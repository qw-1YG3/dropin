// Live read-only verification against R2 production data (Phase 5B-2B).
// Uses ONLY createAppReadStorage() — the exact same function the deployed
// application's own read path (lib/dropin/sources/index.ts) calls. This
// script has no write/delete code path at all: it calls
// storage.readJsonIfExists() and nothing else, so it is structurally
// incapable of mutating anything, independent of which credential
// happens to be configured.
//
// Usage (note --env-file must precede the script path — see
// scripts/migrate-to-r2.ts's own usage comment for why):
//   npx tsx --env-file=.env.local scripts/verify-r2-read.ts --municipality=aurora
import { createAppReadStorage, isR2StorageMode } from "../lib/dropin/snapshot/io";
import { canonicalLatestPath, municipalitySlug } from "../lib/dropin/snapshot/paths";
import { validateCanonicalSessions } from "../lib/dropin/snapshot/validate";
import type { CanonicalSnapshot } from "../lib/dropin/snapshot/types";

async function main() {
  const municipalityArg = process.argv.find((a) => a.startsWith("--municipality="))?.split("=")[1];
  if (!municipalityArg) {
    console.error("[verify-r2-read] --municipality=<name> is required, e.g. --municipality=aurora");
    process.exit(1);
  }
  if (!isR2StorageMode()) {
    console.error("[verify-r2-read] SNAPSHOT_STORAGE=r2 is not set — refusing to run (this script only makes sense against R2).");
    process.exit(1);
  }

  const slug = municipalitySlug(municipalityArg);
  const key = canonicalLatestPath(slug);

  console.log(`[verify-r2-read] reading "${key}" via createAppReadStorage() — the application's own read-only path...`);
  const storage = createAppReadStorage();
  const snapshot = await storage.readJsonIfExists<CanonicalSnapshot>(key);

  if (!snapshot) {
    console.error(`[verify-r2-read] FAIL — no object found at "${key}"`);
    process.exit(1);
  }

  console.log(`[verify-r2-read] object read: ${snapshot.sessions.length} sessions, fetchedAt=${snapshot.metadata.fetchedAt}, schemaVersion=${snapshot.metadata.schemaVersion}`);

  // Validate against the snapshot's OWN recorded municipality name
  // (already correctly cased, e.g. "Aurora") rather than the raw CLI
  // argument (typically a lowercase slug, e.g. "aurora") — avoids a
  // spurious casing mismatch that would report every session as
  // belonging to the "wrong" municipality when it doesn't.
  const validation = validateCanonicalSessions(snapshot.sessions, snapshot.metadata.municipality);
  if (!validation.ok) {
    console.error(`[verify-r2-read] FAIL — snapshot failed validation: ${validation.errors.join("; ")}`);
    process.exit(1);
  }

  console.log(`[verify-r2-read] PASS — ${snapshot.sessions.length} sessions read from "${key}", validated successfully.`);
  console.log("[verify-r2-read] credential class used: read-only (createAppReadStorage cannot construct with write credentials). No write or delete call was made.");
}

main().catch((err) => {
  // Deliberately logs only err.message, never raw error objects that
  // could contain request internals — consistent with the rest of this
  // codebase's error-handling convention.
  console.error("[verify-r2-read] fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
