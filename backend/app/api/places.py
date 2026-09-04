"""The core discovery endpoints: search (radius or bbox, with filters),
place detail, and the community-contribution write paths (suggest a new
place, report an issue, verify a fact) - all three writes land as
pending/unapplied and go through moderation, never straight to the public
record (see app/models/signal.py and app/services/moderation.py)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import DbSession, DeviceTokenHash, OptionalUser
from app.core.ratelimit import limit_writes
from app.services.dedup import find_duplicate
from app.models.category import Category, PlaceCategory
from app.models.place import Place, PlaceStatus
from app.models.signal import PlaceReport, PlaceVerification, ReportType
from app.schemas.place import (
    PlaceDetail,
    PlaceListItem,
    PlaceReportIn,
    PlaceSuggestionIn,
    PlaceVerificationIn,
)
from app.services.moderation import create_place_report, create_place_suggestion, create_place_verification
from app.services.search import FILTERABLE_AMENITIES, PlaceSearchParams, search_places

router = APIRouter(prefix="/places", tags=["places"])


@router.get("", response_model=list[PlaceListItem])
def list_places(
    db: DbSession,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    radius_m: float | None = Query(default=None, gt=0, le=50_000),
    bbox: str | None = Query(default=None, description="min_lon,min_lat,max_lon,max_lat"),
    category: list[str] = Query(default=[]),
    amenity: list[str] = Query(default=[]),
    free_only: bool = Query(default=False),
    min_reliability: float | None = Query(default=None, ge=0, le=1),
    admin_region_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[PlaceListItem]:
    if (lat is None) != (lon is None):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "lat and lon must both be given or both omitted")
    if radius_m is not None and lat is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "radius_m requires lat/lon")

    parsed_bbox = None
    if bbox is not None:
        parts = bbox.split(",")
        if len(parts) != 4:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "bbox must be 'min_lon,min_lat,max_lon,max_lat'")
        try:
            parsed_bbox = tuple(float(p) for p in parts)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "bbox values must be numbers") from exc

    for a in amenity:
        if a not in FILTERABLE_AMENITIES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown amenity: {a!r}")

    params = PlaceSearchParams(
        lat=lat,
        lon=lon,
        radius_m=radius_m,
        bbox=parsed_bbox,
        category_slugs=category,
        amenities=amenity,
        is_free_only=free_only,
        min_reliability=min_reliability,
        admin_region_id=admin_region_id,
        limit=limit,
        offset=offset,
    )
    results = search_places(db, params)
    return [PlaceListItem.from_orm_with_distance(place, distance) for place, distance in results]


@router.get("/{place_id}", response_model=PlaceDetail)
def get_place(place_id: uuid.UUID, db: DbSession) -> PlaceDetail:
    place = db.get(Place, place_id)
    if place is None or place.status == PlaceStatus.pending_review:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "place not found")
    return PlaceDetail.from_orm_with_distance(place)


@router.post(
    "/suggest",
    status_code=status.HTTP_201_CREATED,
    response_model=PlaceDetail,
    dependencies=[Depends(limit_writes)],
)
def suggest_place(payload: PlaceSuggestionIn, db: DbSession, user: OptionalUser) -> PlaceDetail:
    categories = db.execute(select(Category).where(Category.slug.in_(payload.category_slugs))).scalars().all()
    found_slugs = {c.slug for c in categories}
    missing = set(payload.category_slugs) - found_slugs
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown category slug(s): {sorted(missing)}")

    # The dedup service existed but was never consulted on this path, so
    # every re-suggestion of a known place became a new pending row for a
    # moderator to untangle. A confident match answers 409 pointing at the
    # existing record - "verify or report that one" is the useful action.
    duplicate = find_duplicate(db, name=payload.name, lat=payload.lat, lon=payload.lon)
    if duplicate is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "message": "a very similar place already exists; verify or report it instead",
                "existing_place_id": str(duplicate.place.id),
                "existing_place_name": duplicate.place.name,
                "confidence": round(duplicate.confidence, 3),
                "distance_m": round(duplicate.distance_m, 1),
            },
        )

    place = create_place_suggestion(db, payload=payload, categories=categories, user=user)
    db.commit()
    db.refresh(place)
    return PlaceDetail.from_orm_with_distance(place)


@router.post(
    "/{place_id}/reports", status_code=status.HTTP_201_CREATED, dependencies=[Depends(limit_writes)]
)
def report_place(
    place_id: uuid.UUID, payload: PlaceReportIn, db: DbSession, user: OptionalUser, device: DeviceTokenHash
) -> dict:
    place = db.get(Place, place_id)
    if place is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "place not found")
    try:
        report_type = ReportType(payload.report_type)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown report_type (expected one of {[t.value for t in ReportType]})"
        ) from exc

    report = create_place_report(
        db, place=place, report_type=report_type, field=payload.field, note=payload.note, user=user,
        device_token_hash=device,
    )
    db.commit()
    return {"id": str(report.id), "status": report.status.value}


@router.post(
    "/{place_id}/verifications", status_code=status.HTTP_201_CREATED, dependencies=[Depends(limit_writes)]
)
def verify_place(
    place_id: uuid.UUID, payload: PlaceVerificationIn, db: DbSession, user: OptionalUser, device: DeviceTokenHash
) -> dict:
    place = db.get(Place, place_id)
    if place is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "place not found")
    if payload.field not in FILTERABLE_AMENITIES and payload.field not in ("is_active",):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown verifiable field: {payload.field!r}")

    verification = create_place_verification(
        db, place=place, field=payload.field, confirmed_value=payload.confirmed_value, user=user,
        device_token_hash=device,
    )
    db.commit()
    return {"id": str(verification.id), "reliability_score": place.reliability_score}
