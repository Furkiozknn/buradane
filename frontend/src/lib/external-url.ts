/**
 * Turns an OSM `website` value into something safe to put in an href, or
 * null when it is not a web address at all.
 *
 * The detail page used to render `href={place.website}` straight from the
 * snapshot. Measured across the dataset: 1.803 places carry a website, and
 * **30 of them have no scheme** - `bilgesahinpastadukkani.com`. A browser
 * resolves that relative to the current page, so the link pointed at
 * `/yer/bilgesahinpastadukkani.com` on our own site: a 404 presented to the
 * user as the business's homepage. CLAUDE.md §6 calls that inventing what
 * we do not know; a broken link is worse than no link.
 *
 * The allowlist is the other half. Today the dataset contains only http and
 * https, but this value is editable by anyone on openstreetmap.org and by
 * any admin override, and `javascript:alert(1)` in an href is a stored XSS
 * on a page anyone can reach. Allowing two schemes and refusing the rest
 * costs nothing and does not depend on React continuing to special-case
 * `javascript:` for us.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Matches a leading `scheme:` per RFC 3986. Deliberately not a URL parse -
 * we need to know whether the author wrote a scheme at all, and `new URL()`
 * cannot tell "no scheme" from "invalid". */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  // Scheme-less values are assumed to be https rather than http: every one
  // of the 30 in the dataset is a plain hostname, and guessing the insecure
  // scheme for a site that supports both would be a downgrade we chose.
  const candidate = HAS_SCHEME.test(value) ? value : `https://${value}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  // `https://` alone parses successfully with an empty host, and so does a
  // value that was only whitespace after the scheme.
  if (!url.hostname) return null;
  // A hostname with no dot is not a public site - it is `localhost`, a typo,
  // or a fragment of an address someone typed into the wrong OSM field.
  if (!url.hostname.includes(".")) return null;

  return url.href;
}

/**
 * What to SHOW for a link, as opposed to where it points. The raw value is
 * what the OSM contributor wrote and is what a user would recognise;
 * `new URL().href` normalises it into a trailing slash and percent-escapes,
 * which reads like a machine talking.
 */
export function displayUrl(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
