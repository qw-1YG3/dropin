import { ACTIVITY_GROUPS } from "./activities";
import { getDisplayDistrict, matchDistrict, matchDistrictExact } from "./districts";
import { matchMunicipalityExact, type MunicipalityStatus } from "./municipalities";
import type { Session } from "./types";

// FSA-level precision is the expected common case for postal code search per
// docs/SEARCH_ENGINE.md — most users type "M2N," not a full postal code.
const FSA_REGEX = /^[A-Za-z]\d[A-Za-z]$/;
const FULL_POSTAL_REGEX = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

export type DetectedLocation =
  | { type: "postal"; label: string; fsa: string }
  | { type: "centre"; label: string }
  | { type: "neighbourhood"; label: string }
  | { type: "municipality"; label: string; status: MunicipalityStatus };

export type ParsedQuery = {
  activities: string[];
  location: DetectedLocation | undefined;
};

function detectPostalCode(text: string): DetectedLocation | undefined {
  const trimmed = text.trim();
  const compact = trimmed.toUpperCase().replace(/\s+/g, "");
  if (FULL_POSTAL_REGEX.test(trimmed) || FSA_REGEX.test(compact)) {
    const fsa = compact.slice(0, 3);
    return { type: "postal", label: fsa, fsa };
  }
  return undefined;
}

// One-directional (centre name contains query) for the same reason as
// matchDistrict below — matching the reverse would let an unsegmented mixed
// query short-circuit on a short centre name before segmentation runs.
function detectCentre(text: string, centreNames: string[]): DetectedLocation | undefined {
  const q = text.trim().toLowerCase();
  if (q.length < 3) return undefined;
  const match = centreNames.find((c) => c.toLowerCase().includes(q));
  return match ? { type: "centre", label: match } : undefined;
}

function detectNeighbourhood(text: string): DetectedLocation | undefined {
  const d = matchDistrict(text);
  return d ? { type: "neighbourhood", label: d } : undefined;
}

// Location sub-priority per the canonical Production V1 direction: Activity
// (handled separately in parseQuery), then Community Centre, then
// Neighbourhood, then City/Municipality, then Postal Code (deliberately
// checked last — postal codes should be understood, not be the primary
// interaction model). An exact district or municipality name jumps the
// queue ahead of Community Centre regardless, since an exact match is a
// stronger signal than a loose substring match against a differently-typed
// entity (a facility whose formal name happens to contain a district word,
// e.g. "Centennial Recreation Centre - Scarborough").
function detectLocation(text: string, centreNames: string[]): DetectedLocation | undefined {
  const exactDistrict = matchDistrictExact(text);
  if (exactDistrict) return { type: "neighbourhood", label: exactDistrict };

  const exactMunicipality = matchMunicipalityExact(text);
  if (exactMunicipality) return { type: "municipality", label: exactMunicipality.name, status: exactMunicipality.status };

  return detectCentre(text, centreNames) ?? detectNeighbourhood(text) ?? detectPostalCode(text);
}

// Unions two sources rather than short-circuiting on the first: a
// recognized shortcut keyword (e.g. "badminton") still resolves Toronto's
// curated exact title ("Badminton") the same as before, but now ALSO picks
// up any other municipality's real activity name containing that same
// substring (e.g. Richmond Hill's "55+ Badminton (Drop-In)") — without that
// municipality needing its own entry in ACTIVITY_GROUPS, which stays a
// Toronto-vocabulary convenience, not a source of truth every municipality
// must populate. Before Phase 3.2 this returned at most one substring match
// (`.find`) and never fell through to the substring scan at all for a
// recognized shortcut keyword — silently correct only because Toronto was
// the only municipality with real data; multi-municipality search needs
// every real match, not just the first or the curated one.
// A plain substring check alone misses real cross-municipality vocabulary
// variance that isn't a synonym problem, just a stem/suffix one: Toronto's
// curated shortcut is "swimming," but Markham's real titles ("Drop-In Lane
// Swim") only contain "swim" — "swimming" is not a substring of "swim" even
// though a person searching "swimming" obviously means it (Phase 3.5B,
// verified against real Markham data). Checking whether the query and a
// real word from the activity name share a common prefix catches this
// generically — for either direction of length — without hardcoding
// "swimming"/"swim" or any other specific pair, and without weakening the
// existing plain-substring match this already handled correctly (e.g.
// Richmond Hill's "55+ Badminton (Drop-In)" matching "badminton"). The
// length-3 floor avoids short words like "at" or "co-ed" producing
// spuriously broad prefix matches.
function activityNameMatchesQuery(activityName: string, q: string): boolean {
  const lowerName = activityName.toLowerCase();
  if (lowerName.includes(q)) return true;
  // Single-word queries only: a multi-word query like "swimming markham"
  // must NOT match here just because its first word stems to "swim" — that
  // would report an activity match for "swimming markham" as a whole and
  // short-circuit parseQuery's segmentation loop before it ever splits the
  // query into an activity half ("swimming") and a location half
  // ("markham"), silently dropping the location. The plain substring check
  // above already covers legitimate multi-word activity phrases (e.g.
  // "table tennis" against "Table Tennis").
  if (q.includes(" ")) return false;
  return lowerName.split(/\W+/).some((word) => word.length >= 3 && q.length >= 3 && (q.startsWith(word) || word.startsWith(q)));
}

