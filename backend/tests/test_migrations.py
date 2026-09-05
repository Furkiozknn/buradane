"""The Alembic baseline must not drift from the models: every table the
metadata knows must be created by a migration, and vice versa. Static
parity - no database needed - so adding a model without writing its
migration fails CI immediately instead of surfacing at deploy time."""

from __future__ import annotations

import re
from pathlib import Path

import app.models  # noqa: F401 - populates Base.metadata
from app.core.db import Base

VERSIONS_DIR = Path(__file__).parent.parent / "alembic" / "versions"


def _migrated_tables() -> set[str]:
    created: set[str] = set()
    dropped: set[str] = set()
    for migration in VERSIONS_DIR.glob("*.py"):
        source = migration.read_text()
        upgrade_body = source.split("def upgrade", 1)[1].split("def downgrade", 1)[0]
        created |= set(re.findall(r"op\.create_table\(\s*'([^']+)'", upgrade_body))
        dropped |= set(re.findall(r"op\.drop_table\(\s*'([^']+)'", upgrade_body))
    return created - dropped


def test_every_model_table_has_a_migration_and_no_migration_is_orphaned():
    assert _migrated_tables() == set(Base.metadata.tables)


def test_upgrade_downgrade_upgrade_cycle_leaves_no_debris(monkeypatch):
    """The full reversibility check, against a scratch database. The first
    baseline shipped a downgrade that leaked all six Postgres enum TYPEs
    (drop_table never drops them), so the *second* upgrade died on
    DuplicateObject - found only by running the cycle both ways. This test
    keeps that property from regressing."""
    from alembic import command
    from alembic.config import Config as AlembicConfig
    from sqlalchemy import create_engine, make_url, text

    from app.core.config import settings
    from tests.conftest import DB_AVAILABLE

    if not DB_AVAILABLE:
        pytest.skip("no reachable database - see conftest.py docstring")

    base_url = make_url(settings.database_url)
    scratch_name = "buradane_migration_cycle_test"
    admin_engine = create_engine(base_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{scratch_name}"'))
            conn.execute(text(f'CREATE DATABASE "{scratch_name}"'))
    except Exception as exc:  # pragma: no cover - permissions vary by env
        pytest.skip(f"cannot create a scratch database here: {exc}")

    scratch_url = base_url.set(database=scratch_name)
    backend_dir = Path(__file__).parent.parent
    cfg = AlembicConfig(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    # env.py reads settings.database_url at run time; point it at scratch.
    # render_as_string(hide_password=False), NOT str(): URL.__str__ masks
    # the password as literal "***", which a trust-auth local cluster
    # happily accepts and CI's scram-auth Postgres rejects - exactly the
    # local-green/CI-red gap this suite exists to close.
    monkeypatch.setattr(
        settings, "database_url", scratch_url.render_as_string(hide_password=False)
    )

    try:
        with create_engine(scratch_url).connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            conn.commit()
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "base")
        with create_engine(scratch_url).connect() as conn:
            leftover_enums = conn.execute(
                text("SELECT count(*) FROM pg_type WHERE typtype = 'e'")
            ).scalar_one()
            leftover_tables = conn.execute(
                text(
                    "SELECT count(*) FROM pg_tables WHERE schemaname = 'public' "
                    "AND tablename NOT IN ('spatial_ref_sys', 'alembic_version')"
                )
            ).scalar_one()
        assert leftover_enums == 0, "downgrade must drop the enum types it created"
        assert leftover_tables == 0
        command.upgrade(cfg, "head")  # the run that used to die on DuplicateObject
    finally:
        with admin_engine.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{scratch_name}" WITH (FORCE)'))
        admin_engine.dispose()
