"""The two community-contribution signal types the brief asks for
explicitly: a *report* ("bu tuvalet kapalı", "su çeşmesi çalışmıyor" - a
claim something changed) and a *verification* ("evet, engelli erişimi var,
doğruladım" - a claim an existing fact is still true). Both are
time-stamped and feed app/services/reliability.py's score; neither is
trusted forever, which is the entire point of keeping them as their own
rows instead of just mutating Place directly.

Anonymous contributions are allowed (user_id nullable) - see user.py's
docstring for why account-optional matters here.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class ReportType(str, enum.Enum):
    closed = "closed"  # "burası kapalı"
    reopened = "reopened"  # "artık açık" - a positive report undoing a prior closed one
    broken_amenity = "broken_amenity"  # "çeşme çalışmıyor", "wifi yok" - see `field` for which one
    under_maintenance = "under_maintenance"
    overcrowded = "overcrowded"
    incorrect_location = "incorrect_location"
    incorrect_info = "incorrect_info"
    other = "other"


class ReportStatus(str, enum.Enum):
    pending = "pending"  # not yet reviewed - doesn't affect the place's public status yet
    accepted = "accepted"  # applied to the Place
    rejected = "rejected"  # spam/incorrect, moderated out


class PlaceReport(Base):
    """A "something changed" signal from a user. Deliberately NOT applied
    to Place automatically on insert - see app/services/moderation.py for
    when/how a report actually mutates Place.status or an amenity flag."""

    __tablename__ = "place_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # sha256 hex of the submitter's anonymous device token (see
    # api/deps.py). Identity for abuse-resistance without an account and
    # without storing anything a person typed - never the raw token.
    device_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    report_type: Mapped[ReportType] = mapped_column(SAEnum(ReportType), nullable=False)
    # For broken_amenity, which Place column this refers to (e.g.
    # "has_drinking_water") - free text, validated at the API layer against
    # Place's actual amenity field names rather than a DB-level constraint,
    # so a new amenity column doesn't require a migration here too.
    field: Mapped[str | None] = mapped_column(String(80), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[ReportStatus] = mapped_column(SAEnum(ReportStatus), default=ReportStatus.pending)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)


class PlaceVerification(Base):
    """A "this is still true" signal - the positive counterpart to
    PlaceReport. Multiple verifications of the same fact raise confidence;
    see services/reliability.py for exactly how."""

    __tablename__ = "place_verifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    device_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    field: Mapped[str] = mapped_column(String(80), nullable=False)  # e.g. "wheelchair_accessible", "is_active"
    confirmed_value: Mapped[bool] = mapped_column(nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # The consensus check in services/moderation.py reads all recent
    # verifications for one (place, field); this is its access path.
    __table_args__ = (Index("ix_place_verifications_place_field", "place_id", "field"),)
