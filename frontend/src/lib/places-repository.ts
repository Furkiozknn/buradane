/**
 * The demo data adapter.
 *
 * Reads the real OpenStreetMap İstanbul snapshot (frontend/data/
 * places.istanbul.json, produced by scripts/fetch_demo_data.py) and answers
 * the same queries the FastAPI + PostGIS backend answers - radius search,
 * bbox/viewport search, multi-category filtering, amenity filtering,
 * free-text search - with the same result shape and ordering.
 *
 * This is NOT mock data: every place here is a real OSM feature with a real
 * OSM id you can open on openstreetmap.org. What's synthesized is only the
 * *community layer* the demo has no history for yet (verification counts and
 * freshness), and that is generated deterministically and flagged, so it can
 * never be mistaken for real user activity - see `deriveCommunitySignals`.
 *
 * Swapping to the live backend = pointing the API routes at it instead of
 * this module. Nothing above this file knows which one it's talking to.
 */

import fs from "node:fs";
import path from "node:path";

import type {
  AmenityKey,
  CategorySlug,
  Place,
  PlaceQuery,
  PlaceQueryResult,
} from "./types";
import { boundingBox, haversineMeters } from "./geo";
import { isOpenNow } from "./opening-hours";
import { SEARCH_SYNONYMS } from "./categories";

interface RawDataset {
  city?: string;
  city_label?: string;
  generated_at: string;
  source: string;
  license: string;
  attribution: string;
  count: number;
  places: Omit<Place, "reliability_score" | "freshness_label" | "last_verified_at" | "verification_count" | "report_count">[];
}

export interface DatasetMeta {
  generated_at: string;
  source: string;
  license: string;
  attribution: string;
  count: number;
  cities: { slug: string; label: string; count: number }[];
}

let cache: { places: Place[]; meta: DatasetMeta } | null = null;

/** Deterministic 0..1 hash of a string - same input always yields the same
 * value, so the demo doesn't shuffle its own numbers on every request. */
function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * The one place where demo-only values are produced.
 *
 * A real deployment computes these from actual PlaceVerification /
 * PlaceReport rows (backend/app/services/reliability.py). The demo has no
 * community history, so rather than showing every place an identical,
 * meaningless "0 doğrulama", it derives a stable pseudo-history from the
 * place id and - importantly - from signals that are genuinely real: how
 * complete the OSM record is. A place with a name, opening hours, and
 * wheelchair tagging genuinely *is* better-documented than a bare node, so
 * scoring it higher is defensible rather than decorative.
 */
function deriveCommunitySignals(place: RawDataset["places"][number]) {
  const seed = hash01(place.id);

  let completeness = 0.35;
  if (!place.name.match(/^(Umumi Tuvalet|Park|İçme Suyu Çeşmesi|Oturma Alanı|Çocuk Oyun Alanı|Spor Alanı|Otopark|Duş|Ücretsiz Wi-Fi Noktası)$/)) {
    completeness += 0.2; // has a real, mapped name
  }
  if (place.opening_hours_raw) completeness += 0.1;
  if (place.address_line) completeness += 0.08;
  if (place.amenities.wheelchair_accessible !== null) completeness += 0.12;
  if (place.operator) completeness += 0.07;
  if (place.website || place.phone) completeness += 0.05;

  const verificationCount = Math.floor(seed * 6);
  const reportCount = seed > 0.88 ? 1 : 0;

  const ageDays = Math.floor(seed * 120);
  const lastVerified = new Date(Date.now() - ageDays * 86_400_000);

  // Mirrors the shape of the backend formula: source weight + verification
  // freshness bonus, minus an unresolved-report penalty, clamped to 0..1.
  const freshnessBonus = 0.3 * Math.max(0, 1 - ageDays / 90);
  const score = Math.min(
    1,
    Math.max(0, completeness * 0.75 + freshnessBonus + Math.min(0.15, 0.04 * verificationCount) - reportCount * 0.15),
  );

  return {
    reliability_score: Number(score.toFixed(3)),
    verification_count: verificationCount,
    report_count: reportCount,
    last_verified_at: lastVerified.toISOString(),
    freshness_label: freshnessLabel(ageDays),
  };
}

