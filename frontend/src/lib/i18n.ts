/**
 * Interface language (Turkish / English).
 *
 * The Turkish sentence IS the key: `t("Filtreler")` returns "Filters" in
 * English and the same string in Turkish. That keeps the source readable, makes
 * the Turkish copy the single original (nothing to drift out of step with a
 * parallel Turkish table), and lets a test scan the source for every `t("...")`
 * literal and prove each has an English entry - see tests/i18n.test.ts.
 *
 * What is NOT translated, on purpose: place names, addresses and any other
 * text that comes from OpenStreetMap ("Umumi Tuvalet" stays "Umumi Tuvalet"),
 * and the search vocabulary - free-text search understands Turkish words, so
 * the search box says so instead of pretending otherwise.
 */

import { EN } from "./i18n-en";

export type Locale = "tr" | "en";
export type Vars = Record<string, string | number>;

/** New key (the old app had no language setting at all). */
export const LOCALE_STORAGE_KEY = "buradane:dil";

/** Turkish for any `tr*` tag; English for every other language. */
export function localeFromTag(tag: string | null | undefined): Locale {
  return tag && /^tr(\b|-|_|$)/i.test(tag.trim()) ? "tr" : "en";
}

/** Stored choice wins; otherwise the browser's first language decides. */
export function resolveLocale(stored: string | null, languages: readonly string[]): Locale {
  if (stored === "tr" || stored === "en") return stored;
  return localeFromTag(languages[0]);
}

/** First language of an Accept-Language header. No header means the app's
 * home language: a crawler or a script has no preference to honour. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return "tr";
  const first = header.split(",")[0]?.split(";")[0];
  return localeFromTag(first);
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Turkish keys pass through untouched; English looks the key up and falls
 * back to the Turkish text (never to an empty string). */
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const text = locale === "en" ? (EN[key] ?? key) : key;
  return fill(text, vars);
}

/** Digit grouping follows the language: 12.345 in Turkish, 12,345 in English. */
export function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(locale === "tr" ? "tr-TR" : "en-US");
}
