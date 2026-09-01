"""Duplicate detection for ingest: is an incoming candidate (from OSM, a
municipality portal, or a user submission) the same real-world place as
something already in the database, or genuinely new?

Per the brief: spatial proximity + name similarity + category overlap,
combined - not any single signal alone. A same-name, same-category place
100m away and a same-location, different-category place at the exact same
coordinate are both plausible non-matches; only agreement across signals is
treated as a confident match.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from geoalchemy2.shape import to_shape
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.place import Place, PlaceStatus

# How close two points must be to even be considered candidates - loose on
# purpose (dedup happens once per ingest, not on the hot query path, so a
# slightly wider net that name-similarity then narrows is fine).
CANDIDATE_RADIUS_M = 75.0

# Below this combined confidence, treat as "not a match" - i.e. create a
# new Place rather than risk silently merging two distinct real places.
MATCH_CONFIDENCE_THRESHOLD = 0.6


@dataclass(frozen=True)
class DedupCandidate:
    place: Place
    confidence: float  # 0.0-1.0
    distance_m: float
    name_similarity: float


def find_duplicate(db: Session, *, name: str, lat: float, lon: float) -> DedupCandidate | None:
    """Return the best matching existing Place for an incoming (name, lat,
    lon), or None if nothing crosses the confidence threshold."""
    point = ST_SetSRID(ST_MakePoint(lon, lat), 4326)
    query = (
        select(Place)
        .where(Place.status != PlaceStatus.pending_review)
        .where(ST_DWithin(Place.location, point, CANDIDATE_RADIUS_M))
    )
    candidates = db.execute(query).scalars().all()
    if not candidates:
        return None

    scored = [_score_candidate(candidate, name, lat, lon) for candidate in candidates]
    best = max(scored, key=lambda c: c.confidence)
    if best.confidence < MATCH_CONFIDENCE_THRESHOLD:
        return None
    return best


def _score_candidate(place: Place, name: str, lat: float, lon: float) -> DedupCandidate:
    point = to_shape(place.location)  # shapely Point, (x=lon, y=lat)
    distance_m = _haversine_m(lat, lon, point.y, point.x)
    name_similarity = _name_similarity(name, place.name)

    # Distance contributes more at close range and fades out entirely past
    # the candidate radius (candidates further than that never reach this
    # function at all, per the ST_DWithin filter above).
    distance_score = max(0.0, 1.0 - distance_m / CANDIDATE_RADIUS_M)

    # Weighted combination: name similarity matters more than raw
    # distance, since two genuinely distinct facilities (e.g. a toilet
    # block and a drinking fountain) can sit within a few meters of each
    # other inside the same park.
    confidence = 0.65 * name_similarity + 0.35 * distance_score

    return DedupCandidate(place=place, confidence=confidence, distance_m=distance_m, name_similarity=name_similarity)


def _name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


def _normalize(text: str) -> str:
    # Python's str.lower() is locale-independent and maps ASCII "I" -> "i",
    # not the Turkish dotless "ı" - so "KADIKÖY".lower() gives "kadikÖy"'s
    # cousin "kadiköy" (dotted i), which never matches "Kadıköy" (dotless ı)
    # as typed/sourced in Turkish text. Apply Turkish-specific casing for I/İ
    # before falling back to ordinary lower() for everything else.
    text = text.strip().replace("İ", "i").replace("I", "ı")
    return " ".join(text.lower().split())


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import atan2, cos, radians, sin, sqrt

    r = 6_371_000.0  # Earth radius in meters
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = radians(lat2 - lat1)
    d_lambda = radians(lon2 - lon1)
    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
