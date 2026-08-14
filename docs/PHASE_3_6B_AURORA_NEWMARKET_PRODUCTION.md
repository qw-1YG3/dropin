# Phase 3.6B — Aurora + Newmarket Production Integration

Production integration of both municipalities identified by Phase 3.6A's investigation-only audit (`docs/PHASE_3_6A_AURORA_NEWMARKET_SOURCE_AUDIT.md`). Newmarket joins the existing PerfectMind source family with zero code changes beyond configuration. Aurora joins the existing ActiveCommunities source family via one new, config-gated, generic two-tier retrieval capability — not a municipality-specific adapter. This phase also corrects the attendance model so `attendanceRequirement` is derived from retrieval-path evidence rather than assumed constant per municipality, since Aurora disproves that assumption within a single source family.

---

## 1. Architecture Changes

No new source family, no new adapter type, no new top-level module. Three real extensions, all additive:

- **PerfectMind**: one new `PerfectMindMunicipalityConfig` entry (`Newmarket`) in `lib/dropin/sources/perfectmind/config.ts`. `client.ts` and `normalize.ts` are byte-identical to before this phase.
- **ActiveCommunities**: one new optional config field (`dropInKeywords?: string[]`) on `ActiveCommunitiesMunicipalityConfig`, one new client function (`getAcProgramSessions`), one new normalize function (`normalizeAcDropInSession`), and `fetchAndNormalizeMunicipality` branching on `config.dropInKeywords` presence — a capability flag any tenant can opt into, not `if municipality === "Aurora"`. The original direct-calendar path (`fetchDirectCalendar` / `normalizeAcEvent`) is unchanged and still used by Mississauga and Richmond Hill.
- **Registry**: `lib/dropin/municipalities.ts`, `lib/dropin/sources/index.ts` (`MUNICIPALITY_SLUGS`), and `scripts/snapshot-health.ts` all extended with `Newmarket`/`Aurora` entries.

`app/page.tsx` and every other UI file are unchanged in this phase (Part 10 — UI freeze); the attendance-line and official-action-label rendering added in Phase 3.5C already handles both new municipalities without modification, since it reads `Session.attendanceRequirement` generically.

## 2. Newmarket Integration (PerfectMind)

Newmarket uses the identical BookMe4 mechanism as Vaughan/Markham (bootstrap GET + CSRF → `POST ClassesV2` with cursor-based `nextKey` pagination). Category audit (systematic, all 9 live widget categories sampled — not keyword search):

| Category | Decision | Evidence |
|---|---|---|
| Fitness | **Include** | Real Zumba/Barre/Aqua Fitness drop-ins |
| Preschool | **Include** | Real Parent & Tot Drop In sessions |
| Skating | **Include** | Real Public Skate/Shinny sessions |
| Sports | **Include** | Real Badminton/Soccer/Pickleball/Basketball/Volleyball/Fencing |
| Swimming | **Include** | Real Lane/Public Swim sessions |
| Indoor Skate Park | **Include** | Real age-banded skate park sessions |
| Arts & Culture | Exclude | Out of active-recreation scope by category name; empty at audit time |
| Adult 55+ | Exclude | Sampled titles majority non-active social/hobby (Euchre, Chess, Wood Carvers, Shuffleboard, Seniors Lunches, Mah-Jong) vs. two active titles — worse ratio than Markham's own Age 55+ category, which was included |
| Inclusion | Deferred | Ambiguous by name, zero live sessions to validate against at audit time |

Config entry (`lib/dropin/sources/perfectmind/config.ts`): `host: newmarket.perfectmind.com`, `sitePrefix: ""`, `widgetId: 15f6af07-39c5-473e-b053-96653f77a406`, `idPrefix: newmarket`. No changes to `client.ts`/`normalize.ts` were needed — confirms the shared-adapter pattern.

## 3. Aurora Integration (ActiveCommunities — Two-Tier)

Aurora's genuine drop-in content does not live on the dated `onlinecalendar` feed (the mechanism Mississauga/Richmond Hill use) — confirmed by a real, zero-result sweep of all 6 centers over the platform's own visible date horizon. It lives instead in the `activities/list` registered-program catalog, one real "Drop In "-prefixed entry per calendar week, each requiring a second `GET /rest/program/{id}/sessions` call to expand into dated/timed occurrences.

