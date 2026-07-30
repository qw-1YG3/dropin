"use client";

import { useMemo, useState } from "react";
import { PreviewHeader } from "../_components/PreviewHeader";
import { SearchIcon } from "../_components/icons";

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
};

// Order within each day already reflects a blended relevance ranking
// (soonest + closest + context) — not a user-facing sort choice.
const SESSIONS: Session[] = [
  { id: 1, activity: "Lane Swim", day: "today", urgent: true, absoluteTime: "7:00–8:00 PM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6" },
  { id: 2, activity: "Family Swim", day: "today", urgent: false, absoluteTime: "8:00–9:00 PM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$4" },
  { id: 3, activity: "Leisure Swim", day: "today", urgent: true, absoluteTime: "7:15–8:15 PM", centre: "Regent Park Aquatic Centre", distanceKm: 3.4, price: "$6" },
  { id: 4, activity: "Lane Swim", day: "today", urgent: false, absoluteTime: "9:00–10:00 PM", centre: "North York Community Centre", distanceKm: 3.2, price: "$6" },
  { id: 5, activity: "Women's Swim", day: "today", urgent: false, absoluteTime: "9:30–10:30 PM", centre: "Cecil Community Centre", distanceKm: 4.5, price: "Free" },
  { id: 6, activity: "Lane Swim", day: "tomorrow", urgent: false, absoluteTime: "6:00–7:00 AM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6" },
  { id: 7, activity: "Family Swim", day: "tomorrow", urgent: false, absoluteTime: "9:00–10:00 AM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$4" },
  { id: 8, activity: "Leisure Swim", day: "tomorrow", urgent: false, absoluteTime: "10:00–11:00 AM", centre: "Mitchell Field Community Centre", distanceKm: 4.1, price: "$6" },
];

const ACTIVITY_FILTERS = ["All", "Lane Swim", "Leisure Swim", "Family Swim", "Women's Swim"];

const DAY_LABELS: Record<Day, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
};

function timeLabel(s: Session) {
  const prefix = s.day === "today" ? (s.urgent ? "Happening soon" : "Today") : "Tomorrow";
  return `${prefix} · ${s.absoluteTime}`;
}

export default function ResultsHighFi() {
  const [query, setQuery] = useState("Swimming");
  const [activeFilter, setActiveFilter] = useState("All");
  const [timeWindow, setTimeWindow] = useState<"today" | "week">("today");
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return SESSIONS.filter((s) => {
      if (timeWindow === "today" && s.day === "tomorrow") return false;
      if (activeFilter !== "All" && s.activity !== activeFilter) return false;
      return true;
    });
  }, [activeFilter, timeWindow]);

  const days = useMemo(() => {
    const order: Day[] = timeWindow === "week" ? ["today", "tomorrow"] : ["today"];
    return order
      .map((key) => ({ key, sessions: filtered.filter((s) => s.day === key) }))
      .filter((d) => d.sessions.length > 0);
  }, [filtered, timeWindow]);

  function handleCardClick(s: Session) {
    setLastClicked(`${s.activity} at ${s.centre}`);
  }

  function Card({ s }: { s: Session }) {
    return (
      <button
        type="button"
        onClick={() => handleCardClick(s)}
        className="w-full rounded-2xl border border-gray-100 bg-white p-5 text-left transition-shadow duration-200 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left — descriptive: what is this activity */}
          <div>
            <p className="text-[18px] font-bold leading-tight text-gray-900">{s.activity}</p>
            <p
              className={`mt-1.5 text-[15px] ${
                s.urgent ? "font-semibold text-accent" : "font-medium text-gray-700"
              }`}
            >
              {timeLabel(s)}
            </p>
            <p className="mt-2 text-sm text-gray-500">
              {s.centre} · {s.distanceKm} km
            </p>
          </div>

          {/* Right — decision signal slot: minimally populated with Price for MVP,
              architecturally free to hold other lightweight signals later */}
          <span className="flex-shrink-0 text-xs text-gray-500">{s.price}</span>
        </div>
      </button>
    );
  }

  return (
    <main className="min-h-screen bg-surface text-gray-900">
      <PreviewHeader pageName="Results" stage="High-Fidelity" version="V1" />

      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        {/* Search Bar — same shape language as Homepage, meaningfully quieter */}
        <div className="py-5">
          <label htmlFor="results-search" className="sr-only">
            Search activities
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              id="results-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search activities"
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-700 shadow-sm outline-none transition-colors duration-150 placeholder:text-gray-400 hover:border-gray-300 focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </div>
        </div>

        {/* Filter Bar — activity narrowing + Time Scope. No manual sort control:
            ranking is always the system's blended relevance score. */}
        <div className="pb-5">
          <p className="mb-2 text-xs text-gray-500">{`Types of ${query || "this activity"}:`}</p>
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {ACTIVITY_FILTERS.map((f) => {
              const active = activeFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveFilter(f)}
                  className={`flex-shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                    active
                      ? "border-accent bg-accent text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
                  }`}
                >
                  {f}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <button
              type="button"
              onClick={() => setTimeWindow("today")}
              className={
                timeWindow === "today"
                  ? "font-semibold text-accent underline underline-offset-2"
                  : "hover:text-gray-700"
              }
            >
              Today
            </button>
            <span className="text-gray-300">/</span>
            <button
              type="button"
              onClick={() => setTimeWindow("week")}
              className={
                timeWindow === "week"
                  ? "font-semibold text-accent underline underline-offset-2"
                  : "hover:text-gray-700"
              }
            >
              This Week
            </button>
          </div>
        </div>

        {/* Results Count + Last Updated */}
        <div className="border-t border-gray-200/70 py-4 text-xs text-gray-400">
          {`${filtered.length} ${filtered.length === 1 ? "activity" : "activities"} · Last updated 3 hours ago`}
        </div>

        {/* Day Groups + Activity Cards */}
        <div className="space-y-8 pb-4">
          {filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">
              No activities match this filter. Try a different activity or widen the time window.
            </p>
          ) : (
            days.map((d) => (
              <div key={d.key}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {DAY_LABELS[d.key]}
                </h2>
                <div className="space-y-3">
                  {d.sessions.map((s) => (
                    <Card key={s.id} s={s} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {lastClicked && (
          <p className="pb-6 text-xs text-gray-400">
            Preview only — would open Activity Detail for &ldquo;{lastClicked}&rdquo;.
          </p>
        )}
      </div>
    </main>
  );
}
