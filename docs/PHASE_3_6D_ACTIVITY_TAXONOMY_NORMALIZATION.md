# Phase 3.6D — Activity Taxonomy & Display Naming Consolidation

Extends Phase 3.6C's narrow "Adult Pickleball → Pickleball" rule into a small, ordered pipeline that removes several classes of genuinely redundant source-system noise from activity display titles — not just demographic qualifiers. Same core discipline throughout: every transformation either requires an exact match against real structured data before it fires, or was individually audited against the real dataset before being added. `Session.activity` (the source title) is never touched; search, dedup, and data export are unaffected.

**Net effect measured against the live combined dataset**: 12,939 of 47,146 sessions (27.4%) now show a normalized display title, up from 3.6C's 1,698 (3.6%). Distinct display-name count drops from 770 raw titles to 682.

---

## 1. Major Activity Families Audited

Full audit of the combined 47,146-session canonical dataset: Badminton, Basketball, Pickleball, Table Tennis, Yoga, Volleyball, Swimming (Lane/Leisure), Skating, Fitness, Aquafit — plus, since the age/time patterns found are dataset-wide rather than family-specific, evidence surfaced from Hockey/Shinny and general fitness-class titles (Zumba, Pilates, Boot Camp, etc.) that share the exact same redundant-noise patterns as the named families.

## 2. Source-Title Variants Discovered

