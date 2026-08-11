// Toronto refresh (Phase 3.3, Part 11). Fetches live from the City of
// Toronto Open Data CKAN API — the same "Registered Programs and Drop-in
// Courses Offering" package Phase 3.0 identified, confirmed still live and
// stable at these exact resource ids:
//
//   package: registered-programs-and-drop-in-courses-offering
//     (id 1a5be46a-4039-48cd-a2d2-8e702abf9516)
//   Drop-in.json resource:   067b41e7-ac8a-4d3f-ad08-089f8cd70316
//   Locations.json resource: 87f95a5a-184f-4df5-ad37-84bcc1ea99a9
//
// Both are plain, stable, unauthenticated file downloads (not behind the
// datastore/pagination API) — verified directly: ~29,000 drop-in records
// and ~1,880 locations as of this phase, materially larger and fresher
// than the bundled snapshot in data/toronto-open-data/, matching Phase
// 3.0's finding that the bundle had gone stale relative to the live feed.
//
// If the live fetch fails for any reason (network, endpoint change), this
// falls back to the committed bundle rather than failing the whole refresh
// — Toronto is the one municipality with a genuine offline safety net.
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeTorontoSessions, OFFICIAL_SOURCE, type RawDropInRecord, type RawLocation } from "../../lib/dropin/sources/toronto";
import { municipalitySlug } from "../../lib/dropin/snapshot/paths";
import { refreshOneSource, printReport, printReportJson, type SourceReport } from "./lib";

const PACKAGE_ID = "1a5be46a-4039-48cd-a2d2-8e702abf9516";
const DROPIN_RESOURCE_ID = "067b41e7-ac8a-4d3f-ad08-089f8cd70316";
const LOCATIONS_RESOURCE_ID = "87f95a5a-184f-4df5-ad37-84bcc1ea99a9";
const CKAN_HOST = "https://ckan0.cf.opendata.inter.prod-toronto.ca";
const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLive(): Promise<{ dropIn: RawDropInRecord[]; locations: RawLocation[] }> {
  const dropInUrl = `${CKAN_HOST}/dataset/${PACKAGE_ID}/resource/${DROPIN_RESOURCE_ID}/download/drop-in.json`;
  const locationsUrl = `${CKAN_HOST}/dataset/${PACKAGE_ID}/resource/${LOCATIONS_RESOURCE_ID}/download/locations.json`;

  const [dropInRes, locationsRes] = await Promise.all([fetchWithTimeout(dropInUrl), fetchWithTimeout(locationsUrl)]);
  if (!dropInRes.ok) throw new Error(`Drop-in.json fetch failed: HTTP ${dropInRes.status}`);
  if (!locationsRes.ok) throw new Error(`Locations.json fetch failed: HTTP ${locationsRes.status}`);

  const [dropIn, locations] = await Promise.all([dropInRes.json(), locationsRes.json()]);
  if (!Array.isArray(dropIn) || dropIn.length === 0) throw new Error("Drop-in.json returned no records");
  if (!Array.isArray(locations) || locations.length === 0) throw new Error("Locations.json returned no records");

  return { dropIn: dropIn as RawDropInRecord[], locations: locations as RawLocation[] };
}

function loadBundledFallback(): { dropIn: RawDropInRecord[]; locations: RawLocation[] } {
  const dropIn = JSON.parse(readFileSync(path.join(process.cwd(), "data/toronto-open-data/drop-in.json"), "utf-8"));
  const locations = JSON.parse(readFileSync(path.join(process.cwd(), "data/toronto-open-data/locations.json"), "utf-8"));
  return { dropIn, locations };
}

export async function refreshToronto(): Promise<SourceReport> {
  let usedFallback = false;

  return refreshOneSource({
    municipalitySlug: municipalitySlug("Toronto"),
    municipalityName: "Toronto",
    sourceProvider: OFFICIAL_SOURCE,
    fetchRaw: async () => {
      let data;
      try {
        data = await fetchLive();
      } catch (err) {
        console.warn(`[refresh:toronto] live fetch failed (${err instanceof Error ? err.message : err}) — falling back to bundled data/toronto-open-data/`);
        usedFallback = true;
        data = loadBundledFallback();
      }
      return { raw: data, recordCount: data.dropIn.length };
    },
    normalize: (raw, fetchedAt) => {
      const { dropIn, locations } = raw as { dropIn: RawDropInRecord[]; locations: RawLocation[] };
      const fetchedAtDateKey = fetchedAt.slice(0, 10);
      const { sessions, skipped } = normalizeTorontoSessions(dropIn, locations, fetchedAtDateKey);
      const warnings = Object.entries(skipped).map(([reason, count]) => `${count} row(s) skipped: ${reason}`);
      if (usedFallback) warnings.push("used bundled fallback data, not the live source, for this refresh");
      return { sessions, warnings };
    },
  });
}

// Runnable standalone: `npx tsx scripts/refresh/toronto.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const report = await refreshToronto();
    if (process.argv.includes("--json")) printReportJson([report]);
    else printReport([report]);
    process.exit(report.activated ? 0 : 1);
  })();
}
