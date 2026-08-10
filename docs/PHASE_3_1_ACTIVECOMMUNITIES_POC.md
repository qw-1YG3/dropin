# Phase 3.1 — ActiveCommunities Data Access Proof of Concept

**Mississauga + Richmond Hill.** A data-access/engineering investigation, not an implementation. No production code was changed (see §16). Deliverable per the requested format: every claim is tagged **[WEBSITE]** (verified from the official municipal website), **[NETWORK]** (verified from real network traffic captured in a browser), **[API]** (verified from a real API response, including via plain `curl`/Node with no browser involved), **[INFERENCE]**, **[RECOMMENDATION]**, or **[UNKNOWN]**.

**Primary question, answered up front:** Yes, conditionally. Both municipalities' drop-in schedule data is reachable from a normal server-side HTTP client — no login, no CAPTCHA, no browser rendering — via a two-step handshake (one `GET` to mint a session + CSRF token, then `POST` requests against a documented-shape internal REST API). This was proven end-to-end with real production data for both municipalities, from a cold Node.js process with zero prior browser session. The real open question is not "can we access it" but "is this an internal frontend API we're relying on without any vendor sanction, and how much does that data's own shape (missing age/coordinates/reservation semantics) fall short of what the canonical model wants" — both covered below.

---

## 1. Mississauga Official Recreation Path

**[WEBSITE]**
`mississauga.ca` → Services and programs → *Recreation and sports* → *Sports and activities* → an individual activity page (traced via **Swimming**, `mississauga.ca/recreation-and-sports/sports-and-activities/swimming/`) → a **"Find drop in programs"** button.

That button redirects (full navigation, not embedded) to:
`https://anc.ca.apm.activecommunities.com/activemississauga/calendars?onlineSiteId=0&no_scroll_top=true&defaultCalendarId=1&locationId=287&displayType=0&view=2`

**[NETWORK]** Platform: **ACTIVE Network's ActiveCommunities** (branded "Active Mississauga" on-platform). Tenant identifier: `activemississauga`, embedded directly in the URL path (not a query parameter). `defaultCalendarId` and `locationId` are also plain query parameters — the specific "Swimming" origin page pre-selects calendar `1` and location `287` (Adamson Estate), but both are freely overridable.

A second, separate official path exists: the platform's own top-nav **"Activities"** link leads to a full program/course search (`/activemississauga/activity/search`, 13,329 total results at time of testing) — this is Mississauga's *registered-program* catalog, broader than and structurally different from the drop-in calendar (see §7).

## 2. Richmond Hill Official Recreation Path

**[WEBSITE]**
`richmondhill.ca` → Things to Do → **Get Active** → a "Registered Recreation Programs" link → `richmondhill.ca/en/things-to-do/Community-Recreation-Guide.aspx` → an **"ActiveRH Online Registration System"** link (opens in a new window).

That link's real `href`, extracted directly from the page DOM: `https://anc.ca.apm.activecommunities.com/richmondhill/home`.

**[NETWORK]** Same platform, same shared host (`anc.ca.apm.activecommunities.com`) as Mississauga — only the tenant path segment differs: `richmondhill` vs `activemississauga`. Branded "ActiveRH" on-platform. From `/richmondhill/home`, the top nav's **"Drop-In Calendars"** link leads to `/richmondhill/calendars?...`, structurally identical to Mississauga's calendar URL.

**[INFERENCE]** Both cities' web teams are using the exact same white-labeled municipal recreation product from the same vendor, just reskinned — reinforced strongly by everything found in §3–§6 below.

## 3. Real Network Endpoints Discovered

**[NETWORK + API]** Three endpoints matter, all under `https://anc.ca.apm.activecommunities.com/{tenant}/rest/`, all `POST`, all JSON in and out, and — critically — **byte-for-byte identical shape between the two tenants**:

**`onlinecalendar/filters`** — given a `calendar_id` and a `center_id`, returns that calendar's full list of centers (`center: [{id, name}]`), its activity category taxonomy (`activity_category`), and — the single most useful field found in this whole investigation — an explicit **`calendar_period: {start_date, end_date}`**, the server's own stated real date horizon for that calendar.

**`onlinecalendar/multicenter/events`** — given `calendar_id` and a `center_ids` array (any number of centers, batched), returns real dated session occurrences per center: `{center_id, center_name, events: [...], total}`. Each event carries `title, start_time, end_time, description, facilities, price, reservation_event_type_id, event_type, activity_detail_url, event_item_id`.

