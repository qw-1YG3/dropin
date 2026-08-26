# Phase 5B-2B — R2 Storage Integration

**Scope: application code integration with the approved R2 architecture.** No deployment happened, no domain was touched, no scheduler was enabled, no secret value was requested or recorded anywhere, and — critically — **no canonical data was uploaded to R2**. The code is ready; live R2 verification is explicitly not claimed, since real credentials were never available to Claude in this environment (by design, per Phase 5B-2A).

---

## 1. Files Changed

| File | What changed |
|---|---|
| `lib/dropin/snapshot/paths.ts` | Rewritten to produce backend-agnostic **relative keys** (e.g. `canonical/toronto/latest.json`) instead of local filesystem paths — the same key now means the same logical snapshot regardless of which backend resolves it. |
| `lib/dropin/snapshot/io.ts` | Extended: `SnapshotStorage` interface is now async; `LocalFilesystemSnapshotStorage` unchanged in behavior, adapted to the new key shape; new `R2SnapshotStorage` class; new context-specific factory functions (`createAppReadStorage`, `createRefreshStorage`); new local-only synchronous helpers (`readLocalJsonIfExists`, `writeLocalJsonAtomic`) for the facility-locations registry, which stays out of this migration. |
| `lib/dropin/sources/index.ts` | The application's read path (`loadMunicipalitySessions`) now selects local or R2 storage via `SNAPSHOT_STORAGE`; local mode's mtime-based cache is fully preserved and unchanged; R2 mode reads fresh each request (documented simplification, §3). |
| `lib/dropin/facility-locations.ts` | Import name change only (`readJsonIfExists` → `readLocalJsonIfExists`) — stays synchronous, stays local, zero behavior change. |
| `scripts/refresh/lib.ts` | `refreshOneSource()` now uses `createRefreshStorage()` (async, R2-capable); the final promotion step (raw + canonical writes) is now wrapped in a try/catch that converts an upload failure into a proper failure report rather than an unhandled rejection (§6/§7). |
| `scripts/refresh/facility-locations.ts` | Its canonical-snapshot *reads* (for facility discovery) now go through `createRefreshStorage()`, async, R2-capable; its own registry read/write stays on the local-only synchronous helpers, unaffected by `SNAPSHOT_STORAGE`. |
| `scripts/snapshot-health.ts` | Now async, reads through `createRefreshStorage()` — an operator tool, uses the refresh (read+write-capable) credential context, same as the refresh pipeline itself. |
| `scripts/migrate-to-r2.ts` **(new)** | The explicit, manual, one-time local→R2 canonical-data bridge (§9). |
| `.env.example` **(new)** | Documents every environment-variable **name** this integration introduces — zero values, by design (§8). |
| `.gitignore` | Added a `!.env.example` exception so the names-only file above can actually be committed, while every real `.env*` file remains excluded exactly as before. |
| `package.json` / `package-lock.json` | Added `@aws-sdk/client-s3` (exact-pinned `3.1118.0`) as a production dependency — justification in §11. |

**Not changed**: `app/api/sessions/route.ts` (per M1 — untouched, still the thin `getAllSessions()` wrapper it always was), `app/page.tsx`, `proxy.ts`, any UI, any Privacy copy, any domain/hosting configuration.

---

## 2. `SnapshotStorage` Architecture

One interface, two real implementations, selected by environment — never by municipality:

```ts
interface SnapshotStorage {
  readJsonIfExists<T>(key: string): Promise<T | undefined>;
  writeAtomic(key: string, previousKey: string, data: unknown): Promise<void>;
}
```

- **`LocalFilesystemSnapshotStorage`** — unchanged behavior (temp-file-then-rename, round-trip verified), now resolving the new relative-key shape under `data/` instead of receiving a pre-built absolute path.
- **`R2SnapshotStorage`** — new. Talks to Cloudflare R2 via its S3-compatible API (`@aws-sdk/client-s3`). Each instance is constructed with an explicit `{ accountId, bucketName, accessKeyId, secretAccessKey, keyPrefix }` — never reads `process.env` internally, so the credential source is always visible at the call site that constructs it (§4/§5).

---

## 3. Local vs. R2 Selection

One environment variable, `SNAPSHOT_STORAGE`, checked by `isR2StorageMode()`:

