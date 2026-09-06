"""How many round trips one read costs.

The serializer builds `categories` from `place.place_categories[*].category`
- two relationship hops. Whether that costs two queries or 2 + N is decided
entirely by whether the query that fetched the place asked for them, so it
is a property of the endpoint, not of the schema, and nothing else in the
suite would notice it changing.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import event

from app.core.db import engine
from app.models.category import Category, PlaceCategory
from app.models.place import Place, PlaceStatus


@pytest.fixture
def count_sql():
    """Count statements the app's engine emits inside the `with` block."""
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "after_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "after_cursor_execute", record)


def _place_with_categories(db_session, n: int) -> uuid.UUID:
    categories = [
        Category(slug=f"qc-{i}", name_tr=f"Kategori {i}", name_en=f"Category {i}", icon="x")
        for i in range(n)
    ]
    db_session.add_all(categories)
    db_session.flush()

    place = Place(
        name="Moda Parkı",
        location="SRID=4326;POINT(29.02 40.98)",
        country_code="TR",
        status=PlaceStatus.active,
    )
    db_session.add(place)
    db_session.flush()
    for category in categories:
        db_session.add(PlaceCategory(place_id=place.id, category_id=category.id))
    db_session.flush()

    # The endpoint shares this session (see conftest's client fixture), and
    # production does not: get_db hands every request a fresh one, so the
    # identity map it reads is empty. Expunging reproduces that here.
    #
    # expire_all() is NOT enough, and the difference is the whole point:
    # against an expired-but-present instance, Session.get() refreshes the
    # row without applying the relationship loader options, so the count
    # came back 2 + N even with the fix in place - a test that would have
    # failed on correct code. Expunging forces the real query, options and
    # all. It also turns `location` into the WKBElement the serializer
    # needs, rather than the EWKT string it was assigned.
    place_id = place.id
    db_session.expunge_all()
    return place_id


@pytest.mark.parametrize("n_categories", [1, 3, 14])
def test_place_detail_costs_the_same_number_of_queries_at_any_category_count(
    client, db_session, count_sql, n_categories
):
    """The regression: a plain db.get() left both hops lazy, so the endpoint
    cost 2 + N queries. Measured against PostGIS before the fix - 3 at one
    category, 5 at three, 10 at eight, 16 at fourteen - while the search
    path, which loads the same two hops, stayed flat at 3 throughout. That
    asymmetry is why nobody noticed: the list everyone looks at was fine.

    14 is not a made-up ceiling; it is how many categories the app defines.
    """
    place_id = _place_with_categories(db_session, n_categories)

    count_sql.clear()
    response = client.get(f"/places/{place_id}")

    assert response.status_code == 200
    assert len(response.json()["categories"]) == n_categories, "the data must still arrive"
    assert len(count_sql) == 3, (
        f"{len(count_sql)} queries for {n_categories} categories - the "
        f"relationships are being loaded one at a time again"
    )


def test_place_list_costs_the_same_number_of_queries_at_any_result_count(
    client, db_session, count_sql
):
    """The other half of the invariant, and the reason the endpoint above
    could drift without anyone noticing. Kept as a test rather than trusted:
    an N+1 here is multiplied by the page size."""
    for i in range(12):
        place = Place(
            name=f"Yer {i}",
            location=f"SRID=4326;POINT(29.{i:03d} 41.{i:03d})",
            country_code="TR",
            status=PlaceStatus.active,
        )
        db_session.add(place)
    db_session.flush()
    db_session.expunge_all()  # see _place_with_categories

    count_sql.clear()
    response = client.get("/places?limit=12")

    assert response.status_code == 200 and len(response.json()) == 12
    assert len(count_sql) <= 3, f"{len(count_sql)} queries for a 12-row page"
