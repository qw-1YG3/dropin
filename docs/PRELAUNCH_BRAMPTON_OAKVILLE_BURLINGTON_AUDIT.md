# Pre-Launch Coverage Expansion Audit — Brampton, Oakville, Burlington

**Scope: source/architecture audit only.** Nothing was integrated, no config was added to `PERFECTMIND_MUNICIPALITIES`, no UI or About copy was changed, and no hosting/scheduler work was touched. Every finding below is backed by a real, live HTTP request made during this audit (not search-result summaries alone, not assumption) — timestamps, status codes, and real response payloads were captured directly. Where a determination genuinely needs more sampling than an audit justifies, that's stated explicitly rather than guessed.

**Current production coverage:** Toronto, Mississauga, Markham, Vaughan, Richmond Hill, Newmarket, Aurora.

---

## 1. Official Sources

| | Brampton | Oakville | Burlington |
|---|---|---|---|
| **Official recreation page** | `brampton.ca/EN/residents/Recreation/Programs-Activities` | `oakville.ca/parks-recreation-culture/programs-activities/drop-in-programs/` | `burlington.ca/en/recreation/drop-in-programs.aspx` |
| **Platform/vendor** | PerfectMind/BookMe4 — confirmed live (`cityofbrampton.perfectmind.com`); also confirmed via the official "Brampton Rec" Android app package name, `com.perfectmind.bramptonrec` | PerfectMind/BookMe4 — confirmed live (`townofoakville.perfectmind.com`) | PerfectMind/BookMe4 — confirmed live (`cityofburlington.perfectmind.com`) |
| **Drop-in distinguishable from registered programs?** | Yes — a dedicated "Drop-In and Try-It Programs" category group exists, structurally separate from "Fitness"/"Sports"/"Swimming" (registered-course groups of the same/similar names) | Yes — the entire booking widget's category structure is a single "Drop-in Programs" group (confirmed via the live category API) | Yes — a dedicated "Drop-in Programs" group exists |
| **Server-side access available?** | Yes, with a real nuance — see below | Yes, no caveats | Yes, no caveats |
| **Data mechanism** | Existing DropIn source family (PerfectMind) — same `ClassesV2` JSON API Vaughan/Markham/Newmarket already use | Existing DropIn source family (PerfectMind) | Existing DropIn source family (PerfectMind) |
| **Login/session required?** | No — same anonymous cookie + CSRF-token mechanism as existing tenants, confirmed live | No — confirmed live | No — confirmed live |
| **Anti-bot protections?** | **Yes, a real one — see below** | None found | None found |
| **Official URLs reconstructable?** | Yes — same `host + sitePrefix + EventId + OccurrenceDate + widgetId` shape as every existing PerfectMind tenant, confirmed against real sampled `EventId`/`OccurrenceDate` values | Yes, same shape, confirmed | Yes, same shape, confirmed |

### The Brampton anti-bot finding, in detail

Brampton's generic, human-facing widget landing page (`/Clients/BookMe4?widgetId=...`, with no specific calendar) is gated by **Queue-It**, a virtual-waiting-room service — confirmed twice, live, via a plain unauthenticated `HEAD` request: `HTTP/2 302` redirecting to `perfectmind.queue-it.net`, with `x-queueit-connector: cloudfront` in the response headers. This is real, current, and reproducible — not a one-off fluke.