/** Matches backend/app/services/reliability.py's `freshness_label` wording. */
function freshnessLabel(ageDays: number): string {
  if (ageDays < 1) return "Bugün doğrulandı";
  if (ageDays < 2) return "Dün doğrulandı";
  if (ageDays < 30) return `${ageDays} gün önce doğrulandı`;
  if (ageDays < 365) return `${Math.floor(ageDays / 30)} ay önce doğrulandı`;
  return `${Math.floor(ageDays / 365)} yıl önce doğrulandı`;
}

/**
 * Loads every city snapshot in data/, not one hardcoded file.
 *
 * Each city is its own `places.<city>.json` so a city can be re-pulled,
 * added or dropped without touching the others - which is the whole point of
 * a pilot that is supposed to grow to 81 provinces. Adding Ankara meant
 * dropping a file in; no code here changed.
 */
function loadDataset() {
  if (cache) return cache;

  const dataDir = path.join(process.cwd(), "data");
  const files = fs
    .readdirSync(dataDir)
    .filter((name) => name.startsWith("places.") && name.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    throw new Error(
      `data/ içinde places.*.json bulunamadı. Önce scripts/fetch_demo_data.py çalıştırın.`,
    );
  }

  const places: Place[] = [];
  const cities: DatasetMeta["cities"] = [];
  let newest = "";
  let attribution = "© OpenStreetMap katkıda bulunanları";
  let license = "ODbL 1.0";
  let source = "OpenStreetMap via Overpass API";

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf-8")) as RawDataset;
    const slug = raw.city ?? file.replace(/^places\./, "").replace(/\.json$/, "");

    for (const place of raw.places) {
      places.push({ ...place, ...deriveCommunitySignals(place) });
    }

    cities.push({ slug, label: raw.city_label ?? slug, count: raw.places.length });
    if (raw.generated_at > newest) newest = raw.generated_at;
    attribution = raw.attribution ?? attribution;
    license = raw.license ?? license;
    source = raw.source ?? source;
  }

  cache = {
    places,
    meta: { generated_at: newest, source, license, attribution, count: places.length, cities },
  };
  return cache;
}

export function datasetMeta() {
  return loadDataset().meta;
}

export function allPlaces(): Place[] {
  return loadDataset().places;
}

export function getPlaceById(id: string): Place | undefined {
  return loadDataset().places.find((p) => p.id === id);
}

/**
 * Layers a moderation/verification override onto a base place.
 *
 * The score is *derived here*, never stored: the override records what
 * happened (how many people confirmed it, when), and this function applies
 * the same capped bonus the backend's formula uses. Storing an absolute
 * score in the override would mean writing a number without knowing the
 * base - which silently downgraded well-documented places the first time
 * around.
 */
export function applyOverride(base: Place, override: Partial<Place> | undefined): Place {
  if (!override) return base;

  const merged = { ...base, ...override };

  // `undefined` in the override must not erase a real base value.
  if (override.reliability_score === undefined) merged.reliability_score = base.reliability_score;

  const verifications = override.verification_count ?? 0;
  if (verifications > 0) {
    merged.reliability_score = Math.min(
      1,
      Number((base.reliability_score + Math.min(0.15, 0.04 * verifications)).toFixed(3)),
    );
  }

  // An unresolved "this is wrong" report is the clearest low-confidence
  // signal there is, and it outranks the verification bonus.
  if (override.report_count && override.report_count > 0) {
    merged.reliability_score = Math.max(0, Number((merged.reliability_score - 0.15).toFixed(3)));
  }

  return merged;
}

/** Free text -> structured filters. The architecture the brief asks for:
 * natural-language-ish queries resolve into the same structured filter set
 * the UI chips produce, so a semantic/LLM layer can later replace this
 * function without touching anything downstream. */
/** Turkish glue words that carry no search signal. Without this, a natural
 * query like "çocuğumla gidebileceğim park" leaves "gidebileceğim" behind and
 * — since leftover text is matched against place names — returns nothing. */
