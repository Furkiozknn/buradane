/**
 * The demo data adapter.
 *
 * Reads the real OpenStreetMap snapshots (frontend/data/places.<il>.json,
 * one per province, produced by scripts/fetch_by_district.py) and answers
 * the same queries the FastAPI + PostGIS backend answers - radius search,
 * bbox/viewport search, multi-category filtering, amenity filtering,
 * free-text search - with the same result shape and ordering.
 *
 * Nothing here is mock data. Every place is a real OSM feature with a real
 * OSM id you can open on openstreetmap.org, and no field is invented: the
 * community layer (verification counts, report counts, last-verified date)
 * starts empty because the snapshot has no community history, and only real
 * contributions move it - see `deriveCommunitySignals`.
 *
 * Swapping to the live backend = pointing the API routes at it instead of
 * this module. Nothing above this file knows which one it's talking to.
 */

import fs from "node:fs";
import path from "node:path";

import type {
  AccessType,
  AmenityKey,
  CategorySlug,
  Place,
  PlaceQuery,
  PlaceQueryResult,
} from "./types";
import { boundingBox, haversineMeters } from "./geo";
import { isOpenNow } from "./opening-hours";
import { AMENITIES, QUERY_NOTICES, SEARCH_SYNONYMS, type QueryNotice } from "./categories";
import { findProvince, foldAscii, foldWords, parseLocality, resolveDistrict } from "./administrative";
import { divisionCounts, officialDistrict, officialProvinceCenter } from "./admin-divisions";

interface RawDataset {
  city?: string;
  city_label?: string;
  /** Emitted by fetch_by_district.py; absent on legacy bbox snapshots. */
  fetch_unit?: string;
  generated_at: string;
  source: string;
  license: string;
  attribution: string;
  count: number;
  places: (Omit<
    Place,
    | "reliability_score"
    | "freshness_label"
    | "last_verified_at"
    | "verification_count"
    | "report_count"
    | "access"
    | "district"
    | "province"
  > & {
    access?: AccessType;
    district?: string | null;
    province?: string | null;
    /** Untouched OSM values, emitted by newer snapshots. Resolution happens
     * on read so improvements to the rules apply without a re-pull. */
    district_raw?: string | null;
    province_raw?: string | null;
  })[];
}

export interface DatasetMeta {
  generated_at: string;
  source: string;
  license: string;
  attribution: string;
  count: number;
  /** National per-category totals, precomputed. The admin dashboard needs
   * the distribution and nothing else from the records; deriving it from
   * allPlaces() made an untokened page load 167.829 records per request. */
  categoryTotals: Record<string, number>;
  cities: {
    slug: string;
    label: string;
    count: number;
    /**
     * Where the map opens for this province: its capital, taken from the
     * official division list, with the median of its own places as the
     * fallback. Never a hand-maintained table in this file - that version
     * meant "adding a city is a config row plus a fetch run" was not quite
     * true, because a city whose centre nobody remembered to add silently
     * opened on İstanbul.
     *
     * The median alone was right while a file was a city box and stopped
     * being right when files became whole provinces: Kütahya's median landed
     * in open country with nothing within 5 km, while its capital holds 380
     * places. See the assignment in loadDataset for the full reasoning.
     */
    center: { lat: number; lon: number };
    /**
     * How this province's snapshot was fetched. "province_boundary" means
     * the real OSM admin relation - full provincial coverage, no overlap
     * with neighbours. "legacy_bbox" is the older approach: a box around
     * the provincial capital, which nationally covered 2,2% of the country
     * and left districts like Alanya empty. Kept as data rather than a
     * comment because the coverage test asserts against it, and because a
     * reader of a file has a right to know which one they are holding.
     */
    fetchUnit: "province_boundary" | "legacy_bbox";
  }[];
}

/**
 * Lazy, per-province. The eager version read all 81 snapshots on first
 * touch, which measured **7,4 seconds and 433 MB of RSS** at 122.558 places
 * - paid twice, because Next.js gives the route handlers and the RSC tree
 * separate module registries with separate caches. A visitor arriving on a
 * cold process waited for the whole country to be parsed so the app could
 * put a city name in a chip.
 *
 * The data was always partitioned by province and the dominant query is
 * geographic, so the fix is to read only the files a query can actually
 * match: `meta.json` (18 KB) carries each province's extent, and a radius
 * or viewport search touches one to three files. A query with no
 * geographic constraint still loads everything - it genuinely needs to -
 * but the API refuses a country-wide bbox for its own reasons, so that path
 * is the rare one.
 */
const provinceCache = new Map<string, Place[]>();

