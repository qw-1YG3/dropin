// One-time bridge from local canonical snapshots to R2 production storage
// (Phase 5B-2B). Explicit and manual by design — never invoked by
// refresh:data, never scheduled, and requires the owner to have already
// completed the Phase 5B-2A Cloudflare setup and configured R2 write
// credentials locally (see docs/PHASE_5B2B_R2_STORAGE_INTEGRATION.md §9).
//
// Usage — note --env-file must precede the script path (a Node flag, not
// a script argument), so this must be run via `npx tsx` directly rather
// than through `npm run migrate:r2 -- ...` (npm's `--` only appends
// arguments after the script path, where --env-file has no effect —
// verified directly, not assumed):
//
//   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts --dry-run
//     (validate only, all 7, upload nothing)
//   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts --municipality=aurora --dry-run
//     (validate one, upload nothing)
//   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts --municipality=aurora
//     (validate + upload just one — the recommended first live-R2 check)
//   npx tsx --env-file=.env.local scripts/migrate-to-r2.ts
//     (validate + upload all 7 — only after a single-municipality run has
//     already succeeded)
//
// .env.local should contain SNAPSHOT_STORAGE=r2 plus every R2_* credential
// (see .env.example) — --env-file loads all of it in one step.
//
// --municipality is the recommended way to perform a first, smallest,
// reversible live-R2 check before ever running a full 7-municipality
// migration — same flag shape as `npm run refresh:data -- --municipality=X`,
// for consistency.
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
  const municipalityArg = process.argv.find((a) => a.startsWith("--municipality="))?.split("=")[1];

  if (!isR2StorageMode()) {
    console.error("[migrate-to-r2] SNAPSHOT_STORAGE=r2 is not set — refusing to run. This script only makes sense when targeting R2; set SNAPSHOT_STORAGE=r2 (and the R2_* credentials) and try again.");
    process.exit(1);
  }

  let targets = MUNICIPALITIES;
  if (municipalityArg) {
    const slug = municipalitySlug(municipalityArg);
    targets = MUNICIPALITIES.filter((m) => municipalitySlug(m) === slug);
    if (targets.length === 0) {
      console.error(`[migrate-to-r2] Unknown municipality "${municipalityArg}". Known: ${MUNICIPALITIES.map((m) => municipalitySlug(m)).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`[migrate-to-r2] ${dryRun ? "DRY RUN — validating only, nothing will be uploaded" : "LIVE — validated snapshots will be uploaded to R2"} (${targets.length}/${MUNICIPALITIES.length} municipalit${targets.length === 1 ? "y" : "ies"} targeted)\n`);

  const results: MigrationResult[] = [];
  for (const municipality of targets) {
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
