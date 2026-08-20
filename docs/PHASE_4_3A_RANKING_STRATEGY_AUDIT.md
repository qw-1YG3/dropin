# Phase 4.3A — Distance-Aware Ranking Strategy Audit

An evidence-based investigation into whether and how `distanceKm` should influence result ordering. **No production ranking code was changed.** All findings below come from a standalone analysis script run against the real, current canonical dataset (46,367 sessions across all 7 municipalities), replicating `app/page.tsx`'s actual grouping/sorting logic line-for-line before layering alternative strategies on top for comparison.

---

## 1. Current Ranking Architecture (Audit)

Inspected directly in `app/page.tsx` and `lib/dropin/time.ts` — not assumed from prior phase docs.

**Group creation** (`resultsGrouped`, `app/page.tsx:855`): the currently-filtered result set is first sorted with `compareChronologically` (date, then `startMinutes`, ascending), then partitioned into groups by filtering that already-sorted array — so within-group order is inherited, never independently re-sorted.

- **When the selected date is today**: four groups, in this precedence —
  1. **Happening now** — `sessionStatus` returns `"in-progress"` (start ≤ now < end)
  2. **Starting soon** — `"starting-soon"` (start is 0–60 minutes from now)
  3. **Starting today** — `"later"` and `startMinutes < 17:00`
  4. **Later today** — `"later"` and `startMinutes ≥ 17:00`
  Empty groups are omitted entirely (`groups.filter((g) => g.sessions.length > 0)`).
