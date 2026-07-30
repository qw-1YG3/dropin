"use client";

import { PreviewHeader } from "../_components/PreviewHeader";

type Sample = {
  id: number;
  activity: string;
  dateTime: string;
  centre: string;
  distanceKm: number;
  price: string;
  isSoon: boolean;
  day: "Today" | "Tomorrow";
};

const SAMPLES: Sample[] = [
  { id: 1, activity: "Lane Swim", dateTime: "Today • 7:00–8:00 PM", centre: "Douglas Snow Aquatic Centre", distanceKm: 2.1, price: "$6", isSoon: true, day: "Today" },
  { id: 2, activity: "Women's Swim", dateTime: "Today • 9:30–10:30 PM", centre: "Cecil Community Centre", distanceKm: 4.5, price: "Free", isSoon: false, day: "Today" },
  { id: 3, activity: "Leisure Swim", dateTime: "Tomorrow • 10:00–11:00 AM", centre: "Mitchell Field Community Centre", distanceKm: 4.1, price: "$6", isSoon: false, day: "Tomorrow" },
];

function LeftColumn({ s }: { s: Sample }) {
  return (
    <div>
      <p className="text-base font-bold text-gray-900">{s.activity}</p>
      <p className="mt-1 text-sm text-gray-600">{s.dateTime}</p>
      <p className="mt-2 text-sm text-gray-500">
        {s.centre} · {s.distanceKm} km
      </p>
    </div>
  );
}

function SoonPill() {
  return (
    <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-500">
      Happening Soon
    </span>
  );
}

export default function ResultsCardVariations() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <PreviewHeader pageName="Results — Card Exploration" stage="Low-Fidelity" version="V1" />

      <div className="mx-auto max-w-2xl px-4 py-8 space-y-12">
        <p className="text-sm text-gray-500">
          Three layout directions for separating descriptive information (left) from decision
          signals (right). Same three sample activities in every variation for direct comparison.
        </p>

        {/* Variation A */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Variation A — Signals column, buckets retained</h2>
          <p className="mb-4 text-xs text-gray-500">
            Right-aligned Price + Happening Soon pill. Section grouping (Happening Now / Later
            Today / Tomorrow) stays as-is.
          </p>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Happening Now</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.isSoon).map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <span className="text-sm font-semibold text-gray-800">{s.price}</span>
                  <SoonPill />
                </div>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Later Today</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.day === "Today" && !s.isSoon).map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <span className="text-sm font-semibold text-gray-800">{s.price}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Tomorrow</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.day === "Tomorrow").map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
                  <span className="text-sm font-semibold text-gray-800">{s.price}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Variation B */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Variation B — Divided column, day-level grouping only</h2>
          <p className="mb-4 text-xs text-gray-500">
            A vertical rule visually separates information from signals. Urgency-based buckets
            (Now / Later) are dropped in favor of one continuous list per day — the pill alone
            marks what's happening soon.
          </p>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Today</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.day === "Today").map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <div className="flex flex-shrink-0 items-start gap-4 border-l border-gray-200 pl-4">
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-sm font-semibold text-gray-800">{s.price}</span>
                    {s.isSoon && <SoonPill />}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Tomorrow</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.day === "Tomorrow").map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <div className="flex flex-shrink-0 items-start gap-4 border-l border-gray-200 pl-4">
                  <span className="text-sm font-semibold text-gray-800">{s.price}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Variation C */}
        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Variation C — Minimal signals, price only</h2>
          <p className="mb-4 text-xs text-gray-500">
            No pill at all. Right side shows only Price. Calmness comes entirely from omission —
            section headers (Happening Now / Later Today / Tomorrow) carry all timing context.
          </p>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Happening Now</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.isSoon).map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <span className="flex-shrink-0 text-sm font-semibold text-gray-800">{s.price}</span>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Later Today</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.day === "Today" && !s.isSoon).map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <span className="flex-shrink-0 text-sm font-semibold text-gray-800">{s.price}</span>
              </div>
            ))}
          </div>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Tomorrow</div>
          <div className="space-y-2">
            {SAMPLES.filter((s) => s.day === "Tomorrow").map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3.5">
                <LeftColumn s={s} />
                <span className="flex-shrink-0 text-sm font-semibold text-gray-800">{s.price}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