/**
 * How many province snapshots stay resident.
 *
 * Lazy loading made the FIRST query cheap; it did nothing about the tenth,
 * because nothing ever evicted. A performance audit walked one /yer page per
 * province - which is exactly what a search engine does with the 60.000-URL
 * sitemap this app publishes - and took the process to 452 MB, then 741 MB
 * once a single /api/places request filled the second module registry. The
 * deployment note promised a 512 MB container; 82 ordinary unauthenticated
 * GETs falsified it.
 *
 * Eight is deliberate rather than round: the same audit measured how many
 * files a real query reads over a national grid - p50 one, p99 three, max
 * four - so a working set of eight holds every realistic query plus the
 * province the user came from, and evicting past it costs a re-read
 * (measured 150 ms for a small province, ~3 s for İstanbul) rather than
 * correctness.
 */
const MAX_RESIDENT_PROVINCES = 8;
let metaCache: DatasetMeta | null = null;
let provinceIndex: ProvinceIndexRow[] | null = null;
const searchTextCache = new Map<string, string>();
let allLoaded = false;

export interface DistrictRow {
  name: string;
  count: number;
  center: { lat: number; lon: number };
}

interface ProvinceIndexRow {
  slug: string;
  label: string;
  count: number;
  fetch_unit: string;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  /** Districts that actually have records, precomputed by
   * build_dataset_meta.mjs. Absent on an index built before they existed. */
  districts?: DistrictRow[];
}

/**
 * Does any WORD in the haystack start with the needle?
 *
 * Plain `includes` was matching mid-word, and at national scale that is not
 * a subtlety: searching "Bolu cami" returned mosques in **Tirebolu**
 * (Giresun), 600 km away, because "tirebolu" contains "bolu". Every province
 * or district name that happens to be a substring of another place name has
 * the same problem.
 *
 * Word-prefix rather than whole-word, because incremental typing has to keep
 * working - somebody typing "kadik" must still find Kadıköy before they
 * finish the word. The haystack is space-joined, so a word starts at index 0
 * or after a space.
 */
function matchesWordPrefix(haystack: string, needle: string): boolean {
  // Every word of the query must begin a word of the record - "moda parki"
  // matches "Moda Parkı Tuvaleti", "bolu" no longer matches "Tirebolu".
  for (const word of needle.split(" ")) {
    if (!word) continue;
    let from = 0;
    let hit = false;
    for (;;) {
      const at = haystack.indexOf(word, from);
      if (at === -1) break;
      if (at === 0 || haystack[at - 1] === " ") {
        hit = true;
        break;
      }
      from = at + 1;
    }
    if (!hit) return false;
  }
  return true;
}

/** Hoisted once: the facet pass runs this over every match in the result
 * set, and rebuilding it per place was the single most expensive line in a
 * national query. */
const AMENITY_KEYS = AMENITIES.map((a) => a.key) as AmenityKey[];

/**
 * Reliability, computed from what is actually known about the record.
 *
 * This function used to also invent a community history: a hash of the
 * place id produced a verification count (0-5), a report count and a
 * "last verified" date up to 120 days back. The UI then showed those with
 * a green check - "5 kişi doğruladı · 17 gün önce doğrulandı" - on records
 * whose snapshot carries no timestamp at all and which no human being has
 * ever confirmed. A UX audit named it the finding that would embarrass the
 * project hardest, and it was right: fabricated provenance in a civic tool
 * whose whole pitch is trustworthy open data is worse than an empty field.
 *
 * What survives is the part that was always real: OSM completeness. A place
 * with a mapped name, opening hours, an address and wheelchair tagging
 * genuinely IS better documented than a bare node, and saying so is a claim
 * about the DATA, which we hold, not about people, which we do not. Counts
 * start at zero and only real community input moves them - the same numbers
 * the backend derives from actual PlaceVerification / PlaceReport rows.
 */
function deriveCommunitySignals(place: RawDataset["places"][number]) {
  let completeness = 0.35;
  if (!place.name.match(/^(Umumi Tuvalet|Park|İçme Suyu Çeşmesi|Oturma Alanı|Çocuk Oyun Alanı|Spor Alanı|Otopark|Duş|Ücretsiz Wi-Fi Noktası)$/)) {
    completeness += 0.2; // has a real, mapped name
  }
  if (place.opening_hours_raw) completeness += 0.1;
  if (place.address_line) completeness += 0.08;
  if (place.amenities.wheelchair_accessible !== null) completeness += 0.12;
  if (place.operator) completeness += 0.07;
  if (place.website || place.phone) completeness += 0.05;

  // Same shape as the backend formula, minus the invented terms: the
  // verification bonus and the report penalty are earned by real community
  // input, which a fresh snapshot has none of. applyOverride adds them back
  // as people actually contribute.
  const score = Math.min(1, Math.max(0, completeness * 0.75));

  return {
    reliability_score: Number(score.toFixed(3)),
    verification_count: 0,
    report_count: 0,
    // No timestamp exists in the snapshot - OSM's own edit dates are not in
    // the extract - so there is nothing honest to put here. null, and the
    // label says what that means rather than implying a recent visit.
    last_verified_at: null,
    freshness_label: "Topluluk doğrulaması yok",
  };
}

