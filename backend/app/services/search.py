"""Geospatial + filtered place search - the query layer everything else
(nearby, map viewport, category browsing, need-based search) is built on.

Uses PostGIS's `ST_DWithin` on a Geography column (see Place.location) for
radius search - this is index-accelerated via the GiST index on that
column (see Place.__table_args__), not a Python-side haversine loop, so it
stays fast as the place count grows toward Turkey scale.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_Distance, ST_DWithin, ST_MakeEnvelope, ST_MakePoint, ST_SetSRID, ST_Within
from sqlalchemy import Float, cast, null, select
from sqlalchemy.orm import Session, selectinload

from app.models.category import Category, PlaceCategory
from app.models.place import Place, PlaceStatus

# Amenity flags queryable via the `amenities` filter param - a single
# source of truth so the API layer validates against this instead of
# duplicating the column list, and so a new amenity flag only needs adding
# here (plus the Place column itself) to become filterable.
FILTERABLE_AMENITIES: dict[str, str] = {
    "wheelchair_accessible": "wheelchair_accessible",
    "has_ramp": "has_ramp",
    "has_elevator": "has_elevator",
    "baby_changing": "baby_changing",
    "child_friendly": "child_friendly",
    "pet_friendly": "pet_friendly",
    "has_drinking_water": "has_drinking_water",
    "has_wifi": "has_wifi",
    "has_shower": "has_shower",
    "has_seating": "has_seating",
    "has_shade": "has_shade",
    "has_parking": "has_parking",
    "near_public_transport": "near_public_transport",
    "is_quiet": "is_quiet",
}


@dataclass
class PlaceSearchParams:
    # A point + radius(m) for "yakınımda", OR a bounding box for "haritada
    # bu bölgede" - the API layer picks whichever the client sent, never
    # both.
    lat: float | None = None
    lon: float | None = None
    radius_m: float | None = None
    bbox: tuple[float, float, float, float] | None = None  # (min_lon, min_lat, max_lon, max_lat)

    category_slugs: list[str] = field(default_factory=list)
    amenities: list[str] = field(default_factory=list)  # must all be true (AND, not OR)
    is_free_only: bool = False
    open_now: bool = False  # placeholder for v1 - see docstring on `_apply_open_now_placeholder` below
    min_reliability: float | None = None
    admin_region_id: uuid.UUID | None = None

    limit: int = 50
    offset: int = 0


def search_places(db: Session, params: PlaceSearchParams) -> list[tuple[Place, float | None]]:
    """Returns (place, distance_m) pairs - distance_m is populated only for
    radius-based ("yakınımda") searches, None for bbox/plain filtering, so
    the API layer never has to guess whether a distance is meaningful."""
    is_radius_search = params.lat is not None and params.lon is not None and params.radius_m is not None

    # Always select (Place, distance) as a pair, even when distance isn't
    # meaningful (bbox/plain filtering) - a NULL there keeps the row shape
    # identical across both query paths, so the code below and the caller
    # never need an isinstance check on what db.execute returned.
    #
    # It must be CAST(NULL AS FLOAT), not a bound `literal(None, Float)`:
    # psycopg3 sends an untyped None parameter, PostgreSQL infers `text`
    # (OID 25) for that result column, and SQLAlchemy's Float processor then
    # fails with "Unknown PG numeric type: 25" - which is what every
    # non-radius search test hit in CI. The explicit cast makes the column
    # float8 on the server side, with no bind parameter to mis-infer.
    # Default visibility follows the PlaceStatus contract (models/place.py),
    # as an explicit allow-list so a future status is hidden until someone
    # decides otherwise: `active` and `temporarily_closed` are shown (a
    # closed toilet you can see and route around beats one that silently
    # vanished); `permanently_closed` and `pending_review` are not.
    # Filtering to `active` alone contradicted the model's own contract and
    # made every temporarily-closed place disappear from search.
    distance_expr = cast(null(), Float)
    query = select(Place, distance_expr).where(
        Place.status.in_((PlaceStatus.active, PlaceStatus.temporarily_closed))
    )

    if is_radius_search:
        point = ST_SetSRID(ST_MakePoint(params.lon, params.lat), 4326)
        distance_expr = ST_Distance(Place.location, point)
        query = select(Place, distance_expr).where(
        Place.status.in_((PlaceStatus.active, PlaceStatus.temporarily_closed))
    )
        query = query.where(ST_DWithin(Place.location, point, params.radius_m))
        # Place.id as a tie-break makes equal-distance rows page stably.
        query = query.order_by(distance_expr, Place.id)
    elif params.bbox is not None:
        min_lon, min_lat, max_lon, max_lat = params.bbox
        envelope = ST_SetSRID(ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat), 4326)
        # Place.location is a *geography* column (so ST_DWithin/ST_Distance
        # above measure metres on the sphere), but ST_MakeEnvelope produces a
        # *geometry*, and PostGIS has no ST_Within(geography, geometry) -
        # this exact call failed in CI with "function st_within(geography,
        # geometry) does not exist". A bounding box is a lat/lon rectangle,
        # which is a planar notion, so the right fix is to compare in
        # geometry space: cast the point, not the box. (Casting the box to
        # geography would silently turn its edges into great-circle arcs.)
        location_as_geometry = cast(Place.location, Geometry(geometry_type="POINT", srid=4326))
        query = query.where(ST_Within(location_as_geometry, envelope))

    if params.category_slugs:
        query = query.join(PlaceCategory, PlaceCategory.place_id == Place.id).join(
            Category, Category.id == PlaceCategory.category_id
        ).where(Category.slug.in_(params.category_slugs))

    for amenity in params.amenities:
        column = _amenity_column(amenity)
        query = query.where(column.is_(True))

    if params.is_free_only:
        from app.models.place import PriceType

        query = query.where(Place.price_type == PriceType.free)

    if params.min_reliability is not None:
        query = query.where(Place.reliability_score >= params.min_reliability)

    if params.admin_region_id is not None:
        query = query.where(Place.admin_region_id == params.admin_region_id)

    # `open_now` needs opening_hours_raw parsed (OSM opening_hours syntax,
    # a small grammar of its own) - deliberately not implemented as a SQL
    # predicate in v1 to avoid a half-correct parser silently hiding open
    # places. See docs/ROADMAP.md; for now this param is accepted by the
    # API but has no filtering effect, which is safer than a wrong one.

    if not is_radius_search:
        # bbox and plain searches previously had no ORDER BY at all, so
        # LIMIT/OFFSET pagination returned whatever order the planner felt
        # like - rows could repeat or vanish between pages. Most-trusted
        # first is the useful order for a map/list; id breaks ties stably.
        query = query.order_by(Place.reliability_score.desc(), Place.id)

    query = query.distinct().options(selectinload(Place.place_categories).selectinload(PlaceCategory.category))
    query = query.limit(params.limit).offset(params.offset)

    return [(row[0], row[1]) for row in db.execute(query).all()]


def _amenity_column(name: str):
    if name not in FILTERABLE_AMENITIES:
        raise ValueError(f"unknown amenity filter: {name!r} (known: {sorted(FILTERABLE_AMENITIES)})")
    return getattr(Place, FILTERABLE_AMENITIES[name])
