# DropIn — Security & Deployment Readiness Audit

**Scope:** Determine whether the current repository can be safely deployed to a public production environment, and what must change first. This is an audit. Nothing was deployed, no hosting was chosen, no scheduler was built, no analytics were added, and Support DropIn was not implemented. Two minimal, explicitly-scoped documentation-only conclusions aside, **no source files were modified during this audit** — see §M.

**Method note on this document's provenance:** Parts 1–7 of this audit (repository exposure, secrets, data exposure, geolocation privacy, API surface, client-side security, dependencies) were investigated first and are summarized here from that investigation. Parts 8–12 were completed after, in the same session, with fresh command output. Every finding below reflects an actual command run against the current tree — a directory listing, a grep, a build, `npm audit`, or a source read — not an assumption. Where something was not empirically tested, that is stated explicitly rather than asserted as safe.

---

## 1. Repository Exposure Audit

`.gitignore` correctly excludes `/node_modules`, `/.next/`, `data/raw/`, `data/canonical/`, `.env*`, `.DS_Store`, `*.pem`, and log patterns. Confirmed via full read of the file.

- **`data/facility-locations/*.json`** and **`data/toronto-open-data/*.json`** are tracked in git by design — both are public municipal data (a facility coordinate registry DropIn derived, and Toronto's own published Open Data). Inspected `data/facility-locations/latest.json` directly: only name/address/coordinate fields, no secrets, no local paths.
- **`data/raw/`** and **`data/canonical/`** (the per-run scraped/normalized snapshots) are correctly gitignored and were confirmed absent from `git log` history.
- **`docs/`** is fully git-tracked (39 files). One finding here — see the `getdropin.team@gmail.com` item in §12, which is the only meaningful repository-exposure issue found in this directory.
- **`app/design/`** exists as a tracked, buildable route tree (the project's `/design` preview-environment convention, per `docs/PROJECT_WORKFLOW.md`). This is not a *repository* exposure problem — it's a *build output* problem, covered in full under §5 and §8, and is this audit's most significant finding.
- No absolute `/Users/...` paths, no local usernames, no local IP addresses (other than the one `next.config.ts` entry handled in §12), no `localhost` references, and no personal filenames were found anywhere in tracked `.ts`/`.tsx`/`.md`/`.json` source (checked via repo-wide grep, excluding `node_modules` and `.next/`).
- No build artifacts or temp files are tracked; `.next/` is correctly ignored.

**Conclusion:** Repository exposure is clean except for the two items carried into §5/§8 (the `/design` route tree) and §12 (the Gmail address in one doc file).

---

## 2. Secret/Credential Audit

- **Zero `process.env` references anywhere in the codebase.** No environment variables are read, set, or depended on by any application code.
- **No `.env` file exists on disk**, and none is (or needs to be) gitignored beyond the existing `.env*` pattern.
- Full git history (56 commits) was searched for common secret patterns (API keys, tokens, passwords, `Authorization:` headers, connection strings) — no actual secret values were found at any point in history.
- The one credential-shaped thing in the codebase is the ActiveCommunities session cookie (`lib/dropin/sources/activecommunities/client.ts:242`, `Cookie: session.cookieHeader()`). Traced to `createAcSession(tenant)`: this is an **ephemeral, anonymous session cookie extracted from a public page load at request time**, not a stored credential, not a secret, and not something that grants access to anything beyond what an anonymous visitor to the municipality's own public booking site already has.
- Nominatim (OpenStreetMap) geocoding, used by `scripts/refresh/facility-locations.ts`, requires no API key — confirmed via source read, no key/token variable exists for it anywhere.
- No Cloudflare account ID, zone ID, or API token appears anywhere in source (only prose *discussion* of Cloudflare Email Routing as a concept, in docs).

**Conclusion:** No actual secrets or credentials exist in this repository, in its history, or in its dependency configuration. Classification: not a P0/P1 item — there is nothing to remediate.

---

## 3. Data Exposure Audit

The `Session` type (`lib/dropin/types.ts`) is the single shape returned by `/api/sessions`. It carries a `registrationStatus` field that is explicitly commented in source as intentionally **never rendered in the UI** ("kept for potential future internal logic only") — yet the API route returns the full, unfiltered array with no field allowlist, so this internal-only field ships in every production response today. It is not sensitive data (a scheduling-status enum, not PII or a secret), but it's an unintentional exposure of an internal field via a public endpoint with no filtering step. **P2 — recommended improvement**, not blocking: add a response-shaping/allowlist step to `/api/sessions` before general availability.

Beyond that field, all other data returned is already-intended-public: activity name, time, location, price, age range, phone, and the official municipal booking link — this is the product's actual purpose (surfacing public recreation listings), not incidental exposure.

Raw ingestion data (`data/raw/`) and canonical snapshots (`data/canonical/`) are correctly excluded from the client and from git (§1); nothing from those directories reaches a browser. The Toronto fallback (`data/toronto-open-data/*.json`) is already-public source data, intentionally bundled server-side (§8) — not a leak.

No debug metadata, no internal verification fields beyond `registrationStatus`, and no sensitive upstream source URLs are exposed to the client beyond the officially-intended booking link.

**Conclusion:** Architecture ("source → truth → presentation") is respected; one minor internal-field leak (P2), no redesign needed.

---

## 4. Geolocation Privacy Audit (fresh re-verification)

Re-derived from scratch this session, independent of prior Phase 4 / Launch Readiness audit conclusions, via direct grep of `app/page.tsx`:

- `localStorage`/`sessionStorage` usage: exactly two call sites (lines 569, 575), both for an unrelated UI density preference — **zero geolocation data is ever written to either storage.**
- Zero URL-manipulation of coordinates — no query-string, hash, or path construction involving `userLocation` anywhere.
- Exactly one `fetch(` call in the entire file (line 580, to `/api/sessions`) — it sends no location data; `/api/sessions` takes zero input (§5).
- Zero `console.*` calls in `app/page.tsx` — coordinates are never logged client-side.
- `handleShare` (lines 1132–1152) was read in full: shared content is the activity's own public details (name, time, location name), never the user's coordinates or derived distance.
- All 20 reference sites of `userLocation` were enumerated: every one stays within component state/derived UI values (e.g., computing `distanceKm` for display and sort order) — none crosses a network boundary, storage boundary, or logging boundary.
- Current Privacy copy (lines 2094–2098) was re-read against these findings and remains **technically accurate**: coordinates stay in the browser, are not stored, and are not transmitted anywhere.

**Conclusion:** Geolocation handling is provably browser-only. No P0/P1/P2 findings here — this is the strongest area of the audit.

---

## 5. API/Server Surface Audit

The entire server-side route surface is:

| Route | Purpose | Input | Output | Notes |
|---|---|---|---|---|
| `app/api/sessions/route.ts` | Return all current recreation sessions | **None** — `GET`, no params, no body, no headers read | Full `Session[]` array (JSON) | No try/catch (assessed below); `registrationStatus` leak (§3) |

That's it — confirmed via `find app -name "route.ts"`, exactly one match. No middleware, no dynamic route segments (`[param]`), no path or filename ever accepted as input from a client, so there is no path-traversal or arbitrary-file-read surface at all: the route can't be pointed at anything other than what `getAllSessions()` already hardcodes.

Internally, `getAllSessions()` (`lib/dropin/sources/index.ts`) uses `Promise.allSettled` to isolate per-municipality failures — a malformed or missing snapshot for one municipality is caught, logged server-side (`console.error`), and that municipality is silently excluded from the response. It does not propagate to an uncaught exception in the route handler under this failure mode. The *fully*-uncaught scenario (something outside this handled path) was **not** empirically forced/tested this session; it would fall back to Next.js's standard production error behavior (generic 500, no stack trace to the client) — this is documented framework behavior, not independently re-verified here. Given the route also has no input, the realistic trigger surface for an unhandled exception is very small. **P3 — optional hardening** (wrap the handler in try/catch for an explicit, controlled error response), not a launch blocker.

Rate limiting: not implemented, and not necessary for launch — the route is read-only, has no auth/session cost, and returns already-public data; abuse potential is limited to ordinary scraping of data that's already intentionally public.

**The much larger finding for this section is the `app/design/*` route tree.** `app/design/page.tsx` and its six subroutes (`homepage-lowfi`, `homepage-highfi`, `results-lowfi`, `results-highfi`, `results-card-variations`, `colour-exploration`) are ordinary Next.js pages with no `NODE_ENV` guard, no auth, no `noindex`, and no `robots.txt` anywhere in the repo (confirmed — none exists). `app/design/page.tsx` literally titles itself "Design Preview Hub" and describes its own contents as *"Temporary review environments... Not production routes"* — but nothing in the app enforces that. In a normal `next build && next start` deployment, every one of these routes builds and serves exactly like `/`, fully public and fully indexable. This is a real, verified "unnecessary server endpoint" / "internal documentation exposed" finding per the audit's own primary goal. **P1 — should fix before launch.** (See §8 for build-output confirmation and §13 for the recommended remediation options — not implemented here, per this audit's fix policy.)

---

## 6. Client-Side Security Audit

- **Zero `dangerouslySetInnerHTML`** anywhere in `app/` (confirmed via repo-wide grep).
- No unescaped user content is rendered — the app has no user input surface beyond browser-native geolocation permission and standard search/filter UI state, none of which is rendered back as raw HTML.
- Two `target="_blank"` links exist (Directions, line ~1868–1878; Official listing, line ~1885–1895) — both correctly paired with `rel="noopener noreferrer"`, preventing the classic reverse-tabnabbing issue.
- `mailto:` construction (`lib/dropin/contact.ts`) uses `encodeURIComponent` on both subject and body — safe against header injection.
- **URL scheme handling differs by data source family**, worth flagging precisely:
  - PerfectMind `officialUrl` (`lib/dropin/sources/perfectmind/normalize.ts:100-108`, `buildOfficialUrl`) is safely constructed from a hardcoded `https://` template plus DropIn's own static host config — safe by construction, not influenced by upstream data at all.
  - ActiveCommunities `officialUrl` is **direct passthrough** from the raw upstream API response (`event.activity_detail_url` / `activity.detail_url ?? activity.action_link?.href`) with no scheme validation before being rendered into a real `<a href>`. Empirically checked against real current data: 16,133 URLs across three municipalities, 100% `https:`. No exploitation exists today, but there's no defensive check preventing a `javascript:`-scheme or similarly malformed value if the upstream API ever returned one. **P2 — recommended improvement**: validate/allowlist the scheme (`https:` only) before rendering, not urgent given zero real-world instances found, but cheap and directly relevant to a link that renders attacker-influenced (upstream-controlled) upstream data.
- Search query handling was reviewed — search/filter state stays client-side UI state, never reflected into `dangerouslySetInnerHTML`, a URL, or an outbound request payload beyond the no-input `/api/sessions` call.

**Conclusion:** No realistic client-side injection vector found. One low-severity defensive gap (P2, scheme validation on one URL source).

---

## 7. Dependency Audit

`package.json` dependency separation is clean and minimal:
- **Production `dependencies`:** `next` (16.2.12, exact pin), `react` (19.2.4), `react-dom` (19.2.4) — nothing else.
- **`devDependencies`:** `@tailwindcss/postcss`, `@types/node`, `@types/react`, `@types/react-dom`, `eslint`, `eslint-config-next`, `tailwindcss`, `tsx`, `typescript` — correctly excluded from a production install profile.

`npm audit --omit=dev` reports 4 high-severity transitive vulnerabilities:
- `nanoid <3.3.18`
- `postcss <=8.5.22` (XSS/path-traversal via `sourceMappingURL`)
- `next` (depends on the vulnerable postcss/sharp)
- `sharp <0.35.0` (libvips CVEs)

All four were traced via `npm ls nanoid postcss sharp`: `postcss`/`nanoid` are transitive deps of `@tailwindcss/postcss` (a **build-time-only** CSS compilation step — never runs in the deployed server process), and `sharp` is only ever invoked through `next/image`, which was confirmed via `grep -rn "next/image"` to return **zero matches** anywhere in this codebase — DropIn never imports or uses `next/image`, so that vulnerable code path is never reachable regardless of the underlying dependency version. Fixing the `next`-related findings would require `npm audit fix --force` (a major-version bump to `next@16.3.2`), which is explicitly **not performed** here per the task's instruction not to auto-upgrade. **P2 — recommended before general availability**, not blocking: real-world exploitability today is low (build-time-only or unreachable code path), but the upgrade should happen in the next phase rather than being deferred indefinitely.

**Conclusion:** No unnecessary production dependencies, no dev packages shipping to production, no directly-exploitable vulnerability in the current runtime path. The one meaningful action item (bump `next`) is scoped, understood, and deferred by design.

---

## 8. Production Build Audit

A completely fresh build was run this session: `rm -rf .next && npm run build`. It **succeeded cleanly**.

- **Client-facing bundles (`.next/static/`):** grepped for the developer's local path/username — zero matches. Also grepped specifically for `toronto-open-data` — zero matches, confirming the bundled Toronto fallback dataset (§3) stays server-side only, never reaching a browser.
- **Source maps:** `next.config.ts`'s resolved config (read from the build's own `required-server-files.json`) shows `"productionBrowserSourceMaps": false`, and a direct search of `.next/static/` for `*.map` files found none. No source maps ship to the client in production.
- **Server-internal build files:** the developer's local absolute path (`/Users/qingwengao/Desktop/dropin`) **does** appear in `.next/required-server-files.json` / `.js`, in the `outputFileTracingRoot`, `root`, and `appDir` fields. This is Next.js's own internal build manifest, read by the Node.js server process at startup — it is never routed to any HTTP client via any route, and confirmed via source read of `lib/dropin/snapshot/paths.ts` that all actual runtime file access uses `path.join(process.cwd(), "data")`, not this manifest value. Critically, this path is a property of **wherever the build is run**, not something hardcoded in source — a real production build executed on an actual host would automatically contain that host's own path instead. **Not a finding requiring action** — documented for completeness, zero production security impact.
- **Server-side chunks:** `.next/server/chunks/data_toronto-open-data_*.js` (and matching `.js.map`) were found — this is the intentional, already-public Toronto Open Data bundle (§3), not private/raw data.
- **`app/design/*` builds as ordinary static/server routes** alongside `/` — confirmed present in the build output with no build-time exclusion mechanism. This is the same finding as §5, now confirmed at the build-artifact level: it is not hypothetical, it is exactly what a `next start` production server would serve today.