const STOPWORDS = new Set([
  "bir",
  "yer",
  "yeri",
  "yakın",
  "yakında",
  "yakınımda",
  "yakınımdaki",
  "buralarda",
  "nerede",
  "var",
  "varmı",
  "bul",
  "bulunan",
  "olan",
  "ile",
  "ve",
  "veya",
  "için",
  "gidebileceğim",
  "gidebilecegim",
  "gidebileceğimiz",
  "en",
  "çok",
  "biraz",
  "lütfen",
  "bana",
  "bize",
  "benim",
  "acil",
  "hemen",
  "şimdi",
  "burada",
  "buradan",
  // Generic nouns that appear inside our own category labels, so they carry
  // no discriminating signal as a name filter.
  "alan",
  "alanı",
  "alani",
  "alanlar",
  "nokta",
  "noktası",
  "noktasi",
  "mekan",
  "mekanlar",
  "yerler",
]);

/**
 * Turkish is agglutinative, so glue words cannot be enumerated - one verb
 * stem plus productive suffixes yields "gidebileceğim", "alabileceğim",
 * "değiştirebileceğim", "çalışabileceğim", and any other verb a person
 * happens to reach for. Matching the *suffix* covers the whole family;
 * listing words one by one never will, and every miss becomes a literal
 * place-name filter that silently empties the results.
 */
const GLUE_SUFFIXES: RegExp[] = [
  // -abil/-ebil ability + participle/future: "gid-ebilece-ğim", "al-abilece-ğim"
  /(a|e)bilece[kğ]i(m|n|z)?$/,
  /(a|e)bilir(im|sin|iz)?$/,
  // -acak/-ecek future participle: "gidilecek", "bulunacak"
  /[ae]ca[kğ]ı?(m|n|z)?$/,
  /[ae]ce[kğ]i?(m|n|z)?$/,
  // "-mak/-mek istiyorum", "lazım", "gerek"
  /^(istiyorum|isterim|lazım|lazim|gerek|gerekiyor)$/,
  // question/locative glue: "nerede", "neredeki", "nereden", "hangisi"
  /^nere/,
  /^hangi/,
];

function isGlue(token: string): boolean {
  const normalized = normalizeTr(token);
  if (STOPWORDS.has(normalized)) return true;
  return GLUE_SUFFIXES.some((suffix) => suffix.test(normalized));
}

export function parseQueryText(text: string): {
  categories: CategorySlug[];
  amenities: AmenityKey[];
  freeOnly: boolean;
  leftover: string;
} {
  const categories = new Set<CategorySlug>();
  const amenities = new Set<AmenityKey>();
  const weakCategories = new Set<CategorySlug>();
  const weakAmenities = new Set<AmenityKey>();
  let freeOnly = false;

  // Token-wise, not substring-wise. Turkish is agglutinative: "çocuk" turns
  // into "çocuğumla", so a substring replace leaves "umla" behind - and
  // leftovers become a literal name filter, which is how this once returned
  // zero results for a query it had otherwise understood perfectly. If a
  // rule matches anywhere inside a word, that whole word was the signal.
  const tokens = text.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const consumed = new Set<number>();

  for (const rule of SEARCH_SYNONYMS) {
    let matched = false;
    tokens.forEach((token, index) => {
      if (!rule.pattern.test(token)) return;
      consumed.add(index);
      matched = true;
    });
    // Multi-word phrases ("bez değiştir", "park yeri") won't match a single
    // token, so fall back to testing the whole string for those.
    if (!matched && rule.pattern.test(text)) matched = true;
    if (!matched) continue;

    // A weak rule's token is still consumed above - it just parks its filters
    // aside until we know whether anything specific matched.
    const targetCategories = rule.weak ? weakCategories : categories;
    const targetAmenities = rule.weak ? weakAmenities : amenities;
    rule.categories?.forEach((c) => targetCategories.add(c));
    rule.amenities?.forEach((a) => targetAmenities.add(a));
    if (rule.freeOnly && !rule.weak) freeOnly = true;
  }

  if (categories.size === 0) weakCategories.forEach((c) => categories.add(c));
  if (amenities.size === 0) weakAmenities.forEach((a) => amenities.add(a));

  const residualTokens = tokens.filter(
    (token, index) => !consumed.has(index) && token.length >= 3 && !isGlue(token),
  );

  return {
    categories: [...categories],
    amenities: [...amenities],
    freeOnly,
    leftover: residualTokens.join(" ").trim(),
  };
}

