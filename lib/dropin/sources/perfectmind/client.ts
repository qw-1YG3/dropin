// PerfectMind/Xplor BookMe4 transport layer (Phase 3.5B), built directly on
// the mechanism proven in Phase 3.4 (docs/PHASE_3_4_VAUGHAN_MARKHAM_POC.md)
// and stress-tested for real production behavior in Phase 3.5A
// (docs/PHASE_3_5A_PERFECTMIND_STRESS_TEST.md). Zero municipality-specific
// knowledge lives here — every function takes a tenant's host/site-prefix/
// widgetId and works identically for Vaughan or Markham (see ./config.ts).
//
// Mechanism, verified cold (no browser, no login) for both tenants:
//   1. GET  {host}{sitePrefix}/Clients/BookMe4BookingPages/Classes?calendarId=...&widgetId=...
//      — establishes session cookies and returns HTML containing a hidden
//      <input name="__RequestVerificationToken" value="...">.
//   2. POST {host}{sitePrefix}/Clients/BookMe4BookingPagesV2/ClassesV2 —
//      with that cookie jar + token, returns real dated session
//      occurrences: { classes: [...], classesMaxEndDateString, nextKey }.
//   3. Pagination is a DATE CURSOR, not a page number: `page` stays "0" on
//      every call; advance by re-sending the previous response's `nextKey`
//      as the next request's "Date Range" start value.
//
// The completion-gate contract (Phase 3.5A's single most important
// finding): a paginated pull is only PROVEN complete when the cursor
// itself stops advancing (nextKey absent/empty, or repeats its previous
// value) — never merely because a page-count cap was reached without
// error. fetchAllPerfectMindClasses returns `complete: false` whenever the
// safety cap fires first, and callers (../perfectmind/index.ts) must treat
// that as a hard failure, not a partial success.
import { addDays, localMidnight, toDateKey } from "../../time";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
// A hard circuit breaker, not a completion signal (see file header) —
// Phase 3.5A's real extended pull needed 22 pages to reach a genuine stop
// for the densest category tested; this leaves real headroom above that
// while still bounding worst-case cost against a misbehaving response.
const MAX_PAGES_PER_CATEGORY = 40;
// DropIn's current user-facing product commitment is a 7-day quick-
// navigation window. The 30-day source horizon intentionally provides
// generous operational headroom without fetching unbounded far-future
// municipal programming. Rolls forward from each refresh's own "today" —
// see fetchAllPerfectMindClasses, which computes the actual end-date bound
// once per pull, rather than a fixed calendar date here.
const HORIZON_DAYS = 30;

class CookieJar {
  private cookies = new Map<string, string>();
  absorb(response: Response): void {
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export type PmSession = {
  host: string;
  sitePrefix: string;
  jar: CookieJar;
  csrfToken: string;
  pageUrl: string;
  widgetId: string;
};

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function createPmSession(host: string, sitePrefix: string, calendarId: string, widgetId: string): Promise<PmSession> {
  const jar = new CookieJar();
  const pageUrl = `https://${host}${sitePrefix}/Clients/BookMe4BookingPages/Classes?calendarId=${calendarId}&widgetId=${widgetId}&embed=False`;
  const res = await fetchWithTimeout(pageUrl, { headers: { "User-Agent": USER_AGENT } });
  jar.absorb(res);
  const html = await res.text();
  const match = html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  if (!match) {
    throw new Error(`perfectmind client: could not find CSRF token for host "${host}" — page shape may have changed`);
  }
  return { host, sitePrefix, jar, csrfToken: match[1], pageUrl, widgetId };
}

export type PmClass = {
  EventId: string;
  CourseId: string;
  CourseIdTrimmed: string;
  EventName: string;
  Details?: string;
  Spots?: string;
  OccurrenceDate: string; // "YYYYMMDD"
  BookButtonText?: string;
  ClosedButtonName?: string;
  Facility?: string;
  Location?: string;
  FormattedStartDate: string;
  FormattedStartTime: string;
  FormattedEndDate: string;
  FormattedEndTime: string;
  DurationInMinutes?: number;
  MinAge?: number | null;
  MaxAge?: number | null;
  NoAgeRestriction?: boolean;
  PriceRange?: string;
  BookingType?: number;
  Address?: {
    AddressTag?: string;
    Street?: string;
    City?: string;
    PostalCode?: string;
    Latitude?: number;
    Longitude?: number;
    Id?: string;
  };
};

type ClassesV2Response = {
  classes: PmClass[];
  classesMaxEndDateString?: string;
  nextKey?: string;
};

async function fetchClassesPageOnce(
  session: PmSession,
  calendarId: string,
  startDateIso: string,
  endDateIso: string,
): Promise<{ outcome: "ok"; data: ClassesV2Response } | { outcome: "retryable"; status: number | string } | { outcome: "fatal"; error: string }> {
  const body = new URLSearchParams();
  body.set("calendarId", calendarId);
  body.set("widgetId", session.widgetId);
  body.set("page", "0");
  body.set("values[0][Name]", "Date Range");
  body.set("values[0][Value]", `${startDateIso}T00:00:00.000Z`);
  body.set("values[0][Value2]", `${endDateIso}T00:00:00.000Z`);
  body.set("values[0][ValueKind]", "6");
  body.set("__RequestVerificationToken", session.csrfToken);

  let res: Response;
  try {
    res = await fetchWithTimeout(`https://${session.host}${session.sitePrefix}/Clients/BookMe4BookingPagesV2/ClassesV2`, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: session.pageUrl,
        Cookie: session.jar.header(),
      },
      body: body.toString(),
    });
  } catch (err) {
    return { outcome: "retryable", status: `network-error: ${err instanceof Error ? err.message : String(err)}` };
  }
  session.jar.absorb(res);

