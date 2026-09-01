"""Turkey's administrative hierarchy, for the "İstanbul → Kadıköy →
Parklar" style browse flow the brief asks for, and for populating a
province/district picker in the frontend."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.config import settings
from app.models.admin_region import AdminRegion, AdminRegionLevel

router = APIRouter(prefix="/admin-regions", tags=["admin-regions"])


class AdminRegionOut(BaseModel):
    id: uuid.UUID
    level: AdminRegionLevel
    name: str
    parent_id: uuid.UUID | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[AdminRegionOut])
def list_admin_regions(
    db: DbSession,
    level: AdminRegionLevel = Query(default=AdminRegionLevel.province),
    parent_id: uuid.UUID | None = Query(default=None),
) -> list[AdminRegionOut]:
    if level != AdminRegionLevel.province and parent_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "parent_id is required for any level below province")

    query = select(AdminRegion).where(
        AdminRegion.country_code == settings.active_country, AdminRegion.level == level
    )
    if parent_id is not None:
        query = query.where(AdminRegion.parent_id == parent_id)
    regions = db.execute(query.order_by(AdminRegion.name)).scalars().all()
    return [AdminRegionOut.model_validate(r) for r in regions]
