# Phase 3.3B — Scheduler & Deployment Refresh Strategy

Architecture and deployment planning — a recommendation to review, not a deployment. Every claim is tagged **VERIFIED** (checked directly against this repository or real running code), **INFERENCE** (a reasoned conclusion without direct proof), **RECOMMENDATION** (a judgment call for review), or **DEFERRED** (explicitly not done, and why).

---

## 1. Current Deployment State

**VERIFIED**, by direct repository inspection:

- **NOT CONFIGURED**: no Vercel, Netlify, Render, Railway, Fly.io, Docker, or hosting-provider configuration exists anywhere in the repo (no `vercel.json`, `netlify.toml`, `Dockerfile`, `fly.toml`, etc.). `README.md`'s "Deploy on Vercel" section is unedited `create-next-app` boilerplate — not evidence of an actual decision, and not treated as one here.
- **NOT CONFIGURED**: no `.github/workflows/` directory — no CI/CD, no scheduled workflow.
- **NOT CONFIGURED**: no cron configuration anywhere in the repo.
- **NOT CONFIGURED**: no environment variables are read anywhere in the application code (`grep`-confirmed) — there is currently no secrets-handling pattern established at all.
- **A genuine exception, real evidence**: this repository **does** have a real, connected GitHub remote (`github.com/qw-1YG3/dropin`) with real commit history — the code's source-control home is real, not hypothetical. This matters directly for §5: GitHub Actions is evaluated as a live option specifically *because* it requires zero new account/service, not because it's the default Next.js-adjacent choice.
- `next.config.ts` sets no `output` mode (no `"standalone"`, no `"export"`) — the project is currently configured for Next's default Node-server behavior, compatible with a persistent server without modification, and generally adaptable to most serverless Next.js hosts by that host's own build step (not something this repo has opted into either way).

**Overall: PARTIALLY CONFIGURED** — real source control, no deployment target, no scheduler, no secrets infrastructure.

## 2. Filesystem Assumptions (Phase 3.3 Snapshot Implementation)

**VERIFIED**, by auditing `lib/dropin/snapshot/paths.ts` and `io.ts`:

- Raw snapshots: `data/raw/<slug>/latest.json` + `previous.json`. Canonical: `data/canonical/<slug>/latest.json` + `previous.json`.
- "Active" snapshot selection has **no indirection** — the filename `latest.json` itself is the only signal; there is no pointer file, no database row, no version table.
- All paths are built from `path.join(process.cwd(), "data", ...)` — resolved relative to the **process's working directory at runtime**, not relative to the source file's own location. This matters: it means correctness depends on whatever directory the Node process happens to be started from, which is consistent and predictable on a normal server/container but is exactly the kind of assumption that can silently break on a platform that runs the app from an unexpected working directory or a read-only deployment bundle.
- **Snapshots must, and do, survive process restart** — this was the explicit point of Phase 3.3, and it was verified directly: killing and restarting the dev server did not lose any data, because the data lives in files on disk, not in the process's memory.
- **The architecture fundamentally assumes a persistent, writable, shared disk** — specifically, that a file written by one process (the refresh CLI) is later readable, unchanged, by a *different* process (the web server) that may start at an arbitrary later time. This assumption is not incidental; it's load-bearing for the entire design.

