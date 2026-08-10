// ActiveCommunities source-family adapter (Phase 3.2) — the one place that
// wires transport (./client.ts), municipality configuration (./config.ts),
// raw source interpretation (./age-join.ts), and normalization
// (./normalize.ts) together into canonical Sessions. Mississauga and
// Richmond Hill are two configured tenants of this exact same code path —
// see docs/PHASE_3_2_ACTIVECOMMUNITIES_PRODUCTION.md for the evidence this
// produced.
//
// Per-municipality failures are isolated (Part 16): one tenant's fetch
// failing is logged and excluded from the result, not thrown — Toronto and
// the other ActiveCommunities municipality must still return their real
// data. A completely empty result across every source would still surface
// as an empty (not crashed) response, matching the existing UI's real
// "no sessions" empty state rather than a special error path.
import { createAcSession, getAcFilters, getAcEvents } from "./client";
import { buildAgeLookup } from "./age-join";
import { normalizeAcEvent } from "./normalize";
import { ACTIVE_COMMUNITIES_MUNICIPALITIES, type ActiveCommunitiesMunicipalityConfig } from "./config";
import { hasEnded, isWithinRollingWindow, toDateKey } from "../../time";
import type { Session } from "../../types";
import type { SessionQueryOptions } from "../index";

async function fetchMunicipalitySessions(
  config: ActiveCommunitiesMunicipalityConfig,
  now: Date,
  options: SessionQueryOptions | undefined,
): Promise<Session[]> {
  const session = await createAcSession(config.tenant);
  const filters = await getAcFilters(session, { calendarId: config.generalCalendarId, centerId: config.seedCenterId });
  const centerIds = filters.center.map((c) => c.id);
  const centerEvents = await getAcEvents(session, { calendarId: config.generalCalendarId, centerIds });

  const rawEvents = centerEvents.flatMap((c) => c.events);
  const distinctTitles = Array.from(new Set(rawEvents.map((e) => e.title)));
  const ageLookup = await buildAgeLookup(session, distinctTitles);

  const fetchedAtDateKey = toDateKey(now);
  // No artificial common horizon across municipalities (Part 7) — when the
  // caller doesn't ask for something narrower, every real session the
  // source returned is kept; the source's own `calendar_period` (Mississauga
  // ~105 days, Richmond Hill ~21 days, confirmed materially different in
  // Phase 3.1) is what actually bounds this, not a value chosen here.
  const days = options?.days;

  const sessions: Session[] = [];
  // Belt-and-suspenders, same discipline as the Toronto adapter's own
  // seenOccurrenceKeys guard: normalizeAcEvent's id already incorporates
  // facility identity precisely because a real duplicate was found in
  // testing (the same event_item_id running concurrently at two
  // facilities) — this catches anything equally surprising the source
  // might still produce, rather than trusting id construction alone.
  const seenIds = new Set<string>();
  for (const event of rawEvents) {
    const result = normalizeAcEvent(event, config, ageLookup, fetchedAtDateKey);
    if ("skipped" in result) continue;
    const { session: normalized } = result;

    if (days !== undefined && !isWithinRollingWindow(normalized.date, now, days)) continue;
    if (hasEnded(new Date(normalized.endDateTime), now)) continue;
    if (seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);

    sessions.push(normalized);
  }

  return sessions;
}

export async function getActiveCommunitiesSessions(now: Date = new Date(), options?: SessionQueryOptions): Promise<Session[]> {
  const results = await Promise.allSettled(
    ACTIVE_COMMUNITIES_MUNICIPALITIES.map((config) => fetchMunicipalitySessions(config, now, options)),
  );

  const sessions: Session[] = [];
  results.forEach((result, i) => {
    const config = ACTIVE_COMMUNITIES_MUNICIPALITIES[i];
    if (result.status === "fulfilled") {
      sessions.push(...result.value);
    } else {
      // Isolated, not swallowed silently — a failed municipality is absent
      // from the results, never faked as succeeded (Part 16).
      console.error(`[activecommunities adapter] failed to fetch ${config.municipality} (tenant "${config.tenant}"):`, result.reason);
    }
  });

  return sessions;
}

// Real, measured cost (Phase 3.2, Part 18): a cold fetch across both
// configured municipalities — session handshake, full center-batched event
// pull, and the age-join enrichment pass — takes on the order of tens of
// seconds and produces tens of thousands of session objects, dominated by
// Mississauga's ~16,000-event catalog and its own ~200-title age-join pass.
// Re-running that on every single page load would be a real, user-facing
// latency problem, not a hypothetical one — so results are cached in-process
// for a bounded interval and reused across concurrent requests, with no
// database or external cache: this process's own memory is enough for a
// single Next.js server instance, and is exactly the "smallest sensible"
// option the phase asked for rather than standing up Redis pre-emptively.
const CACHE_TTL_MS = 20 * 60 * 1000;
let cache: { fetchedAt: number; now: Date; sessions: Session[] } | undefined;
let inFlight: Promise<Session[]> | undefined;

export async function getActiveCommunitiesSessionsCached(now: Date = new Date(), options?: SessionQueryOptions): Promise<Session[]> {
  // The cache only ever serves the default (unbounded) query — a caller
  // asking for a narrower `days` window gets a fresh, freely-filterable
  // fetch rather than a stale slice of someone else's cached window. Only
  // the common case (the API route's own no-options call) is worth caching.
  if (options?.days !== undefined) {
    return fetchAllConfiguredMunicipalities(now, options);
  }

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.sessions;
  }

  if (!inFlight) {
    inFlight = fetchAllConfiguredMunicipalities(now, options).finally(() => {
      inFlight = undefined;
    });
  }
  const sessions = await inFlight;
  cache = { fetchedAt: Date.now(), now, sessions };
  return sessions;
}

function fetchAllConfiguredMunicipalities(now: Date, options: SessionQueryOptions | undefined): Promise<Session[]> {
  return getActiveCommunitiesSessions(now, options);
}