**`activities/list`** — a *different* search, over the registered-program catalog rather than the drop-in calendar. Given an `activity_search_pattern` object (keyword, category, age, drop_in flag, etc.), returns program/course-level records: `name, number, date_range_start, date_range_end, days_of_week, time_range, age_description, only_one_day, fee, detail_url`.

Facility/location objects never carry a street address or coordinates in either endpoint — only `facility_name`/`center_name` (see §6).

## 4. Authentication / Session Requirements

**[API]** Confirmed via plain `curl`, zero browser involvement:

1. `GET /{tenant}/calendars?...` — returns `200`, sets several cookies (a `JSESSIONID`, a per-tenant `{tenant}_locale`, and F5 BIG-IP load-balancer cookies), and the HTML response body contains a literal, regex-extractable line: `window.__csrfToken = "<uuid>";`.
2. Every subsequent `POST` to the three endpoints in §3 requires that cookie jar plus an `X-CSRF-Token` header set to the extracted token, and an `X-Requested-With: XMLHttpRequest` header.

No login, no account, no CAPTCHA, no rate-limit encountered, no request signing beyond the CSRF token. This was reproduced from scratch twice — once for each municipality — with no prior state.

**Classification: PUBLIC BUT SESSION-INITIALIZED.** Not a bare stateless public API (a naive single `POST` with no prior `GET` fails), but the "session-initialization" step is a single unauthenticated page load, trivially scriptable, with no secret or manual step involved. This is a materially different (and better) classification than "browser-only" or "fragile" — it held up identically for both municipalities and across dozens of repeated calls during this investigation.

**[UNKNOWN]** Whether the CSRF token or session has an expiry that would require re-minting on a long-running scheduled job (e.g., a daily sync) — not tested, since this investigation's longest single script run was under a minute. A production ingestion job should mint a fresh session per run rather than assume long-lived reuse.

## 5. Pagination / Full-Coverage Findings

**[API]** No pagination exists — or rather, none is needed. `multicenter/events` was tested with `center_ids` arrays as large as **all 41 of Mississauga's centers in a single request**, and returned `total === events.length` (i.e. every matching event, unpaginated) every time:

- Mississauga, calendar 1 ("Drop In Programs"), all 41 centers, one request: **15,872 events**, ~28MB, ~6.5s, `200`.
- Mississauga, calendar 2 ("Library Programs"): 82 events. Calendar 3 ("Drop In Pickleball"): 654 events.
- Richmond Hill, calendar 1 ("Recreational Activities"), all 8 centers, one request: **258 events**.
- Richmond Hill, calendar 13 ("Adults 55+ Members Only"): 219 events.

**Full municipality-wide coverage is achievable in a small, fixed number of requests** — 3 for Mississauga (one per calendar type), 4 for Richmond Hill (one per calendar type: general, 55+, skating, swimming — the latter two were confirmed to exist via the on-platform dropdown but not pulled in full for this POC). This directly answers Phase 3.0's open question: this is not a "first page only" API — a single batched request per calendar type retrieves the entire real dataset.

## 6. Field Availability Matrix

**[API]**, from `multicenter/events` (the genuine session-level endpoint):