**Required answer:** *"If this project is deployed to a normal production host, can a visitor access files elsewhere on the developer's personal computer?"* **No.** All filesystem access in the running server uses `path.join(process.cwd(), ...)`, resolving relative to wherever the process actually runs, never a hardcoded developer-machine path. The one API route (§5) takes zero input and cannot be directed to read an arbitrary path — there is no path-traversal surface at all. The single place a developer-machine path appears (`required-server-files.json`) is a server-internal Next.js build artifact, never served by any route, and would be regenerated with the production host's own path if the build ran there instead of locally.

**Conclusion:** Build is clean and reproducible. The one real, actionable finding from this section is the same `/design` route-tree issue already flagged in §5 (carried forward, not double-counted).

---

## 9. Logging & Error Handling Audit

**Production runtime logging** — i.e., code that actually executes inside the deployed Next.js server on a real request — is minimal. A full grep of `app/` and `lib/` found exactly **three** `console.*` calls, all in `lib/dropin/sources/index.ts`:
- Two `console.warn` calls for a missing canonical snapshot (municipality slug only, plus an instruction to run the refresh script).
- One `console.error` call logging `result.reason` when a municipality's snapshot load fails inside the `Promise.allSettled` isolation (§5).

None of these three log lines include user data, coordinates, personal information, secrets, or raw municipal payloads — they log municipality slugs and generic JS error messages only. No analytics, no request logging, no access logging exists in application code (any HTTP access logging would come from the hosting platform itself, a §10 concern, not this codebase).