- Unset (or any value other than `"r2"`) → **local filesystem**, byte-identical to pre-Phase-5B-2B behavior. This is the default — nothing about local development changes unless `SNAPSHOT_STORAGE=r2` is deliberately set.
- `"r2"` → Cloudflare R2, via the context-specific factory functions below.

**One deliberate, documented behavior difference between the two modes**: `lib/dropin/sources/index.ts`'s mtime-based cache (a Phase 3.3 performance optimization — skip re-parsing an unchanged multi-megabyte JSON file on every request) is **local-mode only**. R2 has no free, local equivalent to a filesystem `mtime`; rather than build one (e.g., an extra `HEAD` call per request to check an ETag), R2 mode simply reads fresh every request. This is an accepted simplification, not an oversight — DropIn's current traffic and R2's free-tier request limits (10M Class B operations/month, confirmed in the Phase 5B-1 preflight) leave ample headroom, and a cache can be added back later if that ever stops being true.

---

## 4. Object Paths

Exactly the approved structure — no extra layers invented, matching Phase 5B-2A precisely:

```
production/canonical/<slug>/latest.json
production/canonical/<slug>/previous.json
production/raw/<slug>/latest.json
production/raw/<slug>/previous.json
staging/canonical/<slug>/latest.json
```

`data/facility-locations/` is not part of this structure at all — it stays git-tracked, read/written only through the local-only synchronous helpers, regardless of `SNAPSHOT_STORAGE`.

---

## 5. Read-Only Application Boundary

`createAppReadStorage()` is the **only** function `lib/dropin/sources/index.ts` calls. It:

- Reads `R2_READ_ACCESS_KEY_ID` / `R2_READ_SECRET_ACCESS_KEY` — never the write-capable pair. There is no code path in this function that can construct an `R2SnapshotStorage` instance holding write-capable credentials.
- Defaults its `keyPrefix` to `"production"`, overridable only via `R2_KEY_PREFIX` (the Phase 5A §14 preview-isolation mechanism, §7 below) — the prefix choice never changes which credential is used.
- Is the single call site the running Next.js application (and thus, eventually, Vercel) will ever invoke. `app/api/sessions/route.ts` was not touched — it still just calls `getAllSessions()`, which calls this, unchanged in shape.

The application **cannot** write, delete, or promote a snapshot — not merely by convention, but because `createAppReadStorage()` has no parameter, code path, or environment variable that would give it write-capable credentials.

---

## 6. Refresh Write Boundary

`createRefreshStorage()` is used only by `scripts/refresh/*` and the two operator tools (`scripts/snapshot-health.ts`, `scripts/migrate-to-r2.ts`). It:

- Reads `R2_WRITE_ACCESS_KEY_ID` / `R2_WRITE_SECRET_ACCESS_KEY`.
- Always uses the `"production"` prefix — a staging upload is a separate, explicit, manual act (§9), never something the routine refresh does on its own.
- Is never imported by anything under `app/` or `lib/dropin/sources/` — confirmed by a repo-wide grep before finalizing this document.

---

## 7. Last-Known-Good Promotion Behavior

`R2SnapshotStorage.writeAtomic()` implements the exact safety property the local implementation already had, translated to R2's real primitives (verified against Cloudflare's own documentation during the Phase 5B-1 preflight, not assumed to transfer for free):

1. Check whether an object currently exists at the target key (`HeadObjectCommand`).
2. If it does, server-side-copy it to the `previous` key (`CopyObjectCommand` — no download/re-upload round trip).
3. `PUT` the new, already-validated data to the target key (`PutObjectCommand`) — **a single `PUT` to one key is atomic on R2/S3**: a reader always observes either the fully-old or the fully-new object, never a partial write. This is the direct equivalent of the local implementation's write-temp-then-`rename` pattern; there is no durable "temp" object at any point, because R2's atomicity guarantee makes one unnecessary.

**On failure**: `scripts/refresh/lib.ts`'s `refreshOneSource()` now wraps the final promotion step in a try/catch. If either the raw or canonical `writeAtomic` call throws (a real, realistic possibility with R2 — network errors, transient auth issues — unlike local disk), the function returns a proper `SourceReport` with `activated: false` and a clear `failureReason`, rather than an unhandled promise rejection. **The previously-active `latest` object is left completely untouched**, because the failure can only happen either before the `PUT` (nothing changed yet) or the `PUT` itself fails outright (atomic — either it lands whole or not at all). This directly satisfies "a failed refresh must not replace the last known-good production snapshot," verified against the actual rewritten code, not merely asserted.

