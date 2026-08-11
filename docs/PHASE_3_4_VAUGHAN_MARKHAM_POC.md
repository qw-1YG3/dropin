# Phase 3.4 — Vaughan + Markham PerfectMind/Xplor Data Access POC

Investigation and proof-of-access only — no production adapter was built. Every claim is tagged **[WEBSITE]** (verified from the official municipal website), **[NETWORK]** (verified from real network traffic captured in a browser), **[API]** (verified from a real API response, including via plain server-side HTTP with no browser involved), or **[INFERRED]** (a reasoned conclusion, not independently confirmed — never presented as fact).

---

## 1. Official Recreation Sources

**[WEBSITE]** Both municipalities' own recreation pages point to a PerfectMind-family platform, confirmed by direct navigation and DOM inspection, not assumption:

- **Vaughan**: `vaughan.ca/residential/recreation-programs-and-fitness/recreation-programs` states "All program codes link directly to online registration at vaughan.perfectmind.com." The Sports & Game Rooms page (`vaughan.ca/residential/recreation-programs-and-fitness/sports-game-rooms`) embeds a real widget link: `vaughan.perfectmind.com/25076/Clients/BookMe4?widgetId=dff88c8a-0b78-4a94-9dde-250040385300`. The bare domain root (`vaughan.perfectmind.com`) redirects straight to a login page — the real public entry point is this specific widget URL, not the root.
- **Markham**: `markham.ca/sports-recreation-fitness/sports-recreation-programs/programs/drop-programs` has a "VIEW DROP IN PROGRAMS" button linking to `cityofmarkham.perfectmind.com/Clients/BookMe4?widgetId=6825ea71-e5b7-4c2a-948f-9195507ad90a`. A separate "VIEW PROGRAMS" button on the same page links to a *different* widget (`widgetId=bfd08479-...`) for registered (non-drop-in) programs — the platform genuinely separates these into two distinct public entry points, at least for Markham.

**Important vendor-branding nuance, resolved with direct evidence**: Markham's own external communications refer to "Xplor Recreation" (confirmed via web search — a 2023 platform migration, with `communications@xplorrecreation.com` as the vendor's email domain). **[WEBSITE]** Despite that branding, Markham's actual live platform is hosted at `cityofmarkham.perfectmind.com` — the identical `perfectmind.com` domain and `/Clients/BookMe4` URL structure Vaughan uses. Xplor acquired/rebranded PerfectMind as a company; the technical platform both municipalities' public booking pages actually run on is the same product family. This was verified directly rather than assumed from the shared vendor name.

Both are embedded as full-page navigations (not iframes) from the municipal site — a public visitor clicks through to a `perfectmind.com`-hosted page, not an embedded widget on `vaughan.ca`/`markham.ca` itself.

## 2. Actual Data Transport

**[NETWORK]**, identical mechanism found for both municipalities, matching the Phase 3.1 investigative methodology:

1. `GET /Clients/BookMe4BookingPages/Classes?calendarId=<uuid>&widgetId=<uuid>&embed=False` — returns server-rendered HTML containing a hidden `<input name="__RequestVerificationToken" value="...">` (a 113-character token, standard ASP.NET anti-forgery pattern) and sets session cookies.
2. `POST /Clients/BookMe4BookingPagesV2/ClassesV2` — `application/x-www-form-urlencoded` body containing `calendarId`, `widgetId`, `page`, a `Date Range` filter (`values[0][Name/Value/Value2/ValueKind]`), and the `__RequestVerificationToken` from step 1. Returns JSON: `{ classes: [...], classesMaxEndDateString, nextKey }`.

No GraphQL, no separately-documented REST API — this is the same internal frontend-support API pattern found for ActiveCommunities in Phase 3.1, not a published/versioned contract.

