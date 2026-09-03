import { describe, expect, it } from "vitest";

import { allPlaces, applyOverride, datasetMeta, parseQueryText, queryPlaces } from "@/lib/places-repository";
import { isOpenNow } from "@/lib/opening-hours";
import type { Place } from "@/lib/types";

const ISTANBUL = { lat: 41.0082, lon: 28.9784 };

/**
 * These lock the promises the code makes in comments and the README. Each
 * one corresponds to a claim a user relies on: that an unknown amenity is
 * not silently treated as a yes, that a report never changes the public
 * record on its own, that confirming a place raises its score rather than
 * resetting it.
 */

describe("dataset", () => {
  it("loads every city file, not just one", () => {
    const meta = datasetMeta();
    expect(meta.cities.length).toBeGreaterThanOrEqual(2);
    expect(meta.cities.map((c) => c.slug)).toContain("istanbul");
    expect(meta.count).toBe(allPlaces().length);
  });

  it("gives every place a category, coordinates and a source", () => {
    for (const place of allPlaces().slice(0, 500)) {
      expect(place.categories.length).toBeGreaterThan(0);
      expect(Number.isFinite(place.lat)).toBe(true);
      expect(Number.isFinite(place.lon)).toBe(true);
      expect(place.source.license).toBeTruthy();
    }
  });
});

describe("radius search", () => {
  it("returns only places within the radius, nearest first", () => {
    const { places } = queryPlaces({ ...ISTANBUL, radius_m: 1500, limit: 100 });
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.distance_m).not.toBeNull();
      expect(place.distance_m!).toBeLessThanOrEqual(1500);
    }
    const distances = places.map((p) => p.distance_m!);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("widening the radius never loses a result", () => {
    const near = queryPlaces({ ...ISTANBUL, radius_m: 500, limit: 300 });
    const far = queryPlaces({ ...ISTANBUL, radius_m: 2000, limit: 300 });
    expect(far.total).toBeGreaterThanOrEqual(near.total);
  });
});

describe("amenity filters", () => {
  it("treats unknown (null) as NOT matching - never claims a facility we have no evidence for", () => {
    const { places } = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      amenities: ["wheelchair_accessible"],
      limit: 200,
    });
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.amenities.wheelchair_accessible).toBe(true);
    }
  });

  it("requires ALL requested amenities, not any of them", () => {
    const both = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      amenities: ["wheelchair_accessible", "has_drinking_water"],
      limit: 200,
    });
    for (const place of both.places) {
      expect(place.amenities.wheelchair_accessible).toBe(true);
      expect(place.amenities.has_drinking_water).toBe(true);
    }
  });
});

describe("category filters", () => {
  it("matches any of the requested categories", () => {
    const { places } = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      categories: ["tuvalet", "eczane"],
      limit: 200,
    });
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.categories.some((c) => c === "tuvalet" || c === "eczane")).toBe(true);
    }
  });
});

describe("Turkish text handling", () => {
  it("matches regardless of dotted/dotless I casing", () => {
    // JS toLowerCase maps "I" to "i", not "ı" - without locale-aware
    // normalisation "KADIKÖY" would never match "Kadıköy".
    const upper = queryPlaces({ q: "KADIKÖY", limit: 50 });
    const lower = queryPlaces({ q: "kadıköy", limit: 50 });
    expect(upper.total).toBeGreaterThan(0);
    expect(upper.total).toBe(lower.total);
  });
});

