# Phase 4.1 — Canonical Facility Location & Geocoding Foundation

Builds the smallest reliable facility-location foundation identified as missing in Phase 4.0: a canonical facility identity, a coordinate-source priority chain that prefers official data over geocoding, a one-time/build-time geocoding process (never request-time), and a source-agnostic join that enriches `Session.latitude`/`longitude` at refresh time. Session-level coordinate coverage went from **9.2%** (Phase 4.0) to **96.1%** measured against the live, real refreshed dataset.

---

## 1. Real Facility Inventory

Derived from the live canonical snapshots across all 7 municipalities: **431 real facility identities** (keyed by `municipality::facility-name`, one entry per distinct `(municipality, centre)` pair after Richmond Hill's room-suffix grouping — see Part 2). For each, the build process collects: source facility name(s), municipality, a sample address where the source provides one, any native coordinate, session count, and (once resolved) a provenance record. This inventory is not a new persisted artifact of its own — it's derived fresh from the canonical snapshots each time `scripts/refresh/facility-locations.ts` runs, then resolved into the one real artifact this phase adds: the facility-location snapshot (Part 9).

## 2. Municipality Facility Counts

| Municipality | Real facility identities | Resolved | Coverage |
|---|---|---|---|
| Toronto | 249 | 245 | 98.4% |
| Mississauga | 145 | 110 | 75.9% |
| Richmond Hill | 8 | 6 | 75.0% |
| Vaughan | 12 | 12 | 100.0% |
| Markham | 10 | 10 | 100.0% |
| Newmarket | 4 | 4 | 100.0% |
| Aurora | 3 | 1 | 33.3% |
| **Total** | **431** | **388** | **90.0%** |

## 3. Duplicate/Fragmentation Findings

Confirmed directly (not assumed) using real evidence, per the task's A–D categories:

- **B — subspace within the same facility, deterministically resolvable**: Richmond Hill's `centre` strings follow one consistent, source-wide `"{Building} - {Room}"` delimiter (confirmed against 100% of its real strings) — e.g. `"Oak Ridges CC - Aerobic Room"` and `"Oak Ridges CC - Gymnasium"` are the same real building. This is the *one* case this phase merges facility identity, and only because the delimiter is exact and structural, not fuzzy.
- **D — ambiguous, deliberately left unmerged**: Mississauga's room-suffixed titles (`"Meadowvale CC Fitness Studio"`, `"Meadowvale CC Main Pool"`, 14 variants for one likely building) have no equally reliable delimiter. Per the explicit instruction not to merge on fuzzy string similarity, these stay as **distinct facility identities**, each independently resolved. This turned out to be a useful cross-check, not just caution: independently geocoding e.g. all 10 `"Burnhamthorpe CC ..."` variants produced the **exact same coordinate** for every one of them — strong evidence they really are one building, obtained without ever asserting that identity claim outright.
- **C — genuinely different locations sharing a name prefix**: not found as a real case this phase, but guarded against directly — see Part 8's "different-name-sharing" duplicate check.
- **A — same physical facility, different naming convention**: found between Toronto's own two independent datasets — its session-source `Locations` resource and its separate "Parks and Recreation Facilities" open dataset name some of the same real buildings slightly differently (e.g. an extra "and Arena"/"& Playground Paradise" suffix in one source but not the other). Resolved by address-prefix matching as a fallback to exact name matching (Part 4), not by fuzzy similarity — both are exact matches on a specific real field.

## 4. Canonical Facility Identity Approach

Implemented in `lib/dropin/facility-locations.ts`. `facilityLookupKey(municipality, centre)` is deterministic: `${municipality}::${centre}` for every municipality except Richmond Hill, where it's `${municipality}::${centre.split(" - ")[0].trim()}` — the one evidenced, structural exception from Part 2/3. No database, no facility CMS, no ID-assignment scheme beyond this string key — appropriate for ~431 stable identities. `Session.centre` (the original source facility name) is never touched, overwritten, or replaced by this key — the key is only ever used internally, as a lookup index into the coordinate registry.

## 5. Coordinate Source Hierarchy

Implemented exactly as specified, highest priority first, each tier only attempted if the previous one didn't resolve:

1. **official-source** — a session's own booking-platform source already returns a real coordinate (PerfectMind's `Address.Latitude`/`Longitude` — Vaughan, Markham, Newmarket). Restricted to this specific, confirmed source family via an explicit allowlist (`SOURCES_WITH_NATIVE_COORDINATES`) rather than inferred from "does this session already have a coordinate," specifically because the facility-location enrichment this phase adds writes coordinates back onto sessions from tiers 2/3 too — trusting any present coordinate as tier 1 would misclassify an enriched coordinate as native on every subsequent rebuild (see Part 14/17's bug-and-fix writeup).
2. **official-facility-source** — a different official dataset for the same municipality (Toronto only, this phase — see Part 6).
3. **geocoded** — Nominatim, only for real physical facilities (Part 4's `isPhysicalFacility` check excludes non-physical names like Aurora's `"Virtual"`) with no tier-1/2 match.
4. **unresolved** — recorded honestly as its own real state, never invented.

Provenance is stored per facility in the facility-location snapshot (`CoordinateProvenance`) but is **not surfaced anywhere in the UI** — confirmed: `displayActivityName`/Result Card/Decision Sheet code was not touched this phase, and no new field was added to what the UI reads.

## 6. Official Coordinate-Source Discoveries

**Toronto**: found and verified live this phase. The City of Toronto publishes a separate, real open dataset — **"Parks and Recreation Facilities"** (`cbea3a67-9168-4c6d-8186-16ac1a795b5b`, WGS84 CSV resource `61691590-4c3f-42d3-94c5-443ad3856f64`) — entirely independent of the "Registered Programs and Drop-in Courses" package DropIn's session data comes from, and confirmed to carry real coordinates for ~1,795 parks/community-centre records. Matched against DropIn's real Toronto facility names first by exact name, then by street-number + first-street-word address prefix as a fallback — **244 of 249 Toronto facilities (98.0%)** resolved this way, zero geocoding needed for the large majority of Toronto.

**ActiveCommunities (Mississauga/Richmond Hill/Aurora)**: re-confirmed live this phase, not assumed from Phase 4.0's prior finding — direct inspection of the raw JSON response from every endpoint DropIn already calls (`onlinecalendar/filters`, `onlinecalendar/multicenter/events`) shows `AcCenter`/`AcFacility` genuinely carry only `{id, name}`/`{facility_id, facility_name, center_id, center_name}`, no hidden or unused address field. A generic keyword search across the shared multi-tenant ArcGIS Hub surfaced datasets *named* similarly to a Mississauga facility inventory, but direct inspection showed they belonged to unrelated organizations (Lake County, Florida; a generic hosted layer with Southern California coordinates) — correctly rejected rather than trusted on name alone. No genuine second official source was found for these three municipalities within a reasonable scoped search; Part 7's geocoding fallback was used instead.

## 7. Geocoding Decision

**Yes, geocoding was genuinely necessary** for Mississauga, Richmond Hill, and Aurora (no confirmed second official source), plus isolated gaps elsewhere (Vaughan's one facility with `Address.Latitude: null` from its own source; 5 Toronto facilities the official-facility-source join didn't match). This is exactly the "resolving hundreds of stable facilities, not tens of thousands of sessions" case the task anticipated — **119 facilities were geocoded**, not 44,560 sessions.

## 8. Geocoding Provider Analysis

**Chose Nominatim (OpenStreetMap)** over Google Geocoding/Mapbox:

| Factor | Nominatim | Google/Mapbox |
|---|---|---|
| API key/account | None required | Requires a real account (this project cannot create one on the user's behalf) |
| Cost at this volume (~150 lookups, one-time) | $0 | Likely within free tier, but ties the project to a billing-gated account for no added accuracy benefit at this scale |
| Rate limits | 1 req/sec (public policy) — trivially satisfied by a ~150-request one-time batch | Higher, but irrelevant at this volume |
| Accuracy in GTA | Confirmed good for real named POIs (community centres, arenas) once queried correctly — see the two real bugs found and fixed below | Likely comparable or better, unverified — not needed given Nominatim's results were sufficient |
| Terms of use | Requires an identifying User-Agent, no heavy bulk use without arrangement — both satisfied by a self-enforced 1.1s rate limiter and a real, descriptive User-Agent string | N/A |
| Long-term maintainability | Public instance, no credential rotation/billing to manage | Requires managing an API key/billing relationship for a process run maybe monthly |
| Privacy | No user data involved at all — every query is a static facility name, never a user coordinate | Same (build-time only either way) |

Implemented in `scripts/refresh/facility-sources/nominatim.ts` — build-script-only, never imported by `app/` or the request path.

**Two real problems found and fixed during implementation, not anticipated in advance:**

1. **Abbreviated names silently matched the wrong place.** Querying `"Meadowvale CC, Mississauga, Ontario, Canada"` (the raw internal abbreviation) returned a real, in-GTA-bounds coordinate — but for the *suburb* named "Meadowvale," not the community centre. Same failure for `"Burnhamthorpe CC"` (matched a neighbourhood), `"Huron Park RC"` (matched a road), `"Oak Ridges CC"` (matched a suburb). This is exactly the "municipality/suburb-centroid placeholder" failure mode Part 8 explicitly warned about — these would have passed a bare GTA-bounding-box check easily. **Fixed two ways**: (a) `buildGeocodingQuery()` expands known internal abbreviations (`CC`→"Community Centre", `RC`→"Recreation Centre", `Cntr`→"Centre", `Cplx`→"Complex", `Miss`→"Mississauga") and truncates at a small, explicit, evidenced set of building-type keywords before querying (subspace words like "Fitness Studio"/"Gym A,B" return zero results even after expansion — confirmed live, not assumed); (b) `isPlausibleFacilityResult()` rejects any result whose Nominatim `category` is `boundary`, `place`, or `highway` — a small, evidenced denylist that catches exactly this failure mode even when it slips past the bounding box.
2. **A doubled-quote CSV escaping bug** in the Toronto facilities parser silently corrupted every row's geometry column (the naive parser toggled quote-state on every `"` instead of handling CSV's `""`-means-literal-`"` convention), making `fetchTorontoFacilities()` parse zero valid records on the first real run. Found by direct inspection when the official-facility-source tier unexpectedly resolved 0 facilities; fixed by rewriting the parser to handle escaped quotes correctly — verified against the real 1,795-row dataset afterward.

A third, more subtle **idempotency bug** was found after the first full successful build: re-running the facility-location build script after `refresh:data` had already enriched the canonical snapshots caused those now-enriched coordinates to be misread as if they were native tier-1 coordinates, silently erasing their real `geocoded`/`official-facility-source` provenance on every subsequent rebuild. Fixed by (a) restricting tier-1 detection to the one source family actually confirmed to provide native coordinates (PerfectMind), and (b) making the build process reuse each facility's own prior resolution from the existing facility-location snapshot rather than re-deriving it, so re-running the script is now genuinely idempotent — verified directly: a second consecutive run reused all 388 already-resolved facilities and only retried the 43 still-unresolved ones.

## 9. Storage Architecture

One new snapshot artifact, reusing Phase 3.3's exact `SnapshotStorage` abstraction (`readJsonIfExists`/`writeSnapshotAtomic`) — no database introduced. `data/facility-locations/latest.json` + `previous.json`, same two-slot atomic rotation every other snapshot already uses (`lib/dropin/snapshot/paths.ts`'s new `facilityLocationsLatestPath()`/`facilityLocationsPreviousPath()`). Size: ~214KB for all 431 entries — negligible next to the ~81MB of canonical session data. Built by a **separate, explicitly-invoked process** (`npm run refresh:facilities`, not part of `npm run refresh:data`) specifically because facility coordinates are slow-changing reference data, not something that should be re-derived (and re-geocoded) on every routine session refresh.

