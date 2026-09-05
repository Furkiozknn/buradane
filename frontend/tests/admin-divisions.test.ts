import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { divisionCounts, officialDistrict, officialProvinces } from "@/lib/admin-divisions";
import { findProvince } from "@/lib/administrative";

/**
 * Validates the OSM-fetched administrative reference against the official
 * facts: Türkiye has 81 il and 973 ilçe. These run only once the data file
 * exists - the graceful-absence path (heuristics stand in) is what every
 * other suite exercises before the first fetch.
 *
 * A count mismatch here is information, not noise: either OSM's boundaries
 * disagree with the official register (worth investigating upstream) or
 * the fetch dropped something (worth investigating here). Neither should be
 * normalised away silently.
 */

const DATA_FILE = path.join(process.cwd(), "data", "admin-divisions.json");
const hasData = fs.existsSync(DATA_FILE);

describe.skipIf(!hasData)("official administrative divisions", () => {
  it("has exactly 81 provinces", () => {
    expect(divisionCounts()?.provinces).toBe(81);
    expect(officialProvinces()).toHaveLength(81);
  });

  it("has the official district count", () => {
    expect(divisionCounts()?.districts).toBe(973);
  });

  it("agrees with the hardcoded province table, name by name", () => {
    // Two independent sources of the same 81 names: the plate-code table
    // written from knowledge, and OSM's boundary relations. Disagreement
    // means one of them spells a province wrong - worth failing loudly.
    for (const province of officialProvinces()) {
      expect(findProvince(province.name), `OSM ili tabloda yok: ${province.name}`).not.toBeNull();
    }
  });

  it("places every province centre inside Türkiye", () => {
    for (const province of officialProvinces()) {
      expect(province.center.lat).toBeGreaterThan(35.5);
      expect(province.center.lat).toBeLessThan(42.5);
      expect(province.center.lon).toBeGreaterThan(25.5);
      expect(province.center.lon).toBeLessThan(45);
    }
  });

  it("resolves a well-known district with its province", () => {
    const kadikoy = officialDistrict("Kadıköy");
    expect(kadikoy?.name).toBe("Kadıköy");
    expect(kadikoy?.province).toBe("İstanbul");
    // Diacritic-free input resolves to the same canonical record.
    expect(officialDistrict("kadikoy")?.name).toBe("Kadıköy");
  });

  it("never guesses the province of an ambiguous district name", () => {
    // Dozens of provinces have a merkez ilçe named after themselves or
    // literally "Merkez"; a bare name cannot say which one is meant.
    const merkez = officialDistrict("Merkez");
    if (merkez) expect(merkez.province).toBe("");
  });
});
