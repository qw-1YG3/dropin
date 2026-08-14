// Best-effort age-eligibility enrichment for the ActiveCommunities source
// family (Phase 3.2, Part 5).
//
// Phase 3.1 found age data is NOT present on the dated calendar/event
// endpoint at all — only on the separate `activities/list` registered-
// program catalog (see docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md §7). This
// module validates and implements the real join between the two, rather
// than assuming one exists.
//
// VALIDATED join key: a calendar event's `event_item_id` equals an
// `activities/list` record's `id` — confirmed with a 100% match (8/8) for a
// real, verifiable case (Richmond Hill's "55+ Badminton (Drop-In)").
// `activities/list` has no bulk/list-everything mode (capped at 20
// results/page, confirmed directly), so the only practical way to populate
// a lookup table is one keyword search per DISTINCT event title already
// present in the calendar pull — bounded by catalog *variety*, not by
// event count. Measured against full real data:
//
//   Mississauga:    198 distinct titles -> 1,967 distinct programs
//                    -> 1,044-1,115 matched (53-57%), the rest genuinely
//                       have no activities/list record at all (many
//                       calendar-only drop-ins, e.g. plain "Lane Swim",
//                       simply aren't registered programs).
//                    At the raw (15,868) session level: ~47-50% get real
//                    age data via this join.
//   Richmond Hill:   28 distinct titles -> 147 distinct programs
//                    -> 91 matched (62%), 56 unmatched (38%).
//                    At the raw (258) session level: ~78% get real age data.
//
// This is a genuine, non-trivial improvement over "no age data ever" for
// this source family, but it is INCOMPLETE by construction — the majority
// of Mississauga's pure walk-in events have no corresponding registration
// record to join against, full stop, not a lookup-table gap. Sessions that
// don't match keep ageMin/ageMax undefined — never fabricated.
//
// Cost: ~200ms-300ms per keyword search, run with bounded concurrency here.
// A full run took ~46s sequentially in testing; this module runs requests
// CONCURRENCY at a time to keep that bounded without hammering the source.
// MAX_TITLES is a safety valve against a future, much larger municipality
// having far more catalog variety than the ~200 observed here — if hit, the
// remaining titles are simply left unenriched (age stays undefined for
// those), never blocking the base session fetch.
import { searchAcActivities, type AcSession } from "./client";

const CONCURRENCY = 8;
const MAX_TITLES = 300;

export type AgeInfo = { ageMin?: number; ageMax?: number };

function toAgeInfo(item: { age_min_year?: number; age_max_year?: number }): AgeInfo {
  return {
    ageMin: item.age_min_year,
    ageMax: item.age_max_year && item.age_max_year > 0 ? item.age_max_year : undefined,
  };
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const i = index++;
    if (i >= items.length) return;
    await worker(items[i]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

// Returns a lookup by activities/list `id` (== a calendar event's
// event_item_id when a match exists). Never throws — a failed or capped
// title lookup just means that title's events stay unenriched, consistent
// with "leave age unknown rather than inventing eligibility."
export async function buildAgeLookup(session: AcSession, distinctTitles: string[]): Promise<Map<number, AgeInfo>> {
  const lookup = new Map<number, AgeInfo>();
  const titles = distinctTitles.slice(0, MAX_TITLES);

  await runWithConcurrency(titles, CONCURRENCY, async (title) => {
    try {
      const { items } = await searchAcActivities(session, { keyword: title });
      for (const item of items) {
        if (!lookup.has(item.id)) lookup.set(item.id, toAgeInfo(item));
      }
    } catch {
      // One title's enrichment failing (network blip, unexpected response
      // shape) must not take down the whole fetch — those events simply
      // stay without age data, same as a title with no catalog match at all.
    }
  });

  return lookup;
}
