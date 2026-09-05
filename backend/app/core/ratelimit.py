"""Per-IP token-bucket rate limiting for the community write endpoints.

The audit's falsification demo was 21 unauthenticated requests from one
shell loop; nothing anywhere slowed it down. This is the smallest honest
counter-measure: each client IP gets a refilling budget
(``write_rate_limit_per_hour``/hour, bursts up to
``write_rate_limit_burst``), and exceeding it answers 429 with Retry-After.

State is in-process, deliberately: the backend runs as a single process
today, and pretending otherwise (Redis, distributed counters) would be
complexity the deployment doesn't have. If that changes, this moves to the
reverse proxy or a shared store - the dependency's call sites don't change.
"""

from __future__ import annotations

import threading
import time

from fastapi import HTTPException, Request

from app.core.config import settings


class TokenBucketLimiter:
    def __init__(self, *, per_hour: float, burst: int, clock=time.monotonic):
        self._rate_per_second = per_hour / 3600.0
        self._burst = float(burst)
        self._clock = clock
        self._buckets: dict[str, tuple[float, float]] = {}  # ip -> (tokens, last_seen)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        """Spend one token for ``key`` or raise 429 with a Retry-After."""
        now = self._clock()
        with self._lock:
            tokens, last = self._buckets.get(key, (self._burst, now))
            tokens = min(self._burst, tokens + (now - last) * self._rate_per_second)
            if tokens < 1.0:
                retry_after = max(1, int((1.0 - tokens) / self._rate_per_second))
                raise HTTPException(
                    429,
                    "too many contributions from this address; slow down",
                    headers={"Retry-After": str(retry_after)},
                )
            self._buckets[key] = (tokens - 1.0, now)
            self._maybe_prune(now)

    def _maybe_prune(self, now: float) -> None:
        # Full buckets carry no information; drop them so the dict cannot
        # grow one entry per address ever seen. Cheap enough to run inline
        # once the table is large.
        if len(self._buckets) < 10_000:
            return
        full = self._burst - 0.01
        self._buckets = {
            key: (tokens, last)
            for key, (tokens, last) in self._buckets.items()
            if min(self._burst, tokens + (now - last) * self._rate_per_second) < full
        }


_write_limiter = TokenBucketLimiter(
    per_hour=settings.write_rate_limit_per_hour, burst=settings.write_rate_limit_burst
)

# Verifications get their own, much tighter bucket, keyed by IP+place.
#
# Why the general limiter is not enough: consensus counts DISTINCT submitter
# identities, and the identity is the client-minted X-Device-Token - so one
# IP rotating random tokens in a shell loop supplies `verification_consensus`
# (2) identities well inside the general burst (10). Keying this bucket by
# IP+place and holding its burst UNDER the consensus threshold closes that.
#
# The WINDOW must match too, and the first version of this bucket got it
# wrong: it refilled `consensus-1` tokens per HOUR, while consensus counts
# distinct identities over `stale_after_days` (90 days) - so a patient
# attacker rotated one token per hour and still filled the threshold. The
# adversarial review demonstrated it with a clock simulation. The refill
# horizon is therefore derived from the SAME setting the consensus window
# reads: one address gets at most `consensus-1` same-place verifications
# per consensus window, so it can never supply the deciding "identity" -
# by construction this time, at any patience level.
#
# The honest cost, stated rather than hidden: two real households behind
# one CGNAT address (common on Turkish mobile carriers) verifying the SAME
# place within the window - the second one is turned away, and consensus
# for that place must come from a different network. That is the price of
# an identity signal the client cannot mint; counting distinct addresses
# inside consensus itself (a schema change) is the eventual better answer
# and is noted in ROADMAP.
_consensus_budget = max(1, settings.verification_consensus - 1)
_consensus_window_hours = max(1, settings.stale_after_days) * 24
_verification_limiter = TokenBucketLimiter(
    per_hour=_consensus_budget / _consensus_window_hours,
    burst=_consensus_budget,
)


def limit_writes(request: Request) -> None:
    """FastAPI dependency: one token per community write, keyed by client IP.

    Trusts the direct peer address - correct for the current deployment
    shape (uvicorn facing the client, or a proxy configured with
    --proxy-headers so request.client is already the real peer).
    """
    client = request.client
    _write_limiter.check(client.host if client else "unknown")


def limit_verifications(request: Request) -> None:
    """Per-IP-per-place ceiling for verification writes, below the consensus
    threshold - see _verification_limiter's comment for why the general
    write limiter cannot protect consensus on its own."""
    client = request.client
    place_id = request.path_params.get("place_id", "")
    _verification_limiter.check(f"{client.host if client else 'unknown'}:{place_id}")
