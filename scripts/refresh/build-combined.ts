// Builds the combined, field-trimmed "all municipalities" artifact
// (Phase 5B — response-size architecture decision, Option D). This is the
// smallest implementation step of that decision: it produces
// canonical/_combined/latest.json from whatever is CURRENTLY ACTIVE per
// municipality — never a new fetch, never a new source. It does not
// change /api/sessions, does not implement the presigned redirect, and is
// not yet wired into the automatic daily refresh workflow — it's a
// standalone, independently-runnable, independently-verifiable step.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/refresh/build-combined.ts
//
// Last-known-good, by construction, not by special-case handling: each
// municipality's canonicalLatestPath(slug) is ALREADY the last
// successfully-validated snapshot for that municipality (a failed daily
// refresh never overwrites it — Phase 5B-2B/3). Reading that path here
// means a municipality whose most recent refresh failed simply
// contributes its last good data, exactly as required — no extra logic
// needed to achieve that.
import { createRefreshStorage, createAppReadStorage } from "../../lib/dropin/snapshot/io";
import { canonicalLatestPath, combinedLatestPath, combinedPreviousPath, municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { validateCanonicalSessions } from "../../lib/dropin/snapshot/validate";
import type { CanonicalSnapshot } from "../../lib/dropin/snapshot/types";
import type { Session } from "../../lib/dropin/types";

const MUNICIPALITIES = ["Toronto", "Mississauga", "Richmond Hill", "Vaughan", "Markham", "Newmarket", "Aurora"];

// Fields with zero measured client references (Phase 5B response-size
// architecture report, §B) — the only fields this step is authorized to
// remove. Everything else on Session is kept unchanged.
export type TrimmedSession = Omit<Session, "projectedOccurrenceId" | "sourceScheduleId" | "category" | "dayOfWeek" | "day" | "registrationStatus">;

export function trimSession(s: Session): TrimmedSession {
  return {
    id: s.id,
    activity: s.activity,
    date: s.date,
    absoluteTime: s.absoluteTime,
    startMinutes: s.startMinutes,
    startDateTime: s.startDateTime,
    endDateTime: s.endDateTime,
    centre: s.centre,
    municipality: s.municipality,
    district: s.district,
    address: s.address,
    postalCode: s.postalCode,
    latitude: s.latitude,
    longitude: s.longitude,
    distanceKm: s.distanceKm,
    price: s.price,
    ageMin: s.ageMin,
    ageMax: s.ageMax,
    phone: s.phone,
    officialUrl: s.officialUrl,
    officialSource: s.officialSource,
    lastUpdated: s.lastUpdated,
    verificationStatus: s.verificationStatus,
    attendanceRequirement: s.attendanceRequirement,
  };
}

export type CombinedSnapshot = {
  metadata: {
    generatedAt: string;
    schemaVersion: 1;
    totalSessions: number;
    municipalityCounts: Record<string, number>;
    // Municipalities this build could not find any snapshot for at all
    // (never successfully refreshed even once) — distinct from a
    // municipality whose most recent refresh merely failed, which still
    // contributes its last-good data and is not listed here.
    missingMunicipalities: string[];
  };
  sessions: TrimmedSession[];
};

async function main() {
  const readStorage = createRefreshStorage();
  const sessions: TrimmedSession[] = [];
  const municipalityCounts: Record<string, number> = {};
  const missingMunicipalities: string[] = [];
  const allIds = new Set<string>();
  let duplicateAcrossMunicipalities = 0;

  for (const municipality of MUNICIPALITIES) {
    const slug = municipalitySlug(municipality);
    const snapshot = await readStorage.readJsonIfExists<CanonicalSnapshot>(canonicalLatestPath(slug));

    if (!snapshot) {
      console.warn(`[build-combined] no canonical snapshot found for "${municipality}" at all — excluding from combined object.`);
      missingMunicipalities.push(municipality);
      municipalityCounts[municipality] = 0;
      continue;
    }

    // Integrity check on the SOURCE data, before trimming — trimming
    // removes sourceScheduleId, one of validateCanonicalSessions's own
    // required fields, so this must run first or every session would
    // fail validation for a field this step is intentionally dropping,
    // not one that's actually missing from the source.
    const validation = validateCanonicalSessions(snapshot.sessions, municipality);
    if (!validation.ok) {
      console.error(`[build-combined] "${municipality}"'s current active snapshot FAILED integrity validation — excluding from combined object: ${validation.errors.join("; ")}`);
      missingMunicipalities.push(municipality);
      municipalityCounts[municipality] = 0;
      continue;
    }

    municipalityCounts[municipality] = snapshot.sessions.length;
    for (const s of snapshot.sessions) {
      if (allIds.has(s.id)) {
        duplicateAcrossMunicipalities++;
        continue;
      }
      allIds.add(s.id);
      sessions.push(trimSession(s));
    }
  }

  if (duplicateAcrossMunicipalities > 0) {
    console.warn(`[build-combined] ${duplicateAcrossMunicipalities} session id(s) collided across municipalities — first occurrence kept, duplicates dropped. This should not happen if per-municipality id-prefixing is working correctly; worth investigating if seen.`);
  }

  const combined: CombinedSnapshot = {
    metadata: {
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      totalSessions: sessions.length,
      municipalityCounts,
      missingMunicipalities,
    },
    sessions,
  };

  const writeStorage = createRefreshStorage();
  await writeStorage.writeAtomic(combinedLatestPath(), combinedPreviousPath(), combined);
  console.log(`[build-combined] wrote ${sessions.length} sessions to ${combinedLatestPath()} (write credential).`);

  // Read back through the READ-ONLY credential specifically — proves not
  // just "the write succeeded" but that the credential the eventual
  // presigned-redirect will actually use can see this object, under the
  // same production prefix both credentials already share.
  const verifyStorage = createAppReadStorage();
  const readBack = await verifyStorage.readJsonIfExists<CombinedSnapshot>(combinedLatestPath());
  if (!readBack) {
    console.error("[build-combined] FAIL — could not read the object back via the read-only credential immediately after writing it.");
    process.exit(1);
  }

  const json = JSON.stringify(combined);
  console.log(`[build-combined] read-back via read-only credential: PASS — ${readBack.sessions.length} sessions, generatedAt=${readBack.metadata.generatedAt}`);
  console.log(`[build-combined] raw size: ${(json.length / 1_000_000).toFixed(2)} MB`);
  console.log(`[build-combined] municipality counts: ${JSON.stringify(municipalityCounts)}`);
  if (missingMunicipalities.length > 0) {
    console.warn(`[build-combined] municipalities excluded entirely (no valid snapshot found): ${missingMunicipalities.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("[build-combined] fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
