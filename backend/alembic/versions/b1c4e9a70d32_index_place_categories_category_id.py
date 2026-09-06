"""index place_categories.category_id

The composite primary key (place_id, category_id) cannot serve a lookup by
category_id alone - btree needs the leading column - and "every place in
category X" is the query behind every category filter in the app.

Measured on a local PostgreSQL 16 / PostGIS 3.4 cluster loaded to the live
dataset's size (167,829 places, 281,679 category links):

    category holding    400 links   39ms -> 22ms   bitmap index scan
    category holding 20,000 links   65ms -> 64ms   planner ignores it

The second row is the point of the first: at 14% of the table a sequential
scan is genuinely the cheaper plan and PostgreSQL picks it, so this index
costs one write per link and buys nothing on broad filters - and half the
query on narrow ones, which is what a need-driven finder is asked for.

Deliberately NOT added alongside it: (status, reliability_score DESC). It
was the other half of the same audit note, and it is never chosen at any
selectivity - `status IN ('active','temporarily_closed')` keeps 71% of the
rows (119,894 of 167,829), so the planner sequentially scans `places` in
every plan measured. An index there would be write cost for nothing.

Revision ID: b1c4e9a70d32
Revises: a237a92362fc
Create Date: 2026-09-06

"""
from typing import Sequence, Union

from alembic import op

revision: str = "b1c4e9a70d32"
down_revision: Union[str, None] = "a237a92362fc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_place_categories_category", "place_categories", ["category_id"])


def downgrade() -> None:
    op.drop_index("ix_place_categories_category", table_name="place_categories")