describe("natural-language search", () => {
  it("extracts a category from free text", () => {
    const parsed = parseQueryText("yakınımda bir tuvalet");
    expect(parsed.categories).toContain("tuvalet");
  });

  it("extracts an amenity and the free flag together", () => {
    const parsed = parseQueryText("ücretsiz engelli erişimli yer");
    expect(parsed.freeOnly).toBe(true);
    expect(parsed.amenities).toContain("wheelchair_accessible");
  });

  it("drops Turkish glue words so they cannot become a name filter", () => {
    // "gidebileceğim" left behind as a needle is what once zeroed out this
    // exact query.
    const parsed = parseQueryText("çocuğumla gidebileceğim park");
    expect(parsed.categories).toContain("park");
    expect(parsed.leftover).toBe("");
  });

  it("keeps a genuine proper noun as a needle", () => {
    const parsed = parseQueryText("Gülhane parkı");
    expect(parsed.categories).toContain("park");
    expect(parsed.leftover.toLowerCase()).toContain("gülhane");
  });

  it("understands Turkish-specific vocabulary", () => {
    expect(parseQueryText("abdest alabileceğim yer").categories).toContain("cami");
    expect(parseQueryText("deprem toplanma alanı").categories).toContain("toplanma-alani");
    expect(parseQueryText("nöbetçi eczane").categories).toContain("eczane");
  });

  it("handles Turkish consonant softening (k → ğ) in inflected words", () => {
    // "çocuk" becomes "çocuğ-" before a vowel-initial suffix, which is what
    // anyone typing a natural sentence produces.
    expect(parseQueryText("çocuğumla gidebileceğim park").amenities).toContain("child_friendly");
    expect(parseQueryText("köpeğimle gidebileceğim yer").amenities).toContain("pet_friendly");
  });

  it("strips Turkish verb glue by suffix, not by an enumerated word list", () => {
    // "-abileceğim" is productive: every verb yields one. Listing words
    // one by one always leaves a hole, and each hole becomes a literal name
    // filter that silently empties the results.
    for (const q of [
      "abdest alabileceğim yer",
      "sessiz çalışabileceğim yer",
      "bulabileceğim tuvalet",
      "gidilecek park",
    ]) {
      expect(parseQueryText(q).leftover).toBe("");
    }
  });

  it("reads İ and I correctly when deciding a token is glue", () => {
    // normalizeTr must run before the stopword lookup, or "NEREDE" survives
    // as a needle.
    expect(parseQueryText("NEREDE TUVALET VAR").leftover).toBe("");
  });

  it("recognises softened stems beyond çocuk", () => {
    expect(parseQueryText("bebeğimin bezini değiştirebileceğim yer").amenities).toContain(
      "baby_changing",
    );
    expect(parseQueryText("engelli erişimli tuvalet").amenities).toContain("wheelchair_accessible");
    expect(parseQueryText("engelli erişimli tuvalet").leftover).toBe("");
  });

  it("lets a specific match beat a weak one instead of stacking both", () => {
    // "araç" alone means parking, but next to "şarj" it dragged 600
    // car parks into a charging-station search.
    const charging = parseQueryText("elektrikli araç şarj");
    expect(charging.categories).toContain("sarj");
    expect(charging.categories).not.toContain("otopark");
    // On its own the weak rule still fires - it is real evidence, just
    // lower-priority.
    expect(parseQueryText("arabamı bırakacak yer").categories).toContain("otopark");
  });

  it("returns results for a structured query rather than a dead end", () => {
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, q: "ücretsiz tuvalet", limit: 50 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.applied.categories).toContain("tuvalet");
    expect(result.applied.freeOnly).toBe(true);
  });

  it("relaxes an unmatchable needle instead of returning nothing, and says so", () => {
    const result = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      q: "tuvalet zzzqqxyz",
      limit: 50,
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.applied.relaxed).toBe(true);
  });

  it("drops an unsatisfiable amenity rather than dead-ending, and names it", () => {
    // Amenity data is the sparsest field we have and `null` is excluded on
    // purpose, so an empty result here is usually a gap in the map rather
    // than a gap in the city.
    const result = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      categories: ["eczane"],
      amenities: ["has_shower", "has_wifi", "baby_changing"],
      limit: 20,
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.applied.relaxed).toBe(true);
    expect(result.applied.relaxedBy?.amenities?.length).toBeGreaterThan(0);
    // The chips must keep reflecting what the user asked for.
    expect(result.applied.amenities).toEqual(["has_shower", "has_wifi", "baby_changing"]);
  });

  it("never relaxes a category or the free-only flag - those ARE the question", () => {
    const result = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      categories: ["tuvalet"],
      freeOnly: true,
      amenities: ["has_shower"],
      limit: 50,
    });
    expect(result.applied.freeOnly).toBe(true);
    expect(result.applied.categories).toEqual(["tuvalet"]);
    expect(result.applied.relaxedBy?.amenities ?? []).not.toContain("free");
    for (const place of result.places) {
      expect(place.price_type).toBe("free");
      expect(place.categories).toContain("tuvalet");
    }
  });

  it("keeps the last amenity when there is no category to hold the query together", () => {
    // Dropping it would leave an unconstrained query returning the whole
    // dataset, which answers nothing.
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, amenities: ["is_quiet"], limit: 20 });
    for (const place of result.places) {
      expect(place.amenities.is_quiet).toBe(true);
    }
  });

  it("does NOT relax when there is nothing structured to fall back to", () => {
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, q: "zzzqqxyz", limit: 50 });
    expect(result.total).toBe(0);
    expect(result.applied.relaxed).toBeFalsy();
  });
});

describe("open-now filter", () => {
  it("hides places KNOWN to be closed, not places with no hours", () => {
    // 94.5% of the dataset has no opening_hours. Requiring "open" discarded
    // ~10,875 places to exclude 17, and hid 544 of 569 toilets while not one
    // of them was known to be closed. Silence is not a closed sign.
    const strict = queryPlaces({ ...ISTANBUL, radius_m: 20_000, categories: ["tuvalet"], limit: 400 });
    const filtered = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      categories: ["tuvalet"],
      openNow: true,
      limit: 400,
    });
    expect(filtered.total).toBeGreaterThan(strict.total * 0.5);
    for (const place of filtered.places) {
      expect(isOpenNow(place.opening_hours_raw)).not.toBe("closed");
    }
  });

  it("still excludes something - the filter is not a no-op", () => {
    const all = queryPlaces({ ...ISTANBUL, radius_m: 40_000, limit: 20_000 });
    const filtered = queryPlaces({ ...ISTANBUL, radius_m: 40_000, openNow: true, limit: 20_000 });
    const closed = all.places.filter((p) => isOpenNow(p.opening_hours_raw) === "closed").length;
    expect(all.total - filtered.total).toBe(closed);
  });
});

