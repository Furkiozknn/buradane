"""Photos and star-rating reviews. Phase-2 per the brief's own priority
order (schema exists now so ingest/place data can reference it and no
migration is needed later, but the MVP API surface in app/api/ doesn't
expose write endpoints for these yet - see docs/ROADMAP.md)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class PlacePhoto(Base):
    __tablename__ = "place_photos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    storage_url: Mapped[str] = mapped_column(String(500), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(300), nullable=True)

    # Every photo is moderated before it's publicly visible (brief:
    # "Fotoğraf moderasyonu") - True only after admin/moderator approval.
    is_approved: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class PlaceReview(Base):
    __tablename__ = "place_reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    place_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("places.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    rating: Mapped[int] = mapped_column(nullable=False)  # 1-5
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    cleanliness_rating: Mapped[int | None] = mapped_column(nullable=True)  # 1-5, optional per-category detail

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_place_reviews_rating_range"),
        CheckConstraint(
            "cleanliness_rating IS NULL OR (cleanliness_rating >= 1 AND cleanliness_rating <= 5)",
            name="ck_place_reviews_cleanliness_range",
        ),
    )