**Pagination mechanism, precisely** (a real point of initial confusion, resolved and documented so it isn't repeated): `page` is **not** a page counter — it stays `"0"` on every call. Pagination is a **date cursor**: each response's `nextKey` (a date string) becomes the next request's `Date Range` start value. Naively incrementing `page` on successive calls (`0`, `1`, `2`...) with a stale token/cursor produced a generic ASP.NET "Oops... there is an error" HTML page instead of JSON on the second call — confirmed directly, then corrected by re-testing with the right pattern (`page` always `0`, cursor advanced via `nextKey`), which then paged cleanly through multiple consecutive real calls (63 → 61 → 49 records, dates correctly advancing).

## 3. Cold Access Test

**[API] Classification: A — Public and stable enough for server-side refresh.**

Both municipalities' endpoints were called from a clean Node.js script and from plain `curl`, with zero prior browser session, zero manually-copied cookies, zero CAPTCHA, zero login:

- Vaughan: cold `curl` GET → extract token → `curl` POST returned real data (`HTTP 200`, 60 real sessions on the first call).
- Markham: identical cold `curl` sequence, same result (`HTTP 200`, 64 real sessions on the first call).
- Both re-verified via an isolated Node script (`scripts/poc/perfectmind-client.mjs`) with correct pagination, successfully paging through several consecutive calls for both cities.

This matches Phase 3.1's ActiveCommunities finding almost exactly: a two-step handshake (unauthenticated `GET` for a token, then `POST` with that token + cookies), fully reproducible, no interactive step required.

## 4. Real Recreation Data Schema

**[API]**, fields verified directly against real response records (field list confirmed identical between Vaughan and Markham — see §6):

| DropIn concept | Source field(s) | Notes |
|---|---|---|
| Program/activity name | `EventName` | Real, e.g. "Adult Pickleball", "Drop-In Badminton: All Ages" |
| Subtype/category | The calendar/category itself (e.g. "Sports", "Fitness Centre") — no separate per-record subtype field found | Category is a request-time filter dimension, not a field on each record |
| Facility | `Facility` (room/court-level, e.g. "Gymnasium: 3") + `Location` (building-level, e.g. "Aaniin Community Centre") | Two-level, same pattern as ActiveCommunities' facility/center split |
| Address | `Address.Street`, `.City`, `.PostalCode` | Real, structured |
| **Coordinates** | `Address.Latitude`, `Address.Longitude` | **Present on 100% of Markham records sampled and 98% (352/359) of Vaughan's "Sports" sample** (100% on Vaughan's "Fitness Centre" sample) — a genuine, structured field, not inferred. Neither Toronto nor ActiveCommunities provide this at all. |
| Municipality | Not a per-record field — implicit from which tenant/host was queried | Same pattern as every other source integrated so far |
| Start/end date & time | `OccurrenceDate`, `FormattedStartDate`, `FormattedStartTime`, `FormattedEndDate`, `FormattedEndTime` | Real dated occurrences, not recurring templates — confirmed by inspecting many real records across a multi-week pull |
| Age eligibility | `MinAge`, `MaxAge`, `NoAgeRestriction`, plus month-granularity variants | Real, structured, and genuinely varies — observed `MinAge: 18, MaxAge: 99`, `MinAge: 5, MaxAge: null`, confirming this isn't a constant placeholder |
| Registration/drop-in status | `BookButtonText`, `ClosedButtonName`, `BookingType` | See §5 — present, but does not cleanly map to "true walk-in vs. reservation" |
| Fee | `PriceRange` (e.g. `"$0.00 - $8.50"`) | A range, not always a single number — same ambiguity Phase 3.1 found in ActiveCommunities' price data |
| Capacity | `Spots` (e.g. `"15 spots left"`, `"Full"`, or empty string) | Present but inconsistently formatted (free text, not a clean number in every case) |
| Program/session ID | `EventId` (a GUID, the specific dated occurrence) and `CourseId` (a numeric string, the recurring program) | Same "occurrence vs. schedule" distinction Toronto/ActiveCommunities already model |
| Facility ID | `Address.Id` | A GUID |
| Source URL | Not present as a field | No per-record deep link was found in this response payload — worth flagging as a gap relative to ActiveCommunities, which did provide one (`activity_detail_url`) |

