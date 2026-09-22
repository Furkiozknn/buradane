"""places.access and places.operator

Two OSM tags the frontend already depends on and no schema produced. Both
gaps were written down in docs/api-sozlesme-farklari.md §4 as "modelde ve
şemada hiç yok", and the second one was only found because §4 became an
executable test:

    access    the demo drops `private` places and badges `customers` ones.
              With nothing to read it offers a locked service-yard toilet
              to someone looking for the nearest one.
    operator  `place-jsonld.ts` emits it as the JSON-LD `provider`, and
              `places-repository.ts` counts it toward the completeness part
              of the reliability score. Absent, both degrade silently.

Nullable with no default and no backfill, because "unknown" is the honest
state for 167,829 rows imported before the columns existed - a default of
`public` would turn a missing fact into a claim, which is the one thing
this schema's amenity columns exist to avoid (see models/place.py). The
values arrive on the next import: app/ingest/osm_overpass.py reads both
tags.

String rather than an enum for `access`: OSM's vocabulary has a long tail
(`permissive`, `destination`, `delivery`, `no`, ...) and a value this
schema has not seen must survive ingestion rather than abort a whole
province's import.

Revision ID: c3f8a1d05b47
Revises: b1c4e9a70d32
Create Date: 2026-09-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a1d05b47"
down_revision: Union[str, None] = "b1c4e9a70d32"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("places", sa.Column("access", sa.String(length=40), nullable=True))
    op.add_column("places", sa.Column("operator", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("places", "operator")
    op.drop_column("places", "access")
