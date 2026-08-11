// TEMPORARY Phase 3.4 proof-of-concept code. Not wired into production, not
// connected to `refresh:data`. Demonstrates that Vaughan and Markham (both
// PerfectMind/Xplor "BookMe4" tenants) share the identical underlying REST
// contract — same endpoints, same request shape, same response field names
// — with only the host, tenant-specific widgetId/calendarId UUIDs, and
// category taxonomy differing. See docs/PHASE_3_4_VAUGHAN_MARKHAM_POC.md
// for the full findings this script was used to gather.
//
// Mechanism (verified against the real, unauthenticated production sites):
//   1. GET  {tenant}/Clients/BookMe4BookingPages/Classes?calendarId=...&widgetId=...
//      — establishes cookies and returns HTML containing a hidden
//      <input name="__RequestVerificationToken" value="...">.
//   2. POST {tenant}/Clients/BookMe4BookingPagesV2/ClassesV2 — with that
//      cookie jar + token, returns real dated session occurrences.
//   3. Pagination is a DATE CURSOR, not a page number: `page` stays "0" on
//      every call; advance by re-sending the previous response's `nextKey`
//      as the next request's "Date Range" start value. Naively
//      incrementing `page` produces a server error page, not JSON —
//      confirmed directly during this investigation.
// No login, no CAPTCHA — a plain server-side HTTP client is sufficient.

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

class CookieJar {
  cookies = new Map();
  absorb(response) {
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

export async function createPerfectMindSession(host, { calendarId, widgetId }) {
  const jar = new CookieJar();
  const pageUrl = `https://${host}/Clients/BookMe4BookingPages/Classes?calendarId=${calendarId}&widgetId=${widgetId}&embed=False`;
  const res = await fetch(pageUrl, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  jar.absorb(res);
  const html = await res.text();
  const match = html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  if (!match) {
    throw new Error(`perfectmind client: could not find CSRF token for host "${host}" — page shape may have changed`);
  }
  return { host, jar, csrfToken: match[1], pageUrl, calendarId, widgetId };
}

// startDateIso: "2026-08-11" (a plain date; this function appends the
// T00:00:00.000Z time-of-day PerfectMind's own client always sends).
// endDateIso: a far-future bound — in practice the server appears to cap
// how many days it returns per call (~60-70 records, a handful of days)
// regardless of how wide this range is; use nextKey to actually page.
export async function fetchPerfectMindClasses(session, { startDateIso, endDateIso = "2027-06-30" }) {
  const body = new URLSearchParams();
  body.set("calendarId", session.calendarId);
  body.set("widgetId", session.widgetId);
  body.set("page", "0"); // always 0 — pagination is via the date cursor (nextKey), not this field
  body.set("values[0][Name]", "Date Range");
  body.set("values[0][Value]", `${startDateIso}T00:00:00.000Z`);
  body.set("values[0][Value2]", `${endDateIso}T00:00:00.000Z`);
  body.set("values[0][ValueKind]", "6");
  body.set("__RequestVerificationToken", session.csrfToken);

  const res = await fetch(`https://${session.host}/Clients/BookMe4BookingPagesV2/ClassesV2`, {
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
  session.jar.absorb(res);
  if (!res.ok) throw new Error(`fetchPerfectMindClasses: HTTP ${res.status}`);
  return res.json();
}

// Pages through a calendar starting at startDateIso until either no more
// results, no nextKey is returned, or maxPages is hit (a real safety valve
// for this POC — a production adapter would need a similar bound so a
// misbehaving response can't loop forever).
export async function fetchAllPerfectMindClasses(session, { startDateIso, maxPages = 20 }) {
  const all = [];
  let cursor = startDateIso;
  for (let i = 0; i < maxPages; i++) {
    const resp = await fetchPerfectMindClasses(session, { startDateIso: cursor });
    const classes = resp.classes ?? [];
    all.push(...classes);
    if (!resp.nextKey || classes.length === 0 || resp.nextKey === cursor) break;
    cursor = resp.nextKey;
  }
  return all;
}
