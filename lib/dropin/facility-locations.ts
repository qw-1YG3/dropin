// Canonical facility location model (Phase 4.1). Coordinates are a
// FACILITY attribute, not a session attribute — verified directly against
// real data in Phase 4.0 (every session at a given Vaughan facility shares
// the exact same lat/long). This module is the one place that concept
// lives: a small, deterministic facility identity, a coordinate lookup
// keyed by that identity, and a pure join that enriches sessions from it.
//
// This is deliberately NOT a database or CMS. At DropIn's current scale
// (~400-450 real facility identities across 7 municipalities, Phase 4.0
// §2/§5) a single JSON snapshot artifact — built by a separate, deliberate
// process (scripts/refresh/facility-locations.ts), never by the routine
// per-municipality data refresh — is the smallest architecture that does
// the job, reusing the exact same SnapshotStorage abstraction Phase 3.3
// already established for raw/canonical session snapshots.
import type { Session } from "./types";
import { isValidGtaCoordinate } from "./coordinates";
import { readJsonIfExists } from "./snapshot/io";
import { facilityLocationsLatestPath } from "./snapshot/paths";

// Where a facility's coordinate actually came from — tracked for every
// entry so a future maintainer (or this project's own future self) can
// tell "the source booking platform told us this" apart from "we guessed
// it from an address," without having to re-derive that from scratch.
// Deliberately never surfaced in the UI (Part 4) — this is operational
// provenance, not a user-facing trust signal (Session.verificationStatus
// already owns that job).
export type CoordinateProvenance =
  // Tier 1 — the same official recreation-booking source that already
  // supplies the session itself also returns a real coordinate directly
  // (PerfectMind's Address.Latitude/Longitude for Vaughan/Markham/Newmarket).
  | "official-source"
  // Tier 2 — a *different* official/government dataset for the same
  // municipality, joined by facility name/address (Toronto's own "Parks
  // and Recreation Facilities" open data, joined against Toronto Open
  // Data's session source, which itself has no coordinate field).
  | "official-facility-source"
  // Tier 3 — no official coordinate found anywhere; resolved by geocoding
  // a facility name (Phase 4.1's fallback for Mississauga/Richmond
  // Hill/Aurora, and any individual gap in tiers 1/2).
  | "geocoded"
  // Recorded, not silently dropped — a facility DropIn knows exists (from
  // real session data) but has no reliable coordinate for at all.
  | "unresolved";

export type FacilityLocationEntry = {
  municipality: string;
  // The lookup key this entry answers for — see facilityLookupKey(). Not
  // necessarily identical to any one session's raw `centre` string:
  // Richmond Hill's room-suffixed variants ("Oak Ridges CC - Gym A") share
  // one entry keyed by the base building name.
  lookupKey: string;
  // Every real, distinct source `centre` string this entry resolves for —
  // kept so the facility inventory itself documents which raw identities
  // were grouped together, auditable rather than implicit.
  sourceFacilityNames: string[];
  sessionCount: number;
  latitude?: number;
  longitude?: number;
  provenance: CoordinateProvenance;
  // The address/query text actually used to obtain this coordinate —
  // present for official-facility-source and geocoded entries, kept
  // distinct from any session's own `address` field (never overwritten).
  resolvedFrom?: string;
  resolvedAt: string;
};

export type FacilityLocationSnapshot = {
  metadata: {
    generatedAt: string;
    totalFacilities: number;
    resolvedCount: number;
    // One count per provenance tier — the honest coverage picture this
    // phase's report is built from.
    byProvenance: Record<CoordinateProvenance, number>;
  };
  entries: FacilityLocationEntry[];
};

