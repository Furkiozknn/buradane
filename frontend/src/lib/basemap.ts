import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap: OpenFreeMap's public "positron" style - no API key, no signup,
 * OSM-derived vector tiles. A muted grey basemap is a deliberate choice, not
 * a default: every drop of color on this map belongs to the category pins.
 * A vivid basemap would make a dense result set unreadable.
 */
export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/**
 * Did this MapLibre error mean "the basemap style itself could not be
 * fetched"?
 *
 * That one failure is different in kind from a missing tile or sprite: the
 * map never fires `load`, so the result layers - which are added in the load
 * handler - never exist either. Before this was handled, an unreachable
 * tiles.openfreemap.org (outage, a network filter, a strict corporate proxy)
 * left an empty beige rectangle with no pins and no message, while the list
 * beside it happily showed 200 results. The only trace was a console line.
 *
 * MapLibre reports a failed style fetch as an AJAXError carrying the `url`
 * it asked for; matching on that url (not on the message text, which is
 * not an API) is what separates it from every other error event.
 */
export function isBasemapStyleFailure(error: unknown, styleUrl: string = BASEMAP_STYLE): boolean {
  if (!error || typeof error !== "object") return false;
  const url = (error as { url?: unknown }).url;
  if (typeof url !== "string") return false;
  return url.split(/[?#]/)[0] === styleUrl;
}

/**
 * What the map switches to when the basemap style cannot be fetched: a plain
 * background, so MapLibre can finish loading and the result pins, clusters
 * and selection ring still render in the right places. No streets, but every
 * place is still where it is, and the list, bearing and distance still work.
 *
 * `glyphs` keeps the OpenFreeMap font URL on purpose. MapLibre rejects a
 * symbol layer with `text-field` in a style without `glyphs`, which would
 * drop the cluster-count and name layers at add time; with the URL present
 * they are added normally and, if the host is still unreachable, simply
 * draw no text. Pins are icons, not text, so they are unaffected.
 */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#EEEBE6" } }],
};
