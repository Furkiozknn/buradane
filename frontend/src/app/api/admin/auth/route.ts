import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";
import { checkAuthProbeLimit, getClientKey } from "@/lib/rate-limit";

/**
 * GET /api/admin/auth - token verification probe.
 *
 * Exists for feedback quality, not as the security boundary: every mutation
 * route re-checks on its own. This lets the admin page tell a person their
 * token is wrong (or that the server has none configured) at entry time,
 * instead of letting the first save fail mysteriously.
 *
 * 204 rather than 200-with-body: the only information this endpoint should
 * ever emit on success is "yes".
 */
export async function GET(request: Request) {
  // Brute-force brake BEFORE the comparison: the 429 must not reveal
  // whether the guessed token was right.
  const limit = checkAuthProbeLimit(getClientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Çok fazla deneme. ${limit.retryAfterSeconds} saniye sonra tekrar deneyin.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const auth = checkAdminAuth(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);
  return new NextResponse(null, { status: 204 });
}
