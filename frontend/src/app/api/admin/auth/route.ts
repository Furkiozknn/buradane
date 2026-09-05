import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";

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
  const auth = checkAdminAuth(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);
  return new NextResponse(null, { status: 204 });
}
