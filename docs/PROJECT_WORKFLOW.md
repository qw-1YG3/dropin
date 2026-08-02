# Project Workflow

This document is the long-term collaboration guide for DropIn's development.

---

## General Principles

- Complete one milestone before starting the next.
- Avoid jumping between unrelated features.
- Document important product decisions before moving forward.
- Keep the MVP intentionally simple.
- Prioritize product behaviour before technical implementation.
- Every design decision should support our core product principles.
- As of Production V1 (2026-08-02), DropIn is a production product, not a prototype, and the docs in this folder are its single source of truth. New direction gets merged into the relevant document — dated, in-place, nothing silently overwritten — rather than living only in chat history.

---

## Decision Principle

Whenever there are multiple possible solutions, choose the one that creates the simplest experience for users, even if it means implementing fewer features.

Our goal is not to build the most feature-rich recreation website.

Our goal is to build the easiest way to find a drop-in activity.

---

## Design Workflow

Each major page should follow the same sequence:

1. Information Architecture (IA)
2. Low-Fidelity
3. High-Fidelity
4. Review & Refinement
5. Implementation

Do not skip stages unless we explicitly decide to.

---

## Product Workflow

Whenever we discuss a new feature, always separate the discussion into three stages:

1. Product Behaviour (What should happen?)
2. UX Interaction (How should users experience it?)
3. Technical Implementation (How should we build it?)

Do not jump into implementation before the product behaviour has been agreed upon.

---

## Collaboration Rules

If requirements appear to conflict, ask for clarification before making assumptions.

Don't simply implement my requests.

If you believe a design decision could negatively affect usability, simplicity, or our product principles, explain why and propose an alternative.

Healthy disagreement is encouraged when supported by clear reasoning.

When a new idea is introduced, always evaluate whether it belongs in the MVP or should be intentionally deferred to a future version.

---

## Current Roadmap

**Superseded** — Homepage and Results Page (originally Phases 1–2) were retired entirely during the Product Architecture Review and replaced by the Search Surface (one persistent shell, three states, two overlay sheets). See `docs/INFORMATION_ARCHITECTURE.md`.

**Search Surface — status: production.**
- Information Architecture ✅
- Low-Fidelity ✅
- High-Fidelity ✅ (including Quick Action Sheet and Product Information Sheet refinement passes)
- Real data integration ✅ (Toronto Open Data, via the adapter pipeline in `docs/ARCHITECTURE.md`)
- Universal Search ✅ (Activity / Community Centre / Neighbourhood / City-Municipality / Postal Code, mixed queries, live search with debounce)
- Promoted to the production app root (`/`) — the `/design` preview route for it has been retired.

**Open, not yet built:**
- GTA-wide data coverage beyond Toronto (adapters exist as a pattern; no second municipality is integrated yet — see `docs/ARCHITECTURE.md`'s Current Implementation State)
- Scheduled/live data sync (current Toronto adapter reads a static, manually-refetched snapshot)
- Silent geolocation inference for the default location context
- Map View (not started)

This roadmap should be updated as milestones are completed.

---

## Preview Environment

All design explorations live under `/design`, each as its own route (e.g. `/design/homepage-lowfi`, `/design/results-lowfi`). These are temporary review environments — production pages are only updated after a design is approved. See the Design Preview Hub at `/design` for the current index of what exists.

---

## Revision Notes

- 2026-07-29 — Replaced the initial workflow structure with this expanded version: added General Principles, the Product Workflow discussion stages, Collaboration Rules, and an explicit phase-based Roadmap. One substantive change worth flagging under the Collaboration Rules above: the prior Design Workflow had 6 stages with two separate Review checkpoints (after Low-Fidelity, and after High-Fidelity, before Production Build). This version consolidates to a single Review & Refinement stage positioned after High-Fidelity. Proceeding on the assumption this consolidation is intentional; flagging it since the Homepage work already completed did receive an explicit review checkpoint before High-Fidelity began, under the prior process. Also preserved the Preview Environment section from the prior version, since it documents the still-current `/design` route convention and wasn't restated here.
- 2026-07-29 — Added the Decision Principle section: when multiple solutions exist, prefer the one that keeps the user experience simplest, even at the cost of fewer features. Placed directly after General Principles since it governs how tradeoffs get resolved everywhere else in this document.
- 2026-08-02 — Production V1: rewrote Current Roadmap, which still described the retired three-page architecture (Homepage/Results as separate phases with a stale checklist) despite Search Surface having long since superseded it, gone through real data integration, and been promoted to production. Added the standing note that DropIn is production as of this date and that this docs folder is the single source of truth going forward, per the explicit direction that closed out this sprint.