`app/` has **zero try/catch blocks** anywhere — the one API route relies entirely on the `Promise.allSettled` isolation (§5) plus Next.js's standard production error handling for anything outside that. This was not independently stress-tested (e.g., by forcing a crash) this session — noted as unverified rather than asserted safe.

**CLI/dev tooling** (`scripts/refresh/*.ts`, `scripts/snapshot-health.ts`) is comparatively verbose — dozens of `console.log`/`console.warn` calls reporting fetch status, record counts, durations, geocoding results, and warnings. This is **not** part of the request/response path; it only runs when a human or a future scheduler invokes `npm run refresh:data` etc. Content is entirely operational (municipality names, counts, durations) — no user data, since these scripts never touch user location or any user-supplied data at all. Several lines interpolate `err.message` for filesystem errors, which for a Node `ENOENT`-style error can include an absolute file path — on a real host this would be the *host's* path (§8's `process.cwd()` finding applies equally here), and would land wherever that host's log sink sends stdout/stderr, not somewhere publicly exposed by default. This is folded into the §11 recommendation (log-access control is a hosting-platform concern for the next phase), not a code defect. **P3 — informational**, feeds into §11.

**Conclusion:** No user location, personal data, secrets, or raw payloads were found in any log statement in the codebase, in either the production runtime path or the offline tooling path.

