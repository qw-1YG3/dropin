// TEMPORARY Phase 3.1 proof-of-concept runner. Not wired into the app.
// Usage: node scripts/poc/activecommunities-richmondhill.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { createSession, getFilters, getEvents, searchActivities } from "./activecommunities-client.mjs";
import { normalizeEvent } from "./normalize-sample.mjs";

const TENANT = "richmondhill";
const GENERAL_CALENDAR_ID = 1; // "Recreational Activities" — confirmed via UI dropdown inspection

async function main() {
  const session = await createSession(TENANT);
  console.log(`[richmondhill] session established, csrf token acquired`);

  const filters = await getFilters(session, { calendarId: GENERAL_CALENDAR_ID, centerId: 6 });
  const centerIds = filters.center.map((c) => c.id);
  console.log(`[richmondhill] ${centerIds.length} centers found; calendar_period=${JSON.stringify(filters.calendar_period)}`);

  const centerEvents = await getEvents(session, { calendarId: GENERAL_CALENDAR_ID, centerIds });
  const totalEvents = centerEvents.reduce((sum, c) => sum + c.total, 0);
  console.log(`[richmondhill] fetched ${totalEvents} real events across ${centerEvents.length} centers in one request`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawDir = "data/raw/richmond-hill";
  mkdirSync(rawDir, { recursive: true });
  const rawPath = `${rawDir}/${timestamp}.json`;
  writeFileSync(rawPath, JSON.stringify({ fetchedAt: new Date().toISOString(), calendarId: GENERAL_CALENDAR_ID, filters, centerEvents }, null, 2));
  console.log(`[richmondhill] raw snapshot saved to ${rawPath}`);

  const sampleEvents = [];
  for (const c of centerEvents) {
    for (const e of c.events) {
      sampleEvents.push(e);
      if (sampleEvents.length >= 15) break;
    }
    if (sampleEvents.length >= 15) break;
  }
  const normalized = sampleEvents.map((e) =>
    normalizeEvent(e, {
      municipality: "Richmond Hill",
      officialSource: "City of Richmond Hill / ActiveRH (ActiveCommunities)",
      fetchedAt: new Date().toISOString(),
      idPrefix: "richmondhill",
    })
  );
  const normPath = `${rawDir}/${timestamp}-normalized-sample.json`;
  writeFileSync(normPath, JSON.stringify(normalized, null, 2));
  console.log(`[richmondhill] normalized sample (${normalized.length} sessions) saved to ${normPath}`);

  const badminton = await searchActivities(session, { keyword: "badminton" });
  console.log(`[richmondhill] activities/list cross-check: ${badminton.length} badminton program records returned, first has age_description="${badminton[0]?.age_description}"`);
}

main().catch((err) => {
  console.error(`[richmondhill] POC failed:`, err);
  process.exit(1);
});
