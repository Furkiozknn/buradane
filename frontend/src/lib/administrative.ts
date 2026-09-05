/**
 * Türkiye's administrative divisions: 81 il, 973 ilçe.
 *
 * Why this exists as a table rather than being read off the data:
 *
 * 1. **Coverage has to be stated honestly.** The app is for Türkiye and
 *    currently holds a handful of provinces. "6 il" means nothing without
 *    "of 81", and a roadmap that cannot say how far along it is invites the
 *    reader to assume the worst or the best, both wrong.
 *
 * 2. **The raw OSM tags cannot be grouped on directly.** İstanbul has 39
 *    ilçe; the snapshot carries 48 distinct `addr:district` values. Six are
 *    casing or diacritic variants of a district already in the list
 *    (kadıköy / Kadikoy / Kadiköy / Bakirköy / küçükçekmece / sarıyer), one
 *    is a typo (Küçükçemece), two are the 2018 rename of Eyüp to Eyüpsultan
 *    in both its spaced and unspaced forms, and two are neighbourhoods
 *    mislabelled as districts (Karaköy is in Beyoğlu, Alibeyköy in
 *    Eyüpsultan). Grouping on the raw string splits one district four ways
 *    and invents two that do not exist.
 *
 * 3. **Province type changes who runs the facility.** In a büyükşehir the
 *    ilçe belediyesi operates most parks and toilets; in the other 51
 *    provinces it is the il belediyesi. That decides what `operator` means
 *    and, eventually, where a report should be directed.
 *
 * The 81 provinces are hardcoded because they are small, stable and
 * verifiable by plate code. The 973 districts deliberately are NOT: writing
 * them from memory would produce a list nobody can check, so they come from
 * OSM `admin_level=6` boundaries via scripts/fetch_admin_divisions.py, and
 * the fetched count is compared against 973 so a shortfall is visible rather
 * than silent.
 */

export interface Province {
  /** Plate code, 1-81. The identifier every Turkish system already agrees on. */
  code: number;
  name: string;
  /** One of the 30 büyükşehir. Decides which tier of local government runs
   * public facilities, and therefore how many ilçe the province has. */
  metropolitan: boolean;
}

/**
 * All 81 provinces, ordered by plate code.
 *
 * The 30 marked `metropolitan` hold 519 of the 973 districts between them
 * (about 17 each); the remaining 51 provinces hold 454 (about 9 each), one
 * of which is always the merkez ilçe. That asymmetry is why a single
 * province-wide bounding box is the wrong fetch unit for the large ones.
 */
