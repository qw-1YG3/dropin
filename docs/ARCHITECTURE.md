# Architecture

This document describes architecture decisions and, as of the Production V1 direction, the current implementation state alongside them — the two are called out separately below wherever they diverge, since part of the point of writing this document first was to have a fixed target to measure real implementation against.

---

## System Architecture Overview

DropIn does not talk to official data providers directly on every user request. Instead, official data is synchronized into our own database on a schedule, normalized into a consistent internal format, and served from there.

```
Official Data Source
      ↓
Scheduled Synchronization
      ↓
Normalization
      ↓
DropIn Database
      ↓
Search API
      ↓
Website
```

---

## Source of Truth Principle

DropIn is **not** the source of truth.

Official providers — such as the City of Toronto Open Data Portal — are always the source of truth for schedules, locations, and program details. DropIn's role is narrower and more specific:

- Synchronize official data on a regular schedule
- Normalize that data into a consistent internal format
- Store it in our own database
- Provide a fast, reliable, and searchable experience on top of it

We are not trying to be faster than the official source — we are trying to stay synchronized with it while providing a significantly better user experience than browsing the source directly.

---

## Synchronization Strategy

The website never queries official APIs directly during normal user requests. All official data is pulled in on a schedule, ahead of time, so that user-facing search is always served from our own database rather than from a live upstream call.

This decouples the reliability and speed of the DropIn experience from the reliability and speed of any single official source.

---

## Data Normalization Strategy

Each official source has its own field names, categories, and conventions (see the Toronto Open Data field inventory established earlier in this project). Before anything is stored, incoming records are normalized into DropIn's own consistent internal schema — canonical field names, canonical activity taxonomy, canonical location structure — regardless of how the source data happened to name or structure things.

Source-specific quirks stay at the ingestion boundary. Nothing downstream (search, display) should need to know which source a record originally came from.

---

## Database-First Architecture

Search, filtering, and display are all served from DropIn's own database — never from a live pass-through to an official API. This is what makes the "database-first" principle concrete: the database is the only thing the website talks to at request time; synchronization is a separate, offline process that keeps it current.

---

## Configurable Sync Intervals

The synchronization interval is configurable, not hardcoded. Different official sources update their data at different frequencies, and different municipalities (as coverage expands) may need different schedules. The sync interval is a piece of configuration per source, not a fixed assumption built into the system.

**Current implementation:** this part is not yet built. The Toronto adapter currently reads from a static, manually-refetched snapshot rather than a scheduled sync — see Current Implementation State below.

---

## Multi-Municipality Support

DropIn's target coverage is not one city — it's every municipality whose official recreation data can be integrated, starting with the GTA and expanding from there. The architecture is designed around this from the start rather than being retrofitted for it later: each municipality gets its own source adapter, and every adapter's only job is to produce DropIn's one common normalized record shape (Activity, Category, Community Centre, Municipality, District/Neighbourhood, Address, Postal Code, Latitude/Longitude, Start/End Time, Price, Phone, Website, Official Source, Last Updated, Verification Status). The Search Engine, ranking, and UI only ever operate on that common shape — they never know or care which municipality or raw format a record originally came from.

Different municipalities expose data differently (open data portals, APIs, CSVs, scraped schedule pages, or none at all yet), so adapters are expected to differ internally — some will pull from a structured feed, some may need scraping, some won't exist until a municipality publishes something integrable. What every adapter shares is the same output contract. Adding a new municipality means writing one adapter and registering it; it never means redesigning the Search Engine or the interface.

This is a real constraint already, not just a stated intention: no UI copy, filter, or search-priority rule should assume "Toronto" as anything other than "the first municipality currently registered." Where documentation elsewhere in this project names specific municipalities as examples, treat them as illustrations of the pattern, not as a fixed or exhaustive list — that list only lives in the adapter registry, which is deliberately the one place allowed to enumerate it.

---

## Current Implementation State

Honest snapshot of what's actually built, versus what the architecture above describes as the target:

- **One adapter is registered: Toronto.** It reads Toronto Open Data's "Registered Programs and Drop-in Courses Offering" package. No other municipality has an adapter yet — Mississauga's open-data catalogue has no drop-in dataset, and Markham's drop-in programs live behind a commercial booking widget rather than their open-data portal, so neither is currently integrable without either an official data request or scraping a source that isn't designed to be scraped. Coverage expands as that changes, one adapter at a time.
- **The Toronto adapter reads a static snapshot, not a live scheduled sync.** The "Scheduled Synchronization" step in the System Architecture Overview above is not yet implemented — the current snapshot was fetched once and is refetched manually. Session-level facts that depend on the real current date/time (Today/Tomorrow, "happening soon") are still computed live against the real clock on every request; only the underlying raw records are static.
- **The common Session model exists and is adapter-agnostic** (`lib/dropin/types.ts`), populated today entirely by the Toronto adapter (`lib/dropin/sources/toronto.ts`), aggregated through a registry (`lib/dropin/sources/index.ts`) that the Search Engine and API route call without knowing anything municipality-specific.
- **Latitude/longitude, price, phone, and verified official links are not populated for Toronto** — Toronto Open Data doesn't publish them. They exist as optional fields in the common model so a future adapter that does have them doesn't require a schema change, but nothing currently fabricates them for Toronto.

---

## Revision Notes

- 2026-08-02 — Production V1 direction: DropIn is no longer scoped as Toronto-only or as a prototype. Renamed "Future Multi-City Support" to "Multi-Municipality Support" and rewrote it to state the adapter pattern as a present constraint rather than a future aspiration, per the explicit direction to avoid municipality-specific assumptions in documentation — this document intentionally does not enumerate target municipalities; that list lives only in the adapter registry (`lib/dropin/municipalities.ts`). Added Current Implementation State to honestly separate what's architected from what's actually built (one registered adapter, a static snapshot rather than scheduled sync, no lat/long or price data yet) — checked directly rather than assumed: Mississauga and Markham were confirmed to have no integrable open drop-in data as of this date.
