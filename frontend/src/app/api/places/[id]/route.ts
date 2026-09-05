import { NextResponse } from "next/server";

import { applyOverride, getPlaceById } from "@/lib/places-repository";
import { getPlaceOverrides, listCommunityPlaces } from "@/lib/contributions-store";

/** GET /api/places/:id - mirrors the backend's `GET /places/{place_id}`.
 * OSM ids contain a slash (`node/123`), so the route receives them
 * URL-encoded and decodes here. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);

  // A shared link to a community-added place has to open, or approving a
  // suggestion produces a record nobody can reach.
  const communityPlaces = await listCommunityPlaces();
  const place = getPlaceById(decodedId, communityPlaces);
  if (!place) {
    return NextResponse.json({ error: "Mekan bulunamadı" }, { status: 404 });
  }

  // Admin edits and approved community reports live outside the immutable
  // OSM snapshot and are layered on read, so the source data stays pristine
  // and re-importable.
  const overrides = await getPlaceOverrides(decodedId);

  // Same merge the list query uses, so a place never reports one score in
  // the list and a different one on its own page.
  return NextResponse.json(applyOverride(place, overrides));
}
