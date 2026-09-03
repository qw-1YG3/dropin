import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  // Dev-server-only setting (has no effect in a production build/`next
  // start`) — lets a physical device on the same LAN test the dev server
  // via its http://<LAN-IP>:3000 address. Without this, Next 16 blocks
  // cross-origin requests to dev-only assets/endpoints from any origin
  // other than localhost, confirmed to also affect an origin's own client
  // fetch behaviour, not just HMR. Diagnostic infrastructure, not product
  // behavior — see docs/MOBILE_PREVIEW_DIAGNOSTIC.md.
  allowedDevOrigins: ["192.168.18.4"],
  // Release Versioning & Rollback Foundation — package.json's own `version`
  // is the single canonical application-version source (docs/RELEASE_PROCESS.md).
  // Inlined here at Next's own build time into both server and client bundles,
  // so About reads it via process.env.NEXT_PUBLIC_APP_VERSION instead of a
  // hardcoded literal. A rolled-back historical Vercel deployment naturally
  // still shows the version correct for it, since rollback re-serves that
  // deployment's own already-built bundle rather than rebuilding from
  // today's package.json. The daily R2 municipal-data refresh never touches
  // package.json or triggers a rebuild, so it has zero effect on this value.
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
