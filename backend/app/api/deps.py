"""Shared FastAPI dependencies: DB session and optional-auth current user.

Optional, not required - per the brief, core discovery and even
contributing (reports/verifications/suggestions) must work with zero
account. `get_current_user_optional` returns None rather than raising when
no/invalid token is present; only admin-only endpoints use the strict
variant.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.models.user import User

_bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def _decode_user_id(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    sub = payload.get("sub")
    if sub is None:
        return None
    try:
        return uuid.UUID(sub)
    except ValueError:
        return None


def get_current_user_optional(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)] = None,
) -> User | None:
    if credentials is None:
        return None
    user_id = _decode_user_id(credentials.credentials)
    if user_id is None:
        return None
    return db.get(User, user_id)


OptionalUser = Annotated[User | None, Depends(get_current_user_optional)]


def get_current_admin(user: OptionalUser) -> User:
    if user is None or not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin access required")
    return user


AdminUser = Annotated[User, Depends(get_current_admin)]
