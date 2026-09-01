"""find_duplicate() against real rows - requires PostGIS (see conftest.py)."""

from __future__ import annotations

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.place import Place
from app.services.dedup import find_duplicate

TAKSIM = (41.0370, 28.9850)


def test_same_name_and_near_coordinates_is_a_confident_match(db_session):
    existing = Place(name="Kadıköy Halk Parkı", location=from_shape(Point(TAKSIM[1], TAKSIM[0]), srid=4326), country_code="TR")
    db_session.add(existing)
    db_session.commit()

    match = find_duplicate(db_session, name="Kadıköy Halk Parkı", lat=TAKSIM[0] + 0.0002, lon=TAKSIM[1] + 0.0002)

    assert match is not None
    assert match.place.id == existing.id
    assert match.confidence > 0.6


def test_different_name_nearby_is_not_a_confident_match(db_session):
    # Two genuinely distinct facilities (a toilet block and a drinking
    # fountain) can sit meters apart inside the same park - must not merge.
    existing = Place(name="Park Tuvaleti", location=from_shape(Point(TAKSIM[1], TAKSIM[0]), srid=4326), country_code="TR")
    db_session.add(existing)
    db_session.commit()

    match = find_duplicate(db_session, name="Su Çeşmesi", lat=TAKSIM[0] + 0.0001, lon=TAKSIM[1] + 0.0001)

    assert match is None


def test_same_name_far_away_is_not_a_match(db_session):
    existing = Place(name="Cumhuriyet Meydanı", location=from_shape(Point(TAKSIM[1], TAKSIM[0]), srid=4326), country_code="TR")
    db_session.add(existing)
    db_session.commit()

    # Same name is common across Turkey (many towns have a "Cumhuriyet
    # Meydanı") - far enough apart, this must not match.
    match = find_duplicate(db_session, name="Cumhuriyet Meydanı", lat=39.9208, lon=32.8541)  # Ankara

    assert match is None


def test_no_candidates_within_radius_returns_none(db_session):
    match = find_duplicate(db_session, name="Herhangi Bir Yer", lat=TAKSIM[0], lon=TAKSIM[1])
    assert match is None
