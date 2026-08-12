# Phase 3.5B — PerfectMind Production Integration (Vaughan + Markham)

Production integration, built on Phase 3.4's confirmed transport mechanism and Phase 3.5A's stress-test findings. Vaughan and Markham are now real, live-refreshed sources in DropIn's production pipeline, sharing one PerfectMind adapter. Every claim below is tagged **[IMPLEMENTED]**, **[VERIFIED]** (checked against real, live-fetched data in this phase), **[KNOWN LIMITATION]**, **[DEFERRED]**, or **[RECOMMENDATION]**.

UI is unchanged — no Register button, no Registration-required badge, no visual redesign. This phase is data-layer only.

---

## 1. Architecture

**[IMPLEMENTED]** `PerfectMindAdapter + VaughanConfig + MarkhamConfig`, exactly the structure the phase brief required — no `if municipality === "vaughan"` branching anywhere in the adapter. New code lives entirely under `lib/dropin/sources/perfectmind/`:

- `client.ts` — tenant-agnostic transport (bootstrap/CSRF, pagination, retry, completion detection). Takes `host`/`sitePrefix`/`widgetId`/`calendarId` as parameters; contains zero municipality-specific logic.
- `config.ts` — `PERFECTMIND_MUNICIPALITIES: PerfectMindMunicipalityConfig[]`, two entries (Vaughan, Markham), each with its own host/site prefix/widget id/category list. All business logic-free — pure data.
- `normalize.ts` — raw `PmClass` → canonical `Session`, driven entirely by config values passed in, not hardcoded per-tenant checks.
- `index.ts` — wires the three together per municipality; owns the completion gate and both dedup layers.

`scripts/refresh/perfectmind.ts` mirrors `scripts/refresh/activecommunities.ts`'s shape exactly (`refreshPerfectMindMunicipality`, `refreshAllPerfectMind`), and both are wired into `scripts/refresh/index.ts`'s `--all` and `--municipality=` paths alongside Toronto and ActiveCommunities.

Full pipeline, as specified: `PerfectMind shared client/adapter → municipality config → Vaughan/Markham → raw snapshot → normalize → validate → canonical snapshot → atomic activation → SnapshotStorage → /api/sessions → existing Search/Results`. No new abstraction was added to `SnapshotStorage`, `refreshOneSource`, or the read path (`lib/dropin/sources/index.ts`) beyond adding `"vaughan"`/`"markham"` to `MUNICIPALITY_SLUGS` — the existing Phase 3.3/3.3B machinery absorbed a third source family unchanged.

## 2. Vaughan Config

**[IMPLEMENTED]**, confirmed live: host `vaughan.perfectmind.com`, site prefix `/25076`, widget id `dff88c8a-0b78-4a94-9dde-250040385300`. Three categories in scope — **[VERIFIED]** this is Vaughan's *entire* active category taxonomy on the public widget, not a curated subset:

| Category | calendarId |
|---|---|
| Sports | `1d032376-c4bb-4023-80f5-7c3c44de0637` |
| Fitness Centre | `d719b005-04c6-45b2-8556-4464c699a9ca` |
| Swimming & Aquafitness | `71fe848e-2dbd-4ec5-92fa-7f2d0ad09354` |

## 3. Markham Config

**[IMPLEMENTED]**, confirmed live: host `cityofmarkham.perfectmind.com`, no site prefix, widget id `6825ea71-e5b7-4c2a-948f-9195507ad90a`. Markham's real widget exposes 13 categories total; **3 were deliberately selected** as Phase 3.5B's production scope — a comparable, representative subset (Sports & Activities, Swimming, Skating), not exhaustive:

| Category | calendarId |
|---|---|
| Sports & Activities | `491a603e-4043-4ab6-b04d-8fac51edbcfc` |
| Swimming | `39bd5c76-e07f-43f3-af24-c6969091dbb4` |
| Skating | `ecf5202d-4c97-4f89-b4e3-42966a1cc453` |

