// TEMPORARY Phase 3.1 proof-of-concept code. Not wired into the production
// app. Demonstrates that Mississauga and Richmond Hill (both ActiveCommunities
// tenants) are served by the identical underlying REST contract — the same
// endpoints, request shapes, and response field names work for both, with
// only the tenant slug and center/calendar IDs differing. See
// docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md for the full findings this
// script was used to gather.
//
// Mechanism (verified against the real, unauthenticated production sites):
//   1. GET  /<tenant>/calendars  — establishes a session cookie and returns
//      an HTML page with `window.__csrfToken = "<uuid>"` inline.
//   2. POST /<tenant>/rest/onlinecalendar/filters — with that cookie + token,
//      returns the tenant's real center list, activity categories, and a
//      `calendar_period` (the server's own stated date horizon).
//   3. POST /<tenant>/rest/onlinecalendar/multicenter/events — with a list
//      of center_ids, returns real dated session occurrences (start_time,
//      end_time, facility, price) for every center in one call.
//
// No login, no CAPTCHA, no browser rendering required — a plain HTTP client
// with a cookie jar is sufficient, confirmed via curl outside this script too.

const BASE = "https://anc.ca.apm.activecommunities.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export async function createSession(tenant, { calendarPath = "calendars" } = {}) {
  const jar = new CookieJar();
  const pageUrl = `${BASE}/${tenant}/${calendarPath}?onlineSiteId=0&displayType=0&view=2`;
  const res = await fetch(pageUrl, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  jar.absorb(res);
  const html = await res.text();
  const match = html.match(/window\.__csrfToken = "([a-f0-9-]+)"/);
  if (!match) {
    throw new Error(`Could not find CSRF token for tenant "${tenant}" — page shape may have changed.`);
  }
  return { tenant, jar, csrfToken: match[1], pageUrl };
}

async function post(session, path, body) {
  const res = await fetch(`${BASE}/${session.tenant}/rest/${path}?locale=en-US`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json;charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-Token": session.csrfToken,
      Referer: session.pageUrl,
      Cookie: session.jar.header(),
    },
    body: JSON.stringify(body),
  });
  session.jar.absorb(res);
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function getFilters(session, { calendarId, centerId }) {
  const json = await post(session, "onlinecalendar/filters", { calendar_id: calendarId, center_id: centerId });
  return json.body;
}

export async function getEvents(session, { calendarId, centerIds }) {
  const json = await post(session, "onlinecalendar/multicenter/events", {
    calendar_id: calendarId,
    center_ids: centerIds,
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

export async function searchActivities(session, { keyword = "", dropIn = 0 } = {}) {
  const json = await post(session, "activities/list", {
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
      drop_in: dropIn,
      season_ids: [],
      activity_department_ids: [],
      activity_other_category_ids: [],
      child_season_ids: [],
      activity_keyword: keyword,
      instructor_ids: [],
      max_age: null,
      is_drop_in: false,
      custom_price_from: null,
      custom_price_to: null,
    },
    activity_transfer_pattern: {},
  });
  return json.body.activity_items;
}
