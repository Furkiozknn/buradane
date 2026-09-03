import { describe, expect, it } from "vitest";

import { EMPTY_URL_STATE, buildUrlSearch, parseUrlState, type UrlState } from "@/lib/url-state";

/**
 * A shared link is a promise: whatever the sender was looking at is what the
 * recipient sees. That only holds if build and parse are exact inverses, so
 * these test the round trip rather than either half alone.
 */

describe("round trip", () => {
  it("preserves a fully populated state", () => {
    const state: UrlState = {
      category: "tuvalet",
      amenities: ["wheelchair_accessible", "baby_changing"],
      freeOnly: true,
      openNow: true,
      query: "ücretsiz tuvalet",
      placeId: "node/4816553622",
      center: { lat: 41.00821, lon: 28.97843 },
      zoom: 16.4,
    };

    const parsed = parseUrlState(buildUrlSearch(state).slice(1));

    expect(parsed.category).toBe(state.category);
    expect(parsed.amenities.sort()).toEqual([...state.amenities].sort());
    expect(parsed.freeOnly).toBe(true);
    expect(parsed.openNow).toBe(true);
    expect(parsed.query).toBe(state.query);
    expect(parsed.placeId).toBe(state.placeId);
    expect(parsed.center!.lat).toBeCloseTo(state.center!.lat, 4);
    expect(parsed.center!.lon).toBeCloseTo(state.center!.lon, 4);
    expect(parsed.zoom).toBeCloseTo(state.zoom!, 1);
  });

  it("produces an empty search for empty state, so a clean URL stays clean", () => {
    expect(buildUrlSearch(EMPTY_URL_STATE)).toBe("");
  });

  it("parses an empty search back to empty state", () => {
    expect(parseUrlState("")).toEqual(EMPTY_URL_STATE);
  });
});

describe("flag packing", () => {
  it("keeps amenities and the two toggles distinguishable in one param", () => {
    const search = buildUrlSearch({
      ...EMPTY_URL_STATE,
      amenities: ["has_wifi"],
      freeOnly: true,
      openNow: true,
    });
    const parsed = parseUrlState(search.slice(1));
    // "free"/"open" are reserved names in the shared list and must not leak
    // into amenities, or the query layer would reject them as unknown keys.
    expect(parsed.amenities).toEqual(["has_wifi"]);
    expect(parsed.freeOnly).toBe(true);
    expect(parsed.openNow).toBe(true);
  });
});

describe("hostile input", () => {
  it("ignores non-numeric coordinates instead of producing NaN", () => {
    const parsed = parseUrlState("y=abc&x=def");
    expect(parsed.center).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(parseUrlState("y=999&x=0").center).toBeNull();
    expect(parseUrlState("y=0&x=999").center).toBeNull();
  });

  it("survives a half-specified position", () => {
    expect(parseUrlState("y=41.0").center).toBeNull();
    expect(parseUrlState("x=29.0").center).toBeNull();
  });

  it("ignores an unparseable zoom", () => {
    expect(parseUrlState("z=nope").zoom).toBeNull();
  });

  it("does not crash on unknown params", () => {
    const parsed = parseUrlState("totally=unknown&k=park");
    expect(parsed.category).toBe("park");
  });
});
