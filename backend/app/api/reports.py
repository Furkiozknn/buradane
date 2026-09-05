"""Admin moderation endpoints - the exit the moderation loop was missing.

Reports land ``pending`` (POST /places/{id}/reports) and each pending one
costs its place reliability score; until these two endpoints existed there
was no way to ever resolve one. Both are behind AdminUser (the bootstrap
moderator, app/services/bootstrap.py, logged in via /auth/login).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.api.deps import AdminUser, DbSession
from app.models.place import Place
from app.models.signal import PlaceReport, ReportStatus
from app.services.moderation import resolve_report
from sqlalchemy import select

router = APIRouter(prefix="/reports", tags=["moderation"])


class ReportOut(BaseModel):
    id: uuid.UUID
    place_id: uuid.UUID
    place_name: str
    report_type: str
    field: str | None
    note: str | None
    status: str
    created_at: datetime
    resolved_at: datetime | None


class ReportResolutionIn(BaseModel):
    action: Literal["accept", "reject"]


@router.get("", response_model=list[ReportOut])
def list_reports(
    db: DbSession,
    admin: AdminUser,
    report_status: ReportStatus = Query(default=ReportStatus.pending, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> list[ReportOut]:
    rows = db.execute(
        select(PlaceReport, Place.name)
        .join(Place, Place.id == PlaceReport.place_id)
        .where(PlaceReport.status == report_status)
        # Oldest first: a moderation queue is worked front-to-back, and the
        # id tie-break keeps paging deterministic (same rule as search.py).
        .order_by(PlaceReport.created_at.asc(), PlaceReport.id)
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        ReportOut(
            id=report.id,
            place_id=report.place_id,
            place_name=place_name,
            report_type=report.report_type.value,
            field=report.field,
            note=report.note,
            status=report.status.value,
            created_at=report.created_at,
            resolved_at=report.resolved_at,
        )
        for report, place_name in rows
    ]


@router.patch("/{report_id}", response_model=ReportOut)
def resolve_report_endpoint(
    report_id: uuid.UUID, payload: ReportResolutionIn, db: DbSession, admin: AdminUser
) -> ReportOut:
    report = db.get(PlaceReport, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    if report.status != ReportStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, f"report is already {report.status.value}")
    place = db.get(Place, report.place_id)
    resolve_report(db, report=report, place=place, accept=payload.action == "accept")
    db.commit()
    db.refresh(report)
    return ReportOut(
        id=report.id,
        place_id=report.place_id,
        place_name=place.name,
        report_type=report.report_type.value,
        field=report.field,
        note=report.note,
        status=report.status.value,
        created_at=report.created_at,
        resolved_at=report.resolved_at,
    )
