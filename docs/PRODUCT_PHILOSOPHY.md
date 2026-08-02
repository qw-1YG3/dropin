# Product Philosophy

This document is the fixed foundation for DropIn's product direction — mission and core design principles. Treat these as constraints, not topics for re-debate in future sessions, unless explicitly reopened.

## Mission

Helping people spend less time searching and more time being active.

DropIn is a search-first companion for discovering and joining nearby drop-in activities.

Our goal is not to keep users inside the product. Our goal is to help them confidently find an activity and get on their way.

Every interaction should reduce the distance between "I want to do something today" and "I'm on my way."

## Core Design Principles

**Search is the Product.** Search is not a Homepage feature. Search is not a page. Search is the product. The interface revolves around search rather than navigation.

**One Persistent Surface.** Instead of multiple pages, the experience behaves as one continuous Search Surface. The interface changes state based on user intent — not page transitions, state transitions.

**One Decision at a Time.** Each interaction reduces cognitive load. Never ask users to make decisions they don't need to make yet.

**Build Trust.** Users should understand what DropIn is, why it exists, and where the information comes from. We do not need to explain internal product decisions. We build trust through clarity and transparency, not lengthy explanations.

**Verifiable Data Only.** Only present information we can verify. Never invent popularity. Never imply availability. Never create labels that require data we don't have.

**Delegate Whenever Possible.** Navigation belongs to Google Maps. Official schedules belong to recreation providers. Phone calls belong to the phone. DropIn discovers — others execute. This is why the Quick Action Sheet exists at all: it's a handoff point, not a place to recreate what another, better-suited tool already does.

---

## Revision Notes

- 2026-07-30 — Initial version, formalizing the Product Architecture Review and the philosophy that superseded the original three-page (Homepage → Results → Detail) structure.
- 2026-08-02 — Production V1: added "Delegate Whenever Possible" as its own named Core Design Principle — previously implied by the Mission statement and by how the Quick Action Sheet was already built, but not stated as a standalone principle until the canonical Production V1 direction named it explicitly. DropIn is confirmed as a production product as of this date, not a prototype — every principle above is now a live constraint on a shipped surface, not a target for one still being designed.
