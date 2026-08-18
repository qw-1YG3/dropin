# Phase 4.2 — Real Near Me & User Geolocation

Real `navigator.geolocation`, requested only by an explicit user tap, used to compute a display-only straight-line distance on top of Phase 4.1's facility coordinates. No ranking change, no drive time, no map, no geospatial database. Coordinates are never persisted, never sent to a third party, and never trigger a network request of their own — every distance is computed locally in the browser from data the app already has.

---

## 1. Previous Fake/Static Location Behavior

Confirmed by direct code inspection before writing anything: the header's location pill was a plain, non-interactive `<span>` (`app/page.tsx`, pre-Phase-4.2), with its own comment stating "display only... never typed into directly." It showed `effectiveLocation.label` (the resolved text-search location) or, with nothing resolved, the static string "Near you" — never real device coordinates. A repo-wide search for `navigator.geolocation` found zero matches anywhere in `app/` or `lib/` before this phase. `Session.distanceKm` existed as an optional field (`lib/dropin/types.ts`) and the "comfortable"-density Result Card already had one conditional render hook for it (`{s.centre}{s.distanceKm !== undefined && ...}`), but nothing ever populated it — Phase 4.1's own report confirmed this explicitly. `search-intent.ts` had no concept of "near me" at all; typing it produced a dead-end no-results query (traced through `parseQuery`'s real segmentation logic: neither "pickleball near me" as a whole nor any word-split of it resolved to an activity+location pair, so it fell through to the final `{ activities: [], location: undefined }` case).

## 2. Implemented Interaction Model

The header pill (`app/page.tsx`) is now a real `<button>`, not a `<span>`. Its visible text is unchanged in the default case ("Near you") and its position/icon are unchanged (`LocationIcon`, untouched per Part 18). The **only** new behavior: clicking it calls `requestLocation()`, which calls `navigator.geolocation.getCurrentPosition()` **once** — no `watchPosition`, no continuous tracking, no automatic call anywhere else in the codebase (confirmed: `requestLocation` is referenced in exactly one place, the button's `onClick`). Nothing requests location on mount, on search, on scroll, or on any other implicit trigger.

## 3. Permission Lifecycle

`UserLocationStatus = "idle" | "requesting" | "granted" | "denied" | "unavailable" | "timeout" | "unsupported"` — all seven states from the task are modeled explicitly, none collapsed into a generic error:

- **idle** — default, the only state before any click.
- **requesting** — set synchronously on click, before the async browser call resolves; the button is `disabled` during this state so a second tap can't fire a duplicate request.
- **granted** — real `latitude`/`longitude`/`accuracy`/`timestamp` from the browser, after passing a basic sanity check (see §13).
- **denied** — `PERMISSION_DENIED`.
- **unavailable** — `POSITION_UNAVAILABLE`, or a "successful" callback whose coordinates failed the sanity check.
- **timeout** — the request exceeded its own 10-second budget (`timeout: 10_000` in the `PositionOptions` passed to `getCurrentPosition`).
- **unsupported** — `navigator.geolocation` doesn't exist in this browser at all.

`enableHighAccuracy` is explicitly `false` — GPS-level precision is unnecessary for comparing distances to community centres at kilometre scale, and the low-accuracy (typically network/wifi-based) fix is faster and less battery-intensive. `maximumAge: 5 * 60 * 1000` allows the browser to return a position up to 5 minutes old if it has one cached — still a one-time read, not tracking, just avoiding an unnecessary fresh fix on every tap.

## 4. User-Location State Architecture

```ts
type UserLocation = {
  status: UserLocationStatus;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timestamp?: number;
};
```

Plain React `useState` inside a small local hook (`useUserLocation()`, `app/page.tsx`) — no context, no global store, no persistence layer. It survives re-renders, searches, and filter changes (ordinary React state lifetime), but is **not** written to `localStorage`/`sessionStorage`/cookies, so it does **not** survive a page reload (§14). This was a deliberate choice, not an oversight: the browser's own permission grant already persists across reloads at the platform level, so re-tapping after a reload typically resolves instantly without a new visible prompt — DropIn doesn't need to duplicate that persistence itself, and not doing so keeps the lowest-data footprint that still satisfies the feature (Part 5's own instruction).

## 5. Privacy Behavior

- **Where coordinates exist**: only in this one `useState` value, in browser memory, for the lifetime of the tab.
- **Transmitted anywhere?** No. `distanceKmFor()` (the Haversine call site) runs entirely client-side against `Session.latitude`/`longitude` values already present in the `/api/sessions` response the app already has in memory — no new request is made when location is granted, computed, or changes.
- **Stored anywhere?** No — not in `localStorage`, not in a cookie, not in the canonical snapshot pipeline (which this phase never touches), not in any analytics call (none exist in this codebase to begin with).
- **Survival**: only until the tab is closed or reloaded.
- **Third parties**: none. No reverse-geocoding call, no analytics SDK, no external distance API of any kind was added.

## 6. Coordinate Transmission/Storage Behavior

Explicitly audited: `requestLocation`'s success callback sets local state and nothing else. `distanceKmFor` reads that state and `session.latitude`/`longitude` (already client-side) and returns a number — no `fetch`, no `XMLHttpRequest`, no `navigator.sendBeacon` anywhere in the location/distance code path. Grep-confirmed zero network-call sites touching `userLocation`.

## 7. Distance Formula

Haversine great-circle distance (`lib/dropin/distance.ts`), matching Phase 4.0's own conclusion that this is sufficient for a first version at GTA scale. Pure function, zero dependencies, zero network calls:

```ts
haversineKm(lat1, lon1, lat2, lon2): number
```

Never presented as drive distance, walking distance, or travel time — the UI only ever renders `X km` (Part 21). No routing API (Google Distance Matrix/Routes, Mapbox routing) was called or considered necessary.

## 8. Rounding Rule

`formatDistanceKm()`:

- `< 10 km` → nearest 0.1 km (`Math.round(km * 10) / 10`) — e.g. a real 0.42 km facility renders "0.4 km," a real 8.97 km facility renders "9 km" (JavaScript's own number-to-string conversion drops a trailing `.0` — verified live: this is a deliberate, accepted choice, not a bug, since forcing "9.0 km" would imply more precision than "8.3 km" carries for no real benefit, and avoiding an unnecessary trailing zero is the more common convention already used elsewhere in this app, e.g. price is shown as "$6," not "$6.00").
- `>= 10 km` → nearest whole km (`Math.round(km)`) — e.g. "12 km," and confirmed live against a real outside-GTA test (a mocked Vancouver coordinate correctly rendered "3338 km"/"3350 km," matching real-world distance, no false precision, no crash).

## 9. Result Card Integration

Reused the exact existing hook, no new markup: at the two `SessionCard` render call sites (Discovery highlights, Results — both densities' underlying data, though see below), the session object handed to the card is enriched with `distanceKm` *only when a real value exists* (`distanceKmFor(s) !== undefined ? { ...s, distanceKm: distanceKmFor(s) } : s`) — the `SessionCard` component itself was **not modified**. `distanceKmFor` is a `useCallback` recomputed only when `userLocation` itself changes, and even then it's a per-call function, never a precomputed map over the full session list — it's invoked only for whatever's actually being rendered (Discovery's ~5 highlights, one page of Results), confirmed by design and by the performance measurement in §16.

**Scope decision, stated explicitly**: only the "comfortable"-density card (the one that already had the `distanceKm` render hook) shows distance. The "compact"-density card has no equivalent line in its markup and was left untouched — adding a new UI element there would have gone beyond "reuse the existing hook" into "add a new one," which Part 9 didn't ask for. Verified live: compact density correctly shows no distance; comfortable density shows it correctly in both Discovery and Results.

## 10. Explicit Search vs. Device-Location Precedence

`persistentLocation`/`locationOverride` (explicit text-search location, pre-existing) and `userLocation` (real device coordinates, new) are **completely separate state** — `userLocation` is never read by `sessionMatchesLocation` or any filtering logic, only by the distance-display computation. This makes the precedence rule true by construction, not by an added conditional: an explicit search always determines *which* sessions appear; `userLocation` only ever adds a number to sessions that were already going to be shown.

**Verified live**: searching "swimming markham" while `userLocation.status === "granted"` showed the header switch to "Markham" (explicit search wins the *display* too, via `locationPillLabel`'s own precedence check), results correctly restricted to real Markham facilities only, and distance still shown on every one of them (12 km/15 km/16 km) — geolocation added value without changing which results appeared, exactly Part 12's requirement.

## 11. Near-Me Query Behavior

`stripNearMeLanguage()` (`lib/dropin/search-intent.ts`) trims a literal trailing `near me`/`nearby`/`near you` phrase from the query text before it reaches `parseQuery` — not a new `DetectedLocation` variant, not reverse geocoding, not an NLP system. "pickleball near me" is treated identically to "pickleball": an activity-only search across every municipality. If `userLocation` happens to already be granted, those (now unfiltered) results naturally show distance; if not, they show without it, exactly as a plain "pickleball" search would. **Critically, this never touches geolocation permission** — text parsing and the permission request are fully decoupled, so typing "near me" can never trigger an unexpected browser prompt. Verified live: "pickleball near me" returned real cross-municipality results (Vaughan, Markham) with real distances shown, matching this design exactly.

One accepted, minor tradeoff, stated plainly: the query-miss message (when nothing matches) uses the *stripped* text, not the original — e.g. "xyz near me" would report "No results for 'xyz'," dropping "near me" from the echoed text. This only affects genuinely unmatched gibberish queries containing the phrase, judged not worth a second parallel string for the sake of one canonical `trimmed` value used consistently for both `parseQuery` and `committedQuery` (which a separate downstream `useMemo` independently re-parses — keeping exactly one string used everywhere avoids a real correctness risk of the two diverging).

## 12. Unresolved Facility Behavior

`distanceKmFor` returns `undefined` whenever `session.latitude`/`longitude` is missing (Phase 4.1's real ~3.9% gap) — the session object is passed through unmodified, the card renders exactly as it did before this phase (no distance line, no "unknown distance" placeholder, no "0 km," no removal). This is the same conditional the pre-existing `distanceKm !== undefined` check already guarded — confirmed by code review of a real unresolved facility (Mississauga's "Barondale Green Prk Play In The Park Hut," one of Phase 4.1's documented unresolved cases) and by the denied-permission test (§13), which exercises the identical "no distance value" render path for every card at once.

## 13. Failure-State Behavior

All explicitly tested, live, not just code-reviewed (mocking `navigator.geolocation.getCurrentPosition` where the real browser permission UI is inaccessible to automation — see §14's note on why):

| Case | Result |
|---|---|
| A. Granted (mocked real GTA coordinate) | Header → "Near me"; every card with a facility coordinate shows a correct, rounded distance |
| B. Denied (mocked `PERMISSION_DENIED`) | Header reverts to "Near you"; distances cleanly disappear from all cards; no crash; results unaffected |
| C. Unsupported (`navigator.geolocation` deleted) | Header stays "Near you"; distinct aria-label ("Location isn't available in this browser"); app fully usable |
| D. Timeout (real — waited the full 10s with the native prompt left unanswered) | Header transitions "Locating…" → "Near you" automatically after 10s; button re-enabled, retry available |
| E. Malformed coordinates (mocked `NaN` latitude, `200°` longitude) | Rejected by `isSaneCoordinate`; status → "unavailable"; no distance shown, no crash |
| F. Facility has no coordinates | See §12 |
| G. User outside the GTA (mocked real Vancouver coordinate) | Accepted as valid (no GTA-bounding applied to *user* coordinates, only ever to *facility* coordinates from Phase 4.1's geocoding); real, honest, large distances shown (3338–3350 km) |
| H. Explicit municipality search + active geolocation | See §10 |
| I. Repeated searches after geolocation granted | `userLocation` persists across searches (ordinary React state); distance continues to compute correctly on each new result set without re-requesting permission |
| J. Refresh/reload | `userLocation` resets to `idle` (not persisted, §4/§14); header returns to default "Near you"; no stale/broken state |

## 14. Mobile Results

- **Desktop verified**: full interactive pass on `localhost` — all states in §13, header layout, Decision Sheet, Directions, Share, Official listing/Register, filter controls.
- **LAN mobile verified** (`http://192.168.18.4:3000`, real network, real insecure-context browser behavior — not mocked): page load, search, activity chips, Decision Sheet, Directions, Share, Official listing all confirmed working with no regression from this phase's header change; `document.documentElement.scrollWidth === clientWidth` confirmed (no horizontal overflow) at the viewport genuinely available in this environment.
- **Responsive-viewport verified**: **not available this phase** — `mcp__claude-in-chrome__resize_window` was tested and confirmed non-functional again (reports success, `window.innerWidth` never actually changes), the same reproducible tool limitation documented in every prior phase of this project. No true narrow-viewport visual check was possible through that path.
- **Physical-device verified**: **not tested** — no physical iOS Safari or Android Chrome device was available in this environment. Not claimed.

Given the resize-window limitation, the location pill's own tap-target size and text-wrap safety were verified the same way the Decision Sheet secondary-button polish phase did: by directly constraining real DOM element widths via JavaScript rather than the (non-functional) window resize, which exercises real browser layout/font metrics rather than arithmetic estimation.

## 15. HTTPS / Secure-Context Findings

**Confirmed live, real (not mocked) test**: on the LAN HTTP origin, `window.isSecureContext` is `false` and `navigator.geolocation` still exists as an object (`hasGeolocation: true`), but calling `getCurrentPosition()` fails **immediately** with `PERMISSION_DENIED` — no native prompt is ever shown, the request resolves to the "denied" state within about a second. This is the exact same category of finding already documented for Web Share/Clipboard in Phase 3.6B's mobile investigation (`docs/MOBILE_PREVIEW_DIAGNOSTIC.md`): an **insecure-context browser restriction**, not a DropIn bug, and not something fixable via Next.js dev config. It will not reproduce on real HTTPS production. No workaround was added, per the explicit instruction not to introduce questionable production code to force a dev-only limitation to behave differently.

Smallest real production-equivalent test method: deploy to (or otherwise serve over) real HTTPS — `localhost` itself is already treated as a secure context by browsers, which is why every "granted/denied/timeout/malformed" test in §13 was performed against the `localhost` tab rather than the LAN tab.

## 16. Performance Measurements

- **Distance-calculation cost**: measured directly — computing Haversine distance for **all ~40,335 sessions that have coordinates** (every session in the dataset, a deliberately extreme worst case since real renders only ever compute it for currently-visible cards) took **~85ms**. Real per-render cost is a small fraction of this — `distanceKmFor` is only ever called for Discovery's ~5 highlights or one page of Results, not the full dataset.
- **Result rendering impact**: no observable change — `distanceKmFor` is a `useCallback` that only recomputes when `userLocation` itself changes (not on every keystroke/filter change), and the per-card enrichment is a cheap object spread.
- **Search performance**: unaffected — `stripNearMeLanguage` is a single regex replace on the query string, negligible next to the existing `parseQuery` segmentation work.
- **`/api/sessions` latency**: unaffected by this phase — the ~2.3s JSON parse time measured live is the pre-existing cost of the ~30MB response payload itself (unrelated to distance, unrelated to any change this phase made; no new field size was added since `distanceKm` is computed client-side, never serialized by the API).

No optimization was necessary; no geospatial database or index was introduced.

## 17. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npm run lint` on every touched file: 0 new errors — the same 10 pre-existing `react-hooks/refs`/`react-hooks/set-state-in-effect` errors already documented and out-of-scope since Phase 3.6B remain, unchanged, none overlapping any line touched this phase.
- `npm run build`: succeeds, all 10 routes compiled.
- `scripts/snapshot-health.ts`: all 7 municipalities (Toronto, Mississauga, Richmond Hill, Vaughan, Markham, Newmarket, Aurora) report FRESH — unaffected, since this phase never touches the refresh/snapshot pipeline.
- Live search regression: municipality search (Markham), activity search (swimming, pickleball), mixed search, "near me" stripping, activity chips, date filter (unaffected, not touched), attendance requirement / official CTA (unaffected, verified present and correct in the Decision Sheet), title normalization (unaffected, verified — "Adult Skate" style normalized titles still display correctly) — all confirmed live, no regression found.
- Decision Sheet, Directions, Share, Official listing/Register: all confirmed working, unchanged from the prior phase's polish.
- Result Cards: comfortable density shows distance correctly; compact density correctly does not (§9); card layout/height otherwise unchanged.

## 18. Remaining Risks

- True narrow-viewport visual verification (horizontal overflow at a *genuinely* narrow rendered width, tap-target spacing relative to neighbouring elements) remains unverified this phase, same root cause as every prior phase — the `resize_window` tool limitation. DOM-width-constraint checks (§14) are the strongest available substitute but are not identical to a real narrow browser window.
- Physical iOS Safari / Android Chrome were not tested — geolocation permission UX (the actual native prompt copy/flow, "always allow"/"only this time" options on iOS, etc.) can only be confirmed on a real device.
- The header pill's tap target (92×32px after this phase's small padding increase, up from 92×24px) is a real, deliberate, minimal improvement but still short of the 44px "comfortable" recommendation some accessibility guidance suggests — a further increase was judged to risk crossing into "redesigning the header," which was explicitly out of scope.
- The "Play In The Park Hut"/"4 Rinks"/"Seniors' Cntr" clusters flagged as unresolved in Phase 4.1 remain unresolved — they simply show no distance, honestly, same as any other missing optional field; no new resolution work was attempted this phase (out of scope).

## 19. Readiness for Phase 4.3

The data and computation Phase 4.3 (distance-aware ranking) needs already exist and are already verified correct: `distanceKmFor` produces a real, validated, correctly-rounded number for ~96% of sessions whenever `userLocation.status === "granted"`, with zero network cost and negligible compute cost even at full-dataset scale. What's missing for 4.3 specifically is only the *ranking* logic itself (grouping/sorting rules) and the explicit user-facing "Nearest" control Phase 4.0 recommended — this phase deliberately did not touch either, per its own stop condition.

---

## Concise Answers

**A. Does DropIn now use real browser geolocation?** Yes — `navigator.geolocation.getCurrentPosition()`, a real one-time request, confirmed working end-to-end (mocked success path exercising 100% of DropIn's own code) and confirmed correctly failing gracefully in every real tested failure mode.

**B. Does DropIn request location automatically on page load?** **No.** Verified directly: the app loads to the default "Near you" idle state every time, with zero calls to `requestLocation` anywhere except the header button's own `onClick`.

**C. What exact user action triggers the permission request?** A click/tap on the header location pill (now a real `<button>`, keyboard-accessible, `Enter`/`Space` also activate it via native HTML semantics).

**D. What happens if permission is denied?** DropIn remains fully usable: header reverts to "Near you," distances silently stop appearing on cards, search/filters/Directions/Decision Sheet are completely unaffected, no persistent warning banner, no repeated automatic re-prompting — a later manual tap is allowed to retry (the browser's own remembered-denial behavior prevents that retry from actually re-spamming a native prompt).

**E. Are precise user coordinates permanently stored?** **No.** In-memory React state only, lost on tab close/reload, never written to `localStorage`, a cookie, or the canonical snapshot pipeline.

**F. Are precise user coordinates sent to third parties?** **No.** No reverse-geocoding call, no analytics call, no external distance/routing API — confirmed by code inspection, zero network call sites reference `userLocation`.

**G. Does a user search trigger external geocoding?** **No.** Distance is computed entirely client-side from coordinates already present in the `/api/sessions` response; `stripNearMeLanguage` is a local text transform with no network involvement.

**H. What percentage of current sessions can display distance after location is available?** The same ~96.1% Phase 4.1 established (facility coordinate coverage) — every session with a resolved facility coordinate gets a real distance once `userLocation` is granted; the remaining ~3.9% simply show no distance, honestly.

**I. Does explicit search location override device-location filtering semantics?** **Yes.** Verified live: an explicit municipality search restricts results and wins the header display, while geolocation continues to add distance to whatever the explicit search already decided to show — it never re-scopes or re-filters anything.

**J. Has result ranking changed?** **No.** Grouping (Happening now/Starting soon/etc.) and within-group ordering are entirely untouched this phase — confirmed by code review (no sort/group logic was modified) and by live observation (identical group headers and card order with and without distance shown).

**K. Is the system ready for Phase 4.3 distance-aware ranking?** Yes — the distance values themselves are correct, fast, and available wherever a session has a resolved facility coordinate; 4.3's work is purely the ranking/sorting logic and its UI, not further data or computation prerequisites.

---

Stopping here, as instructed. Not implementing distance sorting, drive time, Map View, or a geospatial database.
