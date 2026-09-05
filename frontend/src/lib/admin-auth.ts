import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/**
 * Shared-secret gate for the admin mutation routes (place overrides,
 * contribution moderation). There is no user/session system in this
 * project - "admin" just means "knows the one token" - so this is
 * deliberately a single environment secret rather than a login system with
 * accounts, hashing and rotation. That is proportionate to what these
 * routes actually protect (a local JSON snapshot, editable by whoever is
 * trusted with the server's environment), not a stand-in for a real
 * multi-user auth system.
 *
 * Server-side only. This module reaches into `node:crypto` and must never
 * be imported from a "use client" component - the client-side half of the
 * token flow (prompting for it, storing it in sessionStorage, attaching it
 * to requests) lives in AdminPlaceEditor.tsx instead, precisely so this
 * file is only ever reachable from the two admin route handlers.
 */

const BEARER_PREFIX = "Bearer ";

/** Accepts either header the brief allows: `Authorization: Bearer <token>`
 * (works out of the box with curl -H / Postman's auth tab) or
 * `x-admin-token` (what the admin page's own fetch calls send, since it
 * needs no prefix concatenation on the client). */
function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(BEARER_PREFIX.length).trim();
    if (token) return token;
  }
  const headerToken = request.headers.get("x-admin-token")?.trim();
  return headerToken || null;
}

/**
 * Constant-time string comparison. A plain `===` short-circuits on the
 * first mismatched character, so response latency correlates with how many
 * leading characters a guess got right - a timing side-channel that turns
 * "guess one long token" into many much smaller guesses. `timingSafeEqual`
 * walks the whole buffer regardless of where it diverges.
 *
 * `timingSafeEqual` throws on a length mismatch instead of comparing, so
 * unequal lengths are rejected before we ever call it. That early return is
 * still safe for what we're defending: it leaks only "wrong length", never
 * *where* a same-length guess diverges, which is the actual property being
 * protected here.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type AdminAuthFailureReason = "not_configured" | "missing_token" | "invalid_token";

export type AdminAuthResult = { ok: true } | { ok: false; reason: AdminAuthFailureReason };

/**
 * What happens when `BURADANE_ADMIN_TOKEN` isn't set in the environment:
 * every admin request is rejected, loudly. The tempting alternative - fall
 * back to "open" so a developer who forgot to set the env var doesn't get
 * blocked - is exactly the bug this file exists to close (the routes were
 * unauthenticated "by design" before this change). Failing closed and
 * saying why in the response body is the honest version of "dev
 * convenience": a developer who hits this immediately sees a clear 401
 * pointing at `.env.example`, instead of either a silently-open admin panel
 * or an opaque, unexplained error.
 */
export function checkAdminAuth(request: Request): AdminAuthResult {
  const expected = process.env.BURADANE_ADMIN_TOKEN;
  if (!expected) return { ok: false, reason: "not_configured" };

  const provided = extractToken(request);
  if (!provided) return { ok: false, reason: "missing_token" };

  return constantTimeEqual(provided, expected) ? { ok: true } : { ok: false, reason: "invalid_token" };
}

const REASON_MESSAGES: Record<AdminAuthFailureReason, string> = {
  not_configured:
    "Yönetici işlemleri şu anda kapalı: sunucuda BURADANE_ADMIN_TOKEN ortam değişkeni tanımlı değil.",
  missing_token:
    "Bu işlem için yönetici yetkisi gerekli. 'Authorization: Bearer <token>' ya da 'x-admin-token' başlığı gönderin.",
  invalid_token: "Geçersiz admin token.",
};

/** Turns a failed `checkAdminAuth` result into the 401 a route handler
 * returns as-is. Kept separate from `checkAdminAuth` so the auth decision
 * itself stays a plain Request -> result function, easy to unit test
 * without constructing a NextResponse. */
export function adminAuthErrorResponse(result: { ok: false; reason: AdminAuthFailureReason }): NextResponse {
  return NextResponse.json({ error: REASON_MESSAGES[result.reason] }, { status: 401 });
}
