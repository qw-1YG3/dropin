# Phase 4.2 — Real "Near Me" & User Geolocation

DropIn's "Near you" header label is now backed by real, permission-gated `navigator.geolocation`, used to compute a display-only straight-line distance on top of Phase 4.1's facility coordinates. Location remains fully optional at every step; nothing about search, filtering, Directions, or the Decision Sheet depends on it. No ranking change, no Map View, no distance sorting — this phase is the foundation those later phases will build on.

---

## 1. Previous "Near You" Behavior (Audit)

Inspected directly, not assumed from Phase 4.0's older findings:

- **Header location label** — before this phase, the pill was a plain, non-interactive `<span>` showing either the resolved text-search location or the static string "Near you." A repo-wide search for `navigator.geolocation` found zero matches anywhere in `app/` or `lib/`.
- **Search-intent location parsing** (`lib/dropin/search-intent.ts`) — already real and unrelated to geolocation: `parseQuery()` resolves postal codes, community centre names, neighbourhoods, and municipalities from the query text itself. This was untouched by this phase and remains the sole driver of which sessions are shown.
- **`Session.distanceKm`** — an existing optional field with one pre-existing conditional render hook in the comfortable-density Result Card (`{s.distanceKm !== undefined && \` · ${s.distanceKm} km\`}`), but nothing populated it. Confirmed by Phase 4.0/4.1's own reports and re-confirmed here by inspection.
- **Directions** (`directionsUrl()`) — already real: builds a Google Maps link from the session's own **facility** coordinates when available, else falls back to an address/centre/municipality text query. This function never touches user location, before or after this phase.
- **Facility coordinates** — Phase 4.1 already populated `Session.latitude`/`longitude` for ~96% of sessions via build-time geocoding, served through the existing `/api/sessions` snapshot pipeline.
- **Mobile behavior** — no location-specific mobile code existed at all prior to this phase, since there was no real geolocation to test.

Conclusion: the audit confirmed Phase 4.0's finding still holds — "Near you" was placeholder copy, not real geolocation — and nothing else in the location-adjacent surface area (search, distance, Directions, facility coordinates) needed to change to support adding real geolocation on top.

## 2. New Geolocation Architecture

`app/page.tsx` gained a small, self-contained `useUserLocation()` hook:

```ts
export type UserLocationStatus =
  | "idle" | "requesting" | "granted" | "denied" | "unavailable" | "timeout" | "unsupported";

export type UserLocation = {
  status: UserLocationStatus;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timestamp?: number;
};

function useUserLocation() {
  const [userLocation, setUserLocation] = useState<UserLocation>({ status: "idle" });
  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setUserLocation({ status: "unsupported" });
      return;
    }
    setUserLocation({ status: "requesting" });
    navigator.geolocation.getCurrentPosition(
      (position) => { /* validate + setUserLocation({ status: "granted", ... }) */ },
      (error) => { /* map PERMISSION_DENIED / TIMEOUT / other -> denied / timeout / unavailable */ },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);
  return { userLocation, requestLocation };
}
```

Key choices, each directly answering a Part 2 requirement:

- **One-time `getCurrentPosition`, never `watchPosition`** — DropIn only ever needs "how far is this facility right now," not continuous tracking. No location history is kept; each call replaces the previous state entirely.
- **`enableHighAccuracy: false`** — GPS-level (metre) precision is unnecessary for comparing distances to community centres at kilometre scale; coarse network/wifi-based positioning is faster and less battery-intensive, and is what the task explicitly asked to prefer.
- **`maximumAge: 5 minutes`** — allows the browser to return a recently cached fix rather than forcing a fresh read on every tap; still a one-shot request, not tracking.
- **`timeout: 10s`** — bounded wait; if the browser can't resolve a position in time, DropIn falls back gracefully (§7) rather than hanging indefinitely.
- **No database, no analytics.** Confirmed by inspection: `setUserLocation` is the only place this data is ever written, and it's a plain in-memory `useState`.

## 3. Permission Behavior

**No automatic request on page load.** Verified live: `navigator.permissions.query({name:'geolocation'})` reports `"prompt"` (unanswered) immediately after a fresh page load — nothing calls `requestLocation()` except the header pill's own `onClick`. `requestLocation` is referenced in exactly one place in the entire file.

