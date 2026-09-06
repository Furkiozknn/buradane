import type { MetadataRoute } from "next";

import { datasetMeta } from "@/lib/places-repository";

/**
 * /admin is an interface, not content; /api is machine surface. Neither
 * belongs in a search index. The map itself and the per-place /yer pages
 * are exactly what should be found.
 *
 * The sitemap is sharded per province (see sitemap.ts - one file would be
 * 60.875 URLs against a 50.000 protocol limit, which crawlers reject
 * outright), and nothing links those shards together, so robots.txt is
 * where they get announced. Listing them here is what makes the sharding
 * discoverable rather than merely valid.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.BURADANE_SITE_URL ?? "https://buradane.example";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/"],
    },
    sitemap: datasetMeta().cities.map((city) => `${base}/sitemap/${city.slug}.xml`),
  };
}
