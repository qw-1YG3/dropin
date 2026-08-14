# Phase 3.6C — Activity Display Name Normalization

A small, conservative display-name layer that removes redundant demographic wording from activity titles when the same information is already communicated reliably by the structured age field — e.g. Vaughan's "Adult Pickleball" and Toronto's "Pickleball" both display as **Pickleball**, distinguished only by their real "Ages 18–99" / "Ages 18–58" badges, exactly as the underlying activity actually is. This is not a taxonomy redesign, not fuzzy activity merging, and not a UI redesign — no new UI, no new Session fields, no change to age/attendance rendering.

---

## 1. Title Variants Discovered

A full audit of the combined 47,146-session, 7-municipality canonical dataset (script-based, not sampling) found the same activity worded differently across source families for every one of the 8 requested families. Representative clusters:

| Family | Sample raw variants |
|---|---|
| Pickleball | `Pickleball` (Toronto), `Adult Pickleball` (Vaughan), `Drop-In Pickleball: Adults` (Markham), `Pickleball - Adult (Drop In)` (Richmond Hill), `Drop In Adult Pickleball` (Mississauga), `Adult Pickleball (AFLC)` (Aurora) |
| Badminton | `Badminton`, `Adult Badminton`, `Drop-In Badminton: Adults`, `Badminton - Adult (Drop In)`, `Drop In Adult Badminton`, `Badminton Hit Around Adult` |
| Table Tennis | `Table Tennis`, `Drop In Table Tennis Adult`, `Drop-In Table Tennis: Adults`, `Table Tennis - Adult (Drop In)` |
| Lane/Leisure Swim | `Lane Swim`, `Leisure Swim`, `Adult Leisure Swim`, `Leisure Swim: Adult`, `Lane Swim: Older Adult`, `Leisure Swim: Older Adult` |
| Basketball | `Basketball`, `Adult Basketball`, `Drop-In Basketball: Adults`, `Basketball - Adult (Drop In)`, `Drop In Adult Basketball`, `Drop In Older Adult Basketball` |
| Volleyball | `Volleyball`, `Adult Volleyball`, `Drop-In Volleyball: Adults`, `Volleyball - Adult (Drop In)`, `Adult Volleyball (ARC/AFLC)` |
| Skating | `Leisure Skate`, `Leisure Skate: Adult (Unsupervised)`, `Leisure Skate: Older Adult (Unsupervised)`, `Adult Skate (10:45-11:35 a.m.)` (Newmarket, one raw title per time slot) |
| Group Fitness | `Group Fitness [AFLC/ARC]` (Aurora, no demographic word), `Drop-In Group Fitness: Older Adult` (Markham) |

