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

      const recent = recentHits(hitsByKey, key, now, windowMs);
      const result = evaluate(recent, now, windowMs, maxRequests);
      if (result.allowed) recent.push(now);
      hitsByKey.set(key, recent);
      return result;
    },

    peek(key: string, now: number = Date.now()): RateLimitResult {
      const recent = recentHits(hitsByKey, key, now, windowMs);
      return evaluate(recent, now, windowMs, maxRequests);
    },
  };
}

function recentHits(map: Map<string, number[]>, key: string, now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return (map.get(key) ?? []).filter((hit) => hit > cutoff);
}

/** Shared allow/deny verdict for both `check` and `peek`, so the two can never drift apart. */
function evaluate(recent: number[], now: number, windowMs: number, maxRequests: number): RateLimitResult {
  if (recent.length >= maxRequests) {
    const oldest = recent[0];
    const retryAfterMs = oldest + windowMs - now;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
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
 * Does this deployment sit behind a proxy that OVERWRITES the forwarding
 * headers?
 *
 * Only the operator knows, so only the operator may say. `x-forwarded-for`
 * and `x-real-ip` are plain request headers: on a bare `next start` the
 * caller writes whatever they like into them, and the limiter then keys on
 * a value the attacker chose. That is not merely a weak limit, it is an
 * inverted one - the admin brute-force lockout in admin-auth.ts counts
 * FAILED token attempts per client key, so a script that sends a new
 * `x-forwarded-for` with every guess gets a fresh 10-attempt budget each
 * time and the lockout never fires. Trusting the header by default made
 * the strongest brake in the app the easiest one to walk around.
 *
 * Off unless explicitly turned on, because the safe state has to be the one
 * you get by doing nothing - the same reasoning contributions-enabled.ts
 * uses for durable storage.
 */
function trustsProxyHeaders(): boolean {
  const flag = process.env.BURADANE_TRUST_PROXY?.trim().toLowerCase();
  return flag === "1" || flag === "on" || flag === "true";
}

/**
 * Best-effort caller identity - the standard `Request` App Router handlers
 * receive carries no lower-level connection info to fall back on.
 *
 * With `BURADANE_TRUST_PROXY` set, the first entry of `x-forwarded-for`
 * (then `x-real-ip`) is the client, which is correct behind a proxy that
 * SETS rather than appends those headers. Without it, every caller shares
 * one bucket: coarse, and deliberately so - a key nobody can rotate limits
 * an attacker to one budget instead of unlimited budgets. Requests with no
 * usable header land in that same shared bucket rather than skipping the
 * limit entirely.
 *
 * The cost of the shared bucket is real and documented (docs/dagitim.md §4):
 * without a proxy, contribution submission is capped site-wide. That is a
 * visible, honest limit; a silently defeatable admin lockout is not.
 */
export function getClientKey(request: Request): string {
  if (trustsProxyHeaders()) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return bucketFor(first);
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return bucketFor(realIp);
  }
  return "unknown";
}

/**
 * The budget unit for one address: an IPv4 address as is, an IPv6 address
 * by its /64.
 *
 * A single IPv6 subscriber is routinely handed a whole /64 - 2^64 addresses
 * - and privacy extensions rotate through it on their own. Keyed on the full
 * address, one machine could spend a fresh 10-attempt admin budget on every
 * guess without trying. The /64 is the smallest block a real client cannot
 * step outside of. IPv4-mapped IPv6 (`::ffff:203.0.113.5`) is the IPv4
 * address it carries, so the two spellings share one budget. Anything that
 * does not parse is returned unchanged: still a key, never a bypass.
 */
export function bucketFor(address: string): string {
  const groups = parseIpv6(address);
  if (!groups) return address;
  const isMappedV4 = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return groups.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}

/** Eight 16-bit groups, or null when `address` is not IPv6. */
function parseIpv6(address: string): number[] | null {
  let text = address.trim();
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end < 0) return null;
    text = text.slice(1, end);
  }
  text = text.split("%")[0]; // zone id: fe80::1%eth0
  if (!text.includes(":")) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const octets = last.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    text = text.slice(0, lastColon + 1) + "0";
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  const width = 8 - (tail.length ? 1 : 0);
  const missing = width - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest]
    .map((g) => parseInt(g, 16));
  if (tail.length) groups.splice(groups.length - 1, 1, ...tail);
  return groups.length === 8 ? groups : null;
}
