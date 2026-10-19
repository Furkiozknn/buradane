import { describe, expect, it } from "vitest";

import { BASEMAP_STYLE, FALLBACK_STYLE, isBasemapStyleFailure } from "@/lib/basemap";

describe("isBasemapStyleFailure", () => {
  it("recognises MapLibre's AJAXError for the style url", () => {
    // The shape MapLibre fires when the style fetch fails - observed in a
    // browser with tiles.openfreemap.org unreachable:
    // "AJAXError: Failed to fetch (0): https://tiles.openfreemap.org/styles/positron"
    const error = Object.assign(new Error("Failed to fetch"), { status: 0, url: BASEMAP_STYLE });
    expect(isBasemapStyleFailure(error)).toBe(true);
  });

  it("ignores a query string or fragment on the failed url", () => {
    expect(isBasemapStyleFailure({ url: `${BASEMAP_STYLE}?v=2` })).toBe(true);
  });

  it("does not treat a failed tile or sprite as a style failure", () => {
    // Those are recoverable: the map still loads and the pins still draw.
    expect(isBasemapStyleFailure({ url: "https://tiles.openfreemap.org/planet/1/2/3.pbf" })).toBe(false);
    expect(isBasemapStyleFailure({ url: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json" })).toBe(false);
  });

  it("is false for errors without a url, and for non-objects", () => {
    expect(isBasemapStyleFailure(new Error("WebGL context lost"))).toBe(false);
    expect(isBasemapStyleFailure(undefined)).toBe(false);
    expect(isBasemapStyleFailure("Failed to fetch " + BASEMAP_STYLE)).toBe(false);
  });
});

describe("FALLBACK_STYLE", () => {
  it("declares glyphs, so the text-bearing result layers can still be added", () => {
    expect(FALLBACK_STYLE.glyphs).toMatch(/\{fontstack\}.*\{range\}/);
  });

  it("does not depend on any remote source to render", () => {
    expect(FALLBACK_STYLE.sources).toEqual({});
    expect(FALLBACK_STYLE.layers.map((layer) => layer.type)).toEqual(["background"]);
  });
});
