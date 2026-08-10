import { getTorontoSessions } from "./toronto";
import { getActiveCommunitiesSessionsCached } from "./activecommunities";
import type { Session } from "../types";

export type SessionQueryOptions = {
  // How many days forward the rolling window covers, starting today.
  // Defaults to each adapter's own real schedule-availability window when
  // omitted (see getTorontoSessions) — a caller only needs to pass this to
  // request something narrower than what the source can actually back up.
  // Each adapter's own real horizon can genuinely differ (Toronto's static
  // snapshot vs. Mississauga's ~105-day vs. Richmond Hill's ~21-day live
  // ActiveCommunities horizon) — this is never normalized into one common
  // window across sources (Phase 3.2, Part 7).
  days?: number;
};

// Every registered adapter contributes to one combined pool. Adding a new
// municipality means writing one adapter (matching this file's shape) and
// adding it here — the Search Engine, API route, and UI never change.
// Adapters are async because Toronto's static-snapshot read and the
// ActiveCommunities family's live remote fetch have genuinely different
// timing characteristics; wrapping the former in Promise.resolve keeps both
// under one uniform interface rather than a sync/async special case per
// source. Each adapter is isolated (Part 16 of Phase 3.2): one source
// failing is logged and excluded, never allowed to fail the whole request.
const ADAPTERS: Array<(now: Date, options?: SessionQueryOptions) => Promise<Session[]>> = [
  async (now, options) => getTorontoSessions(now, options),
  getActiveCommunitiesSessionsCached,
];

export async function getAllSessions(now: Date = new Date(), options?: SessionQueryOptions): Promise<Session[]> {
  const results = await Promise.allSettled(ADAPTERS.map((adapter) => adapter(now, options)));
  const sessions: Session[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      sessions.push(...result.value);
    } else {
      console.error("[sources] an adapter failed and was excluded from this response:", result.reason);
    }
  }
  return sessions;
}
