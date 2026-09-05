/**
 * In-memory, per-key sliding-window rate limiter.
 *
 * What this is NOT, said up front so nobody relies on it for more than it
 * can do:
 *   - Not shared across processes. It lives in one Node process's memory,
 *     so a horizontally-scaled or serverless deployment (several Vercel
 *     lambda instances, a PM2 cluster, etc.) enforces the limit separately
 *     per instance - the effective ceiling becomes `maxRequests *
 *     instanceCount`, not `maxRequests`. Fine for this project's
 *     single-instance deployment; a real multi-instance production setup
 *     needs a shared store (Redis, etc.) instead.
 *   - Not durable. A restart or redeploy clears every counter, so a client
 *     throttled right before a deploy gets a clean slate right after.
 *     Acceptable for throttling casual abuse; would not be for anything
 *     that needs to be tamper-proof.
 *
 * What it is: a genuine sliding window, not a fixed window that resets on
 * the clock and lets a burst straddle the boundary at up to 2x the intended
 * rate. Each key keeps its recent hit timestamps; a check prunes anything
 * older than `now - windowMs` and compares what's left to the limit.
 */

const SWEEP_EVERY_N_CALLS = 500;

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window frees a slot. 0 when `allowed` is true. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
  /** Like `check` but WITHOUT consuming a slot: answers "would a hit be
   * allowed right now?". Needed by the admin-auth brake, which must block
   * before comparing but only spend budget on failures - a legitimate
   * admin's successful requests must never count against it. */
  peek(key: string, now?: number): RateLimitResult;
}

/**
 * Builds an isolated limiter with its own key -> hits map. A factory rather
 * than one shared module-level map, mainly so tests can spin up a limiter
 * with a tiny window and a fake clock without touching the real one (or
 * bleeding state into other tests in the same process).
 */
export function createRateLimiter({ windowMs, maxRequests }: RateLimiterOptions): RateLimiter {
  const hitsByKey = new Map<string, number[]>();
  let callsSinceSweep = 0;

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      // Opportunistic cleanup: a key that goes silent forever (a one-off
      // visitor) would otherwise sit in the map forever, since pruning
      // normally only happens on that same key's next call. Not a full
      // solution, just enough that a long-running server doesn't
      // accumulate one array per IP that has ever made a request.
      callsSinceSweep += 1;
      if (callsSinceSweep >= SWEEP_EVERY_N_CALLS) {
        callsSinceSweep = 0;
        sweepStale(hitsByKey, now, windowMs);
      }

      const cutoff = now - windowMs;
      const recent = (hitsByKey.get(key) ?? []).filter((hit) => hit > cutoff);

      if (recent.length >= maxRequests) {
        hitsByKey.set(key, recent);
        const oldest = recent[0];
        const retryAfterMs = oldest + windowMs - now;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }

      recent.push(now);
      hitsByKey.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },

    peek(key: string, now: number = Date.now()): RateLimitResult {
      const cutoff = now - windowMs;
      const recent = (hitsByKey.get(key) ?? []).filter((hit) => hit > cutoff);
      if (recent.length >= maxRequests) {
        const oldest = recent[0];
        const retryAfterMs = oldest + windowMs - now;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function sweepStale(map: Map<string, number[]>, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  for (const [key, hits] of map) {
    if (!hits.some((hit) => hit > cutoff)) map.delete(key);
  }
}

// --- Wiring for POST /api/contributions ---------------------------------

// Generous on purpose: the requirement for this limiter is "a real user
// submitting 2-3 reports back to back must never notice it". 10 requests
// per 10 minutes gives roughly 3x that burst room while still capping a
// script at 60/hour/key - low enough to matter against a JSON file with no
// other size limit, high enough that no genuine contributor hits it.
const CONTRIBUTIONS_WINDOW_MS = 10 * 60 * 1000;
const CONTRIBUTIONS_MAX_REQUESTS = 10;

const contributionsLimiter = createRateLimiter({
  windowMs: CONTRIBUTIONS_WINDOW_MS,
  maxRequests: CONTRIBUTIONS_MAX_REQUESTS,
});

/** Rate limit gate for POST /api/contributions. `now` is only ever
 * overridden from tests. */
export function checkRateLimit(key: string, now?: number): RateLimitResult {
  return contributionsLimiter.check(key, now);
}

// The auth probe is an online oracle (204 vs 401) with a constant-time
// comparison behind it - which protects the single comparison, not the
// number of attempts. Unlimited tries against it is a token brute-force
// endpoint. Ten per minute is far above any human flow (the gate probes
// once per page load, once per token entry) and reduces an online
// exhaustive search from "bounded by network speed" to "bounded by
// centuries".
const AUTH_PROBE_WINDOW_MS = 60 * 1000;
const AUTH_PROBE_MAX_REQUESTS = 10;

const authProbeLimiter = createRateLimiter({
  windowMs: AUTH_PROBE_WINDOW_MS,
  maxRequests: AUTH_PROBE_MAX_REQUESTS,
});

/** Rate limit gate for GET /api/admin/auth. */
export function checkAuthProbeLimit(key: string, now?: number): RateLimitResult {
  return authProbeLimiter.check(key, now);
}

// The probe endpoint's brake alone was security theater: every OTHER
// admin-guarded route (queue read, place PATCH/DELETE, contribution PATCH)
// answered wrong tokens with an unthrottled 401, so a brute-force script
// simply switched targets - the adversarial review demonstrated exactly
// that. This limiter counts FAILED auth attempts per client key across all
// admin surfaces at once, inside checkAdminAuth itself, so a new admin
// route can never ship un-braked again. Successful requests spend nothing:
// a real admin working the queue at full speed never touches this.
const AUTH_FAILURE_WINDOW_MS = 60 * 1000;
const AUTH_FAILURE_MAX = 10;

const adminAuthFailureLimiter = createRateLimiter({
  windowMs: AUTH_FAILURE_WINDOW_MS,
  maxRequests: AUTH_FAILURE_MAX,
});

/** Is this client currently locked out for too many failed admin auths?
 * Non-consuming - call before the comparison. */
export function peekAdminAuthFailures(key: string, now?: number): RateLimitResult {
  return adminAuthFailureLimiter.peek(key, now);
}

/** Record one failed admin auth attempt (missing or wrong token). */
export function recordAdminAuthFailure(key: string, now?: number): void {
  adminAuthFailureLimiter.check(key, now);
}

/**
 * Best-effort caller identity from proxy headers - the standard `Request`
 * App Router handlers receive carries no lower-level connection info to
 * fall back on. Both headers are attacker-controlled on any deployment that
 * doesn't sit behind a proxy that overwrites them (Vercel does this; a bare
 * `next start` with nothing in front does not), so treat this as "raises
 * the cost of casual, unsophisticated abuse", not "reliable client
 * identity". Requests with neither header collapse into one shared
 * "unknown" bucket rather than skipping the limit entirely.
 */
export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}
