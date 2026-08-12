// GTA-wide target coverage. "available" means a real adapter is registered
// in lib/dropin/sources/ and actually returns sessions for it — Toronto
// (its own static-snapshot adapter); Mississauga and Richmond Hill (both
// configured tenants of the shared ActiveCommunities adapter — see
// lib/dropin/sources/activecommunities/); and, as of Phase 3.5B, Vaughan
// and Markham (both configured tenants of the shared PerfectMind adapter —
// see lib/dropin/sources/perfectmind/). The rest are real target
// municipalities with no wired data source yet: Brampton/Burlington/
// Hamilton also sit behind a PerfectMind/Xplor booking widget, but "same
// platform as Vaughan/Markham" is not "already available" — each tenant
// still needs its own confirmed config (host, widget id, category calendar
// ids) before it's real coverage, and Ajax/Whitby/Oakville/Pickering/Milton
// haven't been integrated yet even though some are the same
// ActiveCommunities platform. Listed here so Search can recognize the name
// and respond honestly ("not covered yet") instead of either pretending to
// have results or treating it as gibberish.
export type MunicipalityStatus = "available" | "not-yet-available";

export type Municipality = {
  name: string;
  status: MunicipalityStatus;
};

export const MUNICIPALITIES: Municipality[] = [
  { name: "Toronto", status: "available" },
  { name: "Mississauga", status: "available" },
  { name: "Markham", status: "available" },
  { name: "Vaughan", status: "available" },
  { name: "Richmond Hill", status: "available" },
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
