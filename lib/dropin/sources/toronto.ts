// Toronto Open Data adapter — the first (and currently only) municipality
// wired into the common Session model. Raw field names mirror the source's
// "Registered Programs and Drop-in Courses Offering" package (Drop-in.json /
// Locations.json) exactly, so a diff against a fresh API pull stays
// meaningful. This file is the one place that shape is allowed to leak into;
// everything downstream of getTorontoSessions() only ever sees the common
// Session model from ../types.
//
// Recurrence shape, confirmed directly against the real data (all 13,408
// records in the current snapshot): First Date === Last Date on every row,
// with dates spanning roughly six weeks out. Each raw row already IS one
// specific dated occurrence — there is no recurring template here that
// needs expanding into multiple dates. Course_ID is what actually
// identifies "the same recurring program" across its many separately-dated
// rows; DayOftheWeek is redundant with First Date (verified to agree on
// all 13,408 records) rather than an independent recurrence pattern. So
// this file is a validate-and-normalize pass over already-dated rows, not
// a projection/expansion engine — building one here would be solving a
// problem this source doesn't actually have.
import { getShortcutForActivity } from "../activities";
import { formatAbsoluteTime, hasEnded, isUrgent, isWithinRollingWindow, legacyDay, weekdayLabel } from "../time";
import type { Session } from "../types";

import rawDropIn from "@/data/toronto-open-data/drop-in.json";
import rawLocations from "@/data/toronto-open-data/locations.json";

type RawDropInRecord = {
  _id: number;
  "Location ID": number;
  Course_ID: number;
  "Course Title": string;
  Section: string;
  "Age Min": string;
  "Age Max": string;
  "Date Range": string;
  "Start Hour": number;
  "Start Minute": number;
  "End Hour": number;
  "End Min": number;
  "First Date": string;
  "Last Date": string;
  DayOftheWeek: string;
};

type RawLocation = {
  _id: number;
  "Location ID": number;
  "Parent Location ID": number;
  "Location Name": string;
  "Location Type": string;
  Accessibility: string;
  Intersection: string;
  "TTC Information": string;
  District: string;
  "Street No": string;
  "Street No Suffix": string;
  "Street Name": string;
  "Street Type": string;
  "Street Direction": string;
  "Postal Code": string;
  Description: string;
};

// The snapshot was fetched 2026-07-31 — see data/toronto-open-data/. Static
// until Sprint 03's own scoping note is revisited (a scheduled live refetch,
// not yet built).
const SNAPSHOT_FETCHED_AT = "2026-07-31";
const OFFICIAL_SOURCE = "City of Toronto Open Data";

