import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

// Inter carries complete Turkish coverage (ı İ ğ Ğ ş Ş ç Ç ö Ö ü Ü) - a real
// constraint here, since a font missing dotless ı silently mangles half the
// place names in the dataset.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
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
      <body className={`${inter.variable} antialiased`}>
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