- **"Drop In"/"Drop-In"/"Drop- In" noise**: 263 distinct titles, 11,713 sessions, present in every source family except Toronto and Vaughan (which don't use the phrase at all in their raw titles).
- **Embedded demographic qualifiers** ("Adult"/"Older Adult"/"Senior(s)"): 107 distinct titles matching a word-boundary scan, spanning every non-Toronto family.
- **Embedded numeric age** ("Ages N+", "Ages N-M", "(N-M yrs)"): 24 distinct titles, 389 sessions, concentrated in Newmarket (basketball/badminton/volleyball/soccer/pickleball time-slot titles) and Mississauga (Hockey Stick & Puck).
- **Embedded formatted time** ("(H:MM-H:MM am/pm)"): 51 distinct titles, 639 sessions (Mississauga, Newmarket).
- **Yoga family**: 47 distinct titles — a mix of pure Drop-In-prefix noise ("Drop In Yoga," "Drop-In Yoga: Power") and genuinely distinct subtypes ("Yoga: Chair," "Yoga/Pilates Fusion," "Yoga LIFT," "Yoga with Baby").
- **Facility/court noise candidate**: only one real case found ("Badminton - Court," Toronto) — investigated and NOT normalized (see §9).

## 3. Redundant Patterns Identified

| Category | Pattern | Example |
|---|---|---|
| E — product-label noise | "Drop In"/"Drop-In" prefix, trailing/mid-string "(Drop In)" parenthetical | "Drop In Badminton," "Pickleball - Adult (Drop In)" |
| C — redundant demographic | "Adult"/"Older Adult"/"Senior" word tokens, "for Older Adults" suffix | "Adult Pickleball," "Yoga for Older Adults" |
| D — redundant embedded age | "Ages N+"/"Ages N-M"/"(N-M yrs)" | "Badminton-Ages 8+ (...)" |
| D — redundant embedded time | "(H:MM-H:MM am/pm)" | "Basketball-Ages 6+ (6:30-8:15 a.m.)" |

## 4. Normalization Rules Implemented

Implemented as an ordered pipeline in `displayActivityName` (`lib/dropin/activities.ts`), each layer independent and individually gated:

1. **`stripDropInNoise`** — unconditional. A leading `Drop In`/`Drop-In`/`Drop- In` token, or a `(Drop In)`/`(Drop-In)` parenthetical anywhere in the title, is removed regardless of age data, because DropIn's entire catalog is drop-in content by definition — there is no session in this product that isn't one. Verified against all 263 real titles containing the phrase; none use it as part of a genuinely distinct program identity. 7 additional real titles needed an explicit override because the phrase sits mid-string in a shape the prefix/suffix patterns don't reach (e.g. `"Parent & Tot Drop In (9:30-11:00 a.m.)"` → `"Parent & Tot (9:30-11:00 a.m.)"`).
2. **Demographic qualifier tables** — gated per session on a realistic age floor, not just "any defined ageMin": **16** for "Adult" (Markham's own "Adult" category floor, the lowest real value observed), **50** for "Older Adult"/"Senior." The 50-floor is a real correction found this phase (§7). Covers all 3.6C entries (now composed with the Drop-In layer, so e.g. `"Drop-In Pickleball: Adults"` needs no dedicated table row anymore — Drop-In-stripping reduces it to `"Pickleball: Adults"` first, which the existing `"Adult"` rule already knows) plus new Aquafit and "for Older Adults" entries.
3. **`stripEmbeddedAge`** — removes "Ages N+"/"Ages N-M"/"(N-M yrs)" only when it matches the session's own `ageMin`/`ageMax` exactly (an open "N+" requires `ageMax` undefined or ≥90). Not a static table — a runtime numeric-match check, self-protecting: it cannot fire on a title whose embedded number doesn't match real structured data, so it's safe against any future/untested title.
4. **`stripEmbeddedTime`** — removes a trailing "(H:MM-H:MM am/pm)" only when it matches the session's own real local start/end time exactly, parsed directly from `startDateTime`/`endDateTime` strings (no `Date`/timezone arithmetic, consistent with this codebase's existing "unqualified string is local time" convention). Handles both real source shapes found (a single trailing period covering both sides, and each side independently labelled — `"11:30a.m.-12:30p.m."` — the second shape was found and fixed mid-phase, see §15).

## 5. Meaningful Qualifiers Preserved

Every case the task named explicitly, confirmed unchanged: `Pickleball with Family`, `Badminton with Family`/`Badminton - Teen (Drop In)` (Teen preserved; only the redundant `(Drop In)` tag is removed), `Yoga/Pilates Fusion`, `Yoga: Chair`, `Yoga LIFT`, `Yoga with Baby`, `Pickleball (2SLGBTQ+)`, `Drop-In Pickleball: Adult and Child` → `Pickleball: Adult and Child` (Drop-In noise removed, "Adult and Child" fully preserved), `Volleyball - Adult (Drop In) Int (must know 5-1 systems)` → only "Adult" and "(Drop In)" removed, the skill-level qualifier kept intact. Also newly confirmed this phase: "Full Court" (Basketball/Soccer format qualifier), birth-year hockey cohorts (`Shinny 2011-2012`, `Basketball - 2010 & Older`), and "With Adult"/"with Adult" in Mississauga's Hockey Stick & Puck titles — here "Adult" means an accompanying caregiver, not a demographic eligibility restriction, so it was never added to any qualifier table; only the redundant `"(9-13 yrs)"`-style age parenthetical next to it was removed.

## 6. Ambiguous Cases Preserved

- **`Drop In Adult Pickleball`, `Table Tennis - Adult (Drop In)`, `Table Tennis  -  Adult (Drop In)`, `Drop In Adult & Older Adult Skate`** — carried forward from 3.6C: zero sessions with reliable age data, so the demographic word stays (only the always-safe Drop-In noise is removed where present).
- **`Drop In Seniors' Centre Pickleball`/`...Table Tennis`** — "Seniors' Centre" names a facility type, not purely a demographic; preserved out of caution (carried forward from 3.6C reasoning).
- **`Badminton - Court`** (Toronto) — investigated per Part 7's instruction rather than assumed: it exists at exactly one real centre (L'Amoreaux Community Recreation Centre), which *also* runs plain `Badminton` sessions. Co-existing with the base activity at the same real venue is evidence it's a genuinely distinct program/booking type there, not generic facility noise — preserved.
- **`Basketball - 2010 & Older (8:00 p.m.)`, `Shinny <birth-year-range> (...)`** — birth-year cohort conventions, idiomatic to youth hockey scheduling and arguably more precise than a generic age range; not touched by any age pattern (the age-parenthetical patterns require "Ages"/"yrs" keywords or a `(N-M)` shape that a birth-year range like `2011-2012` doesn't match without a keyword — confirmed no accidental match).
- **"MSC-" facility-branch abbreviation prefix** (Mississauga Seniors Centre programs) — left untouched; no strong evidence of its exact meaning and not one of the requested normalization targets.
- **General "Fitness"/hobby titles outside the named families** (Bridge, Euchre, Mahjong, Bingo, Scrabble, Billiards) — Drop-In-prefix noise removal still applies dataset-wide (unconditional, family-agnostic), but no demographic or "for Older Adults" table entries were added for these — kept out of scope, consistent with "not building a giant recreation ontology."
- **Single embedded start-time only** (no range), e.g. `"Group Fitness - Zumba (6:45 p.m.) - Magna"` — a fundamentally different shape than the audited "(start-end)" range pattern; not matched by `stripEmbeddedTime` by construction, left unnormalized. Noted as a real remaining case, not a defect.

## 7. Embedded Age/Time Cleanup — Evidence and a Real Data-Quality Finding

Every one of the 24 precise embedded-age matches (`Ages N[+]`, `Ages N-M`, `(N-M yrs)`) checked against structured `ageMin`/`ageMax` this phase matched **exactly**, with zero contradictions — high confidence, safe to remove universally under the exact-match gate.

Embedded time was different: of 46 distinct titles with a real "(H:MM-H:MM am/pm)" shape, **12 titles / 193 sessions had a genuine, systematic mismatch** — every one a Newmarket "Adult Shinny," "Parent & Tot Skate," or "Shinny \<birth-year\>" title whose embedded end time is **consistently exactly 10 minutes earlier** than the session's real structured end time (e.g. title says "ends 12:30-1:20 p.m.," structured data says the session actually ends at 1:30 p.m.). This is flagged here as a genuine source/ingest data-quality inconsistency, not silently resolved either direction — per instruction, these 12 titles were left **completely untouched** (not even a partial strip), since there's no way to know from this data alone which time is the one users should trust.

Separately, a **real demographic-tag data-quality anomaly** was found and corrected for in the design: Mississauga's `"Drop In Drumming Fit for Older Adults"` carries `ageMin=14` on every one of its 15 real sessions — clearly mislabelled (14-year-olds are not "Older Adults"). A naive "any defined ageMin" gate (3.6C's original rule) would have stripped "for Older Adults" from this title anyway. The 50-age-floor introduced this phase (§4) catches this and leaves the wording untouched, rather than compounding the source's own labeling error.

