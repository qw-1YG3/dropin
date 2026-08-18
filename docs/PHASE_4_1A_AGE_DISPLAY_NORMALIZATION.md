# Phase 4.1A — Age Display Normalization

A presentation-only cleanup: several source systems encode "no meaningful upper age limit" as a specific high numeric sentinel rather than leaving the field empty. This phase audited every municipality's real `ageMax` data, found clean, evidence-backed sentinel values, and taught the existing single age-label formatter to treat them as open-ended — without touching source data, canonical snapshots, or any other formatting logic.

---

## 1. Municipality-by-Municipality ageMax Audit

Measured directly against each municipality's real canonical snapshot (`data/canonical/<slug>/latest.json`):

| Municipality | Source family | Sessions with ageMax | Distinct ageMax values (all) | Highest genuine bounded value |
|---|---|---|---|---|
| Toronto | Toronto Open Data (own CSV) | 3,581 | 4, 5, 8, 11–19, 23, 24, **58, 59, 64**, **98** | 64 |
| Mississauga | ActiveCommunities | 1,110 | 6, 8, 12–18, **99**, **100** | 18 |
| Richmond Hill | ActiveCommunities | 38 | 8, 14, 18 | 18 (no sentinel present) |
| Vaughan | PerfectMind | 703 | 12, 17, **99** | 17 |
| Markham | PerfectMind | 131 | 10, 18, **99** | 18 |
| Newmarket | PerfectMind | 1,168 | 4, 9, 11–13, 15, 18, **99** | 18 |
| Aurora | ActiveCommunities | 170 | 14, 18, **99** | 18 |

Bolded values are the sentinel candidates investigated in §2/§3. Critically, **every municipality shows a clean gap between its highest genuine bounded value and its sentinel value(s)** — nothing falls between 65 and 97 anywhere in the current dataset (measured directly, zero sessions in that range across all 7 municipalities). This gap is what makes a single conservative threshold safe.

## 2. Sentinel Values Discovered

- **Toronto: `98`** — 29 sessions. Toronto's own raw open data (`data/toronto-open-data/drop-in.json`, "Age Max" column) literally publishes the string `"98"` for these rows (as opposed to `"None"`, which the adapter already correctly maps to "no restriction" — see §3). This is a real, distinct value the source chose to emit, not a data gap.
- **ActiveCommunities family (Mississauga, Aurora — confirmed; Richmond Hill — not present in current data): `99`, and Mississauga additionally `100`.** This field (`age_max_year`) comes from the ActiveCommunities `activities/list` catalog API, joined in by `lib/dropin/sources/activecommunities/age-join.ts`.
- **PerfectMind family (Vaughan, Markham, Newmarket): `99`.** This field (`MaxAge`) is a direct source field, distinct from the source's own separate `NoAgeRestriction` boolean flag (see §3 for why that distinction matters).

No sentinel values other than 98/99/100 were found. No municipality showed a value between 65 and 97.

## 3. Evidence for Interpreting Sentinels as Open-Ended

**Toronto (`98`)** — every session with `ageMax=98` pairs with a low, general-audience `ageMin` (8 or 13) and an activity with no plausible reason for a hard age-99 cutoff: *Roller Skating*, *Drag Open Studio (2SLGBTQ+)*, *Table Tennis*, *Multi-Sport with Family*, *Sewing*. By contrast, Toronto's genuine bounded adult ranges — `ageMax=64` (5 sessions, all *Volleyball*, ageMin 19), `ageMax=58/59` (121 sessions, *Volleyball/Pickleball/Badminton/Basketball/Open Gym (Women)*, ageMin 13–19) — read as real "under-60" adult time-slot boundaries (the kind of scheduling distinction that separates a general adult slot from a 55+ slot), and were left completely untouched. The gap between 64 and 98, with zero real sessions in between, is the direct evidence that 98 belongs to a different category: an emitted-but-not-meant-literally maximum.

**ActiveCommunities family (`99`/`100`)** — sampled activities carrying these values: Mississauga's *"Fun Swim with Lane For Men and Boys"* (ageMin 18, ageMax 99), *"Drop In Hockey Stick & Puck (18+)"* (ageMin 18, ageMax 99), *"Drop In High Intensity Interval Training (HIIT)"* (ageMin 14, ageMax 100); Aurora's *"Adult Pickleball (AFLC)"* and *"Group Fitness"* variants (ageMin 14–18, ageMax 99). Notably, **the same source family uses both 99 and 100** for what are clearly the same kind of unrestricted adult program — no activity-type distinction separates the two values, which is strong evidence both are arbitrary "no real cap" placeholders chosen inconsistently at data-entry time in the source system, not two different real restrictions.