/**
 * Resolves a place's district and province from whatever the tags contain.
 *
 * `addr:district` first, because it is the field that means what it says;
 * `addr:city` is the fallback and routinely holds a compound "İlçe/İl". Doing
 * this once at load beats doing it per query, and it is what makes district
 * search work at all - matching the raw tag would miss "Kadıköy" for every
 * place tagged "Kadikoy".
 */
function localityFromTags(
  tags: Record<string, string> | undefined,
  raw?: { district?: string | null; province?: string | null },
  /** The province the snapshot file itself covers, when known. Only used to
   * disambiguate names that are meaningless without it - see below. */
  fileProvince?: string | null,
): {
  district: string | null;
  province: string | null;
} {
  // Newer snapshots carry the raw values directly; older ones only have the
  // tag bag. Either way the resolution happens here, so a re-pull is never
  // needed to pick up an improvement to the rules.
  const districtRaw = raw?.district ?? tags?.["addr:district"] ?? tags?.["addr:suburb"];
  const provinceRaw = raw?.province ?? tags?.["addr:province"] ?? tags?.["addr:city"];
  if (!districtRaw && !provinceRaw) return { district: null, province: null };

  const fromCity = parseLocality(provinceRaw);
  const explicitDistrict = resolveDistrict(districtRaw);

  let heuristicDistrict = explicitDistrict?.name ?? fromCity.district?.name ?? null;
  const knownProvince =
    fromCity.province?.name ?? explicitDistrict?.province ?? fileProvince ?? null;

  // `addr:district=Merkez` - 537 places nationally. "Merkez" is the central
  // district of *some* province, which on a national map means nothing on
  // its own, and it collapsed fifty-odd different districts onto one label.
  // The official boundary list spells these "<İl> Merkez" (Gümüşhane
  // Merkez, Bayburt Merkez), so with the province in hand the real district
  // name is recoverable rather than guessed.
  if (heuristicDistrict && knownProvince && foldAscii(heuristicDistrict) === "merkez") {
    heuristicDistrict = officialDistrict(`${knownProvince} Merkez`)?.name ?? null;
  }

  // Anything the official 973-district list does not recognise is NOT
  // reported as a district. At national scale the residue is 71 places
  // across 34 names, every one an OSM artifact: province names in the
  // district field (Gaziantep, Kocaeli (izmit)), misspellings (Gazianetp,
  // Afyokkarahisar, Konyalatı, Osmanazi) and things that are not districts
  // at all (Atatürk Bulvarı, Kumlubel Mahallesi). Showing those as the
  // district claims knowledge we do not have - CLAUDE.md §6.2, "do not
  // invent the unknown" - and it fragments district grouping and search.
  // The province survives, which is what a user actually navigates by.
  // Guarded on the list being present: without it (fresh clone, stripped
  // deployment) every name would be "unrecognised" and this would wipe
  // every district in the dataset.
  if (heuristicDistrict && divisionCounts() && !officialDistrict(heuristicDistrict)) {
    heuristicDistrict = null;
  }

  // The official list (OSM admin boundaries, 973 districts) outranks the
  // heuristic when it recognises the name: its spelling is the boundary
  // relation's own, and it can supply the province for a bare district tag.
  // When the list is absent or the name is not an official district, the
  // heuristic result stands unchanged - which is exactly the behaviour the
  // app shipped with before the list existed.
  const official = heuristicDistrict ? officialDistrict(heuristicDistrict) : null;

  return {
    district: official?.name ?? heuristicDistrict,
    // A district we recognised may name its own province (the fixes table
    // knows which province a mislabelled neighbourhood belongs to; the
    // official list knows it for every unambiguous district in the country).
    province:
      fromCity.province?.name ?? explicitDistrict?.province ?? (official?.province || null),
  };
}

/**
 * Who can actually walk in. Mirrors `_access_from_tags` in
 * scripts/fetch_demo_data.py - the two must agree, or a re-pull would
 * silently change which places are public.
 */