**The trigger is the existing header affordance** — the location pill (icon + "Near you"/"Near me" text) was converted from a decorative `<span>` to a real `<button>`. No new UI element, no onboarding flow, no modal, no tutorial screen was introduced — exactly the "reuse the existing affordance" direction in Part 3. The button's accessible name doubles as the lightweight explanation of *why* location is being requested:

```ts
function locationPillAriaLabel(userLocation: UserLocation): string {
  if (userLocation.status === "requesting") return "Getting your location";
  if (userLocation.status === "granted") return "Using your location for distance — tap to refresh";
  if (userLocation.status === "denied") return "Location access denied — tap to try again";
  if (userLocation.status === "unsupported") return "Location isn't available in this browser";
  return "Use your location to see distance to activities";
}
```

That last line — "Use your location to see distance to activities" — is the entire contextual explanation; no separate copy block, banner, or dialog was added.

## 4. Privacy Model

- **Never written to canonical snapshots, source data, or any database.** Confirmed by inspection: no source adapter, snapshot writer, or refresh script references `userLocation`; the entire feature lives in one client-side React hook.
- **Never persisted client-side either.** Confirmed by inspection: the only `localStorage` usage anywhere in `app/page.tsx` is an unrelated Result Card density preference (`dropin-results-density`); `userLocation` is plain in-memory state that resets to `idle` on reload (verified live).
- **Never sent over the network.** `distanceKmFor()` (§6) runs entirely client-side against `Session.latitude`/`longitude` already present in the already-fetched `/api/sessions` payload — granting location triggers zero new network requests.
- **Never logged.** No `console.log`/analytics call anywhere touches `userLocation`.
- **Never in a URL.** Confirmed by inspection: this app performs no client-side routing or query-string manipulation at all (no `router.push`, no `URLSearchParams`, no `window.location` writes) — there is no mechanism by which coordinates could end up in a URL.
- **Never in Share text.** Confirmed by inspection of `handleShare()`: the shared summary is built from `displayActivityName(s)`, `s.centre`, `timeLabel(...)`, and `s.officialUrl` only — no coordinate of any kind, user or facility, appears in Share text or the native Share Sheet payload.

## 5. Location State Model

Seven explicit states, matching Part 4's minimum plus the two additional real browser outcomes DropIn distinguishes for accurate, calm messaging:

| State | Meaning | User-facing text |
|---|---|---|
| `idle` | Not requested yet (default) | "Near you" |
| `requesting` | Request in flight | "Locating…" |
| `granted` | Real coordinates available | "Near me" |
| `denied` | User declined permission | "Near you" (reverts silently) |
| `unavailable` | Position genuinely couldn't be determined | "Near you" |
| `timeout` | Request exceeded 10s | "Near you" |
| `unsupported` | `navigator.geolocation` doesn't exist | "Near you" |

No technical terminology is ever shown to the user — no error codes, no "PERMISSION_DENIED," no stack traces. Every non-`granted`/`requesting` state reads identically as the calm, pre-existing "Near you" default; they differ only in the button's `aria-label`, which explains what happened without alarming language, and in whether a retry is invited ("tap to try again" for `denied`). Denied permission is never treated as an application error — no error boundary, no red banner, no toast; the app simply continues exactly as it did before location was ever requested.

**Municipality resolution from coordinates was deliberately not implemented** (Part 5) — reverse-geocoding a lat/lng into a municipality name reliably would require new network infrastructure (a geocoding API call) this phase's own scope explicitly excludes ("no per-session external geocoding requests," Part 13). Rather than guess at a municipality from coordinates with a brittle heuristic (e.g. hardcoded bounding boxes per municipality), the honest, truthful label "Near me" is used once geolocation succeeds — accurate to what DropIn actually knows, and clearly distinct from an explicit search like "Mississauga." If reliable municipality resolution becomes worth building, it belongs in its own phase with its own evidence, not bolted on here.

## 6. Distance Calculation

Reused Phase 4.1's existing `lib/dropin/distance.ts` (Haversine great-circle distance, already built and documented in that phase) via a new memoized callback:

