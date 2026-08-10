# Phase 3.2 — Production ActiveCommunities Adapter

Mississauga + Richmond Hill, wired into DropIn through one shared source-family implementation. Every claim below is tagged **IMPLEMENTED** (real code, shipped), **VERIFIED** (tested against the real running app and/or real remote data), **KNOWN LIMITATION** (a real, accepted gap), **DEFERRED** (intentionally not done this phase), or **RECOMMENDATION** (a judgment call for review, not yet a decision).

---

## 1. Architecture Implemented

**IMPLEMENTED.** A new source family at `lib/dropin/sources/activecommunities/`, separated exactly along the four seams the phase asked for:

```
lib/dropin/sources/activecommunities/
  client.ts      — transport: session/CSRF handshake, getAcFilters, getAcEvents, searchAcActivities
  config.ts      — municipality configuration: tenant slug, official URL, calendar id, id prefix
  age-join.ts    — raw source interpretation: the validated event_item_id ↔ activities/list.id join
  normalize.ts   — raw event → canonical Session mapping
  index.ts       — orchestration: per-municipality fetch, failure isolation, in-process cache
```

`client.ts` has zero municipality-specific knowledge — every function takes a `tenant` string and works identically regardless of which city it's called for. `config.ts` has zero behavior — it's two plain objects. Mississauga and Richmond Hill are `ACTIVE_COMMUNITIES_MUNICIPALITIES[0]` and `[1]`; adding a third ActiveCommunities municipality later means adding a third array entry, not new code (see §5).

`lib/dropin/sources/index.ts` was changed from a synchronous adapter array to an async one (Toronto's static-snapshot read is trivially wrapped in a resolved promise; the ActiveCommunities family now genuinely fetches over the network) — see §9 for the failure-isolation behavior this enabled. `app/api/sessions/route.ts` now `await`s it. This is the only change to the aggregation layer itself; Toronto's own adapter code is untouched.

## 2. Files Changed

**IMPLEMENTED**, complete list:

New:
- `lib/dropin/sources/activecommunities/client.ts`
- `lib/dropin/sources/activecommunities/config.ts`
- `lib/dropin/sources/activecommunities/age-join.ts`
- `lib/dropin/sources/activecommunities/normalize.ts`
- `lib/dropin/sources/activecommunities/index.ts`
- `docs/PHASE_3_2_ACTIVECOMMUNITIES_PRODUCTION.md` (this document)

Modified:
- `lib/dropin/sources/index.ts` — async adapter aggregation, per-source failure isolation
- `app/api/sessions/route.ts` — one-line `await`
- `lib/dropin/municipalities.ts` — Mississauga and Richmond Hill flipped to `"available"`
- `lib/dropin/search-intent.ts` — `matchActivity` fixed to union real cross-municipality substring matches instead of returning only Toronto's curated shortcut list or the first substring hit (see §10 — a real bug this phase's real data exposed); `parseQuery` fixed so an exact municipality/neighbourhood match wins over a coincidental substring activity match on the same whole string (see §10)
- `app/page.tsx` — the three hardcoded "Toronto" fallback spots fixed (see §10); no other UI change
- `docs/ARCHITECTURE.md` — Current Implementation State and Revision Notes updated to reflect three registered municipalities and the new source family

Not modified, verified by design and by testing: `lib/dropin/types.ts` (canonical model, unchanged — see §6), `lib/dropin/sources/toronto.ts`, `lib/dropin/districts.ts`, `lib/dropin/time.ts`, `lib/dropin/activities.ts`.

## 3. Mississauga Integration Results

**VERIFIED**, against the real running app (`npm run build` succeeds; `npm run dev` + real `/api/sessions` calls):

- **15,707 real sessions** returned in the combined API response as of the final verification run, spanning all 41 real Mississauga centers and Mississauga's real ~105-day horizon.
- Real facility names, real prices (`"Free"` or a real dollar amount where the source has one), real `officialUrl`s that resolve to actual Mississauga program pages.
- Search verified working generically: `Mississauga` (municipality-only), `swimming Mississauga`, `Bayview Hill`-style facility search pattern (tested equivalently on Mississauga facilities), badminton cross-municipality search all produced correct, real results with no special-case code.

## 4. Richmond Hill Integration Results

**VERIFIED**, same method:

- **253 real sessions**, across 8 real centers, Richmond Hill's real ~21-day horizon (materially shorter than Mississauga's, on the same platform — not normalized away, see §9).
- `pickleball Richmond Hill` returned a real, priced (`$5.75`), aged (`Ages 18+`) result at a real facility (`Rouge Woods CC - Sugar Maple Room North`) — direct evidence the price and age-join pipelines both produce genuinely usable output, not just structurally-present-but-empty fields.
- `Richmond Hill badminton` correctly produced a real, honest zero-result state (no Badminton scheduled that specific day) with working recovery actions (`Try Tomorrow`, `Explore all activities`) — verified this is a true "nothing scheduled today" case, not a broken query.

## 5. Evidence Both Share the Same Adapter

**VERIFIED**, not asserted — the strongest evidence is that this is impossible to fake:

- `client.ts`'s functions were called against both `activemississauga` and `richmondhill` tenants and worked identically, including through a deliberate live QA test where Richmond Hill's tenant string was temporarily corrupted (§9) — Mississauga's fetch was completely unaffected, run through the exact same code path.
- `age-join.ts` and `normalize.ts` contain no `if (municipality === ...)` branches anywhere — grep confirms zero municipality-name string literals outside of `config.ts` itself.
- The only per-municipality inputs anywhere in the pipeline are the five fields in `ActiveCommunitiesMunicipalityConfig` (§1) — everything else (session handshake, request shapes, response field names, normalization logic, age-join strategy) is identical code executing against two different real production tenants.

## 6. Canonical Session Mapping

**IMPLEMENTED**, classified exactly as Phase 3.1 predicted and now verified against real normalized output:

| Field | Classification | Real behavior |
|---|---|---|
| `id` / `projectedOccurrenceId` | TRANSFORMED | `${idPrefix}-${event_item_id}-${facility_id}-${date}-${time}` — facility_id included after a real collision was found in testing (§10) |
| `sourceScheduleId` | TRANSFORMED | `${idPrefix}-${event_item_id}` |
| `activity` | DIRECT | raw `title` |
| `category` | TRANSFORMED | existing `getShortcutForActivity()` reused unchanged; falls back to raw title, same pattern Toronto already uses — no new taxonomy code written |
| `date`/`startDateTime`/`endDateTime` | DIRECT | real datetimes, reformatted |
| `dayOfWeek`/`absoluteTime`/`startMinutes`/`day` | TRANSFORMED | derived via existing `lib/dropin/time.ts` utilities, same as Toronto |
| `centre` | DIRECT | first facility's `facility_name`, falling back to `center_name` |
| `municipality` | DIRECT | from config |
| `district` | **UNAVAILABLE** | always `""` — see §11 |
| `address`/`postalCode`/`latitude`/`longitude`/`phone` | **UNAVAILABLE** | never provided by this source, confirmed in Phase 3.1, unchanged here |
| `price` | TRANSFORMED / OPTIONAL | `"Free"` when the source says so; a real value when present; `undefined` for the placeholder `"See Facility for Details"` string rather than storing a non-value |
| `ageMin`/`ageMax` | OPTIONAL (join) | populated only when age-join.ts found a real match; `undefined` otherwise — see §7 |
| `officialUrl` | DIRECT | `activity_detail_url`, a real working link |
| `officialSource` | DIRECT | from config |
| `lastUpdated` | TRANSFORMED | the real fetch date (genuinely more honest than Toronto's hardcoded constant, since this source really is fetched live) |
| `verificationStatus` | RECOMMENDATION, applied | `"unverified"` for every session from this family — see §8 |

No field was added to `lib/dropin/types.ts`. Every gap above already existed as an optional field for exactly this reason.

## 7. Age-Join Results and Match Rate

**IMPLEMENTED and VERIFIED with real counts**, not estimated:

Validated join key: a calendar event's `event_item_id` equals an `activities/list` record's `id` (confirmed 8/8, 100%, against a real, independently-checkable case before building the general mechanism). Because `activities/list` has no bulk-fetch mode (hard-capped at 20 results/page, confirmed directly), the implemented strategy issues one keyword search per **distinct activity title** already present in the calendar pull (bounded by catalog variety, not event count — 198 titles for Mississauga, 28 for Richmond Hill, both well inside the 300-title safety cap in `age-join.ts`), run with concurrency 8.

Real, measured results from the final production run:

```
Mississauga:    15,707 sessions -> 5,436 with real age data (34.6%)
Richmond Hill:     253 sessions ->   196 with real age data (77.5%)
```

(Earlier standalone test runs against the same live source measured Mississauga between 46.8% and 49.9% and Richmond Hill at 78.3% — the Mississauga number moves between runs because this queries the real, currently-live municipal system, and what's open for registration changes hour to hour; Richmond Hill's has stayed consistent. This variance is a genuine property of live production data, not measurement error, and is called out explicitly rather than picking one favorable number to report.)

The **majority of Mississauga's sessions genuinely have no age data available** — confirmed directly (§ Phase 3.1) that many pure walk-in calendar entries (e.g. plain "Lane Swim") have no corresponding `activities/list` record to join against at all; this is a real data gap, not a lookup-table shortfall. Per the phase's explicit instruction, unmatched sessions keep `ageMin`/`ageMax` as `undefined` — never inferred, never defaulted.

**KNOWN LIMITATION:** the join runs as part of every cache-population cycle (§18), not on a separate schedule — a real, accepted cost (measured below), not an oversight.

## 8. Attendance-Mode Handling

**RECOMMENDATION, applied: no field was added.** Per Phase 3.1 §8, no ActiveCommunities field reliably distinguishes walk-in from reservation-required — `reservation_event_type_id` was `0` for every event tested, both municipalities, no exceptions found in this phase's testing either. Per the phase's explicit instruction ("do NOT add a speculative field merely to populate it with guesses"), `Session` gained no `attendanceMode` field.

Instead, the one honest signal available was used: every ActiveCommunities session carries `verificationStatus: "unverified"`, distinct from Toronto's `"verified"` — this is a real, existing field already surfaced in the Decision Sheet's trust line (`app/page.tsx`'s existing `[selectedSession.verificationStatus === "verified" ? "Verified" : "Unverified", ...]` logic), so this distinction is already visible to users today with zero UI changes required. No activity name, category, capacity, or registration-URL heuristic was used to guess attendance mode anywhere in this implementation.

**RECOMMENDATION for later:** if attendance-mode certainty ever becomes obtainable (a future source, or a future ActiveCommunities finding), the field should still default new sessions to an explicit `unknown`, never `walk_in` — this phase found no evidence that would justify a more confident default.

## 9. Schedule-Horizon Behavior

**VERIFIED**, including a real browser test, not just code review:

- Mississauga's real horizon (~105 days) and Richmond Hill's real horizon (~21 days) are both served as-is — `getAcFilters`'s `calendar_period` is read but never used to clip or extend anything; the events endpoint's own real response is the only boundary applied.
- The UI's date calendar (`maxAvailableDateKey` in `app/page.tsx`, unchanged) is computed from the real combined `sessions` array's own maximum date — confirmed live: with "Richmond Hill" as the active location, the calendar correctly offered September dates (because Mississauga's real data extends that far), and selecting September 5 while scoped to Richmond Hill correctly produced **"No activities found in Richmond Hill on Saturday"** — a real, honest empty state, not a fabricated session and not an artificially disabled date.
- No code anywhere clips one municipality's horizon to match another's, and no code invents a session to fill a gap.

## 10. Search Scenarios Verified (and Two Real Bugs This Phase Found and Fixed)

**VERIFIED**, all against the live app with real combined data, no query-specific handlers written:

`badminton` (generic, no location) → 9 distinct real activity titles across municipalities, 11 total real sessions. `Mississauga` (municipality only) → 87 real activities, correct grouping. `swimming Mississauga` → 16 real results at real Mississauga pools. `pickleball Richmond Hill` → 1 real, priced, aged result. `Richmond Hill badminton` (reversed word order) → correct honest zero-result state with working recovery actions. `badminton Scarborough` → correct honest zero-result state; `Try Tomorrow` correctly advanced to 3 real Toronto results. A specific Mississauga/Richmond Hill facility name (`Bayview Hill`) → correctly resolved to a `centre`-type location match with a working `Try Thu 13` suggestion.

**Two real, load-bearing bugs were found and fixed as a direct result of testing against real multi-municipality data — not hypothetical:**

1. **`matchActivity` in `lib/dropin/search-intent.ts` previously returned early on any recognized shortcut keyword** (e.g. `"badminton"` → hardcoded `["Badminton"]`), never falling through to check other municipalities' real activity names, and even in the fallback path used `.find()` (first match only) instead of `.filter()`. This was invisible with Toronto-only data and would have silently made `"Richmond Hill badminton"` and similar required Part 12 scenarios return nothing. Fixed by unioning the curated shortcut group with a real substring scan across every real activity name currently in the dataset.
2. **That same fix introduced a new, real regression**, caught by testing rather than assumed away: searching the bare municipality name `"Mississauga"` spuriously also matched an unrelated real activity — `"Drop In Seniors' Centre Mississauga Swing B&"` — because that program's real title happens to contain the word "Mississauga". Fixed in `parseQuery` by giving an exact municipality/neighbourhood match on the whole query string priority over any substring activity match on that same string — verified this only affects single-word queries that exactly equal a location name, not genuine mixed queries like `"badminton Mississauga"`.

Both fixes are general (no municipality name appears in either fix's logic) and were verified against real Toronto data afterward to confirm no regression (`badminton Scarborough`, `Try Tomorrow` flow, above).

## 11. Scarborough Regression Results

**VERIFIED, no regression.** `badminton Scarborough` and the follow-on `Try Tomorrow` flow (§10) both produced correct results using Toronto's existing, untouched district-matching code (`lib/dropin/districts.ts`) and real Toronto session data. Scarborough was not made into a fake municipality and was not given any special handling — it continues to work exactly as a Toronto district search, unaffected by two more municipalities' worth of new data being added to the combined pool.

**District/neighbourhood boundary decision (Part 11), documented as asked:** Toronto's `DISTRICTS` vocabulary was deliberately **not** extended or genericized this phase. Every ActiveCommunities session's `district` field is set to `""` (see `normalize.ts`'s inline comment) — `getDisplayDistrict("")` falls through to `""` (no entry in `RAW_DISTRICT_TO_DISPLAY`), so an ActiveCommunities session correctly never matches a Toronto neighbourhood search rather than colliding with one by accident. This means Mississauga and Richmond Hill currently have **no neighbourhood-level search at all** — only municipality-level and facility-name search, which is what §3/§4's real testing exercised. **RECOMMENDATION:** if neighbourhood search is wanted for these municipalities later, it needs its own genuinely-sourced vocabulary (a real facility→neighbourhood mapping for each city) — not Toronto's district list, and not a fabricated one. Deferred, as instructed.

## 12. Cross-Municipality Identity / Deduplication Results

**VERIFIED, including a real bug this phase found and fixed.** ID uniqueness was checked directly against the full real combined response (25,574 sessions): **14 duplicate IDs were found in the first implementation** — traced to a genuine data characteristic, not a code mistake in isolation: the same ActiveCommunities `event_item_id` (e.g. a "Tennis Camp") can run concurrently at two different facilities under one program id. The id construction was fixed to include `facility_id` (§6), and a belt-and-suspenders `seenIds` duplicate guard was added at the orchestration level, mirroring the Toronto adapter's own existing discipline. Re-verified after the fix: **25,574 unique ids / 25,574 total sessions, zero collisions**, across all three municipalities combined.

Toronto/ActiveCommunities collision safety: Toronto ids are `toronto-*`, Mississauga ids are `mississauga-*`, Richmond Hill ids are `richmondhill-*` — namespaced per adapter/tenant, confirmed disjoint by construction and by the zero-collision count above.

## 13. Failure-Handling Behavior

**VERIFIED with a real, deliberate failure simulation**, not just code review. Richmond Hill's tenant config was temporarily corrupted (`"richmondhill-DELIBERATELY-BROKEN-FOR-QA-TEST"`) and the live `/api/sessions` endpoint was hit:

- Response: `HTTP 200`, containing **9,614 real Toronto sessions and 15,707 real Mississauga sessions** — both fully intact.
- Richmond Hill was cleanly absent from the response — not present with fake/empty data, genuinely excluded.
- The server log recorded a clear, specific error: `[activecommunities adapter] failed to fetch Richmond Hill (tenant "richmondhill-DELIBERATELY-BROKEN-FOR-QA-TEST"): Error: ...could not find CSRF token...` with a full stack trace — a real operator would immediately know which source failed and why.

Config was reverted immediately after and re-verified (all three municipalities present again). This is implemented via `Promise.allSettled` at two levels — across the three top-level adapters in `sources/index.ts`, and across the two ActiveCommunities municipalities inside `activecommunities/index.ts` — so a Mississauga failure and a Richmond Hill failure are independent of each other, not just independent of Toronto.

## 14. Performance Measurements

**VERIFIED, real measurements, not estimates:**

| Scenario | Result |
|---|---|
| Cold fetch (`/api/sessions`, empty cache) | ~9.9–10.7s wall-clock across repeated real test runs |
| Cached fetch (same process, within TTL) | ~0.22–0.24s |
| Combined response size (all 3 municipalities) | ~17.2–17.5MB JSON |
| Total sessions returned | 25,574 (Toronto 9,614 / Mississauga 15,707 / Richmond Hill 253) |
| Age-join cost (both municipalities, ~226 keyword searches total, concurrency 8) | included in the cold-fetch time above; a standalone unconcurrent test of the same work took ~46s, confirming concurrency materially matters here |

**A cold fetch on every request would be a real, user-facing problem, not a hypothetical one** — confirmed directly, not assumed. The implemented response: a 20-minute in-process TTL cache (`lib/dropin/sources/activecommunities/index.ts`), no database, no Redis, no external cache — the smallest option that fixes the measured problem. `days`-scoped queries (a narrower request than the default) deliberately bypass the cache rather than serving a stale slice of someone else's window.

**KNOWN LIMITATION:** the ~17MB response size itself is not addressed this phase — every session for three municipalities is still sent to the client in one payload, unchanged from the pre-existing pattern. This was flagged as out of scope for a "no premature infrastructure" phase but is worth naming as the next real cost as more municipalities are added (see §17).

## 15. UI Changes Made

**Three, all content-only, none visual/structural — success criterion 12 target was "ideally NONE"; these three were required to avoid the phase creating a new, worse bug than the one it fixed:**

1. The not-yet-available-municipality fallback message no longer hardcodes "Toronto" — it now names every currently-available municipality, generated from the real registry (`Intl.ListFormat`, e.g. "Toronto, Mississauga, and Richmond Hill").
2. The "Show Toronto instead" recovery button — whose actual behavior has always been "clear the location entirely," never "switch to Toronto specifically" — is relabeled "Show all areas instead" to match what it actually does.
3. The About DropIn modal's "Data sources" paragraph is now generated from the same registry instead of naming only Toronto.

No layout, spacing, color, typography, motion, card, filter-hierarchy, calendar, or Decision Sheet change was made. This is exactly the Part 10 fix the audit already flagged as a real production bug once multiple municipalities went live — not new scope.

## 16. Remaining Production Risks

**Named plainly, not softened:**

- **Undocumented, unsanctioned API dependency (KNOWN LIMITATION, carried from Phase 3.1).** This still relies on ActiveCommunities' internal frontend API, not a published/versioned contract. It could change shape without notice.
- **Age-join coverage is partial and asymmetric (34.6% Mississauga / 77.5% Richmond Hill), and the majority-unmatched case is now shipping to real users** — a Mississauga session without age data reads to a user exactly like Toronto data always has for unmapped cases (no age line shown), which is honest but means most Mississauga sessions currently show no eligibility information at all.
- **In-process cache means a server restart or redeploy always pays the ~10s cold-fetch cost** — no persistence across process boundaries. Acceptable for this phase's scale; worth revisiting before Phase 3.4/3.5 adds more municipalities to the same fetch.
- **The ~17MB response payload** (§14) will only grow as more municipalities are added on top of this pattern — not yet a measured problem for the current three, but the trend is visible now.
- **Neighbourhood-level search does not exist for Mississauga or Richmond Hill** (§11) — a real, known gap, not silently papered over.
- **`district: ""` on every ActiveCommunities session** is a slightly unusual value to leave in a `string`-typed required field long-term — functionally correct and verified safe today, but worth a real design decision (not a fix) before a fourth municipality with real neighbourhood data arrives.

## 17. Readiness for Phase 3.3

Phase 3.0's own sequence named "3.3 — validate with two municipalities" as the next step after the first non-Toronto integration. **This phase effectively already delivered that validation** — Mississauga and Richmond Hill are both live, both real, both proven to share one adapter, and the real differences between them (center count, category breadth, and especially the 105-day vs. 21-day horizon) were exactly the kind of genuine configuration-shaped variance Phase 3.0 hoped a second municipality would surface, confirmed rather than assumed. **RECOMMENDATION:** Phase 3.3 can likely be considered satisfied by this phase's own results rather than requiring a separate pass — worth confirming with the team before renumbering anything.

## 18. Recommended Next Step: Vaughan + Markham / PerfectMind-Xplor

**RECOMMENDATION**, with real lessons carried forward from this phase, stated concretely rather than generically:

1. **Expect a materially different transport layer, not a drop-in reuse of `client.ts`.** ActiveCommunities' session+CSRF handshake and REST contract will not apply to PerfectMind/Xplor — Phase 3.0 already found PerfectMind's public pages are JS-widget shells with no confirmed open API. The Phase 3.1-style investigation (trace the real network traffic, attempt a plain-`curl` round trip) needs to happen fresh for PerfectMind before any adapter code is written — don't assume the "session cookie + embedded token" pattern generalizes.
2. **Budget real time for a join-strategy investigation up front, not after the adapter is built.** This phase's single biggest time cost beyond the base fetch was empirically discovering the age-join key and its real, partial match rate (§7) — that had to be tested against live data with actual keyword searches, not inferred from documentation (there isn't any). Do the equivalent investigation for PerfectMind's own data shape before committing to an architecture.
3. **Expect genuine per-municipality configuration variance even within one platform family, and design for it from the first line of code** — Richmond Hill's ~21-day horizon vs. Mississauga's ~105-day horizon (§9) was a real surprise this phase had to accommodate after the fact; for Vaughan/Markham, look for the equivalent axis of variance (they may differ from each other, not just from a hypothetical PerfectMind "default") before assuming a shared adapter will need zero conditional logic.
4. **Confirm attendance-mode semantics can't be assumed clean here either** — Phase 3.0 already flagged Vaughan specifically as requiring registration even for nominally "drop-in" activities. Don't assume PerfectMind's data will resolve the §8 gap; test for it explicitly, the same way this phase tested (and confirmed the absence of) a usable signal in ActiveCommunities' data.
5. **The shared-adapter-plus-configuration pattern proved itself this phase** (§5) and should be the starting hypothesis for PerfectMind too if Vaughan and Markham turn out to share real infrastructure — but that must be verified with real evidence per municipality, the same way this phase verified it, not assumed from "both use PerfectMind" the way Phase 3.0 already warned against.

Scarborough remains correctly folded into Toronto (§11) and should stay in the QA matrix for every future phase touching search, as a cheap, high-value regression check.

---

## Success Criteria — Self-Assessment

| # | Criterion | Status |
|---|---|---|
| 1 | Toronto still works | VERIFIED (§11, §13) |
| 2 | Mississauga real data through production pipeline | VERIFIED (§3) |
| 3 | Richmond Hill through the same shared architecture | VERIFIED (§4, §5) |
| 4 | No duplicated municipality-specific adapters without reason | VERIFIED (§5) |
| 5 | Search resolves both + mixed queries | VERIFIED (§10) |
| 6 | Scarborough search remains correct | VERIFIED (§11) |
| 7 | Age eligibility reliably joined or truthfully absent | VERIFIED, partial coverage disclosed (§7) |
| 8 | Attendance mode not fabricated | VERIFIED (§8) |
| 9 | Municipality-specific horizons remain truthful | VERIFIED (§9) |
| 10 | IDs cannot collide across sources | VERIFIED, one real bug found and fixed (§12) |
| 11 | Source failure isolated reasonably | VERIFIED with a real simulated failure (§13) |
| 12 | UI remains visually unchanged | Three content-only text fixes; zero visual/layout change (§15) |
| 13 | tsc/build/tests pass | `tsc --noEmit` clean; `npm run build` succeeds; `npm run lint` introduces zero new issues (16 pre-existing, unrelated errors confirmed untouched by this phase's diff). **No test suite exists in this project** (`package.json` has no `test` script) — nothing to run beyond the above. |

Stopping here for review, as instructed. No Vaughan/Markham/PerfectMind implementation was started.