```
Official facility/address (Toronto CSV, PerfectMind Address block)
        ↓
npm run refresh:facilities (one-time / periodic, network calls happen ONLY here)
        ↓
data/facility-locations/latest.json  (SnapshotStorage, same as raw/canonical)
        ↓
npm run refresh:data → each source's normalize step → enrichSessionsWithFacilityLocations()
        ↓
data/canonical/<municipality>/latest.json  (Session.latitude/longitude, no provenance exposed)
        ↓
/api/sessions (plain local file read, unchanged)
```

## 10. Coordinate Provenance Model

`CoordinateProvenance = "official-source" | "official-facility-source" | "geocoded" | "unresolved"`, stored per facility entry in the facility-location snapshot only — never written onto `Session` objects, never serialized in `/api/sessions`, never read by any UI code. `Session.latitude`/`longitude` themselves carry no indication of how they were obtained, by design (Part 4's "do not expose this provenance in the UI").

## 11. Before/After Coordinate Coverage

| Municipality | Before (Phase 4.0) | After (Phase 4.1, measured live) |
|---|---|---|
| Toronto | 0.0% | **99.4%** |
| Mississauga | 0.0% | **89.8%** |
| Richmond Hill | 0.0% | **82.9%** |
| Vaughan | 98.6% | **100.0%** |
| Markham | 100.0% | 100.0% |
| Newmarket | 100.0% | 100.0% |
| Aurora | 0.0% | **89.4%** |
| **Combined** | **9.2%** | **96.1%** |

## 12. Unresolved Facilities

**43 of 431 real facilities (10.0%)** remain unresolved, honestly reported rather than guessed at:

- **Mississauga (35)**: the "Miss Seniors' Cntr" cluster (8 room variants — the phrase itself doesn't resolve as a distinct POI even after abbreviation expansion), "Meadowvale 4 Rinks" (4 rink variants — genuinely ambiguous whether this is the same building as "Meadowvale CC" or a separate structure; not assumed either way), "Lions Club of CV Pool" (3 variants), "Erin Mills Twin Arena" (2 variants — a real Nominatim result existed but was correctly *rejected* by the `highway`/`bus_stop` category check, since it matched a bus stop named after the arena, not the arena itself), 10 "... Play In The Park Hut" temporary/mobile structures (arguably not real fixed geocodable buildings at all), "Mattamy SP Dome" (3 field variants), "MSEC SPORTSPLEX" (2 variants).
- **Toronto (4)**: "Donald D. Summerville Olympic Pools," "General Mercer School - Wading Pool," "Native Scarborough Family Centre," "High Park - Children's Garden and Teaching Kitchen" — none matched the official facilities dataset by name or address prefix, and none geocoded successfully.
- **Richmond Hill (2)**: "Elgin West CC," "Silver Stream Park."
- **Aurora (2)**: "Aurora Rec Cplx" (a plausible-looking alternate query, "Aurora Community Centre," *does* geocode successfully — but with no confirmed evidence it's the same physical place as "Aurora Rec Cplx," it was deliberately left unresolved rather than assumed); "Virtual" (correctly excluded as non-physical, not a gap).

## 13. Unresolved Sessions

**1,809 of 46,367 sessions (3.9%)** currently cannot resolve to a coordinate — the session-level counterpart of Part 12's facility gaps. This is not hidden inside the 96.1% headline figure: reported explicitly here, per the instruction not to hide gaps.

## 14. Performance Measurements

- **Facility-location build** (`npm run refresh:facilities`): ~4–5 minutes on a full cold run (bounded by Nominatim's self-enforced 1.1s/request rate limit across ~119 geocoded facilities) — but this is a rare, explicitly-invoked process, never part of routine refresh. **Confirmed idempotent**: a second consecutive run completed in under a minute, reusing all 388 already-resolved facilities and only retrying the 43 genuinely unresolved ones.
- **`npm run refresh:data`** (routine, the process real deployments actually run repeatedly): enrichment adds one local JSON file read (cached per-process) plus an in-memory `Map` join over each municipality's own sessions — no measurable duration change versus Phase 3.3/3.6B baseline durations (e.g. Aurora: 4.6s this phase vs. 3.6–4.2s in earlier phases, within normal run-to-run variance, not a regression pattern).
- **Snapshot size**: facility-locations snapshot is ~214KB; canonical snapshot sizes are unchanged in shape (`latitude`/`longitude` were already-defined optional `Session` fields, just newly populated for more rows).
- **`/api/sessions` latency**: measured directly — steady-state ~250–360ms for the full ~30MB response in dev mode, no observable regression from before this phase's enrichment (the field was already part of every `Session` object's shape; enrichment only changes *whether* it's populated, not the request-path code that serves it).
- **Confirmed**: zero geocoding or external network calls happen anywhere in the request path. `enrichSessionsWithFacilityLocations()` and `loadFacilityLocationLookup()` (`lib/dropin/facility-locations.ts`) are only ever called from `scripts/refresh/*.ts`; grep-confirmed zero imports from `app/` or `lib/dropin/sources/index.ts`.

## 15. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npm run lint` on every touched file: clean, 0 errors/warnings.
- `npm run build`: succeeds, all 10 routes compiled.
- `npm run refresh:data`: 7/7 sources activated.
- `scripts/snapshot-health.ts`: all 7 municipalities FRESH.
- Canonical-ID collisions across the full combined 46,367-session dataset: **0**.
- Coordinate-quality re-validation on the enriched dataset: 0 out-of-GTA-bounds, 0 exact-`0,0`, 0 swapped lat/long, 0 coordinate shared by genuinely different-named facilities.
- Live search regression: `yoga mississauga` and `swimming toronto` both verified live — real results, real Decision Sheet content, Directions link confirmed present and functioning for sessions at facilities that had zero coordinates before this phase (e.g. Mississauga's "Burnhamthorpe CC Fitness Studio," Toronto's "Scadding Court Community Centre" — the latter's coordinate cross-checked directly against the live `/api/sessions` response: `43.6518252765297, -79.4049504110461`).
- Result Cards and Decision Sheet: visually and structurally unchanged — confirmed no UI file was modified this phase.

## 16. Mobile Verification

Repeated the same `yoga mississauga` search over the real LAN connection (`http://192.168.18.4:3000`) used in every prior phase's mobile check: identical results to desktop, no horizontal overflow, Decision Sheet renders correctly with the Directions/Share/View-official-listing buttons all present and correctly laid out. No browser geolocation was requested (none is implemented yet — that's Phase 4.2), so this phase carries no new mobile permission or HTTPS consideration; it's a pure data-completeness check on top of the same frozen UI.

## 17. Risks

- Mississauga's "Meadowvale 4 Rinks" vs. "Meadowvale CC" relationship remains genuinely unresolved — a future pass could investigate whether they're the same site (in which case the already-resolved "Meadowvale CC" coordinate could reasonably extend to the rinks) or a real separate structure, but this phase deliberately did not assume either way.
- The Toronto official-facility-source join depends on a specific CKAN dataset/resource ID that could change; if it does, Toronto falls back to geocoding automatically (already handled by the `try`/`catch` around `fetchTorontoFacilities()`), just with the same "requires a real government dataset ID" fragility any hardcoded resource reference has.
- Nominatim's public instance is a shared, best-effort service — reasonable for an infrequent one-time batch of this size, but not something to scale up casually if DropIn's municipality count grows substantially; a paid provider or a self-hosted Nominatim instance would be the next step if that ever becomes necessary, not before.
- 43 facilities / 1,809 sessions remain genuinely unresolved — real, reported, not blocking, but Phase 4.2's Near Me feature will simply be unable to compute a distance for these until/unless a future pass resolves them.

## 18. Readiness for Phase 4.2

The data contract Phase 4.2 needs — `user coordinates → facility coordinates → distanceKm` — is now genuinely in place on the *facility coordinates* side: `Session.latitude`/`Session.longitude` are populated for 96.1% of sessions, sourced from real official data wherever possible and validated geocoding elsewhere, with zero request-time cost to obtain them (already sitting on the session object `/api/sessions` already serves). Phase 4.2 only needs to add the *user coordinate* half (`navigator.geolocation`, transient, never persisted, per Phase 4.0's own recommendation) and the Haversine distance computation itself — no further facility-location work is a hard blocker, though the 43 unresolved facilities will simply show no distance, honestly, same as any other missing optional field.

---

## Concise Answers

**A. How many real physical facilities does DropIn currently cover?** 431 real facility identities across all 7 municipalities.

**B. How many now have reliable coordinates?** 388 (90.0%) — 25 official-source, 244 official-facility-source, 119 geocoded (and validated: GTA-bounds, category-checked, cross-validated against duplicate-name-sharing).

**C. What percentage of sessions can now resolve to coordinates?** 96.1% (44,560 of 46,367), up from 9.2% at Phase 4.0.

**D. Which municipalities still have meaningful location gaps?** Mississauga (75.9% facility coverage — mainly its Seniors' Centre cluster, "4 Rinks" arena, and small park-hut structures) and, more narrowly, Aurora (only 1 of 3 real facilities resolved — its second complex has no confirmed-safe geocoding match). Toronto and Richmond Hill are close to fully covered (98.4% and 75.0% facility coverage respectively, though Richmond Hill's absolute count is tiny — 6 of 8). Vaughan, Markham, and Newmarket are fully covered.

**E. Where did coordinates come from?** Tier 1 (official-source, PerfectMind's own data): 25 facilities. Tier 2 (official-facility-source, Toronto's separate Parks and Recreation Facilities open dataset): 244 facilities. Tier 3 (geocoded via Nominatim, validated): 119 facilities.

**F. Did we need external geocoding?** Yes, for 119 of 431 facilities (mainly Mississauga, plus small numbers in Richmond Hill/Aurora/Vaughan/Toronto) — but only after confirming no official source covered them, and only ever for unique facilities, never sessions.

**G. Does any user search trigger external location/geocoding requests?** **No.** Confirmed by code inspection (zero imports of the geocoding/facility-location-loading code from `app/` or the request-path `lib/dropin/sources/index.ts`) and by direct measurement (`/api/sessions` steady-state latency unchanged, no network calls observable from the request path).

**H. Is the dataset ready for real Near Me implementation?** Yes, for the facility half of the equation — 96.1% of sessions can now compute a real distance once a user coordinate exists. Phase 4.2 can proceed directly to browser geolocation and Haversine distance without further location-data prerequisites.

---

Stopping here, as instructed. Not beginning Near Me, distance sorting, or Map View.
