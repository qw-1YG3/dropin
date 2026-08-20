# Phase 4.3B — Distance-Aware Ranking Implementation

Implements exactly the ranking decision Phase 4.3A's real-data audit recommended: **temporal group precedence → `startMinutes` ascending → `distanceKm` ascending (when comparable) → `session.id` as a deterministic final key.** No new strategy was introduced, no time-window heuristic, no weighted scoring, no sort control, no Map View.

---

## 1. Implementation

Two files changed, both minimal, additive changes to existing functions:

- **`lib/dropin/time.ts`** — added `compareForRanking`, a comparator *factory* (not a stored field, not a new state) that takes a `distanceKmFor` lookup function and returns a comparator. It **reuses** the existing `compareChronologically` for the first two keys rather than duplicating that logic, and only evaluates distance/id when `compareChronologically` reports an exact tie.
- **`app/page.tsx`** — `resultsGrouped`'s single sort call changed from `.sort(compareChronologically)` to `.sort(compareForRanking(distanceKmFor))`, and `distanceKmFor` (Phase 4.2's existing, already-memoized distance lookup) was added to that `useMemo`'s dependency array so ranking recomputes when location changes. No other file was touched. No new state, no new hook, no new UI element.

## 2. Comparator Chain

```ts
export function compareForRanking<T extends { date: string; startMinutes: number; id: string }>(
  distanceKmFor: (session: T) => number | undefined,
): (a: T, b: T) => number {
  return (a, b) => {
    const chronological = compareChronologically(a, b); // date, then startMinutes
    if (chronological !== 0) return chronological;

    const da = distanceKmFor(a);
    const db = distanceKmFor(b);
    const aHasDistance = da !== undefined;
    const bHasDistance = db !== undefined;
    if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
    if (aHasDistance && bHasDistance && da !== db) return da - db;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
```

