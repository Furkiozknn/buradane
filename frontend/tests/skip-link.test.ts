import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The skip link must only exist where its target does.
 *
 * It used to sit in the root layout, so /admin, /yer/[id] and the 404 page
 * all opened with a "Sonuç listesine geç" link to #sonuclar - an id only the
 * map page renders. axe-core flagged it on every one of those pages
 * (skip-link, region) in a Playwright run at 390 px and 1280 px. Rendering
 * the full AppShell needs MapLibre and a browser, so this pins the pairing at
 * the source level: the link and its target live in the same component, and
 * the layout that wraps every page carries no in-page anchor at all.
 */
const src = (rel: string) => readFileSync(path.join(import.meta.dirname, "..", "src", rel), "utf8");

describe("skip link", () => {
  it("is not in the root layout, which wraps pages without #sonuclar", () => {
    expect(src("app/layout.tsx")).not.toMatch(/href="#/);
  });

  it("lives in AppShell together with the #sonuclar list it targets", () => {
    const shell = src("components/AppShell.tsx");
    expect(shell).toMatch(/href="#sonuclar"/);
    expect(shell).toMatch(/id="sonuclar"/);
    // It must come before the map: the map's pins are Tab stops, and a skip
    // link after them skips nothing.
    expect(shell.indexOf('href="#sonuclar"')).toBeLessThan(shell.indexOf("<MapCanvas"));
  });
});