```ts
const distanceKmFor = useCallback(
  (s: Session): number | undefined => {
    if (userLocation.status !== "granted" || userLocation.latitude === undefined || userLocation.longitude === undefined) return undefined;
    if (s.latitude === undefined || s.longitude === undefined) return undefined;
    return formatDistanceKm(haversineKm(userLocation.latitude, userLocation.longitude, s.latitude, s.longitude));
  },
  [userLocation.status, userLocation.latitude, userLocation.longitude],
);
```

Called only for sessions actually being rendered (Discovery's highlights, one page of Results) — never precomputed across the full dataset. Rounding rule (established in Phase 4.1, unchanged here): under 10 km shows one decimal (e.g. "2 km," "0.4 km"); 10 km and over rounds to the nearest whole km — avoiding false precision on a straight-line estimate. This is **distance foundation only**: nothing in this phase reorders, sorts, groups, or filters by `distanceKm` — confirmed by code review (no sort/group logic references it) and live observation (identical "Happening now"/time-group ordering with and without a granted location).

## 7. Missing-Coordinate Behavior

`distanceKmFor` returns `undefined` whenever the session has no facility coordinates (Phase 4.1's real, documented ~3.9% gap) — the session renders exactly as it did before this phase: fully visible, fully searchable, Decision Sheet opens normally, Directions falls back to its existing address-text search. Verified live against a real unresolved case (Mississauga's "Let's Play In The Park" at "Barondale Green Prk Play In The Park Hut," `latitude`/`longitude` both `undefined`): the session appeared normally in search results with no distance line, no "unknown distance" placeholder, no "0 km," and its Decision Sheet's Directions/Official listing/Share buttons all worked normally.

## 8. Explicit-Search-vs-Device-Location Precedence

`userLocation` (device geolocation) and `persistentLocation`/`locationOverride`/`effectiveLocation` (explicit text-search location) are **architecturally separate state** — `userLocation` is never read by `sessionMatchesLocation` or any filtering/search logic, only by the distance-display computation in §6. This makes "explicit query overrides device location" true by construction rather than by a conditional that could have edge-case bugs.

**Verified live**: with geolocation granted and mocked to a downtown Toronto coordinate, searching **"swimming markham"** correctly:
- Switched the header label to "Markham" (an explicit search always wins the header display too, via `locationPillLabel`'s own precedence check — explicit location beats both "Near me" and "Near you"),
- Returned all 46 real Markham swimming sessions, not Toronto ones,
- **Still computed and displayed real distance** on those Markham cards ("22 km" from the mocked Toronto point to a real Markham facility) — proving geolocation adds value without ever narrowing or redirecting the search scope.

## 9. Desktop QA

All performed live against the running app on `localhost:3000` (a secure context):

| Scenario | Result |
|---|---|
| A. Granted (mocked, since the native OS permission dialog isn't automatable — see §11) | Header → "Near me"; Result Cards show real, correctly rounded distances |
| B. Denied (mocked) | Header reverts to "Near you"; distance cleanly disappears from cards; no crash; results/search/filters fully unaffected; retry available |
| C. Timeout | Code path verified structurally (10s `timeout` option + `error.code === error.TIMEOUT` → `"timeout"` state, same as `"unavailable"`'s calm fallback); not re-triggered live this pass since it was already directly observed (a real, unmocked 10-second wait) in this feature's original implementation |
| D. Unsupported (`navigator.geolocation` set to `undefined` via `Object.defineProperty`, since a bare `delete` silently fails on this non-configurable property) | Header stays "Near you"; distinct aria-label ("Location isn't available in this browser"); app fully usable |
| E. Location granted + facility coordinates available | Real distance shown on Result Card (verified: "2 km," "22 km" on real sessions) |
| F. Location granted + facility coordinates missing | No distance shown, session fully visible/searchable/functional (§7) |
| G. Explicit municipality search while device location points elsewhere | Search stays fully scoped to the explicit municipality; distance still computed on those results (§8) |
| H. Search without location permission | Works identically to before this phase — location was never a prerequisite for any search |
| I. Decision Sheet + Directions after geolocation | Both open and work normally; Directions link unaffected (confirmed via code inspection — `directionsUrl()` never reads `userLocation`); the Decision Sheet does not surface distance at all (unchanged, pre-existing minimal design — distance is Result-Card-only, per Part 11) |

No console errors traced back to DropIn's own code during any of this; the only console entries observed were unrelated browser-extension noise (a Grammarly hydration-attribute mismatch and an unrelated extension-messaging warning), confirmed by inspecting the actual message content.

## 10. Mobile QA

- **LAN-real (unmocked) verified**: page loads correctly over `http://192.168.18.4:3000`, defaults to idle "Near you," and clicking the location pill produces a real (not simulated) `PERMISSION_DENIED` failure within ~1–2 seconds — see §11 for why, and confirmation this is expected, not a bug.
- **Structurally verified at mobile width**: `resize_window` was tested again this phase and is still non-functional (reports success, but `window.innerWidth` never actually changes — confirmed: requested 390×844, real width stayed 1430px). Compensated with the same DOM-width-constraint injection technique used in earlier phases of this project: constraining `body`'s rendered width to 390px and re-measuring `document.body.scrollWidth` vs `clientWidth` (388px vs 388px, no overflow) confirms the search box, date strip, header (which wraps the location label onto a second line rather than clipping or overflowing), and Result Card all lay out cleanly with no horizontal scroll at that width. This is DOM-constraint verification, not a genuine narrow browser viewport.
- **Physical-device verified**: **not tested.** No physical iOS Safari or Android Chrome device was available in this environment. Not claimed.

## 11. Secure-Context Limitations

**Confirmed live, real (not mocked)**: on the LAN HTTP origin, `window.isSecureContext` is `false` while `'geolocation' in navigator` is still `true` — the API exists, but a real (unmocked) call to `getCurrentPosition()` fails **immediately** with `PERMISSION_DENIED`, with no native OS/browser prompt ever shown, resolving to the "denied" state within roughly a second. This is the identical category of finding already documented for Web Share/Clipboard in this project's earlier mobile diagnostic — an **insecure-context browser restriction**, not a DropIn defect, and not reproducible on real HTTPS production (where `getCurrentPosition` behaves normally). `localhost` is treated as a secure context by browsers regardless of protocol, which is why every granted/denied/unsupported test in §9 was run against the `localhost` tab.

The native OS-level permission dialog itself (the real "Allow/Block" prompt a genuine human click would trigger) is not interactable by the available browser-automation tooling — confirmed via `navigator.permissions.query` reporting a stuck `"prompt"` state with no way to answer it programmatically, and via the tool rejecting navigation to `chrome://settings/...` to pre-grant permission. This is why the granted/denied/unsupported states in §9 were exercised by directly overriding `navigator.geolocation.getCurrentPosition`/`Object.defineProperty(navigator, 'geolocation', ...)` — a substitution of the OS permission hardware only, which still exercises 100% of DropIn's own success/error-handling code.

## 12. Files Changed

- **`app/page.tsx`** — added `UserLocationStatus`/`UserLocation` types, `isSaneCoordinate()`, `useUserLocation()`, `locationPillLabel()`/`locationPillAriaLabel()`, the `distanceKmFor` callback, and converted the header's decorative `<span>` into a real `<button>` wired to `requestLocation`. Both `SessionCard` render call sites now pass `distanceKmFor(s)`-enriched sessions.
- **`lib/dropin/distance.ts`** — pre-existing from Phase 4.1 (Haversine + rounding); not modified this phase, only consumed.
- **`lib/dropin/search-intent.ts`** — pre-existing `stripNearMeLanguage()` (added alongside this feature's original implementation) continues to degrade "near me"/"nearby"/"near you" queries to a plain activity-only search rather than a dead end; not modified this pass.

No source adapter, canonical snapshot, the `Session` type's shape, activity taxonomy/naming, age normalization, attendance/registration semantics, the snapshot/scheduler architecture, or Result Card/Decision Sheet visual design was touched, per Part 15.

## 13. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npm run build`: succeeds, all 10 routes compiled.
- `npx eslint app/page.tsx lib/dropin/distance.ts lib/dropin/search-intent.ts`: the same 10 pre-existing, out-of-scope `react-hooks/refs` errors already documented from earlier phases (unrelated scroll-fade-indicator code) — zero new errors.
- Search regressions (live): "swimming markham" scoped correctly with distance shown (§8); an unresolved-facility session ("Barondale") remained fully searchable/functional with no distance (§7); a granted-location "pickleball" search correctly showed distance only on sessions with real facility coordinates.
- Performance (Part 13, fresh measurement against the current full canonical dataset — 46,367 sessions across all 7 municipalities, 44,560 of them with coordinates, 96.1% coverage, consistent with Phase 4.1's own figure): computing Haversine distance for **every session with coordinates in the entire dataset** took **12ms** — negligible, and a deliberately extreme worst case since real renders only ever touch the currently-visible card subset. No change to `/api/sessions` latency or the refresh pipeline — user location is purely a client-side layer on top of the existing snapshot architecture, confirmed by inspection (no refresh script references `userLocation`).

## 14. Remaining Risks

- Genuine narrow-viewport layout (a truly resized browser window, not a DOM-width-constraint approximation) remains unverified this phase — same root cause as every prior phase in this project, the `resize_window` tool limitation.
- Physical iOS Safari/Android Chrome geolocation UX (the real native permission prompt's exact copy and flow) was not verified — only structurally exercised via mocking.
- Municipality-name resolution from coordinates remains unimplemented by design (§5) — "Near me" is the honest, current ceiling; a future phase could revisit this with dedicated reverse-geocoding infrastructure if the product need justifies the added complexity.
- The ~3.9% of sessions without facility coordinates (Phase 4.1's known gap) still cannot show distance — unchanged, expected, and handled gracefully (§7).

---

## Closing Questions

**A. Is "Near Me" now based on real browser location?** Yes — `navigator.geolocation.getCurrentPosition()` is real and wired end-to-end. The success and error-handling code paths were verified by directly exercising DropIn's own logic (via a controlled override of the browser API, since the native OS permission dialog itself is not automatable in this environment); the real, unmocked insecure-context failure and the real 10-second timeout were both observed without any mocking.

**B. Is location completely optional?** Yes. Nothing on page load, in search, in filtering, in the Decision Sheet, or in Directions requires it. Verified live: every one of those surfaces works identically whether location is `idle`, `denied`, `unsupported`, or `granted`.

**C. What happens when permission is denied?** DropIn degrades gracefully: the header reverts to "Near you," any previously-shown distances disappear cleanly from cards, no error banner or crash occurs, and the same affordance remains available for the user to try again later — denial is never treated as an application error.

**D. Are precise user coordinates stored anywhere?** No. In-memory React state only (`useUserLocation`'s own `useState`), never written to `localStorage`, a cookie, a URL, canonical snapshots, or any server-side store — confirmed by inspection across all of those surfaces.

**E. Can sessions with facility coordinates now calculate distance from the user?** Yes, for the ~96% of sessions with resolved facility coordinates, once the user has granted location — verified live with real, correctly rounded values ("2 km," "22 km").

**F. Does explicit municipality search override device location?** Yes — verified live: an explicit search like "swimming markham" stays fully scoped to Markham even with device location mocked to a Toronto coordinate; distance is still computed on the (unchanged) result set.

**G. Was real physical-device mobile geolocation verified, or only structurally tested?** Only structurally tested. Desktop `localhost` behavior (granted/denied/unsupported, all via controlled mocking of the browser API) and the real LAN insecure-context failure were both genuinely observed; mobile-width layout was verified via DOM-width-constraint injection, not a real narrow window; no physical mobile device was available in this environment, so real physical-device geolocation permission UX was not tested and is not claimed to have been.

**H. Is the system ready for Phase 4.3 — Distance-Aware Ranking?** Yes, on the data side — `distanceKmFor` produces correct, fast, validated distance values for the large majority of sessions whenever location is granted, entirely decoupled from filtering/search. Phase 4.3's remaining work is purely the ranking/sorting logic itself and any accompanying UI control, not further data or computation prerequisites.

---

Stopping here, as instructed. Not implementing Map View, distance-based ranking, or any redesign of the existing UI.
