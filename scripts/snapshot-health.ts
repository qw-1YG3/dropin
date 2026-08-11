// Snapshot health inspector (Phase 3.3, Part 24). Reads snapshot metadata
// directly off disk — no web server, no app code path involved — so it's
// usable in a deploy pipeline as a pre-flight check or just run manually
// before/after a deployment. Deliberately a CLI, not a UI (Part 24 doesn't
// ask for one, and Part 28 freezes the UI regardless).
//
// Usage: npm run snapshot:health
import { readJsonIfExists } from "../lib/dropin/snapshot/io";
import { canonicalLatestPath, canonicalPreviousPath, rawLatestPath, municipalitySlug } from "../lib/dropin/snapshot/paths";
import type { CanonicalSnapshot, RawSnapshot } from "../lib/dropin/snapshot/types";

const MUNICIPALITIES = ["Toronto", "Mississauga", "Richmond Hill"];

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.round(ms / (1000 * 60))}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${(hours / 24).toFixed(1)}d ago`;
}

for (const municipality of MUNICIPALITIES) {
  const slug = municipalitySlug(municipality);
  console.log(`\n${municipality}`);
  console.log("-".repeat(municipality.length));

  const canonical = readJsonIfExists<CanonicalSnapshot>(canonicalLatestPath(slug));
  const previous = readJsonIfExists<CanonicalSnapshot>(canonicalPreviousPath(slug));
  const raw = readJsonIfExists<RawSnapshot>(rawLatestPath(slug));

  if (!canonical) {
    console.log("  NO CANONICAL SNAPSHOT — never refreshed, or refresh always failed before activating.");
    if (slug === "toronto") console.log("  (Toronto falls back to the bundled dataset at request time until refreshed.)");
    continue;
  }

  const m = canonical.metadata;
  console.log(`  last successful fetch:   ${m.fetchedAt} (${ageLabel(m.fetchedAt)})`);
  console.log(`  normalized at:           ${m.normalizedAt}`);
  console.log(`  session count:           ${m.canonicalSessionCount}`);
  console.log(`  source record count:     ${m.sourceRecordCount}`);
  if (m.ageJoin) console.log(`  age join rate:           ${m.ageJoin.matchedSessions}/${m.ageJoin.totalSessions} (${((100 * m.ageJoin.matchedSessions) / Math.max(1, m.ageJoin.totalSessions)).toFixed(1)}%)`);
  if (m.sourceFreshness?.horizon) console.log(`  source horizon:          ${m.sourceFreshness.horizon.startDate} to ${m.sourceFreshness.horizon.endDate}`);
  if (m.warnings && m.warnings.length > 0) for (const w of m.warnings) console.log(`  warning:                 ${w}`);
  console.log(`  has previous snapshot:   ${previous ? `yes (${previous.metadata.canonicalSessionCount} sessions, ${ageLabel(previous.metadata.fetchedAt)})` : "no"}`);
  console.log(`  has raw snapshot:        ${raw ? `yes (${raw.metadata.recordCount} records, status=${raw.metadata.status})` : "no"}`);
}
console.log("");