None of these field meanings were assumed — each was cross-checked against what the live widget UI visibly displayed for the same records (e.g., the "$0.00 - $8.50" price range and "15 spots left" capacity text visible on Vaughan's real Sports listing page matched `PriceRange`/`Spots` exactly).

## 5. Drop-In Semantics — the Central Finding

**[WEBSITE] + [API], consistent across both municipalities, and unambiguous:**

- Vaughan's own drop-in widget's page title, verified directly in the rendered page: **"Pre-Registered Drop-In Activities."**
- Markham's own drop-in widget states directly on the page: **"Residents may register for most drop-in activities up to 21 hours before the program start time. Aquafit is in-person only."**
- Both platforms' real button text for these "drop-in" listings is **"Register Now!"** (Vaughan) / **"Register"** (Markham) / **"Waitlist"** / **"Not available."** — never any wording implying walk-in-without-booking, across every record sampled in this investigation (over 1,000 real sessions across three categories and two municipalities).
- The one field that might structurally distinguish attendance modes, `BookingType`, was found to be a **constant value (`2`) across every single record sampled** in both municipalities' drop-in buckets — it does not vary within the "drop-in" category, so it cannot be used to further distinguish walk-in from reservation-required within that bucket.

**Conclusion, stated plainly per the explicit instruction not to invent a classification**: **neither Vaughan nor Markham's "drop-in" programming is true walk-in.** Both platforms' own first-party copy states registration is required, both share the identical real UI pattern (a "Register"/"Register Now" action, never "walk in"), and no structured field was found that further subdivides this into "more" or "less" reservation-required within the drop-in bucket. This directly confirms what Phase 3.0 flagged as a real concern for Vaughan specifically, and extends the same finding to Markham with equally direct, first-party evidence — not inferred by analogy.

**One genuine nuance, not smoothed over**: Markham's own page notes "Aquafit is in-person only" — meaning at least one category may not be book-ahead-online at all, but rather requires a different (in-person, still not "walk-in-and-play" in the DropIn sense) process. This wasn't investigated further in this phase (Aquafit specifically wasn't pulled) — flagged as a real **[INFERRED]** open question, not resolved here.

## 6. Vaughan vs. Markham Platform Comparison

**[API], directly verified — the schema comparison in §4 was produced by literally running the same client code against both tenants.**

| | Vaughan | Markham |
|---|---|---|
| Host | `vaughan.perfectmind.com` | `cityofmarkham.perfectmind.com` |
| URL structure | `/25076/Clients/BookMe4...` (numeric site-id segment present) | `/Clients/BookMe4...` (no numeric segment) |
| Auth mechanism | Identical — hidden-input CSRF token + cookie jar | Identical |
| `ClassesV2` request shape | Identical field names | Identical field names |
| `ClassesV2` response shape | Identical field names (confirmed: same ~50-key object) | Identical |
| Pagination | Identical (`page` constant, `nextKey` date cursor) | Identical |
| Coordinates | Present (98–100% of sampled records) | Present (100% of sampled records) |
| Age data | Present, real, varies | Present, real, varies |
| `BookingType` | Constant `2` across all sampled records | Constant `2` across all sampled records |
| Drop-in top-level framing | "Pre-Registered Drop-In Activities" | "Drop-In Programs & Activities" + explicit "residents may register... up to 21 hours before" copy |
| Category taxonomy | Lean: 3 active categories (Fitness Centre, Sports, Swimming & Aquafitness; Skating greyed out/inactive) | Broad: ~13 categories (Activities for Age 55+, Adapted, Aquafit, Art, four Group Fitness subtypes, Quick Fitness, Sensory Room/Indoor Playground, Skating, Sports & Activities, Swimming, Tennis Round Robins) |
| Activity-name style | Plain names ("Adult Pickleball", "Adult Game Room") | Consistently prefixed ("Drop-In Badminton: All Ages", "Drop-In Basketball: Adults") |

**Explicit answer: a shared source-family architecture is justified.** The transport, authentication, request/response schema, and pagination mechanism are byte-for-byte identical between the two municipalities — the only real differences are configuration-shaped (host, tenant-specific `widgetId`/`calendarId` UUIDs, category breadth, and activity-naming conventions), exactly the pattern that justified the shared ActiveCommunities adapter in Phase 3.2. **This directly supports `PerfectMindAdapter` (or `XplorAdapter` — either name is defensible; "PerfectMind" reflects the actual technical platform, "Xplor" reflects current vendor branding) + per-municipality configuration**, not two separate `VaughanAdapter`/`MarkhamAdapter` implementations.

## 7. Data Volume & Horizon

**[API]**, real numbers from this investigation's actual pulls (not exhaustive — a bounded POC sample, explicitly not a full citywide harvest, per the instruction to be respectful of source load):

| | Category sampled | Sessions (6-page pull) | Date range covered | Distinct activity names |
|---|---|---|---|---|
| Vaughan | Sports | 359 | Aug 11–28, 2026 (17 days) | 17 |
| Vaughan | Fitness Centre | 398 | Aug 11–19, 2026 (8 days) | 46 |
| Markham | Sports & Activities | 336 | Aug 11–29, 2026 (18 days) | 20 |

**[INFERRED]**: extrapolating from these three category-level samples (roughly 20–50 sessions/day per category once multiple categories are combined) to each municipality's *full* category set (3 for Vaughan, ~13 for Markham) suggests each municipality's total drop-in catalog is plausibly in the low-to-mid thousands of sessions over a multi-week horizon — comparable in order of magnitude to Richmond Hill, and for Markham specifically (given its much broader category count) potentially approaching Mississauga's scale. **This was not directly measured for the full catalog** — a real production investigation would need to pull every category to confirm, which this POC deliberately did not do.

**Pagination/batching requirement, concretely**: unlike ActiveCommunities (which returned an entire municipality's full catalog in one batched request per calendar), PerfectMind's `ClassesV2` endpoint returns only a few days' worth of results per call (~60-70 records), requiring genuinely repeated paginated calls — for Markham's ~13 categories over say a 90-day horizon, this could mean on the order of 100+ HTTP requests per full refresh, per municipality. **This is the single most consequential architectural difference from the ActiveCommunities family**, and belongs directly in any future production-adapter cost/timing estimate.

## 8. POC Artifacts

**[API]**, all under `scripts/poc/`, not connected to `refresh:data`:

- `scripts/poc/perfectmind-client.mjs` — shared transport client (session creation, single-page fetch, cursor-based full pagination), proven against both tenants unmodified — itself direct evidence for §6's shared-architecture conclusion.
- `scripts/poc/perfectmind-vaughan-markham.mjs` — runner script, real output reproduced in §7.
- Small real samples (15 records each) saved to `data/raw/poc-perfectmind/{vaughan,markham}/*.json` — gitignored (already covered by the existing `/data/raw/` gitignore rule from Phase 3.3), ~132KB total, not the full pull.

## 9. Production Fit Assessment

| | Vaughan | Markham |
|---|---|---|
| **Data access** | Good | Good |
| **Drop-in semantics** | Clear (pre-registration required — confirmed directly, first-party) | Clear (pre-registration required — confirmed directly, first-party; one unresolved nuance for Aquafit specifically) |
| **Source stability** | Medium — internal frontend API, not published/versioned, standard ASP.NET session mechanics, no rate-limiting observed in this investigation's modest call volume | Medium — identical platform, same caveat |
| **Production adapter feasibility** | Needs additional investigation | Needs additional investigation |

Both rated "needs additional investigation" rather than "ready," specifically because of §7's pagination-volume finding (real per-municipality request counts for a full refresh weren't measured, only inferred) and because this POC did not test the platform's behavior under the request volume a real production refresh would generate (no rate-limit behavior was observed, but also never stress-tested).

**1. Can Vaughan be added to DropIn?** Technically yes — access, schema, and semantics are all confirmed with real evidence. Not blocked, but not yet "ready" without resolving §7's volume question.

**2. Can Markham be added to DropIn?** Same answer — technically yes, same caveats, plus its broader category count means a real refresh will cost meaningfully more requests than Vaughan's.

**3. Can they share one source-family adapter?** Yes — directly demonstrated, not just argued (§6, §8).

**4. Which should be implemented first?** **[RECOMMENDATION-flavored, stated as inference from evidence, not a decision made in this phase]**: Vaughan — its leaner 3-category taxonomy means a full-catalog refresh requires meaningfully fewer paginated calls than Markham's ~13 categories, making it the cheaper, faster proof of the shared-adapter architecture at production scale, with Markham as the natural, low-marginal-cost second municipality once the adapter is proven (the same relationship Mississauga/Richmond Hill had in Phase 3.2, but inverted — here the *smaller* catalog goes first specifically because of the pagination-cost asymmetry, not catalog size alone).

**5. What is the biggest remaining risk?** The pagination cost at real production scale (§7) — specifically, the number of sequential requests a full multi-category, multi-week refresh would require, and whether that volume risks rate-limiting or simply takes materially longer than Mississauga's single-batched-call pattern did in Phase 3.2. This needs to be measured directly (a real, timed, full-category pull for one municipality) before committing to a production implementation, not assumed from this POC's deliberately bounded sample.

## 10. Scarborough Coverage Reminder — QA Check

**[API]**, checked directly against the real, current Toronto canonical snapshot (`data/canonical/toronto/latest.json`), not re-derived or assumed:

- **4,174 Scarborough sessions present** (district = "Scarborough"), out of 29,255 total Toronto sessions.
- **39 distinct Scarborough facilities** represented, including Agincourt Community Recreation Centre, Birchmount Community Centre, Centennial Recreation Centre - Scarborough, Cedarbrae Collegiate Institute, and Commander Recreation Centre, among others.
- A sampled real record (`toronto-9`, "Basketball" at Birchmount Community Centre) carries full location metadata — `district: "Scarborough"`, real street address, real postal code — confirming search/location metadata is already sufficient for the existing generic district-search mechanism to surface Scarborough results correctly, exactly as verified in Phase 3.2/3.3's own QA passes.

No changes were made to Toronto's adapter or district logic. Scarborough remains correctly represented as part of Toronto, not as a separate municipality.

---

## Constraints Compliance

No UI, search UX, filters, result cards, or Map/Near Me functionality were touched. No production Vaughan/Markham adapter was built. No database or cloud/deployment infrastructure was introduced. No data was hardcoded to make a test pass — every number in this document came from a real network call to a real municipal-vendor endpoint, run during this investigation.

## Stopping Point

Per the explicit instruction: stopping after this POC. No production PerfectMind/Xplor adapter implementation was started. The recommended next step, if this investigation is accepted, is a direct measurement of full-category, multi-week pagination cost for one municipality (Vaughan, per §9) — not adapter code — before any production commitment.
