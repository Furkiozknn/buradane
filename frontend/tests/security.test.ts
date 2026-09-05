import { afterEach, describe, expect, it } from "vitest";

import { checkAdminAuth, constantTimeEqual } from "@/lib/admin-auth";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * The admin routes were once unauthenticated "by design", and the
 * contributions endpoint had no ceiling at all. These lock the two promises
 * the security layer now makes: no token configured means no admin
 * mutations (fail closed, never fail open), and a script cannot grow the
 * contributions file without hitting a wall a real person never sees.
 */

const TOKEN_VAR = "BURADANE_ADMIN_TOKEN";

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/admin/auth", { headers });
}

afterEach(() => {
  delete process.env[TOKEN_VAR];
});

describe("checkAdminAuth", () => {
  it("fails CLOSED when no token is configured", () => {
    // The tempting fallback - "no env var, so let everything through for dev
    // convenience" - is exactly the hole this module exists to close.
    delete process.env[TOKEN_VAR];
    const result = checkAdminAuth(requestWith({ "x-admin-token": "anything" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
  });

  it("rejects a request with no token", () => {
    process.env[TOKEN_VAR] = "s3cret";
    const result = checkAdminAuth(requestWith());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_token");
  });

  it("rejects a wrong token", () => {
    process.env[TOKEN_VAR] = "s3cret";
    const result = checkAdminAuth(requestWith({ "x-admin-token": "guess" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_token");
  });

  it("accepts the token via x-admin-token", () => {
    process.env[TOKEN_VAR] = "s3cret";
    expect(checkAdminAuth(requestWith({ "x-admin-token": "s3cret" })).ok).toBe(true);
  });

  it("accepts the token via Authorization: Bearer", () => {
    // curl -H "Authorization: Bearer ..." has to work out of the box.
    process.env[TOKEN_VAR] = "s3cret";
    expect(checkAdminAuth(requestWith({ authorization: "Bearer s3cret" })).ok).toBe(true);
  });

  it("does not treat an empty bearer value as a token", () => {
    process.env[TOKEN_VAR] = "s3cret";
    const result = checkAdminAuth(requestWith({ authorization: "Bearer " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_token");
  });
});

describe("constantTimeEqual", () => {
  it("agrees with === on the answer, without the short-circuit", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("handles multi-byte input without throwing", () => {
    // timingSafeEqual compares buffers and throws on length mismatch;
    // Turkish text is multi-byte in UTF-8, so byte length !== char length.
    expect(constantTimeEqual("şifre-gizli", "şifre-gizli")).toBe(true);
    expect(constantTimeEqual("şifre", "sifre")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("lets a real person's burst through and stops a script", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 3 });
    const t0 = 1_000_000;
    expect(limiter.check("ip1", t0).allowed).toBe(true);
    expect(limiter.check("ip1", t0 + 100).allowed).toBe(true);
    expect(limiter.check("ip1", t0 + 200).allowed).toBe(true);
    const blocked = limiter.check("ip1", t0 + 300);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("is a sliding window, not a clock-aligned one", () => {
    // A fixed window resets on the boundary and lets a straddling burst
    // through at double the intended rate; sliding does not.
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 2 });
    const t0 = 1_000_000;
    limiter.check("ip1", t0);
    limiter.check("ip1", t0 + 9_000);
    expect(limiter.check("ip1", t0 + 9_500).allowed).toBe(false);
    // The first hit ages out at t0+10_000; one slot frees up.
    expect(limiter.check("ip1", t0 + 10_001).allowed).toBe(true);
  });

  it("keeps keys independent", () => {
    // One abusive client must not consume anyone else's budget.
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 1 });
    const t0 = 1_000_000;
    expect(limiter.check("ip1", t0).allowed).toBe(true);
    expect(limiter.check("ip1", t0 + 1).allowed).toBe(false);
    expect(limiter.check("ip2", t0 + 2).allowed).toBe(true);
  });

  it("reports an honest Retry-After", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 1 });
    const t0 = 1_000_000;
    limiter.check("ip1", t0);
    const blocked = limiter.check("ip1", t0 + 4_000);
    // The oldest hit frees its slot 10s after it landed - 6s from "now".
    expect(blocked.retryAfterSeconds).toBe(6);
  });
});
