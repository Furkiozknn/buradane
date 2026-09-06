import { NextResponse } from "next/server";

import { queryPlaces } from "@/lib/places-repository";
import { listCommunityPlaces, listOverrides } from "@/lib/contributions-store";
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

/** Roughly a large province across. Türkiye spans ~7° of latitude, so this
 * refuses a country-wide scan while leaving every realistic map viewport -
 * including a zoomed-out look at İstanbul or Konya - comfortably inside. */
const MAX_BBOX_DEGREES = 3;

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

    // A viewport spanning the whole country is not a search, it is a scan:
    // measured at 274 ms p50 / 445 ms p95 with 47.319 matches, all of it
    // synchronous, so every other request on the single event loop queues
    // behind it. Ten concurrent ones took 2,4 seconds of wall clock. Any
    // user can trigger it by zooming out and tapping a category chip. The
    // backend already refuses an oversized radius (radius_m <= 50_000); this
    // is the same refusal for the bbox path, and it is a 400 rather than a
    // truncated answer because silently searching a smaller area than the
    // one on screen is exactly the kind of quiet lie this project avoids.
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (Math.abs(maxLat - minLat) > MAX_BBOX_DEGREES || Math.abs(maxLon - minLon) > MAX_BBOX_DEGREES) {
      return NextResponse.json(
        {
          error:
            "Arama alanı çok geniş. Haritada biraz yakınlaşıp tekrar deneyin " +
            "(ya da bir şehir seçin).",
        },
        { status: 400 },
      );
    }
  }

  // Both ends clamped. The ceiling was always here; the FLOOR was not, and
  // without it `?limit=-1` reached `results.slice(offset, offset + limit)`
  // where slice(0, -1) means "everything but the last one" - one
  // unauthenticated GET returned the entire national dataset as a 42 MB
  // response in 716 ms of blocked event loop. A performance audit
  // demonstrated it against the production build. Same reasoning for
  // offset: a negative one silently returned an empty page.
  const limit = Math.max(1, Math.min(num("limit") ?? 60, 300));
  const offset = Math.max(0, num("offset") ?? 0);

  const overrides = await listOverrides();
  const communityPlaces = await listCommunityPlaces();

  const sortParam = params.get("sort");

  const result = queryPlaces({
    overrides,
    communityPlaces,
    sort: sortParam === "reliability" ? "reliability" : "distance",
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
    offset,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    // The dataset is a static snapshot; letting the browser reuse a
    // response for a minute keeps map panning from re-fetching identical
    // viewports.
    "Cache-Control": "public, max-age=60",
    // Two representations now differ by this header, so any cache between
    // us and the user has to key on it.
    Vary: "Accept-Encoding",
  };

  // Route-handler JSON goes out uncompressed - the same server gzips HTML,
  // but this response did not, measured at 184 KB for a typical viewport
  // where gzip gives 14,7 KB (92% saved). On the rural connection this
  // product exists for, 184 KB at 400 kbit/s is ~3,7 s, which blows past
  // the service worker's 2,5 s network-first timeout and serves a
  // stale-labelled cached answer on a connection that would have delivered
  // the fresh one. zlib is built into Node; no dependency is added.
  const body = JSON.stringify(result);
  const acceptsGzip = (request.headers.get("accept-encoding") ?? "").includes("gzip");
  if (acceptsGzip) {
    const { gzipSync } = await import("node:zlib");
    return new NextResponse(new Uint8Array(gzipSync(body)), {
      headers: { ...headers, "Content-Encoding": "gzip" },
    });
  }
  return new NextResponse(body, { headers });
}
