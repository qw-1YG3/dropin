import type { Day } from "./types";

// Shared by every source adapter — computing "today," "tomorrow," and
// "happening soon" is the same logic regardless of which municipality a
// record came from, so it lives here once rather than per-adapter.

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayForDate(dateKey: string, now: Date): Day | undefined {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateKey === toDateKey(now)) return "today";
  if (dateKey === toDateKey(tomorrow)) return "tomorrow";
  return undefined;
}

function formatClock(hour: number, minute: number): { display: string; period: "AM" | "PM" } {
  const period: "AM" | "PM" = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { display: `${h12}:${String(minute).padStart(2, "0")}`, period };
}

// Matches the exact "7:00–8:00 PM" style used throughout the approved UI —
// a single trailing period when both ends share one, otherwise one per side.
export function formatAbsoluteTime(startHour: number, startMinute: number, endHour: number, endMinute: number): string {
  const start = formatClock(startHour, startMinute);
  const end = formatClock(endHour, endMinute);
  if (start.period === end.period) return `${start.display}–${end.display} ${end.period}`;
  return `${start.display} ${start.period}–${end.display} ${end.period}`;
}

export function hasEnded(end: Date, now: Date): boolean {
  return end.getTime() <= now.getTime();
}

// A session counts as "happening soon" when it's already started (or starts
// within the next hour) and hasn't ended yet — computed against the real
// current time, not baked into stored data, so it stays correct no matter
// when the page is loaded.
export function isUrgent(start: Date, end: Date, now: Date): boolean {
  if (hasEnded(end, now)) return false;
  return start.getTime() - now.getTime() <= 60 * 60 * 1000;
}
