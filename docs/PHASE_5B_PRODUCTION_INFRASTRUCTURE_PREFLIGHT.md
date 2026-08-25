# Phase 5B-1 — Production Infrastructure Preflight

**Scope: preflight only.** Nothing was deployed, no cloud resource was created or modified, no domain was touched, no secret was added anywhere, and no scheduler was implemented. Every claim below reflects a fresh check of the actual repository performed this phase — Phase 5A's documentation is treated as the approved *design*, never assumed to already be the *implementation*. Where something is still live-verified (not carried forward from memory), that's stated explicitly, consistent with this project's standing discipline.

---

## 1. Re-Reading the Approved Architecture

`docs/PHASE_5A_HOSTING_REFRESH_ARCHITECTURE.md`, `docs/LAUNCH_READINESS_PLAN.md`, and `docs/SECURITY_DEPLOYMENT_AUDIT.md` were treated as the source of truth for this preflight. **No redesign was found necessary** — no genuine blocker was discovered that the approved architecture didn't already anticipate (the one open item, §L's redirect-vs-server-filter trade-off, was already flagged by Phase 5A itself as needing owner input before implementation, not a new finding). The approved shape is reaffirmed, not re-litigated, in the sections below.

---

## 2. Current Repository State — Verified Fresh

| | Finding | How verified |
|---|---|---|
| Next.js version | `16.2.12` (exact pin), React/React-DOM `19.2.4` | Direct read of `package.json` |
| Build command | `next build` (default, no custom `output` mode) | `next.config.ts` — no `output: "export"`/`"standalone"` set |
| Expected output/runtime | Node.js server runtime (App Router + one live API route) — not static-export-compatible | Confirmed by the config above plus the existence of `app/api/sessions/route.ts` |
| Current API routes | Exactly one: `app/api/sessions/route.ts` | `find app -name "route.ts"` |
| Current proxy/middleware behavior | `proxy.ts` exists at the repo root, blocks `/design` and `/design/:path*` with a bare 404 in production only (`process.env.NODE_ENV === "production"`); no-op in development | Direct read of `proxy.ts` — unchanged since the security audit's P1-1 remediation |
| Environment variables currently required | **None.** Exactly one `process.env` reference in the entire repo — `NODE_ENV` in `proxy.ts`, which Next.js sets automatically | Repo-wide grep for `process\.env`, root included |
| Current canonical data location | Local filesystem only — `data/canonical/<slug>/{latest,previous}.json`, read via `readFileSync` at request time | `lib/dropin/sources/index.ts`, `lib/dropin/snapshot/io.ts` |
| Current generated-data files on disk | `data/raw/` (155MB), `data/canonical/` (83MB) — both real, both gitignored, both **local to this development machine only** | `du -sh`, cross-checked against `.gitignore` |
| Current refresh pipeline | Unchanged from Phase 5A's own description — `scripts/refresh/index.ts` orchestrates per-source fetch/normalize, `scripts/refresh/lib.ts`'s `refreshOneSource()` validates and atomically activates via `lib/dropin/snapshot/io.ts` | Re-read this phase |
| Current `SnapshotStorage` abstraction | **Still local-filesystem only.** `LocalFilesystemSnapshotStorage` is the only implementation of the `SnapshotStorage` interface that exists | `grep -n "class.*SnapshotStorage" lib/dropin/snapshot/io.ts` → one result |
| Current R2-related implementation | **None.** Zero R2/S3/AWS SDK references anywhere in source; zero cloud-storage dependency in `package.json` | Repo-wide grep, `package.json` inspection |
| Current preview/staging plumbing | **None built.** Phase 5A §14 is a design, not code — no `vercel.json`, no branch-scoped env var config, nothing R2-prefix-aware exists yet | `find` for `vercel.json`/`wrangler.toml` → none; no such config anywhere in source |
| Current `.gitignore` protections | `/data/raw/` and `/data/canonical/` both correctly excluded; `.env*` also excluded (though no `.env` file exists to protect yet) | Direct read of `.gitignore` |
| Is generated operational data tracked by Git? | No — `git ls-files data/raw data/canonical` returns nothing. Only `data/facility-locations/` (small, ~210KB, infrequently updated) and `data/toronto-open-data/` (static bundled fallback) are tracked, by design | `git ls-files` |
| Secrets in source/history/working tree? | **None found**, freshly re-scanned this phase (not merely carried forward from the earlier Security Audit): a fresh pattern scan (AWS-style keys, private-key blocks, generic API-key assignments) across the current tree returned zero matches; the working tree is fully clean (`git status` empty); the repository remains confirmed **public** (`"private": false`, re-checked live via the unauthenticated GitHub API this phase); the private forwarding address remains absent from the current tree (the only match found is the Security Audit's own historical remediation record describing *which past commits* contained it — not a live exposure) |

**One important, concrete finding this verification surfaces**: because `data/canonical/` is correctly gitignored and was never committed, **a fresh clone of this repository — which is exactly what a new Vercel deployment does — would contain zero canonical snapshot data for every municipality except Toronto** (Toronto alone has a bundled, git-tracked fallback dataset, `data/toronto-open-data/`, that the app falls back to when no canonical snapshot exists — verified in `lib/dropin/sources/index.ts`'s `loadTorontoFallback()`). This is not a bug — it's the correct, already-understood consequence of the local-filesystem architecture Phase 5A already flagged as needing the R2 migration — but it means **deploying this repository to Vercel today, before that migration, would produce a technically-working but functionally near-empty app** (Toronto-only). This directly shapes the Vercel preflight below.

---

## 3. Vercel Preflight

**Can the repo deploy without structural changes?** Technically, yes — `next build` succeeds cleanly (re-verified repeatedly this session in the Security Audit) and Vercel's own build pipeline would succeed the same way. **Functionally, no** — per the finding above, the deployed app would only serve real data for one municipality (Toronto's bundled fallback) until the R2-backed `SnapshotStorage` implementation (Phase 5A §4) exists and is populated. **This is the one real blocker Phase 5B-2 needs to resolve before a deployment is meaningful** — not a reason to avoid Vercel, but a reason the data-layer migration must happen alongside (or before) the first real deployment, not after.

| | Finding |
|---|---|
| Required Vercel project settings | Framework preset: Next.js (auto-detected from `package.json`/`next.config.ts`). Build command: default (`next build`) — no override needed. Output: Vercel-managed, default. No `vercel.json` is currently needed for a standard deployment. |
| Required environment variables | **None today.** Once the R2 migration lands (Phase 5B-2): the four R2 read-only credential values (§4 below), scoped to Production + Preview. |
| Preview vs. Production environment separation | Native Vercel feature — already verified live this session (Phase 5A §14): Production/Preview/Development scoping, including branch-specific overrides for the new-municipality-testing case. Nothing new to verify here. |
| Should `getdropin.ca` remain disconnected during initial deployment? | **Yes — required by this preflight's own instructions, and already the Phase 5A §10 sequence.** The first deployment(s) should be verified entirely on Vercel's own `*.vercel.app` subdomain. |
| How should the first HTTPS deployment be produced? | Two valid, non-conflicting paths, both safe: (a) connecting the Vercel project to the GitHub repository automatically deploys the current `main` branch — this becomes Vercel's "Production" deployment in its own model, but remains reachable *only* via its `*.vercel.app` URL until a custom domain is explicitly attached (which this preflight does not do); (b) opening a PR / pushing a non-`main` branch produces a genuine, separate Preview deployment with its own unique URL. Either gives a real, HTTPS-verifiable URL without touching `getdropin.ca`. |
| Rollback capability | Native — any previous deployment (Production or Preview) can be promoted directly, already covered in Phase 5A §3/§14. |
| Current blocker | The functional-completeness gap above (Toronto-only until R2 lands) — not a Vercel-platform blocker, a sequencing one. No platform-level blocker was found. |

---

## 4. Cloudflare / R2 Preflight

**A live, dated fact check was performed this phase** (Cloudflare's own R2 API token documentation) specifically to ground the least-privilege recommendation below in verified current behavior, not general familiarity: R2 API tokens support four permission tiers — Admin Read & Write, Admin Read only, **Object Read & Write**, and **Object Read only** — and both Object-level tiers can be **scoped to a specific set of buckets**, not account-wide. A token produces four values: Access Key ID, Secret Access Key (visible only once, at creation), Account ID, and an endpoint URL (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

| | Recommendation |
|---|---|
| R2 bucket(s) required | **One bucket** (e.g. `dropin-snapshots`), not several — prefix-based separation inside it is simpler to provision and credential than multiple buckets, and matches Phase 5A §14's already-designed prefix structure. |
| Recommended bucket/prefix structure | `production/canonical/<slug>/{latest,previous}.json`, `production/raw/<slug>/{latest,previous}.json` — mirroring today's local directory shape exactly, so the migration is a storage-backend swap, not a data-shape redesign. `staging/canonical/<slug>/latest.json` for the new-municipality preview path (Phase 5A §14) — single-slot is sufficient there, since it's an ephemeral review space, not a durable production layer. `data/facility-locations/` stays in Git, unchanged — small (~210KB) and infrequently updated, no reason to migrate it. |
| Production canonical-data path | `production/canonical/<slug>/latest.json` (+ `previous.json`) |
| Preview/staging path | `staging/canonical/<slug>/latest.json` |
| Credentials/API tokens required | **Two, per least privilege** — not one shared token. |
| Minimum permissions required | Token 1 (for Vercel): **Object Read only**, scoped to the `dropin-snapshots` bucket specifically. Token 2 (for GitHub Actions): **Object Read & Write**, scoped to the same bucket. Neither is Admin-tier; neither is account-wide. |
| Which credentials belong in Vercel environment variables | Token 1's four values (Access Key ID, Secret Access Key, Account ID, endpoint) — scoped to Production + Preview (both are safe to share the same read-only token, since reading never mutates anything, per §14's already-established reasoning). |
| Which credentials are needed only by the refresh process | Token 2's four values — belongs **only** in GitHub Actions encrypted repository secrets, never in Vercel at all. The running application never needs write capability, so it should never even *possess* write-capable credentials — this is least-privilege applied concretely, not just asserted. |
| Does the browser/client ever receive R2 credentials? | **No, under any version of the design.** R2 credentials are only ever used server-side — either inside a Vercel Function (if the app ever needs an authenticated read, e.g. for a future freshness-status endpoint) or inside the GitHub Actions refresh job. The specific "combined all-sessions object" redirect design from Phase 5A §4 means the *browser* only ever receives a public object URL (or the redirect target's actual bytes) — never a credential of any kind, regardless of which way §L's open question resolves. |
| How production data remains read-only from the application perspective | Two independent layers, not one: (1) **architecturally** — the application has zero mutation code path today (reconfirmed by this phase's fresh grep, zero write/POST/PUT logic anywhere in `app/`); (2) **credential-wise** — even if that changed by accident, Vercel would only ever hold the Object-Read-only token, incapable of writing regardless of what the code tried to do. |

**Not created this phase**: no bucket, no token, no bound resource of any kind — per this preflight's explicit instruction.

---

## 5. Daily Refresh Preflight

Traced end-to-end against the actual current code (not assumed from Phase 5A's description alone):

```
Source municipalities (Toronto CKAN, PerfectMind ×3, ActiveCommunities ×3)
  → scripts/refresh/{toronto,perfectmind,activecommunities}.ts        [fetch]
  → per-source normalize() functions                                  [normalize]
  → scripts/refresh/lib.ts: refreshOneSource()                        [validate — unchanged, re-verified this session]
      → lib/dropin/snapshot/validate.ts: validateCanonicalSessions() + checkCountCollapse()
  → lib/dropin/snapshot/io.ts: writeSnapshotAtomic()                  [activate — currently local disk only]
  → [Phase 5B-2 gap: R2 SnapshotStorage implementation not yet built]
  → lib/dropin/sources/index.ts: getAllSessions()                     [app read path]
```

| | Finding |
|---|---|
| Scheduler candidate approved by Phase 5A | GitHub Actions scheduled workflow — reaffirmed, not re-litigated (§2 of the Phase 5A doc). Confirmed still the right choice: the repository remains public (re-verified live this phase), so Actions minutes remain free and unlimited. |
| Exact command/job that should run | `npm ci` (must include devDependencies — `tsx` is required to run the refresh scripts and is currently a devDependency, confirmed unchanged in `package.json` §2 above), then `npm run refresh:data -- --all --json`. |
| Runtime requirements | Node.js + `tsx`, no other system dependency — a standard `ubuntu-latest` GitHub Actions runner with a Node setup step covers this fully. |
| Expected execution duration | Consistent with Phase 3.3B's measured baseline (~11–15s at 3 PerfectMind municipalities, concurrency-bound by the slowest single source) scaled to today's 7 municipalities across two source families — low single-digit minutes expected, comfortably inside GitHub Actions' default multi-hour job timeout. Not re-measured live this phase, to avoid an unnecessary real hit on municipal servers during a preflight step. |
| Is Vercel suitable for the refresh job itself? | No — reaffirmed from Phase 5A's own research: no persistent shared filesystem, no clear advantage over GitHub Actions, and would require the same R2 credentialing complexity without the benefit of GitHub Actions' free/unlimited public-repo minutes. |
| Is GitHub Actions preferable? | Yes — already the approved primary mechanism, not merely a fallback (Phase 5A §2). |
| How credentials are provided | GitHub repository → Settings → Secrets and variables → Actions → repository secrets, injected as environment variables into the workflow step at run time — never committed, never logged (the refresh CLI's existing `--json` output already contains only counts/timings/status, confirmed in Phase 3.3B, unchanged). |
| How concurrent refreshes are prevented or handled | **Not currently handled by any code-level lock — a real, if low-probability, gap worth flagging.** The existing atomic-write pattern (temp file + verify + rename, or its R2 equivalent below) would likely survive two overlapping runs without *corrupting* data, but two simultaneous refreshes would be wasteful (double the outbound calls to municipal servers) and is not the intended design. **Recommended fix, at the scheduler layer, not the application layer**: GitHub Actions' native `concurrency` key (e.g. `group: refresh-data`, `cancel-in-progress: false` — queue rather than cancel, so a run in progress always completes cleanly) — a one-line workflow-file setting, not new application code. |
| What happens if one municipality fails | Unchanged, reconfirmed by re-reading the actual code this phase: isolated per-municipality failure (`refreshOneSource`), the existing snapshot for that municipality is left untouched, other municipalities' refreshes are unaffected. |
| What happens if validation fails | Unchanged: `validateCanonicalSessions`/`checkCountCollapse` reject the new snapshot before activation; the raw snapshot is still written for debugging, but the canonical layer — the one the app actually reads — is never touched. |
| What happens if upload fails (the one genuinely *new* failure mode R2 introduces) | Today, "write" and "upload" are the same local filesystem operation, so this failure mode doesn't exist yet in isolation. Once migrated: an R2-backed `SnapshotStorage.writeAtomic()` needs the same safety property the local implementation already has, achieved differently since R2/S3 has no POSIX rename primitive — but a single `PUT` to a given object key **is itself atomic** (a reader always sees either the fully-old or the fully-new object, never a partial write), which is the property that actually matters. The adapted pattern: server-side-copy the current `latest` object to `previous` first (R2 supports this natively), *then* `PUT` the new data to `latest` — if that final `PUT` fails or the network drops, the previous `latest` object is simply never overwritten, which is exactly the same "fail-safe, not fail-corrupt" guarantee the local implementation already provides, translated to the new backend rather than assumed to carry over for free. |

---

## 6. Failure / Last-Known-Good Preflight

| Requirement | Proposed mechanism |
|---|---|
| Validation before promotion | Already built, reconfirmed against real code this phase — `validateCanonicalSessions()` (schema/shape) and `checkCountCollapse()` (>50% session-count drop protection) both run before any write is attempted. Carries over unchanged; no new validation logic needed for R2. |
| Atomic/safe snapshot promotion | Local: existing temp-file + round-trip-verify + `renameSync` (unchanged). R2: server-side copy (rotate) then a single atomic `PUT` (§5 above) — same safety property, different mechanism, not assumed equivalent without checking how R2 actually behaves. |
| Last-known-good preservation | The existing 2-slot (`latest` + `previous`) retention policy, ported to R2 key prefixes unchanged in shape (§4). A failed refresh literally cannot touch `latest`, by construction — there is no code path where a rejected snapshot reaches the write step at all. |
| Rollback | Not automated today, and not proposed to become automated — the `previous` object/file remains available for a **manual** restore (copy `previous` back over `latest`) if a bad snapshot were ever somehow activated despite the validation gates. This matches today's existing local behavior exactly; Phase 5B-2 doesn't need to build anything new here beyond what already exists. |
| Stale-data detection | `scripts/snapshot-health.ts`'s existing `classifyFreshness` (FRESH/AGING/STALE/UNAVAILABLE, built in Phase 3.3B) — needs to be pointed at R2 instead of local disk once the storage migration lands, but the classification logic itself needs no change. |
| Refresh failure notification | GitHub Actions' built-in failure email (Phase 5A §6) — already wired for free by the refresh CLI's existing non-zero exit code on any municipality failing to activate (`scripts/refresh/index.ts`, reconfirmed unchanged this phase). |

**Nothing above is being built this phase** — this is the exact mechanism Phase 5B-2 should implement, stated precisely so there's no ambiguity when that phase begins.

---

## 7. Data Lifecycle Check

Reaffirming Phase 5A §13 against the freshly-verified current state (§2 above), not re-deriving from scratch:

- **Active canonical snapshot**: `latest.json` per municipality — retained indefinitely as "whatever the last successful refresh produced," continuously replaced, never aged out on a timer. Unchanged recommendation.
- **Previous/rollback snapshot(s)**: exactly one generation (`previous.json`) per layer, per municipality — the existing, already-correct policy. No deeper history recommended; nothing in this preflight found new evidence to revisit that.
- **Temporary refresh artifacts**: the local implementation's `.tmp-*` files are already discarded on any validation failure and never a valid read target (confirmed in `io.ts`, unchanged); the R2 equivalent (§5/§6 above) has no comparable durable temp object at all, since the "temp" step becomes an in-memory buffer before a single atomic `PUT` — arguably an improvement, not something needing separate cleanup.
- **Expired sessions**: excluded from what `/api/sessions` returns via real-time filtering against live `now` (`hasEnded`, in `getAllSessions`) — not deleted from the snapshot, ages out naturally on the next refresh because every current source is inherently forward-looking (Phase 5A §13, re-verified there against real fetch-parameter evidence, not re-derived here).
- **Debugging artifacts**: the `raw/` layer, same 2-slot policy, never read by the running app — unchanged recommendation.
- **No historical data warehouse** is recommended, consistent with Phase 5A §13's explicit "no current product need identified" finding — not revisited, since nothing this phase found changes that conclusion.
- **Git remains correctly excluded from this entire lifecycle** — reconfirmed fresh this phase (§2): `data/raw/` and `data/canonical/` are still gitignored, still untracked, still absent from git history where they don't belong.

---

## 8. Human Action Checklist

**Nothing below has been performed.** Every item requires the project owner's own account/credential access — Claude Code cannot create cloud accounts, buckets, or tokens, and per this session's own safety discipline, wouldn't do so autonomously even if technically possible (credential creation and cloud-resource provisioning are exactly the class of action requiring explicit, deliberate owner action, not agent-initiated automation). **No secret value should ever be pasted into chat with Claude, into any file in this repository, or into any documentation — every credential below goes directly from the platform that generates it into the platform that consumes it, with Claude only ever needing to reference the *environment variable name*, never the value itself.**

### Cloudflare

- [ ] **Create the R2 bucket.** Where: Cloudflare dashboard → R2 → "Create bucket." What to create: a bucket (suggested name: `dropin-snapshots`). What Claude needs afterward: just the bucket name — not secret, fine to share in chat.
- [ ] **Create the read-only API token** (for Vercel). Where: Cloudflare dashboard → R2 → "Manage R2 API Tokens" → "Create API Token." Configuration: permission = **Object Read only**, scoped to the `dropin-snapshots` bucket specifically (not account-wide). What Claude needs afterward: nothing directly — the four resulting values (Access Key ID, Secret Access Key, Account ID, endpoint URL) are **secret** and go directly into Vercel's Environment Variables UI (below), never into chat or a file.
- [ ] **Create the read-write API token** (for GitHub Actions). Same location, permission = **Object Read & Write**, scoped to the same bucket. The four resulting values are **secret** and go directly into GitHub's repository secrets UI (below), never into chat or a file.

### Vercel

- [ ] **Connect the GitHub repository.** Where: vercel.com → "Add New" → "Project" → "Import Git Repository" → select `qw-1YG3/dropin`. What: authorizing Vercel's GitHub App (an OAuth-style authorization, not a value to relay to Claude).
- [ ] **Configure environment variables.** Where: the new Vercel project → Settings → Environment Variables. What: paste the read-only R2 token's four values directly here, scoped to **Production + Preview**. What Claude needs afterward: only the *names* chosen for these variables (e.g. `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`) so the corresponding code can reference `process.env.R2_ACCESS_KEY_ID` etc. — never the values.
- [ ] **Confirm the first deployment.** Where: happens automatically once the repo is connected, or triggered manually from the Vercel dashboard. What Claude needs afterward: the resulting `*.vercel.app` URL (not secret) to verify against.

### GitHub

- [ ] **Add the R2 read-write credentials as repository secrets.** Where: github.com/qw-1YG3/dropin → Settings → Secrets and variables → Actions → "New repository secret." What: paste the read-write R2 token's four values directly here. What Claude needs afterward: only the secret *names* chosen, to reference in the workflow YAML — never the values.

### Domain

- [ ] **DNS changes — explicitly not part of this checklist's scope.** Only after production launch is deliberately approved, per this preflight's own instructions and Phase 5A §10's sequence. Nothing to do here yet.

---

## 9. Security Boundary — Reconfirmed

Every assumption below was actively re-checked this phase, not assumed still true from memory:

| Assumption | Status |
|---|---|
| No private Gmail address in source | **Holds.** Fresh grep this phase found zero live exposures — the only match is the Security Audit's own historical remediation record naming *which past commits* contained it, not a current exposure. |
| No credentials in Git | **Holds.** Fresh secret-pattern scan, zero `.env` files, zero `process.env` usage beyond `NODE_ENV`, working tree fully clean. |
| No R2 secret exposed client-side | **Holds, trivially — nothing to expose yet.** R2 isn't implemented at all today; the *design* commitment (§4) is that only the read-only token would ever reach Vercel, and never the browser, once it is. |
| Precise location remains browser-only | **Holds, unchanged.** Nothing touched this session affects `useUserLocation`/`app/page.tsx`'s geolocation handling. |
| `/design` remains unavailable in production | **Holds.** `proxy.ts` re-read this phase, unchanged since the Security Audit's P1-1 remediation — still blocks `/design` and `/design/:path*` with a bare 404 whenever `NODE_ENV === "production"`. |
| Preview cannot mutate production data | **Holds, by design.** The application has zero mutation code path today (reconfirmed by fresh grep), and the credential-scoping plan (§4) ensures even the *deployed* app, in any environment, only ever holds read-only R2 credentials. |
| `getdropin.ca` remains untouched during preflight | **Holds.** No DNS, domain, or hosting action was taken this phase. |

**No blocker found. All seven assumptions hold.**

---

## Final Report

**A. Preflight: PASS.** No genuine architectural blocker was found — the one functional gap identified (§2/§3: a fresh Vercel deployment would be Toronto-only until the R2 migration lands) is an expected, already-anticipated consequence of Phase 5A's own sequencing, not a new problem, and is precisely why Phase 5B-2 needs to implement the storage migration alongside (not after) the first real deployment.

**B. Existing implementation that can be reused, unchanged:** the entire validation/atomicity/failure-isolation pipeline (`validateCanonicalSessions`, `checkCountCollapse`, the temp-file-then-verify write pattern's *safety property*, per-municipality `Promise.allSettled` isolation), the `SnapshotStorage` interface itself (the seam Phase 3.3B built specifically for this migration), the refresh CLI's `--json` output mode, `snapshot:health`'s freshness classification, and `proxy.ts`'s production `/design` block — none of this needs to be rebuilt, only re-pointed at a new storage backend.

**C. Infrastructure that still needs to be created:** one Cloudflare R2 bucket, two scoped API tokens (read-only for Vercel, read-write for GitHub Actions), a Vercel project connected to the GitHub repo with Production+Preview-scoped environment variables, and a GitHub Actions scheduled workflow with its own repository secrets. None of this exists yet (§2). None of it was created this phase.

**D. Exact proposed production data flow:** `production/canonical/<slug>/{latest,previous}.json` and `production/raw/<slug>/{latest,previous}.json` in one R2 bucket, mirroring today's local directory shape exactly — written only by the GitHub Actions refresh job (holding the read-write token), read only by the deployed Vercel app (holding the read-only token). Full detail: §4.

**E. Exact proposed daily refresh flow:** GitHub Actions scheduled workflow → `npm ci` (with devDependencies) → `npm run refresh:data -- --all --json`, using a `concurrency` group to prevent overlapping runs, writing to R2 via the same validate-then-atomically-activate pipeline that already exists, adapted (server-side copy, then a single atomic `PUT`) rather than assumed to carry over unexamined. Full detail: §5.

**F. Last-known-good / rollback strategy:** unchanged in principle from what already exists locally — 2-slot retention, a failed refresh structurally cannot reach the write step, manual (not automated) restore from `previous` remains available if ever needed. Full detail: §6.

**G. Failure notification strategy:** GitHub Actions' built-in failure email, triggered by the refresh CLI's existing non-zero exit code — zero new infrastructure, reaffirmed from Phase 5A §6.

**H. Preview/Production isolation strategy:** Vercel's native Production/Preview environment separation, with the common case (UI/feature work) safely reading the same production R2 data (safe because the app has no write path, confirmed fresh this phase), and the specific new-municipality-testing case using a distinct `staging/` R2 prefix plus one branch-scoped Preview environment variable — full detail already recorded in Phase 5A §14, reaffirmed unchanged here.

**I. Data lifecycle strategy:** 2-slot retention at every layer, no historical archive, cleanup happens as a byproduct of atomic rotation (not a separate job), Git remains permanently excluded from this data category — reconfirmed against the actual current `.gitignore`/tracked-files state this phase, not merely restated from Phase 5A. Full detail: §7.

**J. Security boundary verification:** all seven assumptions re-checked fresh this phase and confirmed holding — no blocker. Full detail: §9.

**K. Human action checklist:** §8 in full — organized by platform (Cloudflare, Vercel, GitHub, Domain-deferred), each item specifying exactly where to go, what to create, what Claude needs afterward, and explicit confirmation that every secret value goes directly from its issuing platform into its consuming platform, never through chat or a committed file.

**L. Exact recommended implementation sequence for Phase 5B-2 onward:**
1. Project owner works through the Cloudflare checklist (§8) — bucket + two scoped tokens.
2. Claude Code implements the R2-backed `SnapshotStorage` class (using the existing interface), converting the currently-synchronous read/write call sites to async.
3. Claude Code implements the `/api/sessions` redirect design (Phase 5A §4) — **contingent on resolving §L's open trade-off first** (see M below).
4. Project owner works through the Vercel checklist (§8) — connect repo, set Production+Preview-scoped read-only env vars.
5. Claude Code verifies the deployed app on its `*.vercel.app` URL: `/`, `/api/sessions`, and `/design/*` (must still 404), against real R2-backed data this time, not local disk.
6. Project owner works through the GitHub checklist (§8) — read-write secrets.
7. Claude Code writes the GitHub Actions scheduled-refresh workflow, including the `concurrency` group (§5).
8. Project owner manually triggers the workflow once (`workflow_dispatch`), confirms it succeeds end-to-end against real R2 credentials, and confirms the live Vercel deployment picks up the new data with no redeploy.
9. Project owner deliberately breaks the workflow once to confirm the GitHub failure-email notification actually arrives.
10. Only after 1–9 are all independently verified working: project owner connects `getdropin.ca` (Phase 5A §10's own sequencing, reaffirmed, not moved up).

**M. Decisions that still require owner approval before Phase 5B-2 proceeds:**
1. **Phase 5A §L's still-open trade-off**: whether `/api/sessions` becomes a redirect to a public R2 object (requiring the end-of-day/`hasEnded` filter to move client-side) or keeps a server-side filtering pass (reintroducing the Vercel 4.5MB response-size question Phase 5A flagged). Not resolved by this preflight — it wasn't resolved by Phase 5A either, deliberately, and remains the one genuine open design question blocking step 3 above.
2. **Confirmation of the credential-scoping plan itself** (§4/§8) — specifically, that two separate least-privilege tokens (rather than one shared token) is an acceptable amount of setup friction in exchange for the security property it buys. This preflight recommends it; it hasn't been explicitly approved.
3. **R2 bucket naming** (`dropin-snapshots` suggested, not fixed) — a trivial choice, but one the owner should make rather than have silently assumed.

Stopping here, as instructed. No deployment, no cloud resource creation, no domain connection, and no Phase 5B-2 implementation was started.
