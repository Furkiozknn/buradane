"""The write endpoints must be defensible: rate-limited, identity-aware,
and duplicate-aware. HTTP-level - these are the first tests to exercise
the FastAPI layer itself (requires PostGIS, see conftest.py)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import ratelimit
from app.core.db import get_db
from app.main import app
from app.models.category import Category
from app.models.place import Place


@pytest.fixture
def client(db_session, monkeypatch):
    # Fresh, permissive limiter per test so one test's spent budget cannot
    # bleed into the next; individual tests swap in a tight one.
    monkeypatch.setattr(
        ratelimit, "_write_limiter", ratelimit.TokenBucketLimiter(per_hour=10_000, burst=1_000)
    )
    # The verification limiter is opened wide here for the same reason: the
    # consensus tests exercise the counting mechanics with several device
    # tokens behind TestClient's single address, which the production
    # limiter now deliberately forbids. The limiter itself gets its own
    # dedicated attack test below, with realistic settings.
    monkeypatch.setattr(
        ratelimit, "_verification_limiter", ratelimit.TokenBucketLimiter(per_hour=10_000, burst=1_000)
    )
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def park(db_session):
    category = Category(slug="park", name_tr="Park", name_en="Park")
    db_session.add(category)
    db_session.flush()
    return category


class TestRateLimiting:
    def test_writes_beyond_the_burst_get_429_with_retry_after(self, client, park, monkeypatch):
        monkeypatch.setattr(
            ratelimit, "_write_limiter", ratelimit.TokenBucketLimiter(per_hour=60, burst=3)
        )
        body = {"name": "Park Önerisi", "lat": 41.0, "lon": 29.0, "category_slugs": ["park"]}
        statuses = []
        for i in range(4):
            body["lat"] = 41.0 + i  # far apart so dedup never triggers
            statuses.append(client.post("/places/suggest", json=body).status_code)
        assert statuses[:3] == [201, 201, 201]
        assert statuses[3] == 429
        resp = client.post("/places/suggest", json=body)
        assert "retry-after" in {k.lower() for k in resp.headers}

    def test_device_token_rotation_cannot_reach_consensus_from_one_address(
        self, client, db_session, park, monkeypatch
    ):
        """The audit's falsification demo, plus one line of token rotation.

        Consensus counts distinct submitter identities, and the identity is
        a client-minted X-Device-Token - so without this limiter, one IP
        rotating random tokens supplies the whole consensus threshold inside
        the general burst. The per-IP-per-place bucket holds one address
        BELOW the threshold: the second same-place verification from the
        same address 429s, so a lone script can never flip a field, while a
        different place (fresh key) sails through untouched.

        The limiter here is sized EXACTLY like production (same formula,
        same settings), with an injectable clock - because the first version
        of this test installed a hand-picked per_hour=1 bucket and happily
        stayed green while production refilled hourly against a 90-day
        consensus window. The clock jump below is that found attack: wait
        just over an hour, rotate the token, try again.
        """
        fake_clock = {"t": 0.0}
        budget = max(1, ratelimit.settings.verification_consensus - 1)
        window_hours = max(1, ratelimit.settings.stale_after_days) * 24
        monkeypatch.setattr(
            ratelimit,
            "_verification_limiter",
            ratelimit.TokenBucketLimiter(
                per_hour=budget / window_hours, burst=budget, clock=lambda: fake_clock["t"]
            ),
        )
        place = Place(
            name="Rotasyon Testi", location="SRID=4326;POINT(29.05 41.01)",
            country_code="TR", wheelchair_accessible=True,
        )
        other = Place(
            name="Başka Mekan", location="SRID=4326;POINT(29.20 41.05)",
            country_code="TR", wheelchair_accessible=True,
        )
        db_session.add_all([place, other])
        db_session.flush()

        body = {"field": "wheelchair_accessible", "confirmed_value": False}
        first = client.post(
            f"/places/{place.id}/verifications", json=body,
            headers={"X-Device-Token": "attacker-token-0001"},
        )
        assert first.status_code == 201

        second = client.post(
            f"/places/{place.id}/verifications", json=body,
            headers={"X-Device-Token": "attacker-token-0002"},
        )
        assert second.status_code == 429, (
            "token rotasyonu ikinci 'kimliği' geçirdi - konsensüs tek IP'den doldurulabilir"
        )

        # The patient variant: 61 minutes later, fresh token. Under the old
        # hourly refill this went through and the 90-day consensus window
        # counted two "identities" from one address. The bucket now refills
        # on the consensus window's own timescale, so patience does not pay.
        fake_clock["t"] += 61 * 60.0
        patient = client.post(
            f"/places/{place.id}/verifications", json=body,
            headers={"X-Device-Token": "attacker-token-0061"},
        )
        assert patient.status_code == 429, (
            "saatlik sabırlı rotasyon geçti - kova penceresi konsensüs penceresinden kısa"
        )

        db_session.refresh(place)
        assert place.wheelchair_accessible is True, "tek adres alanı çevirebildi"

        other_place = client.post(
            f"/places/{other.id}/verifications", json=body,
            headers={"X-Device-Token": "attacker-token-0003"},
        )
        assert other_place.status_code == 201, (
            "farklı mekan ayrı anahtar olmalı - gerçek kullanıcı yürüyüşte birden çok yer doğrular"
        )

    def test_the_bucket_refills_with_time(self):
        from fastapi import HTTPException

        clock = {"t": 0.0}
        limiter = ratelimit.TokenBucketLimiter(per_hour=3600, burst=1, clock=lambda: clock["t"])
        limiter.check("1.2.3.4")
        # HTTPException with 429 specifically - a bare `Exception` here once
        # accepted any crash in check() as "the limiter works".
        with pytest.raises(HTTPException) as denied:
            limiter.check("1.2.3.4")
        assert denied.value.status_code == 429
        clock["t"] += 1.0  # 1/sec refill rate
        limiter.check("1.2.3.4")  # does not raise

    def test_production_verification_limiter_is_sized_to_the_consensus_window(self):
        """Pins the module-level limiter's actual construction, so loosening
        ratelimit.py (say burst=10 "to be friendlier") goes red even though
        every other test installs its own limiter. Reads private attributes
        deliberately: the sizing IS the security property."""
        budget = max(1, ratelimit.settings.verification_consensus - 1)
        window_seconds = max(1, ratelimit.settings.stale_after_days) * 24 * 3600.0
        limiter = ratelimit._verification_limiter
        assert limiter._burst == float(budget)
        assert limiter._rate_per_second == pytest.approx(budget / window_seconds)

    def test_addresses_do_not_share_a_bucket(self):
        limiter = ratelimit.TokenBucketLimiter(per_hour=60, burst=1)
        limiter.check("1.1.1.1")
        limiter.check("2.2.2.2")  # unaffected by 1.1.1.1's spent token


class TestDeviceToken:
    def test_malformed_token_is_rejected(self, client, db_session):
        place = Place(name="Çeşme", location="SRID=4326;POINT(29.0 41.0)", country_code="TR")
        db_session.add(place)
        db_session.flush()
        resp = client.post(
            f"/places/{place.id}/verifications",
            json={"field": "has_drinking_water", "confirmed_value": True},
            headers={"X-Device-Token": "short"},
        )
        assert resp.status_code == 422

    def test_two_devices_flip_a_field_through_the_api(self, client, db_session):
        place = Place(
            name="Çeşme", location="SRID=4326;POINT(29.0 41.0)", country_code="TR",
            has_drinking_water=None,
        )
        db_session.add(place)
        db_session.flush()
        body = {"field": "has_drinking_water", "confirmed_value": True}
        url = f"/places/{place.id}/verifications"
        assert client.post(url, json=body, headers={"X-Device-Token": "d" * 32}).status_code == 201
        db_session.refresh(place)
        assert place.has_drinking_water is None
        assert client.post(url, json=body, headers={"X-Device-Token": "e" * 32}).status_code == 201
        db_session.refresh(place)
        assert place.has_drinking_water is True


class TestSuggestDedup:
    def test_suggesting_an_obvious_duplicate_answers_409_with_the_existing_place(
        self, client, db_session, park
    ):
        existing = Place(name="Moda Parkı Tuvaleti", location="SRID=4326;POINT(29.02 40.98)", country_code="TR")
        db_session.add(existing)
        db_session.flush()

        resp = client.post(
            "/places/suggest",
            json={"name": "Moda Parki Tuvaleti", "lat": 40.9801, "lon": 29.0201, "category_slugs": ["park"]},
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["existing_place_id"] == str(existing.id)

    def test_a_genuinely_new_place_still_lands(self, client, park):
        resp = client.post(
            "/places/suggest",
            json={"name": "Bambaşka Bir Yer", "lat": 39.0, "lon": 32.0, "category_slugs": ["park"]},
        )
        assert resp.status_code == 201
