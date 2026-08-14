# Phase 3.5C — Attendance & Official Action Integration

A small, data-driven enhancement to the existing Decision Sheet — not a new design sprint. Everything below is tagged **[IMPLEMENTED]**, **[VERIFIED]** (checked against real, live data in this phase), **[UNKNOWN]**, **[DEFERRED]**, or **[RECOMMENDATION]**.

---

## 1. Attendance Model Decision

**[IMPLEMENTED]** One new field, `Session.attendanceRequirement?: "pre-registration-required" | "walk-in"` (`lib/dropin/types.ts`) — deliberately not the 4-value sketch the brief offered (`registration-available` and an explicit `"unknown"` member were both omitted). No source family currently has evidence for a middle "registration exists but isn't mandatory" state, and `undefined` already means unknown, matching every other optional field on `Session` (`RegistrationStatus`, `ageMin`/`ageMax`, etc.) — adding a value nothing produces would violate the brief's own "do not create values that none of the current source families can justify."

**Deliberately NOT derived from `registrationStatus`.** This is the central finding of this phase: a live check of PerfectMind's actual `BookButtonText` distribution found it dominated (70-92% of records) by `"More Info"` — a state that turns out to correlate almost entirely with how far out the occurrence date is (35 of 0-3-day records are `"More Info"` vs. 350 of 15-30-day records), not with anything about the program itself. The same session's button flips from `"More Info"` to `"Register Now!"` purely as its registration window opens — exactly the volatile, refresh-cadence-unsafe state Part 12 forbids surfacing. `attendanceRequirement` is instead a **constant per source family**, driven by structural evidence that doesn't change day to day (see §2-3).

## 2. Source-Family Evidence

**[VERIFIED]**

| Source family | Value set | Evidence |
|---|---|---|
| Toronto | `"walk-in"` | The raw dataset (`Course_ID, Course Title, Section, Age Min, Age Max, Date Range, Start/End Hour...`) has no registration field of any kind — this is the City's own "Drop-in Program" category, categorically distinct from its separately published Registered Programs data. `docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md` already established this precedent project-wide: "DropIn's whole premise is trustworthy walk-in drop-in information, and this source family cannot currently back a claim of 'walk-in, no reservation needed' for any session with real data ... the way Toronto's data — imperfectly, but at least nominally — can." |
| ActiveCommunities (Mississauga, Richmond Hill) | unset (unknown) | Phase 3.1 found `reservation_event_type_id` — the one field that could theoretically distinguish walk-in from reservation-required — is `0` for literally every event tested, both municipalities, no exceptions found this phase either. No new field was added here; the same `undefined` this family already carries for `RegistrationStatus` extends to `attendanceRequirement`. |
| PerfectMind (Vaughan, Markham) | `"pre-registration-required"` | Every sampled record across both tenants lives inside a PerfectMind BookMe4 booking platform whose own `DisplaySettings.ButtonName` — a per-tenant constant, not a per-record value — reads `"Register Now!"` (Vaughan) or `"Register"` (Markham) for literally every record. Zero records anywhere (`Details` free-text field) mention a walk-in alternative. See §3 for why the per-record `BookButtonText` state is explicitly NOT what backs this. |

**[VERIFIED] live distribution, this phase's actual refresh**: Toronto 26,353/26,353 sessions `"walk-in"`; Vaughan 1,079/1,079 and Markham 397/397 `"pre-registration-required"`; Mississauga and Richmond Hill both 100% unset.

## 3. PerfectMind Mapping (Part 4 detail)

**[VERIFIED]** — the exact reasoning Part 4 asked for, worked through with real numbers.

A live pull's `BookButtonText` distribution: Vaughan — `"More Info"` 836/1197, `"Register Now!"` 323, `"Waitlist"` 35, `"Not available."` 3. Markham — `"More Info"` 430/468, `"Register"` 38. If `attendanceRequirement` had been derived per-record from this field, the majority of Vaughan/Markham sessions would show nothing (an `undefined`/ambiguous `"More Info"` state), which would be **false** — those sessions still require pre-registration to attend, they just aren't bookable *yet*. Cross-tabulating `BookButtonText` against days-until-occurrence confirmed the real driver: `"Register Now!"`/`"Waitlist"` cluster overwhelmingly in the 0-7 day window (registration window open), `"More Info"` dominates everything 8+ days out (window not yet open) — a rolling registration-open-window pattern, not a signal about whether registration is required at all.

The stable fact — is registration required to attend, full stop — doesn't come from `BookButtonText`; it comes from the platform structure itself (§2's `ButtonName` constant + absence of walk-in language). That's why `attendanceRequirement: "pre-registration-required"` is set unconditionally for every PerfectMind record in `normalize.ts`, independent of that record's own `registrationStatus`.

