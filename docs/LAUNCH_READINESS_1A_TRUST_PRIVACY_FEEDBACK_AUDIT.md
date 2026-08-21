# Launch Readiness 1A — About / Transparency / Feedback / Privacy Audit

An audit-only pass over DropIn's current trust surface (About, data transparency, Feedback, Privacy posture, and unofficial-status communication), verified against the actual shipped implementation rather than prior planning documents. **No production code was changed.** `docs/LAUNCH_READINESS_PLAN.md` (the earlier planning pass) documented intentions; this audit checks what's actually true today.

---

## 1. Executive Summary

DropIn's core product experience (Phase 4, just completed) is solid and well-instrumented for trust: source attribution, freshness labels, and Official Listing links all exist and work. But the trust *surface* — the parts of the product that explain what DropIn is, where its confidence comes from, and what happens to a user's input — has one concrete, provable problem and several real gaps:

- **The Feedback "Send" button transmits nothing.** Confirmed by direct code trace: clicking Send discards the typed text and shows "Thanks — we've received your note and will take a look" regardless. This is not a UX nitpick — it is a materially false claim shown to every user who tries to report a problem.
- **No unofficial/independent-status statement exists anywhere in the product.** Given DropIn surfaces real municipal names, logos-in-spirit (`officialSource` strings like "City of Toronto Open Data"), and an "Official listing" CTA, the absence of an explicit "DropIn is independent, not affiliated with these municipalities" line is a real gap, not a hypothetical one.
- **No Privacy surface exists at all** — not even a short section. Given how little DropIn actually collects (confirmed in §6), a full legal-style policy would be disproportionate, but *something* should exist before public launch.
- **The "Verified"/"Unverified" trust-line label is technically narrow but reads broadly** — a real, non-obvious finding: it signals whether DropIn could confirm attendance mode via a structured source field, not whether the listing is accurate. It is "Unverified" for 6 of 7 municipalities' entire datasets, always, by construction, and this is never explained anywhere in the UI.
- **The About sheet has a real content redundancy** — two separate sections ("Where does the information come from?" and "Data sources") say almost the same thing.

None of this requires new infrastructure to *communicate* honestly. It requires either a small amount of real plumbing (feedback) or a small amount of additional copy (disclaimer, privacy, verification-status explanation) — not a redesign, not accounts, not analytics.

## 2. Verified Current State

Everything below was re-derived from the current source, not assumed:

- **About content** lives entirely inside one `Sheet` component in `app/page.tsx` (the `infoSheetOpen` state, opened from the header info icon), triggered by a single tap — no separate route, no separate page.
- **Feedback** lives inside the same sheet, driven by local `feedbackStage`/`feedbackText` state with no network call anywhere in its path.
- **No Privacy page, route, or section exists** — confirmed by a full-repo search for "privacy" in any `.tsx`/route file; the only occurrence anywhere in the codebase is inside `docs/LAUNCH_READINESS_PLAN.md` itself (planning prose, not shipped UI).
- **No disclaimer/unofficial-status copy exists** anywhere in shipped UI.
- **Package dependencies** are minimal: `next`, `react`, `react-dom` only in production dependencies — zero analytics, tracking, or auth libraries present, not even unused ones.
- **Exactly one API route** exists (`/api/sessions`, `GET`, zero parameters), and no database, ORM, or persistent server-side store exists anywhere in the repo.

## 3. About Audit

Full current copy (verbatim, in order):

1. *"DropIn makes it easier to find drop-in activities happening at community centres near you."*
2. *"Search for an activity, choose a day and time, and quickly see what's available — without checking community centre schedules one by one."*
3. **"Where does the information come from?"** — *"DropIn brings together publicly available recreation schedules from participating municipalities. We regularly refresh our listings, but schedules can change, so we recommend checking the official source before you head out."*
4. **"Built for easier local recreation"** — *"Whether you're looking for badminton tonight, a weekend swim, or simply something active nearby, DropIn is designed to help you find an option with less searching."*
5. **"Data sources"** — *"DropIn currently covers {live municipality list}, using each city's official recreation listings. We're working to bring in more municipalities over time."*
6. **"Feedback"** — see §5.
7. Footer: *"DropIn · v1.0"*

**What's already good:**
- Plain, non-legalistic language throughout — matches the product's stated tone goal.
- The municipality list (§3, item 5) is generated live from `AVAILABLE_MUNICIPALITY_NAMES` (`lib/dropin/municipalities.ts`), not hardcoded — confirmed it cannot silently go stale as coverage grows, a real fix already made in an earlier phase.
- The official-source recommendation ("we recommend checking the official source before you head out") is present and matches the product's core trust principle.