function accessFromTags(tags: Record<string, string> | undefined): AccessType {
  const value = (tags?.access ?? "").trim().toLowerCase();
  if (value === "private" || value === "no") return "private";
  if (value === "customers") return "customers";
  if (value === "permit" || value === "permissive") return "permit";
  return "public";
}

const DATA_DIR = () => path.join(process.cwd(), "data");

/** Reads the province index once. Falls back to scanning the snapshots when
 * meta.json is missing (a clone made before it existed, or a fetch that has
 * not been followed by `node scripts/build_dataset_meta.mjs`) - slower, but
 * the app must never simply fail to start over a derived file. */
function loadIndex(): ProvinceIndexRow[] {
  if (provinceIndex) return provinceIndex;
  const metaPath = path.join(DATA_DIR(), "meta.json");
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as {
      generated_at: string;
      source: string;
      license: string;
      attribution: string;
      count: number;
      categoryTotals?: Record<string, number>;
      provinces: ProvinceIndexRow[];
    };
    metaCache = {
      generated_at: raw.generated_at,
      source: raw.source,
      license: raw.license,
      attribution: raw.attribution,
      count: raw.count,
      categoryTotals: raw.categoryTotals ?? {},
      cities: raw.provinces.map((row) => ({
        slug: row.slug,
        label: row.label,
        count: row.count,
        center: officialProvinceCenter(row.label) ?? {
          lat: (row.bbox.minLat + row.bbox.maxLat) / 2,
          lon: (row.bbox.minLon + row.bbox.maxLon) / 2,
        },
        fetchUnit: row.fetch_unit === "province_boundary" ? "province_boundary" : "legacy_bbox",
      })),
    };
    provinceIndex = raw.provinces;
    return provinceIndex;
  } catch {
    return rebuildIndexFromSnapshots();
  }
}

function snapshotFiles(): string[] {
  const files = fs
    .readdirSync(DATA_DIR())
    .filter((name) => name.startsWith("places.") && name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      "data/ icinde places.*.json bulunamadi. Once scripts/fetch_by_district.py calistirin.",
    );
  }
  return files;
}

/** The meta.json-less path: read every snapshot to derive what the index
 * would have said. Correct, just expensive - which is the entire reason
 * meta.json exists. */
function rebuildIndexFromSnapshots(): ProvinceIndexRow[] {
  const rows: ProvinceIndexRow[] = [];
  const cities: DatasetMeta["cities"] = [];
  let newest = "";
  let attribution = "\u00a9 OpenStreetMap katkida bulunanlari";
  let license = "ODbL 1.0";
  let source = "OpenStreetMap via Overpass API";
  let count = 0;

  for (const file of snapshotFiles()) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR(), file), "utf-8")) as RawDataset;
    const slug = raw.city ?? file.replace(/^places\./, "").replace(/\.json$/, "");
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const place of raw.places) {
      if (place.lat < minLat) minLat = place.lat;
      if (place.lat > maxLat) maxLat = place.lat;
      if (place.lon < minLon) minLon = place.lon;
      if (place.lon > maxLon) maxLon = place.lon;
    }
    rows.push({
      slug,
      label: raw.city_label ?? slug,
      count: raw.places.length,
      fetch_unit: raw.fetch_unit ?? "legacy_bbox",
      bbox: { minLat, minLon, maxLat, maxLon },
    });
    cities.push({
      slug,
      label: raw.city_label ?? slug,
      count: raw.places.length,
      center: officialProvinceCenter(raw.city_label ?? slug) ?? medianCenter(raw.places),
      fetchUnit: raw.fetch_unit === "province_boundary" ? "province_boundary" : "legacy_bbox",
    });
    count += raw.places.length;
    if (raw.generated_at > newest) newest = raw.generated_at;
    attribution = raw.attribution ?? attribution;
    license = raw.license ?? license;
    source = raw.source ?? source;
  }

  metaCache = {
    generated_at: newest,
    source,
    license,
    attribution,
    count,
    // The fallback path has no precomputed totals; the admin page renders
    // the categories with zeroes rather than paying a national load for a
    // header. Running build_dataset_meta.mjs restores them.
    categoryTotals: {},
    cities,
  };
  provinceIndex = rows;
  return rows;
}

/**
 * Resolves one province's snapshot into Place records, once.
 *
 * Everything that used to happen in the single national pass happens here
 * per file: access/district/province resolution, the community-signal
 * defaults, and the folded search text. The one thing that CANNOT be done
 * per file is cross-province duplicate resolution, which is why callers go
 * through `placesFor()` rather than calling this directly.
 */
