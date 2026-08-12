// Municipality + category configuration for the PerfectMind source family
// (Phase 3.5B). Every field here is genuinely municipality- or category-
// specific — host, site path prefix, widget id, and per-category calendar
// ids, all confirmed live against each tenant's real booking widget. No
// business logic lives here: ../client.ts is 100% tenant-agnostic, and
// ../normalize.ts's mapping logic is 100% category-agnostic. Adding a third
// PerfectMind municipality means adding one more entry to
// PERFECTMIND_MUNICIPALITIES — not touching client.ts or normalize.ts.
//
// Category scope is deliberately NOT exhaustive. Markham's live widget
// exposes 13 categories total (Activities for Age 55+, Adapted, Aquafit,
// Art, four separate Group Fitness subcategories, Quick Fitness, Sensory
// Room/Indoor Playground, Skating, Sports & Activities, Swimming, Tennis
// Round Robins); Vaughan exposes 3 (Sports, Fitness Centre, Swimming &
// Aquafitness). Phase 3.5B's production scope is 3 comparable categories per
// city — matching Vaughan's full active taxonomy and a representative,
// evidence-backed subset of Markham's — consistent with Phase 3.4's finding
// that not every category on a shared platform necessarily belongs in
// DropIn. Expanding either city's category list is a config-only change.
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
    ],
  },
];