---

## 10. Deployment Requirements (documentation only — no host selected)

- **Runtime:** Next.js 16.2.12, App Router. `next.config.ts` sets no `output: "export"`, and the app has a live API route (`/api/sessions`) plus a `"use client"` interactive homepage (`app/page.tsx`) that fetches from it — this **requires a Node.js server runtime** (`next start` or equivalent). It is **not** static-export-compatible as currently built.
- **Rendering model:** `app/page.tsx` is a client component; data loading happens via a client-side `fetch("/api/sessions")` call at runtime, not at build time. `data/canonical/*` and `data/facility-locations/latest.json` are read from disk **per request** inside the API route handler (`readFileSync`, confirmed in `lib/dropin/snapshot/io.ts`) — not embedded into the build via static import. (The one exception is the Toronto fallback, which *is* build-time `import()`-ed, per §3/§8.)
- **Persistent storage requirement — the most important item in this section:** because canonical/raw snapshot data is read from the live filesystem at request time rather than baked into the build, the hosting environment **must provide a persistent, writable-by-the-refresh-process, readable-by-the-server-process filesystem** that both the running app and the refresh scripts share. A purely ephemeral/read-only serverless filesystem model would not work as this app is currently architected without either (a) a persistent volume, or (b) moving snapshot storage to an external store (e.g., object storage or a database) — a real architectural decision for the next phase, not resolved here.
- **Environment variables:** **none required today** — zero `process.env` usage anywhere in the codebase (§2). Deployment can proceed with zero secret/config setup as of this audit.
- **Build command:** `next build`. **Start command:** `next start`.
- **Node version:** no `engines` field is set in `package.json`; `@types/node: "^20"` suggests a Node 20+ development target, but this is not an enforced runtime constraint. The next phase should pin an explicit `engines.node` range once a host is chosen.
- **Scheduled refresh:** required for the product to stay current (daily municipal data refresh) — not yet implemented (§11), but any host chosen must support either a built-in cron/scheduled-job feature or accept an externally-triggered refresh.
- **HTTPS / custom domain:** both are standard hosting-provider concerns, not something this codebase constrains one way or the other; `getdropin.ca` readiness depends entirely on whichever host is chosen next.
- **`tsx` (a devDependency)** is required to run the refresh scripts (`npm run refresh:data`, `refresh:facilities`, `snapshot:health`) — a minimal production install (`npm install --omit=dev`) would **not** include it. Whichever environment runs the daily refresh needs either a devDependency-inclusive install or a separate execution context from the production server install. This is a concrete requirement for §11/next-phase planning, not a security defect.

