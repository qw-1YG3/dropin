// Validation gates a new canonical snapshot must pass before it's allowed
// to become active (Phase 3.3, Part 7/8). Municipality/source-aware on
// purpose — Richmond Hill genuinely having hundreds of sessions while
// Mississauga has thousands is not a validation failure; a municipality's
// count collapsing relative to *its own* last known-good snapshot is.
import type { Session } from "../types";

export type ValidationResult = { ok: true; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function validateCanonicalSessions(sessions: Session[], expectedMunicipality: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (sessions.length === 0) {
    warnings.push("zero sessions in this snapshot — allowed, but worth a second look");
  }

  const ids = new Set<string>();
  let duplicateCount = 0;
  let wrongMunicipality = 0;

  for (const [i, s] of sessions.entries()) {
    // Required identity fields — a genuinely missing one indicates a
    // normalization bug, not a legitimate data gap (those are always
    // modeled as `undefined` optional fields, never absent required ones).
    for (const field of ["id", "sourceScheduleId", "activity", "date", "startDateTime", "endDateTime", "centre", "municipality", "officialSource", "lastUpdated", "verificationStatus"] as const) {
      if (!s[field]) {
        errors.push(`session[${i}] (id=${s.id ?? "?"}) missing required field "${field}"`);
      }
    }

    if (s.municipality && s.municipality !== expectedMunicipality) wrongMunicipality++;

    if (s.date && !DATE_KEY_PATTERN.test(s.date)) {
      errors.push(`session[${i}] (id=${s.id}) has malformed date "${s.date}"`);
    }
    if (s.startDateTime && !LOCAL_DATETIME_PATTERN.test(s.startDateTime)) {
      errors.push(`session[${i}] (id=${s.id}) has malformed startDateTime "${s.startDateTime}"`);
    }
    if (s.endDateTime && !LOCAL_DATETIME_PATTERN.test(s.endDateTime)) {
      errors.push(`session[${i}] (id=${s.id}) has malformed endDateTime "${s.endDateTime}"`);
    }
    if (s.startDateTime && s.endDateTime && LOCAL_DATETIME_PATTERN.test(s.startDateTime) && LOCAL_DATETIME_PATTERN.test(s.endDateTime)) {
      if (new Date(s.endDateTime).getTime() <= new Date(s.startDateTime).getTime()) {
        errors.push(`session[${i}] (id=${s.id}) end (${s.endDateTime}) is not after start (${s.startDateTime})`);
      }
    }

    if (s.id) {
      if (ids.has(s.id)) duplicateCount++;
      ids.add(s.id);
    }
  }

  if (duplicateCount > 0) errors.push(`${duplicateCount} duplicate canonical id(s) found — ids must be unique within a snapshot`);
  if (wrongMunicipality > 0) errors.push(`${wrongMunicipality} session(s) have municipality != "${expectedMunicipality}"`);

  // Cap the error list in the report, not the check itself — every real
  // problem is still counted above, this just keeps a pathological failure
  // from producing thousands of log lines.
  const cappedErrors = errors.length > 20 ? [...errors.slice(0, 20), `...and ${errors.length - 20} more`] : errors;

  if (cappedErrors.length > 0) return { ok: false, errors: cappedErrors, warnings };
  return { ok: true, warnings };
}

export type CountCollapseResult = { ok: true } | { ok: false; reason: string };

// Conservative, deliberately simple rule (Part 8): only fires when there's
// a real previous count to compare against (a first-ever refresh has
// nothing to collapse relative to, so it's always allowed through, subject
// only to the shape validation above) and the new count drops by more than
// half relative to a previous count that was itself large enough to be
// meaningful (>=10) — small municipalities fluctuating within that range
// day to day should never trip this.
const COLLAPSE_RATIO_THRESHOLD = 0.5;
const MEANINGFUL_PREVIOUS_COUNT = 10;

export function checkCountCollapse(newCount: number, previousCount: number | undefined): CountCollapseResult {
  if (previousCount === undefined || previousCount < MEANINGFUL_PREVIOUS_COUNT) return { ok: true };
  if (newCount < previousCount * COLLAPSE_RATIO_THRESHOLD) {
    return {
      ok: false,
      reason: `session count collapsed from ${previousCount} to ${newCount} (>${Math.round((1 - COLLAPSE_RATIO_THRESHOLD) * 100)}% drop) — refusing to activate without stronger evidence this is real`,
    };
  }
  return { ok: true };
}
