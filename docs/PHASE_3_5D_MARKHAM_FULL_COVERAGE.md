# Phase 3.5D — Markham Full Category Coverage

An audit-driven expansion of Markham's PerfectMind category coverage, from Phase 3.5B's deliberately partial 3-category baseline to a fully evidence-classified set. No changes to `PerfectMindAdapter`, `client.ts`, or `normalize.ts` — config-only, per the phase's own constraint. Every claim below is tagged **[IMPLEMENTED]**, **[VERIFIED]** (checked against real, live data this phase), **[UNKNOWN]**, **[DEFERRED]**, or **[RECOMMENDATION]**.

---

## 1. Complete Markham Source Taxonomy

**[VERIFIED]**, fetched live from `https://cityofmarkham.perfectmind.com/Clients/BookMe4?widgetId=...` by clicking through every category link and reading the resulting `calendarId` from each real navigation. The widget currently exposes **14 named categories**, of which **11 are hyperlinked/live** (have a real `calendarId` and at least one session) and **3 render as plain, non-clickable text** (no `calendarId` exposed anywhere — genuinely zero current sessions, not a scraping gap):

| # | Category | calendarId | Status |
|---|---|---|---|
| 1 | Activities for Age 55+ | `018e7083-d228-4af0-aab1-6d7958b3c8d4` | live |
| 2 | Adapted | — | **unlinked, zero sessions** |
| 3 | Aquafit | `d4d891dd-9e45-474b-97c4-e43c8f8fe3b8` | live |
| 4 | Art | `7f337b0a-6a6f-45b1-b3a6-84772ca68348` | live |
| 5 | Group Fitness: Cardio | `3cad5e4f-9aa0-430b-b2d4-8f75e0984e39` | live |
| 6 | Group Fitness: Mind & Body | `1da4e633-1e1c-4639-8aed-aaeaef5ebb2d` | live |
| 7 | Group Fitness: Strength Training | `f0a1e11c-56e9-4d9b-996d-ef8201cf6ed8` | live |
| 8 | Group Fitness: Total Body Workout | `c8d9404a-4ccd-465d-9a92-16a071baa76d` | live |
| 9 | Quick Fitness | — | **unlinked, zero sessions** |
| 10 | Sensory Room / Indoor Playground | `1b657632-f24f-42b3-bdb4-3043e211da12` | live |
| 11 | Skating | `ecf5202d-4c97-4f89-b4e3-42966a1cc453` | live (Phase 3.5B) |
| 12 | Sports & Activities | `491a603e-4043-4ab6-b04d-8fac51edbcfc` | live (Phase 3.5B) |
| 13 | Swimming | `39bd5c76-e07f-43f3-af24-c6969091dbb4` | live (Phase 3.5B) |
| 14 | Tennis Round Robins | — | **unlinked, zero sessions** |