function loadProvince(slug: string): Place[] {
  const cached = provinceCache.get(slug);
  if (cached) return cached;

  const file = path.join(DATA_DIR(), `places.${slug}.json`);
  let raw: RawDataset;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8")) as RawDataset;
  } catch {
    provinceCache.set(slug, []);
    return [];
  }

  // The file IS the province fetch unit, so its label is a province name and
  // resolves against the 81-entry table. Used as the LAST fallback only:
  // addr:* tags, when present, stay authoritative - a place tagged into a
  // neighbouring province keeps that tag. Without this, every record lacking
  // addr tags loaded with province null, which made "hakkari cesme" match
  // nothing for "hakkari"; the engine then dropped the needle and answered
  // with every fountain in the country.
  const fileProvince = findProvince(raw.city_label ?? slug)?.name ?? null;

  const places: Place[] = [];
  for (const place of raw.places) {
    const locality = localityFromTags(
      place.raw_tags,
      { district: place.district_raw, province: place.province_raw },
      fileProvince,
    );
    const resolved: Place = {
      ...place,
      // Snapshots taken before the fetcher learned about these still carry
      // the raw OSM tags, so the fields are derived here rather than
      // requiring a full re-pull through a rate-limited Overpass mirror.
      access: place.access ?? accessFromTags(place.raw_tags),
      district: place.district ?? locality.district,
      province: place.province ?? locality.province ?? fileProvince,
      ...deriveCommunitySignals(place),
    };
    places.push(resolved);
    // Precomputed, not per query: folding 120.000 names on every keystroke
    // would be the most expensive thing in the request. Diacritic-free, so
    // someone typing "kadikoy" without a Turkish layout finds the places
    // tagged "Kadikoy" rather than the two spelled without them.
    searchTextCache.set(
      resolved.id,
      foldWords(
        [resolved.name, resolved.address_line, resolved.district, resolved.province]
          .filter(Boolean)
          .join(" "),
      ),
    );
  }

  provinceCache.set(slug, places);
  evictOldestProvinces();
  return places;
}

/** Least-recently-INSERTED eviction, which a Map gives for free through its
 * insertion order. Re-inserting on read would make it true LRU; it is not
 * worth the extra write on the hot path, because a working set of eight
 * over a p99 of three means eviction is rare either way. The search text of
 * an evicted province goes with it - otherwise that Map becomes the leak
 * this one just stopped being. */
function evictOldestProvinces(): void {
  while (provinceCache.size > MAX_RESIDENT_PROVINCES) {
    const oldest = provinceCache.keys().next();
    if (oldest.done) return;
    const dropped = provinceCache.get(oldest.value);
    provinceCache.delete(oldest.value);
    if (dropped) for (const place of dropped) searchTextCache.delete(place.id);
    // A full national load is the one case where eviction would thrash: it
    // asks for all 81 in sequence and needs them all at once. loadAll marks
    // itself so the guard steps aside for it.
    if (loadingAll) return;
  }
}

/** Set only while loadAll() is assembling every province - see above. */
let loadingAll = false;

/**
 * The records for a set of provinces, with cross-province duplicates
 * resolved.
 *
 * One OSM id, one place - decided by geometry, not by file order. Overpass'
 * `(area:...)` returns a way that CROSSES a boundary to both provinces'
 * queries, so a picnic area on the Batman/Diyarbakir border comes back in
 * both files and the map would draw two pins on one spot. Districts tile a
 * province exactly, so the copy that landed inside one is geometrically in
 * that province while the copy with no district was merely returned by the
 * query: Batman said "Kozluk", Diyarbakir said null, and Batman is where it
 * is. The same rule cleans up the legacy overlap while the national
 * re-fetch is in flight - the old Istanbul box reaches into real Kocaeli.
 */
function placesFor(slugs: string[]): Place[] {
  if (slugs.length === 1) return loadProvince(slugs[0]);
  const byId = new Map<string, Place>();
  for (const slug of slugs) {
    for (const place of loadProvince(slug)) {
      const existing = byId.get(place.id);
      if (!existing || (!existing.district && place.district)) byId.set(place.id, place);
    }
  }
  return [...byId.values()];
}

/** Every province whose own extent overlaps the search box, or all of them
 * when a query carries no geographic constraint. This is the whole saving:
 * a radius search in Sivas reads one file, not eighty-one. */
function provincesFor(
  box: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null,
): string[] {
  const index = loadIndex();
  if (!box) return index.map((row) => row.slug);
  return index
    .filter(
      (row) =>
        row.bbox.minLat <= box.maxLat &&
        row.bbox.maxLat >= box.minLat &&
        row.bbox.minLon <= box.maxLon &&
        row.bbox.maxLon >= box.minLon,
    )
    .map((row) => row.slug);
}

