# Search Engine Specification

This is the canonical behavioral reference for how DropIn's search resolves a query into results — written before any backend or database implementation exists, so that implementation has a fixed target rather than being designed ad hoc. It describes *behavior*, not algorithms, data structures, or storage. See `docs/SEARCH_PRINCIPLES.md` for the philosophy this pipeline serves, and `docs/INFORMATION_ARCHITECTURE.md` for how Location Context and Search fit into the product overall.

## Supported Search Intents

Five intents. A query may express one, several combined, or none clearly.

- **Activity** — a sport, program, or class name or synonym ("badminton", "swim", "ping pong"). Resolves to one or more canonical Activities via the Activity/Group/Category model.
- **Community Centre** — a specific named facility ("Regent Park Community Centre," or an informal partial like "Regent Park CC").
- **Neighbourhood** — an informal geographic area name ("North York," "Scarborough," "The Beaches") — distinct from a Municipality and distinct from a Community Centre name, though the three can overlap in casual language (e.g., "Regent Park" names both a neighbourhood and a centre).
- **City / Municipality** — the municipality a session belongs to ("Toronto," "Mississauga," "Markham"). Not MVP-scoped to a single city: DropIn's target coverage is the GTA and beyond, and this intent resolves against whichever municipalities are actually registered as data sources (see `docs/ARCHITECTURE.md`'s Multi-Municipality Support). A recognized-but-not-yet-integrated municipality is a distinct, honest outcome from "no match" — see Empty/No-Results Behavior.
- **Postal Code** — a Canadian postal code, full or FSA-only ("M5A 1C7" or just "M5A"). FSA-level precision is the expected common case — most users won't type a full postal code, and FSA is sufficient for neighbourhood-scale location. Understood, but deliberately not the primary interaction model — see Intent Detection Priority.

## Intent Detection Priority

Detection runs in this order:

1. **Activity — checked first, and checked generously.** Per Product Philosophy's "Search is the Product" and Activity First, Activity is the default assumption and DropIn's primary mental model. Matching runs against canonical names, synonyms, and keywords (the Activity/Group/Category term model).
2. **Community Centre — reference-list lookup.** Checked against the known set of facility names for whichever municipalities are registered.
3. **Neighbourhood — reference-list lookup**, same mechanism as Community Centre, against a different known list.
4. **City / Municipality — reference-list lookup** against registered and target municipality names.
5. **Postal Code — pattern-based, checked last.** A Canadian postal code has an unmistakable shape (letter-digit-letter, optionally followed by digit-letter-digit), so it never needs to compete for priority the way the reference-list intents do — it's understood whenever typed, but deliberately not positioned as the primary interaction model, so it doesn't get first claim on ambiguous input.
6. **Fallback** — if nothing matches confidently, attempt forgiving/typo-tolerant Activity matching (per `docs/SEARCH_PRINCIPLES.md`'s Forgiving Search) before conceding to the no-results behavior below.

Within the location intents, an **exact** match on a Neighbourhood or Municipality name jumps ahead of a **fuzzy/substring** Community Centre match, regardless of the type priority above — otherwise a facility whose formal name happens to contain a place word (e.g. "Centennial Recreation Centre - Scarborough") would outrank the place itself when someone typed exactly "Scarborough." Confidence of match beats type priority when the two disagree.

## Mixed Query Parsing

Example: **"Swimming Scarborough."**

1. The query is segmented and each segment is tested against the detectors above.
2. If one segment resolves to an Activity and another resolves to a location-type intent (Neighbourhood, City, Community Centre, or Postal Code), **both apply at once**: the Activity becomes what's being searched for, and the location becomes a **Location Override** for that search (see below) — not a change to the user's standing location.
3. If a segmentation is ambiguous (e.g., multiple plausible activity substrings, or multiple plausible location substrings), prefer the interpretation that yields one valid Activity match *and* one valid location match over one that yields two matches of the same type. Between multiple candidate location matches, prefer the longer/more specific recognized term.
4. If no clean Activity+Location split exists, fall back to treating the whole query as an Activity attempt; if that fails, fall back to treating the whole query as a location attempt; only if both fail does the query reach the no-results behavior.

## Location Override vs. Persistent "Near You"

This is the detailed mechanic behind the rule summarized in `docs/INFORMATION_ARCHITECTURE.md`'s Location Context section — that document states the outcome, this section states exactly when each branch applies:

- **A query that is purely a location** (just "Scarborough," just a postal code, nothing else) — **updates the persistent Location Context**. The user is explicitly telling search where they are; that's a standing preference change, not a one-off.
- **A location detected as part of a mixed query** ("Swimming Scarborough") — a **one-time override**, scoped to that single search only. The persistent Location Context (whatever "Near You" currently resolves to) is left untouched. The reasoning: pairing a location with an activity almost always means "check this specific place" (maybe for a friend, maybe for a trip), not "I have permanently moved."
- A Location Override never silently persists. The next search that doesn't include a location term uses the persistent context again, not the previous override.
- Promoting an override into the persistent context only happens through the explicit location-pill editing flow already defined in `docs/INFORMATION_ARCHITECTURE.md` — never automatically because an override was used.
- **Community Centre is a location intent for result filtering, but never for the Location Pill's displayed text.** A pure Community Centre search still updates Search Context and still scopes results to that facility, exactly as the rule above describes for any pure location query — that part is unchanged. But the Location Pill itself (`docs/INFORMATION_ARCHITECTURE.md`'s "one shared, persistent location context") continues to display the underlying Near You value (device geolocation status, or "Near you" if none) rather than the facility's name. Reasoning: the pill communicates broad area/proximity context — "where these results are coming from" — and a single named building isn't that; showing it there both misrepresents the pill's meaning and, confirmed on a real device (Round 2 physical-iPhone QA, 2026-08-28), can wrap a long facility name across two lines and destabilize the header layout. Facility identity is surfaced in result cards and the Quick Action Sheet instead, where a specific building name is exactly the right level of detail. Municipality, Neighbourhood, and Postal Code are unaffected by this carve-out — each remains a legitimate persistent-context/pill value, same as before.

