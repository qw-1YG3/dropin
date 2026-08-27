import type { Session } from "./types";

// Canonical activity taxonomy, shared by the server-side normalizer and the
// client search UI. Every entry on the right is a real `Course Title` value
// from Toronto Open Data — no invented names. Earlier design mockups used
// "Family Swim" and "Women's Swim," but those exact titles don't exist in
// the real dataset; the closest real analogues are "Leisure/Lane Swim:
// Family" and "Leisure/Lane Swim (Women)," folded into the Swimming group
// below rather than kept as separate fabricated activities.
export const ACTIVITY_GROUPS: Record<string, string[]> = {
  badminton: ["Badminton"],
  basketball: ["Basketball"],
  pickleball: ["Pickleball"],
  yoga: ["Yoga"],
  "open gym": ["Open Gym"],
  swimming: [
    "Lane Swim",
    "Leisure Swim",
    "Leisure Swim: Family",
    "Lane Swim: Family",
    "Leisure Swim (Women)",
    "Lane Swim (Women)",
  ],
  swim: [
    "Lane Swim",
    "Leisure Swim",
    "Leisure Swim: Family",
    "Lane Swim: Family",
    "Leisure Swim (Women)",
    "Lane Swim (Women)",
  ],
  "table tennis": ["Table Tennis"],
};

export const SHORTCUTS = ["Badminton", "Swimming", "Pickleball", "Basketball", "Yoga", "Open Gym"];

// The full set of real Course Title values the data layer supports right
// now. Used to filter the raw dataset down to what DropIn's taxonomy
// actually recognizes.
export const SUPPORTED_COURSE_TITLES = Array.from(new Set(Object.values(ACTIVITY_GROUPS).flat()));

// Maps a real Course Title to the canonical shortcut label used as the key
// into ACTIVITY_ICONS, so any real session (e.g. "Leisure Swim (Women)")
// resolves to the same icon as its shortcut chip (e.g. "Swimming").
const COURSE_TITLE_TO_SHORTCUT: Record<string, string> = {
  Badminton: "Badminton",
  Basketball: "Basketball",
  Pickleball: "Pickleball",
  Yoga: "Yoga",
  "Open Gym": "Open Gym",
  "Lane Swim": "Swimming",
  "Leisure Swim": "Swimming",
  "Leisure Swim: Family": "Swimming",
  "Lane Swim: Family": "Swimming",
  "Leisure Swim (Women)": "Swimming",
  "Lane Swim (Women)": "Swimming",
  "Table Tennis": "Table Tennis",
};

export function getShortcutForActivity(activity: string): string | undefined {
  return COURSE_TITLE_TO_SHORTCUT[activity];
}

// Phase 3.6C/3.6D: conservative DISPLAY-name normalization. This is
// completely separate from the shortcut/group taxonomy above and from
// Session.activity itself — search (search-intent.ts's matchActivity), the
// activity chip filter's matching logic, and every other consumer of
// `session.activity` keep reading the real, unmodified source title; only
// the small set of UI call sites that show a title to the user (result
// cards, the Decision Sheet, chip labels, share text, results-summary
// copy) route it through displayActivityName first. The original source
// title is never overwritten or discarded.
//
// displayActivityName runs a small, ordered pipeline of independent,
// individually-audited transformations — see
// docs/PHASE_3_6D_ACTIVITY_TAXONOMY_NORMALIZATION.md for the full
// per-layer evidence:
//
//   1. stripDropInNoise    — unconditional. DropIn's entire catalog is
//      drop-in content by definition, so a source's own "Drop In"/
//      "Drop-In" annotation (prefix, trailing parenthetical, or a handful
//      of confirmed mid-title shapes) carries no distinguishing
//      information for this product. Audited against all 263 real titles
//      containing the phrase this phase — none use it as part of a
//      genuinely distinct program identity.
//   2. demographic qualifier tables (ADULT_QUALIFIER_DISPLAY_NAMES /
//      OLDER_ADULT_QUALIFIER_DISPLAY_NAMES) — gated per session on a
//      realistic age floor (16 for "Adult," 50 for "Older Adult"/
//      "Senior"), not just "any defined ageMin." The 50-floor exists
//      because this phase found a real anomaly: Mississauga's "Drop In
//      Drumming Fit for Older Adults" carries ageMin=14 on every sampled
//      session — clearly mislabelled source data, not a true "Older
//      Adults" restriction. A plain "ageMin is defined" gate would have
//      stripped the wording anyway; the floor leaves it untouched instead.
//   3. embedded-age stripping — "Ages N+"/"Ages N-M"/"(N-M yrs)" text
//      removed only when it matches the session's own ageMin/ageMax
//      EXACTLY (not merely "some age is present"). Self-protecting by
//      construction: an untested future title's embedded age simply won't
//      match and will be left alone.
//   4. embedded-time stripping — a trailing "(H:MM-H:MM am/pm)" removed
//      only when it matches the session's own startDateTime/endDateTime
//      exactly. This phase found several real Newmarket titles (Adult
//      Shinny, Parent & Tot Skate, Shinny <birth-year>) whose embedded end
//      time is consistently 10 minutes earlier than the structured end
//      time — a genuine source data-quality inconsistency, not a parsing
//      bug (confirmed by direct inspection). Those titles fail the exact
//      match and are correctly left completely untouched, not guessed at.
//
// Titles where a qualifier is a meaningful subtype rather than a redundant
// restatement ("Pickleball with Family," "Badminton - Teen (Drop In),"
// "Yoga/Pilates Fusion," "Yoga: Chair," anything naming a skill level,
// format, or birth-year cohort) are absent from every table below and
// untouched by every pattern — preserved on purpose, not missed.
function stripDropInNoise(title: string): string {
  const override = DROP_IN_EXPLICIT_OVERRIDES[title];
  if (override !== undefined) return override;
  return title.replace(DROP_IN_PREFIX, "").replace(DROP_IN_SUFFIX, " ").trim();
}

