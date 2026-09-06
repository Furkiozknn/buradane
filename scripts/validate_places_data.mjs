// Per-batch data-integrity gate for the national fetch.
//
// The repository tests already prove the LOADER works over the real files
// (every city loads, centres land inside their own data, spot-checked
// fields). This script is the complement they deliberately are not: it
// checks EVERY record of EVERY file - the loader tests sample 500 - and it
// checks the cross-file properties a per-city loader never sees. Run it
// before committing a landed province; a red exit means the file does not
// get committed.
//
//   node scripts/validate_places_data.mjs
//
// Checks, and why each exists:
//  1. Parse + non-empty: an HTTP-200-empty Overpass reply once froze three
//     provinces at zero districts; the same failure shape can land here.
//  2. Per-record schema: id shape, finite coordinates inside Türkiye's
//     mainland box, non-empty categories - one malformed record poisons
//     map rendering and search for everyone.
//  3. Cross-file duplicate OSM ids: synthesized province bboxes could
//     overlap; a place in two files is two markers on the map.
//  4. Spread sanity: a record further than ~200 km from its file's median
//     centre means the bbox leaked into a neighbouring region (or the
//     median itself was dragged); either way a human should look.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "data");
const ID_SHAPE = /^(node|way|relation)\/\d+$/;
const TR = { latMin: 35.5, latMax: 42.5, lonMin: 25.5, lonMax: 45.0 };
const MAX_SPREAD_KM = 200;

const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("places.") && f.endsWith(".json"));
const problems = [];
// Separate from `problems` on purpose: a duplicate that involves a legacy
// bbox file is EXPECTED while the national re-fetch is in flight (the old
// İstanbul box reaches into Kocaeli, so a place inside real Kocaeli appears
// in both). It stops being possible once every file is boundary-based. A
// gate that cannot tell that apart is a gate people learn to ignore.
const legacyOverlaps = [];
const seenIds = new Map(); // id -> first file
const seenDistrict = new Map(); // id -> district of the first copy (null when outside every polygon)
const fetchUnits = new Map(); // file -> fetch_unit
let total = 0;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * 111;
  const dLon = (bLon - aLon) * 111 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

for (const file of files.sort()) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
  } catch (err) {
    problems.push(`${file}: JSON parse edilemedi - ${err.message}`);
    continue;
  }
  fetchUnits.set(file, data.fetch_unit ?? "legacy_bbox");
  if (!Array.isArray(data.places) || data.places.length === 0) {
    problems.push(`${file}: places dizisi boş ya da yok - boş dosya commit edilmez`);
    continue;
  }

  const lats = [];
  const lons = [];
  for (const p of data.places) {
    if (!ID_SHAPE.test(p.id ?? "")) {
      problems.push(`${file}: geçersiz id '${p.id}'`);
      continue;
    }
    if (
      !Number.isFinite(p.lat) || !Number.isFinite(p.lon) ||
      p.lat < TR.latMin || p.lat > TR.latMax || p.lon < TR.lonMin || p.lon > TR.lonMax
    ) {
      problems.push(`${file}: ${p.id} Türkiye kutusu dışında (${p.lat}, ${p.lon})`);
      continue;
    }
    if (!Array.isArray(p.categories) || p.categories.length === 0) {
      problems.push(`${file}: ${p.id} kategorisiz`);
    }
    const first = seenIds.get(p.id);
    if (first && first !== file) {
      const bothBoundary =
        fetchUnits.get(first) === "province_boundary" &&
        fetchUnits.get(file) === "province_boundary";
      const message = `MÜKERRER: ${p.id} hem ${first} hem ${file} içinde`;
      // Two real province boundaries do not overlap, so a duplicate between
      // two boundary-based files starts out suspicious - but there is one
      // understood, resolvable case. Overpass' `(area:...)` returns a WAY
      // that crosses a boundary to both provinces' queries, and the copies
      // are distinguishable: districts tile a province exactly, so the copy
      // that landed inside one is geometrically in that province and the
      // other is not. The loader keeps that copy (places-repository.ts), so
      // exactly-one-has-a-district is a documented exception rather than a
      // defect. Both or neither having one is unresolvable, and stays a
      // problem.
      const previous = seenDistrict.get(p.id);
      const resolvable = bothBoundary && (previous == null) !== (p.district_raw == null);
      if (!bothBoundary || resolvable) legacyOverlaps.push(message + (resolvable ? " [sınırı kesen way - yükleyici ilçesi olan kopyayı tutar]" : ""));
      else problems.push(message);
    } else {
      seenIds.set(p.id, file);
      seenDistrict.set(p.id, p.district_raw ?? null);
    }
    lats.push(p.lat);
    lons.push(p.lon);
  }

  const cLat = median(lats);
  const cLon = median(lons);
  for (const p of data.places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const d = distanceKm(cLat, cLon, p.lat, p.lon);
    if (d > MAX_SPREAD_KM) {
      problems.push(
        `${file}: ${p.id} medyan merkezden ${d.toFixed(0)} km uzakta - bbox komşu bölgeye taşmış olabilir`,
      );
    }
  }

  total += data.places.length;
}

