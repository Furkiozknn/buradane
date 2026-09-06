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

import ipaddress
import threading
import time
import uuid

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
        pruned = {
            key: (tokens, last)
            for key, (tokens, last) in self._buckets.items()
            if min(self._burst, tokens + (now - last) * self._rate_per_second) < full
        }
        # A slow bucket refills so gradually that NOTHING is ever prunable -
        # the verification limiter refills one token per 90 days, so above
        # 10k keys every check rebuilt the whole dict, inside the lock, and
        # removed nothing. When the sweep cannot free at least a tenth of
        # the table, drop the oldest half by last-seen instead: losing an
        # old bucket only grants a fresh budget to the address that has been
        # silent longest, which is the one least likely to be mid-attack.
        if len(pruned) > len(self._buckets) * 0.9:
            keep = sorted(self._buckets.items(), key=lambda kv: kv[1][1], reverse=True)
            pruned = dict(keep[: len(keep) // 2])
        self._buckets = pruned


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


def client_key(request: Request) -> str:
    """The address a budget is charged to, normalised.

    IPv6 is why this is not just ``client.host``: a residential or mobile
    IPv6 line is handed a /64, which is 2^64 source addresses that cost the
    holder nothing to cycle through. Keyed on the full /128, every packet
    would look like a new visitor and every per-address limit in this file
    would be decorative. Bucketing on the /64 prefix charges the subscriber,
    which is the unit an ISP actually assigns. IPv4 keeps its full address -
    there is no equivalent free space behind a single line.
    """
    client = request.client
    host = client.host if client else "unknown"
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return host
    if address.version == 6:
        return str(ipaddress.ip_network(f"{address}/64", strict=False).network_address)
    return str(address)


# Reports get the same per-address-per-place ceiling as verifications, for
# the same reason and with a different number. Reports were the cheaper
# side of the asymmetry: the general limiter allowed 10 in a burst, and
# three pending reports on one place max out the -0,4 reliability penalty,
# which drops a well-documented place below any min_reliability filter and
# leaves three rows for a human to clear. One report per address per place
# per day is generous for the honest case (you report a broken fountain
# once) and useless for the flooding one.
_report_limiter = TokenBucketLimiter(per_hour=1 / 24, burst=1)


def limit_writes(request: Request) -> None:
    """FastAPI dependency: one token per community write, keyed by client IP.

    Trusts the direct peer address - correct for the current deployment
    shape (uvicorn facing the client, or a proxy configured with
    --proxy-headers so request.client is already the real peer).
    """
    _write_limiter.check(client_key(request))


def _place_key(request: Request) -> str:
    """`address:place`, with the place id canonicalised - see
    limit_verifications for why the raw path text is not safe to key on."""
    raw = str(request.path_params.get("place_id", ""))
    try:
        place_key = str(uuid.UUID(raw))
    except ValueError:
        place_key = raw
    return f"{client_key(request)}:{place_key}"


def limit_reports(request: Request) -> None:
    """Per-IP-per-place ceiling for reports - see _report_limiter."""
    _report_limiter.check(_place_key(request))


def limit_verifications(request: Request) -> None:
    """Per-IP-per-place ceiling for verification writes, below the consensus
    threshold - see _verification_limiter's comment for why the general
    write limiter cannot protect consensus on its own.

    The place id is CANONICALISED before it becomes part of the key, and
    that is the whole difference between a limit and a decoration. The path
    parameter arrives as raw text; the endpoint then parses it to a
    uuid.UUID, so "DEDF9137-...", "dedf9137-...", "dedf913723874061...",
    "{dedf9137-...}" and "urn:uuid:dedf9137-..." all address ONE place while
    presenting five different strings. Keyed on the raw text, one address
    minted a fresh budget per spelling - hex-case alone gives 2^32 of them -
    and reached consensus on any place with two requests. Parsing here makes
    the key the identity the endpoint acts on. A value that is not a UUID
    cannot reach a real place, so it keeps its raw form and is still charged
    rather than skipped.
    """
    _verification_limiter.check(_place_key(request))
