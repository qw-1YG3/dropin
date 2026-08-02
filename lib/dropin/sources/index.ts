import { getTorontoSessions } from "./toronto";
import type { Session } from "../types";

// Every registered adapter contributes to one combined pool. Adding a new
// municipality means writing one adapter (matching this file's shape) and
// adding it here — the Search Engine, API route, and UI never change.
const ADAPTERS: Array<(now: Date) => Session[]> = [getTorontoSessions];

export function getAllSessions(now: Date = new Date()): Session[] {
  return ADAPTERS.flatMap((adapter) => adapter(now));
}
