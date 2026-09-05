import type { MetadataRoute } from "next";

import { allPlaces } from "@/lib/places-repository";

/**
 * Not every place earns a sitemap entry, on purpose. The snapshot holds
 * ~20,000 records and most are unnamed nodes ("Umumi Tuvalet", "Oturma
 * Alanı") whose /yer pages are near-duplicates of each other - tens of
 * thousands of thin pages is how a small site gets its crawl budget wasted
 * and its real pages ignored. Named places are the ones people search for
 * by name, so they are the ones listed. The rest stay reachable through
 * links and the map; a sitemap is a recommendation, not an allowlist.
 */
const GENERIC_NAMES =
  /^(Umumi Tuvalet|Park|İçme Suyu Çeşmesi|Oturma Alanı|Çocuk Oyun Alanı|Spor Alanı|Otopark|Duş|Ücretsiz Wi-Fi Noktası|Cami|Eczane|Acil Toplanma Alanı|Kütüphane|Şarj İstasyonu)$/;

export default function sitemap(): MetadataRoute.Sitemap {
  // No deployment exists yet, so there is no true canonical host to
  // hardcode. The env var lets the eventual deployment set it without a
  // code change; the fallback is syntactically valid and obviously fake,
  // which beats shipping someone else's real domain in a sitemap.
  const base = process.env.BURADANE_SITE_URL ?? "https://buradane.example";

  const places = allPlaces()
    .filter(
      (place) =>
        place.status === "active" &&
        place.access !== "private" &&
        !GENERIC_NAMES.test(place.name),
    )
    .map((place) => ({
      url: `${base}/yer/${encodeURIComponent(place.id)}`,
      changeFrequency: "monthly" as const,
    }));

  return [{ url: base, changeFrequency: "daily" as const }, ...places];
}