| Field | Status |
|---|---|
| Activity name | DIRECTLY AVAILABLE (`title`) |
| Activity category/family | NOT AVAILABLE on this endpoint (category taxonomy exists only in the separate `filters` response, not attached per-event) |
| Activity subtype | NOT AVAILABLE |
| Date / start time / end time | DIRECTLY AVAILABLE (`start_time`, `end_time`, real datetimes) |
| Facility name | DIRECTLY AVAILABLE (`facilities[].facility_name`) |
| Facility address | NOT AVAILABLE — no street address anywhere in this endpoint |
| Age minimum/maximum | **NOT AVAILABLE on this endpoint.** DIRECTLY AVAILABLE on the separate `activities/list` endpoint (`age_description`, `age_min_year` etc.) — see §7 for why these two endpoints don't trivially merge |
| Price/fee | PARTIALLY AVAILABLE — `price.estimate_price` is often a real value (`"Free"`) but frequently the placeholder string `"See Facility for Details"`, which is not a usable fee |
| Capacity / spaces remaining | NOT AVAILABLE on this endpoint (`activities/list` has `total_open`/`enrolled_participants`, but that endpoint is program-level, not tied to a specific dated drop-in occurrence) |
| Registration status | NOT AVAILABLE in a structured field (see §8) |
| True drop-in vs. reservation-required | **NOT AVAILABLE as a structured field** — `reservation_event_type_id` and `event_type` were `0` for every single event observed across both municipalities and all calendars tested (thousands of records) — either an unused field or a distinction this data genuinely doesn't carry. See §8. |
| Cancellation/status | NOT AVAILABLE |
| Program/session ID | DIRECTLY AVAILABLE (`event_item_id`) |
| Facility ID | DIRECTLY AVAILABLE (`facilities[].facility_id`) |
| Coordinates | **NOT AVAILABLE anywhere in either endpoint, for either municipality.** Same gap as Toronto. |
| Official activity URL | DIRECTLY AVAILABLE (`activity_detail_url`, a real per-program public page) |
| Last-updated/freshness signal | NOT AVAILABLE per-event; the `calendar_period` field (§3) is a horizon signal, not a last-modified timestamp |

## 7. Session-vs-Program Data Model Findings — the critical distinction

**[API]** ActiveCommunities exposes **both models, on two different endpoints, and they are not the same records:**

- `onlinecalendar/multicenter/events` → genuine **SESSION/OCCURRENCE** records. `start_time`/`end_time` are real specific datetimes ("2026-08-11 19:00:00" → "2026-08-11 20:00:00"), one row per dated occurrence. This is the data DropIn actually wants, directly.
- `activities/list` → **PROGRAM/COURSE** records. `date_range_start`/`date_range_end` plus `days_of_week` plus one `time_range` describe a recurring weekly pattern over a span (e.g. "June 29, 2026 to August 31, 2026", "Mon 6:15 PM–7:15 PM") — DropIn would have to project this into individual dated sessions itself, exactly the "Model B" the ticket asked us to distinguish. Some `activities/list` records do carry `only_one_day: true`, meaning a subset are effectively single-occurrence already, but this is not guaranteed per record.

**Do not conflate these two.** The calendar endpoint is directly usable as Session-shaped data with no projection logic needed. The activities endpoint is richer (age, price detail, capacity) but requires date-range projection and is the wrong primary source for a walk-in drop-in product — it mixes true drop-in with fully registered, non-drop-in programs (`drop_in` is a request *filter* on this endpoint, not a guaranteed property of every returned row unless explicitly filtered).

**[UNKNOWN]** Whether a given calendar event's `event_item_id` reliably joins back to a specific `activities/list` record's `id` for the same program (which would let a production adapter merge session dates with program-level age/price data). Not tested in this POC — worth a small, targeted test in Phase 3.2 before assuming it's a free win.

## 8. Drop-In / Reservation Semantics

**[API]** This is the least satisfying finding of the investigation, stated plainly rather than softened: **the structured fields that look like they should carry this distinction (`reservation_event_type_id`, `event_type`) were `0` for literally every event observed** — Mississauga (15,872 events, 3 calendars) and Richmond Hill (477 events, 2 calendars) alike. Either the field is unused/vestigial in both cities' configurations, or it encodes a distinction neither municipality happens to use any non-default value for.

**[API]** Each event does carry a free-text `description` field (HTML, often 200–1000+ characters of marketing copy) that sometimes states attendance expectations in prose — e.g. one sampled Mississauga record's description opens "This is a FREE, supervised DROP-IN outdoor program..." — but this is unstructured text, not a queryable field, and inconsistent in phrasing across the 241+ distinct descriptions sampled.

**Conclusion: neither municipality's ActiveCommunities data currently gives DropIn a reliable structured signal for walk-in vs. reservation-required vs. capacity-limited.** Phase 3.0 raised Vaughan (a different platform, PerfectMind) as a concrete example of "drop-in" meaning "registration required" — this POC cannot confirm or rule out an equivalent semantic gap for Mississauga or Richmond Hill specifically, because the field that should say so doesn't vary.

