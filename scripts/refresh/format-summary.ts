// Formats the JSON output of `npm run refresh:data -- --all --json` into a
// clear, human-scannable markdown summary (Phase 5B-3 Part 8: "avoid
// partial or misleading success" — every municipality's actual outcome
// must be visible, not just an overall pass/fail). Reads from stdin,
// writes markdown to stdout — designed to be piped straight into GitHub
// Actions' $GITHUB_STEP_SUMMARY so a scheduled run's per-municipality
// state is visible on the run's own summary page, without needing to open
// the raw logs. Pure formatting only — never touches R2, never reads a
// credential, never mutates anything.
import type { SourceReport } from "./lib";

type ReportPayload = { generatedAt: string; succeeded: number; total: number; allActivated: boolean; reports: SourceReport[] };

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

export function formatSummary(payload: ReportPayload): string {
  const lines: string[] = [];
  lines.push(`## Daily Refresh Summary — ${payload.generatedAt}`);
  lines.push("");
  lines.push(
    payload.allActivated
      ? `**${payload.succeeded}/${payload.total} municipalities refreshed successfully.**`
      : `**${payload.succeeded}/${payload.total} municipalities refreshed — ${payload.total - payload.succeeded} did not activate a new snapshot (previous known-good data was preserved for those).**`,
  );
  lines.push("");
  lines.push("| Municipality | Status | Sessions | Duration | Detail |");
  lines.push("|---|---|---|---|---|");
  for (const r of payload.reports) {
    const status = r.activated ? "refreshed" : "FAILED — previous snapshot kept";
    const sessions = r.canonicalSessionCount ?? "—";
    const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
    const detail = r.failureReason ?? (r.warnings.length > 0 ? r.warnings.join("; ") : "—");
    lines.push(`| ${r.municipality} | ${status} | ${sessions} | ${duration} | ${detail} |`);
  }
  return lines.join("\n");
}

async function main() {
  const raw = await readStdin();
  let payload: ReportPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.log("## Daily Refresh Summary\n\n_Could not parse refresh output as JSON — see raw workflow logs for details._");
    return;
  }
  console.log(formatSummary(payload));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
