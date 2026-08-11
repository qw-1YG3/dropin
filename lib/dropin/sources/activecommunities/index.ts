// ActiveCommunities source-family fetch+normalize (Phase 3.2, restructured
// in Phase 3.3). This module is now called only by scripts/refresh/
// activecommunities.ts — never on the application request path. It wires
// transport (./client.ts), municipality configuration (./config.ts), raw
// source interpretation (./age-join.ts), and normalization
// (./normalize.ts) together, once per refresh run, into a canonical
// snapshot written to disk (see ../../snapshot/). The application reads
// that snapshot at request time (lib/dropin/sources/index.ts) — it no
// longer calls anything in this file.
//
// No `now`/window filtering happens here anymore, for the same reason as
// the Toronto normalizer: a canonical snapshot built once at refresh time
// must stay correct to read hours later, so "is this within range, has it
// ended" is applied fresh at request time instead, not baked in here.
import { createAcSession, getAcFilters, getAcEvents } from "./client";
import { buildAgeLookup } from "./age-join";
import { normalizeAcEvent } from "./normalize";
import type { ActiveCommunitiesMunicipalityConfig } from "./config";
import { toDateKey } from "../../time";
import type { Session } from "../../types";
import type { AcCenterEvents, AcFilters } from "./client";

export { ACTIVE_COMMUNITIES_MUNICIPALITIES, type ActiveCommunitiesMunicipalityConfig } from "./config";

export type ActiveCommunitiesFetchResult = {
  raw: { filters: AcFilters; centerEvents: AcCenterEvents[] };
  sessions: Session[];
  sourceRecordCount: number;
  ageJoin: { matchedSessions: number; totalSessions: number };
  sourceFreshness: { startDate: string; endDate: string } | undefined;
};

// Fetches and normalizes exactly one configured municipality. Left to the
// caller (the refresh script) to isolate failures per municipality — this
// function itself just throws on a real failure, same as any other
// async function; Promise.allSettled at the call site is what makes that
// isolation real (Part 5).
export async function fetchAndNormalizeMunicipality(
  config: ActiveCommunitiesMunicipalityConfig,
  now: Date = new Date(),
): Promise<ActiveCommunitiesFetchResult> {
  const session = await createAcSession(config.tenant);
  const filters = await getAcFilters(session, { calendarId: config.generalCalendarId, centerId: config.seedCenterId });
  const centerIds = filters.center.map((c) => c.id);
  const centerEvents = await getAcEvents(session, { calendarId: config.generalCalendarId, centerIds });

  const rawEvents = centerEvents.flatMap((c) => c.events);
  const distinctTitles = Array.from(new Set(rawEvents.map((e) => e.title)));
  const ageLookup = await buildAgeLookup(session, distinctTitles);

  const fetchedAtDateKey = toDateKey(now);
  const sessions: Session[] = [];
  const seenIds = new Set<string>();
  let matchedSessions = 0;

  for (const event of rawEvents) {
    const result = normalizeAcEvent(event, config, ageLookup, fetchedAtDateKey);
    if ("skipped" in result) continue;
    const { session: normalized } = result;

    // Belt-and-suspenders duplicate guard — normalizeAcEvent's id already
    // incorporates facility identity precisely because a real duplicate
    // was found in testing (the same event_item_id running concurrently at
    // two facilities); this catches anything equally surprising.
    if (seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);

    if (normalized.ageMin !== undefined || normalized.ageMax !== undefined) matchedSessions++;
    sessions.push(normalized);
  }

  return {
    raw: { filters, centerEvents },
    sessions,
    sourceRecordCount: rawEvents.length,
    ageJoin: { matchedSessions, totalSessions: sessions.length },
    sourceFreshness: filters.calendar_period ? { startDate: filters.calendar_period.start_date, endDate: filters.calendar_period.end_date } : undefined,
  };
}
