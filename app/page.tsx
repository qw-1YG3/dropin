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

type ResultGroup = "startingSoon" | "today" | "tomorrow";
const RESULT_GROUP_LABELS: Record<ResultGroup, string> = {
  startingSoon: "Starting Soon",
  today: "Today",
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

type Density = "comfortable" | "compact";

// Compact keeps every field Comfortable shows (activity, time, centre,
// price) — it's not a reduced-information view, just a tighter one:
// activity+price share a line, time+centre share a line. Same card
// component, same click target, same data — only the internal layout and
// type scale shrink, per "reduce height significantly, preserve
// readability, one-column scrolling" rather than a grid.
function SessionCard({ s, onSelect, density = "comfortable" }: { s: Session; onSelect: (s: Session) => void; density?: Density }) {
  if (density === "compact") {
    return (
      <button
        type="button"
        onClick={() => onSelect(s)}
        className="w-full rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-left transition-shadow duration-200 hover:shadow-md"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[15px] font-bold leading-tight text-gray-900">{s.activity}</p>
          {s.price && <span className="flex-shrink-0 text-xs text-gray-500">{s.price}</span>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-600">
          {s.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-status" aria-hidden="true" />}
          <span className={s.urgent ? "font-semibold text-status" : ""}>{timeLabel(s)}</span>
          <span className="text-gray-300">·</span>
          <span className="truncate">{s.centre}</span>
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(s)}
      className="w-full rounded-2xl border border-gray-100 bg-white p-5 text-left transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-bold leading-tight text-gray-900">{s.activity}</p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-sm ${
              s.urgent ? "font-semibold text-status" : "font-medium text-gray-700"
            }`}
          >
            {s.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-status" aria-hidden="true" />}
            {timeLabel(s)}
          </p>
          <p className="mt-4 text-sm text-gray-500">
            {s.centre}
            {s.distanceKm !== undefined && ` · ${s.distanceKm} km`}
          </p>
        </div>
        {s.price && <span className="flex-shrink-0 text-sm text-gray-500">{s.price}</span>}
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-2xl border border-gray-100 bg-white p-5 motion-safe:animate-[skeletonPulse_1.2s_ease-in-out_infinite]"
      aria-hidden="true"
    >
      <div className="h-4 w-28 rounded bg-gray-200" />
      <div className="mt-2.5 h-3.5 w-40 rounded bg-gray-100" />
      <div className="mt-2.5 h-3 w-48 rounded bg-gray-100" />
    </div>
  );
}

export default function SearchSurface() {
  const [surfaceState, setSurfaceState] = useState<"discovery" | "results">("discovery");
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");
  const [timeWindow, setTimeWindow] = useState<"today" | "week">("today");
  const [discoveryFreeOnly, setDiscoveryFreeOnly] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
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

  const suggestions = useMemo(() => {
    if (!suggestionsOpen || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    return SUGGESTION_POOL.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [query, suggestionsOpen]);

  const effectiveLocation = locationOverride ?? persistentLocation;

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

  // Urgent sessions surface in their own group ahead of the rest of Today,
  // so the most time-sensitive activities need zero scanning effort to
  // find. Sorted by start time within each group — real data (startMinutes,
  // computed from the actual schedule). Distance would be the requested
  // secondary sort key, but no session has one: Toronto Open Data has no
  // coordinates and geolocation isn't built yet (Session.distanceKm is
  // undefined for every real session), so sorting by it would mean sorting
  // by nothing — left out rather than faked.
  const resultsByDay = useMemo(() => {
    const byStartTime = (list: Session[]) => [...list].sort((a, b) => a.startMinutes - b.startMinutes);

    const groups: Array<{ key: ResultGroup; sessions: Session[] }> = [
      { key: "startingSoon", sessions: byStartTime(resultsFiltered.filter((s) => s.day === "today" && s.urgent)) },
      { key: "today", sessions: byStartTime(resultsFiltered.filter((s) => s.day === "today" && !s.urgent)) },
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
    const activityLabel =
      matchedActivities.length === 1 ? matchedActivities[0] : matchedActivities.length > 1 ? committedQuery : "activities";
    const scope = timeWindow === "week" ? "this week" : "today";
    return effectiveLocation
      ? `No ${activityLabel} sessions found in ${effectiveLocation.label} ${scope}.`
      : `No ${activityLabel} sessions found ${scope}.`;
  }, [matchedActivities, committedQuery, effectiveLocation, timeWindow]);

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

  const large = surfaceState === "discovery";

  // A quiet time anchor, not a heading — reassures users the results below
  // are current without asking them to think about it.
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    [],
  );

  return (
    <main className="min-h-screen bg-surface text-gray-900">
      {/* Persistent header — present across every state */}
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-4">
          <span className="text-lg font-semibold tracking-tight text-gray-900">DropIn</span>
          <div className="flex items-center gap-3">
            {/* Current Search Area — display only. It reflects wherever the
                search just resolved to; it is never typed into directly. */}
            <span className="flex items-center gap-1 text-sm text-gray-600">
              <LocationIcon className="h-4 w-4 text-gray-400" />
              {effectiveLocation ? effectiveLocation.label : "Near you"}
            </span>
            <button
              type="button"
              aria-label="About DropIn"
              onClick={() => setInfoSheetOpen(true)}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
            >
              <InfoIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Today's context — a quiet time anchor, not a heading. Confirms
            "these results are current" without competing with the wordmark
            above or the search bar below. */}
        <p className="text-base font-medium text-gray-600">Today · {todayLabel}</p>

        {/* Search — persists across every state, changing prominence rather
            than disappearing. No headline above it: Discovery already shows
            real results, so nothing needs to ask "what do you want" first. */}
        <div className={`relative ${large ? "pt-3 pb-6" : "py-4"}`}>
          <label htmlFor="surface-search" className="sr-only">
            Search activities, community centres or places
          </label>
          <div className="relative">
            <SearchIcon
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-500 ${large ? "left-4 h-5 w-5" : "left-3.5 h-4 w-4"}`}
            />
            <input
              ref={inputRef}
              id="surface-search"
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search activities, community centres or places"
              className={`w-full rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_2px_8px_rgba(16,24,40,0.04)] outline-none transition-all duration-200 placeholder:text-gray-500 hover:border-gray-300 focus:border-info focus:shadow-none focus:ring-4 focus:ring-info/10 ${
                large ? "py-[18px] pl-12 pr-4 text-base" : "py-2.5 pl-10 pr-4 text-sm"
              }`}
            />
          </div>

          {suggestions.length > 0 && (
            <ul className="dropdown-enter absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => commitQuery(s)}
                    className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors duration-100 hover:bg-info-soft hover:text-info"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ===================== DISCOVERY STATE ===================== */}
        {surfaceState === "discovery" && (
          <section className="pb-10">
            {queryMiss && (
              <p className="mb-4 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">
                We couldn&rsquo;t find &ldquo;{queryMiss}&rdquo; — here&rsquo;s what&rsquo;s on nearby instead.
              </p>
            )}

            <p className="mb-4 text-sm font-medium text-gray-600">What would you like to do today?</p>

            <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
              {SHORTCUTS.map((chip) => {
                const Icon = ACTIVITY_ICONS[chip];
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => commitQuery(chip)}
                    className="group flex flex-shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:border-info/40 hover:bg-info-soft/40 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                  >
                    <Icon className="h-4 w-4 text-gray-400 transition-colors duration-150 group-hover:text-info" />
                    {chip}
                  </button>
                );
              })}
              <span className="my-1 w-px flex-shrink-0 self-stretch bg-gray-200" aria-hidden="true" />
              <button
                type="button"
                aria-pressed={discoveryFreeOnly}
                onClick={() => setDiscoveryFreeOnly((v) => !v)}
                className={`flex-shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 ${
                  discoveryFreeOnly
                    ? "border-info bg-info font-semibold text-white"
                    : "border-gray-200 bg-white font-medium text-gray-600 hover:border-info/40 hover:bg-info-soft/40 hover:text-info"
                }`}
              >
                Free
              </button>
            </div>

            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-600">
              {persistentLocation ? `Happening in ${persistentLocation.label}` : "Happening near you"}
            </h2>

            {loading ? (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : discoveryHighlights.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-600">
                Nothing free right now nearby.{" "}
                <button type="button" onClick={() => setDiscoveryFreeOnly(false)} className="text-info underline underline-offset-2">
                  Show everything
                </button>
              </p>
            ) : (
              <div className="space-y-4">
                {discoveryHighlights.map((s) => (
                  <SessionCard key={s.id} s={s} onSelect={setSelectedSession} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ===================== RESULTS STATE ===================== */}
        {surfaceState === "results" && (
          <section className="pb-10">
            <p className="mb-2 text-sm text-gray-600">{`${committedQuery} options`}</p>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {["All", ...filterChipActivities].map((f) => {
                const active = activeFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveFilter(f)}
                    className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 ${
                      active
                        ? "border-info bg-info font-semibold text-white"
                        : "border-gray-200 bg-white font-medium text-gray-600 hover:border-info/40 hover:bg-info-soft/40 hover:text-info"
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex items-center gap-1.5 text-sm text-gray-600">
              <button
                type="button"
                onClick={() => setTimeWindow("today")}
                className={timeWindow === "today" ? "font-semibold text-info underline underline-offset-2" : "hover:text-info"}
              >
                Today
              </button>
              <span className="text-gray-300">/</span>
              <button
                type="button"
                onClick={() => setTimeWindow("week")}
                className={timeWindow === "week" ? "font-semibold text-info underline underline-offset-2" : "hover:text-info"}
              >
                This Week
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200/70 py-4 text-xs text-gray-600">
              <span>{`${resultsFiltered.length} ${resultsFiltered.length === 1 ? "activity" : "activities"} · Last updated 3 hours ago`}</span>
              <div className="flex flex-shrink-0 items-center gap-1" role="group" aria-label="List density">
                <button
                  type="button"
                  aria-label="Comfortable list"
                  aria-pressed={density === "comfortable"}
                  onClick={() => setDensityPersisted("comfortable")}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info ${
                    density === "comfortable" ? "bg-info text-white" : "text-gray-400 hover:bg-info-soft/40 hover:text-info"
                  }`}
                >
                  <ComfortableListIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Compact list"
                  aria-pressed={density === "compact"}
                  onClick={() => setDensityPersisted("compact")}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info ${
                    density === "compact" ? "bg-info text-white" : "text-gray-400 hover:bg-info-soft/40 hover:text-info"
                  }`}
                >
                  <CompactListIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-8">
              {resultsFiltered.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-gray-600">{emptyStateMessage}</p>
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-400">Try</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {isUnavailableMunicipality ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLocationOverride(undefined);
                          setPersistentLocation(undefined);
                        }}
                        className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-info/40 hover:bg-info-soft/40 hover:text-info"
                      >
                        Show Toronto instead
                      </button>
                    ) : (
                      <>
                        {timeWindow === "today" && (
                          <button
                            type="button"
                            onClick={() => setTimeWindow("week")}
                            className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-info/40 hover:bg-info-soft/40 hover:text-info"
                          >
                            This Week
                          </button>
                        )}
                        {effectiveLocation && (
                          <button
                            type="button"
                            onClick={() => {
                              setLocationOverride(undefined);
                              setPersistentLocation(undefined);
                            }}
                            className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-info/40 hover:bg-info-soft/40 hover:text-info"
                          >
                            Nearby areas
                          </button>
                        )}
                        {alternateActivitySuggestions.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => commitQuery(a)}
                            className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-info/40 hover:bg-info-soft/40 hover:text-info"
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
                    <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-600">
                      {RESULT_GROUP_LABELS[d.key]}
                    </h2>
                    <div className="space-y-4">
                      {d.sessions.map((s) => (
                        <SessionCard key={s.id} s={s} onSelect={setSelectedSession} density={density} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {/* ===================== QUICK ACTION SHEET =====================
          Recap is deliberately minimal: Activity + Centre only. Time is
          dropped entirely — it's fully visible on the card beneath and has
          no bearing on any action here. Centre stays, but as context for
          the actions (which are literally about that place), not as a
          repeat of browsing information. */}
      <Sheet
        open={!!selectedSession}
        onClose={() => setSelectedSession(null)}
        titleId="quick-action-title"
        desktopVariant="modal"
        narrow
        initialFocusRef={directionsRef}
        titleSlot={
          selectedSession &&
          (() => {
            const ActivityIcon = ACTIVITY_ICONS[getShortcutForActivity(selectedSession.activity) ?? ""];
            return (
              <p id="quick-action-title" className="flex min-w-0 items-center gap-2 text-[18px] font-bold leading-tight text-gray-900">
                {ActivityIcon && <ActivityIcon className="h-5 w-5 flex-shrink-0 text-gray-400" />}
                {selectedSession.activity}
              </p>
            );
          })()
        }
      >
        {selectedSession && (
          <>
            <p className="-mt-2 text-sm text-gray-500">{selectedSession.centre}</p>

            <a
              ref={directionsRef}
              href="#"
              onClick={(e) => e.preventDefault()}
              className="mt-5 grid w-full grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl bg-action px-4 py-3 text-sm font-semibold text-action-text transition-colors hover:bg-action/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
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
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-info/40 hover:bg-info-soft/40 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                >
                  <LinkIcon className="h-5 w-5" />
                  <span className="text-center">Website</span>
                  <span aria-hidden="true" />
                </a>
              )}
              {selectedSession.phone && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-info/40 hover:bg-info-soft/40 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
                >
                  <PhoneIcon className="h-5 w-5" />
                  <span className="text-center">Call</span>
                  <span aria-hidden="true" />
                </a>
              )}
              <button
                type="button"
                className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-info px-4 py-3 text-sm font-semibold text-info transition-colors hover:bg-info-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2"
              >
                <ShareIcon className="h-5 w-5" />
                <span className="text-center">Share</span>
                <span aria-hidden="true" />
              </button>
            </div>
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
        <p id="info-sheet-title" className="text-[18px] font-bold text-gray-900">
          About DropIn
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Helping people spend less time searching and more time being active. Discover nearby
          drop-in activities from official recreation providers — all in one place.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-info">Why DropIn</h3>
        <p className="mt-1 text-sm text-gray-600">
          Community recreation is one of the easiest ways to stay active — but finding what&rsquo;s
          actually on today usually means checking several different websites. DropIn brings it into
          one search.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-info">Our Data</h3>
        <p className="mt-1 text-sm text-gray-600">
          Schedules come directly from official recreation providers. Whenever possible, DropIn links
          straight to the official source to help keep information accurate.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-info">What You&rsquo;ll Find</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-gray-600">
          <li>Nearby activities, ranked by what&rsquo;s happening soonest</li>
          <li>Official schedules, not estimates</li>
          <li>Community centre details</li>
          <li>Quick directions to get you there</li>
        </ul>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-info">Feedback</h3>
        {feedbackStage === "idle" && (
          <p className="mt-1 text-sm text-gray-600">
            Found something that doesn&rsquo;t look right?{" "}
            <button
              type="button"
              onClick={() => setFeedbackStage("writing")}
              className="text-info underline underline-offset-2"
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
              className="w-full resize-none rounded-lg border border-gray-200 p-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-info focus:ring-2 focus:ring-info/40"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setFeedbackStage("idle");
                  setFeedbackText("");
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={feedbackText.trim().length === 0}
                onClick={() => setFeedbackStage("sent")}
                className="rounded-lg bg-action px-3 py-1.5 text-xs font-semibold text-action-text transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {feedbackStage === "sent" && (
          <p className="mt-1 rounded-lg border border-status/25 bg-status/10 px-3 py-2 text-sm text-status">
            Thanks — we&rsquo;ve received your note and will take a look.
          </p>
        )}

        <p className="mt-5 text-xs text-gray-400">DropIn · v1.0</p>
      </Sheet>
    </main>
  );
}
