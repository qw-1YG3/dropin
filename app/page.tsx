"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateCalendar } from "./_components/DateCalendar";
import { Sheet } from "./_components/Sheet";
import {
  ACTIVITY_ICONS,
  CalendarIcon,
  ComfortableListIcon,
  CompactListIcon,
  DirectionsIcon,
  InfoIcon,
  LinkIcon,
  LocationIcon,
  PhoneIcon,
  SearchIcon,
  ShareIcon,
} from "./_components/icons";
import { ACTIVITY_GROUPS, displayActivityName, getShortcutForActivity, SHORTCUTS } from "@/lib/dropin/activities";
import { feedbackMailtoUrl, PUBLIC_CONTACT_EMAIL, PUBLIC_FEEDBACK_EMAIL } from "@/lib/dropin/contact";
import { haversineKm, formatDistanceKm } from "@/lib/dropin/distance";
import { getDisplayDistrict } from "@/lib/dropin/districts";
import { MUNICIPALITIES } from "@/lib/dropin/municipalities";
import { parseQuery, sessionMatchesLocation, stripNearMeLanguage, type DetectedLocation } from "@/lib/dropin/search-intent";
import {
  addDays,
  clockLabel,
  compareForRanking,
  compareNearest,
  dateLabel,
  dateStripContextLabel,
  dateStripDateLabel,
  daysFromToday,
  fullDateLabel,
  isToday,
  isTomorrow,
  localMidnight,
  rollingWindowDates,
  sessionStatus,
  shortDateLabel,
  timeOfDayBucket,
  toDateKey,
  weekdayLabel,
  type SessionStatus,
  type TimeOfDay,
} from "@/lib/dropin/time";
import type { Session } from "@/lib/dropin/types";

const SUGGESTION_POOL = ["Badminton", "Pickleball", "Basketball", "Swimming", "Lane Swim", "Leisure Swim", "Yoga", "Open Gym", "Table Tennis"];

// Real, grounded examples only — every activity and district named here is
// actually supported, so the rotation never implies a search that wouldn't
// work. Static default first, so the first paint matches what screen
// readers get from the real `placeholder` attribute underneath.
const PLACEHOLDER_ROTATION = [
  "Search activities, community centres or places",
  "Search badminton",
  "Search swimming near you",
  "Search yoga in Scarborough",
  "Search North York community centres",
];

// Today is split by real start time, not a fixed label — "later" means
// after 5pm, a simple, statable threshold rather than an arbitrary feel.
// The same boundary defines the Evening time-of-day bucket (see
// lib/dropin/time.ts's timeOfDayBucket), so "Later today" and "Evening"
// never disagree about what counts as evening.
const LATER_TODAY_THRESHOLD_MINUTES = 17 * 60;

const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

// Derived from the real registry, never hardcoded — this used to name
// "Toronto" specifically in both the not-yet-available fallback message and
// the About DropIn copy, which silently became wrong the moment a second
// municipality went live (Phase 3.2, Part 10). Module-level since
// MUNICIPALITIES is static; recomputing per render would be wasted work for
// a value that can't change during the page's lifetime.
const AVAILABLE_MUNICIPALITY_NAMES = MUNICIPALITIES.filter((m) => m.status === "available").map((m) => m.name);
const AVAILABLE_MUNICIPALITIES_LABEL = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
  AVAILABLE_MUNICIPALITY_NAMES,
);

// The one place a session's live status is derived from its real
// start/end time — every caller that needs to know "is this happening now"
// computes it here rather than trusting a stored field, so it can never go
// stale while the page stays open.
function computeStatus(s: Session, liveNow: Date): SessionStatus {
  return sessionStatus(new Date(s.startDateTime), new Date(s.endDateTime), liveNow);
}

// Status-aware, not just date-aware: an in-progress session reads
// "Happening now · Until [end]" — never "Happening soon," which would be
// factually wrong for something already running. A not-yet-started session
// inside the near-term threshold reads "Happening soon"; anything else
// falls back to the real calendar date (dateLabel), never the legacy `day`
// field, which is undefined past tomorrow.
function timeLabel(s: Session, status: SessionStatus, now: Date) {
  if (status === "in-progress") return `Happening now · Until ${clockLabel(new Date(s.endDateTime))}`;
  if (status === "starting-soon") return `Happening soon · ${s.absoluteTime}`;
  return `${dateLabel(s.date, now)} · ${s.absoluteTime}`;
}

// Share always renders; Website/Call are conditional on real data. The grid
// must match however many actually render — a hardcoded column count leaves
// a visible empty gap whenever a session is missing phone or officialUrl.
function secondaryActionCount(s: Session) {
  return 1 + (s.officialUrl ? 1 : 0) + (s.phone ? 1 : 0);
}

// Phase 4.1A — several source systems encode "no meaningful upper age
// limit" as a specific high numeric sentinel rather than leaving ageMax
// undefined: Toronto's own raw open data literally publishes "Age Max": 98
// for general-audience programs (Roller Skating ageMin 8, Drag Open Studio
// ageMin 13), while every genuine bounded adult range in that same dataset
// tops out at 64 (Volleyball, ageMin 19). The ActiveCommunities/PerfectMind
// family (Mississauga, Richmond Hill, Aurora, Vaughan, Markham, Newmarket)
// shows the identical pattern one step higher, at 99 (Mississauga also 100)
// against adult drop-in activities (Adult Pickleball, Adult Badminton,
// Group Fitness) — again with a clean, evidence-confirmed gap to the next
// real bounded value in every one of those datasets. This is a
// presentation-only reinterpretation — source/canonical ageMax is never
// modified — see docs/PHASE_4_1A_AGE_DISPLAY_NORMALIZATION.md for the full
// per-municipality audit.
const OPEN_ENDED_AGE_MAX_THRESHOLD = 98;

// A real eligibility gate, not a nice-to-have — but "0 to no max" means the
// source data simply isn't restricting this session, so it renders as
// nothing rather than a meaningless "Ages 0+".
function ageRestrictionLabel(s: Session): string | undefined {
  const min = s.ageMin ?? 0;
  const max = s.ageMax !== undefined && s.ageMax >= OPEN_ENDED_AGE_MAX_THRESHOLD ? undefined : s.ageMax;
  if (min <= 0 && max === undefined) return undefined;
  if (max === undefined) return `Ages ${min}+`;
  if (min <= 0) return `Up to age ${max}`;
  return `Ages ${min}–${max}`;
}

// Phase 3.5C — the one stable, decision-relevant fact about how a session
// admits participants (see Session.attendanceRequirement's own comment for
// the evidence). Deliberately renders nothing for `undefined` (unknown) —
// never a guess, never a "Check details" filler line standing in for
// missing information, same discipline as ageRestrictionLabel above.
function attendanceRequirementLabel(s: Session): string | undefined {
  if (s.attendanceRequirement === "pre-registration-required") return "Pre-registration required";
  if (s.attendanceRequirement === "walk-in") return "Walk-in";
  return undefined;
}

// Two real CTA cases, per docs/PHASE_3_5C_ATTENDANCE_OFFICIAL_ACTION.md —
// never "Join waitlist"/"Book now"/spots-remaining language, which would
// imply DropIn has real-time booking authority it doesn't have.
//   "Register"           — attendance is known to require registration
//                           (currently: PerfectMind/Vaughan/Markham)
//   "Official listing"   — covers both the "known NOT to require it"
//                           case (currently unused — no source both has a
//                           URL and confirmed walk-in status yet) and the
//                           "genuinely unknown" case (currently:
//                           ActiveCommunities/Mississauga/Richmond Hill) —
//                           collapsed to one label (Decision Sheet polish
//                           pass) since neither case can honestly claim
//                           "Register," and distinguishing "the listing is
//                           definitely not registration" from "we don't
//                           know" isn't a distinction the label itself
//                           needs to carry.
function officialActionLabel(s: Session): string | undefined {
  if (!s.officialUrl) return undefined;
  if (s.attendanceRequirement === "pre-registration-required") return "Register";
  return "Official listing";
}