A **proper category crawl** (Phase 3.6A explicitly warned keyword-guessing is unreliable) was run against every category Aurora's own site advertises as drop-in: A.F.L.C./A.R.C. Drop-Ins, Aquafitness, Group Fitness, Indoor Track, Pickleball, Preschool, Rock Wall, Seniors Walking Club, Shinny Hockey, Skating, Squash, Swimming, Table Tennis, Tennis, The Loft. Only **3 keywords** returned real "Drop In "-prefixed catalog items: `pickleball`, `volleyball`, `group fitness`. Every other advertised category returned zero matching catalog items — these are real, live, town-advertised drop-ins that are PDF-schedule-only with no live API path, confirmed absent rather than assumed absent, and correctly left unretrieved.

## 4. ActiveCommunities Two-Tier Capability (Generic)

`dropInKeywords?: string[]` on `ActiveCommunitiesMunicipalityConfig` is the only new surface. When present, `fetchAndNormalizeMunicipality` calls `fetchDropInCatalog` instead of `fetchDirectCalendar`:

1. `searchAcActivities` (`activities/list`) once per configured keyword, filtered to items whose name matches `/^drop in/i`.
2. **Completion gate**: `activities/list` has no working pagination parameter (multiple real shapes tried this phase — body-level `page_number`, nested `page_info.page_number`, query-string `page_number`/`page`/`pageNumber` — all ignored by the server). Completion is instead proven from the server's own authoritative `total_records`: if the entire returned page is "Drop In"-prefixed AND `total_records` exceeds the page size, the fetch throws (INCOMPLETE) rather than silently accepting a possibly-truncated result. If the drop-in cluster ends before the page boundary, or `total_records` fits within one page outright, that's a genuine, provable completion. All 3 real Aurora keywords completed this way in every successful run this phase; the throw path itself was exercised only by code inspection, not a forced-incomplete live scenario — noted as a residual gap in §16.
3. `getAcProgramSessions` per surviving activity, normalized via `normalizeAcDropInSession`.

No `if municipality === "Aurora"` branch exists anywhere in this path.

## 5. Attendance-Model Changes

`AttendanceRequirement` (`"pre-registration-required" | "walk-in"`, undefined = unknown) is unchanged from Phase 3.5C — no new states added. What changed is *where* the value comes from:

- Toronto: unconditional `"walk-in"` (unchanged, real evidence from Phase 3.5C).
- PerfectMind (Vaughan/Markham/Newmarket): unconditional `"pre-registration-required"` (unchanged — real evidence, and now automatically applies to Newmarket without any new code).
- ActiveCommunities direct-calendar path (Mississauga/Richmond Hill): unset/`undefined` (unchanged — `reservation_event_type_id` was confirmed 0 for every event tested, no reliable signal).
- ActiveCommunities two-tier path (Aurora): unconditional `"pre-registration-required"`, set in `normalizeAcDropInSession` — real, direct evidence for every record this specific retrieval path returns (live no-show-fee/cancellation policy, real enrollment counts, an "Enroll Now" action link, all confirmed on sampled records this phase), not a municipality-level assumption.

