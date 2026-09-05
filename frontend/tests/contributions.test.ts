import { describe, expect, it } from "vitest";

import { placeFromSuggestion } from "@/lib/contributions-store";
import type { Contribution } from "@/lib/types";

/**
 * Approving a suggestion is what makes contributing mean anything. Before
 * this path existed the queue said "Onaylandı" and no place was ever
 * created, so the moderator was told the work had landed when nothing had.
 * These lock the rules that decide what a submission is allowed to become.
 */

function suggestion(payload: Record<string, unknown>, overrides: Partial<Contribution> = {}): Contribution {
  return {
    id: "c_test",
    kind: "suggestion",
    placeId: null,
    placeName: (payload.name as string) ?? null,
    payload,
    note: null,
    status: "pending",
    createdAt: "2026-09-03T08:00:00.000Z",
    ...overrides,
  };
}

const VALID = { name: "Sahil Umumi Tuvaleti", lat: 40.9905, lon: 29.025, categories: ["tuvalet"] };

describe("placeFromSuggestion", () => {
  it("builds a usable place from a complete submission", () => {
    const place = placeFromSuggestion(suggestion(VALID));
    expect(place).not.toBeNull();
    expect(place!.name).toBe("Sahil Umumi Tuvaleti");
    expect(place!.categories).toEqual(["tuvalet"]);
    expect(place!.status).toBe("active");
    expect(place!.id).toBe("community/c_test");
  });

  it("never invents an amenity the submitter did not mention", () => {
    // `null` means unknown. Defaulting to `false` would let the app claim
    // "no wheelchair access" for a place nobody was asked about - the one
    // thing this codebase refuses to do anywhere else.
    const place = placeFromSuggestion(suggestion(VALID))!;
    expect(Object.values(place.amenities).every((v) => v === null)).toBe(true);
  });

  it("attributes the place to the community, not to OpenStreetMap", () => {
    // The snapshot is ODbL. Labelling a user submission as OSM data would
    // misattribute it in both directions.
    const place = placeFromSuggestion(suggestion(VALID))!;
    expect(place.source.slug).toBe("community");
    expect(place.source.license).not.toMatch(/ODbL/i);
  });

  it("starts between an unverified node and a well-tagged one", () => {
    // One moderator approval, no independent confirmation. Zero would bury a
    // place someone stood in front of; parity with a rich OSM node would
    // overstate it.
    const place = placeFromSuggestion(suggestion(VALID))!;
    expect(place.reliability_score).toBeGreaterThan(0.3);
    expect(place.reliability_score).toBeLessThan(0.75);
    expect(place.verification_count).toBe(0);
  });

  it("refuses a submission outside Türkiye", () => {
    // v1 scope is Türkiye, and a bad geocode would otherwise drop a pin in
    // the sea and stay there.
    expect(placeFromSuggestion(suggestion({ ...VALID, lat: 48.85, lon: 2.35 }))).toBeNull();
  });

  it("refuses a submission with no category, no name or no coordinates", () => {
    expect(placeFromSuggestion(suggestion({ ...VALID, categories: [] }))).toBeNull();
    expect(placeFromSuggestion(suggestion({ ...VALID, name: "   " }))).toBeNull();
    expect(placeFromSuggestion(suggestion({ ...VALID, lat: undefined }))).toBeNull();
    expect(placeFromSuggestion(suggestion({ ...VALID, lat: "abc" }))).toBeNull();
  });

  it("carries the submitter's note through as the description", () => {
    const place = placeFromSuggestion(suggestion(VALID, { note: "Sahil yürüyüş yolunun sonunda." }))!;
    expect(place.description).toBe("Sahil yürüyüş yolunun sonunda.");
  });
});