**What's redundant:** Sections 3 ("Where does the information come from?") and 5 ("Data sources") both answer the same question — one in narrative form, one naming the specific municipalities. A user reads essentially the same claim twice, three paragraphs apart.

**What's missing:**
- No unofficial/independent-status statement (§8).
- No explanation of what "Official listing" means as a UI element, despite it being a real, frequently-seen button.
- No explanation of what "Verified"/"Unverified" means (§4).
- No privacy content, not even a one-line pointer.
- No real freshness cadence — "We regularly refresh our listings" is vague, and (per §12) not yet literally backed by any deployed automation.
- Section 4 ("Built for easier local recreation") is marketing copy that substantially restates section 1's intro sentence without adding new operational information — a candidate for trimming, not because it's wrong, but because it adds length without adding trust-relevant content.

**What could mislead a user:** The Feedback confirmation message (§5) is the clearest case. More subtly, showing real municipal names and official-source attribution throughout the product *without* ever stating independence could let a casual user assume some kind of official partnership exists, even though nothing explicitly claims one.

**What should change before launch:** Consolidate sections 3 and 5, add an unofficial-status line, tie freshness language to what's actually true, either fix or soften the Feedback confirmation, and add a short privacy pointer. Full recommendation in §7–§9.

## 4. Data Transparency Audit

Checked against the 7 concepts requested, across every real surface that touches them:

| Concept | Where it's communicated | Consistent? |
|---|---|---|
| 1. Where data comes from | About §3/§5; per-session `officialSource` on the Decision Sheet | Yes, consistent, but redundant within About itself (§3) |
| 2. Municipal affiliation | **Nowhere** | Gap — not contradictory, simply absent |
| 3. Schedules may change | About §3 ("schedules can change") | Present once, not reinforced elsewhere, which is proportionate — no need to repeat it on every card |
| 4. Which source wins on disagreement | Implied by "we recommend checking the official source," never stated explicitly as a rule | Weak but not contradictory |
| 5. Refresh recency | Two different mechanisms: About's vague "regularly refresh," and the real, specific per-session/per-result `daysAgoLabel` ("Updated 3 days ago", "Updated today") shown on the Results meta line and the Decision Sheet's trust line | **Inconsistent in precision** — About makes a vague aggregate claim while the UI elsewhere makes an honest, specific, per-item claim. Not contradictory, but a mismatch in confidence level. |
| 6. Why detail varies by municipality | **Nowhere** — confirmed real variance exists (e.g., Toronto has no `officialUrl` per session at all, while every ActiveCommunities/PerfectMind municipality does; age-data coverage ranges from 49.3% to 100% across municipalities per the Phase 4 acceptance audit) | Gap |
| 7. What "Official listing" means | The button exists and works; its meaning is never explained | Gap |

**Additional finding, not on the original checklist but directly relevant:** the Decision Sheet's trust line reads `Verified/Unverified · Updated N ago · [officialSource]`. Tracing `verificationStatus` through every source adapter: **Toronto is the only municipality ever marked `"verified"`; Mississauga, Richmond Hill, Vaughan, Markham, Newmarket, and Aurora are unconditionally `"unverified"` for every session, by construction** (confirmed in `lib/dropin/sources/activecommunities/normalize.ts` and `lib/dropin/sources/perfectmind/normalize.ts` — both hardcode `verificationStatus: "unverified"` with a comment explaining the real reason: these source families lack a reliable structured field to confirm walk-in vs. reservation-required attendance mode, the specific narrow thing "verified" actually certifies). The word "Unverified," shown prominently and permanently for 6 of 7 municipalities, is easy to misread as "this listing might be wrong" when its real, narrower meaning is "we could not confirm attendance mode from a structured field." This is never explained anywhere in the product.

**No outright contradictions were found** — every claim, taken individually, is true. The issues are gaps (affiliation, verification meaning, per-municipality detail variance) and one precision mismatch (About's vague freshness claim vs. the UI's specific ones), not conflicting statements.

## 5. Feedback Audit

Traced exhaustively through `app/page.tsx`:

```tsx
const [feedbackStage, setFeedbackStage] = useState<"idle" | "writing" | "sent">("idle");
const [feedbackText, setFeedbackText] = useState("");
...
<button type="button" disabled={feedbackText.trim().length === 0} onClick={() => setFeedbackStage("sent")}>
  Send
</button>
```

