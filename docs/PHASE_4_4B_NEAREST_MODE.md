# Phase 4.4B — Lightweight Nearest Mode

Implements exactly the Phase 4.4 audit's recommendation: a lightweight, explicit, opt-in "Nearest" toggle that reorders results by distance **within** the existing, unchanged temporal group structure. The Phase 4.3B default ranking (temporal group → start time → distance tie-break → `session.id`) is untouched and remains the default on every fresh visit.

---

## 1. Implementation

Two files changed, both small and additive:

- **`lib/dropin/time.ts`** — added `compareNearest`, a comparator factory with the same shape as Phase 4.3B's `compareForRanking`, but with distance promoted ahead of start time.
- **`app/page.tsx`** — added `nearestMode`/`awaitingNearestLocation` state, a `handleNearestClick` handler, a `nearestActive` derived value, `resultsGrouped`'s comparator selection, and one new text-button control in the existing result-count row. `useUserLocation`'s `requestLocation` gained an optional completion callback (backward-compatible — the header pill's own call site is unaffected) so Nearest can react to its own permission request without a `useEffect` watching state (avoiding a `react-hooks/set-state-in-effect` lint violation the first implementation attempt introduced and this one fixed before shipping).

No Result Card, Decision Sheet, "When" section, or Activity chip code was touched.

## 2. Ranking Comparator

```ts
export function compareNearest<T extends { date: string; startMinutes: number; id: string }>(
  distanceKmFor: (session: T) => number | undefined,
): (a: T, b: T) => number {
  return (a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;

    const da = distanceKmFor(a);
    const db = distanceKmFor(b);
    const aHasDistance = da !== undefined;
    const bHasDistance = db !== undefined;
    if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
    if (aHasDistance && bHasDistance && da !== db) return da - db;

    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
```

`resultsGrouped` selects between this and `compareForRanking` based on `nearestActive`:

```ts
const comparator = nearestActive ? compareNearest(distanceKmFor) : compareForRanking(distanceKmFor);
const sorted = [...resultsFiltered].sort(comparator);
```

## 3. Temporal-Group Guardrail

This is the load-bearing architectural fact, and it required **no new grouping logic**: `resultsGrouped` sorts the whole date-scoped pool once, then partitions it into groups using `.filter()` calls that decide membership purely from each session's own real `computeStatus`/`timeOfDayBucket` — never from array order. Swapping which comparator produced the pre-filter order therefore can only ever reorder sessions **within** a group; it has no code path that can move a session across a group boundary, because the function that decides group membership never even sees which comparator was used.

This was verified two ways, not assumed:
- **By construction** — read directly from the code, the group filters are unchanged since Phase 4.3B.
- **By real-data script**, mirroring the exact production shape: across every scenario tested (Badminton, Pickleball, Swim, Basketball; multiple real GTA locations; today and a future date), **group membership was byte-identical between DEFAULT and NEAREST in 100% of cases** — only intra-group order differed, and every group's NEAREST order was confirmed strictly nearest-first (missing distance sorting last).

## 4. UI Placement

A single text-based button was added to the existing result-count row, immediately after the count text (not grouped with the density toggle, which is a presentation control, not a ranking one):

```
26 Badminton activities · Updated 3 days ago    Nearest    [list] [grid]
```

It reuses the exact subtle sage "selected" treatment already used by the active Activity chip (`bg-sage/15 text-sage-text` when on, plain `text-text-secondary` when off) — no new visual language, no new component, no dropdown, no settings panel.

## 5. Permission Behavior

Reuses Phase 4.2's `requestLocation()` exactly as it exists — no second geolocation implementation:

- If `userLocation.status === "granted"` already (e.g., via the header pill), clicking Nearest activates it **immediately**, no new prompt.
- If not yet granted, clicking Nearest calls `requestLocation(onResolved)`; the callback fires directly from `useUserLocation`'s own native `getCurrentPosition` success/error callbacks (not from a `useEffect`), activating Nearest on `"granted"` and leaving it off — silently, no crash, no nag, no retry loop — on `"denied"`/`"unavailable"`/`"timeout"`/`"unsupported"`.
- Verified live: a single click on Nearest with location not yet requested correctly triggered the request, granted it (mocked), updated the header pill to "Near me," and activated Nearest — all from one user action.
- Verified live: with location mocked to deny, clicking Nearest left it off, the header stayed "Near you," results stayed in default order, and the control's accessible name read "Sort by nearest — location access denied, tap to try again" — an honest, retry-friendly state, not a dead end.

## 6. Missing-Distance Behavior

Identical safe policy to Phase 4.3B's `compareForRanking`, just with distance promoted ahead of start time in the tuple: a session with a real distance value always sorts ahead of one without, among sessions that would otherwise be compared; two sessions that both lack distance fall through to start time, then `id`. Never hidden, never assigned a fake value, never treated as 0 km. Verified against real data: coordinate-less swim sessions (e.g., "Lane Swim @ Donald D. Summerville Olympic Pools") were confirmed present at the **end** of their real group (e.g., position 92/92, 104/104) under Nearest — pushed toward the back within their group, never dropped, never moved to a different group.

**Comparator transitivity**: the comparator is a strict lexicographic tuple `(date, hasDistance, distance, startMinutes, id)` — every branch is a total order, never an ad hoc pairwise rule. Verified directly: sorting a real tied group with its input array **reversed** produced byte-identical output to the normal-order sort, and repeated sorts of the same input were identical — confirming true determinism, not just apparent stability.

## 7. Explicit-Search Precedence

Unaffected by this phase — Nearest, like every ranking strategy before it, only ever reorders whatever pool `resultsFiltered` already produced; it has no way to add, remove, or reach outside that pool. Verified live: searching "pickleball markham" with Nearest active and a mocked downtown-Toronto device location returned the same 3 real Markham sessions as the default ranking, correctly reordered nearest-first (26 km → 27 km → 29 km) — the header correctly showed "Markham," not "Near me," and Nearest itself stayed active through the query change.

## 8. Accessibility

- Real `<button type="button">`, not a clickable `<div>` — keyboard-focusable by default (`tabIndex: 0`, confirmed).
- `aria-pressed` reflects `nearestActive` — the actual, real effect, never an aspirational "the user clicked it" state — so the control never claims to be doing something it isn't (consistent with this project's established "never imply certainty the data can't support" discipline).
- Dynamic `aria-label` (`nearestControlAriaLabel()`) communicates the specific state in plain language: awaiting location, active, denied-with-retry-hint, or the default invitation — never relying on the sage color alone to convey state (WCAG 1.4.1).
- Keyboard-activated via `Enter` — confirmed live: focusing the button and pressing Enter correctly toggled `aria-pressed` from `"false"` to `"true"` and updated the accessible name to match.
- Focus state uses the same `focus-visible:ring-2 focus-visible:ring-sage-text` pattern as every other interactive control in the app — no new focus styling introduced.

