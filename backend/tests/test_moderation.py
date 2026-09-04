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


def test_single_device_verification_does_not_flip_the_field(db_session):
    place = Place(name="Erişim Testi", location="SRID=4326;POINT(29.0 41.0)", country_code="TR",
                  wheelchair_accessible=None)
    db_session.add(place)
    db_session.commit()

    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=True, user=None, device_token_hash="a" * 64)
    db_session.commit()

    assert place.wheelchair_accessible is None  # one submitter is a signal, not a fact
    assert place.last_verified_at is not None


def test_second_distinct_device_reaches_consensus_and_applies(db_session):
    place = Place(name="Erişim Testi", location="SRID=4326;POINT(29.0 41.0)", country_code="TR",
                  wheelchair_accessible=None)
    db_session.add(place)
    db_session.commit()

    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=True, user=None, device_token_hash="a" * 64)
    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=True, user=None, device_token_hash="b" * 64)
    db_session.commit()

    assert place.wheelchair_accessible is True


def test_the_same_device_repeating_never_reaches_consensus(db_session):
    # The audit's live demo: one shell loop flipped the field. Twenty
    # confirmations from one identity must count as one.
    place = Place(name="Erişim Testi", location="SRID=4326;POINT(29.0 41.0)", country_code="TR",
                  wheelchair_accessible=None)
    db_session.add(place)
    db_session.commit()

    for _ in range(20):
        create_place_verification(db_session, place=place, field="wheelchair_accessible",
                                  confirmed_value=False, user=None, device_token_hash="a" * 64)
    db_session.commit()

    assert place.wheelchair_accessible is None


def test_identityless_verification_neither_flips_nor_refreshes(db_session):
    # Without the header the write is a weak signal only - otherwise
    # omitting X-Device-Token would be the trivial bypass.
    place = Place(name="Erişim Testi", location="SRID=4326;POINT(29.0 41.0)", country_code="TR",
                  wheelchair_accessible=None)
    db_session.add(place)
    db_session.commit()

    for _ in range(5):
        create_place_verification(db_session, place=place, field="wheelchair_accessible",
                                  confirmed_value=True, user=None, device_token_hash=None)
    db_session.commit()

    assert place.wheelchair_accessible is None
    assert place.last_verified_at is None


def test_contradicted_verification_does_not_apply(db_session):
    place = Place(name="Erişim Testi", location="SRID=4326;POINT(29.0 41.0)", country_code="TR",
                  wheelchair_accessible=None)
    db_session.add(place)
    db_session.commit()

    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=False, user=None, device_token_hash="x" * 64)
    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=False, user=None, device_token_hash="y" * 64)
    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=True, user=None, device_token_hash="a" * 64)
    create_place_verification(db_session, place=place, field="wheelchair_accessible",
                              confirmed_value=True, user=None, device_token_hash="b" * 64)
    db_session.commit()

    # The False pair reached consensus first (2-0) and applied; the later
    # True pair only ties it 2-2, and a tie must never overturn what
    # consensus established - supporters must STRICTLY outnumber.
    assert place.wheelchair_accessible is False


def test_repeat_verifications_from_one_device_do_not_pump_reliability(db_session):
    place = Place(name="Çeşme", location="SRID=4326;POINT(29.0 41.0)", country_code="TR")
    db_session.add(place)
    db_session.commit()

    create_place_verification(db_session, place=place, field="has_drinking_water",
                              confirmed_value=True, user=None, device_token_hash="a" * 64)
    db_session.commit()
    score_after_one = place.reliability_score

    for _ in range(20):
        create_place_verification(db_session, place=place, field="has_drinking_water",
                                  confirmed_value=True, user=None, device_token_hash="a" * 64)
    db_session.commit()

    assert place.reliability_score == score_after_one  # one identity, one signal

    create_place_verification(db_session, place=place, field="has_drinking_water",
                              confirmed_value=True, user=None, device_token_hash="b" * 64)
    db_session.commit()
    assert place.reliability_score > score_after_one  # a second person does count


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