// The real, intended production window. A caller (today, only the API
// route) may request a narrower one — see getTorontoSessions' own comment
// for why the route currently does.
const DEFAULT_ROLLING_WINDOW_DAYS = 7;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatAddress(l: RawLocation): string | undefined {
  const parts = [l["Street No"], l["Street No Suffix"], l["Street Name"], l["Street Type"], l["Street Direction"]].filter(
    (p) => p && p !== "None",
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

// "None" means no bound on that end, not "unknown" — the raw feed always
// gives a real Age Min (0 when unrestricted), so only Age Max ever carries
// the sentinel.
function parseAge(raw: string): number | undefined {
  return raw && raw !== "None" ? Number(raw) : undefined;
}

function isValidHourMinute(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

// Shape alone (DATE_KEY_PATTERN) isn't enough — "2026-13-99" matches
// \d{4}-\d{2}-\d{2} but isn't a real date. Some JS engines silently roll an
// out-of-range date like that over into a *different*, valid-looking date
// instead of rejecting it, so round-tripping the parsed components back
// against the input is the only reliable check — verified directly (see
// the sprint's defensive verification script) that V8 itself returns
// Invalid Date here, but this can't assume every engine agrees.
function isValidDateKey(dateKey: string): boolean {
  if (!DATE_KEY_PATTERN.test(dateKey)) return false;
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = dateKey.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Every reason a raw row is left out — never a silent drop. None of these
// currently fire against the real snapshot (checked directly: no malformed
// dates, no malformed times, no end-before-start rows, no orphaned Location
// IDs, no duplicate _id/occurrence keys), but the source is a live city
// feed, not a fixture DropIn controls, so a future refresh could introduce
// any of them.
type SkipReason =
  | "malformed-date"
  | "outside-requested-window"
  | "malformed-time"
  | "end-before-start"
  | "unknown-location"
  | "duplicate-occurrence";

function recordSkipped(id: number, reason: SkipReason): void {
  // Outside the requested window is normal, expected traffic (most rows on
  // any given day are simply further out than what was asked for) — not a
  // data-quality problem, so it doesn't warrant a diagnostic log line.
  if (reason === "outside-requested-window") return;
  console.warn(`[toronto adapter] skipped drop-in record ${id}: ${reason}`);
}

export function getTorontoSessions(now: Date, options?: { days?: number }): Session[] {
  const days = options?.days ?? DEFAULT_ROLLING_WINDOW_DAYS;
  const dropIn = rawDropIn as RawDropInRecord[];
  const locations = rawLocations as RawLocation[];
  const locationById = new Map(locations.map((l) => [l["Location ID"], l]));

  const sessions: Session[] = [];
  const seenOccurrenceKeys = new Set<string>();

  for (const r of dropIn) {
    const dateKey = r["First Date"];
    if (!isValidDateKey(dateKey)) {
      recordSkipped(r._id, "malformed-date");
      continue;
    }

    if (!isWithinRollingWindow(dateKey, now, days)) {
      recordSkipped(r._id, "outside-requested-window");
      continue;
    }

    if (!isValidHourMinute(r["Start Hour"], r["Start Minute"]) || !isValidHourMinute(r["End Hour"], r["End Min"])) {
      recordSkipped(r._id, "malformed-time");
      continue;
    }

    const start = new Date(`${dateKey}T${pad2(r["Start Hour"])}:${pad2(r["Start Minute"])}:00`);
    const end = new Date(`${dateKey}T${pad2(r["End Hour"])}:${pad2(r["End Min"])}:00`);

    // Belt-and-suspenders: dateKey and both hour/minute pairs are already
    // validated above, so this should be unreachable — but an Invalid Date's
    // getTime() is NaN, and NaN comparisons are always false, which would
    // silently defeat the end-before-start check below rather than raising
    // it. Checking explicitly here means a future change to the validation
    // above can't quietly reopen that hole.
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      recordSkipped(r._id, "malformed-time");
      continue;
    }

    if (end.getTime() <= start.getTime()) {
      recordSkipped(r._id, "end-before-start");
      continue;
    }

    if (hasEnded(end, now)) continue;

    const location = locationById.get(r["Location ID"]);
    if (!location) {
      recordSkipped(r._id, "unknown-location");
      continue;
    }

    // Same location + course + exact start instant would mean the source
    // published the same occurrence twice — never observed in the real
    // snapshot (checked directly), but guarded rather than assumed.
    const occurrenceKey = `${r["Location ID"]}|${r.Course_ID}|${start.toISOString()}`;
    if (seenOccurrenceKeys.has(occurrenceKey)) {
      recordSkipped(r._id, "duplicate-occurrence");
      continue;
    }
    seenOccurrenceKeys.add(occurrenceKey);

    const postalCode = location["Postal Code"];
    const activity = r["Course Title"];
    const id = `toronto-${r._id}`;

    sessions.push({
      id,
      // Equal to `id` today because Toronto's feed already provides one row
      // per dated occurrence (see the file-level comment) — kept distinct
      // for a future source that genuinely expands a template into many
      // dates.
      projectedOccurrenceId: id,
      sourceScheduleId: `toronto-course-${r.Course_ID}`,
      activity,
      category: getShortcutForActivity(activity) ?? activity,
      date: dateKey,
      dayOfWeek: weekdayLabel(dateKey),
      day: legacyDay(dateKey, now),
      urgent: isUrgent(start, end, now),
      absoluteTime: formatAbsoluteTime(r["Start Hour"], r["Start Minute"], r["End Hour"], r["End Min"]),
      startMinutes: r["Start Hour"] * 60 + r["Start Minute"],
      startDateTime: `${dateKey}T${pad2(r["Start Hour"])}:${pad2(r["Start Minute"])}:00`,
      endDateTime: `${dateKey}T${pad2(r["End Hour"])}:${pad2(r["End Min"])}:00`,
      centre: location["Location Name"],
      municipality: "Toronto",
      district: location["District"],
      address: formatAddress(location),
      postalCode: postalCode && postalCode !== "None" ? postalCode : undefined,
      ageMin: parseAge(r["Age Min"]),
      ageMax: parseAge(r["Age Max"]),
      officialSource: OFFICIAL_SOURCE,
      lastUpdated: SNAPSHOT_FETCHED_AT,
      verificationStatus: "verified",
    });
  }

  return sessions;
}
