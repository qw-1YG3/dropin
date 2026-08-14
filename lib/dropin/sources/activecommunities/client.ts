// Transport layer for the ActiveCommunities source family (Phase 3.2). Pure
// HTTP + session mechanics — no municipality-specific knowledge, no
// normalization into the canonical Session model. Every function here works
// identically for any ActiveCommunities tenant; only the `tenant` string
// passed in varies per municipality (see ../config.ts).
//
// Mechanism verified in Phase 3.1 (docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md)
// against the real, unauthenticated production sites for Mississauga and
// Richmond Hill, and re-verified here via the POC scripts this file is
// adapted from (scripts/poc/activecommunities-client.mjs):
//   1. GET  /<tenant>/calendars — establishes a session cookie and returns
//      an HTML page with `window.__csrfToken = "<uuid>"` inline.
//   2. POST /<tenant>/rest/onlinecalendar/filters — with that cookie+token,
//      returns the tenant's real center list and its stated date horizon
//      (`calendar_period`).
//   3. POST /<tenant>/rest/onlinecalendar/multicenter/events — returns real
//      dated session occurrences for a batch of centers in one call.
//   4. POST /<tenant>/rest/activities/list — a *different* catalog
//      (registered programs, not dated occurrences); used only for the
//      best-effort age-eligibility enrichment in ./age-join.ts.
// No login, no CAPTCHA — a plain server-side HTTP client is sufficient.

const BASE = "https://anc.ca.apm.activecommunities.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type AcSession = {
  tenant: string;
  csrfToken: string;
  pageUrl: string;
  cookieHeader: () => string;
  absorb: (res: Response) => void;
};

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

