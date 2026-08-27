# Phase 5B — `/api/sessions` Response-Size Architecture

**Status (update, 2026-08-27): combined-object layer LIVE VERIFIED; presigned-URL redirect LIVE VERIFIED; client-side read-time filtering LIVE VERIFIED end-to-end in a real browser, including the R2 bucket CORS fix. The 4.5MB Vercel Function response-size blocker is now fully resolved for real browsers, not just in theory.** This document records the decision, all three implementation checkpoints, and their live verification evidence.

---

## 1. The Problem

`/api/sessions` returns the full session set in one response — a deliberate architectural choice, not an oversight, since DropIn's search-first UX (instant, client-side, forgiving search across activity/municipality/postal code/centre) depends on the client already holding the complete dataset in memory, with zero network round-trips per search interaction. Measured against real, fully-migrated data (all 7 municipalities): the response is **28.5MB uncompressed**, against Vercel's documented 4.5MB Function response limit (confirmed live via Vercel's own docs during the Phase 5A/5B-1 preflight work).

## 2. Decision: Option D — R2-backed delivery via short-lived presigned URL

Evaluated against server-side filtering, municipality-scoped loading, a lightweight-index-plus-detail-fetch model, and pagination — all rejected for degrading the product's core instant/forgiving-search experience (full evaluation was reported in chat this phase, not duplicated here). **Approved**: `/api/sessions` will redirect to a short-lived, read-only presigned R2 URL for a combined "all municipalities" object, bypassing the Vercel Function response path entirely — the client keeps receiving the same full dataset it does today, just delivered through a path that was never subject to the 4.5MB limit.

**Explicitly not relying on response compression** to solve this — Vercel's own documentation doesn't confirm whether the 4.5MB limit is measured pre- or post-compression, and Vercel's own troubleshooting guidance for this exact limit recommends reducing response size, streaming, or external storage — not compression. Betting production correctness on an unconfirmed platform behavior was explicitly avoided.

**Presigned URL, not a public bucket/object** — refines Phase 5A §4's original "public object" sketch specifically so the R2 bucket's existing "zero public access, of any kind" posture (Phase 5B-2A's approved architecture) doesn't need to change at all. The read-only credential generates the presigned URL (a local cryptographic operation); the bucket itself never becomes publicly readable.

**Field trimming**: fields with zero measured client references — `projectedOccurrenceId`, `sourceScheduleId`, `category`, `dayOfWeek`, `day`, `registrationStatus` — are dropped from the combined object only. No other field is touched. This was a real, measured finding (not a guess): these six fields together account for roughly 18% of the response's field-value bytes, confirmed by direct byte-level measurement against real data.

**Framing, explicitly preserved**: this is the Production v1 delivery architecture for the current ~44,000-session dataset, not a claim that shipping the full dataset to the browser remains correct at arbitrary future scale. If dataset growth later makes the initial browser payload itself a UX problem (not merely a Vercel Function limit), that's a separate evaluation, to be made with real production performance evidence — not decided speculatively now.

## 3. Implementation Sequence

1. ✅ **Combined-object generation** (`scripts/refresh/build-combined.ts`) — LIVE VERIFIED (§4).
2. ✅ **Presigned-URL generation + `/api/sessions` redirect** — LIVE VERIFIED (§5).
3. ✅ **Client-side `hasEnded` filtering parity** (`app/page.tsx`) — implemented, parity-VERIFIED against real production data, and LIVE-VERIFIED end-to-end in a real browser (§6).
4. ✅ **Wired into the automatic daily GitHub Actions refresh** (`.github/workflows/daily-refresh.yml`) — no longer manual-only. Full implementation and live verification: `docs/PHASE_5B3_DAILY_REFRESH_SCHEDULER.md` §8.
5. ✅ **R2 bucket CORS policy** — applied by the project owner (exact policy specified in §6, applied outside this codebase via the Cloudflare dashboard); re-verified live this checkpoint (§6).

**The 4.5MB Vercel Function response-size limit is structurally bypassed** (§5) — `/api/sessions` no longer transfers the ~33MB payload through the Function's own response body under any circumstance. **Client-side filtering is implemented and parity-correct, and the full path has now been LIVE VERIFIED end-to-end in a real browser** (§6) — the overall user-facing blocker is resolved.

## 4. Combined-Object Generation — Implementation and Live Verification

**File**: `scripts/refresh/build-combined.ts` (new), plus two new path helpers in `lib/dropin/snapshot/paths.ts` (`combinedLatestPath`/`combinedPreviousPath`, following the exact existing convention) and a new `build:combined` npm script. Nothing else changed — `/api/sessions`, `app/page.tsx`, and the daily refresh workflow are all byte-for-byte unchanged.

**Design**: reads each of the 7 municipalities' *currently active* canonical snapshot (`canonicalLatestPath(slug)`, via the existing write/refresh credential, which already includes read access) — never a new fetch. Re-validates each municipality's source data with the existing `validateCanonicalSessions()` gate *before* trimming (trimming removes `sourceScheduleId`, one of that validator's own required fields, so validating after trimming would produce false failures). Applies the six-field trim via an explicit allowlist (not a denylist), assembles the combined array plus a small metadata block (generation time, per-municipality counts, any municipality excluded entirely), and writes it to `canonical/_combined/latest.json` via the same atomic rotate-then-promote `writeAtomic()` every other snapshot layer already uses.

**Last-known-good, by construction**: because this step reads each municipality's *currently active* `latest.json` — which, by the already-proven daily-refresh behavior (Phase 5B-3), is always the last successfully-validated snapshot — a municipality whose most recent refresh failed simply contributes its last good data automatically. No special-case failure handling was needed in this script at all. **Proven live, not just reasoned about**: Aurora — whose daily refresh has been failing on its own Completion Gate since Phase 5B-3's first live run — correctly contributed its existing 170-session last-known-good snapshot to the combined object, unchanged.

**Live verification performed against real R2** (not mocked, not local):
- Write, via the write-only refresh credential: succeeded, 44,111 sessions across all 7 municipalities.
- Independent read-back, via the **read-only** application credential specifically (not the credential that just wrote it) — proves the credential the eventual presigned redirect will actually use can see the object, under the same shared production prefix.
- Zero-removed-field check across all 44,111 sessions: confirmed clean.
- Required-field presence check across all sessions — see the honest note below.
- Session-count cross-check against each municipality's current direct R2 snapshot: exact match, all 7, zero discrepancy.
- Zero duplicate session IDs across the combined 7-municipality set.

**Honest data-quality note, not a defect in this step**: two fields show partial "emptiness" across the combined set — `district` is a real, non-empty value only for Toronto (every other municipality's canonical data has always carried an empty string there — confirmed via a fresh investigation this phase, `district` is a *required*, always-present key on every session, just empty-string-valued for 6 of 7 municipalities); `officialUrl` is entirely absent (key not present) for Toronto specifically (24,791/24,791), and present with a real value for all 6 other municipalities. Both are **pre-existing characteristics of the source normalization already in place**, confirmed by tracing the exact values copied verbatim from the existing canonical snapshots — this step didn't touch either field's value, only copied it through. `officialUrl` being sometimes absent is explicitly anticipated by the `Session` type's own header comment ("officialUrl... optional because most current sources (Toronto included) don't publish all of them"). Neither is a regression introduced here.

## 5. Presigned URL + `/api/sessions` Redirect — Implementation and Live Verification

**Files**: `lib/dropin/snapshot/io.ts` (new `R2SnapshotStorage.getPresignedReadUrl()` method + a new exported `createPresignedReadUrl()` helper), `app/api/sessions/route.ts` (branches on `isR2StorageMode()`), `package.json`/`package-lock.json` (new dependency, `@aws-sdk/s3-request-presigner`, exact-pinned `3.1118.0` to match the already-installed `@aws-sdk/client-s3`). Nothing else changed — `app/page.tsx`, `search-intent.ts`, the daily refresh workflow, `build-combined.ts`, and R2 bucket access settings are all untouched.

**Design**: `getPresignedReadUrl()` reuses the exact `S3Client` and bucket/prefix configuration `R2SnapshotStorage` already has (no second client, no duplicated credential logic) and calls `@aws-sdk/s3-request-presigner`'s `getSignedUrl()` — a local cryptographic operation, no network call, no read of the object's actual bytes. `createPresignedReadUrl()` obtains its storage instance via the existing `createAppReadStorage()` — meaning it goes through the *exact same* read-only-credential construction every other application read already uses; there is no separate, parallel credential path introduced for this feature. `/api/sessions` now branches: in R2 mode, it generates a presigned URL for `canonical/_combined/latest.json` and returns `NextResponse.redirect(url)` — deliberately never calling `getAllSessions()` or reading the object's bytes into the Function at all. In local filesystem mode (the default, `SNAPSHOT_STORAGE` unset), behavior is byte-for-byte unchanged from before this phase.

**Expiry: 300 seconds (5 minutes).** A fresh URL is generated on every request — never cached, never reused across requests — so the expiry only needs to comfortably outlast one real download. 300s covers even a slow mobile connection (~1 Mbps) completing a ~33MB download (≈3.5 minutes) with real margin, while remaining unambiguously short-lived.

**A real, unplanned discovery this checkpoint, worth recording**: Next.js's own `next build`/`next start` automatically load `.env.local` — unlike the standalone `tsx` scripts used elsewhere in this project, which require an explicit `--env-file` flag. Since `.env.local` now permanently contains `SNAPSHOT_STORAGE=r2` (set during Phase 5B-2B's credential configuration), **every plain `next build`/`next start` invocation from that point on has been running in R2 mode automatically**, not local mode, unless `.env.local` is deliberately set aside first. This was caught immediately when a "local mode" regression check unexpectedly returned a redirect instead of JSON — the true local-mode check was then re-run correctly with `.env.local` temporarily moved aside and confirmed passing (§ Final Report, H). Worth keeping in mind for any future verification step in this project that needs to distinguish the two modes via `next build`/`next start` specifically.

**Live verification performed against real, deployed-shape R2 data** (a real running `next start` server, not a script, not mocked):
- `/api/sessions` in R2 mode: `HTTP 307`, **0-byte response body**, real `Location` header pointing at a genuine R2 presigned URL with `X-Amz-Expires=300` — confirming the chosen expiry actually reached the real signed URL.
- Followed the redirect target directly: `HTTP 200`, real combined data, **44,111 sessions** — exact match to §4's checkpoint, confirming the combined object was correctly left untouched by this step, as instructed.
- Simulated the browser's actual behavior (`curl -L`, which follows redirects the same way `fetch()` does): end-to-end `HTTP 200`, 44,111 sessions — confirms the whole path works, not just its two halves in isolation.
- **Presigned-URL scope, proven empirically, not just asserted**: took the real presigned URL and substituted a different real object key (`canonical/aurora/latest.json`) into it while keeping the same signature — R2 rejected it with `403 SignatureDoesNotMatch`. This is a genuine cryptographic proof that the signature is bound to the exact key it was issued for and cannot be repurposed to read any other object in the bucket.
- Client bundle re-checked after a fresh build: zero traces of the AWS SDK, the presigner package, or any credential/variable name.

**On the Access Key ID appearing inside the presigned URL** — worth stating precisely rather than leaving ambiguous: AWS SigV4 presigned URLs necessarily include the Access Key ID (as `X-Amz-Credential`) as part of how the receiving server verifies the signature. This is standard, expected, and not a secret exposure — the Secret Access Key itself is never included anywhere in the URL, is not derivable from it, and the signature cannot be reused for a different object or after expiry (proven above). This is the same trade-off every presigned-URL-based system accepts by design, not something specific to or weaker in this implementation.

## 6. Client-Side Read-Time Filtering — Implementation, Parity Verification, and a Blocking CORS Finding

**File**: `app/page.tsx` only. No other file changed this checkpoint.

**Server-side semantics identified** (from `lib/dropin/sources/index.ts`'s `applyReadTimeView`, read in full, not assumed): for each session, exclude it if `hasEnded(new Date(s.endDateTime), now)` — `lib/dropin/time.ts`'s `hasEnded(end, now) { return end.getTime() <= now.getTime(); }`, a **boundary-inclusive** exclusion (a session ending at exactly `now` is excluded). A `days`/rolling-window option exists in `applyReadTimeView` but `app/api/sessions/route.ts`'s local-mode call passes no options, so it's never exercised in production — not ported. The server also attaches a `legacyDay` label per session; confirmed (repeated grep, this and prior checkpoints) it has zero frontend consumers and is already one of the six fields `build-combined.ts` trims from the object — not ported, since replicating it would be pure dead code.

**Client-side implementation**: the existing `fetch("/api/sessions")` `useEffect` now filters once, at fetch-resolution time, against a freshly-taken `now`, before the result ever reaches `sessions` state:

```ts
fetch("/api/sessions")
  .then((res) => res.json())
  .then((data: { sessions: Session[] }) => {
    if (cancelled) return;
    const now = new Date();
    setSessions(data.sessions.filter((s) => !hasEnded(new Date(s.endDateTime), now)));
    setLoading(false);
  });
```

**Zero logic duplication**: reuses the exact shared `hasEnded` from `lib/dropin/time.ts` (pure, dependency-free, already safe for client code — no `fs`/env/network usage). No reimplementation of the exclusion rule anywhere.

**A real subtlety this checkpoint had to get right**: `app/page.tsx` already had a `liveSessions` `useMemo` that re-filters by `computeStatus !== "ended"` every 30 seconds — but that memo is *not* what feeds search. `parseQuery(committedQuery, sessions)` reads the raw `sessions` state directly. Filtering only `liveSessions` and leaving `sessions` unfiltered would have left ended sessions fully searchable — wrong. Filtering `sessions` itself at fetch time (mirroring the server's original "filter once, at read time" semantic) fixes this with zero changes to `liveSessions` or any other existing consumer (`parseQuery`, `sessions.find`, `sessions.some` — all continue working unchanged, since they now simply receive pre-filtered data, exactly as before this phase).

**Parity verification** (synthetic + real production data, comparing old server-logic replica vs. new client-logic replica at the same reference time): 7 synthetic boundary cases (ended 1 min before now, ended exactly now [boundary-inclusive], ends 1 min after now, yesterday, today, tomorrow, a midnight-adjacent case) — all matched. One AM/PM-titled session case confirmed zero interaction with Phase 3.6D's display-normalization logic. Full real-data comparison: **44,111 raw combined sessions → 37,670 post-filter on both sides**, exact ID-set match, zero sessions incorrectly retained, zero incorrectly removed. All checks passed on first run.

**`tsc --noEmit`**: clean. **`npm run lint`**: 21 problems (16 errors, 5 warnings) — identical to the documented pre-existing baseline across every prior checkpoint this session; zero new regressions. **Client bundle** (`.next/static/`, fresh build): grepped for `R2_WRITE_ACCESS_KEY_ID`, `R2_WRITE_SECRET_ACCESS_KEY`, `R2_READ_SECRET_ACCESS_KEY`, any `AKIA*` pattern, and the literal read access-key-ID value — zero matches, as expected, since presigned-URL generation stays entirely server-side.

**Real end-to-end browser test — blocked by a genuine infrastructure gap, not a code defect.** A local `next start` server in R2 mode, loaded in a real Chrome tab via `claude-in-chrome`:

- Homepage loaded, UI shell rendered, placeholder-text rotation confirmed the page was hydrated/interactive.
- The "Activities near you" section never left its loading-skeleton state. Console showed `TypeError: Failed to fetch` — the browser's signature for a CORS-blocked response, not an HTTP error status.
- Direct reproduction: `curl -X OPTIONS` against the real presigned R2 URL with `Origin: http://localhost:3940` → `403 Forbidden`. Direct `curl GET` against the same URL with the same `Origin` header → `200 OK` but **no `Access-Control-Allow-Origin` header** in the response.
- Root cause: **the R2 bucket has no CORS rule permitting browser requests from the app's origin.** `curl -L` (Checkpoint 2's verification method) never exercises this, because CORS is enforced only by browsers, on the *final* destination of a followed redirect — which is exactly the presigned R2 URL, a different origin than the app.
- This is not a defect in the redirect or the filtering logic — both reconfirmed correct via fresh `curl` during this checkpoint. It's a missing bucket-level configuration, outside what the app's two existing object-scoped credentials (read-only, write-only) can change; bucket CORS is a Cloudflare account/bucket-admin setting.

**Exact CORS policy applied** (Cloudflare R2 dashboard → bucket → Settings → CORS Policy — applied by the project owner, not this codebase):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "http://localhost:3940",
      "https://getdropin.ca",
      "https://www.getdropin.ca"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

**Not yet known**: the Vercel-assigned `*.vercel.app` URL, since no deployment has happened yet — must be added to `AllowedOrigins` once a Vercel project exists, before relying on R2 mode there.

### CORS fix — re-verified live

Direct reproduction, repeated after the policy was applied: `curl -X OPTIONS` against a fresh presigned R2 URL with `Origin: http://localhost:3940` → `204 No Content`, with `Access-Control-Allow-Origin: http://localhost:3940`, `Access-Control-Allow-Methods: GET`, `Access-Control-Max-Age: 3600` all present. The actual `GET` with the same `Origin` → `200 OK`, `Content-Length: 33263115`, `Access-Control-Allow-Origin: http://localhost:3940` present. Both were `403`/missing-header before the fix — this is a genuine before/after confirmation, not an assumption.

### Real end-to-end browser test — completed, in a fresh Chrome tab (not the tab that had shown the earlier CORS failures, to eliminate any doubt about stale state)

- **Homepage loads**: real content rendered — no skeletons, no `Failed to fetch`. `/api/sessions` → `200` in the browser's own network log (redirect followed transparently, exactly as `fetch()`'s spec-defined behavior predicts); the R2 URL request completed.
- **Console**: zero errors traceable to the app's own bundled code across the entire test session. The only console entries observed (`Cannot read properties of undefined (reading 'merchant')`, repeating on an unrelated timer) come from an installed Chrome extension (matching the `chrome-extension://efaidnbmnnnibpcajpcglclefindmkaj/...` — Adobe Acrobat extension — entries already present in the network log), not from any `/_next/static/chunks/*` file this app ships. No `Failed to fetch` occurred anywhere in this test run.
- **A genuine, honest observation, not a bug**: at the time of testing (~11:44 PM local), "Today" returned **0 activities** for every municipality tried (Markham, Toronto, unfiltered "near you") — this is the client-side `hasEnded` filter working *correctly*: real community-centre drop-in programs end by ~9–10 PM, so by 11:44 PM every one of today's sessions has legitimately ended. Switching to **tomorrow** immediately produced real results (1330 activities city-wide, 92 in Markham, 21 Badminton-filtered in Toronto), confirming the zero-today count was a correct time-of-day filtering outcome, not a data-loading failure — corroborated by the parity test's earlier, time-independent 44,111→37,670 result.
- **Search**: typo query `"swiming"` (missing second letter) correctly matched the "Swim" activity family and surfaced its real subtype chips (Adapted Leisure Swim, Lane Swim, Leisure Swim: Preschool, …) — forgiving search confirmed working against the redirect-delivered, client-filtered dataset.
- **Municipality/location search**: `"markham"` and `"toronto"` both correctly resolved to their respective municipality context (`Activities in Markham` / `Activities in Toronto` headers, location pill updated) and scoped results accordingly (92 Markham / 855 Toronto activities for tomorrow, "All" activities).
- **Result-card rendering**: real cards rendered with correct activity name, date/time, venue name (including a long apostrophe-containing real facility name, "Ethennonnhawahstihnen' Community Recreation Centre and Library" — a good incidental Unicode/rendering check), price range, and age range.
- **Detail modal**: opened correctly from a card click — full address, price, age range, "Pre-registration required", Directions/Register/Share actions, and source attribution ("Updated today · City of Vaughan Recreation (PerfectMind)") all rendered.
- **Sort/filter**: activity chips (Badminton, Swimming, Pickleball, Basketball, …), the day-of-week date strip (Today through 7 days out), Morning/Afternoon/Evening time-of-day sub-filters, the "Nearest first" sort control, and the list/grid view toggle were all present and interactive, producing correctly updated counts and results on each change.
- **30-second `liveNow` behavior**: the underlying mechanism (`liveSessions` `useMemo`, unchanged this checkpoint) could not be observed transitioning a session from live to ended in real time during this test window, because no session's actual end boundary fell within the minutes tested (consistent with the "everything already ended for today" finding above). This is reported honestly as **not directly observed**, not as verified — its correctness rests on (a) the code being completely unmodified from before this phase, and (b) the initial fetch-time `hasEnded` filter being independently proven exactly correct by the parity test.

Checks 2–10 of the required end-to-end verification are now complete, with the one exception noted above (30-second live-transition, not independently observable in this window).

---

## Final Report — Checkpoint 1 (Combined-Object Generation)

**A. Exact files changed:** `lib/dropin/snapshot/paths.ts` (2 new path helpers), `package.json` (1 new script), `scripts/refresh/build-combined.ts` (new). `/api/sessions`, `app/page.tsx`, the daily refresh workflow, R2 bucket access settings, and all credentials are unchanged.

**B. Combined-object generation design:** §4 above — reads current per-municipality snapshots via the refresh credential, re-validates before trimming, trims via explicit allowlist, writes via the existing atomic promotion mechanism.

**C. Live R2 write/read verification result:** Both performed for real. Write: 44,111 sessions, all 7 municipalities, via the write-only credential. Read-back: via the separate read-only credential, confirmed matching content.

**D. Session counts:** Toronto 24,791; Mississauga 15,564; Richmond Hill 213; Vaughan 646; Markham 817; Newmarket 1,910; Aurora 170 (last-known-good, refresh currently failing). **Total: 44,111.** Cross-checked against each municipality's current direct R2 snapshot: exact match, zero discrepancy — the higher total vs. earlier session measurements reflects real, successful municipality refreshes that happened via the live daily-refresh workflow between then and now, not an error.

**E. Raw and gzip size:** Raw: 26.36MB (measured on the live object, differs slightly from the frontend's own 28.5MB measurement because this excludes the six trimmed fields and reflects the current, evolved dataset rather than the earlier snapshot). Gzip: 1.03MB — **informational only**, not relied upon for the size-limit decision, consistent with §2's explicit reasoning.

**F. Removed-field verification:** Confirmed clean across all 44,111 sessions, not just a sample — zero occurrences of any of the six removed fields anywhere in the object.

**G. Required-field verification:** All confirmed-essential fields (`id`, `activity`, `date`, `absoluteTime`, `startMinutes`, `startDateTime`, `endDateTime`, `centre`, `municipality`, `officialSource`, `lastUpdated`, `verificationStatus`) present on every session. Two fields (`district`, `officialUrl`) show partial emptiness — traced precisely and confirmed to be pre-existing source-data characteristics unrelated to this implementation step, not a regression (§4's honest note).

**H. Last-known-good behavior:** Confirmed live, not merely by design — Aurora's currently-failing daily refresh did not remove it from the combined object; its last-known-good 170-session snapshot was correctly included, with zero special-case code required to achieve that.

**I. Security/credential verification:** Write used only the refresh (write-capable) credential; the independent verification read used only the application's read-only credential — confirmed via direct code inspection, not merely assumed. `createRefreshStorage` remains absent from every file under `app/` and `lib/dropin/sources/` (fresh grep, unchanged from prior phases). Zero credential/SDK traces in a freshly-rebuilt client bundle. R2 bucket access configuration was not touched by this step — still zero public access.

**J. Typecheck/build/lint result:** All clean — `tsc` zero errors, `next build` succeeds with an identical route table, `lint` at the same 21 pre-existing, unrelated problems as every prior checkpoint this session. **No regressions.**

**K. Whether this implementation step is LIVE VERIFIED:** **Yes** — real write, real independent read-back via the correct credential, real cross-check against live per-municipality data, all performed against production R2, not mocked or assumed.

**L. Whether the overall 4.5MB blocker is resolved:** **No, explicitly not yet.** This checkpoint proves only the combined-object layer. `/api/sessions` still returns the full unfiltered JSON body exactly as before — nothing about the actual Vercel-facing response has changed yet.

**M. Exact next implementation step:** Implement presigned-URL generation and the `/api/sessions` redirect (§3, step 2) — the next smallest, independently-verifiable unit, deliberately still not touching `app/page.tsx` or the daily workflow.

---

## Final Report — Checkpoint 2 (Presigned URL + `/api/sessions` Redirect)

**A. Exact files changed:** `lib/dropin/snapshot/io.ts` (new method + helper), `app/api/sessions/route.ts` (rewritten to branch on R2 mode), `package.json`/`package-lock.json` (new dependency, `@aws-sdk/s3-request-presigner`). `app/page.tsx`, `search-intent.ts`, the daily workflow, `build-combined.ts`, and R2 bucket access are unchanged.

**B. Presigned URL helper design:** §5 above — a method on `R2SnapshotStorage` reusing its existing client/config, plus a top-level helper that obtains its storage instance via the existing `createAppReadStorage()` (same read-only-credential construction as every other application read, no parallel credential path).

**C. Exact expiry selected:** 300 seconds — sized to comfortably outlast one real download (even a slow mobile connection, ~3.5 minutes for ~33MB) given a fresh URL is generated per-request and never reused.

**D. `/api/sessions` redirect implementation:** In R2 mode, generates the presigned URL and returns `NextResponse.redirect(url)` without ever calling `getAllSessions()` or reading the object's bytes. In local mode, unchanged.

**E. Real R2 presigned URL verification:** Performed against a real running server and real R2 — see §5's live-verification list in full.

**F. HTTP status / Location / byte measurements:** `/api/sessions` → `307`, 0-byte body, real `Location` header with `X-Amz-Expires=300`. Redirect target → `200`, 33,263,115 bytes (the R2-stored object includes `JSON.stringify(data, null, 2)` pretty-printing, which is why this is larger than the 26.36MB compact-JSON measurement in Checkpoint 1 — same data, different serialization, not a discrepancy in content). Full `curl -L` (fetch-equivalent) → `200`, same size, 44,111 sessions.

**G. Session-count verification:** 44,111 — exact match to Checkpoint 1, confirming the combined object was correctly left untouched by this step.

**H. Local filesystem regression check:** Initially produced a false result (a redirect instead of JSON) because Next.js auto-loads `.env.local`, which now permanently contains `SNAPSHOT_STORAGE=r2` — caught immediately, re-tested correctly with `.env.local` temporarily moved aside, confirmed **PASS**: real JSON, `200`, all 7 municipalities, unaffected by this change. Documented in §5 as a real discovery relevant to future verification steps.

**I. Credential/security verification:** Write path unchanged (still write-credential-only, untouched by this checkpoint). Read/redirect path uses only the read-only credential, confirmed by code inspection. Presigned URL empirically proven scoped to its exact object key — a substituted key was rejected with `403 SignatureDoesNotMatch`, real cryptographic proof, not an assumption. R2 bucket access configuration unchanged — still zero public access. Client bundle re-checked clean after a fresh build.

**J. Typecheck/build/lint result:** All clean — `tsc` zero errors, `next build` succeeds with an identical route table, `lint` at the same 21 pre-existing, unrelated problems. No regressions.

**K. LIVE VERIFIED status:** **Yes** — real redirect, real presigned URL, real target fetch, real scope-limitation proof, all against production R2 and a real running server, not mocked.

**L. Whether the 4.5MB Vercel Function response-size problem is structurally bypassed:** **Yes.** `/api/sessions` no longer transfers the large payload through the Function's own response body under any code path in R2 mode — confirmed by the measured 0-byte redirect response.

**M. Whether the overall user-facing blocker is resolved yet:** **No.** The redirect target is today's raw combined object — unfiltered, no `hasEnded` exclusion, no fresh `day` label — and `app/page.tsx` has not been updated to compensate. Per this phase's own explicit instruction, this is not being claimed as resolved.

**N. Exact next implementation step:** Move `hasEnded`/day-label filtering into `app/page.tsx`, verified against the same data the current server-side `applyReadTimeView` produces, before the overall blocker can be considered resolved.

---

## Final Report — Checkpoint 3 (Client-Side Read-Time Filtering Parity)

**A. Exact files changed:** `app/page.tsx` only (added `hasEnded` to the existing `lib/dropin/time` import; the fetch `useEffect` now filters `data.sessions` by `!hasEnded(...)` before calling `setSessions`). No other file touched.

**B. Exact server-side semantics identified:** `hasEnded(end, now) = end.getTime() <= now.getTime()` (boundary-inclusive — a session ending exactly at `now` is excluded). The `days`/rolling-window option exists but is never exercised in production (confirmed via `route.ts`'s no-options call to `getAllSessions`). The server-attached `legacyDay` label has zero frontend consumers and is already one of the six trimmed fields.

**C. Client-side implementation:** §6 above — filters once, at fetch-resolution time, against a freshly-taken `now`, before populating `sessions` state.

**D. Shared or duplicated, and why:** Shared. Reuses `lib/dropin/time.ts`'s exact `hasEnded` — already pure and client-safe. Zero reimplementation.

**E. Parity test results:** 7 synthetic boundary cases + 1 AM/PM case, all matched. Real production data: 44,111 raw → 37,670 post-filter on both old-logic-replica and new-logic-replica, exact ID-set match, zero discrepancies either direction.

**F. Boundary-case test results:** Ended 1 min before now, ended exactly now (boundary-inclusive, correctly excluded), ends 1 min after now (correctly retained), yesterday, today, tomorrow, a midnight-adjacent case — all correct on both sides.

**G. Real end-to-end R2-mode result:** **Passing.** Once the R2 bucket's CORS policy was applied (project owner, exact policy in §6) and independently re-verified via `curl` (`OPTIONS` → `204` with correct `Access-Control-Allow-Origin`; `GET` → `200` with the header present, both previously `403`/missing), a fresh Chrome tab loaded the homepage with real rendered content, zero skeletons, zero `Failed to fetch`, and `/api/sessions` → `200` in the browser's own network log. Full detail in §6.

**H. Raw vs. post-filter session counts:** 44,111 raw combined sessions → 37,670 post-filter (Node-side parity test, real production data). In the live browser at test time (~11:44 PM local), "today" correctly showed 0 activities across every municipality tried — all of today's sessions had legitimately already ended — while "tomorrow" showed real, non-zero counts (1330 city-wide, 92 in Markham, 855 in Toronto unfiltered, 21 Toronto Badminton), confirming the filter is time-correct, not just data-complete.

**I. Client filtering performance:** Not separately instrumented in-browser (no added timing code, per the checkpoint's "smallest change" scope). Qualitatively: full navigation-to-interactive, including the ~33MB R2 download over localhost, completed within the test's few-second wait windows with no visible lag once loaded; the filter itself is a single `Array.prototype.filter` call, and the Node-side parity test measured that same operation over the same 44,111-session array as sub-second.

**J. 30-second `liveNow` behavior:** Not directly observed transitioning a session from live to ended in real time — no session's actual end boundary fell within the test window (consistent with H's finding that all of today's sessions had already ended well before testing began). The mechanism itself is unmodified code from before this phase; its correctness rests on that plus the independently-proven-correct initial filter, not on a fresh observation this checkpoint. Reported honestly as not directly observed, not as verified.

**K. Search/filter/sort/detail regression result:** **Passing.** Forgiving search (typo `"swiming"` → correctly matched "Swim" activity family and its subtypes), municipality/location search (`"markham"`, `"toronto"` both correctly resolved and scoped results), result cards (correct name/time/venue/price/age, including a real long apostrophe-containing facility name rendering correctly), detail modal (full address, price, age, registration note, Directions/Register/Share, source attribution), activity-chip filtering, date-strip navigation, Morning/Afternoon/Evening time filters, "Nearest first" sort control, and list/grid toggle — all present, interactive, and producing correct updated results.

**L. Security/client-bundle result:** Clean. Fresh-build grep of `.next/static/` for write-credential values, read-secret value, any `AKIA*` pattern, and the literal read-access-key-ID value — zero matches.

**M. Typecheck/build/lint result:** `tsc --noEmit` clean. `next build` succeeds. `lint`: 21 problems (16 errors, 5 warnings) — identical to the established baseline across every prior checkpoint. No new regressions.

**N. Whether the overall 4.5MB production blocker can now be considered fully resolved:** **Yes.** The Function-response-size problem is solved (§5), the client-side filtering logic is implemented and parity-correct (§6), and — with the R2 bucket CORS policy now applied and re-verified — a real browser has completed the full path end-to-end: fetch → redirect → R2 → client filter → search/results, with no code-level or infrastructure-level blocker remaining in this architecture.

**O. Exact next step after this checkpoint:** None required to consider this architecture resolved. Remaining, separately-tracked items from §3's checklist: wiring combined-object generation into the daily GitHub Actions workflow (step 4, still deliberately deferred), and adding the eventual Vercel `*.vercel.app` origin to the R2 CORS policy once a Vercel project exists and before relying on R2 mode there.

Stopping here, as instructed. Not deploying to Vercel. Not changing hosting configuration.
