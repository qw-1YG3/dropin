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

**Phase 1 — Homepage**
- Information Architecture ✅
- Low-Fidelity ✅
- High-Fidelity ✅

**Phase 2 — Results Page**
- Information Architecture ✅
- Low-Fidelity ✅
- High-Fidelity ⏳

**Future Phases**

- Phase 3 — Detail Page
- Phase 4 — Search Experience
- Phase 5 — Data Integration
- Phase 6 — Visual Polish
- Phase 7 — Beta Testing

This roadmap should be updated as milestones are completed.

---

## Preview Environment

All design explorations live under `/design`, each as its own route (e.g. `/design/homepage-lowfi`, `/design/results-lowfi`). These are temporary review environments — production pages are only updated after a design is approved. See the Design Preview Hub at `/design` for the current index of what exists.

---

## Revision Notes

- 2026-07-29 — Replaced the initial workflow structure with this expanded version: added General Principles, the Product Workflow discussion stages, Collaboration Rules, and an explicit phase-based Roadmap. One substantive change worth flagging under the Collaboration Rules above: the prior Design Workflow had 6 stages with two separate Review checkpoints (after Low-Fidelity, and after High-Fidelity, before Production Build). This version consolidates to a single Review & Refinement stage positioned after High-Fidelity. Proceeding on the assumption this consolidation is intentional; flagging it since the Homepage work already completed did receive an explicit review checkpoint before High-Fidelity began, under the prior process. Also preserved the Preview Environment section from the prior version, since it documents the still-current `/design` route convention and wasn't restated here.
- 2026-07-29 — Added the Decision Principle section: when multiple solutions exist, prefer the one that keeps the user experience simplest, even at the cost of fewer features. Placed directly after General Principles since it governs how tradeoffs get resolved everywhere else in this document.