## Ranking Principles

Consistent with the Decision Principle (no manual sort, ever) and existing Ranking guidance in `docs/SEARCH_PRINCIPLES.md`:

- Results are ordered by a blended relevance score combining **time proximity** (soonest first) and **distance** (closest first). Neither is user-selectable.
- Distance is computed relative to whichever location is in effect for that search — the Location Override if one was detected, otherwise the persistent Near You context.
- **Verification status never affects ranking order.** Per the broad-coverage-over-perfect-verification decision made during Homepage IA, an unverified session ranks exactly where its time/distance would place it — verification is communicated only as a badge, never as a position penalty. Ranking must not quietly punish broad coverage.
- When an Activity resolves to a Group or Category (broader match, multiple canonical Activities), the union of matching sessions is ranked by the same time/distance blend — no canonical Activity within the resolved set is favored over another.

## Empty / No-Results Behavior

Four distinct situations, each needing different messaging — conflating them would misrepresent what the system actually knows:

- **A near match exists** (typo, or a synonym gap) — auto-resolve and say so plainly: "Showing results for Table Tennis."
- **The query didn't resolve to anything recognized** (neither Activity nor location) — never a blank page. Fall back to Discovery Intent scoped to the persistent Near You context, with a line acknowledging the miss: "We couldn't find '[query]' — here's what's on nearby instead."
- **The query resolved perfectly, but there are genuinely zero matching sessions** (e.g., a real Activity, a real Neighbourhood, no sessions exist for that pair right now) — this is not a failure to understand, and shouldn't be phrased like one. Say so specifically: "No [Activity] sessions found near [Location] right now," and offer a concrete way forward (widen to all of Toronto, or see other activities near that location) rather than a generic dead end.
- **The query resolved to a real municipality that simply isn't integrated yet** (e.g. "swimming Markham") — this is neither "unrecognized" nor "genuinely zero results," and phrasing it like either would be dishonest: "unrecognized" implies the name meant nothing, "zero results" implies we checked Markham and it had none. Neither is true — we haven't checked, because there's no data source for it yet. Say so directly: "DropIn doesn't cover [Municipality] yet — here's what's available in [nearest covered municipality] instead." This is the one situation where "no dead end" doesn't mean "keep looking within this municipality" — it means "hand back to somewhere DropIn can actually answer."

## Search State Transitions

This closes the one previously undefined behavior flagged in the last architecture review: what happens when a user types but never explicitly submits.

