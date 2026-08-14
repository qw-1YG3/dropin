// Raw ActiveCommunities event -> canonical Session mapping, shared by every
// municipality in this source family (Phase 3.2, Part 4). Field-by-field
// classification below is exactly what Phase 3.1 validated against real
// data (docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md §15) — this file does not
// invent anything beyond that.
//
//   DIRECT MAP:      activity (title), date/start/end time, centre,
//                     officialUrl (activity_detail_url)
//   TRANSFORMED:      id/sourceScheduleId (namespaced per municipality),
//                     category (existing getShortcutForActivity fallback,
//                     same pattern Toronto already uses), price (free/
//                     placeholder-string handling)
//   OPTIONAL (join):  ageMin/ageMax — populated only when age-join.ts found
//                     a real match; undefined otherwise, never guessed
//   UNAVAILABLE:      district, address, postalCode, latitude, longitude,
//                     phone — this source never provides them (confirmed,
//                     not merely unmapped)
//
// verificationStatus is "unverified" for every session from this family —
// Phase 3.1 §8 found the field that should distinguish true walk-in from
// reservation-required (`reservation_event_type_id`) was 0 for literally
// every event tested across both municipalities, so DropIn cannot back the
// same "verified" claim it makes for Toronto's data. No attendanceMode
// field is added here (see Part 6 of the Phase 3.2 report) — this project
// deliberately does not invent a field just to fill it with "unknown". Same
// reasoning still holds for Session.attendanceRequirement (Phase 3.5C) —
// this family leaves it unset rather than guessing.
import { getShortcutForActivity } from "../../activities";
import { weekdayLabel, legacyDay, formatAbsoluteTime } from "../../time";
import type { Session } from "../../types";
import type { AcEvent, AcActivityItem, AcProgramSession } from "./client";
import type { ActiveCommunitiesMunicipalityConfig } from "./config";
import type { AgeInfo } from "./age-join";

function parseSpaceSeparated(raw: string): { dateKey: string; hour: number; minute: number } | undefined {
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2}$/);
  if (!match) return undefined;
  return { dateKey: match[1], hour: Number(match[2]), minute: Number(match[3]) };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const PLACEHOLDER_PRICE_STRINGS = new Set(["", "See Facility for Details"]);

function normalizePrice(price: AcEvent["price"]): string | undefined {
  if (!price) return undefined;
  if (price.free) return "Free";
  if (price.estimate_price && !PLACEHOLDER_PRICE_STRINGS.has(price.estimate_price)) return price.estimate_price;
  return undefined;
}

export type SkipReason = "malformed-start-time" | "malformed-end-time" | "end-before-start" | "no-facility";