export const PROVINCES: Province[] = [
  { code: 1, name: "Adana", metropolitan: true },
  { code: 2, name: "Adıyaman", metropolitan: false },
  { code: 3, name: "Afyonkarahisar", metropolitan: false },
  { code: 4, name: "Ağrı", metropolitan: false },
  { code: 5, name: "Amasya", metropolitan: false },
  { code: 6, name: "Ankara", metropolitan: true },
  { code: 7, name: "Antalya", metropolitan: true },
  { code: 8, name: "Artvin", metropolitan: false },
  { code: 9, name: "Aydın", metropolitan: true },
  { code: 10, name: "Balıkesir", metropolitan: true },
  { code: 11, name: "Bilecik", metropolitan: false },
  { code: 12, name: "Bingöl", metropolitan: false },
  { code: 13, name: "Bitlis", metropolitan: false },
  { code: 14, name: "Bolu", metropolitan: false },
  { code: 15, name: "Burdur", metropolitan: false },
  { code: 16, name: "Bursa", metropolitan: true },
  { code: 17, name: "Çanakkale", metropolitan: false },
  { code: 18, name: "Çankırı", metropolitan: false },
  { code: 19, name: "Çorum", metropolitan: false },
  { code: 20, name: "Denizli", metropolitan: true },
  { code: 21, name: "Diyarbakır", metropolitan: true },
  { code: 22, name: "Edirne", metropolitan: false },
  { code: 23, name: "Elazığ", metropolitan: false },
  { code: 24, name: "Erzincan", metropolitan: false },
  { code: 25, name: "Erzurum", metropolitan: true },
  { code: 26, name: "Eskişehir", metropolitan: true },
  { code: 27, name: "Gaziantep", metropolitan: true },
  { code: 28, name: "Giresun", metropolitan: false },
  { code: 29, name: "Gümüşhane", metropolitan: false },
  { code: 30, name: "Hakkâri", metropolitan: false },
  { code: 31, name: "Hatay", metropolitan: true },
  { code: 32, name: "Isparta", metropolitan: false },
  { code: 33, name: "Mersin", metropolitan: true },
  { code: 34, name: "İstanbul", metropolitan: true },
  { code: 35, name: "İzmir", metropolitan: true },
  { code: 36, name: "Kars", metropolitan: false },
  { code: 37, name: "Kastamonu", metropolitan: false },
  { code: 38, name: "Kayseri", metropolitan: true },
  { code: 39, name: "Kırklareli", metropolitan: false },
  { code: 40, name: "Kırşehir", metropolitan: false },
  { code: 41, name: "Kocaeli", metropolitan: true },
  { code: 42, name: "Konya", metropolitan: true },
  { code: 43, name: "Kütahya", metropolitan: false },
  { code: 44, name: "Malatya", metropolitan: true },
  { code: 45, name: "Manisa", metropolitan: true },
  { code: 46, name: "Kahramanmaraş", metropolitan: true },
  { code: 47, name: "Mardin", metropolitan: true },
  { code: 48, name: "Muğla", metropolitan: true },
  { code: 49, name: "Muş", metropolitan: false },
  { code: 50, name: "Nevşehir", metropolitan: false },
  { code: 51, name: "Niğde", metropolitan: false },
  { code: 52, name: "Ordu", metropolitan: true },
  { code: 53, name: "Rize", metropolitan: false },
  { code: 54, name: "Sakarya", metropolitan: true },
  { code: 55, name: "Samsun", metropolitan: true },
  { code: 56, name: "Siirt", metropolitan: false },
  { code: 57, name: "Sinop", metropolitan: false },
  { code: 58, name: "Sivas", metropolitan: false },
  { code: 59, name: "Tekirdağ", metropolitan: true },
  { code: 60, name: "Tokat", metropolitan: false },
  { code: 61, name: "Trabzon", metropolitan: true },
  { code: 62, name: "Tunceli", metropolitan: false },
  { code: 63, name: "Şanlıurfa", metropolitan: true },
  { code: 64, name: "Uşak", metropolitan: false },
  { code: 65, name: "Van", metropolitan: true },
  { code: 66, name: "Yozgat", metropolitan: false },
  { code: 67, name: "Zonguldak", metropolitan: false },
  { code: 68, name: "Aksaray", metropolitan: false },
  { code: 69, name: "Bayburt", metropolitan: false },
  { code: 70, name: "Karaman", metropolitan: false },
  { code: 71, name: "Kırıkkale", metropolitan: false },
  { code: 72, name: "Batman", metropolitan: false },
  { code: 73, name: "Şırnak", metropolitan: false },
  { code: 74, name: "Bartın", metropolitan: false },
  { code: 75, name: "Ardahan", metropolitan: false },
  { code: 76, name: "Iğdır", metropolitan: false },
  { code: 77, name: "Yalova", metropolitan: false },
  { code: 78, name: "Karabük", metropolitan: false },
  { code: 79, name: "Kilis", metropolitan: false },
  { code: 80, name: "Osmaniye", metropolitan: false },
  { code: 81, name: "Düzce", metropolitan: false },
];

/** The official totals, so coverage can be stated as a fraction rather than
 * as a bare number that means nothing on its own. */
export const TOTALS = {
  provinces: 81,
  districts: 973,
  metropolitanProvinces: 30,
  /** Districts inside the 30 büyükşehir. */
  metropolitanDistricts: 519,
} as const;

/**
 * Locale-correct casefolding.
 *
 * The default `toLowerCase` maps "I" to "i" rather than the dotless "ı", so
 * "KADIKÖY" never matches "Kadıköy". Same normalizer the query engine uses -
 * this is the single most common source of "the data is there but nothing
 * matches" in a Turkish dataset.
 */
function foldTr(value: string): string {
  return value.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr-TR").trim();
}

/** Strips diacritics too, for matching text typed without a Turkish keyboard. */
function foldAscii(value: string): string {
  return foldTr(value)
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .replace(/[^a-z0-9]+/g, "");
}

const PROVINCE_INDEX = new Map<string, Province>();
for (const province of PROVINCES) {
  PROVINCE_INDEX.set(foldAscii(province.name), province);
}
// Forms people actually type or that appear in OSM tags.
const PROVINCE_ALIASES: Record<string, string> = {
  icel: "Mersin", // Mersin's pre-2002 name, still in older records
  afyon: "Afyonkarahisar",
  urfa: "Şanlıurfa",
  maras: "Kahramanmaraş",
  antep: "Gaziantep",
  hakkari: "Hakkâri",
  istanbulili: "İstanbul",
};
for (const [alias, target] of Object.entries(PROVINCE_ALIASES)) {
  const province = PROVINCES.find((p) => p.name === target);
  if (province) PROVINCE_INDEX.set(alias, province);
}

/**
 * Resolves free text to a province, tolerating casing, missing diacritics and
 * the handful of names that changed or are habitually shortened.
 *
 * Returns null rather than guessing: a wrong province is worse than none,
 * because it would silently move a place across the country.
 */
