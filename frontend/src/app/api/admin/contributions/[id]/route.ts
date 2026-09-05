import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";

import { moderateContribution } from "@/lib/contributions-store";

/**
 * PATCH /api/admin/contributions/:id  { "action": "approve" | "reject" }
 *
 * Protected by the shared admin token (checkAdminAuth below). An earlier
 * comment here declared the missing auth "a deliberate, documented demo
 * limitation" - and outlived the fix, which is exactly how the DELETE
 * handler next door shipped guardless: a reader trusting this text had no
 * reason to add the two lines. Comments about security posture rot faster
 * than any others; when the posture changes, the words change with it.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  // Fail-closed: no token configured means no admin mutations at all -
  // these routes were open "by design" once, and that is the bug this
  // guard exists to close. See src/lib/admin-auth.ts for the reasoning.
  const auth = checkAdminAuth(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await context.params;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: "action 'approve' ya da 'reject' olmalı" }, { status: 400 });
  }

  const result = await moderateContribution(id, body.action);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Katkı bulunamadı" }, { status: 404 });
    }
    // 422, not 400: the request itself is well-formed, the stored suggestion
    // is the thing that cannot be turned into a place. Saying so beats
    // reporting success and creating nothing.
    return NextResponse.json(
      {
        error:
          "Bu öneri mekana dönüştürülemiyor: ad, kategori ve Türkiye sınırları içinde geçerli bir konum gerekli.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json(result.contribution);
}