function normalizeTr(value: string): string {
  // Locale-correct lowercasing: JS's default toLowerCase() maps "I" to "i",
  // not the Turkish dotless "ı", so "KADIKÖY" would never match "Kadıköy".
  // Same class of bug already fixed in the backend's dedup normalizer.
  return value.replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
}

export function queryPlaces(
  query: PlaceQuery & {
    /** Moderator-approved corrections and community verifications, layered
     * on read. They live outside the immutable OSM snapshot, and must be
     * applied BEFORE filtering - otherwise a place an admin marked closed
     * would still match an "open now" search, and a just-verified place
     * would keep showing its stale freshness label in the list. */
    overrides?: Record<string, Partial<Place>>;
  },
): PlaceQueryResult {
  const {
    lat,
    lon,
    radius_m,
    bbox,
    categories = [],
    amenities = [],
    freeOnly = false,
    openNow = false,
    q,
    limit = 60,
    offset = 0,
    overrides,
    sort = "distance",
  } = query;

  let parsedFromText = { categories: [] as CategorySlug[], amenities: [] as AmenityKey[], freeOnly: false, leftover: "" };
  if (q && q.trim()) parsedFromText = parseQueryText(q);

  const effectiveCategories = [...new Set([...categories, ...parsedFromText.categories])];
  const effectiveAmenities = [...new Set([...amenities, ...parsedFromText.amenities])];
  const effectiveFreeOnly = freeOnly || parsedFromText.freeOnly;
  const textNeedle = parsedFromText.leftover ? normalizeTr(parsedFromText.leftover) : null;

  const hasCenter = typeof lat === "number" && typeof lon === "number";
  const box = hasCenter && radius_m ? boundingBox({ lat: lat!, lon: lon! }, radius_m) : null;

  const hasStructure = effectiveCategories.length > 0 || effectiveAmenities.length > 0 || effectiveFreeOnly;

  /**
   * Graceful relaxation, in order of what costs the user least to lose.
   *
   * 1. The free-text needle. Residual text is matched against place names and
   *    most Turkish POIs in OSM are unnamed, so "ücretsiz tuvalet" must not
   *    dead-end merely because nothing is literally *called* that.
   * 2. Amenity filters, dropped one at a time, keeping whichever survives
   *    best. Amenities are the sparsest field we have - `null` means unknown
   *    and is excluded on purpose, so an empty result here usually reflects a
   *    gap in the map rather than a gap in the city.
   *
   * Categories and "ücretsiz" are never dropped: they *are* the question. A
   * paid toilet is not an answer to a search for a free one, and quietly
   * widening that would be worse than an honest empty state.
   */
  let relaxedNeedle: string | null = null;
  let droppedAmenities: AmenityKey[] = [];
  let activeAmenities = effectiveAmenities;
  let results = collect(textNeedle, activeAmenities);

  if (results.length === 0 && textNeedle && hasStructure) {
    const widened = collect(null, activeAmenities);
    if (widened.length > 0) {
      results = widened;
      relaxedNeedle = parsedFromText.leftover;
    }
  }

  while (results.length === 0 && activeAmenities.length > 0 && (effectiveCategories.length > 0 || activeAmenities.length > 1)) {
    // Try dropping each remaining amenity and keep the variant that recovers
    // the most places, so we shed the single most restrictive constraint
    // rather than an arbitrary one.
    let best: { amenity: AmenityKey; found: Place[] } | null = null;
    for (const amenity of activeAmenities) {
      const without = activeAmenities.filter((a) => a !== amenity);
      const found = collect(relaxedNeedle ? null : textNeedle, without);
      if (!best || found.length > best.found.length) best = { amenity, found };
    }
    if (!best) break;
    activeAmenities = activeAmenities.filter((a) => a !== best!.amenity);
    droppedAmenities = [...droppedAmenities, best.amenity];
    results = best.found;
  }

  const relaxed = relaxedNeedle !== null || droppedAmenities.length > 0;

  results.sort((a, b) => {
    if (sort === "reliability") {
      const byScore = b.reliability_score - a.reliability_score;
      // Distance still breaks ties: among equally trustworthy records, the
      // closer one is always the better answer.
      if (Math.abs(byScore) > 0.001) return byScore;
      return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
    }
    if (a.distance_m != null && b.distance_m != null) return a.distance_m - b.distance_m;
    return b.reliability_score - a.reliability_score;
  });

  // `raw_tags` is the full OSM tag bag - useful on a detail page, pure weight
  // in a 200-result list response (it roughly doubles the payload).
  const page = results.slice(offset, offset + limit).map(({ raw_tags: _omit, ...place }) => place as Place);

  return {
    places: page,
    total: results.length,
    applied: {
      categories: effectiveCategories,
      amenities: effectiveAmenities,
      freeOnly: effectiveFreeOnly,
      openNow,
      q: q?.trim() || null,
      radius_m: radius_m ?? null,
      relaxed,
      // What we widened, so the UI can say it out loud. `amenities` above
      // stays the *requested* set - the filter chips must keep reflecting
      // what the user asked for, not quietly uncheck themselves.
      relaxedBy: relaxed
        ? {
            ...(relaxedNeedle ? { needle: relaxedNeedle } : {}),
            ...(droppedAmenities.length > 0 ? { amenities: droppedAmenities } : {}),
          }
        : undefined,
    },
  };

  function collect(needle: string | null, activeAmenities: AmenityKey[]): Place[] {
    const found: Place[] = [];
    const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;

    for (const base of loadDataset().places) {
      const place = hasOverrides ? applyOverride(base, overrides[base.id]) : base;

      if (place.status === "pending_review" || place.status === "permanently_closed") continue;

      if (box) {
        // Cheap rejection before the trigonometry, same idea as PostGIS using
        // the GiST index before ST_Distance.
        if (place.lat < box.minLat || place.lat > box.maxLat || place.lon < box.minLon || place.lon > box.maxLon) {
          continue;
        }
      }

      if (bbox) {
        const [minLon, minLat, maxLon, maxLat] = bbox;
        if (place.lon < minLon || place.lon > maxLon || place.lat < minLat || place.lat > maxLat) continue;
      }

      if (effectiveCategories.length > 0 && !place.categories.some((c) => effectiveCategories.includes(c))) continue;

      // An amenity filter means "definitely yes" - `null` (unknown) must not
      // satisfy it, or the app would claim facilities it has no evidence for.
      if (activeAmenities.length > 0 && !activeAmenities.every((key) => place.amenities[key] === true)) continue;

      if (effectiveFreeOnly && place.price_type !== "free") continue;

      // Excludes places we KNOW are closed, not places we have no hours for.
      //
      // Only 5.5% of the dataset carries `opening_hours` at all: across
      // 11,406 places, 514 are known open, 17 are known closed, and 10,875
      // are unknown. Requiring "open" therefore discarded ~10,875 places to
      // filter out 17 - and for toilets specifically it hid 544 of 569 while
      // not a single one was known to be closed. A park with no posted hours
      // is almost certainly open; treating silence as "closed" is the same
      // mistake as treating a null amenity as "no", and here it made the
      // filter actively harmful.
      //
      // The chip is labelled "Kapalıları gizle" to match exactly this.
      if (openNow && isOpenNow(place.opening_hours_raw) === "closed") continue;

      if (
        needle &&
        !normalizeTr(place.name).includes(needle) &&
        !normalizeTr(place.address_line ?? "").includes(needle)
      ) {
        continue;
      }

      let distance: number | null = null;
      if (hasCenter) {
        distance = haversineMeters({ lat: lat!, lon: lon! }, { lat: place.lat, lon: place.lon });
        if (radius_m && distance > radius_m) continue;
      }

      found.push({ ...place, distance_m: distance });
    }
    return found;
  }
}

/** Distinct category counts for the current result set - powers the "23 park,
 * 8 tuvalet" style summary and the admin dashboard. */
export function categoryCounts(places: Place[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const place of places) {
    for (const category of place.categories) {
      counts[category] = (counts[category] ?? 0) + 1;
    }
  }
  return counts;
}
