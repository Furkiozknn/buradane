import type { Place } from "./types";

/**
 * Directions hand off to whatever map app the user already has, rather than
 * this product trying to be a routing engine. `geo:` would be the purest
 * choice but desktop browsers do nothing with it, so we use Google Maps'
 * universal `dir` URL, which resolves to the native app on both mobile
 * platforms and to the web app on desktop.
 */
export function directionsUrl(place: Place): string {
  const destination = `${place.lat},${place.lon}`;
  const params = new URLSearchParams({
    api: "1",
    destination,
    travelmode: "walking",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Secondary action: open the place itself (not a route) on OpenStreetMap,
 * which is also where its source record lives - so "veriyi gör" and "haritada
 * aç" are the same click. */
export function osmUrl(place: Place): string {
  return place.source?.url ?? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=19/${place.lat}/${place.lon}`;
}
