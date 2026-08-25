# Launch Readiness 1B — About / Feedback / Privacy / Trust Copy Implementation

Implements exactly the smallest credible trust layer identified in `docs/LAUNCH_READINESS_1A_TRUST_PRIVACY_FEEDBACK_AUDIT.md`: an honest Feedback mechanism, an independent/unofficial-status statement, accurate freshness wording, a corrected Verified/Unverified decision, and a new lightweight Privacy surface. No accounts, analytics, database, scheduler, or hosting work was started — this phase is copy and one small, infrastructure-free plumbing change (`mailto:`).

---

## 1. About — Before/After

**Before** (5 content sections, 2 of which restated the same fact):
1. Intro (2 paragraphs)
2. "Where does the information come from?"
3. "Built for easier local recreation" (marketing restatement of the intro)
4. "Data sources" (restated section 2's claim, just naming the municipalities)
5. "Feedback" (fake local-state flow — see §6)

**After** (4 content sections, each doing distinct work):
1. Intro (1 paragraph, consumer-facing language per the task's own suggested wording)
2. "Where does the information come from?" (merged — names the source *and* the municipalities in one place)
3. "Keeping information current" (new — replaces the removed "Built for easier local recreation" slot with real, accurate freshness language)
4. "Independent project" (new — the unofficial-status statement)
5. "Feedback" (rebuilt — real `mailto:` link, no fake confirmation)
6. "Privacy" (new — one line + a link to the new Privacy sheet)

Net effect: two sections were removed (one redundant, one pure marketing) and three were added (freshness, independence, privacy pointer) — the sheet gained real trust content without growing past its previous length.

## 2. Final About Structure

```
About DropIn
├── [intro paragraph]
├── Where does the information come from?
├── Keeping information current
├── Independent project
├── Feedback
│     └── Email feedback (mailto:) + visible feedback@getdropin.ca
├── Privacy
│     └── link → opens the new Privacy sheet
└── DropIn · v1.0
```

## 3. Independence Statement

> "DropIn is an independent project and is not affiliated with or endorsed by the municipalities listed here. Their official recreation sources remain the authoritative source for schedules, fees, eligibility, and availability."

Appears exactly once in About (§9's placement decision — not repeated on Result Cards or the Decision Sheet, consistent with the existing per-session `officialSource` attribution already providing local context there).

## 4. Freshness Wording

**Removed**: *"We regularly refresh our listings"* — flagged in Launch Readiness 1A as stronger than the deployed reality (no production scheduler exists).

**Replaced with**: *"Each listing shows when it was last updated. Municipal schedules, fees, and availability can change, so we recommend checking the official listing before you head out."*

This makes no cadence claim at all — it points to the real, already-shipped per-session `daysAgoLabel` ("Updated 3 days ago") instead of asserting an update schedule DropIn can't yet back. Re-verified before writing this wording: `.github/workflows/` still does not exist, no cron configuration exists anywhere in the repo — confirmed fresh, not assumed from the prior audit. The task's explicit "Do not use ['DropIn refreshes its source data daily'] yet" instruction was followed — that sentence appears nowhere in the new copy.

## 5. Verified/Unverified Decision

**Chosen: Option C — remove the user-facing label**, per Launch Readiness 1A §8's own framing.

**Why**: traced `Session.attendanceRequirement` (shown separately via the existing, unchanged `attendanceRequirementLabel()` — "Walk-in" / "Pre-registration required") against `verificationStatus` and confirmed they carry different information. `attendanceRequirement` is the real, per-source-family, evidence-derived decision-relevant fact a user actually needs. `verificationStatus` is a much narrower internal signal — whether one specific structured field (`reservation_event_type_id`, ActiveCommunities-specific) could independently corroborate that same walk-in/registration distinction — and it's hardcoded `"unverified"` for 6 of 7 municipalities regardless of actual data quality. Removing the label loses no decision-relevant information a user was actually using, because the real fact was already shown elsewhere.

**What changed**: only the JSX rendering in the Decision Sheet's trust line (`app/page.tsx`). The array `[daysAgoLabel(...), officialSource]` no longer includes the `"verified"`/`"unverified"` conditional string.

**What did NOT change**: `Session.verificationStatus`'s type definition (`lib/dropin/types.ts`), and every source adapter's own assignment of it (`lib/dropin/sources/toronto.ts`, `lib/dropin/sources/activecommunities/normalize.ts`, `lib/dropin/sources/perfectmind/normalize.ts`) — all untouched, still populated exactly as before, preserved for any future internal use. This is a presentation-only change, consistent with the task's explicit "Do NOT change the underlying source-validation architecture merely to preserve a UI label" instruction.

## 6. Feedback — Before/After

**Before**: a 3-stage local `useState` flow (`idle`/`writing`/`sent`) — a textarea captured `feedbackText`, the "Send" button's entire handler was `setFeedbackStage("sent")`, and a confirmation message ("Thanks — we've received your note and will take a look.") displayed unconditionally. Traced exhaustively (again, fresh, in this phase): `feedbackText` was read in exactly one place (the textarea's own `value`/`onChange`) and never referenced anywhere else — no transmission of any kind occurred.

**After**: no local text-capture state at all. A short paragraph explains what feedback is welcome, followed by a single `<a href={feedbackMailtoUrl()}>Email feedback</a>` link that opens the user's own mail client with `feedback@getdropin.ca` pre-addressed, a pre-filled subject ("DropIn Feedback"), and a minimal, non-cumbersome body template. The plain address (`feedback@getdropin.ca`) is shown directly below the link as permanent visible text — the fallback the task's Part 13 requires for anyone without a configured mail client. **No success state of any kind is shown** — clicking the link hands off entirely to the OS/browser's own mailto handling, and DropIn has no way to know what happens next, so it doesn't claim to.

## 7. Mailto Implementation

`lib/dropin/contact.ts`:

```ts
export const PUBLIC_CONTACT_EMAIL = "hello@getdropin.ca";
export const PUBLIC_FEEDBACK_EMAIL = "feedback@getdropin.ca";

export function feedbackMailtoUrl(): string {
  const subject = "DropIn Feedback";
  const body = ["Hi DropIn team,", "", "I wanted to share feedback about:", "", "", "Details:", ""].join("\n");
  return `mailto:${PUBLIC_FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
```

Verified live: the rendered link's `href` starts with `mailto:feedback@getdropin.ca` and its protocol resolves to `mailto:` (confirmed via `new URL(link.href).protocol`). The body template is intentionally short — per the task's own "do not make the template cumbersome" instruction — and the user is free to write anything beyond it, since it opens their own full mail client rather than an in-app constrained textarea.

## 8. Public Contact Architecture

Both public addresses are defined exactly once, in `lib/dropin/contact.ts`, and imported everywhere they're used (`app/page.tsx`'s About section, Feedback section, and the new Privacy sheet) — no address is hardcoded a second time anywhere. This directly satisfies the task's "centralize public contact addresses in one small config/constants location" request without over-engineering it into a larger config system.

**The private Gmail destination (`getdropin.team@gmail.com`) does not appear anywhere in source code or rendered output** — verified two ways:
- Source-level: `grep -rn "getdropin.team\|gmail.com" app/ lib/` returns zero matches.
- Rendered-DOM-level (live): `document.body.innerHTML.includes('getdropin.team')` and `.includes('gmail.com')` both evaluated to `false` with the About sheet open.

## 9. Privacy Implementation

A second `<Sheet>` instance (`privacySheetOpen` state), reusing the exact same component, motion, and accessibility contract as the existing About sheet — the smallest architectural addition available, per the task's own Part 14 instruction to avoid a dedicated page or a larger legal-footer system. Opened via a link inside About ("See what DropIn does and doesn't collect"), which closes About and opens Privacy — only one sheet is ever open at a time, consistent with how every other sheet in this app already behaves.

Content sections, in order: no-account statement, Location (what it's for, that search works without it), Precise location storage, Analytics & cookies, Feedback email, Other websites (municipal sites + Google Maps), Contact (`hello@getdropin.ca`), and a closing line noting the notice may be updated as services evolve.

## 10. Privacy Claims Verified Against Code

Every claim in the new Privacy sheet was re-checked against current source before being written, not carried over from the prior audit unverified:

| Claim | Verified how |
|---|---|
| "No account is required" | Confirmed — zero accounts/authentication code exists anywhere in the repo |
| Location used for distance + Nearest First, search works without it | Confirmed — `distanceKmFor`/`compareNearest` both gate on `userLocation.status === "granted"`; `resultsFiltered`/search filtering has no location dependency |
| Precise coordinates stay on-device, not stored, not in URLs, not in Share | Confirmed fresh: `useUserLocation` is plain `useState` (no `localStorage`/`sessionStorage` write); zero `URLSearchParams`/`window.location`/router calls exist anywhere in the app; `handleShare`'s summary construction (`displayActivityName`, `centre`, `timeLabel`, `officialUrl`) contains no coordinate reference of any kind |
| No analytics, no advertising tracking, no tracking cookies, no account tracking | Confirmed — `package.json` production dependencies are `next`/`react`/`react-dom` only; zero analytics library or custom tracking code exists |
| Feedback handled through email, not stored in a database | Confirmed — no database, ORM, or persistent server-side store exists anywhere in the repo; the only API route (`/api/sessions`) is unrelated and read-only |
| DropIn links to municipal sites and Google Maps, each with their own practices | Confirmed — `directionsUrl()` builds a Google Maps link from facility coordinates or address only; `officialUrl` links are per-session municipal URLs from canonical data |

## 11. Deployment-Dependent Privacy Unknowns

Deliberately excluded from the shipped Privacy content, per the task's own Part 16 instruction not to invent hosting behavior:

- Any statement about server/CDN access log retention, hosting-provider analytics, IP retention, or infrastructure-level telemetry — no hosting has been selected, so none of this can be described accurately yet.
- Any future analytics disclosure, if analytics are ever added later — the Privacy sheet's current "no analytics" claim must be updated in the same change that introduces one, not after.

The Privacy sheet's closing line ("This notice may be updated as DropIn's services evolve.") is the one sentence covering this, exactly as the task suggested, without attempting to describe what those future changes will say.

## 12. Mobile Verification

Structurally verified at 390px and 430px via the DOM-width-constraint technique established in earlier phases of this project — with one honestly-reported limitation specific to this phase's own surfaces:

- **Content reflow** (text wrapping, email-address visibility, section readability): verified directly by constraining the `Sheet` dialog element's own width to 390px and 430px. Confirmed at both widths: no text overflow, `feedback@getdropin.ca` and `hello@getdropin.ca` both render fully on one line with no truncation, all section headings and paragraphs remain readable, and the Email feedback link and Privacy link are both clearly tappable.
- **Tap targets measured**: the "Email feedback" text link is 95.7×20px (a text link, matching the same style already used elsewhere in this app, e.g. the previous "Let us know" link); the Sheet's own close button remains 28×28px — the same pre-existing, already-documented (Phase 4 Final Acceptance Audit) finding, not something this phase introduced or was asked to fix.
- **A genuine limitation found and reported honestly**: the `Sheet` component's `md:` responsive classes (which control whether it renders as a full-width bottom sheet or a centered desktop modal) respond to the browser's real `window.innerWidth`, not to the DOM-width-constraint technique used elsewhere in this project — confirmed directly (`window.innerWidth` stayed `1440` throughout, even while the dialog's own content visibly reflowed at a constrained width). This means the Sheet's outer shell — specifically, whether it correctly renders as a bottom sheet at true mobile viewport widths — could not be structurally verified this phase, the same category of limitation as the already-documented `resize_window` tool failure, just surfacing in a new place (fixed-position overlays specifically, rather than normal document flow). This is reported honestly rather than glossed over.
- **Physical-device verification**: not performed, not claimed, consistent with this project's established discipline.

## 13. Files Changed

- **`lib/dropin/contact.ts`** — new file. `PUBLIC_CONTACT_EMAIL`, `PUBLIC_FEEDBACK_EMAIL`, `feedbackMailtoUrl()`.
- **`app/page.tsx`** — one new import; `feedbackStage`/`feedbackText` state removed, `privacySheetOpen` state added; the About sheet's content fully restructured (§1–§2); a new Privacy `<Sheet>` added; the Decision Sheet's trust line no longer renders the Verified/Unverified prefix (§5).

No other file was touched. `git status` confirms exactly these two files changed.

## 14. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npm run build`: succeeds, all 10 routes compiled.
- `npx eslint app/page.tsx lib/dropin/contact.ts`: exactly the same 10 pre-existing, out-of-scope errors documented since Phase 3.6B — zero new errors, and `contact.ts` itself is fully clean.
- Live verification: search, date navigation, activity filtering, location grant, distance display, and Nearest First were all re-tested after the changes and confirmed working exactly as before — a real Mississauga session correctly showed distance ("18 km") and reordered under Nearest First; a real Toronto Decision Sheet correctly showed Directions/Share and the corrected trust line; state (search text, filters, results) survived opening and closing both the About and Privacy sheets without resetting.
- Console check: one error present, confirmed to be the same pre-existing, unrelated Grammarly browser-extension hydration warning already documented in earlier phases of this project — not caused by this work.
- Snapshot architecture, source adapters, Directions, Official Listing/Register, Share, and ranking logic: none of these files were touched; confirmed via `git status` and direct re-testing above.

## 15. Remaining Risks

- The `Sheet` component's true mobile bottom-sheet shell rendering remains structurally unverified in this environment (§12) — a real, pre-existing tooling gap, not something this phase's content changes could have introduced, since the shell markup/classes were not modified.
- The Sheet's own close button (28×28px) remains short of the 44px comfort target — unchanged from before this phase, already tracked as a known, non-blocking finding.
- The new Privacy content will need a follow-up pass once hosting is selected (§11) — explicitly scoped out of this phase, not forgotten.

---

## Closing Answers

**A. Is About now launch-ready from a trust/content perspective?** Yes — the redundant section was merged, the independence statement and Privacy pointer were added, and freshness wording no longer overclaims relative to the deployed reality.

**B. Is the independent/unofficial status clearly communicated?** Yes — one explicit, plainly-worded statement in About, appearing once (not repeated throughout the UI, per the task's own instruction).

**C. Is the freshness wording accurate for the fact that no production scheduler exists yet?** Yes — the new copy makes no cadence claim at all; it points to the real per-listing "Updated ..." label instead, re-verified fresh that no scheduler/cron exists anywhere in the repo before writing it this way.

**D. What happened to the previous Verified/Unverified wording?** Removed from the UI (Option C, §5) — the underlying `Session.verificationStatus` field and every source adapter's assignment of it are completely untouched; only the Decision Sheet's rendering of it changed.

**E. Does Feedback now perform a real user action instead of a fake submission?** Yes — clicking "Email feedback" opens a real `mailto:` link with a pre-addressed, pre-subjected email in the user's own mail client; no confirmation message is shown, since DropIn genuinely cannot know whether the resulting email is sent.

**F. Where does Feedback go?** `feedback@getdropin.ca`, which per the task's own infrastructure routes through Cloudflare Email Routing to the project's private inbox — DropIn's own code has no visibility into or involvement in that routing.

**G. Is the private Gmail destination hidden from users?** Yes — confirmed absent from both the source code (repo-wide search) and the live rendered DOM.

**H. Does a Privacy surface now exist?** Yes — a new, separate `Sheet` instance, linked from About, visually consistent with the existing design system.

**I. Does the Privacy copy match the currently verified architecture?** Yes — every claim was re-checked against current source in this phase, not carried over unverified from the prior audit (§10).

**J. Are any privacy statements still deployment-dependent?** Yes, explicitly identified and deliberately excluded rather than guessed at: hosting-infrastructure log behavior and any future analytics disclosure (§11).

**K. Did any unrelated product behavior change?** No — search, date navigation, activity filtering, location, distance, Nearest First, ranking, Result Cards, the rest of the Decision Sheet, Directions, Official Listing/Register, Share, the snapshot architecture, and every source adapter were all confirmed unaffected, both by file-scope inspection (`git status`) and live re-testing.

**L. Is Launch Readiness 1B complete?** Yes, for the scope defined in the task (About cleanup, independence statement, freshness wording, Verified/Unverified decision, real Feedback mechanism, lightweight Privacy surface, public contact architecture). Security & Deployment Audit, hosting selection, scheduler/cron, analytics, database, a feedback backend, accounts, Map View, and any unrelated redesign were correctly not started.

---

Stopping here, as instructed. Not beginning the Security & Deployment Audit automatically.