Two smaller, related hardenings added the same way: reading the previous canonical snapshot (for the count-collapse safety check) is now itself wrapped so a *read* failure (e.g., an R2 outage) is reported as a real failure rather than silently treated as "no previous snapshot, anything goes." And the debug raw-snapshot write on an already-known failure path (normalization/validation/collapse rejection) is best-effort — if *that* write also fails, it's appended as a secondary warning, never allowed to replace or mask the original failure reason.

---

## 8. Environment Variable Names

Documented in full in `.env.example` (names only, zero values) — reproduced here for completeness:

| Name | Holds | Used by |
|---|---|---|
| `SNAPSHOT_STORAGE` | `"r2"` to enable R2 mode; unset = local | Both app and refresh pipeline |
| `R2_ACCOUNT_ID` | Cloudflare account ID | Both |
| `R2_BUCKET_NAME` | Bucket name (e.g. `dropin-snapshots`) | Both |
| `R2_READ_ACCESS_KEY_ID` / `R2_READ_SECRET_ACCESS_KEY` | Credential A (read-only) | Application only |
| `R2_WRITE_ACCESS_KEY_ID` / `R2_WRITE_SECRET_ACCESS_KEY` | Credential B (read+write) | Refresh pipeline / operator tools only |
| `R2_KEY_PREFIX` | Optional; `"staging"` on a specific preview branch, otherwise unset/`"production"` | Application only (§7 of Phase 5A) |

**No value for any of these has ever been entered anywhere** — not in this file, not in `.env.example`, not in chat, not in any committed file.

---

## 9. Migration Procedure

`scripts/migrate-to-r2.ts` (new, `npm run migrate:r2`) — explicit and manual, never invoked automatically:

