// Shared refresh-orchestration helpers used by every per-source refresh
// script (Phase 3.3). Each source script stays responsible for its own
// fetch/normalize logic; this file only handles the parts that are
// genuinely identical across sources: building/writing the two snapshot
// layers, validating before activation, and producing one consistent
// report row per source (Part 21).
import { writeSnapshotAtomic, readJsonIfExists } from "../../lib/dropin/snapshot/io";
import { rawLatestPath, rawPreviousPath, canonicalLatestPath, canonicalPreviousPath } from "../../lib/dropin/snapshot/paths";
import { validateCanonicalSessions, checkCountCollapse } from "../../lib/dropin/snapshot/validate";
import { CANONICAL_SCHEMA_VERSION, type CanonicalSnapshot, type RawSnapshot, type SourceFreshness } from "../../lib/dropin/snapshot/types";
import type { Session } from "../../lib/dropin/types";

export type SourceReport = {
  source: string;
  municipality: string;
  fetchStatus: "success" | "failure";
  rawRecordCount?: number;
  canonicalSessionCount?: number;
  durationMs: number;
  activated: boolean;
  ageJoinRate?: string;
  warnings: string[];
  failureReason?: string;
};

export async function refreshOneSource(params: {
  municipalitySlug: string;
  municipalityName: string;
  sourceProvider: string;
  fetchRaw: () => Promise<{ raw: unknown; recordCount: number; sourceFreshness?: SourceFreshness }>;
  normalize: (raw: unknown, fetchedAt: string) => { sessions: Session[]; warnings?: string[]; ageJoin?: { matchedSessions: number; totalSessions: number } };
}): Promise<SourceReport> {
  const start = Date.now();
  const { municipalitySlug: slug, municipalityName, sourceProvider } = params;

  let raw: unknown;
  let recordCount = 0;
  let sourceFreshness: SourceFreshness | undefined;
  try {
    const fetched = await params.fetchRaw();
    raw = fetched.raw;
    recordCount = fetched.recordCount;
    sourceFreshness = fetched.sourceFreshness;
  } catch (err) {
    return {
      source: sourceProvider,
      municipality: municipalityName,
      fetchStatus: "failure",
      durationMs: Date.now() - start,
      activated: false,
      warnings: [],
      failureReason: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const fetchedAt = new Date().toISOString();
  const rawSnapshot: RawSnapshot = {
    metadata: { municipality: municipalityName, sourceProvider, fetchedAt, recordCount, status: "success", sourceFreshness },
    raw,
  };

  let normalized: { sessions: Session[]; warnings?: string[]; ageJoin?: { matchedSessions: number; totalSessions: number } };
  try {
    normalized = params.normalize(raw, fetchedAt);
  } catch (err) {
    // Even though normalization failed, the raw fetch succeeded and is
    // real evidence of what the source returned — write it anyway so a
    // human can inspect why normalization choked, but do not touch the
    // canonical snapshot.
    writeSnapshotAtomic(rawLatestPath(slug), rawPreviousPath(slug), rawSnapshot);
    return {
      source: sourceProvider,
      municipality: municipalityName,
      fetchStatus: "failure",
      rawRecordCount: recordCount,
      durationMs: Date.now() - start,
      activated: false,
      warnings: [],
      failureReason: `normalization failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const warnings = [...(normalized.warnings ?? [])];

  const validation = validateCanonicalSessions(normalized.sessions, municipalityName);
  if (!validation.ok) {
    writeSnapshotAtomic(rawLatestPath(slug), rawPreviousPath(slug), rawSnapshot);
    return {
      source: sourceProvider,
      municipality: municipalityName,
      fetchStatus: "failure",
      rawRecordCount: recordCount,
      canonicalSessionCount: normalized.sessions.length,
      durationMs: Date.now() - start,
      activated: false,
      warnings,
      failureReason: `canonical validation failed: ${validation.errors.join("; ")}`,
    };
  }
  warnings.push(...validation.warnings);

  const previousCanonical = readJsonIfExists<CanonicalSnapshot>(canonicalLatestPath(slug));
  const collapseCheck = checkCountCollapse(normalized.sessions.length, previousCanonical?.metadata.canonicalSessionCount);
  if (!collapseCheck.ok) {
    writeSnapshotAtomic(rawLatestPath(slug), rawPreviousPath(slug), rawSnapshot);
    return {
      source: sourceProvider,
      municipality: municipalityName,
      fetchStatus: "failure",
      rawRecordCount: recordCount,
      canonicalSessionCount: normalized.sessions.length,
      durationMs: Date.now() - start,
      activated: false,
      warnings,
      failureReason: collapseCheck.reason,
    };
  }

  // Everything validated — safe to activate both layers.
  writeSnapshotAtomic(rawLatestPath(slug), rawPreviousPath(slug), rawSnapshot);

  const canonicalSnapshot: CanonicalSnapshot = {
    metadata: {
      municipality: municipalityName,
      sourceProvider,
      fetchedAt,
      normalizedAt: new Date().toISOString(),
      sourceRecordCount: recordCount,
      canonicalSessionCount: normalized.sessions.length,
      status: "success",
      warnings: warnings.length > 0 ? warnings : undefined,
      sourceFreshness,
      ageJoin: normalized.ageJoin,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
    },
    sessions: normalized.sessions,
  };
  writeSnapshotAtomic(canonicalLatestPath(slug), canonicalPreviousPath(slug), canonicalSnapshot);

  const ageJoinRate = normalized.ageJoin
    ? `${normalized.ageJoin.matchedSessions}/${normalized.ageJoin.totalSessions} (${((100 * normalized.ageJoin.matchedSessions) / Math.max(1, normalized.ageJoin.totalSessions)).toFixed(1)}%)`
    : undefined;

  return {
    source: sourceProvider,
    municipality: municipalityName,
    fetchStatus: "success",
    rawRecordCount: recordCount,
    canonicalSessionCount: normalized.sessions.length,
    durationMs: Date.now() - start,
    activated: true,
    ageJoinRate,
    warnings,
  };
}

export function printReport(reports: SourceReport[]): void {
  console.log("\n" + "=".repeat(78));
  console.log("DATA REFRESH REPORT");
  console.log("=".repeat(78));
  for (const r of reports) {
    console.log(`\nSOURCE:               ${r.source}`);
    console.log(`MUNICIPALITY:          ${r.municipality}`);
    console.log(`FETCH STATUS:          ${r.fetchStatus === "success" ? "OK" : "FAILED"}`);
    if (r.rawRecordCount !== undefined) console.log(`RAW RECORD COUNT:      ${r.rawRecordCount}`);
    if (r.canonicalSessionCount !== undefined) console.log(`CANONICAL SESSIONS:    ${r.canonicalSessionCount}`);
    console.log(`DURATION:              ${(r.durationMs / 1000).toFixed(1)}s`);
    console.log(`SNAPSHOT ACTIVATED:    ${r.activated ? "YES" : "NO"}`);
    if (r.ageJoinRate) console.log(`AGE JOIN RATE:         ${r.ageJoinRate}`);
    if (r.warnings.length > 0) for (const w of r.warnings) console.log(`WARNING:               ${w}`);
    if (r.failureReason) console.log(`FAILURE REASON:        ${r.failureReason}`);
  }
  console.log("\n" + "=".repeat(78));
  const succeeded = reports.filter((r) => r.activated).length;
  console.log(`SUMMARY: ${succeeded}/${reports.length} source(s) activated a new snapshot.`);
  console.log("=".repeat(78) + "\n");
}