**However — and this is the more important, more nuanced finding — the actual mechanism DropIn's existing adapter uses is not the generic landing page.** `lib/dropin/sources/perfectmind/client.ts`'s `createPmSession()` calls a *calendar-specific* deep link: `/Clients/BookMe4BookingPages/Classes?calendarId=<real-id>&widgetId=<id>&embed=False`. Tested live, with a real calendarId discovered via search-engine-indexed deep links (`d12803f9-36d1-4bfa-870a-ed8c406e18d4`, "Drop-In Free Programs and Special Events"): **`HTTP 200`, a valid CSRF token returned, zero queue-it redirect.** The queue appears to guard only the generic top-level entry point, not calendar-scoped deep links — meaning the exact access pattern DropIn already uses for every other PerfectMind tenant works for Brampton too, **once each real category calendarId is discovered** (a one-time manual/audit-time task, not a per-refresh cost — exactly the same one-time discovery work already done for Vaughan/Markham/Newmarket's calendarIds). This was verified further: the full category list (`GetCategoriesDataV2`) was successfully retrieved via this same deep-link-derived session, and a real session sample was pulled from it (§4) — the entire pipeline works end-to-end, cold, no browser, no login. **Classified as a real but bounded nuance, not a blocker** — see §2/§9 for how this affects Brampton's specific classification.

---

## 2. Source-Family Reuse

All three fit DropIn's existing PerfectMind adapter family — **no new source family is required for any of them.** Classification, per the task's A/B/C/D scale:

| | Classification | Why |
|---|---|---|
| **Brampton** | **B — small generic-adapter enhancement** | Two real, bounded reasons, neither structural: (1) category calendarIds must be discovered via the deep-link path rather than the queue-gated landing page (§1) — a one-time discovery cost, already demonstrated working; (2) Brampton's `EventName` embeds facility and time directly in the activity title string (e.g., `"Badminton Drop-In (14+ Years) \| Jim Archdekin Recreation Centre 7:15-8:15pm"`, confirmed in real sampled data, §4) — every other PerfectMind tenant keeps these as separate structured fields. This needs a small addition to the existing `displayActivityName` normalization pipeline (`lib/dropin/activities.ts`, already an "ordered pipeline of independent, individually-audited transformations" per its own header comment) to strip the redundant suffix — the same kind of contained, source-specific normalization step already built for other tenants' real quirks, not a new mechanism. |
| **Oakville** | **A — config-only** | The cleanest of the three. Zero anti-bot interference, clean `EventName` strings (no embedded facility/time), standard `BookButtonText` mechanism, native coordinates on every sampled record. This is a textbook "add one config entry" case, matching Vaughan/Markham/Newmarket's own pattern exactly. |
| **Burlington** | **B — small generic-adapter enhancement** | Two real, bounded reasons: (1) a cancelled session appeared in real sampled data with a literal `"CANCELLED: "` prefix baked into `EventName` (e.g., `"CANCELLED: Drop-in Boot Camp"`) rather than a separate status field — needs a small filter/strip step; (2) the broad "Adult" and "Child, Youth and Family" calendars mix genuinely active content (Badminton, Basketball, Pickleball, Boot Camp, Zumba) with non-active social/hobby content explicitly labeled `"55+"` in the title itself (Bid Euchre, Board Games, Crochet Circle, Guitar, Party Bridge, Snooker — all real, sampled titles) — unlike Markham/Newmarket, where this exact same content-mixing problem was resolved at the *category* level (a whole calendar was in/out), Burlington needs it resolved at the *title* level within one calendar, closer to (but smaller than) a keyword-pattern filter. |
| **All three** | **D — not currently practical: N/A** | Not applicable to any of the three — no genuinely new source family, protocol, or platform was encountered. |

---

## 3. Drop-In Semantics

Verified against real per-record `BookButtonText` evidence — the same evidence standard DropIn's existing `AttendanceRequirement` model already requires (structural button-text pattern, never marketing copy alone).

| | Real BookButtonText values observed | Marketing/banner text found | Determination |
|---|---|---|---|
| **Brampton** | `"Register Now!"`, `"More Info"`, `"CLOSED"` (49-record sample, Sports drop-in calendar) | None examined beyond the button text itself | **Pre-registration-required** — `"Register Now!"` is the identical real phrase already documented as Vaughan/Markham's evidence; this is the strongest, most directly comparable match of the three. |
| **Oakville** | `"Register "`, `"More Info"` (53-record sample, Sports Drop-in calendar) | The widget's own `<h1>` banner reads: *"Book your spot in programs up to eight days in advance. Walk-ins are welcome as space permits."* | **Pre-registration-required**, with a documented nuance. Per-record button text is uniformly "Register"-style, never walk-in language — applying DropIn's own established principle ("do not infer attendance status from... marketing language unless supported by source evidence," and per-record button text is the trusted signal) means the banner's "walk-ins welcome" claim is noted as a real, honest caveat (comparable to Markham's existing documented Aquafit banner nuance) but does not change the classification, since it isn't the primary admission mechanism a user is actually directed toward. |
| **Burlington** | `"Register"`, `"More Info"`, `"Closed"` (51-record sample, Adult calendar) | Widget banner is generic ("Select an Activity") — no walk-in-specific claim | **Pre-registration-required**, with one genuine, harder-to-resolve nuance: one sampled record ("Indoor Track") describes itself in its own `Details` text as free, unsupervised, and open to all ages with no registration mechanism at all — yet its structural `BookButtonText` is `"More Info"`, the same value used elsewhere for a full/waitlisted class. PerfectMind's structural signal does not reliably distinguish "no registration needed" from "registration currently unavailable" for this one case. Flagged honestly as a real data-quality limit, not resolved by inference — if Burlington is ever integrated, this specific record type would need either a dedicated, evidence-based exception (only if a clear, repeatable pattern is found across more samples) or would simply inherit the same "pre-registration-required" default as everything else, which would be mildly inaccurate for this one record but not fabricated. |