## 8. Drop-In Prefix Handling

Confirmed safe as an unconditional, dataset-wide transformation — not family-restricted, not age-gated. Audited all 231 distinct prefix-position titles (11,375 sessions) and all suffix/mid-string occurrences (338 sessions); found zero cases where "Drop In"/"Drop-In" carries real distinguishing meaning. 7 mid-string cases needed an explicit override rather than the general prefix/suffix regex (§4.1). Handles all 3 real spelling variants found in the data (`Drop In`, `Drop-In`, `Drop- In`).

## 9. Court/Facility Qualifier Findings

Only one real candidate found dataset-wide: `Badminton - Court` (Toronto, 20 sessions, single centre). Investigated per instruction rather than assumed — found real evidence it's a distinct program (coexists with plain `Badminton` at the same venue) — **not normalized**. No other facility/court-noise pattern was found at meaningful volume. Aurora's `(AFLC)`/`(ARC)` facility-code suffixes (from Phase 3.6B) remain untouched — a separate, already-reviewed decision, not revisited this phase.

## 10. Activity-Chip Changes

Unchanged mechanism from 3.6C: chips (`filterChipActivities`) are built from `displayActivityName(session)`, not raw `session.activity`, so every layer added this phase automatically applies to chip labels and chip-based filtering with no additional wiring. Concretely this phase: Mississauga's `Drop In Badminton` and `Drop In Adult Badminton` now collapse into one `Badminton` chip (previously two separate, redundant chips); `Drop In Yoga` (Mississauga) and `Drop-In Yoga` (Markham) both collapse into Toronto's existing `Yoga` chip; genuinely distinct chips (`Yoga/Pilates Fusion`, `Yoga: Chair`, `Yoga with Family`, `Badminton with Family`, `Basketball-Full Court`, birth-year Shinny variants) remain separate, unmerged.

