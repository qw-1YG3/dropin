// Municipality configuration for the ActiveCommunities source family
// (Phase 3.2). Every field here is a genuinely municipality-specific value
// confirmed in Phase 3.1 (docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md) — tenant
// slug, official public URL, and a seed center/calendar id used only to
// bootstrap the real center list from ../client.ts's getAcFilters (the
// filters response itself returns the full, authoritative list — the seed
// values just need to be *any* valid id for that tenant).
//
// No behavior lives here. Adding municipality #3 in this source family means
// adding one more entry to ACTIVE_COMMUNITIES_MUNICIPALITIES — not touching
// client.ts, age-join.ts, or normalize.ts.
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
  // "calendar type" dropdown for this tenant (not necessarily 1 for every
  // future tenant, even though it happens to be 1 for both of these).
  generalCalendarId: number;
  // Any real, currently-valid center id for this tenant, used only to
  // bootstrap getAcFilters — that call's own response is what supplies the
  // authoritative full center list actually used for the events pull.
  seedCenterId: number;
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
];
