/** Geospatial helpers. Mirrors what PostGIS does server-side in production
 * (ST_DWithin / ST_Distance / ST_MakeEnvelope) so the demo's results are the
 * same shape and ordering the real backend would return. */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters. Matches backend/app/services/dedup.py's
 * `_haversine_m` formula so distances agree across the two implementations. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;

  const h =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Cheap bounding box around a point, used to reject most candidates before
 * doing the (more expensive) haversine call. At Istanbul's latitude this
 * over-selects by a few percent, which is fine - it's a pre-filter, not the
 * answer. */
export function boundingBox(center: LatLon, radiusM: number) {
  const latDelta = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lonDelta = latDelta / Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLon: center.lon - lonDelta,
    maxLon: center.lon + lonDelta,
  };
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** Rough walking time, at a deliberately conservative 4.5 km/h - the number
 * users actually plan around, not a straight-line optimum. */
export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 75));
}
