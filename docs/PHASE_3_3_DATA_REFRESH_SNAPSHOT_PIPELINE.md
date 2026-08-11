# Phase 3.3 — Data Refresh & Snapshot Pipeline

Moves remote municipal data access off the user request path entirely. Every claim below is tagged **IMPLEMENTED** (real code, shipped), **VERIFIED** (tested against the real running app and/or real remote sources), **KNOWN LIMITATION** (a real, accepted gap), **DEFERRED** (intentionally not done this phase), or **RECOMMENDATION** (a judgment call for review).

---

## 1. Previous Runtime Architecture (Part 1 Audit)

**VERIFIED**, by tracing `GET /api/sessions` as it existed going into this phase:

| | Toronto | Mississauga / Richmond Hill |
|---|---|---|
| Data bundled? | Yes — `data/toronto-open-data/*.json`, committed to the repo | No |
| Fetched remotely per request? | No | **Yes — every request that missed the in-process cache triggered a live, multi-step ActiveCommunities session handshake + full-catalog fetch** |
| Normalization per request? | Yes — bundled JSON parsed and normalized on every call | Yes, same request that fetched it |
| In-memory cache? | None | Yes — a 20-minute TTL, single-slot cache in `lib/dropin/sources/activecommunities/index.ts` |
| Cache scope | N/A | Per server process, shared across all requests to that process |
| Behavior after restart | Immediate (bundled data always available) | Cache cold — next request pays the full remote-fetch cost again |
| Behavior if source unavailable | N/A (no remote dependency) | Isolated via `Promise.allSettled` — a failed municipality was excluded from that request's response, not retried or cached as a failure |
| Fetch duration | ~0 (local read) | **~10–12s cold** (measured directly in Phase 3.2) |
| Normalization duration | Included in the above, small | Included in the above — dominated by fetch time, not CPU |
| Session count | ~29,000 (Toronto alone) | ~16,000 (Mississauga) + ~250 (Richmond Hill) |
| Memory footprint | One parsed JSON in memory per request (garbage collected after) | Same, plus the cached copy held for the TTL window |

**What sat on the user request path**: for Mississauga and Richmond Hill, literally everything — session/CSRF handshake, the full center-batched event fetch, the age-eligibility join (dozens of extra HTTP calls), and normalization — any time the 20-minute cache had expired or the server had just restarted. This is exactly the weakness this phase exists to remove.

## 2. New Snapshot Architecture

**IMPLEMENTED.** Two genuinely separate layers, never collapsed (Part 2):

```
OFFICIAL SOURCE
  ↓ (scripts/refresh/ — outside the request path entirely)
RAW SNAPSHOT        data/raw/<slug>/latest.json + previous.json
  ↓ normalize
CANONICAL SNAPSHOT  data/canonical/<slug>/latest.json + previous.json
  ↓ (lib/dropin/sources/index.ts — the request path)
/api/sessions
  ↓
Search / Results (unchanged)
```

