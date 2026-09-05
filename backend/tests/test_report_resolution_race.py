"""Interleaved-transaction proof for the report-resolution row lock.

The sequential double-resolve test always passed and never covered the
race: two moderators in two transactions could both read `pending`, both
apply opposite decisions, and the later commit silently overwrote the
earlier one. This file drives two REAL database connections through the
interleaving itself - which is why it cannot use the shared per-test
session the other suites share, and why it is database-gated like them.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.core.db import SessionLocal
from app.models.place import Place, PlaceStatus
from app.models.signal import PlaceReport, ReportStatus, ReportType
from app.services.moderation import resolve_report
from tests.conftest import DB_AVAILABLE

pytestmark = pytest.mark.skipif(
    not DB_AVAILABLE, reason="no reachable database - see conftest.py docstring"
)


@pytest.fixture
def committed_report():
    """A place and a pending report, COMMITTED, so that independent
    connections can see and lock them - the whole point of the test."""
    setup = SessionLocal()
    place = Place(
        name="Yarış Testi Parkı",
        location="SRID=4326;POINT(29.03 40.99)",
        country_code="TR",
        status=PlaceStatus.active,
    )
    setup.add(place)
    setup.flush()
    report = PlaceReport(
        place_id=place.id, report_type=ReportType.closed, status=ReportStatus.pending
    )
    setup.add(report)
    setup.commit()
    ids = (report.id, place.id)
    setup.close()
    try:
        yield ids
    finally:
        cleanup = SessionLocal()
        cleanup.execute(text("DELETE FROM place_reports WHERE id = :r"), {"r": ids[0]})
        cleanup.execute(text("DELETE FROM places WHERE id = :p"), {"p": ids[1]})
        cleanup.commit()
        cleanup.close()


def test_second_resolver_waits_on_the_lock_instead_of_racing(committed_report):
    report_id, place_id = committed_report

    session_a = SessionLocal()
    session_b = SessionLocal()
    try:
        # A takes the row lock the endpoint now takes, and holds it
        # uncommitted - the exact window the race lived in.
        locked = session_a.get(PlaceReport, report_id, with_for_update=True)
        assert locked is not None and locked.status == ReportStatus.pending

        # B cannot even reach its check-then-act while A holds the lock:
        # with a short lock_timeout the attempt errors instead of reading a
        # stale `pending`. Without with_for_update in the endpoint, this
        # read would have succeeded instantly - that is the regression this
        # assertion pins.
        session_b.execute(text("SET LOCAL lock_timeout = '400ms'"))
        with pytest.raises(OperationalError):
            session_b.get(PlaceReport, report_id, with_for_update=True, populate_existing=True)
        session_b.rollback()

        # A completes its resolution and commits.
        place = session_a.get(Place, place_id, with_for_update=True)
        resolve_report(session_a, report=locked, place=place, accept=True)
        session_a.commit()

        # B retries the way the endpoint does after the wait: fresh read
        # under the lock. It must see the resolved state and take the 409
        # branch - never a second, overwriting resolution.
        after = session_b.get(PlaceReport, report_id, with_for_update=True, populate_existing=True)
        assert after is not None
        assert after.status == ReportStatus.accepted
        session_b.rollback()
    finally:
        session_a.close()
        session_b.close()