**[DEFERRED]**: the remaining 10 Markham categories (Activities for Age 55+, Adapted, Aquafit, Art, four Group Fitness subcategories, Quick Fitness, Sensory Room/Indoor Playground, Tennis Round Robins) are config-only additions for a future phase — no code changes needed to add them, per §1's architecture.

## 4. CSRF/Bootstrap Flow

**[IMPLEMENTED]**, `createPmSession()` in `client.ts`: `GET {host}{sitePrefix}/Clients/BookMe4BookingPages/Classes?calendarId=...&widgetId=...&embed=False` establishes session cookies and returns HTML containing a hidden `__RequestVerificationToken` input, extracted by regex. No login, no manually copied cookies, no browser automation — confirmed working cold against both tenants in this phase's actual production refresh runs.

Each category gets its own session (`createPmSession` called once per category), since a `calendarId` is bound into the page a session's CSRF token is scoped to — sessions are not reused across categories.

## 5. Pagination Implementation

**[IMPLEMENTED]**: `page` stays `"0"` on every request; `values[0][Value]` carries the date cursor. `fetchAllPerfectMindClasses()` advances the cursor using the previous response's `nextKey` until a genuine stop condition (§6) or a 40-page safety cap. Sequential within a category (each page's cursor depends on the prior page's response) and sequential across categories within a municipality (Part 18's conservative pacing — Phase 3.5A did not stress full-taxonomy concurrent load, so its observed stability isn't license for concurrency here).

## 6. The Genuine Completion Gate

**[IMPLEMENTED] + [VERIFIED]** — the central requirement of this phase. `fetchAllPerfectMindClasses()` returns `complete: true` only when `nextKey` is absent/empty or repeats the previous cursor value; `complete: false` if the 40-page safety cap fires first. `fetchAndNormalizeMunicipality()` in `index.ts` **throws** the moment any category comes back incomplete — a fixed page count can never masquerade as success.

**[VERIFIED] real completion behavior, this phase's actual production pull**:

| Category | Pages used | Requests | Stop reason |
|---|---|---|---|
| Vaughan / Sports | 10 | 10 | genuine (nextKey empty) |
| Vaughan / Fitness Centre | 21 | 21 | genuine — matches Phase 3.5A's finding that this category needs ~21-30 pages |
| Vaughan / Swimming & Aquafitness | 2 | 2 | genuine |
| Markham / Sports & Activities | 10 | 10 | genuine |
| Markham / Swimming | 3 | 3 | genuine |
| Markham / Skating | 2 | 2 | genuine |

**[VERIFIED] forced-failure test (Part 30 scenario)**: `MAX_PAGES_PER_CATEGORY` was temporarily lowered to 3 and a real refresh run against Vaughan was executed. Result: `fetchStatus: "failure"`, `activated: false`, exact reported reason: *`"Vaughan / Sports" did not reach a genuine completion signal within the page safety cap (pagesUsed=3, requests=3, records so far=165) — refusing to treat this as a successful refresh`*. The CLI exited 1. The existing canonical snapshot file's checksum was confirmed byte-identical before and after this forced failure — the previously healthy 1,205-session snapshot was untouched. The cap was restored to 40 and a clean refresh re-verified success immediately after.

This reuses `scripts/refresh/lib.ts`'s existing "thrown `fetchRaw()` → no raw snapshot written, nothing activated" path unchanged — no PerfectMind-specific code was added to the shared refresh orchestration.

## 7. Deduplication Strategy — Source-Level vs. Canonical Identity

**[IMPLEMENTED] + [VERIFIED]**, and this phase found and corrected a real error in Phase 3.5A's own prior finding.

**Source-level deduplication** (`index.ts`, within `fetchAndNormalizeMunicipality`): removes pagination-boundary duplicates using `(EventId, OccurrenceDate)` as the key, before normalization ever runs. PerfectMind's date-range filter is inclusive on both ends, so a record on a page boundary date is returned by two consecutive pages — Phase 3.5A measured 24.6%-44.0% duplicate rates from exactly this.

**Canonical session identity** (`normalize.ts`): `id = "${idPrefix}-${EventId}-${OccurrenceDate}"`. **This is deliberately the same two-field key as source-level dedup, not just `${idPrefix}-${EventId}` as Phase 3.5A's report recommended.**