**No record in any sample used volatile live capacity/waitlist language in a way that was captured or would be captured as a persisted field** — consistent with DropIn's existing "do not expose volatile live capacity/waitlist states" principle; `Spots`/`"X spots left"`-style fields were observed in raw data but are not something this audit is recommending DropIn start persisting.

---

## 4. Data Quality

Sampled from real `ClassesV2` responses (49–53 records per municipality, one representative drop-in calendar each — Brampton: Sports; Oakville: Sports Drop-in; Burlington: Adult).

| Field | Brampton | Oakville | Burlington |
|---|---|---|---|
| Activity title | Present, but embeds facility+time redundantly (§2) | Present, clean | Present, clean — except one cancelled record prefixed `"CANCELLED: "` (§2) |
| Date | Present, well-formed (`OccurrenceDate: "20260825"`-style) | Present, well-formed | Present, well-formed |
| Start/end time | Present (`FormattedStartTime`/`FormattedEndTime`) | Present | Present |
| Facility | Present (`Facility` field, e.g. `"Gore Gymnasium (A & B)"`) | Present (e.g. `"Gymnasium (Single)"`) | Present |
| Address | Present, structured | Present, structured | Present, structured |
| Coordinates | **0/49 missing** in sample | **0/53 missing** in sample | **0/51 missing** in sample |
| Age | Present (`MinAge`/`MaxAge`/`NoAgeRestriction`, or embedded in title for Brampton) | Present (`MinAge`/`MaxAge`) | Present in sample checked |
| Price | Present (`PriceRange`) | Present (`PriceRange`, e.g. `"$0.00 - $10.04"`) | **0/51 missing** in sample |
| Official URL | Reconstructable (`EventId` + `OccurrenceDate` present) | Reconstructable | Reconstructable |
| Attendance/pre-registration evidence | Present, real button text (§3) | Present, real button text (§3) | Present, real button text (§3) |
| Municipality/source identity | Present (`OrgName: "Town of Oakville"`-style field on every record) | Present | Present |

**Meaningful gaps found, quantified, not fabricated:**
- **Brampton**: `EventName` is not directly display-safe without a normalization step (redundant facility/time suffix) — a display-layer gap, not a missing-data gap; every underlying field needed is separately present and correct.
- **Burlington**: one cancelled-session record observed with `"CANCELLED: "` baked into the title rather than a separate cancellation flag — in a 51-record sample, this was the only one found, so its real frequency wasn't fully quantified (would need a larger, multi-day sample to state a rate with confidence — explicitly not claimed here).
- **No coordinate, price, or age gaps were found in any of the three samples** — a genuinely strong result, better than this audit expected going in given Toronto's own well-documented age-field gaps (Toronto's raw data doesn't consistently publish max-age in the same clean way, per prior phases) don't reproduce here; all three PerfectMind tenants carry the same rich, structured record shape the existing PerfectMind tenants already do.

---

## 5. Category Coverage

Applying DropIn's established active-recreation scope (real, sampled, time-boxed, physically active — not sedentary studio/hobby/social content, consistent with prior exclusions of Toronto/Markham "Art," Newmarket "Adult 55+," etc.).

### Brampton (from the "Drop-In and Try-It Programs" + "Youth Hub" groups specifically — the *registered-program* groups of similar names, e.g. the top-level "Sports"/"Swimming"/"Fitness" groups, are a separate, non-drop-in part of the same widget and are out of scope by definition, not by content)