// Shared by the per-session Decision Sheet trust line and the aggregate
// Results meta line — same relative-freshness math, one place to keep it
// correct.
function daysAgoLabel(raw: string): string {
  const updated = new Date(`${raw}T00:00:00`);
  const days = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

// Prefers real coordinates when a future source actually has them; Toronto
// Open Data doesn't, so today this always falls back to a text-address
// search query — still a real, working Maps link rather than a stub.
function directionsUrl(s: Session): string {
  if (s.latitude !== undefined && s.longitude !== undefined) {
    return `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`;
  }
  const parts = [s.address, s.centre, s.municipality].filter(Boolean);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(", "))}`;
}

// Phase 4.2 — real user geolocation, kept entirely separate from
// persistentLocation/locationOverride above: those represent an explicit
// TEXT search location ("Mississauga," a postal code, a centre name) and
// drive actual result filtering; UserLocation represents the device's real
// coordinate and is used ONLY to compute a display-only distance for
// already-filtered results (Part 12's "explicit query > implicit device
// location" principle holds by construction — this state is never read by
// sessionMatchesLocation or any filtering logic, only by distance display).
export type UserLocationStatus =
  | "idle" // not requested yet — the default, and the only state before any user action
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable" // position genuinely couldn't be determined (no signal, malformed result)
  | "timeout"
  | "unsupported"; // navigator.geolocation doesn't exist in this browser

export type UserLocation = {
  status: UserLocationStatus;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timestamp?: number;
};

function isSaneCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// One-time position request (Part 2) — navigator.geolocation.getCurrentPosition,
// never watchPosition: DropIn only ever needs "roughly how far is this
// facility right now," not continuous tracking, and a one-shot request is
// both the simplest and the most private option that satisfies the
// feature. enableHighAccuracy is deliberately false — GPS-level (metre)
// precision is unnecessary and slower/more battery-hungry than a
// network/wifi-based fix for comparing distances at the kilometre scale
// real facility spacing operates at (Part 2's "minimum accuracy needed").
// Nothing here fires until requestLocation() is called from an explicit
// user action — no effect requests location on mount.
function useUserLocation() {
  const [userLocation, setUserLocation] = useState<UserLocation>({ status: "idle" });

  // Phase 4.4B — an optional `onResolved` lets a caller (Nearest) react to
  // this SAME one-time request's real outcome without a separate effect
  // watching `userLocation.status`: it's called directly from the native
  // async geolocation callbacks below, exactly where `setUserLocation`
  // already is, never from a useEffect. The header pill's own call site
  // passes no callback and is completely unaffected — this is still the one
  // navigator.geolocation.getCurrentPosition call Phase 4.2 established, not
  // a second geolocation implementation.
  const requestLocation = useCallback((onResolved?: (status: UserLocationStatus) => void) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setUserLocation({ status: "unsupported" });
      onResolved?.("unsupported");
      return;
    }
    setUserLocation({ status: "requesting" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!isSaneCoordinate(latitude, longitude)) {
          setUserLocation({ status: "unavailable" });
          onResolved?.("unavailable");
          return;
        }
        setUserLocation({ status: "granted", latitude, longitude, accuracy, timestamp: position.timestamp });
        onResolved?.("granted");
      },
      (error) => {
        let status: UserLocationStatus = "unavailable";
        if (error.code === error.PERMISSION_DENIED) status = "denied";
        else if (error.code === error.TIMEOUT) status = "timeout";
        setUserLocation({ status });
        onResolved?.(status);
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        // A cached fix up to 5 minutes old is fine for facility-distance
        // purposes and avoids forcing a fresh GPS/network fix on every tap
        // — still a one-time read, not tracking.
        maximumAge: 5 * 60 * 1000,
      },
    );
  }, []);

  return { userLocation, requestLocation };
}

// The header pill's visible text — an explicit search location always wins
// (Part 11/12: "pickleball mississauga" and real Near Me stay conceptually
// distinct, and an explicit query is never overridden by device location).
// "Near me" is used only once geolocation has actually succeeded — never a
// guessed neighbourhood name, since that would need reverse-geocoding
// infrastructure this phase deliberately doesn't add (Part 11).
function locationPillLabel(effectiveLocation: DetectedLocation | undefined, userLocation: UserLocation): string {
  if (effectiveLocation) return effectiveLocation.label;
  if (userLocation.status === "requesting") return "Locating…";
  if (userLocation.status === "granted") return "Near me";
  return "Near you";
}

// The pill's action is always the same (request/refresh device location)
// regardless of what text it's currently showing, so the accessible name
// describes that action, not the transient label — calm, non-technical
// language throughout, never a raw browser error (Part 3).
function locationPillAriaLabel(userLocation: UserLocation): string {
  if (userLocation.status === "requesting") return "Getting your location";
  if (userLocation.status === "granted") return "Using your location for distance — tap to refresh";
  if (userLocation.status === "denied") return "Location access denied — tap to try again";
  if (userLocation.status === "unsupported") return "Location isn't available in this browser";
  return "Use your location to see distance to activities";
}

// Shared by every horizontally-scrolling chip/date row that can overflow —
// shows a trailing fade only when there's real content past the visible
// edge, and hides it again once scrolled to the end or if everything
// already fits, so it never reads as a decorative flourish sitting over a
// row that has nothing more to show. A 1px tolerance absorbs subpixel
// rounding so the fade doesn't flicker right at the boundary.
function useTrailingScrollFade<T extends HTMLElement>() {
  // A callback ref, not useRef + a mount-only effect: the scroll container
  // this attaches to (date strip, activity subtype row) can mount well
  // after this component's own first render — Results doesn't exist in the
  // DOM until a search commits — so an effect with `[]` deps would run once
  // while `ref.current` is still null and then never re-check it. Storing
  // the node in state instead means the listener-attaching effect below
  // re-runs every time the underlying element actually changes (mounts,
  // unmounts, or gets replaced), not just once at component mount.
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    if (!el) return;

    const update = () => {
      const hasOverflow = el.scrollWidth - el.clientWidth > 1;
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
      setShowFade(hasOverflow && !atEnd);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    // Fonts settling in after first paint can change chip widths without
    // resizing the container itself — a load-time recheck catches that.
    window.addEventListener("load", update);
    return () => {
      el.removeEventListener("scroll", update);
      resizeObserver.disconnect();
      window.removeEventListener("load", update);
    };
  }, [el]);

  return { ref, showFade };
}

type Density = "comfortable" | "compact";

// Compact keeps every field Comfortable shows (activity, time, centre,
// price) — it's not a reduced-information view, just a tighter one:
// activity+price share a line, time+centre share a line. Same card
// component, same click target, same data — only the internal layout and
// type scale shrink, per "reduce height significantly, preserve
// readability, one-column scrolling" rather than a grid.
function SessionCard({
  s,
  now,
  liveNow,
  onSelect,
  density = "comfortable",
  delayMs = 0,
}: {
  s: Session;
  now: Date;
  liveNow: Date;
  onSelect: (s: Session) => void;
  density?: Density;
  delayMs?: number;
}) {
  const enterStyle = { animationDelay: `${delayMs}ms` } as React.CSSProperties;
  // Price and age restriction are both short eligibility facts, so they
  // share one slot rather than each claiming their own — the same
  // middot-join treatment the Decision Sheet already uses for this pairing.
  const eligibility = [s.price, ageRestrictionLabel(s)].filter(Boolean).join(" · ");
  const status = computeStatus(s, liveNow);
  // Both "starting soon" and "already in progress" are time-sensitive,
  // actionable-now states — they share the same green dot/text treatment;
  // only the wording (via timeLabel) tells them apart.
  const isLive = status === "starting-soon" || status === "in-progress";

  if (density === "compact") {
    return (
      <button
        type="button"
        onClick={() => onSelect(s)}
        style={enterStyle}
        className="w-full rounded-xl border border-border/70 bg-white px-4 py-2.5 text-left shadow-[0_1px_2px_rgba(47,43,39,0.04)] transition-all duration-200 ease-out hover:-translate-y-px hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-[0.99] motion-safe:animate-[cardIn_220ms_ease-out_both]"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[15px] font-bold leading-tight text-text-primary">{displayActivityName(s)}</p>
          {eligibility && <span className="flex-shrink-0 text-xs text-text-secondary">{eligibility}</span>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-secondary">
          {isLive && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage-text" aria-hidden="true" />}
          <span className={isLive ? "font-semibold text-sage-text" : ""}>{timeLabel(s, status, now)}</span>
          ·
          <span className="truncate">{s.centre}</span>
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(s)}
      style={enterStyle}
      className="w-full rounded-2xl border border-border/70 bg-white p-5 text-left shadow-[0_1px_2px_rgba(47,43,39,0.04)] transition-all duration-200 ease-out hover:-translate-y-px hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-[0.99] motion-safe:animate-[cardIn_220ms_ease-out_both]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-bold leading-tight text-text-primary">{displayActivityName(s)}</p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-sm ${
              isLive ? "font-semibold text-sage-text" : "font-medium text-text-secondary"
            }`}
          >
            {isLive && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage-text" aria-hidden="true" />}
            {timeLabel(s, status, now)}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {s.centre}
            {s.distanceKm !== undefined && ` · ${s.distanceKm} km`}
          </p>
        </div>
        {eligibility && <span className="flex-shrink-0 text-sm text-text-secondary">{eligibility}</span>}
      </div>
    </button>
  );
}

