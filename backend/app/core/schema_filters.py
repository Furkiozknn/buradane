"""What autogenerate must ignore when comparing models to the database.

Lives here rather than in alembic/env.py because it has two consumers and
they MUST agree: env.py uses it when generating migrations, and
tests/test_migrations.py uses it when asserting that the models and the
migration chain have not drifted. A filter that applied to only one of
those would make the test either miss real drift or fail on a difference
env.py deliberately tolerates - and alembic/env.py is not importable as a
module (Alembic loads it by path), so the test could not have shared it
where it was.
"""

from __future__ import annotations

# PostGIS installs spatial_ref_sys into the public schema; it belongs to the
# extension, not this app, and without this filter every autogenerate run
# emits a bogus drop_table for it.
_POSTGIS_TABLES = {"spatial_ref_sys"}


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and name in _POSTGIS_TABLES:
        return False
    # Functional-index false positive: Postgres renders the expression as
    # (location::geometry(Point,4326)) while the model writes
    # CAST(location AS geometry(POINT,4326)) - the same index, different
    # text, and Alembic compares text. Excluded so every autogenerate run
    # doesn't emit a spurious drop/create; a deliberate change to this
    # index needs a hand-written migration.
    #
    # The cost, stated: an accidental production drop of this index would
    # not be flagged by the drift test either. That is the trade for not
    # crying wolf on every single run.
    if type_ == "index" and name == "ix_places_location_geom":
        return False
    return True