- **While actively typing**, the surface stays in Searching state: live suggestions appear over the still-visible Discovery results, exactly as already specified in `docs/INFORMATION_ARCHITECTURE.md`. Nothing commits yet.
- **~300ms after the last keystroke**, if the query is non-empty and hasn't already been explicitly committed, it **auto-commits** — the surface transitions to Results state using the current query, identically to an explicit commit. This is the resolution for the "typed but didn't submit" case: a pause is treated as an implicit submission, not a stuck state.
- **Enter, tapping a suggestion, or tapping a quick-start chip commits immediately**, bypassing the debounce entirely — the user has already told the system they're done.
- **Clearing the query** (deleting back to empty) immediately returns the surface to Discovery state — no debounce in this direction, since there's nothing ambiguous about an empty box.

The debounce exists so a user typing "swim" one letter at a time doesn't visibly re-resolve and re-rank results on every keystroke — but it never requires an explicit action to reach Results. Silence is itself a signal.

## Search Pipeline

```
Normalize → Intent Detection → Search Context → Search → Rank → Results
```

1. **Normalize** — trim, case-fold, collapse whitespace. Purely mechanical; no interpretation of meaning happens here yet.
2. **Intent Detection** — classify the normalized query into typed segments (Activity / Community Centre / Postal Code / Neighbourhood / City) per the priority order above.
3. **Search Context** — combine the detected intents with the current persistent Location Context to produce the one effective context for this query: which location distance is computed from (override if present, else persistent), which Activity/Group/Category scope applies (if any), and the active Time Scope (Today/This Week).
4. **Search** — retrieve every session matching the resolved Activity scope (or all activities, for an unscoped Discovery-style query) within the resolved location context. This is candidate retrieval, before any ordering is applied.
5. **Rank** — apply the blended time/distance relevance score to order the candidate set, per Ranking Principles.
6. **Results** — present the ranked, scoped set through the existing Results state UI (cards, filter chips derived from the resolved Activity taxonomy, Time Scope control), including the correct one of the three empty-state messages when applicable.

---

## Revision Notes

- 2026-07-31 — Initial version. Written specifically to close the gap the Search Surface audit surfaced: Universal Search (Activity / Community Centre / City / Postal Code / Neighbourhood) was documented as a decision in `docs/SEARCH_PRINCIPLES.md` but had no behavioral specification precise enough to implement against. This document is that specification, and additionally refines the Location Context spec in `docs/INFORMATION_ARCHITECTURE.md` with the override-vs-persistent distinction that mixed-query parsing requires.
- 2026-07-31 — Documentation Sync Sprint: added the Search State Transitions section, resolving the previously open "typed but never submitted" question with a canonical debounce (~300ms auto-commit) rule. Reworded Location Override framing now that `docs/INFORMATION_ARCHITECTURE.md` has been updated to match this document, rather than describing it as the coarser, out-of-sync version it was before.
- 2026-08-02 — Production V1: the ~300ms debounce auto-commit specified above is now actually implemented (it had been written but not built since 2026-07-31). Intent Detection Priority reordered — Activity now checked first and Postal Code last, matching the canonical Production V1 direction rather than the earlier shape-based-detection-first reasoning; added the exact-match-beats-fuzzy-match rule that the reordering surfaced as a real bug during implementation (a facility named "Centennial Recreation Centre - Scarborough" was outranking the Scarborough neighbourhood itself). Replaced City with City/Municipality throughout and pointed it at `docs/ARCHITECTURE.md`'s Multi-Municipality Support instead of the old Toronto-only MVP framing. Added the fourth Empty/No-Results case for a real-but-not-yet-integrated municipality, distinct from both "unrecognized" and "genuinely zero results" — verified two real examples (Mississauga, Markham) genuinely have no integrable open data before writing this, rather than assuming.
- 2026-08-28 — Added the Community Centre carve-out to Location Override vs. Persistent "Near You", closing a gap Round 2 physical-iPhone QA surfaced: searching a facility (e.g. "Oakridge") correctly filtered results but also replaced the Location Pill's "Near me" text with the full facility name, which read as a semantic error (a single building isn't the user's area/proximity context) and, on a real phone, could wrap onto two lines and distort the header. Investigation traced this to `locationPillLabel()` in `app/page.tsx` rendering any `effectiveLocation.label` unconditionally, with no branch on location type. Fixed at the display layer only — `type: "centre"` is now excluded from what the pill renders, falling back to the ordinary Near You value instead. Community Centre's role in result filtering (Search Context, ranking, `sessionMatchesLocation`) is completely unchanged. A separate, still-open gap — DropIn has no vocabulary for informal community names within a municipality (e.g. "Unionville" in Markham) — was identified in the same QA round and is deliberately **not** addressed here; see `docs/LAUNCH_READINESS_PLAN.md` for its tracked, deferred status.