export async function createAcSession(tenant: string): Promise<AcSession> {
  const jar = new CookieJar();
  const pageUrl = `${BASE}/${tenant}/calendars?onlineSiteId=0&displayType=0&view=2`;
  const res = await fetch(pageUrl, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  jar.absorb(res);
  const html = await res.text();
  const match = html.match(/window\.__csrfToken = "([a-f0-9-]+)"/);
  if (!match) {
    throw new Error(`activecommunities client: could not find CSRF token for tenant "${tenant}" — page shape may have changed`);
  }
  return { tenant, csrfToken: match[1], pageUrl, cookieHeader: () => jar.header(), absorb: (res) => jar.absorb(res) };
}

async function acPost<T>(session: AcSession, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${session.tenant}/rest/${path}?locale=en-US`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json;charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": session.csrfToken,
      Referer: session.pageUrl,
      Cookie: session.cookieHeader(),
    },
    body: JSON.stringify(body),
  });
  session.absorb(res);
  if (!res.ok) {
    throw new Error(`activecommunities client: POST ${path} failed for tenant "${session.tenant}": HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type AcCenter = { id: number; name: string };
export type AcCalendarPeriod = { start_date: string; end_date: string };
export type AcFilters = {
  center: AcCenter[];
  calendar_period?: AcCalendarPeriod;
};

export async function getAcFilters(session: AcSession, params: { calendarId: number; centerId: number }): Promise<AcFilters> {
  const json = await acPost<{ body: AcFilters }>(session, "onlinecalendar/filters", {
    calendar_id: params.calendarId,
    center_id: params.centerId,
  });
  return json.body;
}

export type AcFacility = {
  facility_id: number;
  facility_name: string;
  center_id: number;
  center_name: string;
};

export type AcPrice = {
  free?: boolean;
  estimate_price?: string;
};

export type AcEvent = {
  event_item_id: number;
  title: string;
  start_time: string; // "2026-08-11 19:00:00", local wall-clock
  end_time: string;
  description?: string;
  facilities: AcFacility[];
  price?: AcPrice;
  reservation_event_type_id: number;
  event_type: number;
  activity_detail_url?: string;
};

export type AcCenterEvents = {
  center_id: number;
  center_name: string;
  total: number;
  events: AcEvent[];
};

export async function getAcEvents(session: AcSession, params: { calendarId: number; centerIds: number[] }): Promise<AcCenterEvents[]> {
  const json = await acPost<{ body: { center_events: AcCenterEvents[] } }>(session, "onlinecalendar/multicenter/events", {
    calendar_id: params.calendarId,
    center_ids: params.centerIds,
    display_all: 1,
    search_start_time: "",
    search_end_time: "",
    facility_ids: [],
    activity_category_ids: [],
    activity_sub_category_ids: [],
    activity_ids: [],
    activity_min_age: "",
    activity_max_age: "",
    event_type_ids: [],
  });
  return json.body.center_events;
}

export type AcActivityItem = {
  id: number;
  name: string;
  age_description?: string;
  age_min_year?: number;
  age_max_year?: number;
  // The rest are only populated/used by the two-tier drop-in retrieval path
  // (Phase 3.6B, Aurora) — real fields confirmed present on every sampled
  // record, unused (left undefined by callers) for the age-enrichment path.
  detail_url?: string;
  action_link?: { href?: string };
  location?: { label?: string };
  date_range_start?: string; // "2026-08-15 00:00:00"
};

export type AcActivitySearchResult = {
  items: AcActivityItem[];
  totalRecords: number;
  recordsPerPage: number;
};

// A different catalog from getAcEvents — registered programs/courses, not
// dated drop-in occurrences (see docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md §7).
// Used for best-effort age enrichment (../age-join.ts) AND, since Phase
// 3.6B, as the primary source for tenants whose real drop-in content lives
// here instead of on the dated onlinecalendar feed (see ../index.ts and
// Session.attendanceRequirement's own reasoning for why that's a genuinely
// different, evidence-backed retrieval path, not a guess). Capped at 20
// results/page by the server itself — confirmed directly; the true total is
// still reported via `page_info.total_records`, used by the two-tier path
// to detect a genuine completion boundary (see ../index.ts).
export async function searchAcActivities(session: AcSession, params: { keyword: string }): Promise<AcActivitySearchResult> {
  const json = await acPost<{ headers: { page_info?: { total_records?: number; total_records_per_page?: number } }; body: { activity_items: AcActivityItem[] } }>(
    session,
    "activities/list",
    {
      activity_search_pattern: {
        skills: [],
        time_after_str: "",
        days_of_week: null,
        activity_select_param: 2,
        center_ids: [],
        time_before_str: "",
        open_spots: null,
        activity_id: null,
        activity_category_ids: [],
        date_before: null,
        min_age: null,
        date_after: null,
        activity_type_ids: [],
        site_ids: [0],
        for_map: false,
        geographic_area_ids: [],
        drop_in: 1,
        season_ids: [],
        activity_department_ids: [],
        activity_other_category_ids: [],
        child_season_ids: [],
        activity_keyword: params.keyword,
        instructor_ids: [],
        max_age: null,
        is_drop_in: true,
        custom_price_from: null,
        custom_price_to: null,
      },
      activity_transfer_pattern: {},
    },
  );
  return {
    items: json.body.activity_items,
    totalRecords: json.headers.page_info?.total_records ?? json.body.activity_items.length,
    recordsPerPage: json.headers.page_info?.total_records_per_page ?? json.body.activity_items.length,
  };
}

export type AcProgramSession = {
  session_id: number;
  session_name: string;
  first_date: string; // "2026-08-15"
  last_date: string;
  beginning_time: string; // "10:15:00"
  ending_time: string;
  days_of_week: string;
};

// Second tier of the drop-in retrieval path (Phase 3.6B): a real
// `activities/list` "week" entry (e.g. "Drop In - Adult Pickleball (AFLC) -
// August 15 - 21") has no per-occurrence date/time on the item itself —
// only this sub-resource expands it into its real dated/timed occurrences.
// Confirmed reachable with the same session/cookie already established by
// createAcSession, no separate handshake needed.
export async function getAcProgramSessions(session: AcSession, programId: number): Promise<AcProgramSession[]> {
  const res = await fetch(`${BASE}/${session.tenant}/rest/program/${programId}/sessions?locale=en-US`, {
    headers: { "User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest", Referer: session.pageUrl, Cookie: session.cookieHeader() },
  });
  session.absorb(res);
  if (!res.ok) {
    throw new Error(`activecommunities client: GET program/${programId}/sessions failed for tenant "${session.tenant}": HTTP ${res.status}`);
  }
  const json = (await res.json()) as { body: { program_sessions: AcProgramSession[] } };
  return json.body.program_sessions;
}
