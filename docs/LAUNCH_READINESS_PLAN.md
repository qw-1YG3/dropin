# Launch Readiness Plan

This document records the launch-readiness decisions made while DropIn moves from a functional search product toward a public-facing production product. **It is a planning/decision record, not an implementation.** None of the items below have been built yet unless explicitly marked otherwise; each will get its own dedicated phase.

Four areas must be addressed before public launch: About, Feedback, Privacy/Disclaimer, and Production Security & Deployment Readiness. This document also re-affirms two standing decisions (Map View stays deferred; mobile stays a release requirement) so they survive future phases without needing to be re-litigated.

---

## 1. About DropIn

**Status: exists, needs a pre-launch UX/content review.** Current implementation: the "About DropIn" `Sheet`, opened from the header info icon (`app/page.tsx`, `infoSheetOpen`), already covers most of the required ground — what DropIn is, where data comes from, and a "Data sources" line naming the currently-covered municipalities (`AVAILABLE_MUNICIPALITIES_LABEL`, derived from the live registry, not hardcoded — see `lib/dropin/municipalities.ts`).

Before launch, the About content should be revised to clearly and concisely answer:

- **A. What is DropIn?** DropIn helps people quickly discover drop-in recreation activities across participating GTA municipalities without having to search through multiple municipal recreation websites.
- **B. Where does the information come from?** Activity information comes from official municipal recreation sources; DropIn reorganizes and presents it to make activities easier to search, compare, and discover.
- **C. How current is the information?** DropIn refreshes its data regularly, but municipal schedules, availability, prices, registration requirements, and other details may change. Users should be encouraged to check the Official Listing when appropriate before heading out.
- **D. Is DropIn an official municipal service?** No — DropIn is an independent project, not affiliated with or endorsed by the municipalities whose recreation information it helps users discover.