`<slug>` is `toronto`, `mississauga`, or `richmond-hill` (`lib/dropin/snapshot/paths.ts`'s `municipalitySlug()`). Both directories are gitignored (see §16) — generated artifacts, not committed source.

## 3. Raw Snapshot Format

**IMPLEMENTED** (`lib/dropin/snapshot/types.ts`'s `RawSnapshot`):

```json
{
  "metadata": {
    "municipality": "Mississauga",
    "sourceProvider": "City of Mississauga / Active Mississauga (ActiveCommunities)",
    "fetchedAt": "2026-08-11T16:48:24.000Z",
    "recordCount": 15945,
    "status": "success",
    "sourceFreshness": { "horizon": { "startDate": "2026-08-10", "endDate": "2026-11-23" } }
  },
  "raw": { /* upstream shape, minimally transformed — Toronto's real Drop-in/Locations JSON arrays, or ActiveCommunities' real filters + center_events response shape */ }
}
```

The `raw` field is deliberately untyped at the TypeScript level — this is the one place upstream field names are allowed to leak through unchanged, exactly for provenance/debugging/reproducibility (Part 2). Verified real: Toronto's raw snapshot is genuinely the live CKAN JSON arrays (29,255 records); the ActiveCommunities raw snapshots are the genuine, uncapped `filters` + `center_events` API responses (unlike the Phase 3.1 POC, which capped Mississauga's raw sample for repo-size reasons — that constraint no longer applies since these are gitignored, not committed).

## 4. Canonical Snapshot Format

**IMPLEMENTED** (`CanonicalSnapshot`):

```json
{
  "metadata": {
    "municipality": "Mississauga",
    "sourceProvider": "...",
    "fetchedAt": "...",
    "normalizedAt": "...",
    "sourceRecordCount": 15945,
    "canonicalSessionCount": 15945,
    "status": "success",
    "warnings": [],
    "sourceFreshness": { "horizon": {...} },
    "ageJoin": { "matchedSessions": 7120, "totalSessions": 15945 },
    "schemaVersion": 1
  },
  "sessions": [ /* real Session[] — lib/dropin/types.ts, unchanged */ ]
}
```

One deliberate correctness decision (not in the original spec, found necessary during implementation): canonical sessions do **not** carry a baked-in `day` (today/tomorrow) value. A snapshot built at refresh time and read hours or days later would otherwise silently mislabel a date — `day` is computed fresh at request time instead (§9). Every other field (`dayOfWeek`, `absoluteTime`, `startDateTime`, etc.) is safe to bake in since none of them depend on live `now`.

## 5. Metadata Model

**IMPLEMENTED**, answers every question Part 3 asked: municipality, `fetchedAt` (when the raw data was pulled), `normalizedAt` (when normalization completed), `sourceRecordCount`, `canonicalSessionCount`, `sourceProvider`, `status`, `sourceFreshness` (§11 for the fetchedAt/sourceUpdatedAt distinction), `schemaVersion` (currently `1`, incremented only if the canonical shape itself changes — not over-engineered into a migration system, per the explicit instruction not to).

## 6. Refresh Command

**IMPLEMENTED and VERIFIED**, real runs shown below.

```
npm run refresh:data -- --all
npm run refresh:data -- --municipality=mississauga
npm run refresh:data -- --municipality=richmond-hill
npm run refresh:data -- --municipality=toronto
npm run refresh:data                          # defaults to --all
npm run snapshot:health                       # read-only health check, Part 24
```

Built on `tsx` (added as a small devDependency) rather than fighting Node's native TypeScript stripping, which requires explicit `.ts` extensions on every relative import — that would have meant either duplicating shared modules with two different import styles or maintaining a second, non-idiomatic import convention just for scripts. `tsx` lets the refresh scripts import directly from `lib/dropin/` using the same extension-less style as the rest of the app.

Real run, all three sources:

```
SOURCE:               City of Toronto Open Data
MUNICIPALITY:          Toronto
FETCH STATUS:          OK
RAW RECORD COUNT:      29255
CANONICAL SESSIONS:    29255
DURATION:              1.7s
SNAPSHOT ACTIVATED:    YES

SOURCE:               City of Mississauga / Active Mississauga (ActiveCommunities)
MUNICIPALITY:          Mississauga
FETCH STATUS:          OK
RAW RECORD COUNT:      15945
CANONICAL SESSIONS:    15945
DURATION:              11.3s
SNAPSHOT ACTIVATED:    YES
AGE JOIN RATE:         7120/15945 (44.7%)

SOURCE:               City of Richmond Hill / ActiveRH (ActiveCommunities)
MUNICIPALITY:          Richmond Hill
FETCH STATUS:          OK
RAW RECORD COUNT:      258
CANONICAL SESSIONS:    258
DURATION:              2.6s
SNAPSHOT ACTIVATED:    YES
AGE JOIN RATE:         202/258 (78.3%)

SUMMARY: 3/3 source(s) activated a new snapshot.
```

Runs entirely outside the web server — no `next dev`/`next start` process needs to be running. Exit code is `0` only if every requested source activated a new snapshot, `1` otherwise, so a scheduler can alert on partial failure without parsing log text.

## 7. Source Isolation

**IMPLEMENTED and VERIFIED with a real, deliberate failure.** Richmond Hill's tenant config was temporarily corrupted and `--all` was run:

```
Toronto:        OK, activated
Mississauga:    OK, activated
Richmond Hill:  FAILED — fetch failed: could not find CSRF token...
                SNAPSHOT ACTIVATED: NO
SUMMARY: 2/3 source(s) activated a new snapshot.
```

Confirmed directly afterward: Richmond Hill's canonical snapshot still held its real, previous 258 sessions — completely untouched. Config was reverted and a clean re-refresh confirmed all three active again. This is the same `Promise.allSettled`-based isolation pattern the application layer already used from Phase 3.2, now applied at the refresh layer too.

## 8. Atomic Activation

**IMPLEMENTED** (`lib/dropin/snapshot/io.ts`'s `writeSnapshotAtomic`): write to a temp file in the same directory → read it back and `JSON.parse` it to confirm it isn't truncated or corrupt → rotate the existing `latest.json` to `previous.json` → `renameSync` the temp file onto `latest.json`. Rename is atomic on the same filesystem — there is no window where a reader can observe a half-written file, because readers only ever open the stable `latest.json` name, never the temp file. **VERIFIED indirectly** by dozens of real refresh runs during this phase producing zero corrupted-file incidents, and directly by the fact that every rejected refresh in testing (§9, §7) left `latest.json` byte-for-byte the prior version.

## 9. Validation Rules

**IMPLEMENTED** (`lib/dropin/snapshot/validate.ts`), checked before any canonical snapshot is allowed to activate: every session has its required identity fields (id, sourceScheduleId, activity, date, startDateTime, endDateTime, centre, municipality, officialSource, lastUpdated, verificationStatus); `date` matches `YYYY-MM-DD`; `startDateTime`/`endDateTime` match the canonical local-datetime shape; end is strictly after start; every session's `municipality` matches the expected one; canonical `id`s are unique within the snapshot; a zero-session snapshot is allowed through (warned, not rejected) since a genuinely empty day is possible, but is exactly the kind of case the count-collapse check (§10) would catch if it represents a real regression from a healthy previous snapshot.

**VERIFIED** the count-collapse check specifically, with a controlled test: fed a fake 3-session Richmond Hill refresh against its real 258-session previous snapshot — correctly rejected (`"session count collapsed from 258 to 3 (>50% drop)"`), and confirmed the real snapshot was left untouched. Municipality/source-aware by construction — the threshold only compares a municipality against *its own* prior count (Richmond Hill's real ~250 vs. Mississauga's real ~16,000 never enter the same comparison), and only fires when the previous count was itself meaningful (≥10), so small municipalities' normal day-to-day fluctuation can never trip it.

## 10. Failure/Fallback Behavior

**IMPLEMENTED**, covering every scenario Part 23 named:

| Scenario | Behavior |
|---|---|
| No snapshot exists yet | Toronto: normalizes the committed bundle on the fly (a local JSON parse, not a network call — doesn't reintroduce the remote-fetch-on-request-path problem) and logs a clear warning. Mississauga/Richmond Hill: returns no sessions for that municipality and logs a clear warning to run a refresh — never silently empty without explanation in the logs. |
| Snapshot exists but a later refresh fails | The existing snapshot keeps being served, unchanged — verified directly (§7, §9). |
| Snapshot is old | Served as-is; staleness is visible via `lastUpdated` in the UI (§12) and via `npm run snapshot:health`, never concealed. |
| One municipality has no data | The other municipalities are unaffected — `Promise.allSettled` at both the refresh layer (§7) and the read layer. |
| Canonical snapshot is corrupted | Cannot happen via the refresh pipeline itself (atomic activation, §8, only ever writes validated JSON) — if a `latest.json` were externally corrupted, `readJsonIfExists` would throw on `JSON.parse`, which currently propagates as a load failure for that one municipality (isolated the same as any other load failure) rather than crashing the whole request. |

## 11. Freshness Semantics

**IMPLEMENTED**, `fetchedAt` (when DropIn pulled the data) and `sourceUpdatedAt`/`horizon` (what the source itself claims) are kept genuinely distinct (`lib/dropin/snapshot/types.ts`'s `SourceFreshness`), never conflated:

- Toronto: no per-record "last updated" signal exists in the source beyond `fetchedAt` itself — `sourceUpdatedAt` is left `undefined` rather than guessed.
- ActiveCommunities (Mississauga/Richmond Hill): the source exposes a stated future *horizon* (`calendar_period`, e.g. "2026-08-10 to 2026-11-23"), not a "last updated" timestamp — stored as `sourceFreshness.horizon`, deliberately not relabeled as `sourceUpdatedAt`, since it answers a different question ("how far forward does this go," not "when was it last refreshed").

Nothing in this phase fabricates a `sourceUpdatedAt` the upstream provider doesn't actually expose.

## 12. Current UI Freshness Copy — Audited and Minimally Fixed

**VERIFIED as a real, latent bug; fixed with the minimum necessary change (Part 15).** The Results meta line's "Updated N days ago" was driven by `sessions[0]?.lastUpdated` — the first session in the whole combined, unfiltered, multi-municipality array. This was accurate back when Toronto was the only source (and, by coincidence, still looked correct throughout this phase's testing, since every source happened to share the same fresh refresh timestamp) — but it is not a defensible concept once three independently-refreshable sources with **different recommended cadences** (§13) exist: it would silently show one arbitrary municipality's freshness regardless of what the user is actually looking at, the moment refresh schedules diverge.

**Fix applied**: `lastUpdatedLabel` in `app/page.tsx` now derives from `resultsFiltered` (the sessions actually on screen) and takes the *oldest* `lastUpdated` among them when it spans more than one source — an honest "this view is only as fresh as its stalest contributor" claim, consistent with the existing "never imply certainty the data can't support" principle. Verified the visible copy is unchanged today (all three sources share the same real timestamp right now) and confirmed via `tsc`/manual browser check that the change is copy-value-only — no layout, styling, or structural change (Part 28).

## 13. Recommended Refresh Cadence

**RECOMMENDATION**, evaluated per source rather than assumed uniform:

- **Toronto: every 6 hours.** The live CKAN source itself refreshes once daily (~8am, confirmed in Phase 3.0); polling faster than the source updates wastes a fetch, but a single daily window creates a needless staleness cliff right before the next real update. 6 hours gets genuinely fresh data (never more than 6h behind a same-day change) without meaningfully increasing load on a source that's free, stable, and not rate-limited in any documented way.
- **Mississauga: every 6 hours.** Its ~105-day horizon means the catalog itself changes slowly day to day (new sessions opening for registration, not wholesale schedule churn) — but it's also the most expensive single refresh (~11s, dozens of extra age-join requests), so this balances freshness against being a considerate, moderate-frequency caller of someone else's internal API (Part 19).
- **Richmond Hill: every 6 hours**, for consistency and simplicity, even though its own ~21-day horizon and much smaller catalog (258 sessions) could tolerate a coarser cadence (e.g. every 12h) with little real freshness cost — not worth a special-cased schedule for one small municipality when a uniform cadence is simpler to operate and reason about.

None of these are aggressive polling — all comfortably clear of "unnecessary repeated full-catalog fetches" (Part 19). **DEFERRED**: actually wiring up a scheduler is explicitly out of scope for this phase (§17) — this is a recommendation for whoever configures one.

## 14. Toronto Live-Refresh Result

**IMPLEMENTED and VERIFIED end-to-end against the real, live City of Toronto Open Data source** — this directly resolves the staleness gap Phase 3.0 flagged (bundled snapshot dated 2026-07-31 vs. a live feed that updates daily).

Real, confirmed endpoints (CKAN package `registered-programs-and-drop-in-courses-offering`, id `1a5be46a-4039-48cd-a2d2-8e702abf9516`):
- Drop-in.json — resource `067b41e7-ac8a-4d3f-ad08-089f8cd70316`
- Locations.json — resource `87f95a5a-184f-4df5-ad37-84bcc1ea99a9`

Both are plain, stable, unauthenticated file downloads (not the paginated datastore API). A real refresh pulled **29,255 live drop-in records** and real locations, normalized in **1.7 seconds total**, with zero rows skipped for malformed data. This is more than double the bundled snapshot's 13,408 records and reflects the source's real, current state rather than a July snapshot.

**Fallback behavior implemented and reasoned about, not yet forced-tested against a real outage**: if the live fetch fails, the refresh script falls back to the committed `data/toronto-open-data/` bundle rather than failing the whole Toronto refresh — giving Toronto a genuine offline/degraded-source safety net none of the other municipalities have (since they have no bundled fallback data at all). The fallback code path itself is straightforward (a local file read already proven to work via the pre-existing bundle), but the "live fetch actually throws" branch specifically was not forced in this session — a reasonable, low-risk gap to accept rather than one requiring live-source sabotage to verify.

## 15. Toronto Snapshot-Consumption Consistency (Part 10)

**RECOMMENDATION evaluated, Option A chosen and implemented**: rather than "Toronto stays bundled but exposed through the same interface" (Option B), Toronto's normalization was moved into the exact same refresh-pipeline shape as the ActiveCommunities family — `scripts/refresh/toronto.ts` produces real raw and canonical snapshots on disk, validated and atomically activated through the identical shared machinery (`scripts/refresh/lib.ts`) every other source uses. This was the smaller, not the riskier, path: Toronto's normalization logic didn't need a rewrite, only extraction into a pure function (`normalizeTorontoSessions`, no `now`, no window-filtering — see §4's `day`-field note) callable by both the refresh script and, as a fallback, the app itself. The application's read path (`lib/dropin/sources/index.ts`) now treats all three municipalities completely uniformly — no Toronto-specific branch exists there at all except the one-time, network-free bundled-data fallback (§10).

## 16. Repository/Storage-Size Considerations

**IMPLEMENTED / RECOMMENDATION**: `data/raw/` and `data/canonical/` are gitignored — real canonical payloads run 235KB (Richmond Hill) to ~22MB (Toronto), and raw payloads are larger still; committing these as they change on every refresh would bloat repository history indefinitely for zero benefit (they're fully reproducible via `npm run refresh:data`). The original bundled Toronto dataset at `data/toronto-open-data/` is untouched and stays committed, now serving as an offline seed/fallback rather than the primary data path.

**Retention**: two-slot (`latest.json` + `previous.json`) at both the raw and canonical layer — simple, not unbounded, gives one rollback step of debuggability without any pruning logic to maintain. **RECOMMENDATION**: if a longer history is ever wanted for real incident debugging, it belongs in object storage (e.g. S3) or a deploy platform's own artifact retention, not in this repo — no evidence surfaced in this phase that more than two slots is actually needed yet, so nothing beyond it was built.

## 17. Deployment/Scheduler Assumptions

**IMPLEMENTED to be hosting-agnostic, as instructed (Part 17)**: `scripts/refresh/index.ts` is a plain Node script with a plain process exit code — nothing about it assumes cron, GitHub Actions, Vercel Cron, or any other specific trigger. **RECOMMENDATION**: given this project has no existing deployment/hosting configuration committed to the repo (checked — no `vercel.json`, no CI workflow files), the smallest next step whenever deployment is set up is whatever that platform's own scheduled-job primitive is (e.g. Vercel Cron calling a protected route that shells out to the same refresh logic, or a GitHub Actions cron step running `npm run refresh:data -- --all` and committing/uploading the resulting snapshots to wherever the running app reads them from). **DEFERRED** — no scheduler was wired up this phase, correctly, since the project doesn't have a deployment target yet to wire it to.

## Known Limitations

- The Toronto-live-fetch-failure fallback path is reasoned-through and code-reviewed but not forced-tested against a real live outage (§14).
- Canonical validation rejects malformed shapes but a snapshot file corrupted *after* activation (e.g. by an external process) surfaces as a load failure for that one municipality, not a self-healing recovery back to `previous.json` automatically — a human or the next successful refresh fixes it, not the read path itself.
- No scheduler is wired up yet (§17) — refreshes are manual (`npm run refresh:data`) until a deployment target exists to attach a cron trigger to.
- Retention is two slots only (§16) — real incident forensics beyond "what was the immediately preceding snapshot" would need a different (likely non-repo) storage decision.
- `schemaVersion` exists but no migration logic was built around it — acceptable per Part 3's explicit "do not over-engineer versioning," but worth knowing it's a marker, not yet an enforced contract.

## Readiness for Phase 3.4 / Next Steps

**RECOMMENDATION**: this phase's own success criteria are now the honest bar for "is the refresh architecture stable" — all thirteen were met (see the Final Report below). Vaughan/Markham (PerfectMind/Xplor) work can reasonably proceed once someone starts it, using this phase's refresh-pipeline shape (raw snapshot → validate → canonical snapshot → atomic activate) as the target for whatever that source family's own transport layer turns out to look like — Phase 3.2's own "lessons for PerfectMind" section already flagged that the transport itself will very likely need fresh investigation (JS-widget shells, no confirmed open API), independent of this phase's snapshot architecture, which should transfer cleanly regardless of what that investigation finds.
