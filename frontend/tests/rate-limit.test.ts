import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bucketFor, createRateLimiter, getClientKey } from "@/lib/rate-limit";

/**
 * `security.test.ts` already covers the sliding-window math via
 * `createRateLimiter().check`. This file covers what that one didn't:
 * `peek` (must never spend budget) and `getClientKey` (the attacker-facing
 * header parsing that decides what "one client" even means).
 */

describe("getClientKey behind a declared proxy", () => {
  // The headers are only read when the operator has said a proxy overwrites
  // them; see the untrusted block below for why that is not the default.
  beforeEach(() => {
    process.env.BURADANE_TRUST_PROXY = "1";
  });
  afterEach(() => {
    delete process.env.BURADANE_TRUST_PROXY;
  });

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

describe("bucketFor: one budget per IPv6 /64", () => {
  // One IPv6 subscriber holds a whole /64 and can rotate through it freely;
  // keyed on the full address, every admin guess got a fresh budget.
  it("puts two addresses from the same /64 in one bucket", () => {
    expect(bucketFor("2001:db8:1:2::1")).toBe(bucketFor("2001:db8:1:2:ffff:ffff:ffff:fffe"));
    expect(bucketFor("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
  });

  it("keeps neighbouring /64s apart", () => {
    expect(bucketFor("2001:db8:1:2::1")).not.toBe(bucketFor("2001:db8:1:3::1"));
  });

  it("normalises spelling: case, leading zeros, brackets, zone id", () => {
    const key = "2001:db8:1:2::/64";
    expect(bucketFor("2001:0DB8:0001:0002:0:0:0:1")).toBe(key);
    expect(bucketFor("[2001:db8:1:2::1]")).toBe(key);
    expect(bucketFor("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 as the IPv4 address it carries", () => {
    expect(bucketFor("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(bucketFor("::ffff:cb00:7105")).toBe("203.0.113.5");
  });

  it("leaves IPv4 and unparseable values unchanged", () => {
    expect(bucketFor("203.0.113.5")).toBe("203.0.113.5");
    expect(bucketFor("not-an-ip")).toBe("not-an-ip");
    expect(bucketFor("1:2:3")).toBe("1:2:3");
    expect(bucketFor("1::2::3")).toBe("1::2::3");
  });

  it("is what getClientKey returns behind a proxy", () => {
    process.env.BURADANE_TRUST_PROXY = "1";
    try {
      const request = new Request("http://localhost/api/admin/auth", {
        headers: { "x-forwarded-for": "2001:db8:1:2:aaaa::7, 10.0.0.1" },
      });
      expect(getClientKey(request)).toBe("2001:db8:1:2::/64");
    } finally {
      delete process.env.BURADANE_TRUST_PROXY;
    }
  });
});

/**
 * The default, and the reason it is the default.
 *
 * `x-forwarded-for` is a plain request header. On a deployment with nothing
 * in front of it, the caller writes whatever they like there - and the admin
 * brute-force lockout keys on exactly that value, so a script that rotates
 * the header gets a fresh 10-attempt budget per guess and the lockout never
 * fires. Believing the header by default turned the strongest brake in the
 * app into the easiest one to walk around. A key nobody can rotate is coarse
 * (everyone shares one bucket) but it cannot be defeated, which is the right
 * trade for a lockout.
 */
describe("getClientKey with no proxy declared", () => {
  beforeEach(() => {
    delete process.env.BURADANE_TRUST_PROXY;
  });

  it("ignores x-forwarded-for entirely", () => {
    const request = new Request("http://localhost/api/admin/auth", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    expect(getClientKey(request)).toBe("unknown");
  });

  it("ignores x-real-ip entirely", () => {
    const request = new Request("http://localhost/api/admin/auth", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(getClientKey(request)).toBe("unknown");
  });

  it("gives a header-rotating attacker ONE bucket, not a fresh one per guess", () => {
    // The lockout bypass, stated as an assertion: twenty different forged
    // addresses must all land on the same key.
    const keys = new Set(
      Array.from({ length: 20 }, (_, i) =>
        getClientKey(
          new Request("http://localhost/api/admin/auth", {
            headers: { "x-forwarded-for": `203.0.113.${i}` },
          }),
        ),
      ),
    );
    expect(keys.size).toBe(1);
  });

  it("treats an unset, empty or off flag as 'no proxy'", () => {
    const request = () =>
      new Request("http://localhost/api/admin/auth", {
        headers: { "x-forwarded-for": "203.0.113.5" },
      });
    for (const value of ["", " ", "0", "off", "false", "hayir"]) {
      process.env.BURADANE_TRUST_PROXY = value;
      expect(getClientKey(request())).toBe("unknown");
    }
    delete process.env.BURADANE_TRUST_PROXY;
    expect(getClientKey(request())).toBe("unknown");
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
