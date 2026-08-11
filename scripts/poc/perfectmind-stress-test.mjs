// TEMPORARY Phase 3.5A stress-test script. Not wired into production, not
// connected to `refresh:data`. Reuses the transport mechanism proven in
// Phase 3.4 (scripts/poc/perfectmind-client.mjs is NOT imported here —
// this file is self-contained and instrumented specifically for
// measurement, so every request's timing/outcome is tracked explicitly).
//
// Conservative by design (Part 3): sequential by default, one small bounded-
// concurrency comparison run, real backoff-retry on transient failures,
// hard caps on both page count and wall-clock time so a misbehaving
// response can't turn this into an unbounded hammering loop against a
// third party's infrastructure.
import { writeFileSync, mkdirSync } from "node:fs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

class CookieJar {
  cookies = new Map();
  absorb(response) {
    const sc = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const raw of sc) {
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

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function createSession(host, sitePrefix, calendarId, widgetId) {
  const jar = new CookieJar();
  const pageUrl = `https://${host}${sitePrefix}/Clients/BookMe4BookingPages/Classes?calendarId=${calendarId}&widgetId=${widgetId}&embed=False`;
  const res = await fetchWithTimeout(pageUrl, { headers: { "User-Agent": USER_AGENT } });
  jar.absorb(res);
  const html = await res.text();
  const match = html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  if (!match) throw new Error(`could not find CSRF token for ${host}`);
  return { host, sitePrefix, jar, csrfToken: match[1], pageUrl, calendarId, widgetId };
}

// Returns { outcome: "ok"|"failed", status, durationMs, retries, data? }
async function fetchClassesPage(session, startDateIso, metrics) {
  let attempt = 0;
  let lastError;
  while (attempt <= MAX_RETRIES) {
    const t0 = performance.now();
    try {
      const body = new URLSearchParams();
      body.set("calendarId", session.calendarId);
      body.set("widgetId", session.widgetId);
      body.set("page", "0");
      body.set("values[0][Name]", "Date Range");
      body.set("values[0][Value]", `${startDateIso}T00:00:00.000Z`);
      body.set("values[0][Value2]", "2027-06-30T00:00:00.000Z");
      body.set("values[0][ValueKind]", "6");
      body.set("__RequestVerificationToken", session.csrfToken);

      const res = await fetchWithTimeout(`https://${session.host}${session.sitePrefix}/Clients/BookMe4BookingPagesV2/ClassesV2`, {
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
      const durationMs = performance.now() - t0;
      metrics.requests.push({ status: res.status, durationMs, attempt, startDateIso });

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        attempt++;
        if (attempt <= MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
        continue;
      }
      if (!res.ok) return { outcome: "failed", status: res.status, durationMs, retries: attempt };

      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        // A non-JSON 200 (the "Oops... there is an error" HTML page found
        // in Phase 3.4) counts as a failure even though the HTTP status
        // itself was 200 — the real signal is payload shape, not status code.
        return { outcome: "failed", status: res.status, durationMs, retries: attempt, malformedJson: true };
      }
      return { outcome: "ok", status: res.status, durationMs, retries: attempt, data: json };
    } catch (err) {
      lastError = err;
      const durationMs = performance.now() - t0;
      metrics.requests.push({ status: "error", durationMs, attempt, startDateIso, error: String(err) });
      attempt++;
      if (attempt <= MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
    }
  }
  return { outcome: "failed", status: "exhausted-retries", retries: attempt, error: String(lastError) };
}

// Sequential full-catalog pull for one calendar, with completeness checks.
export async function stressTestCalendar({ municipality, host, sitePrefix = "", widgetId, calendarId, categoryName, maxPages, startDateIso }) {
  const metrics = { requests: [] };
  const t0 = performance.now();

  const session = await createSession(host, sitePrefix, calendarId, widgetId);

  const allRecords = [];
  const seenIds = new Set();
  let duplicatesWithinPull = 0;
  const pageCursors = [];
  let cursor = startDateIso;
  let pagesFetched = 0;
  let failures = 0;
  let completenessIssue = null;

  for (let i = 0; i < maxPages; i++) {
    const result = await fetchClassesPage(session, cursor, metrics);
    if (result.outcome === "failed") {
      failures++;
      completenessIssue = `page ${i} (cursor=${cursor}) failed after retries: ${result.error ?? result.status}`;
      break;
    }
    pagesFetched++;
    const classes = result.data.classes ?? [];
    pageCursors.push({ page: i, cursor, returned: classes.length, nextKey: result.data.nextKey });

    for (const c of classes) {
      const key = `${c.EventId}|${c.OccurrenceDate}`;
      if (seenIds.has(key)) duplicatesWithinPull++;
      else seenIds.add(key);
      allRecords.push(c);
    }

    if (!result.data.nextKey || classes.length === 0) break;
    if (result.data.nextKey === cursor) {
      completenessIssue = `nextKey did not advance past ${cursor} — stopping to avoid an infinite loop`;
      break;
    }
    cursor = result.data.nextKey;
  }

  const totalDurationMs = performance.now() - t0;
  const latencies = metrics.requests.filter((r) => typeof r.durationMs === "number").map((r) => r.durationMs);

  return {
    municipality,
    categoryName,
    totalRequests: metrics.requests.length,
    successfulRequests: metrics.requests.filter((r) => r.status === 200).length,
    failedRequestAttempts: metrics.requests.filter((r) => r.status !== 200).length,
    pagesFetched,
    failures,
    completenessIssue,
    totalDurationMs,
    avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
    minLatencyMs: latencies.length ? Math.min(...latencies) : 0,
    rawRecordCount: allRecords.length,
    uniqueRecordCount: seenIds.size,
    duplicatesWithinPull,
    approxPayloadBytes: JSON.stringify(allRecords).length,
    pageCursors,
    sampleRecords: allRecords.slice(0, 5),
  };
}