---

## 11. Daily Data Refresh — Security Preparation Only (not implemented)

**What would run:** `scripts/refresh/index.ts` (orchestrates per-municipality PerfectMind/ActiveCommunities fetch + normalize + snapshot activation) and `scripts/refresh/facility-locations.ts` (geocodes/reuses facility coordinates via Nominatim). Both are plain Node/`tsx` scripts with no daemon, no listening port, and no network-facing surface of their own.

**Permissions required:** filesystem read/write access to `data/raw/`, `data/canonical/`, and `data/facility-locations/` under the app's data root — nothing else. No elevated OS permissions, no access to anything outside the app's own data directory. Confirmed via source read that all paths derive from `DATA_ROOT = path.join(process.cwd(), "data")` (§8) — the scripts cannot be pointed elsewhere.

**Local-only path dependency:** none found — same `process.cwd()`-relative pattern as the rest of the app (§8, §10). The scripts are portable to any host with the same directory layout.

**What files get written:** new raw snapshots under `data/raw/<slug>/`, new canonical snapshots under `data/canonical/<slug>/`, and an updated `data/facility-locations/latest.json` — all already-gitignored, already understood as generated data (§1).

**Safety of running in hosted infrastructure:** conditionally safe — contingent entirely on the §10 persistent-storage requirement being met. If the refresh process and the live server process don't share the same persistent filesystem, refreshed data would never reach production traffic (or worse, each request-serving instance could diverge). This is an architecture decision for the next phase, not a defect in the scripts themselves.