// ── Coverage: is the country actually covered, or just its 81 city centres?
//
// This is the check whose absence let "81 il" mean 81 boxes of ~12x12 km -
// 2,2 % of Türkiye's land area, with Alanya (350.000 residents) returning
// nothing. Every other gate here passed on that data: the files parsed, the
// schema held, there were no duplicates, and nothing sat more than 200 km
// from its own file's median, because a 12 km box cannot. The honest
// measure is the one the user experiences - can somebody standing in an
// arbitrary district find anything at all?
const DISTRICT_RADIUS_KM = 15;
let coverage = null;
try {
  const divisions = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "admin-divisions.json"), "utf-8"),
  );
  const all = [];
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
    for (const p of data.places) all.push([p.lat, p.lon]);
  }
  // Grid index: 973 districts x 100k+ places is too many pairs to brute
  // force, and a 0,2-degree bucket is comfortably wider than the radius.
  const CELL = 0.2;
  const grid = new Map();
  for (const [lat, lon] of all) {
    const key = `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push([lat, lon]);
  }
  let covered = 0;
  const empty = [];
  for (const province of divisions.provinces) {
    for (const district of province.districts) {
      const { lat, lon } = district.center;
      let near = false;
      const ci = Math.floor(lat / CELL);
      const cj = Math.floor(lon / CELL);
      for (let i = ci - 1; i <= ci + 1 && !near; i += 1) {
        for (let j = cj - 1; j <= cj + 1 && !near; j += 1) {
          for (const [plat, plon] of grid.get(`${i},${j}`) ?? []) {
            if (distanceKm(lat, lon, plat, plon) <= DISTRICT_RADIUS_KM) {
              near = true;
              break;
            }
          }
        }
      }
      if (near) covered += 1;
      else empty.push(`${province.name}/${district.name}`);
    }
  }
  const totalDistricts = divisions.counts.districts;
  coverage = { covered, totalDistricts, empty };
  console.log(
    `ilçe kapsamı: ${covered}/${totalDistricts} ilçe merkezinin ` +
      `${DISTRICT_RADIUS_KM} km'si içinde veri var (%${((100 * covered) / totalDistricts).toFixed(1)})`,
  );
  if (empty.length) {
    console.log(`  boş ilçeler (ilk 15): ${empty.slice(0, 15).join(", ")}`);
  }
} catch (err) {
  console.log(`ilçe kapsamı ölçülemedi: ${err.message}`);
}

// meta.json is derived from these files and is what the app reads instead
// of parsing all of them. Derived data that silently disagrees with its
// source is worse than no derived data: the UI would show one count while
// the map showed another, and a stale extent would make a province
// invisible to a query that should have matched it.
try {
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "meta.json"), "utf-8"));
  if (meta.count !== seenIds.size || meta.provinces.length !== files.length) {
    problems.push(
      `meta.json bayat: ${meta.provinces.length} il / ${meta.count} mekan diyor, ` +
        `dosyalarda ${files.length} il / ${seenIds.size} benzersiz mekan var. ` +
        `Çözüm: node scripts/build_dataset_meta.mjs`,
    );
  }
} catch {
  problems.push("meta.json yok ya da okunamıyor - node scripts/build_dataset_meta.mjs");
}

console.log(`${files.length} il dosyası, ${total} mekan, ${seenIds.size} benzersiz id`);
const boundaryCount = [...fetchUnits.values()].filter((u) => u === "province_boundary").length;
console.log(`gerçek il sınırından çekilen: ${boundaryCount}/${files.length}`);
if (legacyOverlaps.length) {
  console.log(
    `\n${legacyOverlaps.length} açıklanmış örtüşme - yükleyici tekilleştirir ` +
      `(ilçesi olan kopya kazanır):`,
  );
  for (const item of legacyOverlaps.slice(0, 5)) console.log("  ~ " + item);
}
if (problems.length) {
  console.error(`\n${problems.length} sorun:`);
  for (const p of problems.slice(0, 40)) console.error("  ✗ " + p);
  if (problems.length > 40) console.error(`  ... ve ${problems.length - 40} tane daha`);
  process.exit(1);
}
console.log("✓ şema, sınırlar, mükerrerlik ve yayılım temiz");
