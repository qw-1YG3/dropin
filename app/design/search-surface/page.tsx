"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PreviewHeader } from "../_components/PreviewHeader";
import { Sheet } from "../_components/Sheet";
import {
  ACTIVITY_ICONS,
  DirectionsIcon,
  InfoIcon,
  LinkIcon,
  LocationIcon,
  PhoneIcon,
  SearchIcon,
  ShareIcon,
} from "../_components/icons";
import { ACTIVITY_GROUPS, SHORTCUTS } from "@/lib/dropin/activities";
import type { Day, Session } from "@/lib/dropin/types";

const SUGGESTION_POOL = ["Badminton", "Pickleball", "Basketball", "Swimming", "Lane Swim", "Leisure Swim", "Yoga", "Open Gym"];

const DAY_LABELS: Record<Day, string> = { today: "Today", tomorrow: "Tomorrow" };

function resolveActivities(query: string, sessions: Session[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (ACTIVITY_GROUPS[q]) return ACTIVITY_GROUPS[q];
  const match = sessions.find((s) => s.activity.toLowerCase().includes(q));
  return match ? [match.activity] : [];
}

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

function SessionCard({ s, onSelect }: { s: Session; onSelect: (s: Session) => void }) {
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
            className={`mt-1 flex items-center gap-1.5 text-sm ${
              s.urgent ? "font-semibold text-accent" : "font-medium text-gray-700"
            }`}
          >
            {s.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" aria-hidden="true" />}
            {timeLabel(s)}
          </p>
          <p className="mt-3 text-sm text-gray-500">
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
  const [locationLabel, setLocationLabel] = useState("Near you");
  const [editingLocation, setEditingLocation] = useState(false);
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

  const discoveryHighlights = useMemo(() => {
    const todayPool = sessions.filter((s) => s.day === "today");
    if (discoveryFreeOnly) return todayPool.filter((s) => s.price === "Free");
    // Urgent (happening-soon) sessions always surface first in the top-4 —
    // relevance the user can act on immediately shouldn't lose to array order.
    const ranked = [...todayPool].sort((a, b) => Number(b.urgent) - Number(a.urgent));
    return ranked.slice(0, 4);
  }, [sessions, discoveryFreeOnly]);

  const matchedActivities = useMemo(() => resolveActivities(committedQuery, sessions), [committedQuery, sessions]);

  const resultsFiltered = useMemo(() => {
    return sessions.filter((s) => {
      if (!matchedActivities.includes(s.activity)) return false;
      if (timeWindow === "today" && s.day === "tomorrow") return false;
      if (activeFilter !== "All" && s.activity !== activeFilter) return false;
      return true;
    });
  }, [sessions, matchedActivities, activeFilter, timeWindow]);

  const resultsByDay = useMemo(() => {
    const order: Day[] = timeWindow === "week" ? ["today", "tomorrow"] : ["today"];
    return order
      .map((key) => ({ key, sessions: resultsFiltered.filter((s) => s.day === key) }))
      .filter((d) => d.sessions.length > 0);
  }, [resultsFiltered, timeWindow]);

  function commitQuery(q: string) {
    setQuery(q);
    setCommittedQuery(q);
    setSuggestionsOpen(false);
    setActiveFilter("All");
    setTimeWindow("today");
    setSurfaceState("results");
  }

  function handleInputChange(value: string) {
    setQuery(value);
    setSuggestionsOpen(true);
    if (surfaceState === "results" && value.trim() === "") {
      setSurfaceState("discovery");
      setCommittedQuery("");
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim().length > 0) commitQuery(query.trim());
    if (e.key === "Escape") setSuggestionsOpen(false);
  }

  const large = surfaceState === "discovery";

  return (
    <main className="min-h-screen bg-surface text-gray-900">
      <PreviewHeader pageName="Search Surface" stage="High-Fidelity" version="V1" />

      {/* Persistent header — present across every state */}
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <header className="flex items-center justify-between py-4">
          <span className="text-lg font-semibold tracking-tight text-gray-900">DropIn</span>
          <div className="flex items-center gap-3">
            {editingLocation ? (
              <input
                autoFocus
                defaultValue={locationLabel === "Near you" ? "" : locationLabel}
                placeholder="Postal code or neighbourhood"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    setLocationLabel(v || "Near you");
                    setEditingLocation(false);
                  }
                  if (e.key === "Escape") setEditingLocation(false);
                }}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  setLocationLabel(v || "Near you");
                  setEditingLocation(false);
                }}
                className="w-36 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-700 outline-none focus:border-accent"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingLocation(true)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-accent"
              >
                <LocationIcon className="h-4 w-4 text-gray-400" />
                {locationLabel}
              </button>
            )}
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

        {/* Search — persists across every state, changing prominence rather
            than disappearing. No headline above it: Discovery already shows
            real results, so nothing needs to ask "what do you want" first. */}
        <div className={`relative ${large ? "pt-2 pb-5" : "py-4"}`}>
          <label htmlFor="surface-search" className="sr-only">
            Search activities or locations
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
              placeholder="Search activities or locations"
              className={`w-full rounded-2xl border border-gray-200 bg-white text-gray-900 shadow-sm outline-none transition-all duration-200 placeholder:text-gray-500 hover:border-gray-300 focus:border-accent focus:ring-2 focus:ring-accent/40 ${
                large ? "py-4 pl-12 pr-4 text-base" : "py-2.5 pl-10 pr-4 text-sm"
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
          <section className="pb-10">
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
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
                    ? "border-accent bg-accent font-semibold text-white"
                    : "border-gray-200 bg-white font-medium text-gray-600 hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                }`}
              >
                Free
              </button>
            </div>

            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Happening near you
            </h2>

            {loading ? (
              <div className="space-y-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : discoveryHighlights.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500">
                Nothing free right now nearby.{" "}
                <button type="button" onClick={() => setDiscoveryFreeOnly(false)} className="text-accent underline underline-offset-2">
                  Show everything
                </button>
              </p>
            ) : (
              <div className="space-y-3">
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
              {["All", ...matchedActivities].map((f) => {
                const active = activeFilter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveFilter(f)}
                    className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                      active
                        ? "border-accent bg-accent font-semibold text-white"
                        : "border-gray-200 bg-white font-medium text-gray-600 hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                    }`}
                  >
                    {f}
                  </button>
                );
              })}
            </div>

            <div className="mb-4 flex items-center gap-1.5 text-sm text-gray-500">
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

            <div className="border-t border-gray-200/70 py-4 text-xs text-gray-500">
              {`${resultsFiltered.length} ${resultsFiltered.length === 1 ? "activity" : "activities"} · Last updated 3 hours ago`}
            </div>

            <div className="space-y-8">
              {resultsFiltered.length === 0 ? (
                <p className="py-16 text-center text-sm text-gray-500">
                  No activities match this filter. Try a different activity or widen the time window.
                </p>
              ) : (
                resultsByDay.map((d) => (
                  <div key={d.key}>
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {DAY_LABELS[d.key]}
                    </h2>
                    <div className="space-y-3">
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
        initialFocusRef={directionsRef}
      >
        {selectedSession && (
          <>
            <p id="quick-action-title" className="text-[18px] font-bold leading-tight text-gray-900">
              {selectedSession.activity}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">{selectedSession.centre}</p>

            <a
              ref={directionsRef}
              href="#"
              onClick={(e) => e.preventDefault()}
              className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <DirectionsIcon className="h-4 w-4" />
              Directions
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
                  className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 py-3 text-xs font-medium text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  <LinkIcon className="h-4 w-4" />
                  Website
                </a>
              )}
              {selectedSession.phone && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 py-3 text-xs font-medium text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  <PhoneIcon className="h-4 w-4" />
                  Call
                </a>
              )}
              <button
                type="button"
                className="flex flex-col items-center gap-1 rounded-xl border border-accent py-3 text-xs font-medium text-gray-700 transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <ShareIcon className="h-4 w-4" />
                Share
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

        <p className="mt-5 text-xs text-gray-400">DropIn · Design Preview · v0.1</p>
      </Sheet>
    </main>
  );
}
