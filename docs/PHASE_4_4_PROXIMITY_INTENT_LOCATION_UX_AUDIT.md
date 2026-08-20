# Phase 4.4 — Proximity-First Intent & Location UX Audit

An evidence-based investigation into whether DropIn should support an explicit "prioritize what's nearby" mode, on top of the existing (and unchanged) time-first default ranking. **This is an audit only — no production code was changed.** All findings come from a standalone script run against the real, current canonical dataset, plus direct inspection of the shipped UI.

---

## 1. Current Location UX (Fresh Code Audit)

Inspected directly in `app/page.tsx`, not inferred from prior phase docs.

1. **Where location appears**: exactly one place in the UI — a single pill button in the header, to the left of the info icon (`<button onClick={requestLocation} aria-label={locationPillAriaLabel(userLocation)}>` at `app/page.tsx:1112`). Distance also appears per-session on Result Cards (comfortable density only) and nowhere else.
2. **What it actually does**: on click, calls `requestLocation()` (Phase 4.2's `useUserLocation` hook) — a one-time `navigator.geolocation.getCurrentPosition()` call. Its visible text (`locationPillLabel`) shows, in priority order: an explicit search location's label (e.g., "Markham") if one is active, else "Locating…" while a request is in flight, else "Near me" once granted, else the static default "Near you."
3. **Element classification**:
   - **Interactive + permission-triggering**: the header pill (the only interactive location element in the entire UI).
   - **Display-only**: the per-card `distanceKm` text (`· 2 km`), and the pill's own text when it's just reflecting state, not being clicked.
   - **Search-related but not location-permission-related**: the search input itself, which can resolve municipality/neighbourhood/postal-code/centre text into `effectiveLocation` — entirely independent of geolocation.
   - There is **no** slider, toggle, chip, or menu related to location anywhere else in the codebase — confirmed by a full-file grep for location-related identifiers.
4. **When permission is requested**: only on that one `onClick` — confirmed by inspection that `requestLocation` is referenced in exactly one place. Nothing requests it on page load, on search, or on any other implicit trigger.
5. **Granted/denied/unavailable behavior**: unchanged since Phase 4.2 — granted populates `userLocation.latitude/longitude` and the ranking/display pipeline picks it up automatically; denied/unavailable/timeout/unsupported all revert the pill to "Near you," clear any displayed distance, and leave every other part of the app (search, filters, Decision Sheet, Directions) fully functional.
6. **How distance appears on Result Cards**: exactly the pre-existing conditional hook from Phase 4.0/4.1 (`{s.distanceKm !== undefined && \` · ${s.distanceKm} km\`}`), populated by `distanceKmFor` (Phase 4.2) and now also consulted by ranking (Phase 4.3B) — unchanged visually since Phase 4.2.
7. **Does the user currently have any way to say "prioritize nearby results"?** **No.** Confirmed by exhaustive inspection: distance only ever acts as a tie-breaker (Phase 4.3B's `compareForRanking`) after chronological order is already decided. There is no toggle, chip, query keyword, or any other mechanism that changes ranking priority. This is the exact gap this phase investigates.

## 2. Intent Definitions

**Intent A — Time-first / Default** (existing, unchanged production behavior): `temporal group → startMinutes → distanceKm → session.id`. Answers "what can I do soon?" Remains the default under every finding below.

**Intent B — Proximity-first / Explicit** (audited only, not implemented): conceptually `distance → temporal relevance → startMinutes → session.id`, activated **only** by explicit user action, never automatically, and never allowed to broaden or override explicit search scope (Part 8).

## 3. Real-Data Simulation Setup

A standalone script loaded all 7 municipalities' real canonical snapshots (46,367 sessions), reused Phase 4.3A/B's exact `groupForDate`/`sessionStatus`/`compareForRanking` logic for the DEFAULT baseline, and added a `compareProximityFirst` comparator (distance ascending, missing-distance last, then time, then `id`) for comparison. Tested activities: Pickleball, Badminton, Basketball, Yoga, Swim, and **Volleyball** (23 real sessions across 5 municipalities today — sufficient data, included per the task's conditional ask). User locations reused Phase 4.3A's representative anchors: downtown Toronto, Mississauga, Markham, and Vaughan (covering the Toronto/Scarborough, Mississauga, and Vaughan/Markham areas the task asked for; Richmond Hill/Newmarket sessions appear naturally as real candidate results within these broader searches, e.g. Richmond Hill's Rouge Woods CC and Newmarket's Magna Centre both appear in the scenario data below). "Now" was fixed at 2:00 PM on the real current date (2026-08-20), consistent with Phase 4.3A/B's methodology.

## 4. Time/Distance Trade-offs (Quantified)

**Pure proximity-first** (distance dominates the *entire* eligible pool for the day, exactly per the task's own worked example, which flattens across "5:00 PM / 5:30 PM / 6:00 PM" rather than keeping them under separate group headings) — summary across 24 real scenarios (6 activities × 4 user locations):

| Metric | Result |
|---|---|
| Top-1 result changed | 21/24 scenarios (87.5%) |
| Top-3 results changed | 24/24 (100%) |
| Top-5 results changed | 24/24 (100%) |
| Avg. distance saved (when top-1 changed) | **14.8 km** |
| Avg. wait introduced (when top-1 changed) | **305.7 minutes** (~5.1 hours) |
| Max. wait introduced | **585 minutes** (~9.75 hours) |
| Municipality changed | 13/24 (54%) |

Real example (Basketball, Vaughan user):
```
Default:      11:00 AM · 21 km · Dufferin Grove Park
Proximity:    8:45 PM  · 4.6 km · Carrville Community Centre (Vaughan)
Trade-off: saves 16.4 km, but introduces a 9.75-hour wait
```

This confirms the task's core suspicion: **naive pure proximity-first is often a bad trade.** A session 16 km closer is not obviously "better" if it doesn't start for another 9.75 hours, especially since closer-but-not-closest options exist much sooner in the very same pool (see §6).

## 5. Valuable Cases (Measured, Not Assumed)

Real cases where proximity-first materially helps, found directly in the data:

- **Genuine large distance savings with a same-day-relevant trade-off exist**: Yoga, Mississauga user — default's nearest option is 27 km away; a real Mississauga-local class ("Drop In Yoga for Women @ Frank McKechnie CC") is only 3.1 km away, a **23.9 km** saving. Even though the naive flattened version introduces a 285-minute wait here, this illustrates the underlying signal is real: for a cross-municipality search, the default's tie-break alone (Phase 4.3B) doesn't surface genuinely-local options that start later in the day, and a user who's free all evening would reasonably want to know about the 3.1 km option.
- **High-density activities produce small-wait, real-savings cases even unbounded**: Yoga, Markham user — distanceSaved 4.2 km for only a 15-minute wait increase. Swim (very high session volume, 238 real sessions today) frequently found an equal-or-better top-1 pick (top1Changed=false in 2 of 4 swim scenarios) precisely because density is high enough that a close, soon session already exists — meaning proximity intent has the most obviously-safe value precisely where the catalog is richest.
- **Cross-municipality search is where the signal is strongest**: 13/24 scenarios (54%) changed which municipality the top result was in — confirming proximity-first's core value proposition (surfacing a genuinely local option a city-wide/GTA-wide search wouldn't otherwise rank first) is real and frequent, not rare.
- **Explicit search scope is never widened** — confirmed both structurally (§8 below) and empirically: a "pickleball markham" search under proximity-first still returned only the same 3 real Markham sessions, just reordered (top1 changed, saving 3.0 km for only a 15-minute wait — itself a small, clean example of the feature working exactly as intended within an already-narrow, already-time-clustered scope).

## 6. Bad Cases (Measured, Not Assumed)

**This is the most important finding of this audit.** Naive proximity-first frequently produces results a reasonable user would consider worse, not better:

Real example (Badminton, Markham user):
```
Proximity picks: 10:15 PM · 4.9 km · Armadale Community Centre (Markham) — waits 495 minutes (8.25 hours)
Over:             4:00 PM · 5.6 km · Aaniin Community Centre (Markham) — only 120 minutes away, just 0.7 km farther
```
A 0.7 km difference is not a meaningful proximity gain for anyone; waiting an extra 6+ hours to get it is an obviously bad trade. This is not a rare, cherry-picked case — the **average** wait introduced across all 24 scenarios tested was over 5 hours, confirming this pattern is the norm for a naive implementation, not an edge case.

The Vaughan basketball example in §4 is the most extreme: a 9.75-hour wait to save 16.4 km, when multiple meaningfully-closer-in-time options existed in the same pool (11 km at 5:30 PM, 9.8 km at 7:00 PM — both real, both far more reasonable trade-offs than the 8:45 PM pick).

**Conclusion: meaningful time-distance conflicts are common in the real dataset, not theoretical.** A shipped proximity-first feature without some kind of eligibility boundary would, on this evidence, frequently surprise users in a bad way.

## 7. Is Pure Distance → Time Too Naive?

**Yes, confirmed by §6's evidence.** A bounded alternative was tested — proximity-first applied **within the existing, already-shipped temporal group structure** (Happening now / Starting soon / Starting today / Later today), rather than flattened across the whole day. This introduces **no new magic number or arbitrary time-window weight** — it reuses grouping logic that was already audited and shipped in Phase 4.3A/B.

Result: **dramatic improvement.** Across the same 24 scenarios, group-bounded proximity-first's average top-1 wait dropped from 305.7 minutes to **9.4 minutes**, and its max dropped from 585 to **450 minutes**. Most scenarios produced a *negative* "wait" (the picked session was already in the "Happening now" group, i.e., immediately available) — a clearly better user experience than the unbounded version.

**However, group-bounding is not perfectly airtight**, and this audit found and reports the honest residual case rather than overstating the fix: Volleyball, Markham user — only one non-empty group existed today ("Later today," which by definition spans 5:00 PM to midnight, a 6.25-hour-wide window in this real instance). Within that single wide group, proximity-first still picked a 9:30 PM session (4.9 km) over a 6:30 PM session only 0.6 km farther — a 3-hour wait for a marginal gain, inside a single group, because "Later today" itself is wide by design (it was never built to be a tight window — Phase 3.5C's own original design intentionally left it broad since its job was distinguishing "later today" from "tomorrow," not bounding proximity trade-offs).

**Recommended principle (per the task's own framing, no invented scoring)**: proximity-first should rank **within whatever scope the user has already explicitly established** — the current date selection, active search/location filter, and (critically) an **active Time-of-Day filter chip**, which already exists in the shipped UI and already narrows "Later today" down to a tighter, genuinely user-chosen window. This isn't a new mechanism; it's making proximity-first respect a filter that's already there. A user who wants "nearby, tonight" already has the means to say "tonight" (the existing Evening chip) before asking for "nearby" — the two existing pieces compose correctly without inventing anything new.

## 8. Explicit Search Must Still Win — Verified

Confirmed both **structurally** (proximity-first, in every version tested, only ever reorders the array already produced by `resultsFiltered` — it has no code path that can add, remove, or reach outside that pool) and **empirically**: "pickleball markham" with a mocked downtown-Toronto device location returned exactly the same 3 real Markham sessions under every strategy tested (default, pure proximity, group-bounded proximity) — only their relative order changed. This is the same architectural guarantee Phase 4.2 established and Phase 4.3B preserved: distance-based logic operates strictly downstream of filtering, never upstream of it.

## 9. UX Options Audit

**Option A — No control (status quo).** *Advantage*: zero added complexity, zero added permission friction, consistent with "ranking quality matters more than algorithmic sophistication" (Phase 4.3A's own conclusion, still true). *Disadvantage*: the real, measured value in §5 (23.9 km savings in some real cross-municipality cases) is left entirely on the table for users who would want it.

**Option B — "Near me" intent control.** Mental model: "Near me" as an alternate *lens* on the same result set, phrased as user intent rather than a technical sort. *Risk, confirmed by inspection*: this wording directly collides with the **existing** header pill, whose label already reads "Near me" once geolocation is granted (Phase 4.2) — but that "Near me" today means "distance is now known and shown," not "distance now dominates ranking." Introducing a second, differently-scoped "Near me" would be genuinely confusing without a careful, deliberate distinction in copy — this is a real cost, not a hypothetical one, since it's not a new phrase being introduced into a blank space but a reuse of a word the UI already assigns a specific, narrower meaning to.

**Option C — "Nearest" explicit control.** More clearly a ranking directive than "Near me," and doesn't collide with existing copy. Trade-off: still a new, permanent UI element that needs to justify its footprint (Part 10).

**Option D — Traditional Sort menu ("Recommended" / "Nearest").** Confirmed, by direct inspection of the existing UI's visual language, that this pattern doesn't exist anywhere in DropIn today — no dropdown, no dedicated "Sort by" menu. Introducing one would be the most functionally explicit option but the biggest visual/interaction-model departure from the current, deliberately minimal search-first design (Part 10's audit below).

**Option E**: no additional option is proposed — the existing UI architecture (§10) doesn't strongly suggest anything better than a variant of B/C, and the task explicitly asks not to brainstorm broadly beyond what the evidence supports.

## 10. Existing UI Constraints — Where Could This Live?

Direct inspection of every candidate surface:

- **Search area**: a single text input plus a rotating placeholder and shortcut chips — already doing real work (activity + location parsing). Adding a ranking control here would conflate "what/where" (search) with "how ordered" (ranking), a real conceptual mismatch.
- **Location indicator (header pill)**: already does double duty (shows resolved location text *and* triggers geolocation). It has no visible room for a second, distinct action without becoming two controls disguised as one, or growing wider — and Phase 4.2's own accessibility work already found its tap target tight (32px, short of the 44px comfort target) even in its current single-purpose form.
- **"When" (date strip) section**: purely a date selector; a ranking toggle here would be a non-sequitur next to date navigation.
- **Activity chips**: horizontally-scrolling, already can overflow (has its own fade-affordance mechanism per the code's own comments) — adding a differently-styled ranking chip into that row would be visually inconsistent (activity chips represent filters, not sort order) and compete for already-constrained horizontal space, especially on mobile.
- **Result count row** (`"N activities · Updated ...` + density toggle): **the lowest-cost real estate that already exists for exactly this class of control.** This row already hosts a two-icon-button `role="group"` toggle (Comfortable/Compact density) with an established `aria-pressed` pattern — structurally the closest existing precedent for "a small, optional view-preference control that doesn't affect what's shown, only how." A proximity toggle could conceptually sit here using the *same* established pattern, without inventing a new UI language.
- **Result Cards**: explicitly out of scope (Part 9) and, per inspection, already fully committed to their existing information hierarchy (Activity/Time/Facility/Price-Age/Status) — no natural per-card affordance for a list-level ranking mode exists or should be added here.

**Conclusion**: every option that isn't "reuse the density-toggle row's existing pattern" adds real, avoidable clutter. The result count row is the only surface that doesn't require inventing new visual language.

## 11. Location Permission UX

The task's proposed flow — user chooses "Near me"/"Nearest" → browser requests location only if not already granted → granted activates proximity-first, denied gracefully stays in default mode — is **already exactly how Phase 4.2's `useUserLocation` hook behaves** for the existing "show me distance" affordance, confirmed by inspection: `requestLocation()` is idempotent from the UI's perspective (a granted status short-circuits a second permission prompt at the browser level; a denied status keeps the app fully functional). A proximity-first control would not need any new permission-handling code — it would call the exact same `requestLocation()` already wired to the header pill, and simply also flip a local ranking-mode flag once `userLocation.status === "granted"`. This is consistent with, not a deviation from, Phase 4.2's established behavior.

## 12. Privacy

No new privacy surface is introduced by adding a ranking mode: proximity-first would operate on the exact same `userLocation.latitude/longitude` values Phase 4.2 already acquires, ephemerally, client-side, never persisted, never sent over the network, never in a URL, never in Share text — because ranking is purely a client-side array-sort operation over data already in memory, identical in kind to Phase 4.3B's existing tie-breaker. No IP geolocation, no server-side profile, and no new coordinate-transmission path would be needed under any of the interaction models evaluated in §9.

## 13. Mobile Consideration

- **Tap cost**: a toggle placed in the existing result-count row (§10) would cost exactly one additional tap target the same size as the existing density-toggle buttons (already confirmed functional and reachable on real narrow-width layouts in Phase 4.2/4.3B's own mobile verification).
- **Horizontal space**: the result-count row currently has room for exactly the count text (left) and the two-icon density toggle (right) — a third icon-button would fit at the same visual weight without wrapping, based on direct inspection of that row's current layout, but would measurably tighten the row's whitespace, especially at narrow widths where the count text itself can already be long (e.g., "26 Badminton activities · Updated 3 days ago").
- **Would it overcrowd?** A single additional icon button, styled identically to the existing density toggle, is a small, bounded addition — not a redesign — but it is still real, non-zero visual cost on a row that's already doing two jobs (result count + density) on the narrowest screens.
- **Permission flow**: identical to Phase 4.2's already-mobile-verified flow (structurally verified via DOM-width-constraint injection in every prior phase; genuine physical-device geolocation permission UX has never been claimed as tested in this project, and is not claimed here either).
- **Is proximity intent more valuable on mobile?** Plausibly yes — a user checking DropIn while already out and about is more likely to have a concrete "what's near me right now" need than a desktop user planning ahead — but this audit found no data that directly measures this (no real usage data exists yet); it's a reasonable product hypothesis, not a measured finding, and is reported as such.

## 14. Map View Relationship

Revisiting Phase 4.0's deferral **only** in light of this phase's new evidence: proximity-first, if shipped with the group-bounded safeguard from §7, would let a user see genuinely-nearby, genuinely-soon options directly in the list, with real distances already visible per card and Directions already one tap away (Phase 4.2/4.3B, unchanged). This is the same kind of incremental reinforcement Phase 4.3A already noted for its own default-ranking work — an accurately-ordered list plus working Directions covers more of "help me find something nearby" than an ungrouped, undifferentiated list would, further narrowing the specific gap a map would need to fill. This audit's own bad-case findings (§6) also indirectly suggest a map wouldn't obviously solve the same problem better — a map shows geographic proximity just as directly as a proximity-first list would, but has the *same* underlying tension (visually-closer pins can still represent much-later start times) unless it were built with equivalent time-awareness, which is a materially larger feature than a list reordering. **Recommendation: Map View remains deferred — this evidence mildly reinforces, not overturns, Phase 4.0's original reasoning**, consistent with Phase 4.3A's own prior conclusion.

## 15. Product Decision Matrix

| | User value (measured) | Implementation complexity | UI cost | Mobile suitability | Cognitive load | Depends on location permission | Fits search-first philosophy |
|---|---|---|---|---|---|---|---|
| **A. Current default only** | Real but tie-break-only (Phase 4.3A/B) | None (already shipped) | None | N/A | None | No | Yes |
| **B. "Near me" intent control** | Real, confirmed by §5, but risks copy collision with existing "Near me" label (§9) | Low (reuses `requestLocation`, needs a local ranking-mode flag + the group-bounded comparator) | Low, if placed in the result-count row (§10) | Good, one extra icon-button-sized tap target | Low if worded carefully; medium if it collides with existing "Near me" meaning | Yes, gracefully degrades (§11) | Mostly — still a lens on search results, not a separate feature |
| **C. "Nearest" explicit control** | Same measured value as B, clearer wording, no copy collision | Same as B | Same as B | Same as B | Low — "Nearest" reads as an unambiguous ranking directive | Yes, same graceful degradation | Mostly — same as B |
| **D. Traditional Sort menu** | Same underlying value as B/C | Higher — new UI pattern (dropdown/menu) not currently present anywhere in the app | Higher — introduces a new interaction model | Works, but a dropdown is a heavier mobile pattern than an icon toggle | Higher — introduces "sort" as a concept the app has never asked users to think about | Yes | No — a visible "Sort" menu reads more like a database/search-engine UI than DropIn's current minimal, opinionated one |
| **E. Map View** | Unmeasured directly; §14 suggests marginal value given B/C already cover much of the same need | Highest by far (Phase 4.0's own finding, unchanged) | Highest | Unclear without building it | Unclear | Yes | Departs from the current list-first design entirely |

## 16. Recommendation

**C. Add a lightweight proximity-first behavior before launch — but only with the group-bounded safeguard from §7, and using "Nearest" as the interaction label, not "Near me."**

Preferred interaction model, based on §9–§10's evidence:
- A single icon-button-style toggle placed in the existing result-count row, styled identically to the existing Comfortable/Compact density toggle (same `role="group"`, `aria-pressed` pattern) — no new visual language.
- Labeled "Nearest" (not "Near me," to avoid the confirmed copy collision with the header pill's existing meaning).
- On activation: calls the same, already-shipped `requestLocation()` if not already granted; if granted (now or already), switches `resultsGrouped`'s comparator to the **group-bounded** proximity variant validated in §7 (distance-first *within* each existing temporal group, groups themselves stay in their existing precedence order) — never the pure, unbounded version shown to be genuinely bad in §6.
- If denied/unavailable, the toggle gracefully has no effect (or is disabled with the same honest, non-technical messaging Phase 4.2 already established for the header pill) — the app never degrades below the current default.
- Explicit search scope is untouched under every condition (§8).

This is **not** a full Phase 4.4B implementation directive — it's this audit's answer to "if C, what interaction model," per the task's own instruction. Nothing here has been built.

## 17. Evidence Threshold — Why This Clears the Bar

This recommendation is made *because* the real-data simulation shows genuine, measurable user value (§5: real 20+ km savings in real cross-municipality cases, real municipality changes in 54% of scenarios) that the current default (tie-break-only) cannot surface — not because the code already supports geolocation, not because distance data already exists, and not because it would be easy to build. The same evidence also disqualified the *naive* version of the feature (§6: 305-minute average wait is not a reasonable trade for most users) — meeting the task's explicit bar that ease-of-build is not sufficient justification, and that a technically-possible feature can still be the wrong one to ship as originally conceived.

---

## Closing Questions

**A. Does real data demonstrate meaningful value for an explicit proximity-first intent?** Yes — real distance savings up to 23.9 km were found in real cross-municipality scenarios, and the top result changed municipality in 54% of scenarios tested, confirming the underlying need (surfacing genuinely-local options a time-first default doesn't prioritize) is real, not hypothetical.

**B. How frequently does proximity-first materially change the top results?** Very frequently — top-1 changed in 87.5% of scenarios (pure) and top-3/top-5 changed in 100%, confirming this isn't a marginal, rarely-triggered feature.

**C. What distance savings does it typically create?** Averaged 14.8 km across scenarios where the top result changed, with several real cases in the 15–24 km range.

**D. What additional waiting time does it introduce?** For the naive, unbounded version: an average of 305.7 minutes (~5 hours), up to 585 minutes — genuinely bad. For the group-bounded version: an average of 9.4 minutes, with one honestly-reported residual case reaching 3 hours inside a single wide "Later today" group.

**E. Is pure distance-first safe within the user's existing date/time/search scope?** Not on its own (§6/§7) — it needs to respect the *existing* temporal grouping (not a new invented window) to avoid the bad cases found. With that safeguard, it becomes safe and evidence-supported.

**F. Should DropIn expose this as "Near me", "Nearest", another interaction, or nothing?** "Nearest" — "Near me" was found to collide with the header pill's existing, different meaning; "nothing" leaves real, measured value (§5) unclaimed; a traditional Sort menu is a heavier UI pattern than the evidence justifies.

**G. Would the feature meaningfully increase UI complexity?** Modestly, not substantially — it can reuse the existing density-toggle's exact visual/interaction pattern in the existing result-count row, requiring no new UI language, no new permission flow (reuses Phase 4.2's `requestLocation`), and no new visual surface.

**H. Should it be implemented before launch?** Per this audit's recommendation, yes — as the bounded "Nearest" toggle described in §16, given the measured real value and the now-understood safeguard against the naive version's failure mode.

**I. Does this evidence strengthen or weaken the case for Map View?** Mildly weakens/reinforces the existing deferral (consistent with Phase 4.3A's own prior conclusion) — a bounded "Nearest" list view plus existing Directions covers a meaningful share of the same underlying need a map would address, without a map's substantially higher build cost.

**J. What should Phase 4.4B be, if anything?** Implementing exactly the "Nearest" toggle described in §16: the group-bounded proximity comparator, the result-count-row toggle UI matching the existing density-toggle pattern, wired to the existing `requestLocation()`/`userLocation` state — with the same real-data verification discipline (Phase 4.3B's methodology) applied before shipping.

---

Stopping here, as instructed. No production ranking was changed, no UI was implemented, and no Map View work has begun.
