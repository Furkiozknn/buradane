"""The moderation loop must have an exit: a bootstrap admin can log in,
list the pending queue, and accept/reject reports - and resolving a report
releases the reliability drag it was causing. Before this surface existed,
the entire auth stack was dead code and every report was a permanent score
penalty (audit finding A7)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import ratelimit
from app.core.config import settings
from app.core.db import get_db
from app.core.security import hash_password
from app.main import app
from app.models.place import Place, PlaceStatus
from app.models.signal import ReportStatus, ReportType
from app.models.user import User
from app.services.bootstrap import ensure_bootstrap_admin
from app.services.moderation import create_place_report

ADMIN_EMAIL = "mod@buradane.example"
ADMIN_PASSWORD = "correct-horse-battery"


@pytest.fixture
def client(db_session, monkeypatch):
    monkeypatch.setattr(
        ratelimit, "_write_limiter", ratelimit.TokenBucketLimiter(per_hour=10_000, burst=1_000)
    )
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def admin(db_session):
    user = User(
        email=ADMIN_EMAIL, hashed_password=hash_password(ADMIN_PASSWORD), is_admin=True
    )
    db_session.add(user)
    db_session.flush()
    return user


@pytest.fixture
def place(db_session):
    place = Place(
        name="Moda Parkı",
        location="SRID=4326;POINT(29.02 40.98)",
        country_code="TR",
        status=PlaceStatus.active,
        has_wifi=True,
    )
    db_session.add(place)
    db_session.flush()
    return place


def login(client, email=ADMIN_EMAIL, password=ADMIN_PASSWORD) -> dict:
    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestLogin:
    def test_wrong_password_and_unknown_email_answer_the_same_401(self, client, admin):
        wrong = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": "nope-nope-nope"})
        unknown = client.post("/auth/login", json={"email": "kim@bilir.example", "password": "nope"})
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json()["detail"] == unknown.json()["detail"]

    def test_a_valid_login_yields_a_token_that_reaches_admin_endpoints(self, client, admin):
        assert client.get("/reports", headers=login(client)).status_code == 200

    def test_an_inactive_account_cannot_log_in(self, client, db_session, admin):
        admin.is_active = False
        db_session.flush()
        resp = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert resp.status_code == 401


class TestAdminGate:
    def test_no_token_is_403(self, client):
        assert client.get("/reports").status_code == 403

    def test_a_non_admin_token_is_403(self, client, db_session):
        db_session.add(
            User(email="user@buradane.example", hashed_password=hash_password("sifre-sifre-1"))
        )
        db_session.flush()
        headers = login(client, "user@buradane.example", "sifre-sifre-1")
        assert client.get("/reports", headers=headers).status_code == 403


class TestReportQueue:
    def test_pending_reports_list_with_place_names_oldest_first(self, client, db_session, admin, place):
        create_place_report(
            db_session, place=place, report_type=ReportType.closed, field=None, note="kapalı", user=None
        )
        db_session.flush()
        rows = client.get("/reports", headers=login(client)).json()
        assert len(rows) == 1
        assert rows[0]["place_name"] == "Moda Parkı"
        assert rows[0]["status"] == "pending"

    def test_accepting_a_closed_report_closes_the_place_and_releases_the_drag(
        self, client, db_session, admin, place
    ):
        report = create_place_report(
            db_session, place=place, report_type=ReportType.closed, field=None, note=None, user=None
        )
        db_session.flush()
        dragged_score = place.reliability_score

        resp = client.patch(
            f"/reports/{report.id}", json={"action": "accept"}, headers=login(client)
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "accepted"
        assert resp.json()["resolved_at"] is not None
        db_session.refresh(place)
        assert place.status == PlaceStatus.temporarily_closed
        # The pending-report penalty is gone once the report is resolved.
        assert place.reliability_score > dragged_score

    def test_rejecting_leaves_the_place_alone_but_still_releases_the_drag(
        self, client, db_session, admin, place
    ):
        report = create_place_report(
            db_session, place=place, report_type=ReportType.closed, field=None, note=None, user=None
        )
        db_session.flush()
        dragged_score = place.reliability_score

        resp = client.patch(
            f"/reports/{report.id}", json={"action": "reject"}, headers=login(client)
        )
        assert resp.status_code == 200
        db_session.refresh(place)
        assert place.status == PlaceStatus.active
        assert place.reliability_score > dragged_score

    def test_accepting_broken_amenity_clears_exactly_that_flag(self, client, db_session, admin, place):
        report = create_place_report(
            db_session, place=place, report_type=ReportType.broken_amenity,
            field="has_wifi", note=None, user=None,
        )
        db_session.flush()
        client.patch(f"/reports/{report.id}", json={"action": "accept"}, headers=login(client))
        db_session.refresh(place)
        assert place.has_wifi is False
        assert place.status == PlaceStatus.active  # only the flag, never the status

    def test_a_report_cannot_be_resolved_twice(self, client, db_session, admin, place):
        report = create_place_report(
            db_session, place=place, report_type=ReportType.closed, field=None, note=None, user=None
        )
        db_session.flush()
        headers = login(client)
        assert client.patch(f"/reports/{report.id}", json={"action": "accept"}, headers=headers).status_code == 200
        assert client.patch(f"/reports/{report.id}", json={"action": "reject"}, headers=headers).status_code == 409
        db_session.refresh(report)
        assert report.status == ReportStatus.accepted

    def test_broken_amenity_with_a_non_amenity_field_is_rejected_at_submit(self, client, place):
        resp = client.post(
            f"/places/{place.id}/reports",
            json={"report_type": "broken_amenity", "field": "reliability_score"},
        )
        assert resp.status_code == 400


class TestBootstrap:
    def test_bootstrap_refuses_the_default_jwt_secret(self, db_session, monkeypatch):
        """An admin whose tokens anyone can forge is worse than no admin."""
        monkeypatch.setattr(settings, "admin_email", ADMIN_EMAIL)
        monkeypatch.setattr(settings, "admin_password", ADMIN_PASSWORD)
        assert settings.jwt_secret == "dev-secret-change-in-production"
        with pytest.raises(RuntimeError, match="BURADANE_JWT_SECRET"):
            ensure_bootstrap_admin(db_session)

    def test_bootstrap_creates_one_admin_and_never_overwrites(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "jwt_secret", "a-real-secret-for-this-test")
        monkeypatch.setattr(settings, "admin_email", ADMIN_EMAIL)
        monkeypatch.setattr(settings, "admin_password", ADMIN_PASSWORD)
        first = ensure_bootstrap_admin(db_session)
        assert first is not None and first.is_admin

        # A changed env password must not rotate the stored credential.
        original_hash = first.hashed_password
        monkeypatch.setattr(settings, "admin_password", "some-other-password")
        second = ensure_bootstrap_admin(db_session)
        assert second.id == first.id
        assert second.hashed_password == original_hash

    def test_bootstrap_is_a_noop_when_unconfigured(self, db_session):
        assert settings.admin_email is None
        assert ensure_bootstrap_admin(db_session) is None
