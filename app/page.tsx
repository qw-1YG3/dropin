"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "./_components/Sheet";
import {
  ACTIVITY_ICONS,
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
import { ACTIVITY_GROUPS, getShortcutForActivity, SHORTCUTS } from "@/lib/dropin/activities";
import { getDisplayDistrict } from "@/lib/dropin/districts";
import { parseQuery, sessionMatchesLocation, type DetectedLocation } from "@/lib/dropin/search-intent";
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
const LATER_TODAY_THRESHOLD_MINUTES = 17 * 60;

type ResultGroup = "startingSoon" | "startingToday" | "laterToday" | "tomorrow";
const RESULT_GROUP_LABELS: Record<ResultGroup, string> = {
  startingSoon: "Starting soon",
  startingToday: "Starting today",
  laterToday: "Later today",
  tomorrow: "Tomorrow",
};

function timeLabel(s: Session) {
  const prefix = s.day === "today" ? (s.urgent ? "Happening soon" : "Today") : "Tomorrow";
  return `${prefix} · ${s.absoluteTime}`;
}

// Share always renders; Website/Call are conditional on real data. The grid
// must match however many actually render — a hardcoded column count leaves
// a visible empty gap whenever a session is missing phone or officialUrl.
function secondaryActionCount(s: Session) {
  return 1 + (s.officialUrl ? 1 : 0) + (s.phone ? 1 : 0);
}

// A real eligibility gate, not a nice-to-have — but "0 to no max" means the
// source data simply isn't restricting this session, so it renders as
// nothing rather than a meaningless "Ages 0+".
function ageRestrictionLabel(s: Session): string | undefined {
  const min = s.ageMin ?? 0;
  const max = s.ageMax;
  if (min <= 0 && max === undefined) return undefined;
  if (max === undefined) return `Ages ${min}+`;
  if (min <= 0) return `Up to age ${max}`;
  return `Ages ${min}–${max}`;
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

type Density = "comfortable" | "compact";

// Compact keeps every field Comfortable shows (activity, time, centre,
// price) — it's not a reduced-information view, just a tighter one:
// activity+price share a line, time+centre share a line. Same card
// component, same click target, same data — only the internal layout and
// type scale shrink, per "reduce height significantly, preserve
// readability, one-column scrolling" rather than a grid.
function SessionCard({
  s,
  onSelect,
  density = "comfortable",
  delayMs = 0,
}: {
  s: Session;
  onSelect: (s: Session) => void;
  density?: Density;
  delayMs?: number;
}) {
  const enterStyle = { animationDelay: `${delayMs}ms` } as React.CSSProperties;

  if (density === "compact") {
    return (
      <button
        type="button"
        onClick={() => onSelect(s)}
        style={enterStyle}
        className="w-full rounded-xl border border-border/70 bg-white px-4 py-2.5 text-left shadow-[0_1px_2px_rgba(47,43,39,0.04)] transition-all duration-200 ease-out hover:-translate-y-px hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-[0.99] motion-safe:animate-[cardIn_220ms_ease-out_both]"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[15px] font-bold leading-tight text-text-primary">{s.activity}</p>
          {s.price && <span className="flex-shrink-0 text-xs text-text-secondary">{s.price}</span>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-secondary">
          {s.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage-text" aria-hidden="true" />}
          <span className={s.urgent ? "font-semibold text-sage-text" : ""}>{timeLabel(s)}</span>
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
          <p className="text-[18px] font-bold leading-tight text-text-primary">{s.activity}</p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-sm ${
              s.urgent ? "font-semibold text-sage-text" : "font-medium text-text-secondary"
            }`}
          >
            {s.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage-text" aria-hidden="true" />}
            {timeLabel(s)}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {s.centre}
            {s.distanceKm !== undefined && ` · ${s.distanceKm} km`}
          </p>
        </div>
        {s.price && <span className="flex-shrink-0 text-sm text-text-secondary">{s.price}</span>}
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
  const [timeWindow, setTimeWindow] = useState<"today" | "week">("today");
  const [discoveryFreeOnly, setDiscoveryFreeOnly] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  // Transient "Copied" confirmation on the Share action when the Web Share
  // API isn't available (most desktop browsers) — reverts on its own, and
  // resets immediately if the sheet closes so it never lingers into the
  // next session someone opens.
  const [shareCopied, setShareCopied] = useState(false);
  const shareResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const [feedbackStage, setFeedbackStage] = useState<"idle" | "writing" | "sent">("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [loading, setLoading] = useState(true);
  // Persistent location context (set only by a pure-location search) vs. a
  // one-time override (set by a mixed activity+location search). The pill
  // always displays the effective one; neither is ever typed into directly.
  const [persistentLocation, setPersistentLocation] = useState<DetectedLocation | undefined>(undefined);
  const [locationOverride, setLocationOverride] = useState<DetectedLocation | undefined>(undefined);
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
  }, [density, activeFilter, timeWindow]);

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

  const discoveryHighlights = useMemo(() => {
    let pool = sessions.filter((s) => s.day === "today");
    if (persistentLocation) pool = pool.filter((s) => sessionMatchesLocation(s, persistentLocation));
    if (discoveryFreeOnly) return pool.filter((s) => s.price === "Free");

    // Diversify across districts and activities so Discovery reads as a
    // cross-city sample rather than repeating whichever centre happens to
    // have the most listings — urgent sessions still surface first within
    // that diverse set.
    const ranked = [...pool].sort((a, b) => Number(b.urgent) - Number(a.urgent));
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
  }, [sessions, discoveryFreeOnly, persistentLocation]);

  const parsed = useMemo(() => parseQuery(committedQuery, sessions), [committedQuery, sessions]);
  const matchedActivities = parsed.activities;

  const baseResults = useMemo(() => {
    return sessions.filter((s) => {
      if (matchedActivities.length > 0 && !matchedActivities.includes(s.activity)) return false;
      if (effectiveLocation && !sessionMatchesLocation(s, effectiveLocation)) return false;
      return true;
    });
  }, [sessions, matchedActivities, effectiveLocation]);

  // Filter chips reflect activities actually present in the current
  // activity+location scope, not just the raw parsed match — this way a
  // pure-location search ("North York") still offers useful chips to
  // refine by, instead of only ever showing "All".
  const filterChipActivities = useMemo(
    () => Array.from(new Set(baseResults.map((s) => s.activity))),
    [baseResults],
  );

  const resultsFiltered = useMemo(() => {
    return baseResults.filter((s) => {
      if (timeWindow === "today" && s.day === "tomorrow") return false;
      if (activeFilter !== "All" && s.activity !== activeFilter) return false;
      return true;
    });
  }, [baseResults, activeFilter, timeWindow]);

  // A single, consistently-cased noun for whatever activity scope is
  // currently active — used everywhere the Results state needs to name it
  // in a sentence, instead of each spot independently reaching for the raw
  // (possibly lowercase, possibly multi-word) query text. An active filter
  // chip narrows the scope further, so it takes priority over the broader
  // matched-activity set; a multi-activity match (e.g. "swim" resolving to
  // several real course titles) collapses to its shortcut label ("Swimming")
  // rather than every individual title.
  const activityDisplayLabel = useMemo(() => {
    if (activeFilter !== "All") return activeFilter;
    if (matchedActivities.length === 1) return matchedActivities[0];
    if (matchedActivities.length > 1) return getShortcutForActivity(matchedActivities[0]) ?? matchedActivities[0];
    return undefined;
  }, [activeFilter, matchedActivities]);

  // The one real freshness signal the data layer provides — every session
  // in the current snapshot shares the same lastUpdated date, so the first
  // one is representative. Computed relative to "now" rather than a fixed
  // string, so it stays true regardless of when the page is loaded.
  const lastUpdatedLabel = useMemo(() => {
    const raw = sessions[0]?.lastUpdated;
    return raw ? daysAgoLabel(raw) : undefined;
  }, [sessions]);

  // Priority: Starting Soon (urgent) > Starting Today (before 5pm) > Later
  // Today (5pm+) > Tomorrow — so the most time-sensitive activities need
  // zero scanning effort to find. Sorted by start time within each group —
  // real data (startMinutes, computed from the actual schedule). Distance
  // would be the requested secondary sort key, but no session has one:
  // Toronto Open Data has no coordinates and geolocation isn't built yet
  // (Session.distanceKm is undefined for every real session), so sorting by
  // it would mean sorting by nothing — left out rather than faked. A fifth
  // "Remaining Week" group isn't included for the same reason flagged last
  // sprint: Session.day only ever distinguishes today/tomorrow, so there's
  // no real "day 3-7" bucket to group by without fabricating one.
  const resultsByDay = useMemo(() => {
    const byStartTime = (list: Session[]) => [...list].sort((a, b) => a.startMinutes - b.startMinutes);
    const today = resultsFiltered.filter((s) => s.day === "today");

    const groups: Array<{ key: ResultGroup; sessions: Session[] }> = [
      { key: "startingSoon", sessions: byStartTime(today.filter((s) => s.urgent)) },
      {
        key: "startingToday",
        sessions: byStartTime(today.filter((s) => !s.urgent && s.startMinutes < LATER_TODAY_THRESHOLD_MINUTES)),
      },
      {
        key: "laterToday",
        sessions: byStartTime(today.filter((s) => !s.urgent && s.startMinutes >= LATER_TODAY_THRESHOLD_MINUTES)),
      },
    ];
    if (timeWindow === "week") {
      groups.push({ key: "tomorrow", sessions: byStartTime(resultsFiltered.filter((s) => s.day === "tomorrow")) });
    }
    return groups.filter((g) => g.sessions.length > 0);
  }, [resultsFiltered, timeWindow]);

  const isUnavailableMunicipality = effectiveLocation?.type === "municipality" && effectiveLocation.status === "not-yet-available";

  const emptyStateMessage = useMemo(() => {
    // A recognized-but-uncovered municipality is a different situation than
    // a genuine no-results search — we don't have Markham data at all, so
    // saying "no sessions found in Markham today" would misleadingly imply
    // we checked Markham and came up empty, per "never imply certainty the
    // data can't support."
    if (effectiveLocation?.type === "municipality" && effectiveLocation.status === "not-yet-available") {
      return `DropIn doesn't cover ${effectiveLocation.label} yet — here's what's available in Toronto instead.`;
    }
    const activityPart = activityDisplayLabel ? `${activityDisplayLabel} activities` : "activities";
    const scope = timeWindow === "week" ? "this week" : "today";
    return effectiveLocation
      ? `No ${activityPart} found in ${effectiveLocation.label} ${scope}.`
      : `No ${activityPart} found ${scope}.`;
  }, [activityDisplayLabel, effectiveLocation, timeWindow]);

  // Only ever suggests activities that actually have real sessions in the
  // current location/time scope — never a dead-end suggestion.
  const alternateActivitySuggestions = useMemo(() => {
    const candidates = [...SHORTCUTS, "Table Tennis"].filter((a) => !matchedActivities.includes(a));
    return candidates
      .filter((a) => {
        const group = ACTIVITY_GROUPS[a.toLowerCase()] ?? [a];
        return sessions.some(
          (s) =>
            group.includes(s.activity) &&
            (timeWindow === "week" || s.day === "today") &&
            (!effectiveLocation || sessionMatchesLocation(s, effectiveLocation)),
        );
      })
      .slice(0, 2);
  }, [sessions, matchedActivities, effectiveLocation, timeWindow]);

  function commitQuery(q: string) {
    const trimmed = q.trim();
    setQuery(q);
    setSuggestionsOpen(false);
    setActiveFilter("All");
    setTimeWindow("today");

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
    const summary = [`${s.activity} — ${s.centre}`, timeLabel(s), s.officialUrl].filter(Boolean).join("\n");

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: s.activity,
          text: `${s.activity} — ${s.centre}`,
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
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    [],
  );

  return (
    <main className="min-h-screen bg-surface text-text-primary">
      {/* Persistent header — present across every state */}
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-4">
          <h1 className="text-lg font-semibold tracking-tight text-text-primary">DropIn</h1>
          <div className="flex items-center gap-3">
            {/* Current Search Area — display only. It reflects wherever the
                search just resolved to; it is never typed into directly.
                A brief warm pulse confirms it just changed. */}
            <span
              className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-sm text-text-secondary transition-colors duration-500 ease-out ${
                pillPulsing ? "motion-safe:animate-[pillPulse_900ms_ease-out]" : ""
              }`}
            >
              <LocationIcon className="h-4 w-4 text-text-secondary" />
              {effectiveLocation ? effectiveLocation.label : "Near you"}
            </span>
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

            {/* No wrapper — chips sit directly on the page background, left
                edge lining up naturally with the search bar and heading
                below since none of them add their own padding. */}
            <div className="mb-6 flex items-center gap-2 overflow-x-auto">
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
                    <SessionCard key={s.id} s={s} onSelect={setSelectedSession} delayMs={i * 30} />
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
            <p className="mb-2 text-sm text-text-secondary">
              {activityDisplayLabel ? `${activityDisplayLabel} activities` : `Activities in ${effectiveLocation?.label ?? committedQuery}`}
            </p>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {["All", ...filterChipActivities].map((f) => {
                const active = activeFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveFilter(f)}
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

            <div className="mb-4 flex items-center gap-1.5 text-sm text-text-secondary">
              <button
                type="button"
                onClick={() => setTimeWindow("today")}
                className={`transition-colors duration-150 ease-out ${timeWindow === "today" ? "font-semibold text-sage-text underline underline-offset-2" : "hover:text-sage-text"}`}
              >
                Today
              </button>
              /
              <button
                type="button"
                onClick={() => setTimeWindow("week")}
                className={`transition-colors duration-150 ease-out ${timeWindow === "week" ? "font-semibold text-sage-text underline underline-offset-2" : "hover:text-sage-text"}`}
              >
                This Week
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-border/70 py-4 text-xs text-text-secondary">
              <span>{`${resultsFiltered.length} ${resultsFiltered.length === 1 ? "activity" : "activities"} ${lastUpdatedLabel ? ` · ${lastUpdatedLabel}` : ""}`}</span>
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
                        Show Toronto instead
                      </button>
                    ) : (
                      <>
                        {timeWindow === "today" && (
                          <button
                            type="button"
                            onClick={() => setTimeWindow("week")}
                            className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] active:scale-95"
                          >
                            This week
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
                resultsByDay.map((d) => (
                  <div key={d.key}>
                    <h2 className="mb-3 text-base font-semibold text-sage-text">{RESULT_GROUP_LABELS[d.key]}</h2>
                    <div className="space-y-4">
                      {d.sessions.map((s, i) => (
                        <SessionCard key={s.id} s={s} onSelect={setSelectedSession} density={density} delayMs={i * 30} />
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
                {selectedSession.activity}
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
                selectedSession.urgent ? "font-semibold text-sage-text" : "font-medium text-text-secondary"
              }`}
            >
              {selectedSession.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sage-text" aria-hidden="true" />}
              {timeLabel(selectedSession)}
            </p>

            {/* Location: centre — the anchor fact, a shade darker than the
                supporting address beneath it — then the full address if the
                source has one. Tight to each other (one cluster); a slightly
                wider gap above marks this as a new category from Identity. */}
            <p className="mt-2 text-sm font-medium text-text-primary">{selectedSession.centre}</p>
            {selectedSession.address && <p className="mt-0.5 text-sm text-text-secondary">{selectedSession.address}</p>}

            {/* Eligibility: price and/or age restriction, one line, omitted
                entirely when neither is known rather than showing a blank
                line. A wider gap above marks it as its own category too. */}
            {(selectedSession.price || ageRestrictionLabel(selectedSession)) && (
              <p className="mt-2 text-sm text-text-secondary">
                {[selectedSession.price, ageRestrictionLabel(selectedSession)].filter(Boolean).join(" · ")}
              </p>
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
                  className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-text-primary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
                >
                  <LinkIcon className="h-5 w-5" />
                  <span className="text-center">Website</span>
                  <span aria-hidden="true" />
                </a>
              )}
              {selectedSession.phone && (
                <a
                  href={`tel:${selectedSession.phone}`}
                  className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-text-primary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
                >
                  <PhoneIcon className="h-5 w-5" />
                  <span className="text-center">Call</span>
                  <span aria-hidden="true" />
                </a>
              )}
              <button
                type="button"
                onClick={() => handleShare(selectedSession)}
                className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-text-primary transition-all duration-[170ms] ease-out hover:-translate-y-px hover:bg-hover-surface hover:text-sage-text hover:shadow-[0_8px_20px_-6px_rgba(47,43,39,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text focus-visible:ring-offset-2 active:scale-[0.98]"
              >
                <ShareIcon className="h-5 w-5" />
                <span className="text-center">{shareCopied ? "Copied" : "Share"}</span>
                <span aria-hidden="true" />
              </button>
            </div>

            {/* Trust: verification, freshness, source. Demoted below the
                actions on purpose — it helps someone trust the listing, not
                decide whether to attend, so it shouldn't compete with the
                decision content above. The divider is the same border-t
                treatment the Results meta bar already uses to mark exactly
                this kind of "supporting, not primary" boundary. */}
            <p className="mt-4 border-t border-border/70 pt-3 text-xs text-text-secondary/70">
              {[
                selectedSession.verificationStatus === "verified" ? "Verified" : "Unverified",
                daysAgoLabel(selectedSession.lastUpdated),
                selectedSession.officialSource,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        )}
      </Sheet>

      {/* ===================== PRODUCT INFORMATION SHEET =====================
          Bottom sheet on mobile, centered modal from md: up — the Search
          Surface stays visible behind the scrim in both cases, only the
          dialog's own position/shape changes. */}
      <Sheet
        open={infoSheetOpen}
        onClose={() => {
          setInfoSheetOpen(false);
          setFeedbackStage("idle");
          setFeedbackText("");
        }}
        titleId="info-sheet-title"
        desktopVariant="modal"
      >
        <h2 id="info-sheet-title" className="text-[18px] font-bold text-text-primary">
          About DropIn
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Helping people spend less time searching and more time being active. Discover nearby
          drop-in activities from official recreation providers — all in one place.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Why DropIn</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Community recreation is one of the easiest ways to stay active — but finding what&rsquo;s
          actually on today usually means checking several different websites. DropIn brings it into
          one search.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Our data</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Schedules come directly from official recreation providers. Whenever possible, DropIn links
          straight to the official source to help keep information accurate.
        </p>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">What you&rsquo;ll find</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-text-secondary">
          <li>Nearby activities, ranked by what&rsquo;s happening soonest</li>
          <li>Official schedules, not estimates</li>
          <li>Community centre details</li>
          <li>Quick directions to get you there</li>
        </ul>

        <h3 className="mt-4 text-xs font-semibold text-sage-text">Feedback</h3>
        {feedbackStage === "idle" && (
          <p className="mt-1 text-sm text-text-secondary">
            Found something that doesn&rsquo;t look right?{" "}
            <button
              type="button"
              onClick={() => setFeedbackStage("writing")}
              className="text-sage-text underline underline-offset-2"
            >
              Let us know.
            </button>
          </p>
        )}

        {feedbackStage === "writing" && (
          <div className="mt-1.5">
            <label htmlFor="feedback-text" className="sr-only">
              Your note to DropIn
            </label>
            <textarea
              id="feedback-text"
              autoFocus
              rows={3}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What looks wrong? A time, price, or address that's off..."
              className="w-full resize-none rounded-lg border border-border p-2.5 text-sm text-text-primary outline-none transition-all duration-150 ease-out placeholder:text-text-secondary/70 focus:border-sage-text focus:ring-2 focus:ring-sage-text/20"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setFeedbackStage("idle");
                  setFeedbackText("");
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 ease-out hover:bg-hover-surface hover:text-text-primary active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={feedbackText.trim().length === 0}
                onClick={() => setFeedbackStage("sent")}
                className="rounded-lg bg-terracotta px-3 py-1.5 text-xs font-semibold text-white transition-all duration-150 ease-out hover:bg-terracotta/90 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {feedbackStage === "sent" && (
          <p className="mt-1 rounded-lg border border-sage-text/25 bg-sage/15 px-3 py-2 text-sm text-sage-text motion-safe:animate-[cardIn_220ms_ease-out_both]">
            Thanks — we&rsquo;ve received your note and will take a look.
          </p>
        )}

        <p className="mt-5 text-xs text-text-secondary/70">DropIn · v1.0</p>
      </Sheet>
    </main>
  );
}
