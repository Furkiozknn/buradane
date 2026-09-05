"""Interleaved-transaction proof for the report-resolution row lock,
driven through the ENDPOINT itself.

The sequential double-resolve test always passed and never covered the
race: two moderators in two transactions could both read `pending`, both
apply opposite decisions, and the later commit silently overwrote the
earlier one.

The first version of this file proved only that Postgres row locks work:
it took every with_for_update itself and never imported the endpoint - so
deleting the lock from reports.py left it green (the adversarial review's
finding). This version drives `resolve_report_endpoint` from two threads
on two REAL connections. The first resolver is held inside its
check-then-act window by a wrapped resolve_report; with the endpoint's
lock, the second blocks at the row read and re-reads `accepted` into a
409. Remove with_for_update from the endpoint and the second walks through
the window during the hold, both "win", and the exactly-one-409 assertion
goes red.
"""

from __future__ import annotations

import threading
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.core.db import SessionLocal
from app.models.place import Place, PlaceStatus
from app.models.signal import PlaceReport, ReportStatus, ReportType
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


def test_concurrent_resolutions_through_the_endpoint_yield_exactly_one_409(
    committed_report, monkeypatch
):
    from app.api import reports as reports_api
    from app.api.reports import ReportResolutionIn, resolve_report_endpoint

    report_id, place_id = committed_report

    real_resolve = reports_api.resolve_report
    first_inside = threading.Event()
    hold = threading.Event()

    def held_resolve(db, *, report, place, accept):
        # The first thread to get past the status check announces itself and
        # is held INSIDE the check-then-act window. If the endpoint's row
        # lock is doing its job, the second thread never reaches this point
        # while the hold lasts - it is parked at db.get. Without the lock it
        # sails in here during the hold, which is exactly the race.
        if not first_inside.is_set():
            first_inside.set()
            hold.wait(timeout=10)
        return real_resolve(db, report=report, place=place, accept=accept)

    monkeypatch.setattr(reports_api, "resolve_report", held_resolve)

    results: dict[str, tuple[str, object]] = {}

    def moderator(name: str, action: str) -> None:
        db = SessionLocal()
        try:
            out = resolve_report_endpoint(
                report_id, ReportResolutionIn(action=action), db, admin=None
            )
            results[name] = ("resolved", out.status)
        except HTTPException as exc:
            db.rollback()
            results[name] = ("http", exc.status_code)
        except Exception as exc:  # pragma: no cover - diagnostics on failure
            db.rollback()
            results[name] = ("error", repr(exc))
        finally:
            db.close()

    accepter = threading.Thread(target=moderator, args=("accept", "accept"))
    accepter.start()
    assert first_inside.wait(timeout=10), "first resolver never reached resolve_report"

    rejecter = threading.Thread(target=moderator, args=("reject", "reject"))
    rejecter.start()
    # Give the second thread time to issue its SELECT ... FOR UPDATE and
    # block on the first one's uncommitted lock, then release the hold.
    time.sleep(0.6)
    hold.set()
    accepter.join(timeout=15)
    rejecter.join(timeout=15)
    assert not accepter.is_alive() and not rejecter.is_alive(), f"deadlocked: {results}"

    outcomes = sorted(kind for kind, _ in results.values())
    assert outcomes == ["http", "resolved"], (
        f"exactly one resolution and one 409 expected, got {results} - "
        "two 'resolved' means both moderators won: the endpoint lost its row lock"
    )
    http_result = next(v for v in results.values() if v[0] == "http")
    assert http_result[1] == 409

    # The winner's decision - and only theirs - is what the database holds.
    check = SessionLocal()
    try:
        final = check.get(PlaceReport, report_id)
        winner = next(k for k, v in results.items() if v[0] == "resolved")
        expected_status = ReportStatus.accepted if winner == "accept" else ReportStatus.rejected
        assert final is not None and final.status == expected_status
    finally:
        check.close()
