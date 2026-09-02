"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * MapLibre GL JS v6 is ESM-only and loads its tile-parsing worker from a
 * separate file at runtime, so every bundler-based app has to point at that
 * worker once.
 *
 * We serve it from /public rather than letting the bundler emit it (the
 * documented `new URL(..., import.meta.url)` recipe): the worker statically
 * imports a sibling module, and Turbopack emits the worker without that
 * sibling, so it throws on boot. The resulting failure is completely silent -
 * style and sprites load, no error is ever raised, and the map requests zero
 * vector tiles - which is exactly the blank map this replaced.
 *
 * scripts/copy-maplibre-worker.mjs keeps public/maplibre/ in sync, and runs
 * before dev and build.
 * https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

import { CATEGORIES, categoryMeta } from "@/lib/categories";
import type { Place } from "@/lib/types";
import { buildPinImage } from "@/lib/pin-image";

const SOURCE_ID = "places";
const CLUSTER_LAYER = "clusters";
const CLUSTER_COUNT_LAYER = "cluster-count";
const POINT_LAYER = "place-points";
const LABEL_LAYER = "place-labels";
const SELECTED_LAYER = "place-selected";

/**
 * Basemap: OpenFreeMap's public "positron" style - no API key, no signup,
 * OSM-derived vector tiles. A muted grey basemap is a deliberate choice, not
 * a default: every drop of color on this map belongs to the 9 category pins.
 * A vivid basemap would make a dense result set unreadable.
 */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export interface MapCanvasProps {
  places: Place[];
  selectedId: string | null;
  userLocation: { lat: number; lon: number } | null;
  /** Insets for whatever UI covers the map (bottom sheet on mobile, sidebar
   * on desktop) so the map centers content in the area that's actually
   * visible rather than behind a panel. */
  padding: { bottom: number; left: number };
  onSelect: (place: Place | null) => void;
  /** `center` is the map's own centre, which respects `padding` - the bbox
   * midpoint does NOT (MapLibre computes getBounds() from the raw canvas
   * corners), and using it puts a suggested place hundreds of metres to
   * kilometres from where the user was actually looking. */
  onViewportChange: (
    bbox: [number, number, number, number],
    zoom: number,
    center: { lat: number; lon: number },
  ) => void;
  onMapMoved: () => void;
  onReady?: () => void;
}