// One reason a raw event is excluded — mirrors the Toronto adapter's own
// validate-and-skip discipline (lib/dropin/sources/toronto.ts) rather than
// silently dropping malformed rows from a live remote source.
export function normalizeAcEvent(
  event: AcEvent,
  config: ActiveCommunitiesMunicipalityConfig,
  ageLookup: Map<number, AgeInfo>,
  fetchedAtDateKey: string,
): { session: Session } | { skipped: SkipReason } {
  const start = parseSpaceSeparated(event.start_time);
  if (!start) return { skipped: "malformed-start-time" };
  const end = parseSpaceSeparated(event.end_time);
  if (!end) return { skipped: "malformed-end-time" };

  const startDateTime = `${start.dateKey}T${pad2(start.hour)}:${pad2(start.minute)}:00`;
  const endDateTime = `${end.dateKey}T${pad2(end.hour)}:${pad2(end.minute)}:00`;
  if (new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()) return { skipped: "end-before-start" };

  const facility = event.facilities[0];
  if (!facility) return { skipped: "no-facility" };

  const age = ageLookup.get(event.event_item_id);
  // facility_id, not just event_item_id + start instant: confirmed against
  // real data that the same event_item_id can run concurrently at more than
  // one facility (e.g. a camp using two rooms/courts at once under one
  // program id) — without the facility distinguishing them, those genuinely
  // different sessions would collide onto the same canonical id.
  const id = `${config.idPrefix}-${event.event_item_id}-${facility.facility_id}-${start.dateKey}-${pad2(start.hour)}${pad2(start.minute)}`;

  const session: Session = {
    id,
    projectedOccurrenceId: id,
    sourceScheduleId: `${config.idPrefix}-${event.event_item_id}`,
    activity: event.title,
    category: getShortcutForActivity(event.title) ?? event.title,
    date: start.dateKey,
    dayOfWeek: weekdayLabel(start.dateKey),
    day: legacyDay(start.dateKey, new Date(`${fetchedAtDateKey}T00:00:00`)),
    absoluteTime: formatAbsoluteTime(start.hour, start.minute, end.hour, end.minute),
    startMinutes: start.hour * 60 + start.minute,
    startDateTime,
    endDateTime,
    centre: facility.facility_name || facility.center_name,
    municipality: config.municipality,
    // No neighbourhood/district concept exists in this source at all
    // (confirmed, Phase 3.1 §16) — left empty rather than forced into
    // Toronto's district vocabulary. getDisplayDistrict("") falls through
    // to "" (RAW_DISTRICT_TO_DISPLAY has no "" entry), so this correctly
    // never matches a Toronto neighbourhood search rather than colliding
    // with one by accident. See docs/PHASE_3_2_ACTIVECOMMUNITIES_PRODUCTION.md
    // Part 11 for the fuller reasoning.
    district: "",
    ageMin: age?.ageMin,
    ageMax: age?.ageMax,
    price: normalizePrice(event.price),
    officialUrl: event.activity_detail_url,
    officialSource: config.officialSource,
    lastUpdated: fetchedAtDateKey,
    verificationStatus: "unverified",
  };

  return { session };
}

// Two-tier drop-in path (Phase 3.6B, Aurora). `activity` is one real
// "Drop In "-prefixed week-level catalog entry (see ./config.ts's
// dropInKeywords); `programSession` is one of its real dated/timed
// occurrences from getAcProgramSessions. Field-by-field classification:
//
//   DIRECT MAP:      date/start/end time (first_date/last_date +
//                     beginning_time/ending_time), centre (location.label),
//                     age (age_min_year/age_max_year — same real field this
//                     source already provides for the single-tier path's
//                     age-join, just read directly here instead of joined),
//                     officialUrl (detail_url)
//   TRANSFORMED:      activity (title with the "Drop In - " prefix and
//                     trailing date-range suffix stripped — the raw catalog
//                     title names one specific calendar week, not the
//                     recurring program), id/sourceScheduleId (namespaced,
//                     keyed off both the week-activity id and the specific
//                     session id — see id's own comment for why both)
//   UNAVAILABLE:      price (the catalog item only carries a "view fee
//                     details" link, not an amount — the real number sits
//                     behind a third API call this phase deliberately
//                     doesn't add; see docs/PHASE_3_6B); coordinates,
//                     address, postal code, district, phone (confirmed
//                     absent from every field this endpoint returns,
//                     consistent with the rest of this source family)
//
// attendanceRequirement is set unconditionally to "pre-registration-
// required" here — NOT a per-municipality assumption (Session.
// attendanceRequirement's own comment explains why that would be wrong for
// Aurora specifically) but real, direct evidence for every record this
// specific retrieval path returns: a live no-show-fee/cancellation policy,
// real enrollment counts, and an "Enroll Now" action link were confirmed on
// sampled records this phase. The single-tier path above (normalizeAcEvent)
// still sets nothing, unchanged — this is a property of the retrieval path
// and its evidence, not of the municipality as a whole.
// Handles every real trailing date-range shape sampled this phase: same
// abbreviated month on both ends ("Aug 8 - 14"), full month name on both
// ends ("August 15 - August 21"), full month on the start only ("August 15
// - 21"), and a range crossing a month boundary ("Aug 29 - Sep 4").
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const DATE_RANGE_SUFFIX = new RegExp(`\\s*-?\\s*${MONTH}\\.?\\s+\\d{1,2}\\w*\\s*-\\s*(?:${MONTH}\\.?\\s+)?\\d{1,2}\\w*\\s*$`, "i");

function cleanDropInTitle(raw: string): string {
  return raw
    .replace(/^Drop In\s*-\s*/i, "")
    .replace(DATE_RANGE_SUFFIX, "")
    .trim();
}

