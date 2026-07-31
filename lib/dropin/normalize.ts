import type { Day, RawDropInRecord, RawLocation, Session } from "./types";

import rawDropIn from "@/data/toronto-open-data/drop-in.json";
import rawLocations from "@/data/toronto-open-data/locations.json";

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatClock(hour: number, minute: number): { display: string; period: "AM" | "PM" } {
  const period: "AM" | "PM" = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { display: `${h12}:${String(minute).padStart(2, "0")}`, period };
}

// Matches the exact "7:00–8:00 PM" style used throughout the approved UI —
// a single trailing period when both ends share one, otherwise one per side.
function formatAbsoluteTime(startHour: number, startMinute: number, endHour: number, endMinute: number): string {
  const start = formatClock(startHour, startMinute);
  const end = formatClock(endHour, endMinute);
  if (start.period === end.period) return `${start.display}–${end.display} ${end.period}`;
  return `${start.display} ${start.period}–${end.display} ${end.period}`;
}

// A session counts as "happening soon" when it's already started (or starts
// within the next hour) and hasn't ended yet — computed against the real
// current time, not baked into the stored data, so it stays correct no
// matter when the page is loaded.
function isUrgent(start: Date, end: Date, now: Date): boolean {
  const msToStart = start.getTime() - now.getTime();
  const hasEnded = end.getTime() <= now.getTime();
  if (hasEnded) return false;
  return msToStart <= 60 * 60 * 1000;
}

function hasEnded(end: Date, now: Date): boolean {
  return end.getTime() <= now.getTime();
}

export function normalizeSessions(now: Date = new Date()): Session[] {
  const dropIn = rawDropIn as RawDropInRecord[];
  const locations = rawLocations as RawLocation[];

  const locationById = new Map(locations.map((l) => [l["Location ID"], l]));

  const todayKey = toDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);

  const dayKeyToDay: Record<string, Day> = { [todayKey]: "today", [tomorrowKey]: "tomorrow" };

  const sessions: Session[] = [];

  for (const r of dropIn) {
    const day = dayKeyToDay[r["First Date"]];
    if (!day) continue;

    const start = new Date(`${r["First Date"]}T00:00:00`);
    start.setHours(r["Start Hour"], r["Start Minute"], 0, 0);
    const end = new Date(`${r["First Date"]}T00:00:00`);
    end.setHours(r["End Hour"], r["End Min"], 0, 0);

    if (day === "today" && hasEnded(end, now)) continue;

    const location = locationById.get(r["Location ID"]);
    if (!location) continue;

    sessions.push({
      id: r._id,
      activity: r["Course Title"],
      day,
      urgent: isUrgent(start, end, now),
      absoluteTime: formatAbsoluteTime(r["Start Hour"], r["Start Minute"], r["End Hour"], r["End Min"]),
      centre: location["Location Name"],
    });
  }

  return sessions;
}