## 11. Number and % of Sessions Affected

| Municipality | Sessions | Normalized | % |
|---|---|---|---|
| Toronto | 26,353 | 517 | 2.0% |
| Mississauga | 15,982 | 9,981 | 62.5% |
| Richmond Hill | 258 | 225 | 87.2% |
| Vaughan | 1,157 | 158 | 13.7% |
| Markham | 1,433 | 1,433 | 100.0% |
| Newmarket | 1,766 | 586 | 33.2% |
| Aurora | 197 | 39 | 19.8% |
| **Total** | **47,146** | **12,939** | **27.4%** |

Markham's 100% figure reflects that literally every Markham title in this dataset carries a "Drop-In"/"Drop- In" prefix (its PerfectMind category taxonomy names every category that way) — not that every title changed substantially; most only lost the redundant prefix.

## 12. Search Regression

`lib/dropin/search-intent.ts` was not modified. Verified live:

- `badminton mississauga` → chips `All / Badminton / Youth Sauga At Play Badminton / Badminton Hit Around Family`; results show `Badminton` cards with real `Ages 14+`/`Ages 18+` badges (from raw `Drop In Badminton`/`Drop In Adult Badminton`).
- `yoga` → chips `All / Yoga / Yoga/Pilates Fusion / Yoga: Chair / Yoga with Family / Yoga with ...`; `Yoga` card opened in the Decision Sheet shows `Yoga`, `Ages 13+`, `Walk-in`, `Verified · City of Toronto Open Data` — consistent between card and sheet.
- `basketball newmarket` → chips `Family Basketball / Basketball / Basketball-Full Court / Basketball - 2010 & O...`; a real `Basketball-Ages 6+ (3:45 p.m.-5:45 p.m.)` session now shows as `Basketball`, `Ages 6–99`, in both the card and the opened Decision Sheet (real address, `Pre-registration required`, `Town of Newmarket Recreation (PerfectMind)`), with no residual age or time text in the title.
- Original-wording queries (`adult pickleball`, `drop in badminton`-style substrings) continue to resolve, since `session.activity` — the field search indexes — is never modified.

## 13. Desktop/Mobile Regression