**[RECOMMENDATION]** A canonical `attendanceMode` field (`walk_in | reservation_available | reservation_required | registration_required | unknown`), as the ticket sketched, would be the right shape *if* a reliable signal existed to populate it. Given this evidence, it should default to `unknown` for every ActiveCommunities-sourced session rather than being asserted as `walk_in` — asserting "walk-in" from a `0` in an apparently-unused field would be inventing certainty the data doesn't support. **Do not implement this field yet** (per the ticket's own instruction) — but the honest default, whenever it is implemented, is `unknown`, not `walk_in`.

## 9. Date Horizon

**[API]** Directly stated by the server, not just empirically observed — the `calendar_period` field from `onlinecalendar/filters`:

- **Mississauga**: `{"start_date": "2026-08-10", "end_date": "2026-11-23"}` — a **~105-day** horizon. Cross-checked empirically: the actual latest `start_time` across all 15,872 pulled events was 2026-11-22, one day inside the stated boundary.
- **Richmond Hill**: `{"start_date": "2026-08-10", "end_date": "2026-08-31"}` — a **~21-day** horizon. Confirmed on both the general calendar and the 55+ calendar.

**This is a genuine, real difference between two municipalities on the identical platform** — not a technical API limitation, almost certainly a per-tenant configuration choice each city's recreation department made (how far out they publish schedules). **Any production adapter must read `calendar_period` per municipality at ingestion time rather than assuming a fixed window** — hardcoding "105 days" from the Mississauga test would silently under- or over-fetch for Richmond Hill.

## 10. Stability Assessment

**[API + INFERENCE]**

- Route structure: stable, versionless-looking REST paths (`/rest/onlinecalendar/...`), consistent across both tenants.
- JSON schema: **identical field names and shapes across both municipalities**, strong evidence this is a shared, actively-maintained vendor product rather than a per-city customization.
- Session mechanism: standard `JSESSIONID` (Java backend) + CSRF double-submit pattern — a conventional, well-understood web architecture, not a bespoke or fragile one.
- **Cookies observed include F5 BIG-IP load-balancer and `TS*`-prefixed cookies** — the `TS` prefix is a recognizable signature of F5 BIG-IP Application Security Manager (a WAF/anti-bot layer). It did **not** block any of this investigation's requests, but its presence means there is *some* bot-mitigation infrastructure in front of this endpoint that a production job could plausibly trip under different request patterns (much higher frequency, unusual headers, etc.) even though it didn't trip here.
- No rate-limiting was encountered in this investigation's request volume (roughly 30–40 requests total across both tenants, including one 41-center/15,872-event batch) — but this was not a sustained-load test, and a real daily production job's behavior under repeated automated use over weeks is untested.

**Rating: MEDIUM-HIGH.** Genuinely stable-looking, consistent, well-behaved API surface with strong cross-municipality evidence of shared engineering — but it is an internal frontend API (see §11), not a documented, versioned public contract, and the WAF cookies are a real signal that some anti-automation posture exists even if untriggered so far.

## 11. Access / Licensing Risk

**[API]** No `robots.txt` restriction was found at `anc.ca.apm.activecommunities.com/robots.txt` — the path 301-redirects to ACTIVE Network's own marketing site rather than serving an actual robots file, meaning there is no explicit machine-readable crawl policy either permitting or forbidding this kind of access.

**[WEBSITE]** A "Terms of Use" link exists in the platform's own footer on both tenants' pages. **This investigation did not read its contents in depth** — per this ticket's own instruction not to draw legal conclusions, its actual terms are left as an open item rather than summarized or judged here.

**[INFERENCE]** This is not a documented, vendor-sanctioned public API (unlike the ACTIVE Network Developer API surfaced in Phase 3.0, which is a *different* product — a self-service, publicly documented REST API with published rate limits). What this POC accessed is the same internal REST API the municipalities' own public websites call to render their own pages — reachable by anyone with a browser, but not published, versioned, or supported as a third-party integration point.

**Risk classification: MEDIUM.** Technically open, unauthenticated, and used here in a read-only, low-volume, non-disruptive way matching normal public website usage — but it is an undocumented internal API of a commercial vendor product, not a sanctioned integration path, and its Terms of Use have not been reviewed. **[RECOMMENDATION]** Before any production ingestion job is built against this endpoint, someone should actually read that Terms of Use page, and ideally the municipality or ACTIVE Network should be informed this data will be used (a low-cost, high-goodwill step, independent of what the terms turn out to say).

## 12. Mississauga vs. Richmond Hill — Comparison