/** Every province. Used by the sitemap (build time), the tests, and any
 * query with no geographic constraint. */
interface PlaceIndexFile {
  provinces: string[];
  ids: Record<string, number>;
}

let placeIndexCache: PlaceIndexFile | null | undefined;

/** The id -> province lookup, read at most once per process and only from
 * the by-id path. Null when the file is absent, which is a slower but
 * correct configuration rather than a broken one. */
function loadPlaceIndex(): PlaceIndexFile | null {
  if (placeIndexCache !== undefined) return placeIndexCache;
  try {
    placeIndexCache = JSON.parse(
      fs.readFileSync(path.join(DATA_DIR(), "place-index.json"), "utf-8"),
    ) as PlaceIndexFile;
  } catch {
    placeIndexCache = null;
  }
  return placeIndexCache;
}

/**
 * Every province, assembled once and kept.
 *
 * Deliberately exempt from the residency cap, because the cap and this
 * function answer different questions. The cap exists so a REQUEST can
 * never pin the country in memory; a full load is not a request path -
 * every route now requires a geographic scope (api/places), and a lookup by
 * id goes through place-index.json. What is left is the sitemap at build
 * time and the tests, both of which want the whole thing and both of which
 * would otherwise thrash: eight slots against an 81-province walk means
 * re-reading almost every file, which took the suite from 40 s to 515 s.
 *
 * The one request path that can still reach here is getPlaceById on a
 * deployment with no place-index.json - a degraded configuration the code
 * warns about rather than a normal one.
 */
let allPlacesCache: Place[] | null = null;

function loadAll(): Place[] {
  if (allPlacesCache) return allPlacesCache;
  loadingAll = true;
  try {
    allPlacesCache = placesFor(loadIndex().map((row) => row.slug));
    allLoaded = true;
    return allPlacesCache;
  } finally {
    loadingAll = false;
  }
}

/**
 * Is the word the search gave up on actually a place?
 *
 * Checks the 81 provinces first, then the official 973 districts, so
 * "Alanya", "Kadıköy", "Çeşme" and "Ürgüp" resolve as readily as "Antalya"
 * does. Returns nothing for an ordinary word, which is the common case and
 * must stay cheap.
 */
function resolveNeedleLocation(
  needle: string,
): { needleLocation?: { label: string; province: string; center: { lat: number; lon: number } } } {
  const province = findProvince(needle);
  if (province) {
    const center = officialProvinceCenter(province.name);
    if (center) {
      return { needleLocation: { label: province.name, province: province.name, center } };
    }
  }
  const district = officialDistrict(needle);
  // An ambiguous district name (province "") names several places, so
  // offering to go to one of them would be a guess dressed as an answer.
  if (district && district.province) {
    return {
      needleLocation: {
        label: district.name,
        province: district.province,
        center: district.center,
      },
    };
  }
  return {};
}

/** Median coordinate of a city's places - resistant to a single node
 * mis-tagged on the other side of the country, which a mean is not. */
function medianCenter(places: { lat: number; lon: number }[]): { lat: number; lon: number } {
  if (places.length === 0) return { lat: 41.0082, lon: 28.9784 };
  const lats = places.map((p) => p.lat).sort((a, b) => a - b);
  const lons = places.map((p) => p.lon).sort((a, b) => a - b);
  const mid = Math.floor(places.length / 2);
  return { lat: lats[mid], lon: lons[mid] };
}

export function datasetMeta(): DatasetMeta {
  loadIndex();
  return metaCache!;
}

export function allPlaces(): Place[] {
  return loadAll();
}

/** One province's records. Exported for the sitemap, which is generated per
 * province precisely so no build step or request ever needs the country. */
export function placesOfProvince(slug: string): Place[] {
  return loadProvince(slug);
}

/**
 * The ilçe list for one province, or null when the slug names no province.
 *
 * Reads the index only - never a snapshot - so the districts endpoint stays
 * cheap on a cold process. An index predating the district rows returns an
 * empty list rather than throwing: the picker then simply offers no ilçe
 * step, which is what the app did before this existed.
 */
export function districtsOfProvince(slug: string): DistrictRow[] | null {
  const row = loadIndex().find((province) => province.slug === slug);
  if (!row) return null;
  return row.districts ?? [];
}

/**
 * One place by OSM id.
 *
 * The id carries no province, so this is the one lookup lazy loading cannot
 * narrow: it searches what is already in memory first - which on a warm
 * process is usually the province the user is browsing - and only falls
 * back to reading the rest of the country when that misses. A detail page
 * for a place nobody has queried therefore costs one full load, once.
 */
