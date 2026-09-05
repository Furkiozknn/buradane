import { describe, expect, it } from "vitest";

import {
  PROVINCES,
  TOTALS,
  findProvince,
  provinceByCode,
  resolveDistrict,
} from "@/lib/administrative";

/**
 * Türkiye has 81 il and 973 ilçe. These lock the parts of that the app
 * depends on: that the province table is complete and internally consistent,
 * and that a raw `addr:district` tag can be grouped on without splitting one
 * district across four spellings.
 */

describe("provinces", () => {
  it("has all 81, numbered 1..81 with no gaps or duplicates", () => {
    expect(PROVINCES).toHaveLength(TOTALS.provinces);
    const codes = PROVINCES.map((p) => p.code).sort((a, b) => a - b);
    expect(codes).toEqual(Array.from({ length: 81 }, (_, i) => i + 1));
    expect(new Set(PROVINCES.map((p) => p.name)).size).toBe(81);
  });

  it("marks exactly 30 as büyükşehir", () => {
    // 81 - 30 = 51, which is the count of provinces holding a single merkez
    // ilçe, and the reason 973 - 51 = 922 districts have a kaymakamlık.
    expect(PROVINCES.filter((p) => p.metropolitan)).toHaveLength(TOTALS.metropolitanProvinces);
    expect(PROVINCES.filter((p) => !p.metropolitan)).toHaveLength(51);
  });

  it("keeps the district totals internally consistent", () => {
    const nonMetropolitan = TOTALS.districts - TOTALS.metropolitanDistricts;
    expect(nonMetropolitan).toBe(454);
    // Every non-büyükşehir province has exactly one merkez ilçe, and those
    // are the districts without a separate kaymakam.
    expect(TOTALS.districts - 51).toBe(922);
  });

  it("resolves a province regardless of casing or missing diacritics", () => {
    // "I" lowercases to "i" by default, not to the dotless "ı" - the single
    // most common source of "the data is there but nothing matches".
    expect(findProvince("İSTANBUL")?.code).toBe(34);
    expect(findProvince("istanbul")?.code).toBe(34);
    expect(findProvince("Kahramanmaraş")?.code).toBe(46);
    expect(findProvince("kahramanmaras")?.code).toBe(46);
    expect(findProvince("ŞANLIURFA")?.code).toBe(63);
  });

  it("understands the names people actually use", () => {
    expect(findProvince("Antep")?.name).toBe("Gaziantep");
    expect(findProvince("Urfa")?.name).toBe("Şanlıurfa");
    expect(findProvince("Afyon")?.name).toBe("Afyonkarahisar");
    // Mersin's pre-2002 name, still in older records.
    expect(findProvince("İçel")?.name).toBe("Mersin");
  });

  it("returns null rather than guessing", () => {
    // A wrong province is worse than none: it moves a place across the country.
    expect(findProvince("Selanik")).toBeNull();
    expect(findProvince("")).toBeNull();
    expect(findProvince(null)).toBeNull();
    expect(provinceByCode(82)).toBeNull();
  });
});

describe("districts", () => {
  it("collapses casing and diacritic variants onto one key", () => {
    // These four spellings of Kadıköy all appear in the İstanbul snapshot.
    const keys = ["Kadıköy", "kadıköy", "Kadikoy", "Kadiköy"].map((v) => resolveDistrict(v)!.key);
    expect(new Set(keys).size).toBe(1);
    expect(resolveDistrict("Bakirköy")!.key).toBe(resolveDistrict("Bakırköy")!.key);
  });

  it("applies the 2018 Eyüp rename in both spellings", () => {
    expect(resolveDistrict("Eyüp")!.name).toBe("Eyüpsultan");
    expect(resolveDistrict("Eyüp Sultan")!.name).toBe("Eyüpsultan");
  });

  it("fixes the observed typo", () => {
    expect(resolveDistrict("Küçükçemece")!.name).toBe("Küçükçekmece");
  });

  it("maps neighbourhoods tagged as districts to their parent", () => {
    // Karaköy is in Beyoğlu and Alibeyköy in Eyüpsultan; left raw they would
    // appear as two İstanbul districts that do not exist.
    expect(resolveDistrict("Karaköy")!.name).toBe("Beyoğlu");
    expect(resolveDistrict("Alibeyköy")!.name).toBe("Eyüpsultan");
  });

  it("title-cases in Turkish, not in ASCII", () => {
    // A locale-naive uppercase turns "kadıköy" into "Kadikoy".
    expect(resolveDistrict("kadıköy")!.name).toBe("Kadıköy");
    expect(resolveDistrict("şile")!.name).toBe("Şile");
  });

  it("passes through an unknown value instead of dropping or promoting it", () => {
    // Never invents a district. An unrecognised value still groups
    // consistently so it can be audited later.
    const unknown = resolveDistrict("Bilinmeyen Yer");
    expect(unknown).not.toBeNull();
    expect(unknown!.province).toBeNull();
    expect(resolveDistrict("  ")).toBeNull();
    expect(resolveDistrict(null)).toBeNull();
  });
});
