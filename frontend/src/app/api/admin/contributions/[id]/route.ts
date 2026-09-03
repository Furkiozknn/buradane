import { NextResponse } from "next/server";

import { moderateContribution } from "@/lib/contributions-store";

/**
 * PATCH /api/admin/contributions/:id  { "action": "approve" | "reject" }
 *
 * Demo scope note: there is no auth on this route. That is a deliberate,
 * documented demo limitation (see README "Bilinen sınırlamalar"), not an
 * oversight - the production backend puts the equivalent endpoints behind
 * the JWT dependency in backend/app/api/deps.py. Nothing here is exposed
 * publicly, and the route is confined to a local snapshot.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
