/**
 * The site's absolute base URL.
 *
 * Three separate places need this - robots.txt, the per-province sitemaps,
 * and `metadataBase` for Open Graph - and each had its own copy of the same
 * fallback. A fourth caller would have made four chances to drift, so it
 * lives here once.
 *
 * Resolution order:
 *
 * 1. `BURADANE_SITE_URL` - the real domain, once there is one. Always wins.
 * 2. `VERCEL_PROJECT_PRODUCTION_URL` - Vercel injects the project's stable
 *    production hostname. Without this a Vercel deploy would emit the
 *    obviously-fake fallback into every sitemap and share card, so the site
 *    would be live and simultaneously un-shareable and un-indexable.
 *    Deliberately NOT `VERCEL_URL`: that is the per-deployment hostname and
 *    changes on every push, which would put a throwaway URL in canonical
 *    tags and sitemaps.
 * 3. The fallback - an obviously-fake domain rather than a real one, so an
 *    unconfigured deploy is visible in the output instead of silently
 *    linking somewhere else.
 *
 * Trailing slashes are stripped so callers can concatenate `${base}/x`
 * without producing `//x`, which some crawlers treat as a distinct URL.
 */
export const SITE_URL_FALLBACK = "https://buradane.example";

export function siteUrl(): string {
  const acik = process.env.BURADANE_SITE_URL?.trim();
  if (acik) return acik.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return SITE_URL_FALLBACK;
}