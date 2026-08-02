// GTA-wide target coverage. "available" means a real adapter is registered
// in lib/dropin/sources/ and actually returns sessions for it — right now
// that's Toronto only. The rest are real target municipalities with no
// wired data source yet (checked directly: Mississauga's open-data catalogue
// has no drop-in dataset, Markham's drop-in programs live behind a
// commercial booking widget, not their open-data portal — neither exposes
// the kind of structured feed Toronto does). Listed here so Search can
// recognize the name and respond honestly ("not covered yet") instead of
// either pretending to have results or treating it as gibberish.
export type MunicipalityStatus = "available" | "not-yet-available";

export type Municipality = {
  name: string;
  status: MunicipalityStatus;
};

export const MUNICIPALITIES: Municipality[] = [
  { name: "Toronto", status: "available" },
  { name: "Mississauga", status: "not-yet-available" },
  { name: "Markham", status: "not-yet-available" },
  { name: "Vaughan", status: "not-yet-available" },
  { name: "Richmond Hill", status: "not-yet-available" },
  { name: "Brampton", status: "not-yet-available" },
  { name: "Oakville", status: "not-yet-available" },
  { name: "Burlington", status: "not-yet-available" },
  { name: "Pickering", status: "not-yet-available" },
  { name: "Ajax", status: "not-yet-available" },
  { name: "Whitby", status: "not-yet-available" },
  { name: "Milton", status: "not-yet-available" },
];

// Exact match only, same reasoning as matchDistrictExact in districts.ts —
// checked ahead of Community Centre matching so a facility name that
// happens to contain a municipality word doesn't outrank the municipality
// itself.
export function matchMunicipalityExact(text: string): Municipality | undefined {
  const q = text.trim().toLowerCase();
  return MUNICIPALITIES.find((m) => m.name.toLowerCase() === q);
}
