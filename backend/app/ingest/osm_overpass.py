"""Pulls the İstanbul pilot dataset from OpenStreetMap's Overpass API and
upserts it into `places`, respecting the brief's requirements: every
ingested place carries source/license metadata (via DataSource +
PlaceSourceRecord), and an incoming OSM element that matches an existing
Place (by app/services/dedup.py's spatial+name scoring) merges into it as a
new source record rather than creating a duplicate.

License: OpenStreetMap data is ODbL 1.0 (https://opendatacommons.org/
licenses/odbl/1-0/) - see docs/DATA_SOURCES.md. This script only *reads*
public Overpass output; no OSM data is redistributed as a standalone
download by this project, only served back through buradane's own API with
attribution, which satisfies ODbL's attribution/share-alike terms for
derived-database use.

Category <-> OSM tag matching is driven entirely by Category.osm_tag_mappings
(seeded by app/ingest/seed_categories.py) rather than hardcoded here, so
adding a category with new OSM tags automatically extends what this script
ingests next run - no code change needed.

Run:
    uv run python -m app.ingest.osm_overpass
    uv run python -m app.ingest.osm_overpass --bbox 40.95,28.90,41.10,29.10  # smaller test area
"""

from __future__ import annotations

import argparse

import httpx
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.models.category import Category, PlaceCategory
from app.models.data_source import DataSource, DataSourceType, PlaceSourceRecord
from app.models.place import Place, PlaceStatus, PriceType
from app.services.dedup import find_duplicate
from app.services.reliability import ReliabilityInputs, compute_reliability_score

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
REQUEST_TIMEOUT_S = 90.0

# South, West, North, East - generously covers İstanbul province including
# Silivri in the west and Şile in the east, better a little over-inclusive
# than clipping real places at the province edge.
ISTANBUL_BBOX = (40.75, 27.85, 41.70, 29.95)

OSM_SOURCE_SLUG = "osm"


def _parse_tag_hint(hint: str) -> tuple[tuple[str, str], list[tuple[str, str]]]:
    """"amenity=toilets;wheelchair=yes" -> (("amenity","toilets"), [("wheelchair","yes")]).
    A modifier segment without a bare "key=value" shape (e.g. "shelter",
    "capacity:disabled>0") is dropped rather than guessed at - it just
    means that category is only matched on its primary tag, a safe
    under-match rather than a wrong over/under exclusion."""
    parts = [p.strip() for p in hint.split(";") if p.strip()]
    key, _, value = parts[0].partition("=")
    modifiers = []
    for part in parts[1:]:
        if "=" in part:
            mk, mv = part.split("=", 1)
            modifiers.append((mk.strip(), mv.strip()))
    return (key.strip(), value.strip()), modifiers


def _build_category_index(categories: list[Category]) -> dict[tuple[str, str], list[tuple[Category, list[tuple[str, str]]]]]:
    """primary (key, value) -> [(category, modifier conditions), ...]"""
    index: dict[tuple[str, str], list[tuple[Category, list[tuple[str, str]]]]] = {}
    for category in categories:
        for hint in category.osm_tag_mappings:
            primary, modifiers = _parse_tag_hint(hint)
            index.setdefault(primary, []).append((category, modifiers))
    return index


