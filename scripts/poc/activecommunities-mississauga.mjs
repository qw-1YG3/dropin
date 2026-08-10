// TEMPORARY Phase 3.1 proof-of-concept runner. Not wired into the app.
// Usage: node scripts/poc/activecommunities-mississauga.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { createSession, getFilters, getEvents, searchActivities } from "./activecommunities-client.mjs";
import { normalizeEvent } from "./normalize-sample.mjs";

const TENANT = "activemississauga";
const GENERAL_CALENDAR_ID = 1; // "Drop In Programs" — confirmed via UI dropdown inspection

async function main() {
  const session = await createSession(TENANT);
  console.log(`[mississauga] session established, csrf token acquired`);

  const filters = await getFilters(session, { calendarId: GENERAL_CALENDAR_ID, centerId: 287 });
  const centerIds = filters.center.map((c) => c.id);
  console.log(`[mississauga] ${centerIds.length} centers found; calendar_period=${JSON.stringify(filters.calendar_period)}`);

  const centerEvents = await getEvents(session, { calendarId: GENERAL_CALENDAR_ID, centerIds });
  const totalEvents = centerEvents.reduce((sum, c) => sum + c.total, 0);
  console.log(`[mississauga] fetched ${totalEvents} real events across ${centerEvents.length} centers in one request (full-coverage proof; not all saved to disk — see cap below)`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawDir = "data/raw/mississauga";
  mkdirSync(rawDir, { recursive: true });

  // Full pull (15,872 events, ~28MB) proves citywide feasibility in one request —
  // logged above — but is too large to reasonably commit as a POC artifact.
  // The saved raw snapshot caps each center's events for inspection/schema
  // purposes while a separate coverage summary preserves the real totals.
  const EVENTS_PER_CENTER_CAP = 5;
  const cappedCenterEvents = centerEvents.map((c) => ({ ...c, events: c.events.slice(0, EVENTS_PER_CENTER_CAP) }));
  const rawPath = `${rawDir}/${timestamp}.json`;
  writeFileSync(
    rawPath,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        calendarId: GENERAL_CALENDAR_ID,
        note: `Capped to ${EVENTS_PER_CENTER_CAP} events/center for repo size; real full pull returned ${totalEvents} events (see coverageSummary).`,
        filters,
        coverageSummary: centerEvents.map((c) => ({ center_id: c.center_id, center_name: c.center_name, total: c.total })),
        centerEvents: cappedCenterEvents,
      },
      null,
      2
    )
  );
  console.log(`[mississauga] raw snapshot (capped, ${EVENTS_PER_CENTER_CAP}/center) saved to ${rawPath}`);

  // Sample normalization: first 15 real dated events, spanning multiple centers/activities.
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
      municipality: "Mississauga",
      officialSource: "City of Mississauga / Active Mississauga (ActiveCommunities)",
      fetchedAt: new Date().toISOString(),
      idPrefix: "mississauga",
    })
  );
  const normPath = `${rawDir}/${timestamp}-normalized-sample.json`;
  writeFileSync(normPath, JSON.stringify(normalized, null, 2));
  console.log(`[mississauga] normalized sample (${normalized.length} sessions) saved to ${normPath}`);

  // Cross-check: the separate Activities-search endpoint carries age data the calendar endpoint lacks.
  const badminton = await searchActivities(session, { keyword: "badminton" });
  console.log(`[mississauga] activities/list cross-check: ${badminton.length} badminton program records returned, first has age_description="${badminton[0]?.age_description}"`);
}

main().catch((err) => {
  console.error(`[mississauga] POC failed:`, err);
  process.exit(1);
});
