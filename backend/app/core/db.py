"""SQLAlchemy engine/session setup, plus the declarative Base every model
inherits from."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

#: The most connections this process will ever hold open at once.
#:
#: It is also, in practice, the app's request-concurrency limit. Every
#: endpoint here is a sync ``def``, so Starlette runs each request in
#: anyio's default thread pool, and ``get_db`` below holds a session for
#: the whole request. A thread pool wider than this ceiling is therefore
#: not a queue -- past the ceiling a request waits ``pool_timeout`` (30s
#: by default) and *then* fails with "QueuePool limit of size N overflow M
#: reached", which the client sees as a 500 rather than a slow 200.
#:
#: Measured against SQLAlchemy's inherited 5 + 10 defaults with anyio's
#: default 40 threads: of 40 concurrent requests, 15 were served and 25
#: failed. app/main.py closes that gap from the other side by binding the
#: thread limiter to this number, so the waiting happens where it is free.
POOL_CEILING = settings.db_pool_size + settings.db_max_overflow

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
