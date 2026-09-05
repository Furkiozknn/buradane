"use client";

import { useEffect } from "react";

/**
 * Registers the offline layer.
 *
 * Production only, on purpose: a service worker in front of the dev server
 * intercepts HMR and turns "I changed a file" into "why is the old build
 * still showing", which costs more debugging time than the offline testing
 * it enables. Verify it with `npm run build && npm run start`.
 *
 * Registration is deferred to `load` so it never competes with the first
 * paint or the map's initial tile burst for bandwidth - the app must be
 * usable *now*; being usable offline is next week's problem.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration costs the offline layer and nothing else -
        // every code path above still works against the network. Silently
        // degrading is the correct behaviour; a console error here would
        // just be noise on browsers that block SW in private mode.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
