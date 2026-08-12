// PerfectMind source-family fetch+normalize (Phase 3.5B). Mirrors
// ../activecommunities/index.ts's shape exactly: called only by
// scripts/refresh/perfectmind.ts, never on the application request path.
// Wires transport (./client.ts), tenant/category configuration
// (./config.ts), and normalization (./normalize.ts) together, once per
// refresh run, into the raw+sessions shape scripts/refresh/lib.ts's
// refreshOneSource expects.
//
// THE COMPLETION GATE (Part 5) lives here, not in refreshOneSource: this
// function throws — a full, real Error, no partial return — the moment any
// configured category's pull comes back `complete: false`. refreshOneSource
// already treats a thrown fetchRaw() as "write no raw snapshot, activate
// nothing, previous good snapshot survives untouched" (see
// scripts/refresh/lib.ts), which is exactly the "a partial refresh must
// never replace healthy data" guarantee Part 5/15 requires — reusing that
// existing behavior rather than adding a second, PerfectMind-specific
// version of it.
import { createPmSession, fetchAllPerfectMindClasses, type PmClass } from "./client";
import { normalizePmClass } from "./normalize";
import type { PerfectMindMunicipalityConfig } from "./config";
import { toDateKey } from "../../time";
import type { Session } from "../../types";

export { PERFECTMIND_MUNICIPALITIES, type PerfectMindMunicipalityConfig } from "./config";

export type PerfectMindCategoryPullReport = {
  category: string;
  calendarId: string;
  requestCount: number;
  pagesUsed: number;
  rawRecordCount: number;
};

export type PerfectMindFetchResult = {
  raw: { categories: { category: string; calendarId: string; records: PmClass[] }[] };
  sessions: Session[];
  sourceRecordCount: number;
  categoryReports: PerfectMindCategoryPullReport[];
};

// Fetches and normalizes exactly one configured municipality across all of
// its configured categories, sequentially — conservative pacing (Part 18),
// consistent with Phase 3.5A's evidence: that stress test did not exercise
// full-taxonomy, full-horizon concurrent load, so observed stability there
// is not license for concurrency here. Each category gets its own
// session/CSRF bootstrap (a fresh createPmSession call) rather than reusing
// one across categories, since a calendarId is bound into the very page a
// session's CSRF token is scoped to.
export async function fetchAndNormalizeMunicipality(config: PerfectMindMunicipalityConfig, now: Date = new Date()): Promise<PerfectMindFetchResult> {
  const fetchedAtDateKey = toDateKey(now);
  const todayIso = fetchedAtDateKey;

  const rawCategories: { category: string; calendarId: string; records: PmClass[] }[] = [];
  const categoryReports: PerfectMindCategoryPullReport[] = [];
  // Source-level dedup (Part 6) — distinct from canonical identity below.
  // PerfectMind's date-range filter is inclusive on both ends, so a record
  // on a page boundary date is returned by two consecutive pages
  // (confirmed real duplicate rates of 24.6%-44.0% in Phase 3.5A); this key
  // is what removes exactly those pagination duplicates before normalization
  // ever runs. OccurrenceDate is a required part of the key, not a
  // defensive extra: a real 1,205-record Vaughan pull confirmed EventId
  // alone is NOT occurrence-unique (one recurring program's EventId is
  // reused identically across every one of its dates) — EventId alone here
  // would silently merge distinct occurrences together. (EventId,
  // OccurrenceDate) together were confirmed unique with zero collisions
  // across that same dataset. See ./normalize.ts's id construction for the
  // same finding applied to canonical identity.
  const seenSourceKeys = new Set<string>();

  for (const category of config.categories) {
    const session = await createPmSession(config.host, config.sitePrefix, category.calendarId, config.widgetId);
    const result = await fetchAllPerfectMindClasses(session, category.calendarId, todayIso);

    if (!result.complete) {
      throw new Error(
        `perfectmind: "${config.municipality} / ${category.name}" did not reach a genuine completion signal within the page safety cap ` +
          `(pagesUsed=${result.pagesUsed}, requests=${result.requestCount}, records so far=${result.records.length}) — refusing to treat this as a successful refresh`,
      );
    }

    const dedupedRecords: PmClass[] = [];
    for (const record of result.records) {
      const key = `${record.EventId}|${record.OccurrenceDate}`;
      if (seenSourceKeys.has(key)) continue;
      seenSourceKeys.add(key);
      dedupedRecords.push(record);
    }

    rawCategories.push({ category: category.name, calendarId: category.calendarId, records: dedupedRecords });
    categoryReports.push({
      category: category.name,
      calendarId: category.calendarId,
      requestCount: result.requestCount,
      pagesUsed: result.pagesUsed,
      rawRecordCount: dedupedRecords.length,
    });
  }

  const sessions: Session[] = [];
  const seenCanonicalIds = new Set<string>();
  let sourceRecordCount = 0;

  for (const { records, category } of rawCategories) {
    const categoryConfig = config.categories.find((c) => c.name === category)!;
    for (const record of records) {
      sourceRecordCount++;
      const result = normalizePmClass(record, config, categoryConfig, fetchedAtDateKey);
      if ("skipped" in result) continue;
      const { session } = result;
      // Belt-and-suspenders guard, same discipline as ActiveCommunities'
      // own index.ts — normalizePmClass's id is already namespaced per
      // tenant and keyed off (EventId, OccurrenceDate), which real data
      // confirmed unique with zero collisions; this only catches something
      // equally surprising.
      if (seenCanonicalIds.has(session.id)) continue;
      seenCanonicalIds.add(session.id);
      sessions.push(session);
    }
  }

  return { raw: { categories: rawCategories }, sessions, sourceRecordCount, categoryReports };
}
