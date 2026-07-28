"use client";

import { useMemo, useState } from "react";
import { PreviewMeta } from "../_components/PreviewMeta";

const ACTIVITY_SUGGESTIONS = [
  "Badminton",
  "Pickleball",
  "Basketball",
  "Swimming",
  "Lane Swim",
  "Leisure Swim",
  "Yoga",
  "Pilates",
  "Public Skate",
  "Open Gym",
  "Weight Room",
];

const CHIPS = ["Badminton", "Swimming", "Pickleball", "Basketball", "Yoga", "Open Gym"];

const HAPPENING_SOON = [
  { activity: "Lane Swim", timing: "Starts in 20 min", distance: "2.1 km", walkIn: true },
  { activity: "Badminton", timing: "Today, 7:00–9:00 PM", distance: "3.2 km", walkIn: true },
  { activity: "Yoga", timing: "Tonight, 6:30 PM", distance: "4.1 km", walkIn: false },
];

export default function HomepageLowFi() {
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    if (!suggestionsOpen || query.trim().length === 0) return [];
    const q = query.trim().toLowerCase();
    return ACTIVITY_SUGGESTIONS.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  }, [query, suggestionsOpen]);

  function handlePickSuggestion(s: string) {
    setQuery(s);
    setSuggestionsOpen(false);
    setLastAction(s);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && query.trim().length > 0) {
      setSuggestionsOpen(false);
      setLastAction(query.trim());
    }
  }

  function handleChipClick(chip: string) {
    setSelectedChip(chip);
    setLastAction(chip);
  }

  function handleDiscoveryClick() {
    setSelectedChip(null);
    setLastAction("Anything nearby");
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <PreviewMeta pageName="Homepage" stage="Low-Fidelity" version="v1" />

      {/* 1. Header — Tertiary chrome, kept minimal */}
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <span className="text-base font-semibold tracking-tight">DropIn</span>
        <span className="text-sm text-gray-500">Toronto</span>
      </header>

      {/* 2 + 3. Headline + Search — Primary */}
      <section className="px-4 pt-8 pb-5 sm:pt-12">
        <div className="mx-auto max-w-xl">
          <h1 className="mb-5 text-2xl font-semibold text-gray-900 sm:text-3xl">
            What would you like to do today?
          </h1>

          <div className="relative">
            <label htmlFor="activity-search" className="sr-only">
              Search activities
            </label>
            <input
              id="activity-search"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestionsOpen(true);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search activities"
              className="w-full rounded-lg border-2 border-gray-900 px-4 py-3.5 text-base text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-gray-900/20"
            />

            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => handlePickSuggestion(s)}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 4 + 5. Activity chips + Discovery entry — Secondary */}
      <section className="px-4 pb-6">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 flex flex-wrap gap-2">
            {CHIPS.map((chip) => {
              const active = selectedChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleChipClick(chip)}
                  className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-300 text-gray-700 hover:border-gray-500"
                  }`}
                >
                  {chip}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleDiscoveryClick}
            className="text-sm font-medium text-gray-700 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-600"
          >
            Show me what&rsquo;s available nearby
          </button>

          {lastAction && (
            <p className="mt-2 text-xs text-gray-400">
              Preview only — would open Results for &ldquo;{lastAction}&rdquo;.
            </p>
          )}
        </div>
      </section>

      {/* 6. Happening Soon preview strip — Tertiary */}
      <section className="border-t border-gray-100 px-4 py-6">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Happening soon near you
          </h2>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0">
            {HAPPENING_SOON.map((item) => (
              <div
                key={item.activity}
                className="min-w-[150px] flex-shrink-0 rounded-lg border border-gray-200 p-3 sm:min-w-0"
              >
                <p className="text-sm font-medium text-gray-900">{item.activity}</p>
                <p className="mt-1 text-xs text-gray-600">{item.timing}</p>
                <p className="mt-0.5 text-xs text-gray-500">{item.distance}</p>
                {item.walkIn && <p className="mt-0.5 text-xs text-gray-500">Walk-in</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Data transparency / footer — Tertiary */}
      <footer className="border-t border-gray-100 px-4 py-6 text-center">
        <p className="text-xs text-gray-400">Data from Toronto Open Data &middot; Updated recently</p>
        <p className="mt-2 text-xs text-gray-300">About &middot; Coverage &middot; Contact</p>
      </footer>
    </main>
  );
}
