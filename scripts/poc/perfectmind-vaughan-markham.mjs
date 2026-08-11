// TEMPORARY Phase 3.4 proof-of-concept runner. Not wired into the app or
// into `refresh:data`. Usage: node scripts/poc/perfectmind-vaughan-markham.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { createPerfectMindSession, fetchAllPerfectMindClasses } from "./perfectmind-client.mjs";

// Real, confirmed-working config discovered during this investigation.
// Vaughan is a leaner "Drop-In Activities" bucket (3 active categories);
// Markham's equivalent bucket has ~13 categories. Only a representative
// subset of each is pulled here — enough to validate the mechanism and
// estimate volume/horizon, not an exhaustive citywide pull (Part 19 of
// Phase 3.0/3.3's own "be respectful of external sources" principle
// applies here too).
const TARGETS = [
  {
    municipality: "Vaughan",
    host: "vaughan.perfectmind.com",
    widgetId: "dff88c8a-0b78-4a94-9dde-250040385300",
    categories: [
      { name: "Sports", calendarId: "1d032376-c4bb-4023-80f5-7c3c44de0637" },
      { name: "Fitness Centre", calendarId: "d719b005-04c6-45b2-8556-4464c699a9ca" },
    ],
  },
  {
    municipality: "Markham",
    host: "cityofmarkham.perfectmind.com",
    widgetId: "6825ea71-e5b7-4c2a-948f-9195507ad90a",
    categories: [{ name: "Sports & Activities", calendarId: "491a603e-4043-4ab6-b04d-8fac51edbcfc" }],
  },
];

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const MAX_PAGES_PER_CATEGORY = 6; // ~6 x (4-7 days) ≈ 4-6 real weeks of horizon per category — a POC-scale sample, not exhaustive

async function main() {
  for (const target of TARGETS) {
    console.log(`\n=== ${target.municipality} (${target.host}) ===`);
    const outDir = `data/raw/poc-perfectmind/${target.municipality.toLowerCase()}`;
    mkdirSync(outDir, { recursive: true });

    for (const category of target.categories) {
      const session = await createPerfectMindSession(target.host, { calendarId: category.calendarId, widgetId: target.widgetId });
      const classes = await fetchAllPerfectMindClasses(session, { startDateIso: TODAY_ISO, maxPages: MAX_PAGES_PER_CATEGORY });

      const dates = classes.map((c) => c.OccurrenceDate).sort();
      const bookingTypes = new Set(classes.map((c) => c.BookingType));
      const buttonTexts = new Set(classes.map((c) => c.BookButtonText));
      const distinctNames = new Set(classes.map((c) => c.EventName));
      const withCoords = classes.filter((c) => c.Address?.Latitude && c.Address?.Longitude).length;
      const withAge = classes.filter((c) => c.MinAge != null || c.MaxAge != null).length;

      console.log(`  ${category.name}: ${classes.length} sessions, dates ${dates[0] ?? "?"}–${dates[dates.length - 1] ?? "?"}`);
      console.log(`    distinct activity names: ${distinctNames.size}`);
      console.log(`    bookingType values seen: ${[...bookingTypes].join(",")}`);
      console.log(`    book-button text values seen: ${[...buttonTexts].join(" | ")}`);
      console.log(`    with coordinates: ${withCoords}/${classes.length}, with age data: ${withAge}/${classes.length}`);

      // Small representative sample only — never the full pull (Part 8:
      // "do not commit huge uncontrolled dumps"). data/raw/poc-perfectmind/
      // is not read by production code and not part of the snapshot
      // pipeline's own data/raw/<slug>/ convention.
      const sample = classes.slice(0, 15);
      writeFileSync(`${outDir}/${category.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-sample.json`, JSON.stringify(sample, null, 2));
    }
  }
  console.log("\nDone. Samples written under data/raw/poc-perfectmind/ (gitignored, POC-only, not used by refresh:data).");
}

main().catch((err) => {
  console.error("POC failed:", err);
  process.exit(1);
});
