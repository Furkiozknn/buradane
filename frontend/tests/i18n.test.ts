/**
 * The interface speaks Turkish and English. What these tests lock:
 *
 *  - which language a visitor gets (stored choice, then browser language);
 *  - that EVERY sentence the interface can show has an English entry, and that
 *    no English entry is orphaned - so a new `t("...")` without a translation
 *    fails here instead of shipping half-English screens;
 *  - that a translation keeps the same {placeholders} as its Turkish original,
 *    because a dropped {n} prints "{n}" at a user.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AMENITIES, CATEGORIES, EXTRA_FILTERS, NOTICE_CONTENT } from "@/lib/categories";
import { EN } from "@/lib/i18n-en";
import {
  formatNumber,
  localeFromAcceptLanguage,
  localeFromTag,
  resolveLocale,
  translate,
} from "@/lib/i18n";
import { bearingLabel } from "@/lib/geo";
import { humanizeOpeningHours, openStateLabel } from "@/lib/opening-hours";
import { REPORT_OPTIONS } from "@/components/ReportDialog";

const SRC = join(__dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Every `t("...")` literal in the user-facing code. The admin panel and the
 * /yer share page are Turkish-only on purpose (see docs/TASARIM.md). */
function scannedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    if (/[\\/](admin|yer)[\\/]|Admin|[\\/]i18n\.ts$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      keys.add(match[1].replace(/\\"/g, '"'));
    }
  }
  return keys;
}

/** Sentences that reach `t()` through a table or a function rather than a
 * literal, so the scan above cannot see them. */