**PerfectMind family (`99`)** — sampled activities: Vaughan's *"Adult Pickleball,"* *"Adult Badminton,"* *"Adult Basketball"* (ageMin 13–18, ageMax 99); Markham's *"Drop-In Pickleball: Adults,"* *"Drop-In Badminton: All Ages"* (ageMin 3–16, ageMax 99); Newmarket's *"Group Fitness — Sweat & Sculpt," "Aqua Fitness — Bootcamp"* and similar (ageMin 1–55, ageMax 99). This source additionally provides a genuinely separate, explicit `NoAgeRestriction` boolean field (`lib/dropin/sources/perfectmind/normalize.ts:170-172`) used when there is truly no age gate at all (both `ageMin`/`ageMax` become `undefined` in that case). The fact that these "Adult ___" sessions carry a real `MinAge` **and** the numeric `99` for `MaxAge`, rather than tripping the `NoAgeRestriction` flag, confirms `99` is this vendor's own internal convention for "no meaningful maximum" distinct from "no restriction at all" — i.e., the source system itself already draws exactly the distinction this phase needed to make.

No evidence was found anywhere suggesting 98/99/100 is ever a literal, intentional restriction (e.g., no activity type, centre, or municipality pattern correlates a sentinel value with genuinely age-99-relevant programming — there is no such thing as recreation programming that legitimately excludes centenarians).

## 4. Final Normalization Rule

Presentation-only, in `app/page.tsx`'s existing `ageRestrictionLabel()`:

```ts
const OPEN_ENDED_AGE_MAX_THRESHOLD = 98;

function ageRestrictionLabel(s: Session): string | undefined {
  const min = s.ageMin ?? 0;
  const max = s.ageMax !== undefined && s.ageMax >= OPEN_ENDED_AGE_MAX_THRESHOLD ? undefined : s.ageMax;
  if (min <= 0 && max === undefined) return undefined;
  if (max === undefined) return `Ages ${min}+`;
  if (min <= 0) return `Up to age ${max}`;
  return `Ages ${min}–${max}`;
}
```

A single numeric threshold (`>= 98`) rather than a hardcoded set (`{98, 99, 100}`) or per-municipality branching — it is the smallest rule that covers every sentinel actually found (98 is the lowest one observed), it's anchored directly to real evidence rather than a round arbitrary number, and it stays correct without modification if a future refresh surfaces a slightly different sentinel from the same source families (e.g., 97 or 101), since the underlying intent (adult-context programs, no real cap) would be the same. It cannot mis-fire against any real value currently in the dataset — the closest genuine bounded value in any municipality is 64.

## 5. Examples: Before → After

| ageMin | ageMax | Before | After | Why |
|---|---|---|---|---|
| 18 | 99 | Ages 18–99 | **Ages 18+** | Sentinel (PerfectMind/ActiveCommunities) |
| 13 | 99 | Ages 13–99 | **Ages 13+** | Sentinel |
| 8 | 98 | Ages 8–98 | **Ages 8+** | Sentinel (Toronto) |
| 14 | 100 | Ages 14–100 | **Ages 14+** | Sentinel (Mississauga) |
| 60 | — (undefined) | Ages 60+ | Ages 60+ | Unchanged — already open-ended, no ageMax to reinterpret |
| 19 | 64 | Ages 19–64 | Ages 19–64 | **Unchanged** — genuine bounded adult range (Toronto Volleyball) |
| 18 | 24 | Ages 18–24 | Ages 18–24 | **Unchanged** — genuine bounded range |
| 13 | 18 | Ages 13–18 | Ages 13–18 | **Unchanged** — genuine bounded youth range |
| 0 / undefined | 12 | Up to age 12 | Up to age 12 | Unchanged — ageMax-only case, no sentinel involved |
| — | — | *(no line rendered)* | *(no line rendered)* | Unchanged — missing age data |

All ten cases were verified directly (both by simulating the formatter against representative inputs and by live-testing real sessions in the running app — see §7).

## 6. Ambiguous Cases Deliberately Left Unchanged

