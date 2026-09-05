/**
 * The official il/ilçe reference, loaded from OSM admin boundaries.
 *
 * Server-only (fs): the client never needs the full 973-district table -
 * everything the browser shows arrives already resolved on Place records.
 * Keeping it out of administrative.ts is deliberate, because that module IS
 * shipped to the client (CityPicker uses it) and importing fs there would
 * break the bundle.
 *
 * Produced by scripts/fetch_admin_divisions.py. The app must keep working
 * when the file is absent (fresh clone before any fetch, or a stripped
 * deployment): every consumer falls back to the heuristic resolution in
 * administrative.ts, which is exactly what the app shipped with before this
 * file existed.
 */

import fs from "node:fs";
import path from "node:path";

import { foldAscii } from "./administrative";

export interface OfficialDistrict {
  /** Canonical display name as OSM's boundary relation spells it. */
  name: string;
  province: string;
  center: { lat: number; lon: number };
}

interface RawDivisions {
  generated_at: string;
  counts: { provinces: number; districts: number };
  provinces: {
    name: string;
    center: { lat: number; lon: number };
    districts: { name: string; center: { lat: number; lon: number } }[];
  }[];
}

let cache:
  | {
      districtsByKey: Map<string, OfficialDistrict>;
      provinces: { name: string; center: { lat: number; lon: number } }[];
      counts: { provinces: number; districts: number };
    }
  | null
  | undefined;

function load() {
  if (cache !== undefined) return cache;

  const file = path.join(process.cwd(), "data", "admin-divisions.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as RawDivisions;
    const districtsByKey = new Map<string, OfficialDistrict>();
    for (const province of raw.provinces) {
      for (const district of province.districts) {
        const key = foldAscii(district.name);
        // A district name can repeat across provinces (Merkez everywhere,
        // Eğirdir vs similar folds). First writer wins is NOT acceptable
        // for lookups that ignore the province, so ambiguous keys are
        // marked by storing a null-province sentinel: name resolution still
        // canonicalises the spelling, but never invents which province an
        // ambiguous bare name belongs to.
        const existing = districtsByKey.get(key);
        if (existing && existing.province !== province.name) {
          districtsByKey.set(key, { ...existing, province: "" });
        } else if (!existing) {
          districtsByKey.set(key, {
            name: district.name,
            province: province.name,
            center: district.center,
          });
        }
      }
    }
    cache = {
      districtsByKey,
      provinces: raw.provinces.map((p) => ({ name: p.name, center: p.center })),
      counts: raw.counts,
    };
  } catch {
    // Absent or unreadable: consumers fall back to heuristics. Cached as
    // null so a missing file is one failed stat, not one per request.
    cache = null;
  }
  return cache;
}

/**
 * Canonical spelling and (when unambiguous) province for a district name,
 * from the official list. Null when the list is absent or the name is not
 * an official district - the caller's heuristic then stands.
 */
export function officialDistrict(rawName: string): OfficialDistrict | null {
  const data = load();
  if (!data) return null;
  const hit = data.districtsByKey.get(foldAscii(rawName));
  if (!hit) return null;
  return { ...hit, province: hit.province || "" };
}

/** Totals for coverage display and tests; null when the file is absent. */
export function divisionCounts(): { provinces: number; districts: number } | null {
  return load()?.counts ?? null;
}

export function officialProvinces(): { name: string; center: { lat: number; lon: number } }[] {
  return load()?.provinces ?? [];
}
