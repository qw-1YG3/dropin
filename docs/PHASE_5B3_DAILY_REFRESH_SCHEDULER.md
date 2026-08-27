# Phase 5B-3 — Daily Refresh Scheduler

**Scope: implement the production scheduler only.** No municipality scope was expanded (still exactly the 7 already migrated in Phase 5B-2B), no existing scraper/source/normalize/validate logic was touched or redesigned, no deployment happened.

**Status (update, 2026-08-27): LIVE VERIFIED and COMPLETE.** The first real GitHub Actions production refresh ran against real R2 credentials — 6 of 7 municipalities refreshed, validated, and promoted successfully; the 7th (Aurora) correctly failed its own pre-existing Completion Gate rather than accepting an incomplete upstream dataset. Full live evidence: §7. Aurora's specific issue is tracked separately, non-blocking: `docs/LAUNCH_READINESS_PLAN.md` §14.

---

## 1. Inspection Performed Before Any Code Change

Confirmed fresh, not assumed from prior-phase documentation:

- **No `.github/workflows/` directory existed** before this phase — this is a genuinely new addition, not a modification of existing CI.
- **`npm run refresh:data -- --all --json`** (`scripts/refresh/index.ts`) already does everything the scheduler needs: fetches all 7 municipalities concurrently (Toronto + the ActiveCommunities family + the PerfectMind family), source-isolated, and exits non-zero if any municipality fails to activate a new snapshot. Unchanged by this phase.
- **`scripts/refresh/lib.ts`'s `refreshOneSource()`** already writes through `createRefreshStorage()` (Phase 5B-2B) — meaning it already writes to R2 using the write-capable credential whenever `SNAPSHOT_STORAGE=r2` and the `R2_WRITE_*` environment variables are present. This was already proven working end-to-end in Phase 5B-2B's live migration (all 7 municipalities). **No change was needed to this file for the scheduler to work.**
- **The validation gate (`validateCanonicalSessions` + `checkCountCollapse`) and the atomic-promotion sequence (rotate `previous`, then a single atomic `PUT` to `latest`)** are unchanged, already proven both in mocked tests and in live R2 use (Phase 5B-2B).
- **No architectural conflict was found.** The scheduler's entire job, correctly, is "run an already-correct command on a schedule with the right secrets" — not new refresh logic.

Given this, the only genuinely new code this phase required was: the GitHub Actions workflow itself, and a small, optional reporting helper (§4) — nothing in the fetch/normalize/validate/promote pipeline was touched.

---

## 2. Scheduler Architecture

```
GitHub Actions (schedule: 13:00 UTC daily, or manual workflow_dispatch)
  ↓
actions/checkout, actions/setup-node, npm ci
  ↓
npm run refresh:data -- --all --json          (unchanged CLI, Phase 3.3/3.3B/5B-2B)
  ↓
scripts/refresh/lib.ts: refreshOneSource()    (unchanged — validate, then promote via createRefreshStorage())
  ↓
Cloudflare R2, production/canonical/<slug>/latest.json + previous.json  (unchanged prefix/structure, Phase 5B-2A/2B)
  ↓
scripts/refresh/format-summary.ts             (new — formats the JSON report into the GitHub Actions run summary)
  ↓
Job succeeds (all activated) or fails (any municipality didn't) — GitHub's own built-in failure-email notification fires on the latter (Phase 5A §6, unchanged)
```

**File**: `.github/workflows/daily-refresh.yml`.

**Credential used**: the "Refresh Read & Write" credential only (`R2_WRITE_ACCESS_KEY_ID` / `R2_WRITE_SECRET_ACCESS_KEY`), injected as GitHub Actions repository secrets. The workflow's `env:` block **does not reference** `R2_READ_ACCESS_KEY_ID`/`R2_READ_SECRET_ACCESS_KEY` at all — not merely unused, genuinely absent from the workflow file, confirmed by direct inspection.

