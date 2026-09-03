# DropIn — Release Process

Concise, operational reference for how DropIn cuts a formal application release and recovers from a bad one. This document is the permanent procedure; `docs/LAUNCH_READINESS_PLAN.md` records launch-milestone *status* only and points here rather than duplicating any of it.

## A. Purpose

**Application releases and municipal data refreshes are independent systems.** The daily recreation-data refresh (`.github/workflows/daily-refresh.yml`) writes fresh Toronto/Mississauga/Markham/Vaughan/Richmond Hill/Aurora/Newmarket snapshots to Cloudflare R2 on its own cron schedule. It never touches `package.json`, never creates a commit, never creates a tag, and never triggers a Vercel rebuild. A version like `v1.0.0` describes a specific, deliberately-promoted build of the DropIn *application* — not how fresh the underlying municipal data happens to be on any given day.

## B. Semantic Versioning

- **PATCH** (`v1.0.0` → `v1.0.1`) — bug fixes, small UX/accessibility fixes, copy corrections.
- **MINOR** (`v1.0.1` → `v1.1.0`) — backward-compatible new user-facing functionality or meaningful new product capability.
- **MAJOR** (`v1.x.x` → `v2.0.0`) — major product/architecture changes or intentionally breaking changes.

## C. What does NOT create a release

- Ordinary development commits.
- Documentation-only commits.
- Daily municipal data refreshes.
- Failed/abandoned experiments.
- Preview deployments.

None of the above touch `package.json`'s `version` field, and none produce a tag.

## D. Source of truth

```
package.json "version"
        ↓ (next.config.ts, at Next's own build time)
NEXT_PUBLIC_APP_VERSION build-time constant
        ↓
About UI ("DropIn · vX.Y.Z")
        ↓ (at formal release time, per §E)
Git tag vX.Y.Z
```

`package.json`'s `version` field is the single canonical value. Nothing else duplicates it by hand. A `vX.Y.Z` git tag must correspond **exactly** to the `X.Y.Z` committed in `package.json` at the tagged commit — the tag is a marker on top of that commit, never an independent number chosen separately.

Because a Vercel rollback re-serves a previously-built deployment's own bundle rather than rebuilding from today's source, a rolled-back deployment naturally continues to display the version that was correct for it at its own build time — no extra mechanism needed.

## E. Formal release procedure

Deliberately owner-controlled, not automated. `npm version` is **not** used blindly here — this project's Vercel project auto-deploys every push to `main` as Production today, so bumping the version *before* verification would let an unverified build briefly claim a release number. The sequence below verifies first, tags last:

1. Finish the intended release work.
2. Run typecheck/build/lint against the established baseline (zero new findings).
3. Product owner explicitly approves the release candidate.
4. Set `package.json`'s `version` to the intended SemVer value.
5. Commit that version bump as its own commit.
6. Push to `main`.
7. Wait for the resulting Vercel Production deployment to complete.
8. Verify live production on the intended domain, including a physical-device check.
9. **Only after production verification passes**, create and push the matching immutable git tag `vX.Y.Z`, pointing at the now-verified commit.
10. Create the GitHub Release from that tag.
11. Record the release in the release log (§I).
12. Mark it LAST KNOWN GOOD (§F).

This ordering is deliberate: the tag — the durable, citable release marker — is created only once the exact commit it points to has already been proven good in production, never before.

## F. LAST KNOWN GOOD definition

A release qualifies as LAST KNOWN GOOD only when **all** of the following are true:

- The version is explicit (a real `X.Y.Z`, not "whatever's currently on `main`").
- The exact commit is known.
- The Vercel Production deployment for that commit succeeded.
- Required production smoke/physical verification passed.
- A matching git tag exists.
- A release record exists in the log (§I).

## G. Emergency application rollback

Priority: **restore service first, root-cause later.**

1. Confirm a real production regression (check the live URL directly, not just build status).
2. Distinguish an application-code issue from:
   - bad municipal data,
   - an upstream municipality outage (the Aurora-style failure this project has already seen),
   - an R2/storage issue,
   - a CORS/environment issue.
   Only an application-code issue is fixed by the steps below.
3. Identify the current bad release (its commit/tag).
4. Identify LAST KNOWN GOOD (§F) from the release log.
5. Restore the known-good Vercel production deployment using the available rollback/promote mechanism.
6. Verify production restoration against the same check used in step 1.
7. Record the incident (date, symptom, bad release, restored release) in this document's release log or a short incident note alongside it.
8. Investigate and fix the actual defect separately, without time pressure, once production is stable.
9. Ship the fix as a **new patch release** — never as a rewrite of the bad one.
10. Never rewrite or delete the bad tag or GitHub Release; it stays in history for traceability.

**Explicit caveats:**
- Rollback availability and how much deployment history is retained may depend on the current Vercel plan — confirm in the Vercel dashboard when actually needed, don't assume.
- After a rollback, check the dashboard for how production routing/promotion behaves before resuming normal auto-deploys — a subsequent ordinary push to `main` could auto-promote over the rollback if auto-deploy remains active and nothing is done to pause it.
- Service restoration takes priority over root-cause investigation, every time.

## H. Application rollback vs. data rollback

**A Vercel application rollback changes only the deployed application build.** It does **not** roll Cloudflare R2 municipal snapshots backward. After an application rollback, the (rolled-back) application continues reading whatever is currently active in R2 — today's most recent successful refresh — not the data that was live when that older build was originally deployed. R2's own canonical store keeps only a two-generation rotation per municipality (`latest.json` / `previous.json`), not a full history, and there is currently no tooling to promote `previous` back over `latest`.

**DATA INCIDENT / SNAPSHOT ROLLBACK RUNBOOK → P1 FOLLOW-UP.** Not designed or implemented in this phase. A bad-data incident needs its own separate runbook; do not assume an application rollback fixes it.

## I. Release log

| Version | Tag | Commit | GitHub Release | Vercel Deployment | Verified On | Status |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

No release has been cut yet. `v1.0.0` is intentionally not recorded here until it represents the actual first public launch state (custom domain attached, launch branding/share metadata completed, final production smoke verification done) — see `docs/LAUNCH_READINESS_PLAN.md` for current pre-launch status.
