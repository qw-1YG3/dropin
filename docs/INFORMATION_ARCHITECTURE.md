# Information Architecture

This document describes DropIn at a system level. See `docs/PRODUCT_PHILOSOPHY.md` for the mission and core design principles this architecture exists to serve, `docs/PRODUCT_PRINCIPLES.md` and `docs/SEARCH_PRINCIPLES.md` for supporting detail, and the individual design previews under `/design` for page-level implementation.

**This document supersedes the previous three-page architecture** (Homepage → Results → Detail). That structure is retired — see Revision Notes for why.

## Product Structure

```
Search Surface (one persistent shell)
├── header (persistent across all states): wordmark · location · info icon
├── State: Discovery (default)
├── State: Searching (transient, live suggestions)
├── State: Results (search resolved)
└── Overlays (available from any state; underlying content stays visible beneath)
    ├── Quick Action Sheet — opened by selecting a result
    └── Product Information Sheet — opened by the header's info icon
```

One persistent surface, three states, two sheet overlays. Not three pages. Movement between Discovery, Searching, and Results is a **state transition**, never a page navigation — no route change, no reload, no context loss.

## Search: The Product, Not a Feature

Per `docs/PRODUCT_PHILOSOPHY.md`: Search is not a page and not a capability one screen lends to another — it *is* the surface. The search input persists across every state, simply changing size and prominence:

- **Discovery state:** large, hero-level — the primary thing on screen.
- **Results state:** the same input, demoted to secondary once the page's job has shifted from "what do you want" to "which one do you choose."

Search is responsible for, in every state: being the primary entry point into the product, understanding user intent (forgiving, tolerant of imperfect input — see `docs/SEARCH_PRINCIPLES.md`), and never punishing imperfect input with a dead end.

## Location Context

DropIn maintains **one shared, persistent location context** used across the entire Search Surface — not a per-state or per-page copy. Examples of what it can hold: `Near Me` (default, inferred silently via geolocation), a named place (`North York`), or a postal code (`M2N`).

- **Set initially** via silent inference, shown as an editable ambient pill (`📍 Near you`) — never asked as an upfront question.
- **A search that is purely a location** (typing just a neighbourhood, city, or postal code with no activity) updates this persistent context directly — the user is explicitly telling search where they are.
- **A location detected as part of a mixed query** ("Swimming Scarborough") does *not* update the persistent context — it's a temporary override scoped to that one search. The persistent context is restored automatically as soon as the query is cleared or a new search without a location term is run.
- **Read identically by Discovery State, Results State, and the Quick Action Sheet** (e.g. for computing directions) — always the *effective* location for the current search (override if one is active, otherwise the persistent context). One source of truth, no state maintains its own copy.

Full mechanics — intent detection, how mixed queries are parsed, and exactly when an override applies versus updates the persistent value — are specified in `docs/SEARCH_ENGINE.md`, the canonical source for this behavior. This section states the outcome; that document states the rule.

## Scope Controls vs. Ranking Decisions

Unchanged reasoning from the prior version — still holds under the new architecture.

The Decision Principle ("whenever the system can confidently infer intent, it should, instead of asking the user to decide") is why there is no manual sort control anywhere on the Search Surface. Time Scope (Today vs. This Week) remains user-facing, and this is intentional:

- **Ranking decisions** (like the removed Soonest/Closest sort) have a computable best answer — a blended relevance score approximates it well enough that asking adds friction without adding value.
- **Scope controls** (Time Scope, and the activity Filter Chips) define *what's being looked at*, not *what order it's shown in*. There's no correct answer the system can infer for "how far ahead do you want to plan" — that depends on the user's own unstated plans. Time Scope is the same category as the Filter Chips, not the same category as the removed Sort toggle.

## Responsibility of Each State

**Discovery (default)**
- Show real nearby activities immediately — not a teaser, not marketing, the product itself
- Offer activity shortcuts and verified filters (e.g. "Free") as zero-typing entry points
- Never show a category that requires data we can't verify (no "Popular," no "Trending," no "Family Friendly")

