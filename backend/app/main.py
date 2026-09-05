from __future__ import annotations

import logging
from contextlib import asynccontextmanager

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
