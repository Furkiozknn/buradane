/**
 * The site's absolute base URL, from `BURADANE_SITE_URL`.
 *
 * Three separate places need this - robots.txt, the per-province sitemaps,
 * and `metadataBase` for Open Graph - and each had its own copy of the same
 * `?? "https://buradane.example"` fallback. A fourth caller would have made
 * four chances to drift, so it lives here once.
 *
 * The fallback is deliberately an obviously-fake domain rather than a real
 * one: an unset variable should be visible in the output (a reviewer sees
 * `buradane.example` and knows the deploy is misconfigured), never a silent
 * link to somebody else's site.
 *
 * Trailing slashes are stripped so callers can concatenate `${base}/x`
 * without producing `//x`, which some crawlers treat as a distinct URL.
 */
export const SITE_URL_FALLBACK = "https://buradane.example";

export function siteUrl(): string {
  const raw = process.env.BURADANE_SITE_URL?.trim();
  if (!raw) return SITE_URL_FALLBACK;
  return raw.replace(/\/+$/, "");
}