**Product principle**: the About copy should reinforce the data-transparency system already built into the product — Updated/freshness labels (`lastUpdatedLabel`, `daysAgoLabel`), the Official Listing CTA (`officialActionLabel`, Phase 3.5C), source attribution (`officialSource` shown in the Decision Sheet), honest handling of missing information ("never a guess, never a filler line," per `ageRestrictionLabel`/`attendanceRequirementLabel`'s own established discipline), and preservation of source truth (§6 below). Avoid long legalistic language — the experience should feel transparent and trustworthy, not defensive.

## 2. Feedback

**Status: exists as UI only — confirmed by direct inspection, not yet actually wired to anything.** The Feedback flow inside the About sheet (`feedbackStage`: `"idle" → "writing" → "sent"`) collects free text in a `<textarea>` and, on Send, transitions straight to a "Thanks — we've received your note and will take a look" confirmation. **A repo-wide check found no `fetch`/API call anywhere in the Send path** — the text is held in local component state and discarded on close; nothing is transmitted, logged, or persisted anywhere. This is worth recording explicitly now: the current confirmation copy already promises something ("we've received your note") that isn't technically true yet, which the pre-launch Feedback review needs to either back with a real destination or soften.

Before launch, the Feedback experience should get its own UX/content review:

- Friendly framing, e.g. **"Found something wrong?"**
- Explain what can be reported: incorrect schedules, incorrect locations, incorrect activity information, broken functionality, general suggestions.
- CTA: **"Send feedback."**
- If a structured form is introduced later, likely categories: Incorrect information · Something isn't working · Suggestion · Other.

**Product principle**: feedback should eventually be treated as part of DropIn's data-quality/QA ecosystem — because DropIn aggregates multiple municipalities across multiple source architectures (Toronto Open Data, ActiveCommunities, PerfectMind), user reports may be the fastest way to surface stale municipal data, source drift, parsing problems, facility/location mismatches, or unexpected schedule changes that an automated refresh wouldn't catch on its own. **Do not build this system yet** — this is a future-phase direction, not a current task.

## 3. Privacy

**Status: not yet written.** Must reflect the *actual* production architecture, not generic boilerplate — verified against the real, shipped implementation, not assumed:

- **A. Location** — why it's requested (distance display and Nearest-first ranking, per Phase 4.2/4.3B/4.4B) and that search itself never requires it.
- **B. Location storage** — the current implementation (`useUserLocation`, `app/page.tsx`) holds coordinates in plain in-memory React state only; confirmed by repeated audit across Phases 4.2–4.4B that precise coordinates are never written to `localStorage`, a cookie, a URL, or Share text, and reset on reload. **This must be re-verified against whatever the final production build actually ships before the Privacy page asserts it** — this document records the current state, not a permanent guarantee independent of future code changes.
- **C. Analytics/cookies** — do not claim "no analytics or cookies" until the production hosting/analytics stack is finalized (none exists yet as of this document). If analytics are added later, the Privacy page must be updated in the same change that adds them, not after.
- **D. Feedback data** — if a future Feedback implementation collects an email or other identifying information, document what's collected, why, how it's used, and a proportionate retention policy, at the time that implementation ships (not before, since it doesn't exist yet — see §2).
- **E. Hosting/technical logs** — the policy must account for whatever the eventual hosting provider logs at the infrastructure level (e.g., IP/request logs), once a hosting provider is actually chosen.
- **F. Third-party destinations** — DropIn links out to municipal Official Listings and Google Maps/Directions; both have their own separate privacy practices the Privacy page should point to rather than restate.
- **G. Contact** — provide a real way to ask privacy questions (e.g., an email address once one exists for this purpose).

**Design principle**: DropIn collects very little user information by design. The Privacy page should be short, understandable, transparent, and proportional to the product — not a large copied legal template.

## 4. Disclaimer / Terms

**Status: not yet written.** A concise disclaimer is the priority here, not a full Terms of Use document. It should eventually communicate: DropIn is independent; municipal information may change; DropIn cannot guarantee real-time availability; users should verify important details through the Official Listing. **No final legal copy is being written or implemented as part of this document** — this is a placeholder for a future, dedicated pass.

## 5. Local Computer / Production Security & Deployment Readiness

**Architectural principle to preserve**: the public production website must not depend on the developer's local machine or `localhost` in any way. Users interact only with deployed production infrastructure; shutting down the development computer must have zero effect on the public site.

Before deployment, run a dedicated **"Production Security & Privacy Readiness Audit"** — not started, scoped here for later. At minimum it should examine: `.env` files, environment variables, API keys/credentials, git history for accidentally committed secrets, `.gitignore` correctness, `public/` directory exposure, client/server boundaries, API endpoints, CORS where relevant, error messages, debug information, production source maps where relevant, dependency vulnerabilities, security headers, raw source snapshots, canonical datasets, internal documentation, local filesystem paths, build artifacts, logging, geolocation handling, feedback data handling, analytics, hosting architecture, and deployment architecture.

The central question that audit needs to answer: **"What exactly becomes publicly accessible when DropIn is deployed?"** Nothing should be assumed public merely because it lives in the repository — every production data/asset category should be explicitly classified as one of **PUBLIC / SERVER-ONLY / BUILD-TIME ONLY / LOCAL-ONLY / SECRET**.

A few facts already true today, worth carrying into that future audit rather than rediscovering from scratch: `.gitignore` already excludes `.env*`, `/data/raw/`, and `/data/canonical/` (the generated snapshot directories — see `docs/PHASE_3_3_DATA_REFRESH_SNAPSHOT_PIPELINE.md`); no `.env` file currently exists in the repo; `public/` currently contains only the default Next.js starter SVGs, nothing DropIn-specific. None of this constitutes the audit itself — it's just the starting state the audit will need to re-verify, not assume, once real hosting/deployment/analytics decisions are made.

## 6. Data Architecture Principle (Reaffirmed)

Two principles already established in earlier phases, restated here so they survive into the launch-readiness track without needing to be rediscovered:

- **Source truth ≠ presentation** — already documented in `docs/ARCHITECTURE.md` ("Source of Truth Principle") and repeatedly upheld in practice: Phase 4.1A's age-sentinel normalization and every prior activity-name normalization pass modified only *display* logic, never the canonical `ageMin`/`ageMax`/raw source fields underneath. Raw/source-derived information stays auditable even as DropIn normalizes what users see.
- **Local/internal data ≠ public production data** — raw and canonical snapshots, internal refresh tooling, and developer-facing documentation are not to be exposed merely because they're useful during development or the refresh workflow. This is the specific question the Security Audit in §5 will need to verify concretely (what's actually served vs. what merely exists in the repo).

## 7. Launch Readiness Sequence (Provisional)

```
Current Phase 4 work
        ↓
Complete remaining Phase 4 product/location QA
        ↓
Launch Readiness
        ↓
About / Info review
        ↓
Feedback design
        ↓
Privacy + Disclaimer
        ↓
Production Security & Privacy Readiness Audit
        ↓
Deployment architecture review
        ↓
Production deployment
        ↓
Post-launch monitoring / QA
```

Exact numbering/phase names to be assigned when each step actually begins.

## 8. Map View Remains Deferred

Launch readiness is not a reason to build Map View. The Phase 4.0 decision (`docs/PHASE_4_0_GEOSPATIAL_READINESS_MAP_NECESSITY_AUDIT.md`) stands: **Map View = defer.** Location intelligence continues to center on facility coordinates (Phase 4.1), real geolocation (Phase 4.2), distance display and time-first-then-distance ranking (Phase 4.3A/B), Nearest-first as an explicit opt-in (Phase 4.4/4.4B), and Directions — not a map surface. Map View should only be reconsidered if actual usage data demonstrates a real spatial-browsing need that this location work doesn't already cover.

## 9. Mobile Remains a Release Requirement

Mobile usability stays a production requirement, not a nice-to-have. Before launch, verification is still needed (beyond what's already been checked per-phase) across: narrow-viewport layout, horizontal overflow, touch targets, modal behavior, location permission UX, search, date/activity controls, Nearest first, result cards, Directions, Official Listing, and the About/Feedback/Privacy surfaces once they exist. Physical-device verification should be performed when possible before launch — consistent with this project's established discipline (every phase from 4.2 onward) of never claiming physical-device validation that wasn't actually performed; structural/DOM-constraint verification and physical-device verification remain explicitly distinct and separately reported.

## 10. Future Backlog — Support DropIn (Not Implemented)

**Status: backlog only.** No UI, no dependency, no third-party script, and no Privacy/About copy change has been made for this. Recorded in full here so it can be picked up as a defined item later rather than rediscovered from scratch.

**Goal:** explore an optional way for users who find DropIn useful to financially support the project and its ongoing operating costs.

**Current direction:**
- User-facing concept: **"Support DropIn"** — not "Donate," unless DropIn's legal/organizational status changes in the future (see the constraint below).
- **PayPal** is currently the preferred first candidate for accepting voluntary contributions.
- Contributions must remain completely optional and must never affect access to DropIn.
- DropIn remains free to use, unconditionally.

**Potential future UX** (direction only, not designed or built):
- A small, non-intrusive "Support DropIn" entry point.
- Copy explaining that contributions help support costs such as hosting, data maintenance, and continued development.
- Kept visually secondary to the core recreation-search experience — consistent with this project's existing "Comfortable Before Beautiful" / "Reduce Thinking, Not Information" principles.
- No aggressive fundraising prompts, pop-ups, or dark patterns.

**Before implementation, work through:**
1. Review PayPal integration options and fees.
2. Determine whether an external PayPal payment page/link is preferable to an embedded integration.
3. Review privacy implications, cookies, third-party scripts, and data sharing.
4. Review security implications.
5. Confirm appropriate wording around contributions and project status.
6. Update Privacy / About disclosures if required.
7. Confirm whether any accounting/tax obligations apply before accepting money.

**Hard constraints, carried forward from when this item was first raised:**
- DropIn must never be described as a registered charity or nonprofit, and no copy may imply charitable tax treatment (e.g. tax-receipt language) unless that status is genuinely obtained.
- Any future payment integration is a new trust/security surface — handling money is categorically different from the read-only, no-account architecture this project has maintained throughout Phase 4 and Launch Readiness so far. It must trigger a **fresh privacy/security review before implementation**, not be folded into the existing Production Security & Privacy Readiness Audit (§7) as an afterthought, since that audit was scoped before this idea existed — and it must not be treated as reason to expand that audit's current scope now.

---

## Revision Notes

- 2026-08-21 — Initial launch-readiness plan recorded per explicit user request, ahead of any implementation. Cross-references `docs/ARCHITECTURE.md` (source-of-truth principle), `docs/PHASE_4_0_GEOSPATIAL_READINESS_MAP_NECESSITY_AUDIT.md` (Map View deferral), `docs/PHASE_3_3_DATA_REFRESH_SNAPSHOT_PIPELINE.md` (snapshot gitignore/architecture), and `docs/PRODUCT_PRINCIPLES.md` (existing transparency principles) rather than duplicating their content. Noted, as a factual finding rather than a fix: the current Feedback "Send" action has no backing API call and doesn't actually transmit anything, despite its confirmation copy — flagged for the pre-launch Feedback review in §2, not corrected here.
- 2026-08-24 — Added §10, recording a future optional "Support DropIn" contribution feature (PayPal candidate) as a not-yet-scoped idea, per explicit user request alongside a small, unrelated Privacy-sheet contact-link polish (`docs/LAUNCH_READINESS_1B_TRUST_PRIVACY_FEEDBACK_IMPLEMENTATION.md`). No implementation, no charity/tax-status claims, and a mandatory fresh privacy/security review before any future build.
- 2026-08-24 — Expanded §10 into a formal backlog item per explicit user request: goal, current direction, potential future UX, and a 7-point before-implementation review checklist, with the hard constraints (no "Donate"/charity framing, mandatory fresh privacy/security review, no expansion of the current Security & Deployment Audit scope) carried forward unchanged. Documentation only — no UI, dependency, third-party script, or Privacy/About copy was added or changed.
