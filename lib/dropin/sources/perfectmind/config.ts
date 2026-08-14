// Municipality + category configuration for the PerfectMind source family
// (Phase 3.5B). Every field here is genuinely municipality- or category-
// specific — host, site path prefix, widget id, and per-category calendar
// ids, all confirmed live against each tenant's real booking widget. No
// business logic lives here: ../client.ts is 100% tenant-agnostic, and
// ../normalize.ts's mapping logic is 100% category-agnostic. Adding a third
// PerfectMind municipality means adding one more entry to
// PERFECTMIND_MUNICIPALITIES — not touching client.ts or normalize.ts.
//
// Category scope is deliberately NOT exhaustive — consistent with Phase
// 3.4's finding that not every category on a shared platform necessarily
// belongs in DropIn's "drop-in active recreation" product scope, not
// "all municipal recreation programming." Vaughan exposes 3 categories
// total, all included (its full active taxonomy).
//
// Markham (Phase 3.5D full audit): the live widget currently exposes 14
// named categories, of which only 11 are hyperlinked/live (the other 3 —
// Adapted, Quick Fitness, Tennis Round Robins — render as plain text with
// no calendarId, meaning zero current sessions; there is nothing to
// session-validate against, so they're deliberately left out rather than
// guessed at, and should be re-audited once/if they go live). Of the 11
// live categories, 10 are included here — real, sampled, "Drop-In"-
// prefixed, time-boxed, real-facility, real-price sessions that fit active
// recreation (Sports & Activities, Swimming, Skating, Activities for Age
// 55+, Aquafit, all four Group Fitness subcategories, Sensory Room/Indoor
// Playground). "Art" (real drop-in life-drawing sessions at Varley Art
// Gallery) was excluded: genuinely drop-in, but a sedentary studio class,
// not active recreation. See docs/PHASE_3_5D_MARKHAM_FULL_COVERAGE.md for
// the full per-category evidence.
//
// Known nuance, not a reason to exclude: Markham's own booking-widget
// banner states "Aquafit is in-person only" — confirmed live, every
// sampled Aquafit record (including same-day ones) shows "More Info"
// rather than "Register Now!", unlike every other category. Aquafit is
// still real, drop-in, active recreation — this only affects how a user
// completes registration, not whether the category belongs in DropIn.
export type PerfectMindCategoryConfig = {
  // Human-readable label, used only for logging/health output.
  name: string;
  // PerfectMind's own calendarId for this category, confirmed live via the
  // booking widget's category navigation for this tenant.
  calendarId: string;
  // Session.category for records pulled from this calendar.
  category: string;
};

export type PerfectMindMunicipalityConfig = {
  // Must match an entry's `name` in lib/dropin/municipalities.ts exactly.
  municipality: string;
  // e.g. "vaughan.perfectmind.com" — no protocol, no trailing slash.
  host: string;
  // Tenant path prefix inserted between the host and every /Clients/... path
  // (Vaughan: "/25076"; Markham: "" — confirmed live, not a guess).
  sitePrefix: string;
  // PerfectMind's widgetId for this tenant's public booking widget.
  widgetId: string;
  // Session.officialSource — attribution string, not a URL.
  officialSource: string;
  // The real municipal page this tenant's booking widget is reached from.
  officialMunicipalUrl: string;
  // Namespaces canonical Session ids/sourceScheduleIds so they can never
  // collide with another source family's ids, another PerfectMind tenant's
  // ids, or across categories within this same tenant — see ./normalize.ts.
  idPrefix: string;
  categories: PerfectMindCategoryConfig[];
};

