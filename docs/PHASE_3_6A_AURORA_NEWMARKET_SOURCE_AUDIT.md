# Phase 3.6A — Aurora + Newmarket Source & Platform Audit

Investigation only. No production code was touched — `lib/dropin/sources/`, `refresh:data`, the municipality registry, and canonical `Session` are all unchanged. Every claim is tagged by evidence type (**WEBSITE**, **NETWORK**, **API**, **INFERENCE**) and confidence (**VERIFIED**, **LIKELY**, **UNKNOWN**, **DEFERRED**).

---

## 1. Aurora Official Recreation Path

**WEBSITE, VERIFIED.** `aurora.ca` (homepage) → "Recreation, Arts and Culture" → "Recreation Programs and Drop-In Activities" → "Drop-In Activities" (lists: A.F.L.C. Drop-Ins, A.R.C. Drop-Ins, Aquafitness, Group Fitness, Indoor Track, Pickleball, Preschool, Rock Wall, Seniors Walking Club, Shinny Hockey, Skating, Squash, Swimming, Table Tennis, Tennis, The Loft) → registration platform link: **"e-PLAY - Online Registration"**.

## 2. Newmarket Official Recreation Path

**WEBSITE, VERIFIED.** `newmarket.ca` (homepage) → "Recreation and Parks" → "Drop-in Programs and Schedules" (`/schedules`). This page directly states: *"All drop in users require an Xplor Account to access Drop-In Programs"* and links 9 live category calendars plus downloadable seasonal PDF schedules for categories without live booking.

## 3. Aurora Platform

**NETWORK + API, VERIFIED — ActiveCommunities / ACTIVE Network.** Aurora's "e-PLAY" link resolves to `https://ca.apm.activecommunities.com/AuroraOntario/`, which redirects to `https://anc.ca.apm.activecommunities.com/auroraontario/home?...` — the exact same host (`anc.ca.apm.activecommunities.com`) DropIn's existing `ActiveCommunitiesAdapter` already talks to for Mississauga and Richmond Hill. The page itself displays the "ACTIVE Network" logo. Tenant slug: **`auroraontario`**.

## 4. Newmarket Platform

**NETWORK + API, VERIFIED — PerfectMind / Xplor BookMe4.** Newmarket's schedules page links directly (in static server-rendered HTML, no JS needed to discover) to `https://newmarket.perfectmind.com/Clients/BookMe4BookingPages/Classes?calendarId=...&widgetId=15f6af07-39c5-473e-b053-96653f77a406` — the identical URL shape and domain pattern (`{tenant}.perfectmind.com`) already used for Vaughan and Markham. Widget id: **`15f6af07-39c5-473e-b053-96653f77a406`**.

## 5. Server-Side Accessibility

**API, VERIFIED for both**, tested with plain `node` `fetch` — no browser, no Puppeteer/Playwright:
- **Aurora**: `GET /auroraontario/calendars` → real cookie + inline CSRF token → `POST /auroraontario/rest/onlinecalendar/filters` and `/rest/activities/list` both return real JSON (HTTP 200) with real centers, real programs. A second-tier `GET /auroraontario/rest/program/{id}/sessions` (same cookie, no new handshake) returns fully structured per-occurrence dates/times.
- **Newmarket**: `GET /Clients/BookMe4BookingPages/Classes` → real cookie + inline `__RequestVerificationToken` → `POST /Clients/BookMe4BookingPagesV2/ClassesV2` returns real JSON (HTTP 200), byte-identical shape to Vaughan/Markham's `ClassesV2` response.

## 6. Authentication/Session Requirements

**API, VERIFIED.** Neither municipality requires login, CAPTCHA, or a pre-existing account to *read* catalog/session data — both only need the same anonymous cookie-jar-plus-token bootstrap already implemented for their respective families (`activecommunities/client.ts`, `perfectmind/client.ts`). Account/login is only required to complete an actual *registration* (this is what "Xplor Account" and "e-PLAY account" refer to) — irrelevant to DropIn, which never books on a user's behalf.