const DROP_IN_PREFIX = /^Drop\s*-?\s*[Ii]n\b[\s,.-]*/;
// Not anchored to the string end — a small number of real titles carry the
// "(Drop In)" annotation mid-string (e.g. Richmond Hill's "Volleyball -
// Adult (Drop In) Int (must know 5-1 systems)"), and it is exactly as
// redundant there as at the end.
const DROP_IN_SUFFIX = /\s*\(\s*Drop\s*-?\s*[Ii]n\s*\)\s*/gi;

// A handful of real titles embed "Drop In"/"Drop-In" mid-string in a shape
// the prefix/suffix patterns above don't reach on their own — each
// hand-verified against the real title this phase, not a guess.
const DROP_IN_EXPLICIT_OVERRIDES: Record<string, string> = {
  "Family Garden Drop In": "Family Garden",
  "Preschool Drop In- Stay & Play": "Preschool - Stay & Play",
  "Parent & Tot Drop In (9:30-11:00 a.m.)": "Parent & Tot (9:30-11:00 a.m.)",
  "Open Gym - Family Drop-In (4:00 p.m.)": "Open Gym - Family (4:00 p.m.)",
  "Open Gym - Family Drop-In (10:00 a.m.)": "Open Gym - Family (10:00 a.m.)",
  "Skate Park - Family Drop-In (4:00 p.m.)": "Skate Park - Family (4:00 p.m.)",
  "Skate Park - Family Drop-In (10:00 a.m.)": "Skate Park - Family (10:00 a.m.)",
};

// Applied to the Drop-In-noise-stripped title. See the pipeline comment
// above for the age-floor reasoning. Every key here was confirmed this
// phase (Phase 3.6C entries carried over, Phase 3.6D adds Aquafit and a
// handful of "for Older Adults"/compound-Adult shapes) to have at least
// some real sessions meeting its table's floor —
// docs/PHASE_3_6D_ACTIVITY_TAXONOMY_NORMALIZATION.md has the full
// per-title evidence.
const ADULT_AGE_FLOOR = 16;
const ADULT_QUALIFIER_DISPLAY_NAMES: Record<string, string> = {
  // Pickleball
  "Adult Pickleball": "Pickleball",
  "Adult Pickleball (AFLC)": "Pickleball (AFLC)",
  "Pickleball: Adults": "Pickleball",
  "Pickleball-Adults": "Pickleball",
  "Pickleball Adults": "Pickleball",
  "Pickleball - Adult": "Pickleball",

  // Badminton
  "Adult Badminton": "Badminton",
  "Badminton: Adults": "Badminton",
  "Badminton - Adult": "Badminton",
  "Badminton Hit Around Adult": "Badminton Hit Around",

  // Table Tennis
  "Table Tennis Adult": "Table Tennis",
  "Table Tennis: Adults": "Table Tennis",

  // Basketball
  "Adult Basketball": "Basketball",
  "Basketball: Adults": "Basketball",
  "Basketball - Adult": "Basketball",

  // Volleyball
  "Adult Volleyball": "Volleyball",
  "Volleyball - Adult": "Volleyball",
  "Volleyball - Adult Int (must know 5-1 systems)": "Volleyball Int (must know 5-1 systems)",
  "Volleyball: Adults": "Volleyball",
  "Volleyball-:Adults": "Volleyball",
  "Adult Volleyball (ARC)": "Volleyball (ARC)",
  "Adult Volleyball (AFLC)": "Volleyball (AFLC)",

  // Skating
  "Leisure Skate: Adult (Unsupervised)": "Leisure Skate (Unsupervised)",
  "Leisure Skate: Adult": "Leisure Skate",
  "Adult Skate Fit": "Skate Fit",
};

