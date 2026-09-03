"""Shared fixtures.

Honest limitation of this build environment: no Docker/PostgreSQL was
available while writing this repo (verified: `docker` isn't on PATH here),
so the DB-backed tests (search, dedup against real rows, moderation writes,
API integration) could not be executed locally during development - they
are written against the actual SQLAlchemy/GeoAlchemy2/FastAPI APIs to the
best of this session's knowledge, but not run here. They DO run in CI
(.github/workflows/ci.yml spins up a real postgis service container) and
will run locally once `docker compose up -d db` has been run - see
README.md "Development" section.

`db_session` below tries to connect to `settings.database_url` and skips
(not fails) every test that requests it if no database is reachable, so
`uv run pytest` still gives a clean, honest signal in an environment
without Postgres rather than a wall of connection-refused errors.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import Base, SessionLocal, engine, get_db


def _database_reachable() -> bool:
    """Probe with an explicit timeout, on a throwaway engine.

    The shared `engine` has no `connect_timeout`, and libpq will not give up
    on its own within any useful period: measured here on Windows with
    nothing listening on 5432, the connect had still not returned after 150
    seconds. Because this probe runs at module import, `pytest` hung during
    collection rather than skipping - the exact opposite of what the module
    docstring above promises, and a wall a contributor without Docker hits
    before running a single test.

    A separate engine is used so the production one in app/core/db.py keeps
    its own connection settings; this timeout is a test-harness concern, not
    an application one. Two seconds is libpq's effective minimum and is far
    more than a local or CI database - which CI health-checks before the job
    starts - needs to answer.
    """
    probe = create_engine(settings.database_url, connect_args={"connect_timeout": 2})
    try:
        with probe.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
    finally:
        probe.dispose()


DB_AVAILABLE = _database_reachable()


@pytest.fixture
def db_session() -> Session:
    if not DB_AVAILABLE:
        pytest.skip(f"no reachable database at the configured DATABASE_URL - see conftest.py docstring")

    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
        session.rollback()
    finally:
        # Truncate rather than drop, so PostGIS extension/type setup done
        # once at DB creation time isn't repeated on every test.
        session.execute(text("TRUNCATE TABLE places, categories, admin_regions, data_sources, users RESTART IDENTITY CASCADE"))
        session.commit()
        session.close()


@pytest.fixture
def client(db_session: Session) -> TestClient:
    """A FastAPI TestClient whose `get_db` dependency is overridden to use
    the same transactional test session as `db_session`, so a test can set
    up fixture rows via `db_session` and then hit the real API against
    them in one test."""
    from app.main import app

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)