- **`feedbackStage` has exactly four references in the entire file**: its declaration and three conditional-render checks (`idle`/`writing`/`sent`). No `useEffect` watches it. No function reads `feedbackText` anywhere except the `<textarea>`'s own `onChange`/`value` binding.
- **The "Send" button's entire behavior is `setFeedbackStage("sent")`.** Nothing else happens. `feedbackText` is never read again after being typed — it is not sent to a server, not written to any storage, not logged, not emailed.
- **A repo-wide search found zero backend for this.** No API route, no email integration, no third-party form service (no Formspree/Netlify Forms/etc. reference anywhere), no `fetch` call in the Send path.
- **The confirmation message is unconditional**: *"Thanks — we've received your note and will take a look."* This displays for any non-empty input, every time, regardless of what happens next (nothing) — confirmed this is not gated on any success signal, because there is no operation to succeed or fail.
- **On close, the text is discarded**: the `Sheet`'s `onClose` handler resets `feedbackStage` to `"idle"` and `feedbackText` to `""`.

**Conclusion: the current Feedback implementation actively misleads users.** A user who reports a real problem (an incorrect schedule, a wrong address) reasonably believes their report reached someone. It does not reach anyone. This is the single clearest, most concrete finding in this audit.

**No contact email exists anywhere in the codebase** (confirmed by search) — meaning even the smallest possible honest fallback (a `mailto:` link) requires a real business decision (what address to use) before it can be wired up, not just a code change.

