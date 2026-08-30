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
- **C. Analytics/cookies** — do not claim "no analytics or cookies" until the production hosting/analytics stack is finalized (none exists yet as of this document). If analytics are added later, the Privacy page must be updated in the same change that adds them, not after. See §11 for the recorded launch-observability decision this bullet anticipates.
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
Current Phase 4 work                                    ✅ done
        ↓
Complete remaining Phase 4 product/location QA           ✅ done
        ↓
Launch Readiness                                          ✅ done (this document)
        ↓
About / Info review                                       ✅ done
        ↓
Feedback design                                            ✅ done
        ↓
Privacy + Disclaimer                                       ✅ done
        ↓
Production Security & Privacy Readiness Audit               ✅ done
        ↓
Deployment architecture review                               ✅ done (Phase 5A/5B)
        ↓
Production deployment                                        ✅ FIRST DEPLOYMENT LIVE VERIFIED
        ↓                                                    (2026-08-27, getdropin.vercel.app —
        ↓                                                     see PHASE_5B_PRODUCTION_INFRASTRUCTURE_
        ↓                                                     PREFLIGHT.md §10)
Post-launch monitoring / QA                                  ⬜ next
```

**Status update (2026-08-27): "Production deployment" has had its first real, LIVE VERIFIED instance** — `https://getdropin.vercel.app`, smoke-tested against real production data, full evidence in `PHASE_5B_PRODUCTION_INFRASTRUCTURE_PREFLIGHT.md` §10 and `PHASE_5B_RESPONSE_SIZE_ARCHITECTURE.md` §7. **This is not yet the full public launch** — `getdropin.ca` remains deliberately disconnected (§3/§8 of that preflight, Phase 5A §10's sequencing, unchanged), and §9's mobile/physical-device verification requirement has not yet been performed against this real deployment. The next step in this sequence, per §9's own standing requirement, is mobile/iPhone verification against the now-live production deployment — not started as part of this checkpoint.

Exact numbering/phase names to be assigned when each step actually begins.

## 8. Map View Remains Deferred

Launch readiness is not a reason to build Map View. The Phase 4.0 decision (`docs/PHASE_4_0_GEOSPATIAL_READINESS_MAP_NECESSITY_AUDIT.md`) stands: **Map View = defer.** Location intelligence continues to center on facility coordinates (Phase 4.1), real geolocation (Phase 4.2), distance display and time-first-then-distance ranking (Phase 4.3A/B), Nearest-first as an explicit opt-in (Phase 4.4/4.4B), and Directions — not a map surface. Map View should only be reconsidered if actual usage data demonstrates a real spatial-browsing need that this location work doesn't already cover.

## 9. Mobile Remains a Release Requirement

