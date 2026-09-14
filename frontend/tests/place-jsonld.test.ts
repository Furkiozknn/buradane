import { beforeEach, describe, expect, it } from "vitest";

import { jsonLdToScript, nonceFromCsp, placeJsonLd } from "@/lib/place-jsonld";
import type { Place } from "@/lib/types";

function yer(ustunden: Partial<Place> = {}): Place {
  return {
    id: "node/123",
    name: "Test Parkı",
    lat: 41.0082,
    lon: 28.9784,
    categories: ["park"],
    status: "active",
    price_type: "free",
    access: "public",
    address_line: null,
    district: "Fatih",
    province: "İstanbul",
    opening_hours_raw: null,
    is_24h: null,
    website: null,
    phone: null,
    description: null,
    operator: null,
    amenities: {
      wheelchair_accessible: null,
      has_ramp: null,
      baby_changing: null,
      child_friendly: null,
      pet_friendly: null,
      has_drinking_water: null,
      has_wifi: null,
      has_shower: null,
      has_seating: null,
      has_shade: null,
      has_parking: null,
      is_quiet: null,
    },
    source: {
      slug: "osm",
      name: "OpenStreetMap",
      license: "ODbL 1.0",
      url: "https://www.openstreetmap.org/node/123",
    },
    reliability_score: 0.5,
    freshness_label: "",
    last_verified_at: null,
    verification_count: 0,
    report_count: 0,
    ...ustunden,
  } as Place;
}

beforeEach(() => {
  process.env.BURADANE_SITE_URL = "https://buradane.test";
});

describe("placeJsonLd", () => {
  it("emits coordinates and a canonical url", () => {
    const d = placeJsonLd(yer());
    expect(d["@context"]).toBe("https://schema.org");
    expect(d.url).toBe("https://buradane.test/yer/node%2F123");
    expect(d.geo).toMatchObject({ latitude: 41.0082, longitude: 28.9784 });
  });

  it("uses a real schema.org type where one exists", () => {
    expect(placeJsonLd(yer({ categories: ["eczane"] }))["@type"]).toBe("Pharmacy");
    expect(placeJsonLd(yer({ categories: ["cami"] }))["@type"]).toBe("Mosque");
    expect(placeJsonLd(yer({ categories: ["park"] }))["@type"]).toBe("Park");
  });

  it("falls back to Place and keeps the real category machine-readable", () => {
    // Uydurma bir tip ("PublicToilet") tuketici tarafindan yok sayilir.
    const d = placeJsonLd(yer({ categories: ["tuvalet"] }));
    expect(d["@type"]).toBe("Place");
    expect(JSON.stringify(d.additionalType)).toContain("tuvalet");
  });

  it("omits fields it does not have instead of emitting empty ones", () => {
    const d = placeJsonLd(yer());
    expect(d).not.toHaveProperty("telephone");
    expect(d).not.toHaveProperty("description");
    expect(d).not.toHaveProperty("amenityFeature");
  });

  it("never maps raw OSM opening hours", () => {
    // "Mo-Fr 08:00-17:00" schema.org grameri DEGIL. Yanlis gramerde
    // yayinlamak, hic yayinlamamaktan kotu: tuketici emin ve yanlis olur.
    const d = placeJsonLd(yer({ opening_hours_raw: "Mo-Fr 08:00-17:00; PH off" }));
    expect(JSON.stringify(d)).not.toContain("Mo-Fr");
    expect(d).not.toHaveProperty("openingHoursSpecification");
  });

  it("maps only the unambiguous 24h case", () => {
    const d = placeJsonLd(yer({ is_24h: true }));
    expect(d.openingHoursSpecification).toMatchObject({ opens: "00:00", closes: "23:59" });
  });

  it("publishes true amenities only", () => {
    const d = placeJsonLd(
      yer({ amenities: { ...yer().amenities, wheelchair_accessible: true, has_wifi: false } }),
    );
    const adlar = (d.amenityFeature as { name: string }[]).map((a) => a.name);
    expect(adlar).toContain("Tekerlekli sandalye erişimi");
    expect(adlar).not.toContain("Wi-Fi");
  });

  it("always attributes the OSM source", () => {
    expect(placeJsonLd(yer()).sameAs).toContain("https://www.openstreetmap.org/node/123");
  });
});

describe("jsonLdToScript", () => {
  it("cannot be broken out of with a crafted place name", () => {
    // Isimler OSM'den geliyor ve herkes duzenleyebiliyor.
    const kotu = yer({ name: '</script><img src=x onerror=alert(1)>' });
    const cikti = jsonLdToScript(placeJsonLd(kotu));
    expect(cikti).not.toContain("</script>");
    expect(cikti).not.toContain("<img");
    expect(cikti).toContain("\\u003c");
    // Yine de gecerli JSON ve isim korunmus olmali.
    expect(JSON.parse(cikti).name).toBe('</script><img src=x onerror=alert(1)>');
  });

  it("escapes line separators that are legal JSON but fatal in a script", () => {
    const cikti = jsonLdToScript(placeJsonLd(yer({ name: "a\u2028b" })));
    expect(cikti).toContain("\\u2028");
    expect(JSON.parse(cikti).name).toBe("a\u2028b");
  });
});

describe("nonceFromCsp", () => {
  it("pulls the nonce back out of the policy proxy.ts set", () => {
    expect(nonceFromCsp("script-src 'self' 'nonce-abc123=='; style-src 'self'")).toBe("abc123==");
  });

  it("returns undefined rather than a wrong value when absent", () => {
    // Yanlis nonce, nonce yoklugundan kotu: tarayici script'i sessizce duser.
    expect(nonceFromCsp("script-src 'self'")).toBeUndefined();
    expect(nonceFromCsp(null)).toBeUndefined();
    expect(nonceFromCsp("")).toBeUndefined();
  });
});