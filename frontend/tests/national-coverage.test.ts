import { describe, expect, it } from "vitest";

import { allPlaces, datasetMeta, queryPlaces } from "@/lib/places-repository";
import { PROVINCES, TOTALS, findProvince } from "@/lib/administrative";
import { divisionCounts, officialDistrict } from "@/lib/admin-divisions";

/**
 * The national-coverage gate.
 *
 * "81 il indi" is a claim about files on disk; this is the claim a USER
 * relies on: every province is loadable, distinctly resolved, reachable in
 * the city picker, and findable by name in search. It exists because the
 * per-file integrity script (scripts/validate_places_data.mjs) cannot see
 * any of that - it checks records, not what the app makes of them.
 *
 * These run over the real snapshot, so they are also the thing that goes
 * red if a future fetch drops or double-counts a province.
 */

describe("national coverage", () => {
  it("covers all 81 provinces, each resolved to a distinct plate code", () => {
    const cities = datasetMeta().cities;
    const codes = new Map<number, string>();
    const unresolved: string[] = [];
    for (const city of cities) {
      const province = findProvince(city.label);
      if (!province) {
        unresolved.push(city.label);
        continue;
      }
      const clash = codes.get(province.code);
      // Two files resolving to one province would inflate the coverage
      // count and double the places on the map.
      expect(clash, `${city.label} ve ${clash} aynı ile çözülüyor`).toBeUndefined();
      codes.set(province.code, city.label);
    }
    expect(unresolved).toEqual([]);
    expect(codes.size).toBe(TOTALS.provinces);
    expect(codes.size).toBe(81);
  });

  it("leaves no province in the plate table without data", () => {
    const covered = new Set(
      datasetMeta().cities.map((c) => findProvince(c.label)?.code).filter(Boolean),
    );
    const missing = PROVINCES.filter((p) => !covered.has(p.code)).map((p) => `${p.code} ${p.name}`);
    expect(missing).toEqual([]);
  });

  it("gives every province a non-trivial number of places", () => {
    // A province that fetched almost nothing is a silent hole: the file
    // exists, the picker lists it, and the map opens on emptiness.
    const thin = datasetMeta()
      .cities.filter((c) => c.count < 20)
      .map((c) => `${c.label}: ${c.count}`);
    expect(thin).toEqual([]);
  });

  it("finds every province by typing its name", () => {
    // The single most common national query shape: province name alone.
    for (const city of datasetMeta().cities) {
      const result = queryPlaces({ q: city.label, limit: 1 });
      expect(result.total, `"${city.label}" aramasi bos dondu`).toBeGreaterThan(0);
    }
  });

  it("resolves districts against the official 973-district list", () => {
    const counts = divisionCounts();
    expect(counts).not.toBeNull();
    expect(counts!.provinces).toBe(81);
    expect(counts!.districts).toBe(973);

    // Every district name the dataset carries must be one the official
    // boundary list knows - a name that is not is either a neighbourhood
    // mislabelled as a district or a spelling the canonicaliser missed.
    const unknown = new Map<string, number>();
    for (const place of allPlaces()) {
      if (!place.district) continue;
      if (!officialDistrict(place.district)) {
        unknown.set(place.district, (unknown.get(place.district) ?? 0) + 1);
      }
    }
    // Reported with counts so a regression names the offenders instead of
    // just failing a number.
    expect([...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)).toEqual([]);
  });

  it("keeps every place inside Türkiye and attributed", () => {
    for (const place of allPlaces()) {
      expect(place.lat).toBeGreaterThan(35.5);
      expect(place.lat).toBeLessThan(42.5);
      expect(place.lon).toBeGreaterThan(25.5);
      expect(place.lon).toBeLessThan(45);
      expect(place.source.license).toBeTruthy();
    }
  });
});
