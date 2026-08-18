# Phase 4.0 — Location & Geospatial Readiness Audit + Map Necessity Audit

Audit and product/technical analysis only. No production code changed. Every figure below is measured directly against the real, live canonical snapshots (`data/canonical/*/latest.json`, `data/raw/*/latest.json`) and the actual current implementation (`app/page.tsx`, `lib/dropin/*`) — nothing here is carried forward from earlier phase reports without re-verification.

---

## 1. Municipality Coordinate Coverage Table

| Municipality | Sessions | Has latitude | Has longitude | Has both | Has address | Has postal code | Has facility name |
|---|---|---|---|---|---|---|---|
| Toronto | 26,353 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 26,353 (100%) | 15,852 (60.2%) | 26,353 (100%) |
| Mississauga | 15,982 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 15,982 (100%) |
| Richmond Hill | 258 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 258 (100%) |
| Vaughan | 1,157 | 1,141 (98.6%) | 1,141 (98.6%) | 1,141 (98.6%) | 1,157 (100%) | 1,157 (100%) | 1,157 (100%) |
| Markham | 1,433 | 1,433 (100%) | 1,433 (100%) | 1,433 (100%) | 1,433 (100%) | 1,433 (100%) | 1,433 (100%) |
| Newmarket | 1,766 | 1,766 (100%) | 1,766 (100%) | 1,766 (100%) | 1,766 (100%) | 1,766 (100%) | 1,766 (100%) |
| Aurora | 197 | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | 197 (100%) |
| **Total** | **47,146** | **4,340 (9.2%)** | **4,340 (9.2%)** | **4,340 (9.2%)** | **30,709 (65.1%)** | **20,208 (42.9%)** | **47,146 (100%)** |

**This is a real, previously-uncorrected assumption worth naming directly**: only 9.2% of all sessions have coordinates today. That's the entire PerfectMind family (Vaughan/Markham/Newmarket) minus one facility; ActiveCommunities (Mississauga, Richmond Hill, Aurora) and Toronto Open Data have **zero** coordinate coverage. This was individually true and already documented per-source in earlier phases (3.1, 3.2, 3.6B), but no report until now had assembled it into one combined-dataset figure. Facility name is the one field that's 100% present everywhere and is the natural join key for any future location work.

Vaughan's 16-session (1.4%) gap is fully explained, not a bug: PerfectMind's own `Address` block for "Woodbridge Pool & Memorial Arena" returns `Latitude: null, Longitude: null, AnyFieldMissing: true` directly from the source — confirmed by inspecting the real raw record. Every other Vaughan coordinate is populated.

## 2. Unique Facility/Location Analysis

| Municipality | Sessions | Unique raw `centre` strings | Rough estimated real buildings* |
|---|---|---|---|
| Toronto | 26,353 | 249 | ~248 |
| Mississauga | 15,982 | 147 | ~131 |
| Richmond Hill | 258 | 20 | ~8 |
| Vaughan | 1,157 | 12 | ~12 |
| Markham | 1,433 | 10 | ~10 |
| Newmarket | 1,766 | 4 | ~4 |
| Aurora | 197 | 3 | ~3 |
| **Total** | **47,146** | **445** | **~416** |

\* Audit-only heuristic (strips " - Room/Gym/Rink N" style suffixes) to size the fragmentation — not a production normalization, not stored anywhere.

**Richmond Hill is the clearest real fragmentation case.** Its 20 "unique centres" are room/space subdivisions of roughly 8 real buildings:

```
Oak Ridges CC - Aerobic Room       Oak Ridges CC - Gym A
Oak Ridges CC - Gymnasium          Oak Ridges CC - Activity Room
Oak Ridges CC - Gym B              Oak Ridges CC - Program Room 1
```
— six distinct `centre` values, one real physical building. Same pattern for "Rouge Woods CC" (3 room variants), "Elgin West CC" (4 variants), "Ed Sackfield" (2 variants).

**Mississauga shows the same pattern at larger scale.** Its "Meadowvale" cluster alone spans 14 distinct `centre` strings for what is very likely 1–2 real physical locations (a community centre plus a possibly-separate adjacent 4-rink arena building):

```
Meadowvale CC Fitness Studio        Meadowvale 4 Rinks Rink 1
Meadowvale CC Main Pool             Meadowvale 4 Rinks Rink 2
Meadowvale CC Therapeutic Pool      Meadowvale 4 Rinks Rink 3
Meadowvale CC Gym A / Gym A,B       Meadowvale 4 Rinks Rink 4
Meadowvale CC Auditorium 1,2        Meadowvale CC Senior Rm
Meadowvale CC Youth/Senior Rm       Meadowvale CC Program Rm 2
```