**Chronological order is checked first and is fully authoritative** — the function returns immediately on any real date/time difference, before distance is even looked up. Distance is only ever consulted when two sessions share the exact same `date` and `startMinutes`. This is a strict lexicographic tuple comparison `(date, startMinutes, hasDistance, distance, id)`, which is transitive and deterministic by construction (Part 8's requirement) — never an ad hoc pairwise heuristic.

When `distanceKmFor` returns `undefined` for every session (no granted location — Part 5), the distance step is a no-op for every pair, and the whole comparator degrades to `compareChronologically` + the `id` tiebreak — achieved by this one function handling both cases identically, not by a separate branch.

## 3. Missing-Distance Behavior

Exact comparator behavior for the three possible pairings at an exact time-tie, verified in code and against real data:

| a has distance | b has distance | Result |
|---|---|---|
| yes | yes | ascending by `distanceKm` (or `id` if numerically equal) |
| yes | no | **a ranks first** — a session with a real distance value always outranks one without, among otherwise-tied sessions |
| no | yes | **b ranks first** (symmetric case) |
| no | no | falls through to `id` ascending |

A session missing distance is **never dropped, never assigned a fake value (never `0`), and never treated as an error** — it simply skips the distance-comparison step and falls to the deterministic `id` key. Verified live and via script against real sessions with missing facility coordinates (e.g., `Lane Swim @ Donald D. Summerville Olympic Pools`) — present and fully functional at real positions inside real result groups (position 6/92, 33/104, etc. in the verification run), never hidden.

## 4. Location-Permission Behavior

No conditional logic was added for "is location granted" — Part 5's requirement (time-first, deterministic ranking with no location) is satisfied **structurally**, by the same mechanism as §3: `distanceKmFor` (Phase 4.2, unchanged) already returns `undefined` for every session whenever `userLocation.status !== "granted"`, so idle/denied/unavailable/unsupported all produce the exact same ranking behavior — chronological order, then `id`. Verified live: with location denied, a real tied badminton group (four sessions all starting 4:30 PM) fell back to a stable, real, non-arbitrary order (`Carmine Stefano → East Bayfront → Trinity → Badminton with Family`, by `session.id`) — and reproduced **byte-identical** after a full page reload with location never even requested, confirming this isn't dependent on any transient state.

No IP-based location inference and no use of the displayed fallback municipality as coordinates were added — confirmed by inspection: `distanceKmFor`'s only input is `userLocation.latitude`/`longitude`, which only ever come from a real, granted `navigator.geolocation` reading.

## 5. Explicit-Search Precedence

Unchanged from Phase 4.2, and untouched by this phase: `compareForRanking` only ever reorders sessions **within** whatever pool `resultsFiltered` already produced — it has no visibility into, and cannot affect, which sessions are in that pool. Verified live: searching "pickleball markham" while device location was mocked to downtown Toronto returned exactly 3 real Markham sessions (header correctly showing "Markham," not "Near me"), regardless of ranking — the same real result confirmed structurally in Phase 4.3A's Case 6 and reconfirmed here against the shipped code.

## 6. Deterministic Tie-Breaking

`session.id` is the final key precisely because it's already a required, unique `string` field on every `Session` (confirmed in `lib/dropin/types.ts`) — no new field was introduced. This replaces the two real, previously-identified sources of incidental ordering:

- **Municipality iteration order** (`getAllSessions`'s fixed `["toronto", "mississauga", ...]` array) — no longer decides any real tie's final order; it's now only ever the input to a comparator that resolves every tie deterministically by `id`.
- **Snapshot/scrape order** (no sort at canonical-write time) — same: still the input order, but no longer the deciding factor for how ties render.

Verified live and by script: identical output across (a) repeated calls with the same input, (b) a deliberately **reversed** input array, and (c) a real full-page reload that reset all component state. All three produced byte-identical ordering.

## 7. Real Before/After Examples

All from the live app (2026-08-20, mocked downtown-Toronto coordinate for the "granted" examples) and cross-checked against a standalone script that mirrors the shipped comparator line-for-line:

**Badminton, "Starting soon" (4:30 PM tie, granted location):**
```
Before (chronological only, old tie order): 4:30 PM · Badminton with Family · Trinity Community Recreation Centre (2.7 km)
                                              4:30 PM · Badminton · Carmine Stefano Community Centre (15 km)
                                              4:30 PM · Badminton (Women) · East Bayfront Community Recreation Centre (2 km)

After (Phase 4.3B, live):                    4:30 PM · Badminton (Women) · East Bayfront Community Recreation Centre — 2 km
                                              4:30 PM · Badminton with Family · Trinity Community Recreation Centre — 2.7 km
                                              4:30 PM · Badminton · Carmine Stefano Community Centre — 15 km
```
Confirmed live in the running app, not just simulated.

**Swim, future date (Aug 26), cross-municipality 6:00 AM tie, granted location:**
```
6:00 AM · Lane Swim @ Etobicoke Olympium (Toronto) · 16 km      ← ranks first
6:00 AM · Lane Swim (6:00 a.m.) @ Ray Twinney Recreation Complex (Newmarket) · 44 km  ← ranks second
```
Before this phase, this exact tie would have resolved by the fixed municipality array order (Toronto before Newmarket) regardless of actual distance — here the outcome happens to agree, but the *reason* is now real ("closer"), not incidental array position. Confirmed live at 437 real cross-municipality results.

**No-location fallback (denied), same badminton tie:**
```
4:30 PM · Badminton · Carmine Stefano Community Centre
4:30 PM · Badminton (Women) · East Bayfront Community Recreation Centre
4:30 PM · Badminton with Family · Trinity Community Recreation Centre
```
Distance cleanly absent from every card; order is deterministic (by `id`), reproduced identically after a full reload.

**Never-an-overtake, every scenario tested:** across the full real-data verification sweep (Pickleball, Badminton, Swim, Basketball, Yoga; today and a future date; 6 user-location scenarios from Phase 4.3A's matrix), **zero** cases were found where a session starting later ranked ahead of one starting earlier. This was explicitly checked programmatically (a `verifyNoOvertakes` pass over every group's final order) and passed on every single group.

## 8. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npm run build`: succeeds, all 10 routes compiled.
- `npx eslint app/page.tsx lib/dropin/time.ts`: the same 10 pre-existing, out-of-scope `react-hooks/refs` errors already documented since Phase 3.6B (unrelated scroll-fade-indicator code) — zero new errors.
- **Scenario coverage** (A–I from the task, all performed against real data, live and/or scripted):
  - A. Location granted — confirmed, real distance tie-breaks observed live and at scale (script: e.g. 73/92 sessions reordered within one real "Happening now" swim group due to real tie density).
  - B. Location denied — confirmed, deterministic `id`-based fallback, no distance shown.
  - C. Location unavailable — same code path as denied (`distanceKmFor` returns `undefined` identically for every non-`"granted"` status); not re-tested as a separate live case since the mechanism is provably identical, per §4.
  - D. Explicit municipality search — confirmed scope preserved (Markham stayed 3-session Markham-only) regardless of ranking.
  - E. Same-start-time sessions — confirmed extensively; this is, per Phase 4.3A's own measurement, 98.3% of a typical day's sessions, so it was exercised heavily by every other test.
  - F. Missing-distance sessions — confirmed present, functional, never dropped, never defaulted to 0.
  - G. Happening Now vs. Starting Soon — confirmed groups remain fully separate; no distance value can move a session across that boundary (§1's chronological-first check makes this structurally impossible, not just observed).
  - H. Future selected dates — confirmed (Aug 26 swim example above, 437 real cross-municipality results).
  - I. Cross-municipality broad activity search — confirmed (same Aug 26 example; also the earlier badminton example spans Toronto/Markham).
- **Municipalities**: real sessions from Toronto, Mississauga, Vaughan, Markham, and Newmarket appeared directly in the scenarios tested above; Richmond Hill and Aurora sessions were included in the underlying real-data verification sweep (Phase 4.3A's matrix and this phase's `verify_4_3b.js` run against all 7 municipalities' canonical snapshots) though not separately screenshotted live — their session data flows through the exact same, single, municipality-agnostic comparator as every other municipality, so no municipality-specific behavior exists to verify separately (Part 15's "avoid municipality-specific logic" was upheld by construction, not asserted).

## 9. Mobile Verification

- **Structurally verified at mobile width** (390px, via DOM-width-constraint injection — the same technique used in every prior phase of this project, since `resize_window` remains non-functional in this environment): search works, the swim result group renders correctly with distance visible ("16 km," "44 km"), cards remain tappable, and the Decision Sheet opens correctly with Directions/Share intact.
- **LAN-real device**: not separately re-tested this phase — Phase 4.2 already established the real insecure-context geolocation limitation on the LAN origin, and this phase makes no change to geolocation acquisition itself, only to how an already-available distance value is used in sorting, so that finding carries forward unchanged.
- **Physical-device visual verification**: **not performed.** No physical iOS Safari or Android Chrome device was available in this environment. Not claimed.

## 10. Performance Impact

No new network calls of any kind were introduced — confirmed by inspection: `compareForRanking` and `distanceKmFor` are both pure, synchronous, client-side functions operating on data already present in the fetched `/api/sessions` payload. `/api/sessions` itself was not modified and remains fully snapshot-driven (`lib/dropin/sources/index.ts`, untouched this phase). No per-session geocoding, no routing API, no external distance API — the only distance computation is Phase 4.2's existing Haversine formula, unchanged.

The added work per sort is a handful of extra comparisons only on **exact ties** (the common case, per Phase 4.3A's 98.3% figure, resolves to at most one extra `distanceKmFor` call pair per comparison beyond what the array's sort already performs) — negligible next to Phase 4.2's own measured baseline (~12ms to Haversine the entire ~44,500-session dataset with real coordinates). No separate re-measurement was necessary since the sort's asymptotic complexity (`O(n log n)`) and per-comparison cost are both unchanged in order of magnitude from before this phase.

## 11. Remaining Risks

- **Snapshot-order stability across refreshes remains unverified in practice** (flagged already in Phase 4.3A, still true) — though it now matters less: even if snapshot order varies between refreshes, `session.id` is derived from stable per-session identifiers (confirmed by inspection of the id values used throughout this phase's testing, e.g. `toronto-3366`, `markham-b4e30db8-...-20260820`), so the *final* tie order stays deterministic regardless of what order the snapshot happens to load sessions in — this was the whole point of adding the `id` key, and it was directly verified (input-order-independence test: sorting a reversed copy of a real tied group produced byte-identical output).
- **No real user-location data exists yet** — same caveat as Phase 4.3A: every distance figure in this phase's testing comes from mocked/simulated coordinates, since real granted-geolocation usage data doesn't exist yet.
- **Discovery's highlight algorithm was deliberately not touched** — it has its own separate status-rank + district/activity-diversity logic (`discoveryHighlights`, unchanged), which was out of scope for this phase's specific mandate (implementing exactly Phase 4.3A's Strategy C recommendation for the main Results list). If Discovery's ranking is ever revisited, it would be a separate, explicit decision, not an oversight here.

---

## Closing Questions

**A. Is the production ranking now: temporal relevance → start time → distance → deterministic key?** Yes, exactly — confirmed by direct inspection of the shipped `compareForRanking` and its single call site in `resultsGrouped`.

**B. Can distance ever cause a later-starting session to outrank an earlier one?** No. `compareChronologically` (date, then `startMinutes`) is checked first and returns immediately on any real difference — the distance step is structurally unreachable except on an exact tie. Verified programmatically across every tested scenario: zero overtakes found.

**C. What happens when distance is unavailable?** The session is never hidden, never invalidated, and never treated as 0 km. Among otherwise-tied sessions, one with a real distance value ranks ahead of one without; two sessions that both lack distance (or have numerically equal distance) fall through to the `id` tiebreak. Verified live and by script against real sessions with missing facility coordinates.

**D. Is ranking deterministic across refreshes?** Yes, for the final tie order specifically — verified directly: sorting a real tied group with its input array reversed, and separately after a full page reload, both produced byte-identical output to the original order. (Whether the *snapshot itself* refreshes with stable internal ordering was not verified — but it no longer needs to be, since `id` makes the final order stable regardless.)

**E. Does explicit municipality search still override passive user location?** Yes, unchanged and unaffected by this phase — verified live: "pickleball markham" stayed scoped to exactly 3 real Markham sessions with a mocked Toronto device location active.

**F. Were all seven municipalities regression-tested?** Real sessions from 5 municipalities (Toronto, Mississauga, Vaughan, Markham, Newmarket) were directly exercised in live browser scenarios; all 7 (including Richmond Hill and Aurora) were included in the script-based real-data verification sweep against their actual canonical snapshots. No municipality-specific code path exists for this feature — every session flows through the same single, generic comparator — so this coverage is sufficient to conclude the behavior is uniform across all 7, not merely the 5 directly screenshotted.

**G. Were any new network calls introduced?** No. Confirmed by inspection — ranking is a pure, synchronous, client-side computation over already-fetched data; `/api/sessions` and the refresh/snapshot pipeline are both untouched.

**H. Is Phase 4.3 now complete?** Yes, per its own defined scope (4.3A audit + 4.3B implementation) — distance-aware ranking is shipped, evidence-based, regression-tested, and documented. No sort control, Map View, or further ranking phase has been started.

---

Stopping here, as instructed. No Map View work, no sorting controls, and no further phase has begun.
