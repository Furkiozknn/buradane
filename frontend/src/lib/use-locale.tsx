"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  LOCALE_STORAGE_KEY,
  formatNumber,
  resolveLocale,
  translate,
  type Locale,
  type Vars,
} from "./i18n";

/**
 * The chosen language, kept in localStorage.
 *
 * An external store rather than useState+useEffect for the same reason as
 * use-favorites.ts: localStorage is external state. The server render (and the
 * first client paint, which must match it) uses the language the server
 * derived from Accept-Language; the real preference takes over right after
 * hydration, so there is no mismatch error - at worst a one-frame flash for a
 * visitor whose stored choice differs from their header.
 */

let memoryChoice: Locale | null = null; // storage blocked: still holds for this session
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return resolveLocale(memoryChoice ?? readStored(), languages);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setLocale(next: Locale) {
  memoryChoice = next;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // Blocked storage: the in-memory choice above still applies.
  }
  for (const listener of listeners) listener();
}

interface I18n {
  locale: Locale;
  t: (key: string, vars?: Vars) => string;
  /** Locale-aware digit grouping. */
  num: (value: number) => string;
  setLocale: (next: Locale) => void;
}

const Fallback: I18n = {
  locale: "tr",
  t: (key, vars) => translate("tr", key, vars),
  num: (value) => formatNumber("tr", value),
  setLocale,
};

const Context = createContext<I18n>(Fallback);

export function LocaleProvider({ initial, children }: { initial: Locale; children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, () => initial);

  // The root layout is a server component and cannot know the language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18n>(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
      num: (n) => formatNumber(locale, n),
      setLocale,
    }),
    [locale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useT(): I18n {
  return useContext(Context);
}
