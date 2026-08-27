// Snapshot storage (Phase 3.3, extended Phase 5B-2B). Two real
// implementations of one interface: LocalFilesystemSnapshotStorage
// (development, and the local-verification step of the new-municipality
// workflow) and R2SnapshotStorage (production, Cloudflare R2 — Phase
// 5B-2A's approved bucket/credential architecture). Selection is entirely
// environment-driven (SNAPSHOT_STORAGE=r2), never municipality-specific —
// every call site asks for "the app's read storage" or "the refresh
// pipeline's storage" and gets whichever backend is configured, without
// knowing or caring which one it is.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface SnapshotStorage {
  readJsonIfExists<T>(key: string): Promise<T | undefined>;
  // Rotates whatever currently exists at `key` into `previousKey` (if
  // anything does), then activates `data` at `key` such that a reader can
  // never observe a partially-written value — the specific mechanism
  // differs by backend (POSIX rename locally, a single atomic PUT on R2 —
  // see R2SnapshotStorage below) but the guarantee is identical.
  writeAtomic(key: string, previousKey: string, data: unknown): Promise<void>;
}

const LOCAL_DATA_ROOT = path.join(process.cwd(), "data");

export class LocalFilesystemSnapshotStorage implements SnapshotStorage {
  async readJsonIfExists<T>(key: string): Promise<T | undefined> {
    const filePath = path.join(LOCAL_DATA_ROOT, key);
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  }

  async writeAtomic(key: string, previousKey: string, data: unknown): Promise<void> {
    const finalPath = path.join(LOCAL_DATA_ROOT, key);
    const previousPath = path.join(LOCAL_DATA_ROOT, previousKey);
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

export type R2Config = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  // "production" or "staging" (Phase 5A §14) — prepended to every key this
  // instance resolves, so the same relative key (e.g.
  // "canonical/toronto/latest.json") lands in a completely separate part
  // of the bucket depending on which prefix this instance was built with.
  keyPrefix: string;
};

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  const metadata = "$metadata" in err ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata : undefined;
  return name === "NoSuchKey" || name === "NotFound" || metadata?.httpStatusCode === 404;
}

export class R2SnapshotStorage implements SnapshotStorage {
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    // R2's S3-compatible endpoint — Cloudflare's own documented shape,
    // confirmed live during the Phase 5B-1 preflight. "auto" is R2's own
    // required region value, not a real AWS region.
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  private resolveKey(key: string): string {
    return `${this.config.keyPrefix}/${key}`;
  }

  async readJsonIfExists<T>(key: string): Promise<T | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucketName, Key: this.resolveKey(key) }));
      const text = await res.Body?.transformToString("utf-8");
      if (text === undefined) return undefined;
      return JSON.parse(text) as T;
    } catch (err) {
      if (isNotFoundError(err)) return undefined;
      // Anything else (auth failure, network error, malformed JSON) is a
      // real problem — surfaced to the caller, never silently treated as
      // "no snapshot exists" the way a genuine 404 is.
      throw err;
    }
  }

  private async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucketName, Key: key }));
      return true;
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  }

  async writeAtomic(key: string, previousKey: string, data: unknown): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    // Round-trip check, mirroring the local implementation's own safety
    // step — cheap, and catches a non-serializable value before anything
    // touches the network.
    JSON.parse(json);

    const finalKey = this.resolveKey(key);
    const previousFullKey = this.resolveKey(previousKey);

    // Rotate first: if something is already active at `latest`, copy it to
    // `previous` (R2's native server-side copy — no download/re-upload
    // round trip) before the new data is written anywhere.
    if (await this.objectExists(finalKey)) {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.config.bucketName,
          CopySource: `${this.config.bucketName}/${finalKey}`,
          Key: previousFullKey,
        }),
      );
    }

    // A single PUT to one key is atomic on R2/S3 — a reader always
    // observes either the fully-old or the fully-new object, never a
    // partial write. This is the R2-native equivalent of the local
    // implementation's write-temp-then-rename pattern: there is no
    // durable "temp" object at any point, because none is needed (Phase
    // 5B-1 §5).
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: finalKey,
        Body: json,
        ContentType: "application/json",
      }),
    );
  }

  // A presigned URL is a GET-only, single-object-scoped, time-limited
  // grant — a property of AWS SigV4 signing itself (Phase 5B response-size
  // architecture decision), not something this method enforces by
  // convention. The signature is cryptographically bound to exactly this
  // bucket + this key + this expiry + the GET method; it cannot be used
  // to read a different object, list the bucket, or write/delete
  // anything, regardless of which credential generated it. Generating one
  // is a local cryptographic operation — no network call, no read of the
  // object's actual bytes — so it's cheap to call fresh on every request
  // rather than cached.
  async getPresignedReadUrl(key: string, expirySeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.config.bucketName, Key: this.resolveKey(key) });
    return getSignedUrl(this.client, command, { expiresIn: expirySeconds });
  }
}

