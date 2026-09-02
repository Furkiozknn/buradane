"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Saved places, kept in localStorage.
 *
 * Deliberately device-local and account-free: the product's privacy stance is
 * that discovery and contribution both work without signing in, and a list of
 * the toilets and showers someone relies on is exactly the kind of data that
 * should not sit on a server tied to an identity. The trade-off (no sync
 * across devices) is the honest cost of that, and is stated in the UI.
 *
 * Implemented as a tiny external store rather than useState+useEffect:
 * localStorage *is* external state, and `useSyncExternalStore` is the API for
 * it. The cached snapshot matters - parsing the JSON on every read would hand
 * React a new array identity each time and spin forever.
 */

const STORAGE_KEY = "buradane:favorites:v1";

let cache: string[] = [];
let cacheLoaded = false;
const listeners = new Set<() => void>();

function readFromStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Private mode, blocked storage, or corrupt contents - a broken favorites
    // list must never take the app down with it.
    return [];
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab is the same user - keep the two in step.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = readFromStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string[] {
  if (!cacheLoaded) {
    cache = readFromStorage();
    cacheLoaded = true;
  }
  return cache;
}

const EMPTY: string[] = [];
/** Server render has no storage; returning a stable empty array keeps SSR
 * markup and the first client paint identical. */
function getServerSnapshot(): string[] {
  return EMPTY;
}

export function useFavorites() {
  const ids = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((placeId: string) => {
    const current = getSnapshot();
    cache = current.includes(placeId)
      ? current.filter((id) => id !== placeId)
      : [...current, placeId];
    cacheLoaded = true;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // Storage full or blocked: the in-memory list still works for this
      // session, which is better than refusing the interaction.
    }
    emit();
  }, []);

  const isFavorite = useCallback((placeId: string) => ids.includes(placeId), [ids]);

  return { favoriteIds: ids, toggle, isFavorite, count: ids.length };
}