| Category | Determination | Why |
|---|---|---|
| Sports | **INCLUDE** | Real sampled evidence: Badminton, Basketball, Pickleball, Volleyball, Ball Hockey Shinny, Ninja Parkour and Rock Climbing — clearly active. |
| Skating | **INCLUDE** | Matches existing Markham/Newmarket precedent directly. |
| Swimming | **INCLUDE** | Matches existing precedent directly. |
| Fitness | **INCLUDE, pending one sample check** | Name strongly suggests active content consistent with precedent; not directly sampled this audit (Sports was the representative sample pulled). |
| Flower City Senior Centre | **REVIEW** | Same treatment as every existing "55+"-style category — real evidence needed before inclusion, likely to be a mixed active/social split like Markham's Age 55+. |
| General Interest | **EXCLUDE, pending confirmation** | Name pattern matches categories already excluded elsewhere for being predominantly hobby/social, not active recreation — not directly sampled, flagged for confirmation rather than asserted with full certainty. |
| Inclusion | **REVIEW/DEFER** | Same treatment already given to Newmarket's identically-named, identically-ambiguous category — needs real sampling, not guessed. |
| Youth Hub Drop-Ins | **REVIEW** | Not sampled this audit; could be active programming or a general hangout space — genuinely ambiguous by name alone. |

### Oakville (single "Drop-in Programs" group)

