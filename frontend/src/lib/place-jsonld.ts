import type { CategorySlug, Place } from "./types";
import { siteUrl } from "./site-url";

/**
 * schema.org JSON-LD for a place page.
 *
 * The 167k `/yer` pages are the whole organic-search surface of this site,
 * and none of them carried structured data. For a directory of physical
 * places that is the single biggest on-page lever there is: it is what lets
 * a result show as a place - with its district, whether it is free, whether
 * it is step-free - instead of a blue link.
 *
 * Two rules held throughout:
 *
 * 1. **Only real schema.org types.** Invented ones (`PublicToilet`) are
 *    ignored by consumers at best. Where no accurate type exists the entry
 *    stays `Place` and the specific kind is carried in `additionalType` as
 *    the OSM category, which is true and machine-readable.
 * 2. **Only fields we actually have.** An absent phone is omitted, not
 *    emitted empty. `opening_hours_raw` is OSM syntax ("Mo-Fr 08:00-17:00;
 *    PH off") and is NOT schema.org's format, so it is deliberately not
 *    mapped - publishing it in the wrong grammar is worse than publishing
 *    nothing, because a consumer that parses it gets confident wrong hours.
 *    Only `is_24h`, which is unambiguous, becomes an
 *    `openingHoursSpecification`.
 */

/** Categories with a genuine schema.org type. Everything else stays `Place`. */
const SCHEMA_TYPE: Partial<Record<CategorySlug, string>> = {
  eczane: "Pharmacy",
  cami: "Mosque",
  park: "Park",
  kutuphane: "Library",
  otopark: "ParkingFacility",
};

/** Amenities worth publishing, with the wording a consumer will show. */
const AMENITY_LABEL: Record<string, string> = {
  wheelchair_accessible: "Tekerlekli sandalye erişimi",
  has_ramp: "Rampa",
  baby_changing: "Bebek bakım alanı",
  child_friendly: "Çocuk dostu",
  pet_friendly: "Evcil hayvan dostu",
  has_drinking_water: "İçme suyu",
  has_wifi: "Wi-Fi",
  has_shower: "Duş",
  has_seating: "Oturma alanı",
  has_shade: "Gölge",
  has_parking: "Otopark",
  is_quiet: "Sessiz",
};

export function placeJsonLd(place: Place): Record<string, unknown> {
  const taban = siteUrl();
  const url = `${taban}/yer/${encodeURIComponent(place.id)}`;

  const tip = place.categories.map((c) => SCHEMA_TYPE[c]).find(Boolean) ?? "Place";

  const veri: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": tip,
    name: place.name,
    url,
    geo: {
      "@type": "GeoCoordinates",
      latitude: place.lat,
      longitude: place.lon,
    },
  };

  // Tip "Place"e dustuyse, gercek kategoriyi yine de makine okunur birak.
  if (tip === "Place" && place.categories.length > 0) {
    veri.additionalType = place.categories.map(
      (c) => `https://wiki.openstreetmap.org/wiki/Tr:Key:amenity#${c}`,
    );
  }

  const adres: Record<string, unknown> = {
    "@type": "PostalAddress",
    addressCountry: "TR",
  };
  if (place.address_line) adres.streetAddress = place.address_line;
  if (place.district) adres.addressLocality = place.district;
  if (place.province) adres.addressRegion = place.province;
  // Ulke disinda bir sey yoksa adres eklemenin bilgi degeri yok.
  if (Object.keys(adres).length > 2) veri.address = adres;

  if (place.description) veri.description = place.description;
  if (place.phone) veri.telephone = place.phone;
  if (place.website) veri.sameAs = [place.website];
  if (place.operator) {
    veri.provider = { "@type": "Organization", name: place.operator };
  }

  if (place.price_type === "free") veri.isAccessibleForFree = true;
  if (place.access === "public") veri.publicAccess = true;

  if (place.is_24h === true) {
    veri.openingHoursSpecification = {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [
        "Monday", "Tuesday", "Wednesday", "Thursday",
        "Friday", "Saturday", "Sunday",
      ],
      opens: "00:00",
      closes: "23:59",
    };
  }

  const olanaklar = Object.entries(place.amenities)
    .filter(([anahtar, deger]) => deger === true && AMENITY_LABEL[anahtar])
    .map(([anahtar]) => ({
      "@type": "LocationFeatureSpecification",
      name: AMENITY_LABEL[anahtar],
      value: true,
    }));
  if (olanaklar.length > 0) veri.amenityFeature = olanaklar;

  // Kaynak atfi: ODbL zaten gerektiriyor, ayrica OSM kaydini dogrulanabilir
  // kiliyor. Varsa website ile birlestir.
  if (place.source?.url) {
    const mevcut = Array.isArray(veri.sameAs) ? (veri.sameAs as string[]) : [];
    veri.sameAs = [...mevcut, place.source.url];
  }

  return veri;
}

/**
 * Serialises for embedding in a `<script>` element.
 *
 * `JSON.stringify` alone is NOT safe here: place names come from OSM, which
 * anyone can edit, and a name containing `</script>` would end the element
 * and turn the rest into markup. Escaping `<`, `>` and `&` as unicode
 * sequences keeps the JSON byte-identical to a parser while making that
 * breakout impossible. `U+2028`/`U+2029` are escaped too - legal in JSON,
 * fatal inside a script element.
 */
export function jsonLdToScript(veri: Record<string, unknown>): string {
  return JSON.stringify(veri)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * The per-request CSP nonce, pulled back out of the header `proxy.ts` set.
 *
 * `script-src` is `'self' 'nonce-...'`, so an inline JSON-LD block without
 * the nonce is dropped by the browser - the page would look fine and the
 * structured data would silently never exist, which is the exact failure
 * this change is meant to avoid.
 */
export function nonceFromCsp(csp: string | null | undefined): string | undefined {
  if (!csp) return undefined;
  return /'nonce-([^']+)'/.exec(csp)?.[1];
}