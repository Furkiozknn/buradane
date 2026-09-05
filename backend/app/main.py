from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin_regions, auth, categories, health, places, reports
from app.core.config import settings


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
