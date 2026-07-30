"use client";

import { useMemo, useState } from "react";
import { PreviewHeader } from "../_components/PreviewHeader";

type Bucket = "now" | "later" | "tomorrow";

type Session = {
  id: number;
  activity: string;
  bucket: Bucket;
  relativeLabel: string | null;
  absoluteLabel: string;
  centre: string;
  distanceKm: number;
  price: string;
};

const SESSIONS: Session[] = [
  { id: 1, activity: "Lane Swim", bucket: "now", relativeLabel: "Starts in 12 min", absoluteLabel: "7:00–8:00 PM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6" },
  { id: 2, activity: "Leisure Swim", bucket: "now", relativeLabel: "Starts in 25 min", absoluteLabel: "7:15–8:15 PM", centre: "Regent Park Aquatic Centre", distanceKm: 3.4, price: "$6" },
  { id: 3, activity: "Family Swim", bucket: "later", relativeLabel: "Starts in 1 hr", absoluteLabel: "8:00–9:00 PM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$4" },
  { id: 4, activity: "Lane Swim", bucket: "later", relativeLabel: "Starts in 2 hr", absoluteLabel: "9:00–10:00 PM", centre: "North York Community Centre", distanceKm: 3.2, price: "$6" },
  { id: 5, activity: "Women's Swim", bucket: "later", relativeLabel: "Starts in 3 hr", absoluteLabel: "9:30–10:30 PM", centre: "Cecil Community Centre", distanceKm: 4.5, price: "Free" },
  { id: 6, activity: "Leisure Swim", bucket: "tomorrow", relativeLabel: null, absoluteLabel: "10:00–11:00 AM", centre: "Mitchell Field Community Centre", distanceKm: 4.1, price: "$6" },
  { id: 7, activity: "Lane Swim", bucket: "tomorrow", relativeLabel: null, absoluteLabel: "6:00–7:00 AM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6" },
  { id: 8, activity: "Family Swim", bucket: "tomorrow", relativeLabel: null, absoluteLabel: "9:00–10:00 AM", centre: "Wallace Emerson Community Centre", distanceKm: 1.8, price: "$4" },
];

const ACTIVITY_FILTERS = ["All", "Lane Swim", "Leisure Swim", "Family Swim", "Women's Swim"];

const BUCKET_LABELS: Record<Bucket, string> = {
  now: "Happening Now",
  later: "Later Today",
  tomorrow: "Tomorrow",
};

export default function ResultsLowFi() {
  const [query, setQuery] = useState("Swimming");
  const [activeFilter, setActiveFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"soonest" | "closest">("soonest");
  const [timeWindow, setTimeWindow] = useState<"today" | "week">("today");
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return SESSIONS.filter((s) => {
      if (timeWindow === "today" && s.bucket === "tomorrow") return false;
      if (activeFilter !== "All" && s.activity !== activeFilter) return false;
      return true;
    });
  }, [activeFilter, timeWindow]);

  const buckets = useMemo(() => {
    const order: Bucket[] = timeWindow === "week" ? ["now", "later", "tomorrow"] : ["now", "later"];
    return order
      .map((key) => ({ key, sessions: filtered.filter((s) => s.bucket === key) }))
      .filter((b) => b.sessions.length > 0);
  }, [filtered, timeWindow]);

  const flatByDistance = useMemo(
    () => [...filtered].sort((a, b) => a.distanceKm - b.distanceKm),
    [filtered]
  );

  function handleCardClick(s: Session) {
    setLastClicked(`${s.activity} at ${s.centre}`);
  }

  function Card({ s }: { s: Session }) {
    return (
      <button
        type="button"
        onClick={() => handleCardClick(s)}
        className="w-full rounded-lg border border-gray-200 p-3.5 text-left transition-colors hover:border-gray-400"
      >
        {/* 1. Activity Name — strongest element on the card */}
        <p className="text-base font-bold leading-tight text-gray-900">{s.activity}</p>

        {/* 2. Time — answers "can I still make it" before "what time is it" */}
        <p className="mt-1.5 text-sm font-semibold text-gray-800">
          {s.relativeLabel ?? s.absoluteLabel}
        </p>
        {s.relativeLabel && <p className="text-xs text-gray-400">{s.absoluteLabel}</p>}

        {/* 3 + 4. Community Centre + Distance — grouped as one "where" line */}
        <p className="mt-2 text-sm text-gray-500">
          {s.centre} · {s.distanceKm} km
        </p>

        {/* 5. Price — lightest element, last in reading order */}
        <p className="mt-1 text-xs text-gray-400">{s.price}</p>
      </button>
    );
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <PreviewHeader pageName="Results" stage="Low-Fidelity" version="V2" />

      <div className="mx-auto max-w-2xl px-4">
        {/* Search Bar — persistent, visually secondary */}
        <div className="border-b border-gray-100 py-3">
          <label htmlFor="results-search" className="sr-only">
            Search activities
          </label>
          <input
            id="results-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activities"
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-gray-400"
          />
        </div>

        {/* Filter Bar — horizontal scroll so it stays one fixed-height row regardless of activity count */}
        <div className="border-b border-gray-100 py-3">
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {ACTIVITY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={activeFilter === f}
                onClick={() => setActiveFilter(f)}
                className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs ${
                  activeFilter === f
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <span>Sort:</span>
              <button
                type="button"
                onClick={() => setSortBy("soonest")}
                className={sortBy === "soonest" ? "font-medium text-gray-900 underline" : "hover:text-gray-700"}
              >
                Soonest
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={() => setSortBy("closest")}
                className={sortBy === "closest" ? "font-medium text-gray-900 underline" : "hover:text-gray-700"}
              >
                Closest
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTimeWindow("today")}
                className={timeWindow === "today" ? "font-medium text-gray-900 underline" : "hover:text-gray-700"}
              >
                Today
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={() => setTimeWindow("week")}
                className={timeWindow === "week" ? "font-medium text-gray-900 underline" : "hover:text-gray-700"}
              >
                This Week
              </button>
            </div>
          </div>
        </div>

        {/* Results Count + Last Updated */}
        <div className="border-b border-gray-100 py-3 text-xs text-gray-400">
          {`${filtered.length} ${filtered.length === 1 ? "activity" : "activities"} · Last updated 3 hours ago`}
        </div>

        {/* Time Buckets + Activity Cards */}
        <div className="space-y-6 py-4">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No activities match this filter. Try a different activity or widen the time window.
            </p>
          ) : sortBy === "soonest" ? (
            buckets.map((b) => (
              <div key={b.key}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {BUCKET_LABELS[b.key]}
                </h2>
                <div className="space-y-2">
                  {b.sessions.map((s) => (
                    <Card key={s.id} s={s} />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-2">
              {flatByDistance.map((s) => (
                <Card key={s.id} s={s} />
              ))}
            </div>
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