const OLDER_ADULT_AGE_FLOOR = 50;
const OLDER_ADULT_QUALIFIER_DISPLAY_NAMES: Record<string, string> = {
  // Basketball / Volleyball
  "Older Adult Basketball": "Basketball",
  "Basketball Shoot Around for Older Adults": "Basketball Shoot Around",
  "Older Adult Volleyball": "Volleyball",

  // Skating / Swimming
  "Leisure Skate: Older Adult (Unsupervised)": "Leisure Skate (Unsupervised)",
  "Lane Swim: Older Adult": "Lane Swim",
  "Leisure Swim: Older Adult": "Leisure Swim",

  // Fitness / Aquafit / Group Fitness / Yoga
  "Group Fitness: Older Adult": "Group Fitness",
  "Aquafit: Older Adults": "Aquafit",
  "Yoga for Older Adults": "Yoga",
  "MSC- Osteo Fit for Older Adults": "MSC- Osteo Fit",
  "MSC- Weight Training Fit Class for Older Adults": "MSC- Weight Training Fit Class",
};

// A separate table for titles where "Adult"/"Older Adult" needs no age
// floor because it isn't a demographic claim at all — kept in its own
// unconditional table rather than the gated ones above so it never
// accidentally depends on age data that has nothing to do with it.
const UNGATED_QUALIFIER_DISPLAY_NAMES: Record<string, string> = {
  "Leisure Swim: Adult (Therapeutic Time)": "Leisure Swim (Therapeutic Time)",
};

// Newmarket embeds a literal start/end time directly into many raw activity
// titles (e.g. "Adult Skate (10:45-11:35 a.m.)", one distinct raw title per
// time slot). Handling that the same way as the tables above would mean
// one near-duplicate row per time slot for what is really a single audited
// pattern, so it gets one narrow, explicitly-scoped pattern instead —
// confirmed against every real "Adult Skate "/"Adult Swim " title
// Newmarket returned this phase, none from any other municipality. It
// strips only the leading "Adult " token and leaves everything else,
// including the embedded time (handled independently by the embedded-time
// layer below), untouched.
const NEWMARKET_ADULT_TIME_SLOT_PATTERN = /^Adult\s+(Skate|Swim)(\s*\(.+\))?$/i;

function stripAdultQualifier(title: string, ageMin: number | undefined): string {
  const ungated = UNGATED_QUALIFIER_DISPLAY_NAMES[title];
  if (ungated !== undefined) return ungated;

  if (ageMin !== undefined && ageMin >= OLDER_ADULT_AGE_FLOOR) {
    const olderAdult = OLDER_ADULT_QUALIFIER_DISPLAY_NAMES[title];
    if (olderAdult !== undefined) return olderAdult;
  }
  if (ageMin !== undefined && ageMin >= ADULT_AGE_FLOOR) {
    const adult = ADULT_QUALIFIER_DISPLAY_NAMES[title];
    if (adult !== undefined) return adult;
    if (NEWMARKET_ADULT_TIME_SLOT_PATTERN.test(title)) return title.replace(/^Adult\s+/i, "");
  }
  return title;
}