export function getPlaceById(id: string, communityPlaces?: Place[]): Place | undefined {
  for (const loaded of provinceCache.values()) {
    const hit = loaded.find((p) => p.id === id);
    if (hit) return hit;
  }
  const fromCommunity = communityPlaces?.find((p) => p.id === id);
  if (fromCommunity) return fromCommunity;

  // Not in memory: ask the id index which province holds it and read that
  // one file. The index (3,2 MB, loaded once and only on this path) exists
  // precisely so a miss is not a national load - otherwise a single
  // /yer/<bogus-id> request would pull 167.829 records into memory, which
  // is both a 15-second 404 and something a crawler could trigger at will.
  const index = loadPlaceIndex();
  if (index) {
    const provinceIndexPosition = index.ids[id];
    if (provinceIndexPosition === undefined) return undefined;
    const slug = index.provinces[provinceIndexPosition];
    return slug ? loadProvince(slug).find((p) => p.id === id) : undefined;
  }

  // No index file (a clone that has not run build_dataset_meta.mjs): fall
  // back to the exhaustive read rather than answering a wrong 404.
  if (allLoaded) return undefined;
  return loadAll().find((p) => p.id === id);
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
  notices: QueryNotice[];
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
    notices: QUERY_NOTICES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.notice),
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
    /**
     * Places the community added and a moderator approved. Passed in rather
     * than read here, because the snapshot loader is synchronous and the
     * community layer lives behind async file IO - the same split the
     * overrides already use.
     */
    communityPlaces?: Place[];
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
    communityPlaces,
    sort = "distance",
  } = query;

  let parsedFromText = {
    categories: [] as CategorySlug[],
    amenities: [] as AmenityKey[],
    freeOnly: false,
    leftover: "",
    notices: [] as QueryNotice[],
  };
  if (q && q.trim()) parsedFromText = parseQueryText(q);

  const effectiveCategories = [...new Set([...categories, ...parsedFromText.categories])];
  const effectiveAmenities = [...new Set([...amenities, ...parsedFromText.amenities])];
  const effectiveFreeOnly = freeOnly || parsedFromText.freeOnly;
  // Folded with the same function the index was built with, or the two would
  // simply never meet.
  // Folded per word, like the index it is matched against.
  const textNeedle = parsedFromText.leftover ? foldWords(parsedFromText.leftover) : null;

  const hasCenter = typeof lat === "number" && typeof lon === "number";
  const box = hasCenter && radius_m ? boundingBox({ lat: lat!, lon: lon! }, radius_m) : null;

  // Which snapshots this query can possibly match, and therefore which ones
  // get read off disk. A radius search in Sivas touches one file; a viewport
  // straddling two provinces touches two. Only a query with no geographic
  // constraint at all reads the country - and the API refuses a
  // country-wide bbox on its own account, so that is the rare path.
  const searchBox = box
    ? { minLat: box.minLat, minLon: box.minLon, maxLat: box.maxLat, maxLon: box.maxLon }
    : bbox
      ? { minLon: bbox[0], minLat: bbox[1], maxLon: bbox[2], maxLat: bbox[3] }
      : null;
  const scoped = placesFor(provincesFor(searchBox));

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

  // Facets over the whole match set, before pagination. One pass; at the
  // measured 7-30ms per query this is not the expensive part, and counting
  // after `slice` is how the category chips came to under-report every
  // number by whatever the page cap cut off.
  const facets: PlaceQueryResult["facets"] = {
    categories: {},
    amenities: {},
    freeOnly: 0,
    notClosed: 0,
  };
  for (const place of results) {
    for (const slug of place.categories) {
      facets.categories[slug] = (facets.categories[slug] ?? 0) + 1;
    }
    // Indexed, not Object.entries: entries allocated an array of 14
    // two-element arrays PER PLACE, which on a national query is 664.636
    // throwaway arrays and, measured, 50,6 ms of the facet pass's 86 ms.
    // Only `true` counts - `null` means unknown, and counting it here would
    // promise exactly the facilities the filter refuses to claim.
    for (const key of AMENITY_KEYS) {
      if (place.amenities[key] === true) {
        facets.amenities[key] = (facets.amenities[key] ?? 0) + 1;
      }
    }
    if (place.price_type === "free") facets.freeOnly += 1;
    if (isOpenNow(place.opening_hours_raw) !== "closed") facets.notClosed += 1;
  }

  // `raw_tags` is the full OSM tag bag - useful on a detail page, pure weight
  // in a 200-result list response (it roughly doubles the payload).
  const page = results.slice(offset, offset + limit).map(({ raw_tags: _omit, ...place }) => place as Place);

  return {
    places: page,
    total: results.length,
    facets,
    applied: {
      categories: effectiveCategories,
      amenities: effectiveAmenities,
      freeOnly: effectiveFreeOnly,
      openNow,
      q: q?.trim() || null,
      radius_m: radius_m ?? null,
      notices: parsedFromText.notices.length > 0 ? parsedFromText.notices : undefined,
      relaxed,
      // What we widened, so the UI can say it out loud. `amenities` above
      // stays the *requested* set - the filter chips must keep reflecting
      // what the user asked for, not quietly uncheck themselves.
      relaxedBy: relaxed
        ? {
            ...(relaxedNeedle ? { needle: relaxedNeedle } : {}),
            ...(relaxedNeedle ? resolveNeedleLocation(relaxedNeedle) : {}),
            ...(droppedAmenities.length > 0 ? { amenities: droppedAmenities } : {}),
          }
        : undefined,
    },
  };

  function collect(needle: string | null, activeAmenities: AmenityKey[]): Place[] {
    const found: Place[] = [];
    const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;

    // Community places are searched on exactly the same terms as OSM ones -
    // same filters, same radius, same status rules. A contributed place that
    // only showed up under special conditions would be a second-class record,
    // and the whole point of approving it is that it is now part of the map.
    const candidates =
      communityPlaces && communityPlaces.length > 0
        ? [...scoped, ...communityPlaces]
        : scoped;

    for (const base of candidates) {
      // Geometry BEFORE the override merge. An override never moves a place,
      // so rejecting on coordinates first is exactly equivalent - and it is
      // the difference between doing 47.474 dictionary lookups plus object
      // spreads per query and doing a few hundred. Measured: one single
      // community verification anywhere in Türkiye took a 2 km radius query
      // from 8,8 ms to 28,3 ms, because `hasOverrides` is global and the
      // merge ran before the cheap rejection. Every filter that legitimately
      // needs the merged record (status, access, open-now, score) still runs
      // after it, below.
      if (box) {
        // Cheap rejection before the trigonometry, same idea as PostGIS using
        // the GiST index before ST_Distance.
        if (base.lat < box.minLat || base.lat > box.maxLat || base.lon < box.minLon || base.lon > box.maxLon) {
          continue;
        }
      }

      if (bbox) {
        const [minLon, minLat, maxLon, maxLat] = bbox;
        if (base.lon < minLon || base.lon > maxLon || base.lat < minLat || base.lat > maxLat) continue;
      }

      const place = hasOverrides ? applyOverride(base, overrides[base.id]) : base;

      if (place.status === "pending_review" || place.status === "permanently_closed") continue;

      // A place tagged `access=private` is inside someone's property. Sending
      // a person in a hurry to a door that will not open is the worst thing
      // this app can do, so these never reach a result - 155 places in the
      // national snapshot restrict access, and every one was being served as
      // freely usable before this line. `customers` and `permit` DO reach
      // results: they are usable under a condition a person can meet, and
      // they carry a badge saying so.
      if (place.access === "private") continue;

      if (effectiveCategories.length > 0 && !place.categories.some((c) => effectiveCategories.includes(c))) continue;

      // An amenity filter means "definitely yes" - `null` (unknown) must not
      // satisfy it, or the app would claim facilities it has no evidence for.
      if (activeAmenities.length > 0 && !activeAmenities.every((key) => place.amenities[key] === true)) continue;

      if (effectiveFreeOnly && place.price_type !== "free") continue;

      // Excludes places we KNOW are closed, not places we have no hours for.
      //
      // Only 2,45% of the national dataset carries `opening_hours` at all:
      // across 47.474 places, 444 are known open, 603 known closed, and
      // 46.309 unknown. Requiring "open" would therefore discard 46.309
      // places to filter out 603. A park with no posted hours
      // is almost certainly open; treating silence as "closed" is the same
      // mistake as treating a null amenity as "no", and here it made the
      // filter actively harmful.
      //
      // The chip is labelled "Kapalıları gizle" to match exactly this.
      if (openNow && isOpenNow(place.opening_hours_raw) === "closed") continue;

      // Matched against a precomputed, diacritic-free blob of name, address,
      // district and province. Two things this fixes at once: "Kadıköy" now
      // finds the places tagged "Kadikoy" (resolved district, not raw text),
      // and "kadikoy" typed without a Turkish keyboard finds all of them
      // rather than the two spelled that way.
      if (needle) {
        const haystack =
          searchTextCache.get(place.id) ??
          foldWords([place.name, place.address_line, place.district, place.province].filter(Boolean).join(" "));
        if (!matchesWordPrefix(haystack, needle)) continue;
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
