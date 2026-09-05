"""What KIND of place something is (Tuvalet, Park, Kütüphane, ...).

Deliberately many-to-many with Place, not a single FK - the brief is
explicit that a real place (a park with an integrated playground, toilet,
and drinking fountain) is not "one category," and forcing a single primary
category loses that. Cross-cutting attributes that aren't really a "type of
place" (wheelchair-accessible, free, 24h, wifi, ...) live on Place/
PlaceAmenity instead - see app/models/place.py's module docstring for the
category-vs-amenity split rationale.

The starting ~50 categories from the brief are seeded via
app/ingest/seed_categories.py, not hardcoded as an enum, specifically so the
system can grow ("araştırma sırasında yeni kategoriler keşfedersen genişlet")
without a schema migration for every new category.
"""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)  # e.g. "tuvalet", "park"
    name_tr: Mapped[str] = mapped_column(String(120), nullable=False)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(40), nullable=True)  # icon key for frontend, not a file path

    # Optional grouping (e.g. "Spor Alanları" parent for Basketbol/Futbol/
    # Tenis/Skate Park) purely for UI organization - search/filtering never
    # depends on this, only category membership does.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    parent: Mapped["Category | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["Category"]] = relationship(back_populates="parent")

    # The OSM tag(s) this category maps to during ingest, e.g.
    # ["amenity=toilets"] or ["leisure=park"] - a list because some
    # categories (e.g. "Spor Alanı") correspond to multiple OSM tags.
    # Purely an ingest-time mapping hint, never read by the search API.
    osm_tag_mappings: Mapped[list[str]] = mapped_column(JSONB, default=list)

    is_active: Mapped[bool] = mapped_column(default=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Category {self.slug}>"


class PlaceCategory(Base):
    """The many-to-many join, kept as its own model (not a bare Table) so
    it can carry `is_primary` - useful for "what's this place mainly?"
    display without losing the other categories it also belongs to."""

    __tablename__ = "place_categories"

    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("categories.id"), primary_key=True)
    is_primary: Mapped[bool] = mapped_column(default=False)

    place: Mapped["Place"] = relationship(back_populates="place_categories")  # noqa: F821
    category: Mapped["Category"] = relationship()

    # No separate UniqueConstraint: (place_id, category_id) is already the
    # composite primary key, which is itself the uniqueness guarantee - a
    # second identical constraint was redundant (and Postgres quietly
    # collapsed it into the PK anyway; found writing the Alembic baseline).
