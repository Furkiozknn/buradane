from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin_regions, auth, categories, health, places, reports
from app.core.config import settings

logger = logging.getLogger("buradane")

# Two layers, deliberately, and they are not redundant. The bootstrap gate
# in services/bootstrap.py REFUSES to create an admin under the shipped
# default secret - that is the control. But the gate only runs when
# BURADANE_ADMIN_EMAIL/PASSWORD are set: a deployment whose admin row
# already exists (bootstrapped once, env vars later removed - the rotation
# path bootstrap.py itself suggests) starts silently with a secret anyone
# can read in this public repository, and every one of that admin's tokens
# is forgeable. This warning is the signal for exactly that quiet case. It
# vanished once already, in a merge that judged the gate sufficient; the
# regression test in tests/test_default_secret_warning.py is why it cannot
# vanish quietly a second time.
if settings.jwt_secret == "dev-secret-change-in-production":
    logger.warning(
        "BURADANE_JWT_SECRET varsayilan degerde - bu deger herkese acik depoda"
        " yazili. Uretimde mutlaka degistirin:"
        " python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Never let more requests run than there are connections to serve them.
    #
    # Every endpoint here is a sync `def`, so Starlette hands each request
    # to anyio's default thread pool - 40 threads - and each one holds a DB
    # session for its whole life. Against the connection pool's ceiling
    # that is not a queue: the surplus requests wait pool_timeout (30s) at
    # the pool and then fail with "QueuePool limit ... reached". Measured
    # on a 5 + 10 pool: 40 concurrent requests, 15 served, 25 errors.
    #
    # Capping the thread pool at the ceiling moves the waiting to where it
    # is free - a request waits for a thread instead of a thread waiting
    # for a connection - so load past the limit is latency, not 500s. It
    # costs nothing here because this app puts nothing else in the thread
    # pool: no StaticFiles, no run_in_threadpool of its own, 11 endpoints
    # that all take a session.
    #
    # Imported here rather than at module scope to keep this file's existing
    # property that importing it touches no database machinery at all. (It
    # would be harmless - create_engine does not connect - but the deferred
    # import below was written for that reason and this one honours it.)
    from app.core.db import POOL_CEILING

    anyio.to_thread.current_default_thread_limiter().total_tokens = POOL_CEILING

    # Guarded entirely by config: a run without BURADANE_ADMIN_EMAIL/
    # PASSWORD (tests, discovery-only deployments) must not need a
    # reachable database just to start.
    if settings.admin_email and settings.admin_password:
        from app.core.db import SessionLocal
        from app.services.bootstrap import ensure_bootstrap_admin

        with SessionLocal() as db:
            ensure_bootstrap_admin(db)
    yield


app = FastAPI(
    title="buradane API",
    description="Türkiye'deki kamusal ve ortak kullanım alanlarını keşfetme platformu - API katmanı.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(places.router)
app.include_router(categories.router)
app.include_router(admin_regions.router)
app.include_router(auth.router)
app.include_router(reports.router)
