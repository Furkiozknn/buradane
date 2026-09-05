"""Fetch Türkiye's administrative divisions (81 il, 973 ilçe) from OSM.

Why this exists: the app needs the district list, and writing 973 names from
memory would produce a list nobody can verify (see the reasoning in
frontend/src/lib/administrative.ts). OSM's admin_level=4 (il) and
admin_level=6 (ilçe) boundary relations ARE the checkable source, and this
script pulls names and centre points only - no geometry - so the whole
national output is a few hundred kilobytes.

The result serves two consumers:

1. frontend/data/admin-divisions.json - district resolution, coverage
   display, and (later) per-ilçe anything.
2. scripts/fetch_demo_data.py - remaining provinces' fetch bboxes are
   generated from these centres instead of being typed from memory, which is
   how 62 hand-written bounding boxes would otherwise each become a chance
   to drop a city in a field.

Districts are fetched per-province (81 small area queries) rather than in
one national query, because a district relation does not name its province
in its own tags - containment IS the parent relationship, and asking "level
6 inside this level 4 area" is the query shape that encodes it.

Usage:
    uv run python scripts/fetch_admin_divisions.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows cp1254 console

# Reuse the query runner (mirror rotation + exponential backoff) rather than
# growing a second, slightly different copy of the same resilience code.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_demo_data import run_query  # noqa: E402

OUT_PATH = Path(__file__).resolve().parent.parent / "frontend" / "data" / "admin-divisions.json"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".overpass-cache" / "_admin"

EXPECTED_PROVINCES = 81
EXPECTED_DISTRICTS = 973

# Relations that pass the level-6 query inside a Turkish province's area but
# are not districts. Every entry is an observed, verified case - never a
# guess - and the right long-term fix is upstream in OSM, not here.
NOT_DISTRICTS = {
    # A small island off Bodrum someone tagged admin_level=6. Türkiye's
    # official register has no such district; with it (and the Greek overlap
    # below) the national count read 975 instead of 973.
    19258534,  # "Kara Ada", inside Muğla's area
}


def _looks_greek(name: str) -> bool:
    # Aegean overlap: Greek regional units (Kalymnos) satisfy the area
    # containment for coastal provinces. Turkish district names never use
    # Greek script, so the script itself is the honest discriminator.
    return any("Ͱ" <= ch <= "Ͽ" or "ἀ" <= ch <= "῿" for ch in name)


def fetch_provinces() -> list[dict]:
    """Provinces with their capital-city anchor, not their polygon centroid.

    The relation's own ``center`` is the centroid of the whole province
    polygon, which for oddly shaped provinces lands nowhere near the
    provincial capital - Antalya's centroid is in the mountains. These
    centres feed the place-fetch bounding boxes downstream, so anchoring on
    the ``admin_centre`` member node (the capital) is the difference between
    fetching a city and fetching forest. Centroid stays as the fallback for
    any relation missing the member, flagged in the output.
    """
    # ISO3166-2 filter, not just area containment: the Aegean's Greek
    # decentralised administration overlaps Türkiye's area enough for the
    # bare containment query to return it as an 82nd "province" (found by
    # the count check, exactly the mismatch it exists to catch). Turkish
    # provinces all carry ISO3166-2 codes of the form TR-xx; nothing Greek
    # does.
    query = """
