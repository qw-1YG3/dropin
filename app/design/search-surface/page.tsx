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

type Day = "today" | "tomorrow";

type Session = {
  id: number;
  activity: string;
  day: Day;
  urgent: boolean;
  absoluteTime: string;
  centre: string;
  distanceKm: number;
  price: string;
  phone?: string;
  officialUrl?: string;
};

// Order already reflects a blended relevance ranking (soonest + closest +
// context) — never a user-facing sort choice, per the Decision Principle.
const SESSIONS: Session[] = [
  { id: 1, activity: "Lane Swim", day: "today", urgent: true, absoluteTime: "7:00–8:00 PM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6", phone: "416-555-0142", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/60/index.html" },
  { id: 2, activity: "Badminton", day: "today", urgent: true, absoluteTime: "6:45–8:00 PM", centre: "North York Community Centre", distanceKm: 3.2, price: "$8", phone: "416-555-0198", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/167/index.html" },
  { id: 3, activity: "Family Swim", day: "today", urgent: false, absoluteTime: "8:00–9:00 PM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$4" },
  { id: 4, activity: "Yoga", day: "today", urgent: false, absoluteTime: "7:00–8:00 PM", centre: "Mitchell Field Community Centre", distanceKm: 4.1, price: "Free", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/302/index.html" },
  { id: 5, activity: "Leisure Swim", day: "today", urgent: true, absoluteTime: "7:15–8:15 PM", centre: "Regent Park Aquatic Centre", distanceKm: 3.4, price: "$6", phone: "416-555-0177" },
  { id: 6, activity: "Lane Swim", day: "today", urgent: false, absoluteTime: "9:00–10:00 PM", centre: "North York Community Centre", distanceKm: 3.2, price: "$6", phone: "416-555-0198", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/167/index.html" },
  { id: 7, activity: "Women's Swim", day: "today", urgent: false, absoluteTime: "9:30–10:30 PM", centre: "Cecil Community Centre", distanceKm: 4.5, price: "Free", phone: "416-555-0163", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/88/index.html" },
  { id: 8, activity: "Basketball", day: "today", urgent: false, absoluteTime: "8:00–9:30 PM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$5", phone: "416-555-0111", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/54/index.html" },
  { id: 9, activity: "Pickleball", day: "today", urgent: false, absoluteTime: "9:00–10:00 PM", centre: "Regent Park Community Centre", distanceKm: 3.4, price: "$5" },
  { id: 10, activity: "Open Gym", day: "today", urgent: false, absoluteTime: "6:00–9:00 PM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "Free", phone: "416-555-0142", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/60/index.html" },
  { id: 11, activity: "Lane Swim", day: "tomorrow", urgent: false, absoluteTime: "6:00–7:00 AM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6", phone: "416-555-0142", officialUrl: "https://toronto.ca/data/parks/prd/facilities/complex/60/index.html" },
  { id: 12, activity: "Family Swim", day: "tomorrow", urgent: false, absoluteTime: "9:00–10:00 AM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$4", phone: "416-555-0111" },
  { id: 13, activity: "Leisure Swim", day: "tomorrow", urgent: false, absoluteTime: "10:00–11:00 AM", centre: "Mitchell Field Community Centre", distanceKm: 4.1, price: "$6" },
];

const SHORTCUTS = ["Badminton", "Swimming", "Pickleball", "Basketball", "Yoga", "Open Gym"];

const QUERY_GROUPS: Record<string, string[]> = {
  swimming: ["Lane Swim", "Leisure Swim", "Family Swim", "Women's Swim"],
  swim: ["Lane Swim", "Leisure Swim", "Family Swim", "Women's Swim"],
  badminton: ["Badminton"],
  pickleball: ["Pickleball"],
  basketball: ["Basketball"],
  yoga: ["Yoga"],
  "open gym": ["Open Gym"],
};

const SUGGESTION_POOL = ["Badminton", "Pickleball", "Basketball", "Swimming", "Lane Swim", "Leisure Swim", "Yoga", "Open Gym"];

const DAY_LABELS: Record<Day, string> = { today: "Today", tomorrow: "Tomorrow" };

function resolveActivities(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (QUERY_GROUPS[q]) return QUERY_GROUPS[q];
  const match = SESSIONS.find((s) => s.activity.toLowerCase().includes(q));
  return match ? [match.activity] : [];
}

function timeLabel(s: Session) {
  const prefix = s.day === "today" ? (s.urgent ? "Happening soon" : "Today") : "Tomorrow";
  return `${prefix} · ${s.absoluteTime}`;
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
            className={`mt-1.5 flex items-center gap-1.5 text-sm ${
              s.urgent ? "font-semibold text-accent" : "font-medium text-gray-700"
            }`}
          >
            {s.urgent && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" aria-hidden="true" />}
            {timeLabel(s)}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {s.centre} · {s.distanceKm} km
          </p>
        </div>
        <span className="flex-shrink-0 text-sm text-gray-500">{s.price}</span>
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
  const [loading, setLoading] = useState(true);
  const [locationLabel, setLocationLabel] = useState("Near you");
  const [editingLocation, setEditingLocation] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []);

  const suggestions = useMemo(() => {
    if (!suggestionsOpen || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    return SUGGESTION_POOL.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [query, suggestionsOpen]);

  const discoveryHighlights = useMemo(() => {
    const todayPool = SESSIONS.filter((s) => s.day === "today");
    if (discoveryFreeOnly) return todayPool.filter((s) => s.price === "Free");
    return todayPool.slice(0, 4);
  }, [discoveryFreeOnly]);

  const matchedActivities = useMemo(() => resolveActivities(committedQuery), [committedQuery]);

  const resultsFiltered = useMemo(() => {
    return SESSIONS.filter((s) => {
      if (!matchedActivities.includes(s.activity)) return false;
      if (timeWindow === "today" && s.day === "tomorrow") return false;
      if (activeFilter !== "All" && s.activity !== activeFilter) return false;
      return true;
    });
  }, [matchedActivities, activeFilter, timeWindow]);

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

      {/* ===================== QUICK ACTION SHEET ===================== */}
      <Sheet open={!!selectedSession} onClose={() => setSelectedSession(null)} titleId="quick-action-title">
        {selectedSession && (
          <>
            <p id="quick-action-title" className="text-[18px] font-bold text-gray-900">
              {selectedSession.activity}
            </p>
            <p className="mt-1 text-sm text-gray-600">{timeLabel(selectedSession)}</p>
            <p className="mt-1 text-sm text-gray-500">{selectedSession.centre}</p>

            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <DirectionsIcon className="h-4 w-4" />
              Directions
            </a>

            <div className="mt-2 grid grid-cols-3 gap-2">
              {selectedSession.officialUrl && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 py-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                >
                  <LinkIcon className="h-4 w-4" />
                  Website
                </a>
              )}
              {selectedSession.phone && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 py-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                >
                  <PhoneIcon className="h-4 w-4" />
                  Call
                </a>
              )}
              <button
                type="button"
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 py-2.5 text-xs font-medium text-gray-700 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
              >
                <ShareIcon className="h-4 w-4" />
                Share
              </button>
            </div>

            {!selectedSession.phone && !selectedSession.officialUrl && (
              <p className="mt-3 text-xs text-gray-400">
                No phone number or official page on file for this session yet.
              </p>
            )}
          </>
        )}
      </Sheet>

      {/* ===================== PRODUCT INFORMATION SHEET =====================
          Bottom sheet on mobile, centered modal from md: up — the Search
          Surface stays visible behind the scrim in both cases, only the
          dialog's own position/shape changes. */}
      <Sheet
        open={infoSheetOpen}
        onClose={() => setInfoSheetOpen(false)}
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

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Why DropIn</h3>
        <p className="mt-1 text-sm text-gray-600">
          Community recreation is one of the easiest ways to stay active — but finding what&rsquo;s
          actually on today usually means checking several different websites. DropIn brings it into
          one search.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Our Data</h3>
        <p className="mt-1 text-sm text-gray-600">
          Schedules come directly from official recreation providers. Whenever possible, DropIn links
          straight to the official source to help keep information accurate.
        </p>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">What You&rsquo;ll Find</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-gray-600">
          <li>Nearby activities, ranked by what&rsquo;s happening soonest</li>
          <li>Official schedules, not estimates</li>
          <li>Community centre details</li>
          <li>Quick directions to get you there</li>
        </ul>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Feedback</h3>
        <p className="mt-1 text-sm text-gray-600">
          Found something incorrect? Have an idea?{" "}
          <a href="#" onClick={(e) => e.preventDefault()} className="text-accent underline underline-offset-2">
            We&rsquo;d love to hear from you.
          </a>
        </p>

        <p className="mt-5 text-xs text-gray-400">DropIn · Design Preview · v0.1</p>
      </Sheet>
    </main>
  );
}