- **Desktop**: full interactive pass (localhost) across the queries in §12 plus direct data-level verification against all 47,146 real sessions (see §11). **PASS.**
- **Mobile (LAN)**: repeated the `yoga` search over the real LAN connection (`http://192.168.18.4:3000`) — identical chip set and normalization to desktop (`Yoga`, `Yoga/Pilates Fusion`, `Yoga: Chair`, `Yoga with Family`). **PASS** (functional; true narrow-viewport visual verification carries the same environment limitation already documented in Phase 3.6B, unchanged by this phase, since it doesn't touch layout).
- `npx tsc --noEmit`: clean, 0 errors.
- `npm run lint` on touched files: `lib/dropin/activities.ts` fully clean; `app/page.tsx` has the same 10 pre-existing, out-of-scope `react-hooks/refs`/`react-hooks/set-state-in-effect` errors already documented in Phase 3.6B/3.6C (line numbers shifted only by earlier unrelated edits, none overlapping anything touched this phase).
- `npm run build`: succeeds, all 10 routes compiled.

## 14. Representative Before → After Examples

| Municipality | Raw source title | Displayed as |
|---|---|---|
| Mississauga | `Drop In Badminton` | **Badminton** |
| Mississauga | `Drop In Adult Basketball` | **Basketball** |
| Mississauga | `Drop In Yoga` | **Yoga** |
| Markham | `Drop-In Yoga` | **Yoga** |
| Markham | `Drop-In Pickleball: Adults` | **Pickleball** |
| Markham | `Drop-In Badminton: Adult and Child` | **Badminton: Adult and Child** (Drop-In noise removed; meaningful qualifier kept) |
| Newmarket | `Basketball-Ages 6+ (6:30-8:15 a.m.)` | **Basketball** |
| Newmarket | `Badminton-Ages 8+ (11:15 a.m.-1:15 p.m.)` | **Badminton** |
| Newmarket | `Soccer-Full Court Ages 30+ (6:45-8:45 p.m.)` | **Soccer-Full Court** ("Full Court" preserved) |
| Newmarket | `Pickleball-Open Play 8+ (9:00-11:00 a.m.)` | **Pickleball-Open Play** ("Open Play" preserved) |
| Newmarket | `Adult Shinny (12:30-1:20 p.m.)` | **unchanged** — real 10-minute title/structured-time mismatch found this phase |
| Mississauga | `Drop In Hockey Stick & Puck With Adult (9-13 yrs)` | **Hockey Stick & Puck With Adult** ("With Adult" = accompanying caregiver, preserved; redundant age parenthetical removed) |
| Mississauga | `Drop In Drumming Fit for Older Adults` (ageMin=14) | **unchanged** — real source mislabeling caught by the 50-age floor |
| Toronto | `Badminton - Court` | **unchanged** — investigated, real distinct program at its one venue |
| Richmond Hill | `Pickleball - Adult (Drop In)` (age-reliable subset) | **Pickleball** |
| Vaughan/Toronto | `Adult Pickleball` / `Pickleball` | **Pickleball** (unified across municipalities) |

## 15. Bugs Found and Fixed This Phase

The initial `stripEmbeddedTime` implementation assumed the am/pm period marker only ever appears once, trailing both times (`"6:30-8:15 a.m."`). Real data showed a second, equally common shape where **each side carries its own marker** (`"11:30a.m.-12:30p.m."`, `"11:00a.m.-12:30 p.m."`). Discovered by comparing the tool's own before/after output against the audited match list — several titles that should have had a matching, strippable time were left unchanged. Fixed by making the first period marker optional and using it directly when present (falling back to the end marker only when the start truly omits one, preserving the original correct behavior for the shared-trailing-period shape). Re-verified against the full Newmarket dataset: every legitimate exact-match case now strips correctly, and all 12 genuine mismatch cases from §7 remain correctly untouched.

## 16. Remaining Naming Inconsistencies

- **12 Newmarket titles / 193 sessions** with a real, unresolved title-vs-structured-time discrepancy (§7) — left untouched by design, not a normalization gap so much as a genuine source data-quality question worth raising with Newmarket's own data if this becomes user-visible.
- **Single-start-time-only titles** (`"Group Fitness - Zumba (6:45 p.m.) - Magna"`) — a different shape than the audited range pattern, not handled this phase.
- **"MSC-" facility-branch prefix** (Mississauga) — left as-is, ambiguous abbreviation, not one of the requested targets.
- **General hobby/social programming** (Bridge, Euchre, Mahjong, Bingo, Scrabble, Billiards, Line Dance) still carries "for Older Adults"/"Seniors' Centre" wording untouched beyond the always-safe Drop-In-prefix removal — deliberately out of scope (not a named or high-volume activity family).
- **"Youth" qualifier** — still not normalized anywhere (carried forward from 3.6C's own scope decision); real titles mix a brand name ("Sauga At Play"), a program format ("Pick Up"), and inconsistent embedded age ranges, and the task gave no worked "Youth X → X" example the way it did for "Adult."

---

## Answer to the closing question

**Yes.** After this pass, cross-source naming inconsistency for DropIn's core recreation-activity vocabulary — Badminton, Basketball, Pickleball, Table Tennis, Yoga, Volleyball, Swimming, Skating, Fitness, Aquafit — is now small and specific rather than pervasive: 27.4% of all sessions were touched, every remaining un-normalized case falls into one of a short, named, and now-documented list (missing age evidence, a real title/structured-data mismatch just discovered and correctly left alone, a facility-branch abbreviation, a deliberately out-of-scope "Youth" qualifier, or genuinely meaningful subtype wording). There is no longer an obvious, large class of redundant noise left to chase pre-launch. Further normalization from here — a "Youth" pass, single-start-time stripping, "MSC-" abbreviation expansion, or resolving the Newmarket 10-minute time discrepancy — would be speculative refinement rather than fixing a visible product problem, and is better prioritized by what real users actually notice or complain about than by continuing to mine the dataset for smaller and smaller residual inconsistencies.

Stopping here, as instructed. Not beginning Phase 4.
