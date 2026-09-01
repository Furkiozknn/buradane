"""Pure-function tests, no database needed - see conftest.py's docstring
for why the DB-dependent tests live separately and are skipped in
environments without a reachable PostGIS instance (this repo was built in
one, so these are the tests actually run/verified during development;
CI runs everything, including the DB-backed suite)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.reliability import ReliabilityInputs, compute_reliability_score, freshness_label

NOW = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)


def _inputs(**overrides) -> ReliabilityInputs:
    defaults = dict(
        source_weights=[0.7],
        last_verified_at=None,
        last_reported_at=None,
        recent_verification_count=0,
        pending_conflicting_reports=0,
        has_photos=False,
        stale_after_days=90,
        now=NOW,
    )
    defaults.update(overrides)
    return ReliabilityInputs(**defaults)


def test_no_signals_returns_base_source_weight():
    score = compute_reliability_score(_inputs(source_weights=[0.7]))
    assert score == 0.7


def test_no_source_at_all_uses_neutral_default():
    score = compute_reliability_score(_inputs(source_weights=[]))
    assert score == 0.4


def test_strongest_source_wins_not_average():
    score = compute_reliability_score(_inputs(source_weights=[0.2, 0.9, 0.5]))
    assert score == 0.9


def test_fresh_verification_today_gives_maximum_freshness_bonus():
    score = compute_reliability_score(_inputs(source_weights=[0.5], last_verified_at=NOW))
    assert score > 0.5 + 0.29  # ~full +0.3 bonus at age=0


def test_verification_bonus_decays_linearly_with_age():
    recent = compute_reliability_score(_inputs(source_weights=[0.5], last_verified_at=NOW - timedelta(days=5)))
    old = compute_reliability_score(_inputs(source_weights=[0.5], last_verified_at=NOW - timedelta(days=80)))
    assert recent > old


def test_verification_past_stale_window_still_helps_a_little_not_zero():
    just_over = compute_reliability_score(_inputs(source_weights=[0.5], last_verified_at=NOW - timedelta(days=91)))
    way_over = compute_reliability_score(_inputs(source_weights=[0.5], last_verified_at=NOW - timedelta(days=300)))
    assert just_over > 0.5  # still a small residual bonus
    assert way_over >= 0.5  # decays toward (not below) the base, never penalizes


def test_multiple_recent_verifications_increase_score_but_capped():
    few = compute_reliability_score(_inputs(source_weights=[0.5], recent_verification_count=2))
    many = compute_reliability_score(_inputs(source_weights=[0.5], recent_verification_count=20))
    assert few > 0.5
    assert many - 0.5 <= 0.15 + 1e-9  # bonus capped at 0.15 regardless of count


def test_pending_conflicting_reports_reduce_score():
    score = compute_reliability_score(_inputs(source_weights=[0.7], pending_conflicting_reports=2))
    assert score < 0.7


def test_conflicting_reports_penalty_is_capped():
    moderate = compute_reliability_score(_inputs(source_weights=[0.9], pending_conflicting_reports=3))
    extreme = compute_reliability_score(_inputs(source_weights=[0.9], pending_conflicting_reports=50))
    assert extreme == moderate  # both hit the 0.4 cap


def test_score_never_goes_below_zero_or_above_one():
    floor = compute_reliability_score(_inputs(source_weights=[0.05], pending_conflicting_reports=50))
    ceiling = compute_reliability_score(
        _inputs(source_weights=[1.0], last_verified_at=NOW, recent_verification_count=50, has_photos=True)
    )
    assert 0.0 <= floor <= 1.0
    assert 0.0 <= ceiling <= 1.0


def test_recent_unverified_report_reduces_score_slightly():
    score = compute_reliability_score(_inputs(source_weights=[0.7], last_reported_at=NOW - timedelta(days=1)))
    assert score < 0.7


def test_report_older_than_a_subsequent_verification_does_not_penalize():
    # A report came in, then someone verified the fact afterward - the
    # verification should "win" and not still be penalized by the stale report.
    score = compute_reliability_score(
        _inputs(
            source_weights=[0.7],
            last_reported_at=NOW - timedelta(days=10),
            last_verified_at=NOW - timedelta(days=1),
        )
    )
    baseline = compute_reliability_score(_inputs(source_weights=[0.7], last_verified_at=NOW - timedelta(days=1)))
    assert score == baseline


def test_has_photos_gives_small_bonus():
    without = compute_reliability_score(_inputs(source_weights=[0.5], has_photos=False))
    with_photos = compute_reliability_score(_inputs(source_weights=[0.5], has_photos=True))
    assert with_photos > without


# --- freshness_label ---------------------------------------------------

def test_freshness_label_never_verified():
    assert freshness_label(None, now=NOW) == "Henüz doğrulanmadı"


def test_freshness_label_today():
    assert freshness_label(NOW - timedelta(hours=2), now=NOW) == "Bugün doğrulandı"


def test_freshness_label_yesterday():
    assert freshness_label(NOW - timedelta(days=1, hours=1), now=NOW) == "Dün doğrulandı"


def test_freshness_label_days_ago():
    assert freshness_label(NOW - timedelta(days=5), now=NOW) == "5 gün önce doğrulandı"


def test_freshness_label_months_ago():
    assert freshness_label(NOW - timedelta(days=65), now=NOW) == "2 ay önce doğrulandı"


def test_freshness_label_years_ago():
    assert freshness_label(NOW - timedelta(days=400), now=NOW) == "1 yıl önce doğrulandı"


def test_freshness_label_handles_naive_datetime():
    # last_verified_at coming from a DB row without tzinfo must not crash.
    naive = NOW.replace(tzinfo=None) - timedelta(days=3)
    assert freshness_label(naive, now=NOW) == "3 gün önce doğrulandı"
