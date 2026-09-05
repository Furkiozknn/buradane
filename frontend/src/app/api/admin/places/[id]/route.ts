import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";

import { applyOverride, getPlaceById } from "@/lib/places-repository";
import { clearPlaceOverride, getPlaceOverrides, setPlaceOverride } from "@/lib/contributions-store";
import type { Place, PlaceStatus, PriceType } from "@/lib/types";

/**
 * Admin place editing, implemented as overrides rather than mutations.
 *
 * The OSM snapshot is immutable on purpose: it is re-importable, it carries
 * a licence and an upstream id, and an admin fixing a typo must not make the
 * next re-import silently undo their work or, worse, make our copy diverge
 * from the source with no record of why. So an edit is a layer, the source
 * stays pristine, and "revert" is a delete of that layer.
 *
 * There is deliberately no hard delete. A place that isn't there any more is
 * `permanently_closed` - which hides it from search while keeping the record
 * (and the reason) for anyone auditing the data later.
 *
 * Demo scope note: these routes are unauthenticated, the same documented
 * limitation the moderation route carries. In production the equivalent
 * endpoints sit behind the JWT dependency in backend/app/api/deps.py.
 */

const EDITABLE_STATUSES: PlaceStatus[] = [
  "active",
  "temporarily_closed",
  "permanently_closed",
  "pending_review",
];

const EDITABLE_PRICE_TYPES: PriceType[] = ["free", "paid", "unknown"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  // Fail-closed: no token configured means no admin mutations at all -
  // these routes were open "by design" once, and that is the bug this
  // guard exists to close. See src/lib/admin-auth.ts for the reasoning.
  const auth = checkAdminAuth(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await context.params;
  const placeId = decodeURIComponent(id);

  const base = getPlaceById(placeId);
  if (!base) {
    return NextResponse.json({ error: "Mekan bulunamadı" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi" }, { status: 400 });
  }

  const patch: Partial<Place> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2 || name.length > 300) {
      return NextResponse.json({ error: "Mekan adı 2-300 karakter olmalı" }, { status: 400 });
    }
    patch.name = name;
  }

  if (body.status !== undefined) {
    if (!EDITABLE_STATUSES.includes(body.status as PlaceStatus)) {
      return NextResponse.json(
        { error: `Bilinmeyen durum. Beklenen: ${EDITABLE_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    patch.status = body.status as PlaceStatus;
  }

  if (body.price_type !== undefined) {
    if (!EDITABLE_PRICE_TYPES.includes(body.price_type as PriceType)) {
      return NextResponse.json(
        { error: `Bilinmeyen ücret tipi. Beklenen: ${EDITABLE_PRICE_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
    patch.price_type = body.price_type as PriceType;
  }

  if (body.amenities !== undefined) {
    if (typeof body.amenities !== "object" || body.amenities === null || Array.isArray(body.amenities)) {
      return NextResponse.json({ error: "amenities bir nesne olmalı" }, { status: 400 });
    }
    const incoming = body.amenities as Record<string, unknown>;
    const amenities = { ...base.amenities };
    for (const [key, value] of Object.entries(incoming)) {
      if (!(key in base.amenities)) {
        return NextResponse.json({ error: `Bilinmeyen özellik: ${key}` }, { status: 400 });
      }
      // `null` is a first-class value here: "we don't know" must stay
      // expressible, or an admin can only ever assert yes/no.
      if (value !== true && value !== false && value !== null) {
        return NextResponse.json(
          { error: `${key} true, false ya da null olmalı` },
          { status: 400 },
        );
      }
      amenities[key as keyof typeof amenities] = value;
    }
    patch.amenities = amenities;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Değiştirilecek alan verilmedi" }, { status: 400 });
  }

  await setPlaceOverride(placeId, patch);
  const overrides = await getPlaceOverrides(placeId);
  return NextResponse.json(applyOverride(base, overrides));
}

/** Reverts every admin/community override on this place, restoring the raw
 * OSM record. This is the "undo" that makes editing safe to do. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const placeId = decodeURIComponent(id);

  const base = getPlaceById(placeId);
  if (!base) {
    return NextResponse.json({ error: "Mekan bulunamadı" }, { status: 404 });
  }

  await clearPlaceOverride(placeId);
  return NextResponse.json(base);
}
