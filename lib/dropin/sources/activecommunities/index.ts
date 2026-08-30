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
import { createAcSession, getAcFilters, getAcEvents, searchAcActivities, searchAcActivitiesMap, getAcProgramSessions, type AcActivityItem, type AcSession } from "./client";
import { buildAgeLookup } from "./age-join";
import { normalizeAcEvent, normalizeAcDropInSession } from "./normalize";
import type { ActiveCommunitiesMunicipalityConfig } from "./config";
import { toDateKey } from "../../time";
import type { Session } from "../../types";

export { ACTIVE_COMMUNITIES_MUNICIPALITIES, type ActiveCommunitiesMunicipalityConfig } from "./config";

export type ActiveCommunitiesFetchResult = {
  // Shape differs by retrieval strategy (direct calendar vs. two-tier
  // drop-in, see below) — round-tripped opaquely into the raw snapshot by
  // scripts/refresh/activecommunities.ts, never destructured there.
  raw: unknown;
  sessions: Session[];
  sourceRecordCount: number;
  ageJoin: { matchedSessions: number; totalSessions: number };
  sourceFreshness: { startDate: string; endDate: string } | undefined;
};

// Direct/catalog retrieval strategy (Phase 3.2) — Mississauga, Richmond
// Hill: real drop-in content lives on the dated onlinecalendar feed itself.
async function fetchDirectCalendar(config: ActiveCommunitiesMunicipalityConfig, now: Date): Promise<ActiveCommunitiesFetchResult> {
  const session = await createAcSession(config.tenant);
  const filters = await getAcFilters(session, { calendarId: config.generalCalendarId!, centerId: config.seedCenterId! });
  const centerIds = filters.center.map((c) => c.id);
  const centerEvents = await getAcEvents(session, { calendarId: config.generalCalendarId!, centerIds });

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

// Optional two-tier drop-in retrieval strategy (Phase 3.6B) — Aurora: real
// drop-in content lives in the activities/list catalog instead, one real
// "Drop In "-prefixed entry per calendar week, each needing its own
// getAcProgramSessions call to expand into real dated/timed occurrences.
// Config-driven (config.dropInKeywords), not municipality-branched — any
// future ActiveCommunities tenant whose evidence points the same way could
// opt into this without a code change.
//
// THE COMPLETION GATE, same discipline as Phase 3.5B's PerfectMind gate:
// activities/list is capped at 20 results/page with no working pagination
// parameter found during this phase's investigation (multiple real request
// shapes tried, all ignored by the server — see
// docs/PHASE_3_6B_AURORA_NEWMARKET_PRODUCTION.md). A genuine stop condition
// is still provable without real pagination: the server's own
// `total_records` count is authoritative, so if a keyword's entire returned
// page is "Drop In "-prefixed AND total_records exceeds the page size, more
// drop-in content might exist beyond what was fetched — that's reported as
// INCOMPLETE (thrown) rather than silently accepted. If the drop-in cluster
// visibly ends before the page boundary (a real non-"Drop In" item
// follows), or total_records fits within one page outright, that's a
// genuine, provable completion — confirmed against all 3 configured
// keywords in real testing (none came close to hitting this cap).
// Aurora Source Reliability phase — one centre's activities/list slice,
// paired with its own reported totals so the merge step below can apply
// the same Completion Gate to it independently.
type CentrePartition = { centerId: number; items: AcActivityItem[]; totalRecords: number; recordsPerPage: number };

// Pure — no network calls, exported for direct testing (including the
// deliberate-mismatch/fail-safe path, which needs no real request to
// exercise). Applies three independent proofs before trusting a
// centre-partitioned result, per the Aurora Source Reliability
// investigation's own integrity requirement:
//   1. Every individual centre partition must itself pass the exact same
//      Completion Gate the keyword-level check already applies — a centre
//      whose own result is capped/incomplete fails the whole fetch, never
//      silently contributes a partial slice.
//   2. No activity id may appear in more than one centre partition — a
//      real duplicate here would mean double-counting the same program.
//   3. The merged item count, AND the sum of each partition's own
//      authoritative `total_records`, must both exactly equal the
//      original unfiltered keyword-level `total_records` — the one number
//      activities/list itself already claims is the true total. A
//      mismatch means centre discovery (activities/map) missed something
//      (e.g. a real ungrouped/unlocated result) — refuse rather than
//      guess which centres were "enough."
// Any failure throws the same class of plain, descriptive Error the
// pre-existing keyword-level gate already throws — never a silent partial
// result, never a different/weaker failure mode.
export function mergeCentrePartitions(config: ActiveCommunitiesMunicipalityConfig, keyword: string, originalTotalRecords: number, partitions: CentrePartition[]): AcActivityItem[] {
  for (const p of partitions) {
    const dropInItems = p.items.filter((item) => /^drop in/i.test(item.name));
    if (dropInItems.length === p.items.length && p.items.length > 0 && p.totalRecords > p.recordsPerPage) {
      throw new Error(
        `activecommunities client: "${config.municipality}" keyword "${keyword}" centre ${p.centerId} partition itself filled its entire page ` +
          `with "Drop In"-prefixed results (${p.items.length}/${p.recordsPerPage}, total_records=${p.totalRecords}) with no working pagination to ` +
          `confirm the cluster ends there — refusing to treat the centre-partition fallback as a complete fetch`,
      );
    }
  }

  const mergedItems = partitions.flatMap((p) => p.items);
  const ids = mergedItems.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      `activecommunities client: "${config.municipality}" keyword "${keyword}" centre-partition fallback found duplicate activity ids across ` +
        `centre partitions — refusing to merge a result that may double-count sessions`,
    );
  }

  const summedTotalRecords = partitions.reduce((sum, p) => sum + p.totalRecords, 0);
  if (summedTotalRecords !== originalTotalRecords || mergedItems.length !== originalTotalRecords) {
    throw new Error(
      `activecommunities client: "${config.municipality}" keyword "${keyword}" centre-partition fallback merged ${mergedItems.length} items across ` +
        `${partitions.length} centres (summed total_records=${summedTotalRecords}) but the original unfiltered search reported total_records=` +
        `${originalTotalRecords} — centre discovery may have missed a real result (e.g. ungrouped/unlocated) — refusing to treat this as complete`,
    );
  }

  return mergedItems.filter((item) => /^drop in/i.test(item.name));
}