## 4. Other-Source Handling (Part 5)

**[IMPLEMENTED]** No PerfectMind-derived logic leaked into Toronto or ActiveCommunities. Toronto's normalizer sets `attendanceRequirement: "walk-in"` as its own independent constant with its own evidence comment; ActiveCommunities' normalizer sets nothing and documents why (same file, same paragraph that already explains why no `verificationStatus: "verified"` claim is made for this family). Vaughan/Markham showing a participation rule while Mississauga/Richmond Hill show none is the intended, truthful outcome — not an inconsistency to fix.

## 5. Decision Sheet Change

**[IMPLEMENTED]** Exact before/after, `app/page.tsx`'s Decision Sheet (Sheet with `titleId="quick-action-title"`):

**Before**: Identity (time) → Location (centre, address) → Eligibility (price · age, one line) → Directions (primary) → [Website (if `officialUrl`) / Call (if `phone`) / Share] → Trust footer.

**After**: identical, except the Eligibility block gained one conditional line directly beneath price/age (`attendanceRequirementLabel`, same `text-sm text-text-secondary` typography, no new section, no badge, no icon), and the existing "Website" button was relabeled by `officialActionLabel` instead of a hardcoded string. No button was added, removed, or reordered; `secondaryActionCount`'s grid-column logic is untouched. **[VERIFIED]** visually against real Vaughan, Markham, Toronto, and Mississauga records — see §9.

## 6. Action-Label Logic (Part 7)

**[IMPLEMENTED]**, `officialActionLabel(s)`:
- `attendanceRequirement === "pre-registration-required"` → **"Register"**
- `attendanceRequirement === "walk-in"` (officialUrl present) → **"Official listing"** — no source currently has both a URL and confirmed walk-in status, so this branch is implemented but currently unexercised; included so Toronto gaining an `officialUrl` later needs no code change.
- otherwise (officialUrl present, attendance unknown) → **"View official listing"** — currently ActiveCommunities' real case.
- No `officialUrl` → button doesn't render at all (unchanged from before this phase).

No "Join waitlist"/"Book now"/spots-remaining language anywhere — confirmed by inspecting the diff, these strings don't appear.

## 7. `officialUrl` Behavior (Parts 9-10)

**[VERIFIED]**, unchanged code path (`selectedSession.officialUrl && <a href={...} target="_blank" rel="noopener noreferrer">`), only the label changed. Live-tested:
- A real Vaughan session's `officialUrl` (`https://vaughan.perfectmind.com/25076/Clients/BookMe4LandingPages/Class?widgetId=...&classId=...&occurrenceDate=...`) returned **HTTP 200** via a cold `curl` — no DropIn cookies, no prior PerfectMind session.
- The same session's internal `registrationStatus` was `"waitlist"` at fetch time and was confirmed **absent from every rendered element** in the live Decision Sheet screenshot — proof Part 12's hard constraint holds in practice, not just in code review.
- Never renders a fake `#`/disabled action for any source lacking a URL (Toronto, confirmed visually — only Directions + Share render).

## 8. Volatile Booking State Deliberately Excluded (Part 12)

**[IMPLEMENTED] + [VERIFIED]** `registrationStatus` (`"open" | "waitlist" | "closed"`) remains in the canonical model, populated by PerfectMind exactly as before (Phase 3.5B), and is retained purely for potential future internal logic. It is not read anywhere in `app/page.tsx`'s Decision Sheet JSX — confirmed by grep and by the live "waitlist" example in §7. `About DropIn` copy was reviewed (Part 13): no wording claims DropIn guarantees booking availability; "quickly see what's available" reads as schedule discovery in context ("without checking community centre schedules one by one"), and the Data Sources paragraph already hedges ("schedules can change, so we recommend checking the official source before you head out"). **No copy correction made** — none was genuinely necessary.

## 9. Mobile QA

**[VERIFIED]** on desktop viewport (1512px) with real data across all applicable source families: Vaughan pre-registration record (Adult Pickleball, "Pre-registration required" line + "Register" CTA), Markham pre-registration record (Drop-In Lane Swim, same pattern), Toronto walk-in record (Badminton, "Walk-in" line, no price line, no officialUrl button rendered — 1-column secondary grid), Mississauga unknown-attendance record (Drop-In Badminton, no attendance line rendered, "View official listing" CTA wrapping cleanly to 3 lines).

**[UNKNOWN]** True narrow-viewport (iPhone-width) visual QA. The browser tool's `resize_window` reported success but `window.innerWidth` never actually changed in this session (confirmed twice) — a tool limitation, not a code issue. Compensating verification performed instead: the modified "View official listing" button was inspected via computed layout (`scrollHeight === clientHeight`, 84px, `height: auto`) confirming its 3-line wrapped label is NOT clipped — no `overflow-hidden`, no fixed height, no `truncate` class anywhere in the new code. The Sheet component's mobile bottom-sheet behavior itself was not touched by this phase's diff. **[RECOMMENDATION]**: a real on-device glance is still worth doing before considering this fully closed — the dev server is reachable from a phone on the same Wi-Fi network at the LAN address already shared with the user.