function matchActivity(text: string, knownActivityNames: string[]): string[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const shortcutGroup = ACTIVITY_GROUPS[q] ?? [];
  const substringMatches = knownActivityNames.filter((a) => activityNameMatchesQuery(a, q));
  return Array.from(new Set([...shortcutGroup, ...substringMatches]));
}

// Follows docs/SEARCH_ENGINE.md's Mixed Query Parsing: segment the query and
// prefer the split that yields exactly one Activity match and one Location
// match over any other combination. Falls back to treating the whole query
// as Activity, then as Location, before conceding no match.
export function parseQuery(query: string, sessions: Session[]): ParsedQuery {
  const knownActivityNames = Array.from(new Set(sessions.map((s) => s.activity)));
  const centreNames = Array.from(new Set(sessions.map((s) => s.centre)));

  const trimmed = query.trim();
  if (!trimmed) return { activities: [], location: undefined };

  // An exact municipality or neighbourhood name is a strong enough signal
  // that it must win outright over a *substring* activity match against
  // that same whole string. Real case that surfaced this: a Mississauga
  // program is genuinely titled "Drop In Seniors' Centre Mississauga Swing
  // B&" — once matchActivity started unioning in real substring matches
  // (Phase 3.2, needed for cross-municipality activity search), a plain
  // "Mississauga" search would otherwise spuriously resolve as BOTH that
  // one activity AND the municipality, instead of just the municipality
  // search it obviously is. This can only fire when the trimmed query is
  // itself exactly the location name — never for a genuine mixed query
  // like "badminton Mississauga", which doesn't equal "Mississauga" alone.
  if (matchDistrictExact(trimmed) ?? matchMunicipalityExact(trimmed)) {
    const exactLocation = detectLocation(trimmed, centreNames);
    if (exactLocation) return { activities: [], location: exactLocation };
  }

  const wholeActivity = matchActivity(trimmed, knownActivityNames);
  const wholeLocation = detectLocation(trimmed, centreNames);
  if (wholeActivity.length > 0 && !wholeLocation) return { activities: wholeActivity, location: undefined };
  if (wholeLocation && wholeActivity.length === 0) return { activities: [], location: wholeLocation };

  const words = trimmed.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");

    const leftActivity = matchActivity(left, knownActivityNames);
    const rightLocation = detectLocation(right, centreNames);
    if (leftActivity.length > 0 && rightLocation) return { activities: leftActivity, location: rightLocation };

    const leftLocation = detectLocation(left, centreNames);
    const rightActivity = matchActivity(right, knownActivityNames);
    if (leftLocation && rightActivity.length > 0) return { activities: rightActivity, location: leftLocation };
  }

  if (wholeActivity.length > 0) return { activities: wholeActivity, location: wholeLocation };
  if (wholeLocation) return { activities: [], location: wholeLocation };
  return { activities: [], location: undefined };
}

export function sessionMatchesLocation(session: Session, location: DetectedLocation): boolean {
  switch (location.type) {
    case "postal":
      return (session.postalCode ?? "").toUpperCase().startsWith(location.fsa);
    case "centre":
      return session.centre === location.label;
    case "neighbourhood":
      return getDisplayDistrict(session.district) === location.label;
    case "municipality":
      return session.municipality === location.label;
  }
}