- Refuses to run at all unless `SNAPSHOT_STORAGE=r2` is set (a natural, structural gate — it simply cannot proceed without R2 write credentials also being present, since `createRefreshStorage()` throws immediately if they're missing).
- For each of the 7 current municipalities: reads the **local** canonical `latest.json` directly (via `LocalFilesystemSnapshotStorage`, bypassing the `SNAPSHOT_STORAGE` switch for the read side specifically, since the whole point is bridging local → R2), validates it with the exact same `validateCanonicalSessions()` gate the daily refresh already uses, and — only if valid — uploads it via `createRefreshStorage()`.
- A missing local snapshot is reported and skipped (`skipped-missing`), never uploaded as if it were real data.
- A local snapshot that fails validation is reported and skipped (`skipped-invalid`) — **never uploaded as production `latest`**, directly satisfying the task's explicit requirement.
- Supports `--dry-run` to validate and report everything that *would* happen without uploading anything — a safe way to check readiness before committing to a real upload.
- Reports municipality-by-municipality, with a summary line.
- Touches Git nowhere — reads local files already gitignored, writes to R2, nothing is ever committed.

**Not run this phase** — no R2 credentials are available to Claude in this environment; this is prepared code, not an executed migration.

---

## 10. Preview/Staging Behavior

Exactly the Phase 5A §14 design, now backed by real code:

- **Common case** (ordinary UI/feature preview deployments): no special configuration — `createAppReadStorage()` defaults to the `"production"` prefix, using the same read-only credential production uses. Safe by construction (§5 — the app cannot write regardless of environment).
- **New-municipality/new-source preview**: a specific branch gets `R2_KEY_PREFIX=staging` set as a **branch-scoped** Vercel Preview environment variable (a native Vercel capability, confirmed live during the Phase 5A research) — only that one deployment's `createAppReadStorage()` calls resolve against `staging/` instead of `production/`. No other preview, and production itself, is ever affected.
- No separate staging database or duplicate application deployment was built — none is needed, per Phase 5A §14's own reasoning, unchanged here.

---

## 11. Security Verification

| Requirement | Status |
|---|---|
| No credentials in client bundle | **Verified.** `grep`'d the actual built `.next/static/` output for AWS SDK traces, R2 variable names, and credential-shaped strings — zero matches. All R2 code lives in `lib/dropin/snapshot/io.ts`, imported only by server-side/CLI code paths. |
| No `NEXT_PUBLIC_` prefix for R2 credentials | **Verified by construction** — every R2-related variable name (§8) deliberately avoids that prefix, which is the specific, real mechanism Next.js uses to decide what reaches the client bundle. |
| No R2 secrets in logs/errors | **Verified.** Every error path uses `err.message` only — AWS SDK error messages describe the failure (e.g. "AccessDenied," "NoSuchKey"), never the credential values themselves. |
| No public R2 bucket access required | **Unchanged from Phase 5B-2A** — M1 keeps all reads server-side; nothing in this integration needs or assumes public bucket access. |
| Production app only needs read credential | **Verified** — `createAppReadStorage()` has no code path to a write-capable credential (§5). |
| Refresh code is the only path requiring write credential | **Verified** — `createRefreshStorage()` is imported only by `scripts/refresh/*`, `scripts/snapshot-health.ts`, and `scripts/migrate-to-r2.ts`; a repo-wide grep confirms nothing under `app/` or the application's own `lib/dropin/sources/` imports it. |
| `/design` protection remains intact | **Verified.** `proxy.ts` is byte-identical to before this phase (`diff` against the last commit returns nothing) and was re-tested live against a fresh production build: `404`, 0-byte body. |
| Precise location behavior unchanged | **Verified** — `app/page.tsx` was not touched (`git diff --stat` empty). |
| No private Gmail address reintroduced | **Verified** — fresh repo-wide grep, zero live matches (only the Security Audit's own historical remediation record, unchanged). |

---

## 12. Tests Performed

**CODE VERIFIED** (real checks against the actual code, this phase):

- `tsc --noEmit` — clean, zero errors, across every touched file.
- `next build` — succeeds cleanly; identical route table to before (`/`, `/api/sessions`, `/design/*`, `ƒ Proxy (Middleware)`).
- `npm run lint` — 21 pre-existing problems, unchanged count — confirmed via a direct re-run, meaning every file touched this phase introduces zero new lint issues.
- **Local filesystem regression**: a real `next start` production server, `SNAPSHOT_STORAGE` unset (local mode) — `/api/sessions` returned 33,165 real sessions across all 7 municipalities, byte-comparable to the pre-refactor baseline established earlier in the Security Audit. `/design` still returns `404`/0 bytes. `/` still returns `200`.
- **R2 adapter logic verification, mocked** (no test framework exists in this project — none was added, consistent with its established verification style): a throwaway script (not part of the repo) monkey-patched `R2SnapshotStorage`'s underlying `S3Client.send` and exercised the real, actual class — 11 checks, all passing: missing-key reads return `undefined` without throwing; a first write issues no `CopyObjectCommand` (nothing to rotate); a second write correctly rotates the prior object into `previous` before promoting the new one; a genuine error (403) propagates rather than being swallowed as "not found"; key resolution correctly applies the `production/`/`staging/` prefix; a staging-prefixed instance never touches a production key.

**LIVE R2 VERIFIED: performed, in full, for all 7 municipalities** (update, 2026-08-26 — the owner completed local credential configuration and live verification; full record below).

- **Live write**: `npm run migrate:r2 -- --municipality=aurora` (Aurora first, as the smallest dataset, per the agreed smallest-reversible-test sequencing) — real `HeadObjectCommand` + `PutObjectCommand` against the real `dropin-snapshots` bucket, 170 real sessions uploaded to `production/canonical/aurora/latest.json`.
- **Live read, read-only credential only**: a new script, `scripts/verify-r2-read.ts` (§9), calling `createAppReadStorage()` — the exact function the deployed application itself uses — confirmed the Aurora object readable and passing `validateCanonicalSessions()`, using only `R2_READ_*`. **Proved, not merely asserted, that no local-filesystem fallback was masking the result**: the local `data/canonical/aurora/` directory was temporarily moved aside entirely, the read was re-run, and it still succeeded with the identical 170 sessions and identical `fetchedAt` — only possible if the data genuinely came from R2. Local data was restored immediately after.
- **Live end-to-end app check**: a real `next build && next start` with `SNAPSHOT_STORAGE=r2` and real credentials, `/api/sessions` hit over real HTTP — returned Aurora + Toronto's bundled fallback correctly (before the remaining migration), then all 7 municipalities correctly after it (below).
- **Remaining 6 municipalities migrated** the same day, one at a time via `--municipality=<slug>`, deliberately excluding Aurora from the batch run so its already-verified object was never re-touched — confirmed after the fact by its `fetchedAt` timestamp remaining byte-identical. All 6 (`Toronto`, `Mississauga`, `Richmond Hill`, `Vaughan`, `Markham`, `Newmarket`) uploaded successfully on the first attempt, zero validation failures.
- **All 7 re-verified via the read-only path** (`verify-r2-read.ts`) after the full migration — every municipality's session count and `fetchedAt` matched exactly what was uploaded.
- **Credential exposure re-checked at every step**: zero credential values found in server logs, in the `/api/sessions` response body, or in the rebuilt client-side static bundle, across every live test performed.

---

## 13. Remaining Risks

- **Production load/concurrency behavior is unverified.** Every live test performed (this section, and the Aurora handoff before it) was single-request/sequential — never concurrent traffic. This is now a formally recorded pre-launch gate, not an open-ended risk: see `docs/LAUNCH_READINESS_PLAN.md` §13, added the same day this migration completed. Not implemented here, deliberately — a real concurrent-load test needs a real deployed instance, which doesn't exist yet (no Vercel project, per this phase's own scope).
- **The R2-mode cache simplification (§3)** trades a small amount of request latency/R2-request-count for simplicity. Not expected to matter at DropIn's current scale (well inside R2's free tier — confirmed via real usage this phase: migrating and verifying all 7 municipalities twice over used a negligible fraction of the 10M/month Class B allowance), but worth watching if traffic grows substantially, and directly relevant to the load-verification gate above.
- **`@aws-sdk/client-s3` is a real, if justified, new production dependency** (§11 below covers the justification) — its own transitive dependency tree should be revisited during any future dependency audit, the same as every other production dependency.

