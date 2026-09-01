"""Turkish administrative hierarchy: country -> province (il) -> district
(ilçe) -> neighborhood/village (mahalle/köy). Self-referential rather than
four separate tables, so the depth is data-driven, not schema-fixed - if a
belediye/municipality level needs to be inserted between district and
neighborhood for some region, that's a row, not a migration.

Seeded from TurkiyeAPI (github.com/ubeydeozdmr/turkiye-api, MIT license,
static dataset download) rather than hand-modeled - see
app/ingest/turkiye_api.py and docs/DATA_SOURCES.md. Never hardcode a
province/district list in code; this table is the single source of truth
and is re-seedable.
"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class AdminRegionLevel(str, enum.Enum):
    country = "country"
    province = "province"  # il
    district = "district"  # ilçe
    municipality = "municipality"  # belediye - not every region has one, optional level
    neighborhood = "neighborhood"  # mahalle
    village = "village"  # köy


class AdminRegion(Base):
    __tablename__ = "admin_regions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    country_code: Mapped[str] = mapped_column(String(2), nullable=False)  # ISO 3166-1 alpha-2, e.g. "TR"
    level: Mapped[AdminRegionLevel] = mapped_column(SAEnum(AdminRegionLevel), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # External source's own id, for re-sync/dedup against the seed source
    # (e.g. TurkiyeAPI's province/district id) - not this table's own PK.
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("admin_regions.id"), nullable=True
    )
    parent: Mapped["AdminRegion | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["AdminRegion"]] = relationship(back_populates="parent")

    population: Mapped[int | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_admin_regions_country_level", "country_code", "level"),
        Index("ix_admin_regions_parent", "parent_id"),
        Index("ix_admin_regions_external", "country_code", "level", "external_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debug convenience only
        return f"<AdminRegion {self.level.value}:{self.name}>"
