// Builds frontend/data/meta.json: one small row per province.
//
// Why this file has to exist. The reader used to answer `datasetMeta()` -
// which province files exist, how many places each holds, where the map
// should open - by parsing all 81 snapshots. That was free when the
// snapshots were city boxes. It is not free now: measured at 122.558
// places, loading them all costs **7,4 seconds and 433 MB of RSS**, and
// Next.js pays it twice (the route-handler graph and the RSC graph are
// separate module registries, each with its own cache). Every visitor who
// arrives on a cold process waits for the whole country to be read so the
// app can put a city name in a chip.
//
// meta.json is the answer to that: ~81 rows, a few kilobytes, enough for
// the picker, the coverage display and - crucially - the province BBOX, so
// a radius or viewport query can work out which one to three files it
// actually needs and read only those.
//
// Regenerate after any fetch:
//   node scripts/build_dataset_meta.mjs
//
// It is committed because it is derived from committed data and the app
// must work on a fresh clone with no build step. `npm test` fails loudly if
// it has drifted from the snapshots.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend", "data");
const OUT = path.join(DATA_DIR, "meta.json");
const INDEX_OUT = path.join(DATA_DIR, "place-index.json");

const files = fs
  .readdirSync(DATA_DIR)
  .filter((f) => f.startsWith("places.") && f.endsWith(".json"))
  .sort();

const provinces = [];
// Counted as DISTINCT ids, not as a sum of file lengths. Overpass returns a
// way that crosses a provincial boundary to both provinces' queries, so a
// handful of records appear in two files; the loader keeps one (the copy
// that landed inside a district - see places-repository.ts) and the number
// the UI shows has to be the number the app actually holds. Summing file
// lengths would overstate it by exactly those border cases.
const distinctIds = new Set();
// id -> index into `provinces`. Only ever read when a place is looked up by
// id and is not already in memory - see getPlaceById. Without it that miss
// costs a full national load (~15 s, ~400 MB), which any crawler could
// trigger with one bogus /yer/<id> URL.
const placeIndex = {};
const indexedHasDistrict = {};
// Distinct-id guard so a border-crossing way is not counted twice.
const countedForCategories = new Set();
// Per-province distinct ids, so the city picker's "N kayıtlı yer" matches
// what the app actually holds - summing file lengths over-reported the
// seven provinces that share a border-crossing way.
const provinceIds = [];
// National per-category totals. Fourteen numbers, so that the admin
// dashboard can show the distribution without loading 167.829 records: it
// used to call allPlaces() on every request behind `force-dynamic`, which
// measured 26,7 seconds and blocked every other user on the box for the
// duration - on a page that requires no token to render.
const categoryTotals = {};
let newest = "";
let attribution = "© OpenStreetMap katkıda bulunanları";
let license = "ODbL 1.0";
let source = "OpenStreetMap via Overpass API";

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
  const slug = data.city ?? file.slice("places.".length, -".json".length);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of data.places) {
    distinctIds.add(p.id);
    if (!countedForCategories.has(p.id)) {
      countedForCategories.add(p.id);
      for (const slug of p.categories ?? []) {
        categoryTotals[slug] = (categoryTotals[slug] ?? 0) + 1;
      }
    }
    // The copy WITH a district wins, exactly as the loader decides it
    // (places-repository.ts). First-file-wins disagreed with the loader for
    // the border-crossing ways, so the same place reported a different il
    // and ilçe depending on whether you reached it by id or by viewport.
    const seenAt = placeIndex[p.id];
    if (seenAt === undefined || (p.district_raw && !indexedHasDistrict[p.id])) {
      placeIndex[p.id] = provinces.length;
      indexedHasDistrict[p.id] = Boolean(p.district_raw);
    }
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // Districts that actually HAVE data, with where to open the map and how
  // much is there. The app can now offer ilçe selection because every
  // record carries one - and in a province like İstanbul (25.916 places)
  // the province centre is not a useful place to open: somebody in Kadıköy
  // had to pan there by hand. Counted and centred from the records
  // themselves rather than from admin-divisions.json, so a district with no
  // data is simply absent instead of being offered and then empty.
  const districts = new Map();
  for (const p of data.places) {
    if (!p.district_raw) continue;
    let d = districts.get(p.district_raw);
    if (!d) districts.set(p.district_raw, (d = { name: p.district_raw, count: 0, lats: [], lons: [] }));
    d.count += 1;
    d.lats.push(p.lat);
    d.lons.push(p.lon);
  }
  const districtRows = [...districts.values()]
    .map((d) => {
      // Median, not mean: one mis-tagged node on the far side of the
      // district would drag an average out of it entirely.
      const lats = d.lats.sort((a, b) => a - b);
      const lons = d.lons.sort((a, b) => a - b);
      const mid = Math.floor(lats.length / 2);
      return { name: d.name, count: d.count, center: { lat: lats[mid], lon: lons[mid] } };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  provinceIds.push(new Set(data.places.map((p) => p.id)).size);
  provinces.push({
    slug,
    label: data.city_label ?? slug,
    count: provinceIds[provinceIds.length - 1],
    fetch_unit: data.fetch_unit ?? "legacy_bbox",
    // The extent of this province's OWN records. A query whose search box
    // misses this rectangle cannot match anything in the file, which is the
    // whole point: it is the cheapest possible "do I need to read this?".
    bbox: { minLat, minLon, maxLat, maxLon },
    districts: districtRows,
  });

  if (data.generated_at > newest) newest = data.generated_at;
  attribution = data.attribution ?? attribution;
  license = data.license ?? license;
  source = data.source ?? source;
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      generated_at: newest,
      source,
      license,
      attribution,
      count: distinctIds.size,
      categoryTotals,
      provinces,
    },
    null,
    1,
  ),
  "utf-8",
);

fs.writeFileSync(
  INDEX_OUT,
  JSON.stringify({ provinces: provinces.map((p) => p.slug), ids: placeIndex }),
  "utf-8",
);

console.log(
  `meta.json: ${provinces.length} il, ${distinctIds.size} mekan (benzersiz), ` +
    `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`,
);
console.log(
  `place-index.json: ${Object.keys(placeIndex).length} id, ` +
    `${(fs.statSync(INDEX_OUT).size / 1048576).toFixed(1)} MB`,
);
