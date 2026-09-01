"""Pure-function tests for the dedup scoring math - no database needed."""

from __future__ import annotations

from app.services.dedup import _haversine_m, _name_similarity, _normalize


def test_haversine_same_point_is_zero():
    assert _haversine_m(41.0, 29.0, 41.0, 29.0) == 0.0


def test_haversine_known_distance_istanbul_taksim_to_kadikoy():
    # Taksim Square (~41.0370, 28.9850) to Kadıköy (~40.9905, 29.0234) is
    # roughly 6-7km as the crow flies - a real-world sanity check, not an
    # exact fixture (coordinates are approximate landmark points).
    distance = _haversine_m(41.0370, 28.9850, 40.9905, 29.0234)
    assert 5_500 < distance < 7_500


def test_haversine_is_symmetric():
    a_to_b = _haversine_m(41.0, 29.0, 41.01, 29.01)
    b_to_a = _haversine_m(41.01, 29.01, 41.0, 29.0)
    assert abs(a_to_b - b_to_a) < 1e-6


def test_normalize_collapses_whitespace_and_case():
    assert _normalize("  Kadıköy   Parkı  ") == "kadıköy parkı"


def test_name_similarity_identical_names_is_one():
    assert _name_similarity("Kadıköy Parkı", "Kadıköy Parkı") == 1.0


def test_name_similarity_case_and_whitespace_insensitive():
    assert _name_similarity("KADIKÖY PARKI", "  kadıköy   parkı ") == 1.0


def test_name_similarity_different_names_is_low():
    assert _name_similarity("Kadıköy Parkı", "Beşiktaş Sahili") < 0.4


def test_name_similarity_near_match_is_high_but_not_one():
    score = _name_similarity("Kadıköy Halk Parkı", "Kadıköy Halk Park")
    assert 0.9 < score < 1.0