// Mirrors whichever SessionCard shape is about to load in — same
// dimensions, same corner radius, same shadow — so the loading state
// previews the real card's height instead of always showing the taller
// Comfortable silhouette regardless of the reader's chosen density.
function SkeletonCard({ density = "comfortable" }: { density?: Density }) {
  if (density === "compact") {
    return (
      <div
        className="rounded-xl border border-border/70 bg-white px-4 py-2.5 shadow-[0_1px_2px_rgba(47,43,39,0.04)] motion-safe:animate-[skeletonPulse_1.2s_ease-in-out_infinite]"
        aria-hidden="true"
      >
        <div className="h-3.5 w-24 rounded bg-border" />
        <div className="mt-1.5 h-3 w-36 rounded bg-hover-surface" />
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-border/70 bg-white p-5 shadow-[0_1px_2px_rgba(47,43,39,0.04)] motion-safe:animate-[skeletonPulse_1.2s_ease-in-out_infinite]"
      aria-hidden="true"
    >
      <div className="h-4 w-28 rounded bg-border" />
      <div className="mt-2.5 h-3.5 w-40 rounded bg-hover-surface" />
      <div className="mt-2.5 h-3 w-48 rounded bg-hover-surface" />
    </div>
  );
}

export default function SearchSurface() {
  const [surfaceState, setSurfaceState] = useState<"discovery" | "results">("discovery");
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");
  // A stable "now" for the whole session — computed once at mount, same
  // precedent as the header's own todayLabel below, rather than re-evaluated
  // on every render (which would make the date strip's window silently
  // shift if the tab were left open across a real midnight).
  const now = useMemo(() => new Date(), []);
  const todayDateKey = useMemo(() => toDateKey(now), [now]);
  // Separate from the stable `now` above on purpose: session status
  // (starting soon / in progress / ended) needs to keep advancing with real
  // time for as long as the page stays open, while date identity ("today")
  // deliberately does not — ticking `now` itself would risk the rolling
  // window's date range shifting mid-session. 30s is frequent enough that a
  // status transition never reads stale for long, without re-rendering the
  // whole results list constantly.
  const [liveNow, setLiveNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayDateKey);
  const [timeOfDayFilter, setTimeOfDayFilter] = useState<TimeOfDay | "all">("all");
  const [discoveryFreeOnly, setDiscoveryFreeOnly] = useState(false);

  // The 7-day quick-nav strip's anchor — normally "today," matching the
  // original always-starts-at-today behaviour, but the strip is a
  // navigation convenience, not the schedule boundary: when the Calendar
  // sends `selectedDate` somewhere the currently-shown window can't
  // display, this re-centers so the selection stays visible rather than
  // leaving the strip stranded on its original Aug 7-13-style window.
  // Ordinary strip clicks never touch this — the clicked date is always
  // already inside `rollingDates` by construction, so the effect below is a
  // no-op — only a Calendar jump (or returning from one) triggers a
  // recompute, which is exactly the one case that needs it.
  const [stripAnchorDate, setStripAnchorDate] = useState<string>(todayDateKey);
  const rollingDates = useMemo(() => rollingWindowDates(localMidnight(stripAnchorDate), 7), [stripAnchorDate]);
  useEffect(() => {
    if (rollingDates.includes(selectedDate)) return;
    const diff = daysFromToday(selectedDate, now);
    // Back within (or returning to) the original window snaps to the
    // canonical today-anchored strip rather than some slightly-off
    // recentring; only a genuinely far selection gets recentred around
    // itself, with two days of leading context so it doesn't land as the
    // very first visible date.
    const nextAnchor = diff >= 0 && diff < 7 ? todayDateKey : toDateKey(addDays(localMidnight(selectedDate), -2));
    setStripAnchorDate(nextAnchor);
  }, [selectedDate, rollingDates, now, todayDateKey]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const discoveryCarouselScroll = useTrailingScrollFade<HTMLDivElement>();
  const dateStripScroll = useTrailingScrollFade<HTMLDivElement>();
  const subtypeScroll = useTrailingScrollFade<HTMLDivElement>();
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  // Transient "Copied" confirmation on the Share action when the Web Share
  // API isn't available (most desktop browsers) — reverts on its own, and
  // resets immediately if the sheet closes so it never lingers into the
  // next session someone opens.
  const [shareCopied, setShareCopied] = useState(false);
  const shareResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  // Launch Readiness 1B — Privacy is its own Sheet instance rather than a
  // section inside About: reuses the exact same overlay/motion/accessibility
  // mechanism (smallest architectural change per that phase's own Part 14
  // instruction) while keeping About from growing past a comfortable length.
  // Only one of the two is ever open at a time (see the "Privacy" link's
  // onClick below), matching how every other sheet in this app already
  // behaves — never a stacked/simultaneous-sheets pattern.
  const [privacySheetOpen, setPrivacySheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  // Persistent location context (set only by a pure-location search) vs. a
  // one-time override (set by a mixed activity+location search). The pill
  // always displays the effective one; neither is ever typed into directly.
  const [persistentLocation, setPersistentLocation] = useState<DetectedLocation | undefined>(undefined);
  const [locationOverride, setLocationOverride] = useState<DetectedLocation | undefined>(undefined);
  // Real device geolocation (Phase 4.2) — entirely separate from the two
  // states above; see useUserLocation's own comment for why it never
  // touches search filtering.
  const { userLocation, requestLocation } = useUserLocation();
  // Phase 4.4B — the explicit, opt-in "Nearest" ranking mode. Always starts
  // false on a fresh session (Part 13 — real location already being granted
  // must never silently switch ranking; only an explicit tap does).
  // `awaitingNearestLocation` distinguishes a location request the user
  // fired FROM the Nearest control from one fired from the header pill —
  // only the former should auto-activate Nearest once granted; the header
  // pill refreshing location on its own must never silently turn Nearest on.
  const [nearestMode, setNearestMode] = useState(false);
  const [awaitingNearestLocation, setAwaitingNearestLocation] = useState(false);
  const [queryMiss, setQueryMiss] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  // Results-only presentation choice (Discovery's highlights always stay
  // Comfortable) — remembered across sessions since it's a stable reading
  // preference, not a per-search setting.
  const [density, setDensity] = useState<Density>("comfortable");
  const [pillPulsing, setPillPulsing] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const directionsRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("dropin-results-density");
    if (stored === "comfortable" || stored === "compact") setDensity(stored);
  }, []);

  function setDensityPersisted(next: Density) {
    setDensity(next);
    window.localStorage.setItem("dropin-results-density", next);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data: { sessions: Session[] }) => {
        if (cancelled) return;
        setSessions(data.sessions);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setLiveNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Rotating placeholder — only cycles while the box is empty and unfocused,
  // so it never competes with something the user is actually doing.
  useEffect(() => {
    if (query !== "" || inputFocused) return;
    const timer = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_ROTATION.length);
    }, 3200);
    return () => clearInterval(timer);
  }, [query, inputFocused]);

  const suggestions = useMemo(() => {
    if (!suggestionsOpen || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    return SUGGESTION_POOL.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [query, suggestionsOpen]);

  const effectiveLocation = locationOverride ?? persistentLocation;

  // A brief pulse confirms "the context just updated" without a separate
  // label — fires only on genuine changes, not on mount.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    setPillPulsing(true);
    const timer = setTimeout(() => setPillPulsing(false), 900);
    return () => clearTimeout(timer);
  }, [effectiveLocation?.label]);

  // Search suggestions — keeps rendering the last non-empty list for a beat
  // after it empties out (query cleared, committed, or Escape pressed) so
  // the dropdown can play a reverse of its own entrance instead of
  // disappearing mid-frame.
  const [displaySuggestions, setDisplaySuggestions] = useState<string[]>([]);
  const [suggestionsClosing, setSuggestionsClosing] = useState(false);
  useEffect(() => {
    if (suggestions.length > 0) {
      setDisplaySuggestions(suggestions);
      setSuggestionsClosing(false);
      return;
    }
    if (displaySuggestions.length === 0) return;
    setSuggestionsClosing(true);
    const timer = setTimeout(() => {
      setDisplaySuggestions([]);
      setSuggestionsClosing(false);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions]);

  // A quick, opacity-only pulse whenever density or the active filter/time
  // window changes. The cards themselves swap instantly — same as before,
  // their own data and keys are untouched — this only softens how that swap
  // reads visually, so switching density or narrowing a filter feels like
  // the same list settling rather than a fresh page. Alternates between two
  // identically-defined keyframe names so the animation reliably restarts
  // without remounting (and therefore without disturbing) the cards
  // underneath.
  const [resultsPulse, setResultsPulse] = useState<0 | 1>(0);
  const isFirstResultsRender = useRef(true);
  useEffect(() => {
    if (isFirstResultsRender.current) {
      isFirstResultsRender.current = false;
      return;
    }
    setResultsPulse((v) => (v === 0 ? 1 : 0));
  }, [density, activeFilter, selectedDate, timeOfDayFilter]);

  const [discoveryPulse, setDiscoveryPulse] = useState<0 | 1>(0);
  const isFirstDiscoveryRender = useRef(true);
  useEffect(() => {
    if (isFirstDiscoveryRender.current) {
      isFirstDiscoveryRender.current = false;
      return;
    }
    setDiscoveryPulse((v) => (v === 0 ? 1 : 0));
  }, [discoveryFreeOnly]);

  // Discovery <-> Results handoff — a short, fast fade-out of whatever's
  // currently on screen, immediately followed by the incoming view's own
  // entrance, so the switch reads as one continuous change of state rather
  // than the old screen vanishing and an unrelated new one appearing.
  const [displaySurfaceState, setDisplaySurfaceState] = useState(surfaceState);
  const [surfaceExiting, setSurfaceExiting] = useState(false);
  useEffect(() => {
    if (surfaceState === displaySurfaceState) return;
    setSurfaceExiting(true);
    const timer = setTimeout(() => {
      setDisplaySurfaceState(surfaceState);
      setSurfaceExiting(false);
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceState]);

  // A session that has ended should not appear as a currently actionable
  // session — the adapter already excludes sessions ended as of the fetch,
  // but the client can hold that fetch open far longer than that, so this
  // re-checks against `liveNow` on every tick rather than only once at
  // fetch time. Centralized here so every downstream list (Discovery,
  // Results) inherits the same live behaviour instead of each filtering it
  // separately.
  const liveSessions = useMemo(
    () => sessions.filter((s) => computeStatus(s, liveNow) !== "ended"),
    [sessions, liveNow],
  );

  // The Calendar's real upper bound — computed from whatever the fetch
  // actually returned, never assumed. The API route now asks each adapter
  // for its own genuine availability window rather than a fixed 7 days (see
  // app/api/sessions/route.ts), so the furthest real `date` present in
  // `sessions` *is* the source's honest boundary. Falls back to today so the
  // Calendar has a sane (if empty) range before the fetch resolves.
  const maxAvailableDateKey = useMemo(
    () => sessions.reduce((max, s) => (s.date > max ? s.date : max), todayDateKey),
    [sessions, todayDateKey],
  );

  // Phase 4.2, Part 7/9/20 — a distance getter, not a precomputed map over
  // all ~46k sessions: recomputed only when userLocation itself changes
  // (not on every render/search/filter change), and even then only ever
  // actually called for whatever's currently being rendered (Discovery's ~5
  // highlights, one page of Results) via the two SessionCard.map() call
  // sites below — never the full dataset. Reuses Session.distanceKm, the
  // field the Result Card already had a conditional rendering hook for
  // (Part 9) — this function's only job is deciding what value that field
  // should hold for a given session right now, never touching layout.
  const distanceKmFor = useCallback(
    (s: Session): number | undefined => {
      if (userLocation.status !== "granted" || userLocation.latitude === undefined || userLocation.longitude === undefined) return undefined;
      if (s.latitude === undefined || s.longitude === undefined) return undefined;
      return formatDistanceKm(haversineKm(userLocation.latitude, userLocation.longitude, s.latitude, s.longitude));
    },
    [userLocation.status, userLocation.latitude, userLocation.longitude],
  );

  // Phase 4.4B, Part 5 — Nearest reuses requestLocation() exactly as-is (no
  // second geolocation implementation). If a location was already granted
  // (e.g. via the header pill), Nearest activates immediately with no new
  // prompt. Otherwise this fires the one real request and passes a
  // completion callback: on success it activates Nearest, on
  // denial/unavailability/timeout/unsupported it silently leaves Nearest
  // off — never a crash, never a retry loop, never activating on anything
  // but a real granted position. The callback fires from inside
  // useUserLocation's own native geolocation callbacks, not from a
  // useEffect watching state — avoiding an extra render cycle.
  function handleNearestClick() {
    if (nearestMode) {
      setNearestMode(false);
      return;
    }
    if (awaitingNearestLocation) return;
    if (userLocation.status === "granted") {
      setNearestMode(true);
      return;
    }
    setAwaitingNearestLocation(true);
    requestLocation((status) => {
      setAwaitingNearestLocation(false);
      if (status === "granted") setNearestMode(true);
    });
  }

  // Nearest only ever has a real effect once real coordinates exist —
  // mirrors distanceKmFor's own gate, so the control can never claim to be
  // active while doing nothing.
  const nearestActive = nearestMode && userLocation.status === "granted";

  function nearestControlAriaLabel(): string {
    if (awaitingNearestLocation && userLocation.status === "requesting") return "Getting your location to sort nearest first";
    if (nearestActive) return "Nearest first — sorted by distance within each time group, tap to turn off";
    if (userLocation.status === "denied") return "Sort nearest first — location access denied, tap to try again";
    return "Sort nearest first, within each time group";
  }

  const discoveryHighlights = useMemo(() => {
    // Exact date match, not the legacy `day` field — Discovery intentionally
    // stays a today-only feed even though `sessions` itself now spans the
    // full rolling 7-day window Results uses.
    let pool = liveSessions.filter((s) => s.date === todayDateKey);
    if (persistentLocation) pool = pool.filter((s) => sessionMatchesLocation(s, persistentLocation));
    if (discoveryFreeOnly) return pool.filter((s) => s.price === "Free");

    // Diversify across districts and activities so Discovery reads as a
    // cross-city sample rather than repeating whichever centre happens to
    // have the most listings — sessions already happening now or starting
    // soon still surface first within that diverse set.
    const statusRank = (s: Session) => {
      const status = computeStatus(s, liveNow);
      return status === "in-progress" ? 2 : status === "starting-soon" ? 1 : 0;
    };
    const ranked = [...pool].sort((a, b) => statusRank(b) - statusRank(a));
    const seenDistricts = new Set<string>();
    const seenActivities = new Set<string>();
    const diverse: Session[] = [];
    for (const s of ranked) {
      const district = getDisplayDistrict(s.district);
      if (seenDistricts.has(district) && seenActivities.has(s.activity)) continue;
      diverse.push(s);
      seenDistricts.add(district);
      seenActivities.add(s.activity);
      if (diverse.length === 5) break;
    }
    const target = Math.min(5, ranked.length);
    for (const s of ranked) {
      if (diverse.length >= target) break;
      if (!diverse.includes(s)) diverse.push(s);
    }
    return diverse;
  }, [liveSessions, discoveryFreeOnly, persistentLocation, todayDateKey, liveNow]);

  const parsed = useMemo(() => parseQuery(committedQuery, sessions), [committedQuery, sessions]);
  const matchedActivities = parsed.activities;

  const baseResults = useMemo(() => {
    return liveSessions.filter((s) => {
      if (matchedActivities.length > 0 && !matchedActivities.includes(s.activity)) return false;
      if (effectiveLocation && !sessionMatchesLocation(s, effectiveLocation)) return false;
      return true;
    });
  }, [liveSessions, matchedActivities, effectiveLocation]);

  // Filter chips reflect activities actually present in the current
  // activity+location scope, not just the raw parsed match — this way a
  // pure-location search ("North York") still offers useful chips to
  // refine by, instead of only ever showing "All". Built from the
  // normalized display name (Phase 3.6C), not the raw source title —
  // otherwise cross-municipality variants of the same activity (e.g.
  // Vaughan's "Adult Pickleball" vs. Toronto's "Pickleball") would each
  // claim their own redundant chip instead of one shared "Pickleball" chip,
  // and clicking one would show a card titled differently than the chip
  // that was clicked.
  const filterChipActivities = useMemo(
    () => Array.from(new Set(baseResults.map((s) => displayActivityName(s)))),
    [baseResults],
  );

  // The date-scoped pool before the Time of Day refinement is applied — used
  // both to produce the final filtered results and to compute which time-of-
  // day chips are actually worth offering (see timeOfDayOptions below).
  const resultsForSelectedDate = useMemo(() => {
    return baseResults.filter((s) => {
      if (s.date !== selectedDate) return false;
      if (activeFilter !== "All" && displayActivityName(s) !== activeFilter) return false;
      return true;
    });
  }, [baseResults, activeFilter, selectedDate]);

  // Only offer a time-of-day chip when it would actually return something —
  // same "never a dead-end filter" principle already applied to the activity
  // chips above (filterChipActivities).
  const timeOfDayOptions = useMemo(() => {
    const present = new Set(resultsForSelectedDate.map((s) => timeOfDayBucket(s.startMinutes)));
    return (["morning", "afternoon", "evening"] as const).filter((t) => present.has(t));
  }, [resultsForSelectedDate]);

  const resultsFiltered = useMemo(() => {
    if (timeOfDayFilter === "all") return resultsForSelectedDate;
    return resultsForSelectedDate.filter((s) => timeOfDayBucket(s.startMinutes) === timeOfDayFilter);
  }, [resultsForSelectedDate, timeOfDayFilter]);

  // A single, consistently-cased noun for whatever activity scope is
  // currently active — used everywhere the Results state needs to name it
  // in a sentence, instead of each spot independently reaching for the raw
  // (possibly lowercase, possibly multi-word) query text. An active filter
  // chip narrows the scope further, so it takes priority over the broader
  // matched-activity set; a multi-activity match (e.g. "swim" resolving to
  // several real course titles) collapses to its shortcut label ("Swimming")
  // rather than every individual title. `activeFilter` is already a
  // normalized display name (filterChipActivities is built from
  // displayActivityName), so it needs no further treatment; the two
  // fallback branches below independently route through
  // displayActivityName too (Phase 3.6C) — without it, a query that
  // resolves to exactly one raw title, or to several with no pre-existing
  // shortcut label (Volleyball/Skating/Group Fitness have none), would show
  // a raw source title here ("Drop-In Group Fitness: Older Adult") even
  // though every card/chip on the same screen already shows the
  // normalized one.
  const activityDisplayLabel = useMemo(() => {
    if (activeFilter !== "All") return activeFilter;
    if (matchedActivities.length === 1) {
      const representative = sessions.find((s) => s.activity === matchedActivities[0]);
      return representative ? displayActivityName(representative) : matchedActivities[0];
    }
    if (matchedActivities.length > 1) {
      const shortcut = getShortcutForActivity(matchedActivities[0]);
      if (shortcut) return shortcut;
      const representative = sessions.find((s) => s.activity === matchedActivities[0]);
      return representative ? displayActivityName(representative) : matchedActivities[0];
    }
    return undefined;
  }, [activeFilter, matchedActivities, sessions]);

  // Freshness of what's actually on screen, not an arbitrary session from
  // the whole combined pool. Phase 3.3 gave Toronto, Mississauga, and
  // Richmond Hill independently-refreshed snapshots (recommended on
  // different cadences — see docs/PHASE_3_3_DATA_REFRESH_SNAPSHOT_PIPELINE.md
  // Part 16), so `sessions[0]?.lastUpdated` stopped being a safe stand-in
  // the moment more than one municipality could exist: it would silently
  // show whichever municipality happens to sort first in the combined
  // array, regardless of what the user is actually looking at. Scoped to
  // resultsFiltered (the currently-displayed set) and, when that set spans
  // sources with different freshness, takes the oldest one — "this view is
  // only as fresh as its stalest contributor" is the honest claim,
  // matching the existing "never imply certainty the data can't support"
  // principle rather than picking whichever value looks best. Computed
  // relative to "now" rather than a fixed string, so it stays true
  // regardless of when the page is loaded.
  const lastUpdatedLabel = useMemo(() => {
    if (resultsFiltered.length === 0) return undefined;
    const oldest = resultsFiltered.reduce((min, s) => (s.lastUpdated < min ? s.lastUpdated : min), resultsFiltered[0].lastUpdated);
    return daysAgoLabel(oldest);
  }, [resultsFiltered]);

  // Grouping depends on which date is selected, not a fixed shape: live
  // status (Happening now / Starting soon / Starting today / Later today)
  // is only ever meaningful for the currently-selected date being *today*
  // — a future date's sessions can't structurally be "happening now" or
  // "starting soon" (their start time is more than an hour from `liveNow`
  // by construction). Future dates use neutral Morning/Afternoon/Evening
  // grouping instead. When the Time of Day chip has already narrowed to one
  // bucket, regrouping by that same dimension would just repeat the active
  // chip as a redundant heading, so that case collapses to one flat,
  // chronologically-sorted list instead.
  //
  // Phase 4.3B — sessions are sorted with compareForRanking, not the older
  // date/startMinutes-only compareChronologically: chronological order is
  // still fully authoritative (a later session can never outrank an earlier
  // one), but an exact date+startMinutes tie now breaks on real distance
  // when userLocation is granted, per Phase 4.3A's real-data audit. With no
  // granted location, distanceKmFor returns undefined for every session, so
  // every tie's distance step is a no-op and this is byte-for-byte the old
  // chronological-then-arbitrary order, except ties now end on a
  // deterministic `id` key instead of incidental snapshot/municipality
  // array order (see compareForRanking's own comment in lib/dropin/time.ts).
  //
  // Phase 4.4B — when Nearest is active, this pre-sort swaps to
  // compareNearest (distance ahead of start time) instead. Critically, this
  // is still the SAME pre-sort-then-partition shape: the group filters below
  // are completely unchanged and decide membership purely from each
  // session's own real status/time bucket, never from array order — so
  // swapping the comparator can only ever reorder sessions WITHIN a group,
  // never move one across a group boundary (Phase 4.4's Part 1 guardrail,
  // achieved by construction, not a separate check).
  const resultsGrouped = useMemo(() => {
    const comparator = nearestActive ? compareNearest(distanceKmFor) : compareForRanking(distanceKmFor);
    const sorted = [...resultsFiltered].sort(comparator);
    const isTodaySelected = isToday(selectedDate, now);

    if (isTodaySelected) {
      const statusOf = (s: Session) => computeStatus(s, liveNow);
      const groups = [
        { key: "happeningNow", label: "Happening now", sessions: sorted.filter((s) => statusOf(s) === "in-progress") },
        { key: "startingSoon", label: "Starting soon", sessions: sorted.filter((s) => statusOf(s) === "starting-soon") },
        {
          key: "startingToday",
          label: "Starting today",
          sessions: sorted.filter((s) => statusOf(s) === "later" && s.startMinutes < LATER_TODAY_THRESHOLD_MINUTES),
        },
        {
          key: "laterToday",
          label: "Later today",
          sessions: sorted.filter((s) => statusOf(s) === "later" && s.startMinutes >= LATER_TODAY_THRESHOLD_MINUTES),
        },
      ];
      return groups.filter((g) => g.sessions.length > 0);
    }

    if (timeOfDayFilter !== "all") {
      return sorted.length > 0 ? [{ key: "all", label: "", sessions: sorted }] : [];
    }

    const groups = (["morning", "afternoon", "evening"] as const).map((t) => ({
      key: t,
      label: TIME_OF_DAY_LABELS[t],
      sessions: sorted.filter((s) => timeOfDayBucket(s.startMinutes) === t),
    }));
    return groups.filter((g) => g.sessions.length > 0);
  }, [resultsFiltered, selectedDate, timeOfDayFilter, now, liveNow, distanceKmFor, nearestActive]);

  const isUnavailableMunicipality = effectiveLocation?.type === "municipality" && effectiveLocation.status === "not-yet-available";

  const emptyStateMessage = useMemo(() => {
    // A recognized-but-uncovered municipality is a different situation than
    // a genuine no-results search — we don't have Markham data at all, so
    // saying "no sessions found in Markham today" would misleadingly imply
    // we checked Markham and came up empty, per "never imply certainty the
    // data can't support."
    if (effectiveLocation?.type === "municipality" && effectiveLocation.status === "not-yet-available") {
      return `DropIn doesn't cover ${effectiveLocation.label} yet — here's what's available in ${AVAILABLE_MUNICIPALITIES_LABEL} instead.`;
    }

    // Composes activity + time-of-day into one natural subject rather than
    // stacking separate clauses — "Badminton activities in the evening",
    // "evening activities", or just "Badminton activities" depending on
    // which refinements are actually active.
    let subject: string;
    if (activityDisplayLabel && timeOfDayFilter !== "all") {
      subject = `${activityDisplayLabel} activities in the ${timeOfDayFilter}`;
    } else if (activityDisplayLabel) {
      subject = `${activityDisplayLabel} activities`;
    } else if (timeOfDayFilter !== "all") {
      subject = `${timeOfDayFilter} activities`;
    } else {
      subject = "activities";
    }

    const dateWord = isToday(selectedDate, now)
      ? "today"
      : isTomorrow(selectedDate, now)
        ? "tomorrow"
        : `on ${weekdayLabel(selectedDate)}`;

    return effectiveLocation
      ? `No ${subject} found in ${effectiveLocation.label} ${dateWord}.`
      : `No ${subject} found ${dateWord}.`;
  }, [activityDisplayLabel, effectiveLocation, timeOfDayFilter, selectedDate, now]);

  // The nearest other date (within the rolling window) that has at least one
  // real session for the current activity+location scope — only offered
  // when neither an activity nor a time-of-day filter is the active
  // constraint, since those get their own targeted "clear" actions that
  // resolve the emptiness without changing what date is being looked at.
  const nextAvailableDate = useMemo(() => {
    if (activeFilter !== "All" || timeOfDayFilter !== "all") return undefined;
    return rollingDates.find((d) => d !== selectedDate && baseResults.some((s) => s.date === d));
  }, [baseResults, rollingDates, selectedDate, activeFilter, timeOfDayFilter]);

  // Only ever suggests activities that actually have real sessions on the
  // currently selected date — never a dead-end suggestion.
  const alternateActivitySuggestions = useMemo(() => {
    const candidates = [...SHORTCUTS, "Table Tennis"].filter((a) => !matchedActivities.includes(a));
    return candidates
      .filter((a) => {
        const group = ACTIVITY_GROUPS[a.toLowerCase()] ?? [a];
        return sessions.some(
          (s) =>
            group.includes(s.activity) &&
            s.date === selectedDate &&
            (!effectiveLocation || sessionMatchesLocation(s, effectiveLocation)),
        );
      })
      .slice(0, 2);
  }, [sessions, matchedActivities, effectiveLocation, selectedDate]);

  function commitQuery(q: string) {
    // "near me"/"nearby" carry no parseable location today (Part 13) — the
    // box itself still shows exactly what the user typed via setQuery(q)
    // below; only the text actually handed to the parser (and, from there,
    // committedQuery — re-parsed downstream by the `parsed` memo, so this
    // must be the same string or the two would silently diverge) drops the
    // phrase, so "pickleball near me" behaves like "pickleball."
    const trimmed = stripNearMeLanguage(q.trim());
    setQuery(q);
    setSuggestionsOpen(false);
    setActiveFilter("All");
    setSelectedDate(todayDateKey);
    setTimeOfDayFilter("all");

    const result = parseQuery(trimmed, sessions);

    if (result.activities.length === 0 && !result.location) {
      // Query didn't resolve to anything recognized — never a dead end.
      // Fall back to Discovery Intent, scoped to the persistent context,
      // with a line acknowledging the miss.
      setQueryMiss(trimmed);
      setCommittedQuery("");
      setLocationOverride(undefined);
      setSurfaceState("discovery");
      return;
    }

    setQueryMiss(null);
    setCommittedQuery(trimmed);
    setSurfaceState("results");

    if (result.location && result.activities.length === 0) {
      // Purely a location search — updates the persistent context directly.
      setPersistentLocation(result.location);
      setLocationOverride(undefined);
    } else if (result.location) {
      // Mixed query — a one-time override, scoped to this search only.
      setLocationOverride(result.location);
    } else {
      // Activity-only — an override never silently persists.
      setLocationOverride(undefined);
    }
  }

  // Broadens from a single-activity search without starting over — the
  // activity constraint is entirely query-driven (matchedActivities, via
  // committedQuery), so removing it means clearing the query itself, not
  // just the activeFilter chip. Deliberately does not touch selectedDate,
  // timeOfDayFilter, location, density, or surfaceState: this is a
  // refinement of the current Results context, not a new search.
  function exploreAllActivities() {
    setQuery("");
    setCommittedQuery("");
    setActiveFilter("All");
  }

  // Live search: ~300ms after the last keystroke, a non-empty query that
  // hasn't already been committed auto-commits — the same resolution as an
  // explicit Enter, just triggered by a pause instead of a keypress. Enter
  // and suggestion taps still commit immediately, bypassing this entirely.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "" || trimmed === committedQuery) return;
    const timer = setTimeout(() => commitQuery(query), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleInputChange(value: string) {
    setQuery(value);
    setSuggestionsOpen(true);
    if (value.trim() !== "") setQueryMiss(null);
    if (surfaceState === "results" && value.trim() === "") {
      setSurfaceState("discovery");
      setCommittedQuery("");
      setLocationOverride(undefined);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim().length > 0) commitQuery(query.trim());
    if (e.key === "Escape") setSuggestionsOpen(false);
  }

  // Native share sheet where it exists; a clipboard copy (with a brief
  // "Copied" confirmation on the button itself) everywhere else — no new
  // UI, just a real action behind a button that previously did nothing.
  async function handleShare(s: Session) {
    const displayName = displayActivityName(s);
    const summary = [`${displayName} — ${s.centre}`, timeLabel(s, computeStatus(s, liveNow), now), s.officialUrl].filter(Boolean).join("\n");

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: displayName,
          text: `${displayName} — ${s.centre}`,
          ...(s.officialUrl ? { url: s.officialUrl } : {}),
        });
      } catch {
        // User cancelled the native share sheet — not an error, nothing to do.
      }
      return;
    }

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(summary);
        setShareCopied(true);
        if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
        shareResetTimer.current = setTimeout(() => setShareCopied(false), 1500);
      } catch {
        // Clipboard permission denied or unavailable — fail silently rather
        // than surfacing an error for what's a convenience action.
      }
    }
  }

  const large = surfaceState === "discovery";

  // A quiet time anchor, not a heading — reassures users the results below
  // are current without asking them to think about it.
  const todayLabel = useMemo(
    () => now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    [now],
  );

  const selectedSessionStatus = useMemo(
    () => (selectedSession ? computeStatus(selectedSession, liveNow) : undefined),
    [selectedSession, liveNow],
  );

  return (
    <main className="min-h-screen bg-surface text-text-primary">
      {/* Persistent header — present across every state */}
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-4">
          <h1 className="text-lg font-semibold tracking-tight text-logo">DropIn</h1>
          <div className="flex items-center gap-3">
            {/* Current Search Area, and (Phase 4.2) the one location
                affordance — its visible text still just reflects wherever
                the search resolved to (never typed into directly, a brief
                warm pulse confirms it just changed), but it's now also the
                single intentional action that requests real device
                location. Never fired automatically — only this onClick, in
                response to a real tap/click/Enter, ever calls
                requestLocation(). */}
            <button
              type="button"
              onClick={() => requestLocation()}
              disabled={userLocation.status === "requesting"}
              aria-label={locationPillAriaLabel(userLocation)}
              className={`flex items-center gap-1 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors duration-500 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary ${
                pillPulsing ? "motion-safe:animate-[pillPulse_900ms_ease-out]" : ""
              }`}
            >
              <LocationIcon className="h-4 w-4 text-text-secondary" />
              {locationPillLabel(effectiveLocation, userLocation)}
            </button>
            <button
              type="button"
              aria-label="About DropIn"
              onClick={() => setInfoSheetOpen(true)}
              className="rounded-full p-1 text-text-secondary transition-all duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-95"
            >
              <InfoIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Today's context — a quiet time anchor, not a heading. Confirms
            "these results are current" without competing with the wordmark
            above or the search bar below. */}
        <p className="text-base font-medium text-text-secondary">Today · {todayLabel}</p>

        {/* Search — persists across every state, changing prominence rather
            than disappearing. No headline above it: Discovery already shows
            real results, so nothing needs to ask "what do you want" first. */}
        <div className={`relative ${large ? "pt-3 pb-6" : "py-4"}`}>
          <label htmlFor="surface-search" className="sr-only">
            Search activities, community centres or places
          </label>
          <div className="relative">
            <SearchIcon
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-secondary transition-transform duration-200 ease-out ${large ? "left-4 h-5 w-5" : "left-3.5 h-4 w-4"}`}
            />
            <input
              ref={inputRef}
              id="surface-search"
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={query === "" && !inputFocused ? "" : "Search activities, community centres or places"}
              className={`w-full rounded-2xl border border-border bg-white text-text-primary shadow-[0_1px_2px_rgba(47,43,39,0.04),0_2px_8px_rgba(47,43,39,0.04)] outline-none transition-all duration-200 ease-out placeholder:text-text-secondary hover:border-text-secondary/30 focus:border-sage-text focus:shadow-none focus:ring-4 focus:ring-sage-text/20 ${
                large ? "py-[18px] pl-12 pr-4 text-base" : "py-2.5 pl-10 pr-4 text-sm"
              }`}
            />
            {/* Decorative rotating examples — purely visual, layered over the
                real (static, accessible) placeholder above; clicks pass
                through since this never intercepts pointer events. */}
            {query === "" && !inputFocused && (
              <span
                key={placeholderIndex}
                aria-hidden="true"
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-text-secondary motion-safe:animate-[placeholderFade_3.2s_ease-in-out] ${
                  large ? "left-12 right-4 text-base" : "left-10 right-4 text-sm"
                }`}
              >
                {PLACEHOLDER_ROTATION[placeholderIndex]}
              </span>
            )}
          </div>

          {displaySuggestions.length > 0 && (
            <ul
              className={`absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-border bg-white shadow-[0_16px_40px_-8px_rgba(47,43,39,0.20)] ${
                suggestionsClosing ? "dropdown-exit pointer-events-none" : "dropdown-enter"
              }`}
            >
              {displaySuggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => commitQuery(s)}
                    className="block w-full px-4 py-2.5 text-left text-sm text-text-primary transition-colors duration-100 ease-out hover:bg-hover-surface hover:text-sage-text"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ===================== DISCOVERY STATE ===================== */}
        {displaySurfaceState === "discovery" && (
          <section
            className={`pb-10 ${surfaceExiting ? "motion-safe:animate-[fadeOut_100ms_ease-out_both]" : "motion-safe:animate-[cardIn_220ms_ease-out_both]"}`}
          >
            {queryMiss && (
              <p className="mb-4 rounded-xl border border-border bg-hover-surface px-4 py-3 text-sm text-text-secondary">
                We couldn&rsquo;t find &ldquo;{queryMiss}&rdquo; — here&rsquo;s what&rsquo;s on nearby instead.
              </p>
            )}

            <p className="mb-4 text-sm font-medium text-text-secondary">What would you like to do today?</p>

            {/* No wrapper padding — chips sit directly on the page
                background, left edge lining up naturally with the search bar
                and heading below. The relative/absolute pair around the
                scroll row is purely a trailing-fade affordance: it only
                appears when there's real content past the edge, so it never
                claims there's more to scroll when there isn't. */}
            <div className="relative mb-6">
              <div ref={discoveryCarouselScroll.ref} className="flex items-center gap-2 overflow-x-auto">
                {SHORTCUTS.map((chip) => {
                  const Icon = ACTIVITY_ICONS[chip];
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => commitQuery(chip)}
                      className="group flex flex-shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-3.5 py-2 text-sm font-medium text-text-primary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-95"
                    >
                      <Icon className="h-4 w-4 text-text-secondary transition-colors duration-150 ease-out group-hover:text-sage-text" />
                      {chip}
                    </button>
                  );
                })}
                <span className="my-1 w-px flex-shrink-0 self-stretch bg-border" aria-hidden="true" />
                <button
                  type="button"
                  aria-pressed={discoveryFreeOnly}
                  onClick={() => setDiscoveryFreeOnly((v) => !v)}
                  className={`flex-shrink-0 rounded-full border px-3.5 py-2 text-sm transition-all duration-[170ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-95 ${
                    discoveryFreeOnly
                      ? "border-transparent bg-sage/15 font-semibold text-sage-text"
                      : "border-border bg-white font-medium text-text-secondary hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)]"
                  }`}
                >
                  Free
                </button>
              </div>
              {discoveryCarouselScroll.showFade && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-surface"
                />
              )}
            </div>

            <h2 className="mb-3 text-base font-semibold text-sage-text">
              {persistentLocation ? `Activities in ${persistentLocation.label}` : "Activities near you"}
            </h2>

            <div className={`motion-safe:animate-[${discoveryPulse === 0 ? "contentFadeA" : "contentFadeB"}_180ms_ease-out]`}>
              {loading ? (
                <div className="space-y-4">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : discoveryHighlights.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-text-secondary">
                  Nothing free right now — here&rsquo;s what&rsquo;s on nearby instead.{" "}
                  <button type="button" onClick={() => setDiscoveryFreeOnly(false)} className="text-sage-text underline underline-offset-2">
                    Show everything
                  </button>
                </p>
              ) : (
                <div className="space-y-4">
                  {discoveryHighlights.map((s, i) => (
                    <SessionCard
                      key={s.id}
                      s={distanceKmFor(s) !== undefined ? { ...s, distanceKm: distanceKmFor(s) } : s}
                      now={now}
                      liveNow={liveNow}
                      onSelect={setSelectedSession}
                      delayMs={i * 30}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ===================== RESULTS STATE ===================== */}
        {displaySurfaceState === "results" && (
          <section
            className={`pb-10 ${surfaceExiting ? "motion-safe:animate-[fadeOut_100ms_ease-out_both]" : "motion-safe:animate-[cardIn_220ms_ease-out_both]"}`}
          >
            {/* No standalone "{Activity} Activities" heading here on purpose
                — it used to read as a section title implying everything
                below belonged under it, when the actual next content was
                Date, then Time, then Activity again. The selected activity
                is already communicated by the query, the active chip below,
                and the result cards themselves; its one remaining job —
                naming what's currently showing — now lives in the Results
                Summary line instead (see the count line below the
                refinements), and its "remove this constraint" job is now
                the Activity row's own "All" option (see exploreAllActivities
                usage below) rather than a separate link. */}

            {/* WHEN group — Date + Time-of-day read as one cluster via a
                shared quiet utility label (reusing the exact text-xs
                font-medium text-text-secondary treatment the date strip's
                own weekday line already uses, not a new style) and tighter
                internal spacing than what separates this group from
                Activity below. Deliberately not a heading — smaller,
                muted, never sage — so it stays subordinate to real content
                headings like a result group's "Morning". mt-2 restores the
                "comfortable separation" from the search bar that the
                removed context heading used to contribute incidentally via
                its own margin. */}
            <div className="mt-2 mb-1.5 flex items-center justify-between">
              {/* text-text-primary, not -secondary — the same "the more
                  structural of two stacked lines gets the darker token"
                  precedent the date strip's own weekday/date pair already
                  uses in this file. Weight/size stay exactly as before;
                  the one-token color shift alone is enough to read as
                  clearly more intentional than the plain-secondary
                  metadata line below, without approaching the sage/
                  semibold weight of a real result-group heading. */}
              <span className="text-xs font-medium text-text-primary">When</span>
              {/* No border/fill — same quiet icon-button treatment the
                  header's own Info button already uses. Now sits beside the
                  "When" label rather than inline with the dates themselves
                  — it's the entry point to the full schedule, not one of
                  the date options, so it shouldn't visually resemble one.
                  Still a plain sibling outside the scrollable strip, so it
                  can never scroll out of view with the date content on
                  mobile. */}
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                aria-label="Choose another date"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-text-secondary transition-all duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-95"
              >
                <CalendarIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Date navigator — deliberately NOT styled like the pill filter
                chips below it. Filters are bordered pills (a "pick one or
                more categories" vocabulary); this reads as calendar/week
                navigation instead: no border or fill on unselected dates,
                a stacked weekday-context + calendar-date pair per item, and
                a selected state built from color + a thin underline
                indicator rather than a filled pill, so "when" and "what"
                don't look like the same control system stacked twice.
                mb-3 (not mt on Time below) is the Date→Time gap — deliberately
                smaller than the Time→Activity gap below, so Date+Time read
                as one group. When Time doesn't render at all, this same
                margin collapses with the Activity label's own larger mt-6
                instead, so the group boundary still lands in the right
                place regardless of which row happens to be last. */}
            <div className="relative mb-3">
              <div
                ref={dateStripScroll.ref}
                className="flex gap-0.5 overflow-x-auto pb-1"
                role="group"
                aria-label="Select a date"
              >
                {rollingDates.map((d) => {
                  const active = d === selectedDate;
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={active}
                      aria-label={fullDateLabel(d, now)}
                      onClick={() => setSelectedDate(d)}
                      className="group flex flex-shrink-0 flex-col items-center gap-1 rounded-lg px-3 pb-1.5 pt-2 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-95"
                    >
                      <span className={`text-xs font-medium ${active ? "text-sage-text" : "text-text-secondary group-hover:text-sage-text"}`}>
                        {dateStripContextLabel(d, now)}
                      </span>
                      <span className={`text-sm font-semibold ${active ? "text-sage-text" : "text-text-primary group-hover:text-sage-text"}`}>
                        {dateStripDateLabel(d)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`h-0.5 w-6 rounded-full transition-colors duration-150 ease-out ${active ? "bg-sage-text" : "bg-transparent"}`}
                      />
                    </button>
                  );
                })}
              </div>
              {dateStripScroll.showFade && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-surface"
                />
              )}
            </div>

            {/* Time of day — a single segmented control, not a row of
                independent chips. Date is calendar navigation, activity is a
                set of category chips; time-of-day is neither "which day" nor
                "which category" but a subdivision of the day itself, so it
                gets its own coherent-looking control: one quiet bordered
                soft-rectangle housing three segments, rather than three
                separate bordered/shadowed chips that would read as more
                activity filters. Deliberately NOT a full capsule
                (rounded-full) — the activity row directly beneath already
                uses that shape, and two different filter kinds sharing one
                silhouette is exactly the sameness this control needs to
                avoid. rounded-lg reuses the same corner radius the date
                strip's own buttons already use elsewhere in this file, not
                a new value. Deliberately never shares a scroll container
                with activity subtype chips either — see the row below.
                Only rendered once there's a real choice to make, and each
                segment still behaves as a toggle, like Discovery's Free
                chip — tapping the active one again clears it. No bottom
                margin of its own on purpose — the Activity label's mt-6
                below owns the larger group-separating gap regardless of
                whether this control is present. */}
            {timeOfDayOptions.length > 1 && (
              <div
                className="inline-flex rounded-lg border border-border/70 bg-white p-0.5"
                role="group"
                aria-label="Time of day"
              >
                {timeOfDayOptions.map((t) => {
                  const active = timeOfDayFilter === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTimeOfDayFilter(active ? "all" : t)}
                      className={`rounded-md px-3.5 py-1.5 text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-95 ${
                        active ? "bg-sage/15 font-semibold text-sage-text" : "font-medium text-text-secondary hover:text-sage-text"
                      }`}
                    >
                      {TIME_OF_DAY_LABELS[t]}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ACTIVITY group — its own quiet utility label (same treatment
                as "When", singular "Activity" since this names the
                filtering dimension, not the result count) plus the subtype
                row. mt-6 is the deliberately larger gap that separates the
                When group above from this one — collapses with whichever
                row above happens to be last (Date or Time), so the
                boundary reads correctly either way. Label and row are
                wrapped in the same condition so "Activity" never renders
                with nothing beneath it. Now the row's own "All" carries the
                job the removed context heading's "Explore all activities"
                link used to do, so it renders whenever a real search-driven
                activity constraint exists (matchedActivities.length > 0)
                even for an activity with no subtypes of its own (Badminton,
                Pickleball) — otherwise there'd be no way to answer "what do
                I want to do?" with anything other than the one thing
                already searched. "All" is never cosmetic: when real
                subtypes exist (e.g. Swimming's Lane/Leisure variants) it
                narrows within that matched family, same as before; when
                there's no real family to narrow within, it falls through to
                exploreAllActivities so it still visibly does something
                rather than silently no-op. Can run long (every Swimming
                variant, say), so it gets its own scroll container and
                trailing fade rather than ever competing with time-of-day
                for horizontal space. */}
            {(matchedActivities.length > 0 || filterChipActivities.length > 1) && (
              <>
                {/* Same treatment as "When" above — see its comment. mb-4
                    here, not mb-1.5: "When"'s own label-to-content gap
                    reads as 16px in practice because its row is stretched
                    taller by the calendar button sitting beside it
                    (items-center centers the text within that taller row,
                    adding invisible space below the text before the row's
                    own margin even starts) — a plain single-line span like
                    this one has no such hidden height, so it needs a
                    larger explicit margin to land on the same visible
                    16px gap, confirmed by measuring both in the browser. */}
                <span className="mt-6 mb-4 block text-xs font-medium text-text-primary">Activity</span>
                <div className="relative mb-3">
                  <div ref={subtypeScroll.ref} className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Activity subtype">
                    {["All", ...filterChipActivities].map((f) => {
                      const active = activeFilter === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            if (f !== "All") return setActiveFilter(f);
                            if (filterChipActivities.length > 1) return setActiveFilter("All");
                            exploreAllActivities();
                          }}
                          className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-all duration-[170ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-95 ${
                            active
                              ? "border-transparent bg-sage/15 font-semibold text-sage-text"
                              : "border-border bg-white font-medium text-text-secondary hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)]"
                          }`}
                        >
                          {f}
                        </button>
                      );
                    })}
                  </div>
                  {subtypeScroll.showFade && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-surface"
                    />
                  )}
                </div>
              </>
            )}

            {/* mt-3 here, not a bigger mb- on whichever refinement row
                happens to be last (date, time, or activity, depending on
                how many real choices exist) — adding it to the divider
                instead means "the whole refinement cluster sits clearly
                apart from results" holds true regardless of which row is
                actually last, without needing per-case spacing logic. */}
            <div className="mt-3 flex items-center justify-between border-t border-border/70 py-4 text-xs text-text-secondary">
              {/* Now the one place the active activity is actually named —
                  absorbing the job the removed standalone heading used to
                  do, rather than duplicating it above the filters. Nearest
                  first (Phase 4.4B, relabelled/restyled in a later polish
                  pass) sits right next to it, not with the density toggle on
                  the right: it's a ranking preference, the same family as
                  the count text describing what's being shown, not a
                  presentation control like density.
                  A quiet outlined pill, not a chip: `border` is present on
                  BOTH states (only its color changes — transparent when
                  active) specifically so the box model never changes size
                  between inactive/active and toggling never shifts
                  neighbouring layout. Deliberately lighter-weight than the
                  real Activity chips (no shadow, no hover-lift, tighter
                  padding, font-medium not semibold) so it reads as related
                  but subordinate — a ranking preference, not another
                  filter. Inactive text uses sage-text at reduced opacity
                  ("muted green") purely so active (full-opacity sage-text,
                  "deeper green") has somewhere higher to read as deeper
                  against — both are the one existing interactive/brand
                  green, no new color introduced. */}
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate">{`${resultsFiltered.length} ${activityDisplayLabel ? `${activityDisplayLabel} ` : ""}${resultsFiltered.length === 1 ? "activity" : "activities"}${lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ""}`}</span>
                <button
                  type="button"
                  aria-pressed={nearestActive}
                  aria-label={nearestControlAriaLabel()}
                  disabled={awaitingNearestLocation && userLocation.status === "requesting"}
                  onClick={handleNearestClick}
                  className={`flex-shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1.5 font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text disabled:cursor-default ${
                    nearestActive
                      ? "border-transparent bg-sage/15 text-sage-text"
                      : "border-border bg-white text-sage-text/70 hover:border-sage-text/40 hover:bg-hover-surface hover:text-sage-text"
                  }`}
                >
                  Nearest first
                </button>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1" role="group" aria-label="List density">
                <button
                  type="button"
                  aria-label="Comfortable list"
                  aria-pressed={density === "comfortable"}
                  onClick={() => setDensityPersisted("comfortable")}
                  className={`rounded-md p-1.5 transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-90 ${
                    density === "comfortable" ? "bg-sage/15 text-sage-text" : "text-text-secondary hover:bg-hover-surface hover:text-sage-text"
                  }`}
                >
                  <ComfortableListIcon className={`h-4 w-4 transition-transform duration-200 ease-out ${density === "comfortable" ? "scale-100" : "scale-90"}`} />
                </button>
                <button
                  type="button"
                  aria-label="Compact list"
                  aria-pressed={density === "compact"}
                  onClick={() => setDensityPersisted("compact")}
                  className={`rounded-md p-1.5 transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-90 ${
                    density === "compact" ? "bg-sage/15 text-sage-text" : "text-text-secondary hover:bg-hover-surface hover:text-sage-text"
                  }`}
                >
                  <CompactListIcon className={`h-4 w-4 transition-transform duration-200 ease-out ${density === "compact" ? "scale-100" : "scale-90"}`} />
                </button>
              </div>
            </div>

            <div className={`space-y-8 motion-safe:animate-[${resultsPulse === 0 ? "contentFadeA" : "contentFadeB"}_180ms_ease-out]`}>
              {loading ? (
                <div className="space-y-4">
                  <SkeletonCard density={density} />
                  <SkeletonCard density={density} />
                  <SkeletonCard density={density} />
                </div>
              ) : resultsFiltered.length === 0 ? (
                <div className="py-12 text-center motion-safe:animate-[cardIn_220ms_ease-out_both]">
                  <p className="text-sm text-text-secondary">{emptyStateMessage}</p>
                  <p className="mt-3 text-xs font-medium text-text-secondary/70">Try</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {isUnavailableMunicipality ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLocationOverride(undefined);
                          setPersistentLocation(undefined);
                        }}
                        className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                      >
                        {/* Names the real action (clearing the location
                            entirely, via the existing municipality registry
                            below) rather than a hardcoded city — this used
                            to always say "Show Toronto instead" even after
                            other municipalities became available (Phase
                            3.2, Part 10). */}
                        Show all areas instead
                      </button>
                    ) : (
                      <>
                        {activeFilter !== "All" && (
                          <button
                            type="button"
                            onClick={() => setActiveFilter("All")}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            Clear {activeFilter} filter
                          </button>
                        )}
                        {timeOfDayFilter !== "all" && (
                          <button
                            type="button"
                            onClick={() => setTimeOfDayFilter("all")}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            Clear time filter
                          </button>
                        )}
                        {matchedActivities.length > 0 && (
                          <button
                            type="button"
                            onClick={exploreAllActivities}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            Explore all activities
                          </button>
                        )}
                        {nextAvailableDate && (
                          <button
                            type="button"
                            onClick={() => setSelectedDate(nextAvailableDate)}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            Try {shortDateLabel(nextAvailableDate, now)}
                          </button>
                        )}
                        {effectiveLocation && (
                          <button
                            type="button"
                            onClick={() => {
                              setLocationOverride(undefined);
                              setPersistentLocation(undefined);
                            }}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            Nearby areas
                          </button>
                        )}
                        {alternateActivitySuggestions.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => commitQuery(a)}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            {a}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                resultsGrouped.map((d) => (
                  <div key={d.key}>
                    {d.label && <h2 className="mb-3 text-base font-semibold text-sage-text">{d.label}</h2>}
                    <div className="space-y-4">
                      {d.sessions.map((s, i) => (
                        <SessionCard
                          key={s.id}
                          s={distanceKmFor(s) !== undefined ? { ...s, distanceKm: distanceKmFor(s) } : s}
                          now={now}
                          liveNow={liveNow}
                          onSelect={setSelectedSession}
                          density={density}
                          delayMs={i * 30}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {/* ===================== QUICK ACTION SHEET (Decision Sheet) =====================
          Everything above the actions exists to answer one question, "should I
          go?" — in priority order: Identity (activity, already the title; time,
          first line), Location (centre, address), Eligibility (price, age
          restriction), Trust (verification, freshness, source). Each line is
          conditionally rendered and omitted outright when the data isn't
          available — never a placeholder standing in for missing information. */}
      <Sheet
        open={!!selectedSession}
        onClose={() => {
          setSelectedSession(null);
          setShareCopied(false);
        }}
        titleId="quick-action-title"
        desktopVariant="modal"
        narrow
        initialFocusRef={directionsRef}
        titleSlot={
          selectedSession &&
          (() => {
            const ActivityIcon = ACTIVITY_ICONS[getShortcutForActivity(selectedSession.activity) ?? ""];
            return (
              <h2 id="quick-action-title" className="flex min-w-0 items-center gap-2 text-[18px] font-bold leading-tight text-text-primary">
                {ActivityIcon && <ActivityIcon className="h-5 w-5 flex-shrink-0 text-text-secondary" />}
                {displayActivityName(selectedSession)}
              </h2>
            );
          })()
        }
      >
        {selectedSession && (
          <>
            {/* Identity: date & time — the hardest constraint, so it leads,
                and it earns the same urgency styling as the card it was
                just opened from (bold sage + dot when urgent, medium-weight
                secondary otherwise) rather than reading flatter here than
                it did one tap ago. */}
            <p
              className={`-mt-2 flex items-center gap-1.5 text-sm ${
                selectedSessionStatus === "starting-soon" || selectedSessionStatus === "in-progress"
                  ? "font-semibold text-sage-text"
                  : "font-medium text-text-secondary"
              }`}
            >
              {(selectedSessionStatus === "starting-soon" || selectedSessionStatus === "in-progress") && (
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage-text" aria-hidden="true" />
              )}
              {timeLabel(selectedSession, selectedSessionStatus!, now)}
            </p>

            {/* Location: centre — the anchor fact, a shade darker than the
                supporting address beneath it — then the full address if the
                source has one. Tight to each other (one cluster); a slightly
                wider gap above marks this as a new category from Identity. */}
            <p className="mt-2 text-sm font-medium text-text-primary">{selectedSession.centre}</p>
            {selectedSession.address && <p className="mt-0.5 text-sm text-text-secondary">{selectedSession.address}</p>}

            {/* Eligibility: price and/or age restriction on one line, plus
                the stable attendance requirement (Phase 3.5C) as its own
                line directly beneath — same decision-fact cluster, same
                typography, just one additional factual line rather than a
                new section. Each piece is omitted entirely when unknown
                rather than showing a blank or guessed line. A wider gap
                above marks the cluster as its own category. */}
            {(selectedSession.price || ageRestrictionLabel(selectedSession) || attendanceRequirementLabel(selectedSession)) && (
              <div className="mt-2 space-y-1">
                {(selectedSession.price || ageRestrictionLabel(selectedSession)) && (
                  <p className="text-sm text-text-secondary">
                    {[selectedSession.price, ageRestrictionLabel(selectedSession)].filter(Boolean).join(" · ")}
                  </p>
                )}
                {attendanceRequirementLabel(selectedSession) && (
                  <p className="text-sm text-text-secondary">{attendanceRequirementLabel(selectedSession)}</p>
                )}
              </div>
            )}

            <a
              ref={directionsRef}
              href={directionsUrl(selectedSession)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 grid w-full grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl bg-sage-text px-4 py-3 text-sm font-semibold text-white transition-all duration-150 ease-out hover:bg-sage-text/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              <DirectionsIcon className="h-5 w-5" />
              <span className="text-center">Directions</span>
              <span aria-hidden="true" />
            </a>

            <div
              className={`mt-2 grid gap-2 ${
                { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }[secondaryActionCount(selectedSession)]
              }`}
            >
              {selectedSession.officialUrl && (
                <a
                  href={selectedSession.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-sm font-semibold text-text-primary transition-colors duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
                >
                  <LinkIcon className="h-5 w-5 flex-shrink-0" />
                  <span>{officialActionLabel(selectedSession)}</span>
                </a>
              )}
              {selectedSession.phone && (
                <a
                  href={`tel:${selectedSession.phone}`}
                  className="flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-sm font-semibold text-text-primary transition-colors duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
                >
                  <PhoneIcon className="h-5 w-5 flex-shrink-0" />
                  <span>Call</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => handleShare(selectedSession)}
                className="flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-sm font-semibold text-text-primary transition-colors duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
              >
                <ShareIcon className="h-5 w-5 flex-shrink-0" />
                <span>{shareCopied ? "Copied" : "Share"}</span>
              </button>
            </div>

            {/* Trust: freshness, source. Demoted below the actions on
                purpose — it helps someone trust the listing, not decide
                whether to attend, so it shouldn't compete with the decision
                content above. The divider is the same border-t treatment
                the Results meta bar already uses to mark exactly this kind
                of "supporting, not primary" boundary.
                Launch Readiness 1B — the old "Verified"/"Unverified" prefix
                was removed here (Session.verificationStatus itself is
                untouched — still populated by every source adapter exactly
                as before, preserved for any future internal use). Audit
                finding: it's permanently "Unverified" for 6 of 7
                municipalities purely because that source family lacks one
                structured field (see
                lib/dropin/sources/activecommunities/normalize.ts's own
                comment), a narrow technical distinction a user has no way
                to learn and could easily misread as "this listing might be
                wrong." It added no decision value beyond what
                attendanceRequirementLabel() (Walk-in / Pre-registration
                required, shown separately above) already states clearly
                per session — removing it is Option C from
                docs/LAUNCH_READINESS_1A_TRUST_PRIVACY_FEEDBACK_AUDIT.md §8,
                not a data-architecture change. */}
            <p className="mt-4 border-t border-border/70 pt-3 text-xs text-text-secondary/70">
              {[daysAgoLabel(selectedSession.lastUpdated), selectedSession.officialSource].filter(Boolean).join(" · ")}
            </p>
          </>
        )}
      </Sheet>

      {/* ===================== DATE CALENDAR =====================
          The secondary "choose another date" mechanism — selecting a date
          here goes through the exact same setSelectedDate the quick-nav
          strip uses, so query/activity/location/density are untouched and
          the strip's own re-anchoring effect picks up the change
          automatically. */}
      <DateCalendar
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        now={now}
        selectedDate={selectedDate}
        todayDateKey={todayDateKey}
        minDateKey={todayDateKey}
        maxDateKey={maxAvailableDateKey}
        onSelectDate={setSelectedDate}
      />

      {/* ===================== PRODUCT INFORMATION SHEET =====================
          Bottom sheet on mobile, centered modal from md: up — the Search
          Surface stays visible behind the scrim in both cases, only the
          dialog's own position/shape changes.
          Launch Readiness 1B — restructured from 5 content sections down to
          4 (the old "Where does the information come from?" and "Data
          sources" headings said almost the same thing twice; merged into
          one) to make room for two new, real trust requirements
          (Independent project, Privacy link) without making the sheet net
          longer than before. "Built for easier local recreation" (pure
          marketing restatement of the intro, no new operational
          information) was cut rather than kept alongside the new content —
          see docs/LAUNCH_READINESS_1A_TRUST_PRIVACY_FEEDBACK_AUDIT.md §3/§10. */}
      <Sheet
        open={infoSheetOpen}
        onClose={() => setInfoSheetOpen(false)}
        titleId="info-sheet-title"
        desktopVariant="modal"
        // Same fix as the date calendar's title: puts "About DropIn" on the
        // same row as Close instead of on its own line below an otherwise-
        // empty close-button row, which was both the misalignment and most
        // of the excess space above the title.
        titleSlot={
          <h2 id="info-sheet-title" className="text-[18px] font-bold text-text-primary">
            About DropIn
          </h2>
        }
      >
        <p className="mt-2 text-sm text-text-secondary">
          DropIn makes it easier to discover drop-in recreation activities across participating GTA
          municipalities, without searching multiple municipal recreation websites one by one. Search for
          an activity, choose a day and time, and quickly see what&rsquo;s available nearby.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Where does the information come from?</h3>
        <p className="mt-1 text-sm text-text-secondary">
          DropIn organizes publicly available recreation schedules from official municipal sources —
          currently {AVAILABLE_MUNICIPALITIES_LABEL}. We&rsquo;re working to bring in more municipalities
          over time.
        </p>

        {/* Launch Readiness 1A found "We regularly refresh our listings"
            overclaimed relative to the deployed reality (no production
            scheduler exists yet — see docs/PHASE_3_3B_SCHEDULER_DEPLOYMENT_STRATEGY.md's
            own "NOT CONFIGURED" finding, re-verified in that audit). This
            wording deliberately makes no cadence claim at all — it points to
            the real, existing per-listing "Updated ..." freshness label
            instead of asserting a schedule DropIn can't yet back. Upgrade
            only after a scheduler is genuinely deployed and verified. */}
        <h3 className="mt-4 text-xs font-semibold text-sage-text">Keeping information current</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Each listing shows when it was last updated. Municipal schedules, fees, and availability can
          change, so we recommend checking the official listing before you head out.
        </p>

        {/* Launch Readiness 1A/1B — the one explicit statement this needs;
            deliberately not repeated on Result Cards or the Decision Sheet
            (per-session officialSource attribution already provides that
            local context — see the audit's §8). */}
        <h3 className="mt-4 text-xs font-semibold text-sage-text">Independent project</h3>
        <p className="mt-1 text-sm text-text-secondary">
          DropIn is an independent project and is not affiliated with or endorsed by the municipalities
          listed here. Their official recreation sources remain the authoritative source for schedules,
          fees, eligibility, and availability.
        </p>

        {/* Launch Readiness 1B — replaces the old fake local-state Send flow
            (see lib/dropin/contact.ts's own comment) with a real mailto:
            link. DropIn cannot know whether the resulting email is actually
            sent once the user's mail client takes over, so there is
            deliberately no "sent"/confirmation state here — showing one
            would be exactly the false claim this phase exists to remove.
            The address itself stays visible as plain text right below the
            link (Part 13's fallback requirement) for anyone without a
            configured mail client. */}
        <h3 className="mt-4 text-xs font-semibold text-sage-text">Feedback</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Found something wrong or have an idea for DropIn? Let us know about incorrect information,
          something that isn&rsquo;t working, or a suggestion.
        </p>
        <a
          href={feedbackMailtoUrl()}
          className="mt-1.5 inline-block text-sm font-medium text-sage-text underline underline-offset-2"
        >
          Email feedback
        </a>
        <p className="mt-1 text-xs text-text-secondary/70">{PUBLIC_FEEDBACK_EMAIL}</p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Privacy</h3>
        <p className="mt-1 text-sm text-text-secondary">
          DropIn asks for very little.{" "}
          <button
            type="button"
            onClick={() => {
              setInfoSheetOpen(false);
              setPrivacySheetOpen(true);
            }}
            className="text-sage-text underline underline-offset-2"
          >
            See what DropIn does and doesn&rsquo;t collect.
          </button>
        </p>

        <p className="mt-5 text-xs text-text-secondary/70">DropIn · v1.0</p>
      </Sheet>

      {/* ===================== PRIVACY SHEET =====================
          Launch Readiness 1B, Part 14 — its own Sheet instance rather than
          a section inside About: same reasoning as the comment above the
          Product Information Sheet. Content is limited to what fresh code
          inspection actually verified (docs/LAUNCH_READINESS_1A_TRUST_PRIVACY_FEEDBACK_AUDIT.md
          §6) — nothing here describes hosting infrastructure that doesn't
          exist yet, per that audit's Part 16/§12. */}
      <Sheet
        open={privacySheetOpen}
        onClose={() => setPrivacySheetOpen(false)}
        titleId="privacy-sheet-title"
        desktopVariant="modal"
        titleSlot={
          <h2 id="privacy-sheet-title" className="text-[18px] font-bold text-text-primary">
            Privacy
          </h2>
        }
      >
        <p className="mt-2 text-sm text-text-secondary">No account is required to use DropIn.</p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Location</h3>
        <p className="mt-1 text-sm text-text-secondary">
          If you choose to use location-based features, your browser may ask for permission to access
          your location. This is used to calculate distance to recreation facilities and to support
          Nearest First sorting. Search works fully without it.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Precise location storage</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Your precise coordinates stay on your device. DropIn does not store them, does not place them in
          URLs, and does not include them in Share content.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Analytics &amp; cookies</h3>
        <p className="mt-1 text-sm text-text-secondary">
          DropIn does not currently use analytics, advertising tracking, or cookies for tracking, and has
          no accounts to track.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Feedback email</h3>
        <p className="mt-1 text-sm text-text-secondary">
          If you email us, the information you choose to share is handled through email — DropIn does not
          store feedback in a database.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Other websites</h3>
        <p className="mt-1 text-sm text-text-secondary">
          DropIn links to official municipal websites and to Google Maps for directions. Those services
          have their own privacy practices.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Contact</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Questions about privacy can be sent to {PUBLIC_CONTACT_EMAIL}.
        </p>

        <p className="mt-4 text-xs text-text-secondary/70">
          This notice may be updated as DropIn&rsquo;s services evolve.
        </p>
      </Sheet>
    </main>
  );
}
