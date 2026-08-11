// TEMPORARY Phase 3.5A runner. node scripts/poc/perfectmind-stress-runner.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { stressTestCalendar } from "./perfectmind-stress-test.mjs";

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const MAX_PAGES = 15; // a bounded, respectful full-horizon attempt, not unlimited

const TARGETS = [
  { municipality: "Vaughan", host: "vaughan.perfectmind.com", sitePrefix: "/25076", widgetId: "dff88c8a-0b78-4a94-9dde-250040385300", calendarId: "1d032376-c4bb-4023-80f5-7c3c44de0637", categoryName: "Sports" },
  { municipality: "Vaughan", host: "vaughan.perfectmind.com", sitePrefix: "/25076", widgetId: "dff88c8a-0b78-4a94-9dde-250040385300", calendarId: "d719b005-04c6-45b2-8556-4464c699a9ca", categoryName: "Fitness Centre" },
  { municipality: "Markham", host: "cityofmarkham.perfectmind.com", sitePrefix: "", widgetId: "6825ea71-e5b7-4c2a-948f-9195507ad90a", calendarId: "491a603e-4043-4ab6-b04d-8fac51edbcfc", categoryName: "Sports & Activities" },
];

async function main() {
  const outDir = "data/raw/poc-perfectmind/stress-test";
  mkdirSync(outDir, { recursive: true });

  console.log(`=== SEQUENTIAL full-catalog pull (max ${MAX_PAGES} pages/category) ===\n`);
  const sequentialResults = [];
  const seqStart = performance.now();
  for (const target of TARGETS) {
    console.log(`Fetching ${target.municipality} / ${target.categoryName}...`);
    const result = await stressTestCalendar({ ...target, maxPages: MAX_PAGES, startDateIso: TODAY_ISO });
    sequentialResults.push(result);
    console.log(
      `  requests=${result.totalRequests} pages=${result.pagesFetched} raw=${result.rawRecordCount} unique=${result.uniqueRecordCount} dupes=${result.duplicatesWithinPull} ` +
        `duration=${(result.totalDurationMs / 1000).toFixed(1)}s avgLatency=${result.avgLatencyMs.toFixed(0)}ms maxLatency=${result.maxLatencyMs.toFixed(0)}ms ` +
        `completenessIssue=${result.completenessIssue ?? "none"}`,
    );
  }
  const seqTotal = performance.now() - seqStart;
  console.log(`\nSequential total wall-clock (all ${TARGETS.length} categories): ${(seqTotal / 1000).toFixed(1)}s\n`);

  // Bounded-concurrency comparison: same targets, run concurrently (small
  // concurrency = 3, one per category, since each targets a DIFFERENT
  // tenant/category combination already — this is the natural concurrency
  // ceiling before within-category page-level parallelism would even be
  // considered, and within-category pagination is inherently sequential
  // anyway since each page's cursor depends on the previous page's result).
  console.log(`=== BOUNDED CONCURRENCY comparison (${TARGETS.length} categories in parallel) ===\n`);
  const conStart = performance.now();
  const concurrentResults = await Promise.all(TARGETS.map((target) => stressTestCalendar({ ...target, maxPages: MAX_PAGES, startDateIso: TODAY_ISO })));
  const conTotal = performance.now() - conStart;
  for (const result of concurrentResults) {
    console.log(
      `${result.municipality} / ${result.categoryName}: requests=${result.totalRequests} raw=${result.rawRecordCount} ` +
        `duration=${(result.totalDurationMs / 1000).toFixed(1)}s completenessIssue=${result.completenessIssue ?? "none"}`,
    );
  }
  console.log(`\nConcurrent total wall-clock (all ${TARGETS.length} categories): ${(conTotal / 1000).toFixed(1)}s\n`);

  writeFileSync(
    `${outDir}/summary.json`,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        maxPagesPerCategory: MAX_PAGES,
        sequential: { totalWallClockMs: seqTotal, results: sequentialResults.map(({ sampleRecords, ...rest }) => rest) },
        concurrent: { totalWallClockMs: conTotal, results: concurrentResults.map(({ sampleRecords, ...rest }) => rest) },
      },
      null,
      2,
    ),
  );
  console.log(`Summary written to ${outDir}/summary.json`);
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});
