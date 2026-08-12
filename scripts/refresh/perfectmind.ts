// PerfectMind family refresh (Phase 3.5B, Part 17). Each configured
// municipality (Vaughan, Markham — see
// lib/dropin/sources/perfectmind/config.ts) is fetched and validated
// independently; one failing never blocks or replaces another's successful
// refresh, same source-isolated discipline as ../activecommunities.ts.
//
// The completion gate (Part 5) lives inside
// lib/dropin/sources/perfectmind/index.ts's fetchAndNormalizeMunicipality —
// it throws when any category's pagination doesn't reach a genuine stop
// condition. That throw surfaces here as an ordinary fetchRaw() failure, so
// refreshOneSource's existing "fetch failed -> write no snapshot, activate
// nothing" path is what actually enforces "a partial refresh must never
// replace healthy data" — nothing PerfectMind-specific needed in lib.ts.
import { fetchAndNormalizeMunicipality, PERFECTMIND_MUNICIPALITIES, type PerfectMindMunicipalityConfig } from "../../lib/dropin/sources/perfectmind";
import { municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { refreshOneSource, printReport, printReportJson, type SourceReport } from "./lib";

export async function refreshPerfectMindMunicipality(config: PerfectMindMunicipalityConfig): Promise<SourceReport> {
  return refreshOneSource({
    municipalitySlug: municipalitySlug(config.municipality),
    municipalityName: config.municipality,
    sourceProvider: config.officialSource,
    fetchRaw: async () => {
      const result = await fetchAndNormalizeMunicipality(config);
      return { raw: result, recordCount: result.sourceRecordCount };
    },
    normalize: (raw) => {
      const result = raw as Awaited<ReturnType<typeof fetchAndNormalizeMunicipality>>;
      const warnings = result.categoryReports.map(
        (r) => `${r.category}: ${r.rawRecordCount} records across ${r.pagesUsed} page(s), ${r.requestCount} request(s)`,
      );
      return { sessions: result.sessions, warnings };
    },
  });
}

export async function refreshAllPerfectMind(): Promise<SourceReport[]> {
  const results = await Promise.allSettled(PERFECTMIND_MUNICIPALITIES.map((config) => refreshPerfectMindMunicipality(config)));
  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const config = PERFECTMIND_MUNICIPALITIES[i];
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

// Runnable standalone: `npx tsx scripts/refresh/perfectmind.ts [municipality-name]`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const rawArgs = process.argv.slice(2);
    const json = rawArgs.includes("--json");
    const arg = rawArgs.find((a) => !a.startsWith("--"));
    let reports: SourceReport[];
    if (arg) {
      const config = PERFECTMIND_MUNICIPALITIES.find((c) => municipalitySlug(c.municipality) === municipalitySlug(arg));
      if (!config) {
        console.error(`Unknown PerfectMind municipality "${arg}". Known: ${PERFECTMIND_MUNICIPALITIES.map((c) => c.municipality).join(", ")}`);
        process.exit(1);
      }
      reports = [await refreshPerfectMindMunicipality(config)];
    } else {
      reports = await refreshAllPerfectMind();
    }
    if (json) printReportJson(reports);
    else printReport(reports);
    process.exit(reports.every((r) => r.activated) ? 0 : 1);
  })();
}