**New dependency justification** (`@aws-sdk/client-s3`, exact-pinned `3.1118.0`): required because R2's S3-compatible API needs AWS Signature V4 request signing — implementing that by hand would be more code, more risk, and less maintainable than using the standard, actively-maintained client Cloudflare's own documentation recommends for exactly this use case. Used directly (`GetObjectCommand`/`PutObjectCommand`/`CopyObjectCommand`/`HeadObjectCommand`), with no additional wrapper layer on top — 26 packages added to `node_modules` (the client plus its transitive smithy/util dependencies). `npm audit` re-run after installation: **zero new vulnerabilities** traced to `@aws-sdk` or `smithy` packages — the pre-existing findings (`nanoid`, `postcss`, `next`→`sharp`, plus two devDependency-only findings in `brace-expansion`/`js-yaml`) are unchanged in count and origin.

---

## 14. Owner Action Required — Completed

Original checklist (below) is preserved for the record; every step was completed, in a slightly extended order (a single-municipality live write+read check was inserted between the original steps 1 and 3, at the owner's request, as an even smaller reversible test than a full 7-municipality run):

1. ~~Configure local credentials~~ — done; `.env.local` created from `.env.example`, real values entered directly by the owner, never shared in chat.
2. ~~Dry-run migration check~~ — done; all 7 validated cleanly before any real upload.
2a. *(inserted)* Live single-municipality write+read check — Aurora migrated and read back successfully (§12), before committing to the full batch.
3. ~~Run the real migration~~ — done, for the remaining 6 municipalities (Aurora deliberately excluded from the batch, already verified individually).
4. ~~Verify locally against R2~~ — done; a real `next build`/`next start` in R2 mode correctly served all 7 municipalities over real HTTP.
5. ~~Report back without sharing credential values~~ — done throughout; only non-secret confirmations, output, and error text (none of which contained credentials) were ever shared.

**Actual output for step 3** (real, not illustrative): all 6 remaining municipalities — `Toronto` (26,353 sessions), `Mississauga` (15,712), `Richmond Hill` (251), `Vaughan` (968), `Markham` (1,230), `Newmarket` (1,683) — uploaded successfully on the first attempt. Combined with Aurora (170, migrated separately), all 7 municipalities' canonical data now lives in `production/canonical/<slug>/latest.json`.

---

## 15. Owner Action Status

**Complete.** All 7 municipalities' canonical snapshots are live in R2, verified via the read-only application path, with zero validation failures and zero credential exposure across every check performed. The only remaining pre-launch item this phase surfaced is the production load/concurrency verification gate, now formally recorded in `docs/LAUNCH_READINESS_PLAN.md` §13 — not part of this phase's scope, and not implemented here.

---

## Final Report

**A. R2 integration implemented?** Yes — `R2SnapshotStorage` (§2), the environment-driven selection mechanism (§3), the approved object-path structure (§4), and the read/write credential boundaries (§5/§6) are all real, working code.

**B. Local filesystem behavior preserved?** Yes — confirmed via a real production build + live request, byte-comparable to the pre-refactor baseline (33,165 sessions, all 7 municipalities). `LocalFilesystemSnapshotStorage` remains the default and requires zero configuration.

**C. Production read path implemented?** Yes — `createAppReadStorage()`, wired into `lib/dropin/sources/index.ts`, structurally incapable of holding write-capable credentials (§5).

**D. Refresh write path implemented?** Yes — `createRefreshStorage()`, wired into `scripts/refresh/lib.ts` and the two operator tools, with the rotate-then-atomic-PUT promotion sequence implemented and mock-verified (§7/§12).

**E. Last-known-good promotion implemented?** Yes — atomic per-key `PUT` semantics (verified against Cloudflare's real documented behavior, not assumed), a failed promotion leaves the prior `latest` untouched and is reported as a real failure, never silently treated as success (§7).

**F. Preview/staging isolation supported?** Yes — `R2_KEY_PREFIX`, branch-scoped via Vercel's native environment-variable feature, with no new database or duplicate deployment (§10).

**G. Any new dependency?** Yes — `@aws-sdk/client-s3`, exact-pinned, justified in §13, confirmed to introduce zero new vulnerabilities via a fresh `npm audit` comparison.

**H. Secrets/client exposure status:** Clean — verified against the actual built client bundle (zero traces), verified no `NEXT_PUBLIC_` prefix exists anywhere, verified error paths never include credential values. Full detail: §11.

**I. Production build result:** Clean — `next build` succeeds, identical route table, `tsc`/`lint` both clean (lint at the same 21 pre-existing, unrelated problems as before).

**J. Real R2 live test status: PERFORMED, for all 7 municipalities** (update, 2026-08-26). Real write (Aurora, then the remaining 6), real read-only-credential read-back (all 7), a real end-to-end `next build`/`next start` against live R2 data, and an empirical (not merely asserted) proof that no local-filesystem fallback was masking the reads — all detailed in §12.

**K. Exact owner action taken:** §14, completed in full — credentials configured locally (never shared with Claude), a single-municipality live check performed first (Aurora) as an even smaller test than the originally-planned dry-run-then-full-batch sequence, then the remaining 6 municipalities migrated and every one of the 7 re-verified via the read-only path.

**L. Any blockers before canonical-data migration:** None existed, and none remain — the migration is complete. The next real gate is the production load/concurrency verification now recorded in `docs/LAUNCH_READINESS_PLAN.md` §13 (added this same phase) — not a blocker to anything done so far, but required before public launch.

**M. Exact files changed, across the full phase (code integration + live migration):** 10 modified files (§1), plus new files `scripts/migrate-to-r2.ts`, `scripts/verify-r2-read.ts`, `.env.example`, `.env.local` (gitignored, never committed, contains the owner's real credentials), and this document. `docs/LAUNCH_READINESS_PLAN.md` also gained §13 (the load/concurrency gate). No file outside `lib/dropin/snapshot/`, `lib/dropin/sources/index.ts`, `lib/dropin/facility-locations.ts`, `scripts/`, `package.json`/`package-lock.json`, `.gitignore`, `.env.example`, and the two named documentation files was touched. No application UI, Privacy copy, or hosting/domain configuration was touched at any point.

**Phase 5B-2B is complete: all 7 municipalities' canonical data is live in Cloudflare R2, verified read and write, with the read-only/read-write credential boundary holding throughout and zero credential exposure anywhere.**

Stopping here, as instructed. Phase 5B-3 scheduler work has not begun; nothing was deployed.
