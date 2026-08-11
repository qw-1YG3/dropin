import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-server-only setting (has no effect in a production build/`next
  // start`) — lets a physical device on the same LAN test the dev server
  // via its http://<LAN-IP>:3000 address. Without this, Next 16 blocks
  // cross-origin requests to dev-only assets/endpoints from any origin
  // other than localhost, confirmed to also affect an origin's own client
  // fetch behaviour, not just HMR. Diagnostic infrastructure, not product
  // behavior — see docs/MOBILE_PREVIEW_DIAGNOSTIC.md.
  allowedDevOrigins: ["192.168.18.4"],
};

export default nextConfig;