- **Toronto's `ageMax=58/59/64`** (121 + 5 = 126 sessions, Volleyball/Pickleball/Badminton/Basketball/Open Gym (Women), ageMin 13–19) — read as genuine "under-60" adult scheduling boundaries, most plausibly separating a general adult time slot from a 55+/senior one at the same centre. Left completely untouched; this is exactly the kind of value the task warned not to blindly sweep in.
- **Richmond Hill** — its current canonical snapshot contains no `99`/`100`/`98` value at all (highest real `ageMax` is 18); the new rule is present in the code (since it's a single shared formatter) but has nothing to normalize for this municipality today. Documented rather than special-cased — if a future refresh surfaces Richmond Hill sessions with the same ActiveCommunities-family sentinel, they'll be handled identically and automatically.
- **No ageMax-only (ageMax present, ageMin absent) sessions exist in any current municipality's data** — verified directly (0 across all 7). The formatter's existing "Up to age N" branch for that case was left completely unmodified and is untouched by this phase's threshold check.

## 7. Files Changed

- **`app/page.tsx`** — the single `ageRestrictionLabel()` formatter (used identically by both the Result Card's combined price/eligibility line and the Decision Sheet's own eligibility line — confirmed by code inspection to be the only two call sites, both already sharing this one function before this phase) gained the `OPEN_ENDED_AGE_MAX_THRESHOLD` constant and one added condition. No other file was modified.

Explicitly **not** modified, per Part 3/Part 4: `lib/dropin/types.ts` (Session's `ageMin`/`ageMax` fields), any source adapter (`lib/dropin/sources/**`), any raw or canonical snapshot data, `lib/dropin/activities.ts` (which has its own, separate, pre-existing `ageMax >= 90` convention used only for stripping redundant embedded age text from raw titles during Phase 3.6C/D's activity-name normalization — a different concern, for a different UI surface, already independently landed on a similar "high value = open-ended" judgment call before this phase, which is corroborating context rather than something this phase needed to touch or duplicate).

## 8. Regression Results

- `npx tsc --noEmit`: clean, 0 errors.
- `npx eslint app/page.tsx`: the same 10 pre-existing, out-of-scope `react-hooks/refs` errors already documented since Phase 3.6B (unrelated scroll-fade-indicator code, nowhere near the age formatter) — no new errors introduced.
- `npm run build`: succeeds, all 10 routes compiled.
- Formatter-level verification against 11 representative cases (open-ended adult, open-ended older-adult, open-ended child/youth minimum, two genuine bounded ranges, ageMin-only, ageMax-only, and fully-missing age data) — all produced the expected label, listed in §5.
- Live verification in the running app:
  - Vaughan "Adult Pickleball" (real `ageMin=18, ageMax=99`) — Result Card shows **"Ages 18+,"** Decision Sheet shows **"Ages 18+"** — agreement confirmed.
  - Toronto "Volleyball" at Malvern Recreation Centre (real `ageMin=19, ageMax=64`) — Result Card and Decision Sheet both show **"Ages 19–64," unchanged**.
  - Toronto "Volleyball" (real `ageMin=13, ageMax=18`) — shows **"Ages 13–18," unchanged**.
  - Toronto "Lane Swim" sessions (real `ageMin=7`, no `ageMax`) — shows **"Ages 7+,"** unaffected (no sentinel involved).
  - Search/filter behavior unaffected throughout — activity chips, municipality search, date navigation all worked normally across the searches performed above; age is never part of the filtering/search logic (confirmed by inspection: `lib/dropin/search-intent.ts` and `lib/dropin/activities.ts`'s matching logic reference nothing derived from `ageRestrictionLabel`).
  - Source data unchanged — confirmed by inspection (no source adapter or snapshot file was touched) and by the live `/api/sessions` fetch in §"regression QA," which still returns the session's raw `ageMax: 99` untouched; only the rendered label differs.

## Answers

**A. Can ageMax=99 safely be displayed as "+" across all supported sources?** Yes, for every municipality where it currently appears (Mississauga, Vaughan, Markham, Newmarket, Aurora) — every sampled case pairs 99 with a general/adult-context activity and no municipality shows any real bounded value anywhere near 99.

**B. Are there municipality-specific exceptions?** No true exceptions, but one asymmetry worth naming: Toronto's own sentinel is `98`, not `99` — its raw open data literally emits that value, one lower than every other municipality's convention. The rule (`>= 98`) accounts for this directly rather than assuming Toronto matches the other municipalities' exact number.

**C. Are there other sentinel maximum values we should normalize?** `100` (Mississauga only, alongside its own `99` — same evidence, same treatment) is already covered by the `>= 98` threshold. No other sentinel-shaped value (e.g., 120) was found in any current dataset.

**D. Did any underlying source/canonical age data change?** No. Zero source adapters, snapshot files, or the `Session` type were modified. `ageMin`/`ageMax` remain exactly what each source publishes; only the derived display string changed.

**E. Do all user-facing age labels now use the same formatting rule?** Yes — `ageRestrictionLabel()` in `app/page.tsx` is the single formatter, used identically by the Result Card and the Decision Sheet (confirmed the only two call sites in the codebase). Share text does not include age at all (unchanged, out of scope). No duplicate or divergent age-formatting logic exists anywhere in the UI layer.

---

Stopping here, as instructed. Not creating age-group categories/badges, not touching activity taxonomy, search, filtering, sorting, card layout, or the Near Me/distance/geolocation work from Phase 4.2.
