# Phase 5A — Hosting + Daily Data Refresh Architecture Decision

**Scope:** architecture and provider selection only. Nothing was deployed, no domain was connected, no scheduler was implemented, and the application was not modified — the one exception is `next.config.ts`/code inspection performed purely to verify claims, never to change behavior. Every claim below is either **VERIFIED** (checked directly against this repository, or against a live, dated fetch of a provider's current documentation) or **RECOMMENDATION** (a judgment call, clearly labeled as such). Nothing is designed from assumption.

**Relationship to prior work:** `docs/PHASE_3_3B_SCHEDULER_DEPLOYMENT_STRATEGY.md` already did substantial work on this exact question, and its findings are the starting point here, not repeated from scratch. That document was written when DropIn had 3 municipalities and ~200MB of snapshot data, and it explicitly recommended a **persistent server** (Model A) specifically because (a) no evidence yet favored serverless, and (b) the local-filesystem storage layer was already built and working. Two things have materially changed since: the dataset has grown to 7 municipalities (~238MB, and still growing), and this phase explicitly asks to evaluate Vercel and Cloudflare — both serverless-first platforms — as real candidates rather than a generic "some persistent host." That change in ask, combined with real growth in data volume, changes the correct recommendation in one specific way (detailed in §3): the storage layer now needs the object-storage migration Phase 3.3B already scoped out but deliberately deferred, because the case for it is now concrete rather than hypothetical.

---

## 1. The Real Current Pipeline (inspected fresh this phase)

```
municipal source (Toronto CKAN, PerfectMind, ActiveCommunities APIs)
  → scripts/refresh/{toronto,perfectmind,activecommunities}.ts   [fetch]
  → per-source normalize() functions                              [normalization]
  → scripts/refresh/lib.ts: refreshOneSource()                     [validate + facility enrichment]
      → lib/dropin/snapshot/validate.ts: validateCanonicalSessions() + checkCountCollapse()
  → lib/dropin/snapshot/io.ts: writeSnapshotAtomic()                [atomic activation]
      → data/raw/<slug>/{latest,previous}.json
      → data/canonical/<slug>/{latest,previous}.json
  → lib/dropin/sources/index.ts: getAllSessions()                  [production read path]
  → app/api/sessions/route.ts                                       [API]
  → app/page.tsx (client fetch)                                     [production application]
```

**Scripts involved:** `scripts/refresh/index.ts` (orchestrator, entry point for `npm run refresh:data`), `scripts/refresh/toronto.ts`, `scripts/refresh/perfectmind.ts`, `scripts/refresh/activecommunities.ts` (per-source-family fetch+normalize), `scripts/refresh/lib.ts` (shared `refreshOneSource` — validation, facility enrichment, atomic write), `scripts/refresh/facility-locations.ts` + `scripts/refresh/facility-sources/{nominatim,toronto-open-data}.ts` (a **separate**, lower-frequency process — not part of the daily municipality refresh).

**Runtime required:** Node.js + `tsx` (a devDependency — a minimal production `npm install --omit=dev` would not include it; the refresh environment needs a devDependency-inclusive install, distinct from the app's own production install).

**Execution characteristics (measured directly in Phase 3.3/3.3B, not re-measured this phase to avoid an unnecessary live hit on municipal servers during an architecture-only phase):** a full concurrent `--all` refresh completed in ~11–15s at 3 municipalities. All municipalities/sources already refresh concurrently (`Promise.all` / `Promise.allSettled` in `scripts/refresh/index.ts`), so wall-clock time scales with the *slowest* single source, not the sum — at 7 municipalities today, still well within a small number of minutes; comfortably inside any scheduler's job-duration limits evaluated below.

**Network access required:** outbound HTTPS to each municipality's public API/CKAN endpoint — no inbound access, no VPN, no special network placement. All currently-integrated sources require **zero API keys or credentials** (verified in Phase 3.0/3.1, unchanged).

**Files read:** none, on a from-scratch run (each source fetches live). `readJsonIfExists(canonicalLatestPath(slug))` is read once per municipality, purely to compare the new session count against the previous one for count-collapse protection (§4) — not required data, a safety check.

**Files written:** `data/raw/<slug>/{latest,previous}.json` and `data/canonical/<slug>/{latest,previous}.json`, only for municipalities that pass validation.

**Generated datasets, measured fresh this phase:**

| | Size (`latest.json` only, per municipality, largest → smallest) |
|---|---|
| Raw | Mississauga 45M, Toronto 14M, Newmarket 7.7M, Markham 5.8M, Vaughan 4.6M, Richmond Hill 947K, Aurora 207K — **~78MB total** |
| Canonical | Toronto 22M, Mississauga 14M, Newmarket 2.1M, Markham 1.5M, Vaughan 1.2M, Richmond Hill 237K, Aurora 169K — **~41MB total** |

With 2-slot (`latest`+`previous`) retention at each layer, on-disk today: **`data/raw/` = 155MB, `data/canonical/` = 83MB, combined ~238MB** — up from Phase 3.3B's ~200MB estimate at 3 municipalities, confirming the growth trend that document already anticipated (§18 there projected 500MB–1GB at 8–12 municipalities; today's 7-municipality, 238MB reality is consistent with that trajectory).

**A new, decision-relevant measurement Phase 3.3B did not make:** the actual `/api/sessions` response, unfiltered, is **24MB uncompressed** (gzip-compresses to ~1MB, verified with a real request against a live production build during the just-completed security audit). This number is the single most important new fact this phase surfaces — see §3.

**Whether Git is currently part of the data-update workflow:** **partially, and inconsistently by design.** `data/raw/` and `data/canonical/` are gitignored — never committed, purely local/ephemeral-to-whichever-machine-runs-refresh. `data/facility-locations/{latest,previous}.json` (a small, ~210KB cross-cutting registry, refreshed far less often via a *separate* script using rate-limited Nominatim geocoding) **is** git-tracked. `data/toronto-open-data/*.json` (a static, rarely-changing bundled fallback) is also git-tracked. So: Git already is the publication mechanism for the two *small*, *infrequently-changing* datasets, and deliberately is not for the *large*, *daily* one — a distinction that turns out to matter a great deal for §2.

**Whether the production app reads bundled data, filesystem data, generated modules, API data, or another mechanism:** filesystem data, read at request time (`lib/dropin/sources/index.ts`'s `loadMunicipalitySessions`, via `readFileSync`/`statSync` against `data/canonical/<slug>/latest.json`), with one exception — Toronto has a **build-time-bundled** fallback (`import()` of `data/toronto-open-data/*.json`, only used if no canonical snapshot exists yet). This confirms Phase 3.3B's own finding, still true: the app's read path assumes a **persistent, shared, writable disk** between the refresh process and the running server process. This has not changed and was not touched this phase.

**Whether refresh currently assumes local paths or local tooling:** no local-machine-specific assumption exists (all paths are `path.join(process.cwd(), "data", ...)`, portable to wherever the process runs — already confirmed in the just-completed security audit). It does assume a *persistent* disk shared with the app process, which is a real, load-bearing architectural assumption, not a portability bug.

---

## 2. Refresh Model Comparison

| | A. GitHub Actions scheduled workflow | B. Hosting-provider scheduled function/cron | C. Materially simpler alternative |
|---|---|---|---|
| **Reliability** | High; GitHub's cron has a documented tendency to run a few minutes late under load — irrelevant at a once-daily cadence | High, provider-managed | N/A |
| **Implementation complexity** | Low — one YAML workflow file, calling the exact existing `npm run refresh:data -- --all --json` CLI unchanged | Low-to-medium, provider-dependent; couples the refresh job's runtime/timeout/network egress rules to whatever that platform's scheduled-function product allows | — |
| **Cost** | **Free, unlimited minutes** — confirmed: this repository is a **public** GitHub repo (verified in the security audit's follow-up), and GitHub Actions on standard runners is free and unmetered for public repositories | Usually free/bundled at this volume, but tied to the app's own hosting plan | — |
| **Free-tier suitability** | Excellent, by construction | Good, but variable by provider and sometimes gated to paid tiers for "scheduled function" specifically | — |
| **GitHub public-repo implications** | This is the one place repo-publicness is a genuine *advantage* rather than a risk (§ this was the subject of the P1-2 remediation in the security audit) — free compute exists *because* the repo is public | N/A | — |
| **Secrets requirements** | Native encrypted repo secrets (GitHub Actions secrets) — needed for object-storage credentials (§3), nothing else (the refresh pipeline itself needs zero secrets, confirmed §1) | Whatever that provider's own env-var/secrets UI offers | — |
| **Runtime limits** | Generous for a job measured in low minutes (GitHub Actions default job timeout is far beyond what this needs) | Serverless scheduled-function products on both Vercel and Cloudflare cap a single invocation's duration — Vercel's general Function duration limits are documented (5 minutes default/max on the Hobby plan, confirmed live in §3) and would need explicit configuration headroom for a 7-source concurrent refresh; not a blocker at today's ~11–15s-per-run scale, but a real constraint to keep in mind if source count keeps growing | — |
| **Municipal-source fetch requirements** | Runs on a normal GitHub-hosted Actions runner — plain outbound HTTPS, no different from any other environment | Same, if using the provider's scheduled-function product | — |
| **Filesystem persistence** | **None, and none needed** — Actions runners are ephemeral VMs with no shared disk with the running app; this is exactly why the refresh job must write to durable storage that both it and the app can reach (§3), not to a local disk | Same underlying constraint on Vercel/Cloudflare specifically (both serverless) | — |
| **Atomicity / rollback / recovery** | Unaffected by *which* scheduler triggers the job — atomicity is a property of `writeSnapshotAtomic()` and the validation gates in `refreshOneSource()` (§4), already built, independent of scheduler choice | Same | — |
| **Observability** | Built-in run history in the Actions tab, plus free failure-email notification to repo watchers on any non-zero exit code — directly usable, since the refresh CLI already exits non-zero on any failed-to-activate municipality (§1, `scripts/refresh/index.ts`'s `process.exit(...)`) | Provider's own function logs — generally serviceable but doesn't double as a free notification channel the way GitHub Actions does | — |
| **Ease of maintenance by one developer** | One YAML file, reviewed once, then it runs unattended — no new account, no new dashboard to check regularly beyond occasionally glancing at the Actions tab or waiting for a failure email | An additional provider-specific scheduling UI/concept to learn and maintain, on top of everything else that provider already handles | — |

**C — a materially simpler alternative:** none was found that beats A. The repository's own free, unlimited, already-present GitHub Actions is about as simple as a scheduled-job architecture gets; there's no evidence a different mechanism would reduce complexity further while keeping reliability and observability this good.

**Recommendation: A — GitHub Actions scheduled workflow**, promoted from Phase 3.3B's "fallback/redundant" role to the **primary and only** refresh trigger. Phase 3.3B originally recommended OS/server cron as primary specifically because a persistent server was the recommended hosting model; since this phase's hosting recommendation is serverless (§3), there is no persistent host to attach an OS cron job to, and GitHub Actions is simply the correct primary mechanism now — not a downgrade, a direct consequence of the hosting choice.

---

## 3. Hosting Comparison — Vercel vs. Cloudflare, Against DropIn's Verified Requirements

Every row below is checked against a requirement this project actually has, verified either in `docs/SECURITY_DEPLOYMENT_AUDIT.md` or freshly in this phase (with live provider documentation fetched today where the fact is fast-changing enough that training-data knowledge would be unreliable).

| Requirement | Vercel | Cloudflare (Workers/Pages) |
|---|---|---|
| **Next.js 16 App Router support** | First-party — Vercel is Next.js's creator; Next 16 ships with Vercel as its reference deployment target. Treated as stable/GA. | Supported via a dedicated adapter. **Verified via a live fetch of Cloudflare's own current docs (checked this phase): Cloudflare's own current recommended Next.js deployment path is explicitly labeled BETA** — their docs state it directly and recommend running a compatibility check "before adopting it for an existing production application." The older adapter (OpenNext) remains available for apps with a "compatibility gap," implying the newer path isn't yet at full parity either. |
| **Proxy/Middleware support (the exact mechanism now blocking `/design/*`, `proxy.ts`)** | Native, first-party, zero-config — this is exactly the platform `proxy.ts`/Middleware was designed for. | Confirmed supported by Cloudflare's current (beta) Next.js path per the same live fetch — but inherits that path's overall beta status. |
| **Server/API route requirements** (`/api/sessions`) | Full Node.js API coverage in Vercel Functions (confirmed live, §"API support" in Vercel's current function-limits docs) — no rewrite needed for anything the app currently does. | Cloudflare Workers' runtime is not a full Node.js environment by default; Node compatibility is provided via a compatibility layer, not confirmed to cover everything DropIn's server code uses (this app doesn't currently use Node-specific APIs beyond `node:fs`/`node:path` in the refresh scripts, which wouldn't run on Workers anyway under this phase's recommended architecture — but the beta status above is the more decisive factor regardless). |
| **A real, verified constraint independent of which of these two is chosen: Vercel Function response size** | **Confirmed live, current as of this phase's research: Vercel Functions cap response payload size at 4.5MB.** DropIn's current `/api/sessions` returns **24MB uncompressed** — this is a real mismatch that must be addressed (§ below), not a hypothetical one. | Cloudflare Workers do not share this specific 4.5MB Vercel limit, but the point is moot — the fix below (§ Dataset Publication Model) removes the *application* from the business of serving the full dataset as a function response on **either** platform, so this stops being a platform-differentiator once addressed. |
| **Build/deployment workflow, GitHub integration** | Native — connect the repo, every push to `main` auto-deploys, PRs get preview deployments. Zero configuration beyond authorizing the GitHub App. | Also native via Cloudflare's own GitHub integration — comparable simplicity. |
| **Custom domain (`getdropin.ca`) + HTTPS** | Standard, well-documented, automatic HTTPS via Vercel's own certificate provisioning. DNS/domain stays wherever it already is (Cloudflare, per the security audit) — Vercel only needs the domain pointed at it, it does not need to *host* DNS. | Same story in reverse — if hosting on Cloudflare Workers, and DNS is *already* on Cloudflare, this is arguably marginally more integrated (same account, same dashboard) — the one genuine Cloudflare-specific convenience found in this comparison. |
| **Logs** | Standard function logs in the Vercel dashboard, per-deployment. | Standard Workers logs (`wrangler tail` / dashboard), comparable. |
| **Rollback** | One-click "promote a previous deployment to production" — mature, well-known feature. | Cloudflare also supports rollback to a previous deployment — comparable. |
| **Free-tier feasibility for this project's current traffic** | Vercel's Hobby plan: 2GB memory, full Node API coverage, generous concurrency (auto-scales to 30,000), free — comfortably fits an early-stage, sub-second-request-time app like this one. | Cloudflare Workers' free tier is also generous for low/moderate traffic — roughly comparable at this stage. |
| **Operational complexity, net** | Lower, specifically *because* of first-party/stable Next.js support — no beta-adapter risk to monitor or work around. | Higher today, specifically because of the beta status just confirmed — real risk of hitting an undocumented compatibility gap on a brand-new (Next 16) framework version, for a solo-maintained project that explicitly wants low maintenance burden. |

**Recommendation: Vercel.** The decisive factor is the freshly-verified beta status of Cloudflare's current Next.js 16 deployment path against Vercel's first-party, stable support for the exact same framework version — for a solo developer explicitly prioritizing low maintenance, choosing the platform with a real, live-confirmed compatibility risk over the platform built by the framework's own maintainers isn't justified without a concrete Cloudflare-specific requirement, and none was found. (The one place Cloudflare Workers hosting would have a genuine edge — DNS/hosting living in one account, since `getdropin.ca`'s DNS is already on Cloudflare — does not outweigh a live-confirmed beta-compatibility risk for a real production launch.) **Domain/DNS and application hosting remain cleanly separable, exactly as the task noted**: `getdropin.ca` stays on Cloudflare for DNS/email routing; only the application itself moves to Vercel.

**The 4.5MB response-size finding needs a real fix, addressed below — not a reason to avoid Vercel, since it would need solving on nearly any serverless host, and the fix is small and clean.**

---

## 4. Dataset Publication Model (the one place this phase's recommendation changes the data layer)

**Why local-filesystem storage (Phase 3.3B's recommendation) cannot carry over unchanged:** Vercel serverless functions have no persistent, writable, cross-invocation filesystem — confirmed again this phase, unchanged from Phase 3.3B's own finding. A GitHub Actions refresh job and a Vercel Function serving `/api/sessions` are different, ephemeral compute environments with no shared disk between them.

**Why git-commit-and-redeploy (Phase 3.3B's "Option B," already flagged there as a poor fit) is an even worse fit today than when that document was written:** committing changed canonical JSON to the repo daily would mean committing **~41MB of substantively-different JSON every single day** to a **public** repository (confirmed public in the security audit's follow-up) — over a year, tens of gigabytes of git history growth, since large reordered/regenerated JSON doesn't delta-compress the way source code does. Phase 3.3B ruled this out on principle at ~70MB-total-project scale; at today's real, measured 41MB-per-refresh scale, the case against it is no longer theoretical.

**Recommendation: Cloudflare R2 object storage**, implementing the `SnapshotStorage` interface Phase 3.3B already built for exactly this purpose (`lib/dropin/snapshot/io.ts`) — a new class alongside `LocalFilesystemSnapshotStorage`, not a rewrite of any call site's calling convention beyond making reads/writes async (currently synchronous; every existing call site already runs inside an `async` function, so this is a mechanical change, not a structural one).

**Why R2 specifically, over Vercel Blob (the same-provider alternative) or S3:**
- **Confirmed live, this phase: R2's free tier is 10GB storage, 1M Class A + 10M Class B operations/month, and — its headline feature — zero egress fees.** 10GB comfortably covers today's ~238MB and the ~500MB–1GB Phase 3.3B projected for 8–12 municipalities, with room to spare.
- Zero egress fees matter specifically for DropIn's access pattern: the recommended fix for the 4.5MB Vercel limit (below) means every real user visit reads the full combined dataset directly from object storage — an egress-fee model would make traffic growth a real, unpredictable cost; R2's model makes it free regardless of traffic.
- Keeps the data layer decoupled from the hosting choice (R2 is reachable from Vercel, from GitHub Actions, or from anywhere else) — consistent with Phase 3.3B's own explicit "avoid casual provider lock-in" framing, and means a future hosting migration wouldn't also force a data-layer migration.

**The 4.5MB Vercel response-size fix, specifically:** rather than having `/api/sessions` read the full dataset from R2 and return it as a Vercel Function response (still capped at 4.5MB, so this alone would not fix anything), the recommended shape is: the refresh job writes one **combined, pre-assembled "all municipalities" JSON object** to R2 (in addition to, or instead of, the existing per-municipality split — a small addition to `refreshOneSource`'s existing writes), made readable via a public R2 URL; `/api/sessions` becomes a thin redirect to that object's current URL. Because `fetch()` follows redirects transparently, **`app/page.tsx`'s existing `fetch("/api/sessions")` call needs no change at all** — the client keeps working exactly as it does today, but the actual bytes are served by R2/Cloudflare's CDN path, not a Vercel Function invocation, so the 4.5MB cap no longer applies.

**The one real trade-off this introduces, flagged honestly rather than decided unilaterally (see §L):** the current server-side read path (`applyReadTimeView` in `lib/dropin/sources/index.ts`) filters out already-ended sessions and computes the `day` (today/tomorrow) label fresh against live `now` on every request — this is what keeps the "Updated..." and date-relative UI honest without waiting for the next refresh cycle. A redirect straight to a static R2 object bypasses that server-side step entirely. This filtering would need to move to the client (which already has `now` and the full dataset in memory for its own search/filter UI, so this is a contained, not a structural, change) — or the redirect approach would need to be reconsidered in favor of a lighter-weight server-side pass that still avoids the 4.5MB ceiling somehow. **This is a real design decision for Phase 5B, not resolved here.**

---

## 5. Daily Refresh Safety Model

**Investigated fresh this phase, not assumed:** the safety model the task asks for — fetch → normalize → validate → accept only valid output → publish → production update, with a failed source never destroying the previous known-good dataset — **already exists, in full, and needs no changes.**

- **Validation already exists**: `lib/dropin/snapshot/validate.ts`'s `validateCanonicalSessions()` checks required fields, malformed dates, start/end ordering, and duplicate IDs before a snapshot is allowed to activate.
- **A second, independent safety gate already exists**: `checkCountCollapse()` refuses to activate a new snapshot if its session count drops by more than 50% relative to the previous snapshot (when that previous count was itself meaningful, ≥10) — protecting against a source silently returning a truncated or empty response without erroring outright.
- **Updates are already atomic**: `writeSnapshotAtomic()` (`lib/dropin/snapshot/io.ts`) writes to a temp file, round-trip-verifies it parses as valid JSON, rotates the current file into `previous.json`, then `renameSync`s the temp file into place — an atomic POSIX rename, so a reader can never observe a partially-written file.
- **Partial municipality failure is already fully supported and isolated**: each municipality's `refreshOneSource()` call is independent; a failed fetch, failed normalization, failed validation, or failed count-collapse check for one municipality writes nothing to that municipality's canonical snapshot and returns a failure report, **without affecting any other municipality's refresh in the same run** (`Promise.all`/`Promise.allSettled` in `scripts/refresh/index.ts`).
- **One failed municipality does not block other updates** — directly verified by reading the orchestration code; each source's activation is independent.
- **Previous known-good data is already preserved** by construction — a failed validation/collapse check simply never calls `writeSnapshotAtomic()` for the canonical layer, so `latest.json` (and the app's read path, `lib/dropin/sources/index.ts`) continues serving whatever the last successful run produced.
- **Stale data is already classified**: `scripts/snapshot-health.ts`'s `classifyFreshness` (built in Phase 3.3B) reports FRESH/AGING/STALE/UNAVAILABLE per municipality based on time since last successful fetch — an operational tool, already built, unaffected by this phase's hosting/storage changes.
- **"Updated..." UI remains truthful already**: each session's `lastUpdated` is sourced from its canonical snapshot's real `fetchedAt` — since a failed refresh never touches that snapshot, the displayed "Updated N ago" label continues correctly reflecting the last real successful fetch, not a fake "just refreshed" timestamp. No change needed. (This is the one place §4's proposed redirect trade-off is most relevant — see §L.)

**No changes are recommended to this layer.** The only change the new architecture requires is *where* `writeSnapshotAtomic`/`readJsonIfExists` ultimately read/write (R2 instead of local disk, §4) — the validation, atomicity, and isolation guarantees above are properties of the logic layered on top of that storage interface, not of the local filesystem specifically, and carry over unchanged once the new `SnapshotStorage` implementation exists.

---

## 6. Failure Notification

**Recommendation: GitHub Actions' own built-in failure-email notification** — free, zero setup beyond the scheduled workflow existing at all. The refresh CLI already exits non-zero (`process.exit(reports.every((r) => r.activated) ? 0 : 1)` in `scripts/refresh/index.ts`) whenever any municipality fails to activate a new snapshot, which is exactly the signal that marks a GitHub Actions step (and therefore the whole workflow run) as failed — triggering GitHub's default email notification to the repository's notification-enabled users, with zero additional code or third-party service.

**Not recommended at this stage**: a dedicated monitoring platform, Slack/webhook integration, or paging service — none is justified by anything observed about DropIn's actual scale or failure history; this would be exactly the kind of infrastructure the task explicitly asked to avoid introducing without evidence of need.

---

## 7. Cost

| | Required | Optional | Future scaling |
|---|---|---|---|
| **Application hosting (Vercel)** | $0 — Hobby plan covers this project's current traffic/compute needs (sub-second request times, low-to-moderate visitor volume at launch) | Pro plan ($20/mo/member) only becomes relevant if traffic, team size, or the extended-duration/large-function features are ever actually needed | Usage-based if traffic grows well beyond an early-stage launch — no evidence that's imminent |
| **Data refresh (GitHub Actions)** | $0 — unlimited minutes on a public repo | — | Remains $0 regardless of scale, since it's not traffic-driven |
| **Dataset storage (Cloudflare R2)** | $0 — 10GB free storage comfortably covers today's ~238MB and the ~500MB–1GB projected at 8–12 municipalities, plus free egress | — | Storage cost only becomes real well beyond the free 10GB tier; egress stays free regardless of traffic (R2's core differentiator) |
| **Domain/DNS (Cloudflare, already in place)** | Whatever `getdropin.ca`'s registration already costs — unrelated to this phase's decisions | — | Unchanged |
| **Monitoring/notification** | $0 — GitHub Actions' built-in failure email | — | Revisit only if evidence emerges that email isn't sufficient |

**Total required initial cost: $0/month**, aside from the domain registration DropIn already carries independent of this phase. No paid infrastructure is required to launch.

---

## 8. Recommendation

```
Application:
  Vercel (Hobby plan) — first-party Next.js 16 support, native Proxy/Middleware
  support for the /design block, native GitHub auto-deploy, native custom
  domain + HTTPS.

Daily refresh:
  GitHub Actions scheduled workflow (public repo → free, unlimited minutes),
  running the existing `npm run refresh:data -- --all --json` CLI unchanged,
  on a cadence consistent with Phase 3.3B's reasoning (6h recommended, 24h
  floor) — re-affirmed, not re-litigated, this phase.

Dataset publication:
  Cloudflare R2 (new SnapshotStorage implementation, using the interface
  already built in Phase 3.3B). Refresh job writes canonical snapshots (per
  municipality, plus one combined "all sessions" object) to R2. The running
  app reads from R2 instead of local disk — fully decoupled from both the
  hosting provider and from deployment cadence; a data refresh no longer
  requires a redeploy.

Failure handling:
  Unchanged — the existing validate → count-collapse-check → atomic-activate
  pipeline (§5) already provides everything the task asked for. Ported to
  R2 via the existing SnapshotStorage seam, not rebuilt.

Notification:
  GitHub Actions' built-in failure email — zero new infrastructure.

Domain/DNS:
  Unchanged — getdropin.ca stays on Cloudflare for DNS/email routing;
  only application hosting moves to Vercel. Connected only in Phase 5B,
  and only after the rest of this architecture is verified working on
  Vercel's own default subdomain first.

Preview/staging:
  Vercel's native per-branch/PR preview deployments (automatic, unique
  HTTPS URLs, zero extra infrastructure) — evaluated as a first-class
  requirement, not an afterthought, specifically because DropIn's
  application has no write path at all (confirmed in the security audit),
  making "preview reads the same production R2 data as production" safe
  by construction for the common case. A new municipality/source gets a
  distinct, opt-in R2 `staging/` prefix plus one branch-scoped Preview
  environment variable (a native Vercel feature, confirmed live) when it
  specifically needs isolated review before production activation. Full
  design, including the local → preview/staging → production activation
  sequence for new data sources: §14.
```

---

## 9. Rejected Alternatives and Why

- **Cloudflare Workers/Pages as the application host** — rejected specifically because Cloudflare's own current documentation (fetched live this phase) labels its Next.js 16 deployment path **beta**, a real, verified compatibility risk for a solo-maintained production launch, against Vercel's first-party stable support for the identical framework version. Revisit if/when that path reaches general availability and there's a concrete reason to prefer it (e.g., DNS/hosting consolidation, which was the one genuine advantage found).
- **A persistent server/VPS (Phase 3.3B's original Model A recommendation)** — not rejected on technical grounds (it would still work, unchanged, with zero rework of the local-filesystem storage layer), but not what this phase's evaluation criteria favor: the task explicitly asked to evaluate Vercel/Cloudflare, and the goal of not depending on "a machine being online" is better satisfied by a fully managed serverless platform (no OS patching, no server-uptime monitoring, no SSH access to maintain) than by a small always-on VPS, which is itself still "a machine that needs to stay online," just one the developer would now be responsible for instead of their own Mac.
- **Committing canonical data to git and redeploying on refresh** — rejected on concrete, measured evidence (§4): ~41MB of daily-changing JSON in a public repo's history is a real, quantifiable bloat problem, not a hypothetical one, at today's actual scale.
- **Vercel Blob instead of R2** — not wrong, but R2's zero-egress-fee model is a better structural fit for "every visitor fetches the full dataset," and keeping the data layer on a different provider than the hosting layer avoids compounding lock-in onto a single vendor, consistent with Phase 3.3B's own stated preference.
- **A dedicated monitoring/alerting platform** — rejected as unjustified infrastructure for a project with no evidence yet that a free failure email is insufficient (§6).
- **A database for canonical data** — not re-evaluated in depth this phase because nothing has changed that would revisit Phase 3.3B's own correct conclusion: this is "read the latest JSON blob," not a complex-query problem, and a database would be overkill regardless of hosting choice.

---

## 10. Exact Phase 5B Implementation Sequence

Ordered; each step names who does it.

1. **[Project owner]** Create a Cloudflare R2 bucket for DropIn's snapshot data (new, separate from the existing DNS/email Cloudflare account usage — same account is fine, this is just a different product within it). Generate R2 API credentials (access key ID + secret) scoped to that bucket only.
2. **[Claude Code]** Implement a new `SnapshotStorage` class (e.g. `R2SnapshotStorage`) in `lib/dropin/snapshot/io.ts`, implementing the existing interface against R2's S3-compatible API. Convert `readJsonIfExists`/`writeSnapshotAtomic` call sites to `await` (mechanical change — every call site is already inside an `async` function).
3. **[Claude Code]** Add the combined "all sessions" object write (§4) to `refreshOneSource`'s successful-activation path, and change `app/api/sessions/route.ts` to redirect to that object's current R2 URL instead of reading+returning JSON directly.
4. **[Project owner + Claude Code, decision needed first — see §11]** Resolve the end-of-day/`hasEnded` filtering trade-off (§4) — most likely by moving that filter to the client in `app/page.tsx`, which already has `now` and the full dataset in memory.
5. **[Claude Code]** Verify locally: `tsc`, lint, `next build`, and a local end-to-end refresh-then-serve test against R2 (using the project owner's real R2 credentials, provided as local environment variables, never committed).
6. **[Project owner]** Create a Vercel account/project, connect it to the GitHub repository (`qw-1YG3/dropin`), authorize Vercel's GitHub App. Do not connect `getdropin.ca` yet — verify on Vercel's default `*.vercel.app` subdomain first.
7. **[Project owner]** Add the R2 credentials (from step 1) as Vercel environment variables (production scope), so the deployed app can read from R2 at request time.
8. **[Claude Code]** Confirm the deployed Vercel app serves correctly: `/`, `/api/sessions` (now a redirect), and `/design/*` (must still 404 in production — re-run the same verification performed in the security audit, against the real Vercel deployment this time).
9. **[Project owner]** Add `REFRESH_R2_*` credentials as GitHub Actions encrypted repository secrets (same R2 credentials from step 1, or a second, write-scoped key pair if the project owner wants read/write credential separation — a reasonable optional hardening, not required).
10. **[Claude Code]** Write the GitHub Actions workflow YAML (`.github/workflows/refresh-data.yml`): scheduled trigger (cron, cadence per §2/Phase 3.3B's existing recommendation), runs `npm ci` (including devDependencies, for `tsx`) then `npm run refresh:data -- --all --json`, using the secrets from step 9.
11. **[Project owner]** Manually trigger the new workflow once (`workflow_dispatch`) to confirm it runs end-to-end against real R2 credentials, and confirm the live Vercel deployment picks up the new data without a redeploy.
12. **[Project owner]** Deliberately break the workflow once (e.g. a temporarily-wrong secret) to confirm GitHub's failure-email notification actually arrives — the same "prove it, don't assume it" verification standard used throughout the security audit.
13. **[Project owner, only after 6–12 are all confirmed working]** Connect `getdropin.ca` to the Vercel project (DNS record change on Cloudflare, pointing at Vercel — DNS stays on Cloudflare, only the record target changes).

**Explicitly not part of this sequence, per this phase's own instruction**: no deployment happens before step 6; no domain connection happens before step 13; the scheduler is not implemented until step 10, after the storage layer it depends on (steps 1–5) is verified working.

---

## 11. Municipality Expansion Readiness

Audited fresh this phase by reading the actual matching/config code, not inferred from file names. No refactoring was performed — findings only, classified A/B/C as requested.

### A — Already extensible (no concern)

- **Activity/category matching is genuinely data-driven, not hardcoded.** Traced `lib/dropin/search-intent.ts`'s `matchActivity()`: it unions `ACTIVITY_GROUPS` (a curated, Toronto-worded convenience taxonomy) with a generic substring/prefix scan against `knownActivityNames` — which is itself computed live, per-request, as `Array.from(new Set(sessions.map(s => s.activity)))` (confirmed at `search-intent.ts:139`). A new municipality's real activity vocabulary (verified via the code's own comment describing exactly this case for Markham's real "Drop-In Lane Swim" title) becomes searchable automatically, with zero code change, the moment its sessions exist in the dataset. `ACTIVITY_GROUPS` is explicitly documented in its own source comment as "a Toronto-vocabulary convenience, not a source of truth every municipality must populate."
- **The canonical `Session` schema already accommodates per-source evidence gaps cleanly, not by leaking source-specific concepts.** `RegistrationStatus` and `AttendanceRequirement` (`lib/dropin/types.ts`) are real, source-backed concepts (PerfectMind currently, none other) — but every field is optional/`undefined`-safe by design, with source comments explicitly stating `undefined` means "no evidence for this source," never a guessed default. A new municipality's adapter can simply leave these fields undefined exactly as ActiveCommunities already does; nothing needs redesigning.
- **Municipality-name string comparisons in actual logic (not comments) are minimal and mostly generic.** Only two real occurrences exist in the whole codebase: `search-intent.ts:194` (`session.municipality === location.label`, a fully generic comparison against whatever municipality name was matched — works for any municipality) and one narrow, scoped exception (next finding).
- **The source-family adapter pattern itself is the intended, working extension point.** Adding a *new tenant of an already-integrated platform* (e.g., a hypothetical new PerfectMind or ActiveCommunities municipality) is genuinely "add one config entry" — `PERFECTMIND_MUNICIPALITIES`/`ACTIVE_COMMUNITIES_MUNICIPALITIES` (`lib/dropin/sources/{perfectmind,activecommunities}/config.ts`) are real arrays of per-tenant config (host, widget/calendar IDs), and `scripts/refresh/{perfectmind,activecommunities}.ts` already iterate them generically. This matches the task's own preferred pattern (source adapter → normalize → validate → canonical → existing search/presentation) and is already how Vaughan/Markham/Newmarket (PerfectMind) and Mississauga/Richmond Hill/Aurora (ActiveCommunities) were each added.

### B — Small future cleanup (real, but not urgent, not a launch blocker)

- **Municipality names are hardcoded as a literal array in (at least) four separate places, requiring manual, unenforced synchronization**: `lib/dropin/sources/index.ts`'s `MUNICIPALITY_SLUGS` (the app's actual **read path** — this is the riskiest one, see below), `scripts/snapshot-health.ts`'s `MUNICIPALITIES`, `scripts/refresh/facility-locations.ts`'s `MUNICIPALITIES`, and `lib/dropin/municipalities.ts`'s `MUNICIPALITIES` (the search-facing "available"/"not-yet-available" registry — already thoughtfully pre-populated with real target municipalities like Brampton/Oakville/Burlington as "not-yet-available", a genuinely good design for honest search responses, but still a list needing a manual status flip). **The read-path list (`MUNICIPALITY_SLUGS`) is the one worth prioritizing**: forgetting to add a new municipality there is a **silent failure** — the refresh job would succeed and write real canonical data to storage, but `getAllSessions()` would simply never look for it, with no error anywhere. A fix already has working precedent elsewhere in the same codebase: `scripts/refresh/index.ts`'s CLI arg validation already derives its own municipality list generically from `["toronto", ...ACTIVE_COMMUNITIES_MUNICIPALITIES.map(...), ...PERFECTMIND_MUNICIPALITIES.map(...)]` — the same pattern could replace the hardcoded `MUNICIPALITY_SLUGS` array with a derived one. **Not implemented this phase**, per the task's explicit instruction not to refactor unless required for Phase 5 — but flagged as the single most worthwhile item to fix soon, specifically because of its silent-failure characteristic.
- **One narrow, genuinely municipality-specific special case exists in shared enrichment logic**: `lib/dropin/facility-locations.ts:94`, `if (municipality === "Richmond Hill" && centre.includes(" - ")) {` — a real, if small, example of a municipality-specific quirk handled inline in shared code rather than isolated per-source. Doesn't block adding new municipalities (a new one simply never triggers this branch), but is exactly the kind of ad-hoc special case worth watching for accumulation as more municipalities are added.
- **`lib/dropin/activities.ts`'s `SUPPORTED_COURSE_TITLES` export is defined but never consumed anywhere** (confirmed via a repo-wide reference search — it appears only in its own definition line). Its own comment describes an intended filtering use ("used to filter the raw dataset down to what DropIn's taxonomy actually recognizes") that isn't actually wired up — harmless dead code today, but worth removing or actually wiring up during any future taxonomy work, so the comment doesn't mislead a future reader about what's actually enforced.

### C — Meaningful architectural bottleneck

**None found.** The one candidate that looked initially concerning — whether the activity taxonomy hard-filters non-Toronto vocabulary — was investigated and disproven by reading the actual matching code (see the "Already extensible" findings above); it was a reasonable hypothesis to check, not a real bottleneck.

### Concretely, adding a new municipality on an already-integrated platform (e.g., Brampton, if confirmed as a PerfectMind tenant) today:

1. **[Required]** Add one config entry to `PERFECTMIND_MUNICIPALITIES` (host, widget ID, calendar IDs) — the real integration work, proportional to any new data source regardless of architecture.
2. **[Required, silent-failure risk if missed]** Add the slug to `MUNICIPALITY_SLUGS` in `lib/dropin/sources/index.ts`.
3. **[Required for honest search]** Flip Brampton's `status` from `"not-yet-available"` to `"available"` in `lib/dropin/municipalities.ts` (already listed there).
4. **[Recommended, non-critical]** Add it to the two tooling-only `MUNICIPALITIES` lists (`snapshot-health.ts`, `facility-locations.ts`) for full health-check/enrichment coverage — a graceful-degradation miss if skipped, not a hard failure.

No changes to search, presentation, the canonical schema, or the Phase 5A hosting/refresh/storage architecture are required — this is what "primarily a data-source extension" looks like in practice today, modulo the B-level cleanup above.

---

## 12. Future Product Feature Infrastructure Readiness

Evaluated against the Phase 5A architecture recommended above (§8) — not implemented, evaluated only.

| Future feature | Blocked by this architecture? | Why |
|---|---|---|
| **Additional municipalities** (beyond the 8–12 range Phase 3.3B already sized) | No | R2's free tier alone (10GB) covers roughly 25–40x today's actual data volume; GitHub Actions' refresh-time headroom and Vercel's free-tier compute both scale with "one more concurrent HTTP fetch," not a structural limit. §11 above covers the (non-architectural) code-level extension points. |
| **Additional recreation categories** | No | `Session.category`/`.activity` are already free-text fields; the taxonomy layer (§11) is a search-convenience layer on top of real data, not a hard schema constraint. |
| **Improved location intelligence** | No | Coordinates are already optional `Session` fields; the facility-locations registry is already its own small, independently-refreshed, git-tracked dataset, unrelated to the hosting/refresh architecture decided in this phase. |
| **Future Map View** | No, at foreseeable scale | Reaffirms Phase 3.3B's own finding: in-memory Haversine distance computation over an already-loaded session array needs no spatial database. If a future Map View specifically needed viewport/tile-based spatial queries at a scale where in-memory filtering stops being fast enough, that would justify a real database at that time — not evidenced now, and this phase's architecture doesn't foreclose adding one later (R2/Vercel don't preclude also adding a database if a genuine query-complexity need ever emerges). |
| **Richer freshness/status information surfaced in the product UI** (today: only in `snapshot:health`, an operator-facing CLI) | No, small addition needed | `classifyFreshness`'s FRESH/AGING/STALE/UNAVAILABLE logic reads snapshot `metadata.fetchedAt` — already present in every canonical snapshot object, including the ones the Phase 5B storage migration writes to R2. Surfacing this in the product (e.g., a per-municipality freshness badge) would mean the app reading that same metadata at request time — a small, additive change to `/api/sessions` or a new small endpoint, not an architecture change. |
| **Future lightweight analytics** | No | Confirmed zero analytics exist today (security audit). Vercel offers an opt-in, privacy-respecting analytics add-on that would require no architecture change to adopt — noted as a natural fit if ever wanted, **not recommended or implemented this phase** (explicitly out of scope, and previously explicitly deferred). |
| **Support DropIn** (backlog-only, per prior phases) | No | A payment flow (e.g., a hosted checkout redirect) needs no persistent backend state DropIn would have to build or store itself — Vercel/serverless hosting doesn't preclude it. Reaffirming prior guidance, not revisited here: this needs its own fresh security/trust review at build time, specifically because it's a categorically different trust surface (handling money) — not something this infrastructure phase resolves or should scope-creep into. |

**No architecture decision in this phase blocks any of the above.** The recommended Vercel + GitHub Actions + R2 architecture was sized and chosen with headroom for the concretely-foreseeable growth path (§11, Phase 3.3B's own 8–12 municipality projection), not narrowly for today's 7.

---

## 13. Data Lifecycle / Retention

**Investigated fresh this phase**, by reading the actual fetch/filter code, not assumed.

**O. Current expired-data behavior:**

- **What happens to an activity after its date/time passes:** it is excluded from what `/api/sessions` returns via `applyReadTimeView`'s `hasEnded(new Date(s.endDateTime), now)` check (`lib/dropin/sources/index.ts`) — evaluated fresh against live `now` on every single request, not baked into the snapshot. This is real-time filtering, not deletion.
- **Whether expired activities remain in canonical/generated datasets:** yes, for a bounded window — between the moment a session ends and the next refresh cycle that re-derives a snapshot without it. This window is bounded by the refresh cadence (Phase 3.3B's 6h recommendation / 24h floor, reaffirmed in §2), not unbounded.
- **Whether they're merely hidden by presentation logic, or actually removed:** hidden at *read* time (server-side, in `getAllSessions`), not removed from the stored snapshot file, until the *next refresh* naturally supersedes them.
- **Why canonical data doesn't accumulate past sessions indefinitely — verified, not assumed:** every currently-integrated source is inherently forward-looking by construction. PerfectMind's fetch client is explicitly parameterized by a `startDateIso`, paging forward from the request time (confirmed in `lib/dropin/sources/perfectmind/client.ts`) — it never requests or receives historical data. ActiveCommunities exposes a stated forward `horizon` (`SourceFreshness.horizon`, a `{startDate, endDate}` window, confirmed in `lib/dropin/snapshot/types.ts` and surfaced in `snapshot:health`'s real output). This means a session that has passed simply stops being returned by the source on the *next* refresh — canonical data ages out **because the upstream source itself is forward-only**, not because DropIn runs any active deletion/cleanup logic. No such logic currently exists, and — per the analysis above — none is actually needed for this specific concern.
- **Whether raw/source/generated data grows indefinitely:** no. Every snapshot layer (raw, canonical, facility-locations) uses the same 2-slot (`latest`+`previous`) retention, confirmed in `lib/dropin/snapshot/paths.ts`/`io.ts` — each refresh *overwrites* (with one-generation rollback via the `previous` slot), never appends or accumulates.
- **Whether stale municipality snapshots accumulate:** no, for the same reason — a municipality's `latest.json`/`previous.json` are the only files that ever exist for it; there is no numbered or timestamped history file being added to over time.
- **Whether repository size will grow continuously under daily refresh:** not under the architecture recommended in §4/§8 — canonical/raw data moves to R2, never touching git. This *would* be a real, continuous-growth problem under the rejected git-commit-publication alternative (§4, §9) — already quantified there (~41MB/day) and already the reason it was rejected.
- **Whether Git history would become unnecessarily large if generated datasets were committed daily:** yes, confirmed and quantified in §4 — this is exactly why that approach isn't the recommendation.

**P. Recommended data lifecycle / retention policy**, distinguishing the four categories requested:

| Category | What it is for DropIn today | Retain? | For how long | Where |
|---|---|---|---|---|
| **1. Active production data** | The current `latest.json` canonical snapshot per municipality (plus the combined all-sessions object, §4) | Yes — this is what the app serves | Indefinitely, as "whatever the last successful refresh produced" — it's continuously replaced, not aged out on a timer | R2 (per the Phase 5A storage recommendation) |
| **2. Previous known-good data** | The `previous.json` slot at each layer | Yes | Exactly one generation (the existing 2-slot policy) — already correct, already sufficient for the task's own stated safety model (a failed refresh must never destroy the last good dataset, and it doesn't, because a failed refresh never calls `writeSnapshotAtomic` at all) | R2, same bucket, same key pattern already designed in Phase 3.3B (§8 of that document) and carried into §4 here |
| **3. Operational/debug snapshots** | The `raw/<slug>/{latest,previous}.json` layer — real upstream API responses, kept for debugging a normalization failure, never read by the running app | Yes, but only the existing 2-slot amount | Same 2-slot policy — no evidence more is needed; Phase 3.3B already reasoned through this (§15 of that document) and nothing has changed to revisit it | R2, same bucket, distinct key prefix from canonical (already the existing `raw/` vs. `canonical/` separation) |
| **4. Long-term historical data** | Would mean: every past session, forever, or a dated archive of old snapshots | **No current product need identified.** DropIn is a "what's happening now/soon" discovery tool — nothing in the product (search, results, Map View plans, freshness display) reads or benefits from what a session looked like a month ago. **Do not build this merely because it would be easy to bolt onto object storage.** | N/A | N/A — explicitly not recommended |

**Cleanup timing — should it happen during refresh or separately?** **During refresh, as already implemented** — the existing `writeSnapshotAtomic()` rotation (copy current → `previous`, then atomically activate the new file) *is* the cleanup mechanism; there's no separate accumulating history to periodically sweep, so no separate cleanup job is needed or recommended. This directly satisfies the task's own desired safety model (fetch → normalize → validate → confirm → publish/replace → clean obsolete data) — "clean obsolete data" here means exactly "the atomic rotation already retires the 2-generations-ago file the moment a new one is confirmed good," which is what already happens.

**Should Git be used as long-term data storage? No** — reaffirming §4/§9 directly: Git remains correct for what it already handles (source code, and the two small, infrequently-changing datasets — facility-locations and the Toronto static fallback), and wrong for the large, daily-changing canonical/raw data, for the same measured repo-bloat reason already established. This applies with equal force to a hypothetical "long-term historical archive" — if that were ever wanted (it isn't, per category 4 above), it would belong in R2 (as dated, separately-keyed objects) or nowhere, never in git.

**Q. Repository/data-growth risk, restated plainly:** near-zero, under the recommended architecture. Git only ever holds source code plus two small, slow-changing datasets (currently ~4.5MB combined for `toronto-open-data` + `facility-locations`). The large, fast-changing data lives entirely in R2 under a fixed 2-slot-per-layer policy that doesn't grow with time, only with municipality count (§11's headroom analysis already covers that). The one way this risk becomes real is the already-rejected git-commit-publication alternative — not the recommended path.

---

## 14. Preview / Staging Deployment Strategy

Evaluated against Vercel specifically (§3's recommendation), since preview-deployment capability is a first-class requirement for this decision, not an afterthought bolted on after the fact.

### What Vercel provides natively — verified live, not assumed

Fetched Vercel's current environment-variables documentation this phase (dated 2026-06-16) to confirm the specifics this design depends on, rather than relying on general familiarity with the platform:

- **Automatic preview deployments from Git branches/PRs**: confirmed — "Preview Deployments are created when you push to a branch that is not the Production Branch." With the GitHub integration already assumed in §3/§10, this requires zero extra configuration — every branch and PR gets one automatically.
- **Unique HTTPS preview URLs**: every deployment (preview or production) gets its own real, valid-HTTPS `*.vercel.app` URL — genuinely reachable from any device, including a physical phone on cellular data, not just localhost-adjacent tooling.
- **Rollback**: unchanged from §3 — any previous deployment (production or preview) can be promoted to production directly, a mature, one-click Vercel feature.
- **Production vs. preview environment separation**: native — Vercel's own `Environment` concept (Production / Preview / Development) is a first-class part of the platform, not something this architecture needs to build.
- **Environment variables scoped by environment — including per-branch overrides**: confirmed live — a variable can be scoped to Production, to all Preview deployments, **or to one specific branch**, and "any branch-specific variables will override other preview environment variables with the same name." This one fact is what makes the new-municipality-testing design below possible without any new infrastructure.

### Why this is simpler for DropIn than a "generic" staging setup

Most apps need a genuinely separate staging *dataset* because their application can **write** to shared state (a database, user records, bookings), and a preview build hitting production write-paths would be actively dangerous. **DropIn's application has no write path at all** — confirmed repeatedly across this session (the security audit found exactly one API route, `/api/sessions`, taking zero input and performing zero mutation; every data *write* happens exclusively in the refresh job, a completely separate process from the running Next.js app, triggered by GitHub Actions, never by a user request or a Vercel deployment). This means **a preview deployment reading the exact same production R2 data as production is safe by construction, not by careful scoping** — there is no mutation path to guard against in the first place. This single architectural fact is what keeps the preview strategy below simple rather than requiring a parallel staging dataset for every ordinary change.

### Recommended workflow

**For the common case — UI, feature, and product-experiment changes (the large majority of work):**

1. Develop and review locally (`npm run dev`) — unchanged, today's existing workflow.
2. Push to a branch / open a PR. Vercel automatically builds a preview deployment with its own unique HTTPS URL — no manual step.
3. The preview deployment reads canonical data from **the same production R2 objects** production reads (the R2 read credentials are scoped to apply to both Production and Preview environments — one checkbox in Vercel's environment-variable UI). This is safe (see above) and gives reviewers realistic, real data to evaluate the actual change against — more useful than synthetic/stale staging data would be.
4. Review on desktop and on a real physical phone, using the real preview URL — both trivially possible since it's a genuine public HTTPS endpoint, not localhost.
5. Merge to `main` → Vercel automatically promotes to production. Production remains completely untouched by every preceding step until this deliberate merge.

**For the specific case this phase called out — testing a new municipality/source before it's approved for production:**

1. **Local verification** (unchanged from today): run `npm run refresh:data -- --municipality=<new>` locally, inspect the resulting canonical JSON, run `npm run snapshot:health`, verify with `npm run dev` against the local filesystem — exactly today's existing, already-proven workflow, no new tooling.
2. **Preview/staging verification** (new, and the actual point of this section): once the new municipality's data looks right locally, upload that same locally-verified canonical snapshot to a **separate R2 key prefix** — e.g. `staging/canonical/<slug>/latest.json`, alongside the existing `raw/`/`canonical/` prefixes already designed in §4 — using the exact same `SnapshotStorage`/`writeSnapshotAtomic` mechanism already being built for R2, just pointed at a different key. No new write mechanism, only a different destination for one that already exists. Then add **one branch-specific Preview environment variable** on that feature branch (confirmed supported live, above) telling the app's read path to check the `staging/` prefix for that municipality, falling back to `production/` for everything else. Open that branch's PR; its unique preview URL now shows the new municipality's real data blended into an otherwise-normal DropIn experience — reviewable on desktop and phone — while every *other* preview deployment, and production itself, is completely unaffected (they never read the `staging/` prefix at all).
3. **Production activation**: once approved, "promotion" is simply re-running the refresh (or a small copy step) targeting the `production/` prefix instead of `staging/` — the same mechanism, same validation/atomicity gates (§5) that already exist. From that point on, the new municipality is just one more entry in `PERFECTMIND_MUNICIPALITIES`/`ACTIVE_COMMUNITIES_MUNICIPALITIES` and the routine daily GitHub Actions refresh (§2) takes over automatically — no special-casing survives past this one-time activation step. The branch-specific preview env var from step 2 is deleted once the branch merges; nothing about it persists into production configuration.

**A preview deployment never automatically overwrites the live production canonical dataset, under either path** — the common-case path never writes anything (the app has no write capability regardless of environment), and the new-municipality path writes only to a distinctly-named `staging/` prefix that production never reads, made visible to a specific preview deployment only via an explicit, deliberate, branch-scoped environment variable that has to be added on purpose.

### What this deliberately does not build

No separate staging *application deployment* running continuously (Vercel's automatic per-branch preview deployments already provide this, ephemerally, exactly when needed — a standing "staging environment" would just be an idle deployment costing nothing extra but adding a URL to keep track of, for zero real benefit over per-branch previews). No staging database. No environment-promotion pipeline tooling beyond what's described above. No new roles/permissions system for who can "approve" a promotion — that's a process/discipline question (e.g., requiring a PR review before merge to `main`), not an infrastructure one, and is left to however the project owner already works, not decided here.

---

## 15. Launch Observability Strategy — Cross-Reference

**Documentation only, recorded in full in `docs/LAUNCH_READINESS_PLAN.md` §11–§12 — not duplicated here, since it's fundamentally a Privacy-adjacent decision and belongs with that document's other Privacy commitments (§3.C already anticipated it).** Recorded briefly here too because it's the final Phase 5A decision before Phase 5B, and because its "Launch v1" candidate — Cloudflare Web Analytics — sits directly on top of the hosting stack this document already decided (Cloudflare is already in this architecture for DNS/email routing and R2 object storage, §3/§4/§9).

**Summary of the decision** (full detail, including the binding Privacy-update procedure, in `docs/LAUNCH_READINESS_PLAN.md` §11): Cloudflare Web Analytics is the preferred launch-v1 option for lightweight, aggregate basic web analytics (visits, traffic trends, device/browser, referrers, geographic aggregates, Core Web Vitals) — **not implemented now**, subject to fresh verification against Cloudflare's real current documentation and DropIn's real network behavior at actual implementation time, consistent with every other externally-verified claim in this document (§3's Cloudflare-beta finding, §3's Vercel response-size limit — all fetched live, none assumed). Detailed product/behavioral analytics remain explicitly out of launch scope, deferred to their own dedicated future design phase (`docs/LAUNCH_READINESS_PLAN.md` §12).

**Why this doesn't change anything already decided in §1–§14**: basic web analytics (if/when enabled) is a client-side script + a Cloudflare-side aggregation service, entirely orthogonal to the application hosting (§3), refresh pipeline (§2), dataset storage (§4), or preview/staging strategy (§14) — it reads/writes none of DropIn's own data and requires no change to any of those decisions. It's recorded here for completeness, not because it alters the architecture.

**No analytics is enabled by this entry, and no Privacy copy was changed** — see `docs/LAUNCH_READINESS_PLAN.md` §11 for the full, binding requirement that governs whenever this actually gets implemented.

---

## Final Report

**A. Current data pipeline:** Fully mapped in §1 — municipal source → per-source-family fetch/normalize scripts → shared validate+enrich+atomic-write orchestration (`refreshOneSource`) → local-filesystem canonical snapshots → request-time read (`getAllSessions`) → `/api/sessions` → client. Git is currently the publication mechanism for two small, infrequent datasets (facility-locations, Toronto fallback) but explicitly not for the large, daily raw/canonical data — a distinction, not an oversight.

**B. Hosting recommendation:** Vercel, primarily because Cloudflare's current Next.js 16 support is live-confirmed **beta** today, against Vercel's first-party stable support for the same framework version.

**C. Daily refresh recommendation:** GitHub Actions scheduled workflow (free, unlimited on this confirmed-public repo), running the existing, unmodified refresh CLI — promoted from Phase 3.3B's "fallback" role to primary, as a direct consequence of moving off a persistent-server hosting model.

**D. Dataset publication model:** Cloudflare R2 object storage, via a new implementation of the `SnapshotStorage` interface Phase 3.3B already built for this purpose — required because Vercel's serverless functions have no persistent shared filesystem, and because committing ~41MB of daily-changing JSON to a public repo's git history is a real, measured bloat problem at today's scale.

**E. Failure/rollback model:** No changes needed — validation, count-collapse protection, atomic activation, and per-municipality failure isolation already exist and are already correct (§5); they carry over unchanged onto the new storage backend via the existing interface seam.

**F. Failure notification recommendation:** GitHub Actions' built-in failure email — free, zero new infrastructure, already wired to the refresh CLI's existing non-zero exit code on failure.

**G. Required secrets:** R2 access credentials (as Vercel environment variables, for the app's reads; as GitHub Actions encrypted secrets, for the refresh job's writes). Nothing else — no currently-integrated municipal source requires any credential.

**H. Expected initial cost:** $0/month required (Vercel Hobby, GitHub Actions on a public repo, R2's free 10GB/zero-egress tier all comfortably cover today's real, measured scale), aside from the domain registration DropIn already carries.

**I. Why this architecture is preferable for DropIn:** it satisfies the explicit goal (no dependency on the developer's own machine), keeps every piece on a free tier at today's real measured scale, reuses everything Phase 3.3B already built and verified (validation, atomicity, isolation, the storage-interface seam) rather than rebuilding it, and is grounded in live-verified current facts (Cloudflare's beta status, Vercel's exact response-size limit) rather than assumptions about either platform.

**J. Rejected alternatives and why:** detailed in full in §9 — Cloudflare hosting (beta risk), a persistent VPS (still "a machine to keep online," just not the developer's), git-commit-based publication (measured repo-bloat problem), Vercel Blob (R2's zero-egress model is a better fit for this access pattern), a monitoring platform and a database (both unjustified by any evidence of need).

**K. Exact Phase 5B implementation sequence:** §10, 13 steps, each attributed to Claude Code or the project owner, ending with domain connection only after every prior step is independently verified working.

**L. Unresolved decision requiring project-owner input:** the end-of-day/`hasEnded` filtering trade-off introduced by the recommended `/api/sessions` → R2 redirect (§4). The current server-side filter (excluding already-ended sessions, computing the `day` label fresh per request) would need to move to the client to preserve today's exact behavior under the redirect design. This is a real, if small, architectural shift — not something to decide unilaterally in an architecture-only phase. The project owner should confirm this approach (or propose an alternative, e.g. accepting a small amount of server-side filtering logic that returns a still-large-but-somewhat-smaller payload and separately verifying empirically whether Vercel's compression makes the 4.5MB limit a non-issue in practice) before Phase 5B implements it.

**M. Municipality expansion readiness:** Good, with one worthwhile-but-non-blocking cleanup identified. Activity/category matching is already fully data-driven (verified by reading the actual matching code, not assumed) and the canonical schema already handles per-source evidence gaps cleanly — both classified **A, already extensible**. Municipality names are hardcoded across four separate lists requiring manual sync, one of which (`MUNICIPALITY_SLUGS`, the app's actual read path) has a real silent-failure risk if forgotten when adding a municipality — classified **B, small future cleanup**, with a working fix pattern already precedented elsewhere in the same codebase. **No C-level (meaningful architectural bottleneck) findings** — the one hypothesis that looked concerning going in (a Toronto-vocabulary taxonomy silently excluding other municipalities' differently-worded activities) was investigated and disproven. Full detail and the concrete "what adding Brampton actually requires today" walkthrough: §11.

**N. Future feature infrastructure readiness:** No feature on the requested list (additional municipalities, categories, location intelligence, Map View, richer freshness display, lightweight analytics, Support DropIn) is blocked by the architecture recommended in this phase. Each was evaluated individually against what §8 actually proposes, not assumed compatible — table in §12. None of these are implemented or scoped for building; this is a headroom check only.

**O. Current expired-data behavior:** Expired sessions are excluded from `/api/sessions` by real-time, per-request filtering (`hasEnded` against live `now`), not deleted from storage — they remain in the canonical snapshot for a bounded window until the next refresh naturally supersedes them. Confirmed, not assumed: every currently-integrated source is inherently forward-looking (PerfectMind pages forward from a `startDateIso`; ActiveCommunities exposes a stated forward `horizon`), so canonical data ages out because the upstream sources themselves never return past sessions — no active deletion logic exists or is needed for this. Full detail: §13.

**P. Recommended data lifecycle / retention policy:** Keep the existing 2-slot (`latest`+`previous`) retention for active production data, previous known-good data, and raw operational/debug snapshots — already correct, already sufficient, ported unchanged onto R2. **No long-term historical archive is recommended** — no current product need was identified, and building one merely because object storage would make it easy is explicitly not recommended. Cleanup already happens *during* refresh, as a property of the existing atomic-rotation write, not as a separate job. Git should never be used for this data, at any retention tier. Full detail and the four-category breakdown requested: §13.

**Q. Repository/data-growth risk:** Near-zero under the recommended architecture — git only ever holds source code plus two small, slow-changing datasets (~4.5MB combined today); the large, fast-changing data lives entirely in R2 under a fixed-size-per-layer policy that scales with municipality count (already sized with headroom, §11/§12), not with time. The real growth risk lives entirely in the already-rejected git-commit-publication alternative, not the recommended path.

**R. Architecture decisions worth locking in now to avoid a later migration:** two, both small. First, write per-municipality objects to R2 in the Phase 5B storage migration (not only the combined all-sessions object) — already the plan in §4, reaffirmed here as worth keeping deliberately, since it's what future per-municipality health/status display (§12) and any future "refresh just one municipality" tooling would need, and costs nothing extra to do from the start. Second, treat "Git is never long-term storage for generated data" as a settled principle before Phase 5B, not a case-by-case judgment call each time it comes up — retrofitting this later (if convenience ever tempted a one-off git-commit of generated data) would risk repeating the exact kind of history-cleanup problem the security audit's P1-2 remediation just dealt with. Nothing else rises to "decide now or pay for it later" — the rest of this phase's findings (§11's B-level cleanup, §12's headroom) are real but genuinely deferrable without cost.

Stopping here, as instructed. No deployment, no domain connection, no scheduler implementation was performed.