| Capability | Mississauga | Richmond Hill |
|---|---|---|
| Official municipal entry | `mississauga.ca` → Recreation → activity page → "Find drop in programs" | `richmondhill.ca` → Get Active → Community Recreation Guide → ActiveRH link |
| Underlying platform | ActiveCommunities (tenant `activemississauga`) | ActiveCommunities (tenant `richmondhill`) |
| Machine-readable endpoint | Identical `/rest/onlinecalendar/*` + `/rest/activities/list` | Identical, byte-for-byte same shape |
| Anonymous access | Yes (session+CSRF, no login) | Yes (session+CSRF, no login) |
| Full-result enumeration | Yes — 15,872 events / 41 centers in 1 request | Yes — 258 events / 8 centers in 1 request |
| Pagination | None needed | None needed |
| Session-level dates | Yes, real `start_time`/`end_time` | Yes, real `start_time`/`end_time` |
| Activity name | Direct | Direct |
| Facility name | Direct | Direct |
| Address | Not available | Not available |
| Age | Not on calendar endpoint; available on `activities/list` | Same |
| Fee | Partial (`"Free"` or placeholder text) | Same pattern |
| Capacity | Not on calendar endpoint | Same |
| Reservation semantics | Flat/unpopulated (`0` everywhere) | Flat/unpopulated (`0` everywhere) |
| Coordinates | Not available | Not available |
| Official URL | Direct (`activity_detail_url`) | Direct, same field |
| Freshness signal | `calendar_period` only, no per-event timestamp | Same |
| **Date horizon** | **~105 days** | **~21 days** |
| Number of centers | 41 | 8 |
| Activity category taxonomy | 10 categories | 3 categories |
| Stability | MEDIUM-HIGH | MEDIUM-HIGH (identical mechanism) |
| Access risk | MEDIUM | MEDIUM |
| Canonical Session compatibility | Same gaps as Richmond Hill (§16) | Same gaps as Mississauga |

**Are they the same source family from an ingestion perspective? YES** — one shared adapter (client + endpoint contract) plus municipality configuration, not two bespoke integrations. Every field name, request shape, and response shape was identical. The *only* differences found were data-level configuration (number of centers, category taxonomy breadth, and critically, the date horizon) — exactly what a configuration object should carry, not what should drive separate code paths. This conclusion is evidence-based, not assumed from "both say ActiveCommunities": it required literally running the same client code unmodified against both tenants, which worked (§14).

## 13. POC Fetch Results

**[API]** Two runnable Node.js scripts (native `fetch`, no dependencies) under `scripts/poc/`, sharing one client module — proving Option A (§17) by construction, not just by argument:

- `scripts/poc/activecommunities-client.mjs` — session creation (GET + CSRF extraction), `getFilters`, `getEvents`, `searchActivities`. Tenant-agnostic.
- `scripts/poc/normalize-sample.mjs` — maps a raw calendar event to DropIn's current `Session` shape, leaving genuinely-unavailable fields `undefined` rather than fabricated.
- `scripts/poc/activecommunities-mississauga.mjs` and `scripts/poc/activecommunities-richmondhill.mjs` — thin runners, differing only in tenant slug and starting center/calendar IDs.

Both were run from a cold process with no prior browser session. Real output:

```
[mississauga] session established, csrf token acquired
[mississauga] 41 centers found; calendar_period={"start_date":"2026-08-10","end_date":"2026-11-23"}
[mississauga] fetched 15872 real events across 41 centers in one request
[mississauga] raw snapshot (capped, 5/center) saved to data/raw/mississauga/<timestamp>.json
[mississauga] normalized sample (15 sessions) saved to data/raw/mississauga/<timestamp>-normalized-sample.json
[mississauga] activities/list cross-check: 20 badminton program records returned, first has age_description="Age at least 12 yrs but less than 15 yrs,"

[richmondhill] session established, csrf token acquired
[richmondhill] 8 centers found; calendar_period={"start_date":"2026-08-10","end_date":"2026-08-31"}
[richmondhill] fetched 258 real events across 8 centers in one request
[richmondhill] raw snapshot saved to data/raw/richmond-hill/<timestamp>.json
[richmondhill] normalized sample (15 sessions) saved to data/raw/richmond-hill/<timestamp>-normalized-sample.json
[richmondhill] activities/list cross-check: 20 badminton program records returned, first has age_description="55 yrs +,"
```

