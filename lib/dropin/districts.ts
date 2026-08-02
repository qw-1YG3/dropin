// Real `District` values from Toronto Open Data's Locations resource, mapped
// to friendlier display names. Toronto Open Data itself is inconsistent about
// the old-City-of-Toronto district's exact string ("Toronto East York" vs
// "Toronto and East York" both appear) — both alias to one display name here
// so it doesn't show up as two confusingly-similar neighbourhood chips.
const RAW_DISTRICT_TO_DISPLAY: Record<string, string> = {
  "North York": "North York",
  Scarborough: "Scarborough",
  "Etobicoke York": "Etobicoke",
  "Toronto East York": "Downtown Toronto",
  "Toronto and East York": "Downtown Toronto",
};

export const DISTRICTS = ["North York", "Scarborough", "Etobicoke", "Downtown Toronto"];

export function getDisplayDistrict(rawDistrict: string): string {
  return RAW_DISTRICT_TO_DISPLAY[rawDistrict] ?? rawDistrict;
}

// Matches a free-text query segment against a real neighbourhood name.
// Case-insensitive, prefix/partial-based ("york" -> "North York"), which is
// the "standard/exact matching" MVP bar docs/SEARCH_PRINCIPLES.md sets for
// location-type queries (no fuzzy matching required yet).
//
// Deliberately one-directional (district contains query, not the reverse):
// this is called on a single already-segmented piece of a query. Matching
// "query contains district" too would make a whole unsegmented query like
// "badminton north york" match North York on its own, short-circuiting
// mixed-query parsing before it ever tries splitting activity from location.
export function matchDistrict(text: string): string | undefined {
  const q = text.trim().toLowerCase();
  if (!q) return undefined;
  return DISTRICTS.find((d) => d.toLowerCase().includes(q));
}

// Exact match only ("scarborough" -> "Scarborough", but not "the scarborough
// bluffs club"). Checked ahead of Community Centre matching in detectLocation
// so a facility whose name happens to contain a district word (e.g.
// "Centennial Recreation Centre - Scarborough") doesn't outrank the
// district itself when someone just typed the district's exact name.
export function matchDistrictExact(text: string): string | undefined {
  const q = text.trim().toLowerCase();
  return DISTRICTS.find((d) => d.toLowerCase() === q);
}