## 7. Existing DropIn Source Family — Reusable?

| | Aurora | Newmarket |
|---|---|---|
| ActiveCommunitiesAdapter | **Yes** — same host, same REST paths | No |
| PerfectMindAdapter | No | **Yes** — same host pattern, same `ClassesV2` mechanism, byte-identical record shape |
| Toronto/Open Data pattern | No | No |
| New source family required | **No** | **No** |

**No fourth source family is necessary for either municipality.**

## 8. Config-Only vs. Adapter Change vs. New Source Family

- **Newmarket → PerfectMind: CONFIG ONLY.** Confirmed by directly running the existing mechanism (bootstrap + `ClassesV2`) against `newmarket.perfectmind.com` with zero code changes — it returned real classes with the identical field shape `normalize.ts` already parses (`EventId`, `OccurrenceDate`, `FormattedStartTime`, `Address.Latitude/Longitude`, `BookButtonText`, `DisplaySettings.ButtonName`, etc.). Adding Newmarket would be a `PerfectMindMunicipalityConfig` entry, nothing else.
- **Aurora → ActiveCommunities: SMALL GENERIC ADAPTER IMPROVEMENT, not pure config-only.** Aurora's real drop-in content (confirmed: "Drop In - Adult Pickleball", "Drop In - Adult Volleyball") lives in the `activities/list` catalog — the endpoint the existing adapter currently uses *only* for age-enrichment, never as the primary session source (see `activecommunities/client.ts`'s own comment: *"used only for best-effort age enrichment... never as the primary session source"*). Aurora's `onlinecalendar/multicenter/events` feed (the adapter's current primary source, and the one Mississauga/Richmond Hill actually use for their drop-in content) returned **zero drop-in-sounding titles across all 6 centers and ~84 days** — it appears to carry only registered/structured programs for this tenant. A working Aurora integration would need the adapter to optionally treat `activities/list` (filtered to "Drop In"-prefixed titles) plus its per-program `/sessions` sub-resource as the primary source for this tenant — a real, scoped code path the current adapter doesn't have, not a config value.

## 9. Drop-In Semantics

**WEBSITE + API, VERIFIED for both, and unusually explicit** (more so than Vaughan/Markham were at the equivalent stage):

- **Newmarket**: town copy states outright — *"All pre-registered drop-in programs (Aqua Fit, Group Fit, Badminton, Pickleball & Volleyball) will no longer have a waitlist option"* and *"Failure to attend a pre-registered drop in will result in a $10 no show fee."* This is **pre-registration required**, stated by the municipality itself, not inferred from button labels. Confirmed structurally too: every sampled Sports-category record's real `Details` field reads *"Magna Centre Gym drop in program"* and carries a real `BookButtonText`/`DisplaySettings.ButtonName: "Register"` — the same PerfectMind pattern as Vaughan/Markham.
- **Aurora**: **mixed, category-dependent** — a genuinely new pattern DropIn hasn't seen yet. Pickleball/Volleyball drop-ins have an explicit "Pre-Registration Guidelines" page, a no-show/cancellation policy, and require online enrollment (`already_enrolled`/`total_open` fields, "Enroll Now" action) — **pre-registration required**. But other advertised drop-in categories (Table Tennis, Rock Wall, general AFLC Gymnasium, Indoor Track) are published only as downloadable seasonal PDF schedules with no matching `activities/list` entry found — consistent with simple walk-in/pass-based admission (Aurora's own site separately describes "Drop-Ins & Memberships" admission via its Pass Validation page, distinct from "Registered Programs"). **This cannot be collapsed into one constant per municipality the way Vaughan/Markham/Toronto currently are** — seed evidence suggests Aurora's real attendance requirement varies *by category*, not just by source family.

## 10. Official Registration/Listing URL Feasibility

