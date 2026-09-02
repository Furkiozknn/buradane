"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPin, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";

import { CategoryChips, CategoryGrid } from "./CategoryPicker";
import { PlaceCard, PlaceCardSkeleton } from "./PlaceCard";
import { PlaceDetail } from "./PlaceDetail";
import { EMPTY_FILTERS, FilterSheet, activeFilterCount, type FilterState } from "./FilterSheet";
import { SuggestPlaceDialog } from "./SuggestPlaceDialog";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import type { CategorySlug, Place, PlaceQueryResult } from "@/lib/types";

// The map is browser-only (WebGL + window). Loading it without SSR is
// required, not a preference - and it keeps maplibre out of the server bundle.
const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface-sunken" aria-hidden />,
});

const ISTANBUL_CENTER = { lat: 41.0082, lon: 28.9784 };
const DEFAULT_RADIUS_M = 2000;

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
  full: "92vh",
};

export function AppShell({
  datasetMeta,
}: {
  datasetMeta: { attribution: string; generatedAt: string; count: number };
}) {
  const [category, setCategory] = useState<CategorySlug | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [location, setLocation] = useState<LocationState>({ status: "idle" });
  const [result, setResult] = useState<PlaceQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [viewport, setViewport] = useState<{ bbox: [number, number, number, number]; zoom: number } | null>(null);
  const [staleViewport, setStaleViewport] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const center = location.status === "granted" ? { lat: location.lat, lon: location.lon } : ISTANBUL_CENTER;
  const usingApproximateLocation = location.status !== "granted";

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
      params.set("limit", "200");

      try {
        const response = await fetch(`/api/places?${params.toString()}`);
        if (!response.ok) throw new Error(`Sunucu ${response.status} döndü`);
        const data = (await response.json()) as PlaceQueryResult;
        // A slower earlier request must never overwrite a newer result.
        if (requestId !== requestIdRef.current) return;
        setResult(data);
        setStaleViewport(false);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Sonuçlar getirilemedi");
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [category, filters, query, center.lat, center.lon],
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
  }, [category, filters, query, location.status]);

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

  const handleViewportChange = useCallback((bbox: [number, number, number, number], zoom: number) => {
    setViewport({ bbox, zoom });
  }, []);

  const handleMapMoved = useCallback(() => {
    setStaleViewport(true);
  }, []);

  const places = result?.places ?? [];
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

  const filterCount = activeFilterCount(filters);
  const hasAnyFilter = filterCount > 0 || category !== null || query.trim().length > 0;

  // Where a suggested place would land: the middle of what the user is
  // currently looking at, which is the spot they panned to.
  const mapCenter = useMemo(() => {
    if (!viewport) return center;
    const [minLon, minLat, maxLon, maxLat] = viewport.bbox;
    return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  }, [viewport, center]);

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-bg">
      <MapCanvas
        places={places}
        selectedId={selectedId}
        userLocation={location.status === "granted" ? { lat: location.lat, lon: location.lon } : null}
        padding={mapPadding}
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
              className="h-full w-full min-w-0 bg-transparent text-[14.5px] outline-none placeholder:text-text-muted"
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
          <div className="pointer-events-auto mx-auto mt-2 flex max-w-2xl justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1 text-[12px] font-medium text-text-secondary shadow-sm">
              <MapPin size={12} aria-hidden />
              {location.status === "denied"
                ? "Konum kapalı — İstanbul merkez gösteriliyor"
                : "Yaklaşık konum — İstanbul merkez"}
            </span>
          </div>
        )}
      </div>

      {/* "Search this area" - the map moved, so results may not match what's
          visible. Re-querying automatically would fight the user; offering it
          keeps them in control. */}
      {staleViewport && !loading && (
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
        style={{ bottom: isDesktop ? "1.5rem" : `calc(${SNAP_HEIGHT[snap]} + 12px)` }}
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
            ? { top: usingApproximateLocation ? 112 : 76 }
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
          <PlaceDetail place={detailPlace} onBack={() => setDetailPlace(null)} />
        ) : (
          <>
            <div className="shrink-0">
              {category === null && (isDesktop || snap !== "peek") ? (
                <CategoryGrid selected={category} onSelect={setCategory} counts={counts} />
              ) : (
                <CategoryChips selected={category} onSelect={setCategory} counts={counts} />
              )}

              <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-2">
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
                  <span className="shrink-0 text-[11.5px] text-text-muted">arama genişletildi</span>
                )}
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

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-6">
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
