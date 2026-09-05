"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The device's own connectivity flag.
 *
 * Treated as a *hint*, never as proof. `navigator.onLine` reports "online"
 * for a device on a captive portal or behind a router with no upstream, and
 * it does not flip at all under devtools network emulation - so on its own
 * it produced a banner that stayed invisible while the server was
 * demonstrably dead.
 *
 * The trustworthy signal is what actually happened to a request, which the
 * service worker reports per-response via `x-buradane-offline` (see
 * public/sw.js). `AppShell` combines the two: this hook catches the case
 * where the radio is off before any request is made, and the response header
 * catches everything else.
 *
 * An earlier version had the worker broadcast its status over postMessage.
 * That was abandoned: a service worker is terminated whenever it goes idle,
 * so the status lived in a variable that was routinely gone by the next page
 * load - exactly when the page needed it. A fact carried on the response
 * cannot go stale that way.
 *
 * `useSyncExternalStore` for the same reason as `useMediaQuery`: this is an
 * external store, and subscribing directly avoids the extra render an
 * effect-then-setState pass costs. The server snapshot is `true`, so SSR and
 * first paint agree and no banner flashes on load.
 */
export function useOnlineStatus(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    return () => {
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
    };
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