function parseClockTime(raw: string): { hour: number; minute: number } | undefined {
  const match = raw.match(/^(\d{2}):(\d{2}):\d{2}$/);
  if (!match) return undefined;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

// `age_min_year`/`age_max_year` on a two-tier catalog item are NOT reliable
// — confirmed directly against every real record retrieved this phase,
// every single one reports "0/0" regardless of the activity's actual real
// restriction. The real evidence lives only in the free-text
// `age_description` field (real observed values: "Age At least 18 yrs but
// less than 99 yrs", "Age At least 14 yrs but less than 99 yrs") — parsed
// only when it matches this one confirmed, unambiguous shape; anything
// else stays undefined rather than guessed. "99" is kept as a real,
// evidence-provided ceiling value as-is (not adjusted to 98 for "less
// than"), consistent with how PerfectMind's own MaxAge: 99 sentinel is
// already treated elsewhere in this codebase — not a new convention.
function parseAgeDescription(desc: string | undefined): { ageMin?: number; ageMax?: number } {
  if (!desc) return {};
  const match = desc.match(/at least (\d+)\s*yrs?\s*but less than (\d+)\s*yrs?/i);
  if (!match) return {};
  return { ageMin: Number(match[1]), ageMax: Number(match[2]) };
}

export type DropInSkipReason = "malformed-date" | "malformed-time" | "end-before-start" | "no-facility";

export function normalizeAcDropInSession(
  activity: AcActivityItem,
  programSession: AcProgramSession,
  config: ActiveCommunitiesMunicipalityConfig,
  fetchedAtDateKey: string,
): { session: Session } | { skipped: DropInSkipReason } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(programSession.first_date) || !/^\d{4}-\d{2}-\d{2}$/.test(programSession.last_date)) {
    return { skipped: "malformed-date" };
  }
  const start = parseClockTime(programSession.beginning_time);
  const end = parseClockTime(programSession.ending_time);
  if (!start || !end) return { skipped: "malformed-time" };

  const startDateTime = `${programSession.first_date}T${pad2(start.hour)}:${pad2(start.minute)}:00`;
  const endDateTime = `${programSession.last_date}T${pad2(end.hour)}:${pad2(end.minute)}:00`;
  if (new Date(endDateTime).getTime() <= new Date(startDateTime).getTime()) return { skipped: "end-before-start" };

  const centre = activity.location?.label?.trim();
  if (!centre) return { skipped: "no-facility" };

  const title = cleanDropInTitle(activity.name);
  // Namespaced per tenant AND keyed off both the week-level activity id and
  // the specific occurrence's session id — the week-activity id alone is
  // NOT occurrence-unique (one "Drop In - ... - August 15-21" activity
  // expands into 8 real distinct dated/timed sessions in real sampled
  // data), the same class of mistake Phase 3.5B's canonical-id bug already
  // proved out for a different source family. session_id was confirmed
  // occurrence-unique across a real sampled activity's full session list.
  const id = `${config.idPrefix}-${activity.id}-${programSession.session_id}`;
  const age = parseAgeDescription(activity.age_description);

  const session: Session = {
    id,
    projectedOccurrenceId: id,
    sourceScheduleId: `${config.idPrefix}-${activity.id}`,
    activity: title,
    category: getShortcutForActivity(title) ?? title,
    date: programSession.first_date,
    dayOfWeek: weekdayLabel(programSession.first_date),
    day: legacyDay(programSession.first_date, new Date(`${fetchedAtDateKey}T00:00:00`)),
    absoluteTime: formatAbsoluteTime(start.hour, start.minute, end.hour, end.minute),
    startMinutes: start.hour * 60 + start.minute,
    startDateTime,
    endDateTime,
    centre,
    municipality: config.municipality,
    district: "",
    ageMin: age.ageMin,
    ageMax: age.ageMax,
    officialUrl: activity.detail_url ?? activity.action_link?.href,
    officialSource: config.officialSource,
    lastUpdated: fetchedAtDateKey,
    verificationStatus: "unverified",
    attendanceRequirement: "pre-registration-required",
  };

  return { session };
}
