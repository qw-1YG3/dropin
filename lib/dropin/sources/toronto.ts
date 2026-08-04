// Toronto Open Data adapter — the first (and currently only) municipality
// wired into the common Session model. Raw field names mirror the source's
// "Registered Programs and Drop-in Courses Offering" package (Drop-in.json /
// Locations.json) exactly, so a diff against a fresh API pull stays
// meaningful. This file is the one place that shape is allowed to leak into;
// everything downstream of getTorontoSessions() only ever sees the common
// Session model from ../types.
import { getShortcutForActivity } from "../activities";
import { dayForDate, formatAbsoluteTime, hasEnded, isUrgent } from "../time";
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

function formatAddress(l: RawLocation): string | undefined {
  const parts = [l["Street No"], l["Street No Suffix"], l["Street Name"], l["Street Type"], l["Street Direction"]].filter(
    (p) => p && p !== "None",
  );
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function getTorontoSessions(now: Date): Session[] {
  const dropIn = rawDropIn as RawDropInRecord[];
  const locations = rawLocations as RawLocation[];
  const locationById = new Map(locations.map((l) => [l["Location ID"], l]));

  const sessions: Session[] = [];

  for (const r of dropIn) {
    const day = dayForDate(r["First Date"], now);
    if (!day) continue;

    const start = new Date(`${r["First Date"]}T00:00:00`);
    start.setHours(r["Start Hour"], r["Start Minute"], 0, 0);
    const end = new Date(`${r["First Date"]}T00:00:00`);
    end.setHours(r["End Hour"], r["End Min"], 0, 0);

    if (day === "today" && hasEnded(end, now)) continue;

    const location = locationById.get(r["Location ID"]);
    if (!location) continue;

    const postalCode = location["Postal Code"];
    const activity = r["Course Title"];

    sessions.push({
      id: `toronto-${r._id}`,
      activity,
      category: getShortcutForActivity(activity) ?? activity,
      day,
      urgent: isUrgent(start, end, now),
      absoluteTime: formatAbsoluteTime(r["Start Hour"], r["Start Minute"], r["End Hour"], r["End Min"]),
      startMinutes: r["Start Hour"] * 60 + r["Start Minute"],
      centre: location["Location Name"],
      municipality: "Toronto",
      district: location["District"],
      address: formatAddress(location),
      postalCode: postalCode && postalCode !== "None" ? postalCode : undefined,
      officialSource: OFFICIAL_SOURCE,
      lastUpdated: SNAPSHOT_FETCHED_AT,
      verificationStatus: "verified",
    });
  }

  return sessions;
}
