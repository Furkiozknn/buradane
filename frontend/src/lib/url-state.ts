/**
 * The app's state, expressed in the URL.
 *
 * Why this matters beyond convenience: a civic tool people want to *send to
 * someone* ("bak, burada ücretsiz tuvalet var") is only useful if the link
 * carries what you were looking at. It also makes the back button behave
 * the way people expect, and makes a bug report reproducible - the reporter
 * can paste the exact state.
 *
 * Kept deliberately short and human-readable rather than an encoded blob:
 * ?k=tuvalet&f=wheelchair_accessible,free&y=41.0082&x=28.9784&z=14&p=node/123
 */

import type { AmenityKey, CategorySlug } from "./types";

export interface UrlState {
  category: CategorySlug | null;
  amenities: AmenityKey[];
  freeOnly: boolean;
  openNow: boolean;
  query: string;
  placeId: string | null;
  center: { lat: number; lon: number } | null;
  zoom: number | null;
}

export const EMPTY_URL_STATE: UrlState = {
  category: null,
  amenities: [],
  freeOnly: false,
  openNow: false,
  query: "",
  placeId: null,
  center: null,
  zoom: null,
};

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);

  const num = (key: string) => {
    const raw = params.get(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const lat = num("y");
  const lon = num("x");

  // Flags live in one comma-separated param so the URL stays short; the
  // two non-amenity toggles share it under reserved names.
  const flags = (params.get("f") ?? "").split(",").filter(Boolean);

  return {
    category: (params.get("k") as CategorySlug) || null,
    amenities: flags.filter((f) => f !== "free" && f !== "open") as AmenityKey[],
    freeOnly: flags.includes("free"),
    openNow: flags.includes("open"),
    query: params.get("q") ?? "",
    placeId: params.get("p"),
    center: lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
    zoom: num("z"),
  };
}

export function buildUrlSearch(state: UrlState): string {
  const params = new URLSearchParams();

  if (state.category) params.set("k", state.category);

  const flags: string[] = [...state.amenities];
  if (state.freeOnly) flags.push("free");
  if (state.openNow) flags.push("open");
  if (flags.length > 0) params.set("f", flags.join(","));

  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.placeId) params.set("p", state.placeId);

  if (state.center) {
    // 5 decimals is ~1m - more precision would just make the link noisy.
    params.set("y", state.center.lat.toFixed(5));
    params.set("x", state.center.lon.toFixed(5));
  }
  if (state.zoom !== null) params.set("z", state.zoom.toFixed(1));

  const search = params.toString();
  return search ? `?${search}` : "";
}
