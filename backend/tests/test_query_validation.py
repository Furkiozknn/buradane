"""Query-string validation on the public read endpoints.

Two holes this closes, both reproduced against a running API before the fix:

- `GET /places?offset=99999999999999999999` answered **500**. FastAPI's
  `ge=0` accepts any Python int, psycopg then fails to bind it as BIGINT,
  and the error escaped as an Internal Server Error with a traceback in
  the log. An unauthenticated caller could produce server errors at will.
- `bbox` was only checked for "four numbers". `nan`, `inf`, `500,500,...`
  and an inverted box (min > max) all answered **200 with an empty list** -
  indistinguishable from "there is nothing here", which is the one answer
  this product must never give falsely.
"""

from __future__ import annotations

import pytest

from app.api.places import MAX_OFFSET
from app.core.security import create_access_token, hash_password
from app.models.user import User


class TestOffsetCeiling:
    def test_offset_past_bigint_is_a_422_not_a_500(self, client):
        response = client.get("/places", params={"offset": "99999999999999999999"})
        assert response.status_code == 422

    def test_offset_above_the_ceiling_is_refused(self, client):
        response = client.get("/places", params={"offset": MAX_OFFSET + 1})
        assert response.status_code == 422

    def test_offset_at_the_ceiling_is_accepted(self, client):
        response = client.get("/places", params={"offset": MAX_OFFSET})
        assert response.status_code == 200

    def test_reports_queue_has_the_same_ceiling(self, client, db_session, api_jwt_secret):
        # Admin-only: without a real admin token the request stops at 403
        # before the offset is ever used, so this proves nothing unless it
        # authenticates first.
        admin = User(email="mod@buradane.example", hashed_password=hash_password("x" * 12), is_admin=True)
        db_session.add(admin)
        db_session.flush()
        headers = {"Authorization": f"Bearer {create_access_token(admin.id)}"}

        assert client.get("/reports", headers=headers).status_code == 200
        response = client.get("/reports", params={"offset": "99999999999999999999"}, headers=headers)
        assert response.status_code == 422


class TestBboxValidation:
    @pytest.mark.parametrize(
        "bbox",
        [
            "nan,nan,nan,nan",
            "inf,-inf,1e400,5",
            "28.9,40.9,inf,41.1",
            "500,40,501,41",  # longitude out of range
            "28,-91,29,41",  # latitude out of range
            "29.1,40.9,28.9,41.1",  # min_lon > max_lon
            "28.9,41.1,29.1,40.9",  # min_lat > max_lat
        ],
    )
    def test_unusable_bbox_is_a_400(self, client, bbox):
        response = client.get("/places", params={"bbox": bbox})
        assert response.status_code == 400, response.text

    def test_a_real_viewport_is_accepted(self, client):
        response = client.get("/places", params={"bbox": "28.9,40.9,29.1,41.1"})
        assert response.status_code == 200
        assert response.json() == []

    def test_a_degenerate_point_box_is_accepted(self, client):
        # min == max is a valid (if tiny) envelope, not an error.
        response = client.get("/places", params={"bbox": "29,41,29,41"})
        assert response.status_code == 200
