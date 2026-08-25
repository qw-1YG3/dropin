// Facility-location build/update process (Phase 4.1, Part 6/9). This is
// deliberately NOT part of `npm run refresh:data` — it resolves coordinates
// for DropIn's ~400-450 real facility identities, a slow-changing, mostly
// stable inventory (community centres don't move), and re-running it on
// every routine session refresh would mean redundant network calls
// (including external geocoding) for a result that essentially never
// changes. Run it explicitly (`npm run refresh:facilities`) after a
// `refresh:data` run has produced canonical snapshots to build the
// inventory from, or periodically/manually thereafter.
//
// Source priority per facility, highest first (Part 4):
//   1. official-source            — a session at this facility already
//                                    carries a real coordinate from its own
//                                    booking-platform source (PerfectMind).
//   2. official-facility-source   — a different official government
//                                    dataset for the same municipality,
//                                    matched by name/address (Toronto's own
//                                    Parks and Recreation Facilities open
//                                    data).
//   3. geocoded                   — Nominatim, only once tiers 1-2 are
//                                    exhausted for a real physical facility.
//   4. unresolved                 — recorded honestly, never invented.
//
// Never overwrites a higher tier with a lower one, and never touches a
// canonical session snapshot directly — this script only reads canonical
// snapshots (to enumerate real facilities) and writes the separate
// facility-location snapshot; `scripts/refresh/*.ts`'s own normalize steps
// are what join this registry onto sessions, on the next `refresh:data` run.
import { createRefreshStorage, readLocalJsonIfExists, writeLocalJsonAtomic } from "../../lib/dropin/snapshot/io";
import { facilityLocationsLatestPath, facilityLocationsPreviousPath, canonicalLatestPath } from "../../lib/dropin/snapshot/paths";
import { municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { isValidGtaCoordinate } from "../../lib/dropin/coordinates";
import {
  facilityLookupKey,
  isPhysicalFacility,
  type CoordinateProvenance,
  type FacilityLocationEntry,
  type FacilityLocationSnapshot,
} from "../../lib/dropin/facility-locations";
import type { CanonicalSnapshot } from "../../lib/dropin/snapshot/types";
import { fetchTorontoFacilities, matchTorontoFacility } from "./facility-sources/toronto-open-data";
import { geocodeNominatim, isPlausibleFacilityResult, buildGeocodingQuery } from "./facility-sources/nominatim";

const MUNICIPALITIES = ["Toronto", "Mississauga", "Richmond Hill", "Vaughan", "Markham", "Newmarket", "Aurora"];

type RawFacility = {
  municipality: string;
  lookupKey: string;
  sourceFacilityNames: Set<string>;
  sessionCount: number;
  // A real coordinate already present on at least one session at this
  // facility (tier 1) — undefined if none of its sessions carry one.
  sourceCoordinate: { latitude: number; longitude: number } | undefined;
  // One real address seen on a session at this facility, if any — used
  // only as a matching aid for tier 2/3, never written back as if it were
  // a session's own field.
  sampleAddress: string | undefined;
};

// Only PerfectMind (Vaughan, Markham, Newmarket) is confirmed (Phase 3.4/
// 3.5B, re-confirmed this phase) to return real coordinates directly from
// its own booking-platform source — every other family (Toronto,
// ActiveCommunities) has zero native coordinate fields. This matters
// specifically because this script is re-runnable: once a facility has
// been enriched once, its coordinate now lives on the very canonical
// session rows this function reads, and naively trusting any present
// `s.latitude`/`s.longitude` as tier-1 evidence would misclassify an
// already-geocoded or already-official-facility-source coordinate as if
// it came straight from the booking platform, permanently losing its real
// provenance on every subsequent rebuild. Restricting tier-1 detection to
// the source families actually confirmed to provide it keeps re-runs
// idempotent and the provenance trail honest.
const SOURCES_WITH_NATIVE_COORDINATES = new Set(["Vaughan", "Markham", "Newmarket"]);

async function buildRawFacilityInventory(): Promise<Map<string, RawFacility>> {
  const storage = createRefreshStorage();
  const facilities = new Map<string, RawFacility>();
  for (const municipality of MUNICIPALITIES) {
    const slug = municipalitySlug(municipality);
    const snapshot = await storage.readJsonIfExists<CanonicalSnapshot>(canonicalLatestPath(slug));
    if (!snapshot) {
      console.warn(`[facility-locations] no canonical snapshot for ${municipality} yet — run refresh:data first. Skipping.`);
      continue;
    }
    const trustsNativeCoordinate = SOURCES_WITH_NATIVE_COORDINATES.has(municipality);
    for (const s of snapshot.sessions) {
      const key = facilityLookupKey(municipality, s.centre);
      if (!facilities.has(key)) {
        facilities.set(key, {
          municipality,
          lookupKey: key,
          sourceFacilityNames: new Set(),
          sessionCount: 0,
          sourceCoordinate: undefined,
          sampleAddress: undefined,
        });
      }
      const f = facilities.get(key)!;
      f.sourceFacilityNames.add(s.centre);
      f.sessionCount++;
      if (trustsNativeCoordinate && !f.sourceCoordinate && s.latitude !== undefined && s.longitude !== undefined) {
        f.sourceCoordinate = { latitude: s.latitude, longitude: s.longitude };
      }
      if (!f.sampleAddress && s.address) f.sampleAddress = s.address;
    }
  }
  return facilities;
}

// A small number of real facilities need a query text that differs from
// the automatic truncation/expansion (buildGeocodingQuery) to resolve
// correctly — confirmed individually, live, this phase. Each entry here is
// a verified alternate query, not a guess: "Aurora Rec Cplx" is
// deliberately absent even though "Aurora Community Centre" geocodes
// successfully, because that's a real, different Aurora facility with no
// confirmed evidence it's the same physical place as "Aurora Rec Cplx" —
// left unresolved rather than assumed.
const GEOCODING_QUERY_OVERRIDES: Record<string, string> = {
  "Richmond Hill::Ed Sackfield": "Ed Sackfield Arena, Richmond Hill, Ontario, Canada",
  "Vaughan::Woodbridge Pool & Memorial Arena": "Woodbridge Memorial Arena, Vaughan, Ontario, Canada",
};

async function resolveEntry(
  facility: RawFacility,
  torontoFacilities: Awaited<ReturnType<typeof fetchTorontoFacilities>> | undefined,
  existing: FacilityLocationEntry | undefined,
): Promise<FacilityLocationEntry> {
  const now = new Date().toISOString();
  const base: Omit<FacilityLocationEntry, "provenance" | "latitude" | "longitude" | "resolvedFrom"> = {
    municipality: facility.municipality,
    lookupKey: facility.lookupKey,
    sourceFacilityNames: [...facility.sourceFacilityNames].sort(),
    sessionCount: facility.sessionCount,
    resolvedAt: now,
  };

  // Idempotency (Part 6/9): once a facility has been resolved via a real
  // official-facility-source match or geocoding, re-running this script
  // reuses that same result rather than re-deriving it — critical because
  // after one successful run, the coordinate this entry produced is now
  // ALSO present on the canonical session rows buildRawFacilityInventory()
  // reads (facility-location enrichment writes it back into the snapshot,
  // Part 10), which would otherwise look identical to a genuine tier-1
  // official-source coordinate on a second run and silently overwrite this
  // entry's real provenance. Only an "unresolved" prior result is retried
  // fresh each run, in case an official source improves in the meantime.
  if (existing && existing.provenance !== "unresolved") {
    return { ...base, provenance: existing.provenance, latitude: existing.latitude, longitude: existing.longitude, resolvedFrom: existing.resolvedFrom };
  }

  // Tier 1 — official-source, already on the session.
  if (facility.sourceCoordinate && isValidGtaCoordinate(facility.sourceCoordinate.latitude, facility.sourceCoordinate.longitude)) {
    return { ...base, provenance: "official-source", latitude: facility.sourceCoordinate.latitude, longitude: facility.sourceCoordinate.longitude };
  }

  const representativeName = [...facility.sourceFacilityNames][0];
  if (!isPhysicalFacility(representativeName)) {
    return { ...base, provenance: "unresolved" };
  }

  // Tier 2 — official-facility-source (Toronto only, this phase).
  if (facility.municipality === "Toronto" && torontoFacilities) {
    const match = matchTorontoFacility(torontoFacilities, representativeName, facility.sampleAddress);
    if (match && isValidGtaCoordinate(match.latitude, match.longitude)) {
      return {
        ...base,
        provenance: "official-facility-source",
        latitude: match.latitude,
        longitude: match.longitude,
        resolvedFrom: `Toronto Parks and Recreation Facilities: "${match.assetName}", ${match.address}`,
      };
    }
  }

  // Tier 3 — geocoded fallback.
  try {
    const query = GEOCODING_QUERY_OVERRIDES[facility.lookupKey] ?? buildGeocodingQuery(facility.municipality, representativeName);
    const results = await geocodeNominatim(query);
    const accepted = results.find((r) => isPlausibleFacilityResult(r) && isValidGtaCoordinate(Number(r.lat), Number(r.lon)));
    if (accepted) {
      return {
        ...base,
        provenance: "geocoded",
        latitude: Number(accepted.lat),
        longitude: Number(accepted.lon),
        resolvedFrom: `Nominatim: "${query}" -> ${accepted.display_name} (${accepted.category}/${accepted.type})`,
      };
    }
    if (results.length > 0) {
      console.warn(`[facility-locations] geocode for "${query}" returned only rejected/out-of-bounds results (top: ${results[0].category}/${results[0].type}) — not activated`);
    }
  } catch (err) {
    console.warn(`[facility-locations] geocoding failed for "${representativeName}" (${facility.municipality}): ${err instanceof Error ? err.message : err}`);
  }

  return { ...base, provenance: "unresolved" };
}

// Coordinate-quality re-validation across the WHOLE resolved set (Part 8) —
// beyond the per-entry GTA-bounds check already applied above, this catches
// the one failure mode that only shows up in aggregate: the same
// coordinate pair being assigned to more than one clearly UNRELATED
// facility (a sign of a bad geocode match, e.g. resolving to a municipal
// centroid instead of the real address). Deliberately NOT flagging the
// expected, benign case: several of a single building's own room/subspace
// entries (e.g. "Meadowvale CC Fitness Studio" and "Meadowvale CC Main
// Pool", independently geocoded, Part 2's deliberate no-merge decision)
// legitimately converging on the same real coordinate — that's a positive
// cross-check on geocoding accuracy, not a defect. Distinguished here by
// whether every member of a coordinate group shares the same leading word
// of its facility name (an exact, not fuzzy, string comparison).
function leadingWord(name: string): string {
  return name.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

function findSuspiciousDuplicateCoordinates(entries: FacilityLocationEntry[]): string[] {
  const byCoord = new Map<string, FacilityLocationEntry[]>();
  for (const e of entries) {
    if (e.latitude === undefined || e.longitude === undefined) continue;
    const key = `${e.latitude.toFixed(5)},${e.longitude.toFixed(5)}`;
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key)!.push(e);
  }
  const warnings: string[] = [];
  for (const [coord, group] of byCoord) {
    if (group.length <= 1) continue;
    const leadingWords = new Set(group.flatMap((g) => g.sourceFacilityNames.map(leadingWord)));
    if (leadingWords.size > 1) {
      warnings.push(`${coord} shared by ${group.length} facilities with DIFFERENT names: ${group.map((g) => g.lookupKey).join(" | ")}`);
    }
  }
  return warnings;
}

async function main() {
  const raw = await buildRawFacilityInventory();
  console.log(`[facility-locations] ${raw.size} real facility identities found across canonical snapshots.`);

  // The facility-location registry itself is explicitly out of scope for
  // the R2 migration (Phase 5B-2A) — small, infrequently updated, stays
  // git-tracked. Always local, regardless of SNAPSHOT_STORAGE, even when
  // the canonical snapshots this script reads FROM (above) come from R2.
  const previousSnapshot = readLocalJsonIfExists<FacilityLocationSnapshot>(facilityLocationsLatestPath());
  const previousByKey = new Map((previousSnapshot?.entries ?? []).map((e) => [e.lookupKey, e]));
  if (previousSnapshot) {
    console.log(`[facility-locations] found an existing snapshot with ${previousSnapshot.entries.length} entries — already-resolved facilities will be reused, not re-derived.`);
  }

  let torontoFacilities;
  try {
    torontoFacilities = await fetchTorontoFacilities();
    console.log(`[facility-locations] fetched ${torontoFacilities.length} records from Toronto's official Parks and Recreation Facilities dataset.`);
  } catch (err) {
    console.warn(`[facility-locations] could not fetch Toronto's official facilities dataset (${err instanceof Error ? err.message : err}) — Toronto will fall back to geocoding this run.`);
  }

  const entries: FacilityLocationEntry[] = [];
  let i = 0;
  let reused = 0;
  for (const facility of raw.values()) {
    i++;
    const existing = previousByKey.get(facility.lookupKey);
    if (existing && existing.provenance !== "unresolved") reused++;
    const entry = await resolveEntry(facility, torontoFacilities, existing);
    entries.push(entry);
    if (entry.provenance === "geocoded" || entry.provenance === "unresolved") {
      console.log(`[facility-locations] (${i}/${raw.size}) ${entry.lookupKey} -> ${entry.provenance}`);
    }
  }
  console.log(`[facility-locations] ${reused}/${raw.size} facilities reused from the previous snapshot without re-deriving.`);

  const duplicateWarnings = findSuspiciousDuplicateCoordinates(entries);
  if (duplicateWarnings.length > 0) {
    console.warn(`[facility-locations] ${duplicateWarnings.length} suspicious duplicate-coordinate group(s) found:`);
    for (const w of duplicateWarnings) console.warn(`  ${w}`);
  }

  const byProvenance: Record<CoordinateProvenance, number> = {
    "official-source": 0,
    "official-facility-source": 0,
    geocoded: 0,
    unresolved: 0,
  };
  for (const e of entries) byProvenance[e.provenance]++;

  const snapshot: FacilityLocationSnapshot = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalFacilities: entries.length,
      resolvedCount: entries.length - byProvenance.unresolved,
      byProvenance,
    },
    entries,
  };

  writeLocalJsonAtomic(facilityLocationsLatestPath(), facilityLocationsPreviousPath(), snapshot);

  console.log("\n" + "=".repeat(78));
  console.log("FACILITY LOCATION BUILD REPORT");
  console.log("=".repeat(78));
  console.log(`Total facilities:          ${snapshot.metadata.totalFacilities}`);
  console.log(`Resolved:                  ${snapshot.metadata.resolvedCount}`);
  console.log(`  official-source:         ${byProvenance["official-source"]}`);
  console.log(`  official-facility-source:${byProvenance["official-facility-source"]}`);
  console.log(`  geocoded:                ${byProvenance.geocoded}`);
  console.log(`  unresolved:              ${byProvenance.unresolved}`);
  console.log("=".repeat(78) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[facility-locations] fatal error:", err);
    process.exit(1);
  });
}
