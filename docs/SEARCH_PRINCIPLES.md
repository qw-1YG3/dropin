# Search Principles

Search is DropIn's primary entry point into the product, not just an input field. This document is the authoritative reference for search product behaviour and interaction design. Technical implementation (matching algorithms, ranking formulas, etc.) is intentionally out of scope here.

## Search Philosophy

- Core rule: search should reduce user effort, not require user precision. Whenever there is ambiguity, prefer helping users find the most likely intended activity over requiring exact input.
- Expectation principle: if a reasonable user would expect a search to work, it should probably work. Examples: "Swimming", "Ping Pong", "North York", "M2N", "Regent Park Community Centre" should all work. Natural language queries such as "badminton tonight under $5" intentionally wait for a future version.
- Universal Search: search scope is broad, search intelligence evolves gradually. Users should reasonably be able to search by Activity, Community Centre, City, or Postal Code — but the two categories get different levels of matching intelligence in the MVP (see Forgiving Search below).
- Regardless of what triggered a search — an activity name, a community centre, a city, or a postal code — **the result is always an activity-first, relevance-ranked list of individual sessions, never a directory or browse view of a place.** A city or postal code query recentres the location context and runs the same relevance-ranked search from there. A specific, uniquely-identified community centre name may scope results to that one place, but is still presented as a ranked list of sessions at that centre, not a directory page for the centre itself. This is what keeps Universal Search from becoming Universal Browse — the input gets broader, the output shape never changes.

## Interaction Patterns

Three distinct mechanisms exist and are never interchangeable:

- **Homepage Quick-start Chips** — static shortcuts to popular activities. Purpose: help users start searching quickly. Not filters, and not suggestions.
- **Typing Suggestions** — temporary autocomplete suggestions shown while typing, drawn from canonical activity names only (never raw source strings). Help users complete a query. Disappear after a selection or search. Not filters.
- **Results Filter Chips** — context-aware filters generated from the resolved search result, used to refine the current result set. Example: Swimming → Lane Swim / Leisure Swim / Family Swim. Badminton → Adult / Family / Open Play.

## Forgiving Search

Matching intelligence differs by data type for the MVP:

- **Activity queries:** prefix matching, typo tolerance, synonym matching, relevance ranking.
- **Location / Community Centre / Postal Code queries:** exact or standard matching is sufficient for MVP. Advanced fuzzy matching and ranking for this category can come later.

## Ranking

No manual sort exists in the MVP. Results are always ranked by the system's blended relevance score (time, distance, and context combined) — never a user-facing choice between, e.g., "soonest" and "closest." This applies uniformly regardless of query type: a location-scoped search still ranks by relevance, not simply by proximity to the searched point.

## Synonyms

Synonym resolution runs through the Activity/Group/Category term model (synonyms, keywords, raw source values, future locale aliases). When a query matches a synonym rather than a canonical name, the match is auto-resolved and clearly labelled rather than silently substituted — e.g. searching "Ping Pong" shows "Showing results for Table Tennis."

## Empty States

Never a dead end. Two cases:

- **A near match exists** (typo, or a synonym gap): auto-resolve to it and state clearly what's being shown — e.g. "Showing results for Table Tennis."
- **No reasonable match exists at all** (e.g. "Football", or a query DropIn genuinely has no data for): avoid an empty page. Gracefully guide the user toward nearby alternatives or Discovery Intent instead of a blank state.

## Placeholder

`Search activities, centres or postal codes` — names the searchable categories directly so a first-time user understands scope immediately, rather than leaning on examples (which mattered more when the box was activity-only and needed to reassure about forgiveness; now the main onboarding job is communicating breadth).

## Future Enhancements

- Natural language queries (e.g. "badminton tonight under $5")
- Personalized or popularity-ranked Homepage quick-start chips
- Multilingual query parsing (the term data model already supports locale aliases; parsing behavior does not exist yet)
- Voice search
- Advanced fuzzy matching and ranking for location/centre/postal code queries
- A dedicated centre-browse mode, if ever justified by real user need

---

## Revision Notes

- 2026-07-30 — First real population of this document (previously placeholder headings only). Added the Interaction Patterns and Placeholder sections, which didn't fit cleanly under the original six headings. One addition beyond what was explicitly specified: the "results are always an activity-first ranked list, never a directory/browse view" principle under Search Philosophy — proposed as the safeguard that keeps Universal Search from reintroducing centre-first browsing through the back door. Flagging for confirmation since it's the one place I extended the brief with my own reasoning rather than transcribing a given decision.
