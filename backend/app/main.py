from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin_regions, categories, health, places
from app.core.config import settings

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
