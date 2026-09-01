"""Community-contribution write paths - requires PostGIS (see conftest.py)."""

from __future__ import annotations

from app.models.category import Category
from app.models.place import Place, PlaceStatus
from app.models.signal import ReportStatus, ReportType
from app.schemas.place import PlaceSuggestionIn
from app.services.moderation import create_place_report, create_place_suggestion, create_place_verification


def test_suggested_place_lands_as_pending_review_not_public(db_session):
    category = Category(slug="park", name_tr="Park", name_en="Park")
    db_session.add(category)
    db_session.flush()

    payload = PlaceSuggestionIn(name="Yeni Mahalle Parkı", lat=41.0, lon=29.0, category_slugs=["park"])
    place = create_place_suggestion(db_session, payload=payload, categories=[category], user=None)
    db_session.commit()

    assert place.status == PlaceStatus.pending_review
    assert place.reliability_score < 0.5  # unverified single-source, starts low


def test_report_does_not_mutate_place_directly(db_session):
    place = Place(name="Test Tuvaleti", location="SRID=4326;POINT(29.0 41.0)", country_code="TR")
    db_session.add(place)
    db_session.commit()
    original_status = place.status

    create_place_report(db_session, place=place, report_type=ReportType.closed, field=None, note="kapalı görünüyor", user=None)
    db_session.commit()

    assert place.status == original_status  # a pending report never auto-applies
    assert place.last_reported_at is not None


def test_report_lands_as_pending_status(db_session):
    place = Place(name="Test Parkı", location="SRID=4326;POINT(29.0 41.0)", country_code="TR")
    db_session.add(place)
    db_session.commit()

    report = create_place_report(
        db_session, place=place, report_type=ReportType.under_maintenance, field=None, note="bakımda", user=None
    )
    db_session.commit()

    assert report.status == ReportStatus.pending


def test_verification_immediately_updates_the_named_field(db_session):
    place = Place(
        name="Belirsiz Erişim", location="SRID=4326;POINT(29.0 41.0)", country_code="TR", wheelchair_accessible=None
    )
    db_session.add(place)
    db_session.commit()

    create_place_verification(db_session, place=place, field="wheelchair_accessible", confirmed_value=True, user=None)
    db_session.commit()

    assert place.wheelchair_accessible is True
    assert place.last_verified_at is not None


def test_verification_recomputes_reliability_score(db_session):
    place = Place(name="Doğrulanacak Yer", location="SRID=4326;POINT(29.0 41.0)", country_code="TR")
    db_session.add(place)
    db_session.commit()
    before = place.reliability_score

    create_place_verification(db_session, place=place, field="has_drinking_water", confirmed_value=True, user=None)
    db_session.commit()

    assert place.reliability_score != before


def test_user_contribution_counters_increment(db_session):
    from app.models.user import User

    user = User(email="test@example.com", hashed_password="x")
    db_session.add(user)
    db_session.flush()

    category = Category(slug="tuvalet", name_tr="Tuvalet", name_en="Toilet")
    db_session.add(category)
    db_session.flush()

    payload = PlaceSuggestionIn(name="Kullanıcı Önerisi", lat=41.0, lon=29.0, category_slugs=["tuvalet"])
    create_place_suggestion(db_session, payload=payload, categories=[category], user=user)
    db_session.commit()

    assert user.contribution_count == 1
