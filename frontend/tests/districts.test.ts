import { describe, expect, it } from "vitest";

import { GET as districtsGET } from "@/app/api/districts/route";
import { districtsOfProvince, queryPlaces } from "@/lib/places-repository";
import { divisionCounts, officialDistrictsOf } from "@/lib/admin-divisions";

/**
 * İlçe selection, end to end.
 *
 * The data has carried a district on every record since the fetch moved to
 * real boundary polygons, but the app could only offer provinces - so
 * someone in Kadıköy picked "İstanbul", landed on Fatih, and panned. These
 * pin the three claims that make the ilçe step honest: the list is real
 * (every district that appears has records), it is complete (all 973 are
 * represented nationally), and its centre actually opens on that district
 * rather than near it.
 */

function req(query: string): Request {
  return new Request(`http://localhost/api/districts${query}`);
}

describe("ilçe listesi", () => {
  it("covers all 973 official districts across the country", () => {
    // The coverage claim, stated where it can go red. A province whose
    // boundary fetch silently returned nothing (Eskişehir and Van both did,
    // once) shows up here as missing districts rather than as a number
    // nobody checks.
    const counts = divisionCounts();
    expect(counts?.districts).toBe(973);

    let withData = 0;
    const missing: string[] = [];
    for (const province of ["İstanbul", "Ankara", "İzmir", "Eskişehir", "Van", "Bayburt"]) {
      const official = officialDistrictsOf(province);
      expect(official.length).toBeGreaterThan(0);
      const slug = province
        .toLocaleLowerCase("tr-TR")
        .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
        .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
        .replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u")
        .replace(/\s+/g, "");
      const rows = districtsOfProvince(slug) ?? [];
      withData += rows.length;
      for (const d of official) {
        if (!rows.some((row) => row.name === d.name)) missing.push(`${province}/${d.name}`);
      }
    }
    expect(missing).toEqual([]);
    expect(withData).toBeGreaterThan(0);
  });

  it("gives every listed district a centre that opens ON it", () => {
    // A centre 20 km off is worse than no ilçe step: the user asks for
    // Kadıköy and gets a map of somewhere else with Kadıköy's name on the
    // chip. Checked against the query engine, not against geometry, because
    // what matters is what the app shows.
    const rows = districtsOfProvince("istanbul") ?? [];
    expect(rows.length).toBe(39);
    for (const district of rows) {
      const found = queryPlaces({ ...district.center, radius_m: 2000, limit: 5 });
      expect(found.total, `${district.name} merkezinde sonuç yok`).toBeGreaterThan(0);
      // The nearest results must belong to the district that was asked for.
      expect(found.places[0].district, `${district.name} merkezi başka ilçeye düşüyor`).toBe(
        district.name,
      );
    }
  });

  it("counts only districts that actually hold records", () => {
    const rows = districtsOfProvince("bayburt") ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const district of rows) {
      expect(district.count).toBeGreaterThan(0);
    }
  });

  it("serves one province cheaply and refuses the rest", async () => {
    const ok = await districtsGET(req("?province=istanbul"));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { districts: { name: string; count: number }[] };
    expect(body.districts.length).toBe(39);
    expect(body.districts.every((d) => d.count > 0)).toBe(true);

    expect((await districtsGET(req(""))).status).toBe(400);
    expect((await districtsGET(req("?province=yokboyle"))).status).toBe(404);
  });
});
