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

import { AMENITY_BY_KEY, NOTICE_CONTENT, categoryMeta } from "@/lib/categories";
import { CategoryChips, CategoryGrid } from "./CategoryPicker";
import { PlaceCard, PlaceCardSkeleton } from "./PlaceCard";
import { PlaceDetail } from "./PlaceDetail";
import { EMPTY_FILTERS, FilterSheet, activeFilterCount, type FilterState } from "./FilterSheet";
import { SuggestPlaceDialog } from "./SuggestPlaceDialog";
import { CityPicker } from "./CityPicker";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { buildUrlSearch, type UrlState } from "@/lib/url-state";
import { formatDistance, haversineMeters } from "@/lib/geo";
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

/** Only used before any city data has loaded. Every real city's centre is
 * derived from that city's own places (see `medianCenter` in
 * places-repository) - a hand-maintained table meant a city whose centre
 * nobody remembered to add silently opened on İstanbul, which made "adding a
 * city is a config row plus a fetch run" not quite true. */
const FALLBACK_CENTER = { lat: 41.0082, lon: 28.9784 };

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

/**
 * Turkish dative suffix for a place name: Antalya'YA, İzmir'E, Bolu'YA.
 *
 * Hardcoding "'a" produced "Antalya'a git" and "İzmir'a git" for 48 of the
 * 81 provinces - the first thing a native speaker notices. Vowel harmony
 * picks a/e from the last vowel, and a name ending in a vowel takes a "y"
 * buffer. The location chip above avoids suffixes entirely for the same
 * reason; here the sentence needs one.
 */