// Embedded age text ("Ages 6+", "Ages 10-15", "(9-13 yrs)") removed only
// when it matches the session's own ageMin/ageMax EXACTLY — an open-ended
// "N+" requires ageMax to be either undefined or >=90 (this codebase's own
// "no real cap" convention, matching PerfectMind's MaxAge:99 sentinel
// elsewhere), an explicit "N-M" requires both bounds to match exactly. Any
// non-exact match is left completely untouched by construction — this
// never needs a per-title table because it can't fire on anything that
// doesn't already carry matching structured evidence.
function stripEmbeddedAge(title: string, ageMin: number | undefined, ageMax: number | undefined): string {
  const withKeyword = title.match(/-?\s*\bAges?\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?(\+)?/i);
  if (withKeyword) {
    const min = Number(withKeyword[1]);
    const explicitMax = withKeyword[2] ? Number(withKeyword[2]) : undefined;
    const open = !!withKeyword[3];
    const matches = explicitMax !== undefined ? min === ageMin && explicitMax === ageMax : min === ageMin && open && (ageMax === undefined || ageMax >= 90);
    if (matches) return title.replace(withKeyword[0], "");
  }
  const barePlus = title.match(/\s+(\d{1,2})\+(?=\s*\()/);
  if (barePlus) {
    const min = Number(barePlus[1]);
    if (min === ageMin && (ageMax === undefined || ageMax >= 90)) return title.replace(barePlus[0], "");
  }
  const yrs = title.match(/\(\s*(\d{1,2})\s*-\s*(\d{1,2})\s*yrs?\.?\s*\)/i);
  if (yrs && Number(yrs[1]) === ageMin && Number(yrs[2]) === ageMax) return title.replace(yrs[0], "");
  return title;
}

// Embedded "(H:MM-H:MM am/pm)" text removed only when it matches the
// session's own real local start/end time exactly (parsed directly from
// the startDateTime/endDateTime strings, same "unqualified string is
// local time" convention already established in lib/dropin/time.ts — no
// Date/timezone arithmetic). A non-exact match — several real Newmarket
// titles this phase turned out to be exactly 10 minutes off structured
// data — is left completely untouched, never guessed at.
//
// The source labels the am/pm period inconsistently: sometimes only once,
// trailing ("6:30-8:15 a.m." — both sides share it), sometimes on both
// sides independently ("11:30a.m.-12:30p.m."). The first period group
// below is optional for that reason; when absent, the start borrows the
// end's period, same as the shared-trailing case.
function stripEmbeddedTime(title: string, startDateTime: string, endDateTime: string): string {
  const match = title.match(
    /\s*\(\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*\)/i,
  );
  if (!match) return title;
  const endIsPm = /p/i.test(match[6]);
  const startIsPm = match[3] ? /p/i.test(match[3]) : endIsPm;
  const toMinutes = (h: number, min: number, isPm: boolean) => {
    let hh = h % 12;
    if (isPm) hh += 12;
    return hh * 60 + min;
  };
  const embeddedStart = toMinutes(Number(match[1]), match[2] ? Number(match[2]) : 0, startIsPm);
  const embeddedEnd = toMinutes(Number(match[4]), match[5] ? Number(match[5]) : 0, endIsPm);
  const toDayMinutes = (dt: string) => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
  if (embeddedStart === toDayMinutes(startDateTime) && embeddedEnd === toDayMinutes(endDateTime)) {
    return title.replace(match[0], "");
  }
  return title;
}

// Mobile UX Polish pass, physical-device QA finding: several real titles
// carry a single trailing "(H:MM am/pm)" — a bare start time, not a range
// (stripEmbeddedTime above handles the two-sided "(H:MM-H:MM am/pm)" case)
// — immediately followed on the card/sheet by the real structured time
// ("Today · 5:45–8:00 PM"), e.g. "Public Swim (5:45 p.m.)" next to a
// session whose real start time is 5:45 PM. Same exact-match-only
// discipline as every other layer here: removed only when the embedded
// time equals the session's own real local start time exactly. Anchored to
// the END of the title on purpose — more conservative than the range
// version above, since a mid-string single time in parentheses has no
// confirmed real example yet and stripping one there risks removing a
// genuine part of an activity's name.
function stripEmbeddedSingleTime(title: string, startDateTime: string): string {
  const match = title.match(/\s*\(\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*\)\s*$/i);
  if (!match) return title;
  const isPm = /p/i.test(match[3]);
  const toMinutes = (h: number, min: number, pm: boolean) => {
    let hh = h % 12;
    if (pm) hh += 12;
    return hh * 60 + min;
  };
  const embedded = toMinutes(Number(match[1]), match[2] ? Number(match[2]) : 0, isPm);
  const toDayMinutes = (dt: string) => Number(dt.slice(11, 13)) * 60 + Number(dt.slice(14, 16));
  if (embedded === toDayMinutes(startDateTime)) {
    return title.replace(match[0], "");
  }
  return title;
}

function cleanupPunctuation(title: string): string {
  return title
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-:]+|[\s\-:]+$/g, "")
    .trim();
}

// The title actually shown to the user for this session — falls back to
// the original source title (`session.activity`, always preserved, never
// mutated) whenever no layer's evidence requirements are met. Callers that
// need the real source title for anything other than display (search,
// dedup keys, data export) should keep reading `session.activity`
// directly.
export function displayActivityName(
  session: Pick<Session, "activity" | "ageMin" | "ageMax" | "startDateTime" | "endDateTime">,
): string {
  let title = stripDropInNoise(session.activity);
  title = stripAdultQualifier(title, session.ageMin);
  title = stripEmbeddedAge(title, session.ageMin, session.ageMax);
  title = stripEmbeddedTime(title, session.startDateTime, session.endDateTime);
  title = stripEmbeddedSingleTime(title, session.startDateTime);
  title = cleanupPunctuation(title);
  return title.length > 0 ? title : session.activity;
}
