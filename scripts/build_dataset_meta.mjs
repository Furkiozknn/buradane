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
    // First file wins, matching the loader's own preference order closely
    // enough for a lookup hint: the record is read from that province and
    // the dedupe rule then applies as usual.
    if (!(p.id in placeIndex)) placeIndex[p.id] = provinces.length;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  provinces.push({
    slug,
    label: data.city_label ?? slug,
    count: data.places.length,
    fetch_unit: data.fetch_unit ?? "legacy_bbox",
    // The extent of this province's OWN records. A query whose search box
    // misses this rectangle cannot match anything in the file, which is the
    // whole point: it is the cheapest possible "do I need to read this?".
    bbox: { minLat, minLon, maxLat, maxLon },
  });

  if (data.generated_at > newest) newest = data.generated_at;
  attribution = data.attribution ?? attribution;
  license = data.license ?? license;
  source = data.source ?? source;
}

fs.writeFileSync(
  OUT,
  JSON.stringify(
    { generated_at: newest, source, license, attribution, count: distinctIds.size, provinces },
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
