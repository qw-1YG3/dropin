// Atomic snapshot read/write (Phase 3.3). Phase 3.3B adds one seam here,
// no behavior change: a `SnapshotStorage` interface describes what any
// backend must support, with `LocalFilesystemSnapshotStorage` as the only
// implementation today. Every call site (refresh scripts, the app's read
// path) already goes through the plain `readJsonIfExists`/
// `writeSnapshotAtomic` functions at the bottom of this file, which are now
// thin wrappers around `defaultSnapshotStorage` — so nothing outside this
// file needed to change. The reason to separate this now rather than
// later: Phase 3.3B's deployment audit found the current local-filesystem
// assumption only holds on a persistent server/container (see
// docs/PHASE_3_3B_SCHEDULER_DEPLOYMENT_STRATEGY.md Part 2) — if a future
// deployment model ever needs object storage instead, that becomes a new
// class implementing this same interface, not a rewrite of every call
// site. No cloud SDK or credentials are introduced here — this is the
// interface only, deliberately, per that document's Part 21.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

export interface SnapshotStorage {
  readJsonIfExists<T>(key: string): T | undefined;
  // Rotates whatever currently exists at `key` into `previousKey` (if
  // anything does), then atomically activates `data` at `key`. Must never
  // leave a reader able to observe a partially-written value at `key`.
  writeAtomic(key: string, previousKey: string, data: unknown): void;
}

// "key" is a plain filesystem path for this implementation — an object-
// storage implementation would instead treat it as a bucket key, but the
// call sites (paths.ts's path.join-based helpers) don't need to know or
// care which.
export class LocalFilesystemSnapshotStorage implements SnapshotStorage {
  readJsonIfExists<T>(filePath: string): T | undefined {
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  }

  writeAtomic(finalPath: string, previousPath: string, data: unknown): void {
    const dir = path.dirname(finalPath);
    mkdirSync(dir, { recursive: true });

    const tmpPath = path.join(dir, `.tmp-${path.basename(finalPath)}-${process.pid}-${Date.now()}`);
    const json = JSON.stringify(data, null, 2);
    writeFileSync(tmpPath, json, "utf-8");

    // Round-trip check: confirm what's on disk is valid, complete JSON
    // before it's ever allowed to become the active snapshot.
    try {
      JSON.parse(readFileSync(tmpPath, "utf-8"));
    } catch (err) {
      unlinkSync(tmpPath);
      throw new Error(`writeSnapshotAtomic: temp file failed round-trip validation, not activated: ${err}`);
    }

    if (existsSync(finalPath)) {
      copyFileSync(finalPath, previousPath);
    }
    renameSync(tmpPath, finalPath);
  }
}

export const defaultSnapshotStorage: SnapshotStorage = new LocalFilesystemSnapshotStorage();

export function readJsonIfExists<T>(filePath: string): T | undefined {
  return defaultSnapshotStorage.readJsonIfExists<T>(filePath);
}

// Writes `data` to `finalPath` atomically, rotating whatever was previously
// at `finalPath` into `previousPath` first (two-slot retention). Throws if
// the write can't be verified — callers must not treat a thrown error here
// as "the old snapshot is gone," since the old file is never touched until
// the very last step.
export function writeSnapshotAtomic(finalPath: string, previousPath: string, data: unknown): void {
  defaultSnapshotStorage.writeAtomic(finalPath, previousPath, data);
}
