import type { Day } from "./types";

// Shared by every source adapter — computing dates, weekdays, "happening
// soon," and chronological order is the same logic regardless of which
// municipality a record came from, so it lives here once rather than
// per-adapter.

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Local-midnight arithmetic throughout this file, deliberately — every date
// key is parsed and compared at local midnight (`T00:00:00`, no UTC
// offset), which is what makes calendar-day comparisons DST-safe: a day
// that's actually 23 or 25 hours long shifts each midnight by at most an
// hour, well inside the rounding tolerance used below. This only holds if
// the process itself runs in the source municipality's timezone — DropIn
// has no explicit IANA timezone handling (no Temporal/date-fns-tz), so a
// server running in a different zone would compute the wrong "today." See
// the Toronto adapter's own notes for how this is currently mitigated.
function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function localMidnight(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

export function isToday(dateKey: string, now: Date): boolean {
  return dateKey === toDateKey(now);
}

export function isTomorrow(dateKey: string, now: Date): boolean {
  return dateKey === toDateKey(addDays(now, 1));
}

// How many calendar days `dateKey` is from "today," which may be negative
// (the past) — rounded rather than floored/ceiled so a single DST
// transition inside the interval (a 23h or 25h day) still lands on the
// correct whole-day count.
export function daysFromToday(dateKey: string, now: Date): number {
  const today = localMidnight(toDateKey(now));
  const target = localMidnight(dateKey);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// True for today through today+(days-1) — the rolling window a source
// adapter or the Results layer requests. `days: 2` reproduces the original
// today/tomorrow-only behaviour exactly; `days: 7` is the real production
// target.
export function isWithinRollingWindow(dateKey: string, now: Date, days: number): boolean {
  const diff = daysFromToday(dateKey, now);
  return diff >= 0 && diff < days;
}

export function rollingWindowDates(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, i) => toDateKey(addDays(now, i)));
}

// The legacy today/tomorrow-only classifier the current Results UI reads
// directly (Discovery's highlight pool, the Today/This Week toggle, result
// grouping). Undefined for anything beyond tomorrow — never fabricated —
// so a future adapter returning a wider range doesn't silently mislabel a
// day-3 session as "tomorrow." Superseded by `date` for anything that needs
// the real range; this exists purely for backward compatibility until the
// UI is rebuilt against it.
export function legacyDay(dateKey: string, now: Date): Day | undefined {
  if (isToday(dateKey, now)) return "today";
  if (isTomorrow(dateKey, now)) return "tomorrow";
  return undefined;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Computed independently from the date itself rather than trusted from a
// raw source field — Toronto's own DayOftheWeek happens to always agree
// (verified against all 13,408 real records), but a shared canonical
// utility shouldn't depend on every future municipality's feed getting that
// right.
export function weekdayLabel(dateKey: string): string {
  return WEEKDAY_NAMES[localMidnight(dateKey).getDay()];
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "Today" / "Tomorrow" for the near term (matching the copy already used
// throughout the product), a real weekday + date beyond that — never a bare
// weekday name on its own, which becomes ambiguous the moment a range spans
// more than one occurrence of that weekday (a "Monday" 6 days out is a
// different Monday from one 13 days out).
export function dateLabel(dateKey: string, now: Date): string {
  if (isToday(dateKey, now)) return "Today";
  if (isTomorrow(dateKey, now)) return "Tomorrow";
  const d = localMidnight(dateKey);
  return `${weekdayLabel(dateKey)}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
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
// when the page is loaded. Naturally only ever true for the very near
// term: a session on day 4 of a rolling window has a start time far more
// than an hour away from "now" by construction, so this needs no separate
// date check to stay correct across a wider range.
export function isUrgent(start: Date, end: Date, now: Date): boolean {
  if (hasEnded(end, now)) return false;
  return start.getTime() - now.getTime() <= 60 * 60 * 1000;
}

export type TimeOfDay = "morning" | "afternoon" | "evening";

// Boundaries match the "Later Today" 5pm threshold already established in
// the Results UI, so a future time-of-day filter reads consistently with
// grouping that already exists rather than introducing a second opinion
// about what "evening" means.
export function timeOfDayBucket(startMinutes: number): TimeOfDay {
  if (startMinutes < 12 * 60) return "morning";
  if (startMinutes < 17 * 60) return "afternoon";
  return "evening";
}

// Chronological order across a real multi-day range: date first, then
// start time within that date. `Session.startMinutes` alone (the current
// UI's sort key) only produces a correct order within a single day.
export function compareChronologically(a: { date: string; startMinutes: number }, b: { date: string; startMinutes: number }): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.startMinutes - b.startMinutes;
}
