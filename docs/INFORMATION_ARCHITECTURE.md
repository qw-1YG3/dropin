# Information Architecture

This document describes DropIn at a system level — how the screens relate to each other and to the product's purpose — rather than page-by-page UI. See `docs/PRODUCT_PRINCIPLES.md`, `docs/SEARCH_PRINCIPLES.md`, and the individual design previews under `/design` for page-level detail.

## Product Structure

```
Homepage
   ↓
Results
   ↓
Detail
```

Three screens. Search is deliberately not shown as a step here — see below.

## Search: A Shared Capability

Search is not a page and not a step in the flow above. It's a capability shared by Homepage and Results:

- **On Homepage:** primary, the hero-level interaction the whole page exists to support.
- **On Results:** the same capability, still present and functional, but demoted to secondary — the page's job has shifted from "what do you want" to "which one do you choose."

Wherever it appears, Search is responsible for:
- Being the primary entry point into the product
- Understanding user intent (forgiving, tolerant of imperfect input — see `docs/SEARCH_PRINCIPLES.md`)
- Never punishing imperfect input with a dead end

## Location Context

DropIn maintains a **single shared location context** used across the entire product — not a separate location state per page.

Examples of what it can hold: `Near Me` (default, inferred silently via geolocation), a named place (`North York`), or a postal code (`M2N`).

- **Set initially** on the Homepage via silent inference, shown as an editable ambient pill (`📍 Near you`) — never asked as an upfront question (see the original Homepage journey reasoning: asking "where are you" first would revert to a location-first product).
- **Can also be changed** via Universal Search — typing a city or postal code into the search box, on either Homepage or Results, updates this same shared context. It does not create a page-local override.
- **Read by Homepage, Results, and Detail alike.** Detail's exact use of it (e.g. computing directions) is a decision for Detail's own dedicated IA phase, but it commits to reading the same shared value, not maintaining its own.

This directly closes the state-consistency gap flagged in the last review: no matter where location is set, every screen reads the same value, so a search typed on Results and a pill edited on Homepage can never desync.

## Scope Controls vs. Ranking Decisions

The Decision Principle ("whenever the system can confidently infer intent, it should, instead of asking the user to decide") removed manual sorting (Soonest/Closest) from the Results page. Today/This Week — the **Time Scope** control — remains user-facing, and this is intentional, not an oversight or an exception to the principle. Ranking decisions and scope controls are different in kind:

- **Ranking decisions** (like Soonest vs. Closest) have a computable best answer. A blended relevance score can reliably approximate "what most users want" well enough that asking the user to choose adds friction without adding real value. This is exactly what the Decision Principle targets.
- **Scope controls** (Time Scope — Today vs. This Week — and the activity Filter Chips) define *what's being looked at*, not *what order it's shown in*. There is no single correct answer the system can infer for "how far ahead do you want to plan" — it depends on the user's own unstated plans (spontaneous tonight vs. checking what's on Saturday), which the system has no signal to infer from. Time Scope is the same category of control as the Filter Chips, not the same category as the removed Sort toggle.

The Decision Principle asks the system to stop making users choose things it can figure out on its own. It was never an argument against every user-facing control — scope and filtering remain legitimate, because there's genuinely nothing to infer.

## Responsibility of Each Screen

**Homepage**
- Discover
- Start searching
- Quick-start activities

**Results**
- Compare activities
- Reduce decision effort
- Refine results

**Detail**
- Verify information
- Official links
- Phone
- Directions

## Information Hierarchy

**Homepage**
1. Search
2. Quick-start activities
3. Discovery

(This is the system-level summary. The full section-by-section breakdown — header, headline, search, chips, discovery CTA, Happening Soon strip, data transparency, footer — is documented in the Homepage IA phase and the `/design/homepage-*` previews.)

**Results**
1. Search
2. Filter Chips
3. Result Summary
4. Activity Cards

**Detail** *(not yet built — sketched here at system level only; still requires its own dedicated IA phase before Low/High-Fidelity, per the project workflow)*
1. Activity
2. Time
3. Location
4. Official Information
5. Actions

## User Journey

The complete MVP flow:

```
User opens Homepage
   ↓
Searches (Known Intent — a specific activity) or browses (Discovery Intent — "show me what's nearby")
   ↓
Reviews Results — a relevance-ranked list of individual sessions, not a directory of centres
   ↓
Chooses an activity
   ↓
Verifies details on the Detail page (fee, access, cancellations — via official source, phone, or directions)
   ↓
Navigates to the community centre
```

Both Known Intent and Discovery Intent converge on the same Results page and the same card format — they differ only in what filters the initial result set, never in the page structure itself. The entire flow is designed around a single measure of success: a first-time user should be able to go from opening the Homepage to knowing exactly where to go within about 30 seconds.

## Design Principles

The principles that shape this architecture (full authoritative list lives in `docs/PRODUCT_PRINCIPLES.md` — referenced here, not duplicated in full, so the two documents can't silently drift apart):

- Activity First
- Search First
- One Decision Per Screen
- Reduce Thinking, Not Information
- Comfortable Before Beautiful
- Simplicity over Feature Completeness
- Never imply certainty when data cannot support it

## Future Expansion

How future ideas fit into the existing architecture without disrupting the current MVP experience:

- **Saved activities** — would live as an additional lightweight section on the Homepage (below Happening Soon, or as its own quiet entry point), not a new screen or navigation structure.
- **Recently searched** — a Homepage or Search-layer enhancement (feeds Typing Suggestions with recent queries), doesn't change Results or Detail at all.
- **Personalization** — influences ranking (relevance scoring) and which Quick-start Chips appear; doesn't introduce new screens or change the information hierarchy of any existing page.
- **Maps** — a secondary view toggle on the Results page (List/Map), already anticipated in the original user journey work — additive to Results, not a replacement or a new top-level screen.
- **AI recommendations** — most naturally an enhancement to Discovery Intent (a smarter "what's nearby" default), not a new decision point or a competing entry path to Known Intent search.

None of these require redesigning the MVP; they all slot into an existing screen's responsibility rather than creating a new one.

---

## Revision Notes

- 2026-07-30 — Initial version of this document.
- 2026-07-30 — Removed Search as a step in Product Structure (was: Homepage → Search → Results → Detail; now: Homepage → Results → Detail), and gave it its own "Search: A Shared Capability" section instead of listing it alongside real screens. Added the Location Context section to establish a single shared location state across Homepage/Results/Detail, closing the state-consistency gap flagged in the prior architecture review. Added "Scope Controls vs. Ranking Decisions" to resolve the apparent tension between keeping Today/This Week and the Decision Principle — they are different categories of control, not an exception to the principle.
