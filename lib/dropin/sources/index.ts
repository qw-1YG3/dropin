import { getTorontoSessions } from "./toronto";
import type { Session } from "../types";

export type SessionQueryOptions = {
  // How many days forward the rolling window covers, starting today.
  // Defaults to each adapter's own real production window (currently 7 for
  // Toronto) when omitted — a caller only needs to pass this to request
  // something narrower, as the API route currently does.
  days?: number;
};

// Every registered adapter contributes to one combined pool. Adding a new
// municipality means writing one adapter (matching this file's shape) and
// adding it here — the Search Engine, API route, and UI never change.
const ADAPTERS: Array<(now: Date, options?: SessionQueryOptions) => Session[]> = [getTorontoSessions];

export function getAllSessions(now: Date = new Date(), options?: SessionQueryOptions): Session[] {
  return ADAPTERS.flatMap((adapter) => adapter(now, options));
}