// Newmarket (Phase 3.6B, audited per Phase 3.6A's platform discovery): the
// live widget exposes 9 categories. 6 included — Fitness, Preschool,
// Skating, Sports, Swimming, Indoor Skate Park — all real, sampled,
// time-boxed drop-in sessions fitting active recreation (Zumba/Barre/Aqua
// Fitness, Parent & Tot Drop In, Public Skate/Shinny, Badminton/Soccer/
// Pickleball/Basketball/Volleyball/Fencing, Lane/Public Swim, age-banded
// skate park sessions). 2 excluded — "Arts & Culture" (out of scope by
// category name, and empty at audit time) and "Adult 55+" (sampled real
// titles were majority non-active social/hobby content — Euchre, Chess,
// Wood Carvers, Shuffleboard, Seniors Lunches, Mah-Jong — outweighing the
// two genuinely active titles, "Badminton" and "Archery (Indoor)," a
// worse ratio than Markham's own Age 55+ category, which tipped the other
// way). 1 deferred — "Inclusion" (ambiguous by name, zero live sessions
// to validate against at audit time — same reasoning as Markham's
// Adapted/Quick Fitness/Tennis Round Robins). See
// docs/PHASE_3_6B_AURORA_NEWMARKET_PRODUCTION.md for full evidence.
export const PERFECTMIND_MUNICIPALITIES: PerfectMindMunicipalityConfig[] = [
  {
    municipality: "Vaughan",
    host: "vaughan.perfectmind.com",
    sitePrefix: "/25076",
    widgetId: "dff88c8a-0b78-4a94-9dde-250040385300",
    officialSource: "City of Vaughan Recreation (PerfectMind)",
    officialMunicipalUrl: "https://www.vaughan.ca/recreation",
    idPrefix: "vaughan",
    categories: [
      { name: "Sports", calendarId: "1d032376-c4bb-4023-80f5-7c3c44de0637", category: "Sports" },
      { name: "Fitness Centre", calendarId: "d719b005-04c6-45b2-8556-4464c699a9ca", category: "Fitness Centre" },
      { name: "Swimming & Aquafitness", calendarId: "71fe848e-2dbd-4ec5-92fa-7f2d0ad09354", category: "Swimming & Aquafitness" },
    ],
  },
  {
    municipality: "Markham",
    host: "cityofmarkham.perfectmind.com",
    sitePrefix: "",
    widgetId: "6825ea71-e5b7-4c2a-948f-9195507ad90a",
    officialSource: "City of Markham Recreation (PerfectMind)",
    officialMunicipalUrl: "https://www.markham.ca/things-do/recreation-programs-activities",
    idPrefix: "markham",
    categories: [
      { name: "Sports & Activities", calendarId: "491a603e-4043-4ab6-b04d-8fac51edbcfc", category: "Sports & Activities" },
      { name: "Swimming", calendarId: "39bd5c76-e07f-43f3-af24-c6969091dbb4", category: "Swimming" },
      { name: "Skating", calendarId: "ecf5202d-4c97-4f89-b4e3-42966a1cc453", category: "Skating" },
      { name: "Activities for Age 55+", calendarId: "018e7083-d228-4af0-aab1-6d7958b3c8d4", category: "Activities for Age 55+" },
      { name: "Aquafit", calendarId: "d4d891dd-9e45-474b-97c4-e43c8f8fe3b8", category: "Aquafit" },
      { name: "Group Fitness: Cardio", calendarId: "3cad5e4f-9aa0-430b-b2d4-8f75e0984e39", category: "Group Fitness: Cardio" },
      { name: "Group Fitness: Mind & Body", calendarId: "1da4e633-1e1c-4639-8aed-aaeaef5ebb2d", category: "Group Fitness: Mind & Body" },
      { name: "Group Fitness: Strength Training", calendarId: "f0a1e11c-56e9-4d9b-996d-ef8201cf6ed8", category: "Group Fitness: Strength Training" },
      { name: "Group Fitness: Total Body Workout", calendarId: "c8d9404a-4ccd-465d-9a92-16a071baa76d", category: "Group Fitness: Total Body Workout" },
      { name: "Sensory Room / Indoor Playground", calendarId: "1b657632-f24f-42b3-bdb4-3043e211da12", category: "Sensory Room / Indoor Playground" },
    ],
  },
  {
    municipality: "Newmarket",
    host: "newmarket.perfectmind.com",
    sitePrefix: "",
    widgetId: "15f6af07-39c5-473e-b053-96653f77a406",
    officialSource: "Town of Newmarket Recreation (PerfectMind)",
    officialMunicipalUrl: "https://www.newmarket.ca/schedules",
    idPrefix: "newmarket",
    categories: [
      { name: "Fitness", calendarId: "fbaf60eb-a810-4cae-9269-908329c23749", category: "Fitness" },
      { name: "Preschool", calendarId: "a676fa83-d326-461c-b378-4d1200d8a114", category: "Preschool" },
      { name: "Skating", calendarId: "7df1a9b7-7d8f-4fbb-8359-1423ea1ef5e8", category: "Skating" },
      { name: "Sports", calendarId: "96370493-6148-4ba0-a655-99186ec6b29a", category: "Sports" },
      { name: "Swimming", calendarId: "d1df7882-40a8-45dc-8e7c-cfb2b6a9a930", category: "Swimming" },
      { name: "Indoor Skate Park", calendarId: "29ce1e64-7511-4cb7-af47-0f33e30b8b63", category: "Indoor Skate Park" },
    ],
  },
];
