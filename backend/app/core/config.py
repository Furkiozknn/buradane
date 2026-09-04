"""App configuration, read from environment / .env.

`active_country` exists specifically so nothing downstream hardcodes
"Turkey" as a string constant scattered through the codebase - v1 only
*activates* Turkey (see docs/ARCHITECTURE.md for why), but every query that
needs to scope by country reads this setting instead of a literal.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="BURADANE_", extra="ignore")

    database_url: str = "postgresql+psycopg://buradane:buradane@localhost:5432/buradane"

    # ISO 3166-1 alpha-2. v1 supports exactly one active country; the schema
    # (AdminRegion.country_code, Place.country_code) is not hardcoded to it.
    active_country: str = "TR"

    jwt_secret: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 14  # 14 days

    # A time-decayed report/verification older than this is still shown, but
    # flagged as low-confidence in the reliability score (see
    # app/services/reliability.py) rather than silently trusted forever.
    stale_after_days: int = 90

    cors_origins: list[str] = ["http://localhost:3000"]

    # How many DISTINCT submitters (accounts or anonymous devices) must
    # confirm the same field/value inside the freshness window before a
    # verification actually flips the public record. One phone in a shell
    # loop must never be able to falsify accessibility data - the audit
    # demonstrated exactly that against the previous apply-immediately
    # behavior.
    verification_consensus: int = 2

    # Community writes per client IP: a refilling budget of
    # write_rate_limit_per_hour with short bursts up to
    # write_rate_limit_burst. In-process state - honest for the current
    # single-process deployment; a multi-process deployment moves this to
    # its proxy or a shared store.
    write_rate_limit_per_hour: int = 30
    write_rate_limit_burst: int = 10


settings = Settings()
