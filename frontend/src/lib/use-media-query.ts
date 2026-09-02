"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Viewport branch as state rather than pure CSS.
 *
 * The map/sheet layout isn't a styling difference - on mobile the sheet is a
 * bottom sheet with drag snap points, on desktop it is a fixed sidebar with
 * no snap concept at all, and the map's `padding` (which decides what stays
 * visible behind the panel) has to follow whichever one is showing. Those
 * can't be expressed as a media query over the same DOM without the inline
 * height fighting the breakpoint.
 *
 * `useSyncExternalStore` rather than useState+useEffect: matchMedia *is* an
 * external store, and this is the API that subscribes to one without the
 * cascading extra render an effect-then-setState pass causes. Its server
 * snapshot returns false, so SSR markup and first client paint always agree
 * (mobile-first) and there is no hydration mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Sidebar layout threshold. Below this the bottom sheet is the right model;
 * at and above it there is room for a permanent panel beside the map. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