**How this fares across deployment models (Part 2's explicit ask):**

| Model | Works unchanged? | Why |
|---|---|---|
| A. Persistent Node server | **Yes** | Exactly what was built and verified — refresh CLI and web server share one real, persistent disk. |
| B. Docker/container + persistent volume | **Yes**, with the volume mounted at the app's working directory | Same guarantee as A, as long as the volume — not the container's own ephemeral layer — is where `data/` resolves to. |
| C. Serverless functions | **No, not reliably** | Most serverless runtimes give each invocation an ephemeral (or at best per-instance, not cross-instance) `/tmp`-style filesystem. A refresh job and a later `/api/sessions` invocation are not guaranteed to run on the same instance, or to see each other's writes at all. |
| D. Vercel-style ephemeral filesystem | **No** | Same reasoning as C — Vercel's serverless functions (and the deployed bundle itself) do not offer a writable, persistent, shared filesystem between invocations or between a separate build/refresh step and a running function. |
| E. Static deployment | **No — doesn't apply** | A fully static export has no server-side API route to read snapshots from at all; `/api/sessions` requires a Node/Edge server runtime, which static export doesn't provide. |

This table is the crux of the whole phase: **Phase 3.3's architecture is correct and complete for models A/B, and would need real rework (most plausibly: swap local disk for durable object storage behind the same `SnapshotStorage` interface — see §21) before it could be trusted on C/D.** No such rework was done this phase, deliberately — see §14/§16 for why A/B is the actual recommendation rather than a compromise being routed around.

## 3. Data Durability Requirements

**INFERENCE**, classified by what each layer actually needs:

| | Survive restart? | Survive redeploy? | Survive failed refresh? | Versioned? | Regenerable? | Regeneration cost | App needs read access? |
|---|---|---|---|---|---|---|---|
| Source data (upstream) | N/A — not DropIn's to manage | N/A | N/A | N/A | N/A | N/A | No — never read directly by the app |
| Raw snapshot | Yes | Yes (ideally) | Yes — must not be overwritten by a failed attempt | 2 slots (latest/previous) | Yes, from the source, whenever the source is reachable | ~2–12s per source (measured) | No — debugging/provenance only |
| Canonical snapshot | **Yes — required** | **Yes — required** | **Yes — required, this is the whole point of §6/§9 of Phase 3.3** | 2 slots | Yes, by re-running refresh (which itself depends on raw snapshot or live source) | Same as raw, plus normalization (~1s, cheap) | **Yes — this is the one thing the request path reads** |
| Temporary refresh file (the `.tmp-*` file mid-write) | No — must not, by design | No | No — discarded on any validation failure | No | Trivially, it's mid-computation | N/A | Never — never a valid read target |
| Metadata/health state | Ideally yes, for trend visibility | Ideally yes | Yes | No | Fully — it's derived from the snapshot files themselves | Free (a metadata read is what `snapshot:health` already does) | No — operator-facing only |

**This drives §8 directly**: only the canonical snapshot is a hard, must-have-durable-read-access requirement for the running app. Everything else (raw, metadata) is valuable for debugging/provenance but not on the critical path — which is exactly why a simpler storage choice than "everything needs a database" is defensible.

## 4. Recommended Refresh Cadence

**RECOMMENDATION**, reasoned per source rather than copied from the phase prompt's own example:

| Source | Recommended | Minimum acceptable | Why |
|---|---|---|---|
| **Toronto** | Every 6 hours | Every 24 hours | The live CKAN source itself only updates once daily (~8am, confirmed in Phase 3.0) — refreshing faster than the source updates can't gain freshness, but a single daily window creates a real staleness cliff right before the next real source update. 6h keeps DropIn within 6h of any real change at negligible cost (~2s, no rate limits documented, free public API). 24h (matching the source's own real cadence) is the honest floor below which DropIn is *never* current with a same-day change. |
| **Mississauga** | Every 6 hours | Every 12 hours | Largest catalog (~16,000 sessions) and by far the most expensive single refresh (~11s, plus dozens of extra HTTP calls for the age-eligibility join) against an undocumented internal vendor API, not a published one (Phase 3.1). Freshness value is real (new registrations opening, cancellations) but unproven to change minute-to-minute; 6h balances that against being a considerate, moderate-frequency caller of someone else's infrastructure (Phase 3.0/3.1's "be respectful of external sources" principle). |
| **Richmond Hill** | Every 6 hours | Every 12 hours | Cheapest to refresh (~2–3s, only 258 sessions) and could tolerate a coarser cadence with little real freshness cost given its narrower ~21-day horizon — but there's no strong reason to run it on a *different* schedule from the other two either. Kept aligned with Toronto/Mississauga because one uniform cadence is simpler to operate, monitor, and reason about than three different cron expressions, and the operational simplicity is worth more here than the marginal savings from a slower schedule for the smallest source. |

**Not hourly, deliberately** — none of the three sources have any evidence of sub-hourly-meaningful change, and hourly polling of Mississauga specifically would mean running its expensive age-join pass 24x/day against a third party's internal API for no demonstrated benefit.

## 5. Scheduler Options

**INFERENCE + RECOMMENDATION**, evaluated against DropIn's actual current scale (§1's real evidence: no deployment yet, real GitHub repo, no existing paid infrastructure):

