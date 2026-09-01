"""Per the brief's explicit requirement: every piece of ingested data must
carry source/license/update-recency metadata, never anonymously merged in.
`DataSource` is the source itself (OpenStreetMap, İBB Açık Veri, ULAŞAV, a
specific municipality's CKAN portal, or "user_submission" for
community-contributed places); `PlaceSourceRecord` links one Place to every
source that reported it, which is also the raw material the dedup service
(app/services/dedup.py) matches against to decide whether an incoming
record is a new Place or a match for an existing one.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.db import Base


class DataSourceType(str, enum.Enum):
    openstreetmap = "openstreetmap"
    municipality_ckan = "municipality_ckan"  # İBB, ULAŞAV, or any other CKAN portal
    government_other = "government_other"  # non-CKAN official source
    user_submission = "user_submission"
    manual_curation = "manual_curation"  # us, directly


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)  # "osm", "ibb-acik-veri", ...
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type: Mapped[DataSourceType] = mapped_column(SAEnum(DataSourceType), nullable=False)

    license: Mapped[str | None] = mapped_column(String(200), nullable=True)  # e.g. "ODbL 1.0", "CC-BY 4.0"
    license_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    homepage_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    api_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Reliability isn't a global constant per source type - a well-maintained
    # municipal portal and a stale one both being "government_other" would
    # otherwise get identical trust. Weight is set per concrete source
    # (0.0-1.0) and feeds app/services/reliability.py's score.
    reliability_weight: Mapped[float] = mapped_column(default=0.7)

    last_synced_at: Mapped[datetime | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<DataSource {self.slug}>"


class PlaceSourceRecord(Base):
    """One source's report of one place. Several of these can point at the
    same Place (that's how the dedup/merge model works: OSM's node,
    İBB's row, and a user submission all become PlaceSourceRecords under a
    single canonical Place, rather than three separate Places)."""

    __tablename__ = "place_source_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    data_source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("data_sources.id"), nullable=False)

    # The source's own identifier for this record (OSM node id, CKAN row
    # id, ...) - kept so re-syncing the same source updates the existing
    # record instead of creating a duplicate PlaceSourceRecord every run.
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)

    # The raw, source-native payload as ingested, untouched - lets the
    # dedup/merge service (and any future re-processing) work from the
    # original data rather than only the fields we happened to map onto
    # Place at ingest time.
    raw_data: Mapped[dict] = mapped_column(JSONB, default=dict)

    fetched_at: Mapped[datetime] = mapped_column(server_default=func.now())

    place: Mapped["Place"] = relationship(back_populates="source_records")  # noqa: F821
    data_source: Mapped["DataSource"] = relationship()

    def __repr__(self) -> str:  # pragma: no cover
        return f"<PlaceSourceRecord {self.external_id}>"
