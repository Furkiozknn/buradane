"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Bookmark,
  LocateFixed,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  WifiOff,
  X,
} from "lucide-react";

import { AMENITY_BY_KEY } from "@/lib/categories";
import { CategoryChips, CategoryGrid } from "./CategoryPicker";
import { PlaceCard, PlaceCardSkeleton } from "./PlaceCard";
import { PlaceDetail } from "./PlaceDetail";
import { EMPTY_FILTERS, FilterSheet, activeFilterCount, type FilterState } from "./FilterSheet";
import { SuggestPlaceDialog } from "./SuggestPlaceDialog";
import { CityPicker } from "./CityPicker";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { buildUrlSearch, type UrlState } from "@/lib/url-state";
import { useFavorites } from "@/lib/use-favorites";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { CategorySlug, Place, PlaceQueryResult, SortKey } from "@/lib/types";

// The map is browser-only (WebGL + window). Loading it without SSR is
// required, not a preference - and it keeps maplibre out of the server bundle.
const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface-sunken" aria-hidden />,
});

const DEFAULT_RADIUS_M = 2000;

/** Where each pilot city's map opens when we can't use the device location.
 * Keyed by the slug the data pipeline writes, so a new city file shows up in
 * the picker as soon as its centre is listed here. */
const CITY_CENTERS: Record<string, { lat: number; lon: number }> = {
  istanbul: { lat: 41.0082, lon: 28.9784 },
  ankara: { lat: 39.9208, lon: 32.8541 },
  izmir: { lat: 38.4237, lon: 27.1428 },
};

const FALLBACK_CENTER = CITY_CENTERS.istanbul;

type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "granted"; lat: number; lon: number }
  | { status: "denied" }
  | { status: "unavailable" };

type SheetSnap = "peek" | "half" | "full";

const SNAP_HEIGHT: Record<SheetSnap, string> = {
  peek: "min(190px, 26vh)",
  half: "52vh",
  // Anchored to the floating header's height rather than a vh percentage:
  // at 92vh the expanded sheet stopped ~6px below the filter button, which
  // both looks cramped and fails the touch-target spacing check. Leaving a
  // fixed 136px keeps a real gap on every screen size, and keeps a strip of
  // map visible so the user never loses spatial context.
  full: "calc(100dvh - 136px)",
};

/** Turns the query engine's relaxation report into one short Turkish phrase. */
function relaxationDetail(relaxedBy: PlaceQueryResult["applied"]["relaxedBy"]): string {
  const dropped = relaxedBy?.amenities ?? [];
  if (dropped.length > 0) {
    const labels = dropped.map((key) => AMENITY_BY_KEY[key]?.filterLabel ?? key);
    return `${labels.join(", ").toLocaleLowerCase("tr-TR")} filtresi kaldırıldı`;
  }
  if (relaxedBy?.needle) return `“${relaxedBy.needle}” aranmadı`;
  return "arama genişletildi";
}

