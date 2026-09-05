"""POST /auth/login - the only way to obtain a JWT in v1.

There is intentionally no /auth/register: accounts are moderator/attribution
infrastructure (see app/services/bootstrap.py), not a product feature, and
an open registration endpoint would only be spam surface. Login shares the
community-write rate limiter, which doubles as brute-force throttling.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.ratelimit import limit_writes
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

# Verified against when the email is unknown, so a login attempt costs one
# bcrypt either way - otherwise response timing says which emails exist.
_DUMMY_HASH = hash_password("this-password-can-never-match")


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenOut, dependencies=[Depends(limit_writes)])
def login(payload: LoginIn, db: DbSession) -> TokenOut:
    user = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if user is None:
        verify_password(payload.password, _DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    if not verify_password(payload.password, user.hashed_password) or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    return TokenOut(access_token=create_access_token(user.id))
