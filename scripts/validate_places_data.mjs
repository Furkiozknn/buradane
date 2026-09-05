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
const seenIds = new Map(); // id -> first file
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
    if (first && first !== file) problems.push(`MÜKERRER: ${p.id} hem ${first} hem ${file} içinde`);
    else seenIds.set(p.id, file);
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

console.log(`${files.length} il dosyası, ${total} mekan, ${seenIds.size} benzersiz id`);
if (problems.length) {
  console.error(`\n${problems.length} sorun:`);
  for (const p of problems.slice(0, 40)) console.error("  ✗ " + p);
  if (problems.length > 40) console.error(`  ... ve ${problems.length - 40} tane daha`);
  process.exit(1);
}
console.log("✓ şema, sınırlar, mükerrerlik ve yayılım temiz");
