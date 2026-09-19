import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server's hot-reload websocket work when visiting via the
  // branded local hostname (see scripts/start.mjs / README "Running it").
  allowedDevOrigins: ["meridian.local"],
};

export default nextConfig;
