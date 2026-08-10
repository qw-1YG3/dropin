# Phase 3.0 — GTA Data Coverage: Source & Architecture Audit

This is an audit and planning document, not an implementation record. It exists so the multi-municipality architecture can be reviewed and decided on *before* Phase 3.1 begins — same reasoning as why `ARCHITECTURE.md` and `SEARCH_ENGINE.md` were written before their respective implementations. No ingestion code, UI change, or refactor was made as part of producing this document.

Every claim below is tagged with its evidence class:

- **[CODE]** — verified directly by reading this repository
- **[SOURCE]** — verified against an official municipal/vendor source (URL cited)
- **[INFERENCE]** — a reasoned conclusion from the above, not independently confirmed
- **[RECOMMENDATION]** — a judgment call, not a fact
- **[UNKNOWN]** — flagged as needing further investigation before Phase 3.1 relies on it

---

## 1. Current Toronto Data Architecture

**[CODE]** The Toronto pipeline, end to end:

1. **Original source**: City of Toronto Open Data Portal, package *"Registered Programs and Drop-in Courses Offering"*, published by the City's Parks, Forestry & Recreation division via its CKAN-based portal.
2. **Fetch mechanism**: none, currently. `lib/dropin/sources/toronto.ts` does `import rawDropIn from "@/data/toronto-open-data/drop-in.json"` — a build-time bundled static import, not a runtime fetch.
3. **Raw source format**: JSON (CKAN datastore dump). Two resources are used: a drop-in/registered-programs resource (13,408 records in the bundled snapshot) and a locations resource (149 records).
4. **Fetch scripts/jobs**: **none exist in this repo.** No `scripts/` directory, no cron/scheduled job, no CLI ingestion tool. `package.json` has only `dev`/`build`/`start`/`lint`. The two JSON files in `data/toronto-open-data/` were manually placed (file mtimes: 2026-08-02) and are refetched by hand, not automated.
5. **Raw snapshot storage**: two flat files, `data/toronto-open-data/drop-in.json` (4.4MB) and `locations.json` (124KB), committed to the repo and imported directly into the Next.js server bundle.
6. **Transformation/normalization layer**: `lib/dropin/sources/toronto.ts` — a single `getTorontoSessions(now, options)` function. Validates date/time shape, joins drop-in records to locations by `Location ID`, filters to the requested rolling window, de-duplicates by `(Location ID, Course_ID, start instant)`, and maps to the canonical `Session` shape.
7. **Final application data model**: `lib/dropin/types.ts`'s `Session` type (detailed in §2).
8. **Required vs optional fields**: see §2.
9. **Activity categorization**: `lib/dropin/activities.ts`'s `ACTIVITY_GROUPS` — a hand-curated map of 12 real Toronto `Course Title` values into groups (e.g. `swimming` → 6 real swim-variant titles). This is a **curated subset for search/UI shortcuts, not a data filter** — the adapter ingests every `Course Title` in the raw feed regardless of whether it appears in this map; unmapped titles pass through with `category` falling back to the raw title itself.
10. **Subtype/family relationships**: one flat map, group name → array of exact title strings. No hierarchy beyond that one level (no group-of-groups).
11. **Date/time parsing**: raw fields are `First Date`/`Last Date` (verified identical on all 13,408 real records — no recurrence expansion needed), plus separate `Start Hour`/`Start Minute`/`End Hour`/`End Min` integers. Parsed into local-wall-clock `YYYY-MM-DDTHH:MM:SS` strings with no UTC offset — the whole codebase assumes the process runs in Toronto's local timezone (`lib/dropin/time.ts`, no IANA timezone library in use).
12. **Location/centre representation**: raw `Locations` resource joined by `Location ID`. Fields consumed: `Location Name`, `District`, street-address components (concatenated into one `address` string), `Postal Code`. `District` is one of Toronto's own 4 amalgamated-city district names (North York, Scarborough, Etobicoke York, Toronto East York/Toronto and East York — the latter two both alias to "Downtown Toronto" in `lib/dropin/districts.ts`).
13. **Latitude/longitude**: **not present anywhere in the Toronto source or the app.** Confirmed by direct inspection of every raw location record — no lat/long field exists in Toronto's Locations resource at all. `Session.latitude`/`longitude` are optional fields that exist in the schema for a future source that has them; Toronto never populates them.
14. **Age restrictions**: raw `Age Min`/`Age Max` string fields (`"None"` sentinel for "no upper bound"; Age Min is always a real number, never `"None"`). Parsed into optional `ageMin`/`ageMax` numbers.
15. **Fees/pricing**: **not present in the source.** No price/fee field exists anywhere in Toronto's raw feed — not unmapped, genuinely absent. `Session.price` is optional and never populated for Toronto.
16. **Source URL/attribution**: `officialSource: "City of Toronto Open Data"` is a hardcoded literal per session. There is **no per-session `officialUrl`** — that field exists in the schema but Toronto's adapter never populates it (no field in the source maps to a specific program's own webpage).
17. **Freshness**:
    - **[CODE]** The bundled snapshot's `lastUpdated` is a hardcoded constant (`SNAPSHOT_FETCHED_AT = "2026-07-31"`), stamped identically onto every session regardless of when the adapter runs.
    - **[SOURCE]** Verified directly against the live CKAN API (`ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show`, checked 2026-08-10): the dataset's real state is `"active"` (not retired — the portal's own dataset landing page briefly appeared to say otherwise in one fetch, but that was a site-wide banner about an unrelated dataset, not this one's own status), and the City updates it **daily at 8:00 AM** with roughly a one-day lag. The bundled snapshot is materially staler than the source's real freshness — the live catalogue currently reports 29,255 drop-in records and 1,882 locations, versus the bundled snapshot's 13,408 and 149. This gap needs its own investigation (§13) — it may reflect a genuinely narrower slice taken at fetch time (e.g., only locations actually referenced by drop-in rows), not a defect, but that hasn't been independently confirmed.
