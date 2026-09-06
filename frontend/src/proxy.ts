import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy, with a per-request nonce.
 *
 * This started life in next.config.ts as a static header, and a browser check
 * proved that version broke the entire app: Next emits two inline bootstrap
 * scripts that carry the RSC payload, `script-src 'self'` blocked both, and
 * the page shipped as a dead shell - `self.__next_f.length === 0`, no map
 * canvas, "Yakındakiler aranıyor…" forever. The console said so plainly;
 * nothing about the served HTML did.
 *
 * A nonce is the fix Next documents, and it has to be minted per request, so
 * it cannot live in next.config.ts. The other headers still do - they are the
 * same on every response and belong where they cost nothing.
 *
 * The usual objection to nonces is that they force dynamic rendering. That
 * was measured here rather than assumed: the only statically generated routes
 * are the 81 sitemap shards, robots.txt, the manifest and the icon, all of
 * which the matcher below excludes. `/` and `/yer/[id]` were already dynamic.
 * The cost is zero.
 *
 * Directive notes, written against what the app actually loads:
 *
 *  - `script-src 'self' 'nonce-…'` - `'self'` covers the chunk <script src>
 *    tags; the nonce covers Next's inline bootstrap. No 'unsafe-inline':
 *    with a nonce present browsers ignore it anyway, and dropping it is the
 *    whole point of the exercise.
 *  - `'unsafe-eval'` in development only - React Refresh and the webpack HMR
 *    client need it, and a CSP that makes `npm run dev` unusable gets turned
 *    off rather than fixed.
 *  - `worker-src blob:` - MapLibre spawns its worker from a Blob URL. Without
 *    it the map silently renders nothing.
 *  - `img-src blob: data:` - MapLibre rasterises glyphs and sprites into
 *    canvases and registers category pins as data URIs (see pin-image.ts).
 *  - `style-src 'unsafe-inline'` WITHOUT a nonce, deliberately. Next injects
 *    critical CSS inline; adding a nonce here would make the browser ignore
 *    'unsafe-inline' and block MapLibre's own injected styles too. Style
 *    injection alone does not carry the risk that script injection does.
 *  - tile host - OpenFreeMap serves the base style, tiles and fonts.
 *    Everything else the app fetches is same-origin.
 *
 * HSTS is deliberately absent: it is a promise about a domain, and there is
 * no deployment yet. docs/dagitim.md is where it belongs, at the proxy, on
 * the day a real hostname exists.
 */
const TILE_HOST = "https://tiles.openfreemap.org";

function contentSecurityPolicy(nonce: string): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    process.env.NODE_ENV === "development" ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${TILE_HOST}`,
    `font-src 'self' data: ${TILE_HOST}`,
    `connect-src 'self' ${TILE_HOST}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  // 128 bits, base64. Next reads the nonce back out of the request's own CSP
  // header and stamps it onto every script tag it emits - that round trip is
  // why the header goes on the request as well as the response.
  const nonce = randomBytes(16).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      /*
       * Documents only. The exclusions are not cosmetic:
       *
       *  - /api serves JSON, where a CSP does nothing but cost a round of
       *    header work on the hottest path in the app.
       *  - the metadata routes (sitemap shards, robots, manifest, icon) are
       *    the app's ONLY statically generated output. Handing them a nonce
       *    would trade 81 prebuilt files for 81 per-request renders to
       *    protect XML that contains no scripts.
       */
      source:
        "/((?!api|_next/static|_next/image|favicon\\.ico|icon\\.svg|robots\\.txt|manifest\\.webmanifest|sitemap/).*)",
      // Router prefetches fetch RSC payloads, not documents - no inline
      // script to authorise, so no reason to mint a nonce for them.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