## 10. Result Card Recommendation (Part 15)

**[RECOMMENDATION, not implemented]**: omitting "Pre-registration required" from the Result Card does not create a serious decision-cost problem. The activity name, time, centre, price, and age already give a user enough to decide whether to open the card; attendance requirement is one tap away in the Decision Sheet, consistent with how age/address-level detail already works today. Given ~1,476 of ~47,000 live sessions (Vaughan + Markham) would gain a new card-level badge while ~45,500 wouldn't, adding it now risks exactly the card information-density churn Part 15 asks to avoid. No action taken.

## 11. Results Sorting Audit (Parts 16-17, read-only, unchanged)

**[VERIFIED]**, traced directly in `app/page.tsx`'s `resultsGrouped` (the Results screen — distinct from the homepage's separate `discoveryHighlights` pool, which has its own unrelated `statusRank` diversify-by-district logic).

1. **Group ordering**: a hardcoded array order, not computed. When the selected date is today: `["Happening now", "Starting soon", "Starting today", "Later today"]` (empty groups filtered out). When a future date is selected: `["Morning", "Afternoon", "Evening"]` (empty filtered out) — unless a Time-of-Day chip is already active, which collapses everything to one flat unlabeled group.
2. **Within-group comparator**: `compareChronologically(a, b)` — `date` ascending first, then `startMinutes` ascending. Applied once to the whole filtered set (`[...resultsFiltered].sort(compareChronologically)`) before grouping; each group is a `.filter()` over that already-sorted array, so within-group order is inherited, not separately computed. No end time, facility, activity name, or source municipality enters the comparator.
3. **Distance sorting**: none exists. `distanceKm` is a real `Session` field but is referenced in exactly one place in the entire app — an inline display string (`` `· ${s.distanceKm} km` ``) — never in any comparator, filter, or sort call. No current source populates it either.
4. **Tie-breaking**: `Array.prototype.sort` is spec-guaranteed stable, so two sessions with identical `(date, startMinutes)` keep their relative order from the array `sort()` was called on. That input order traces back to `MUNICIPALITY_SLUGS`'s declared order (`toronto, mississauga, richmond-hill, vaughan, markham`) in `lib/dropin/sources/index.ts`, and within one municipality, whatever order that municipality's canonical snapshot's own `sessions` array holds — itself inherited from the upstream source's response order at refresh time. This is a real tie-break, not an absence of one, but it is not a designed key like "facility name A-Z" — it's "whichever source/refresh order produced it."
5. **Determinism across refreshes**: deterministic *within* one loaded snapshot generation (same tab session always sorts the same way), but **not guaranteed identical across two different refresh runs** when a tie exists — if an upstream source (most plausibly PerfectMind, given real page-content churn observed between refreshes in Phase 3.5B) returns two same-time records in a different relative order on a later refresh, their tie-broken position could swap. This was not observed to cause a visible problem in this phase's testing, but it is an honest, previously-undocumented characteristic now on record.

**[RECOMMENDATION]** for Phase 4: distance sorting has a clean, obvious insertion point — a `distanceKm`-based comparator slotted before or as a tiebreaker to `compareChronologically`, once `distanceKm` is actually populated by geocoding — but nothing about today's comparator needs to change to make room for it.

## 12. Known Limitations

**[KNOWN LIMITATION]**:
- `attendanceRequirement` is only two-valued today; a genuine "registration available but not required" source would need a third value added with its own real evidence, not retrofitted from what exists now.
- Tie-break determinism across refreshes is weaker than it might appear (§11.5) — not a regression introduced by this phase, but newly documented.
- True mobile-viewport visual QA is outstanding (§9) due to a tool limitation this session, not a code gap.
- The `"walk-in"` → "Official listing" CTA branch is implemented but has no real source to exercise it yet.

## 13. Remaining Product Risks

**[RECOMMENDATION]**: if a future PerfectMind tenant's platform ever supports a genuine walk-in program alongside registered ones (unlike Vaughan/Markham today, where every sampled record is registration-only), the current per-source-family constant would need to become per-category or per-program instead — worth flagging before assuming every future PerfectMind municipality is uniformly `"pre-registration-required"`. Toronto's `"walk-in"` classification rests on dataset-category inference (no explicit per-record field), consistent with the project's own long-standing "imperfectly, but at least nominally" framing — a genuinely walk-in-vs-registered-mixed Toronto dataset would silently misclassify under the current constant-per-source-family design.
