# Visual Language

This document is the authoritative visual design system for DropIn — not page-specific styling, but the language every screen inherits from. The operating idea behind every decision below: **the interface should be quiet by default, so the few things that actually matter can be confident without the page ever feeling busy.** That single mechanism is what lets "calm" and "confident" coexist rather than trade off.

## Brand Personality

DropIn should feel:

- Calm
- Friendly
- Trustworthy
- Human
- Spacious
- Modern
- Confident

DropIn should never feel:

- Corporate
- Government
- Dashboard
- Technical
- Busy

## Visual Principles

Every visual decision is checked against these:

- Reduce Thinking, Not Information
- One Decision Per Screen
- Activity First
- Comfortable Before Beautiful
- Simplicity over Feature Completeness

Whitespace is treated as a design element, not leftover margin. Typography creates hierarchy through size and weight, not decoration. The test for any screen: if it looks "efficient" rather than "calm," it doesn't have enough space in it yet.

## Typography

Geist Sans throughout (already in the project — a second typeface would itself be a "busy" decision). Hierarchy comes from size and weight, not color:

| Role | Size | Weight | Where |
|---|---|---|---|
| Card primary (Activity Name) | 18px | Bold | Every card, everywhere |
| Card secondary (Time) | 15px | Semibold/Medium | Every card |
| Supporting text (Centre, Distance) | 14px | Regular | Every card |
| Micro/meta (Price, section labels, trust line) | 12–13px | Regular, muted | Everywhere |