**Recommended smallest credible mechanism for initial public launch** (not implemented here, per instructions): a `mailto:` link to a real, monitored address, with the existing textarea either removed (if `mailto:` opens the user's own mail client with a pre-filled subject/body) or kept as a courtesy pre-fill for that same `mailto:` link. This requires zero new infrastructure, zero new dependencies, and is honest — the moment the user's mail client opens, the promise made to them ("let us know") is actually kept. A real backend (form-to-database, form-to-email service) is a reasonable *later* upgrade but is more infrastructure than a v1 launch needs, per the product's own "avoid unnecessary infrastructure" principle.

**Conceptual categories** (incorrect activity information / missing-outdated listing / website-search problem / feature suggestion / general feedback) are a reasonable future structure for a dropdown or subject-line prefix, but **not implemented here** per instructions — the free-text `mailto:` body already lets a user describe any of these without DropIn needing to build a taxonomy for v1.

## 6. Privacy Architecture Audit

**A. DropIn application code intentionally collects/processes:**

| Data | Collected? | Where | Persisted? | Leaves the browser? |
|---|---|---|---|---|
| Precise geolocation coordinates | Only if the user explicitly taps the location control | `useUserLocation` hook, `app/page.tsx` | No — plain `useState`, resets on reload | No — used only for a local Haversine distance calculation against already-fetched facility coordinates |
| List/grid density preference | Yes, automatically | `localStorage["dropin-results-density"]` | Yes, indefinitely, client-side only | No |
| Search text, selected date/filters | Yes, in-memory only | React component state | No — lost on reload | No — used only to filter already-fetched local session data |
| Feedback text | Yes, while typing | React component state | No — discarded on send or close (§5) | **No — confirmed never transmitted anywhere** |
| Cookies of any kind | **No** | — | — | — |
| Analytics/telemetry of any kind | **No** — zero analytics library installed, zero custom tracking code | — | — | — |
| User accounts / authentication | **No** — no such concept exists in the codebase | — | — | — |
| IP address (application-level) | **No** — the one API route (`/api/sessions`) never reads or logs request metadata | — | — | — |

**B. Infrastructure-level data a future hosting provider may automatically process** (not DropIn's own code, not yet determined — no hosting has been selected):

- Standard web server/CDN access logs (IP address, user agent, request path, timestamp) — nearly universal at the infrastructure layer regardless of hosting choice, and entirely outside application code's control.
- Any hosting-provider-level analytics dashboard that some platforms enable by default (varies by provider — cannot be predicted without a provider chosen).
- TLS/CDN-level metadata (also provider-dependent).

This split matters for the Privacy recommendation in §7: DropIn's own code has an unusually small, easy-to-describe footprint, but a complete Privacy statement eventually needs one sentence acknowledging that the hosting layer itself may log standard request metadata — a sentence that cannot be made specific or accurate until a host is chosen (§12).

**Geolocation specifics** (re-verified fresh, consistent with the Phase 4 Final Acceptance Audit completed immediately before this one):
- Requested only via explicit tap (header pill or "Nearest first" control) — never on page load.
- Coordinates never leave the browser: the only network call in the entire client app is `fetch("/api/sessions")`, which accepts zero parameters.
- Never stored: plain `useState`, not `localStorage`/`sessionStorage`.
- Never in a URL: zero `URLSearchParams`/`window.location`/router-navigation calls exist anywhere in the app.
- Never in Share content: `handleShare`'s summary is built from activity name, centre, time, and official URL only — confirmed by direct inspection, no coordinate of any kind.
- On denial: the app reverts cleanly to its default, fully-functional state — no retry nagging, no broken UI.

## 7. Privacy Communication Recommendation

Given §6's findings — a genuinely small, easy-to-describe data footprint, no accounts, no analytics, no cookies, no server-side storage — a full legal-style Privacy Policy would be disproportionate to what the product actually does, and would risk reading as more alarming than the reality (a long policy implies there's a lot to explain; here there isn't).

**Recommendation: Option B — a separate, lightweight Privacy page**, not buried inside About, and not a full legal document.

Reasoning:
- **Not Option A (inside About)**: About is already carrying redundant content (§3) and is a `Sheet`, not a full page — appending a privacy section risks making an already-borderline-long modal worse (§10), and privacy deserves its own stable, linkable location a user (or an app-store/platform reviewer, if DropIn is ever distributed that way) can point to directly.
- **Not Option C (full legal policy)**: nothing in §6 justifies dense legal language — DropIn doesn't need clauses about international data transfers, children's privacy law, or cookie-consent banners, because none of those apply. Writing one anyway would be exactly the "large copied legal template" this product's own stated design principle explicitly warns against.
- **Option B** lets the page be genuinely short (a handful of short paragraphs mapping directly to §6's table), linked from About rather than nested inside it, and — critically — easy to keep accurate as the product evolves, since it isn't entangled with About's own product-description copy.

**What can be written with full confidence today** (from §6.A): geolocation behavior, the absence of accounts/cookies/analytics/tracking, and the Feedback data handling (once §5's recommendation ships, this section must describe whatever the real mechanism turns out to be — currently there is nothing to describe because nothing is collected).

**What must wait** (deployment-dependent, see §12): the hosting-infrastructure-logs sentence (§6.B), and any statement about analytics if one is ever added later — the existing `LAUNCH_READINESS_PLAN.md` already correctly identifies this dependency; this audit confirms it's still true and adds no new claims that would need to be walked back.

## 8. Disclaimer Recommendation

**Yes, DropIn should explicitly communicate its independent/unofficial status.** This is not a hypothetical concern — the product actively displays real municipal names and official-source strings (`"City of Toronto Open Data"`, `"City of Vaughan Recreation (PerfectMind)"`, etc.) throughout the Decision Sheet, and offers an "Official listing" CTA that visually sits alongside those names. A user has every reasonable basis to wonder whether DropIn has some kind of formal relationship with these cities — and nothing currently in the product answers that question either way.

**Where it should appear:** once, prominently, in About (or the new Privacy page's opening line, or both — a single short sentence duplicated in two places is not "excessive," it's normal practice for a fact this important) — **not** repeated on every Result Card or Decision Sheet. The existing per-session `officialSource` attribution (§4) already does the work of showing *which* municipality's data is being displayed on any given card; that is sufficient localized context. Repeating a full disclaimer sentence on every card would be the "defensive legal clutter" this task explicitly warns against, and would fight the product's own "Comfortable Before Beautiful" and "Reduce Thinking, Not Information" principles.

**How prominent:** prominent enough to be found without effort (top-level in About, not buried under a scroll), but it does not need visual weight (no warning icon, no colored banner) — a plain sentence is proportionate to the actual risk, which is a misunderstanding, not a safety issue.

## 9. Recommended Information Architecture

The task's own example (About with six sub-sections including Privacy and Feedback as children) is **not quite right** given §7's own conclusion that Privacy deserves a separate, stable surface. Recommended structure instead:

```
About (existing Sheet, content trimmed per §10)
├── What DropIn does (sections 1–2, kept, trimmed for redundancy with §4 below)
├── Where the data comes from + freshness + official-source recommendation
│     (merge current sections 3 + 5 into ONE section — see §3's redundancy finding)
├── Independent/unofficial-status line (NEW, §8)
├── Feedback (existing, behavior fixed per §5's recommendation)
└── Link to Privacy (NEW — a single line + link, not the content itself)

Privacy (NEW, separate lightweight page/route, linked from About)
├── What DropIn uses your location for, and that it's optional
├── That DropIn stores no accounts, uses no analytics/cookies/tracking (today)
├── What happens to Feedback text (once §5 ships)
├── One sentence on hosting-infrastructure logs (deployment-dependent, §12)
├── Third-party destinations (municipal Official Listings, Google Maps) have their own practices
└── Contact
```

This keeps About focused on *product* information (what/where/how-fresh/independent-status/feedback) and gives Privacy its own small, stable, linkable surface — proportionate to the actual amount of content each deserves, not an assumed template.

## 10. UI/Content-Quality Assessment

Reviewed the shipped About `Sheet` as it exists today, not a redesign:

- **Length**: currently 5 content sections plus a feedback block and version footer — already at the edge of what a bottom sheet/modal should comfortably hold before it starts to feel like a document rather than a quick reference. Confirmed via the existing mobile-width verification pattern (structural, DOM-constrained) established in the Phase 4 audit: at 390px, the sheet's content requires scrolling past roughly two screen-heights of text today, before any Privacy or disclaimer content is added.
- **Scanability**: the small `text-xs font-semibold text-sage-text` sub-headings do real work here and should be preserved — they're the reason the sheet reads as sections rather than one wall of text.
- **Repetition**: confirmed concretely in §3 (sections 3 and 5 restate the same fact).
- **Mobile readability**: no font-size or line-length problems found — the existing type scale and `Sheet` width already handle this correctly; the concern is purely *length*, not typography.
- **Would adding Privacy content make the modal excessively long?** Yes, if inserted directly — this is the strongest concrete argument for §7's "separate page" recommendation over "inside About." A Privacy section written with the same care as the rest of About (i.e., not terse to the point of being unhelpful) would add real length to an already-borderline sheet.
- **Is Feedback sufficiently discoverable?** Yes structurally — it's the last visible content section before the version footer, always reachable without extra navigation. The discoverability isn't the problem; the honesty of what happens after discovery is (§5).
- **Does the current structure feel like product information or policy text?** Currently, entirely like product information — which is a real strength worth preserving. The recommendation in §9 is deliberately structured to keep it that way by moving policy-flavored content (Privacy) to its own surface rather than diluting About's current tone.

**Recommendation: trim, don't expand About in place.** Merging the two data-source sections (§3) roughly offsets the length cost of adding one new short disclaimer line and one short "see Privacy" pointer — the sheet can gain real trust content without growing net-longer than it is today.

## 11. P0 / P1 / P2 Classification

| Finding | Classification | Reasoning |
|---|---|---|
| Feedback "Send" transmits nothing but shows a false success message | **P1** | Provably dishonest to users attempting to report real problems; does not block the app's core search functionality from working, but must be fixed (or the confirmation copy honestly softened) before public launch — the more conservative, defensible classification is P1 rather than P0, since it does not break the product's primary function |
| No independent/unofficial-status statement anywhere | **P1** | A real gap given the product actively displays municipal names and official-source attribution; low effort to close (one sentence) |
| No Privacy surface exists | **P1** | Proportionate, low-effort given the small real data footprint (§6); appropriate to have *something* before public launch even though the footprint is small |
| Redundant "Where does the information come from?" / "Data sources" sections | **P2** | Real but purely a polish/clarity issue, not trust-critical |
| "Verified"/"Unverified" label meaning never explained | **P2** | Real communication gap, but the underlying data itself is not misrepresented anywhere else — this is a clarity improvement, not a correctness fix |
| "We regularly refresh" not yet backed by deployed automation | **P2**, becomes **P1 at the moment of public deployment** | Not misleading *today* (pre-deployment), but must be either true or reworded by the time DropIn is actually live — see §12 |
| No explanation of what "Official listing" means as a UI element | **P2** | Minor discoverability gap; the button is self-explanatory enough in context (it's clearly a link near a "Directions" button) that this is a nice-to-have, not a trust risk |
| No explanation of why municipalities show different levels of detail | **Not needed** | This is normal, expected variation in an aggregator; explaining every data-availability nuance would add length without meaningfully increasing user trust |
| Hosting-infrastructure logging disclosure | **Not needed yet** | Cannot be written accurately before a host is chosen (§12) — correctly deferred, not a current gap |

**No P0 (launch blocker) was found.** Every real issue is fixable with copy changes and a small amount of honest plumbing (a `mailto:` link), none of which requires new infrastructure, redesign, or blocks the product's core search functionality from being demonstrably ready.

## 12. Deployment-Dependent Unknowns

Explicitly cannot be finalized until later decisions are made — listed here so they aren't forgotten, not attempted:

- **Hosting-infrastructure log disclosure** — the exact sentence describing what a host automatically logs depends entirely on which host is chosen; writing it now would mean guessing at behavior this audit has no evidence for (correctly avoided, per this task's own instruction not to invent hosting behavior).
- **Refresh-cadence honesty** — About's "We regularly refresh our listings" becomes literally true only once a scheduler is actually deployed (confirmed still absent: no `.github/workflows/`, no cron configuration anywhere in the repo, consistent with Phase 3.3B's own "NOT CONFIGURED" finding, re-verified fresh in this audit). Before public launch, this claim should either be backed by a real deployed scheduler or reworded to something honestly true regardless of automation status (e.g., referencing the actual per-listing freshness label the UI already shows, rather than an aggregate promise).
- **The real feedback-transmission mechanism's own privacy language** — §7 notes the Privacy page's Feedback-data section can only be written accurately once §5's recommendation (or whatever mechanism is actually chosen) ships.
- **Any future analytics** — if added, the Privacy page must be updated in the same change, not after; today's accurate claim ("no analytics") must not be allowed to go stale.

## 13. Exact Recommended Scope for Phase 1B

Based only on findings classified P1 above (the P0-free result in §11), Phase 1B's implementation scope should be exactly:

1. **Fix or honestly soften the Feedback mechanism** — implement the `mailto:`-based approach recommended in §5 (requires a real contact email address to be decided first — a small business decision, not a code task), replacing the current unconditional false-success message.
2. **Add one independent/unofficial-status sentence** to About (§8), plus the same sentence (or a closely-matching one) at the top of the new Privacy page.
3. **Create the lightweight Privacy page** recommended in §7/§9 — short, mapped directly to §6's real data-footprint table, explicitly marking the hosting-log sentence as "to be added once hosting is finalized" rather than guessing at it.
4. **Merge the two redundant About data-source sections** (§3) into one, freeing up length budget for items 2 and a "see Privacy" link.
5. **Do not** address the P2 items (verification-status explanation, "Official listing" tooltip/explainer, refresh-cadence rewording) in 1B unless they can be folded in at near-zero additional cost while doing the above — they are real but lower priority and shouldn't expand this phase's scope.

---

## Closing Answers

**A. Is the current About content launch-ready?** No — functionally accurate but incomplete: missing an independence/unofficial-status statement and any privacy pointer, and contains one real content redundancy. Fixable with copy changes only, no redesign.

**B. Is the current Feedback implementation launch-ready?** No — confirmed by direct code trace that it transmits nothing while unconditionally claiming success. This is the audit's clearest, most concrete finding.

**C. Does DropIn currently collect personal data through application code?** Effectively no. The only personal data ever handled is device geolocation, and only when the user explicitly opts in — it never leaves the browser, is never stored, and is used solely for an in-browser distance calculation. No accounts, cookies, analytics, or server-side user data exist anywhere in the codebase.

**D. Does DropIn need a Privacy surface for v1?** Yes, but a short, proportionate one (§7) — not because the current footprint is large (it isn't), but because *some* clear statement should exist before public launch, and having one costs little given how little there is to explain.

**E. Does DropIn need an explicit unofficial/independent disclaimer?** Yes (§8) — the product displays real municipal names and official-source attribution throughout without ever stating there's no formal relationship; this gap should close before public launch.

**F. Should Privacy live inside About or separately?** Separately (§7/§9) — About is already near its comfortable length limit, and Privacy content has a different nature (policy, not product description) that benefits from its own stable, linkable surface.

**G. Are there any P0 blockers?** No. Every finding is P1 or lower, and every P1 is closeable with copy changes and one small, infrastructure-free plumbing fix (a `mailto:` link) — nothing found in this audit prevents DropIn's core product from being demonstrably ready.

**H. What exactly should Phase 1B implement?** Exactly the five items in §13: fix/soften Feedback via a `mailto:` mechanism, add an independent-status sentence to About and the new Privacy page, create the lightweight Privacy page itself, and merge About's two redundant data-source sections. Nothing else — no accounts, no analytics, no legal-template Privacy Policy, no deployment work.

---

Stopping here, as instructed. No production code was modified, no Privacy page or new components were created, no feedback infrastructure was implemented, and no deployment or Map View work was begun.
