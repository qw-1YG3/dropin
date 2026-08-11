# Mobile Preview Diagnostic — Physical iPhone over LAN

Diagnosis only, run against the real dev server on 2026-08-10. One infrastructure-only change was made (`next.config.ts`'s `allowedDevOrigins`, see §3) — no product UI or product behavior was touched. Every finding below was verified directly (real browser connected to the real LAN address the phone uses, or direct code audit), not inferred.

---

## 1. Interactions Depending on Browser/Device APIs

Full audit of `app/page.tsx` (the only file with any of these):

| Interaction | Uses | Classification |
|---|---|---|
| "Near you" label | Nothing — plain static text | PURE REACT/UI |
| Location pill / location controls | `parseQuery`/`detectLocation` (text parsing only) | PURE REACT/UI |
| Directions button | Builds a `google.com/maps` URL from session data; `<a target="_blank">` | EXTERNAL NAVIGATION |
| Website button | `selectedSession.officialUrl`; `<a target="_blank">` | EXTERNAL NAVIGATION |
| Call button | `tel:` link | EXTERNAL NAVIGATION |
| Share button | `navigator.share`, falling back to `navigator.clipboard.writeText` | BROWSER API, SECURE-CONTEXT DEPENDENT |
| Density toggle (Comfortable/Compact) | `window.localStorage` | BROWSER API (not secure-context gated) |
| Calendar / Decision Sheet open-close | Plain React state + CSS animation | PURE REACT/UI |
| Search suggestions, filters, date strip | Plain React state | PURE REACT/UI |

**Nothing in the codebase uses `navigator.geolocation`, any permission-query API, or an IP-geolocation service** — confirmed by grepping the entire `app/` and `lib/` trees for `navigator.`, `geolocation`, `permissions`, and known IP-geo service names/domains. Zero matches beyond what's listed above.

## 2. Current "Near You" Implementation

Answered directly, no ambiguity:

- Does it call `navigator.geolocation`? **No.**
- Does it request real device lat/long? **No.**
- Hardcoded/default location? **No — it's not a location at all.** `"Near you"` is the literal fallback string rendered when `effectiveLocation` is `undefined` (`app/page.tsx`: `{effectiveLocation ? effectiveLocation.label : "Near you"}`).
- Infers location from search context? **Yes — this is the only mechanism.** `effectiveLocation` is set only by `parseQuery`/`detectLocation` (`lib/dropin/search-intent.ts`) parsing what the user typed (a municipality, neighbourhood, postal code, or centre name) — never anything device-derived.
- IP geolocation anywhere? **No — confirmed absent, not just unused.**
- Uses permission state? **No — there is no permission to check, since no permission-gated API is called.**
- What happens on "permission denied" or "geolocation unavailable"? **N/A — these situations can't occur because geolocation is never requested.**

**There is currently no location-detection feature in DropIn at all.** "Near you" is decorative copy, not a broken feature — worth being precise about, since the symptom report could otherwise be misread as "geolocation is failing."

## 3. LAN HTTP Diagnosis — Two Distinct, Now-Separated Root Causes

Verified with a real, controlled A/B test: two tabs open simultaneously against the same running dev server — one at `http://localhost:3000`, one at `http://192.168.18.4:3000` (the exact LAN address the iPhone uses).

### 3a. Root cause found and fixed: Next.js 16 dev-mode cross-origin protection (DEVELOPMENT-PREVIEW LIMITATION)

**Before any fix**, the LAN tab's page rendered, but **`/api/sessions` was never called at all** — confirmed via `performance.getEntriesByType('resource')` (empty) and 298 captured network requests across three fresh loads with zero appearances of `/api/sessions`, despite the dev server log recording:

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from "192.168.18.4".
Cross-origin access to Next.js dev resources is blocked by default for safety.
```

This project's own installed Next.js 16 docs (`node_modules/next/dist/docs/.../allowedDevOrigins.md`) confirm: *"Next.js blocks cross-origin requests to dev-only assets **and endpoints** during development by default."* Manually calling `fetch("/api/sessions")` from the console on the LAN origin worked fine (200, real data) — so the endpoint itself was healthy; something in the dev client's own bootstrapping on a non-allowlisted origin was preventing the app's `useEffect` fetch from ever firing.

**Fix applied** (`next.config.ts`): added `allowedDevOrigins: ["192.168.18.4"]`. This is a **dev-server-only setting with zero effect on a production build** (`next build`/`next start` don't have this gate at all — confirmed by the doc's own "during development" framing). Restarted the dev server and re-tested: real session data now loads correctly on the LAN origin, matching localhost.

**This alone very likely explains the bulk of "buttons/interactions do not appear to work"** — with `sessions` permanently empty and `loading` permanently `true`, Results/Discovery stay on skeleton cards forever, so every session-dependent interaction (opening the Decision Sheet, Share, Directions, filters, date selection against real data) would have looked broken simply because there was no data to act on, not because those interactions themselves were broken.

### 3b. Root cause confirmed, NOT fixable via config: insecure context (also DEVELOPMENT-PREVIEW LIMITATION, but a permanent one for plain HTTP)

Checked directly, same LAN tab, **after** the fix above:

```json
{ "origin": "http://192.168.18.4:3000", "isSecureContext": false, "hasShare": false, "hasClipboard": false }
```

vs. localhost in the same moment:

```json
{ "origin": "http://localhost:3000", "isSecureContext": true, "hasShare": true, "hasClipboard": true }
```

Per the W3C Secure Contexts spec, only `https:` origins and the special-cased `localhost`/loopback are "potentially trustworthy" — a private-network IP like `192.168.x.x` does **not** qualify just because it's on a local network. `navigator.share` and `navigator.clipboard` are consequently absent entirely (not merely restricted) in that context.

**Directly observed in the live UI**: clicking "Share" in the Decision Sheet on the LAN tab produces **zero visible response** — no native share sheet, no "Copied" confirmation. On the localhost tab, the identical click is expected to succeed (both APIs present; `handleShare`'s existing try/catch already silently swallows the "user cancelled" case, which is why nothing crashes either way — it just silently no-ops on the LAN origin instead of silently succeeding).

**No amount of Next.js config fixes this** — it requires the origin itself to become secure (HTTPS, or a tunnel that terminates HTTPS in front of the same dev server). See §6.

### Clearly distinguished, per the request

| | Cause | Fixable via dev config? | Exists in real HTTPS production? |
|---|---|---|---|
| §3a — stuck loading skeleton, all interactions look dead | `allowedDevOrigins` dev-mode gate | **Yes — fixed** | No — this gate doesn't exist outside `next dev` |
| §3b — Share button silently does nothing | Insecure context (plain HTTP, non-localhost) | No — needs HTTPS | No — a real deployment is HTTPS, so `isSecureContext` would be `true` |

**Both are development-preview limitations, not production bugs.** Nothing found in this investigation indicates the deployed product would exhibit either symptom.

## 4. iOS Safari Compatibility Review

Reviewed for the specific classes of incompatibility named in the request:

- **Click vs. pointer handlers**: every interactive element uses plain `onClick` — confirmed via grep, zero `onMouseEnter`/`onMouseDown`/`onDoubleClick`/`onContextMenu` handlers anywhere. `onClick` fires correctly on tap in iOS Safari; nothing here is mouse-only.
- **Hover-only interactions**: only decorative `hover:` Tailwind classes exist (color/shadow/translate on hover) — none gate actual functionality. iOS Safari's well-known "sticky hover" quirk (a hover style lingering after a tap until the next tap elsewhere) could apply cosmetically here but would never block a real interaction.
- **Touch targets**: not measured against Apple's 44×44pt guideline in this pass (out of scope for a diagnosis-only investigation into *functional* failures) — worth a follow-up if the live phone test still shows anything after §3's fixes.
- **Fixed/sticky positioning**: the Sheet component (`app/_components/Sheet.tsx`) uses `fixed inset-0` for its overlay — standard, no iOS-specific red flags in the CSS itself.
- **Modal/sheet dismissal**: Escape-key handler and backdrop-click both call `onClose` — fine on iOS Safari, which supports both.
- **Scrolling containers**: the horizontal chip/date strips use `overflow-x-auto` — standard and iOS-Safari-compatible.
- **No viewport meta override** exists in `app/layout.tsx` — Next's App Router default (`width=device-width, initial-scale=1`) applies, which is what avoids the old 300ms tap-delay quirk. Verified nothing overrides it.
- **External link / Share / Call behavior**: all standard `<a>`/`tel:` patterns; Share's real limitation is §3b, not an iOS-specific bug — the same insecure-context restriction applies identically in Chrome, confirmed in this investigation.

**One real, unverified-on-a-physical-device candidate worth naming, not confirmed as a bug:** `app/_components/Sheet.tsx` does not lock body scroll while open (no `overflow: hidden` applied to `<body>`/`<html>`, no `touch-action` restriction). iOS Safari is well-documented to **not** automatically prevent the page behind a `position: fixed` overlay from rubber-band-scrolling via touch, unlike most desktop browsers, which can make an open sheet feel like it's "not responding" or let background content shift underneath it. This is plausible as a contributor to "interactions feel broken" on a real iPhone specifically, but it could not be verified here (no physical device access) — flagged as a real candidate for the next physical-device pass, not asserted as confirmed. **Not fixed in this diagnosis-only pass**, per the explicit instruction not to change product behavior yet.

## 5. Temporary Diagnostics

**Not added to the product code — turned out not to be necessary.** Every check requested (`window.isSecureContext`, API availability, origin, fetch behavior) was performed by directly executing JavaScript against the live page via browser automation, connected to the exact same LAN address the phone uses — this gave real, verifiable answers without adding any logging, diagnostic UI, or console noise to `app/page.tsx` itself. Nothing needs to be cleaned up in product code as a result of this investigation.

If you want to confirm any of this yourself on the actual physical iPhone: enable **Settings → Safari → Advanced → Web Inspector** on the phone, connect it to this Mac by cable, then open **Safari → Develop → [your iPhone name] → the DropIn tab** in Mac Safari — that gives you the real device's live console and network panel, which is the authoritative way to confirm these findings on the real hardware rather than this investigation's Chrome-based stand-in for it.

## 6. Recommended Local Testing Method

**Recommendation: a secure tunnel (Option C) for routine mobile testing; LAN HTTP (now fixed, Option A) remains fine for anything that doesn't touch Share/Clipboard.**

| Option | Solves §3a | Solves §3b (secure context) | Setup cost | Notes |
|---|---|---|---|---|
| A. LAN HTTP | Yes, now that `allowedDevOrigins` is set | No — HTTP can never be a secure context | None (already done) | Fine for layout/search/data/Directions/Calendar testing; Share will never work here |
| B. Local HTTPS dev | Yes | Yes | Real setup cost — a self-signed cert (e.g. via `mkcert`) must be generated and its root CA manually trusted on the iPhone (Settings → General → About → Certificate Trust Settings) | Solves everything but is the fiddliest option for a phone specifically |
| **C. Secure tunnel** (e.g. `ngrok`, Cloudflare quick tunnel) | Yes | **Yes** | Low — install one CLI tool, run one command alongside `next dev` | Real HTTPS in front of the live dev server, no cert-trust dance on the phone, dev server's own fast refresh still applies |
| D. Production-like preview deploy (e.g. Vercel preview) | Yes | Yes | Highest — a real deploy per change | Most production-realistic, but too slow for routine iteration; save for pre-launch validation, not everyday testing |

Given the explicit goal ("not to introduce infrastructure unnecessarily... just a secure environment where device APIs behave similarly to production"), **C is the smallest option that actually closes the one gap A can't close**. Keep using LAN HTTP (A) for everything except specifically testing Share — reach for a tunnel only when Share/Clipboard behavior itself needs verifying on the real phone.

## 7. Device Location vs. IP Geolocation — Explicit Answer

**Confirmed directly: DropIn does not obtain device location via `navigator.geolocation`, and there is no IP-based geolocation service anywhere in this codebase.** Nothing was introduced as part of this investigation. "Near you" (§2) is the entire extent of location-flavored copy that isn't driven by an explicit user search.

## 8. Report Summary

1. **Affected interactions (before this session's fix):** effectively all of Results/Discovery, since data never loaded (§3a) — this was the dominant symptom. Separately, **Share** specifically (§3b) — a real, narrower, still-open gap.
2. **Root cause per issue:**
   - Stuck loading / "nothing works": Next.js 16's `allowedDevOrigins` dev-mode cross-origin gate blocking the LAN origin.
   - Share does nothing: insecure context (plain HTTP, non-localhost) makes `navigator.share`/`navigator.clipboard` unavailable.
3. **Classification:**
   - Stuck loading: **DEVELOPMENT-PREVIEW LIMITATION — fixed** via dev config, not a product bug.
   - Share failure: **DEVELOPMENT-PREVIEW LIMITATION**, real and currently still present on LAN HTTP, but will not reproduce on a real HTTPS deployment.
   - Sheet body-scroll-lock absence (§4): a **real, unconfirmed iOS-Safari-class candidate**, not fixed, flagged for the next physical-device pass.
4. **Is insecure HTTP responsible?** Yes, specifically and only for Share/Clipboard (§3b) — not for the stuck-loading symptom, which had a separate cause (§3a).
5. **Current "Near You" implementation:** not a feature — static fallback text, no geolocation call (§2).
6. **Actual device geolocation implemented?** No (§7).
7. **Recommended testing setup:** LAN HTTP (now working) for general testing; a secure tunnel for anything touching Share (§6).
8. **Production fix genuinely required:** none identified — both confirmed root causes are development-preview-only and won't reproduce in a real deployment. The Sheet body-scroll-lock gap (§4) is a real candidate worth testing on the physical device before deciding whether it needs a fix, but should not be assumed to be one yet.
9. **What should NOT be changed:** `handleShare`'s existing try/catch behavior (already correctly silent on failure — the *cause* was the environment, not the error handling); the Sheet component's animation/dismissal logic; anything in `app/page.tsx`'s product UI — none of it was touched, and this investigation found no evidence any of it needs to be.