18. **Toronto-specific assumptions found** — see §3.

---

## 2. Current Canonical Session Model

**[CODE]** From `lib/dropin/types.ts`, classified per the requested scheme:

| Field | Status | Notes |
|---|---|---|
| `id` | REQUIRED | `toronto-${rawId}` — adapter-namespaced, already collision-safe across municipalities |
| `projectedOccurrenceId` | REQUIRED | Equals `id` today; exists for a future source whose raw rows are recurrence templates that expand into many dates |
| `sourceScheduleId` | REQUIRED | Identifies "same recurring program" across its dated rows (Toronto's `Course_ID`) |
| `activity` | REQUIRED | Raw activity/program name, verbatim from source |
| `category` | REQUIRED | Curated shortcut label if one exists, else falls back to `activity` |
| `date` | REQUIRED | Canonical `YYYY-MM-DD`, local |
| `dayOfWeek` | REQUIRED | Computed from `date`, not trusted from source |
| `day` | OPTIONAL (legacy) | `"today"`/`"tomorrow"`/undefined — superseded by `date`, kept for one remaining legacy UI reader |
| `absoluteTime` | REQUIRED | Pre-formatted display string |
| `startMinutes` | REQUIRED | |
| `startDateTime` / `endDateTime` | REQUIRED | Local wall-clock, no offset |
| `centre` | REQUIRED | Facility name |
| `municipality` | REQUIRED | **Already exists and is already wired into search/filtering** (`sessionMatchesLocation`'s `"municipality"` case) — currently only ever populated with the literal string `"Toronto"` |
| `district` | REQUIRED | **Already exists**, but the *recognized values* are hardcoded to Toronto's own 4 district names (§3) |
| `address` | OPTIONAL | Present when the source has street-address components |
| `postalCode` | OPTIONAL | Present when source has it and it isn't the `"None"` sentinel |
| `latitude` / `longitude` | OPTIONAL, **NOT CURRENTLY SUPPORTED for Toronto** | Field exists in schema; Toronto has none to put there |
| `distanceKm` | OPTIONAL, **NOT CURRENTLY SUPPORTED** | No session has ever populated this — Phase 4 (geocoding) territory, correctly out of scope here |
| `price` | OPTIONAL, **NOT CURRENTLY SUPPORTED for Toronto** | No fee field exists in Toronto's source at all |
| `ageMin` / `ageMax` | OPTIONAL | Populated for Toronto; `ageMin` 0 + `ageMax` undefined means "no real restriction" |
| `phone` | OPTIONAL, **NOT CURRENTLY SUPPORTED for Toronto** | Never populated |
| `officialUrl` | OPTIONAL, **NOT CURRENTLY SUPPORTED for Toronto** | Never populated — no per-program link in the source |
| `officialSource` | REQUIRED | Hardcoded literal string per adapter |
| `lastUpdated` | REQUIRED | Hardcoded constant today, not derived from the live source's real update timestamp |
| `verificationStatus` | REQUIRED | Always `"verified"` for Toronto; the type also allows `"unverified"` for a future source DropIn trusts less |

**[CODE + RECOMMENDATION]** Fields the ticket specifically asked to evaluate:

- **`municipality`** — already exists, required, already wired into filtering. Nothing to add.
- **`region`** — **does not exist**, and §4 below is exactly why it would be premature to add: recreation is administered per-municipality, not per-region, so a `region` field would describe geography DropIn doesn't actually need for filtering (nothing in the product currently searches "give me all of York Region"). **Recommendation: do not add yet.** If it's ever needed, it's a display/grouping concern, cheap to add later without touching the ingestion contract.
- **`sourceProvider`** — **does not exist**. Given §6's finding that multiple municipalities share the same underlying platform (PerfectMind, ACTIVE Network), a field distinguishing "which adapter *family*/platform produced this" (not just "which municipality") would let the Search Engine or ops tooling reason about shared-platform outages or licensing without inspecting `officialSource`'s free-text string. **Recommendation: add before municipality #3** (i.e., once there are two live non-Toronto adapters, not necessarily before the very first one) — not urgent enough to block Phase 3.2.
- **`sourceRecordId`** — **does not exist as a distinct field**, but is *de facto* already present, encoded inside `id` (`toronto-${r._id}`). Not broken today, but conflating "our id" with "their id, prefixed" means a future consumer that needs the raw upstream id for a support/debugging request has to string-parse it back out. **Recommendation: low priority; consider splitting when a second adapter's own raw-id shape makes the current implicit convention awkward, don't do it speculatively now.**
- **`sourceUrl`** — **does not exist as a distinct concept from `officialUrl`.** Worth being precise about what each would mean: `officialUrl` is "link to this specific program," `sourceUrl` would be "link to the dataset/feed this record came from" — a provenance/debugging field, not a user-facing one. **Recommendation: not needed yet** — `officialSource`'s free-text string plus this document already capture that provenance at the adapter level; a per-record field would be redundant until adapters start mixing multiple upstream feeds per municipality.
- **`sourceUpdatedAt`** — **does not exist**, and this is the one gap worth taking seriously now. `lastUpdated` is currently a hardcoded per-adapter constant, not derived from the source's own real freshness signal — verified directly that Toronto's real feed has a genuine, meaningful per-dataset `metadata_modified` timestamp that the current code doesn't read at all. **Recommendation: before municipality #2, decide whether `lastUpdated` should become source-derived** (see §11) — this is a real, not hypothetical, freshness-honesty gap already present for Toronto today, independent of multi-municipality work.
- **`latitude`/`longitude`** — already exist as optional fields; nothing to add. Populating them is Phase 4 (geocoding) territory per the stated constraints, correctly excluded here.

---

## 3. Toronto-Specific Assumptions Found

**[CODE]**, by layer:

**Adapter layer** (expected, and correctly isolated):
- `municipality: "Toronto"` and `officialSource: "City of Toronto Open Data"` are literals inside `toronto.ts`. This is fine — every future adapter is expected to hardcode its own equivalents; it only becomes a problem if something *downstream* of the adapter also hardcodes Toronto.

**Location/search layer** (real, structural):
- `lib/dropin/districts.ts`'s `DISTRICTS` array is exactly Toronto's 4 amalgamated-city districts (North York, Scarborough, Etobicoke, Downtown Toronto). The neighbourhood-search intent (`matchDistrict`) can **only ever recognize these 4 names** — a Mississauga neighbourhood search would silently fail to resolve as a neighbourhood (it would fall through to postal-code/centre-name matching or "unrecognized," never "neighbourhood"). This needs a real decision before municipality #2: does "neighbourhood" search stay Toronto-only, or does every municipality need its own recognized neighbourhood list?
- `matchMunicipalityExact` (`lib/dropin/municipalities.ts`) is already municipality-agnostic — it's driven by the `MUNICIPALITIES` registry array, not hardcoded per-name logic. This one is already correctly generalized.

**UI/copy layer** (real, but low-risk to fix):
- `app/page.tsx`: the "not-yet-available municipality" fallback message hardcodes `"...here's what's available in Toronto instead"`, and its accompanying recovery button is literally labeled `"Show Toronto instead"`. **This directly contradicts `docs/SEARCH_ENGINE.md`'s own spec**, which calls for "the *nearest covered* municipality," not a hardcoded name — confirming this is drift between documented intent and shipped code, not an oversight no one had already thought about. Breaks the moment a second municipality goes live and a user searches a *third*, not-yet-covered one.
- `app/page.tsx`'s About DropIn modal: "DropIn currently covers the City of Toronto..." — static prose, not logic. Needs a copy update whenever municipality #2 ships, but carries no structural risk.

**What is *not* a Toronto-specific assumption, despite first appearances**:
- `Session.municipality` and `Session.district` being *required* fields is fine — every adapter can and should populate its own municipality's real values; the field itself isn't Toronto-specific, only today's *only caller* of it is.
- `lib/dropin/sources/index.ts`'s adapter registry is already a plain array (`ADAPTERS: Array<(now, options?) => Session[]>`) — adding a municipality is one array entry, no registry redesign needed.

---

## 4. GTA Official-Source Inventory

**[SOURCE]**, checked 2026-08-10, one municipality/region at a time. Confidence noted per entry — some are confirmed via direct fetch of the actual platform, others via search-result corroboration only and should be treated as provisional until directly tested.

### Toronto — existing, for reference
City of Toronto Open Data Portal (CKAN), package *"Registered Programs and Drop-in Courses Offering"*, `open.toronto.ca`. Confirmed active, daily updates, JSON/CSV/XML/XLSX resource formats, no auth required. Already integrated.

### Mississauga
- **Civic open-data portal**: `opendata-mississauga.hub.arcgis.com` (ArcGIS Hub) — general city open data (200+ datasets), JS-rendered pages (a plain fetch returns an empty shell; the actual API is ArcGIS's own GeoServices/REST endpoints, not the HTML search page). **No drop-in-program-schedule dataset was found here** — matches this repo's own prior finding in `municipalities.ts`'s comment.
- **Recreation booking platform**: "Active Mississauga," confirmed running on **ACTIVE Network's ActiveCommunities** platform (`anc.ca.apm.activecommunities.com/activemississauga`) — a different system entirely from the civic open-data portal above. This is the more promising lead (§6).

### Brampton
Recreation booking runs on **PerfectMind/Xplor Recreation** (`cityofbrampton.perfectmind.com`). No separate civic open-data recreation dataset found in this pass.

### Markham
Recreation booking runs on **PerfectMind/Xplor Recreation** (`cityofmarkham.perfectmind.com`) — matches this repo's existing prior finding ("Markham's drop-in programs live behind a commercial booking widget, not their open-data portal").

### Vaughan
Recreation booking runs on **PerfectMind/Xplor Recreation** (`vaughan.perfectmind.com`). Notably, Vaughan's own program copy states registration is required for *all* drop-in programs including facility/court access — a materially different "drop-in" semantic than Toronto's genuine walk-in model (relevant to §8).

### Richmond Hill
Recreation booking runs on **ACTIVE Network's ActiveCommunities**, branded "ActiveRH" (`ca.apm.activecommunities.com/richmondhill`), confirmed directly.

### Burlington
Recreation booking runs on **PerfectMind/Xplor Recreation** (`cityofburlington.perfectmind.com`).

### Hamilton
- **Recreation booking platform**: **PerfectMind/Xplor Recreation** (`cityofhamilton.perfectmind.com`), confirmed via multiple distinct booking-page URLs.
- **Civic open-data portal**: "Open Hamilton" (`open.hamilton.ca`) has a dataset named "Recreation and Community Centres." Content could not be confirmed directly — the portal is also a JS-rendered ArcGIS Hub-style page that returned no readable content via plain fetch. **[INFERENCE]**, not confirmed: given the naming parallels Toronto's own separate "Locations"/"Facilities" resources (as opposed to its "Drop-in courses" resource), this is more likely a facility-location dataset than a program-schedule one — needs direct verification before assuming either way.

### Durham-area municipalities
Recreation is administered per-municipality, not by Durham Region (see §5 for the regional-vs-municipal finding). Checked individually:
- **Ajax** — ACTIVE Network/ActiveCommunities, "ActiveAjax" (`ca.apm.activecommunities.com/ajax`), confirmed.
- **Whitby** — ACTIVE Network/ActiveCommunities (`ca.apm.activecommunities.com/whitby`), confirmed.
- **Clarington** — ACTIVE Network/ActiveCommunities, "Be Active Clarington" (`ca.apm.activecommunities.com/clarington`), confirmed.
- **Pickering** — platform not conclusively identified in this pass. **[UNKNOWN]**.
- **Oshawa** — platform not conclusively identified in this pass. **[UNKNOWN]**.
- Brock, Scugog, Uxbridge (the remaining 3 of Durham's 8 area municipalities) were not researched — outside this session's scope and, per §7, unlikely to be product-priority given their smaller populations.

### York Region municipalities
Recreation is administered per-municipality, not by York Region itself (see §5). Markham, Vaughan, Richmond Hill covered above. Not researched this session: East Gwillimbury, Georgina, King, Newmarket, Whitchurch-Stouffville, Aurora — none were named in this phase's target list.

---

## 5. Region vs. Municipality — Verified Finding

**[SOURCE]**, directly answering the ticket's explicit concern:

- **York Region**: local parks, recreation, and libraries are each lower-tier municipality's own responsibility under York's two-tier government structure. York Region itself only offers cross-cutting *subsidies* (recreation/day-camp fee assistance), not the programming itself. **There is no single "York Region recreation dataset" that would cover Markham + Vaughan + Richmond Hill at once — each needs its own adapter.**
- **Durham Region**: identical structure. The 8 area municipalities (Ajax, Brock, Clarington, Oshawa, Pickering, Scugog, Uxbridge, Whitby) each independently run their own parks and recreation; the Region's own role is regional-scale services (transit, waste, etc.), not local recreation programming. **Same conclusion: municipality-by-municipality, never region-wide.**

This confirms the ticket's instruction directly — the coverage architecture must be organized around *lower-tier municipalities*, never around the two regional governments, regardless of how the product's own marketing/geography language groups them (e.g., "York Region" as a casual location term is fine in search copy; it must never be an *ingestion* unit).

---

## 6. Shared Source/Platform Families Discovered

**[SOURCE]**, this is the single most consequential finding of this audit.

Of the 9 target areas, **at least 8 municipalities cluster into exactly two commercial booking-platform families**, neither of which is an open civic data portal:

**Family A — PerfectMind / Xplor Recreation** (`{municipality}.perfectmind.com`):
Brampton, Markham, Vaughan, Burlington, Hamilton. Confirmed via direct fetch (Brampton) that the public booking pages are **client-side JavaScript application shells with no server-rendered data** — a plain HTTP fetch returns a "Loading activities, please wait..." placeholder, nothing usable. PerfectMind/Xplor does publish API documentation (a "Web API Specifications" PDF) and a "Data Lake" product, but both are governed by their own Terms of Service pages aimed at the *municipality's own* integration partners — **no evidence of a self-service, publicly-registrable read API** comparable to what ACTIVE Network offers (§ below). Integrating any PerfectMind municipality today would mean either (a) requesting formal API/partner access through PerfectMind directly — feasibility, cost, and municipality sign-off all unknown — or (b) scraping the widget's own internal AJAX calls, which the project's own constraints explicitly rule out as "blind scraping."

**Family B — ACTIVE Network / ActiveCommunities** (`ca.apm.activecommunities.com/{municipality}`):
Mississauga, Richmond Hill, Ajax, Whitby, Clarington. Confirmed via direct fetch of `developer.active.com`'s own documentation: ACTIVE Network publishes a **genuinely public, self-service Activity Distribution API** — read-only, no OAuth/SSL required for the public endpoints, apply for a key through a normal developer-portal signup, documented rate limits (2 calls/sec, 10,000/day), and response formats including JSON. Its documented category list explicitly includes "Parks & Recreation" and "Classes."

**Important caveat on Family B, stated plainly rather than glossed over**: the documented API's example categories read like they describe **ACTIVE.com's own consumer-facing activity marketplace**, which may or may not be the same data plumbing as each municipality's individual ActiveCommunities recreation-guide instance (e.g., Mississauga's own program catalog specifically, as opposed to ACTIVE.com's aggregated cross-organization listings). **This has not been confirmed either way** — it requires actually registering a developer key and testing a real query against a specific municipality's data before treating it as usable. This is the single highest-value next step before committing to a first non-Toronto municipality (§7, §13).

**Family C — CKAN civic open data**: Toronto only, among the municipalities checked. No other GTA municipality in this list was found to expose drop-in-level *program schedule* data through their own civic open-data portal (Mississauga's and Hamilton's civic portals both appear to be facility/location data only, not schedules) — though Hamilton's specific dataset content remains unconfirmed (§4).

**[RECOMMENDATION]**: the architecture should favor **one adapter per source/platform family, parameterized by municipality**, not one bespoke adapter per municipality — *once the family's actual data contract is proven with one real municipality*. Concretely: if Mississauga (or another ActiveCommunities municipality) is confirmed to work through the public ACTIVE Network API, the resulting adapter should be written as `activeNetworkAdapter(municipalityConfig)` from the start, not as a Mississauga-specific file — the next 4 municipalities in that same family become configuration, not new code. The same logic would apply to a PerfectMind family adapter *if* a legitimate access path to PerfectMind's data is ever secured. This is explicitly conditional on evidence, per the ticket's own instruction not to over-engineer before evidence exists — do not build the family abstraction before the first real adapter proves what the shared contract actually looks like.

---

## 7. Recommended First Municipality After Toronto

**[RECOMMENDATION]**

Given §6's finding, the honest framing has changed from "which municipality is best" to "which *platform family* is actually reachable without violating the project's own no-blind-scraping constraint" — and only one family currently has a documented, self-service, public API path: **ACTIVE Network / ActiveCommunities.**

Within that family, four candidates were confirmed (Mississauga, Richmond Hill, Ajax, Whitby). Recommend **Mississauga**, but conditionally, and for reasons distinct from population size:

1. **Data accessibility** — tentatively best-positioned of the four, since ACTIVE Network's API is the only genuinely open path found across the whole 9-area survey. Still gated on the unresolved question in §6 (does the public API actually surface a specific municipality's own catalog).
2. **Data quality / drop-in specificity** — unknown until the API is actually queried; cannot be honestly rated better or worse than Ajax/Whitby/Richmond Hill from search results alone.
3. **Structural compatibility with the canonical model** — no evidence yet either way; this is exactly what a real test call would establish.
4. **Implementation effort** — likely comparable across all four ActiveCommunities municipalities once the platform's own API contract is understood, since they share the same underlying system.
5. **Reliability** — a well-established commercial vendor (ACTIVE Network is a large, long-running company across many jurisdictions) is a reasonable prior for uptime, but not verified for these specific municipal deployments.
6. **Product value / geographic usefulness** — Mississauga is the GTA's second-largest municipality by population and immediately adjacent to Toronto, genuinely useful coverage if the data holds up.
7. **What it teaches for later municipalities** — proving out *one* ActiveCommunities integration immediately de-risks Richmond Hill, Ajax, Whitby, and Clarington as near-free follow-ons (§6's family-adapter reasoning) — this is the strongest argument for Mississauga specifically over the other three: it's the largest population served by proving the same integration once.

**This recommendation is provisional on Phase 3.1 opening with a real API test call, not a full build.** If the ACTIVE Network public API turns out not to expose per-municipality drop-in schedules (the caveat in §6), the honest fallback is that **no GTA municipality in this survey currently has a clean, low-risk integration path**, and the next real step would be direct outreach to a municipality's open-data or recreation department rather than more code — a possibility this document does not want to paper over.

---

## 8. Multi-Municipality Architecture Risks

**[INFERENCE / RECOMMENDATION]**, organized by the categories the ticket asked about:

- **ID collisions** — low risk. Toronto's `id` is already adapter-namespaced (`toronto-${rawId}`); the same convention trivially extends (`mississauga-${rawId}`).
- **Timezone assumptions** — real, latent risk, but not multi-municipality-specific — it already exists for Toronto alone. Every GTA municipality shares the same timezone as Toronto (America/Toronto), so this doesn't get *worse* within GTA scope, but the "no IANA timezone library" gap remains unaddressed and would become a real bug the day DropIn ever covers a different timezone.
- **Municipality naming** — low risk; `Session.municipality` is free text and already used correctly.
- **Duplicate facilities / duplicate sessions** — real risk if a facility or program is ever cross-listed by two sources (unlikely within GTA's actual administrative boundaries per §5, but worth a de-dup guard analogous to Toronto's own `(location, course, start instant)` key if a second source is ever layered over the same municipality).
- **Activity taxonomy differences** — real and expected. `ACTIVITY_GROUPS` is hand-curated to Toronto's exact 12 `Course Title` strings; a second municipality will almost certainly use different program-naming conventions ("Open Gym" vs. "Gym Time," etc.), meaning the taxonomy needs either per-municipality mapping tables or a fuzzier canonical-activity layer — **do not assume the existing map extends for free.**
- **Different age formats** — real; already varies even within Toronto's own raw data (`"None"` sentinel handling). A new source may express age differently (e.g., "Adult," "55+," "All Ages" as free text rather than numeric bounds) and will need its own per-adapter parsing, not a shared one.
- **Different fee formats** — currently moot for Toronto (no fee data at all) but real the moment any municipality's source has fees — currency, "free" vs. `$0`, per-visit vs. membership-only pricing all need adapter-level normalization decisions, not assumed to be a single number.
- **Different cancellation/status semantics** — real and already partially surfaced: Toronto's own `Section` field mixes literal `"Drop-In"` values with `"Reserve a Spot - Sports"` — meaning even Toronto's own "drop-in" label isn't perfectly uniform today. Vaughan's own site copy confirms its "drop-in" *requires* pre-registration — a genuinely different product meaning than Toronto's walk-in model. **This is not just a formatting difference — it may be a real, user-facing distinction DropIn needs to represent honestly** rather than normalize away (see "what should NOT be normalized" below).
- **Missing end times** — not observed in Toronto's data (verified: no malformed times in the current snapshot) but should be treated as a real possibility for any new source, handled the same defensive way Toronto's adapter already does (skip and log, never fabricate).
- **Different schedule horizons** — already handled architecturally: `getTorontoSessions`'s rolling-window default is derived from the *real* max date in the source, not a hardcoded assumption. This pattern should carry forward, not be re-litigated per adapter.
- **Source freshness** — real gap, not multi-municipality-specific (§2's `sourceUpdatedAt` discussion) — worth fixing before it compounds across multiple adapters with different real update cadences.
- **Source outages** — no current handling for a source being unreachable at request time; moot today since Toronto's adapter reads a static bundled file, not a live call. Becomes a real question the moment any adapter does a live fetch (even at build/sync time, not per-request, per the documented "database-first" target architecture).
- **Partial updates** — not applicable to the current static-snapshot model; becomes relevant only once a real scheduled sync exists.
- **Geocoding needs** — explicitly out of scope for this phase per the ticket's own constraints; noted only to confirm it wasn't accidentally pulled in.
- **Search normalization / location filtering** — the real, concrete risk is §3's `DISTRICTS` hardcoding — needs an explicit decision before municipality #2, not an afterthought.
- **Source attribution** — `officialSource` is free text per adapter already; fine as-is, just needs each new adapter to fill in its own real value rather than copy Toronto's.

**What should NOT be normalized away** (the ticket's own explicit ask):
- Different "drop-in" semantics (true walk-in vs. requires-reservation) should be **represented, not hidden** — collapsing Vaughan's reservation-required model into looking identical to Toronto's walk-in model on a card would be dishonest to the user standing at the door.
- Toronto's `Section` field distinction ("Drop-In" vs. "Reserve a Spot - Sports") is a real, currently-unsurfaced nuance in the *existing* Toronto data, independent of any new municipality — worth its own small follow-up regardless of Phase 3 timing.
- Per-municipality activity naming shouldn't be forced into Toronto's exact vocabulary if the source's own term is more accurate locally; the *category*/shortcut layer can unify for search, but the *display* `activity` field should stay source-truthful, matching the existing "never invent a name the source doesn't use" principle already established for Toronto.

---

## 9. Proposed Phase 3 Implementation Sequence

**[RECOMMENDATION]**, revised from the ticket's suggested skeleton based on what this audit actually found:

**Phase 3.0 — Data/source audit** *(this document)*
- Objective: understand the real source landscape before writing any ingestion code.
- Files affected: none (documentation only).
- Major risk: none — this phase's only risk is *skipping* it and discovering the PerfectMind/ActiveCommunities split mid-implementation.
- Validation: this document, reviewed before Phase 3.1 begins.

**Phase 3.1 — Canonical model preparation + ACTIVE Network API proof-of-access**
- Objective: two things, deliberately combined — (a) resolve the §6 caveat by actually registering an ACTIVE Network developer key and making one real test call against a specific municipality's ActiveCommunities instance to confirm whether drop-in-level data is reachable at all; (b) only if that succeeds, make the minimal canonical-model additions §2 flagged as reasonably near-term (`sourceProvider`, and a decision on `sourceUpdatedAt`).
- Files likely affected: `lib/dropin/types.ts` (additive only), a new scratch/investigation script (not committed as product code), this document (updated with the real answer).
- Major risk: the API doesn't expose what's needed, and Phase 3 has to pivot to direct municipal outreach instead of a technical integration — a real possible outcome, not just a formality.
- Validation criteria: a real, successful API call returning actual program/session-level data for at least one non-Toronto municipality, inspected by hand against this document's field-mapping expectations.

**Phase 3.2 — First non-Toronto adapter**
- Objective: build one working adapter (Mississauga, conditional on 3.1's outcome) producing real `Session` objects from the confirmed data path.
- Files likely affected: new `lib/dropin/sources/{municipality}.ts`, `lib/dropin/sources/index.ts` (one array entry), `lib/dropin/municipalities.ts` (flip status to `"available"`), `lib/dropin/districts.ts` (extend or restructure per the §3/§8 neighbourhood-search decision), `lib/dropin/activities.ts` (extend taxonomy for the new source's real activity names).
- Major risk: activity-taxonomy and district/neighbourhood-search assumptions turning out to be more entangled with Toronto's specific data than they look from reading the code alone — budget real time for this, not just the adapter itself.
- Validation: real sessions render correctly through the existing Results UI, unmodified, for the new municipality, with correct age/price/date/time honesty (never fabricating a field the new source doesn't have — same standard as Toronto).

**Phase 3.3 — Validate search/filter/results with two municipalities live**
- Objective: confirm the "Search Engine never knows which municipality a record came from" claim actually holds once it's no longer hypothetical — mixed queries, location-only queries, and the not-yet-available fallback messaging (§3) all need real two-municipality testing.
- Files likely affected: `app/page.tsx` (fixing the hardcoded "Toronto" fallback string flagged in §3), `lib/dropin/search-intent.ts` (verify municipality/neighbourhood priority still behaves correctly with two real municipalities in the mix).
- Major risk: the hardcoded UI strings in §3 are easy to miss until there are genuinely two municipalities to test against each other.
- Validation: a location-only search for the new municipality, a mixed activity+location query, and an unavailable-third-municipality query all produce the correct one of the four documented empty-state messages from `docs/SEARCH_ENGINE.md`.

**Phase 3.4 — Add additional municipalities/source families**
- Objective: use Phase 3.2's adapter as a template for the rest of its confirmed family (Richmond Hill, Ajax, Whitby, Clarington if ActiveCommunities pans out), and separately re-evaluate the PerfectMind family's access path (formal partner request vs. continuing to exclude it).
- Files likely affected: additional `lib/dropin/sources/*.ts` files (or municipality-config entries if the family-adapter pattern from §6 was adopted), `municipalities.ts`.
- Major risk: assuming every municipality in a family is a trivial config change without verifying each one's actual raw-data quirks — Toronto's own adapter needed real defensive validation (malformed dates, duplicate occurrences) that wasn't obvious until real data was inspected; expect the same per new municipality even within a shared platform family.
- Validation: same per-municipality checklist as Phase 3.2, repeated per addition.

**Phase 3.5 — Freshness + ingestion reliability hardening**
- Objective: close the gap `docs/ARCHITECTURE.md` already honestly flags — move from a manually-refetched static snapshot toward the documented "Scheduled Synchronization" target, now genuinely necessary once there's more than one source to keep in sync.
- Files likely affected: introduces the first real synchronization mechanism (not designed in this document — a separate design decision, not a small addition).
- Major risk: this is the first phase that touches genuinely new infrastructure (a scheduler, and likely some persistence beyond a bundled JSON file) — the biggest architectural jump in the whole sequence, and probably deserves its own audit-style planning pass rather than being implemented ad hoc.
- Validation: `lastUpdated`/`sourceUpdatedAt` on real sessions reflects genuine source freshness, not a hardcoded constant, for every registered adapter.

---

## 10. What Should Be Changed Before Municipality #2

**[RECOMMENDATION]**, the concrete, scoped list — deliberately short, per the ticket's own instruction not to refactor speculatively:

1. Fix the hardcoded `"Toronto"` fallback in `app/page.tsx`'s unavailable-municipality messaging and "Show Toronto instead" button (§3) — small, but will produce visibly wrong copy the moment it's not fixed.
2. Decide the neighbourhood-search question: does `lib/dropin/districts.ts` become per-municipality, or does "neighbourhood" search stay explicitly Toronto-only for now with municipality/postal-code search covering the rest? Either is defensible; leaving it undecided is not.
3. Decide whether `lastUpdated` becomes source-derived before or after municipality #2 — doesn't have to be fixed immediately, but should be a conscious choice, not an accident of "we didn't get to it."

## 11. What Should Deliberately Remain Unchanged

**[RECOMMENDATION]**:
- The adapter-array registry pattern in `lib/dropin/sources/index.ts` — already correctly minimal, don't add abstraction before a second real adapter proves what's actually shared.
- The canonical `Session` shape itself — already broad enough (optional fields for everything not every source has) to accept a second municipality without a breaking schema change.
- The "never fabricate a field the source doesn't have" discipline established for Toronto (no invented prices, no invented coordinates, no invented `officialUrl`) — this is the standard every new adapter must be held to, not relaxed for convenience.
- The static-snapshot-over-live-database current reality — Phase 3.5, not earlier, per the ticket's own explicit "don't build a large abstraction before understanding actual source differences."

## 12. Unknowns Requiring Further Investigation

**[UNKNOWN]**, consolidated:

1. Whether ACTIVE Network's public developer API actually exposes a specific municipality's own ActiveCommunities program catalog, versus only ACTIVE.com's separate marketplace listings (§6, §7) — **the single highest-priority unknown**, blocks a confident Phase 3.2 recommendation.
2. Hamilton's "Open Hamilton" recreation dataset's actual content — facility-only or schedule-level (§4).
3. Pickering's and Oshawa's recreation-registration platform identity (§4) — not conclusively found this session.
4. Whether PerfectMind/Xplor has *any* realistic path to legitimate API access for a project at DropIn's current stage (cost, approval process, whether a municipality would need to sponsor the request) — currently assumed "no viable path found," not confirmed impossible.
5. The exact cause of the record-count gap between the bundled Toronto snapshot (13,408 drop-in / 149 locations) and the live catalogue's current counts (29,255 / 1,882) — likely benign (a narrower slice taken at fetch time) but not independently confirmed.
6. Whether any of the remaining un-researched York/Durham municipalities (East Gwillimbury, Georgina, King, Newmarket, Whitchurch-Stouffville, Aurora, Brock, Scugog, Uxbridge) have meaningfully different data situations than their researched neighbours — not investigated, likely low product priority per population size but not verified.

---

## 13. Explicitly Not Done In This Phase

Per the ticket's constraints, confirmed as respected: no UI redesign, no Results/date-navigation/card changes, no Map View/Near Me/distance-sort/geocoding work, no blind scraping performed, no large abstraction introduced before evidence existed, the working Toronto pipeline was not touched, and no municipality ingestion was started. This document is the entire Phase 3.0 deliverable.
