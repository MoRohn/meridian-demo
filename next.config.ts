import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * The Content-Security-Policy every page is served with (the no-nonce form from Next's CSP guide). API keys saved in
 * Settings live in the browser, so the policy is what limits what a script that got onto the page could do with them:
 * `connect-src 'self'` means it cannot send them to another server, `object-src`/`base-uri`/`frame-ancestors` close the
 * other common routes, and nothing is loaded from a third party. Inline scripts stay allowed because Next and the theme
 * bootstrap in layout.tsx emit them; moving to nonces (see the guide) would remove that, at the cost of static rendering.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Lets the dev server's hot-reload websocket work when visiting via the
  // branded local hostname (see scripts/start.mjs and docs/configuration.md).
  allowedDevOrigins: ["meridian.local"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
