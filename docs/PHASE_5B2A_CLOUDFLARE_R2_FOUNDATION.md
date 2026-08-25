# Phase 5B-2A — Cloudflare R2 Foundation (Owner-Guided Setup)

**Scope: Cloudflare R2 storage foundation only.** No application code was migrated, no `SnapshotStorage` implementation was added or changed, no Vercel project was created, no domain was touched, no scheduler was implemented, and no secret value appears anywhere in this document. This phase determines the exact resources needed and hands the project owner a precise setup checklist — nothing beyond that.

---

## Approved Owner Decisions (carried in, not re-litigated)

**M1 — `/api/sessions` stays as-is for launch.** No redirect, no server-side-filtering refactor, during launch readiness. This has one direct, favorable consequence for this phase, spelled out in §1: because the app keeps reading canonical data server-side (exactly as it does from local disk today, just from R2 instead), **the R2 bucket does not need any public/anonymous access at all** — a stricter, simpler security posture than Phase 5A §4's original redirect-to-a-public-object sketch, which is superseded by this decision. Any future revisit of `/api/sessions`'s shape is recorded as post-launch technical backlog, not decided or scheduled here.

**M2 — two scoped credentials, not one shared token.** Credential A (Vercel/application): read-only. Credential B (refresh pipeline): read-write. Both scoped to the same single bucket, never account-wide, never interchangeable.

---

## 1. Re-Verified R2 Requirements

Re-checked against the actual Phase 5B-1 findings and Cloudflare's current, live-fetched R2 documentation (bucket-naming rules and default-private behavior confirmed fresh this phase) — **not a redesign of Phase 5A**, a confirmation of its existing shape plus the one simplification M1 directly enables.

| | Decision |
|---|---|
| **Number of buckets** | **One.** Prefix-based separation inside it remains simpler to provision, credential, and reason about than multiple buckets — unchanged from Phase 5B-1's recommendation, reaffirmed. |
| **Exact recommended bucket name** | **`dropin-snapshots`** — satisfies R2's real naming constraints (confirmed live: lowercase letters, numbers, hyphens only, 3–63 characters, no leading/trailing hyphen). The owner may rename if they prefer; this is the recommended default, not a hard requirement. |
| **Prefix structure** | Mirrors today's local directory shape exactly, so the eventual migration is a storage-backend swap, not a data reshape: |
| **Production prefix** | `production/canonical/<slug>/latest.json` + `production/canonical/<slug>/previous.json`, and `production/raw/<slug>/latest.json` + `previous.json` |
| **Staging/preview prefix** | `staging/canonical/<slug>/latest.json` — single-slot only (Phase 5A §14's new-municipality preview case; an ephemeral review space, not a durable layer, so no `previous` slot is needed there) |
| **Rollback/previous snapshot structure** | Already covered above — the existing 2-slot (`latest`/`previous`) policy, unchanged from Phase 5A, applied per-municipality at both the `canonical` and `raw` prefixes |
| **Temporary refresh structure** | **Not applicable, and this is a real simplification worth stating precisely, not assumed.** The local filesystem implementation needs a durable `.tmp-*` file mid-write because POSIX rename requires the new content to already exist on disk under some name before the atomic rename step. R2/S3's `PUT` to a given key is *itself* atomic (a reader sees either the fully-old or fully-new object, never a partial one) — so the equivalent R2 write path is: hold the new content in memory, server-side-copy the current `latest` object to `previous`, then a single atomic `PUT` to `latest`. No separate temp object or prefix is needed. (This was already identified in Phase 5B-1 §5; restated here because it directly answers this section's question, not introduced fresh.) |
| **Public access** | **Off — bucket remains fully private.** Confirmed live: R2 buckets are not public by default. Because M1 keeps all reads server-side (no browser ever fetches directly from R2), there is no reason to enable the "Public Development URL" or attach a custom domain for public access at all. This is stricter than Phase 5A §4's original sketch, which is superseded by M1 exactly as noted above. |
| **`data/facility-locations/`** | Stays in Git, unchanged — small (~210KB), infrequently updated, not part of this migration. Not affected by anything in this phase. |

---

## 2. Owner-Guided Cloudflare Setup