Not wired into the app; production registry (`lib/dropin/sources/index.ts`), municipality registry, and canonical types were not touched.

## 14. Raw Snapshot Examples Created

**[API]**
- `data/raw/mississauga/<timestamp>.json` — real API responses: full `filters` (41 centers, categories, `calendar_period`), a `coverageSummary` (per-center real totals proving the 15,872-event full pull), and events capped to 5/center (~824KB) for repo-reasonable inspection rather than the full ~28MB pull.
- `data/raw/mississauga/<timestamp>-normalized-sample.json` — 15 real sessions mapped to DropIn's `Session` shape.
- `data/raw/richmond-hill/<timestamp>.json` — full real response, uncapped (679KB, reasonable as-is).
- `data/raw/richmond-hill/<timestamp>-normalized-sample.json` — 15 real sessions mapped to DropIn's `Session` shape.

This demonstrates the proposed two-stage flow end-to-end: remote source → raw snapshot (provenance-preserving, inspectable) → normalization (separate, reproducible step) — not the final storage architecture, per the ticket's own framing.

## 15. Canonical Session Mapping

**[API + INFERENCE]** Real field-by-field classification, from actually running the normalizer against real data (see `scripts/poc/normalize-sample.mjs` and the saved normalized samples):

| Session field | Classification | Note |
|---|---|---|
| `id` / `projectedOccurrenceId` | DIRECT MAP (constructed) | Built from `event_item_id` + date + time — stable, collision-safe |
| `sourceScheduleId` | DIRECT MAP | `event_item_id` alone (identifies the recurring program across its dates) |
| `activity` | DIRECT MAP | `title` |
| `category` | TRANSFORMATION REQUIRED | No taxonomy mapping exists yet for this source family; currently falls back to raw title, same pattern as Toronto |
| `date`, `startDateTime`, `endDateTime` | DIRECT MAP | Real datetimes, straightforward reformat (space → `T`) |
| `dayOfWeek`, `absoluteTime`, `startMinutes` | TRANSFORMATION REQUIRED | Derivable via existing `lib/dropin/time.ts` utilities — not a gap, just not done in this POC |
| `centre` | DIRECT MAP | `facilities[0].facility_name` |
| `municipality` | DIRECT MAP | Adapter-supplied constant, same pattern as Toronto |
| `district` | **MODEL GAP** | Source has no neighbourhood/district concept whatsoever — not even facility-region data |
| `address` | **MODEL GAP** | Never provided by this source |
| `postalCode` | **MODEL GAP** | Never provided |
| `latitude`/`longitude` | **MODEL GAP** | Never provided — same gap as Toronto |
| `price` | TRANSFORMATION REQUIRED / OPTIONAL | Real when `"Free"`; frequently a non-value placeholder string requiring a decision (store as-is? treat as missing?) |
| `ageMin`/`ageMax` | **MODEL GAP on the session-level endpoint specifically** | Only available on the separate program-level `activities/list` endpoint — a real join question, not a simple absence (§7) |
| `phone` | **MODEL GAP** | Never provided |
| `officialUrl` | DIRECT MAP | `activity_detail_url`, a real, working per-program public URL |
| `officialSource` | DIRECT MAP (constructed) | Adapter-supplied constant per municipality |
| `lastUpdated` | TRANSFORMATION REQUIRED | No per-event timestamp; would be fetch-time, same limitation Toronto already has |
| `verificationStatus` | RECOMMENDATION | Should start `"unverified"` for this source family given the semantic gaps in §8, unlike Toronto's `"verified"` |

**No changes were made to the canonical model.** Every gap above is a genuine data absence, not a modeling oversight — the current `Session` type already has these fields as optional for exactly this reason.

## 16. Model Gaps — Summary

**[INFERENCE]** Three gap categories, in order of how much they matter:

1. **Coordinates and address** — absent from this source family entirely, same as Toronto. Not a new problem; confirms Phase 3.0's Phase-4 framing (geocoding) is still correctly deferred and will eventually be needed regardless of which family of sources DropIn adds.
2. **Age eligibility split across two endpoints** — a genuinely new problem Toronto didn't have (Toronto's single feed carries everything). Needs a real decision in Phase 3.2: attempt the join (§7's open unknown), fetch both endpoints and merge, or ship ActiveCommunities sessions without age data initially and treat it as a known, disclosed gap.
3. **No structured attendance-mode signal** — the deepest gap, discussed fully in §8. Not fixable by better parsing; the source simply doesn't carry it in either municipality tested.

**District/neighbourhood** is a gap worth naming separately from the others: Phase 3.0 already flagged that `lib/dropin/districts.ts` is Toronto-only. This POC confirms the *data itself* wouldn't help even if that code were generalized — ActiveCommunities has no neighbourhood concept to map from at all, for either municipality. Any future "neighbourhood" search for these municipalities would need a separate facility-to-neighbourhood lookup table maintained outside the source data entirely, or would need to be scoped down to municipality/postal-code-level search only for this source family.

## 17. Recommended Production Adapter Architecture

**[RECOMMENDATION]**, directly evidence-based per §12: **Option A — one `ActiveCommunitiesAdapter` + per-municipality configuration**, not Option B (separate transformers) and not Option C (separate adapters). The evidence supports this strongly: this POC's own client module (`activecommunities-client.mjs`) was written once and used, completely unmodified, against both tenants — the only per-municipality inputs were the tenant slug and starting center/calendar IDs. A configuration object per municipality (tenant slug, list of calendar IDs to pull, municipality display name, official-source label) is sufficient; no municipality-specific transformation logic was needed anywhere in this POC.

The one piece of *real* per-municipality variability found — the `calendar_period` date horizon — is not a reason to fork the adapter; it's a reason the adapter must read that field from the API at runtime rather than hardcode a window, which the POC client already does correctly (nothing in `getFilters`/`getEvents` assumes a fixed horizon).

## 18. Which Municipality Should Be Integrated First

**[RECOMMENDATION]** Mississauga remains the right first ActiveCommunities integration, now on stronger evidence than Phase 3.0's conditional recommendation: **larger real dataset (15,872 vs. 258 events), longer real date horizon (105 vs. 21 days), broader real activity taxonomy (10 vs. 3 categories) — a better test of whether the adapter and canonical model hold up under realistic production volume and variety**, not just whether the mechanism works at all.

**Richmond Hill's real value is as the immediate second integration**, precisely because it is smaller and differently shaped (fewer centers, shorter horizon, narrower taxonomy, an additional members-only calendar tier Mississauga didn't exhibit) — it is a genuinely good Phase-3.3 "validate with two municipalities" candidate specifically *because* its differences are configuration-shaped, not code-shaped, which is exactly the hypothesis Phase 3.3 needs to test.

## 19. Exact Remaining Blocker Before Implementation

**[RECOMMENDATION]**, stated precisely rather than vaguely:

There is no *technical* blocker — access, full coverage, and canonical-model fit are all proven with real data. The actual remaining blocker is a **product/data-honesty decision, not an engineering one**: DropIn's whole premise is trustworthy walk-in drop-in information, and this source family cannot currently back a claim of "walk-in, no reservation needed" for any session with real data (§8) the way Toronto's data — imperfectly, but at least nominally — can. Before Phase 3.2 ships real ActiveCommunities sessions into the product, a decision is needed on **how the UI should represent attendance-mode uncertainty** for these sessions (e.g., does "verificationStatus: unverified" surface differently in the Decision Sheet? does the card avoid the word "drop-in" language that implies no-reservation-needed?) — that is a product-facing decision this document deliberately does not make, consistent with the instruction not to touch Results UI in this phase.

Secondary, lower-priority items: reading the platform's Terms of Use (§11) before committing to production ingestion, and testing the `activities/list` ↔ `multicenter/events` join (§7) to see if age data is recoverable without a second gap being permanently accepted.

---

## Appendix — Unknowns Carried Forward

- Whether CSRF/session tokens expire in a way that matters for a long-running scheduled sync (§4).
- Whether `event_item_id` reliably joins calendar events to `activities/list` program records for age/fee enrichment (§7).
- The actual content of the platform's Terms of Use (§11) — deliberately not reviewed here to avoid drawing legal conclusions this document isn't positioned to make.
- Behavior under sustained, repeated, multi-week automated use (rate limiting, WAF response) — this POC's request volume was too low to observe.
- Richmond Hill's "Skating & Shinny" and "Swimming & Aquafit" calendars were confirmed to exist but not pulled in full in this POC (time-boxed; the general and 55+ calendars were sufficient to establish the findings above).
