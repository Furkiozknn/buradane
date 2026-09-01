"""The Place: one real-world public/civic location.

Category-vs-amenity split (why amenities aren't just more categories):
a "category" answers *what kind of place is this* (Park, Tuvalet,
Kütüphane, ...) - see category.py, many-to-many via PlaceCategory. An
"amenity" answers *what does this place have/offer*, and is meaningful
across almost every category (a park, a library, and a mosque can all have
wheelchair access; a beach and a park can both have showers). Modeling
"engelli erişimli tuvalet" as its own category, separate from "tuvalet",
would force every feature combination into a combinatorial explosion of
categories - exactly what the brief explicitly warns against. So the ~10
most-filtered amenities are first-class nullable-boolean columns (fast,
indexable, directly usable in the filter API), and anything long-tail or
newly-discovered during ingest lives in `tags` (JSONB) without a migration -
the same escape hatch OSM itself uses.

Geometry: a single PostGIS Point (lon/lat) with a GiST index, via
GeoAlchemy2 - this is what makes "nearby" and "within this map viewport"
queries fast at Turkey scale instead of a full-table scan with Python-side
haversine math. See app/services/search.py for how it's queried.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import Enum as SAEnum
from sqlalchemy import Float, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.db import Base


class PlaceStatus(str, enum.Enum):
    active = "active"  # normal, shown
    temporarily_closed = "temporarily_closed"  # user-reported or source-reported, still shown but flagged
    permanently_closed = "permanently_closed"  # hidden from default search, kept for history
    pending_review = "pending_review"  # user-submitted, not yet moderated - not shown in public search


class PriceType(str, enum.Enum):
    free = "free"
    paid = "paid"
    unknown = "unknown"


class Place(Base):
    __tablename__ = "places"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Geography (not Geometry) so distance math is in real meters on a
    # sphere, not degrees - correct nearby-radius results without a manual
    # SRID transform at query time. See docs/ARCHITECTURE.md "Geospatial".
    location: Mapped[str] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)

    address_line: Mapped[str | None] = mapped_column(String(400), nullable=True)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)  # not hardcoded "TR" - see core/config.py
    admin_region_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_regions.id"), nullable=True
    )  # the most specific matched level (neighborhood/village if known, else district, else province)
    admin_region = relationship("AdminRegion")

    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)

    opening_hours_raw: Mapped[str | None] = mapped_column(String(300), nullable=True)  # OSM opening_hours syntax
    is_24h: Mapped[bool | None] = mapped_column(nullable=True)

    price_type: Mapped[PriceType] = mapped_column(SAEnum(PriceType), default=PriceType.unknown)
    price_note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # --- first-class amenity flags (nullable = "unknown", not "false") ---
    # A missing fact must never render as a negative claim to the user -
    # "unknown" and "no" are different and the frontend must be able to
    # tell them apart, so these are Optional[bool], never a plain bool
    # defaulting to False.
    wheelchair_accessible: Mapped[bool | None] = mapped_column(nullable=True)
    has_ramp: Mapped[bool | None] = mapped_column(nullable=True)
    has_elevator: Mapped[bool | None] = mapped_column(nullable=True)
    baby_changing: Mapped[bool | None] = mapped_column(nullable=True)
    child_friendly: Mapped[bool | None] = mapped_column(nullable=True)
    pet_friendly: Mapped[bool | None] = mapped_column(nullable=True)
    has_drinking_water: Mapped[bool | None] = mapped_column(nullable=True)
    has_wifi: Mapped[bool | None] = mapped_column(nullable=True)
    has_shower: Mapped[bool | None] = mapped_column(nullable=True)
    has_seating: Mapped[bool | None] = mapped_column(nullable=True)
    has_shade: Mapped[bool | None] = mapped_column(nullable=True)
    has_parking: Mapped[bool | None] = mapped_column(nullable=True)
    near_public_transport: Mapped[bool | None] = mapped_column(nullable=True)
    is_quiet: Mapped[bool | None] = mapped_column(nullable=True)

    # Free-form escape hatch for anything not (yet) a first-class column -
    # e.g. raw OSM tags not mapped to a flag above. Never queried for
    # filtering in v1 (that's what the columns above are for); kept purely
    # for traceability and future column promotion.
    tags: Mapped[dict] = mapped_column(JSONB, default=dict)

    status: Mapped[PlaceStatus] = mapped_column(SAEnum(PlaceStatus), default=PlaceStatus.active)

    # --- freshness / reliability, per the brief's explicit requirement to
    # never trust an old report forever ---
    last_verified_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_reported_at: Mapped[datetime | None] = mapped_column(nullable=True)
    reliability_score: Mapped[float] = mapped_column(Float, default=0.5)  # recomputed, see services/reliability.py

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())

    place_categories: Mapped[list["PlaceCategory"]] = relationship(  # noqa: F821
        back_populates="place", cascade="all, delete-orphan"
    )
    source_records: Mapped[list["PlaceSourceRecord"]] = relationship(  # noqa: F821
        back_populates="place", cascade="all, delete-orphan"
    )
    reports: Mapped[list["PlaceReport"]] = relationship(cascade="all, delete-orphan")  # noqa: F821
    verifications: Mapped[list["PlaceVerification"]] = relationship(cascade="all, delete-orphan")  # noqa: F821
    photos: Mapped[list["PlacePhoto"]] = relationship(cascade="all, delete-orphan")  # noqa: F821
    reviews: Mapped[list["PlaceReview"]] = relationship(cascade="all, delete-orphan")  # noqa: F821

    __table_args__ = (
        Index("ix_places_location", "location", postgresql_using="gist"),
        Index("ix_places_country_status", "country_code", "status"),
        Index("ix_places_admin_region", "admin_region_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Place {self.name}>"
