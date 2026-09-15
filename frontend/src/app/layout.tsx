import type { Metadata, Viewport } from "next";

// Inter, self-hosted from a lockfile-pinned npm package rather than fetched
// from fonts.googleapis.com at build time.
//
// `next/font/google` downloads the font during `next build`. That put an
// unpinned third-party HTTP call on the critical path of CI: Google Fonts
// being slow or unreachable turns a green build red, which is exactly the
// failure mode this project claims not to have. `npm ci` also hits the
// network, but every byte it fetches is pinned in package-lock.json; the
// font request was not.
//
// `wght.css` is the weight-axis variable font, declared as seven @font-face
// rules that differ only by unicode-range, so a browser downloads just the
// subsets a page actually uses. Turkish needs two of them: ç ö ü and dotless
// ı come from `latin`, while İ ğ Ğ ş Ş come from `latin-ext`. That per-subset
// unicode-range is why this is a stylesheet import and not `next/font/local`,
// which has no way to express one.
import "@fontsource-variable/inter/wght.css";

import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { siteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  // Without this, every relative image in metadata - including the
  // /yer/[id]/opengraph-image route - resolves against http://localhost:3000
  // in production. The page still renders; only the share preview breaks, so
  // nothing in CI or a smoke test notices. For an app people find by having a
  // link sent to them, a broken preview card is a growth bug, not a cosmetic
  // one. Next warns about this at build time and the warning was being missed.
  metadataBase: new URL(siteUrl()),
  title: "buradane — Yakınımda ne var?",
  description:
    "Türkiye'deki kamusal alanları keşfet: tuvalet, park, içme suyu, dinlenme alanı, çocuk parkı, spor alanı, otopark ve daha fazlası. Konumuna en yakın olanı saniyeler içinde bul.",
  applicationName: "buradane",
  keywords: ["kamusal alan", "tuvalet bul", "park", "içme suyu", "erişilebilirlik", "İstanbul"],
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
  width: "device-width",
  initialScale: 1,
  // Deliberately NO maximumScale/user-scalable=no. Blocking page zoom is a
  // WCAG 1.4.4 failure, and in an app whose whole point is helping people
  // find accessible facilities, disabling zoom to protect a gesture would be
  // the wrong trade. Map gestures are handled by MapLibre and `touch-action`
  // instead.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="antialiased">
        <a
          href="#sonuclar"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Sonuç listesine geç
        </a>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
