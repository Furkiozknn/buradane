import { describe, expect, it } from "vitest";

import { allPlaces, datasetMeta, queryPlaces } from "@/lib/places-repository";
import { PROVINCES, TOTALS, findProvince } from "@/lib/administrative";
import { divisionCounts, officialDistrict, officialDistrictsOf, officialProvinces } from "@/lib/admin-divisions";

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
    expect(datasetMeta().cities.length).toBe(81);
    const thin = datasetMeta()
      .cities.filter((c) => c.count < 20)
      .map((c) => `${c.label}: ${c.count}`);
    expect(thin).toEqual([]);
  });

  it("finds every province by typing its name", () => {
    // The single most common national query shape: province name alone.
    expect(datasetMeta().cities.length).toBe(81);
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
    // Same anchor: with every district null, `unknown` stays empty and the
    // assertion below passes without having checked anything.
    expect(allPlaces().filter((p) => p.district).length).toBeGreaterThan(1_000);
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

  it("loads one record per OSM id, whatever the files say", () => {
    // Overpass' `(area:...)` returns a way that CROSSES a boundary to BOTH
    // provinces' queries - a picnic area on the Batman/Diyarbakır border
    // came back in both files and the map drew two pins on one spot. The
    // loader keeps whichever copy landed inside a district (districts tile a
    // province exactly, so that copy is geometrically confirmed).
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const place of allPlaces()) {
      if (seen.has(place.id)) duplicates.push(place.id);
      seen.add(place.id);
    }
    expect(duplicates).toEqual([]);
  });

  it("gives real coverage inside each province, not just at its centre", () => {
    // THE regression test for the finding that mattered most: "81 il" once
    // meant 81 boxes of ~12x12 km around the provincial capitals - 2,2% of
    // the country - and every other check passed on it. A user standing in
    // Alanya (350.000 residents, 110 km from Antalya's centre) got nothing.
    //
    // Data-driven over the province's own official district centres, and
    // only for provinces already re-fetched from their real boundary, so
    // this gets strictly harder as the migration completes instead of
    // needing a hand-maintained list of cities to remember.
    const divisions = officialProvinces();
    expect(divisions.length).toBe(81);

    const boundaryProvinces = datasetMeta()
      .cities.filter((c) => c.fetchUnit === "province_boundary")
      .map((c) => c.label);
    expect(boundaryProvinces.length).toBeGreaterThan(0);

    const thin: string[] = [];
    for (const provinceName of boundaryProvinces) {
      for (const district of officialDistrictsOf(provinceName)) {
        const found = queryPlaces({
          lat: district.center.lat,
          lon: district.center.lon,
          radius_m: 15_000,
          limit: 1,
        });
        if (found.total === 0) thin.push(`${provinceName}/${district.name}`);
      }
    }
    // A handful of genuinely empty rural districts is believable; a
    // systematic hole is the bug this exists to catch.
    const districtCount = boundaryProvinces.reduce(
      (sum, name) => sum + officialDistrictsOf(name).length,
      0,
    );
    expect(thin.length / districtCount, `veri bulunamayan ilçeler: ${thin.join(", ")}`).toBeLessThan(
      0.1,
    );
  });

  it("answers the Alanya question", () => {
    // Named because it was the audit's headline failure: 0 results within
    // 25 km of a district of 350.000 people, while the app claimed full
    // national coverage.
    const alanya = queryPlaces({ lat: 36.5444, lon: 31.9957, radius_m: 5_000, limit: 5 });
    expect(alanya.total).toBeGreaterThan(50);
    for (const place of alanya.places) {
      expect(place.province).toBe("Antalya");
    }
  });

  it("keeps every place inside Türkiye and attributed", () => {
    // Anchored: a bare `for (const p of allPlaces())` executes zero
    // assertions and passes green if the dataset ever loads empty - which
    // is precisely the regression this file exists to catch.
    expect(allPlaces().length).toBeGreaterThan(40_000);
    for (const place of allPlaces()) {
      expect(place.lat).toBeGreaterThan(35.5);
      expect(place.lat).toBeLessThan(42.5);
      expect(place.lon).toBeGreaterThan(25.5);
      expect(place.lon).toBeLessThan(45);
      expect(place.source.license).toBeTruthy();
    }
  });
});
