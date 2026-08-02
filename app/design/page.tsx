import Link from "next/link";

type Preview = {
  label: string;
  href: string;
};

type ScreenGroup = {
  screen: string;
  previews: Preview[];
};

const DESIGN_PREVIEWS: ScreenGroup[] = [
  {
    screen: "Map View",
    previews: [],
  },
  {
    screen: "Legacy: Homepage (superseded by Search Surface)",
    previews: [
      { label: "Low-Fidelity V1", href: "/design/homepage-lowfi" },
      { label: "High-Fidelity V1", href: "/design/homepage-highfi" },
    ],
  },
  {
    screen: "Legacy: Results Page (superseded by Search Surface)",
    previews: [
      { label: "Low-Fidelity V1", href: "/design/results-lowfi" },
      { label: "Card Layout Exploration", href: "/design/results-card-variations" },
      { label: "High-Fidelity V1", href: "/design/results-highfi" },
    ],
  },
];

export default function DesignIndex() {
  return (
    <main className="min-h-screen bg-white px-4 py-10 text-gray-900 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Design Preview Hub</h1>
        <p className="mb-8 text-sm text-gray-500">
          Temporary review environments, grouped by product screen. Not production routes. Search
          Surface graduated from here to production — see{" "}
          <Link href="/" className="text-accent underline underline-offset-2">
            the live app
          </Link>
          .
        </p>

        <div className="space-y-6">
          {DESIGN_PREVIEWS.map((group) => (
            <section key={group.screen}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {group.screen}
              </h2>

              {group.previews.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">
                  Not started
                </p>
              ) : (
                <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200">
                  {group.previews.map((p) => (
                    <li key={p.href}>
                      <Link
                        href={p.href}
                        className="flex items-center justify-between px-4 py-3 text-sm transition-colors duration-150 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{group.screen}</span>
                        <span className="text-gray-500">{p.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
