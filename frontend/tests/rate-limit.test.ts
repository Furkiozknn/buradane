import { describe, expect, it } from "vitest";

import { createRateLimiter, getClientKey } from "@/lib/rate-limit";

/**
 * `security.test.ts` already covers the sliding-window math via
 * `createRateLimiter().check`. This file covers what that one didn't:
 * `peek` (must never spend budget) and `getClientKey` (the attacker-facing
 * header parsing that decides what "one client" even means).
 */

describe("getClientKey", () => {
  it("takes the first address from a comma-separated x-forwarded-for", () => {
    const request = new Request("http://localhost/api/admin/auth", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" },
    });
    expect(getClientKey(request)).toBe("203.0.113.5");
  });

  it("trims whitespace around the first x-forwarded-for address", () => {
    const request = new Request("http://localhost/api/admin/auth", {
      headers: { "x-forwarded-for": "  203.0.113.5  ,10.0.0.1" },
    });
    expect(getClientKey(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("http://localhost/api/admin/auth", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(getClientKey(request)).toBe("198.51.100.7");
  });

  it("collapses to a shared 'unknown' bucket when neither header is present", () => {
    const request = new Request("http://localhost/api/admin/auth");
    expect(getClientKey(request)).toBe("unknown");
  });

  it("falls back to x-real-ip when x-forwarded-for is present but empty", () => {
    const request = new Request("http://localhost/api/admin/auth", {
      headers: { "x-forwarded-for": "", "x-real-ip": "198.51.100.7" },
    });
    expect(getClientKey(request)).toBe("198.51.100.7");
  });
});

describe("rate limiter peek", () => {
  it("reports the same verdict as check without consuming a slot", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 1 });
    const t0 = 1_000_000;
    // Repeated peeks before any real hit must all read as "allowed" - a
    // peek that (bugfully) wrote to the map would make the very first real
    // check see a slot that peek already claimed.
    expect(limiter.peek("ip1", t0).allowed).toBe(true);
    expect(limiter.peek("ip1", t0 + 1).allowed).toBe(true);
    expect(limiter.check("ip1", t0 + 2).allowed).toBe(true);
  });

  it("does not free the caller's real budget once the limit is hit", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 1 });
    const t0 = 1_000_000;
    limiter.check("ip1", t0);
    // Many peeks in a row must keep reporting "blocked" - none of them may
    // prune or otherwise mutate the stored hits.
    expect(limiter.peek("ip1", t0 + 1).allowed).toBe(false);
    expect(limiter.peek("ip1", t0 + 2).allowed).toBe(false);
    expect(limiter.check("ip1", t0 + 3).allowed).toBe(false);
  });

  it("agrees with check's Retry-After for the same key and moment", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, maxRequests: 1 });
    const t0 = 1_000_000;
    limiter.check("ip1", t0);
    const peeked = limiter.peek("ip1", t0 + 4_000);
    const blocked = limiter.check("ip1", t0 + 4_000);
    expect(peeked.retryAfterSeconds).toBe(blocked.retryAfterSeconds);
  });
});
