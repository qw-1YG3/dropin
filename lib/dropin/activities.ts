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

// Phase 3.6C: conservative DISPLAY-name normalization. This is completely
// separate from the shortcut/group taxonomy above and from Session.activity
// itself — search (search-intent.ts's matchActivity), the activity chip
// filter's matching logic, and every other consumer of `session.activity`
// keep reading the real, unmodified source title; only the small set of
// UI call sites that show a title to the user (result cards, the Decision
// Sheet, chip labels, share text) route it through displayActivityName
// first. The original source title is never overwritten or discarded.
//
// The problem this solves: different source municipalities word the exact
// same activity differently to encode who it's for — "Adult Pickleball"
// (Vaughan), "Drop-In Pickleball: Adults" (Markham), "Pickleball - Adult
// (Drop In)" (Richmond Hill) — even though DropIn already shows a
// structured, more precise "Ages X+" badge for the same session. Once that
// badge exists and is reliable, the word "Adult"/"Older Adult" in the title
// is redundant, not informative.
//
// This is deliberately NOT a general regex over the dataset. Every entry in
// ADULT_QUALIFIER_DISPLAY_NAMES below was individually confirmed, against
// real per-session age data, to have at least some sessions with a defined
// ageMin — see docs/PHASE_3_6C_ACTIVITY_DISPLAY_NORMALIZATION.md for the
// full per-title audit. Titles where "Adult"/"Senior" appeared but NO
// session had reliable age data (e.g. Mississauga's "Drop In Adult
// Pickleball", Richmond Hill's "Table Tennis - Adult (Drop In)") are
// deliberately absent — normalizing those would delete the only signal a
// user has, with nothing to replace it. Titles where the qualifier is a
// meaningful subtype rather than a redundant demographic restatement
// ("Pickleball with Family," "Badminton - Teen (Drop In)," "Pickleball
// (2SLGBTQ+)," anything naming a specific skill level) are also absent —
// preserved unchanged, on purpose.
//
// displayActivityName() additionally gates every lookup on the SPECIFIC
// session's own ageMin being defined, not just on the title being present
// in this table — several of these exact titles are shared by both
// age-verified and age-unknown sessions from the same municipality (e.g.
// Mississauga's "Adult Leisure Swim" is 1,092 sessions with no age data at
// all alongside 166 with a real ageMin of 16), so the same raw title can
// normalize for one session and stay untouched for another, correctly.
const ADULT_QUALIFIER_DISPLAY_NAMES: Record<string, string> = {
  // Pickleball
  "Adult Pickleball": "Pickleball",
  "Adult Pickleball (AFLC)": "Pickleball (AFLC)",
  "Drop-In Pickleball: Adults": "Drop-In Pickleball",
  "Drop-In Pickleball-Adults": "Drop-In Pickleball",
  "Drop-In Pickleball Adults": "Drop-In Pickleball",
  "Pickleball - Adult (Drop In)": "Pickleball (Drop In)",

  // Badminton
  "Adult Badminton": "Badminton",
  "Drop-In Badminton: Adults": "Drop-In Badminton",
  "Drop In Adult Badminton": "Drop In Badminton",
  "Badminton - Adult (Drop In)": "Badminton (Drop In)",
  "Badminton Hit Around Adult": "Badminton Hit Around",

  // Table Tennis
  "Drop In Table Tennis Adult": "Drop In Table Tennis",
  "Drop-In Table Tennis: Adults": "Drop-In Table Tennis",

  // Basketball
  "Drop In Adult Basketball": "Drop In Basketball",
  "Basketball - Adult (Drop In)": "Basketball (Drop In)",
  "Adult Basketball": "Basketball",
  "Drop-In Basketball: Adults": "Drop-In Basketball",
  "Drop In Older Adult Basketball": "Drop In Basketball",

  // Volleyball
  "Adult Volleyball": "Volleyball",
  "Volleyball - Adult (Drop In)": "Volleyball (Drop In)",
  "Volleyball - Adult (Drop In) Int (must know 5-1 systems)": "Volleyball (Drop In) Int (must know 5-1 systems)",
  "Drop-In Volleyball: Adults": "Drop-In Volleyball",
  "Drop-In Volleyball-:Adults": "Drop-In Volleyball",
  "Adult Volleyball (ARC)": "Volleyball (ARC)",
  "Adult Volleyball (AFLC)": "Volleyball (AFLC)",
  "Drop In Older Adult Volleyball": "Drop In Volleyball",

  // Skating
  "Leisure Skate: Older Adult (Unsupervised)": "Leisure Skate (Unsupervised)",
  "Leisure Skate: Adult (Unsupervised)": "Leisure Skate (Unsupervised)",
  "Leisure Skate: Adult": "Leisure Skate",
  "Drop In Adult Skate Fit": "Drop In Skate Fit",

  // Swimming (Lane Swim / Leisure Swim)
  "Lane Swim: Older Adult": "Lane Swim",
  "Leisure Swim: Older Adult": "Leisure Swim",
  "Leisure Swim: Adult": "Leisure Swim",
  "Leisure Swim: Adult (Therapeutic Time)": "Leisure Swim (Therapeutic Time)",
  "Adult Leisure Swim": "Leisure Swim",

  // Group Fitness
  "Drop-In Group Fitness: Older Adult": "Drop-In Group Fitness",
};

// Newmarket embeds a literal start/end time directly into many raw activity
// titles (e.g. "Adult Skate (10:45-11:35 a.m.)", one distinct raw title per
// time slot). Handling that the same way as every entry above would mean
// one near-duplicate table row per time slot for what is really a single
// audited pattern, so it gets one narrow, explicitly-scoped pattern instead
// — confirmed against every real "Adult Skate "/"Adult Swim " title
// Newmarket returned this phase (9 distinct titles, all Newmarket, none
// from any other municipality — see docs/PHASE_3_6C_...). It strips only
// the leading "Adult " token and leaves everything else, including the
// embedded time, untouched.
const NEWMARKET_ADULT_TIME_SLOT_PATTERN = /^Adult\s+(Skate|Swim)(\s*\(.+\))?$/i;

// The title actually shown to the user for this session — falls back to
// the original source title (`session.activity`, always preserved,
// never mutated) whenever no rule applies or the session lacks the
// reliable age evidence a rule requires. Callers that need the real
// source title for anything other than display (search, dedup keys,
// data export) should keep reading `session.activity` directly.
export function displayActivityName(session: Pick<Session, "activity" | "ageMin">): string {
  if (session.ageMin === undefined) return session.activity;

  const exact = ADULT_QUALIFIER_DISPLAY_NAMES[session.activity];
  if (exact !== undefined) return exact;

  if (NEWMARKET_ADULT_TIME_SLOT_PATTERN.test(session.activity)) {
    return session.activity.replace(/^Adult\s+/i, "");
  }

  return session.activity;
}
