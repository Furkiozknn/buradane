import type { NextConfig } from "next";

/**
 * Security headers that are identical on every response.
 *
 * This app renders community-submitted place names and OSM `website` values
 * on a page anyone can reach, and until now React's escaping was the only
 * thing between that and an injected script - no second line if a rendering
 * dependency (MapLibre, lucide) were ever compromised. A security review
 * flagged the whole set as missing, including the `X-Powered-By: Next.js`
 * banner it ships by default.
 *
 * The Content-Security-Policy is NOT here. It carries a per-request nonce -
 * without one, `script-src 'self'` blocks Next's own inline bootstrap and the
 * app ships as a dead shell - so it lives in src/proxy.ts, which can mint one.
 * That file also documents every directive and why it is there.
 *
 * HSTS is deliberately absent: it is a promise about a domain, and there is
 * no deployment yet. docs/dagitim.md is where it belongs, at the proxy, on
 * the day a real hostname exists - setting it here from a repo that has
 * never been served over HTTPS would be a claim, not a control.
 */
const nextConfig: NextConfig = {
  // Advertising the framework and its version tells an attacker which CVE
  // list to start from and tells a user nothing.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stops a browser from second-guessing a Content-Type - the
          // classic way a user-supplied file becomes executable script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrers leak the map coordinates a user was looking at, which
          // for a civic tool is a location. Origin-only, cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app asks for geolocation and nothing else.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