**Searching (transient)**
- Surface live, forgiving suggestions without hiding what's already visible beneath
- Never itself the destination — always resolves into Results or reverts to Discovery

**Results**
- Compare activities
- Reduce decision effort
- Refine results (filter chips, Time Scope)

**Quick Action Sheet** (not a screen — an overlay)
- Action, not browsing: Directions (primary), Official Website / Call / Share (secondary)
- The list underneath always stays visible; dismissing the sheet never re-navigates or resets scroll position

**Product Information Sheet** (not a screen — an overlay)
- Build trust through brevity: what DropIn is, where the data comes from, how to give feedback
- Explicitly not a place to explain internal product decisions — see `docs/PRODUCT_PHILOSOPHY.md`'s "Build Trust" principle

## Information Hierarchy

**Discovery state**
1. Search (large)
2. Activity shortcuts + verified filters ("Free")
3. Live results (real nearby-right-now sessions, same card component Results uses)

**Results state**
1. Search (demoted)
2. Filter Chips
3. Result Summary
4. Activity Cards (day-grouped)

**Quick Action Sheet**
1. Brief recap (Activity, Time, Centre)
2. Directions (primary action)
3. Official Website / Call / Share (secondary actions)

## User Journey

The complete MVP flow, no page navigation anywhere in it:

```
App opens → Discovery state
   (location inferred silently; real nearby-right-now results already visible — zero taps, already useful)
      ↓
Known Intent: type a query, or tap an activity shortcut          Discovery Intent: already looking at it
      ↓                                                                    ↓
Searching state (live suggestions, still over visible results)             │
      ↓                                                                    │
Results state (search bar demotes, filter chips + Time Scope appear) ◀─────┘
      ↓
Tap a card → Quick Action Sheet slides up, list stays visible beneath
      ↓
Tap Directions → native Maps app opens, address pre-filled
      ↓
"I'm on my way."
```

Common case, honestly counted: one tap to search (or none, if Discovery's default is already what's wanted), one tap to choose, one tap to go.

## Design Principles

Full authoritative list lives in `docs/PRODUCT_PRINCIPLES.md` and `docs/PRODUCT_PHILOSOPHY.md` — referenced here, not duplicated, so the documents can't silently drift apart.

## Future Expansion

How future ideas fit into the Search Surface without reintroducing pages:

- **Saved activities** — a lightweight addition to Discovery state, not a new screen.
- **Recently searched** — feeds Searching state's suggestions; doesn't touch Results or the sheets.
- **Personalization** — influences relevance ranking and which activity shortcuts appear in Discovery; no new states.
- **Maps** — a secondary List/Map toggle within Results state — additive, not a new top-level surface.
- **AI recommendations** — an enhancement to Discovery state's default ranking, not a competing entry path.

None of these require reintroducing a page. That's the actual test of whether the Search Surface model holds up: every future idea should be able to slot into an existing state or sheet.

---

## Revision Notes

- 2026-07-30 — Initial version of this document.
- 2026-07-30 — Removed Search as a step in Product Structure, gave it its own "Search: A Shared Capability" section. Added Location Context and "Scope Controls vs. Ranking Decisions."
- 2026-07-30 — **Major rewrite.** Retired the three-page architecture (Homepage → Results → Detail) entirely, following the Product Architecture Review. Replaced with one persistent Search Surface with three states (Discovery, Searching, Results) and two overlay sheets (Quick Action Sheet, Product Information Sheet). Detail as a full page is gone — replaced by the Quick Action Sheet. Homepage and Results are no longer separate pages — Discovery state and Results state are two states of the same surface, which also resolves a redundancy the old architecture had: Homepage's "Happening Soon" preview and the Results list were the same kind of content, built twice. Location Context and Scope Controls reasoning carried forward unchanged, since both were already page-agnostic in substance.
- 2026-07-31 — Documentation Sync Sprint: rewrote Location Context to state the finalized three-part behavior (persistent default, temporary search-location override, restoration on clear) and to point to `docs/SEARCH_ENGINE.md` as the canonical source for the underlying mechanics, rather than restating a coarser version of the same rule that could drift out of sync with it.
