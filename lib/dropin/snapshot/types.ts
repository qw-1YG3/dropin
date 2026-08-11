// Phase 3.3 — the two snapshot layers, kept as genuinely distinct types
// rather than collapsed into one shape. See docs/PHASE_3_3_DATA_REFRESH_SNAPSHOT_PIPELINE.md
// Part 2 for why: raw preserves upstream shape for provenance/debugging;
// canonical is the one shape the app ever reads at request time.
import type { Session } from "../types";

export type SnapshotStatus = "success" | "failure";

// Distinguishes "when DropIn fetched this" from "when the source itself
// claims to have last updated" (Part 14) — never fabricated when the
// upstream provider doesn't expose the latter (sourceUpdatedAt stays
// undefined rather than defaulting to fetchedAt, which would silently
// imply a freshness guarantee the source never made).
export type SourceFreshness = {
  sourceUpdatedAt?: string;
  // Some sources (ActiveCommunities) expose a stated future horizon rather
  // than a "last updated" timestamp — kept distinct from sourceUpdatedAt
  // rather than conflated with it.
  horizon?: { startDate: string; endDate: string };
};

export type RawSnapshotMetadata = {
  municipality: string;
  sourceProvider: string;
  fetchedAt: string;
  recordCount: number;
  status: SnapshotStatus;
  failureReason?: string;
  sourceFreshness?: SourceFreshness;
};

export type RawSnapshot = {
  metadata: RawSnapshotMetadata;
  // Deliberately untyped/source-shaped — this is the one place upstream
  // field names are allowed to leak through unchanged.
  raw: unknown;
};

export type CanonicalSnapshotMetadata = {
  municipality: string;
  sourceProvider: string;
  // When the raw data behind this snapshot was fetched — carried through
  // from the raw snapshot's own fetchedAt, not re-stamped at normalize time.
  fetchedAt: string;
  normalizedAt: string;
  sourceRecordCount: number;
  canonicalSessionCount: number;
  status: SnapshotStatus;
  failureReason?: string;
  warnings?: string[];
  sourceFreshness?: SourceFreshness;
  ageJoin?: { matchedSessions: number; totalSessions: number };
  schemaVersion: number;
};

export type CanonicalSnapshot = {
  metadata: CanonicalSnapshotMetadata;
  sessions: Session[];
};

export const CANONICAL_SCHEMA_VERSION = 1;
