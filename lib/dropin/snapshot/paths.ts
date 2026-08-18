// Snapshot directory layout (Phase 3.3, Part 2/12):
//
//   data/raw/<slug>/latest.json + previous.json
//   data/canonical/<slug>/latest.json + previous.json
//
// Two-slot retention (latest + previous) at each layer — "modest, simple"
// per the phase's own instruction, not unbounded history. Both directories
// are gitignored (see .gitignore) — generated/refreshed artifacts, not
// committed source. Toronto's original bundled snapshot at
// data/toronto-open-data/ is untouched and still committed; it now serves
// as the offline fallback input for Toronto's raw-snapshot step (see
// scripts/refresh/toronto.ts) rather than being read directly by the app.
import path from "node:path";

export function municipalitySlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const DATA_ROOT = path.join(process.cwd(), "data");

export function rawDir(slug: string): string {
  return path.join(DATA_ROOT, "raw", slug);
}

export function canonicalDir(slug: string): string {
  return path.join(DATA_ROOT, "canonical", slug);
}

export function rawLatestPath(slug: string): string {
  return path.join(rawDir(slug), "latest.json");
}

export function rawPreviousPath(slug: string): string {
  return path.join(rawDir(slug), "previous.json");
}

export function canonicalLatestPath(slug: string): string {
  return path.join(canonicalDir(slug), "latest.json");
}

export function canonicalPreviousPath(slug: string): string {
  return path.join(canonicalDir(slug), "previous.json");
}

// Phase 4.1 — one facility-location registry shared across all
// municipalities (cross-cutting reference data, not per-source raw/
// canonical session data), built by its own separate, deliberate process
// (scripts/refresh/facility-locations.ts) rather than the routine
// per-municipality data refresh. Same two-slot latest/previous retention
// and the same SnapshotStorage abstraction as every other snapshot.
const FACILITY_LOCATIONS_DIR = path.join(DATA_ROOT, "facility-locations");

export function facilityLocationsLatestPath(): string {
  return path.join(FACILITY_LOCATIONS_DIR, "latest.json");
}

export function facilityLocationsPreviousPath(): string {
  return path.join(FACILITY_LOCATIONS_DIR, "previous.json");
}
