"""The connection pool's ceiling is this app's real concurrency limit.

Every endpoint is a sync ``def``, so Starlette runs each request in anyio's
default thread pool and ``get_db`` holds a session for the whole request. If
more threads can run than there are connections to serve them, the surplus
requests do not queue - they wait ``pool_timeout`` at the pool and then fail.

Nothing here needs a database: the failure is a property of the pool, and a
QueuePool over in-memory SQLite exhibits it identically. That matters twice
over, because CI fails the build on any skipped test.
"""

from __future__ import annotations

import threading
import time

import anyio
import anyio.to_thread
from sqlalchemy import create_engine, text
from sqlalchemy.exc import TimeoutError as PoolTimeout
from sqlalchemy.pool import QueuePool

from app.core.config import settings
from app.core.db import POOL_CEILING, engine
from app.main import app, lifespan

# A pool_timeout small enough to keep the test quick. Production uses
# SQLAlchemy's 30s default, which makes the same failure far worse: every
# surplus request hangs for half a minute before its 500.
FAST_TIMEOUT = 0.3

#: How long each simulated request holds its connection. It has to outlast
#: FAST_TIMEOUT or nothing ever times out: at a hold shorter than the
#: timeout the pool simply recycles connections fast enough to serve
#: everyone, which is what a *brief* request looks like and is not the case
#: under test. (First draft of this test held for 0.2s against a 0.5s
#: timeout, served all 40, and proved nothing.)
HOLD_SECONDS = 0.6


def _burst(pool_size: int, max_overflow: int, *, requests: int, concurrency: int | None = None):
    """Fire `requests` concurrent "requests", each holding a connection for
    a moment, against a pool of the given shape. Returns (served, failed).

    `concurrency` caps how many run at once - that is the fix, expressed as
    the test expresses it: a limiter in front of the pool.
    """
    pool = create_engine(
        "sqlite:///file:pooltest?mode=memory&cache=shared&uri=true",
        poolclass=QueuePool,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=FAST_TIMEOUT,
        connect_args={"check_same_thread": False},
    )
    gate = threading.Semaphore(concurrency) if concurrency else None
    served, failed = [], []
    start = threading.Barrier(requests)

    def one_request():
        start.wait()
        if gate:
            gate.acquire()
        try:
            with pool.connect() as conn:
                conn.execute(text("select 1"))
                time.sleep(HOLD_SECONDS)  # a request that does some work
            served.append(1)
        except PoolTimeout:
            failed.append(1)
        finally:
            if gate:
                gate.release()

    threads = [threading.Thread(target=one_request) for _ in range(requests)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    pool.dispose()
    return len(served), len(failed)


def test_a_thread_pool_wider_than_the_connection_pool_drops_requests():
    """The failure this change exists to prevent, reproduced.

    SQLAlchemy's inherited defaults (5 + 10) against anyio's default 40
    threads: only the ceiling is served and everything past it errors. In
    production each of those errors arrives 30 seconds late.
    """
    served, failed = _burst(5, 10, requests=40)

    assert served == 15, f"a 5+10 pool served {served}"
    assert failed == 25, f"expected the other 25 to fail, got {failed}"


def test_capping_concurrency_at_the_ceiling_drops_nothing():
    """The same burst, with the limiter the app now installs: slower, but
    no request is lost. This is the whole argument for the change."""
    served, failed = _burst(5, 10, requests=40, concurrency=15)

    assert failed == 0, f"{failed} request(s) still failed under the cap"
    assert served == 40


def test_the_engine_uses_the_configured_pool_not_sqlalchemys_defaults():
    # Guards the wiring: settings that never reach create_engine would leave
    # the app on 5 + 10 while the docs and the limiter both say otherwise.
    assert engine.pool.size() == settings.db_pool_size
    assert engine.pool._max_overflow == settings.db_max_overflow
    assert POOL_CEILING == settings.db_pool_size + settings.db_max_overflow


def test_startup_caps_the_request_thread_pool_at_the_connection_ceiling(monkeypatch):
    """The invariant, checked by running the real lifespan rather than by
    re-reading the constant: once startup is done, no more requests can be
    in flight than there are connections to serve them.

    anyio.run gives the lifespan a fresh event loop, so the limiter starts
    at anyio's own default and nothing leaks into other tests. The admin
    settings are cleared so this never depends on a reachable database -
    CI fails the build on any skipped test, so it has to run everywhere.
    """
    monkeypatch.setattr(settings, "admin_email", None)
    monkeypatch.setattr(settings, "admin_password", None)

    async def start_and_read() -> tuple[int, int]:
        before = anyio.to_thread.current_default_thread_limiter().total_tokens
        async with lifespan(app):
            return before, anyio.to_thread.current_default_thread_limiter().total_tokens

    before, after = anyio.run(start_and_read)

    assert after == POOL_CEILING
    assert before != after or POOL_CEILING == 40, (
        f"the limiter was already {before}, so this test would pass without the fix"
    )


def test_the_default_ceiling_is_at_least_starlettes_own_thread_default():
    """A sanity floor on the sizing itself.

    Capping threads at the ceiling converts errors into queueing, but a
    ceiling far below the 40 requests the framework would otherwise run
    would trade one problem for a throughput one. 20 is deliberate: more
    concurrency than the 15 the old defaults actually served, and small
    enough that several workers stay clear of PostgreSQL's default
    max_connections of 100.
    """
    assert POOL_CEILING >= 20
    assert POOL_CEILING <= 40