  if (res.status === 429 || res.status >= 500) return { outcome: "retryable", status: res.status };
  if (!res.ok) return { outcome: "fatal", error: `HTTP ${res.status}` };

  const text = await res.text();
  try {
    return { outcome: "ok", data: JSON.parse(text) as ClassesV2Response };
  } catch {
    // A non-JSON 200 (an ASP.NET "Oops... there is an error" HTML page,
    // confirmed real in Phase 3.4/3.5A) is a retryable condition — the
    // session/token itself is usually still fine, this reflects a
    // transient server-side hiccup, not a permanent failure.
    return { outcome: "retryable", status: "malformed-json" };
  }
}

async function fetchClassesPageWithRetry(session: PmSession, calendarId: string, startDateIso: string, endDateIso: string): Promise<ClassesV2Response> {
  let attempt = 0;
  let lastStatus: number | string = "unknown";
  while (attempt <= MAX_RETRIES) {
    const result = await fetchClassesPageOnce(session, calendarId, startDateIso, endDateIso);
    if (result.outcome === "ok") return result.data;
    if (result.outcome === "fatal") throw new Error(`perfectmind client: fatal response for calendar ${calendarId} at ${startDateIso}: ${result.error}`);
    lastStatus = result.status;
    attempt++;
    if (attempt <= MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
  }
  throw new Error(`perfectmind client: exhausted ${MAX_RETRIES} retries for calendar ${calendarId} at ${startDateIso} (last status: ${lastStatus})`);
}

export type PmCategoryPullResult = {
  records: PmClass[];
  complete: boolean;
  pagesUsed: number;
  requestCount: number;
};

// Pages through one calendar from startDateIso until a genuine stop
// condition is reached. `complete: false` if the MAX_PAGES_PER_CATEGORY
// safety cap fires first — see the completion-gate contract in the file
// header. Never throws on "ran out of pages" (that's a normal, valid
// outcome to report as incomplete); does throw if a request itself fails
// unrecoverably (a real network/server problem, distinct from "we simply
// haven't reached the end yet").
export async function fetchAllPerfectMindClasses(session: PmSession, calendarId: string, startDateIso: string): Promise<PmCategoryPullResult> {
  const records: PmClass[] = [];
  let cursor = startDateIso;
  let requestCount = 0;
  // Computed once, from the pull's own start date — not the advancing
  // cursor — so the horizon stays a fixed 30 days from "today" for the
  // whole pull, same local-midnight semantics as the rest of the app.
  const endDateIso = toDateKey(addDays(localMidnight(startDateIso), HORIZON_DAYS));

  for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page++) {
    const data = await fetchClassesPageWithRetry(session, calendarId, cursor, endDateIso);
    requestCount++;
    const classes = data.classes ?? [];
    records.push(...classes);

    if (!data.nextKey || classes.length === 0) {
      return { records, complete: true, pagesUsed: page + 1, requestCount };
    }
    if (data.nextKey === cursor) {
      return { records, complete: true, pagesUsed: page + 1, requestCount };
    }
    cursor = data.nextKey;
  }

  // Safety cap reached without the cursor ever stopping on its own —
  // this is exactly the Phase 3.5A "looked healthy but wasn't actually
  // complete" trap. Report it honestly rather than pretending success.
  return { records, complete: false, pagesUsed: MAX_PAGES_PER_CATEGORY, requestCount };
}