export function isR2StorageMode(): boolean {
  return process.env.SNAPSHOT_STORAGE === "r2";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when SNAPSHOT_STORAGE=r2`);
  return value;
}

function r2Credentials(kind: "read" | "write"): { accessKeyId: string; secretAccessKey: string } {
  return kind === "read"
    ? { accessKeyId: requireEnv("R2_READ_ACCESS_KEY_ID"), secretAccessKey: requireEnv("R2_READ_SECRET_ACCESS_KEY") }
    : { accessKeyId: requireEnv("R2_WRITE_ACCESS_KEY_ID"), secretAccessKey: requireEnv("R2_WRITE_SECRET_ACCESS_KEY") };
}

// The application's own read path (lib/dropin/sources/index.ts). Always
// read-only credentials — this function has no way to construct a
// write-capable instance, by design, not merely by convention. Defaults
// to the production prefix; a specific Preview deployment can opt into
// staging data via R2_KEY_PREFIX (Phase 5A §14) — the prefix choice never
// changes which credential is used.
export function createAppReadStorage(): SnapshotStorage {
  if (!isR2StorageMode()) return new LocalFilesystemSnapshotStorage();
  return new R2SnapshotStorage({
    accountId: requireEnv("R2_ACCOUNT_ID"),
    bucketName: requireEnv("R2_BUCKET_NAME"),
    ...r2Credentials("read"),
    keyPrefix: process.env.R2_KEY_PREFIX || "production",
  });
}

// Phase 5B response-size architecture decision — lets the application
// redirect a request to R2 directly, bypassing the Vercel Function
// response-size limit entirely, without ever holding the object's bytes
// in the Function's own memory. Reuses createAppReadStorage() so this
// goes through the exact same read-only-credential, production/staging-
// prefix-aware construction every other application read already uses —
// there is no separate, parallel credential path for this. Only
// meaningful in R2 mode; local development has no equivalent concept
// (there's nothing to redirect to), so this throws if called outside it
// rather than silently returning something misleading.
export async function createPresignedReadUrl(key: string, expirySeconds: number): Promise<string> {
  const storage = createAppReadStorage();
  if (!(storage instanceof R2SnapshotStorage)) {
    throw new Error("createPresignedReadUrl requires R2 mode (SNAPSHOT_STORAGE=r2) — no presigned-URL concept exists for local filesystem storage");
  }
  return storage.getPresignedReadUrl(key, expirySeconds);
}

// The refresh pipeline's own path (scripts/refresh/*). Write-capable
// credentials, always the production prefix — a staging upload for the
// new-municipality preview case (Phase 5A §14) is a separate, explicit,
// manual step, never something the routine automated refresh does.
export function createRefreshStorage(): SnapshotStorage {
  if (!isR2StorageMode()) return new LocalFilesystemSnapshotStorage();
  return new R2SnapshotStorage({
    accountId: requireEnv("R2_ACCOUNT_ID"),
    bucketName: requireEnv("R2_BUCKET_NAME"),
    ...r2Credentials("write"),
    keyPrefix: "production",
  });
}

// data/facility-locations/ is explicitly out of scope for the R2
// migration (Phase 5B-2A's approved architecture) — small, infrequently
// updated, stays git-tracked. Always local and always synchronous,
// regardless of SNAPSHOT_STORAGE — this data never needs to participate
// in the async, R2-capable interface above at all.
export function readLocalJsonIfExists<T>(key: string): T | undefined {
  const filePath = path.join(LOCAL_DATA_ROOT, key);
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function writeLocalJsonAtomic(key: string, previousKey: string, data: unknown): void {
  const finalPath = path.join(LOCAL_DATA_ROOT, key);
  const previousPath = path.join(LOCAL_DATA_ROOT, previousKey);
  const dir = path.dirname(finalPath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = path.join(dir, `.tmp-${path.basename(finalPath)}-${process.pid}-${Date.now()}`);
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  try {
    JSON.parse(readFileSync(tmpPath, "utf-8"));
  } catch (err) {
    unlinkSync(tmpPath);
    throw new Error(`writeLocalJsonAtomic: temp file failed round-trip validation, not activated: ${err}`);
  }
  if (existsSync(finalPath)) {
    copyFileSync(finalPath, previousPath);
  }
  renameSync(tmpPath, finalPath);
}

// Used only by the app's local-mode mtime-based cache (Phase 3.3 perf
// optimization, lib/dropin/sources/index.ts) — a real OS path is needed
// for statSync(), which has no R2 equivalent. Local mode only; R2 mode
// reads fresh every request instead (see that file for why).
export function resolveLocalSnapshotPath(key: string): string {
  return path.join(LOCAL_DATA_ROOT, key);
}
