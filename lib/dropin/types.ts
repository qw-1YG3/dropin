export type Day = "today" | "tomorrow";

export type VerificationStatus = "verified" | "unverified";

// The one attendance-related concept any current source can actually back
// up with real evidence (Phase 3.5A/3.5B) — a genuine three-way state the
// PerfectMind family exposes per session (open to register / waitlisted /
// closed), never a broader "walk-in vs. reservation" spectrum no source
// has been found to support. Left undefined for every other source family
// (Toronto, ActiveCommunities) and for any PerfectMind session whose
// button state didn't map confidently to one of these three (e.g. a
// "More Info" state with no verified meaning) — undefined here means
// "unknown," never "walk-in." See docs/PHASE_3_5B_PERFECTMIND_PRODUCTION.md
// Part 10 for why this is the smallest evidence-based addition rather than
// a general attendanceMode field.
export type RegistrationStatus = "open" | "waitlist" | "closed";

// A STABLE participation requirement — deliberately not derived from the
// volatile per-record RegistrationStatus above (Phase 3.5C). Real evidence:
// PerfectMind's own per-record BookButtonText turns out to be heavily
// time-relative (a live check of Vaughan/Markham found "More Info" — an
// ambiguous, non-actionable state — dominates every record more than 7
// days out, while "Register Now!"/"Waitlist" cluster in the 0-7 day
// window; the same occurrence flips between these as its registration
// window opens), which is exactly the kind of state DropIn's snapshot
// refresh cadence cannot keep truthful. What IS stable and refresh-cadence
// -safe is the structural fact of which mechanism a municipality's whole
// program uses to admit participants — Toronto's dataset is categorically
// the City's own "Drop-in" (walk-in) program data, distinct from its
// separately-published Registered Programs data and carrying no
// registration field of any kind; every Vaughan/Markham record lives
// inside a PerfectMind BookMe4 booking platform whose own widget labels
// its primary action "Register Now!"/"Register" for literally every
// record sampled, with zero walk-in language anywhere in source text.
// ActiveCommunities (Mississauga, Richmond Hill) has no reliable signal
// either way (Phase 3.1 found `reservation_event_type_id` is 0 for every
// event tested) and stays undefined here, same as it already does for
// RegistrationStatus. Only two values are defined because only two source
// families currently have real evidence to justify one — no
// "registration-available" or explicit "unknown" member exists merely to
// sketch out a hypothetical future value; undefined already means unknown,
// same convention as every other optional field on Session.
export type AttendanceRequirement = "pre-registration-required" | "walk-in";

// DropIn's common normalized session model — the one shape every municipal
// data source adapter (lib/dropin/sources/*) must produce. The Search Engine
// only ever operates on this; it never knows or cares which municipality or
// raw format a record came from. Only fields a source can actually verify
// are required — latitude/longitude, price, phone, officialUrl, and postal
// code are optional because most current sources (Toronto included) don't
// publish all of them, and inventing values would violate "Don't imply
// certainty when the data cannot support it."
//
// Scheduling fields support a real rolling multi-day range, not just
// today/tomorrow — `date`/`startDateTime`/`endDateTime` are the canonical
// source of truth for any date a source provides. `day` is a legacy
// convenience the current UI still reads directly; see its own comment.
export type Session = {
  id: string;
  // Stable identity of this specific dated occurrence. For every source
  // adapter today, one raw record already represents exactly one dated
  // occurrence (verified for Toronto: First Date === Last Date for all
  // 13,408 real records), so this is always equal to `id`. Kept as its own
  // field because a future source that genuinely expresses recurrence as a
  // template — one raw row producing many dated occurrences — would need
  // `id` to stay stable per raw row while this diverges per generated
  // occurrence.
  projectedOccurrenceId: string;
  // Identifies "the same recurring program" across all of its dated rows
  // (Toronto's Course_ID) — distinct from projectedOccurrenceId, which
  // identifies one specific date's occurrence of that program. Lets a
  // future UI say "this is the same drop-in, five days this week" without
  // guessing from activity+centre+time alone.
  sourceScheduleId: string;
  activity: string;
  category: string;
  // Canonical local calendar date (YYYY-MM-DD) this occurrence happens on —
  // the source of truth for scheduling, valid for any date a source
  // provides, not just today/tomorrow.
  date: string;
  dayOfWeek: string;
  // Legacy convenience classifier the current Results UI still reads
  // directly (Discovery, the Today/This Week toggle, result grouping).
  // Optional and undefined for anything beyond tomorrow rather than lying
  // about it — superseded by `date`/`startDateTime` for any range beyond
  // that. Kept only so the existing UI keeps working unchanged until a
  // future sprint rebuilds it against the real date range.
  day?: Day;
  // Live status (starting-soon / in-progress / ended) is deliberately NOT
  // stored here — it depends on "now," and a boolean baked in at fetch time
  // goes stale the moment real time moves past it while the page stays
  // open. Compute it on demand from startDateTime/endDateTime via
  // lib/dropin/time.ts's sessionStatus() instead.
  absoluteTime: string;
  startMinutes: number;
  // Local wall-clock datetimes (no UTC offset, deliberately) — the source
  // only ever expresses local time for the municipality, and every date
  // computation already in this codebase treats an unqualified
  // `YYYY-MM-DDTHH:MM:SS` string as local time (see lib/dropin/time.ts).
  startDateTime: string;
  endDateTime: string;
  centre: string;
  municipality: string;
  district: string;
  address?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  price?: string;
  // Real eligibility gate, not a nice-to-have: Toronto's own drop-in data
  // publishes an age range per course (e.g. a "60, no max" 55+ swim, or a
  // "13–15" youth-only gym slot). ageMin 0 with ageMax undefined means no
  // real restriction — the Decision Sheet omits the line entirely rather
  // than showing a meaningless "Ages 0+".
  ageMin?: number;
  ageMax?: number;
  phone?: string;
  officialUrl?: string;
  officialSource: string;
  lastUpdated: string;
  verificationStatus: VerificationStatus;
  // Source-dependent, volatile — see RegistrationStatus above. Retained
  // internally (Phase 3.5B) but deliberately NOT rendered in the UI
  // (Phase 3.5C Part 12) — DropIn's snapshot refresh cadence cannot keep an
  // "open"/"waitlist"/"closed" claim truthful between refreshes. Kept for
  // potential future internal logic only.
  registrationStatus?: RegistrationStatus;
  // The stable, user-facing participation requirement — see
  // AttendanceRequirement above. Undefined means genuinely unknown, never
  // a guess; only set where a source family has real structural evidence.
  attendanceRequirement?: AttendanceRequirement;
};