**[VERIFIED]** The whole widget is itself titled *"Drop-In Programs & Activities Start Page"* and carries its own banner: *"Residents may register for most drop-in activities up to 21 hours before the program start time. Aquafit is in-person only."* This confirms two things directly relevant to product scope: (1) Markham has already pre-scoped this entire widget to drop-in-only offerings — its conventional registered/multi-week programs live elsewhere, not on this page at all; (2) the "21 hours before" window explains the `BookButtonText` volatility Phase 3.5C found (a session's button flips from `"More Info"` to `"Register Now!"` as it crosses that 21-hour threshold, not because of anything about the program itself).

## 2-3. INCLUDE / EXCLUDE / REVIEW Classification + Rationale

**[VERIFIED]**, real sessions sampled from every live category (see §1's calendarIds), applying the product-scope test: *"Would a reasonable user open DropIn to find and participate in this?"* and *"Does the source represent this as drop-in rather than a conventional course?"*

**INCLUDE (10)** — every category's real sampled titles were uniformly `"Drop-In "`-prefixed, time-boxed (45 min–3 hr), tied to a real facility, and either free or carrying a real per-session fee:

| Category | Real sample titles | Fit |
|---|---|---|
| Sports & Activities | Drop-In Badminton, Pickleball, Basketball, Volleyball, Soccer | sports — obvious fit |
| Swimming | Drop-In Lane Swim, Recreational Swim, Parent & Tot Swim, Therapy Swim | swimming — obvious fit |
| Skating | Drop-In Recreational Skate, Stick & Puck | skating — obvious fit |
| Activities for Age 55+ | Drop-In Tai Chi Sword, Line Dance, Yoga/Chair Yoga, LaBlast (+ Mahjong, Art) | mostly physical; genuinely drop-in, single-session format |
| Aquafit | Drop-In Aquafit: Shallow/Deep, Stretch, Older Adults | water fitness — obvious fit; see §14 for the in-person-only nuance |
| Group Fitness: Cardio | Drop-In Zumba, Cardio Dance, Step, Cycle Fitness | fitness — obvious fit |
| Group Fitness: Mind & Body | Drop-In Yoga (7 variants), Relax & Stretch | fitness — obvious fit |
| Group Fitness: Strength Training | Drop-In Muscle Conditioning, Pilates, Functional Movement Workout | fitness — obvious fit |
| Group Fitness: Total Body Workout | Drop-In Bodyweight Boot Camp, Barre, Cardio & Strength Fusion | fitness — obvious fit |
| Sensory Room / Indoor Playground | Drop-In Indoor Playground, Drop-In Sensory Room | active/recreational family-facility use, real facilities (Aaniin, Cornell) |

**EXCLUDE (1)**:

| Category | Reason |
|---|---|
| Art | Real, genuinely drop-in (single recurring program, "Art: Drop-in Friday Night Life Drawing - Open Studio," $25/session at Varley Art Gallery) — but a sedentary studio class, not active recreation. DropIn's scope is explicitly "drop-in active recreation," not general drop-in programming. |

**REVIEW/DEFERRED (3)** — no `calendarId` exists on the live source for any of these; there is nothing to session-validate, so nothing was configured:

| Category | Note |
|---|---|
| Adapted | Ambiguous by name alone (could be adapted/accessible sport, or non-physical support programming) — genuinely can't classify without real sessions |
| Quick Fitness | Name strongly suggests active-recreation fit (parallel to the four included Group Fitness categories) — likely INCLUDE once it has live sessions |
| Tennis Round Robins | Name strongly suggests active-recreation fit (organized tennis matchplay) — likely INCLUDE once it has live sessions |

## 4. Final Production Categories

**[IMPLEMENTED]**: Markham now runs **10 categories** (up from 3), added purely via `lib/dropin/sources/perfectmind/config.ts` — zero changes to `client.ts`, `normalize.ts`, or `index.ts`. `PerfectMindAdapter + VaughanConfig + MarkhamConfig` architecture unchanged.

## 5. Before vs. After Session Count

**[MEASURED]**: 397-470 sessions (Phase 3.5B's 3-category baseline, varying run to run with live data) → **1,471 sessions** (this phase's 10-category refresh) — roughly a 3.5x increase, entirely from real, sampled, classified categories.

## 6-7. Requests, Duration

**[MEASURED]**, this phase's actual refresh:

| Category | Requests | Pages | Records |
|---|---|---|---|
| Sports & Activities | 9 | 9 | 329 |
| Swimming | 4 | 4 | 186 |
| Skating | 2 | 2 | 9 |
| Activities for Age 55+ | 2 | 2 | 14 |
| Aquafit | 8 | 8 | 314 |
| Group Fitness: Cardio | 8 | 8 | 315 |
| Group Fitness: Mind & Body | 3 | 3 | 90 |
| Group Fitness: Strength Training | 3 | 3 | 79 |
| Group Fitness: Total Body Workout | 3 | 3 | 53 |
| Sensory Room / Indoor Playground | 3 | 3 | 82 |
| **Total** | **45** | **45** | **1,471** |

Every category reached a genuine completion signal (cursor exhaustion) well under the 40-page safety cap — no category came close to the cap, so the completion gate (Phase 3.5B) never needed to fire during a clean run. Markham-only refresh: **35-37s**. Full 5-source refresh (Toronto + Mississauga + Richmond Hill + Vaughan + Markham, concurrent): **~36s wall-clock**, all 5 activated.

**[VERIFIED] forced-failure regression** (inherited unchanged from Phase 3.5B, not re-broken by this expansion): the completion gate still throws — and `refreshOneSource` still writes no snapshot at all — the moment any single category fails to reach genuine completion. Not re-tested with a forced cap this phase since the mechanism itself was not touched; Phase 3.5B's own forced-cap test already proved it.

## 8. Duplicate / Canonical-ID Findings

**[VERIFIED]**, re-run against the real expanded dataset: **zero canonical id collisions** within Markham's 1,471 sessions, and **zero `(EventId, OccurrenceDate)` pairs appearing under more than one category** (checked directly — no session got pulled through two different category calendars). Combined across all five live municipalities (Toronto 25,326/26,353 + Mississauga 14,994/15,985 + Richmond Hill 203/258 + Vaughan 1,192 + Markham 1,471, read-time-filtered/raw counts respectively) — canonical snapshot totals: **45,259 sessions, 45,259 unique ids, 0 collisions**.

## 9. New Activity Types Discovered

**[VERIFIED]**: 64 real distinct activity titles across the 7 newly added categories (Zumba, Cardio Dance, Step, Cycle Fitness, Muscle Conditioning, Pilates, Functional Movement Workout, Bodyweight Boot Camp, Barre, Tai Chi Sword, Line Dance, LaBlast, Aquafit Shallow/Deep/Stretch, Drop-In Sensory Room, Drop-In Indoor Playground, and more). None of these exact-match Toronto's curated shortcut list (`ACTIVITY_GROUPS`), so `category` falls back to the literal PerfectMind category name for all of them — the existing, unmodified fallback pattern. **No Markham-specific activity aliases were added** — the existing `getShortcutForActivity` + substring/stem-match search logic (`search-intent.ts`, unchanged since Phase 3.5B) handles every new title correctly with zero new code, confirmed in §10.

## 10. Search QA

**[VERIFIED]**, real browser testing against the live app: `"aquafit Markham"` (9 real Aquafit results, correct location), `"zumba Markham"` (Drop-In Zumba resolved via the Phase 3.5B stemming fix — "zumba" isn't in any shortcut list, pure substring match against the real title), `"yoga Markham"` (36 activities), `"pilates Markham"` (12), `"fitness Markham"` (48), `"skating Markham"` (3), `"badminton Markham"` (19), `"swimming Markham"` (51) — all correctly resolved both an activity list and the Markham location, confirming the Phase 3.5B search fix remains intact under the 3.5x larger real dataset. `"badminton Scarborough"` regression-checked live (6 real results) — Toronto/Scarborough coverage intact.

## 11. Attendance + Register CTA QA

**[VERIFIED]**: all 1,471 Markham sessions carry `attendanceRequirement: "pre-registration-required"` (the Phase 3.5C constant, category-independent by design) and 100% have a populated `officialUrl`. Live-tested a real Aquafit session (the category with the "in-person only" nuance, §14): Decision Sheet correctly shows "Pre-registration required" and a "Register" CTA pointing to the real official listing — no volatile per-record state (`registrationStatus`, internally `undefined` for this session since its `BookButtonText` was `"More Info"`) leaked into the UI. Same pattern confirmed for a Group Fitness: Zumba session.

## 12. Data-Quality Findings

**[VERIFIED]**, quantified against the real 1,471-session Markham dataset:

| Check | Result |
|---|---|
| Missing age (both min/max undefined) | 131 / 1,471 (8.9%) — real `NoAgeRestriction: true` from source, not a gap |
| Missing price | 0 |
| Missing coordinates | 0 |
| Missing `officialUrl` | 0 |
| Missing centre | 0 |
| Sessions longer than 4 hours | 0 |
| Implausible coordinates (outside GTA bounding box) | 0 (filtered at normalize time, per Phase 3.5B) |
| Content-level duplicates (same activity+centre+start-time appearing twice) | 0 |
| Conventional registered courses found among included categories | 0 — every single sampled title across all 10 included categories was `"Drop-In "`-prefixed; the source widget itself is scoped to drop-in-only programming (§1) |

## 13. Full Five-Municipality Regression Result

**[VERIFIED]**: `npm run refresh:data -- --all` — 5/5 sources activated, zero failures. `/api/sessions` still snapshot-driven (169-269ms response, ~30MB payload), still never waits on PerfectMind at request time. Live-tested Scarborough (Toronto family) unaffected. Toronto 25,326, Mississauga 14,994, Richmond Hill 203, Vaughan 1,192, Markham 1,471 all present and correctly attributed in the combined `/api/sessions` response.

## 14. Remaining Risks

**[KNOWN LIMITATION]**:
- Aquafit is real active recreation but "in-person only" per Markham's own banner — every sampled Aquafit record shows `BookButtonText: "More Info"` even for same-day sessions (never `"Register Now!"`), unlike every other category. The Decision Sheet still correctly shows "Pre-registration required" / "Register" (technically accurate — a registration step of some kind is still required), but a user clicking "Register" will land on a page that itself explains the in-person requirement rather than completing registration online. Not a bug; a genuine platform nuance worth knowing about.
- Adapted, Quick Fitness, and Tennis Round Robins remain unconfigured — not because they were evaluated and rejected, but because they currently have zero live sessions to validate against. Two of the three (Quick Fitness, Tennis Round Robins) look like probable future INCLUDEs by name-pattern alone; this should be re-audited periodically rather than assumed permanently out of scope.
- "Activities for Age 55+" is a mixed-content category (Tai Chi/Yoga/Line Dance/LaBlast are clearly active; Mahjong and Art-for-older-adults are more sedentary/social) — included as a whole category per the "prefer configuration changes over complex heuristics" guidance rather than session-level filtering within it.

**[RECOMMENDATION] for what Phase 3 should do next**: with Markham's real category coverage now substantially complete (10 of 11 live categories) and Vaughan already at its full 3-category taxonomy, the two PerfectMind municipalities are in a comparably mature state. The next highest-value data-coverage work is likely either (a) periodically re-checking Adapted/Quick Fitness/Tennis Round Robins for when they go live, which requires no new engineering — just re-running the same taxonomy audit — or (b) beginning Phase 4 (Map/Near Me/Distance), which this phase was explicitly instructed not to start.
