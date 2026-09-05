"""Geospatial search integration tests - require a real PostGIS database
(see conftest.py; these are skipped, not failed, without one)."""

from __future__ import annotations

from geoalchemy2.shape import from_shape
from shapely.geometry import Point

from app.models.category import Category, PlaceCategory
from app.models.place import Place, PlaceStatus
from app.services.search import PlaceSearchParams, search_places

# Approximate Istanbul landmark coordinates, used only as realistic-looking
# fixture data - not sourced from any real place dataset.
TAKSIM = (41.0370, 28.9850)
KADIKOY = (40.9905, 29.0234)
ANKARA_KIZILAY = (39.9208, 32.8541)


def _place(name: str, lat: float, lon: float, **kwargs) -> Place:
    return Place(
        name=name,
        location=from_shape(Point(lon, lat), srid=4326),
        country_code="TR",
        status=kwargs.pop("status", PlaceStatus.active),
        **kwargs,
    )


def test_radius_search_finds_nearby_and_excludes_far(db_session):
    toilet_category = Category(slug="tuvalet", name_tr="Tuvalet", name_en="Toilet")
    db_session.add(toilet_category)
    db_session.flush()

    near = _place("Taksim Tuvaleti", *TAKSIM)
    far = _place("Ankara Tuvaleti", *ANKARA_KIZILAY)
    db_session.add_all([near, far])
    db_session.flush()
    db_session.add(PlaceCategory(place_id=near.id, category_id=toilet_category.id, is_primary=True))
    db_session.add(PlaceCategory(place_id=far.id, category_id=toilet_category.id, is_primary=True))
    db_session.commit()

    results = search_places(
        db_session, PlaceSearchParams(lat=TAKSIM[0], lon=TAKSIM[1], radius_m=5_000)
    )

    names = {p.name for p, _ in results}
    assert "Taksim Tuvaleti" in names
    assert "Ankara Tuvaleti" not in names


def test_radius_search_orders_by_distance_ascending(db_session):
    center_lat, center_lon = TAKSIM
    closer = _place("Yakın Park", center_lat + 0.001, center_lon)  # ~110m
    farther = _place("Uzak Park", center_lat + 0.02, center_lon)  # ~2.2km
    db_session.add_all([closer, farther])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams(lat=center_lat, lon=center_lon, radius_m=10_000))

    assert [p.name for p, _ in results] == ["Yakın Park", "Uzak Park"]
    assert results[0][1] < results[1][1]  # distance_m ascending


def test_category_filter_only_returns_matching_places(db_session):
    park = Category(slug="park", name_tr="Park", name_en="Park")
    toilet = Category(slug="tuvalet", name_tr="Tuvalet", name_en="Toilet")
    db_session.add_all([park, toilet])
    db_session.flush()

    park_place = _place("Gülhane Parkı", *TAKSIM)
    toilet_place = _place("Sirkeci Tuvaleti", *TAKSIM)
    db_session.add_all([park_place, toilet_place])
    db_session.flush()
    db_session.add(PlaceCategory(place_id=park_place.id, category_id=park.id, is_primary=True))
    db_session.add(PlaceCategory(place_id=toilet_place.id, category_id=toilet.id, is_primary=True))
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams(category_slugs=["park"]))

    names = {p.name for p, _ in results}
    assert names == {"Gülhane Parkı"}


def test_place_with_multiple_categories_matches_either_filter(db_session):
    # The core multi-category requirement from the brief: one physical
    # place (a park with an integrated playground) must show up whether
    # searching by "park" or by "oyun parkı".
    park = Category(slug="park", name_tr="Park", name_en="Park")
    playground = Category(slug="oyun-parki", name_tr="Oyun Parkı", name_en="Playground")
    db_session.add_all([park, playground])
    db_session.flush()

    combo_place = _place("Maçka Parkı", *TAKSIM)
    db_session.add(combo_place)
    db_session.flush()
    db_session.add(PlaceCategory(place_id=combo_place.id, category_id=park.id, is_primary=True))
    db_session.add(PlaceCategory(place_id=combo_place.id, category_id=playground.id, is_primary=False))
    db_session.commit()

    by_park = search_places(db_session, PlaceSearchParams(category_slugs=["park"]))
    by_playground = search_places(db_session, PlaceSearchParams(category_slugs=["oyun-parki"]))

    assert [p.name for p, _ in by_park] == ["Maçka Parkı"]
    assert [p.name for p, _ in by_playground] == ["Maçka Parkı"]


