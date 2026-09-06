import { describe, expect, it } from "vitest";

import { displayUrl, safeExternalUrl } from "@/lib/external-url";
import { allPlaces } from "@/lib/places-repository";

/**
 * The place detail page renders an OSM `website` value as a link. That value
 * is written by anyone with an openstreetmap.org account, which makes it the
 * least trusted string the app puts in an href.
 */
describe("safeExternalUrl", () => {
  it("passes http and https through", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("adds https to a scheme-less host instead of leaving a relative link", () => {
    // This is the bug the module exists for. `href="example.com"` resolves
    // against the current page, so on /yer/node%2F123 it points at
    // /yer/example.com - a 404 on our own site, shown as the business's
    // homepage. 30 records in the shipped dataset look exactly like this.
    expect(safeExternalUrl("bilgesahinpastadukkani.com")).toBe(
      "https://bilgesahinpastadukkani.com/",
    );
    expect(safeExternalUrl("www.example.com/menu")).toBe("https://www.example.com/menu");
  });

  it("refuses schemes that are not the web", () => {
    // `javascript:` in an href is stored XSS on a page anyone can reach.
    // React currently blocks it, but that is React's choice to reverse, not
    // a guarantee this app should rest on.
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses values that are not addresses at all", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl("https://")).toBeNull();
    // No dot: localhost, a typo, or a fragment of an address typed into the
    // wrong OSM field. Never a public site.
    expect(safeExternalUrl("localhost")).toBeNull();
    expect(safeExternalUrl("Ana cadde no 5")).toBeNull();
  });

  it("keeps the human spelling for display", () => {
    // new URL().href normalises into trailing slashes and percent escapes,
    // which reads like a machine talking. The link text stays what the OSM
    // contributor wrote, minus the scheme noise.
    expect(displayUrl("https://www.example.com/")).toBe("www.example.com");
    expect(displayUrl("http://example.com")).toBe("example.com");
    expect(displayUrl("example.com")).toBe("example.com");
  });
});

describe("the shipped dataset", () => {
  it("has no website value that would render as a dangerous or relative link", () => {
    // Walks the real snapshot rather than trusting the unit cases above: the
    // point of the guard is the data we actually ship, and a re-pull can
    // introduce a value nobody predicted.
    const withSite = allPlaces().filter((p) => p.website);
    expect(withSite.length).toBeGreaterThan(1000);

    const rejected: string[] = [];
    const relative: string[] = [];
    for (const place of withSite) {
      const href = safeExternalUrl(place.website);
      if (href === null) {
        rejected.push(place.website!);
        continue;
      }
      if (!/^https?:\/\//i.test(href)) relative.push(href);
    }

    // A rejected value is not a test failure - it is the guard working. It
    // IS worth seeing, so the assertion names them rather than counting.
    expect(relative).toEqual([]);
    expect(rejected.length, `reddedilen: ${rejected.slice(0, 10).join(", ")}`).toBeLessThan(
      withSite.length * 0.02,
    );
  }, 180_000);
});