// Discovery-only use of activities/map (never treated as the canonical
// activity dataset itself — see searchAcActivitiesMap's own comment): asks
// which real centres exist for this keyword right now, then re-fetches
// each one individually through the exact same activities/list path every
// other keyword already uses, so every session that ends up in the
// canonical output still comes from activities/list, normalized exactly
// as before.
async function fetchCappedKeywordViaCentrePartition(
  session: AcSession,
  config: ActiveCommunitiesMunicipalityConfig,
  keyword: string,
  originalTotalRecords: number,
): Promise<AcActivityItem[]> {
  const map = await searchAcActivitiesMap(session, { keyword });
  if (map.mapPoints.length === 0) {
    throw new Error(
      `activecommunities client: "${config.municipality}" keyword "${keyword}" is capped but activities/map returned no centre breakdown to ` +
        `partition by — refusing to treat this as a complete fetch`,
    );
  }

  const partitions: CentrePartition[] = await Promise.all(
    map.mapPoints.map(async (point) => {
      const { items, totalRecords, recordsPerPage } = await searchAcActivities(session, { keyword, centerIds: [point.id] });
      return { centerId: point.id, items, totalRecords, recordsPerPage };
    }),
  );

  return mergeCentrePartitions(config, keyword, originalTotalRecords, partitions);
}

async function fetchDropInCatalog(config: ActiveCommunitiesMunicipalityConfig, now: Date): Promise<ActiveCommunitiesFetchResult> {
  const session = await createAcSession(config.tenant);
  const fetchedAtDateKey = toDateKey(now);

  const activitiesByKeyword: { keyword: string; activities: AcActivityItem[] }[] = [];
  for (const keyword of config.dropInKeywords!) {
    const { items, totalRecords, recordsPerPage } = await searchAcActivities(session, { keyword });
    const dropInItems = items.filter((item) => /^drop in/i.test(item.name));

    if (dropInItems.length === items.length && items.length > 0 && totalRecords > recordsPerPage) {
      // Aurora Source Reliability phase — the keyword-level page is
      // genuinely capped. Before giving up, try the verified centre-
      // partition fallback (see mergeCentrePartitions/
      // fetchCappedKeywordViaCentrePartition above); it throws the same
      // class of error if it can't prove completeness either, so this
      // never silently accepts a partial result either way.
      const partitioned = await fetchCappedKeywordViaCentrePartition(session, config, keyword, totalRecords);
      activitiesByKeyword.push({ keyword, activities: partitioned });
      continue;
    }
    activitiesByKeyword.push({ keyword, activities: dropInItems });
  }

  const sessions: Session[] = [];
  const seenIds = new Set<string>();
  let sourceRecordCount = 0;
  let matchedSessions = 0;

  for (const { activities } of activitiesByKeyword) {
    for (const activity of activities) {
      const programSessions = await getAcProgramSessions(session, activity.id);
      for (const programSession of programSessions) {
        sourceRecordCount++;
        const result = normalizeAcDropInSession(activity, programSession, config, fetchedAtDateKey);
        if ("skipped" in result) continue;
        const { session: normalized } = result;
        if (seenIds.has(normalized.id)) continue;
        seenIds.add(normalized.id);
        if (normalized.ageMin !== undefined || normalized.ageMax !== undefined) matchedSessions++;
        sessions.push(normalized);
      }
    }
  }

  return {
    raw: { activitiesByKeyword },
    sessions,
    sourceRecordCount,
    ageJoin: { matchedSessions, totalSessions: sessions.length },
    sourceFreshness: undefined,
  };
}

// Fetches and normalizes exactly one configured municipality. Left to the
// caller (the refresh script) to isolate failures per municipality — this
// function itself just throws on a real failure, same as any other
// async function; Promise.allSettled at the call site is what makes that
// isolation real (Part 5).
export async function fetchAndNormalizeMunicipality(
  config: ActiveCommunitiesMunicipalityConfig,
  now: Date = new Date(),
): Promise<ActiveCommunitiesFetchResult> {
  return config.dropInKeywords ? fetchDropInCatalog(config, now) : fetchDirectCalendar(config, now);
}