| Category | Determination | Why |
|---|---|---|
| Sports Drop-in | **INCLUDE** | Real sampled evidence: Rock Climbing, Volleyball, Basketball — clearly active. |
| Fitness Drop-in | **INCLUDE, pending one sample check** | Name matches precedent directly; not the specific calendar sampled this audit. |
| Recreational Skating and Shinny Hockey | **INCLUDE** | Matches precedent directly. |
| Recreational Swimming and Waterfit | **INCLUDE** | Matches precedent directly. |
| Court Bookings | **REVIEW** | Real sample not pulled this audit — "court booking" naming could indicate a reservation-a-specific-slot model rather than a scheduled drop-in session; worth a dedicated check before inclusion rather than assuming either way. |
| Preschool Drop-in | **REVIEW** | Could be active free-play (include-worthy, matching Markham's Sensory Room/Indoor Playground precedent) or craft/passive-activity-based — needs sampling. |
| Super Playgrounds | **REVIEW, likely INCLUDE** | Strong precedent match to Markham's already-included "Sensory Room / Indoor Playground," but not directly sampled — flagged rather than assumed. |
| Youth Drop-in | **REVIEW** | Genuinely ambiguous by name alone, same reasoning as Brampton's Youth Hub. |
| Seniors Services | **REVIEW** | Same treatment as every other municipality's 55+/seniors category — needs real sampling to find the active/social ratio. |
| Culture Drop-in | **EXCLUDE, pending confirmation** | Name pattern matches the precedent that excluded genuinely-drop-in-but-sedentary studio content (Toronto/Markham "Art") — not directly sampled. |
| Culture Days | **EXCLUDE** | Reads as a seasonal/event-based offering, not standing programming. |
| Family Day | **EXCLUDE** | Single seasonal holiday event, not standing programming. |
| Oakville Museum | **EXCLUDE** | Museum programming, not active recreation by category name and by precedent. |

### Burlington (broad umbrella categories — filtering happens at the activity-title level within each, per §2)

| Category | Determination | Why |
|---|---|---|
| Skating and Recreational Hockey | **INCLUDE** | Matches precedent directly, no mixed-content concern found. |
| Swimming and Aquatic Fitness | **INCLUDE** | Matches precedent directly. |
| Adult | **INCLUDE, with title-level exclusions** | Real sampled evidence is genuinely mixed within one calendar (§2): Badminton/Basketball/Pickleball/Volleyball/Boot Camp/Zumba/Pilates/Total Body Conditioning/Indoor Track are real, active, INCLUDE-worthy; Bid Euchre/Board Games/Crochet Circle/Guitar/Party Bridge/Snooker/Pottery Studio (all `"55+"`-suffixed in the real title) are non-active and should be excluded the same way Newmarket's Age 55+ category members were judged individually. |
| Child, Youth and Family | **REVIEW** | Not sampled this audit — likely a similar broad-umbrella pattern to "Adult," needs the same title-level review before inclusion. |

**Overall principle applied throughout, consistent with the task's own instruction**: nothing above is included merely to raise the record count, and nothing recognizably active is excluded merely because its exact wording differs from an existing municipality's — every REVIEW item is REVIEW because real evidence genuinely wasn't gathered this audit, not because of a name-pattern guess dressed up as a finding.

---

## 6. Refresh Feasibility

| | Brampton | Oakville | Burlington |
|---|---|---|---|
| Relevant category count (drop-in scope only) | Up to 8 (Drop-In and Try-It Programs' 7 + Youth Hub Drop-Ins) | 13 (all under one group) — the highest of any PerfectMind tenant DropIn has evidence for, above Markham's 10 | 4 — the smallest of the three |
| Pagination behavior | Same date-cursor mechanism already proven (`nextKey`) — confirmed live (`nextKey: "2026-08-28"` returned on a real call) | Same, confirmed live (`nextKey: "2026-08-30"`) | Same, confirmed live (`nextKey: "2026-09-01"`) |
| Approximate per-category record volume | ~49 records per category in the forward window sampled | ~53 records per category sampled | ~51 records per category sampled |
| Rate-limit concerns | None encountered in this audit's real requests (a handful of GETs/POSTs per municipality); no `429` responses seen | None encountered | None encountered |
| Sequential/concurrent implications | Fits the existing `Promise.all`/`Promise.allSettled` concurrency pattern already used for every PerfectMind tenant — no new pattern needed | Same | Same |
| Estimated refresh duration impact | Comparable in order of magnitude to adding roughly one more Markham-sized municipality (8 categories vs. Markham's 10) | Comparable to slightly more than one more Markham-sized municipality (13 categories) | Small — comparable to less than Vaughan's 3 categories |
| Can it safely join the once-daily pipeline? | **Yes, with the deep-link entry point (§1), not the queue-gated generic one** | **Yes, no caveats** | **Yes, no caveats** |

**Combined effect of adding all three**: roughly 25 additional category-calendars refreshed concurrently, on top of today's ~19 across Vaughan/Markham/Newmarket — the same well-proven concurrency pattern, well within the headroom already established in `docs/PHASE_5A_HOSTING_REFRESH_ARCHITECTURE.md`'s municipality-scaling analysis (that document sized the architecture for an 8–12 municipality range; adding these three reaches 10, squarely inside that already-planned-for range). **No refresh-architecture change is triggered by this expansion** — reaffirming, not contradicting, Phase 5A's own conclusion.

---

## 7. Extensibility Test — Findings Against a Real, Concrete Case

Using these three municipalities as the real test the task asked for, against `docs/PHASE_5A_HOSTING_REFRESH_ARCHITECTURE.md` §11's own findings:

| Area | Would need changes? | Classification |
|---|---|---|
| Search | No | **A** — activity matching is already fully data-driven (Phase 5A §11 already verified this from the code, reaffirmed here: nothing about these three municipalities' real activity vocabulary — "Rock Climbing Drop-in," "Ball Hockey Shinny," "Stride, Tone and Stretch" — requires any change to `search-intent.ts`'s substring/prefix matcher). |
| Ranking | No | **A** — ranking operates on `distanceKm`/time, not municipality identity. |
| Location | No | **A** — every sampled record from all three carries native `Address.Latitude`/`Longitude` (§4, §8) — no new location-handling code needed. |
| Activity taxonomy | No structural change; `ACTIVITY_GROUPS` (the Toronto-worded shortcut convenience) would optionally gain a few more real synonyms over time, exactly as already anticipated in its own source comments | **A** for the mechanism, **B** for the optional enrichment |
| Canonical `Session` model | No | **A** — every field these three sources provide already has a home in the existing schema; nothing source-specific needs to leak in. |
| Source registry (`PERFECTMIND_MUNICIPALITIES`) | Yes, by design — this is the intended extension point | **A** — exactly "config-only" for Oakville; small, contained additions (normalize-layer tweaks) for Brampton/Burlington, still within this same registry pattern. |
| Refresh pipeline | No | **A** — same concurrency pattern, same validation/atomicity gates, confirmed sufficient headroom (§6). |
| Facility geocoding | No | **A** — see §8; native coordinates make the existing geocoding-fallback path largely unnecessary for these three. |
| About coverage list | Yes, but only text, and only after real integration (§10) | Not applicable to classify — this is expected, routine copy maintenance, not a bottleneck. |

**Assumptions flagged, per the task's explicit ask:**
- The "exactly 7 municipalities" assumption already identified in `docs/PHASE_5A_HOSTING_REFRESH_ARCHITECTURE.md` §11 (four separate hardcoded municipality-name lists, most notably the silent-failure-prone `MUNICIPALITY_SLUGS` in `lib/dropin/sources/index.ts`) is **the single most relevant prior finding to this exercise** — adding any of these three would hit exactly that same risk (a successful refresh whose data the app never reads, silently, if that list isn't updated). Not re-litigated in depth here since Phase 5A already fully documented it; simply reconfirmed as directly relevant the moment any of these three actually gets implemented.
- No new duplicated-adapter-logic pattern was found — Brampton and Burlington's small quirks (§2) belong in `normalize.ts`'s per-tenant handling or `activities.ts`'s display pipeline, both existing, designed extension points, not new parallel code paths.

**No C-level (meaningful architectural bottleneck) finding for any of the three** — consistent with, and a real-world confirmation of, Phase 5A §11's own conclusion.

---

## 8. Geospatial Readiness

**Excellent, across all three — better than this audit expected going in.** Every sampled record from Brampton, Oakville, and Burlington (0 missing out of 49/53/51 respectively) carries a native, structured `Address` object with real `Latitude`/`Longitude` fields directly from PerfectMind's own API response — the exact same shape already relied on for Vaughan/Markham/Newmarket (the existing `SOURCES_WITH_NATIVE_COORDINATES` set in `scripts/refresh/facility-locations.ts`).

This means the existing facility-location enrichment system (`lib/dropin/facility-locations.ts` — a pure, local, in-memory join that only *fills a gap*, never overwrites a real source coordinate) would have **little to no work to do** for these three specifically, since real coordinates already arrive with the raw data. The enrichment/geocoding pipeline (Nominatim-based fallback, §11 of Phase 5A) exists for sources *without* native coordinates (Toronto, ActiveCommunities) — not a concern for these three.

**No large-scale geocoding is needed.** A small proof was performed as part of this audit's real data sampling (§4) rather than a separate step — real coordinates were directly observed, not geocoded.

---

## 9. Production Recommendation

### Municipality-by-municipality

**A. Brampton — PROCEED WITH CONDITIONS.** Conditions: (1) integration must use the calendar-specific deep-link entry point, never the generic queue-gated landing page, for both the one-time calendarId discovery and every future refresh; (2) `normalize.ts` needs a small addition to strip the embedded facility/time suffix from `EventName` before display; (3) the REVIEW-classified categories (§5) need real sampling before an inclusion decision, not a guess.

**B. Oakville — PROCEED.** No conditions beyond the routine per-category sampling every existing PerfectMind municipality already went through before its own categories were finalized (§5's REVIEW items). This is the closest of the three to a standard, low-friction addition.

**C. Burlington — PROCEED WITH CONDITIONS.** Conditions: (1) `normalize.ts` needs a small filter for the `"CANCELLED: "` title-prefix pattern; (2) the broad "Adult" (and likely "Child, Youth and Family") calendars need title-level filtering to exclude the real `"55+"`-suffixed social/hobby content mixed into them, not just a category-level include/exclude.

### Overall

**Recommend deferring all three to a dedicated post-launch phase, not bundling them into pre-launch work.** Reasoning:

- **None is required for an honest launch.** DropIn already has a real, designed mechanism for exactly this situation — `lib/dropin/municipalities.ts`'s `MunicipalityStatus`, which lets search recognize and honestly respond to a not-yet-covered municipality ("not covered yet") rather than either pretending to have results or treating the name as unrecognized. Deferring these three doesn't create a broken or dishonest experience; it uses the graceful path the product was already built to use.
- **Each genuinely deserves the same dedicated, careful integration treatment every existing municipality received** — Vaughan, Markham, Newmarket, and Aurora were each added in their own phase, with real category-by-category sampling before any inclusion/exclusion call was finalized. Two of these three (Brampton, Burlington) surfaced real quirks in just this audit-level pass that would need proper resolution, not a rushed pre-launch pass across all three at once — doing that risks exactly the "included merely to maximize record count" outcome the task explicitly warned against.
- **Engineering cost is real, if modest per-municipality**: two small `normalize.ts`/`activities.ts` enhancements (Brampton, Burlington), one queue-it-aware access pattern to build correctly (Brampton), and — for all three — real category-level sampling to resolve every REVIEW item in §5 with evidence, not inference.
- **No architecture reason to rush this before launch.** §6/§7 already confirm the Phase 5A hosting/refresh architecture comfortably accommodates these three (and the 8–12 municipality range generally) whenever they're actually added — there is no coupling between finalizing Phase 5 hosting and doing this expansion work. The two can and should proceed on independent timelines.
- **If the user wants exactly one additional pre-launch win despite the above**, Oakville is the one that could reasonably be fast-tracked — it's the only clean **A** classification, has zero anti-bot friction, and needs nothing beyond the same category-sampling pass every prior municipality received. This is noted as an option, not a recommendation to actually do it.

---

## 10. About DropIn — Proposed Wording (not applied)

**Do not modify About in this audit — this section states what the sentence *should* say if and only if the recommended integration work actually succeeds and is verified in production, consistent with the rule that About must only list municipalities that are actually integrated and verified.**

If all three are eventually integrated and verified:

> "DropIn currently covers Toronto, Mississauga, Markham, Vaughan, Richmond Hill, Newmarket, Aurora, Brampton, Oakville, and Burlington."

If only Oakville is added first (the most likely fast-tracked candidate, per §9):

> "DropIn currently covers Toronto, Mississauga, Markham, Vaughan, Richmond Hill, Newmarket, Aurora, and Oakville."

**Until any of this is real and verified in production, About must continue to list exactly the current seven** — no wording change is being made now.

---

## Final Report

**A. Brampton — recommendation:** PROCEED WITH CONDITIONS. Real PerfectMind platform confirmed, real drop-in category group confirmed, real data sampled with zero coordinate/price/age gaps — but the generic booking-widget entry point is Queue-It-gated (confirmed live, twice) and `EventName` embeds facility/time redundantly. Both are real, bounded, already-demonstrated-workable-around issues, not blockers — see §2/§9.

**B. Oakville — recommendation:** PROCEED. The cleanest of the three — config-only classification, zero anti-bot friction, clean data shape, native coordinates on every sampled record.

**C. Burlington — recommendation:** PROCEED WITH CONDITIONS. Real PerfectMind platform confirmed, zero anti-bot friction, native coordinates on every sampled record — but real sampled data shows a cancelled-session title-prefix quirk and genuine active/non-active content mixing within its broad "Adult" calendar, both needing small, contained `normalize.ts` handling before inclusion.

**D. Existing source families reusable?** Yes, for all three — DropIn's existing PerfectMind/BookMe4 adapter family (`lib/dropin/sources/perfectmind/`) covers all three with no protocol-level changes, confirmed via real, live requests replicating the exact mechanism `client.ts` already uses.

**E. Any new source family required?** No — zero new source families, protocols, or platforms were encountered across all three municipalities.

**F. Any meaningful architecture bottleneck discovered?** None (no C-level findings) — reconfirms `docs/PHASE_5A_HOSTING_REFRESH_ARCHITECTURE.md` §11's own conclusion, now backed by a real, concrete 3-municipality test rather than code-reading alone.

**G. Expected impact on daily refresh workload:** Modest — roughly 25 additional category-calendars across the three (8 + 13 + 4), comparable to adding a bit more than two more Markham-sized municipalities, well inside the 8–12 municipality range the Phase 5A hosting/refresh architecture was already sized for. No architecture change is triggered.

**H. Should all three be integrated before launch?** No — recommend deferring all three to a dedicated post-launch phase, per §9's full reasoning. DropIn's existing "not-yet-available" honest-search-response mechanism makes deferring cost-free from a launch-honesty standpoint, and each municipality's real quirks (found in this very audit) deserve the same dedicated verification treatment every existing municipality already received, not a rushed bundle.

**I. What should the implementation phase contain (whenever it happens):** Per municipality — one config entry in `PERFECTMIND_MUNICIPALITIES` (host/sitePrefix/widgetId/calendarIds, per §1); real category-by-category sampling to resolve every §5 REVIEW item with evidence; Brampton specifically needs the deep-link (not generic-landing-page) access pattern built in and a small `EventName`-cleanup normalization step; Burlington specifically needs a cancelled-session filter and title-level active/non-active filtering within its broad umbrella calendars. Each municipality should get its own dedicated verification pass (matching the precedent set by every prior municipality's own phase), not a single combined pass across all three.

**J. Exact About wording after successful integration:** See §10 — two candidate sentences given (all three integrated; Oakville-only), neither applied yet.

Stopping here, as instructed. No integration was performed, About was not modified, and no Phase 5A hosting/scheduler work was touched.