function dativeSuffix(name: string): string {
  const vowels = [...name.toLocaleLowerCase("tr-TR")].filter((c) => "aeıioöuü".includes(c));
  const last = vowels[vowels.length - 1] ?? "a";
  const back = "aıou".includes(last);
  const endsWithVowel = "aeıioöuü".includes(name.slice(-1).toLocaleLowerCase("tr-TR"));
  return `${endsWithVowel ? "y" : ""}${back ? "a" : "e"}`;
}

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
    cities: { slug: string; label: string; count: number; center: { lat: number; lon: number } }[];
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
  // A shared link's coordinates decide the city, not the default.
  //
  // MapCanvas honours the URL's y/x/z, so without this the map flew to the
  // shared place while the QUERY origin stayed on the hardcoded default:
  // opening a Sivas link showed a Sivas map with an İstanbul list reading
  // "en yakın 42 m", and the first filter tap then answered with Sivas
  // places labelled "694 km · yürüyerek 9259 dk". A UX audit found this as
  // the third path of a bug whose other two paths (the city picker and the
  // locate button) were already fixed - it is the same class, and this is
  // the path a launch's traffic actually arrives on.
  //
  // Falls back to the pilot city, not to whichever file sorts first
  // alphabetically (which quietly made Ankara the default the moment it was
  // added), then to the largest dataset if İstanbul is ever dropped.
  const [activeCity, setActiveCity] = useState<string>(() => {
    const cities = datasetMeta.cities;
    const shared = initial?.center;
    if (shared) {
      let best: { slug: string; d: number } | null = null;
      for (const city of cities) {
        const d = haversineMeters(shared, city.center);
        if (!best || d < best.d) best = { slug: city.slug, d };
      }
      if (best) return best.slug;
    }
    if (cities.some((c) => c.slug === "istanbul")) return "istanbul";
    return [...cities].sort((a, b) => b.count - a.count)[0]?.slug ?? "istanbul";
  });
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  /**
   * Whether the map follows the device or a chosen city.
   *
   * Before this existed, granting location permission removed the city
   * switcher entirely - the chip that opens it only appeared when we had
   * *failed* to locate someone. So the moment the app worked as intended,
   * looking at another city became impossible short of panning there, which
   * across nine cities is not a real option. Planning a trip is an ordinary
   * reason to open a civic map.
   */
  // A shared link is an explicit "show me here", which outranks the device
  // until the user taps the locate button - otherwise a granted permission
  // would silently drag them away from the place someone sent them.
  const [followUser, setFollowUser] = useState(() => !initial?.center);

  // An explicit "take me here". The nonce is what makes re-picking the city
  // you already have selected work after you have panned away from it.
  const [mapFocus, setMapFocus] = useState<{
    center: { lat: number; lon: number };
    zoom: number;
    nonce: number;
  } | null>(null);
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

  const cityCenter =
    datasetMeta.cities.find((c) => c.slug === activeCity)?.center ?? FALLBACK_CENTER;
  const followingUser = followUser && location.status === "granted";
  // A shared link's own coordinates win over the city centre until the user
  // moves somewhere else: a link to a village must answer from the village,
  // not from 60 km away at the provincial capital.
  const [sharedCenter, setSharedCenter] = useState(() => initial?.center ?? null);
  const center = followingUser ? { lat: location.lat, lon: location.lon } : (sharedCenter ?? cityCenter);
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
        if (!response.ok) {
          // Prefer the server's own sentence. The API says useful, actionable
          // things ("Arama alanı çok geniş, biraz yakınlaşın") that a generic
          // "Sunucu 400 döndü" would throw away, leaving the user with a dead
          // end instead of an instruction.
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Sunucu ${response.status} döndü`);
        }
        const data = (await response.json()) as PlaceQueryResult;
        // A slower earlier request must never overwrite a newer result.
        if (requestId !== requestIdRef.current) return;
        setServedFromCache(wasOffline);
        setResult(data);
        setStaleViewport(false);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        // Only a genuine network failure means "nothing answered". An HTTP
        // error DID answer - flagging it as offline put a "Çevrimdışısınız"
        // banner on a working connection and hid the server's actual
        // explanation behind it.
        const networkFailure = err instanceof TypeError;
        if (networkFailure) setServedFromCache(true);
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
  //    button is for); only a filter/search/location/CENTRE change re-fetches.
  //
  // `centerKey` earns its place in that list the hard way. Without it, the
  // query origin never followed the map: picking Sivas flew the camera and
  // relabelled the chip while the list still held İstanbul's results, the
  // header still read "en yakın 33 m", and every card offered a walking time
  // to a bench 900 km away. A UX audit reproduced it three ways (city
  // picker, first location fix, shared link). Both handlers that move the
  // centre already null the viewport, so this re-queries around the new
  // origin rather than re-running the old city's bbox.
  //  - set-state-in-effect: fetchPlaces sets loading/error synchronously.
  //    That's the point - this effect synchronises with an external system
  //    (the API), and the actual hazard it warns about, a stale response
  //    overwriting a newer one, is handled by the request-id guard inside
  //    fetchPlaces.
  // Rounded to ~11 m so GPS jitter cannot re-query on every fix while the
  // user stands still; a city change or a real move always clears it.
  const centerKey = `${center.lat.toFixed(4)},${center.lon.toFixed(4)}`;

  useEffect(() => {
    const bbox = viewport?.bbox;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPlaces(bbox ? { bbox } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, filters, query, sort, location.status, centerKey]);

  // The first location fix flies the camera. The locate button only calls
  // setMapFocus when a fix ALREADY exists, so the very first tap - the one
  // that asks for permission - moved nothing: the user granted access, the
  // header updated, and the map sat on İstanbul until they tapped a second
  // time with no indication that they should. Fires once per fix, only
  // while following the user, so browsing another city is never yanked back.
  const flownToFixRef = useRef(false);
  useEffect(() => {
    if (location.status !== "granted" || !followUser) {
      if (location.status !== "granted") flownToFixRef.current = false;
      return;
    }
    if (flownToFixRef.current) return;
    flownToFixRef.current = true;
    setViewport(null);
    setStaleViewport(false);
    setMapFocus({ center: { lat: location.lat, lon: location.lon }, zoom: 15, nonce: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.status, followUser]);

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
  // Counts come from the server's facets, which are computed over the whole
  // match set. Counting the loaded page here under-reported every category
  // by whatever the 200-item cap cut off - on a 480-result query that was
  // more than half the map.
  //
  // The exception is the favourites view, which is a client-side filter over
  // a list the server never sees (the saved ids never leave the device), so
  // there its counts have to be derived here.
  const counts = useMemo(() => {
    if (!showFavoritesOnly) return (result?.facets.categories ?? {}) as Record<string, number>;
    const map: Record<string, number> = {};
    for (const place of places) {
      for (const slug of place.categories) map[slug] = (map[slug] ?? 0) + 1;
    }
    return map;
  }, [result, places, showFavoritesOnly]);

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

  const cityOptions = datasetMeta.cities;

  /** The city closest to the device, when we have a fix. With nine cities
   * and counting, "which one am I in?" stops being obvious from a list. */
  const nearestCity = useMemo(() => {
    if (location.status !== "granted") return null;
    let best: { slug: string; d: number } | null = null;
    for (const city of datasetMeta.cities) {
      const d = haversineMeters({ lat: location.lat, lon: location.lon }, city.center);
      if (!best || d < best.d) best = { slug: city.slug, d };
    }
    return best?.slug ?? null;
  }, [location, datasetMeta.cities]);
  const activeCityLabel =
    datasetMeta.cities.find((c) => c.slug === activeCity)?.label ?? "İstanbul";

  /** The province name the search engine threw away, when it threw away a
   * province name and that province is not the one we are already showing.
   * Folded comparison so "hakkari" matches "Hakkâri" - the same rule the
   * city picker's filter uses, for the same keyboard-layout reason. */
  /**
   * The place the search gave up on, when the word it dropped names one.
   *
   * Resolved by the server against the 81 provinces AND the 973 districts.
   * Matching province labels here on the client covered "Antalya eczane"
   * and missed "Alanya tuvalet", "Kadıköy tuvalet", "Çeşme park" - the
   * names people actually type - which came back as local results with
   * nothing but 11,5 px of grey text admitting the word was ignored.
   */
  const droppedPlace = useMemo(() => {
    const hint = result?.applied.relaxedBy?.needleLocation;
    if (!hint) return null;
    const activeLabel = datasetMeta.cities.find((c) => c.slug === activeCity)?.label;
    // Already looking there: nothing to offer.
    if (hint.label === activeLabel) return null;
    return hint;
  }, [result?.applied.relaxedBy?.needleLocation, datasetMeta.cities, activeCity]);

  const filterCount = activeFilterCount(filters);
  // Kept apart because the empty state has to name the right culprit. Typing
  // a name that is not in the snapshot used to be reported as "Filtrelere
  // uyan yer yok - seçtiğin filtreleri gevşetmeyi dene", to a user who had
  // set no filters at all, with a "Filtreleri temizle" button. Telling
  // someone to undo something they never did is a dead end dressed as help.
  const hasStructuralFilter = filterCount > 0 || category !== null;
  const searchText = query.trim();
  const hasAnyFilter = hasStructuralFilter || searchText.length > 0;

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
        flyTo={mapFocus}
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
        {/* Always present, in every location state.
            It used to appear only when locating had FAILED, which meant the
            city switcher vanished the moment the app worked as intended -
            and a control that comes and goes with permission state also
            shifted everything below it. Its label states which of the two
            things the map is actually centred on, since "near me" and
            "showing Ankara" produce very different result lists. */}
        {/* mt-3, not mt-2: at mt-2 this row clipped the bottom of the 48px
            filter button above it, leaving it only ~6px of free space and
            failing the touch-target spacing check. */}
        {/* The right gutter is the map's zoom controls, which float at the
            edge of the map and are NOT part of this row. Without it the chip,
            being centred and sized to its content, grew under them: measured
            at 360x800 with the longest province name in the country, "Konum
            sorulmadı — Afyonkarahisar · değiştir" ran to x=332 while the "+"
            button starts at x=306, and the chip painted straight over it. The
            zoom-in control was not merely clipped, it was unreachable.
            Desktop keeps its natural centring - the whole top bar lives in
            the 416 px sidebar there and never reaches the map controls. */}
        {/* pointer-events stay OFF on this row and go on the button alone.
            The row is a full-width centring box, so it still lies across the
            zoom controls even after the padding above pulls the chip off
            them - and with pointer-events on, it swallowed the tap while
            painting nothing. Measured: elementsFromPoint at the "+" button's
            own centre returned this div on top. A control that looks
            reachable and is not is worse than one that looks blocked. */}
        <div
          className="pointer-events-none mx-auto mt-3 flex max-w-2xl justify-center"
          style={isDesktop ? undefined : { paddingRight: 56 }}
        >
          {/* Tappable: when we can't locate someone, "pick your city" is a
              far better recovery than a blank map or a re-prompt the browser
              will silently swallow - and when we can, it is how you go look
              somewhere else. */}
          <button
            type="button"
            onClick={() => setCityPickerOpen(true)}
            className="pointer-events-auto flex min-h-11 max-w-full items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1 text-[12px] font-medium text-text-secondary shadow-sm transition-colors hover:bg-surface"
          >
            <MapPin size={12} aria-hidden className="shrink-0" />
            {/* Three genuinely different situations, said differently.
                "Yaklaşık konum" is a confession that we could not locate the
                user, so it must not appear when we know exactly where they
                are and they simply chose to look at another city. That case
                gets the bare city name - the pin icon already says what it
                means, and naming it any harder would drag in Turkish case
                suffixes that differ per city (Ankara'ya, İzmir'e, Bursa'ya).

                Truncating, and it is this half that gives way: on a narrow
                screen the province name is also readable from the map, while
                "değiştir" is the only way out of a wrong city and must stay
                whole and tappable. */}
            <span className="min-w-0 truncate">
              {followingUser
                ? "Konumundasın"
                : location.status === "granted"
                  ? activeCityLabel
                  : location.status === "denied"
                    ? `Konum kapalı — ${activeCityLabel}`
                    : // "Yaklaşık konum" claimed we had approximated where the
                      // user is. We had not: nothing has asked the browser yet,
                      // and the city is a hardcoded default, which for 80 of 81
                      // provinces points 500-1400 km away. Say what is true.
                      `Konum sorulmadı — ${activeCityLabel}`}
            </span>
            <span className="shrink-0 text-brand">
              &middot; {followingUser ? "şehir seç" : "değiştir"}
            </span>
          </button>
        </div>
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
            // The location chip is always present now, so this no longer
            // has to branch on whether it is showing.
            top: isDesktop ? "1.25rem" : "8rem",
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
        onClick={() => {
          // Doubles as "back to me" once the user has gone off to browse
          // another city, which is why it re-centres even when we already
          // have a fix.
          setFollowUser(true);
          setSharedCenter(null);
          if (location.status === "granted") {
            setViewport(null);
            setStaleViewport(false);
            setMapFocus({ center: { lat: location.lat, lon: location.lon }, zoom: 15, nonce: Date.now() });
          } else {
            requestLocation();
          }
        }}
        className="absolute right-3 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface shadow transition-transform"
        style={{
          bottom: isDesktop
            ? "calc(1.5rem + env(safe-area-inset-bottom))"
            : `calc(${SNAP_HEIGHT[snap]} + 12px)`,
        }}
        aria-label={followingUser ? "Konumumu yeniden ortala" : "Konumuma dön"}
      >
        <LocateFixed
          size={20}
          className={location.status === "locating" ? "animate-spin" : ""}
          style={{ color: followingUser ? "var(--location)" : "var(--text-secondary)" }}
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
            ? { top: 118 }
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
              {/* Some questions have a correct answer that open geodata
                  structurally does not hold. Returning every pharmacy in the
                  city for "nöbetçi eczane" is not a partial answer, it is a
                  wrong one - so the app says so and points at the roster
                  that is actually authoritative. */}
              {result?.applied.notices?.map((notice) => {
                const content = NOTICE_CONTENT[notice];
                if (!content) return null;
                return (
                  <div
                    key={notice}
                    className="mx-4 mb-1 mt-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed"
                    style={{ background: "var(--warning-soft)", color: "var(--text)" }}
                  >
                    {content.text}{" "}
                    <a
                      href={content.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline underline-offset-2"
                      style={{ color: "var(--text)" }}
                    >
                      {content.linkLabel}
                    </a>
                  </div>
                );
              })}

              {/* A dropped LOCATION word is categorically different from a
                  dropped descriptive one. "sivas tuvalet" on an İstanbul map
                  returned 75 confident İstanbul results with `"sivas"
                  aranmadı` in 11,5 px muted text next to them - the reader
                  had no reason to doubt an answer that looked complete. If
                  the word we threw away names a province we cover, say so
                  where it cannot be missed and offer the one action that
                  actually answers the question. */}
              {droppedPlace && !loading && (
                <div
                  className="mx-4 mb-1 mt-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed"
                  style={{ background: "var(--warning-soft)", color: "var(--text)" }}
                  role="status"
                >
                  Sonuçlar <strong>{activeCityLabel}</strong> çevresinden.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      // Move to the resolved coordinates, and set the city to
                      // the province that contains them so the chip, the
                      // picker and the query origin all agree.
                      const province = cityOptions.find((c) => c.label === droppedPlace.province);
                      if (province) setActiveCity(province.slug);
                      setFollowUser(false);
                      setSharedCenter(droppedPlace.center);
                      setViewport(null);
                      setStaleViewport(false);
                      setMapFocus({ center: droppedPlace.center, zoom: 12.5, nonce: Date.now() });
                    }}
                    className="font-semibold underline underline-offset-2"
                  >
                    {droppedPlace.label}
                    {droppedPlace.province !== droppedPlace.label ? ` (${droppedPlace.province})` : ""}
                    &apos;{dativeSuffix(droppedPlace.label)} git
                  </button>
                </div>
              )}

              {/* The grid is a desktop affordance. It shipped in the first
                  commit, when the sheet showed it at every snap above peek
                  and the category set was smaller. With 14 categories it is
                  three columns by five rows - about 506 px - and the mobile
                  sheet is 439 px at "half" and 708 px at "full". Measured on
                  a 390x844 screen it did not fit either one: at "half" it was
                  cut off, and at "full" the first result card started 14 px
                  below the fold. Expanding the sheet therefore showed FEWER
                  results than the collapsed state, which shows one. The
                  gesture means "show me the list"; it was answering with a
                  category picker.

                  The chips carry the same information - icon, name, count -
                  in a row that scrolls, which is what peek already used and
                  what the list needs the space for. The sidebar keeps the
                  grid: five columns there is three rows, and it sits beside
                  the results rather than on top of them. */}
              {category === null && isDesktop ? (
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
                <p className="min-w-0 truncate text-[13px] font-medium text-text-secondary" aria-live="polite">
                  {loading
                    ? "Yakındakiler aranıyor…"
                    : error
                      ? "Sonuçlar getirilemedi"
                      : // The count is the whole match set but the list holds
                        // at most `limit`, and saying only "47.319 sonuç"
                        // over 200 cards is a 236x disagreement the reader
                        // cannot see. formatDistance, not raw metres: the
                        // header used to read "en yakın 692778 m".
                        //
                        // Phrased as a sentence rather than "200 / 722": the
                        // slash reads as a page indicator or a fraction, and
                        // the first number is neither - it is how many of the
                        // matches are in the list. Same fact, same honesty,
                        // no decoding.
                        `${
                          result && result.total > places.length
                            ? `${result.total.toLocaleString("tr-TR")} sonuçtan ${places.length}'i`
                            : `${(result?.total ?? 0).toLocaleString("tr-TR")} sonuç`
                        }${
                          places[0]?.distance_m != null
                            ? ` · en yakın ${formatDistance(places[0].distance_m)}`
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
                  className="flex min-h-11 shrink-0 items-center gap-1 px-1 text-[12.5px] font-medium text-text-secondary"
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
                    className="min-h-11 shrink-0 px-1 text-[12.5px] font-medium text-brand"
                  >
                    Temizle
                  </button>
                )}
              </div>

              {/* ODbL attribution, in the sheet's always-rendered header.
                  It used to live after the last of up to 200 cards and only
                  inside the `places.length > 0` branch, which on a phone put
                  it ~22.000 px down the scroll and removed it entirely from
                  every empty and error state - while MapLibre's own control
                  sits behind the sheet at all snap heights. The licence
                  requires it to be reasonably visible, so it is now on
                  screen whatever the result set does. */}
              <p className="truncate px-4 pb-2 text-[11px] text-text-muted">
                {datasetMeta.attribution} · {datasetMeta.count.toLocaleString("tr-TR")} kayıt · ODbL
              </p>
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
                  // The server's own sentence, which fetchPlaces already went
                  // to the trouble of extracting and which this component
                  // then threw away for a generic one. The API says useful
                  // things - "Arama alanı çok geniş, biraz yakınlaşın" - and
                  // a user who instead reads "Sonuçları getiremedik" plus a
                  // retry button will press it forever.
                  body={error}
                  actionLabel="Tekrar dene"
                  onAction={() => fetchPlaces(viewport ? { bbox: viewport.bbox } : {})}
                />
              ) : places.length === 0 ? (
                filterCount > 0 ? (
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
                ) : category !== null ? (
                  // A category on its own, with nothing behind it. "Relax
                  // your filters" is not advice here - a category is not a
                  // dial you can loosen - and "pan the map" is often not
                  // either: measured on the shipped snapshot, three
                  // provinces (Iğdır, Kırıkkale, Kırşehir) have ZERO mapped
                  // public toilets and fourteen more have one to three. In
                  // those places panning is a promise the data cannot keep,
                  // and a user who pans and still sees nothing concludes the
                  // app is broken rather than that the map has a gap.
                  //
                  // So the primary action becomes the one that can actually
                  // change the outcome: adding the place they know is there.
                  <EmptyState
                    title={`Bu alanda kayıtlı ${categoryMeta(category).label.toLocaleLowerCase("tr-TR")} yok`}
                    body="Bu, çevrede öyle bir yer olmadığı anlamına gelmez — OpenStreetMap'te henüz kayıtlı değil demek. Bildiğin bir yer varsa ekleyebilirsin."
                    actionLabel="Yer öner"
                    onAction={() => setSuggestOpen(true)}
                    secondaryLabel="Tüm kategoriler"
                    onSecondary={() => setCategory(null)}
                  />
                ) : searchText ? (
                  // A name the snapshot does not carry. Most Turkish POIs in
                  // OSM are unnamed, so this is a common and honest outcome -
                  // but it is not a filter problem, and the fix on offer must
                  // be the one that applies. Quoting what they typed also
                  // catches the everyday cause: a typo they can now see.
                  <EmptyState
                    title={`"${searchText.slice(0, 40)}" için sonuç yok`}
                    body="Bu ad çevredeki kayıtlarda geçmiyor. Yazımı kontrol edebilir ya da ne aradığını yazabilirsin — örneğin “tuvalet”, “eczane”, “park”."
                    actionLabel="Aramayı temizle"
                    onAction={() => setSearchInput("")}
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
          facets={result?.facets ?? null}
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
          nearestCity={nearestCity}
          onSelect={(city, district) => {
            setActiveCity(city.slug);
            // The shared link's coordinates stop being the query origin the
            // moment the user names somewhere else - otherwise picking a
            // city would move the map and leave the results where the link
            // pointed, which is the bug this pair of states exists to fix.
            setSharedCenter(null);
            setCityPickerOpen(false);
            // Choosing a city means "show me there", which outranks a device
            // fix until the user taps the locate button again.
            setFollowUser(false);
            // Selecting a city is an explicit "take me here", so the map
            // jumps rather than waiting for the next viewport query. This
            // used to only clear the app's viewport state, which moved the
            // list and the label while the map itself stayed on the old
            // city - MapLibre reads `initialView` exactly once.
            setViewport(null);
            setStaleViewport(false);
            // An ilçe is a much smaller thing than an il, so it opens
            // closer: at 12.5 a district fills a fraction of the screen and
            // the user has to zoom in before the pins mean anything.
            if (district) {
              setSharedCenter(district.center);
              setMapFocus({ center: district.center, zoom: 14, nonce: Date.now() });
            } else {
              setMapFocus({ center: city.center, zoom: 12.5, nonce: Date.now() });
            }
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
