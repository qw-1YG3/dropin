// Toronto Open Data normalizer — the one place Toronto's raw field shape
// (the "Registered Programs and Drop-in Courses Offering" package's
// Drop-in / Locations resources) is allowed to leak into; everything
// downstream only ever sees the common Session model from ../types.
//
// Phase 3.3 split this file: it used to read the bundled JSON snapshot
// itself and apply a live now-based rolling-window filter in one pass, on
// the request path. As of Phase 3.3, normalization is a pure function of
// whatever raw data it's given (called by scripts/refresh/toronto.ts
// against either a freshly-fetched live snapshot or, as a fallback, the
// committed bundle) — it takes no `now` and applies no time-window
// filtering, because a canonical snapshot built once at refresh time must
// stay valid to read hours or days later. The live "is this still within
// range, has it ended yet" view is applied fresh at request time instead,
// in lib/dropin/sources/index.ts, against whatever `now` actually is when
// someone asks. See docs/PHASE_3_3_DATA_REFRESH_SNAPSHOT_PIPELINE.md.
//
// Recurrence shape, confirmed directly against real data (both the
// original 13,408-record snapshot and the live ~29,000-record feed): First
// Date === Last Date on every row. Each raw row already IS one specific
// dated occurrence — there is no recurring template here that needs
// expanding into multiple dates. Course_ID is what actually identifies
// "the same recurring program" across its many separately-dated rows;
// DayOftheWeek is redundant with First Date rather than an independent
// recurrence pattern. So this file is a validate-and-normalize pass over
// already-dated rows, not a projection/expansion engine.
import { getShortcutForActivity } from "../activities";
import { formatAbsoluteTime, weekdayLabel } from "../time";
import type { Session } from "../types";

export type RawDropInRecord = {
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

export type RawLocation = {
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

export const OFFICIAL_SOURCE = "City of Toronto Open Data";

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
// \d{4}-\d{2}-\d{2} but isn't a real date — round-tripping the parsed
// components back against the input is the only reliable check.
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

// Every reason a raw row is left out — never a silent drop.
export type SkipReason = "malformed-date" | "malformed-time" | "end-before-start" | "unknown-location" | "duplicate-occurrence";

export type NormalizeResult = {
  sessions: Session[];
  skipped: Partial<Record<SkipReason, number>>;
};

// Pure: given raw rows and the date this data was fetched, produces every
// valid canonical Session — no `now`, no window filtering, no fabricated
// values for fields Toronto's feed doesn't have (latitude/longitude, price,
// phone, officialUrl all stay undefined, same as before this split).
export function normalizeTorontoSessions(rawDropIn: RawDropInRecord[], rawLocations: RawLocation[], fetchedAtDateKey: string): NormalizeResult {
  const locationById = new Map(rawLocations.map((l) => [l["Location ID"], l]));
  const sessions: Session[] = [];
  const seenOccurrenceKeys = new Set<string>();
  const skipped: Partial<Record<SkipReason, number>> = {};

  const recordSkip = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const r of rawDropIn) {
    const dateKey = r["First Date"];
    if (!isValidDateKey(dateKey)) {
      recordSkip("malformed-date");
      continue;
    }

    if (!isValidHourMinute(r["Start Hour"], r["Start Minute"]) || !isValidHourMinute(r["End Hour"], r["End Min"])) {
      recordSkip("malformed-time");
      continue;
    }

    const start = new Date(`${dateKey}T${pad2(r["Start Hour"])}:${pad2(r["Start Minute"])}:00`);
    const end = new Date(`${dateKey}T${pad2(r["End Hour"])}:${pad2(r["End Min"])}:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      recordSkip("malformed-time");
      continue;
    }

    if (end.getTime() <= start.getTime()) {
      recordSkip("end-before-start");
      continue;
    }

    const location = locationById.get(r["Location ID"]);
    if (!location) {
      recordSkip("unknown-location");
      continue;
    }

    // Same location + course + exact start instant would mean the source
    // published the same occurrence twice.
    const occurrenceKey = `${r["Location ID"]}|${r.Course_ID}|${start.toISOString()}`;
    if (seenOccurrenceKeys.has(occurrenceKey)) {
      recordSkip("duplicate-occurrence");
      continue;
    }
    seenOccurrenceKeys.add(occurrenceKey);

    const postalCode = location["Postal Code"];
    const activity = r["Course Title"];
    const id = `toronto-${r._id}`;

    sessions.push({
      id,
      projectedOccurrenceId: id,
      sourceScheduleId: `toronto-course-${r.Course_ID}`,
      activity,
      category: getShortcutForActivity(activity) ?? activity,
      date: dateKey,
      dayOfWeek: weekdayLabel(dateKey),
      // `day` (today/tomorrow) is deliberately NOT set here — it depends on
      // live `now` at read time, not the fetch time this function runs at.
      // See lib/dropin/sources/index.ts, which sets it fresh per request.
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
      lastUpdated: fetchedAtDateKey,
      verificationStatus: "verified",
      // Phase 3.5C: this dataset IS the City of Toronto's own "Drop-in"
      // program category, categorically distinct from its separately
      // published Registered Programs data, and carries no registration
      // field of any kind — the closest thing to a stable walk-in signal
      // any current source has. See docs/PHASE_3_5C_ATTENDANCE_OFFICIAL_ACTION.md.
      attendanceRequirement: "walk-in",
    });
  }

  return { sessions, skipped };
}
