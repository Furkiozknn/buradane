"""One moderator account from the environment, ensured at startup.

The moderation endpoints (app/api/reports.py) sit behind AdminUser, but v1
deliberately has no self-serve registration - per the brief, accounts only
exist to moderate or attribute, never as a gate on using the product. So
the single moderator is bootstrapped from BURADANE_ADMIN_EMAIL /
BURADANE_ADMIN_PASSWORD: create-if-missing, never overwrite. A changed env
password does NOT silently rotate an existing user's credential - process
environments leak into too many places (shell history, unit files,
container inspect) to be trusted as the source of truth for an existing
secret; rotate by updating the row.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.user import User

logger = logging.getLogger(__name__)


def ensure_bootstrap_admin(db: Session) -> User | None:
    if not settings.admin_email or not settings.admin_password:
        return None
    if settings.jwt_secret == "dev-secret-change-in-production":
        # Refuse, don't warn: with the shipped default secret anyone who has
        # read this repository can mint an admin JWT, and the admin surface
        # is exactly the moderation power the consensus work exists to
        # protect. A warning in a log nobody reads is not a control. Local
        # dev sets BURADANE_JWT_SECRET right next to the two admin vars it
        # is already setting.
        raise RuntimeError(
            "refusing to create the bootstrap admin while BURADANE_JWT_SECRET "
            "is still the built-in dev default - anyone could forge an admin "
            "token. Set a real BURADANE_JWT_SECRET and restart."
        )
    user = db.execute(select(User).where(User.email == settings.admin_email)).scalar_one_or_none()
    if user is not None:
        if not user.is_admin:
            user.is_admin = True
            db.commit()
        return user
    user = User(
        email=settings.admin_email,
        hashed_password=hash_password(settings.admin_password),
        display_name="Moderator",
        is_admin=True,
    )
    db.add(user)
    db.commit()
    logger.info("bootstrap admin created")
    return user
