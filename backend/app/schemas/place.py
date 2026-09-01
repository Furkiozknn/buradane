"""API request/response shapes. Kept separate from the ORM models
(app/models/) on purpose - the DB schema is free to evolve (new amenity
columns, new source metadata) without silently changing the public API
contract, and vice versa."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.place import PlaceStatus, PriceType
from app.services.reliability import freshness_label


class CategoryOut(BaseModel):
    id: uuid.UUID
    slug: str
    name_tr: str
    name_en: str
    icon: str | None = None

    model_config = {"from_attributes": True}


class PlaceListItem(BaseModel):
    """The compact shape used in list/nearby/map results - deliberately
    smaller than PlaceDetail so a viewport with hundreds of markers doesn't
    ship full descriptions/tags/reviews for every one of them."""

    id: uuid.UUID
    name: str
    lat: float
    lon: float
    categories: list[CategoryOut]
    status: PlaceStatus
    price_type: PriceType
    wheelchair_accessible: bool | None
    distance_m: float | None = None  # only populated for radius-based ("yakınımda") searches
    reliability_score: float
    freshness_label: str

    @classmethod
    def from_orm_with_distance(cls, place, distance_m: float | None = None) -> "PlaceListItem":
        from geoalchemy2.shape import to_shape

        point = to_shape(place.location)
        return cls(
            id=place.id,
            name=place.name,
            lat=point.y,
            lon=point.x,
            categories=[CategoryOut.model_validate(pc.category) for pc in place.place_categories],
            status=place.status,
            price_type=place.price_type,
            wheelchair_accessible=place.wheelchair_accessible,
            distance_m=distance_m,
            reliability_score=place.reliability_score,
            freshness_label=freshness_label(place.last_verified_at),
        )


class PlaceDetail(PlaceListItem):
    description: str | None
    address_line: str | None
    website: str | None
    phone: str | None
    opening_hours_raw: str | None
    is_24h: bool | None
    price_note: str | None

    has_ramp: bool | None
    has_elevator: bool | None
    baby_changing: bool | None
    child_friendly: bool | None
    pet_friendly: bool | None
    has_drinking_water: bool | None
    has_wifi: bool | None
    has_shower: bool | None
    has_seating: bool | None
    has_shade: bool | None
    has_parking: bool | None
    near_public_transport: bool | None
    is_quiet: bool | None

    last_verified_at: datetime | None
    last_reported_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_with_distance(cls, place, distance_m: float | None = None) -> "PlaceDetail":
        from geoalchemy2.shape import to_shape

        point = to_shape(place.location)
        return cls(
            id=place.id,
            name=place.name,
            description=place.description,
            lat=point.y,
            lon=point.x,
            address_line=place.address_line,
            website=place.website,
            phone=place.phone,
            opening_hours_raw=place.opening_hours_raw,
            is_24h=place.is_24h,
            price_type=place.price_type,
            price_note=place.price_note,
            categories=[CategoryOut.model_validate(pc.category) for pc in place.place_categories],
            status=place.status,
            wheelchair_accessible=place.wheelchair_accessible,
            has_ramp=place.has_ramp,
            has_elevator=place.has_elevator,
            baby_changing=place.baby_changing,
            child_friendly=place.child_friendly,
            pet_friendly=place.pet_friendly,
            has_drinking_water=place.has_drinking_water,
            has_wifi=place.has_wifi,
            has_shower=place.has_shower,
            has_seating=place.has_seating,
            has_shade=place.has_shade,
            has_parking=place.has_parking,
            near_public_transport=place.near_public_transport,
            is_quiet=place.is_quiet,
            distance_m=distance_m,
            reliability_score=place.reliability_score,
            freshness_label=freshness_label(place.last_verified_at),
            last_verified_at=place.last_verified_at,
            last_reported_at=place.last_reported_at,
            created_at=place.created_at,
            updated_at=place.updated_at,
        )


class PlaceSuggestionIn(BaseModel):
    """A user proposing a brand-new place - lands as status=pending_review,
    never directly published (brief: moderation before publish)."""

    name: str = Field(min_length=2, max_length=300)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    category_slugs: list[str] = Field(min_length=1)
    description: str | None = None
    address_line: str | None = None
    note: str | None = None


class PlaceReportIn(BaseModel):
    """A status-change signal on an existing place - "kapalı", "çeşme
    çalışmıyor", etc. Also moderated (see app/models/signal.py)."""

    report_type: str
    field: str | None = None
    note: str | None = None


class PlaceVerificationIn(BaseModel):
    field: str
    confirmed_value: bool
