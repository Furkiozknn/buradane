"""Locks the default-secret startup warning in place.

The warning was added, then silently deleted by a merge that judged the
bootstrap refuse-gate sufficient. The gate only fires when the bootstrap
admin variables are set; a deployment whose admin row already exists starts
with no signal at all while its secret sits in a public repository. This
test is why the next merge cannot drop the warning without going red.
"""

from __future__ import annotations

import importlib
import logging

from app.core.config import settings


def test_default_secret_emits_a_warning_at_import(caplog):
    assert settings.jwt_secret == "dev-secret-change-in-production", (
        "test ortaminda gercek bir secret ayarlanmis - bu test varsayilan"
        " degerin uyari uretmesini kilitler"
    )
    import app.main

    with caplog.at_level(logging.WARNING, logger="buradane"):
        importlib.reload(app.main)

    assert any(
        "BURADANE_JWT_SECRET" in record.message and "varsayilan" in record.message
        for record in caplog.records
    ), "varsayilan JWT secret uyarisi kayboldu - onceki kaybolusun tekrari"


def test_no_token_is_accepted_under_the_published_default_secret(monkeypatch):
    """The bootstrap gate refuses to CREATE an admin under the default
    secret, but it only runs when the admin env vars are set - a deployment
    whose admin row already exists and whose bootstrap vars were removed
    (the rotation path bootstrap.py recommends) starts under a secret this
    public repository prints, and every admin token is forgeable. This is
    the same refusal at the door instead of at setup."""
    import uuid

    from app.api import deps
    from app.core.config import settings
    from app.core.security import create_access_token

    user_id = uuid.uuid4()

    # A genuinely valid token, minted under a real secret.
    monkeypatch.setattr(settings, "jwt_secret", "a-real-secret-nobody-published")
    token = create_access_token(str(user_id))
    assert deps._decode_user_id(token) == user_id

    # The same token, with the deployment left on the published default:
    # refused outright rather than decoded.
    monkeypatch.setattr(settings, "jwt_secret", deps.DEFAULT_JWT_SECRET)
    forged = create_access_token(str(user_id))
    assert deps._decode_user_id(forged) is None