**[VERIFIED] the correction**: Phase 3.5A's report stated *"`EventId` (a GUID) is confirmed occurrence-level unique already"*, based on checking one course's two adjacent-day occurrences. This phase built the real canonical-id-from-`EventId`-alone version first, ran it against a real 1,205-record Vaughan pull, and found **215 groups of genuinely distinct sessions silently collapsed into 1 canonical record each** — one recurring program's `EventId` (e.g. "Youth Basketball") is reused identically across every one of its ~10-14 real dated occurrences; it is **not** occurrence-unique. This directly violated Part 6's "must not silently drop genuinely distinct simultaneous sessions." The fix (including `OccurrenceDate` in the canonical id) was verified against the same real dataset: `(EventId, OccurrenceDate)` had **zero collisions** across all 1,205 Vaughan records, and the corrected canonical session count matches the raw record count exactly (1,205 = 1,205; Markham 472 = 472).

## 8. Canonical Identity — Collision Testing

**[VERIFIED]** against the complete real combined dataset across all five live municipalities (Toronto 29,255 + Mississauga 15,952 + Richmond Hill 258 + Vaughan 1,203 + Markham 470 = **47,138 total sessions**): **zero canonical id collisions** — within Vaughan, within Markham, across Vaughan/Markham, and across the PerfectMind family and every other source family (Toronto's `toronto-*`, ActiveCommunities' `mississauga-*`/`richmondhill-*` prefixes). The `idPrefix` namespacing (`vaughan-`/`markham-`) is what guarantees cross-tenant and cross-family safety; `(EventId, OccurrenceDate)` guarantees within-tenant safety per §7.

## 9. Normalization Mapping

**[IMPLEMENTED]**, field-by-field, based on real sampled data (`data/raw/poc-perfectmind/*/*.json`):

- **Direct map**: `activity` (`EventName`, trimmed), `centre` (`Location`), `address`/`latitude`/`longitude` (`Address.*`), `price` (`PriceRange`, passed through as-is — real ranges like `"$0.00 - $8.50"` reflect genuine resident/non-resident or membership tiering, not a parsing artifact).
- **Transformed**: `date`/`startDateTime` (`OccurrenceDate`, `YYYYMMDD`, plus `FormattedStartTime`, 12-hour `HH:MM AM/PM`); `endDateTime` computed as `startDateTime + DurationInMinutes` rather than parsing the year-less `FormattedEndDate` string (`"Aug 11th"` — ambiguous without a year); `category` (`getShortcutForActivity(activity) ?? categoryConfig.category`, same fallback pattern ActiveCommunities already uses).
- **Unavailable**: `district` (no neighbourhood concept in this source, same conclusion Phase 3.2 reached for ActiveCommunities), `phone`.

## 10. Registration/Official Action Data Preserved