| Option | Setup complexity | Reliability | Secrets | Persistence assumption | Lock-in | Observability | Cost | Fit today |
|---|---|---|---|---|---|---|---|---|
| 1. Hosting-provider cron (e.g. a PaaS's built-in scheduled task) | Low, if the eventual host offers one | High (provider-managed) | Handled by that provider's own env-var UI | None — runs alongside the app on the same disk | Ties the schedule definition to that specific host | Provider's own logs | Usually free/bundled | Good, but depends on picking a host that offers this |
| 2. GitHub Actions scheduled workflow | Low — YAML in a repo that already exists | High, but GitHub's own cron has a documented tendency to run a few minutes late under load — acceptable for a 6h cadence, not for sub-minute needs | Native encrypted repo secrets | **None on its own** — Actions runners are ephemeral VMs with no shared disk with the app | Ties scheduling to GitHub specifically, but GitHub is already the code's home — not a *new* dependency | Built-in run history + free failure-email notifications (directly serves §13) | Free (public repo, or ample free minutes on a private one at this volume) | **Good, real evidence supports it (§1)** |
| 3. OS/server cron | Very low if a persistent server exists at all | High, but silent-failure-prone (no built-in alerting — a broken cron job just stops, quietly) | Plain server env vars, no extra mechanism | Runs directly on the same disk as the app — trivially correct | None — plain Unix cron | None built-in — must be added manually | Free | **Good, simplest of all, but weakest on observability (§12/§13)** |
| 4. External cron hitting a protected HTTP endpoint | Medium — requires building and securing that endpoint (§6) | Depends entirely on the external cron service's own reliability | A shared-secret/bearer token the endpoint must validate | Endpoint runs on the app's own server, so writes land on the app's own disk — fine, *if* the app runs somewhere with persistent disk at all | Whichever external cron service is chosen | Whatever that service offers, usually minimal at free tiers | Often free tier, sometimes a new account/service | Viable, but introduces a new third-party dependency with no evidence one is needed yet |
| 5. Background worker/job runner (a long-lived process with its own internal scheduling, e.g. a queue+worker system) | High | High once built | Whatever the worker's own runtime needs | Needs its own persistent process anyway | Framework-specific | Whatever's built for it | Free in compute, high in engineering time | **Overkill at 3 sources, explicitly the kind of infrastructure this phase should not introduce without evidence** |

**Recommended primary: Option 3 (OS/server cron)**, directly invoking `npm run refresh:data -- --all --json` on whatever persistent server ends up running the app. This is the simplest possible closed loop — zero new secrets, zero new services, zero network exposure, and it's the exact same CLI already built and verified in Phase 3.3, now with `--json` output (§21) for whenever a log-forwarding or notification step wants to parse it.

**Recommended fallback/redundancy: Option 2 (GitHub Actions scheduled workflow)**, calling a protected refresh HTTP endpoint on the deployed server (§6). Its value isn't as the primary trigger — it's as an *independent* second signal: GitHub's own free failure-email notification means an operator finds out if refresh has silently stopped working even if the server's own cron/monitoring has also silently failed, and the run history in the Actions tab gives a visible, versioned audit trail that plain server cron logs don't provide by default.

**Not recommended at this scale**: Option 4 as a *primary* (introduces a new third-party service with no evidence of need over the free GitHub Actions option that already fits), Option 5 (real engineering cost for a problem three cron-triggered CLI calls already solve).

## 6. Refresh Command vs. HTTP Endpoint

**RECOMMENDATION: both (Option C)**, with a clear division of labor — CLI as the primary mechanism (§5), HTTP endpoint as a secondary, carefully-secured trigger for the GitHub Actions fallback and for manual "refresh now" operator use.

**If/when the HTTP endpoint is built** (design specified now, **DEFERRED** as actual code — see §21 for why), it must:
- Live at a non-guessable or clearly access-controlled path (e.g. `/api/admin/refresh`, gated regardless of path obscurity).
- Require a bearer token / shared secret passed in a header, compared using a constant-time comparison, read from a server-only environment variable (e.g. `REFRESH_SECRET`) — never hardcoded, never exposed to any client bundle.
- Reject any request without a valid token with a generic `401`, revealing nothing about *why* it failed.
- Rate-limit itself (e.g. refuse a second trigger within some minimum interval — even a simple in-memory "last triggered at" check is enough at this scale) — because unlike most admin endpoints, *this one's real cost lands on a third party* (Mississauga's/Richmond Hill's servers), so an attacker who obtained or guessed the secret shouldn't be able to turn DropIn into a tool for hammering someone else's infrastructure.
- Run the exact same `refreshOneSource`/`refreshAllActiveCommunities`/`refreshToronto` functions already built — no parallel implementation.

## 7. Snapshot Storage Options

**INFERENCE**, evaluated against §3's actual requirement (durable read of "the latest canonical dataset," not complex queries):

| Option | Durability | Atomic replacement | Version retention | Read latency | Operational complexity | Cost | Portability | Fit for raw+canonical |
|---|---|---|---|---|---|---|---|---|
| A. Local persistent filesystem | High, *if* the disk itself is persistent (true on A/B from §2, false on C/D) | **Already implemented** (rename-based, §2 of Phase 3.3) | Whatever retention policy is coded (currently 2-slot) | Lowest possible — a local file read, already measured at well under a second for the full combined dataset | Lowest — no new service, no credentials | Free (disk is already paid for as part of hosting) | Low — tied to wherever that disk lives | **Excellent, and already built** |
| B. Repository/build-bundled snapshots | High (git itself) | Not naturally — would need its own commit-based activation logic | Full git history, if wanted (probably far more than needed) | Fast (bundled into the deploy) but means every refresh requires a new deploy | Medium — couples data refresh to the deploy pipeline, which is a real coupling cost | Free, but repo bloat over time (Phase 3.3 §16 already ruled this out for exactly this reason) | High (portable anywhere git is) | Poor fit — conflates "ship new code" with "ship new data," which are different cadences and different failure domains |
| C. Object storage (e.g. an S3-compatible bucket) | High, provider-managed | Supported natively by most providers (conditional writes / versioning features) | Native versioning support in most providers, if enabled | Slightly higher than local disk (a network call, though typically tens of milliseconds within the same region) | Medium — needs credentials, an SDK dependency, and a small storage-interface implementation (the seam for which already exists, §21) | Low at this data volume (~200MB total today) — comfortably within most providers' free or near-free tiers | High — the same bucket is reachable from any compute environment, including a *different* refresh runner than the one serving requests | **The correct choice specifically if/when a serverless deployment (model C/D) is chosen** — decouples snapshot durability from any one compute instance |
| D. Database | High | Depends on schema design | Native, if modeled for it | Fast for a single-row/document read; the "advantage" of query flexibility is unused here | High relative to what's needed — schema, migrations, a connection-pooling story, a new operational dependency | Ranges free-to-real depending on provider/tier | Medium | **Overkill for "read the latest JSON blob"** — Phase 3.3's own explicit instruction not to add one for perceived sophistication applies with equal force here |
| E. Provider blob/KV store (e.g. a platform's own built-in key-value offering) | Varies by provider, generally high | Varies — some support atomic conditional writes, some don't | Varies, often none built-in | Generally fast | Low, if already using that provider for hosting | Often free at small scale, bundled with the platform | **Low — the biggest cost of this option.** Tied to one specific provider's proprietary API, the exact lock-in the prompt explicitly asked to avoid choosing casually | Workable, but the least portable option evaluated |

## 8. Recommended Storage Architecture

**RECOMMENDATION**: **Option A (local persistent filesystem) remains correct for right now**, because it directly follows from §16's deployment-model recommendation (a persistent server/container) — not chosen in isolation, but as the logical consequence of that choice. It already satisfies every requirement §8 lists: persistent latest + previous snapshot (built), atomic activation (built), source-specific refresh (built), fast app reads (built and measured), restart survival (built and verified), modest historical retention (2-slot, built), and — critically — it does not block future source expansion, because adding municipality #4 is still just "one more `<slug>/` directory," regardless of which storage backend eventually sits behind `SnapshotStorage`.

**If the deployment model recommendation in §16 is ever overridden in favor of serverless**, the conceptual layout for Option C (object storage) that this architecture would migrate to, unchanged in shape:

```
raw/
  toronto/latest.json
  toronto/previous.json
  mississauga/latest.json
  mississauga/previous.json
  richmond-hill/latest.json
  richmond-hill/previous.json

canonical/
  toronto/latest.json
  toronto/previous.json
  mississauga/latest.json
  mississauga/previous.json
  richmond-hill/latest.json
  richmond-hill/previous.json
```

This is deliberately the *same* key structure `lib/dropin/snapshot/paths.ts` already produces for local paths — an object-storage `SnapshotStorage` implementation would take `key` (already computed identically today) and call a bucket's `put`/`get` instead of `fs.writeFile`/`fs.readFile`, with no change needed anywhere else in the codebase (§21). **Not implemented this phase** — no bucket, no SDK, no credentials — because no deployment model has actually chosen serverless yet (§1), and Part 21 is explicit that this would be premature without that evidence.

## 9. Request-Time Read Strategy

**VERIFIED** (already built and measured in Phase 3.3, reconfirmed here as the right ongoing strategy): `/api/sessions` reads canonical snapshots from durable storage (currently local disk) on every request, through a small in-process cache keyed by the snapshot file's own mtime (`lib/dropin/sources/index.ts`) — the cache is purely a performance optimization to avoid re-parsing a multi-megabyte JSON file on every single request; it is never the only copy of the data, and it self-invalidates the moment a new snapshot is atomically activated (a new mtime is observed on the next request, triggering a fresh read).

| Event | Behavior |
|---|---|
| Process restart | Cache is empty; next request does one real (fast, local) file read, then re-populates the cache. No data loss — verified directly in Phase 3.3. |
| Cold start (a fresh process, e.g. serverless — hypothetically, if that model were chosen) | Same as restart — but see §2's caveat that a truly ephemeral filesystem would have nothing durable to read at all under model C/D, which is exactly why §16 doesn't recommend that model yet. |
| Deployment | If code changes but the data volume/disk persists (true on model A/B with a persistent volume), snapshots survive untouched — only the running process restarts, same as any restart. |
| Cache expiry | There isn't a TTL-based expiry — the cache is invalidated by real file-content change (mtime), not by time, so it never serves data staler than what's actually on disk. |

## 10. Refresh Failure / Stale Data Policy

**RECOMMENDATION, and IMPLEMENTED as a real classification function** (`scripts/snapshot-health.ts`'s `classifyFreshness`, derived directly from §4's 6-hour recommended cadence):

- **FRESH** — last successful fetch < 8 hours ago. (One cadence interval plus slack for a single delayed run.)
- **AGING** — 8–24 hours ago. One or two missed cycles; worth a warning in logs/health output, not yet a user-facing concern.
- **STALE** — ≥ 24 hours ago. Multiple consecutive misses — a real operational problem needing attention, even though the app should keep serving the last known-good snapshot throughout (per Phase 3.3's own "last known-good over empty app" principle, unchanged here).
- **UNAVAILABLE** — no canonical snapshot has ever successfully activated for that municipality. Toronto can never truly reach this state (its bundled-data fallback, §14/§15 of Phase 3.3, guarantees *something* is always servable); Mississauga/Richmond Hill could, only before their very first successful refresh ever runs.

These are operational thresholds, not automatically user-facing text — §11 addresses what the UI itself should say.

## 11. Data Freshness UI Semantics — Reconfirmed

**VERIFIED, no change needed beyond what Phase 3.3 already did.** Phase 3.3 already established and fixed the right rule: the Results meta line's "Updated N ago" represents **the last successful DropIn fetch** (each session's `lastUpdated`, sourced from its canonical snapshot's `fetchedAt`), scoped to what's actually displayed, taking the *oldest* value when a view spans more than one source. This remains the correct concept under Phase 3.3B's cadence recommendation (§4) — "last successful DropIn fetch" is the one freshness concept every source can honestly support; "upstream source updated timestamp" is not reliably available across all three sources (Toronto has none beyond its own fetch time; ActiveCommunities exposes a forward-looking horizon, not a last-updated signal — see Phase 3.3 §11/§14), so using it as the UI's primary claim would require fabricating it for sources that don't expose it. No UI code was touched this phase.

## 12. Observability

**RECOMMENDATION, mostly already IMPLEMENTED.** The eight questions Part 12 asks for are all answerable today without a dashboard:

| Question | Answered by |
|---|---|
| When did each source last refresh successfully? | `npm run snapshot:health` (`fetchedAt` + human age label) |
| When did it last fail? | Not currently persisted as its own record — see Known Limitations |
| Raw record count? Canonical session count? | `snapshot:health` and the refresh report itself |
| How long did refresh take? | Refresh report's `DURATION` field |
| Age-join rate? | `snapshot:health` and the refresh report |
| Is the active snapshot stale? | `snapshot:health`'s new `freshness` field (§10) |
| Did count-collapse safety reject anything? | Surfaces as a `FAILURE REASON` in the refresh report today — not yet separately queryable after the fact without re-reading that run's log |

**Implemented this phase** (§21): `--json` output on both the refresh CLI and the health command, so a scheduler step can parse results programmatically instead of scraping text — this is what makes "logs + health command" (Part 12's own suggested ceiling) actually sufficient without a dashboard.

**Known gap, DEFERRED**: failure history isn't persisted anywhere beyond that run's own log output — a health check right now can tell you the *current* snapshot's staleness, but not "how many of the last 5 scheduled refreshes failed." Acceptable at this scale (§20) and easy to add later (e.g. appending one line to a small local log file) if it turns out to matter.

## 13. Failure Notification

**RECOMMENDATION**: GitHub Actions' own built-in "email the repository's notification-enabled users on workflow failure" (free, zero setup beyond the workflow existing at all) is the right mechanism at this stage — directly why §5 recommends GitHub Actions as the fallback/redundant trigger even though server cron is the primary: **the redundant trigger doubles as the notification channel**, at no additional cost or complexity. **DEFERRED**: a dedicated webhook/Slack-style notification is explicitly more than an independent small project needs right now (Part 13's own instruction) and isn't recommended until there's evidence email notification is insufficient.

## 14. Refresh Concurrency

**VERIFIED**: the current implementation already runs Toronto and the ActiveCommunities family concurrently (`Promise.all` in `scripts/refresh/index.ts`), and within the AC family, Mississauga and Richmond Hill also already refresh concurrently (`Promise.allSettled` in `refreshAllActiveCommunities`) — confirmed by real timing: a full `--all` run completes in roughly the duration of its single slowest source (~11s), not the sum of all three (~15s serially).

**RECOMMENDATION for scale**: keep this pattern (all configured sources concurrent) as-is through the near-term roadmap (§18's 8–12 municipality range) — three-to-a-dozen concurrent outbound fetches to *different* third-party vendors is not meaningful load on any single one of them, and is trivial memory/bandwidth for any host capable of running the app at all. **Recommend introducing an explicit concurrency cap** (e.g. a maximum of 6–8 simultaneous source refreshes) only once the municipality count grows large enough that "every source at once" could plausibly stress the refresh host's own outbound bandwidth or memory — not a real concern at today's or the next phase's scale, but cheap to note now as the ceiling before it needs revisiting.

## 15. Retention

**RECOMMENDATION**: keep Phase 3.3's existing two-slot policy (current `latest` + `previous`) for both raw and canonical snapshots — it already gives one real rollback/debugging step without unbounded growth, and nothing in this phase's evidence suggests more is needed yet. If deeper diagnostic history is ever wanted, **RECOMMENDATION, DEFERRED**: a small numbered history (e.g. the last 5 raw snapshots per source) is the natural next step, but belongs in object storage (§7 Option C) rather than the repo or a persistent server's own disk indefinitely — "debuggability without uncontrolled storage growth" (Phase 3.3's own framing) applies just as much to a VPS's disk as to a git repo.

## 16. Deployment Model Comparison

**RECOMMENDATION**, evaluated concretely rather than by popularity, per Part 16's explicit request:

| | **Model A — Persistent Node/container server** | **Model B — Serverless Next.js deployment** |
|---|---|---|
| Scheduler | OS cron or platform scheduled-task feature, directly on the same host (§5) | Requires the platform's own cron primitive (e.g. a scheduled serverless function) or an external trigger — cannot use plain OS cron, since there's no persistent OS-level process to attach one to |
| Refresh execution | Runs the existing CLI directly, writing to the same local disk the app reads (§9) — zero rework | Must run as its own function invocation, and **cannot write to local disk the app can later read** (§2) — requires object storage (§7 Option C) to be built first |
| Snapshot storage | Local persistent disk — **already built** | Must be object storage — **not built this phase**, real new work (SDK, credentials, a new `SnapshotStorage` implementation) |
| `/api/sessions` reads | Local file read, already measured at sub-second (§9) | Object storage read — still fast, but a genuinely new code path, not the one already verified |
| Failure behavior | Verified directly in Phase 3.3 (last known-good served, failures isolated) | Would need to be re-verified against the new object-storage code path — untested territory |

**Recommendation: Model A (persistent server/container)**, for reasons grounded in what's actually built and what evidence exists, not provider popularity:
1. Everything Phase 3.3 built and verified — atomic activation, restart survival, sub-second reads, source isolation, count-collapse safety — was tested against exactly this model. Choosing it means **zero rework** of already-working, already-tested code.
2. The refresh job (§4/§14, ~11–15s, real outbound HTTP) is a natural fit for a scheduled CLI job on a long-lived host; forcing it into a serverless function invocation works too (11s is within most providers' limits) but buys nothing here since there's no autoscaling/traffic-spike need evidenced yet for a request path that's already sub-second.
3. Model B's real advantages (zero-maintenance scaling, pay-per-request pricing, global edge) address problems DropIn doesn't have evidence of having yet at this stage — meanwhile its real cost (mandatory object-storage rework before the data layer even works) is immediate and certain.
4. **No specific provider is named for Model A** — "a small persistent Node host" (a VPS, or a PaaS with a persistent-process tier such as Railway/Render/Fly.io, named here only as illustrative categories, not a recommendation for any one of them specifically) is the category recommendation; §1 found no existing evidence favoring one over another, so none is chosen.

## 17. Future Map/Geospatial Implications (Phase 4)

**INFERENCE, no blocker found.** Map View, Near Me, and Distance Sort need, at minimum: real coordinates on sessions (not yet populated for any source — a separate, already-deferred geocoding project) and simple distance filtering/sorting over an already-loaded set of sessions. At DropIn's current and near-term scale (tens of thousands of sessions total across a handful of municipalities), that's a straightforward in-memory Haversine-distance computation over the array `/api/sessions` already assembles — it does not require spatial indexing, a geospatial database extension, or any change to how snapshots are stored. **RECOMMENDATION, matching Phase 3.3's own framing**: snapshot-file storage is fine for Phase 4 at today's scale; a real database (with geospatial indexing, e.g. PostGIS-style radius queries) becomes justified once municipality count or per-request query complexity grows enough that in-memory filtering stops being fast enough — not evidenced yet, and not something to build ahead of that evidence.

## 18. Future Municipality Scale (Vaughan/Markham and Beyond)

**VERIFIED via direct extrapolation from real measured numbers**, not guessed: today's 3 municipalities produce ~123MB of raw snapshots and ~70MB of canonical snapshots (2-slot retention each), with a full concurrent `--all` refresh completing in ~11–15s. Scaling roughly 4x to 8–12 municipalities (Part 18's own target range) would put total snapshot storage in the range of 500MB–1GB — trivial for any persistent disk, comfortably within free/cheap tiers of any object storage if that migration ever happens (§7) — and, with the concurrency pattern already in place (§14), a full refresh in the range of one to a few minutes, run every 6 hours: entirely unremarkable. **No structural redesign is needed to reach this range** — the architecture already scales by adding one config entry (per Phase 3.2's ActiveCommunities pattern) or one new source-family script (for a genuinely new platform like PerfectMind/Xplor) per municipality, exactly as designed.

## 19. Security

**RECOMMENDATION**, since nothing here is implemented yet (no deployment target to configure it against):

- **No secrets are required by any currently-integrated source** — Toronto's CKAN API and both ActiveCommunities municipalities are all confirmed (Phase 3.0/3.1) to require no API key or credential of any kind. This is a genuine, worth-stating simplification: today's refresh pipeline has *zero* secrets to manage.
- **If the HTTP refresh endpoint (§6) is ever built**: one new environment variable, e.g. `REFRESH_SECRET` — a server-only value, never referenced in any client-side code, provided to both the deployed app (as a platform env var) and to GitHub Actions (as an encrypted repo secret) if that's the trigger calling it.
- **If object storage (§7 Option C) is ever adopted**: storage access credentials (an access key/secret or equivalent), server-only, provided the same way.
- **General rule, applied in advance**: no secret is ever committed to the repository, ever read by client-side code, or ever logged in refresh output (the `--json` report added this phase, §21, contains only counts/timings/status — no request headers, tokens, or credentials).

## 20. Cost / Operational Complexity

**INFERENCE**, qualitative as requested:

| | Estimate | Why |
|---|---|---|
| Hosting cost | **LOW** | A small persistent Node host for this traffic level (early-stage product, sub-second request times) fits comfortably in many providers' $0–10/month tiers. |
| Storage cost | **LOW** | ~200MB today, ~500MB–1GB projected at 8–12 municipalities (§18) — negligible on any persistent disk, and comfortably within free/cheap object-storage tiers if that's ever adopted. |
| Maintenance burden | **LOW–MEDIUM** | Mostly "keep one small server up" plus occasional health checks; GitHub Actions' free failure email (§13) handles the passive-alerting half of this. |
| Setup burden | **LOW–MEDIUM** | One persistent host to provision, one cron entry (or platform scheduled-task) to configure, one GitHub Actions YAML file for the fallback trigger — no database, no object-storage SDK, no cloud-account sprawl required at this phase. |

Nothing in this recommendation requires more than one paid service (the host itself), consistent with Part 20's explicit instruction to avoid an architecture leaning on several managed services without clear justification.

## 21. Small Provider-Agnostic Preparation — What Was Actually Implemented

**IMPLEMENTED**, kept deliberately small, per the explicit permission and constraints in Part 21:

1. **`SnapshotStorage` interface + `LocalFilesystemSnapshotStorage`** (`lib/dropin/snapshot/io.ts`) — the exact "separate the storage interface from the local filesystem implementation" improvement Part 21 named as an example. `readJsonIfExists`/`writeSnapshotAtomic` are now thin wrappers around a `defaultSnapshotStorage` instance; every existing call site (refresh scripts, the app's read path) needed zero changes. This is the seam a future object-storage implementation (§7/§8) would plug into — not built, no SDK added, no credentials introduced.
2. **`--json` output mode** on the refresh CLI (`scripts/refresh/index.ts`, and the standalone `toronto.ts`/`activecommunities.ts` entry points) and on `snapshot:health` — machine-readable, single-line JSON on stdout, verified to parse correctly. This is what makes a scheduler step able to act on refresh results programmatically (§12) without scraping human-readable text.
3. **A real `classifyFreshness` function** (`scripts/snapshot-health.ts`) implementing §10's FRESH/AGING/STALE/UNAVAILABLE thresholds, now surfaced in both the human and JSON health output — turning §10's policy from a paper definition into something `npm run snapshot:health` actually reports today.

**Explicitly not done**, per Part 21's own boundary: no cloud SDK installed, no Vercel/other-provider integration created, no object-storage bucket created, no database added, no deployment credentials created, nothing deployed. `tsc`, `npm run build`, and `npm run lint` were all re-verified clean after these changes (lint shows the same 16 pre-existing, unrelated errors already present before this phase — confirmed untouched).

---

## 22. Proposed Final Production Architecture

Derived from the evidence above, not the prompt's own illustrative example:

```
OS cron (primary) — GitHub Actions scheduled workflow (fallback/redundant, + free failure email)
  ↓ every 6 hours
npm run refresh:data -- --all --json
  ↓
Toronto: live CKAN fetch (bundled-data fallback if unreachable)
Mississauga + Richmond Hill: live ActiveCommunities fetch (concurrent, source-isolated)
  ↓
Raw snapshot (local persistent disk, 2-slot retention)
  ↓ validate (shape, count-collapse safety)
Canonical snapshot (local persistent disk, 2-slot retention, atomically activated)
  ↓
Small in-process app cache (mtime-invalidated — not the source of truth, the durable snapshot is)
  ↓
/api/sessions (reads local disk, sub-second, no remote fetch)
  ↓
DropIn — unchanged
```

Running on **Model A**: a single persistent Node/container host (§16) — no object storage, no database, no external scheduler service required to reach a genuinely production-grade version of what Phase 3.3 already built.

## 23. Data-Infrastructure Launch Checklist

Practical, not exhaustive:

- [ ] A persistent host is provisioned and `npm run build && npm run start` runs correctly on it
- [ ] `data/` resolves to a real, persistent (not container-ephemeral) path on that host
- [ ] `npm run refresh:data -- --all` succeeds when run manually on the deployed host
- [ ] A scheduler (OS cron, per §5) is wired to run it automatically on the recommended cadence (§4)
- [ ] GitHub Actions fallback workflow is configured and its failure-email notification confirmed working (send one deliberate test failure)
- [ ] `npm run snapshot:health` shows FRESH for all three sources after the first scheduled run
- [ ] A deliberately-broken refresh (temporarily bad config, same test performed in Phase 3.3) confirms the last known-good snapshot is preserved on the deployed host, not just in local dev
- [ ] A server restart/redeploy on the host is performed and confirmed not to lose snapshot data
- [ ] Freshness copy in the UI ("Updated N ago") is spot-checked against `snapshot:health`'s own numbers post-deploy
- [ ] `/api/sessions` cold-request latency is measured on the deployed host and confirmed sub-second, not a repeat of the ~10s remote-fetch behavior this phase eliminated
- [ ] Toronto, Mississauga, and Richmond Hill are each spot-checked for real search results on the deployed instance (not just localhost)
- [ ] Mobile/LAN access is re-verified against the deployed URL (the `allowedDevOrigins` dev-only concern from the mobile diagnostic phase does not apply to a real production deployment, but is worth one confirming check)

## 24. Documentation

This document. `docs/ARCHITECTURE.md` was not further revised this phase — its Phase 3.3 revision already accurately describes the snapshot pipeline this document builds a deployment strategy around; nothing about the pipeline's own shape changed here, only how it should eventually be triggered and hosted.

---

## Final Report

1. **Deployment state found**: not configured (no host, no CI/CD, no cron) — but a real GitHub repository exists and is treated as genuine evidence for §5's recommendation.
2. **Filesystem durability findings**: Phase 3.3's snapshot architecture requires a persistent, shared disk between the refresh process and the app process — true on a persistent server/container, false on serverless/ephemeral-filesystem models without further work.
3. **Recommended deployment model**: Model A — a persistent Node/container server, no specific provider named (no evidence favoring one).
4. **Recommended snapshot storage**: local persistent filesystem, unchanged from Phase 3.3 — already built, already verified, already sufficient for the recommended deployment model.
5. **Recommended scheduler**: OS/server cron as primary; GitHub Actions scheduled workflow (calling a protected HTTP endpoint) as fallback and failure-notification channel.
6. **Recommended source refresh frequencies**: every 6 hours for all three sources (Toronto, Mississauga, Richmond Hill), with per-source minimum-acceptable floors of 24h/12h/12h respectively.
7. **Refresh triggering model**: both CLI (primary, via cron) and a to-be-built protected HTTP endpoint (fallback trigger + manual operator use) — endpoint design specified, not implemented this phase.
8. **Read/cache behavior**: unchanged from Phase 3.3 — durable snapshot is the source of truth; a small mtime-invalidated in-process cache is a pure performance optimization, never the only copy.
9. **Stale-data policy**: FRESH (<8h) / AGING (8–24h) / STALE (≥24h) / UNAVAILABLE (never succeeded) — implemented as a real function this phase, surfaced in `snapshot:health`.
10. **Monitoring/notification strategy**: logs + `--json`-capable health/refresh commands (built this phase) + GitHub Actions' free failure email — no dashboard.
11. **Retention strategy**: keep Phase 3.3's 2-slot policy; deeper history, if ever needed, belongs in object storage, not the repo or server disk indefinitely.
12. **Security requirements**: zero secrets needed by any currently-integrated source; one new secret (`REFRESH_SECRET`) only if/when the HTTP endpoint is built; storage credentials only if/when object storage is adopted.
13. **Expected cost/complexity**: low across hosting, storage, and maintenance; low-to-medium setup burden; at most one paid service (the host itself).
14. **Phase 4 implications**: no blocker — in-memory distance computation over the existing snapshot data is sufficient at current/near-term scale; a real geospatial database remains correctly deferred until evidenced.
15. **Scale-to-Vaughan/Markham assessment**: comfortably supported without redesign up to the 8–12 municipality range evaluated, based on real extrapolated numbers.
16. **Small code changes made**: a `SnapshotStorage` interface (local-filesystem-backed, no new dependency), `--json` output on the refresh CLI and health command, and a real `classifyFreshness` implementation — all verified against `tsc`/`build`/`lint`.
17. **Exact Phase 3.3C implementation recommendation**: provision one persistent host, deploy the current build to it, wire OS cron to `npm run refresh:data -- --all --json` on the recommended 6-hour cadence, and build the protected HTTP refresh endpoint (§6) plus its matching GitHub Actions fallback workflow — in that order, since the first two alone already constitute a complete, production-viable data pipeline, with the HTTP endpoint and Actions workflow as the natural very-next hardening step rather than a launch blocker.

Stopping here for review, as instructed. No Phase 3.3C implementation was started.
