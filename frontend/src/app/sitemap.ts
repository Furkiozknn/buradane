import type { MetadataRoute } from "next";

import { datasetMeta, placesOfProvince } from "@/lib/places-repository";

/**
 * One sitemap per province, not one file for the country.
 *
 * The single-file version emitted 60.873 URLs in 6 MB. The sitemaps.org
 * protocol caps one file at 50.000, and Google and Bing REJECT an oversized
 * file rather than truncating it - so every /yer page was getting exactly
 * zero crawl benefit from a sitemap that looked like it was working. It
 * also made the build's static-generation phase load all 167.829 records
 * into one worker (15,8 s, 485 MB peak).
 *
 * Sharding by province fixes all three at once: 81 files of a few hundred
 * URLs each, each one needing only its own province's snapshot, which the
 * reader loads lazily anyway.
 *
 * Not every place earns an entry, on purpose. Most records are unnamed
 * nodes ("Umumi Tuvalet", "Oturma Alanı") whose /yer pages are
 * near-duplicates of each other, and tens of thousands of thin pages is how
 * a small site gets its crawl budget spent on nothing. Named places are the
 * ones people search for by name, so they are the ones listed; the rest
 * stay reachable through the map and through links. A sitemap is a
 * recommendation, not an allowlist.
 */
const GENERIC_NAMES =
  /^(Umumi Tuvalet|Park|İçme Suyu Çeşmesi|Oturma Alanı|Çocuk Oyun Alanı|Spor Alanı|Otopark|Duş|Ücretsiz Wi-Fi Noktası|Cami|Eczane|Acil Toplanma Alanı|Kütüphane|Şarj İstasyonu)$/;

/** Next calls this at build time to learn the shard ids; each returned
 * object becomes /sitemap/<id>.xml. */
export function generateSitemaps() {
  return datasetMeta().cities.map((city) => ({ id: city.slug }));
}

export default async function sitemap({
  id,
}: {
  // Next 16 hands metadata routes their params asynchronously, the same way
  // page and route handlers get them. Typed and awaited rather than
  // destructured directly: reading it synchronously yields a Promise, which
  // silently became a slug that matches no file, and every shard built
  // clean, valid and empty.
  id: Promise<string> | string;
}): Promise<MetadataRoute.Sitemap> {
  const slug = await id;
  // No deployment exists yet, so there is no true canonical host to
  // hardcode. The env var lets the eventual deployment set it without a
  // code change; the fallback is syntactically valid and obviously fake,
  // which beats shipping someone else's real domain in a sitemap.
  const base = process.env.BURADANE_SITE_URL ?? "https://buradane.example";

  const places = placesOfProvince(slug)
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

  // The homepage rides on the first shard alphabetically, so it appears
  // exactly once across the set rather than 81 times.
  const isFirstShard = datasetMeta().cities[0]?.slug === slug;
  return isFirstShard
    ? [{ url: base, changeFrequency: "daily" as const }, ...places]
    : places;
}
