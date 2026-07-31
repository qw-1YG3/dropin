# Search Principles

Search is DropIn's primary entry point into the product, not just an input field. This document is the authoritative reference for search product behaviour and interaction design. Technical implementation (matching algorithms, ranking formulas, etc.) is intentionally out of scope here.

## Search Philosophy

- Search should reduce user effort, not require user precision.
- If a reasonable user would expect a search to work, it should probably work. Examples: "Swimming", "Ping Pong", "North York", "M2N", "Regent Park Community Centre" should all work. Natural language queries such as "badminton tonight under $5" intentionally wait for a future version.
- Never create dead ends. If a near match exists (a typo, or a synonym gap), auto-resolve to it and state clearly what's being shown — e.g. searching "Ping Pong" shows "Showing results for Table Tennis." If no reasonable match exists at all (e.g. "Football"), avoid an empty page — gracefully guide the user toward nearby alternatives or Discovery Intent instead.
- Search should become smarter over time without changing how users interact with it. As matching intelligence improves behind the scenes, the interaction pattern stays stable — improvements should never require the user to learn a new control or mode.

## Three Interaction Patterns

Clearly distinct, and never treated as interchangeable:

- **Discovery State Quick-start Chips** — static shortcuts to popular activities. Purpose: help users start searching quickly. Not filters, and not suggestions.
- **Typing Suggestions** — temporary autocomplete suggestions shown while typing, drawn from canonical activity names only (never raw source strings). Help users complete a query. Disappear after a selection or search. Not filters.
- **Results Filter Chips** — context-aware filters generated from the resolved search result, used to refine the current result set. Example: Swimming → Lane Swim / Leisure Swim / Family Swim. Badminton → Adult / Family / Open Play.

## Universal Search

For MVP, users can search by:

- Activity
- Community Centre
- Postal Code
- Neighbourhood
- City

Matching intelligence differs by type:

- **Activity search** supports prefix matching, typo tolerance, synonyms, and intelligent ranking.
- **Location-based search** (Community Centre, Neighbourhood, City, Postal Code) only requires standard/exact matching for MVP — advanced fuzzy matching and ranking for this category can come later.

Regardless of query type, the result is always an activity-first, relevance-ranked list of individual sessions — never a directory or browse view of a place. This is what keeps Universal Search from becoming Universal Browse — the input gets broader, the output shape never changes.

How a query is actually parsed into these intents — detection priority, mixed queries like "Swimming Scarborough," and how a detected location interacts with the persistent location context — is specified in `docs/SEARCH_ENGINE.md`, the canonical source for that behavior. Not duplicated here.

## Progressive Intelligence

What belongs in MVP versus what's intentionally deferred:

| MVP | Future |
|---|---|
| Activity: prefix, typo-tolerant, synonym matching + relevance ranking | Natural language queries (e.g. "badminton tonight under $5") |
| Location/Centre/Neighbourhood/Postal Code: standard/exact matching | Advanced fuzzy matching and ranking for location-type queries |
| Live typing suggestions, canonical names only, capped list | Personalized or popularity-ranked Discovery State quick-start chips |
| Dynamic Results Filter Chips (Group/Category-derived) | Multilingual query parsing (term data model already supports locale aliases; parsing behaviour does not exist yet) |
| Graceful no-match → nearest match or Discovery Intent fallback | Voice search |
| Single blended relevance ranking, no manual sort | A dedicated centre-browse mode, if ever justified by real user need |

## Placeholder

**Recommended:** `Search activities or locations`

Finalized during the Design Consistency Sprint as shorter than the originally proposed `Search activities, centres or postal codes` — still communicates breadth (activity vs. location), without listing every location sub-type. Used identically in Discovery State and Results State, since Search is one shared capability, not two.

## Decision Principle

Whenever the system can confidently infer user intent, it should do so instead of asking the user to make another decision.

Our goal is not to build the most configurable search. Our goal is to build the easiest way to find a drop-in activity.

This is the reason there is no manual sort control, no "did you mean X? yes/no" confirmation step for auto-resolved typos, and no separate query mode for locations versus activities — every one of those would be asking the user to make a decision the system can make for them.

Note: Today/This Week in Results State is a deliberate exception in appearance only, not in substance — see "Scope Controls vs. Ranking Decisions" in `docs/INFORMATION_ARCHITECTURE.md` for why it doesn't conflict with this principle.

---

## Revision Notes

- 2026-07-30 — Restructured around the finalized six-section format (Search Philosophy, Three Interaction Patterns, Universal Search, Progressive Intelligence, Placeholder, Decision Principle), consolidating content previously spread across separate Forgiving Search / Ranking / Synonyms / Empty States / Future Enhancements headings — no content was dropped, it was folded into the new structure. The "results are always an activity-first ranked list, never a directory/browse view" principle (flagged for confirmation last round) is now treated as agreed, since it wasn't contradicted and is restated here under Universal Search.
- 2026-07-31 — Documentation Sync Sprint: added Neighbourhood as a fifth Universal Search intent, matching `docs/SEARCH_ENGINE.md` (this document previously listed only four and was out of sync). Removed the detailed location-context recentering description from Universal Search — that behavior is now specified precisely in `docs/SEARCH_ENGINE.md` (override vs. persistent), and restating a coarser version here risked the two documents drifting apart again; this document now points there instead of duplicating. Also fixed several remaining "Homepage"/"Results page" references left over from the pre-Search-Surface architecture (Three Interaction Patterns, Progressive Intelligence, Placeholder, Decision Principle) to Discovery State/Results State.
