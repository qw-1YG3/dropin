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
};

export const SHORTCUTS = ["Badminton", "Swimming", "Pickleball", "Basketball", "Yoga", "Open Gym"];

// The full set of real Course Title values the data layer supports right
// now. Used to filter the raw dataset down to what DropIn's taxonomy
// actually recognizes.
export const SUPPORTED_COURSE_TITLES = Array.from(new Set(Object.values(ACTIVITY_GROUPS).flat()));