export function AppShell({
  datasetMeta,
  initialState,
}: {
  datasetMeta: {
    attribution: string;
    generatedAt: string;
    count: number;
    cities: { slug: string; label: string; count: number }[];
  };
  /** Parsed from the request URL on the server (see app/page.tsx), so the
   * server and client agree on the first paint - reading `window` here
   * instead produces a hydration mismatch and a visible state jump. */
  initialState: UrlState;
}) {
  const initial = initialState;

  const [category, setCategory] = useState<CategorySlug | null>(initial?.category ?? null);
  const [filters, setFilters] = useState<FilterState>(
    initial
      ? { amenities: initial.amenities, openNow: initial.openNow, freeOnly: initial.freeOnly }
      : EMPTY_FILTERS,
  );
  const [query, setQuery] = useState(initial?.query ?? "");
  const [searchInput, setSearchInput] = useState(initial?.query ?? "");
  const [location, setLocation] = useState<LocationState>({ status: "idle" });
  const [result, setResult] = useState<PlaceQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  // A link that opens a place starts expanded. Letting it settle at "peek"
  // and then jump to "full" once the fetch resolves is a large, avoidable
  // layout shift on the exact page people share.
  const [snap, setSnap] = useState<SheetSnap>(initial?.placeId ? "full" : "peek");
  const [viewport, setViewport] = useState<{
    bbox: [number, number, number, number];
    zoom: number;
    center: { lat: number; lon: number };
  } | null>(null);
  const [staleViewport, setStaleViewport] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const { favoriteIds, toggle: toggleFavorite, isFavorite, count: favoriteCount } = useFavorites();
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("distance");
  // Defaults to the pilot city, not whichever file sorts first alphabetically
  // (which quietly made Ankara the default the moment it was added). Falls
  // back to the largest dataset if İstanbul is ever dropped.
  const [activeCity, setActiveCity] = useState<string>(() => {
    const cities = datasetMeta.cities;
    if (cities.some((c) => c.slug === "istanbul")) return "istanbul";
    return [...cities].sort((a, b) => b.count - a.count)[0]?.slug ?? "istanbul";
  });
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const deviceOnline = useOnlineStatus();
  // Set from the response itself: the service worker labels an answer it had
  // to serve from cache because the network was gone. That is the only
  // trustworthy offline signal - `navigator.onLine` stays true on a captive
  // portal, and cleared as soon as a request gets through again.
  const [servedFromCache, setServedFromCache] = useState(false);
  const online = deviceOnline && !servedFromCache;

  // Keep the address bar in step with what's on screen. replaceState, not
  // push: panning the map or toggling a filter shouldn't bury the user's
  // real navigation history under dozens of entries.
  useEffect(() => {
    const search = buildUrlSearch({
      category,
      amenities: filters.amenities,
      freeOnly: filters.freeOnly,
      openNow: filters.openNow,
      query,
      placeId: detailPlace?.id ?? null,
      center: viewport?.center ?? null,
      zoom: viewport?.zoom ?? null,
    });
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }, [category, filters, query, detailPlace, viewport]);

  const cityCenter = CITY_CENTERS[activeCity] ?? FALLBACK_CENTER;
  const center = location.status === "granted" ? { lat: location.lat, lon: location.lon } : cityCenter;
  // Deliberately excludes "locating": while the request is in flight we have
  // not fallen back to anything yet, and claiming we did would be both wrong
  // and (on desktop, where this drives the sidebar offset) a layout jump the
  // moment the real fix arrives.
  const usingApproximateLocation =
    location.status === "denied" || location.status === "unavailable" || location.status === "idle";

  /** Debounced free-text search: typing shouldn't fire a request per keystroke. */
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput), 320);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchPlaces = useCallback(
    async (opts: { bbox?: [number, number, number, number] } = {}) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.set("lat", String(center.lat));
      params.set("lon", String(center.lon));

      if (opts.bbox) {
        params.set("bbox", opts.bbox.join(","));
      } else {
        params.set("radius_m", String(DEFAULT_RADIUS_M));
      }

      if (category) params.append("category", category);
      for (const amenity of filters.amenities) params.append("amenity", amenity);
      if (filters.freeOnly) params.set("free_only", "true");
      if (filters.openNow) params.set("open_now", "true");
      if (query.trim()) params.set("q", query.trim());
      if (sort !== "distance") params.set("sort", sort);
      params.set("limit", "200");

      try {
        const response = await fetch(`/api/places?${params.toString()}`);
        // The service worker answers with 503 + this header when it has
        // neither a cached copy nor a network. Treating it as a normal
        // server error would tell the user something is broken, when what
        // actually happened is that they walked out of coverage.
        const wasOffline = response.headers.get("x-buradane-offline") !== null;
        if (response.status === 503 && wasOffline) {
          if (requestId !== requestIdRef.current) return;
          setServedFromCache(true);
          setError("Çevrimdışısınız ve bu arama daha önce yüklenmemiş");
          return;
        }
        if (!response.ok) throw new Error(`Sunucu ${response.status} döndü`);
        const data = (await response.json()) as PlaceQueryResult;
        // A slower earlier request must never overwrite a newer result.
        if (requestId !== requestIdRef.current) return;
        setServedFromCache(wasOffline);
        setResult(data);
        setStaleViewport(false);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        // A hard failure means nothing answered at all - not even the cache.
        setServedFromCache(true);
        setError(err instanceof Error ? err.message : "Sonuçlar getirilemedi");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [category, filters, query, sort, center.lat, center.lon],
  );

  // Filter/category/search changes re-query immediately against the current
  // map viewport (or the radius, before the map reports one).
  //
  // The two disables are deliberate:
  //  - exhaustive-deps: `viewport` is read but intentionally NOT a dependency.
  //    Panning must not silently re-query (that's what the "Bu alanda ara"
  //    button is for); only a filter/search/location change re-fetches.
  //  - set-state-in-effect: fetchPlaces sets loading/error synchronously.
  //    That's the point - this effect synchronises with an external system
  //    (the API), and the actual hazard it warns about, a stale response
  //    overwriting a newer one, is handled by the request-id guard inside
  //    fetchPlaces.
  useEffect(() => {
    const bbox = viewport?.bbox;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPlaces(bbox ? { bbox } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, filters, query, sort, location.status]);

  // Coming back into coverage refreshes on its own. Making someone who just
  // walked out of a metro station notice a stale list and hunt for a refresh
  // button is the kind of small friction that decides whether a tool gets
  // used twice. Only fires on the offline -> online edge, and only when the
  // last attempt actually failed, so a normal session never re-queries here.
  // Keyed to the device flag, not to `online`: `online` only turns true once
  // a request has succeeded, so waiting on it would mean waiting for the
  // refresh this effect is supposed to trigger.
  const wasDegradedRef = useRef(false);
  useEffect(() => {
    wasDegradedRef.current = error !== null || servedFromCache;
  }, [error, servedFromCache]);

  useEffect(() => {
    if (!deviceOnline) return;
    if (!wasDegradedRef.current) return;
    const bbox = viewport?.bbox;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPlaces(bbox ? { bbox } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceOnline]);

  // A link that names a place opens straight on that place's detail, rather
  // than dropping the recipient on a map and making them hunt for it.
  useEffect(() => {
    if (!initial?.placeId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/places/${encodeURIComponent(initial.placeId!)}`);
        if (!response.ok || cancelled) return;
        const place = (await response.json()) as Place;
        setDetailPlace(place);
        setSelectedId(place.id);
        setSnap("full");
      } catch {
        // A stale or hand-edited link shouldn't break the app - the user
        // still lands on a working map.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initial?.placeId]);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocation({ status: "unavailable" });
      return;
    }
    setLocation({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          status: "granted",
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (geoError) => {
        // PERMISSION_DENIED is a decision, not a failure - never re-prompt,
        // just fall back to the city and say so plainly.
        setLocation({ status: geoError.code === geoError.PERMISSION_DENIED ? "denied" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }, []);

  const handleViewportChange = useCallback(
    (bbox: [number, number, number, number], zoom: number, mapCenter: { lat: number; lon: number }) => {
      setViewport({ bbox, zoom, center: mapCenter });
    },
    [],
  );

  const handleMapMoved = useCallback(() => {
    setStaleViewport(true);
  }, []);

  // Favorites filter is applied client-side: the saved list never leaves the
  // device, so the server has no way to filter by it (and shouldn't).
  const allPlaces = result?.places ?? [];
  const places = showFavoritesOnly ? allPlaces.filter((p) => favoriteIds.includes(p.id)) : allPlaces;
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const place of places) {
      for (const slug of place.categories) map[slug] = (map[slug] ?? 0) + 1;
    }
    return map;
  }, [places]);

  const selectedPlace = useMemo(
    () => places.find((p) => p.id === selectedId) ?? null,
    [places, selectedId],
  );

  const openDetail = useCallback((place: Place) => {
    setDetailPlace(place);
    setSelectedId(place.id);
    setSnap("full");
  }, []);

  /** After a verification lands, both views have to agree: the list/map get
   * re-queried, and the open detail re-reads its own record so the score and
   * "N kişi doğruladı" the user is looking at aren't a snapshot from before
   * their own tap. */
  const handleVerified = useCallback(
    async (placeId: string) => {
      void fetchPlaces(viewport ? { bbox: viewport.bbox } : {});
      try {
        const response = await fetch(`/api/places/${encodeURIComponent(placeId)}`);
        if (!response.ok) return;
        const fresh = (await response.json()) as Place;
        setDetailPlace((current) => (current?.id === placeId ? { ...current, ...fresh } : current));
      } catch {
        // The verification itself already succeeded; failing to refresh the
        // view is not worth surfacing an error over.
      }
    },
    [fetchPlaces, viewport],
  );

  const sheetHeightPx = useMemo(() => {
    if (typeof window === "undefined") return 190;
    const vh = window.innerHeight;
    if (snap === "peek") return Math.min(190, vh * 0.26);
    if (snap === "half") return vh * 0.52;
    return vh * 0.92;
  }, [snap]);

  // On desktop the panel is beside the map, so nothing is covered at the
  // bottom - the map should instead keep its content clear of the sidebar.
  const mapPadding = isDesktop
    ? { bottom: 24, left: 416 }
    : { bottom: Math.min(sheetHeightPx, 360), left: 24 };

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (places.length === 0) return;
      const index = places.findIndex((p) => p.id === selectedId);

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next =
          event.key === "ArrowDown"
            ? Math.min(places.length - 1, index + 1)
            : Math.max(0, index <= 0 ? 0 : index - 1);
        const target = places[next];
        if (!target) return;
        setSelectedId(target.id);
        // Keep the highlighted row on screen - moving a selection the user
        // can't see is worse than not moving it.
        document
          .querySelector(`[data-place-id="${CSS.escape(target.id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "Enter" && index >= 0) {
        event.preventDefault();
        openDetail(places[index]);
        return;
      }

      if (event.key === "Escape" && selectedId) {
        event.preventDefault();
        setSelectedId(null);
      }
    },
    [places, selectedId, openDetail],
  );

  const cityOptions = useMemo(
    () =>
      datasetMeta.cities.map((city) => ({
        ...city,
        center: CITY_CENTERS[city.slug] ?? FALLBACK_CENTER,
      })),
    [datasetMeta.cities],
  );
  const activeCityLabel =
    datasetMeta.cities.find((c) => c.slug === activeCity)?.label ?? "İstanbul";

  const filterCount = activeFilterCount(filters);
  const hasAnyFilter = filterCount > 0 || category !== null || query.trim().length > 0;

  // Where a suggested place would land: the map's own centre, which accounts
  // for the sheet/sidebar padding. The bbox midpoint would be the centre of
  // the whole canvas including the part hidden behind the panel - off by
  // hundreds of metres to kilometres depending on zoom.
  const mapCenter = viewport?.center ?? center;

  return (
    <main
      className="relative h-[100dvh] w-full overflow-hidden bg-bg"
      // When the sheet is fully expanded on mobile it covers the map, and
      // MapLibre's zoom buttons end up underneath it - unreachable, and
      // flagged as obscured touch targets. Hiding them in that one state is
      // honest: there is no map to zoom while the panel owns the screen.
      data-sheet={isDesktop ? "sidebar" : snap}
    >
      <MapCanvas
        places={places}
        selectedId={selectedId}
        userLocation={location.status === "granted" ? { lat: location.lat, lon: location.lon } : null}
        padding={mapPadding}
        initialView={
          initial?.center && initial.zoom !== null
            ? { center: initial.center, zoom: initial.zoom }
            : null
        }
        onSelect={(place) => {
          if (!place) {
            setSelectedId(null);
            return;
          }
          setSelectedId(place.id);
          const full = places.find((p) => p.id === place.id);
          if (full) {
            setDetailPlace(null);
            setSnap((current) => (current === "peek" ? "half" : current));
          }
        }}
        onViewportChange={handleViewportChange}
        onMapMoved={handleMapMoved}
      />

      {/* Top bar: search + filters. Exactly two controls float over the map.
          On desktop it sits inside the sidebar column instead of spanning
          the whole width, so it never floats over the map twice. */}
      <div
        className="pointer-events-none absolute top-0 z-20 p-3"
        style={isDesktop ? { left: 0, width: 416 } : { left: 0, right: 0 }}
      >
        <div className="pointer-events-auto mx-auto flex max-w-2xl gap-2">
          <div className="flex h-12 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 shadow">
            <Search size={18} className="shrink-0 text-text-muted" aria-hidden />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Ne arıyorsun? Örn. ücretsiz tuvalet"
              aria-label="Mekan ara"
              // 16px is a hard floor for form controls: iOS Safari auto-zooms
              // the whole layout when a focused input is smaller, and it does
              // not zoom back out on blur.
              className="h-full w-full min-w-0 bg-transparent text-[16px] outline-none placeholder:text-text-muted"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="shrink-0 text-text-muted hover:text-text"
                aria-label="Aramayı temizle"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface shadow"
            aria-label={`Filtreler${filterCount > 0 ? `, ${filterCount} aktif` : ""}`}
          >
            <SlidersHorizontal size={18} />
            {filterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold text-brand-contrast">
                {filterCount}
              </span>
            )}
          </button>
        </div>

        {/* Shown on desktop too: silently falling back to the city centre
            with no explanation is exactly the state users misread as "the
            app is broken". On desktop this sits in the sidebar column, so
            it doesn't need to compete with the map. */}
        {usingApproximateLocation && (
          // mt-3, not mt-2: at mt-2 this row clipped the bottom of the 48px
          // filter button above it, leaving it only ~6px of free space and
          // failing the touch-target spacing check.
          <div className="pointer-events-auto mx-auto mt-3 flex max-w-2xl justify-center">
            {/* pointer-events-none: this is a passive label sitting over the
                map, and without it the strip silently eats drag-to-pan. */}
            {/* Tappable: when we can't locate someone, "pick your city" is a
                far better recovery than a blank map or a re-prompt the
                browser will silently swallow. */}
            <button
              type="button"
              onClick={() => setCityPickerOpen(true)}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1 text-[12px] font-medium text-text-secondary shadow-sm transition-colors hover:bg-surface"
            >
              <MapPin size={12} aria-hidden />
              {location.status === "denied" ? "Konum kapalı" : "Yaklaşık konum"} — {activeCityLabel}
              <span className="text-brand">&middot; değiştir</span>
            </button>
          </div>
        )}
      </div>

      {/* "Search this area" - the map moved, so results may not match what's
          visible. Re-querying automatically would fight the user; offering it
          keeps them in control. */}
      {/* Not shown when the sheet is fully expanded: there is no visible map
          left to re-search, and the pill would sit underneath the panel. */}
      {staleViewport && !loading && (isDesktop || snap !== "full") && (
        <button
          type="button"
          onClick={() => viewport && fetchPlaces({ bbox: viewport.bbox })}
          className="absolute z-20 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] font-semibold shadow-lg"
          // Centered over the *map*, which on desktop starts after the
          // sidebar; and below the approximate-location chip when that chip
          // is showing, so the two never overlap.
          style={{
            background: "var(--text)",
            color: "var(--bg)",
            top: isDesktop ? "1.25rem" : usingApproximateLocation ? "8rem" : "5rem",
            left: isDesktop ? "calc(416px + (100% - 416px) / 2)" : "50%",
          }}
        >
          <span className="flex items-center gap-1.5">
            <RefreshCw size={14} aria-hidden />
            Bu alanda ara
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={requestLocation}
        className="absolute right-3 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface shadow transition-transform"
        style={{
          bottom: isDesktop
            ? "calc(1.5rem + env(safe-area-inset-bottom))"
            : `calc(${SNAP_HEIGHT[snap]} + 12px)`,
        }}
        aria-label="Konumumu göster"
      >
        <LocateFixed
          size={20}
          className={location.status === "locating" ? "animate-spin" : ""}
          style={{ color: location.status === "granted" ? "var(--location)" : "var(--text-secondary)" }}
        />
      </button>

      {/* Bottom sheet */}
      <section
        ref={sheetRef}
        id="sonuclar"
        aria-label="Sonuçlar"
        className={
          isDesktop
            ? "absolute bottom-3 left-3 z-30 flex w-[400px] flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-lg"
            : "absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl border-t border-border bg-surface shadow-lg transition-[height] duration-300 ease-out"
        }
        // Desktop: starts below the search row, and lower still when the
        // approximate-location chip is showing above it.
        style={
          isDesktop
            ? { top: usingApproximateLocation ? 118 : 76 }
            : { height: SNAP_HEIGHT[snap] }
        }
      >
        {!isDesktop && (
          <button
            type="button"
            onClick={() => setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"))}
            className="flex h-7 w-full shrink-0 items-center justify-center"
            aria-label={snap === "full" ? "Paneli küçült" : "Paneli büyüt"}
          >
            <span className="h-1 w-9 rounded-full bg-border-strong" />
          </button>
        )}

        {detailPlace ? (
          <PlaceDetail
            place={detailPlace}
            onBack={() => setDetailPlace(null)}
            onVerified={handleVerified}
            isFavorite={isFavorite(detailPlace.id)}
            onToggleFavorite={toggleFavorite}
          />
        ) : (
          <>
            <div className="shrink-0">
              {/* Placed inside the sheet rather than floating over the map:
                  the map itself keeps working offline from cached tiles, so
                  a full-width alarm across it would overstate the problem.
                  What is actually at stake is whether the *list* is current,
                  and this sits directly above the list. */}
              {!online && (
                <div
                  role="status"
                  className="mx-4 mb-1 mt-2 flex items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-[12.5px] text-text-secondary"
                >
                  <WifiOff size={14} className="shrink-0" aria-hidden />
                  <span>
                    Çevrimdışısınız
                    {result ? " — daha önce yüklenen sonuçlar gösteriliyor." : " — bağlantı gelince yenilenecek."}
                  </span>
                </div>
              )}
              {category === null && (isDesktop || snap !== "peek") ? (
                <CategoryGrid selected={category} onSelect={setCategory} counts={counts} />
              ) : (
                <CategoryChips selected={category} onSelect={setCategory} counts={counts} />
              )}

              <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-2">
                {favoriteCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowFavoritesOnly((v) => !v)}
                    aria-pressed={showFavoritesOnly}
                    className="flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors"
                    style={{
                      borderColor: showFavoritesOnly ? "var(--brand)" : "var(--border)",
                      background: showFavoritesOnly ? "var(--brand-soft)" : "transparent",
                      color: showFavoritesOnly ? "var(--brand)" : "var(--text-secondary)",
                    }}
                  >
                    <Bookmark size={12} fill={showFavoritesOnly ? "currentColor" : "none"} aria-hidden />
                    Kayıtlı {favoriteCount}
                  </button>
                )}
                <p className="text-[13px] font-medium text-text-secondary" aria-live="polite">
                  {loading
                    ? "Yakındakiler aranıyor…"
                    : error
                      ? "Sonuçlar getirilemedi"
                      : `${result?.total ?? 0} sonuç${
                          places[0]?.distance_m != null
                            ? ` · en yakın ${Math.round(places[0].distance_m)} m`
                            : ""
                        }`}
                </p>
                {result?.applied.relaxed && !loading && (
                  // Naming what was dropped matters more than admitting that
                  // something was: "arama genişletildi" leaves the user
                  // wondering whether these results still answer their
                  // question. Saying "bebek bakım filtresi kaldırıldı" lets
                  // them judge it themselves.
                  <span className="shrink-0 text-[11.5px] text-text-muted" title={relaxationDetail(result.applied.relaxedBy)}>
                    {relaxationDetail(result.applied.relaxedBy)}
                  </span>
                )}
                {/* Sorting matters here in a way it wouldn't in a normal
                    directory: open civic data is uneven, so the nearest
                    record is sometimes an unverified decade-old node while
                    the one 200m further is the one that's actually there. */}
                <button
                  type="button"
                  onClick={() => setSort((s) => (s === "distance" ? "reliability" : "distance"))}
                  className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-text-secondary"
                  aria-label={`Sıralama: ${sort === "distance" ? "en yakın" : "en güvenilir"}. Değiştir.`}
                >
                  <ArrowUpDown size={12} aria-hidden />
                  {sort === "distance" ? "En yakın" : "En güvenilir"}
                </button>
                {hasAnyFilter && !loading && (
                  <button
                    type="button"
                    onClick={() => {
                      setCategory(null);
                      setFilters(EMPTY_FILTERS);
                      setSearchInput("");
                    }}
                    className="shrink-0 text-[12.5px] font-medium text-brand"
                  >
                    Temizle
                  </button>
                )}
              </div>
            </div>

            {/* The bottom padding clears the iPhone home indicator: the
                layout declares viewport-fit=cover, which makes honouring the
                inset this app's responsibility. */}
            {/* The list is the map's accessible equivalent, so it has to be
                navigable without a pointer: ↑/↓ step through results (and
                highlight the matching pin), Enter opens, Escape clears the
                selection. Tabbing through 200 cards to reach the fifth one
                is not navigation. */}
            <div
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4"
              style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
              onKeyDown={handleListKeyDown}
            >
              {loading && places.length === 0 ? (
                Array.from({ length: 4 }).map((_, index) => <PlaceCardSkeleton key={index} />)
              ) : error ? (
                <EmptyState
                  title="Bir şeyler ters gitti"
                  body="Sonuçları getiremedik."
                  actionLabel="Tekrar dene"
                  onAction={() => fetchPlaces(viewport ? { bbox: viewport.bbox } : {})}
                />
              ) : places.length === 0 ? (
                hasAnyFilter ? (
                  <EmptyState
                    title="Filtrelere uyan yer yok"
                    body="Seçtiğin filtreleri gevşetmeyi ya da haritayı biraz kaydırmayı dene."
                    actionLabel="Filtreleri temizle"
                    onAction={() => {
                      setCategory(null);
                      setFilters(EMPTY_FILTERS);
                      setSearchInput("");
                    }}
                    // A dead end is the worst possible outcome here: if we
                    // genuinely have nothing, the useful move is letting the
                    // user add what they know is there.
                    secondaryLabel="Yer öner"
                    onSecondary={() => setSuggestOpen(true)}
                  />
                ) : (
                  <EmptyState
                    title="Bu bölgede sonuç yok"
                    body="Haritayı biraz kaydır ya da uzaklaştır."
                    actionLabel="Bu alanda ara"
                    onAction={() => viewport && fetchPlaces({ bbox: viewport.bbox })}
                    secondaryLabel="Yer öner"
                    onSecondary={() => setSuggestOpen(true)}
                  />
                )
              ) : (
                places.map((place) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    active={place.id === selectedId}
                    origin={center}
                    onSelect={(p) => setSelectedId(p.id)}
                    onOpenDetail={openDetail}
                  />
                ))
              )}

              {places.length > 0 && (
                <div className="pt-3 text-center">
                  <button
                    type="button"
                    onClick={() => setSuggestOpen(true)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken"
                  >
                    <Plus size={15} aria-hidden />
                    Eksik bir yer mi var? Öner
                  </button>
                  <p className="mt-3 text-[11px] text-text-muted">
                    {datasetMeta.attribution} · {datasetMeta.count.toLocaleString("tr-TR")} kayıt
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Selected-place quick card floating above the sheet, so tapping a pin
          answers the question without forcing a trip into the list. */}
      {selectedPlace && !detailPlace && !isDesktop && (
        <div
          className="absolute inset-x-3 z-20 mx-auto max-w-md"
          style={{ bottom: `calc(${SNAP_HEIGHT[snap]} + 68px)` }}
        >
          <PlaceCard
            place={selectedPlace}
            active
            origin={center}
            onSelect={() => {}}
            onOpenDetail={openDetail}
          />
        </div>
      )}

      {filtersOpen && (
        <FilterSheet
          filters={filters}
          resultCount={result?.total ?? 0}
          onChange={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {suggestOpen && (
        <SuggestPlaceDialog center={mapCenter} onClose={() => setSuggestOpen(false)} />
      )}

      {cityPickerOpen && (
        <CityPicker
          cities={cityOptions}
          activeCity={activeCity}
          onSelect={(city) => {
            setActiveCity(city.slug);
            setCityPickerOpen(false);
            // Selecting a city is an explicit "take me here", so the map
            // jumps rather than waiting for the next viewport query.
            setViewport(null);
            setStaleViewport(false);
          }}
          onClose={() => setCityPickerOpen(false)}
        />
      )}
    </main>
  );
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <h3 className="text-[15px] font-semibold text-text">{title}</h3>
      <p className="mt-1 text-[13.5px] text-text-secondary">{body}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onAction}
          className="h-11 rounded-xl bg-brand px-5 text-[14px] font-semibold text-brand-contrast"
        >
          {actionLabel}
        </button>
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className="h-11 rounded-xl border border-border px-5 text-[14px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken"
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
