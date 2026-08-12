// Raw PerfectMind ClassesV2 record -> canonical Session mapping, shared by
// every PerfectMind municipality (Phase 3.5B, Part 8). Field-by-field
// classification below is exactly what real sampled data supports
// (data/raw/poc-perfectmind/{vaughan,markham}/*-sample.json) — nothing here
// is invented beyond what the source actually returns.
//
//   DIRECT MAP:      activity (EventName), centre (Location), address/
//                     lat/long (Address.*), price (PriceRange), age
//                     (MinAge/MaxAge/NoAgeRestriction — a real, explicit
//                     flag this source provides, unlike ActiveCommunities)
//   TRANSFORMED:      id/sourceScheduleId (namespaced per tenant), date/time
//                     (OccurrenceDate is YYYYMMDD; end computed from start +
//                     DurationInMinutes rather than parsing the year-less
//                     FormattedEndDate string), officialUrl (reconstructed
//                     landing-page URL — see buildOfficialUrl), category
//                     (existing getShortcutForActivity fallback, same
//                     pattern ActiveCommunities already uses)
//   registrationStatus: mapped from BookButtonText only (see
//                     mapRegistrationStatus below) — ClosedButtonName was
//                     found to be a static per-tenant constant in every
//                     sampled record ("Not available." for Vaughan,
//                     "Registration Closed" for Markham, regardless of the
//                     record's actual state), so it carries no real signal
//                     and is deliberately not used.
//   UNAVAILABLE:      district (no neighbourhood concept in this source,
//                     same conclusion as ActiveCommunities), phone,
//                     postalCode kept separate from address rather than
//                     invented as a standalone field where the source
//                     folds it into the same Address block
//
// verificationStatus is "unverified" — same rationale as ActiveCommunities:
// DropIn has not independently confirmed attendance mechanics beyond what
// registrationStatus itself already states.
import { getShortcutForActivity } from "../../activities";
import { weekdayLabel, legacyDay } from "../../time";
import type { RegistrationStatus, Session } from "../../types";
import type { PmClass } from "./client";
import type { PerfectMindCategoryConfig, PerfectMindMunicipalityConfig } from "./config";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "20260811" -> "2026-08-11". Used instead of FormattedStartDate ("Tue, Aug
// 11th, 2026") purely because it's trivially unambiguous to parse; both
// express the same real date in every sampled record.
function parseOccurrenceDate(raw: string): string | undefined {
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

// "06:00 AM" / "10:00 PM" -> 24h hour/minute.
function parseFormattedTime(raw: string): { hour: number; minute: number } | undefined {
  const match = raw.match(/^(\d{2}):(\d{2}) (AM|PM)$/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3];
  if (period === "AM") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  return { hour, minute };
}

// Adds durationMinutes to a local "YYYY-MM-DDTHH:MM:SS" datetime and
// reformats to the same shape. Deliberately not derived from
// FormattedEndDate/FormattedEndTime — FormattedEndDate omits the year
// ("Aug 11th"), and DurationInMinutes is present on every sampled record
// and lets end-of-day rollover (rare for drop-in programming, but real)
// fall out of ordinary Date arithmetic instead of needing its own case.
function addMinutes(startDateTime: string, durationMinutes: number): string {
  const d = new Date(startDateTime);
  d.setMinutes(d.getMinutes() + durationMinutes);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

function formatAbsoluteTimeFromMinutes(startHour: number, startMinute: number, endDateTime: string): string {
  const end = new Date(endDateTime);
  const endHour = end.getHours();
  const endMinute = end.getMinutes();
  const fmt = (h: number, m: number) => {
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { display: `${h12}:${pad2(m)}`, period };
  };
  const start = fmt(startHour, startMinute);
  const endFmt = fmt(endHour, endMinute);
  if (start.period === endFmt.period) return `${start.display}–${endFmt.display} ${endFmt.period}`;
  return `${start.display} ${start.period}–${endFmt.display} ${endFmt.period}`;
}

// GTA-area plausibility bounds (Part 12) — wide enough to cover every
// municipality DropIn could plausibly add (Toronto through outer 905 belt)
// without being so wide it would accept an obviously wrong coordinate
// (e.g. a swapped lat/long landing in the ocean or another continent).
const GTA_LAT_RANGE: [number, number] = [43.0, 44.5];
const GTA_LON_RANGE: [number, number] = [-80.5, -78.5];

function validCoordinate(lat: number | undefined, lon: number | undefined): { latitude?: number; longitude?: number } {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  if (lat < GTA_LAT_RANGE[0] || lat > GTA_LAT_RANGE[1] || lon < GTA_LON_RANGE[0] || lon > GTA_LON_RANGE[1]) return {};
  return { latitude: lat, longitude: lon };
}

// Confirmed cold (no session/login) via curl for both Vaughan and Markham
// (Phase 3.4) — built purely from fields already present on every record
// plus static tenant config, so it survives independent of any session
// this refresh run itself created.
function buildOfficialUrl(config: PerfectMindMunicipalityConfig, record: PmClass): string {
  const params = new URLSearchParams({
    widgetId: config.widgetId,
    classId: record.EventId,
    occurrenceDate: record.OccurrenceDate,
    redirectedFromEmbededMode: "False",
  });
  return `https://${config.host}${config.sitePrefix}/Clients/BookMe4LandingPages/Class?${params.toString()}`;
}

// Evidence-based mapping from the one field found to carry a real signal
// (BookButtonText) — see file header for why ClosedButtonName is ignored.
// A string that doesn't confidently match one of these patterns (e.g. the
// real "More Info" or "Not available." values sampled) returns undefined:
// "unknown," never a guess. Case-insensitive `includes` rather than an
// exact-match table because Vaughan and Markham were already found to use
// different real strings for the same state ("Register Now!" vs.
// "Register"), and a future tenant/category is likely to add a third
// variant of the same underlying meaning.
function mapRegistrationStatus(bookButtonText: string | undefined): RegistrationStatus | undefined {
  if (!bookButtonText) return undefined;
  const text = bookButtonText.toLowerCase();
  if (text.includes("waitlist")) return "waitlist";
  if (text.includes("closed") || text.includes("sold out")) return "closed";
  if (text.includes("register")) return "open";
  return undefined;
}

function normalizeAddress(address: PmClass["Address"]): string | undefined {
  if (!address) return undefined;
  const parts = [address.Street, address.City, address.PostalCode].map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export type SkipReason = "malformed-occurrence-date" | "malformed-start-time" | "no-facility";

export function normalizePmClass(
  record: PmClass,
  municipalityConfig: PerfectMindMunicipalityConfig,
  categoryConfig: PerfectMindCategoryConfig,
  fetchedAtDateKey: string,
): { session: Session } | { skipped: SkipReason } {
  const dateKey = parseOccurrenceDate(record.OccurrenceDate);
  if (!dateKey) return { skipped: "malformed-occurrence-date" };

  const startTime = parseFormattedTime(record.FormattedStartTime);
  if (!startTime) return { skipped: "malformed-start-time" };

  const centre = record.Location?.trim() || record.Address?.AddressTag?.trim();
  if (!centre) return { skipped: "no-facility" };

  const startDateTime = `${dateKey}T${pad2(startTime.hour)}:${pad2(startTime.minute)}:00`;
  const durationMinutes = typeof record.DurationInMinutes === "number" ? record.DurationInMinutes : 0;
  const endDateTime = addMinutes(startDateTime, durationMinutes);

  // MUST include OccurrenceDate — verified against a real 1,205-record
  // Vaughan pull (Phase 3.5B) that EventId is NOT occurrence-unique: the
  // earlier Phase 3.4/3.5A belief that it was turned out to be wrong (or at
  // least didn't hold under this fuller pull). A single recurring program's
  // EventId is reused identically across every one of its dates (e.g. one
  // "Youth Basketball" EventId shared by 10+ distinct Mon/Wed/Fri
  // occurrences) — using EventId alone as the canonical id silently
  // collapsed 215 groups of genuinely distinct sessions down to one each.
  // (EventId, OccurrenceDate) together WERE confirmed unique with zero
  // collisions across that same real dataset, so no facility segment is
  // needed the way ActiveCommunities' id required one (Part 7).
  const id = `${municipalityConfig.idPrefix}-${record.EventId}-${record.OccurrenceDate}`;
  const courseId = record.CourseIdTrimmed || record.CourseId;

  const activity = record.EventName.trim();
  const age = record.NoAgeRestriction
    ? { ageMin: undefined, ageMax: undefined }
    : { ageMin: typeof record.MinAge === "number" ? record.MinAge : undefined, ageMax: typeof record.MaxAge === "number" ? record.MaxAge : undefined };
  const coords = validCoordinate(record.Address?.Latitude, record.Address?.Longitude);

  const session: Session = {
    id,
    projectedOccurrenceId: id,
    sourceScheduleId: `${municipalityConfig.idPrefix}-${courseId}`,
    activity,
    category: getShortcutForActivity(activity) ?? categoryConfig.category,
    date: dateKey,
    dayOfWeek: weekdayLabel(dateKey),
    day: legacyDay(dateKey, new Date(`${fetchedAtDateKey}T00:00:00`)),
    absoluteTime: formatAbsoluteTimeFromMinutes(startTime.hour, startTime.minute, endDateTime),
    startMinutes: startTime.hour * 60 + startTime.minute,
    startDateTime,
    endDateTime,
    centre,
    municipality: municipalityConfig.municipality,
    district: "",
    address: normalizeAddress(record.Address),
    postalCode: record.Address?.PostalCode?.trim() || undefined,
    latitude: coords.latitude,
    longitude: coords.longitude,
    ageMin: age.ageMin,
    ageMax: age.ageMax,
    price: record.PriceRange?.trim() || undefined,
    officialUrl: buildOfficialUrl(municipalityConfig, record),
    officialSource: municipalityConfig.officialSource,
    lastUpdated: fetchedAtDateKey,
    verificationStatus: "unverified",
    registrationStatus: mapRegistrationStatus(record.BookButtonText),
  };

  return { session };
}