The owner already has a Cloudflare account (managing `getdropin.ca`'s DNS/email routing there) — no new account is needed, only a new product (R2) within it.

**General rule for every step below: if a value is marked SECRET, it must be pasted directly into the platform that will actually use it (Vercel or GitHub, both later) — never into a message to Claude, never into any file in this repository, never into any documentation.**

### Step 1 — Open R2

- **Where:** Cloudflare dashboard (`dash.cloudflare.com`) → left sidebar → **R2 Object Storage** (if this is the account's first time using R2, Cloudflare may show a one-time "enable R2" prompt — accepting it is safe and doesn't require entering payment details to use the free tier).
- **Action:** none yet, just confirm you're looking at the R2 section.

### Step 2 — Create the bucket

- **Where:** R2 Object Storage → **Create bucket**.
- **Value to enter:** bucket name — recommended `dropin-snapshots` (§1). Not secret; ordinary configuration metadata.
- **Location hint:** if the dashboard presents a location/region choice, "Automatic" is the simplest, safe default — this doesn't need to be pinned to a specific region for DropIn's scale. Not secret.
- **Storage class:** if asked, "Standard" (not "Infrequent Access") — matches the free-tier terms already confirmed in Phase 5A's research.
- **Public access:** leave disabled / do not enable a "Public Development URL" or attach a custom domain to this bucket — per §1, nothing needs public access under the M1 design.
- **What Claude needs afterward:** just confirmation the bucket exists and its exact name (if different from the recommendation above). Not secret.

### Step 3 — Create Credential A (application / Vercel — read-only)

- **Where:** R2 Object Storage → **Manage R2 API Tokens** (sometimes labeled "API" or "Manage API Tokens" depending on current dashboard wording) → **Create API Token**.
- **Permission to select:** **Object Read only** (not "Admin Read only," not "Object Read & Write" — the narrowest tier that satisfies the application's actual need, per M2).
- **Scope:** restrict the token to the specific `dropin-snapshots` bucket — not "all buckets" / account-wide.
- **Token name (metadata, not secret):** something identifying, e.g. `dropin-app-read` — helps distinguish it from Credential B later in the dashboard's token list.
- **What this produces:** an Access Key ID, a Secret Access Key (shown once, at creation), the Account ID, and an endpoint URL (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`). **All four of these are SECRET except the endpoint's shape being publicly documented** (the Account ID embedded in it is not highly sensitive but should still be handled as configuration, not broadcast). **Do not paste any of these into chat.** They are not needed anywhere yet — Phase 5B-2B (not this phase) is when Vercel exists and has an Environment Variables screen to receive them.
- **What Claude needs afterward:** nothing about the values. Only a confirmation that this credential was created, scoped correctly (read-only, this bucket only), and — if the owner wants to keep the naming convention below consistent — the token's *name*, not its value.

### Step 4 — Create Credential B (refresh pipeline — read-write)

- **Where:** same location as Step 3, **Create API Token** again.
- **Permission to select:** **Object Read & Write** (not "Admin Read & Write" — the refresh pipeline needs to read the previous snapshot for count-collapse comparison and write new snapshots, nothing account-administrative).
- **Scope:** the same `dropin-snapshots` bucket only.
- **Token name (metadata, not secret):** e.g. `dropin-refresh-write`.
- **What this produces:** the same four values as Step 3, for this separate credential. **Do not paste any of these into chat.** These will go into GitHub's repository secrets in Phase 5B-2B, not now.
- **What Claude needs afterward:** the same as Step 3 — confirmation only, not values.

### Step 5 — Confirm back to Claude, without secrets

Once Steps 2–4 are complete, tell Claude only:

- "The bucket exists" (and its name, if different from `dropin-snapshots`).
- "Both tokens are created, scoped correctly" (read-only for the app, read-write for refresh).
- Optionally, the token *names* chosen, if different from the suggestions above.

**Nothing else needs to be shared** — no Access Key ID, no Secret Access Key, no Account ID needs to reach this conversation at all for Phase 5B-2A to be considered complete.

---

## 3. Application Code — Unchanged This Phase

**Confirmed: zero application code was modified.** The existing `LocalFilesystemSnapshotStorage` (`lib/dropin/snapshot/io.ts`) remains the only `SnapshotStorage` implementation in the codebase — not removed, not touched. No R2 SDK dependency was added to `package.json`. No canonical data was migrated (the local `data/canonical/`/`data/raw/` directories are untouched, still gitignored, still the only thing the running app reads from). This phase produced documentation and a resource-creation checklist only, per its own explicit scope.

The only thing this phase commits to, in writing rather than in code, is the **environment-variable naming convention** the eventual integration (Phase 5B-2B) will use — decided now so Steps 3–4 above and the future Vercel/GitHub setup stay consistent, without requiring any code to exist yet:

| Variable name | Holds | Used by | Scope |
|---|---|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account ID | Both | Vercel (Production+Preview) *and* GitHub Actions secrets |
| `R2_BUCKET_NAME` | `dropin-snapshots` (or the owner's chosen name) | Both | Same as above — not secret, but kept alongside the others for consistency |
| `R2_READ_ACCESS_KEY_ID` / `R2_READ_SECRET_ACCESS_KEY` | Credential A (read-only) | Application (Vercel) only | Vercel Production+Preview |
| `R2_WRITE_ACCESS_KEY_ID` / `R2_WRITE_SECRET_ACCESS_KEY` | Credential B (read-write) | Refresh pipeline (GitHub Actions) only | GitHub Actions repository secrets only — never Vercel |

The deliberate `READ_`/`WRITE_` naming prefix exists specifically to make it structurally obvious, at every future call site, which credential is in play — reducing the chance the write-capable credential ever accidentally ends up somewhere read-only should suffice.

---

## 4. Security Requirements — Verified Against This Design

| Requirement | Status |
|---|---|
| Application runtime: read-only | **Satisfied by design.** Credential A (§2 Step 3) is provisioned as Object-Read-only, scoped to one bucket — the application will be structurally incapable of writing even if its code somehow tried to. |
| Refresh pipeline: read + write | **Satisfied by design.** Credential B (§2 Step 4) is provisioned as Object-Read-&-Write, scoped to the same bucket, and used only by the (not-yet-built) GitHub Actions job. |
| Browser: no R2 credentials | **Satisfied, trivially and structurally.** M1 keeps `/api/sessions` server-side (no public object URL, no client-side R2 access of any kind) — there is no code path, today or in the Phase 5B-2B plan, where any R2 credential could reach a browser. |
| Git repository: no R2 credentials | **Satisfied — verified.** Nothing was added to the repository this phase; no `.env` file, no hardcoded value, no new dependency. `git status` remains clean. |
| Documentation: no secret values | **Satisfied — self-verified.** This document (and the Phase 5B-1 preflight before it) name environment-variable *names* only; no Access Key ID, Secret Access Key, or Account ID appears anywhere in either file. |
| Preview must not mutate production data | **Satisfied by design, reaffirmed from Phase 5A §14.** Once implemented, preview deployments will share the same read-only Credential A as production (safe, since it cannot write) — the only path that ever touches `staging/` is a deliberate, owner-approved, branch-scoped configuration for the specific new-municipality-review case, not something a preview deployment can trigger on its own. |
| Production canonical data must not be publicly writable | **Satisfied, and exceeded.** The bucket has no public access of any kind (§1) — not public-writable, not public-readable either, a stricter posture than the original Phase 5A sketch, made possible by M1. |

---

## 5. Stopping Point — Human Action Required

**This phase stops here.** The exact configuration has been determined (§1); the owner-facing setup checklist has been produced (§2); no application integration has begun (§3) and none should, until the owner confirms the bucket and both credentials exist. The expected next step is:

```
This document (Claude's exact configuration + setup instructions)
  → owner creates the R2 bucket and both scoped tokens in Cloudflare (§2)
  → owner confirms completion back to Claude — WITHOUT sharing any secret value
  → Phase 5B-2B: DropIn's application integration with R2 begins
```

**Phase 5B-2B is not started by this document.**

---

## Final Report

**A. Exact R2 architecture:** one private R2 bucket, prefix-separated into `production/` (durable, 2-slot retention, canonical + raw) and `staging/` (single-slot, canonical only, for the new-municipality preview case) — no public access, no separate temp-object structure needed (R2's atomic per-key `PUT` makes one unnecessary). Full detail: §1.

**B. Exact bucket name:** `dropin-snapshots` (recommended; owner may rename during creation if preferred).

**C. Exact prefixes:** `production/canonical/<slug>/{latest,previous}.json`, `production/raw/<slug>/{latest,previous}.json`, `staging/canonical/<slug>/latest.json`.

**D. Credential A (application/Vercel) permissions:** Object Read only, scoped to the `dropin-snapshots` bucket specifically — never Admin, never account-wide, never write-capable.

**E. Credential B (refresh pipeline) permissions:** Object Read & Write, scoped to the same bucket — never Admin, never account-wide.

**F. Required environment-variable names** (values not yet created, and not recorded anywhere): `R2_ACCOUNT_ID`, `R2_BUCKET_NAME` (both platforms); `R2_READ_ACCESS_KEY_ID` / `R2_READ_SECRET_ACCESS_KEY` (Vercel only); `R2_WRITE_ACCESS_KEY_ID` / `R2_WRITE_SECRET_ACCESS_KEY` (GitHub Actions only). Full table: §3.

**G. Owner Cloudflare action checklist:** §2, five steps — open R2, create the bucket (with public access left off), create Credential A (read-only), create Credential B (read-write), confirm completion back to Claude without sharing any secret value.

**H. Security verification:** all seven stated requirements hold by design — read-only application access, read-write refresh access, zero browser exposure, zero repository exposure, zero secret values in documentation, preview isolation from production mutation, and a production dataset that is neither publicly writable nor (going further than originally required, thanks to M1) publicly readable. Full detail: §4.

**I. Whether any code changed:** **No.** Confirmed — `LocalFilesystemSnapshotStorage` remains the only `SnapshotStorage` implementation, no dependency was added, no file under `app/`, `lib/`, or `scripts/` was touched, `data/canonical/`/`data/raw/` are untouched and still local-only. This phase produced two things only: this documentation file, and a request for the owner to perform the Cloudflare steps in §2.

**J. What confirmation is needed from the owner before 5B-2B:** exactly three non-secret facts — (1) the bucket exists (and its name, if not `dropin-snapshots`), (2) Credential A was created as Object-Read-only, scoped to that bucket, (3) Credential B was created as Object-Read-&-Write, scoped to that same bucket. No Access Key ID, Secret Access Key, or Account ID should be shared to provide this confirmation.

Stopping here, as instructed. Phase 5B-2B is not started.
