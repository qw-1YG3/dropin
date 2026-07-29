# Architecture

This document describes architecture decisions only. It does not describe implementation — no backend code, API routes, database schema, or synchronization services exist yet.

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

The synchronization interval is configurable, not hardcoded. Different official sources update their data at different frequencies, and different cities (as multi-city support is added) may need different schedules. The sync interval is a piece of configuration per source, not a fixed assumption built into the system.

---

## Future Multi-City Support

The long-term vision extends beyond Toronto to other municipalities across Ontario. The architecture above is intended to generalize to that: each city's official data provider gets its own source adapter (matching the hybrid sourcing adapter pattern already established for Toronto — Open Data adapter, community centre webpage adapter, manual correction layer), each feeding the same normalized DropIn database and schema. Adding a new city means adding a new adapter and a sync schedule for it, not redesigning the pipeline.
