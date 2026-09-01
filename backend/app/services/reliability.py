"""How "Bu bilgi ne kadar güncel?" gets answered.

Deliberately a pure function over plain inputs (not something that reaches
into the DB itself) so it's trivial to unit test every factor in isolation,
and so a future background job can recompute it in bulk without importing
half the ORM layer.

Score is 0.0-1.0. This is a simple, explainable, hand-tunable formula for
v1 - not a learned model. The factors are exactly the ones the brief lists:
official source, recency of verification, multiple independent
verifications, unresolved conflicting reports, and staleness.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class ReliabilityInputs:
    source_weights: list[float]  # reliability_weight of every DataSource backing this place
    last_verified_at: datetime | None
    last_reported_at: datetime | None
    recent_verification_count: int  # verifications within the freshness window
    pending_conflicting_reports: int  # unresolved reports contradicting current state
    has_photos: bool
    stale_after_days: int
    now: datetime | None = None  # injectable for tests; defaults to "now" at call time


def compute_reliability_score(inputs: ReliabilityInputs) -> float:
    now = inputs.now or datetime.now(timezone.utc)

    # Base: the strongest backing source's own weight, not an average - one
    # solid official source shouldn't be dragged down by also having a
    # single low-weight scrape backing the same place.
    base = max(inputs.source_weights) if inputs.source_weights else 0.4

    score = base

    # Recent, positive human confirmation is the single strongest signal -
    # weighted more than the source itself, since a source can be stale
    # even when generally reliable.
    if inputs.last_verified_at is not None:
        age = _age_days(inputs.last_verified_at, now)
        if age <= inputs.stale_after_days:
            # Linear decay from a full +0.3 bonus at age=0 to +0.0 at the
            # staleness boundary - "doğrulandı 2 gün önce" and "doğrulandı
            # 85 gün önce" should not read as equally fresh.
            freshness_bonus = 0.3 * max(0.0, 1.0 - age / inputs.stale_after_days)
            score += freshness_bonus
        else:
            # Past the staleness window: the verification still counts for
            # something (better than nothing), but decays toward zero
            # rather than cliff-dropping the moment it crosses the boundary.
            overdue = age - inputs.stale_after_days
            score += max(0.0, 0.1 * (1.0 - overdue / (inputs.stale_after_days * 2)))

    # Multiple independent people agreeing is worth more than one - capped
    # so this can't alone push a place to a perfect score.
    score += min(0.15, 0.04 * inputs.recent_verification_count)

    # Unresolved reports that contradict the current state are the clearest
    # "don't fully trust this" signal - weighted heavily, capped so one
    # spam report can't zero out an otherwise well-verified place.
    score -= min(0.4, 0.15 * inputs.pending_conflicting_reports)

    if inputs.has_photos:
        score += 0.05

    # A report (of any kind, not just conflicting ones) with no
    # verification since is a mild "something might have changed, nobody's
    # confirmed since" signal.
    if (
        inputs.last_reported_at is not None
        and (inputs.last_verified_at is None or inputs.last_reported_at > inputs.last_verified_at)
        and _age_days(inputs.last_reported_at, now) <= inputs.stale_after_days
    ):
        score -= 0.1

    return round(min(1.0, max(0.0, score)), 4)


def _age_days(then: datetime, now: datetime) -> float:
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0.0, (now - then) / timedelta(days=1))


def freshness_label(last_verified_at: datetime | None, now: datetime | None = None) -> str:
    """The human-facing string the brief asks for explicitly: "Bugün
    doğrulandı", "3 gün önce güncellendi", "2 ay önce doğrulandı" - never
    just a bare score."""
    if last_verified_at is None:
        return "Henüz doğrulanmadı"
    now = now or datetime.now(timezone.utc)
    age = _age_days(last_verified_at, now)
    if age < 1:
        return "Bugün doğrulandı"
    if age < 2:
        return "Dün doğrulandı"
    if age < 30:
        return f"{int(age)} gün önce doğrulandı"
    if age < 365:
        months = int(age / 30)
        return f"{months} ay önce doğrulandı"
    years = int(age / 365)
    return f"{years} yıl önce doğrulandı"