**Failure/corruption risk:** `LocalFilesystemSnapshotStorage` (`lib/dropin/snapshot/io.ts`) already writes via a temp-file-then-rename pattern (`renameSync`, confirmed at line 34 area) — this is an atomic-replacement pattern, meaning a failed/partial write should not corrupt the previously-activated snapshot. `readJsonIfExists` has no internal try/catch around `JSON.parse` (confirmed, lines 32–35) — a malformed JSON file would throw, but this is already caught one layer up by `getAllSessions()`'s `Promise.allSettled` (§5, §9), so a corrupted canonical file for one municipality degrades to "that municipality returns no sessions" rather than crashing the whole app.

**Previous-known-good availability:** the snapshot format already tracks a `previous` snapshot (referenced in `scripts/snapshot-health.ts` output, `entry.previous`) — the underlying design already supports "keep the last good snapshot available," though this audit did not trace the full activation/rollback logic in enough depth to certify it end-to-end; that would be worth a focused pass in the scheduler-implementation phase itself.

**Recommended minimal architecture (recommendation only, not built):** run refresh as a scheduled job with access to the *same* persistent volume the app server reads from; keep the existing atomic-rename activation pattern; do not change `readJsonIfExists` unless the next phase specifically wants to convert a malformed-snapshot failure into a more visible alert rather than a silent per-municipality exclusion (currently: silent exclusion + server log line, per §9 — appropriate for launch, worth revisiting once real monitoring exists).

---

## 12. Personal/Project Separation Audit

