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
