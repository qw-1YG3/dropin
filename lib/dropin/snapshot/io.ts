// Atomic snapshot read/write (Phase 3.3, Part 6). The app's request path
// only ever calls readJsonIfExists — a plain synchronous file read, no
// network, no normalization. Writing (refresh scripts only) follows:
//
//   write to a temp file in the same directory
//   -> read it back and JSON.parse it to confirm it's not truncated/corrupt
//   -> rotate the current latest.json to previous.json, if one exists
//   -> rename the temp file onto latest.json (atomic on the same filesystem)
//
// A crash or failure at any point before the final rename leaves the
// previous latest.json completely untouched — there is no window where a
// reader can observe a half-written file, because readers only ever open
// the stable `latest.json` name, never the temp file.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

export function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

// Writes `data` to `finalPath` atomically, rotating whatever was previously
// at `finalPath` into `previousPath` first (two-slot retention — Part 12).
// Throws if the write can't be verified — callers must not treat a thrown
// error here as "the old snapshot is gone," since the old file is never
// touched until the very last step.
export function writeSnapshotAtomic(finalPath: string, previousPath: string, data: unknown): void {
  const dir = path.dirname(finalPath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `.tmp-${path.basename(finalPath)}-${process.pid}-${Date.now()}`);
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmpPath, json, "utf-8");

  // Round-trip check: confirm what's on disk is valid, complete JSON before
  // it's ever allowed to become the active snapshot.
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
