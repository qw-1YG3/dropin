// Data Refresh CLI (Phase 3.3, Part 4). Runs outside the web server and
// outside the user request path entirely — this is the ONLY place that
// fetches from remote municipal sources. Hosting-agnostic on purpose (Part
// 17): it's a plain script with a plain exit code, callable identically
// from a local terminal, a cron entry, a GitHub Actions step, or a
// platform's own scheduled-function feature — nothing here assumes any
// particular scheduler or hosting provider.
//
// Usage:
//   npm run refresh:data -- --all
//   npm run refresh:data -- --municipality=mississauga
//   npm run refresh:data -- --municipality=toronto
//   npm run refresh:data                    (defaults to --all)
//   npm run refresh:data -- --all --json    (machine-readable summary on
//                                             stdout, for a scheduler step
//                                             that wants to parse the
//                                             result — Phase 3.3B Part 21)
import { refreshToronto } from "./toronto";
import { refreshActiveCommunitiesMunicipality, refreshAllActiveCommunities } from "./activecommunities";
import { refreshPerfectMindMunicipality, refreshAllPerfectMind } from "./perfectmind";
import { ACTIVE_COMMUNITIES_MUNICIPALITIES } from "../../lib/dropin/sources/activecommunities";
import { PERFECTMIND_MUNICIPALITIES } from "../../lib/dropin/sources/perfectmind";
import { municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { printReport, printReportJson, type SourceReport } from "./lib";

function parseArgs(argv: string[]): { all: boolean; municipality: string | undefined; json: boolean } {
  const municipalityArg = argv.find((a) => a.startsWith("--municipality="));
  const municipality = municipalityArg?.split("=")[1];
  const all = argv.includes("--all") || !municipality;
  const json = argv.includes("--json");
  return { all, municipality, json };
}

async function main() {
  const { all, municipality, json } = parseArgs(process.argv.slice(2));
  const reports: SourceReport[] = [];

  if (all) {
    if (!json) console.log("Refreshing all sources...\n");
    // Source-isolated by construction: each of these already contains its
    // own try/catch (Toronto) or Promise.allSettled (the AC/PerfectMind
    // families) inside refreshOneSource, so one throwing here would itself
    // be a bug — but wrap anyway rather than trusting that invariant
    // silently.
    const [torontoReport, acReports, pmReports] = await Promise.all([
      refreshToronto().catch((err): SourceReport => ({
        source: "City of Toronto Open Data",
        municipality: "Toronto",
        fetchStatus: "failure",
        durationMs: 0,
        activated: false,
        warnings: [],
        failureReason: `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      })),
      refreshAllActiveCommunities(),
      refreshAllPerfectMind(),
    ]);
    reports.push(torontoReport, ...acReports, ...pmReports);
  } else if (municipality) {
    const slug = municipalitySlug(municipality);
    if (slug === "toronto") {
      reports.push(await refreshToronto());
    } else {
      const acConfig = ACTIVE_COMMUNITIES_MUNICIPALITIES.find((c) => municipalitySlug(c.municipality) === slug);
      const pmConfig = PERFECTMIND_MUNICIPALITIES.find((c) => municipalitySlug(c.municipality) === slug);
      if (acConfig) {
        reports.push(await refreshActiveCommunitiesMunicipality(acConfig));
      } else if (pmConfig) {
        reports.push(await refreshPerfectMindMunicipality(pmConfig));
      } else {
        const known = ["toronto", ...ACTIVE_COMMUNITIES_MUNICIPALITIES.map((c) => municipalitySlug(c.municipality)), ...PERFECTMIND_MUNICIPALITIES.map((c) => municipalitySlug(c.municipality))];
        console.error(`Unknown municipality "${municipality}". Known: ${known.join(", ")}`);
        process.exit(1);
      }
    }
  }

  if (json) {
    printReportJson(reports);
  } else {
    printReport(reports);
  }
  process.exit(reports.every((r) => r.activated) ? 0 : 1);
}

main();