## 9. Mobile Behavior

- **Tap target**: measured at 54×24px on first implementation — the same bare-WCAG-2.2-AA-minimum height Phase 4.2 found on the header pill. Applied the identical, minimal fix that phase established (`py-1` → `py-1.5`), bringing it to 54×28px — a real, honest improvement, consistent with the project's prior documented judgment that this is the smallest defensible change without a larger redesign; still short of the 44px "ideal" comfort target, reported as such rather than overstated.
- **Row layout at 390px width** (structurally verified via DOM-width-constraint injection — `resize_window` remains non-functional in this environment, the same limitation documented in every prior phase): tested with the longest realistic count string ("26 Badminton activities · Updated 3 days ago") plus an active Nearest control plus the density toggle, all in one row. The count text's existing `truncate` treatment (added as part of this phase's minimal structural adjustment — wrapping the count span and the new button in a `flex min-w-0` container) lets the count shrink instead of pushing Nearest or the density icons off-screen or wrapping the row. Confirmed via direct measurement: `document.body.scrollWidth === document.body.clientWidth` (388px, no overflow) in the worst-case scenario tested.
- **Physical-device visual verification**: **not performed.** No physical iOS Safari or Android Chrome device was available in this environment. Not claimed.

## 10. Real Before/After Examples

All six required demonstrations, from the real-data verification script mirroring the shipped code exactly, plus live confirmation in the running app for the first two:

**1. Meaningful distance savings** (Basketball, Vaughan-area user, "Later today" group):
```
DEFAULT:  5:00 PM · 18 km · Stephen Leacock Community Recreation Centre
NEAREST:  8:45 PM · 4.6 km · Adult Basketball @ Carrville Community Centre (Vaughan)
```
A real 13.4 km saving, available because the user explicitly opted in — never shown by default.

