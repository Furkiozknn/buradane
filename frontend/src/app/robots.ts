import type { MetadataRoute } from "next";

/**
 * /admin is an interface, not content; /api is machine surface. Neither
 * belongs in a search index. The map itself and the per-place /yer pages
 * are exactly what should be found.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/"],
    },
  };
}
