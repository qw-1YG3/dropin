// ActiveCommunities family refresh (Phase 3.3, Part 5). Each configured
// municipality (Mississauga, Richmond Hill — see
// lib/dropin/sources/activecommunities/config.ts) is fetched and
// validated independently; one failing never blocks or replaces another's
// successful refresh — refreshMunicipality returns one report per
// municipality, and the CLI (index.ts) is what decides to run them with
// Promise.allSettled-style isolation, same discipline as the app's own
// read-path isolation.
import { fetchAndNormalizeMunicipality, ACTIVE_COMMUNITIES_MUNICIPALITIES, type ActiveCommunitiesMunicipalityConfig } from "../../lib/dropin/sources/activecommunities";
import { municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { refreshOneSource, printReport, type SourceReport } from "./lib";

export async function refreshActiveCommunitiesMunicipality(config: ActiveCommunitiesMunicipalityConfig): Promise<SourceReport> {
  return refreshOneSource({
    municipalitySlug: municipalitySlug(config.municipality),
    municipalityName: config.municipality,
    sourceProvider: config.officialSource,
    fetchRaw: async () => {
      const result = await fetchAndNormalizeMunicipality(config);
      return {
        raw: result,
        recordCount: result.sourceRecordCount,
        sourceFreshness: result.sourceFreshness ? { horizon: result.sourceFreshness } : undefined,
      };
    },
    normalize: (raw) => {
      const result = raw as Awaited<ReturnType<typeof fetchAndNormalizeMunicipality>>;
      return { sessions: result.sessions, ageJoin: result.ageJoin };
    },
  });
}

export async function refreshAllActiveCommunities(): Promise<SourceReport[]> {
  const results = await Promise.allSettled(ACTIVE_COMMUNITIES_MUNICIPALITIES.map((config) => refreshActiveCommunitiesMunicipality(config)));
  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const config = ACTIVE_COMMUNITIES_MUNICIPALITIES[i];
    return {
      source: config.officialSource,
      municipality: config.municipality,
      fetchStatus: "failure" as const,
      durationMs: 0,
      activated: false,
      warnings: [],
      failureReason: `unexpected error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    };
  });
}

// Runnable standalone: `npx tsx scripts/refresh/activecommunities.ts [municipality-name]`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const arg = process.argv[2];
    let reports: SourceReport[];
    if (arg) {
      const config = ACTIVE_COMMUNITIES_MUNICIPALITIES.find((c) => municipalitySlug(c.municipality) === municipalitySlug(arg));
      if (!config) {
        console.error(`Unknown ActiveCommunities municipality "${arg}". Known: ${ACTIVE_COMMUNITIES_MUNICIPALITIES.map((c) => c.municipality).join(", ")}`);
        process.exit(1);
      }
      reports = [await refreshActiveCommunitiesMunicipality(config)];
    } else {
      reports = await refreshAllActiveCommunities();
    }
    printReport(reports);
    process.exit(reports.every((r) => r.activated) ? 0 : 1);
  })();
}
