// Municipality configuration for the ActiveCommunities source family
// (Phase 3.2). Every field here is a genuinely municipality-specific value
// confirmed in Phase 3.1 (docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md) — tenant
// slug, official public URL, and a seed center/calendar id used only to
// bootstrap the real center list from ../client.ts's getAcFilters (the
// filters response itself returns the full, authoritative list — the seed
// values just need to be *any* valid id for that tenant).
//
// No behavior lives here. Adding another municipality to this source family
// means adding one more entry to ACTIVE_COMMUNITIES_MUNICIPALITIES — not
// touching client.ts, age-join.ts, or normalize.ts.
export type ActiveCommunitiesMunicipalityConfig = {
  // Must match an entry's `name` in lib/dropin/municipalities.ts exactly.
  municipality: string;
  // ActiveCommunities tenant slug — the path segment right after
  // anc.ca.apm.activecommunities.com/.
  tenant: string;
  // The real municipal page Phase 3.1 traced the official journey from.
  officialMunicipalUrl: string;
  // Session.officialSource — attribution string, not a URL.
  officialSource: string;
  // The general/public drop-in calendar id, confirmed via the on-platform
  // "calendar type" dropdown for this tenant. Optional as of Phase 3.6B —
  // Aurora's real drop-in content isn't on this dated calendar feed at all
  // (confirmed: zero "Drop In"-titled events across all 6 centers and ~84
  // days), so it omits this and relies entirely on `dropInKeywords` below
  // instead. A tenant sets one retrieval strategy or the other based on
  // where its real evidence says drop-in content actually lives — never
  // both guessed at once.
  generalCalendarId?: number;
  // Any real, currently-valid center id for this tenant, used only to
  // bootstrap getAcFilters — that call's own response is what supplies the
  // authoritative full center list actually used for the events pull.
  // Only meaningful alongside generalCalendarId.
  seedCenterId?: number;
  // Phase 3.6B: the optional two-tier drop-in retrieval strategy. When
  // present, ../index.ts fetches each keyword via `activities/list`
  // (client.ts's searchAcActivities), keeps only real "Drop In "-prefixed
  // results (confirmed, not assumed, to be this tenant's genuine drop-in
  // content — see docs/PHASE_3_6B_AURORA_NEWMARKET_PRODUCTION.md), and
  // expands each into its real dated/timed occurrences via
  // getAcProgramSessions. Every keyword listed here was individually
  // confirmed live to return real "Drop In "-titled programs during this
  // phase's category crawl — this is not a guess at what might exist.
  // A future tenant could use this same capability without any code
  // change, just its own confirmed keyword list.
  dropInKeywords?: string[];
  // Namespaces canonical Session ids/sourceScheduleIds so they can never
  // collide with Toronto's `toronto-*` ids or another municipality's own —
  // see ./normalize.ts.
  idPrefix: string;
};

export const ACTIVE_COMMUNITIES_MUNICIPALITIES: ActiveCommunitiesMunicipalityConfig[] = [
  {
    municipality: "Mississauga",
    tenant: "activemississauga",
    officialMunicipalUrl: "https://www.mississauga.ca/recreation-and-sports/sports-and-activities/",
    officialSource: "City of Mississauga / Active Mississauga (ActiveCommunities)",
    generalCalendarId: 1,
    seedCenterId: 287,
    idPrefix: "mississauga",
  },
  {
    municipality: "Richmond Hill",
    tenant: "richmondhill",
    officialMunicipalUrl: "https://www.richmondhill.ca/en/things-to-do/Community-Recreation-Guide.aspx",
    officialSource: "City of Richmond Hill / ActiveRH (ActiveCommunities)",
    generalCalendarId: 1,
    seedCenterId: 6,
    idPrefix: "richmondhill",
  },
  {
    municipality: "Aurora",
    tenant: "auroraontario",
    officialMunicipalUrl: "https://www.aurora.ca/recreation-arts-and-culture/recreation-programs-and-drop-in-activities/drop-in-activities/",
    officialSource: "Town of Aurora Recreation (ActiveCommunities)",
    // Confirmed via a real systematic category crawl (Phase 3.6B, not
    // keyword guessing per Phase 3.6A's own warning): these 3 keywords are
    // the ones that actually returned real "Drop In "-prefixed programs.
    // Aquafitness/Indoor Track/Rock Wall/Seniors Walking Club/Shinny/
    // Skating/Table Tennis/The Loft — every other category Aurora
    // advertises as drop-in on its own site — returned ZERO matching
    // catalog items despite being real, live, PDF-scheduled activities;
    // they are not retrievable through this API at all, not silently
    // assumed absent. See docs/PHASE_3_6B_AURORA_NEWMARKET_PRODUCTION.md.
    dropInKeywords: ["pickleball", "volleyball", "group fitness"],
    idPrefix: "aurora",
  },
];
