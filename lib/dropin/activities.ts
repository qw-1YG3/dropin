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