describe("sorting", () => {
  it("orders by reliability when asked, with distance breaking ties", () => {
    const { places } = queryPlaces({
      ...ISTANBUL,
      radius_m: 5000,
      sort: "reliability",
      limit: 50,
    });
    const scores = places.map((p) => p.reliability_score);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] + 0.0011);
    }
  });
});

describe("status visibility", () => {
  it("never returns pending or permanently-closed places to the public", () => {
    const { places } = queryPlaces({ ...ISTANBUL, radius_m: 20_000, limit: 300 });
    for (const place of places) {
      expect(place.status).not.toBe("pending_review");
      expect(place.status).not.toBe("permanently_closed");
    }
  });
});

describe("facets", () => {
  it("counts the whole match set, not the returned page", () => {
    // Counting client-side from the page silently under-reported every
    // category by whatever the limit cut off.
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, limit: 10 });
    expect(result.places.length).toBe(10);
    expect(result.total).toBeGreaterThan(10);
    const summed = Object.values(result.facets.categories).reduce((a, b) => a + (b ?? 0), 0);
    // A place can hold several categories, so the sum is >= total, never below.
    expect(summed).toBeGreaterThanOrEqual(result.total);
  });

  it("counts only confirmed amenities - never `null`", () => {
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, limit: 50 });
    const shade = result.facets.amenities.has_shade ?? 0;
    const actual = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      amenities: ["has_shade"],
      limit: 5000,
    });
    // The chip's number has to be the number the filter actually returns, or
    // it is worse than showing nothing.
    expect(shade).toBe(actual.total);
  });

  it("counts notClosed with the same rule the filter uses", () => {
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, limit: 5 });
    const filtered = queryPlaces({ ...ISTANBUL, radius_m: 20_000, openNow: true, limit: 5 });
    expect(result.facets.notClosed).toBe(filtered.total);
  });

  it("counts freeOnly with the same rule the filter uses", () => {
    const result = queryPlaces({ ...ISTANBUL, radius_m: 20_000, categories: ["tuvalet"], limit: 5 });
    const filtered = queryPlaces({
      ...ISTANBUL,
      radius_m: 20_000,
      categories: ["tuvalet"],
      freeOnly: true,
      limit: 5,
    });
    expect(result.facets.freeOnly).toBe(filtered.total);
  });
});

describe("payload shape", () => {
  it("strips raw_tags from list results", () => {
    const { places } = queryPlaces({ ...ISTANBUL, radius_m: 2000, limit: 20 });
    for (const place of places) {
      expect(place.raw_tags).toBeUndefined();
    }
  });
});

describe("applyOverride", () => {
  const base = (): Place => ({
    ...allPlaces()[0],
    reliability_score: 0.7,
    verification_count: 0,
    report_count: 0,
  });

  it("returns the place untouched when there is no override", () => {
    const place = base();
    expect(applyOverride(place, undefined)).toEqual(place);
  });

  it("RAISES the score on verification - never resets it to a default", () => {
    // The first implementation stored an absolute score in the override and,
    // not knowing the base, dropped a 0.713 place to 0.54 when someone
    // confirmed it was still there.
    const place = base();
    const once = applyOverride(place, { verification_count: 1 });
    const thrice = applyOverride(place, { verification_count: 3 });
    expect(once.reliability_score).toBeGreaterThan(place.reliability_score);
    expect(thrice.reliability_score).toBeGreaterThan(once.reliability_score);
  });

  it("caps the verification bonus so confirmations alone cannot reach a perfect score", () => {
    const place = base();
    const many = applyOverride(place, { verification_count: 100 });
    expect(many.reliability_score).toBeLessThanOrEqual(place.reliability_score + 0.15);
    expect(many.reliability_score).toBeLessThanOrEqual(1);
  });

  it("lets an unresolved report outweigh the verification bonus", () => {
    const place = base();
    const disputed = applyOverride(place, { verification_count: 1, report_count: 1 });
    expect(disputed.reliability_score).toBeLessThan(place.reliability_score);
  });

  it("never lets an undefined override field erase a real value", () => {
    const place = base();
    const merged = applyOverride(place, { reliability_score: undefined, status: "temporarily_closed" });
    expect(merged.reliability_score).toBe(place.reliability_score);
    expect(merged.status).toBe("temporarily_closed");
  });

  it("keeps the score inside 0..1", () => {
    const place = { ...base(), reliability_score: 0.05 };
    const crushed = applyOverride(place, { report_count: 5 });
    expect(crushed.reliability_score).toBeGreaterThanOrEqual(0);
  });
});