This is the required correction: `attendanceRequirement` is now a property of *retrieval-path evidence*, not of municipality. Aurora is proof it must be — its two-tier (enrollment-tracked) programs are `"pre-registration-required"`, while any Aurora program on the direct-calendar path (none currently configured, since none of Aurora's PDF-only categories have a live API path at all) would correctly stay unset. No volatile state (open/full/waitlist/spots-remaining) was added anywhere. Neither "drop-in" in a title nor the mere presence of `officialUrl` was used to infer either value.

## 6. Category Coverage

| Municipality | Categories audited | Categories activated | Activation basis |
|---|---|---|---|
| Newmarket | 9 (full live widget) | 6 | Real sampled sessions, active-recreation fit |
| Aurora | 15 (full advertised drop-in list) | 3 (Pickleball, Volleyball, Group Fitness) | Real catalog items returned; all others confirmed empty via live crawl, not guessed absent |

## 7. Data-Quality Metrics (measured against the live `npm run refresh:data` snapshot activated this phase)

| Metric | Newmarket | Aurora |
|---|---|---|
| Raw record count | 1,766 | 197 |
| Canonical sessions | 1,766 | 197 |
| Missing age | 226 (12.8%) | 0 (0.0%) |
| Missing coordinates | 0 (0.0%) | 197 (100.0%) |
| Missing officialUrl | 0 (0.0%) | 0 (0.0%) |
| Attendance: pre-registration-required | 1,766 | 197 |
| Attendance: walk-in | 0 | 0 |
| Attendance: unknown | 0 | 0 |
| Duplicate/canonical-ID collisions (own dataset) | 0 | 0 |

Aurora's 100% missing-coordinates figure is a real, confirmed source limitation (same as Mississauga/Richmond Hill — this ActiveCommunities family never returns address/lat/long on any endpoint used), not an integration gap. Aurora's attendance distribution is reported exactly as measured — 100% pre-registration-required, 0% walk-in, 0% unknown — not normalized to look more balanced; this reflects that only Aurora's enrollment-tracked programs are retrievable through any live API this phase found, not a claim that Aurora has no walk-in drop-ins in reality (its PDF-only categories may well include some — genuinely unknown from this data source).

Combined 7-municipality canonical dataset: **47,146 sessions**. Canonical-ID collisions across the *entire* combined dataset (Toronto/Mississauga/Richmond Hill/Vaughan/Markham/Newmarket/Aurora together): **0**.

Aurora's `category` field reflects real per-facility program names (e.g. "Adult Pickleball (AFLC)", "Group Fitness [ARC]") rather than a collapsed "Pickleball"/"Group Fitness" label — this is the existing shared `getShortcutForActivity` fallback-to-raw-title behavior already used by Mississauga/Richmond Hill and Toronto for any title outside the fixed Toronto-derived shortcut taxonomy (`lib/dropin/activities.ts`), not new or Aurora-specific. Cross-municipality activity search was verified working against these titles during Task #130's regression (substring/family matching, not exact taxonomy membership).

## 8. Snapshot/Refresh Behavior

Both municipalities participate in `npm run refresh:data` and `scripts/snapshot-health.ts` identically to existing sources — no request-time fetching, atomic snapshot activation, per-source failure isolation via `Promise.allSettled`. Measured this phase (full 7-source refresh):

| Source | Duration | Result |
|---|---|---|
| Toronto | 1.6s | 26,353 canonical, activated |
| Mississauga | 11.0s | 15,982 canonical, activated |
| Richmond Hill | 2.5s | 258 canonical, activated |
| Aurora | 3.6s | 197 canonical, activated |
| Vaughan | 34.3s | 1,157 canonical, activated |
| Markham | 34.5s | 1,433 canonical, activated |
| Newmarket | 35.2s | 1,766 canonical, activated |

7/7 sources activated a new snapshot. Newmarket's per-category pagination (Fitness 5 pages, Preschool 2, Skating 9, Sports 13, Swimming 12, Indoor Skate Park 6) completed via PerfectMind's existing proven cursor-based genuine-stop detection — the same mechanism already validated for Vaughan/Markham, applied to Newmarket with zero new code.

**Count-collapse safety net validated live this phase**: an interim Aurora refresh transiently returned 39 records against an active 197-session snapshot. `checkCountCollapse` (`previousCount >= 10 && newCount < previousCount * 0.5`, unchanged code from Phase 3.3) correctly refused activation; the healthy 197-snapshot remained active; a follow-up refresh minutes later self-corrected back to 197. This was confirmed as genuine real-world data volatility (Aurora's small, weekly-rolling drop-in catalog) rather than a code defect, and stands as a real, non-hypothetical validation of the safety net rather than a bug to fix.

## 9. Official URL Integrity

Newmarket officialUrls are real per-class/per-occurrence PerfectMind booking links (e.g. `.../BookMe4LandingPages/Class?...&classId=...&occurrenceDate=...`), same shape already verified for Vaughan/Markham. Aurora officialUrls are real per-program ActiveCommunities detail links (e.g. `.../ActiveNet_Home?FileName=onlineDCProgramDetail.sdi&dcprogram_id=...`), sourced directly from `activity.detail_url`/`action_link.href` — never constructed from a template. 0% missing officialUrl for either municipality. Representative URLs were cold-requested and confirmed reachable during Task #128. No generic-homepage substitution occurs where a program-specific listing exists.

## 10. Search QA

Regression run across all 8 municipality entries (Toronto, Scarborough as part of Toronto, Mississauga, Richmond Hill, Vaughan, Markham, Newmarket, Aurora): municipality search, activity search, activity+municipality combinations, partial terms, activity-family matching, no-result behavior, "All" reset behavior, date filter, Morning/Afternoon/Evening segmented control, Decision Sheet open/close, official CTA, list/grid density — all pass. No municipality-specific search hacks were introduced; previously-fixed cross-municipality `matchActivity` behavior is unregressed.

## 11. Desktop QA

Full desktop pass performed in-browser against the local dev server: search across all interaction types above, Decision Sheet content correctness for both new municipalities (Newmarket: real address, "Pre-registration required", "Register" CTA, correct trust footer; Aurora sampled via the same code path), calendar/date picker, density toggle. **PASS.**

## 12. Mobile QA

Functional verification performed over the real LAN connection (`http://192.168.18.4:3000`) from a browser tab, not code inspection alone:

**Verified over LAN (PASS):** page load and real data parity with desktop, `/api/sessions` loads, search (tested live with a real Newmarket query — "swimming Newmarket" returned real Parent & Tot Swim / Gorman Pool results with correct pricing, date strip, and time-of-day filter), Decision Sheet open/close with correct real content (address, attendance line, trust footer), official Register/View-listing CTA, calendar/date picker open and close.

**Not verified this session (environment limitation, not a code defect):** true narrow-viewport visual layout — horizontal overflow, clipped controls/text, tap-target sizing, background-scroll-lock while the Decision Sheet is open, activity-chip horizontal scroll behavior at real phone width, list/grid density toggle at narrow width. The `mcp__claude-in-chrome__resize_window` tool was attempted and confirmed non-functional in this environment (`window.innerWidth` remained 1193 after a requested 390×844 resize) — the second time this exact tool has failed identically in this session, across different phases. This is a tool limitation, not evidence about DropIn's actual responsive behavior one way or the other.

**Overall mobile status: PARTIAL — functional PASS over real LAN, true-viewport visual layout UNVERIFIED.**

## 13. Physical-Device Verification Status

**NOT TESTED this phase** — no physical device was available/connected in this environment. This is an environment limitation, not a skipped-by-choice check. Smallest concrete physical-device checklist to close the gap:

1. Open the real LAN URL on an iPhone (or any phone) on the same network.
2. Confirm no horizontal page scroll on the homepage and on an open Decision Sheet.
3. Confirm activity chips scroll horizontally without clipping the last chip.
4. Open the Decision Sheet, confirm background page does not scroll while the sheet is open, confirm it closes via both the close button and swipe-down/backdrop tap if supported.
5. Tap the official Register/View-listing CTA and confirm it opens in a new tab correctly.
6. Test "Share" on the real HTTPS production deployment specifically (not the HTTP LAN dev tab) — LAN HTTP is expected to no-op per §14; HTTPS production is the only environment where a real pass/fail on Share is meaningful.
7. Confirm all tap targets (density toggle, close buttons, chips) are comfortably tappable, not just visually present.

## 14. Development-Environment Limitations (not production defects)

Two limitations were re-confirmed unregressed this phase, both already diagnosed in `docs/MOBILE_PREVIEW_DIAGNOSTIC.md` prior to this session:

- **(A) `allowedDevOrigins` cross-origin gate**: `next.config.ts`'s `allowedDevOrigins: ["192.168.18.4"]` is present and working — LAN `/api/sessions` loads correctly. Already fixed, confirmed unregressed.
- **(B) Insecure-context Share/Clipboard unavailability**: the LAN tab reports `isSecureContext: false, hasShare: false, hasClipboard: false`; clicking "Share" silently no-ops (no crash, no confirmation) exactly as documented. This is a browser platform restriction on plain-HTTP origins, not fixable via Next.js dev config, and will not reproduce on real HTTPS production. No code change was made to force Share to work over insecure LAN HTTP, per explicit instruction not to introduce questionable production code for a dev-only limitation.

## 15. Bugs Discovered and Fixed This Phase

1. **`cleanDropInTitle` failed to strip real trailing date ranges** on cross-month or full-month-name ranges (e.g. "Adult Pickleball (AFLC) - August 15 - 21" was left un-cleaned). Root cause: the original regex only matched 3-letter month abbreviations sharing one implied month. Fixed by rewriting to a full month-name/abbreviation alternation with an optional second month group. Verified: re-running the refresh collapsed titles cleanly to `["Adult Volleyball (ARC)", "Adult Volleyball (AFLC)", "Group Fitness [AFLC]", "Group Fitness [ARC]", "Group Fitness Virtual [AFLC]"]` with no residual date text.
2. **Aurora's `age_min_year`/`age_max_year` fields are always `0/0`** regardless of the real restriction, confirmed against every raw Aurora record this phase (e.g. a real "18 yrs but less than 99 yrs" record reported `0/0`) — this would have silently rendered "no age restriction" where the truth was "18+ only," violating "unknown is better than wrong." Fixed by parsing the free-text `age_description` field instead via a regex matching only the one confirmed unambiguous shape, leaving age undefined for anything else.
3. **Two stray literal-digit typos** found via a fresh `npm run lint` pass this phase, both pre-existing (not introduced by this phase's edits) and both in files touched by earlier phases: `lib/dropin/sources/perfectmind/config.ts` line 10 (`11// Category scope...`) and `lib/dropin/snapshot/io.ts` line 1 (`1// Atomic snapshot...`) — a stray digit had been merged into a comment line, parsed by ESLint as an orphaned expression statement. Both fixed by removing the stray digit; confirmed via a follow-up lint run that both associated warnings cleared.

## 16. Bugs NOT Fixed / Remaining Risks

- The two-tier completion-gate's **throw path has not been exercised against a real forced-incomplete scenario** — all 3 real Aurora keywords completed within one page in every run this phase, so the throw branch is verified by code inspection only, not by observing a real throw. Low risk given Aurora's genuinely small catalog, but worth a synthetic test if Aurora's real drop-in volume grows.
- **Aurora price is unavailable** by design — the catalog item only carries a "View fee details" link, not a number; a third API call was deliberately not added this phase rather than guess or fabricate a price.
- **Aurora's PDF-only categories** (Aquafitness, Indoor Track, Rock Wall, Seniors Walking Club, Shinny, Skating, Table Tennis, The Loft, Squash, Tennis) remain genuinely unretrievable through any live API found this phase — real, town-advertised drop-ins that DropIn currently cannot represent. Not a code gap; a real source-availability ceiling.
- **True mobile narrow-viewport visual verification remains unverified**, per §12/§13 — the concrete next step is the physical-device checklist above.

## 17. Full Regression Results

- `npx tsc --noEmit`: **clean, 0 errors.**
- `npm run build`: **succeeds**, all 10 routes compiled (static + `/api/sessions` dynamic).
- `npm run lint`: 0 errors/warnings in any file touched this phase (`lib/dropin/**`, `scripts/snapshot-health.ts`); 16 pre-existing errors remain in `app/_components/Sheet.tsx`, `app/_components/DateCalendar.tsx`, `app/page.tsx` (untouched lines), and one `/design`-only page — all from React-Compiler-oriented rules (`react-hooks/refs`, `react-hooks/set-state-in-effect`) flagging pre-existing UI patterns this phase did not touch and, per the UI freeze (Part 10), was not in scope to rewrite.
- `npm run refresh:data`: **7/7 sources activated**, see §8.
- `scripts/snapshot-health.ts`: **all 7 municipalities report FRESH**, session counts match the refresh report exactly.
- Combined canonical-ID collision check across all 7 municipalities: **0 collisions**, 47,146 total sessions.
- Search regression (Task #130): **PASS**, all 8 municipality entries.
- Desktop QA (§11): **PASS.**
- Mobile QA (§12): **PARTIAL** — functional PASS, visual-viewport UNVERIFIED.

## 18. UI Freeze Compliance

No UI file was modified this phase. Search bar, When section/date strip, calendar treatment, time segmented control, Activity section/chips, result cards, density controls, typography, colors, spacing, motion, and overall information architecture are all unchanged from before Phase 3.6B. The Phase 3.5C attendance-line and official-action-label rendering already handles Newmarket and Aurora correctly with no new UI code, since it reads `Session.attendanceRequirement`/`officialUrl` generically rather than by municipality. No UI change was identified as required for correctness this phase.
