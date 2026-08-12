// Snapshot health inspector (Phase 3.3 Part 24, extended in Phase 3.3B).
// Reads snapshot metadata directly off disk — no web server, no app code
// path involved — so it's usable in a deploy pipeline as a pre-flight
// check or just run manually before/after a deployment.
//
// Usage:
//   npm run snapshot:health
//   npm run snapshot:health -- --json
import { readJsonIfExists } from "../lib/dropin/snapshot/io";
import { canonicalLatestPath, canonicalPreviousPath, rawLatestPath, municipalitySlug } from "../lib/dropin/snapshot/paths";
import type { CanonicalSnapshot, RawSnapshot } from "../lib/dropin/snapshot/types";

const MUNICIPALITIES = ["Toronto", "Mississauga", "Richmond Hill", "Vaughan", "Markham"];

// Thresholds derived from the Phase 3.3B recommended 6-hour refresh
// cadence (see docs/PHASE_3_3B_SCHEDULER_DEPLOYMENT_STRATEGY.md Part 10):
// FRESH allows one cadence interval plus slack for a single delayed run;
// AGING covers one or two missed cycles (worth noticing, not yet urgent);
// STALE means multiple consecutive misses — a real operational problem,
// even though the app keeps serving the last known-good data throughout.
export type FreshnessStatus = "fresh" | "aging" | "stale" | "unavailable";

export function classifyFreshness(fetchedAt: string | undefined): FreshnessStatus {
  if (!fetchedAt) return "unavailable";
  const hours = (Date.now() - new Date(fetchedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 8) return "fresh";
  if (hours < 24) return "aging";
  return "stale";
}

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / (1000 * 60))}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

type HealthEntry = {
  municipality: string;
  freshness: FreshnessStatus;
  canonical?: CanonicalSnapshot["metadata"];
  previous?: { canonicalSessionCount: number; fetchedAt: string };
  raw?: { recordCount: number; status: string };
};

function collectHealth(): HealthEntry[] {
  return MUNICIPALITIES.map((municipality) => {
    const slug = municipalitySlug(municipality);
    const canonical = readJsonIfExists<CanonicalSnapshot>(canonicalLatestPath(slug));
    const previous = readJsonIfExists<CanonicalSnapshot>(canonicalPreviousPath(slug));
    const raw = readJsonIfExists<RawSnapshot>(rawLatestPath(slug));
    return {
      municipality,
      freshness: classifyFreshness(canonical?.metadata.fetchedAt),
      canonical: canonical?.metadata,
      previous: previous ? { canonicalSessionCount: previous.metadata.canonicalSessionCount, fetchedAt: previous.metadata.fetchedAt } : undefined,
      raw: raw ? { recordCount: raw.metadata.recordCount, status: raw.metadata.status } : undefined,
    };
  });
}

function printHuman(entries: HealthEntry[]): void {
  for (const entry of entries) {
    console.log(`\n${entry.municipality}`);
    console.log("-".repeat(entry.municipality.length));

    if (!entry.canonical) {
      console.log("  NO CANONICAL SNAPSHOT — never refreshed, or refresh always failed before activating.");
      if (municipalitySlug(entry.municipality) === "toronto") console.log("  (Toronto falls back to the bundled dataset at request time until refreshed.)");
      continue;
    }

    const m = entry.canonical;
    console.log(`  freshness:               ${entry.freshness.toUpperCase()}`);
    console.log(`  last successful fetch:   ${m.fetchedAt} (${ageLabel(m.fetchedAt)})`);
    console.log(`  normalized at:           ${m.normalizedAt}`);
    console.log(`  session count:           ${m.canonicalSessionCount}`);
    console.log(`  source record count:     ${m.sourceRecordCount}`);
    if (m.ageJoin) console.log(`  age join rate:           ${m.ageJoin.matchedSessions}/${m.ageJoin.totalSessions} (${((100 * m.ageJoin.matchedSessions) / Math.max(1, m.ageJoin.totalSessions)).toFixed(1)}%)`);
    if (m.sourceFreshness?.horizon) console.log(`  source horizon:          ${m.sourceFreshness.horizon.startDate} to ${m.sourceFreshness.horizon.endDate}`);
    if (m.warnings && m.warnings.length > 0) for (const w of m.warnings) console.log(`  warning:                 ${w}`);
    console.log(`  has previous snapshot:   ${entry.previous ? `yes (${entry.previous.canonicalSessionCount} sessions, ${ageLabel(entry.previous.fetchedAt)})` : "no"}`);
    console.log(`  has raw snapshot:        ${entry.raw ? `yes (${entry.raw.recordCount} records, status=${entry.raw.status})` : "no"}`);
  }
  console.log("");
}

const json = process.argv.includes("--json");
const entries = collectHealth();
if (json) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), municipalities: entries }));
} else {
  printHuman(entries);
}
