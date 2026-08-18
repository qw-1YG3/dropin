// Nominatim (OpenStreetMap) geocoding client — Phase 4.1's fallback for the
// small number of real facilities (Mississauga, Richmond Hill, Aurora, plus
// isolated gaps elsewhere) with no coordinate available from any official
// source investigated this phase (see
// docs/PHASE_4_1_FACILITY_LOCATION_GEOCODING.md Part 7 for the full
// provider comparison). Chosen specifically because DropIn only needs to
// resolve on the order of ~150-200 stable facility identities, once, not
// per-session or per-request: Nominatim's public instance requires no API
// key/account (this project cannot create third-party accounts on the
// user's behalf) and its usage policy's 1 request/second cap is trivially
// satisfied by a one-time batch this small. Build-script-only — never
// imported by app/ or lib/dropin/sources/index.ts.
//
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// requires: max 1 req/sec, a real identifying User-Agent, and no heavy
///bulk use without prior arrangement — this client enforces the rate limit
// itself rather than trusting callers to.
const NOMINATIM_HOST = "https://nominatim.openstreetmap.org";
const USER_AGENT = "DropIn-FacilityGeocoding/1.0 (one-time batch geocoding of ~150 stable GTA recreation facilities; not a bulk/live service)";
const MIN_REQUEST_INTERVAL_MS = 1100; // slightly over the 1 req/sec policy floor
const FETCH_TIMEOUT_MS = 15_000;

let lastRequestAt = 0;

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

// jsonv2's real field is `category` (e.g. "amenity", "leisure", "building",
// "boundary", "place", "highway") — confirmed by direct inspection this
// phase, not the "class" field name used by Nominatim's older v1 shape.
export type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  category: string;
  type: string;
  importance?: number;
};

// Requesting a few candidates rather than just the top hit: confirmed this
// phase that the single top-ranked result for a facility query is
// sometimes a *wrong* match (a suburb/neighbourhood centroid or a nearby
// road sharing the facility's first word — e.g. "Meadowvale CC" top-matches
// the "Meadowvale" suburb boundary, not the actual community centre), while
// a real POI match is present a little further down. The caller
// (facility-locations.ts) is responsible for picking the first candidate
// that passes category validation, never blindly the top one.
export async function geocodeNominatim(query: string): Promise<NominatimResult[]> {
  await rateLimit();
  const url = `${NOMINATIM_HOST}/search?${new URLSearchParams({ q: query, format: "jsonv2", limit: "5", countrycodes: "ca" })}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Nominatim geocode failed for "${query}": HTTP ${res.status}`);
  return (await res.json()) as NominatimResult[];
}

// Categories confirmed this phase to indicate a generic administrative
// area, neighbourhood/suburb, or road — never a real facility — rather
// than a specific point of interest. Rejecting these specifically (an
// explicit, evidenced denylist) is what catches the "municipality/suburb-
// centroid placeholder" failure mode Phase 4.0/4.1 were both explicitly
// asked to guard against, since these results otherwise pass the GTA
// bounding-box check easily (they're real, in-bounds coordinates — just
// not the facility's).
const REJECTED_CATEGORIES = new Set(["boundary", "place", "highway"]);

export function isPlausibleFacilityResult(result: NominatimResult): boolean {
  return !REJECTED_CATEGORIES.has(result.category);
}

// Query-text construction ONLY — never used for facility identity/merging
// (that stays exact per-source-string, Part 2). Confirmed this phase that
// Nominatim requires a clean, real-world-recognizable place name: an
// unexpanded internal abbreviation ("Meadowvale CC") mismatches to the
// wrong nearby place (a suburb boundary, not the building), and any
// trailing room/subspace words ("... Fitness Studio", "... Gym A,B")
// return zero results even after expansion. Both fixes are applied only to
// the TEXT sent to the geocoder — the resolved coordinate is still
// validated against the real GTA bounds and result category before
// acceptance, and the original facility identity/session display text is
// completely unaffected by anything in this function.
const ABBREVIATION_EXPANSIONS: [RegExp, string][] = [
  [/\bMiss\b/g, "Mississauga"],
  [/\bCC\b/g, "Community Centre"],
  [/\bRC\b/g, "Recreation Centre"],
  [/\bCntr\b/g, "Centre"],
  [/\bCplx\b/g, "Complex"],
];

// A small, explicit, evidenced set of building-type nouns real facility
// names in this dataset are confirmed to end their "core building" portion
// with — used only to trim trailing room/rink/studio words a geocoder
// can't otherwise resolve past. A name with none of these keywords is
// passed through unmodified (better to try the full raw text than guess
// where to cut).
const BUILDING_KEYWORD_PATTERN = /^(.*?\b(?:CC|Cntr|RC|Arena|Library|Pool|Gymnasium|SPORTSPLEX|Cplx))\b/;

export function buildGeocodingQuery(municipality: string, facilityName: string): string {
  const truncated = facilityName.match(BUILDING_KEYWORD_PATTERN)?.[1] ?? facilityName;
  let expanded = truncated;
  for (const [pattern, replacement] of ABBREVIATION_EXPANSIONS) {
    expanded = expanded.replace(pattern, replacement);
  }
  return `${expanded}, ${municipality}, Ontario, Canada`;
}