**API, VERIFIED, cold-tested for both:**
- Newmarket: `https://newmarket.perfectmind.com/Clients/BookMe4LandingPages/Class?widgetId=...&classId={EventId}&occurrenceDate={OccurrenceDate}` — same construction as Vaughan/Markham — **HTTP 200 cold**.
- Aurora: two real, stable, session/program-specific URLs, both **HTTP 200 after redirect, cold**: `activity_detail_url` (`.../activity/search/detail/{id}`) for registered-style catalog entries, and `detail_url` (`.../daycare/program/{id}`) for the FlexReg program-detail page used by real drop-in programs. Both are program-specific, not generic search pages.

## 11. Relevant Category Taxonomy

**WEBSITE + API, VERIFIED, both partial:**
- **Newmarket**: 9 live category calendars, discovered directly from static HTML (no browser click-through needed): Adult 55+, Arts & Culture, Fitness, Inclusion, Preschool, Skating, Sports, Swimming, Indoor Skate Park. Real sampled Sports titles: Badminton, Soccer, Pickleball, Basketball, Volleyball, Fencing — comfortably within DropIn's active-recreation scope, same shape as Markham's audit.
- **Aurora**: real "Drop In"-prefixed programs confirmed for Pickleball and Volleyball via keyword search (20+11 items respectively). Keyword search for "swim" returned 265 real catalog items but **zero** matched the "Drop In" naming convention — meaning Aurora's swim drop-ins likely exist under different real titles this investigation didn't guess correctly, not that they don't exist. "skat"/"table tennis"/"shinny" keywords returned **zero** items at all, despite being advertised drop-in categories with PDF schedules — **REVIEW**: unclear whether these have zero current live sessions (like Markham's `Adapted`/`Quick Fitness`) or simply require different search terms/a proper category-filter crawl (like Phase 3.5D's link-by-link Markham audit) rather than keyword guessing. **DEFERRED** — a real category audit for Aurora needs the same systematic category-link approach used for Markham, not keyword search.

## 12. Representative Real Records

Full JSON captured for both (see §5's endpoints). Newmarket record (Badminton-Ages 8+): `EventId`, `OccurrenceDate: "20260814"`, `FormattedStartTime/EndTime`, `Address` with `Latitude: 44.043976, Longitude: -79.438918`, `PriceRange: "$0.00 - $3.75"`, `MinAge: 8, MaxAge: 99`. Aurora record (Drop In - Adult Pickleball, week-level) expands via `/sessions` into 8 real dated/timed occurrences, e.g. `first_date: "2026-08-15", beginning_time: "10:15:00", ending_time: "11:45:00"`.

## 13. Available/Missing Canonical Fields

| Field | Newmarket | Aurora |
|---|---|---|
| Program/session ID | ✓ (`EventId`) | ✓ (`session_id`, nested under `program_id`) |
| Title | ✓ | ✓ |
| Activity/category | ✓ (calendar-scoped) | ✓ (catalog category, needs its own taxonomy work) |
| Occurrence date | ✓ | ✓ (via `/sessions`) |
| Start/end time | ✓ (`FormattedStartTime`/`EndTime`) | ✓ (via `/sessions`, NOT on the top-level catalog record) |
| Facility | ✓ (`Address.AddressTag`) | ✓ (`location.label`) |
| Address | ✓ (full street/city/postal) | **UNKNOWN** — not observed in any sampled Aurora record |
| Age restriction | ✓ | ✓ (`age_description`) |
| Price | ✓ (`PriceRange`) | Only a "View fee details" link on the catalog record — real amount requires a further fetch (`/rest/program/{id}/estimateprice`, seen in network trace but not tested) |
| Latitude/longitude | ✓ (`Address.Latitude/Longitude`) | **Not observed** in any Aurora record sampled |
| Official URL | ✓ (constructible, cold-verified) | ✓ (two real patterns, cold-verified) |
| Registration requirement | ✓ (explicit town policy text) | ✓ for Pickleball/Volleyball; unclear for other categories |
| Registration status (volatile) | ✓ present (`BookButtonText`) — same as Vaughan/Markham, must stay internal-only per existing principle | ✓ present (`already_enrolled`/`total_open`/`openings`) — same principle applies, even more explicitly numeric/volatile here |
| Update timestamp | Not a source field; DropIn stamps this at refresh time, same as every other source | same |

## 14. Latitude/Longitude/Address Availability

**API, VERIFIED for Newmarket, UNKNOWN for Aurora.** Newmarket carries real, precise coordinates directly on every record — same as Vaughan/Markham, zero geocoding needed. Aurora's ActiveCommunities records (both the `onlinecalendar` events and the `activities/list` catalog) carry only a facility **name** (`"Aurora Family Leisure Cplx"`), no coordinates and no street address in anything sampled this phase — consistent with the already-known ActiveCommunities limitation (Mississauga/Richmond Hill also have none). Aurora would need the same future geocoding work already anticipated for the rest of the ActiveCommunities family, not a new problem.

## 15. Pagination Mechanism

**API, VERIFIED.** Newmarket: identical date-cursor `nextKey` mechanism as Vaughan/Markham (`nextKey: "2026-08-28"` observed on a real Sports-category pull, page size ~50). Aurora's `activities/list` endpoint is page-number-based and capped at 20 results per request server-side (`page_info.total_records` vs. `total_records_per_page: 20`, confirmed directly — a "drop in" keyword search reported 26 total records across a 20-item first page), requiring simple incrementing pagination, not a cursor.

## 16. Approximate Dataset Size

**API, MEASURED (partial).** Newmarket Sports category alone: 50 records in one page, cursor advancing to Aug 28 (comparable density to Vaughan/Markham's Sports categories). Aurora: 26 "Drop In"-titled Pickleball/Volleyball records found via keyword search alone (a real undercount — swim/skate/table-tennis/rock-wall drop-ins likely add meaningfully more once discovered via proper category browsing rather than keywords).

## 17. Refresh Complexity

- **Newmarket: HIGH feasibility.** Mechanically identical to Vaughan/Markham — same transport, same pagination, same completion-gate logic, same normalize.ts field mapping. A category-taxonomy audit (like Phase 3.5D's Markham work) is the only real remaining task before this is production-ready.
- **Aurora: MEDIUM feasibility.** The registration platform and server-side access are both fully confirmed and reliable, but real drop-in content requires a two-tier fetch (search/list → per-program `/sessions`) instead of the ActiveCommunities adapter's current single-tier `onlinecalendar` call, and the true category taxonomy needs a proper UI-driven audit rather than keyword guessing (§11). This is real, scoped engineering work, not a blocker — but it's meaningfully more than "add a config entry."

## 18. Rate-Limit/Source-Stability Risks

**INFERENCE**, based on this phase's actual request volume (a few dozen requests total across both tenants, all HTTP 200, no throttling observed) — consistent with Phase 3.5A's finding that these vendor platforms tolerate polite sequential traffic well. Aurora's two-tier fetch means proportionally more requests per real session found (one `/sessions` call per program, versus zero extra calls for PerfectMind or Mississauga/Richmond Hill's single-tier ActiveCommunities events) — worth pacing conservatively once real category counts are known, same conservative-by-default posture already used for Vaughan/Markham.

## 19. Data-Honesty Risks

**INFERENCE**, both tenants carry real, obviously-volatile fields that must NOT become DropIn-facing truth, per existing principle:
- Newmarket: `BookButtonText` (same time-relative volatility already documented for Vaughan/Markham in Phase 3.5C).
- Aurora: `already_enrolled`/`total_open`/`openings` (explicit numeric capacity, even more obviously volatile than PerfectMind's button-text state) and `allow_drop_in_reg: false` (unclear meaning, not to be surfaced without further evidence).
- Aurora's split walk-in/pre-registered reality (§9) is itself a data-honesty risk if handled carelessly: a future integration must not default every Aurora session to one attendance value the way Vaughan/Markham safely could — doing so would misrepresent the categories that are actually just PDF-schedule walk-ins.

## 20. Existing DropIn Architectural Assumptions Exposed

**INFERENCE**, reported per Part 13's instruction — none of these were changed this phase:
- `MUNICIPALITY_SLUGS` (`lib/dropin/sources/index.ts`) and `MUNICIPALITIES` (`lib/dropin/municipalities.ts`) are both hand-maintained arrays, not auto-discovered from source configs — adding any municipality always requires touching these two files, a minor but real manual step, not a structural blocker.
- `lib/dropin/sources/index.ts` has one Toronto-specific code path (`loadTorontoFallback`, the bundled-dataset safety net) — contained and harmless, but a real "assumes Toronto" special case.
- **The attendance model (`Session.attendanceRequirement`) currently assumes one constant value per municipality**, set once in each source family's `normalize.ts` (Toronto: always `"walk-in"`; Vaughan/Markham: always `"pre-registration-required"`). Aurora is the first real municipality this audit found where that assumption doesn't hold — a single tenant with a genuine category-level split. This is a real, previously-unexercised edge in the Phase 3.5C model, not a bug in it.
- The `PerfectMindAdapter`/`ActiveCommunitiesAdapter` shared-adapter-plus-config pattern itself was **validated, not weakened**, by this audit: Newmarket slots in with zero code changes, proving the abstraction generalizes past the two municipalities it was built against. Aurora is the more interesting test — it shows the *config-only* promise has a real edge (a tenant whose primary drop-in data source differs from its sibling tenants' primary source), which is architecturally healthy information to have before committing to a Phase 3.6B build, not a flaw in the existing design.

## 21-22. Recommendations

**Aurora: PROCEED WITH CONDITIONS.** Platform confirmed, server-side access confirmed reliable and real, real drop-in content confirmed to exist and be retrievable with full date/time granularity. Conditions before a production build: (1) a proper category-by-category taxonomy audit (Phase 3.5D-style, not keyword search) to find the real full set of drop-in categories and confirm which are walk-in vs. pre-registered; (2) resolve whether coordinates/addresses are obtainable at all (possibly not — may inherit the existing ActiveCommunities geocoding gap); (3) design the small adapter improvement needed to make `activities/list` + `/sessions` a first-class primary path, not just an age-enrichment fallback.

**Newmarket: PROCEED.** Platform confirmed, server-side access confirmed, data shape byte-identical to already-shipped Vaughan/Markham, drop-in semantics explicitly confirmed by the town's own published policy. The only remaining pre-production work is the same category-taxonomy audit already proven out twice (Phase 3.5B baseline + Phase 3.5D full audit) — a known, low-risk, well-understood task, not new architecture.

## 23. Recommended Phase 3.6B Architecture (if proceeding)

**RECOMMENDATION, not implemented.** Newmarket: add a `NewmarketConfig` entry to `PerfectMindMunicipalityConfig[]` after a Markham-style category audit — no other changes. Aurora: add an `AuroraConfig` entry to `ActiveCommunitiesMunicipalityConfig[]`, plus the scoped adapter change identified in §8 (an optional `activities/list`-as-primary-source path, category-filtered to "Drop In"-prefixed real titles, with its own `/sessions` expansion) — designed as a generic capability any future ActiveCommunities tenant could also opt into, not an Aurora-specific branch.

## 24. Is a Fourth Source Family Actually Necessary?

**No.** Both municipalities cleanly map to source families DropIn already operates in production. This audit found real internal variation *within* the ActiveCommunities family (Aurora's two-tier catalog vs. Mississauga/Richmond Hill's single-tier calendar) worth designing for generically, but nothing that requires a new adapter architecture.