**Concurrency**: a `concurrency: { group: production-refresh, cancel-in-progress: false }` block ensures a slow run can never overlap with the next scheduled trigger — it queues rather than cancels, so any run already in progress always completes cleanly (the Phase 5B-1 preflight's own recommendation, now implemented).

---

## 3. Schedule / Cadence

**`0 13 * * *`** — 13:00 UTC, every day.

**Reasoning, carried forward from already-established project findings, not re-derived**: Toronto's own CKAN open-data source updates once daily around 8am ET (a Phase 3.0 finding, already relied on by Phase 3.3B's cadence reasoning and Phase 5A's refresh-model recommendation). 13:00 UTC is 9:00am ET during EDT (the period this project has been actively worked in) — running an hour after Toronto's own update gives it time to fully complete before DropIn pulls it, while still refreshing early enough in the day to be fresh for the large majority of a day's users.

**`workflow_dispatch`** is also enabled — a manual trigger, usable both for testing this workflow itself and for on-demand recovery if a scheduled run is ever missed or needs re-running outside the normal cadence.

---

## 4. Required GitHub Secrets

Exactly four — to be added by the project owner at **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**. No value is recorded anywhere in this document or in source.

| Secret name | Value comes from |
|---|---|
| `R2_ACCOUNT_ID` | The same Cloudflare account ID already used for local `.env.local` testing (Phase 5B-2B) |
| `R2_BUCKET_NAME` | The same bucket name (`dropin-snapshots`) |
| `R2_WRITE_ACCESS_KEY_ID` | The "DropIn Refresh Read & Write" token's Access Key ID (Phase 5B-2A) — the same one already used for the local live migration |
| `R2_WRITE_SECRET_ACCESS_KEY` | The same token's Secret Access Key |

**Not required, and deliberately not referenced anywhere in this workflow**: `R2_READ_ACCESS_KEY_ID` / `R2_READ_SECRET_ACCESS_KEY` — those belong exclusively to the (not-yet-created) Vercel deployment's own application read path, never to this scheduler.

---

## 5. Manual Recovery / Run Procedure

To trigger a refresh outside the normal daily schedule (testing this workflow, or recovering from a missed/failed run):

- **Via the GitHub web UI**: repository → **Actions** tab → **Daily Production Data Refresh** (in the left-hand workflow list) → **Run workflow** button → confirm.
- **Via the `gh` CLI**, if installed and authenticated: `gh workflow run daily-refresh.yml`.

Either path runs the exact same job as the scheduled trigger — same secrets, same command, same validation/promotion behavior. There is no separate "recovery mode" — recovery *is* just running the same safe, idempotent refresh again.

---

## 6. Failure Behavior — Unchanged, Now Scheduled

Nothing about failure handling was invented this phase — it already existed (Phase 3.3, reconfirmed in Phase 5B-1/5B-2B) and is simply now running on a schedule instead of only manually:

- **Per-municipality isolation**: a failure fetching, normalizing, or validating one municipality does not affect any other municipality's refresh in the same run.
- **Validation gate**: `validateCanonicalSessions()` + `checkCountCollapse()` must both pass before any promotion is attempted — a failure here means the canonical `latest` object for that municipality is never touched.
- **Atomic promotion**: the previous `latest` is rotated into `previous` (R2 server-side copy), then a single atomic `PUT` activates the new data — a failure at the promotion step itself (e.g. a transient R2/network error) leaves the previously-active `latest` completely untouched and is reported as a real failure (Phase 5B-2B §7), never silently treated as success.
- **Job-level failure signal**: `scripts/refresh/index.ts` already exits non-zero if *any* municipality failed to activate — this workflow's final step (`Fail the job if any municipality failed to refresh`) turns that into a failed GitHub Actions run, which is what triggers GitHub's own built-in failure-email notification (Phase 5A §6 — no new notification mechanism was built).
- **Visibility, newly added this phase**: `scripts/refresh/format-summary.ts` writes a per-municipality markdown table (status, session count, duration, failure reason if any) to the GitHub Actions run's own summary page — verified locally this phase (§8) — so a partial failure is immediately visible without opening raw logs, directly satisfying "avoid partial or misleading success."

---

## 7. Verification Status

### CODE VERIFIED (performed this phase)

- `tsc --noEmit` — clean, zero errors.
- `next build` — succeeds, identical route table to before; this workflow doesn't touch the Next.js app at all, confirmed by its own contents (it only runs `scripts/refresh/*`).
- `npm run lint` — 21 pre-existing problems, unchanged count.
- **Workflow YAML validated** — parsed successfully with a YAML parser; trigger keys (`schedule`, `workflow_dispatch`), the cron expression, the concurrency block, and all six step names confirmed structurally correct.
- **`scripts/refresh/format-summary.ts` tested locally with representative sample data** (no real credentials involved) — a mixed pass/6-of-7-succeed/1-fails case produced a correct, clearly differentiated markdown table (the failed municipality shown with its exact failure reason, not lumped in with the successes); an all-succeed case and a malformed-input case were also tested and handled correctly.
- **The workflow's exit-code-capture-then-fail shell logic was independently simulated locally**, outside any GitHub Actions context — both the "refresh command fails" and "refresh command succeeds" branches were reproduced with the exact same shell pattern used in the workflow file, and both correctly determined whether the job should fail.
- **No secret appears anywhere in the workflow file** — every credential reference uses GitHub's `${{ secrets.NAME }}` syntax; confirmed by direct inspection, zero literal values present.
- **Client bundle re-checked**: zero traces of the AWS SDK, R2 variable names, or credential-shaped strings in the built `.next/static/` output — this workflow is unrelated to the client bundle (it never touches `app/`), and this check simply reconfirms nothing regressed.

### LIVE SCHEDULER VERIFIED: **performed** (update, 2026-08-27)

The project owner configured the four repository secrets (§4) and triggered the first real production run. Real evidence, from that run and the same-day Aurora diagnosis that followed it:

- The real GitHub Actions production workflow executed (not a simulation, not a dry run).
- The four repository secrets were successfully consumed by the workflow.
- The real write-capable R2 credential ("Refresh Read & Write") authenticated against Cloudflare R2.
- All 7 configured municipalities were attempted — exactly the approved scope, no more, no fewer.
- 6 municipalities (Toronto, Mississauga, Richmond Hill, Vaughan, Markham, Newmarket) fetched, validated, and were promoted to the production R2 namespace (`production/canonical/<slug>/latest.json`) for real.
- Aurora failed at the fetch step — its own pre-existing Completion Gate (Phase 3.6B) correctly refused an incomplete upstream result (30 real records reported, only 20 retrievable, no confirmed working pagination — full diagnosis in `docs/LAUNCH_READINESS_PLAN.md` §14). This is a real, upstream, source-completeness condition, independently confirmed persistent (not transient, not a scheduler/R2/credential/GitHub Actions defect) via live re-testing against Aurora's actual API the same day.
- Aurora's previous known-good R2 snapshot was left completely untouched — confirmed both by the workflow's own behavior and by an independent read-only re-check afterward.
- The workflow correctly exited non-zero on the partial failure, and the per-municipality summary made the split (6 succeeded / 1 failed, with Aurora's exact reason) immediately visible rather than ambiguous.

**Verification distinction, precisely:**

| Claim | Status |
|---|---|
| Workflow mechanism (checkout → setup-node → npm ci → refresh → summary → fail-on-failure) | **LIVE VERIFIED** |
| R2 write path (real authentication, real promotion of 6 real snapshots) | **LIVE VERIFIED** |
| Failure handling (isolation, last-known-good preservation, non-zero exit, clear reporting) | **LIVE VERIFIED** — arguably more thoroughly than an all-success run would have, since this run exercised the failure path for real |
| Manual (`workflow_dispatch`) trigger | **LIVE VERIFIED**, based on the owner-triggered production run |
| Scheduled cron trigger (`0 13 * * *`) — configuration | **VERIFIED** (structurally correct, unchanged from §7's original YAML validation) |
| Scheduled cron trigger — autonomous firing, unattended | **NOT YET OBSERVED** — non-blocking follow-up, not a completion requirement; confirmed the next time a run appears in the Actions history with trigger type `schedule` rather than `workflow_dispatch` |

**Aurora is not, and should not be, considered part of this phase's own pass/fail bar.** The original acceptance criterion was "a real GitHub Actions production refresh has successfully run against R2" — a statement about the scheduler mechanism, not a guarantee that every individual upstream municipal source always returns complete data. Aurora's Completion Gate correctly rejecting incomplete data *is* the failure-handling requirement working as intended, not a reason to withhold completion. **Aurora itself is not marked resolved** — it remains open, tracked in `docs/LAUNCH_READINESS_PLAN.md` §14, and its Completion Gate must not be weakened or bypassed to force a green run.

---

## Final Report

**A. Scheduler architecture implemented:** GitHub Actions workflow (`.github/workflows/daily-refresh.yml`) that runs the existing, unmodified `npm run refresh:data -- --all --json` CLI — no new refresh/validation/promotion logic, only a new scheduling and reporting layer on top of what Phase 3.3/5B-2B already built and proved.

**B. Exact daily schedule:** `0 13 * * *` (13:00 UTC / 9:00am ET daily), chosen to run after Toronto's own ~8am ET source update completes, plus `workflow_dispatch` for manual runs.

**C. Exact GitHub Secrets the owner must configure:** `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_WRITE_ACCESS_KEY_ID`, `R2_WRITE_SECRET_ACCESS_KEY` — the same four values already used for local testing in Phase 5B-2B, added at Settings → Secrets and variables → Actions. `R2_READ_*` is never referenced by this workflow.

**D. Validation/promotion behavior:** Unchanged from Phase 5B-2B — `validateCanonicalSessions()` + `checkCountCollapse()` gate every promotion; a passing snapshot is promoted via rotate-then-atomic-`PUT`; a failing one never reaches the write step at all. Nothing about this logic was modified this phase.

**E. Failure behavior:** Per-municipality isolation (unchanged); a failed municipality's previous known-good snapshot is left untouched (unchanged); the overall job fails (new — via an explicit exit-code check) whenever any municipality fails, which triggers GitHub's built-in failure-email (Phase 5A §6, unchanged mechanism); a markdown run summary (new, `format-summary.ts`) makes every municipality's individual outcome visible regardless of overall pass/fail.

**F. Files changed:**
- New: `.github/workflows/daily-refresh.yml`
- New: `scripts/refresh/format-summary.ts`
- New: this document
- **Not changed**: any file under `app/`, `lib/`, or the existing `scripts/refresh/{index,lib,toronto,perfectmind,activecommunities}.ts` — the entire fetch/normalize/validate/promote pipeline is byte-for-byte unchanged.

**G. Tests/checks performed:** `tsc`, `next build`, `lint` (all clean, unchanged baseline); YAML structural validation; `format-summary.ts` tested locally against three representative payloads (mixed pass/fail, all-pass, malformed input); the workflow's exit-code shell logic independently simulated for both pass and fail cases; workflow file inspected to confirm zero literal secret values and zero reference to the read-only credential; client bundle re-checked for zero credential/SDK traces.

**H. CODE VERIFIED status:** Yes, in full — every check above was actually performed and passed, not assumed. Detail: §7.

**I. LIVE SCHEDULER VERIFIED status (update, 2026-08-27): Performed.** The owner configured the four repository secrets and triggered the first real production run. Workflow mechanism, R2 write path, and failure handling are all LIVE VERIFIED (full evidence and the precise per-claim distinction: §7). **Phase 5B-3 is now considered LIVE VERIFIED and COMPLETE.** The one residual, non-blocking item — autonomous cron firing not yet observed — does not gate this status (§7).

**J. Owner action taken:** Secrets configured; a manual production run triggered and completed with 6/7 municipalities refreshed and promoted, 1 (Aurora) correctly rejected by its own Completion Gate. Result reported back without any secret value. No further action is required to close this phase. Optional, non-blocking follow-up: check the Actions run history after the next scheduled 13:00 UTC to confirm a run with trigger type `schedule` (not `workflow_dispatch`) appears, closing the one remaining open verification item (§7).

Aurora's own issue remains open and is tracked separately — `docs/LAUNCH_READINESS_PLAN.md` §14 — not resolved here, and its Completion Gate must not be weakened or bypassed.

Documentation-only closeout performed 2026-08-27. No application code, workflow code, R2 data, snapshots, GitHub Secrets, or municipality source logic was touched in this update.
