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


def test_the_api_client_fixture_installs_a_secret_that_actually_authenticates(api_jwt_secret):
    """The other side of the refusal, and the regression this file was
    missing.

    When _decode_user_id started refusing every token under the published
    default, six tests in test_admin_moderation.py went red in CI and only
    in CI: they log in, get a genuinely valid token, and then get 403 on it.
    Nothing was wrong with the auth code - the suite was simply exercising
    the API under the secret the app is built to distrust, and no test said
    so.

    Two halves, because the first draft only had the first and a mutation
    that deleted the fixture wiring sailed straight through it:

    1. the value is usable - not the default, and a token minted under it
       decodes;
    2. the client fixture actually asks for it.

    Note it takes api_jwt_secret as an argument rather than patching the
    setting itself. That is the third mutation talking: a version that did
    its own monkeypatching still passed when the fixture was gutted into a
    plain `return`, because it was never exercising the fixture at all.

    Needs no database, so it runs everywhere - including the machines where
    the admin tests it protects skip.
    """
    import inspect
    import uuid

    from app.api import deps
    from app.core.security import create_access_token

    from .test_admin_moderation import client as client_fixture

    assert api_jwt_secret != deps.DEFAULT_JWT_SECRET
    # The fixture must have *installed* it, not merely named it.
    assert settings.jwt_secret == api_jwt_secret

    user_id = uuid.uuid4()
    assert deps._decode_user_id(create_access_token(str(user_id))) == user_id

    # pytest wraps a fixture function; __wrapped__ is the one that declares
    # the dependencies. Structural on purpose: asserting the value is right
    # says nothing about whether anything installs it.
    params = inspect.signature(client_fixture.__wrapped__).parameters
    assert "api_jwt_secret" in params, (
        "the API client fixture no longer requests api_jwt_secret - every "
        "authenticated request it makes will be refused at the door"
    )