- **No personal email addresses in app-facing code.** `lib/dropin/contact.ts` correctly centralizes the two public project addresses (`hello@getdropin.ca`, `feedback@getdropin.ca`) that route through Cloudflare Email Routing to a private inbox. That private inbox address deliberately does **not** appear in source code or rendered output — confirmed by the code's own comment and by a repo-wide grep finding zero occurrences in `app/`, `lib/`, or any `.tsx`/`.ts` file.
- **One real finding:** `docs/LAUNCH_READINESS_1B_TRUST_PRIVACY_FEEDBACK_IMPLEMENTATION.md:92` names the private destination inbox directly — `getdropin.team@gmail.com` — while documenting that it correctly does *not* appear in source/output. This doc file is git-tracked, and the repository has a GitHub remote (`https://github.com/qw-1YG3/dropin.git`). **This audit could not verify the visibility (public/private) of that GitHub repository** — no `gh` CLI is available/authenticated in this environment. This matters directly: if the repo is currently public, this is a **live exposure today**; if private, it's a landmine for whenever the repo is later made public (e.g., a Vercel-style deploy-from-public-repo flow, or open-sourcing). **Classified P1 pending visibility confirmation** — treat as P1 until confirmed private, then P2 (fix before ever making the repo public). Recommended fix either way: redact/generalize that one line (e.g., "the private forwarding destination") — small, low-risk, directly related to this exact finding, and explicitly documented here per this audit's fix policy. **Not applied in this audit** — reported for the user to action, since it wasn't unambiguously "P1 confirmed" without the visibility check.
- `next.config.ts`'s `allowedDevOrigins: ["192.168.18.4"]` is a real developer-LAN-IP-in-source finding, but confirmed via official Next.js docs (§ prior session investigation, `node_modules/next/dist/docs/.../allowedDevOrigins.md`) to be dev-server-only with zero effect on `next build`/`next start` production behavior. **P3 — cosmetic**, worth removing on general cleanup grounds (a machine-specific value with no purpose in the shipped product) but zero security impact.
- No developer name, no local username, no personal cloud/storage paths (e.g., iCloud/Dropbox paths), and no personal API accounts were found anywhere in tracked source — confirmed via repo-wide grep for the developer's name/username and for `/Users/` paths, both returning zero matches outside the one `.next/required-server-files.json` build artifact already assessed in §8 as non-exposed. `package.json` has no `author` field to assess (none present, not a finding).
- This audit did **not** find or remove any legitimate authorship information, since none exists in a form this audit would need to distinguish from accidental exposure — there was nothing to preserve or redact on that front.

---

## 13. Findings Summary (P0–P3)

**P0 (blocks public deployment): none found.**

**P1 (should fix before launch):**
1. **`app/design/*` route tree is fully public, unauthenticated, and indexable in a production build.** Six design-review pages plus an index (`app/design/page.tsx`) that self-describes as "temporary review environments... not production routes" have no guard preventing them from being built and served in production. Recommended remediation options (not implemented — architectural choice, not a "clearly necessary, low-risk" mechanical fix): (a) delete/move the `app/design` directory out of `app/` before a production build, (b) gate it behind a build-time `NODE_ENV`/env-flag check that 404s in production, or (c) add `robots.txt`/`noindex` plus basic auth if it needs to stay reachable for review purposes. This is a decision for the user, not something to auto-resolve.
2. **Private inbox address in `docs/LAUNCH_READINESS_1B_TRUST_PRIVACY_FEEDBACK_IMPLEMENTATION.md:92`, repo visibility unverified.** Confirm whether `github.com/qw-1YG3/dropin` is public or private. If public, this is a live exposure today. Recommended fix: redact the literal address in that doc line, regardless of visibility outcome.

**P2 (recommended improvement, non-blocking):**
- `registrationStatus` field ships in every `/api/sessions` response despite being explicitly internal-only in source comments — add a response-shaping/allowlist step (§3).
- ActiveCommunities `officialUrl` is unvalidated upstream passthrough rendered as a live `<a href>` — add an `https:`-only scheme check before rendering (§6).
- `npm audit` high-severity transitive findings (`nanoid`, `postcss`, `next`, `sharp`) — real-world exploitability is low today (build-time-only or unreached `next/image` code path), but the `next` version bump should happen in the next phase rather than indefinitely (§7).