**2. Case where pure (unbounded) distance-first would have caused a major wait penalty** — this is exactly why the group guardrail exists: the Carrville session above starts at 8:45 PM. Under Phase 4.4's audit, a naive *global* proximity sort would have let this session outrank a real 5:30 PM option only 11 km away — a bad trade the audit specifically measured (585-minute average-case wait). Under the shipped, group-bounded Nearest, that 5:30 PM option is protected: it can only be reordered against other "Later today" sessions, and — confirmed live and by script — the group itself never admits an out-of-window session just because it's close.

**3. Cross-municipality broad search** (Swim, future date Aug 27, Vaughan-area user, "afternoon" group):
```
DEFAULT:  12:00 PM · 9.6 km · Leisure Swim @ Grandravine Community Recreation Centre (Toronto)
NEAREST:  1:00 PM  · 7.9 km · Leisure Swim @ Driftwood Community Recreation Centre (Toronto)
```
402 real sessions across multiple municipalities in the pool; Nearest correctly surfaces a genuinely closer option within the same afternoon window.

**4. Explicit "pickleball markham"** — confirmed live: 3 real Markham sessions, reordered nearest-first (26 km → 27 km → 29 km), header showing "Markham," Nearest remaining active through the query change. No Toronto session ever appeared.

**5. Missing-distance sessions** — confirmed by script: real coordinate-less swim sessions present at the end of their real group (e.g., position 92/92) under Nearest, never dropped, never faked.

**6. Same-start-time sessions** — confirmed live: Badminton's real "Happening now" group (all sessions already in progress) reordered from arbitrary tie order to nearest-first (2 km → 2.7 km → 15 km → 24 km) the moment Nearest was activated, and reverted cleanly to the prior order when deactivated.

## 11. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npm run build`: succeeds, all 10 routes compiled.
- `npx eslint app/page.tsx lib/dropin/time.ts`: exactly the same 10 pre-existing, out-of-scope errors documented since earlier phases (4 `react-hooks/set-state-in-effect` in unrelated pre-existing effects, 6 `react-hooks/refs` in unrelated scroll-fade code) — **zero new errors**, including zero from the new `useUserLocation` callback pattern (the first implementation attempt did introduce one new `set-state-in-effect` violation via a `useEffect`; it was found, root-caused, and replaced with the callback-based design in §1/§5 before this was considered done).
- **Municipalities**: real sessions from Toronto, Mississauga, Vaughan, Markham, and Newmarket were directly exercised in live browser scenarios and the real-data verification script; Richmond Hill and Aurora sessions were included in the same script's full canonical-snapshot sweep. No municipality-specific code path exists for Nearest — every session flows through the identical generic comparator — so this is sufficient to conclude uniform behavior across all 7.
- **Search**: confirmed working identically with Nearest on or off (query parsing untouched).
- **Date selection**: confirmed live — Nearest persisted correctly through a same-page date change to a future date (Aug 21), correctly re-applied to that date's Morning/Afternoon/Evening groups.
- **Time-of-day filtering**: unaffected by inspection — an active Time-of-Day chip collapses `resultsGrouped` to a single flat, already-sorted list; Nearest's comparator selection happens before that collapse, so it applies consistently to that flattened list too, itself an even safer, more explicitly user-scoped case per the audit's own §7 reasoning.
- **Activity chips**: unaffected — chip filtering happens upstream of ranking.
- **Default ranking**: confirmed byte-identical to Phase 4.3B's shipped behavior when Nearest is off, both by code inspection (untouched `compareForRanking` code path) and live observation.
- **Distance display, Result Card, Decision Sheet, Directions, Official listing/Register, Share**: all confirmed working normally with Nearest active — none of this code was touched, and live testing found no regression.
- **Mobile functional behavior**: confirmed via DOM-width-constraint structural verification (§9).

## 12. Performance

No new network calls of any kind. Confirmed by inspection: `compareNearest` is a pure, synchronous, client-side function operating on data already in memory; the only "external" action anywhere in this feature is the exact same one-time `navigator.geolocation.getCurrentPosition()` call Phase 4.2 already established, reused as-is. `/api/sessions` and the refresh/snapshot pipeline are completely untouched — no per-session geocoding, no routing API, no new external distance API. The added computational cost is the same order of magnitude as Phase 4.3B's own tie-break sort (a handful of extra comparisons on real ties, which Phase 4.3A measured to be common but cheap — the full-dataset Haversine baseline was ~12ms).