// Richmond Hill's own facility-naming convention (confirmed against 100%
// of its real centre strings, Phase 4.1 audit) puts the real building name
// before a " - " delimiter and the room/subspace after it — e.g. "Oak
// Ridges CC - Gym A" / "Oak Ridges CC - Aerobic Room" are the same real
// building. This is a deterministic, source-consistent structural rule,
// not fuzzy string similarity — it only fires for the one municipality
// whose data was confirmed to follow it. Every other municipality's
// `centre` string is used as its own facility identity unchanged: Toronto
// and PerfectMind's own facility field are already close to 1:1 with real
// buildings (Phase 4.0 §2), and Mississauga's room-suffixed titles (e.g.
// "Meadowvale CC Fitness Studio") have no equally reliable delimiter to
// split on, so they're deliberately left as distinct identities rather
// than merged on a guess — see docs/PHASE_4_1_FACILITY_LOCATION_GEOCODING.md
// Part 2 for the full evidence either way.
function baseFacilityName(municipality: string, centre: string): string {
  if (municipality === "Richmond Hill" && centre.includes(" - ")) {
    return centre.split(" - ")[0].trim();
  }
  return centre;
}

export function facilityLookupKey(municipality: string, centre: string): string {
  return `${municipality}::${baseFacilityName(municipality, centre)}`;
}

// Facility names that exist in real session data but don't refer to a
// physical place at all — must never be geocoded or assigned a
// coordinate. Confirmed by scanning every real `centre` value across all
// 7 municipalities for this phase; "Virtual" (Aurora) is the only match
// found. A narrow, explicit check rather than a broad heuristic, so it
// only ever excludes what's actually been confirmed non-physical.
const NON_PHYSICAL_FACILITY_NAMES = new Set(["Virtual"]);

export function isPhysicalFacility(centre: string): boolean {
  return !NON_PHYSICAL_FACILITY_NAMES.has(centre.trim());
}

export function buildFacilityLocationLookup(snapshot: FacilityLocationSnapshot): Map<string, FacilityLocationEntry> {
  return new Map(snapshot.entries.map((e) => [e.lookupKey, e]));
}

// A plain local file read (via the same SnapshotStorage-backed
// readJsonIfExists every other snapshot uses) — not a network call, and
// safe to call from the refresh pipeline as often as needed. Cached at
// module scope for the lifetime of one script invocation (refresh scripts
// are short-lived CLI processes, not a long-running server, so this never
// goes stale mid-run) so refreshing all 7 municipalities in one process
// only reads the file once. Deliberately only ever called from
// scripts/refresh/* — the request-path code in sources/index.ts reads
// Session.latitude/longitude directly off the already-enriched canonical
// snapshot and has no reason to load this registry itself.
let cachedLookup: Map<string, FacilityLocationEntry> | undefined;

export function loadFacilityLocationLookup(): Map<string, FacilityLocationEntry> {
  if (cachedLookup) return cachedLookup;
  const snapshot = readJsonIfExists<FacilityLocationSnapshot>(facilityLocationsLatestPath());
  cachedLookup = snapshot ? buildFacilityLocationLookup(snapshot) : new Map();
  return cachedLookup;
}

// Pure join, never mutates its input. A session that already carries its
// own real coordinate (PerfectMind's direct Address.Latitude/Longitude —
// tier "official-source") is left completely untouched; this only fills
// in latitude/longitude for sessions that don't have one yet, and only
// when the registry has a validated (GTA-bounded, see coordinates.ts)
// entry for that session's facility. A session whose facility has no
// resolved entry, or whose entry's coordinate failed validation, is
// returned exactly as it came in — undefined stays undefined, never
// guessed. This is the one place any part of the app should ever derive a
// session's coordinate from its facility, and it never performs a network
// request — the registry it reads is a plain in-memory Map built from an
// already-fetched snapshot.
export function enrichSessionsWithFacilityLocations(sessions: Session[], lookup: Map<string, FacilityLocationEntry>): Session[] {
  return sessions.map((s) => {
    if (s.latitude !== undefined && s.longitude !== undefined) return s;
    const entry = lookup.get(facilityLookupKey(s.municipality, s.centre));
    if (!entry || !isValidGtaCoordinate(entry.latitude, entry.longitude)) return s;
    return { ...s, latitude: entry.latitude, longitude: entry.longitude };
  });
}
