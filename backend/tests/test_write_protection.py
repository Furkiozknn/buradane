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
        """
        monkeypatch.setattr(
            ratelimit,
            "_verification_limiter",
            ratelimit.TokenBucketLimiter(per_hour=1, burst=1),
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
        clock = {"t": 0.0}
        limiter = ratelimit.TokenBucketLimiter(per_hour=3600, burst=1, clock=lambda: clock["t"])
        limiter.check("1.2.3.4")
        with pytest.raises(Exception):
            limiter.check("1.2.3.4")
        clock["t"] += 1.0  # 1/sec refill rate
        limiter.check("1.2.3.4")  # does not raise

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