def test_amenity_filter_requires_all_given_amenities(db_session):
    both = _place("Erişilebilir Su Noktası", *TAKSIM, wheelchair_accessible=True, has_drinking_water=True)
    only_water = _place("Sadece Su", *TAKSIM, wheelchair_accessible=False, has_drinking_water=True)
    db_session.add_all([both, only_water])
    db_session.commit()

    results = search_places(
        db_session, PlaceSearchParams(amenities=["wheelchair_accessible", "has_drinking_water"])
    )

    assert [p.name for p, _ in results] == ["Erişilebilir Su Noktası"]


def test_null_amenity_excluded_from_filter(db_session):
    # A place with wheelchair_accessible=None (unknown, not "no") must not
    # satisfy a wheelchair_accessible=True filter - "unknown" is not "yes".
    unknown = _place("Bilinmeyen Erişim", *TAKSIM, wheelchair_accessible=None)
    known_false = _place("Erişimsiz", *TAKSIM, wheelchair_accessible=False)
    known_true = _place("Erişimli", *TAKSIM, wheelchair_accessible=True)
    db_session.add_all([unknown, known_false, known_true])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams(amenities=["wheelchair_accessible"]))

    assert [p.name for p, _ in results] == ["Erişimli"]


def test_free_only_filter(db_session):
    from app.models.place import PriceType

    free_place = _place("Ücretsiz Park", *TAKSIM, price_type=PriceType.free)
    paid_place = _place("Ücretli Otopark", *TAKSIM, price_type=PriceType.paid)
    db_session.add_all([free_place, paid_place])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams(is_free_only=True))

    assert [p.name for p, _ in results] == ["Ücretsiz Park"]


def test_pending_review_places_are_never_returned_by_public_search(db_session):
    pending = _place("Kullanıcının Önerdiği Yer", *TAKSIM, status=PlaceStatus.pending_review)
    active = _place("Onaylı Yer", *TAKSIM)
    db_session.add_all([pending, active])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams())

    assert [p.name for p, _ in results] == ["Onaylı Yer"]


def test_bbox_search_returns_places_within_envelope_only(db_session):
    inside = _place("İçeride", 41.00, 29.00)
    outside = _place("Dışarıda", 42.50, 35.00)
    db_session.add_all([inside, outside])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams(bbox=(28.5, 40.5, 29.5, 41.5)))

    names = {p.name for p, _ in results}
    assert names == {"İçeride"}


def test_empty_result_set_does_not_raise(db_session):
    results = search_places(db_session, PlaceSearchParams(lat=0.0, lon=0.0, radius_m=100))
    assert results == []


def test_temporarily_closed_places_stay_visible_in_search(db_session):
    # The PlaceStatus contract says temporarily_closed is "still shown but
    # flagged" - a closed toilet you can see beats one that vanished.
    flagged = _place("Tadilatta Tuvalet", *TAKSIM, status=PlaceStatus.temporarily_closed)
    gone = _place("Yıkılmış Tuvalet", *KADIKOY, status=PlaceStatus.permanently_closed)
    db_session.add_all([flagged, gone])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams())

    names = {p.name for p, _ in results}
    assert "Tadilatta Tuvalet" in names
    assert "Yıkılmış Tuvalet" not in names


def test_non_radius_search_pages_deterministically(db_session):
    # Same reliability everywhere, so ordering can only come from the
    # deliberate tie-break - without one, LIMIT/OFFSET pages could repeat
    # or drop rows between requests.
    db_session.add_all(
        [_place(f"Yer {i}", 41.0 + i * 1e-4, 29.0, reliability_score=0.5) for i in range(10)]
    )
    db_session.commit()

    bbox = (28.5, 40.5, 29.5, 41.5)
    page1 = search_places(db_session, PlaceSearchParams(bbox=bbox, limit=5, offset=0))
    page2 = search_places(db_session, PlaceSearchParams(bbox=bbox, limit=5, offset=5))
    again1 = search_places(db_session, PlaceSearchParams(bbox=bbox, limit=5, offset=0))

    ids1 = [p.id for p, _ in page1]
    ids2 = [p.id for p, _ in page2]
    assert ids1 == [p.id for p, _ in again1]      # stable across identical requests
    assert not set(ids1) & set(ids2)              # no overlap between pages
    assert len(ids1) + len(ids2) == 10            # nothing dropped


def test_higher_reliability_places_come_first_in_bbox_search(db_session):
    low = _place("Az Güvenilir", *TAKSIM, reliability_score=0.2)
    high = _place("Çok Güvenilir", *KADIKOY, reliability_score=0.9)
    db_session.add_all([low, high])
    db_session.commit()

    results = search_places(db_session, PlaceSearchParams(bbox=(28.5, 40.5, 29.5, 41.5)))

    assert [p.name for p, _ in results] == ["Çok Güvenilir", "Az Güvenilir"]