Classification (per the task's A/B/C scheme) was done **per exact raw title against real per-session age data**, not by eyeballing the wording — see §2–4.

## 2. Normalization Rules Accepted (Category A)

38 exact-title rules plus one narrow pattern, gated at apply time on the specific session's own `ageMin` being defined (never on title text alone):

**Pickleball**: `Adult Pickleball`→`Pickleball`, `Adult Pickleball (AFLC)`→`Pickleball (AFLC)`, `Drop-In Pickleball: Adults`→`Drop-In Pickleball`, `Drop-In Pickleball-Adults`→`Drop-In Pickleball`, `Drop-In Pickleball Adults`→`Drop-In Pickleball`, `Pickleball - Adult (Drop In)`→`Pickleball (Drop In)`.

**Badminton**: `Adult Badminton`→`Badminton`, `Drop-In Badminton: Adults`→`Drop-In Badminton`, `Drop In Adult Badminton`→`Drop In Badminton`, `Badminton - Adult (Drop In)`→`Badminton (Drop In)`, `Badminton Hit Around Adult`→`Badminton Hit Around`.

**Table Tennis**: `Drop In Table Tennis Adult`→`Drop In Table Tennis`, `Drop-In Table Tennis: Adults`→`Drop-In Table Tennis`.

**Basketball**: `Drop In Adult Basketball`→`Drop In Basketball`, `Basketball - Adult (Drop In)`→`Basketball (Drop In)`, `Adult Basketball`→`Basketball`, `Drop-In Basketball: Adults`→`Drop-In Basketball`, `Drop In Older Adult Basketball`→`Drop In Basketball`.

**Volleyball**: `Adult Volleyball`→`Volleyball`, `Volleyball - Adult (Drop In)`→`Volleyball (Drop In)`, `Volleyball - Adult (Drop In) Int (must know 5-1 systems)`→`Volleyball (Drop In) Int (must know 5-1 systems)`, `Drop-In Volleyball: Adults`→`Drop-In Volleyball`, `Drop-In Volleyball-:Adults`→`Drop-In Volleyball`, `Adult Volleyball (ARC)`→`Volleyball (ARC)`, `Adult Volleyball (AFLC)`→`Volleyball (AFLC)`, `Drop In Older Adult Volleyball`→`Drop In Volleyball`.

**Skating**: `Leisure Skate: Older Adult (Unsupervised)`→`Leisure Skate (Unsupervised)`, `Leisure Skate: Adult (Unsupervised)`→`Leisure Skate (Unsupervised)`, `Leisure Skate: Adult`→`Leisure Skate`, `Drop In Adult Skate Fit`→`Drop In Skate Fit`.

**Swimming**: `Lane Swim: Older Adult`→`Lane Swim`, `Leisure Swim: Older Adult`→`Leisure Swim`, `Leisure Swim: Adult`→`Leisure Swim`, `Leisure Swim: Adult (Therapeutic Time)`→`Leisure Swim (Therapeutic Time)`, `Adult Leisure Swim`→`Leisure Swim`.

**Group Fitness**: `Drop-In Group Fitness: Older Adult`→`Drop-In Group Fitness`.

**Newmarket time-slot pattern** (one narrow regex, not a per-title table, since Newmarket embeds a literal time into the raw title): `/^Adult\s+(Skate|Swim)(\s*\(.+\))?$/i` strips only the leading `"Adult "` token, leaving the embedded time untouched (e.g. `Adult Skate (10:45-11:35 a.m.)`→`Skate (10:45-11:35 a.m.)`). Verified to match only 9 real Newmarket titles and nothing from any other municipality.

Several titles are shared by both age-verified and age-unknown sessions from the *same* source (e.g. Mississauga's `Adult Leisure Swim` is 1,092 sessions with no age data at all alongside 166 with a real `ageMin` of 16) — the per-session gate means the same raw title normalizes for one session and stays untouched for another, correctly, rather than a title-level blanket decision.

**Net effect measured against the live dataset**: 1,698 of 47,146 sessions (3.6%) now display a normalized title; distinct display-name count drops from 770 to 763 raw titles.

## 3. Variants Deliberately Preserved (Category B)

Confirmed meaningful subtypes, left completely untouched regardless of age-data reliability: `Pickleball with Family`, `Pickleball (Women)`, `Pickleball (2SLGBTQ+)`, `Drop In Family Pickleball`, `Drop-In Pickleball: Adult and Child`, `Pickleball - Adult Beginner/Beginner Plus(Drop In)` (contains "Beginner" — preserved whole, not partially stripped), `Badminton with Family`, `Badminton (Women)`, `Badminton - Teen (Drop In)`, `Youth Badminton`, `Badminton with Caregiver`, `Basketball (Women)`, `Basketball with Family`, `Family Basketball (...)`, `Youth Basketball` and its Mississauga variants, `Table Tennis with Family`, `Drop In Table Tennis Youth`, `Volleyball (2SLGBTQ+)`, `Volleyball - Adult (Drop In) Int (must know 5-1 systems)` (the "Int (must know 5-1 systems)" skill-level qualifier is kept — only the redundant "Adult" token is stripped). "Youth" was deliberately not normalized anywhere this phase (see §4).

## 4. Ambiguous Cases Left Unchanged (Category C)

Titles containing "Adult"/"Older Adult"/"Senior(s)" that were **not** normalized, with the reason:

- **No reliable age evidence at all** — normalizing would delete the only signal, with nothing to replace it: `Drop In Adult Pickleball` (Mississauga, 0/130 sessions with a defined `ageMin`), `Table Tennis - Adult (Drop In)` and `Table Tennis  -  Adult (Drop In)` (Richmond Hill, 0/6 and 0/9), `Drop In Adult & Older Adult Skate` (Mississauga, 0/166 — also a compound descriptor spanning two age bands, not a single redundant qualifier).
- **Venue-type ambiguity, not pure demographics** — `Drop In Seniors' Centre Pickleball` / `...Table Tennis` (Mississauga): "Seniors' Centre" names a specific facility type, not only an age qualifier, even though the sessions do carry reliable age data (55+). Preserved out of caution rather than assumed equivalent to "Older Adult [Activity]".
- **"Youth" deliberately out of scope this phase** — real titles like `Drop In Youth Sauga At Play Badminton`/`Basketball` mix a brand name ("Sauga At Play"), a program format ("Pick Up"), and inconsistent embedded age ranges; the task listed "Youth" among words not to blindly strip without giving a worked example the way it did for "Adult," so no Youth rule was added. Flagged as a candidate for a future, more careful pass.
- **Aquafit/general "Fitness"** (e.g. `Drop- In Aquafit: Older Adults`) — real and reliable, but outside the 8 requested families (the task named "Group Fitness" specifically, not the much larger and messier "Fitness"/"Aquafit" space). Deferred, not implemented.
- Dozens of other "Adult"/"Senior(s)" titles outside the 8 requested families entirely (Bridge, Euchre, Mah Jongg, Bingo, Scrabble, Billiards, Shinny/Hockey, Soccer, Yoga) were found during the audit but intentionally excluded from the implemented rule set — solving the full GTA recreation taxonomy was explicitly out of scope for this phase.

## 5. Implementation Location

- **`lib/dropin/activities.ts`** — new `displayActivityName(session)` export, plus the private `ADULT_QUALIFIER_DISPLAY_NAMES` exact-title table and `NEWMARKET_ADULT_TIME_SLOT_PATTERN` regex. Chosen because this file already hosts the existing activity-taxonomy concepts (`ACTIVITY_GROUPS`, `getShortcutForActivity`) that this is conceptually adjacent to, but kept as a fully separate table/function — it does not touch or extend the shortcut/search taxonomy.
- **`app/page.tsx`** — `displayActivityName` is called at every place an activity title is shown to the user: both result-card density variants, the Decision Sheet title, the Share summary/title/text, activity chip generation (`filterChipActivities`) and the chip-based results filter (`resultsForSelectedDate`), and the `activityDisplayLabel` search-summary sentence (added during regression after finding it was the one remaining raw-text fallback — see §7). No JSX structure, class name, spacing, or layout changed.

Model used: `session.activity` (source/original title, from the canonical `Session` model, Phase 3.3) → `displayActivityName(session)` (pure function, Phase 3.6C) → JSX. This matches the requested `source title → canonical session → display-name normalization → UI display title` shape without adding a new field to `Session` — `activity` already was the appropriate distinction, so `displayActivityName` layers on top of it rather than replacing it, per "reuse an existing distinction rather than adding unnecessary fields."

## 6. Source Title Preservation

`Session.activity` is never mutated, overwritten, or dropped anywhere in the source adapters, snapshot pipeline, or UI state. `displayActivityName` is a pure, read-only function called only at render sites; every other consumer (search matching, dedup keys, canonical IDs, data export, the raw canonical snapshot files on disk) continues to read the real, original municipal/vendor title untouched. The original title remains fully recoverable from `data/canonical/<municipality>/latest.json` and from `session.activity` in memory.

## 7. Search Regression Results

Search matching (`lib/dropin/search-intent.ts`'s `matchActivity`/`parseQuery`) was **not modified** — it already builds its known-activity index from `session.activity` (raw), so it required no change to keep working. Verified live in-browser:

- `pickleball` → 10 activities, chips `All / Pickleball / Pickleball with Family / Pick Up Hockey: Older Adult (Unsupervised)` (substring match, pre-existing, unrelated to this phase); cards show `Pickleball` with real distinct age badges (18–58, 60+, 18–99) from Toronto, Toronto, and Vaughan respectively — the Vaughan card, opened in the Decision Sheet, confirmed "Pre-registration required · City of Vaughan Recreation (PerfectMind)" with its raw source title `Adult Pickleball` displaying as `Pickleball` in both card and sheet, no mismatch.
- `adult pickleball` → still resolves correctly (4 activities: `Drop In Adult Pickleball`, `Adult Pickleball`, `Adult Pickleball (AFLC)` raw matches) — confirms the original wording remains fully searchable even though the same sessions display normalized.
- `leisure swim mississauga` → chips `Adult Leisure Swim / Leisure Swim / Lane & Leisure Swim`; cards for `Adult Leisure Swim` sessions **without** an age badge correctly kept their original title (no reliable evidence to normalize against), confirming the per-session gate live, not just in a unit check.
- `skate newmarket` → chip `Skate (2-2:50 p.m.)` confirmed the Newmarket time-slot pattern fires correctly in the running app.
- `badminton` → chips `Badminton / Badminton with Family / Badminton - Court / Badminton with Caregiver`; Newmarket's `Badminton-Ages 8+ (4:30-6:30 p.m.)` (no "Adult" token, out of pattern scope) correctly left untouched.
- `volleyball aurora` → chips `Volleyball (ARC) / Volleyball (AFLC)`; opened card confirmed `Volleyball (ARC)`, Ages 18–99, from raw `Adult Volleyball (ARC)`.
- `group fitness markham` → chip `Drop-In Group Fitness`; **found and fixed a real gap during this check**: the "N activities found"/empty-state summary sentence (`activityDisplayLabel`) was still showing the raw title (`"No Drop-In Group Fitness: Older Adult activities found..."`) because it independently fell back to `matchedActivities[0]` without going through `displayActivityName` — this affected any query resolving to Volleyball, Skating, or Group Fitness (none of which have a pre-existing shortcut label to fall back to, unlike Pickleball/Badminton/Basketball/Table Tennis, which already had one). Fixed by routing both of `activityDisplayLabel`'s raw-fallback branches through `displayActivityName` against a representative session; re-verified live — now reads `"No Drop-In Group Fitness activities found in Markham today."`
- `basketball richmond hill` → chip `Basketball (Drop In)` (from raw `Basketball - Adult (Drop In)`, partially reliable — 14/18 sessions).

No regression found in municipality search, activity+municipality search, partial terms, or the "All" reset behavior.

## 8. Desktop/Mobile Regression

- **Desktop**: full interactive pass in-browser (localhost) across the query set in §7 — search, result cards, chips, Decision Sheet, Share, all correct. **PASS.**
- **Mobile (LAN)**: repeated the `pickleball` search over the real LAN connection (`http://192.168.18.4:3000`, list-density view) — identical normalized results, same layout, no regressions. The pre-existing dev-only Grammarly-extension hydration-mismatch overlay ("1 Issue") was present as already documented in Phase 3.6B and is unrelated to this change. **PASS** (functional, over real LAN — true narrow-viewport visual verification carries the same environment limitation already documented in Phase 3.6B §12/§13, unchanged by this phase).
- `npx tsc --noEmit`: clean, 0 errors.
- `npm run lint` on touched files (`lib/dropin/activities.ts`, `app/page.tsx`): 0 new errors — `activities.ts` fully clean; the same 10 pre-existing `react-hooks/refs`/`react-hooks/set-state-in-effect` errors already documented and out-of-scope in Phase 3.6B remain, at the same (line-shifted) locations, none overlapping any line touched this phase.
- `npm run build`: succeeds, all 10 routes compiled.

## 9. Examples: Before → After

| Municipality | Raw source title | Age evidence | Displayed as |
|---|---|---|---|
| Vaughan | `Adult Pickleball` | 18–99 | **Pickleball** |
| Aurora | `Adult Pickleball (AFLC)` | 18–99 | **Pickleball (AFLC)** |
| Markham | `Drop-In Pickleball: Adults` | 10–99 to 16–99 | **Drop-In Pickleball** |
| Richmond Hill | `Pickleball - Adult (Drop In)` | 7 of 24 sessions: 18+ | **Pickleball (Drop In)** (7 sessions) / unchanged (17 sessions, no age data) |
| Mississauga | `Drop In Adult Pickleball` | none (0/130) | **unchanged** — `Drop In Adult Pickleball` |
| Toronto | `Pickleball with Family` | 5–12 | **unchanged** — meaningful subtype |
| Aurora | `Adult Volleyball (ARC)` | 18–99 | **Volleyball (ARC)** |
| Mississauga | `Adult Leisure Swim` | 166/1,258: 16+; rest: none | **Leisure Swim** (166 sessions) / unchanged (1,092 sessions) |
| Toronto | `Lane Swim: Older Adult` | 60+ | **Lane Swim** |
| Newmarket | `Adult Skate (10:45-11:35 a.m.)` | 18–99 | **Skate (10:45-11:35 a.m.)** |
| Markham | `Drop-In Group Fitness: Older Adult` | 14+ | **Drop-In Group Fitness** |
| Mississauga | `Drop In Seniors' Centre Pickleball` | 55+ | **unchanged** — venue-type ambiguity, preserved out of caution |

---

## Phase 3 Status

Phase 3.6C completes the last open item flagged at the end of Phase 3.6B (a naming-consistency issue, not a data-integrity or coverage gap). With this pass:

- All 8 target municipalities (Toronto/Scarborough, Mississauga, Richmond Hill, Vaughan, Markham, Newmarket, Aurora) are integrated, snapshot-backed, and search/regression-clean.
- Attendance semantics are evidence-derived per retrieval path (Phase 3.6B).
- Activity display naming is now evidence-derived per session rather than dictated by inconsistent source wording, without weakening search or hiding genuinely meaningful subtypes.
- No known data-honesty, regression, or build issues remain open.

**Phase 3 can be considered functionally complete.** The one carried-forward, explicitly-scoped-out item is physical-device mobile visual verification (narrow-viewport overflow/tap-target/scroll-lock checks), still blocked by the same environment tool limitation documented in Phase 3.6B — not a code defect, and not something this phase's normalization work touches or worsens.

Stopping here, as instructed. Not beginning Phase 4.