**P3 (future hardening):**
- Wrap `app/api/sessions/route.ts` in an explicit try/catch for a controlled error response, rather than relying solely on `Promise.allSettled` isolation plus Next.js's default production error page (§5, §9).
- Remove `allowedDevOrigins: ["192.168.18.4"]` from `next.config.ts` on general cleanup grounds — zero production impact, but a machine-specific value with no purpose in shipped code (§12).
- Once a host is chosen, ensure refresh-script log output (which can include filesystem error messages/paths, §9) lands in a log sink with appropriate access control — not a code change, a hosting-configuration item for §11's next phase.

---

## Required Closing Answers

**A. Overall security status:** No secrets, credentials, or personal-computer file exposure exist anywhere in the codebase or its build output. Geolocation handling is provably privacy-preserving. The architecture is sound. Two P1 issues exist and must be resolved before public launch — neither involves a secret or user-data leak, but both are real, verified exposures of internal-only content (design mockups; one internal email address) that this audit's own primary goal explicitly asked to check for.

**B. P0 blockers:** None.

**C. P1 pre-launch fixes:** (1) `app/design/*` route tree must be excluded from the production build or otherwise gated — see §13 for options. (2) Confirm GitHub repo visibility and redact the private inbox address in `docs/LAUNCH_READINESS_1B_TRUST_PRIVACY_FEEDBACK_IMPLEMENTATION.md:92` regardless of the outcome.

**D. P2/P3 recommendations:** See §13 in full — five items, none blocking, all documented with rationale.

**E. Secrets/credentials status:** Clean. Zero `process.env` usage, zero `.env` file, zero hardcoded secrets found in current tree or across 56 commits of git history.

**F. Personal-computer exposure status:** No visitor to a deployed instance can reach files elsewhere on the developer's machine. The only local-machine-path artifact (`required-server-files.json`'s build metadata) is server-internal, never routed to any client, and is itself just a reflection of wherever the build runs.

**G. Geolocation privacy status:** Clean, freshly re-verified independent of prior audits. Coordinates are provably confined to browser memory — never stored, never logged, never transmitted, never reflected into a URL or Share payload. Current Privacy copy remains technically accurate.

**H. API/server exposure status:** One API route exists (`/api/sessions`), takes zero input, has no path-traversal surface, and has a working (if not independently stress-tested) failure-isolation mechanism. The real server-surface finding is the accidental `app/design/*` route tree becoming production-reachable (P1, item C.1).

**I. Production build status:** Build succeeds cleanly. No secrets, no local paths, no raw/private files in client-facing output. No source maps ship to the client. The one local-path artifact is server-internal and non-exposed.

**J. Dependency status:** Minimal, correctly-separated production dependencies (`next`, `react`, `react-dom` only). `npm audit` flags 4 high-severity transitive vulnerabilities, all in build-time-only or unreached code paths today — recommended but not urgent to address via a `next` version bump in the next phase.

**K. Daily-refresh readiness:** Scripts are portable, machine-agnostic, and use an atomic-write pattern with existing failure isolation. Safe to run in hosted infrastructure **conditional on** the host providing persistent shared storage between the refresh process and the live app server — an architectural requirement for the next phase, not a defect today.

**L. Hosting requirements:** Node.js server runtime required (not static-export-compatible); persistent shared filesystem required for snapshot data; zero environment variables required today; standard `next build`/`next start` commands; cron/scheduled-job capability needed for the daily refresh; HTTPS/custom-domain support depends entirely on the host chosen next. Full detail in §10.

**M. Exact files changed during this audit:** **One file created** — `docs/SECURITY_DEPLOYMENT_AUDIT.md` (this document). **No other files were modified.** No source code, configuration, or data files were changed. The one prior candidate fix considered (URL scheme validation, §6) was explicitly deferred and reported rather than applied, per this audit's fix policy.

**N. Recommended next action:** Because P1 issues exist, **this audit does not clear the project for hosting/scheduler planning yet.** Per the audit's own instructions, work stops here: resolve C.1 (exclude or gate `/design`) and C.2 (confirm repo visibility, redact the inbox address), then re-run a focused re-check of just those two items before proceeding to hosting selection, scheduler implementation, domain connection, or any deployment step.
