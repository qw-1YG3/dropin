"use client";

// Colour-and-atmosphere exploration only, iteration 2 — forked from the
// production component (app/page.tsx) because this round's requests
// (a tinted Discovery area, section-label markers, stronger selected/hover
// states) need small markup additions, not just a CSS-variable swap at the
// root. Every non-colour line below is unchanged from production: same
// state machine, same search/filter/ranking logic, same layout, same
// typography, same spacing. Diff against app/page.tsx to verify — the only
// edits are className colour/shadow values and the handful of small
// decorative additions called out in the accompanying explanation.

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "../../_components/Sheet";
import {
  ACTIVITY_ICONS,
  DirectionsIcon,
  InfoIcon,
  LinkIcon,
  LocationIcon,
  PhoneIcon,
  SearchIcon,
  ShareIcon,
} from "../../_components/icons";
import { ACTIVITY_GROUPS, getShortcutForActivity, SHORTCUTS } from "@/lib/dropin/activities";
import { getDisplayDistrict } from "@/lib/dropin/districts";
import { parseQuery, sessionMatchesLocation, type DetectedLocation } from "@/lib/dropin/search-intent";
import { sessionStatus } from "@/lib/dropin/time";
import type { Day, Session } from "@/lib/dropin/types";

const SUGGESTION_POOL = ["Badminton", "Pickleball", "Basketball", "Swimming", "Lane Swim", "Leisure Swim", "Yoga", "Open Gym", "Table Tennis"];

const DAY_LABELS: Record<Day, string> = { today: "Today", tomorrow: "Tomorrow" };

// This exploration snapshot predates the production session-status model
// (lib/dropin/time.ts's sessionStatus) and the removal of Session.urgent —
// it's a frozen colour/atmosphere fork, not wired to live production
// changes, so it gets the smallest possible local shim rather than being
// migrated to the newer date/status architecture the rest of this file
// doesn't use either.
function isSessionUrgent(s: Session): boolean {
  const status = sessionStatus(new Date(s.startDateTime), new Date(s.endDateTime), new Date());
  return status === "starting-soon" || status === "in-progress";
}

function timeLabel(s: Session) {
  const prefix = s.day === "today" ? (isSessionUrgent(s) ? "Happening soon" : "Today") : "Tomorrow";
  return `${prefix} · ${s.absoluteTime}`;
}

function secondaryActionCount(s: Session) {
  return 1 + (s.officialUrl ? 1 : 0) + (s.phone ? 1 : 0);
}

// A small accent marker beside section labels — the one purely decorative
// addition in this exploration, used to test whether a tiny localized
// accent reads as "energy" without adding a feature or changing hierarchy.
function LabelMarker() {
  return <span className="mr-2 inline-block h-2.5 w-1 rounded-full bg-accent align-middle" aria-hidden="true" />;
}