## 13. Privacy

No new privacy surface. `nearestMode`/`awaitingNearestLocation` are plain booleans — never coordinates, never written to `localStorage`, a cookie, a URL, Share text, or any server-side store. User coordinates themselves are exactly the same `userLocation.latitude/longitude` Phase 4.2 already acquires ephemerally and client-side only; Nearest reads them through the identical `distanceKmFor` function already used for display and Phase 4.3B's default tie-break — no new coordinate-transmission path, no IP geolocation, nothing persisted across a reload (confirmed: `nearestMode` is plain `useState`, resets to `false` on refresh, consistent with `userLocation`'s own already-established ephemeral design and Part 13's explicit "default must remain default" requirement).

## 14. Remaining Risks

- The tap target (54×28px) is a real, honest improvement but — consistent with the header pill's own precedent — still short of the 44px "ideal" comfort target; a larger fix would have meant a bigger visual footprint than the task's "minimal addition" instruction supported.
- Genuine narrow-viewport visual verification (an actually-resized browser window, not the DOM-constraint approximation) remains structurally unverified — the same `resize_window` tool limitation documented in every prior phase of this project.
- Physical mobile device testing was not performed and is not claimed.
- No real user-location or real Nearest-usage data exists yet — every distance figure and every "before/after" example in this document comes from mocked/simulated coordinates layered on real session data, since genuine granted-geolocation usage data doesn't exist for this feature yet (same caveat carried forward from Phase 4.3A/4.4).

---

## Closing Questions

**A. Is default ranking unchanged from Phase 4.3B?** Yes — `compareForRanking` and its call site are untouched; Nearest only ever activates an alternate comparator when `nearestActive` is explicitly true, and `nearestMode` always starts `false`.

**B. Does Nearest rank by distance only within the existing temporal group?** Yes — confirmed both structurally (group membership is decided independently of sort order, §3) and by script across every real scenario tested: group membership was identical between DEFAULT and NEAREST in 100% of cases; only intra-group order differed.

**C. Can Nearest ever promote a later temporal group above an earlier one?** No — this is structurally impossible, not merely avoided by convention: the comparator that produces Nearest's ordering has no visibility into or influence over which group a session belongs to; that's decided entirely separately, before ranking is ever applied to the group's own contents.

**D. What happens if location permission is denied?** Nearest stays off, the app remains in default ranking, no crash occurs, and the control's own accessible name honestly communicates the denial with a retry affordance — confirmed live.

**E. What happens to sessions without coordinates?** They're never hidden, never assigned a fake distance, and never treated as 0 km — they sort to the end of their real group under Nearest (or fall back to time/id ordering among themselves), confirmed present and functional in real test data.

**F. Does explicit municipality search still override passive location?** Yes — confirmed live: "pickleball markham" with a mocked Toronto location and Nearest active still returned only the 3 real Markham sessions, correctly reordered by distance within that scope.

**G. Does Nearest introduce any new network calls beyond existing browser geolocation?** No — confirmed by inspection; it reuses the exact same one-time `requestLocation()` call Phase 4.2 established, with no new geocoding, routing, or distance API of any kind.

**H. Is the control usable on mobile without materially degrading the current UI?** Yes, based on structural verification — it fits in the existing result-count row without wrapping or overflow even in the longest realistic case, using a small `flex`/`truncate` adjustment rather than a redesign; genuine physical-device confirmation remains outstanding and is reported as such, not claimed.

**I. Were all seven municipalities regression-tested?** Directly, in live browser scenarios: 5 (Toronto, Mississauga, Vaughan, Markham, Newmarket). All 7 were included in the real-data verification script's full canonical-snapshot sweep, and since no municipality-specific logic exists for this feature, that coverage is sufficient to conclude uniform behavior.

**J. Is Map View still deferred?** Yes — this phase implemented, but did not build, anything related to Map View; Phase 4.4's audit conclusion stands unchanged.

**K. Can Phase 4 now be considered functionally complete?** For the scope defined across Phases 4.0–4.4B — real geolocation, distance-aware default ranking, and an explicit, evidence-based, guardrailed proximity mode — yes. Map View remains a distinct, deliberately deferred, evidence-dependent future feature outside this scope.

---

Stopping here, as instructed. No Map View work has begun, and no further phase has started.