[out:json][timeout:180];
area["ISO3166-1"="TR"][admin_level=2]->.tr;
relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"~"^TR-"](area.tr)->.il;
.il out body center;
node(r.il:"admin_centre");
out;
"""
    elements = run_query(query)

    nodes = {el["id"]: el for el in elements if el.get("type") == "node"}
    provinces = []
    for el in elements:
        if el.get("type") != "relation":
            continue
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue

        admin_centre_id = next(
            (m.get("ref") for m in el.get("members", []) if m.get("role") == "admin_centre"),
            None,
        )
        centre_node = nodes.get(admin_centre_id) if admin_centre_id else None
        if centre_node:
            center = {"lat": centre_node["lat"], "lon": centre_node["lon"]}
            anchored = True
        elif el.get("center"):
            center = {"lat": el["center"]["lat"], "lon": el["center"]["lon"]}
            anchored = False
        else:
            continue

        provinces.append(
            {
                "name": name,
                "osm_relation": el["id"],
                "center": center,
                # False means "polygon centroid, treat with suspicion".
                "center_is_capital": anchored,
            }
        )
    provinces.sort(key=lambda p: p["name"])
    return provinces


def fetch_districts(province: dict) -> list[dict]:
    """One small query per province, checkpointed - 81 requests against a
    rate-limited free API will get interrupted sooner or later, and losing
    the 60 provinces already fetched to a 429 on the 61st is the exact
    failure the place fetcher already learned to avoid."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{province['osm_relation']}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    # Area id for a relation is relation id + 3600000000 (Overpass convention).
    area_id = 3600000000 + province["osm_relation"]
    query = f"""
[out:json][timeout:90];
relation["boundary"="administrative"]["admin_level"="6"](area:{area_id});
out tags center;
"""
    elements = run_query(query)

    # A transient mirror hiccup can yield an HTTP-200 empty result, and the
    # first national run cached exactly that for three provinces - Düzce,
    # Eskişehir and Çorum froze at zero districts and the count check
    # flagged a 34-district hole. No Turkish province has zero districts,
    # so empty is treated as failure: first retry through the il relation's
    # own subarea members (the districts are members of the province
    # relation), and if that is empty too, raise rather than cache a lie.
    if not elements:
        subarea_query = f"""
[out:json][timeout:60];
relation({province['osm_relation']});
relation(r);
out tags center;
"""
        elements = [
            el
            for el in run_query(subarea_query)
            if el.get("tags", {}).get("admin_level") == "6"
        ]
    if not elements:
        raise RuntimeError(
            f"{province['name']}: ilçe sorgusu iki yöntemle de boş döndü - "
            "önbelleğe boş liste yazmak 34 ilçelik sessiz bir delik açar"
        )

    districts = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name")
        center = el.get("center")
        if not name or not center:
            continue
        if el["id"] in NOT_DISTRICTS or _looks_greek(name):
            print(f"    - dışlandı (ilçe değil): {name} (rel {el['id']})")
            continue
        districts.append(
            {
                "name": name,
                "osm_relation": el["id"],
                "center": {"lat": center["lat"], "lon": center["lon"]},
            }
        )
    districts.sort(key=lambda d: d["name"])
    cache_file.write_text(json.dumps(districts, ensure_ascii=False), encoding="utf-8")
    return districts


def main() -> None:
    print("İl sınırları çekiliyor (admin_level=4)...")
    provinces = fetch_provinces()
    print(f"  {len(provinces)} il bulundu (beklenen {EXPECTED_PROVINCES})")

    total_districts = 0
    for index, province in enumerate(provinces, 1):
        districts = fetch_districts(province)
        province["districts"] = districts
        total_districts += len(districts)
        print(f"  [{index:2}/{len(provinces)}] {province['name']:20} {len(districts):3} ilçe")
        time.sleep(3)  # polite; these are tiny queries but there are 81 of them

    OUT_PATH.write_text(
        json.dumps(
            {
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source": "OpenStreetMap admin boundaries via Overpass API",
                "license": "ODbL 1.0",
                "attribution": "© OpenStreetMap katkıda bulunanları",
                "expected": {"provinces": EXPECTED_PROVINCES, "districts": EXPECTED_DISTRICTS},
                "counts": {"provinces": len(provinces), "districts": total_districts},
                "provinces": provinces,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )

    print(f"\n✓ {len(provinces)} il, {total_districts} ilçe → {OUT_PATH.name}")
    if len(provinces) != EXPECTED_PROVINCES or total_districts != EXPECTED_DISTRICTS:
        # A mismatch is information, not necessarily an error: OSM sometimes
        # maps merkez ilçe boundaries differently, or a boundary is briefly
        # broken upstream. Say it loudly and let a human decide.
        print(
            f"! Beklenenden farklı: {len(provinces)}/{EXPECTED_PROVINCES} il, "
            f"{total_districts}/{EXPECTED_DISTRICTS} ilçe. Fark incelenmeli."
        )


if __name__ == "__main__":
    main()
