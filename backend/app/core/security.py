"""Password hashing and JWT issuance - the missing half of the auth stack.

api/deps.py could always *decode* a bearer token, but nothing in the
application could create one: there was no login endpoint and the declared
password-hashing dependency was never imported. In practice OptionalUser
was always None, AdminUser was unreachable, and every pending report
dragged its place's reliability score down with no path to resolution.

Uses the `bcrypt` library directly rather than passlib: passlib is
unmaintained (last release 2020) and its import-time self-test crashes
against bcrypt >= 4.1, which is what actually installs today.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    data = password.encode()
    if len(data) > 72:
        # bcrypt reads only the first 72 bytes; refusing beats silently
        # accepting a password whose tail is never checked.
        raise ValueError("password longer than bcrypt's 72-byte limit")
    return bcrypt.hashpw(data, bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: uuid.UUID) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(
        {"sub": str(user_id), "exp": expires},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
