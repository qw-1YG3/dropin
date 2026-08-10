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
// deliberately does not invent a field just to fill it with "unknown".
import { getShortcutForActivity } from "../../activities";
import { weekdayLabel, legacyDay, formatAbsoluteTime } from "../../time";
import type { Session } from "../../types";
import type { AcEvent } from "./client";
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
