import { NextResponse } from "next/server";

import { districtsOfProvince } from "@/lib/places-repository";

/**
 * GET /api/districts?province=<slug>
 *
 * The ilçe list for one province: name, how many places are in it, and
 * where to open the map. Served on demand rather than shipped with the page
 * because the country has 973 of them - about 100 KB that every visitor
 * would pay for on first paint to support a panel most of them never open.
 * One province is ten to forty rows.
 *
 * Reads only `meta.json`, which is already resident, so this costs nothing
 * even on a cold process - deliberately, because it is reachable without a
 * geographic scope and the places endpoint's own guard therefore does not
 * apply to it.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("province");
  if (!slug) {
    return NextResponse.json({ error: "province parametresi gerekli" }, { status: 400 });
  }

  const districts = districtsOfProvince(slug);
  if (districts === null) {
    return NextResponse.json({ error: "İl bulunamadı" }, { status: 404 });
  }

  return NextResponse.json(
    { districts },
    {
      headers: {
        // Derived from a committed snapshot: it changes when the data is
        // re-fetched and redeployed, never between requests.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
