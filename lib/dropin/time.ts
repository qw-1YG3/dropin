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
export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function localMidnight(dateKey: string): Date {
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

// Compact label for a date-strip chip — "Today"/"Tomorrow" for the near
// term (matching `dateLabel`), "{Weekday-abbrev} {day}" beyond that, e.g.
// "Sat 8". Deliberately shorter than `dateLabel`, which spells the weekday
// out in full for contexts with room for it.
export function shortDateLabel(dateKey: string, now: Date): string {
  if (isToday(dateKey, now)) return "Today";
  if (isTomorrow(dateKey, now)) return "Tomorrow";
  const d = localMidnight(dateKey);
  return `${weekdayLabel(dateKey).slice(0, 3)} ${d.getDate()}`;
}

// The two-line date-strip pieces: a short top context word ("Today" for
// the current date, a 3-letter weekday abbreviation otherwise — never
// "Tomorrow," which is long enough to break the strip's uniform rhythm)
// and a "Mon D" bottom line that always carries the real calendar date, so
// "Today" never stands alone without the date underneath it.
export function dateStripContextLabel(dateKey: string, now: Date): string {
  if (isToday(dateKey, now)) return "Today";
  return weekdayLabel(dateKey).slice(0, 3);
}

export function dateStripDateLabel(dateKey: string): string {
  const d = localMidnight(dateKey);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

// Full, unambiguous label for accessibility — always states the real
// calendar date, even for "Today"/"Tomorrow," which alone don't tell a
// screen-reader user landing on a date-strip control which date that
// actually is.
export function fullDateLabel(dateKey: string, now: Date): string {
  const d = localMidnight(dateKey);
  const calendarPart = `${weekdayLabel(dateKey)}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
  if (isToday(dateKey, now)) return `Today, ${calendarPart}`;
  if (isTomorrow(dateKey, now)) return `Tomorrow, ${calendarPart}`;
  return calendarPart;
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

export type SessionStatus = "starting-soon" | "in-progress" | "later" | "ended";

// The one centralized model for a session's live status against its real
// start/end time and the current moment. Replaces the old single "urgent"
// boolean, which conflated "starts within the hour" with "already
// started": for an in-progress session, start-minus-now is negative, and a
// negative number is always <= one hour, so the old check quietly labelled
// a session that had already started as "Happening soon." Computed fresh
// against a live `now` rather than baked into stored data, so status stays
// correct for as long as the page stays open, not just at fetch time.
export function sessionStatus(start: Date, end: Date, now: Date): SessionStatus {
  if (hasEnded(end, now)) return "ended";
  if (start.getTime() <= now.getTime()) return "in-progress";
  if (start.getTime() - now.getTime() <= 60 * 60 * 1000) return "starting-soon";
  return "later";
}

// "6:45 PM" from a Date's own local wall-clock time — used wherever only one
// endpoint (not a start–end range) needs to be shown, e.g. "Happening now ·
// Until 6:45 PM". Reuses formatClock so there's exactly one place that knows
// how to render a 12-hour clock string.
export function clockLabel(d: Date): string {
  const { display, period } = formatClock(d.getHours(), d.getMinutes());
  return `${display} ${period}`;
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

// Phase 4.3B — the ranking chain Phase 4.3A's real-data audit recommended
// (docs/PHASE_4_3A_RANKING_STRATEGY_AUDIT.md, "Strategy C" plus a
// deterministic final key): chronological order remains authoritative
// (never lets a later session outrank an earlier one — the audit's Strategy
// B was rejected specifically for doing that), and distance ONLY breaks an
// exact date+startMinutes tie. `distanceKmFor` is a caller-supplied lookup
// rather than a stored field so this stays a pure comparator factory with no
// dependency on React state, geolocation, or when it's called — the same
// discipline as compareChronologically above. When `distanceKmFor` returns
// `undefined` for every session (no granted location), every tie's distance
// step is a no-op and this degrades to `compareChronologically` + a
// deterministic `id` tiebreak, which is exactly Part 5's required
// no-location behavior — achieved by construction, not a separate branch.
//
// Missing distance never sorts as if it were 0 km (that was Phase 4.3A's
// concrete cautionary finding against naive weighted scoring) — a session
// with a real distance value always sorts ahead of one without, among
// otherwise-tied sessions, and two sessions that both lack distance (or
// have the identical distance) fall through to the `id` tiebreak. Every
// branch is a strict lexicographic tuple comparison
// (date, startMinutes, hasDistance, distance, id), which is transitive and
// deterministic by construction — never an ad hoc pairwise heuristic that
// could produce unstable ordering across a larger set (Part 8).
export function compareForRanking<T extends { date: string; startMinutes: number; id: string }>(
  distanceKmFor: (session: T) => number | undefined,
): (a: T, b: T) => number {
  return (a, b) => {
    const chronological = compareChronologically(a, b);
    if (chronological !== 0) return chronological;

    const da = distanceKmFor(a);
    const db = distanceKmFor(b);
    const aHasDistance = da !== undefined;
    const bHasDistance = db !== undefined;
    if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
    if (aHasDistance && bHasDistance && da !== db) return da - db;

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

// Phase 4.4B — the explicit, opt-in "Nearest" mode Phase 4.4's audit
// recommended (docs/PHASE_4_4_PROXIMITY_INTENT_LOCATION_UX_AUDIT.md §7/§16):
// distance ordered ahead of start time, but — critically — this comparator
// is applied to the SAME already-date-scoped pool `compareForRanking` sorts,
// BEFORE that pool is partitioned into temporal groups (Happening now /
// Starting soon / Starting today / Later today, or Morning / Afternoon /
// Evening). Group membership itself is decided entirely by each session's
// own real status/time bucket, never by array order, so sorting the pool
// with this comparator first and then applying the exact same group filters
// automatically keeps every session in its real temporal group — this
// function has no way to move a session across groups, because it never
// sees or produces group boundaries at all. This is what "group-bounded"
// means in practice: no new grouping concept, no time-window magic number,
// just a different pre-sort ahead of the same existing partition step.
//
// `date` is still checked first (matching compareForRanking) purely for
// safety on a pool that could in principle span more than one date — within
// the single-date pools this is actually ever called on, it's a no-op tie.
// Missing distance follows the identical safe policy as compareForRanking
// (never treated as 0, never hidden, sorts after real distance, falls back
// to start time then `id`) — same transitive lexicographic-tuple shape
// (date, hasDistance, distance, startMinutes, id), just distance promoted
// ahead of startMinutes in the tuple order.
export function compareNearest<T extends { date: string; startMinutes: number; id: string }>(
  distanceKmFor: (session: T) => number | undefined,
): (a: T, b: T) => number {
  return (a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;

    const da = distanceKmFor(a);
    const db = distanceKmFor(b);
    const aHasDistance = da !== undefined;
    const bHasDistance = db !== undefined;
    if (aHasDistance !== bHasDistance) return aHasDistance ? -1 : 1;
    if (aHasDistance && bHasDistance && da !== db) return da - db;

    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}
