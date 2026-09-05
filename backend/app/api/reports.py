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
    # Row lock BEFORE the status check. Two moderators resolving the same
    # report concurrently each ran check-then-act in their own transaction:
    # both read `pending`, both applied their (possibly opposite) decision,
    # and the later commit silently overwrote the earlier one - accept and
    # reject both "succeeded", the place's status kept whichever transaction
    # happened to finish last. The sequential double-resolve test never saw
    # this; only interleaving does. with_for_update makes the second
    # transaction wait on the first's lock, and populate_existing forces a
    # fresh read after the wait, so the second sees `accepted`/`rejected`
    # and gets the 409 it always should have.
    report = db.get(
        PlaceReport, report_id, with_for_update=True, populate_existing=True
    )
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    if report.status != ReportStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, f"report is already {report.status.value}")
    # The place is written too (status flips, reliability recomputes), so it
    # takes the same lock - always in report -> place order, so two resolvers
    # of different reports on the same place serialise instead of deadlocking.
    place = db.get(Place, report.place_id, with_for_update=True, populate_existing=True)
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
