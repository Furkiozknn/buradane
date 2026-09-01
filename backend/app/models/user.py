"""Deliberately minimal. Per the brief: core discovery works with zero
account, so User only exists for the contribution path (suggesting a place,
reporting an issue, verifying a feature) - not for personalization yet
(that's a later phase, see docs/ROADMAP.md). Contributions from a
not-logged-in user are still accepted (see PlaceReport/PlaceVerification's
nullable user_id) via an anonymous device/session token, so "no account
required" holds even for contributing, matching the privacy-first
requirement - an account only adds attribution and a trust score.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Lightweight gamification per the brief ("hafif, oyunlaştırmayan") -
    # raw counters, not a points/leveling engine. Badges/levels can be
    # derived from these later without a schema change.
    contribution_count: Mapped[int] = mapped_column(default=0)
    verification_count: Mapped[int] = mapped_column(default=0)

    # A very light trust signal (0.0-1.0) feeding reliability scoring on
    # this user's future contributions - not exposed as a public "score",
    # just an internal weight. Starts neutral, moves slowly.
    trust_weight: Mapped[float] = mapped_column(default=0.5)

    is_admin: Mapped[bool] = mapped_column(default=False)
    is_active: Mapped[bool] = mapped_column(default=True)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email}>"
