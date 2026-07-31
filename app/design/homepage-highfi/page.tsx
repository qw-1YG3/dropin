"use client";

import { useMemo, useState } from "react";
import { PreviewHeader } from "../_components/PreviewHeader";
import { ACTIVITY_ICONS, LocationIcon, SearchIcon } from "../_components/icons";

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
  {
    activity: "Lane Swim",
    urgent: true,
    timing: "Starts in 20 min",
    centre: "Douglas Snow Aquatic Centre",
    distance: "2.1 km",
  },
  {
    activity: "Badminton",
    urgent: false,
    timing: "Today, 7:00–9:00 PM",
    centre: "North York Community Centre",
    distance: "3.2 km",
  },
  {
    activity: "Yoga",
    urgent: false,
    timing: "Tonight, 6:30 PM",
    centre: "Mitchell Field Community Centre",
    distance: "4.1 km",
  },
];

export default function HomepageHighFi() {
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
    setSelectedChip((prev) => (prev === chip ? null : chip));
    setLastAction(chip);
  }

  function handleDiscoveryClick() {
    setSelectedChip(null);
    setLastAction("Anything nearby");
  }

  return (
    <main className="min-h-screen bg-surface text-gray-900">
      <PreviewHeader pageName="Homepage" stage="High-Fidelity" version="V2" />

      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        {/* 1. Header — quiet, does not compete with search */}
        <header className="flex items-center justify-between py-4">
          <span className="text-lg font-semibold tracking-tight text-gray-900">DropIn</span>
          <span className="flex items-center gap-1 text-sm text-gray-500">
            <LocationIcon className="h-4 w-4 text-gray-400" />
            Toronto
          </span>
        </header>

        {/* 2 + 3. Headline + Search — Primary. This is the reference search bar
            every other search input (including Results) inherits shape and
            behaviour from — larger scale and more padding, same radius,
            same colour rules. */}
        <section className="pt-6 pb-6 sm:pt-9">
          <h1 className="mb-5 text-[1.75rem] font-semibold leading-tight tracking-tight text-gray-900 sm:text-4xl">
            What would you like to do today?
          </h1>

          <div className="relative">
            <label htmlFor="activity-search" className="sr-only">
              Search activities or locations
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
              <input
                id="activity-search"
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSuggestionsOpen(true);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search activities or locations"
                className="w-full rounded-2xl border border-gray-200 bg-white py-4 pl-12 pr-4 text-base text-gray-900 shadow-sm outline-none transition-colors duration-150 placeholder:text-gray-500 hover:border-gray-300 focus:border-accent focus:ring-2 focus:ring-accent/40"
              />
            </div>

            {suggestions.length > 0 && (
              <ul className="dropdown-enter absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => handlePickSuggestion(s)}
                      className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition-colors duration-100 hover:bg-accent-soft hover:text-accent"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 4 + 5. Activity chips + Discovery entry — Secondary.
            Chips keep icons here (Homepage is the "which activity" recognition
            moment); Results chips stay text-only (narrowing a known search) —
            documented, intentional difference, not an inconsistency. */}
        <section className="pb-8">
          <div className="mb-4 flex flex-wrap gap-2">
            {CHIPS.map((chip) => {
              const Icon = ACTIVITY_ICONS[chip];
              const active = selectedChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleChipClick(chip)}
                  className={`group inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
                    active
                      ? "border-accent bg-accent font-semibold text-white"
                      : "border-gray-200 bg-white font-medium text-gray-700 hover:border-accent/50 hover:bg-accent-soft hover:text-accent"
                  }`}
                >
                  <Icon className={active ? "h-4 w-4 text-white" : "h-4 w-4 text-gray-400 transition-colors duration-150 group-hover:text-accent"} />
                  {chip}
                </button>
              );
            })}
          </div>

          {/* Discovery CTA — teal only on hover/focus now, no permanent tinted
              fill at rest. A large resting-state colour surface is exactly what
              the revised colour philosophy rules out; the pill shape + icon +
              border keep it noticeable without needing a colour crutch. */}
          <button
            type="button"
            onClick={handleDiscoveryClick}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors duration-150 hover:border-accent/50 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <LocationIcon className="h-4 w-4" />
            Show me what&rsquo;s available nearby
          </button>

          {lastAction && (
            <p className="mt-3 text-xs text-gray-500">
              Preview only — would open Results for &ldquo;{lastAction}&rdquo;.
            </p>
          )}
        </section>
      </div>

      {/* 6. Happening Soon preview strip — Tertiary, demonstrates Real-Time
          Confidence. Card language now matches Results exactly: same name
          size/weight, same urgency-conditional time treatment (dot + teal
          only when genuinely imminent), same combined centre+distance line,
          same padding, same hover (shadow only, no translate). Walk-in badge
          removed — Results deliberately doesn't claim access-status certainty,
          so neither should this preview. */}
      <section className="border-t border-gray-200/70 py-8">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Happening soon near you
          </h2>
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0">
            {HAPPENING_SOON.map((item) => (
              <div
                key={item.activity}
                className="min-w-[240px] flex-shrink-0 snap-start rounded-2xl border border-gray-100 bg-white p-5 transition-shadow duration-200 hover:shadow-md sm:min-w-0"
              >
                <p className="text-[18px] font-bold leading-tight text-gray-900">{item.activity}</p>
                <p
                  className={`mt-1.5 flex items-center gap-1.5 text-sm ${
                    item.urgent ? "font-semibold text-accent" : "font-medium text-gray-700"
                  }`}
                >
                  {item.urgent && (
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" aria-hidden="true" />
                  )}
                  {item.timing}
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  {item.centre} · {item.distance}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Data transparency / footer — Tertiary */}
      <footer className="border-t border-gray-200/70 py-6 text-center">
        <p className="text-xs text-gray-500">Data from Toronto Open Data &middot; Updated recently</p>
        <p className="mt-2 text-xs text-gray-500">About &middot; Coverage &middot; Contact</p>
      </footer>
    </main>
  );
}