export function findProvince(input: string | null | undefined): Province | null {
  if (!input) return null;
  return PROVINCE_INDEX.get(foldAscii(input)) ?? null;
}

export function provinceByCode(code: number): Province | null {
  return PROVINCES.find((p) => p.code === code) ?? null;
}

/* ------------------------------------------------------------------ *
 * İlçe (district)
 * ------------------------------------------------------------------ */

/**
 * Corrections for `addr:district` values observed in the snapshot that are
 * not district names.
 *
 * Every entry here is a value that actually appears in the data, not a
 * hypothetical. Casing and diacritic variants are handled by folding and are
 * deliberately NOT listed - enumerating them would be endless, and the whole
 * point of `foldAscii` is that "kadıköy", "Kadikoy" and "Kadiköy" collapse to
 * one key on their own.
 *
 * What folding cannot fix, and so is listed:
 *   - a rename: Eyüp became Eyüpsultan in 2018, and appears spaced as well
 *   - a typo that folds to its own distinct key
 *   - neighbourhoods tagged as though they were districts
 */
const DISTRICT_FIXES: Record<string, { district: string; province: string }> = {
  // Renamed in 2018; both the old name and a spaced spelling are in the data.
  eyup: { district: "Eyüpsultan", province: "İstanbul" },
  eyupsultan: { district: "Eyüpsultan", province: "İstanbul" },
  // "Küçükçemece" - a dropped k.
  kucukcemece: { district: "Küçükçekmece", province: "İstanbul" },
  // Neighbourhoods, not districts. Mapping them to their parent is more
  // useful than dropping them: the place is real and its district is knowable.
  karakoy: { district: "Beyoğlu", province: "İstanbul" },
  alibeykoy: { district: "Eyüpsultan", province: "İstanbul" },
};

export interface DistrictRef {
  /** Canonical display name. */
  name: string;
  /** Province it belongs to, when known. */
  province: string | null;
  /** Stable key for grouping - folded, diacritic-free. */
  key: string;
}

/**
 * Turns a raw `addr:district` tag into something safe to group and search on.
 *
 * Returns null for empty input. Never invents a district: a value it does not
 * recognise is returned as-is under its folded key, so it can still be
 * grouped consistently and audited later, rather than being silently dropped
 * or silently promoted to an official name.
 */
export function resolveDistrict(raw: string | null | undefined): DistrictRef | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const key = foldAscii(trimmed);
  if (!key) return null;

  const fix = DISTRICT_FIXES[key];
  if (fix) return { name: fix.district, province: fix.province, key: foldAscii(fix.district) };

  // Title-case in Turkish, so "kadıköy" comes back as "Kadıköy" rather than
  // the "Kadikoy" that a locale-naive uppercase would produce.
  return { name: titleCaseTr(trimmed), province: null, key };
}

function titleCaseTr(value: string): string {
  return value
    .split(/\s+/)
    .map((word) =>
      word
        ? word.charAt(0).toLocaleUpperCase("tr-TR") + word.slice(1).toLocaleLowerCase("tr-TR")
        : word,
    )
    .join(" ");
}

/**
 * Pulls a province and district out of whatever ended up in an address tag.
 *
 * OSM's Turkish data routinely crams both into one field: `addr:city` holds
 * "Seyhan/Adana" or "Çankaya/Ankara" as often as it holds a plain province
 * name, and 405 of the 1,985 locality tags in the snapshot are in that form.
 * Reading the tag literally resolved none of them.
 *
 * Order matters: the province is the part that can be checked against a
 * closed list of 81, so it is identified first and whatever remains is
 * treated as the district. Doing it the other way round would let a district
 * that happens to share a province name (Ordu, Düzce and Yalova are all both)
 * swallow the wrong half.
 */
export function parseLocality(raw: string | null | undefined): {
  province: Province | null;
  district: DistrictRef | null;
} {
  if (!raw) return { province: null, district: null };

  const parts = raw
    .split(/[/,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return { province: null, district: null };

  // A single value: a province if it is one, otherwise a district.
  if (parts.length === 1) {
    const province = findProvince(parts[0]);
    if (province) return { province, district: null };
    return { province: null, district: resolveDistrict(parts[0]) };
  }

  // Compound: find the part that is a province, treat the rest as district.
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const province = findProvince(parts[i]);
    if (!province) continue;
    const rest = parts.filter((_, index) => index !== i);
    return { province, district: resolveDistrict(rest[0] ?? null) };
  }

  // "Mahalle/Sokak" and similar - no province anywhere in it.
  return { province: null, district: resolveDistrict(parts[0]) };
}

/** Exported for the district resolver and for tests; both need the exact
 * folding rules the province index was built with. */
export { foldAscii, foldTr };