**Toronto and Vaughan/Markham/Newmarket/Aurora show almost no fragmentation** — their `centre` values are already close to real building-level names (Toronto's raw feed names full facilities like "York Recreation Centre" directly; PerfectMind's `Location` field is the booking-system's own facility identity, not a room).

No "CC" vs. "Community Centre" cross-naming collision was found within a single municipality (i.e., no case of the same real building appearing under both a "CC" short form and a full "Community Centre" form as two separate `centre` values) — the abbreviation is used consistently per source, not inconsistently within one.

## 3. Coordinate-Quality Findings

Checked all 4,340 sessions carrying coordinates against a GTA bounding box (lat 43.0–44.5, lon -80.5 to -78.5):

- **Out of GTA bounds: 0**
- **Exact 0,0: 0**
- **Negative latitude or positive longitude (swap/hemisphere errors): 0**
- **Same coordinate pair shared by more than one distinct facility name (placeholder/centroid suspicion): 0**

Every coordinate that exists today is clean. This isn't luck — `lib/dropin/sources/perfectmind/normalize.ts` already has a `validCoordinate()` gate (a GTA bounding-box check, Phase 3.4/3.5B) that silently discards anything outside range before it's ever stored, so a bad coordinate from the source would already come through as `undefined`, not a wrong value. **The real problem is coverage (90.8% of sessions have no coordinate at all), not quality of what's present.**

## 4. Missing-Coordinate Analysis

For the four sources with 0% coordinate coverage (Toronto, Mississauga, Richmond Hill, Aurora), what's actually available differs by source:

- **Toronto**: 100% address (street number/name/type/direction), 60.2% postal code, 100% facility name. The specific Open Data resource DropIn currently reads (`Locations`, part of the "Registered Programs and Drop-in Courses" package) genuinely has no latitude/longitude field — confirmed directly from its own type shape (`RawLocation` has `Street No/Name/Type/Direction`, `Postal Code`, `Intersection`, `TTC Information`, but no coordinate field). Toronto's Open Data portal very likely publishes a separate address-point or parks-and-recreation-facilities dataset with coordinates elsewhere in its catalog — this is a real, plausible hypothesis worth investigating in a future phase, **not confirmed this session**.
- **Mississauga / Richmond Hill / Aurora (ActiveCommunities)**: 0% address, 0% postal code. Confirmed absent from every endpoint DropIn currently calls (`onlinecalendar/filters`, `onlinecalendar/multicenter/events`, `activities/list`) — `AcCenter` is only `{id, name}`, `AcFacility` is only `{facility_id, facility_name, center_id, center_name}`, no address field exists anywhere in these response shapes. This was independently confirmed in Phase 3.1/3.2 and holds unchanged. A separate ActiveCommunities facility-directory endpoint may exist on the same platform but has not been found or tested.

**Recommended source-priority order per the task's A–D options**: (A) existing official source data — exhausted for these three; nothing more to extract from currently-integrated endpoints. (B) another endpoint on the same platform — worth a scoped investigation for ActiveCommunities specifically (a facility/location directory feed is plausible for a commercial recreation platform), and worth checking Toronto's broader Open Data catalog for a facility address-point dataset. (C) official facility pages — plausible fallback, low-value/high-effort (manual, brittle). (D) one-time geocoding of stable facility addresses — the practical fallback once a real street address is obtained, either from a source (B) or already in-hand (Toronto already has one). **Only Toronto currently has enough in-hand (real address + facility name) to geocode today without further source investigation.** Mississauga/Richmond Hill/Aurora need either a new source endpoint or manually-sourced addresses before geocoding is even possible.

## 5. Geocoding Requirements

**Unique locations needing geocoding, not sessions.** From §2: 445 raw `(municipality, centre)` pairs, of which only 26 (Vaughan/Markham/Newmarket) already have coordinates. That leaves **419 raw facility identities**, collapsing to roughly **335–400 real physical buildings** after accounting for the room/subspace fragmentation in Richmond Hill and Mississauga specifically (Toronto's 249 are already close to 1:1). This is a small, one-time, entirely tractable geocoding job — not a per-session or per-request problem at any current or realistically foreseeable DropIn scale.

**Recommended architecture**: official facility/address → one-time (refresh-time-adjacent, not request-time) geocoding → stored facility coordinates → folded into the snapshot → used for Near Me/distance at read time. This is unambiguously the right call over request-time geocoding: geocoding the same ~400 stable buildings repeatedly per user request would be pure waste, slower, rate-limit-exposed, and costs money for a result that never changes between refreshes (a community centre does not move). A **one-time or infrequent (e.g. monthly) geocoding pass**, cached indefinitely and only re-run if a facility's address changes, is the safe, cheap, simple approach — directly analogous to the discipline this project already applies to snapshot refresh generally (Phase 3.3: never fetch live at request time).

## 6. Recommended Location Data Model

The question posed: are coordinates fundamentally a **session** attribute or a **facility** attribute? The data itself already answers this — verified directly: for every Vaughan facility with coordinates, every session at that facility carries the exact same lat/long pair (checked programmatically: 1 distinct coordinate pair per facility name, zero variation). Coordinates are a **facility** attribute that the current schema merely denormalizes onto every session row.

A small `FacilityLocation` concept (conceptually: `{facility identity, municipality, address, postal code, latitude, longitude}`, keyed by `(municipality, centre)` or a normalized facility id) would:

- **Reduce repeated geocoding** — yes, directly: geocode once per real building (~400), not once per session (47,146) or redundantly across sessions that already share a value.
- **Improve distance calculation** — yes, marginally: no calculation is wrong today (there's none), but a facility table is the natural place to compute distance once per unique location per request rather than once per session, which matters more once Near Me exists (§8/§9).
- **Improve map rendering** — yes, materially, if a map is ever built (§16): pins should represent facilities, not sessions.
- **Improve data consistency** — yes: it gives Richmond Hill's and Mississauga's room-suffixed `centre` strings one real anchor point (address/coordinate) to resolve to, instead of each room-suffix variant independently and redundantly carrying (or lacking) its own copy.
- **Simplify future location features** — yes: Near Me, distance sort, and any map all become "join session → facility → coordinate" instead of "hope every session already carries one."

**Recommended smallest step for DropIn's current scale**: do **not** build a separate database table or persisted facility registry yet — that's more architecture than ~400 stable, rarely-changing locations justify. Instead, generate a facility lookup (`Map<municipality::centre, {lat, lon, address}>`) as a build-time/refresh-time artifact, geocode any entries missing coordinates in that lookup (not per-session), and have the snapshot-normalization step join it in when building each `Session`. This preserves the existing snapshot-pipeline discipline (Phase 3.3), adds one new lookup artifact, and requires no schema migration, no database, and no session-level changes beyond continuing to populate the already-existing `latitude`/`longitude` fields.

## 7. Near Me — Technical Requirements

**Current state, verified directly against the running code, not assumed**: "Near you" is **not** real geolocation. `app/page.tsx` line ~956 renders it as a plain, non-interactive `<span>` — the code comment on it literally reads "display only... it is never typed into directly." A repo-wide search for `navigator.geolocation`, `getCurrentPosition`, and `watchPosition` returns **zero matches** anywhere in `app/` or `lib/`. What currently exists is `DetectedLocation` (`lib/dropin/search-intent.ts`), a text-search-derived category — postal FSA prefix, exact centre name, neighbourhood/district, or exact municipality string — matched via `sessionMatchesLocation()`, which is pure string/category comparison, not distance. "Near you" today means "no location filter is currently applied," not "sessions near your GPS position."

**What genuine Near Me requires**:
- `navigator.geolocation.getCurrentPosition()`, called from a real user action (a button, not on page load) — required by every mobile browser's permission model and good practice generally.
- **HTTPS requirement**: `navigator.geolocation` is blocked entirely on insecure (plain HTTP) origins by every modern browser except `localhost`. This directly matches the already-documented LAN-dev limitation from Phase 3.6B (`docs/MOBILE_PREVIEW_DIAGNOSTIC.md`) — geolocation will not work on the LAN dev preview for the same reason Share/Clipboard don't, and will work correctly once deployed to real HTTPS production.
- **Permission states to handle explicitly**: granted, denied, dismissed/no-answer, and unavailable (no hardware/no signal) — each needs a distinct, honest UI state, not a silent fallback that could misrepresent "no location" as "no results."
- **Mobile Safari / Android Chrome**: both support the API under HTTPS; iOS additionally requires the user has Location Services enabled system-wide, which the API surfaces as a denial, not a hang.
- **Fallback behavior**: when denied/unavailable, DropIn already has a working fallback — the existing text-search location model (municipality/neighbourhood/postal code) — so Near Me should be additive, not a hard dependency the rest of the product breaks without.

**Does DropIn need to persist a user's precise location at all?** No — and it should not. Every real use of a user's coordinate in this product (computing distance to facilities for the current session) is a **transient, per-request computation**: get the coordinate, compute distances against the facility lookup from §6, discard. There is no product reason identified in this audit to store a user's coordinate — not in a database, not in localStorage, not in an analytics event payload. Recommendation: **compute-then-discard**, every time.

## 8. Distance Calculation

**Straight-line (Haversine) distance is sufficient for the first production version of Near Me.** Reasoning:

- **Complexity**: Haversine is a ~10-line pure function, zero dependencies, zero network calls, computes instantly client-side or server-side.
- **Cost**: $0, no API, no rate limit, no key.
- **Accuracy at DropIn's scale**: the GTA is a dense, well-connected road grid: straight-line distance is a reasonable proxy for "how far is this, roughly" at the 1–10 km scale most drop-in decisions happen at. It will occasionally understate real driving distance across a highway or river crossing, but not in a way that would flip a reasonable "which of these two options is closer" decision often enough to matter for a v1.
- **Driving distance/time (via a routing API)** would be more accurate but requires an external vendor, a request-time (or aggressively cached) network call per user × facility pair, real cost at scale, rate limits, and a privacy consideration (sending a user's coordinate to a third party). This is real added complexity for a marginal accuracy gain that a first version doesn't need.

**Recommendation**: ship Haversine straight-line distance first; only reconsider routing/drive-time if real usage shows straight-line distance is materially misleading for GTA geography in practice (a testable, evidence-driven trigger, not a default).

## 9. Distance Display

- **Where it would come from**: computed transiently at render/request time from (user coordinate, facility coordinate) via Haversine — never stored, never pre-baked into the snapshot (only the facility coordinate is snapshot-stored, per §6).
- **Reliability**: only as reliable as facility coordinate coverage (§1) — today that's 9.2% of sessions. Distance should never be shown as a confident number for a session whose facility has no coordinate; it should simply be omitted, consistent with this project's existing "don't imply certainty the data can't support" principle (already the pattern for `price`, `ageMin`/`ageMax`, `officialUrl`).
- **Rounding**: one decimal place (e.g. "1.8 km") is the right precision — matches the `Session.distanceKm?: number` field's existing usage in the retired `/design` mockups and is precise enough to compare two nearby options without implying false accuracy.
- **When user location is unavailable**: omit the distance entirely, exactly as `officialUrl`/`price`/age are already omitted when unknown — never show a placeholder or a stale/default value.
- **Does it belong on every card?** Only when both a user location and a facility coordinate are available — which, given §1, would currently be a minority of results. This is itself an argument for prioritizing facility-coordinate coverage (§5/§6) before shipping distance display, or the feature will visibly not work for ~90% of today's sessions.
- **Caching within a request**: yes, trivially — since distance is a pure function of (user coordinate, facility coordinate) and many sessions share one facility, computing it once per unique facility per request (not once per session) is the obvious and cheap optimization, and falls out naturally from the §6 facility-lookup model.

**A concrete, already-existing hook worth noting**: `Session.distanceKm?: number` already exists in the canonical type (`lib/dropin/types.ts`), and the production result card (`app/page.tsx` line ~299) **already** conditionally renders it (`{s.distanceKm !== undefined && \` · ${s.distanceKm} km\`}`) — this was wired during earlier design work and never removed. No Result Card UI change would be needed to surface distance; only the computation needs to exist. This audit did not touch this code, per the read-only constraint, but it's material evidence for how small the eventual implementation step is.

## 10. Distance/Ranking Product Recommendation

The task's worked example is correct and matters: a pure nearest-first sort would rank "0.5 km away, starts at 9:30 PM" above "2.1 km away, starts in 20 minutes" for a user who obviously wants the second one right now. DropIn's entire existing information architecture (Happening now / Starting soon / today / Morning / Afternoon / Evening / future dates) is a temporal-relevance model — introducing pure distance sort would directly contradict it.

**Recommendation: (B) time groups first, distance within each group, plus (D) an explicit, user-controlled "Nearest" toggle for when someone genuinely wants pure proximity** (e.g. planning something later, not "right now"). Reasoning against the alternatives:; (A) pure distance sort — rejected, breaks the worked example. (C) a single blended time+proximity relevance score — rejected for now: an opaque combined score is harder for a user to predict/trust than "grouped by time, nearest within the group," and this project has consistently favored transparent, explainable ordering over black-box scoring (mirrors the existing Decision Sheet philosophy of never showing unearned certainty). (E) hybrid — B+D already is the pragmatic hybrid: default behavior preserves temporal usefulness, and an explicit opt-in respects users who want distance to lead.

## 11. Cross-Municipality Location Value

This is one of DropIn's real structural advantages, and the audit found no architectural blocker to it. `sessionMatchesLocation()`'s `"municipality"` branch is `session.municipality === location.label` — an exact string filter used only when a user's query resolves to a municipality-type location. It is not a data partition: every `Session` object, regardless of municipality, lives in the same combined array served by `/api/sessions`, uses the same fields, and (once §6 is built) would carry a facility coordinate the same way. Nothing in the canonical model, the snapshot pipeline, or the source adapters segregates municipalities from each other structurally — `municipality` is just a label field on an otherwise uniform record.

**Concretely**: once Near Me computes distance generically across the full combined session set (not "search within municipality X, then compute distance"), a user near the Toronto/Markham boundary would naturally see the geographically closest real options ranked together regardless of which municipal recreation system owns them — exactly the scenario in the task's example. The only real remaining risk is a UX one, not a data one: today's location search still defaults to resolving a typed query to a single municipality/neighbourhood category (§7) — Near Me needs to be its own, separate, distance-driven path that doesn't first collapse to one municipality before computing distance, or the cross-boundary advantage would be silently lost at the search layer rather than the data layer.

## 12. Map Necessity Analysis

Evaluated against the list experience DropIn already has: activity search, time filtering, facility name, (pending) Near Me, (pending) distance, Directions, official listing — each of the "possible map jobs" the task lists maps onto something the list already does or is already scoped to do in this same phase's roadmap:

| Possible map job | Already covered by list + Near Me + distance + Directions? |
|---|---|
| Understand approximate facility direction/location | Yes — Directions already opens real turn-by-turn navigation (§18); distance display (§9) gives a number |
| Visually compare several nearby options | Partially — a sorted, distance-labeled list already supports this; a map adds a spatial (not ranked) view of the same comparison |
| Explore activities around a geographic area | Weakly covered today (only via explicit municipality/neighbourhood search) — this is the one job a map plausibly does better than a list |
| Discover options across municipal boundaries | Covered by §11's data model once Near Me ships — not map-dependent |
| Understand clusters of community centres | A map's clearest unique value — genuinely spatial, hard for a list to convey |
| Explore an unfamiliar neighbourhood | Similar to the above — spatial browsing is a real, distinct job a list doesn't do |

**Once Near Me + distance-aware results exist, the remaining unresolved job is specifically spatial browsing/exploration** — "what's around here in general" as opposed to "what's the best option for the activity I already want." That is a real, narrower problem than "add a map," and it's genuinely not solved by a sorted list no matter how good the list is. It is not a strong enough case on its own to justify building a map now (see §21), but it's not zero either — this shapes the DEFER recommendation's trigger condition.

## 13. Competitor Map Failure Mode

The stated failure mode — pins on a map showing roughly where community centres are, without helping decide *which activity* to attend — happens specifically when a map is just "the same list results, as pins" with no information a list didn't already have. DropIn should not reproduce **LIST + SAME RESULTS AS PINS + MAP** as three views of identical data.

**What would make a DropIn map meaningfully different, not just present**: the map has to answer a question the list structurally cannot — "what's happening, spatially, right now" — rather than restate the list's own ranking in pin form. Concretely, this means the map's pins and interactions must be built around *time-relevant availability* (which of these places has something starting soon, visualized where they are), not merely *facility existence* (a static pin for every community centre whether or not anything bookable is happening there today). A map that shows the same 20 result cards as 20 identical pins, sorted the same way, adds visual polish and nothing decisional.

## 14. What a Good DropIn Map Could Be

Technically evaluated against the current canonical data model — realistic, not aspirational:

- **Pins representing available activities, not just facilities** — realistic. A pin should represent "this facility has bookable drop-in activity right now/today," derived by grouping the already-existing per-session `startDateTime`/`endDateTime` by facility, not a static always-on pin per building.
- **Time-aware map state** ("Happening now"/"Starting soon" visibility) — realistic, and *this specific idea is the one genuinely distinctive concept found in this audit*: since `Session.startDateTime`/`endDateTime` already exist and `lib/dropin/time.ts`'s `sessionStatus()` already computes exactly this live status for the list UI, the same computation could drive pin state (e.g. a visually "live" pin) without new data.
- **Activity filtering synchronized with the map** — realistic; the map would just be a different rendering of the same already-filtered session set the list uses.
- **Multiple activities grouped at one facility** — realistic and necessary regardless (§16) — a facility with 1,446 Toronto sessions (York Recreation Centre, the busiest facility in the dataset) cannot be one pin per session.
- **Cross-municipality results shown seamlessly** — realistic per §11, no architectural blocker.
- **Selecting a pin reveals the relevant session(s), not just an address** — realistic and directly reuses the existing Decision Sheet component/pattern rather than inventing new UI.
- **Map viewport influencing exploration** — realistic only if scoped carefully (e.g. "load facilities visible in the current viewport" for performance, §16) — but this should follow from a genuine spatial-browsing need (§12), not be added for its own sake.

None of these require new fields on `Session`, a new data source, or a schema change beyond what §6 already recommends (a facility coordinate lookup). They are UI/interaction concepts, correctly out of scope to design or build in this phase.

## 15. Map Infrastructure Cost

No dependency installed or selected this phase — `package.json` confirmed to have zero map-related packages currently. Options evaluated for a *future* decision:

| Option | Complexity | Cost at DropIn's scale | Key/account | Vendor lock-in | Mobile perf | Accessibility | Next.js fit | Sufficient for our data? |
|---|---|---|---|---|---|---|---|---|
| **Google Maps JS API** | Low-medium (mature SDK, best docs) | Free tier is generous but requires a billing-enabled account past it; real cost risk if traffic grows | Requires a Google Cloud API key | High — proprietary, billing-gated | Good | Reasonable (Google-maintained ARIA support) | Works fine, client-only | Yes — coordinates are all it needs |
| **Mapbox GL JS** | Medium (more customizable, steeper learning curve) | Free tier exists, paid past a request threshold | Requires a Mapbox account/token | Medium-high — proprietary rendering, hosted tiles | Good, WebGL-based | Requires more manual work than Google's SDK | Works fine, client-only | Yes |
| **MapLibre GL JS + OpenStreetMap tiles** | Medium (open-source fork of Mapbox GL, same API shape) | Free tile sources exist (with usage policies); can self-host or use a free-tier tile provider | No account strictly required for community tile sources; a paid tile provider needs one for volume | Low — open source, swappable tile providers | Good, same WebGL engine as Mapbox GL | Same manual-work profile as Mapbox GL | Works fine, client-only | Yes |
| **Static/simple Leaflet + OSM tiles** | Low-medium, simpler API than GL-based options, less visually modern | Free tile sources exist under usage policies | No account required for community tiles | Low | Good for a few hundred pins, worse than WebGL options at very high pin counts | Comparable to MapLibre | Works fine, client-only | Yes |

**No vendor recommendation is made in this phase** — the evidence doesn't strongly favor one over the others for DropIn's specific needs, and per the task's own instruction this isn't the phase to select one. If a map is eventually built, MapLibre/OSM is the most defensible **default lean** for a small/non-profit-scale project specifically because it avoids a billing-gated account and vendor lock-in without sacrificing capability — but this should be revisited with real requirements at build time, not decided speculatively now.

## 16. Map Performance

- **Real unique facility count**: ~416 estimated real buildings (§2), well within what any of the options in §15 render smoothly without special handling.
- **Expected visible pin count**: bounded by facility count, not session count — even showing every facility across all 7 municipalities simultaneously is ~416 pins, a trivial render load for any modern map library. Realistic on-screen counts for a single municipality or viewport would be far smaller (Newmarket: 4, Aurora: 3, Markham: 10, Vaughan: 12, Richmond Hill: ~8 real buildings, Mississauga: ~131, Toronto: ~248).
- **Clustering**: not needed at 416 total pins city-wide; would only become relevant if Toronto's ~248 facilities were all rendered simultaneously at a very zoomed-out view — a reasonable future refinement, not a v1 requirement.
- **Map data must be facility-based, not session-based** — confirmed necessary, not optional: York Recreation Centre alone has 1,446 sessions (the single busiest facility in the combined dataset; median sessions-per-facility across all 445 raw facility identities is 46, mean 105.9). Rendering one pin per session would mean up to ~1,446 stacked, identical-location pins at that one address — architecturally wrong, confirmed by real data, not a hypothetical. Pins must represent facilities (grouping many sessions), consistent with §14's "pins represent available activities at a place," not raw session rows.

## 17. Mobile Product Value

Location features are plausibly strongest on mobile specifically because that's where "what can I do right now, near me" is asked most literally (a user physically out and about, not planning from a desk). Weighed against a map specifically:

- **One-handed use / touch targets**: a list of tappable cards is easier to operate one-handed than pan/zoom map gestures — this favors the list, not the map, as the primary mobile surface.
- **Location permission**: identical requirement (HTTPS, explicit grant) whether Near Me feeds a list or a map — no map-specific cost here.
- **Map/list switching**: a real cost if implemented — a toggle adds a decision point and state to manage (which view, does it persist, does switching lose scroll position) that a list-only experience doesn't have.
- **Decision speed**: for the core "find an activity now" job, a ranked list (time-first, per §10) gets to a decision faster than visually scanning a map and then still needing to open a pin's detail — this favors the list for the primary use case, mirroring §12's finding that the list already covers most of the plausible map jobs.
- **Performance / iOS Safari / Android**: not a blocker per §16's small pin counts, but a map is unavoidably heavier to load and render than a list on a constrained mobile connection, which is a real (if secondary) cost specifically on mobile.

**Conclusion**: mobile makes Near Me/distance/Directions *more* valuable, not specifically a map — the "one-handed, fast-decision" nature of mobile use plays to a strong list experience more than it plays to a map. This reinforces rather than overturns §12's finding.

## 18. Directions Audit

`directionsUrl()` (`app/page.tsx`) already exists and is wired to the Decision Sheet's primary action button: if a session's facility has coordinates, it opens `https://www.google.com/maps/search/?api=1&query={lat},{lon}` directly (maximally precise); otherwise it falls back to a text query built from `address`, `centre`, and `municipality` (`https://www.google.com/maps/search/?api=1&query={encoded text}`). Google Maps' own geocoding resolves the text-fallback case for the majority of DropIn's data (§1's 100% facility-name, 65% address coverage), so **Directions already provides real, working external navigation today for effectively all sessions, coordinates or not.**

Given the existing user flow — find activity → see distance (once §9 ships) → open Decision Sheet → Directions → external navigation — the **incremental value an internal Map View adds is narrow and specific**: it would let a user compare *multiple* options spatially *before* committing to one Decision Sheet, and support open-ended "what's around here" browsing (§12). It does not add anything to the single-destination "get me there" job, which Directions already fully owns via mature, purpose-built external navigation apps that DropIn has no reason to reproduce.

## 19. Privacy

Recommended model, consistent with §7's findings: **user grants browser location → coordinate used transiently for one distance computation pass → discarded, never persisted.** No coordinate should be written to a database, localStorage, cookie, or analytics event payload. This is not a new architectural burden — it's the absence of one; the simplest implementation (compute Haversine distance in the same request/render that has the coordinate, then let it fall out of scope) is also the most private one, so there's no privacy/complexity tradeoff to weigh here.

**Analytics implication**: an event like `near_me_clicked` (§20) should record that the action happened, not the coordinate value itself — a boolean/count signal, never the location payload. Distance values shown to a user (e.g. "1.8 km") are derived and ephemeral, fine to reference in aggregate ("median displayed distance") but the underlying raw coordinate should never leave the browser/request boundary it was computed in.

No tracking is introduced by this audit — this section is a recommendation for when Near Me is eventually implemented, not something built now.

## 20. Future Analytics Events

Not implemented — named here only so a future implementation phase has a starting vocabulary and so "did this feature help" is answerable later instead of guessed at:

- `near_me_clicked` — user tapped the (future) Near Me action
- `location_permission_granted`
- `location_permission_denied`
- `location_unavailable` — permission granted but the browser/OS couldn't produce a position
- `distance_sort_used` — the explicit "Nearest" toggle from §10 was engaged
- `directions_clicked` — already meaningful today, not gated on any future feature
- `official_listing_clicked` — already meaningful today
- `map_opened` (only relevant if §21 ever becomes BUILD)
- `map_pin_selected`
- `map_to_list_switch` / `list_to_map_switch` — needed specifically to answer whether a map view actually gets used relative to the list once both exist

**How this would eventually answer "does Map View actually help people?"**: compare `map_opened` → `map_pin_selected` → (Decision Sheet opened from a map pin) conversion against the equivalent list → card → Decision Sheet conversion; watch whether `map_opened` sessions that never select a pin (pure browsing, no decision) are common (would support the "spatial exploration" job from §12) or rare (would suggest the map isn't earning its screen space). None of this requires precise location to be persisted — session-scoped counts and funnel steps are sufficient.

## 21. Map View Decision

| Factor | Assessment |
|---|---|
| User value | Real but narrow — spatial browsing/cluster-understanding (§12), not decision-making, which the list already serves |
| Distinct value beyond list | Weak once Near Me + distance + Directions exist (§18) — the strongest distinct job ("what's around here in general") is real but secondary to DropIn's core "I want to do X" job |
| Cross-municipality value | High in principle (§11), but achievable without a map — Near Me + distance already deliver it in list form |
| Technical readiness | Low today — only 9.2% of sessions have coordinates (§1); a map built now would be mostly empty for Toronto/Mississauga/Richmond Hill/Aurora |
| Data readiness | Not ready — §5/§6's facility-geocoding work hasn't happened yet |
| Implementation complexity | Medium — a real new dependency, new interaction model, new state (§15/§16), even though the underlying data shape is small and manageable |
| Mobile usefulness | Secondary to list on mobile specifically (§17) |
| Performance | Not a blocker technically (§16 — pin counts are small) |
| Maintenance burden | Ongoing — a map is a persistent UI surface to keep working (library updates, tile/key management) for a benefit that's currently unproven |
| External API/vendor dependency | New, real, avoidable-for-now dependency regardless of which option in §15 is chosen |

### Recommendation: **DEFER**

Not DO NOT BUILD, because §12/§14 found a real, specific, technically realistic concept (time-aware, activity-level pins, not facility-decoration) that would genuinely differ from the competitor's decorative map — the idea has actual merit. Not BUILD, because the data isn't ready (9.2% coordinate coverage), the strongest distinct job it solves (spatial exploration) is real but secondary, and building it now would mean either shipping a map that's mostly empty outside three PerfectMind municipalities, or blocking on §5/§6 geocoding work first anyway — at which point Near Me and distance-aware lists (§7–§10), which serve DropIn's *primary* job more directly, should ship first regardless.

**What should be built/tested first**: the full §6 → §7 → §8/§9 sequence (facility coordinates → Near Me → distance-aware results), because every one of those is a prerequisite for a map being worth anything, and each is independently valuable without a map ever being built at all.

**Evidence that should trigger reconsidering Map View**: real usage data (once `directions_clicked`, `near_me_clicked`, `distance_sort_used` exist, §20) showing users frequently browsing multiple nearby options without a clear single-activity intent (i.e., real evidence of the "explore what's around here" job from §12 being common, not hypothetical) — or direct user feedback asking for a spatial/area view specifically. Absent that evidence, continued investment in list-based location features has a clearer, more directly-measurable payoff.

## 22. Recommended Phase 4 Roadmap

The proposed default sequence in the task prompt is **supported by this audit's evidence**, with one adjustment (folding facility-location work and geocoding into one phase, since they're the same underlying deliverable):

- **4.0 — Geospatial Readiness + Map Necessity Audit** (this phase) — complete.
- **4.1 — Canonical Facility Location + Geocoding.** Build the facility lookup from §6 (keyed by `municipality::centre`), geocode the ~335–400 real buildings currently missing coordinates (prioritizing Toronto, which already has real addresses in hand — the cheapest win), investigate the two open hypotheses from §4/§5 (an ActiveCommunities facility-directory endpoint; a Toronto Open Data address-point dataset) before defaulting straight to third-party geocoding for Mississauga/Richmond Hill/Aurora. This is the true prerequisite everything else depends on.
- **4.2 — Near Me.** Real `navigator.geolocation`, transient/never-persisted (§7/§19), with explicit, honest handling of every permission state, additive to the existing text-location search rather than replacing it.
- **4.3 — Distance-Aware Results.** Haversine distance (§8) computed per unique facility per request (§9), displayed via the already-existing `distanceKm` card hook, time-groups-first ranking with an explicit "Nearest" toggle (§10), cross-municipality by construction (§11).
- **4.4 — Map View, only if the §21 trigger evidence actually shows up** after 4.2/4.3 ship and get real usage — not scheduled by default.

## 23. Risks / Unresolved Questions

- Whether Toronto Open Data publishes a separate facility/address-point dataset with coordinates is a real, plausible, **unconfirmed** hypothesis — needs direct investigation in 4.1, not assumed.
- Whether ActiveCommunities exposes any address/coordinate-bearing endpoint beyond the three already integrated is likewise unconfirmed — worth a scoped check before committing to third-party geocoding for Mississauga/Richmond Hill/Aurora.
- Richmond Hill's and Mississauga's room/subspace fragmentation (§2) means facility-identity resolution for 4.1 needs a real (if modest) normalization pass — the rough heuristic used in this audit is not production-grade and a real implementation will need to handle edge cases (e.g. confirming "Meadowvale 4 Rinks" really is the same physical site as "Meadowvale CC" and not a genuinely separate adjacent building) with actual evidence, not assumption.
- The GTA bounding-box validation in `perfectmind/normalize.ts` is the only existing coordinate-quality safeguard; if 4.1 adds a second geocoding path (e.g. for Toronto), it should reuse or replicate that same validation rather than trusting a new source uncritically.
- No evidence was gathered this phase on real geocoding API pricing/rate limits for ~400 one-time lookups — worth a brief, concrete cost check at the start of 4.1 rather than assumed to be negligible (it almost certainly is, at this volume, but wasn't verified).

---

## Concise Answers

**A. Can DropIn reliably support Near Me?**
Not yet, end-to-end — the browser-geolocation half is straightforward and unimplemented (zero code exists today), but it would only be reliably *useful* once facility coordinate coverage improves from today's 9.2%. The permission/HTTPS/fallback handling itself has no open technical question.

**B. Can DropIn reliably calculate useful distance?**
Yes, technically (Haversine is simple and sufficient, §8) — but only for the 9.2% of sessions with a facility coordinate today. Reliable, product-wide distance requires §6's facility-geocoding work first.

**C. Should distance replace time as the primary ranking signal?**
No. Time relevance should remain primary; distance should rank within time groups, with an explicit opt-in "Nearest" control for users who want pure proximity (§10).

**D. What location-data work must happen before implementation?**
Facility-level coordinate coverage (§5/§6) — geocode or source-obtain coordinates for the ~335–400 real buildings currently missing them, prioritizing Toronto (already has real addresses) and investigating two unconfirmed but plausible additional-source hypotheses before defaulting to blind third-party geocoding for the ActiveCommunities municipalities.

**E. Does Map View solve a meaningful problem that Near Me + distance + Directions do not?**
Partially. A narrow, real job — spatial "what's around here" browsing and understanding facility clusters — is not solved by a list no matter how good it is. But DropIn's core job (decide which specific activity to attend) is already well served by list + Near Me + distance + Directions, and that core job is not meaningfully improved by a map.

**F. Map View recommendation: BUILD / DEFER / DO NOT BUILD?**
**DEFER.**

**G. If BUILD (future), what specifically must DropIn's map do better than the competitor?**
Pins must represent time-relevant available activity at a place — grouping sessions per facility and reflecting live status ("Happening now"/"Starting soon," reusing the existing `sessionStatus()` computation) — not a static pin per community centre that merely restates the list as dots on a map. If a future map ever just mirrors the list's own results as identical pins with no time-awareness, it will reproduce exactly the competitor failure mode this phase was asked to avoid.

---

Stopping here, as instructed. Not beginning Phase 4.1.