Three steps, deliberately not more — enough for real hierarchy, not so many the scale itself becomes noise. (The scale previously included a "Page headline" row for a rhetorical question above the search bar; that was removed when Discovery State was first built. Production V1's "What would you like to do today?" line is a different thing, not a reversal of that decision: it sits *below* the search bar as a quiet label for the shortcut chips beneath it — smaller than a headline, after the search, and real results are still visible without it. The search bar remains the first thing on screen; nothing asks "what do you want" before showing something real.)

## Spacing

Base-8 scale (8 / 16 / 24 / 32 / 48px), applied generously:

- Card internal padding: 20–24px
- Gap between cards: 12–16px
- Page horizontal margin: 16px mobile; centered `max-w-2xl` on larger screens
- Gap between sections (search / filters / results): 24–32px

## Colour Philosophy

Colour reinforces hierarchy — it never replaces it. The interface relies primarily on whitespace, typography, and spacing to create structure; colour is layered on top only where it carries real meaning.

- **One soft neutral background** (`#faf9f7`), not stark white — pure white reads clinical under prolonged use; warm off-white reads calm.
- **One confident accent, used sparingly** — muted teal (`#0f766e`), continued from Homepage High-Fidelity rather than reinvented, because introducing a second accent for a different page would fragment the product on day one. Reserved for: focus states, selected controls, and the one piece of urgency-adjacent text ("Happening soon"). If it appeared everywhere, it would stop meaning anything — restraint is the entire source of its power to draw the eye when it matters.
- **Neutral grayscale for everything else.** No second competing accent, anywhere.
- **Status colour only where it communicates something real** — small and restrained (e.g. a Walk-in dot), never a loud badge, never decorative.

## Card Language

- Generously rounded corners (`rounded-2xl` territory) — rounded reads approachable and friendly; sharp corners read technical.
- Near-invisible border by default; a soft shadow appears only on hover/interaction, not as a permanent decoration — a hard border everywhere is the "dashboard" tell, while a card that gently lifts on interaction reads as a physical, tactile object.
- Whole-card tap target — no separate button competing with the card itself.
- Information order is fixed and inherited from the approved Low-Fidelity hierarchy (Activity Name → Time → Community Centre + Distance → Price) — visual polish does not reopen that decision.

## Search Language

One shape language, two scales — this is what "Search is the product, not a page-specific feature" should look like visually:

- **Discovery State:** large, generously rounded, soft shadow, accent-coloured focus ring — the hero element.
- **Results State:** identical shape language, meaningfully smaller and quieter (thinner border, less padding) — the same trusted control, just not the loudest thing on the surface anymore.

Searching State doesn't get its own scale — it's Discovery State's large search bar with a suggestions dropdown layered on top, not a third visual treatment.

## Motion Principles

Governing rule: **motion only ever confirms something the user just did — it never draws attention to something they weren't already interacting with.** No auto-playing animation, no idle pulses or bounces. Concretely: soft hover elevation on cards, smooth colour transitions on chip/button state changes, a gentle focus-ring transition on search, short durations (100–200ms — fast enough to feel responsive, not performative), everything gated behind `prefers-reduced-motion`.

## Icon Philosophy

Icons aid recognition at a decision point — never decoration. They belong where a user is choosing what to search for (Discovery State's quick-start chips) or confirming they've landed on the right thing after a context switch (the Quick Action Sheet's header, opened as its own overlay) — not where a user is comparing sessions they've already found side by side (Results State cards), where an icon next to a name already bold on the card is redundant, not helpful. One custom stroke-based icon set throughout (consistent weight, rounded caps, single colour) — no icon library, no mixed styles, and explicitly no emoji: tested and rejected earlier in this project for conflicting with the colour system, failing for screen readers, and being semantically unreliable (a cucumber does not read as "pickleball").

## Component Behaviour

Interactive elements share one behavioural contract rather than each inventing its own states:

- Every interactive element has a default, hover, focus-visible, and (where applicable) selected state.
- States are communicated through weight, colour intensity, or elevation — never by introducing a new colour.
- `focus-visible` always uses the accent-coloured ring, consistently, everywhere.
- Hover is always a subtle tint or elevation change — never a jarring or high-contrast shift.
- Selected state (chips, toggles) always uses the same accent fill, so "this is currently chosen" looks identical everywhere it appears.

## Avoid

Patterns that should never become part of DropIn, and why:

- **Heavy shadows** — reads dated or overly dramatic; conflicts with Calm. Elevation should be soft and only appear on interaction, never as permanent decoration.
- **Dashboard-style layouts** — dense grids and simultaneous data panels optimize for monitoring many things at once. DropIn optimizes for deciding one thing. Directly conflicts with One Decision Per Screen.
- **Dense information** — cramming data points to look "efficient" increases cognitive load, which is exactly what Reduce Thinking, Not Information exists to remove.
- **Decorative animations** — motion used for delight or attention rather than confirmation conflicts with the Motion Principles' "confirm, don't attract" rule and with Calm generally.
- **Multiple competing accent colours** — dilutes the one accent's meaning-carrying power. If everything is emphasized, nothing is.
- **Excessive icon usage** — icons stop aiding recognition and become noise, conflicting with Icon Philosophy and Comfortable Before Beautiful.
- **Government-style interfaces** — dense navigation, bureaucratic tone, directory-first browsing. This is the specific pattern DropIn exists to reverse; it cannot leak back in through visual style even if the underlying architecture stays activity-first.

---

## Revision Notes

- 2026-07-30 — Initial version, formalizing the visual direction proposal discussed prior to Results Page High-Fidelity. Carries forward and codifies choices already made in Homepage High-Fidelity (teal accent, neutral surface background, Geist Sans, custom icon set) rather than introducing new ones, since a visual language that forks per page isn't a language.
- 2026-07-31 — Documentation Sync Sprint: this document predated the Search Surface rewrite and still referred to "Homepage" and "Results" as pages throughout (Typography, Search Language, Icon Philosophy). Updated to Discovery State / Searching State / Results State. Also removed the Typography scale's "Page headline" row — that headline no longer exists in the built product (Discovery State intentionally has none), so keeping the row, even renamed, would have described a fictional element. Historical references to "Homepage High-Fidelity" as a named build stage (Colour Philosophy provenance, earlier Revision Notes) were left as-is — those are accurate historical record, not current architecture claims.
- 2026-08-02 — Production V1: reconciled two real conflicts between this document and what's actually built, rather than leaving them silently contradicted. Typography: Production V1 added a quiet explore-copy line back into Discovery — clarified this isn't a reversal of the earlier "Page headline" removal, since it's smaller, positioned after the search bar, and labels the shortcuts rather than gating results behind a question. Icon Philosophy: the Quick Action Sheet header now carries an activity icon, which is a real exception to "not on cards you're comparing" — justified because opening the sheet is itself a context switch and confirmation point, not a comparison view, and explicitly not "just decoration creeping back in." Also made the existing no-emoji stance explicit here rather than leaving it only as team memory, since it was directly tested against during this sprint.
