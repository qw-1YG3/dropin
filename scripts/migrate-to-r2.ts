// One-time bridge from local canonical snapshots to R2 production storage
// (Phase 5B-2B). Explicit and manual by design — never invoked by
// refresh:data, never scheduled, and requires the owner to have already
// completed the Phase 5B-2A Cloudflare setup and configured R2 write
// credentials locally (see docs/PHASE_5B2B_R2_STORAGE_INTEGRATION.md §9).
//
// Usage:
//   SNAPSHOT_STORAGE=r2 npm run migrate:r2 -- --dry-run   (validate only, upload nothing)
//   SNAPSHOT_STORAGE=r2 npm run migrate:r2                (validate, then upload)
//
// Every municipality's local canonical/<slug>/latest.json is validated
// with the exact same validateCanonicalSessions() gate the routine daily
// refresh already uses before it's ever allowed to reach R2 — a missing
// or corrupt local snapshot is reported and skipped, never uploaded as if
// it were good.
import { LocalFilesystemSnapshotStorage, createRefreshStorage, isR2StorageMode } from "../lib/dropin/snapshot/io";
import { canonicalLatestPath, canonicalPreviousPath, municipalitySlug } from "../lib/dropin/snapshot/paths";
import { validateCanonicalSessions } from "../lib/dropin/snapshot/validate";
import type { CanonicalSnapshot } from "../lib/dropin/snapshot/types";

const MUNICIPALITIES = ["Toronto", "Mississauga", "Richmond Hill", "Vaughan", "Markham", "Newmarket", "Aurora"];

type MigrationResult = { municipality: string; outcome: "uploaded" | "would-upload" | "skipped-missing" | "skipped-invalid" | "failed"; detail: string };

async function migrateOne(municipality: string, dryRun: boolean): Promise<MigrationResult> {
  const slug = municipalitySlug(municipality);
  const local = new LocalFilesystemSnapshotStorage();

  const snapshot = await local.readJsonIfExists<CanonicalSnapshot>(canonicalLatestPath(slug));
  if (!snapshot) {
    return { municipality, outcome: "skipped-missing", detail: "no local canonical/latest.json found — run npm run refresh:data first" };
  }

  const validation = validateCanonicalSessions(snapshot.sessions, municipality);
  if (!validation.ok) {
    return { municipality, outcome: "skipped-invalid", detail: `local snapshot failed validation, not uploaded: ${validation.errors.join("; ")}` };
  }

  if (dryRun) {
    return { municipality, outcome: "would-upload", detail: `${snapshot.sessions.length} sessions, fetched ${snapshot.metadata.fetchedAt} — valid, ready to upload` };
  }

  try {
    const remote = createRefreshStorage();
    await remote.writeAtomic(canonicalLatestPath(slug), canonicalPreviousPath(slug), snapshot);
    return { municipality, outcome: "uploaded", detail: `${snapshot.sessions.length} sessions uploaded to production/canonical/${slug}/latest.json` };
  } catch (err) {
    return { municipality, outcome: "failed", detail: `upload failed, previous production snapshot (if any) left untouched: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!isR2StorageMode()) {
    console.error("[migrate-to-r2] SNAPSHOT_STORAGE=r2 is not set — refusing to run. This script only makes sense when targeting R2; set SNAPSHOT_STORAGE=r2 (and the R2_* credentials) and try again.");
    process.exit(1);
  }

  console.log(`[migrate-to-r2] ${dryRun ? "DRY RUN — validating only, nothing will be uploaded" : "LIVE — validated snapshots will be uploaded to R2"}\n`);

  const results: MigrationResult[] = [];
  for (const municipality of MUNICIPALITIES) {
    const result = await migrateOne(municipality, dryRun);
    results.push(result);
    console.log(`${result.municipality.padEnd(16)} ${result.outcome.padEnd(16)} ${result.detail}`);
  }

  const uploaded = results.filter((r) => r.outcome === "uploaded" || r.outcome === "would-upload").length;
  const problems = results.filter((r) => r.outcome === "skipped-invalid" || r.outcome === "failed").length;
  console.log(`\n[migrate-to-r2] ${uploaded}/${results.length} municipalities ${dryRun ? "would be uploaded" : "uploaded"}; ${problems} had a real problem (invalid or failed, not merely missing).`);

  if (results.some((r) => r.outcome === "failed")) process.exit(1);
}

main().catch((err) => {
  console.error("[migrate-to-r2] fatal error:", err);
  process.exit(1);
});
