import { NextResponse } from "next/server";

import { queryPlaces } from "@/lib/places-repository";
import type { AmenityKey, CategorySlug } from "@/lib/types";

/**
 * GET /api/places
 *
 * Deliberately the same query contract as the FastAPI backend's
 * `GET /places` (backend/app/api/places.py): lat/lon/radius_m for
 * "yakınımda", bbox for the map viewport, repeated `category` / `amenity`
 * params, free_only, open_now, q, limit, offset. Swapping this demo adapter
 * for the real service is a base-URL change.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const num = (key: string) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const lat = num("lat");
  const lon = num("lon");
  if ((lat === undefined) !== (lon === undefined)) {
    return NextResponse.json({ error: "lat ve lon birlikte verilmeli" }, { status: 400 });
  }

  let bbox: [number, number, number, number] | undefined;
  const bboxRaw = params.get("bbox");
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      return NextResponse.json({ error: "bbox 'min_lon,min_lat,max_lon,max_lat' olmalı" }, { status: 400 });
    }
    bbox = parts as [number, number, number, number];
  }

  const limit = Math.min(num("limit") ?? 60, 300);

  const result = queryPlaces({
    lat,
    lon,
    radius_m: num("radius_m"),
    bbox,
    categories: params.getAll("category") as CategorySlug[],
    amenities: params.getAll("amenity") as AmenityKey[],
    freeOnly: params.get("free_only") === "true",
    openNow: params.get("open_now") === "true",
    q: params.get("q") ?? undefined,
    limit,
    offset: num("offset") ?? 0,
  });

  return NextResponse.json(result, {
    headers: {
      // The dataset is a static snapshot; letting the browser reuse a
      // response for a minute keeps map panning from re-fetching identical
      // viewports.
      "Cache-Control": "public, max-age=60",
    },
  });
}
