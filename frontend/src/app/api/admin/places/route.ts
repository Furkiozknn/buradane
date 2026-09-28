import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";
import { listCommunityPlaces, listOverrides } from "@/lib/contributions-store";
import { searchProvinceForAdmin } from "@/lib/places-repository";

/**
 * GET /api/admin/places?province=<slug>&q=<text>[&limit=n]
 *
 * The admin place editor's search. It exists because the editor's old path -
 * the public `GET /api/places?q=` with no location - has been a 400 since
 * the public route started requiring a scope, and the editor treated that
 * 400 as "no results". The public route's scope rule stays exactly as it
 * is; this route does not relax it for anyone, it is a different door:
 *
 * - admin token first (checkAdminAuth, fail-closed), like every other
 *   /api/admin handler - an anonymous caller learns nothing, not even
 *   whether a province slug is valid;
 * - the scope is a province, required, and exactly one snapshot file is
 *   read - never the country;
 * - closed and in-review places are included, so an admin can find and
 *   revert a place they closed (the public search hides those).
 */

const MAX_QUERY_CHARS = 120;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const params = new URL(request.url).searchParams;
  const province = params.get("province")?.trim() ?? "";
  if (!province) {
    return NextResponse.json({ error: "Arama için il seçin (province)." }, { status: 400 });
  }

  const q = params.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ error: "Arama metni en az 2 karakter olmalı." }, { status: 400 });
  }
  if (q.length > MAX_QUERY_CHARS) {
    return NextResponse.json(
      { error: `Arama metni en fazla ${MAX_QUERY_CHARS} karakter olabilir.` },
      { status: 400 },
    );
  }

  const rawLimit = Number(params.get("limit") ?? 12);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.trunc(rawLimit), MAX_LIMIT)) : 12;

  const places = searchProvinceForAdmin({
    province,
    q,
    limit,
    overrides: await listOverrides(),
    communityPlaces: await listCommunityPlaces(),
  });
  if (places === null) {
    return NextResponse.json({ error: `Bilinmeyen il: ${province}` }, { status: 400 });
  }

  // Never cached: the answer depends on overrides an admin may have written
  // a second ago, and it is behind a token.
  return NextResponse.json({ places }, { headers: { "Cache-Control": "no-store" } });
}
