"""Spatial enrichment pass over the fetched İstanbul snapshot.

Why this exists: OpenStreetMap models a park and the drinking fountain inside
it as two separate objects. Both are correct, and both should stay separate
places (you might specifically want the fountain). But the product's core
promise - "Kadıköy Parkı: park + çocuk alanı + tuvalet + su + oturma" - is
about what a place *offers*, and a park that contains a fountain genuinely
does offer drinking water.

So: containers (parks, sports areas) inherit **amenity flags** from the
facilities physically inside them. Categories are NOT merged - the fountain
does not become a park and the park does not become a fountain. This is
exactly the category-vs-amenity split the data model was designed around
(see backend/app/models/place.py's module docstring).

Enrichment is provenance-tagged (`enriched_from`) so the UI can distinguish
"OSM says this park has water" from "we inferred it from a fountain 40m
inside the park", and so the whole pass is reversible/re-runnable.

Run: uv run --no-project python scripts/enrich_demo_data.py
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(__file__).resolve().parent.parent / "frontend" / "data"


def dataset_files() -> list[Path]:
    """Every city snapshot. Enrichment is per-city by construction - a park
    in İzmir can only contain facilities in İzmir - so each file is processed
    independently and adding a city needs no change here."""
    return sorted(DATA_DIR.glob("places.*.json"))

# Categories that act as "containers" - large areas a user visits, which can
# reasonably own facilities located inside them.
CONTAINER_CATEGORIES = {"park", "spor"}

# How close a facility must be to a container's center to count as "inside
# it". OSM gives us way centers, not polygons, so this is a radius around the
# centroid rather than true point-in-polygon. 120m is deliberately
# conservative: it captures facilities in a typical neighbourhood park
# without swallowing everything across the street.
CONTAINMENT_RADIUS_M = 120.0

# facility category -> the amenity flag it grants its container
CATEGORY_TO_AMENITY = {
    "tuvalet": "wheelchair_accessible_unused",  # handled specially below
    "su": "has_drinking_water",
    "dinlenme": "has_seating",
    "cocuk-alani": "child_friendly",
    "dus": "has_shower",
    "wifi": "has_wifi",
    "otopark": "has_parking",
}

EARTH_RADIUS_M = 6_371_000


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def grid_key(lat: float, lon: float) -> tuple[int, int]:
    """~150m buckets. A full O(n²) pass over 4.5k places is 20M haversine
    calls; bucketing makes it a few hundred thousand."""
    return (int(lat / 0.0015), int(lon / 0.0015))


def enrich_file(data_path: Path) -> tuple[int, int, int]:
    dataset = json.loads(data_path.read_text(encoding="utf-8"))
    places = dataset["places"]

    buckets: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for place in places:
        buckets[grid_key(place["lat"], place["lon"])].append(place)

    containers = [p for p in places if any(c in CONTAINER_CATEGORIES for c in p["categories"])]

    enriched_count = 0
    flags_added = 0

    for container in containers:
        key = grid_key(container["lat"], container["lon"])
        nearby: list[dict] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nearby.extend(buckets.get((key[0] + dx, key[1] + dy), []))

        granted: dict[str, str] = {}
        has_toilet_inside = False

        for candidate in nearby:
            if candidate["id"] == container["id"]:
                continue
            distance = haversine_m(container["lat"], container["lon"], candidate["lat"], candidate["lon"])
            if distance > CONTAINMENT_RADIUS_M:
                continue

            for category in candidate["categories"]:
                if category == "tuvalet":
                    has_toilet_inside = True
                    granted.setdefault("has_toilet_nearby", candidate["id"])
                    continue
                amenity = CATEGORY_TO_AMENITY.get(category)
                if not amenity or amenity.endswith("_unused"):
                    continue
                # Never overwrite a value OSM stated explicitly - an inferred
                # flag is weaker evidence than a mapped tag.
                if container["amenities"].get(amenity) is None:
                    container["amenities"][amenity] = True
                    granted.setdefault(amenity, candidate["id"])
                    flags_added += 1

        if granted:
            container["enriched_from"] = granted
            if has_toilet_inside:
                # Not an amenity column in the schema - kept as an explicit
                # extra field the detail page can surface as "İçinde tuvalet var".
                container["has_toilet_inside"] = True
            enriched_count += 1

    multi_feature = [
        p
        for p in places
        if sum(1 for value in p["amenities"].values() if value is True) >= 3
    ]

    dataset["enrichment"] = {
        "containment_radius_m": CONTAINMENT_RADIUS_M,
        "enriched_places": enriched_count,
        "flags_added": flags_added,
        "note": (
            "Konteyner mekanlar (park/spor alanı), 120m yarıçapındaki tesislerden "
            "amenity bayrağı devraldı. Kategoriler birleştirilmedi; OSM'in açıkça "
            "belirttiği değerlerin üzerine yazılmadı."
        ),
    }

    data_path.write_text(json.dumps(dataset, ensure_ascii=False), encoding="utf-8")
    return enriched_count, flags_added, len(multi_feature)


def main() -> None:
    files = dataset_files()
    if not files:
        print("frontend/data/ içinde places.*.json yok - önce fetch_demo_data.py çalıştırın.")
        return

    totals = [0, 0, 0]
    for data_path in files:
        enriched, flags, multi = enrich_file(data_path)
        totals = [totals[0] + enriched, totals[1] + flags, totals[2] + multi]
        print(f"  {data_path.name}: {enriched} mekan zenginleştirildi, {flags} bayrak eklendi")

    print(f"\n✓ Toplam {totals[0]} mekan zenginleştirildi, {totals[1]} amenity bayrağı eklendi")
    print(f"  {totals[2]} mekan 3+ özelliğe sahip (çoklu-özellik modeli görünür)")


if __name__ == "__main__":
    main()