function SessionCard({ s, onSelect }: { s: Session; onSelect: (s: Session) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(s)}
      className="w-full rounded-2xl border border-gray-100 bg-white p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/15 hover:shadow-[0_8px_24px_-4px_rgba(33,129,107,0.16)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[18px] font-bold leading-tight text-gray-900">{s.activity}</p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-sm ${
              isSessionUrgent(s) ? "font-semibold text-accent" : "font-medium text-gray-700"
            }`}
          >
            {isSessionUrgent(s) && (
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full bg-accent ring-2 ring-accent/25"
                aria-hidden="true"
              />
            )}
            {timeLabel(s)}
          </p>
          <p className="mt-4 text-sm text-gray-600">
            {s.centre}
            {s.distanceKm !== undefined && ` · ${s.distanceKm} km`}
          </p>
        </div>
        {s.price && <span className="flex-shrink-0 text-sm text-gray-600">{s.price}</span>}
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

export default function SearchSurfaceV2() {
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
  const [persistentLocation, setPersistentLocation] = useState<DetectedLocation | undefined>(undefined);
  const [locationOverride, setLocationOverride] = useState<DetectedLocation | undefined>(undefined);
  const [queryMiss, setQueryMiss] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const directionsRef = useRef<HTMLAnchorElement>(null);

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

    const ranked = [...pool].sort((a, b) => Number(isSessionUrgent(b)) - Number(isSessionUrgent(a)));
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

  const resultsByDay = useMemo(() => {
    const order: Day[] = timeWindow === "week" ? ["today", "tomorrow"] : ["today"];
    return order
      .map((key) => ({ key, sessions: resultsFiltered.filter((s) => s.day === key) }))
      .filter((d) => d.sessions.length > 0);
  }, [resultsFiltered, timeWindow]);

  const isUnavailableMunicipality = effectiveLocation?.type === "municipality" && effectiveLocation.status === "not-yet-available";

  const emptyStateMessage = useMemo(() => {
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
      setPersistentLocation(result.location);
      setLocationOverride(undefined);
    } else if (result.location) {
      setLocationOverride(result.location);
    } else {
      setLocationOverride(undefined);
    }
  }

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

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    [],
  );

  return (
    <main className="min-h-screen bg-surface text-gray-900">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-4">
          <span className="text-lg font-semibold tracking-tight text-gray-900">DropIn</span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-sm text-gray-600">
              <LocationIcon className="h-4 w-4 text-gray-400" />
              {effectiveLocation ? effectiveLocation.label : "Near you"}
            </span>
            <button
              type="button"
              aria-label="About DropIn"
              onClick={() => setInfoSheetOpen(true)}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <InfoIcon className="h-5 w-5" />
            </button>
          </div>
        </header>

        <p className="text-base font-medium text-gray-600">Today · {todayLabel}</p>

        <div className={`relative ${large ? "pt-3 pb-6" : "py-4"}`}>
          <label htmlFor="surface-search-v2" className="sr-only">
            Search activities, community centres or places
          </label>
          <div className="relative">
            <SearchIcon
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-gray-500 ${large ? "left-4 h-5 w-5" : "left-3.5 h-4 w-4"}`}
            />
            <input
              ref={inputRef}
              id="surface-search-v2"
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search activities, community centres or places"
              className={`w-full rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_2px_8px_rgba(16,24,40,0.04)] outline-none transition-all duration-200 placeholder:text-gray-500 hover:border-gray-300 focus:border-accent focus:shadow-none focus:ring-4 focus:ring-accent/10 ${
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
                    className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors duration-100 hover:bg-accent-soft hover:text-accent"
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
          <section className="-mx-4 rounded-3xl bg-accent-soft/40 px-4 py-4 pb-10 sm:-mx-6 sm:px-6">
            {queryMiss && (
              <p className="mb-4 rounded-xl bg-white px-4 py-3 text-sm text-gray-600">
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
                    className="group flex flex-shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:border-accent/50 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    <Icon className="h-4 w-4 text-gray-400 transition-colors duration-150 group-hover:text-accent" />
                    {chip}
                  </button>
                );
              })}
              <span className="my-1 w-px flex-shrink-0 self-stretch bg-gray-200" aria-hidden="true" />
              <button
                type="button"
                aria-pressed={discoveryFreeOnly}
                onClick={() => setDiscoveryFreeOnly((v) => !v)}
                className={`flex-shrink-0 rounded-full border px-3.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                  discoveryFreeOnly
                    ? "border-accent bg-accent font-semibold text-white shadow-[0_2px_8px_rgba(33,129,107,0.25)]"
                    : "border-gray-200 bg-white font-medium text-gray-600 hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                }`}
              >
                Free
              </button>
            </div>

            <h2 className="mb-3 flex items-center text-xs font-medium uppercase tracking-wide text-gray-600">
              <LabelMarker />
              {persistentLocation ? `Happening in ${persistentLocation.label}` : "Happening near you"}
            </h2>

            {loading ? (
              <div className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : discoveryHighlights.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-200 bg-white py-8 text-center text-sm text-gray-500">
                Nothing free right now nearby.{" "}
                <button type="button" onClick={() => setDiscoveryFreeOnly(false)} className="text-accent underline underline-offset-2">
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
                    className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                      active
                        ? "border-accent bg-accent font-semibold text-white shadow-[0_2px_8px_rgba(33,129,107,0.25)]"
                        : "border-gray-200 bg-white font-medium text-gray-600 hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
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
                className={timeWindow === "today" ? "font-semibold text-accent underline underline-offset-2" : "hover:text-accent"}
              >
                Today
              </button>
              <span className="text-gray-300">/</span>
              <button
                type="button"
                onClick={() => setTimeWindow("week")}
                className={timeWindow === "week" ? "font-semibold text-accent underline underline-offset-2" : "hover:text-accent"}
              >
                This Week
              </button>
            </div>

            <div className="border-t border-gray-200/70 py-4 text-xs text-gray-600">
              {`${resultsFiltered.length} ${resultsFiltered.length === 1 ? "activity" : "activities"} · Last updated 3 hours ago`}
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
                        className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                      >
                        Show Toronto instead
                      </button>
                    ) : (
                      <>
                        {timeWindow === "today" && (
                          <button
                            type="button"
                            onClick={() => setTimeWindow("week")}
                            className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
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
                            className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                          >
                            Nearby areas
                          </button>
                        )}
                        {alternateActivitySuggestions.map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => commitQuery(a)}
                            className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
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
                    <h2 className="mb-3 flex items-center text-xs font-medium uppercase tracking-wide text-gray-600">
                      <LabelMarker />
                      {DAY_LABELS[d.key]}
                    </h2>
                    <div className="space-y-4">
                      {d.sessions.map((s) => (
                        <SessionCard key={s.id} s={s} onSelect={setSelectedSession} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      <Sheet
        open={!!selectedSession}
        onClose={() => setSelectedSession(null)}
        titleId="quick-action-title-v2"
        desktopVariant="modal"
        narrow
        initialFocusRef={directionsRef}
        titleSlot={
          selectedSession &&
          (() => {
            const ActivityIcon = ACTIVITY_ICONS[getShortcutForActivity(selectedSession.activity) ?? ""];
            return (
              <p id="quick-action-title-v2" className="flex min-w-0 items-center gap-2 text-[18px] font-bold leading-tight text-gray-900">
                {ActivityIcon && <ActivityIcon className="h-5 w-5 flex-shrink-0 text-gray-400" />}
                {selectedSession.activity}
              </p>
            );
          })()
        }
      >
        {selectedSession && (
          <>
            <p className="-mt-2 text-sm text-gray-600">{selectedSession.centre}</p>

            <a
              ref={directionsRef}
              href="#"
              onClick={(e) => e.preventDefault()}
              className="mt-5 grid w-full grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
                  className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
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
                  className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  <PhoneIcon className="h-5 w-5" />
                  <span className="text-center">Call</span>
                  <span aria-hidden="true" />
                </a>
              )}
              <button
                type="button"
                className="grid grid-cols-[20px_1fr_20px] items-center gap-3 rounded-xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <ShareIcon className="h-5 w-5" />
                <span className="text-center">Share</span>
                <span aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={infoSheetOpen}
        onClose={() => {
          setInfoSheetOpen(false);
          setFeedbackStage("idle");
          setFeedbackText("");
        }}
        titleId="info-sheet-title-v2"
        desktopVariant="modal"
      >
        <p id="info-sheet-title-v2" className="text-[18px] font-bold text-gray-900">
          About DropIn
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Helping people spend less time searching and more time being active. Discover nearby
          drop-in activities from official recreation providers — all in one place.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-accent">Why DropIn</h3>
        <p className="mt-1 text-sm text-gray-600">
          Community recreation is one of the easiest ways to stay active — but finding what&rsquo;s
          actually on today usually means checking several different websites. DropIn brings it into
          one search.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-accent">Our Data</h3>
        <p className="mt-1 text-sm text-gray-600">
          Schedules come directly from official recreation providers. Whenever possible, DropIn links
          straight to the official source to help keep information accurate.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-accent">What You&rsquo;ll Find</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-gray-600">
          <li>Nearby activities, ranked by what&rsquo;s happening soonest</li>
          <li>Official schedules, not estimates</li>
          <li>Community centre details</li>
          <li>Quick directions to get you there</li>
        </ul>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-accent">Feedback</h3>
        {feedbackStage === "idle" && (
          <p className="mt-1 text-sm text-gray-600">
            Found something that doesn&rsquo;t look right?{" "}
            <button
              type="button"
              onClick={() => setFeedbackStage("writing")}
              className="text-accent underline underline-offset-2"
            >
              Let us know.
            </button>
          </p>
        )}

        {feedbackStage === "writing" && (
          <div className="mt-1.5">
            <label htmlFor="feedback-text-v2" className="sr-only">
              Your note to DropIn
            </label>
            <textarea
              id="feedback-text-v2"
              autoFocus
              rows={3}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What looks wrong? A time, price, or address that's off..."
              className="w-full resize-none rounded-lg border border-gray-200 p-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-accent focus:ring-2 focus:ring-accent/40"
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
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        )}

        {feedbackStage === "sent" && (
          <p className="mt-1 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-sm text-accent">
            Thanks — we&rsquo;ve received your note and will take a look.
          </p>
        )}

        <p className="mt-5 text-xs text-gray-400">DropIn · v1.0</p>
      </Sheet>
    </main>
  );
}