Mobile usability stays a production requirement, not a nice-to-have. Before launch, verification is still needed (beyond what's already been checked per-phase) across: narrow-viewport layout, horizontal overflow, touch targets, modal behavior, location permission UX, search, date/activity controls, Nearest first, result cards, Directions, Official Listing, and the About/Feedback/Privacy surfaces once they exist. Physical-device verification should be performed when possible before launch — consistent with this project's established discipline (every phase from 4.2 onward) of never claiming physical-device validation that wasn't actually performed; structural/DOM-constraint verification and physical-device verification remain explicitly distinct and separately reported.

**Status update (2026-08-28): Round 1 real physical-iPhone QA against `https://getdropin.vercel.app` is complete.** Findings were recorded, not treated as evidence the core mobile product was broken — the core Search + Results experience passed; the secondary interaction layer (Results metadata/controls crowding, Activity Detail sheet spacing/dismissal, About/Privacy density, Share content, Directions destination format, redundant title text) needed mobile-specific polish. A targeted **Mobile UX Polish patch has been implemented** in response (`app/_components/Sheet.tsx`, `app/page.tsx`, `lib/dropin/activities.ts`, `docs/PROJECT_WORKFLOW.md` — commit `6120b0f`), covering: a split two-row mobile Results metadata/controls layout, Activity Detail sheet breathing room + a true ~44×44px close target + swipe-down-on-handle dismissal + backdrop-tap dismissal + internal scrolling for long content, tighter About/Privacy mobile rhythm (About's trust-related items grouped under "Data & accuracy," no accordion introduced), a native-Share payload that includes activity name/time/venue/DropIn URL and never precise location, Directions preferring human-readable venue name + address over raw coordinates, and conservative display-only activity-title normalization (e.g. `Public Swim (5:45 p.m.)` → `Public Swim`, only when the trailing time matches the structured session start time; raw source data unchanged). The patch passed build, typecheck, and lint, and passed desktop regression review and resized-browser-viewport verification for the mobile changes.

**IMPORTANT — this patch has NOT yet been physically re-verified on a real iPhone.** Viewport verification in a desktop browser is not a substitute for physical-device verification, per this section's own standing discipline. Current status is precisely:

```
Mobile UX Polish:  IMPLEMENTED + VIEWPORT VERIFIED
                   NOT YET PHYSICALLY VERIFIED
```

**The immediate next checkpoint is Round 2 real-iPhone regression QA** — testing the polish patch on the same real device used for Round 1, against the same production build. Round 2 is not started and must not be described as complete until it has actually been performed.

**Status update (2026-08-28): a Round 2 real-iPhone QA pass against production surfaced two new findings, distinct from the Round 1 Mobile UX Polish patch above** — this entry records only these two findings and does not itself confirm or deny the Round 1 patch's own checklist items (Results metadata/controls, Activity Detail sheet, Directions, Share, title normalization, About/Privacy); that confirmation is not yet recorded here and should not be assumed from this entry.

1. **Searching an informal community name (e.g. "Unionville," a real community within Markham) returned "we couldn't find it."** Investigated end-to-end: this is a genuine data/vocabulary gap, not a bug — the string "Unionville" does not exist anywhere in DropIn's ingested data (no facility name, no address, no district field, across any of the 10 real Markham facilities/addresses checked directly), and `DISTRICTS` (the only neighbourhood-level vocabulary DropIn has) is hardcoded to Toronto's four old boroughs only — no municipality has a general informal-community concept. **This remains open and deliberately deferred** to its own future product-design task (a small curated alias/gazetteer layer, not a geocoding system, is the recommended direction) — not addressed by this entry, not scheduled, not implemented.
2. **A facility search (e.g. "Oakridge") could replace the header's "Near me" text with the full Community Centre name** (e.g. "Oakridge Community Recreation Centre"), which on a real phone could wrap across two lines and distort the header, and was independently judged a semantic error — a single building isn't the broad area/proximity context the header pill exists to communicate. Traced to `locationPillLabel()` in `app/page.tsx` rendering any resolved search location's label unconditionally, regardless of type. **Fixed** (2026-08-28) — a `type: "centre"` result no longer drives the header pill; it continues to correctly filter results exactly as before. Display-layer change only; no change to search filtering, ranking, `sessionMatchesLocation`, user geolocation, or distance calculation. Full mechanics in `docs/SEARCH_ENGINE.md`'s Location Override vs. Persistent "Near You" section and `docs/INFORMATION_ARCHITECTURE.md`'s Location Context section.

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

## 11. Launch Observability Strategy

**Status: decision recorded, nothing implemented.** No analytics of any kind is enabled today — confirmed by direct inspection (`app/page.tsx`, zero analytics/tracking code of any kind, unchanged by this entry). This section records the *decision* for when observability is actually built, not a change to current behavior, so the choice doesn't need to be rediscovered from scratch when that phase begins.

DropIn needs lightweight post-launch visibility into whether the site is being used and whether the production experience is healthy — but "needs some visibility eventually" is not the same as "build it now," and the three kinds of visibility below are deliberately kept distinct rather than bundled into one decision or one tool.

### Launch v1 — basic web analytics

**Cloudflare Web Analytics is the preferred initial option**, subject to fresh verification during implementation (per this project's standing discipline: nothing about a third party's actual behavior is trusted from memory — it gets re-checked against that provider's real, current documentation and DropIn's own real, current network behavior at the time it's actually wired up, not assumed now). Its intended role is deliberately narrow: lightweight, aggregate website visibility only — visits/page views, traffic trends, device/browser information, referrers where available, geographic aggregate information where available, and web performance/Core Web Vitals where available. **Not implemented as part of this entry** — recorded as the intended direction only.

### Privacy requirement — binding on whichever future phase implements this

The current Privacy copy (`app/page.tsx`) states that DropIn does not currently use analytics. **That statement is correct today and must not change until analytics is actually enabled** — this document does not authorize an early Privacy-copy update, and none was made. When Cloudflare Web Analytics (or any analytics) is actually enabled in a future implementation phase, that phase must, in order:

1. Verify its actual production data-collection behavior against Cloudflare's current documentation at that time (not this document's description of intent).
2. Re-audit DropIn's actual network/client behavior in the real deployed build — the same "prove it, don't assume it" standard already applied throughout the Security & Deployment Audit.
3. Update the Privacy notice so it accurately describes what is actually collected, in that same change — never a separate, later cleanup step.
4. Not make broader privacy claims than what was actually technically verified.

**Privacy copy must describe actual production behavior, not planned behavior** — this is the operative rule this whole entry exists to protect.

### Product analytics — explicitly NOT launch scope

Detailed behavioral/product analytics (e.g. search performed, zero-result search, normalized activity/category searched, municipality searched, Nearest First enabled, location permission outcome, list/grid view selection, Decision Sheet opened, Directions clicked, Official Listing clicked) are explicitly deferred — **not implemented, not designed in detail, listed here only as illustrative examples of the category being deferred.** See §12 for the formal backlog entry.

Before any future product-analytics implementation, it needs its own dedicated analytics/privacy design phase, covering at minimum: event schema, data minimization, retention, raw search-query handling specifically, location privacy, whether identifiers are necessary at all, and the resulting Privacy-notice changes. **Prefer aggregate/normalized information over storing raw user-entered search queries whenever practical** — a principle to carry into that future design phase, not a design decided here.

### Architecture principle — three separate concerns, not one

DropIn should keep these distinct, and they should not automatically share the same data or tooling merely because they're all loosely "analytics":

1. **Operational observability** — is the site/data pipeline healthy? (Already partly covered by existing tooling — `npm run snapshot:health`'s FRESH/AGING/STALE/UNAVAILABLE classification, GitHub Actions' failure-email notification — both recorded in `docs/PHASE_5A_HOSTING_REFRESH_ARCHITECTURE.md` §5/§6, unrelated to user-facing analytics of any kind.)
2. **Basic web analytics** — is the site being visited and performing well? (§ Launch v1, above — Cloudflare Web Analytics, aggregate only.)
3. **Product analytics** — how are people actually using DropIn? (§12, explicitly deferred, needs its own dedicated design phase before any implementation.)

## 12. Future Backlog — Product Analytics (Not Implemented)

**Status: backlog only.** No event tracking, no schema, no third-party product-analytics tool, and no Privacy-copy change has been made for this. Recorded here, in the same style as §10's "Support DropIn" entry, so it can be picked up as a defined item later rather than rediscovered from scratch.

**Goal:** design a privacy-conscious DropIn product analytics system, only when actual usage justifies it — not merely because it would be interesting to have.

**Do not implement during launch readiness or Phase 5.** Before any implementation, a dedicated analytics/privacy design phase must cover: event schema, data minimization, retention period, raw search-query handling (preferring aggregate/normalized data over storing what a user actually typed, wherever practical), location privacy (DropIn's existing, hard-won browser-only geolocation guarantee must not be quietly weakened by an analytics integration), whether persistent identifiers are necessary at all, and the required Privacy-notice changes — determined at that time, against that implementation's actual real behavior, not written speculatively now.

**Illustrative examples of what this category *might* eventually cover** (not designed, not committed to, not exhaustive): search performed, zero-result search, normalized activity/category searched, municipality searched, Nearest First enabled, location permission outcome, list/grid view selection, Decision Sheet opened, Directions clicked, Official Listing clicked.

## 13. Future Gate — Production Load / Concurrency Verification (Not Implemented)

**Status: gate recorded, not performed.** No load test, no concurrency test, and no tooling for either has been added. This is a required pre-launch checkpoint, not a suggestion — recorded now, while the R2 migration (`docs/PHASE_5B2B_R2_STORAGE_INTEGRATION.md`) is fresh, specifically because it changes DropIn's request-time behavior in a way the existing local-disk-only verification never exercised.

**Why this is a real gate, not a formality:** every verification performed through Phase 5B-2B (Aurora's live write+read, then all 7 municipalities' migration and read-back) was **single-request, sequential** — one `curl` at a time, never concurrent traffic. Production traffic will not look like that. Two things specifically need real-traffic-shaped evidence before public launch, not assumption:

- **R2 read behavior under concurrent load.** `/api/sessions` currently issues up to 7 concurrent R2 `GetObjectCommand` calls per request (`Promise.allSettled` over all municipalities, unchanged by the storage-backend migration). One request doing 7 concurrent reads is already proven working (§ this phase's own verification). *Many simultaneous visitors* each doing that has not been — R2's free-tier request limits (10M Class B operations/month, confirmed during the Phase 5B-1 preflight) are generous, but the actual latency/error behavior under real concurrent load from a real serverless host is a live-traffic question, not a documentation one.
- **Vercel serverless concurrency behavior for this specific request shape.** `/api/sessions` currently returns the full, unfiltered session set on every request (Phase 5A §L's still-open redirect-vs-server-filter decision, deliberately deferred past launch by M1) — a ~24MB uncompressed response per request, confirmed earlier this session. What that looks like under 10, 50, or 100 concurrent requests — memory pressure, cold-start behavior, R2 connection reuse — is unverified.

**Do not implement load testing now.** This section exists to ensure the gate isn't forgotten, not to schedule it. Before public launch, this needs: a real (even if modest) concurrent-request test against a real deployed instance (not local), read against real R2 data (not mocked), with pass/fail criteria decided at that time based on DropIn's actual expected traffic — not a synthetic, arbitrarily large number chosen without evidence, consistent with this project's own "don't build for hypothetical scale" discipline applied everywhere else.

## 14. Aurora ActiveCommunities Data Completeness — CLOSED / LIVE VERIFIED (2026-08-30)

**Status: RESOLVED, live-verified in real production.** Originally discovered during the first real Phase 5B-3 production refresh run (`docs/PHASE_5B3_DAILY_REFRESH_SCHEDULER.md`). Fixed and closed on branch `fix/aurora-centre-partition-fallback` after a dedicated reliability investigation, per the hard constraint below — the Completion Gate itself was never weakened.

**The issue:** Aurora's ActiveCommunities `activities/list` endpoint, for the "group fitness" drop-in keyword, currently reports **30 total records**, but the endpoint caps at **20 results per page** with **no confirmed working pagination mechanism** — verified directly against the live API this phase (real request/response inspection, several plausible pagination parameter shapes tried, none produced a reliable second page; one attempt produced a clearly broken, session-stateful response, reinforcing rather than contradicting the original Phase 3.6B finding that "the server ignores it").

**Why this is not currently breaking anything:** Aurora's existing "Completion Gate" (built in Phase 3.6B specifically for this endpoint's known lack of pagination) is functioning exactly as designed — it detects when a keyword's entire returned page is "Drop In"-prefixed *and* the server's own `total_records` exceeds the page size, and **refuses to treat the fetch as complete** rather than silently under-reporting real data. This is a deliberate, evidence-based safety mechanism working correctly, not a defect.

**Current effect:** Aurora's daily automated refresh fails at the fetch step (before validation is even reached) for as long as this condition persists. Its last-known-good R2 snapshot (`production/canonical/aurora/latest.json`) remains active and is served to users unchanged — it does not go stale to zero, it simply stops getting *fresher* until this is resolved. The other 6 municipalities are unaffected (per-municipality failure isolation, unchanged).

**Hard constraint, carried forward:** **Do not weaken or bypass the Completion Gate** to make Aurora's refresh "succeed" — raising the safety threshold or disabling the check would mean silently shipping incomplete data, exactly what this mechanism exists to prevent. Any real fix must be a genuine, evidence-based pagination mechanism (or another way to retrieve all 30 records reliably), found with the same rigor Phase 3.6A/3.6B originally applied to this source — not a quick patch to make a red workflow turn green.

**Resolution (2026-08-30):** a dedicated Aurora reliability investigation, mirroring Phase 3.6A/B's own methodology, found a genuine complete-retrieval path without pagination and without weakening the gate:

- **Evidence-based centre discovery.** Aurora's `activities/map` endpoint (discovery-only, never treated as the canonical dataset) reports the real, current physical-centre breakdown for a capped keyword — confirmed live that per-centre counts sum exactly to the same `total_records` the capped `activities/list` call itself reports.
- **Sequential per-centre retrieval.** Each discovered centre is re-queried individually through the same `activities/list` endpoint every other keyword already uses. Requests are sequential, not concurrent — live testing found Aurora's session/cookie-scoped backend intermittently returned an empty result for one of several *concurrent* requests on one session; sequential requests against the same live endpoint succeeded consistently.
- **Contradictory-response guard.** Separately, live testing found Aurora's backend can return `total_records > 0` with `items: []` — a genuine contradiction indistinguishable from a real empty result to the original Completion Gate. A genuine `total_records === 0 && items: []` response is never touched. For the contradictory case only, exactly one immediate retry is attempted; if the retry repeats the same contradiction, the fetch **throws and fails closed** — the previous known-good snapshot is preserved, never an incomplete dataset.
- **Every existing safeguard preserved, not replaced:** the original Completion Gate still applies independently to each centre partition; the merged result is only accepted if the summed per-centre totals exactly match the original unfiltered `total_records`; duplicate activity ids across centres are explicitly checked and rejected.

**Live verification:** 10/10 repeated real Aurora fetches after the fix — 27/27 group-fitness activities every time, zero duplicates. 45 raw live keyword calls — 44 clean, 1 correct fail-closed throw (persistent contradiction), zero silent data loss. Real 7-municipality production R2 refresh — 7/7 succeeded, Aurora activated a genuinely fresh 511-session snapshot (not the prior fallback). Confirmed via the actual Daily Production Data Refresh GitHub Actions workflow (**Run #6, branch `fix/aurora-centre-partition-fallback`**): workflow SUCCESS, combined object written and read-back verified (44,393 sessions: Toronto 24,376 / Mississauga 15,935 / Richmond Hill 232 / Vaughan 550 / Markham 646 / Newmarket 2,143 / **Aurora 511**).

## 15. Open Issue — Geographic Vocabulary / Informal Community Search (Non-Blocking)

**Status: unresolved, tracked, non-blocking, deliberately deferred.** Discovered during Round 2 real-iPhone QA (§9) when searching "Unionville" — a real community within Markham — returned "we couldn't find it" instead of a meaningful result. Investigated the same day. **Not implemented, not worked around, not fixed here.**

**The issue:** DropIn's Search understands exactly four geographic tiers: Municipality (14 entries, reference-list), Neighbourhood/District (Toronto's four old boroughs only — North York, Scarborough, Etobicoke, Downtown Toronto — hardcoded in `lib/dropin/districts.ts`), Community Centre (facility name substring match), and Postal Code (FSA pattern). There is no concept anywhere in the pipeline for an informal community name within a municipality. Confirmed this is a genuine data gap, not a matching/indexing bug: the string "Unionville" does not appear anywhere in Markham's canonical session data — not in any of its 10 real facility names, not in any of its real street addresses (all read `"..., Markham, <postal>"`), not in any `district` field (PerfectMind, Markham's source family, supplies no neighbourhood field at all — `district` is a literal empty string on every non-Toronto session). Even Toronto's own source data tops out at the same four-borough granularity — no municipality has finer community-level data available to search against today.

**Why this is non-blocking:** the existing "query didn't resolve to anything recognized" fallback (`docs/SEARCH_ENGINE.md`'s Empty/No-Results Behavior) handles this honestly — it falls back to Discovery scoped to the persistent location, with a line acknowledging the miss, rather than a dead end or a false claim.

**Recommended direction, not committed to:** a small curated alias/gazetteer layer (community name → municipality, resolved via reference-list lookup, the same mechanism `DISTRICTS` already uses) — explicitly **not** a geocoding/boundary-polygon system, which this project's existing discipline (per `docs/PHASE_4_0_GEOSPATIAL_READINESS_MAP_NECESSITY_AUDIT.md`'s Map View deferral reasoning) would consider unjustified infrastructure without stronger evidence of need.

**Not scheduled, not assigned a phase yet.** Needs its own product-design scoping (which communities, which municipalities, how much coverage) before implementation — deliberately kept separate from the header-display fix in §9, which addressed a different, unrelated finding from the same QA round.

## 16. Infrastructure Maintenance Backlog (Non-Blocking)

**Status: recorded only, not fixed.** Two small findings surfaced incidentally while closing §14's Aurora gate (Daily Production Data Refresh, Run #6) — neither is an Aurora reliability issue, both deliberately left as-is here.

- **Job-summary parsing.** The GitHub Actions run summary displayed "Could not parse refresh output as JSON" despite the underlying refresh succeeding — a reporting/formatting gap in `scripts/refresh/format-summary.ts`'s handling of the real CLI output shape, not a data-integrity or Completion Gate issue. The workflow's actual pass/fail result and the real per-municipality data were unaffected.
- **Node.js 20 deprecation.** The workflow runner logs a deprecation notice (Node 20 forced onto Node 24 runners) and the AWS SDK v3 warns it will require Node ≥22 after early January 2027. Not a current failure, not a launch blocker — a future runtime-upgrade housekeeping item for `daily-refresh.yml` and `actions/setup-node`.

---

## Revision Notes

- 2026-08-21 — Initial launch-readiness plan recorded per explicit user request, ahead of any implementation. Cross-references `docs/ARCHITECTURE.md` (source-of-truth principle), `docs/PHASE_4_0_GEOSPATIAL_READINESS_MAP_NECESSITY_AUDIT.md` (Map View deferral), `docs/PHASE_3_3_DATA_REFRESH_SNAPSHOT_PIPELINE.md` (snapshot gitignore/architecture), and `docs/PRODUCT_PRINCIPLES.md` (existing transparency principles) rather than duplicating their content. Noted, as a factual finding rather than a fix: the current Feedback "Send" action has no backing API call and doesn't actually transmit anything, despite its confirmation copy — flagged for the pre-launch Feedback review in §2, not corrected here.
- 2026-08-24 — Added §10, recording a future optional "Support DropIn" contribution feature (PayPal candidate) as a not-yet-scoped idea, per explicit user request alongside a small, unrelated Privacy-sheet contact-link polish (`docs/LAUNCH_READINESS_1B_TRUST_PRIVACY_FEEDBACK_IMPLEMENTATION.md`). No implementation, no charity/tax-status claims, and a mandatory fresh privacy/security review before any future build.
- 2026-08-24 — Expanded §10 into a formal backlog item per explicit user request: goal, current direction, potential future UX, and a 7-point before-implementation review checklist, with the hard constraints (no "Donate"/charity framing, mandatory fresh privacy/security review, no expansion of the current Security & Deployment Audit scope) carried forward unchanged. Documentation only — no UI, dependency, third-party script, or Privacy/About copy was added or changed.
- 2026-08-25 — Added §11 (Launch Observability Strategy) and §12 (Future Backlog — Product Analytics), per explicit user request, as the final Phase 5A documentation item before Phase 5B. Records Cloudflare Web Analytics as the preferred launch-v1 basic-web-analytics option (subject to fresh verification at implementation time), the binding four-step Privacy-update requirement for whenever analytics is actually enabled, and the explicit deferral of detailed product analytics to its own future dedicated design phase. Also added a one-line cross-reference from §3.C to §11. Documentation only — analytics remains fully disabled (confirmed by direct inspection of `app/page.tsx`, unchanged), and the existing Privacy copy's "does not currently use analytics" claim remains accurate and was not touched.
- 2026-08-26 — Added §13, a required pre-launch gate for production load/concurrency verification, recorded immediately after all 7 municipalities' canonical data was live-migrated to R2 (Phase 5B-2B) — every verification performed through that phase was single-request/sequential, never concurrent, so this gate exists to make sure that gap isn't silently treated as "already covered." Documentation only, per explicit user request — no load-testing tooling was added or run.
- 2026-08-27 — Added §14, recording Aurora's ActiveCommunities "group fitness" data-completeness limitation as a tracked, non-blocking open issue, discovered during Phase 5B-3's first real production refresh run and diagnosed the same day. Aurora's own Completion Gate (Phase 3.6B) is correctly rejecting the incomplete upstream result; its last-known-good snapshot remains active and unaffected. Explicitly not marked resolved, and the Completion Gate itself must not be weakened or bypassed to force a green run. Documentation only, per explicit user request — no source/adapter code was changed.
- 2026-08-27 — Updated §7 to record the first real Vercel production deployment (`https://getdropin.vercel.app`) as LIVE VERIFIED — real smoke-tested production data, the exact read-only credential boundary, and the R2 CORS origin addition, full evidence in `PHASE_5B_PRODUCTION_INFRASTRUCTURE_PREFLIGHT.md` §10 and `PHASE_5B_RESPONSE_SIZE_ARCHITECTURE.md` §7. This is the first real instance of the "Production deployment" sequence step, not yet the full public launch — `getdropin.ca` remains disconnected and §9's mobile/physical-device verification requirement is still outstanding, now identified as the next step. Documentation only, per explicit user request — no application code, Vercel configuration, Cloudflare configuration, GitHub Actions, or domain attachment was touched.
- 2026-08-28 — Updated §9 to record that §9's outstanding mobile/physical-device verification requirement (flagged in the two entries above) has since had its first real pass: Round 1 real physical-iPhone QA against `https://getdropin.vercel.app` (commit `6120b0f`, "first physical-device QA"), which produced secondary-interaction-layer findings (not core-product-breaking) and a resulting Mobile UX Polish patch across `app/_components/Sheet.tsx`, `app/page.tsx`, `lib/dropin/activities.ts`, and `docs/PROJECT_WORKFLOW.md`, already build/typecheck/lint-clean and desktop/viewport-regression-clean. Documentation only, added ahead of Round 2 to make an explicit, previously-undocumented distinction: this patch is IMPLEMENTED + VIEWPORT VERIFIED but **not yet physically re-verified on a real iPhone** — Round 2 real-iPhone regression QA is recorded as the immediate next checkpoint and is explicitly not marked complete. No application code was changed as part of this entry.
- 2026-08-28 — Updated §9 and added §15, recording two new findings from a Round 2 real-iPhone QA pass, investigated the same day. (1) Searching "Unionville" (a real Markham community) was unrecognized — confirmed a genuine geographic-vocabulary/data gap, not a bug: DropIn has no informal-community concept for any municipality, and the string doesn't exist anywhere in Markham's canonical data. Recorded as new §15, explicitly non-blocking, deliberately deferred to its own future product-design task — not implemented, not aliased, not worked around here, matching the same treatment this document already gives the Aurora issue (§14). (2) A facility search (e.g. "Oakridge") could replace the header pill's "Near me" text with the full Community Centre name, which could wrap across two lines on a real phone and misrepresented the pill's area/proximity meaning — traced to `locationPillLabel()` in `app/page.tsx` rendering any resolved location's label unconditionally. **This one was fixed**, same day: `type: "centre"` is now excluded from the pill's display logic; Community Centre search continues to filter results exactly as before, and user geolocation/distance calculation/`sessionMatchesLocation` are entirely untouched. `docs/SEARCH_ENGINE.md` and `docs/INFORMATION_ARCHITECTURE.md` updated in the same pass to state the Community-Centre-filters-but-doesn't-drive-the-pill rule explicitly. Build, typecheck, and lint (zero new errors — 10 pre-existing, unrelated errors confirmed identical on unmodified `main`) all clean.
- 2026-08-30 — Closed §14: Aurora ActiveCommunities Data Completeness marked **CLOSED / LIVE VERIFIED**, on branch `fix/aurora-centre-partition-fallback`. Root cause was a real 20-result page cap on `activities/list` with no working pagination (re-confirmed exhaustively). Fixed via evidence-based centre discovery (`activities/map`, discovery-only), sequential per-centre `activities/list` retrieval (concurrent requests were found live to be intermittently unreliable against Aurora's session-scoped backend), a one-bounded-retry guard for a separately-discovered contradictory `total_records > 0`/`items: []` upstream response (fails closed if the retry repeats the contradiction), and a merged-total/duplicate-id cross-check against the original unfiltered `total_records` — the original Completion Gate itself was never weakened, only preserved and extended. Live-verified: 10/10 repeated Aurora fetches clean post-fix, 45 raw keyword calls (44 clean, 1 correct fail-closed throw), a real 7-municipality production R2 refresh (7/7, Aurora activating a genuinely fresh 511-session snapshot), and the actual Daily Production Data Refresh GitHub Actions workflow (Run #6, this branch) — SUCCESS, combined object written and read-back verified at 44,393 sessions. Added §16, recording two small, unrelated, non-blocking findings from that same GitHub run (a job-summary JSON-parsing display gap, and a Node.js 20 deprecation notice) — explicitly not fixed here. No application code changed as part of this documentation entry.