export default function MapCanvas({
  places,
  selectedId,
  userLocation,
  padding,
  onSelect,
  onViewportChange,
  onMapMoved,
  onReady,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const userMarkerRef = useRef<Marker | null>(null);
  // Callbacks change identity on every parent render; holding them in refs
  // keeps the map's event listeners stable so the map is never re-created.
  const handlersRef = useRef({ onSelect, onViewportChange, onMapMoved, onReady });
  // Latest results, readable from inside the async load handler. Without
  // this, results that arrive while the map is still initialising are lost:
  // the data effect can only no-op until the source exists, and if no
  // further result update follows, the map stays empty forever.
  const placesRef = useRef(places);

  const toGeoJSONRef = useRef<(items: Place[]) => GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: [],
  }));

  const toGeoJSON = useCallback((items: Place[]) => {
    return {
      type: "FeatureCollection" as const,
      features: items.map((place) => ({
        type: "Feature" as const,
        id: place.id,
        geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
        properties: {
          id: place.id,
          name: place.name,
          category: place.categories[0] ?? "park",
          reliable: place.reliability_score >= 0.5 ? 1 : 0,
        },
      })),
    };
  }, []);

  // Refs are written in an effect, not during render: the map's event
  // listeners and its async load handler read them later (at event time), so
  // a commit-phase write is both correct and what React expects.
  useEffect(() => {
    handlersRef.current = { onSelect, onViewportChange, onMapMoved, onReady };
    placesRef.current = places;
    toGeoJSONRef.current = toGeoJSON;
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [28.9784, 41.0082], // İstanbul, until we know where the user is
      zoom: 12.5,
      attributionControl: false,
      // Pitch/rotate add nothing to a "what's near me" product and make the
      // map easy to knock askew with a stray two-finger gesture.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") {
      // Debug handle. Kept because the one failure mode this map has shown in
      // practice (v6's worker failing to boot) produces no error anywhere -
      // being able to inspect the live instance from the console is the only
      // practical way to diagnose it.
      (window as unknown as { __buradaneMap?: MapLibreMap }).__buradaneMap = map;
    }

    map.touchZoomRotate.disableRotation();
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.getCanvas().setAttribute("aria-label", "Kamusal alan haritası");
    map.getCanvas().setAttribute("role", "application");

    // Without this, a style/tile/source failure is completely silent - the
    // map just stays blank and there is nothing to debug from.
    map.on("error", (event) => {
      console.error("MapLibre hatası:", event?.error?.message ?? event);
    });

    map.on("load", async () => {
      // Pin images: one per category, drawn once and registered as map
      // images. A symbol layer with icon-image scales to thousands of
      // features, where DOM markers would stall the main thread.
      //
      // Failures here must NOT abort the rest of setup: if a pin image can't
      // be produced, the right outcome is a map with default-styled points,
      // not a map with no data layers at all.
      await Promise.allSettled(
        CATEGORIES.map(async (category) => {
          const image = await buildPinImage(category.pin, category.slug);
          if (image && !map.hasImage(`pin-${category.slug}`)) {
            map.addImage(`pin-${category.slug}`, image, { pixelRatio: 2 });
          }
        }),
      );

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 52,
        clusterMaxZoom: 15,
      });

      map.addLayer({
        id: CLUSTER_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          // Neutral clusters on purpose: a cluster has no single category, so
          // coloring it with one would be a lie.
          "circle-color": "#1C1917",
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 50, 27, 200, 33],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#FFFFFF",
        },
      });

      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 13,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#FFFFFF" },
      });

      map.addLayer({
        id: SELECTED_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["get", "id"], "__none__"],
        paint: {
          "circle-radius": 26,
          "circle-color": "#0E6E78",
          "circle-opacity": 0.18,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0E6E78",
          "circle-stroke-opacity": 0.5,
        },
      });

      map.addLayer({
        id: POINT_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["concat", "pin-", ["get", "category"]],
          "icon-size": 0.5,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          // Selected pin must never be hidden behind a neighbour.
          "symbol-sort-key": ["case", ["==", ["get", "id"], ["literal", ""]], 0, 1],
        },
        paint: {
          // Low-confidence records are drawn faded rather than hidden - the
          // user still sees them, and the card explains why they look weaker.
          "icon-opacity": ["case", ["==", ["get", "reliable"], 1], 1, 0.62],
        },
      });

      map.addLayer({
        id: LABEL_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        minzoom: 16,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-offset": [0, 0.6],
          "text-anchor": "top",
          "text-max-width": 9,
          "text-optional": true,
        },
        paint: {
          "text-color": "#1C1917",
          // Halo, not a background box: keeps labels legible over the map
          // without covering it. The accessible path is the list, not this.
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 1.6,
        },
      });

      readyRef.current = true;

      // Apply whatever results exist right now. The data effect below cannot
      // do this for us: it may well have already run (and no-opped) while
      // this async handler was still awaiting pin images.
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (source) source.setData(toGeoJSONRef.current(placesRef.current));

      handlersRef.current.onReady?.();
      emitViewport(map);
    });

    const emitViewport = (instance: MapLibreMap) => {
      const bounds = instance.getBounds();
      const center = instance.getCenter();
      handlersRef.current.onViewportChange(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        instance.getZoom(),
        { lat: center.lat, lon: center.lng },
      );
    };

    map.on("moveend", () => {
      emitViewport(map);
      handlersRef.current.onMapMoved();
    });

    map.on("click", CLUSTER_LAYER, async (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const source = map.getSource(SOURCE_ID) as GeoJSONSource;
      const clusterId = feature.properties?.cluster_id as number;
      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
          duration: 380,
        });
      } catch {
        // A cluster can vanish between click and resolve (source updated);
        // silently ignoring is correct - there's nothing to expand into.
      }
    });

    map.on("click", POINT_LAYER, (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;
      handlersRef.current.onSelect({ id: feature.properties.id } as Place);
    });

    // Tapping empty map dismisses the selection - the standard "escape
    // hatch" gesture users expect from every map app.
    map.on("click", (event: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(event.point, { layers: [POINT_LAYER, CLUSTER_LAYER] });
      if (hits.length === 0) handlersRef.current.onSelect(null);
    });

    for (const layer of [CLUSTER_LAYER, POINT_LAYER]) {
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Feed results into the map source. Before the map is ready this is a
  // no-op on purpose - the load handler applies `placesRef` itself, which is
  // the only ordering that can't race with its own async setup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (source) source.setData(toGeoJSON(places));
  }, [places, toGeoJSON]);

  // Highlight ring for the selected place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!map.getLayer(SELECTED_LAYER)) return;
    map.setFilter(SELECTED_LAYER, ["==", ["get", "id"], selectedId ?? "__none__"]);
  }, [selectedId, places]);

  // Keep the visible (unobscured) map area centered clear of the panel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Never let padding exceed the canvas: a padding taller/wider than the
    // viewport collapses the transform and the map silently stops drawing.
    const canvas = map.getCanvas();
    const maxBottom = Math.max(0, canvas.clientHeight - 160);
    const maxLeft = Math.max(0, canvas.clientWidth - 160);
    map.setPadding({
      top: 90,
      bottom: Math.min(padding.bottom, maxBottom),
      left: Math.min(padding.left, maxLeft),
      right: 24,
    });
  }, [padding.bottom, padding.left]);

  // User location dot. A DOM marker is right here: exactly one, and it needs
  // a pulsing halo that a symbol layer can't express.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    if (!userMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "buradane-user-dot";
      element.setAttribute("aria-hidden", "true");
      userMarkerRef.current = new Marker({ element }).setLngLat([userLocation.lon, userLocation.lat]);
      userMarkerRef.current.addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userLocation.lon, userLocation.lat]);
    }
  }, [userLocation]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <style jsx global>{`
        .buradane-user-dot {
          width: 20px;
          height: 20px;
          border-radius: 999px;
          background: var(--location);
          border: 3px solid #fff;
          box-shadow: 0 0 0 6px color-mix(in srgb, var(--location) 22%, transparent);
        }
        @media (prefers-reduced-motion: no-preference) {
          .buradane-user-dot {
            animation: buradane-pulse 2.4s ease-in-out infinite;
          }
        }
        @keyframes buradane-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 6px color-mix(in srgb, var(--location) 22%, transparent);
          }
          50% {
            box-shadow: 0 0 0 12px color-mix(in srgb, var(--location) 8%, transparent);
          }
        }
      `}</style>
    </div>
  );
}

export function useMapController() {
  return null;
}

export { categoryMeta };