**[IMPLEMENTED] + [VERIFIED]**. Part 9 asked whether the existing `officialUrl` field could truthfully carry this without a new field — it can, and does: `buildOfficialUrl()` reconstructs `https://{host}{sitePrefix}/Clients/BookMe4LandingPages/Class?widgetId=...&classId={EventId}&occurrenceDate={OccurrenceDate}&redirectedFromEmbededMode=False` purely from fields already on the record plus static config, confirmed working cold (no browser session) in Phase 3.4 via curl. **[VERIFIED] this phase**: a real Vaughan session's `officialUrl` from a live canonical snapshot was curled directly and returned `200`. The Decision Sheet's existing "Website" button (used for ActiveCommunities' `activity_detail_url` today) renders this correctly with zero UI changes — confirmed visually in the browser against real Vaughan data.

## 11. Attendance Semantic Handling

**[IMPLEMENTED]**: one new field, `Session.registrationStatus?: "open" | "waitlist" | "closed"` (`lib/dropin/types.ts`) — deliberately not a broader `attendanceMode`, and deliberately not both `attendanceMode` and `registrationRequirement`, per Part 10's explicit warning against inventing fields without evidence. Mapped in `normalize.ts` from `BookButtonText` only: `mapRegistrationStatus()` does case-insensitive matching (`"waitlist"` → `waitlist`, `"closed"`/`"sold out"` → `closed`, `"register"` → `open`, anything else → `undefined`).

**[VERIFIED]** `ClosedButtonName` was found to be a **static per-tenant constant** in every sampled record (always `"Not available."` for Vaughan, always `"Registration Closed"` for Markham, regardless of the record's actual state) — it carries no real signal and is deliberately not used. States like `"More Info"` or `"Not available."` (as `BookButtonText`) map to `undefined` — genuinely ambiguous (in sampled data, `"Not available."` co-occurred with a `BookButtonDescription` of `"Add to X waitlist"`, a real internal inconsistency in the source's own copy), so `undefined` here means "unknown," never a guess at "walk-in." Not rendered anywhere in the UI yet, per the Part 29 freeze.

## 12. Coordinate Coverage

**[IMPLEMENTED] + [VERIFIED]**: `Address.Latitude`/`Address.Longitude` validated against a GTA-area plausibility bounding box (lat 43.0-44.5, lon -80.5–-78.5) before being accepted — finite, non-swapped, non-null. Real Vaughan/Markham records carry coordinates on nearly every record (consistent with Phase 3.4's finding). No map functionality built — groundwork only, per Part 12.

## 13. Age Handling

**[IMPLEMENTED] + [VERIFIED]**: PerfectMind provides an explicit `NoAgeRestriction` boolean per record — a real, stronger signal than ActiveCommunities has (which required an external age-title join, Phase 3.2). When `true`, `ageMin`/`ageMax` are left `undefined` (no restriction). When `false`, `MinAge`/`MaxAge` are passed through as-is — including real values like `MaxAge: 99` for an "18 to 99" adult restriction, which is the source's own real encoding, not a fabricated "unrestricted" default. **[VERIFIED]** visually: a real Vaughan session with `NoAgeRestriction: true` ("Recreational Swim") renders with no age line at all in the Decision Sheet/card, matching the existing "omit rather than show a meaningless value" convention; an "18-99" session correctly shows "Ages 18-99".

## 14. Raw/Canonical Snapshot Integration

**[IMPLEMENTED]**: `data/raw/vaughan/latest.json` and `data/raw/markham/latest.json` (each containing per-category raw `PmClass[]` arrays plus category pull reports) and `data/canonical/vaughan/latest.json` / `data/canonical/markham/latest.json`, using the existing `SnapshotStorage`/atomic-activation machinery from Phase 3.3B unchanged. Raw payload sizes: Vaughan 5.6MB, Markham 2.2MB — retained for debugging/provenance, not committed (existing `data/` ignore practices apply unchanged).

## 15. Refresh Failure Safety

**[VERIFIED]**, see §6's forced-failure test — the completion gate is what makes this real, not a separate mechanism. `npm run refresh:data -- --municipality=vaughan` and `--municipality=markham` both work individually; `--all` runs Toronto + ActiveCommunities + PerfectMind together via `Promise.all`, source-isolated (one family's failure doesn't block or corrupt another's).

## 16. Count-Collapse Protection

**[VERIFIED]**: reused unchanged from Phase 3.3 (`checkCountCollapse` in `lib/dropin/snapshot/validate.ts`) — fires if a new count is both ≥10 fewer than the previous count's floor AND drops below 50% of the previous count. Works in concert with the completion gate: the completion gate catches an *incomplete pagination* before count-collapse would even need to; count-collapse remains the backstop for a pull that completes genuinely but returns anomalously few real records for some other reason (e.g. a source-side outage returning an empty-but-valid category).

## 17. Search QA

**[VERIFIED]**, real browser testing against the live app with real production data — see also §7 for the canonical-id bug this QA pass caught. **A second real bug was found and fixed during this QA pass**: `"swimming Markham"` returned zero results despite 15 real Markham swim sessions existing that day. Root cause: `lib/dropin/search-intent.ts`'s `matchActivity()` did plain substring matching only — Toronto's curated shortcut group is `"swimming"`, but Markham's real activity titles (`"Drop-In Lane Swim"`, `"Drop-In Recreational Swim"`) contain `"swim"`, not `"swimming"` as a substring, so no match existed in either direction. Fixed generically (not a `"swimming"`-specific rule) by adding a single-word stem-prefix check (`activityNameMatchesQuery`) alongside the existing substring check — restricted to single-word queries only, after an initial version of the fix caused a regression where `"swimming markham"` matched as a whole string on the word "swim" alone and short-circuited before the segmentation loop could split out the location. Verified after the fix against the real 47,138-session combined dataset: `"swimming Markham"`, `"badminton Vaughan"`, `"pickleball Vaughan"`, `"badminton Markham"`, and the reversed-order `"Markham swimming"` all now resolve both an activity list and the correct location.

Scenarios verified live in the browser: Vaughan municipality-only; Markham municipality-only; Vaughan + activity (Adult Pickleball, 5 real results); Markham + activity (13 real swim results after the fix); "All" broadening (Vaughan + Adult Pickleball → Evening-adjacent → "All" clicked → Vaughan and Today persist, activity resets to All, 56 Vaughan activities shown — no regression to old false "All" behavior); age-restricted display (Ages 18-99 correctly shown); age-unrestricted display (no age line shown for a real `NoAgeRestriction: true` session); Scarborough regression (0 badminton today, 1 real result confirmed on "Try Tomorrow" — Toronto/Scarborough coverage intact); calendar-selected date 14 days beyond the visible strip (Wed Aug 26, real Vaughan sessions rendered with correct date labels); combined cross-municipality query (`"badminton"`, no location — 14 real results spanning Toronto and Richmond Hill facilities mixed together, chronologically grouped).

## 18. Performance

**[MEASURED]**, this phase's actual production refresh runs:

| Source | Requests | Raw records | Canonical sessions | Duration |
|---|---|---|---|---|
| Vaughan (3 categories) | 33 | 1,203 | 1,203 | 28.7s |
| Markham (3 categories) | 15 | 470 | 470 | 13.9s |

Full `--all` refresh (Toronto + Mississauga + Richmond Hill + Vaughan + Markham, run concurrently via `Promise.all`): **~30s wall-clock total**, all 5 sources activated. `/api/sessions` (now serving 5 municipalities, 41,120 sessions after the read-time rolling-window filter): 256ms first request, 162-219ms on subsequent requests — still snapshot-driven, never waits on PerfectMind at request time, consistent with the Phase 3.3 architecture's guarantee. Full response payload: ~27MB uncompressed JSON.

## 19. Remaining Limitations

**[KNOWN LIMITATION]**:
- Markham's category coverage is intentionally partial (3 of 13 real categories) — not a defect, a documented scope decision (§3).
- No live fee/capacity/status re-fetch from the registration page itself — DropIn remains a finder, not a booking-inventory mirror, per Part 11.
- `registrationStatus` is `undefined` (unknown) for a meaningful fraction of records where `BookButtonText` doesn't confidently map (`"More Info"`, `"Not available."`) — this is correct behavior, not a bug, but means the field's practical coverage is partial.
- No IANA timezone handling (same pre-existing limitation as every other source in this codebase — see `lib/dropin/time.ts`'s own note).
- Retry-with-backoff exists but, as in Phase 3.5A, was not exercised under real failure conditions in this phase's production runs (zero HTTP failures observed) — its behavior under a genuine transient outage remains unverified by direct observation, though the completion-gate forced-failure test (§6) did exercise the adjacent "give up cleanly" path.

## 20. Recommendation for Phase 3.5C (Attendance & Official Action Integration)

**[RECOMMENDATION]**: `registrationStatus` and `officialUrl` are both real, live, verified-correct data already flowing through the canonical model for Vaughan and Markham (and `officialUrl` for ActiveCommunities too). Phase 3.5C's UI work (Register button, registration-status badge) has a real data foundation to build against for 4 of 5 municipalities already — Toronto remains the one family with neither field populated (no registration concept in its open dataset), so Phase 3.5C should explicitly design for a mixed-availability UI (some sessions can show a registration action, some genuinely cannot) rather than assuming universal coverage.