function tableKeys(): Set<string> {
  const keys = new Set<string>();
  for (const c of CATEGORIES) {
    keys.add(c.label);
    keys.add(c.shortLabel);
  }
  for (const a of AMENITIES) {
    keys.add(a.label);
    keys.add(a.filterLabel);
  }
  for (const f of EXTRA_FILTERS) keys.add(f.label);
  for (const n of Object.values(NOTICE_CONTENT)) {
    keys.add(n.text);
    keys.add(n.linkLabel);
  }
  for (const o of REPORT_OPTIONS) keys.add(o.label);
  for (const state of ["open", "closed", "unknown"] as const) keys.add(openStateLabel(state));
  // Labels the data layer writes into records (places-repository, contributions-store).
  for (const label of ["Topluluk doğrulaması yok", "Bugün doğrulandı", "Topluluk tarafından eklendi"]) {
    keys.add(label);
  }
  keys.add("İsimsiz mekan"); // MapCanvas fallback name
  const meta = JSON.parse(readFileSync(join(__dirname, "..", "data", "meta.json"), "utf8")) as {
    attribution: string;
  };
  keys.add(meta.attribution);
  return keys;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Same word in both languages; a translation identical to the key is fine here.
const SAME_IN_BOTH = new Set(["Wi-Fi", "Park"]);

describe("which language a visitor gets", () => {
  it("any tr tag is Turkish, everything else English", () => {
    expect(localeFromTag("tr")).toBe("tr");
    expect(localeFromTag("tr-TR")).toBe("tr");
    expect(localeFromTag("TR")).toBe("tr");
    expect(localeFromTag("en-US")).toBe("en");
    expect(localeFromTag("de")).toBe("en");
    // "tr" must not match a language that merely starts with those letters.
    expect(localeFromTag("trk")).toBe("en");
    expect(localeFromTag(undefined)).toBe("en");
  });

  it("a stored choice outranks the browser language", () => {
    expect(resolveLocale("en", ["tr-TR"])).toBe("en");
    expect(resolveLocale("tr", ["en-US"])).toBe("tr");
    expect(resolveLocale(null, ["tr-TR", "en"])).toBe("tr");
    expect(resolveLocale(null, ["en-GB", "tr"])).toBe("en");
    // A corrupt stored value falls back to the browser, never to a crash.
    expect(resolveLocale("fr", ["tr"])).toBe("tr");
  });

  it("the server reads the first Accept-Language entry, defaulting to Turkish", () => {
    expect(localeFromAcceptLanguage("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,tr;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("tr");
    expect(localeFromAcceptLanguage("")).toBe("tr");
  });
});

describe("translate", () => {
  it("passes Turkish through and fills placeholders", () => {
    expect(translate("tr", "{n} kişi doğruladı", { n: 3 })).toBe("3 kişi doğruladı");
    expect(translate("en", "{n} kişi doğruladı", { n: 3 })).toBe("3 people confirmed this");
  });

  it("falls back to the Turkish text, never to an empty string", () => {
    expect(translate("en", "olmayan bir cümle")).toBe("olmayan bir cümle");
  });

  it("leaves an unknown placeholder visible instead of printing undefined", () => {
    expect(translate("tr", "{n} kayıt", {})).toBe("{n} kayıt");
  });

  it("groups digits the way each language writes them", () => {
    expect(formatNumber("tr", 167829)).toBe("167.829");
    expect(formatNumber("en", 167829)).toBe("167,829");
  });
});

describe("compass and opening hours follow the language", () => {
  it("names the direction in English on request and in Turkish by default", () => {
    expect(bearingLabel(0)).toBe("kuzey");
    expect(bearingLabel(0, "en")).toBe("north");
    expect(bearingLabel(225, "en")).toBe("southwest");
    expect(bearingLabel(225)).toBe("güneybatı");
  });

  it("keeps OSM's own day codes in English and the Turkish rendering unchanged", () => {
    expect(humanizeOpeningHours("Mo-Fr 09:00-18:00", "en")).toEqual(["Mo-Fr 09:00-18:00"]);
    expect(humanizeOpeningHours("Mo-Fr 09:00-18:00")).toEqual(["Pzt-Cum 09:00-18:00"]);
    expect(humanizeOpeningHours("24/7", "en")).toEqual(["Open 24 hours, every day"]);
    expect(humanizeOpeningHours("24/7")).toEqual(["Her gün 24 saat açık"]);
  });
});

describe("the English catalogue", () => {
  const used = new Set([...scannedKeys(), ...tableKeys()]);

  it("has an entry for every sentence the interface shows", () => {
    const missing = [...used].filter((key) => !(key in EN));
    expect(missing.join(" | "), "çevirisi olmayan cümleler").toBe("");
  });

  it("has no entry that nothing uses", () => {
    const orphan = Object.keys(EN).filter((key) => !used.has(key));
    expect(orphan.join(" | "), "kullanılmayan çeviriler").toBe("");
  });

  it("uses only the Turkish original's placeholders and drops none but {suffix}", () => {
    // {suffix} is the Turkish case ending (Antalya'ya, Izmir'e); English has
    // no use for it. Anything else missing would silently lose information,
    // anything extra would print as a literal "{...}".
    for (const [key, value] of Object.entries(EN)) {
      const tr = placeholders(key);
      const en = placeholders(value);
      expect(en.filter((name) => !tr.includes(name)), `${key}: fazla yer tutucu`).toEqual([]);
      expect(tr.filter((name) => !en.includes(name) && name !== "suffix"), `${key}: eksik yer tutucu`).toEqual([]);
    }
  });

  it("really translates (an English value equal to its Turkish key is a copy-paste slip)", () => {
    const same = Object.entries(EN)
      .filter(([key, value]) => key === value && !SAME_IN_BOTH.has(key))
      .map(([key]) => key);
    expect(same).toEqual([]);
  });

  it("contains no Turkish letters that only Turkish text has", () => {
    // A leftover Turkish word in an English sentence reads as a bug. Proper
    // nouns that legitimately carry them (Türkiye, İstanbul, OpenStreetMap
    // data) are the allow-list.
    const allowed = /Türkiye|İstanbul|e-Devlet|ücretsiz tuvalet/i;
    const leaked = Object.entries(EN)
      .filter(([, value]) => /[çğıöşüÇĞİÖŞÜ]/.test(value) && !allowed.test(value))
      .map(([key, value]) => `${key} → ${value}`);
    expect(leaked).toEqual([]);
  });
});
