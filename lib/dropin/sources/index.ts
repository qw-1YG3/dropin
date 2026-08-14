// Phase 3.3 — the application's read path. Every registered municipality
// now contributes a pre-built canonical snapshot (see ../snapshot/ and
// scripts/refresh/) rather than being fetched or normalized here. This
// file's job is now just: load whatever's on disk, apply the one thing
// that genuinely depends on live `now` (the rolling-window/ended filter and
// the legacy `day` label), and combine. No network call, no remote-source
// normalization, and no per-municipality-specific logic lives here anymore
// — adding municipality #4 later means adding a refresh script and a
// snapshot directory, not touching this file.
import { statSync } from "node:fs";
import { readJsonIfExists } from "../snapshot/io";
import { canonicalLatestPath } from "../snapshot/paths";
import type { CanonicalSnapshot } from "../snapshot/types";
import { normalizeTorontoSessions, type RawDropInRecord, type RawLocation } from "./toronto";
import { hasEnded, isWithinRollingWindow, legacyDay, toDateKey } from "../time";
import type { Session } from "../types";

export type SessionQueryOptions = {
  // How many days forward the rolling window covers, starting today.
  // Omitted means "everything this municipality's own snapshot actually
  // contains" — no artificial common horizon is imposed across
  // municipalities (Toronto's real snapshot extent, Mississauga's ~105-day
  // ActiveCommunities horizon, and Richmond Hill's ~21-day horizon can all
  // genuinely differ; each snapshot is already naturally bounded by
  // whatever its source really provided, so "no cap" and "cap at the real
  // extent" produce the same result without this file needing to know
  // what that extent is per source).
  days?: number;
};

const MUNICIPALITY_SLUGS = ["toronto", "mississauga", "richmond-hill", "vaughan", "markham", "newmarket", "aurora"] as const;

// Cached per municipality, invalidated by the snapshot file's own mtime —
// avoids re-reading and re-parsing a potentially large JSON file on every
// single request while still picking up a newly-activated snapshot
// automatically the moment scripts/refresh/ atomically renames a new one
// into place (Part 25 performance target).
const snapshotCache = new Map<string, { mtimeMs: number; sessions: Session[] }>();

async function loadTorontoFallback(): Promise<Session[]> {
  // Toronto-only safety net: the bundled dataset is committed to the repo
  // (data/toronto-open-data/), so a fresh clone with no refresh run yet
  // still has real Toronto data instead of nothing. This is a local JSON
  // parse, not a network call — it does not reintroduce the remote-fetch-
  // on-request-path problem this phase removes. Still logs clearly, since
  // it means a real refresh hasn't been run.
  console.warn(
    '[sources] no canonical Toronto snapshot found — normalizing the bundled fallback dataset on the fly. Run "npm run refresh:data -- --municipality=toronto" for a real snapshot with live data.',
  );
  const [{ default: rawDropIn }, { default: rawLocations }] = await Promise.all([
    import("@/data/toronto-open-data/drop-in.json"),
    import("@/data/toronto-open-data/locations.json"),
  ]);
  const { sessions } = normalizeTorontoSessions(rawDropIn as RawDropInRecord[], rawLocations as RawLocation[], toDateKey(new Date()));
  return sessions;
}

async function loadMunicipalitySessions(slug: (typeof MUNICIPALITY_SLUGS)[number]): Promise<Session[]> {
  const filePath = canonicalLatestPath(slug);

  let mtimeMs: number | undefined;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    // No snapshot file exists at all yet.
    if (slug === "toronto") return loadTorontoFallback();
    console.warn(`[sources] no canonical snapshot found for "${slug}" — run "npm run refresh:data" to populate it. Returning no sessions for this municipality until then.`);
    return [];
  }

  const cached = snapshotCache.get(slug);
  if (cached && cached.mtimeMs === mtimeMs) return cached.sessions;

  const snapshot = readJsonIfExists<CanonicalSnapshot>(filePath);
  if (!snapshot) {
    if (slug === "toronto") return loadTorontoFallback();
    return [];
  }

  snapshotCache.set(slug, { mtimeMs, sessions: snapshot.sessions });
  return snapshot.sessions;
}

// The one place "is this session still relevant right now" is decided —
// applied fresh against the live `now` at request time, never baked into
// a snapshot built at some earlier refresh time. `day` (today/tomorrow) is
// computed here for the same reason: a snapshot built yesterday must not
// keep saying "today" for a date that no longer is.
function applyReadTimeView(sessions: Session[], now: Date, options: SessionQueryOptions | undefined): Session[] {
  const days = options?.days;
  const out: Session[] = [];
  for (const s of sessions) {
    if (days !== undefined && !isWithinRollingWindow(s.date, now, days)) continue;
    if (hasEnded(new Date(s.endDateTime), now)) continue;
    out.push({ ...s, day: legacyDay(s.date, now) });
  }
  return out;
}

export async function getAllSessions(now: Date = new Date(), options?: SessionQueryOptions): Promise<Session[]> {
  const results = await Promise.allSettled(MUNICIPALITY_SLUGS.map((slug) => loadMunicipalitySessions(slug)));

  const sessions: Session[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      sessions.push(...applyReadTimeView(result.value, now, options));
    } else {
      // Isolated, not swallowed silently — a failed municipality load is
      // absent from the results, never faked as succeeded.
      console.error(`[sources] failed to load snapshot for "${MUNICIPALITY_SLUGS[i]}":`, result.reason);
    }
  });

  return sessions;
}
