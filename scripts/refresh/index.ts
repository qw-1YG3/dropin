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
import { refreshToronto } from "./toronto";
import { refreshActiveCommunitiesMunicipality, refreshAllActiveCommunities } from "./activecommunities";
import { ACTIVE_COMMUNITIES_MUNICIPALITIES } from "../../lib/dropin/sources/activecommunities";
import { municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { printReport, type SourceReport } from "./lib";

function parseArgs(argv: string[]): { all: boolean; municipality: string | undefined } {
  const municipalityArg = argv.find((a) => a.startsWith("--municipality="));
  const municipality = municipalityArg?.split("=")[1];
  const all = argv.includes("--all") || !municipality;
  return { all, municipality };
}

async function main() {
  const { all, municipality } = parseArgs(process.argv.slice(2));
  const reports: SourceReport[] = [];

  if (all) {
    console.log("Refreshing all sources...\n");
    // Source-isolated by construction: each of these already contains its
    // own try/catch (Toronto) or Promise.allSettled (the AC family) inside
    // refreshOneSource, so one throwing here would itself be a bug — but
    // wrap anyway rather than trusting that invariant silently.
    const [torontoReport, acReports] = await Promise.all([
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
    ]);
    reports.push(torontoReport, ...acReports);
  } else if (municipality) {
    const slug = municipalitySlug(municipality);
    if (slug === "toronto") {
      reports.push(await refreshToronto());
    } else {
      const config = ACTIVE_COMMUNITIES_MUNICIPALITIES.find((c) => municipalitySlug(c.municipality) === slug);
      if (!config) {
        console.error(`Unknown municipality "${municipality}". Known: toronto, ${ACTIVE_COMMUNITIES_MUNICIPALITIES.map((c) => municipalitySlug(c.municipality)).join(", ")}`);
        process.exit(1);
      }
      reports.push(await refreshActiveCommunitiesMunicipality(config));
    }
  }

  printReport(reports);
  process.exit(reports.every((r) => r.activated) ? 0 : 1);
}

main();
