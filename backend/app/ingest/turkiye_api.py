"""Seeds AdminRegion (country -> province -> district [-> neighborhood /
village]) from TurkiyeAPI (https://turkiyeapi.dev, github.com/ubeydeozdmr/
turkiye-api, MIT license - see docs/DATA_SOURCES.md), rather than
hand-modeling Turkey's administrative boundaries.

Default run seeds all 81 provinces + their districts - enough for the
brief's "infra must support all 81 il from day one" requirement without
pulling all ~32k neighborhoods / ~18k villages on every run. Neighborhood/
village-level seeding is opt-in (`--with-neighborhoods`) and scoped per
province, since the pilot rollout (İstanbul first) doesn't need every il's
mahalle data seeded up front - re-run this script per province as the
rollout expands; it's idempotent (matched by country_code+level+external_id)
so re-running never creates duplicates.

Run:
    uv run python -m app.ingest.turkiye_api
    uv run python -m app.ingest.turkiye_api --with-neighborhoods --province-id 34  # İstanbul only
"""

from __future__ import annotations

import argparse
import time

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.models.admin_region import AdminRegion, AdminRegionLevel

API_BASE = "https://api.turkiyeapi.dev/v2"
PAGE_SIZE = 200
REQUEST_TIMEOUT_S = 15.0


def _get_paginated(client: httpx.Client, path: str, params: dict) -> list[dict]:
    """TurkiyeAPI paginates via limit/offset; keep paging until a page
    comes back short of PAGE_SIZE rather than trusting an exact total-count
    field name we haven't independently verified against a live response."""
    results: list[dict] = []
    offset = 0
    while True:
        response = client.get(path, params={**params, "limit": PAGE_SIZE, "offset": offset}, timeout=REQUEST_TIMEOUT_S)
        response.raise_for_status()
        page = response.json().get("data", [])
        results.extend(page)
        if len(page) < PAGE_SIZE:
            return results
        offset += PAGE_SIZE
        time.sleep(0.1)  # gentle on a free public API


def _region_cache(db: Session) -> dict[tuple[str, AdminRegionLevel, str], AdminRegion]:
    existing = db.execute(select(AdminRegion).where(AdminRegion.external_id.is_not(None))).scalars().all()
    return {(r.country_code, r.level, r.external_id): r for r in existing}


def _upsert(
    db: Session,
    cache: dict[tuple[str, AdminRegionLevel, str], AdminRegion],
    *,
    level: AdminRegionLevel,
    name: str,
    external_id: str,
    parent: AdminRegion | None,
    population: int | None,
) -> AdminRegion:
    country_code = settings.active_country
    key = (country_code, level, external_id)
    region = cache.get(key)
    if region is None:
        region = AdminRegion(
            country_code=country_code,
            level=level,
            name=name,
            external_id=external_id,
            parent_id=parent.id if parent else None,
            population=population,
        )
        db.add(region)
        db.flush()  # need region.id if it becomes a parent for the next level in the same pass
        cache[key] = region
    else:
        region.name = name
        region.population = population
        region.parent_id = parent.id if parent else None
    return region


def import_provinces_and_districts(db: Session, *, only_province_id: int | None = None) -> None:
    cache = _region_cache(db)
    country = _upsert(
        db, cache, level=AdminRegionLevel.country, name="Türkiye",
        external_id=settings.active_country, parent=None, population=None,
    )

    with httpx.Client(base_url=API_BASE) as client:
        province_params = {"fields": "id,name,population"}
        if only_province_id is not None:
            province_params["id"] = only_province_id
        provinces = _get_paginated(client, "/provinces", province_params)

        for province_data in provinces:
            province = _upsert(
                db, cache, level=AdminRegionLevel.province, name=province_data["name"],
                external_id=str(province_data["id"]), parent=country,
                population=province_data.get("population"),
            )
            districts = _get_paginated(
                client, "/districts",
                {"provinceId": province_data["id"], "fields": "id,name,population"},
            )
            for district_data in districts:
                _upsert(
                    db, cache, level=AdminRegionLevel.district, name=district_data["name"],
                    external_id=str(district_data["id"]), parent=province,
                    population=district_data.get("population"),
                )
            db.commit()
            print(f"  {province_data['name']}: {len(districts)} ilçe")

    print(f"Toplam {len(provinces)} il işlendi.")


def import_neighborhoods_and_villages(db: Session, *, province_id: int) -> None:
    """Opt-in, per-province deep seed - see module docstring for why this
    isn't part of the default run."""
    cache = _region_cache(db)
    districts = db.execute(
        select(AdminRegion).where(
            AdminRegion.level == AdminRegionLevel.district,
            AdminRegion.parent_id == (
                select(AdminRegion.id)
                .where(AdminRegion.level == AdminRegionLevel.province, AdminRegion.external_id == str(province_id))
                .scalar_subquery()
            ),
        )
    ).scalars().all()
    if not districts:
        print(f"provinceId={province_id} için önce import_provinces_and_districts() çalıştırılmalı.")
        return

    with httpx.Client(base_url=API_BASE) as client:
        for district in districts:
            neighborhoods = _get_paginated(
                client, "/neighborhoods", {"districtId": district.external_id, "fields": "id,name,population"}
            )
            for n in neighborhoods:
                _upsert(
                    db, cache, level=AdminRegionLevel.neighborhood, name=n["name"],
                    external_id=str(n["id"]), parent=district, population=n.get("population"),
                )
            villages = _get_paginated(
                client, "/villages", {"districtId": district.external_id, "fields": "id,name,population"}
            )
            for v in villages:
                _upsert(
                    db, cache, level=AdminRegionLevel.village, name=v["name"],
                    external_id=str(v["id"]), parent=district, population=v.get("population"),
                )
            db.commit()
            print(f"  {district.name}: {len(neighborhoods)} mahalle, {len(villages)} köy")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--with-neighborhoods", action="store_true", help="Also seed mahalle/köy level (slow, opt-in)")
    parser.add_argument("--province-id", type=int, default=None, help="Limit to one province's TurkiyeAPI id (e.g. 34 for İstanbul)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        import_provinces_and_districts(db, only_province_id=args.province_id)
        if args.with_neighborhoods:
            if args.province_id is None:
                print("--with-neighborhoods tüm 81 il için önerilmez; --province-id ile sınırlayın.")
                return
            import_neighborhoods_and_villages(db, province_id=args.province_id)
    finally:
        db.close()


if __name__ == "__main__":
    main()