def _build_overpass_query(tag_keys: list[tuple[str, str]], bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    clauses = []
    for key, value in tag_keys:
        clauses.append(f'  node["{key}"="{value}"]({south},{west},{north},{east});')
        clauses.append(f'  way["{key}"="{value}"]({south},{west},{north},{east});')
    body = "\n".join(clauses)
    return f"[out:json][timeout:60];\n(\n{body}\n);\nout center tags;"


def _matching_categories(
    element_tags: dict[str, str],
    category_index: dict[tuple[str, str], list[tuple[Category, list[tuple[str, str]]]]],
) -> list[Category]:
    matched: dict[str, Category] = {}
    for (key, value), entries in category_index.items():
        if element_tags.get(key) != value:
            continue
        for category, modifiers in entries:
            if all(element_tags.get(mk) == mv for mk, mv in modifiers):
                matched[category.slug] = category
    return list(matched.values())


def _get_or_create_osm_source(db: Session) -> DataSource:
    source = db.execute(select(DataSource).where(DataSource.slug == OSM_SOURCE_SLUG)).scalar_one_or_none()
    if source is None:
        source = DataSource(
            slug=OSM_SOURCE_SLUG,
            name="OpenStreetMap",
            source_type=DataSourceType.openstreetmap,
            license="ODbL 1.0",
            license_url="https://opendatacommons.org/licenses/odbl/1-0/",
            homepage_url="https://www.openstreetmap.org",
            api_url="https://overpass-api.de/api/interpreter",
            reliability_weight=0.75,
        )
        db.add(source)
        db.flush()
    return source


def _apply_amenity_hints(place: Place, tags: dict[str, str]) -> None:
    """A small, deliberately conservative set of OSM tags that map cleanly
    onto Place's first-class amenity columns - see place.py's module
    docstring for why only well-known, high-value flags are promoted like
    this rather than every OSM tag."""
    if "wheelchair" in tags:
        place.wheelchair_accessible = {"yes": True, "no": False}.get(tags["wheelchair"])
    if tags.get("drinking_water") == "yes":
        place.has_drinking_water = True
    elif tags.get("drinking_water") == "no":
        place.has_drinking_water = False
    if "fee" in tags:
        place.price_type = PriceType.paid if tags["fee"] == "yes" else PriceType.free if tags["fee"] == "no" else place.price_type
    if "opening_hours" in tags:
        place.opening_hours_raw = tags["opening_hours"][:300]
    if tags.get("internet_access") == "wlan":
        place.has_wifi = True


def import_istanbul_pilot(db: Session, *, bbox: tuple[float, float, float, float] = ISTANBUL_BBOX) -> None:
    # Filtered in Python, not SQL - JSONB-vs-list-literal comparison isn't a
    # reliable equality check across backends, and the categories table is
    # small enough that pulling all of them and filtering here is cheap.
    all_categories = db.execute(select(Category)).scalars().all()
    categories = [c for c in all_categories if c.osm_tag_mappings]
    if not categories:
        print("Hiç kategori bulunamadı - önce `python -m app.ingest.seed_categories` çalıştırın.")
        return

    category_index = _build_category_index(categories)
    query = _build_overpass_query(list(category_index.keys()), bbox)

    print(f"Overpass sorgusu gönderiliyor ({len(category_index)} etiket türü)...")
    response = httpx.post(OVERPASS_URL, data={"data": query}, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    elements = response.json().get("elements", [])
    print(f"{len(elements)} OSM elemanı alındı.")

    osm_source = _get_or_create_osm_source(db)
    created, merged, skipped = 0, 0, 0

    for element in elements:
        tags = element.get("tags", {})
        if element["type"] == "node":
            lat, lon = element.get("lat"), element.get("lon")
        else:
            center = element.get("center")
            if not center:
                skipped += 1
                continue
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            skipped += 1
            continue

        matched_categories = _matching_categories(tags, category_index)
        if not matched_categories:
            skipped += 1
            continue

        name = tags.get("name") or f"İsimsiz {matched_categories[0].name_tr}"
        external_id = f"{element['type']}/{element['id']}"

        existing_record = db.execute(
            select(PlaceSourceRecord).where(
                PlaceSourceRecord.data_source_id == osm_source.id,
                PlaceSourceRecord.external_id == external_id,
            )
        ).scalar_one_or_none()

        if existing_record is not None:
            place = existing_record.place
            existing_record.raw_data = tags
        else:
            dup = find_duplicate(db, name=name, lat=lat, lon=lon)
            if dup is not None:
                place = dup.place
                merged += 1
            else:
                place = Place(
                    name=name,
                    location=from_shape(Point(lon, lat), srid=4326),
                    country_code=settings.active_country,
                    status=PlaceStatus.active,
                    tags=tags,
                )
                db.add(place)
                db.flush()
                created += 1
            db.add(PlaceSourceRecord(place_id=place.id, data_source_id=osm_source.id, external_id=external_id, raw_data=tags))

        _apply_amenity_hints(place, tags)

        existing_category_ids = {pc.category_id for pc in place.place_categories}
        for i, category in enumerate(matched_categories):
            if category.id in existing_category_ids:
                continue
            db.add(PlaceCategory(place_id=place.id, category_id=category.id, is_primary=(i == 0 and not existing_category_ids)))

        place.reliability_score = compute_reliability_score(
            ReliabilityInputs(
                source_weights=[osm_source.reliability_weight],
                last_verified_at=place.last_verified_at,
                last_reported_at=place.last_reported_at,
                recent_verification_count=0,
                pending_conflicting_reports=0,
                has_photos=False,
                stale_after_days=settings.stale_after_days,
            )
        )

    db.commit()
    print(f"Bitti: {created} yeni yer, {merged} mevcut yerle birleştirildi, {skipped} eleman atlandı.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bbox", type=str, default=None, help="south,west,north,east - default: İstanbul province")
    args = parser.parse_args()
    bbox = tuple(float(x) for x in args.bbox.split(",")) if args.bbox else ISTANBUL_BBOX

    db = SessionLocal()
    try:
        import_istanbul_pilot(db, bbox=bbox)  # type: ignore[arg-type]
    finally:
        db.close()


if __name__ == "__main__":
    main()
