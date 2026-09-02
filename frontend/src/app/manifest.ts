import type { MetadataRoute } from "next";

/**
 * Installable as a home-screen app.
 *
 * This is not decoration for a utility like this: "yakınımda tuvalet nerede"
 * is a question people ask while walking, in a hurry, often on a bad
 * connection. A home-screen icon that opens straight into the map - no
 * browser chrome, no typing a URL - is the difference between a site someone
 * visits once and a tool they actually reach for.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "buradane — Yakınımda ne var?",
    short_name: "buradane",
    description:
      "Türkiye'deki kamusal alanları keşfet: tuvalet, park, içme suyu, cami, eczane, acil toplanma alanı ve daha fazlası.",
    lang: "tr",
    dir: "ltr",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafaf9",
    theme_color: "#0b6e5f",
    categories: ["navigation", "travel", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
