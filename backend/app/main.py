from __future__ import annotations

import logging
import warnings

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin_regions, categories, health, places
from app.core.config import settings

logger = logging.getLogger("buradane")

# The default JWT secret is a working value on purpose - local development
# must not require ceremony - but a deployment that keeps it lets anyone who
# reads this public repository mint valid tokens. Shouting at import time is
# the strongest thing that cannot break development: every server start and
# every test run prints it until the variable is set, and it cannot be
# missed the way a line in a settings file can.
if settings.jwt_secret == "dev-secret-change-in-production":
    _msg = (
        "BURADANE_JWT_SECRET varsayılan değerde! Bu değer herkese açık depoda "
        "yazılı - üretimde MUTLAKA değiştirin: "
        "python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )
    logger.warning(_msg)
    warnings.warn(_msg, stacklevel=1)

app = FastAPI(
    title="buradane API",
    description="Türkiye'deki kamusal ve ortak kullanım alanlarını keşfetme platformu - API katmanı.",
    version="0.1.0",
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
