// Snapshot key layout (Phase 3.3, extended Phase 5B-2B for storage-backend
// independence):
//
//   canonical/<slug>/latest.json + previous.json
//   raw/<slug>/latest.json + previous.json
//
// These are backend-agnostic RELATIVE KEYS, not filesystem paths — Phase
// 5B-2B introduced a second SnapshotStorage backend (Cloudflare R2,
// lib/dropin/snapshot/io.ts) alongside the original local-filesystem one,
// and a single key shape needs to mean the same thing to both: the local
// backend resolves a key under data/ on disk, the R2 backend resolves the
// same key under a production/ or staging/ prefix in the bucket. Nothing
// here decides which backend is active or where the key physically lands
// — that's io.ts's job. Two-slot retention (latest + previous) at each
// layer — "modest, simple" per Phase 3.3's own instruction, unchanged by
// the storage-backend split. Toronto's original bundled snapshot at
// data/toronto-open-data/ is untouched and still committed to git; it
// remains the offline fallback input for Toronto's raw-snapshot step (see
// scripts/refresh/toronto.ts) regardless of which backend is active.
export function municipalitySlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function rawDir(slug: string): string {
  return `raw/${slug}`;
}

export function canonicalDir(slug: string): string {
  return `canonical/${slug}`;
}

export function rawLatestPath(slug: string): string {
  return `${rawDir(slug)}/latest.json`;
}

export function rawPreviousPath(slug: string): string {
  return `${rawDir(slug)}/previous.json`;
}

export function canonicalLatestPath(slug: string): string {
  return `${canonicalDir(slug)}/latest.json`;
}

export function canonicalPreviousPath(slug: string): string {
  return `${canonicalDir(slug)}/previous.json`;
}

// Phase 5B — the combined, field-trimmed "all municipalities" artifact
// (scripts/refresh/build-combined.ts), built from whatever is currently
// active per municipality at canonicalLatestPath(slug) above — never a
// separate fetch/source. Same 2-slot latest/previous retention as every
// other snapshot layer; same key-prefix-based production/staging
// separation the R2 backend already applies to every other key.
export function combinedLatestPath(): string {
  return "canonical/_combined/latest.json";
}

export function combinedPreviousPath(): string {
  return "canonical/_combined/previous.json";
}

// Phase 4.1 — one facility-location registry shared across all
// municipalities (cross-cutting reference data, not per-source raw/
// canonical session data), built by its own separate, deliberate process
// (scripts/refresh/facility-locations.ts) rather than the routine
// per-municipality data refresh. Explicitly OUT OF SCOPE for the Phase
// 5B-2B R2 migration (Phase 5B-2A's approved architecture) — small
// (~210KB), infrequently updated, stays git-tracked. Always resolved via
// the local-only helpers in io.ts, never through the R2-capable storage
// selection, regardless of SNAPSHOT_STORAGE.
export function facilityLocationsLatestPath(): string {
  return "facility-locations/latest.json";
}

export function facilityLocationsPreviousPath(): string {
  return "facility-locations/previous.json";
}