- **When the selected date is a future date**: three neutral groups — Morning (`< 12:00`), Afternoon (`< 17:00`), Evening (`≥ 17:00`) — since a future session can never structurally be "happening now" or "starting soon" (`sessionStatus` computes that relative to live `now`, and a future date's start time is always >60 minutes away by construction).
- **When a Time-of-Day filter chip is already active**: grouping collapses to one flat, chronologically-sorted list (re-grouping by the same dimension the chip already narrowed to would just repeat it as a redundant heading).

**Within-group ordering**: `compareChronologically(a, b)` is exactly `date` string comparison, then `a.startMinutes - b.startMinutes`. **There is no tertiary key.** Ties are resolved only by whatever order the array was in before `.sort()` ran — JavaScript's `Array.prototype.sort` is stable (guaranteed since ES2019/V8), so ties don't reorder randomly on every render, but the order they resolve to is inherited from upstream, not chosen for any product reason.

**`startMinutes` calculation**: `hour * 60 + minute` from the source's own local wall-clock start time, computed identically by all three source adapters (`lib/dropin/sources/toronto.ts:183`, `activecommunities/normalize.ts:95,235`, `perfectmind/normalize.ts:185`). It is a **required, non-optional** field on `Session` (`lib/dropin/types.ts:95`) — every adapter always derives it from a required raw time field, so **missing start times do not exist** anywhere in the current dataset by construction.

**Ongoing sessions**: `sessionStatus(start, end, now)` (`lib/dropin/time.ts:172`) checks `end`-vs-`now` before `start`-vs-`now` — an in-progress session is never miscategorized as `"ended"` or `"starting-soon"`.

**Future-date sessions**: handled by the separate Morning/Afternoon/Evening branch above; the 5pm boundary is shared with the "Later today" threshold via one constant (`LATER_TODAY_THRESHOLD_MINUTES`) so the two labels never disagree about what "evening" means.

**Source ordering effect on ties — confirmed real, not hypothetical.** `getAllSessions()` (`lib/dropin/sources/index.ts:100`) iterates a **fixed** municipality order — `["toronto", "mississauga", "richmond-hill", "vaughan", "markham", "newmarket", "aurora"]` — and pushes each municipality's full session array in that order via `results.forEach((result, i) => sessions.push(...))`, even though the underlying snapshot reads run concurrently (`Promise.allSettled`). Within a municipality, `loadMunicipalitySessions` returns `snapshot.sessions` in **whatever order the canonical JSON file stores them** — confirmed by inspection that no `scripts/refresh/*` file sorts sessions before writing the canonical snapshot. This means:
- **Municipality order can and does affect ties**, deterministically: Toronto sessions always precede Mississauga's, which always precede Richmond Hill's, etc., for any exact `(date, startMinutes)` collision — regardless of which is actually closer to the user or more relevant by any other measure.
- **Within-municipality order is essentially scrape/normalize order** — arbitrary from a product standpoint, and not guaranteed to be stable across separate refreshes unless the upstream source API itself returns a stable order (not verified either way — see §12).

**Real, measured tie prevalence** (today's date, live sessions only): **98.3% of all 1,270 sessions across all municipalities share their exact `(date, startMinutes)` with at least one other session.** This is not a rare edge case — drop-in facility schedules cluster heavily around common slot times (on-the-hour, on-the-half-hour), so ties are the *norm*. Toronto alone: 99.2% of its 906 sessions are tied with at least one other Toronto session. 59 of today's tied groups span more than one municipality — i.e., 59 real, live cases today where the current production code's tie order is decided purely by the fixed municipality iteration order above, not by anything meaningful.

**Where `distanceKm` is currently available**: computed client-side, on demand, only for currently-rendered sessions, via `distanceKmFor` (`app/page.tsx:697`, built in Phase 4.2) — Haversine distance from `userLocation` (real device geolocation, only when granted) to `Session.latitude`/`longitude` (Phase 4.1's facility geocoding, ~96% coverage). It is **display-only** today: nothing in `resultsGrouped`, `compareChronologically`, or any sort call reads it. Confirmed by inspection — zero references to `distanceKm` inside any comparator function.

## 2. Real-Data Test Setup

A standalone Node script (not committed to the app, no production files touched) that:
1. Loads all 7 municipalities' canonical `latest.json` snapshots in the **exact same order** `getAllSessions()` does, preserving on-disk order — so any tie-order finding reflects real production behavior, not an artifact of the analysis tooling.
2. Reimplements `sessionStatus`, `timeOfDayBucket`, `compareChronologically`, and the `resultsGrouped` grouping rules line-for-line from the real source.
3. Reimplements `haversineKm`/`formatDistanceKm` line-for-line from `lib/dropin/distance.ts`.
4. Layers five alternative sort strategies (§5) on top of each real result group, without touching how the group itself is formed.

"Today" was fixed at **2026-08-20** (the real current date at the time of this audit) and a **"now" of 2:00 PM** was used throughout for consistent status computation. A future date, **2026-08-27** (one week out), was used for the future-date scenarios.

## 3. Representative Activity/Location Scenarios

**User-location scenarios** (approximate real-world coordinates, not GPS-precise — representative anchor points):

| Key | Location | Coordinates |
|---|---|---|
| A | Downtown Toronto (Union Station area) | 43.6532, -79.3832 |
| B | North York (Yonge/Sheppard area) | 43.7615, -79.4111 |
| C | Mississauga (Square One area) | 43.5890, -79.6441 |
| D | Vaughan (Vaughan Mills / city centre area) | 43.8361, -79.5183 |
| E | Markham (civic centre area) | 43.8561, -79.3370 |
| F | Toronto/Vaughan boundary (Steeles/Jane area) | 43.7615, -79.5019 |

**Activity families tested**: Pickleball (high-volume, 26 sessions today), Badminton (high-volume, 30), Lane Swim/Swimming (very high-volume, 420), Basketball (medium, ~30), Yoga (medium, 32) — deliberately spanning both high- and lower-volume families, on both today and the future date.

## 4–8. Strategy Results

Below, "today" figures use the real 2026-08-20 dataset; PM times use 24-hour minute offsets converted to clock time for readability.

### Strategy A — Current Behavior (Baseline)

Exactly production: time group → `startMinutes` ascending → inherited (municipality/scrape) order for ties. No changes tested here; this is what every other strategy is compared against.

### Strategy B — Pure Distance Within Each Time Group

**Confirmed: this causes materially later sessions to outrank meaningfully sooner ones, exactly as the task anticipated.** Real example — Pickleball, "Later today" group, downtown Toronto user:

```
A (current):  17:30 · 17 km  Thistletown Multi-Service Centre
              17:45 · 1.8 km Canoe Landing Community Recreation Centre
              18:30 · 5.1 km East York Community Recreation Centre
              19:00 · 11 km  Warden Hilltop Community Centre
              19:15 · 14 km  Parkway Forest Community Centre

B (pure distance): 17:45 · 1.8 km Canoe Landing
                    18:30 · 5.1 km East York
                    19:30 · 9.7 km O'Connor Community Centre  ← 2 hours later than #1, still ranks 3rd
                    19:00 · 11 km  Warden Hilltop
                    19:15 · 14 km  Parkway Forest
```

A more extreme real case (Badminton, "Later today," downtown Toronto): a **20:30** session (Canoe Landing, 1.8 km) ranks *ahead* of a **17:00** session (Matty Eckler, 3.9 km) — a **3.5-hour** difference, purely because it's 2.1 km closer. Measured across every scenario tested, Strategy B produced **maxTimeSacrificed values from 90 to 345 minutes** (i.e., a single overtake where a session starting up to 5¾ hours later leapfrogs one starting sooner) and typically reordered **80–100% of a group's positions**. Strategy B also, as a structural side effect, can reorder sessions that started at genuinely different times into an order that reads as temporally confusing (a 19:30 session before a 19:00 one), which is exactly the "does this feel right" failure mode Part 11 asks to watch for.

### Strategy C — Time First, Distance as Tie-Breaker

**Confirmed conservative and predictable, as the task's own framing anticipated.** Real example, same Pickleball group:

```
C (time -> distance): 17:30 · 17 km  Thistletown  (unchanged — no tie to break)
                       17:45 · 1.8 km Canoe Landing (unchanged)
                       18:30 · 5.1 km East York (unchanged)
                       19:00 · 11 km  Warden Hilltop (unchanged)
                       19:15 · 14 km  Parkway Forest (unchanged)
```

Because this group happened to have no exact-time ties, Strategy C is identical to Strategy A here — **by design**: it never lets a later session outrank an earlier one (`overtakePairs=0` in every single scenario tested, without exception, across all 5 activity families, both dates, and all 6 user locations). Where it *does* change anything is real ties — and given §1's finding that 98.3% of today's sessions are tied with something, this is not a marginal case. A real tied example (Swim, "afternoon," future date, Vaughan user): four sessions all starting at 12:00 — Strategy C reorders them from arbitrary snapshot order to `9.6 km → 9.7 km → 10 km → 11 km`, a small but real, honest improvement with zero risk of a later session jumping ahead of an earlier one. Across the full sweep, Strategy C's `posChanges` ranged from 0 (no ties in that particular group) up to 125/162 (Swim afternoon future-date, where ties were extremely common) — always with `overtakePairs=0`.

### Strategy D — Time-Window + Distance (Bounded Hybrid)

Tested two window sizes (30 min, 60 min), clustering sessions whose start times fall within the window of the earliest session in a running cluster, then sorting each cluster by distance.

**The task's own worked example reproduced almost exactly with real data** — Pickleball, downtown Toronto: a **17:30 · 17 km** session (Thistletown) and a **17:45 · 1.8 km** session (Canoe Landing) are 15 minutes apart. With a 30-minute window, D30 promotes Canoe Landing ahead of Thistletown — the task's own "6:45 PM · 1.2 km should be promoted over 6:30 PM · 15 km" intuition, confirmed to fire correctly on real data.

**The task's own safety concern also reproduced correctly**: the same group's **17:30 · 17 km** vs a **19:00 · 11 km** or **19:15 · 14 km** session (90 minutes apart) — D30 and D60 both correctly leave these in time order; the window never bridges a 90-minute gap at a 30- or 60-minute setting, so a much-later session never jumps to the front just for being closer.

Window-size sensitivity matters: D30 produced 9–18 overtake pairs per group in the swept scenarios vs. D60's 7–21 — **larger windows do materially change more positions and do so at a coarser time-tolerance**, confirmed quantitatively (e.g. Pickleball/Markham-user/Later-today: D30 had `maxTimeSacrificed=30min` across 9 overtakes; D60 had `maxTimeSacrificed=60min` across 8 overtakes — a real trade-off between "more chances to reward proximity" and "larger tolerance for how much lateness that proximity can excuse"). No single "correct" window size emerged from the data — 30 minutes tracked closer to Strategy C's conservatism; 60 minutes started producing reorderings similar in character (though smaller in magnitude) to Strategy B's more aggressive ones.

### Strategy E — Weighted Scoring

Explored with two weights (5 min/km, 15 min/km — i.e., "how many minutes of wait is 1 km of proximity worth"), **not recommended by default**, per the task's own framing, and this audit's evidence reinforces that caution:

- **A real implementation bug was caught by this audit's own exploratory code**, and it is directly instructive: the first weighted-scoring pass used `distFor(a) ?? 0` (missing distance defaults to 0) — which is *exactly* the "treat missing distance as 0" anti-pattern Part 9 explicitly warns against. The result was immediate and severe: sessions with **no facility coordinates were scored as if they were 0 km away** (better than every real session), and shot to the **very top** of the list ahead of everything else. Real example (Swim, evening, future date, Vaughan user): `17:00 · no coord · Lane Swim @ Donald D. Summerville Olympic Pools` ranked **#1**, ahead of a real `17:00 · 10 km` session. This is a **concrete demonstration of why scoring approaches are easy to get subtly, severely wrong** — the bug is invisible unless you specifically test the missing-distance case, and its effect (silently promoting the least-known sessions to the top) is the opposite of intuitive.
- Even with correct missing-distance handling, a weighted score is fundamentally **harder to explain and predict** than Strategies C or D: "closer" and "sooner" collapse into one opaque number, so a user (or a future engineer debugging "why is this session first?") cannot look at two sessions and immediately understand the ordering rule the way they can with "time, then distance" or "time window, then distance." The quantitative sweep bears this out indirectly: E1/E2's `posChanges` and `overtakePairs` numbers move in less predictable steps across scenarios than C or D's do, precisely because a linear score has no natural "boundary" the way a window or a strict lexicographic order does.
- **Assessment: not worth the complexity.** It doesn't solve a problem C/D don't already solve, and it introduces a real, demonstrated failure mode that requires careful, non-obvious handling to avoid.

## 9. Quantitative Comparison (Summary)

Across the full sweep (5 activities × up to 3 user locations × today, plus 2 future-date scenarios):

| Strategy | Typical posChanges | overtakePairs (later session ranked before earlier) | Typical maxTimeSacrificed | Predictability |
|---|---|---|---|---|
| A (current) | — (baseline) | — | — | Fully predictable, but ties are arbitrary |
| B (pure distance) | 80–100% of group | Frequent, large | 90–345 min | Low — later sessions routinely outrank sooner ones |
| C (time, then distance) | Only where real ties exist (0–~80% depending on tie density) | **0, always** | **0, always** | High — never violates time order |
| D30 | Moderate–high | Frequent, small-magnitude | Capped at 30 min | Medium-high — bounded, explainable ("close in time, ranked by distance") |
| D60 | Higher than D30 | More frequent | Capped at 60 min | Medium — larger tolerance, still bounded |
| E (weighted) | Variable, less predictable pattern | Frequent | Uncapped (grows with weight) | Low — requires understanding a formula; failure-prone if distance defaults wrong |

## 10. Edge Cases (Cases 1–6, with Real Sessions)

**Case 1 — identical start time, large distance gap.** Real (Swim, today, downtown Toronto): `10:00 · 0.7 km` (Harrison Pool) vs. `10:00 · 18 km` (Kidstown Water Park) — both genuinely start at the same moment. Strategy A's tie order is arbitrary (municipality/scrape order); Strategy C correctly promotes the 0.7 km session with zero risk. **Intuition confirmed**: the closer session should plausibly go first when time is truly equal, and only Strategy C (and, within its window, D) does this safely.

**Case 2 — 15 minutes later, much closer.** Real (Pickleball, today, downtown Toronto): `17:30 · 17 km` (Thistletown) vs. `17:45 · 1.8 km` (Canoe Landing), Δt = 15 min. D30 promotes Canoe Landing; Strategy C does not (it never crosses a real time gap, however small). This is the genuine product judgment call the task poses — "should 15 minutes outweigh 15 km" — and the evidence doesn't resolve it definitively either way; it's a values choice, not a data question (see §14).

**Case 3 — 90 minutes later, much closer.** Real (Pickleball, today, downtown Toronto): `16:15 · 15 km` (Domenico DiLuca) vs. `17:45 · 1.8 km` (Canoe Landing), Δt = 90 min. At a 30- or 60-minute window, Strategy D correctly does **not** let the 17:45 session jump ahead of the 16:15 one — confirming the task's own intuition that a 90-minute gap should not be bridged by proximity, at least not at these window sizes.

**Case 4 — Happening-now vs. Starting-soon distance conflict.** Real (Swim, today, downtown Toronto): `Happening now · 18 km` (Kidstown Water Park) vs. `Starting soon · 13 km` (Douglas Snow Aquatic Centre). Under every strategy tested here, **group membership itself is never touched** — only within-group order changes. Kidstown stays in "Happening now" and Douglas Snow stays in "Starting soon" regardless of strategy; a currently-closer-but-later-group session can never jump into an earlier, more urgent group. This confirms Part 6's requirement structurally, not just by observation.

**Case 5 — missing distance.** Real (Swim, today): `Lane Swim @ Harrison Pool` (has coordinates) and `Lane Swim @ Donald D. Summerville Olympic Pools` (no coordinates) both start at 10:00. Strategies B/C/D all correctly sort the missing-distance session to the **end** of its tie group rather than hiding it, inventing a value, or (critically, per the Strategy E bug above) treating it as 0 km. Measured missing-coordinate rates within real activity pools today: Pickleball 0%, Badminton 0%, Yoga 0%, Swim 3.4%, Basketball 3.4% — consistent with Phase 4.1's ~96% overall coverage figure, confirmed here at the individual-activity-family level too.

**Case 6 — explicit search scope preservation.** Real, live-simulated: "pickleball markham" (an explicit municipality search) while the user's device location is mocked to downtown Toronto. The filtered pool is **3 Markham sessions only**, regardless of which strategy is applied — every strategy tested only ever reorders an *already-filtered* pool; none of them add, remove, or reach outside that pool. Confirmed on both today's date and the future date. This holds by construction (the same architectural separation Phase 4.2 established between `userLocation` and `effectiveLocation`), not by any strategy-specific safeguard — meaning **any** of Strategies B–E could be adopted without reopening this risk, since none of them touch which sessions are in scope, only their order within it.

## 11. Missing-Distance Behavior (Recommendation)

Every strategy considered (B, C, D) already implements the safe rule correctly in this audit's code: a session with `distanceKm === undefined` is **never dropped, never invalidated, and never treated as 0 km** — it sorts to the end of whatever tie/window group it's in, preserving its real temporal position relative to *other* groups (it's never pulled out of "Happening now" or shoved to the very end of the whole list). Strategy E's naive `?? 0` implementation is the one counter-example, and it's a cautionary tale, not a recommendation (§8). **Recommended fallback for Phase 4.3B, regardless of which strategy is chosen: missing distance sorts last within its tie-breaking scope, using time order as the deciding factor when two sessions both lack distance.**

## 12. Ranking Stability Findings

Two independent, real, confirmed sources of non-meaningful tie variation exist in the **current, unmodified production code**, entirely separate from anything this audit proposes:

1. **Municipality iteration order** (`MUNICIPALITY_SLUGS`, fixed but arbitrary from a ranking standpoint) — Toronto sessions always win a cross-municipality tie today, not because they're closer, more relevant, or fresher, but because Toronto is first in a hardcoded array. Confirmed with 59 real cross-municipality ties today alone.
2. **Within-municipality scrape/snapshot order** — no canonical snapshot writer sorts sessions before persisting them (confirmed by inspection: no `.sort()` call touches session arrays anywhere in `scripts/refresh/`). This order is not guaranteed stable across separate refreshes unless the upstream source API itself happens to return a stable order, which was not verified in either direction this phase (flagged as a real unknown in §14, not asserted).

Neither of these is new — they exist in Strategy A (today's real behavior) regardless of whether distance-aware ranking is ever added. **This audit's clearest, most confident recommendation is unrelated to which distance strategy is chosen**: introduce a deterministic tie-breaking chain so that ties resolve the same way every time, for a legible reason, rather than by incidental array order.

**Recommended deterministic tie-breaking chain** (to be implemented, not yet implemented, in Phase 4.3B):

```
1. time-group precedence (Happening now > Starting soon > Starting today > Later today,
   or Morning > Afternoon > Evening for a future date) — unchanged from today
2. startMinutes ascending — unchanged from today
3. distanceKm ascending, missing sorts last — NEW
4. a stable deterministic key, e.g. session.id ascending — NEW, guarantees a
   reproducible order even when two sessions share identical time AND distance
   (or both lack distance), so the "last tiebreak" is never left to array order again
```

This chain is, in effect, **Strategy C** with one more deterministic layer added underneath it for the small remainder of ties that even distance doesn't resolve (identical time, identical or both-missing distance) — which the audit confirms is a real, if smaller, remaining case (e.g., the two literal duplicate `19:00 · 1.8 km` Badminton-at-Canoe-Landing sessions found in §1's tie data).

## 13. UX / Mental-Model Analysis

- **Strategy A (current)**: predictable in principle (time-first) but its tie-breaking is *not* explainable to a user — "why does this Toronto session show before this closer Mississauga one at the exact same time?" has no good answer today. Given 98.3% of sessions are tied with something, this is a real, live, if invisible, product gap.
- **Strategy B**: fails the "does this feel right" test in real data — a 20:30 session outranking a 17:00 one only because it's 2 km closer reads as arbitrary or even broken to a user scanning by eyeball down a time-grouped list, since the list itself is still headed "Later today," implying temporal order within it.
- **Strategy C**: the most explainable of all — "sessions are in time order; when two start at literally the same time, the closer one comes first" is a one-sentence rule any user could restate correctly after seeing it happen twice. It never surprises a user by hiding a sooner option behind a farther one.
- **Strategy D**: explainable with slightly more nuance ("sessions starting close together in time are grouped, then ordered by distance") but requires the user to intuit or be told about the window — less immediately legible than C, though it captures real, plausible cases (Case 2) that C by design leaves alone.
- **Strategy E**: the least explainable — no user (and, per §8's bug, not even this audit's own first-pass implementation) can reliably predict what a blended score will do without seeing the formula, and "why is this session ranked here" becomes a real support/debugging question rather than a one-glance answer.
- **Temporal urgency stays visible under every strategy tested** except B, where a late-but-close session visually competing for the top slot inside a group still labeled by real, meaningfully different start times risks diluting the "Happening now"/"Starting soon" urgency signal Phase 3.5C built and Phase 4.2 was careful not to disturb.

## 14. Recommended Default Ranking Strategy

**Strategy C (time first, distance as tie-breaker), extended with the deterministic key in §12.** This is the strategy that:
- Never lets a materially later session outrank a materially sooner one (0 overtakes, confirmed across every single scenario tested — the only strategy with that property besides doing nothing),
- Has a real, measured, non-trivial benefit given how common exact-time ties are (98.3% of today's sessions),
- Is the easiest to explain and predict,
- Requires no product judgment call about "how many kilometres is worth how many minutes" (Strategy D and E both require picking a number nobody has evidence for yet; Strategy C requires no such number),
- Is a strict, additive refinement of exactly what exists today — no session's relative time-based position changes, only same-time ties resolve more usefully.

Strategy D (time-window hybrid) is flagged as a **plausible, evidence-supported future refinement**, not the initial recommendation — it does capture real, intuitively-reasonable cases (Case 2) that Strategy C leaves alone, but it requires a window-size product decision this audit found no data-driven way to make definitively (§8), and it's a larger behavioral change to reason about and support than C. Recommend revisiting D only after C has shipped and there's real usage evidence about whether users want same-hour-ish sessions reordered by distance.

Strategy B and E are **not recommended**, for the concrete reasons in §5 and §8 respectively.

## 15. Recommended Deterministic Tie-Breaking Chain

See §12 — `time-group → startMinutes → distanceKm (missing sorts last) → session.id`. This should be treated as a **prerequisite fix independent of the distance question**: even a build that never ships distance-aware ranking at all would benefit from replacing the current "whatever array order happened to survive" tie behavior with `session.id` as a final deterministic key, given how frequently ties occur.

## 16. Is a Future Sort Control Justified?

**No clear evidence for one yet, and the task's own framing (default should be useful without forcing sort management) is borne out by this audit.** Strategy C requires no user-facing control at all — it's a pure quality improvement to the existing default ordering. A "Nearest" control only becomes clearly justified if a future version deliberately adopts a more aggressive strategy (B, D, or E) as an *alternative* view rather than the default — since those strategies visibly reorder across time in ways a user might reasonably want to opt into or out of, whereas Strategy C's changes are subtle enough (same-time reordering only) that they don't need to be surfaced as a toggle. Recommend revisiting this question only if/when Phase 4.3B or a later phase considers shipping Strategy D as an option.

## 17. Implications for Map View

This audit's findings **mildly reinforce** Phase 4.0's existing recommendation to defer Map View, without forcing that conclusion. The evidence: Strategy C already surfaces the closest same-time option at the top of a list a user is already scanning, and Directions (Phase 4.2, unchanged) already gets them there — between an accurately-ordered list and a working Directions link, the marginal value a map adds for "help me find something nearby" specifically is smaller than it would be if today's ranking were doing nothing useful with distance at all. This is a incremental observation, not new geospatial-coverage or user-research evidence — Phase 4.0's original reasons for deferring Map View (data coverage, product focus, engineering cost) are unchanged and remain the primary basis for that recommendation.

## 18. Risks / Unknowns

- **Snapshot-order stability across refreshes was not empirically verified** — this audit confirmed no explicit sort exists at write time (a static code fact), but did not run two consecutive refreshes of the same municipality and diff the resulting session order to see how much it actually moves in practice. If it turns out to be highly stable in practice (e.g., because the upstream APIs paginate deterministically), the tie-instability risk is smaller than the static analysis alone suggests — but this should be verified before or during Phase 4.3B, not assumed.
- **No real user-location data exists yet** — every distance figure in this audit comes from six representative anchor coordinates, not real granted-geolocation usage. Once Phase 4.2's geolocation is used by real users, actual distance distributions (and therefore how often Strategy C's tie-breaker actually fires in practice) could differ from this audit's estimates.
- **The Strategy D window-size question remains genuinely unresolved** — this audit deliberately did not manufacture a false sense of precision here; 30 vs. 60 minutes both "worked" in the sense of not producing absurd results, but neither is backed by evidence that it matches real user tolerance for "close enough in time."
- **Activity-family-specific behavior was only lightly explored** — lower-volume activities (Yoga, Basketball) showed smaller absolute group sizes, which naturally produces fewer ties and fewer overtakes; this audit did not find evidence that any activity family needs a *different* strategy, but it also did not exhaustively test every real activity title in the taxonomy.

---

## Closing Questions

**A. What exactly is DropIn's current ranking logic?** Time-group precedence (today: Happening now → Starting soon → Starting today → Later today; future date: Morning → Afternoon → Evening), then `startMinutes` ascending within each group, with ties resolved only by incidental array order (fixed municipality iteration order, then whatever order the canonical snapshot file happens to store sessions in) — never by anything meaningful. Distance plays no role today.

**B. Is pure distance sorting appropriate?** No. Confirmed by real data: Strategy B routinely lets sessions starting 90–345 minutes later outrank materially sooner ones, which conflicts with DropIn's core "what can I actually go play, and where" framing and the existing temporal-urgency grouping work.

**C. Should distance only break exact start-time ties, or should it have more influence?** This audit's recommendation is to start with exact-tie-breaking only (Strategy C) — it's evidence-backed, safe, and explainable, and 98.3% of today's sessions are tied with something so the benefit is real, not marginal. A bounded time-window extension (Strategy D) is a plausible, evidence-supported next step, not ruled out, but the window size is a product judgment call this audit couldn't resolve from data alone.

**D. Does a bounded time-window + distance strategy materially improve results?** Somewhat, but with real trade-offs. It correctly captures intuitive cases (a 15-minute-later, 15-km-closer session; Case 2) and correctly refuses to bridge clearly-too-large gaps (a 90-minute gap; Case 3) at the window sizes tested (30/60 min). But it also introduces the same kind of "later session ranks first" surprise Strategy B has, just capped in magnitude — window size directly controls how much of that trade-off you accept, and this audit found no definitive evidence for the "right" number.

**E. Is weighted scoring worth the added complexity?** No, not currently. It solves nothing that C/D don't already solve, its behavior is harder to predict or explain than either, and this audit's own exploratory implementation demonstrated a real, severe failure mode (missing distance defaulting to 0, promoting the least-known sessions to the very top) that would require careful, non-obvious safeguards to avoid in a real implementation.

**F. What should happen to sessions with missing distance?** Never hidden, never invalidated, never treated as 0 km. They should sort to the end of whatever tie-breaking scope they're in (their real time-based position is preserved; only the distance tie-break step is skipped for them), falling back to time order among themselves when more than one in the same group lacks distance.

**G. What deterministic tie-breaking chain do you recommend?** `time-group precedence → startMinutes ascending → distanceKm ascending (missing sorts last) → session.id ascending` (or another guaranteed-unique, stable field) as the final deterministic layer, so no tie is ever left to incidental array/snapshot order again.

**H. Should DropIn eventually expose a "Nearest" sort option?** Not with the currently-recommended default (Strategy C) — it needs no user-facing control since its changes are subtle same-time reordering only. This becomes worth reconsidering only if a future phase adopts a more visibly aggressive strategy (D or beyond) as an optional alternative view rather than the default.

**I. Does the evidence strengthen or weaken the case for Map View?** Mildly weakens the case for building it soon — an accurately time-and-distance-ordered list plus the existing Directions link already covers a meaningful share of "help me find something nearby" without a map, reinforcing (not overturning) Phase 4.0's original deferral, which remains grounded primarily in that phase's own coverage/cost findings.

**J. What exact ranking strategy should Phase 4.3B implement?** Strategy C (time-group → startMinutes → distanceKm tie-break) plus the deterministic `session.id` final key from §15 — applied only when `userLocation.status === "granted"` (per Part 10: with no location, ranking stays exactly as it is today, since distance simply isn't available to break ties with, and that's not a degraded experience, just today's honest baseline).

---

Stopping here, as instructed. No production ranking code was modified. Phase 4.3B (implementation) has not been started, no Map View work has begun, and no user-facing sort control was built.
