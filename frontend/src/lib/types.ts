/**
 * The place shape the app works with.
 *
 * This mirrors the FastAPI backend's `PlaceListItem` / `PlaceDetail` Pydantic
 * schemas (see backend/app/schemas/place.py) on purpose: the demo currently
 * reads from a real-OSM JSON snapshot through a local adapter, and swapping
 * that for the live backend is meant to be a base-URL change, not a rewrite.
 *
 * Amenity flags are `boolean | null`, never plain `boolean`. `null` means
 * "we don't know", which is a different claim from "no" and must render
 * differently - a toilet with no wheelchair data is not a toilet without
 * wheelchair access.
 */

import type { QueryNotice } from "./categories";

export type CategorySlug =
  | "tuvalet"
  | "park"
  | "su"
  | "dinlenme"
  | "cocuk-alani"
  | "spor"
  | "otopark"
  | "dus"
  | "wifi"
  // Türkiye-specific. See scripts/fetch_demo_data.py for why these earn a
  // place a general-purpose "find a toilet" app wouldn't have.
  | "cami"
  | "eczane"
  | "toplanma-alani"
  | "kutuphane"
  | "sarj";

export type PlaceStatus = "active" | "temporarily_closed" | "permanently_closed" | "pending_review";

export type PriceType = "free" | "paid" | "unknown";

/**
 * Who can actually use the place.
 *
 * `private` is not a public facility and never reaches a search result. The
 * middle two are usable under a condition a person can meet, so they are
 * labelled rather than hidden - "buy a tea, use the toilet" is how a large
 * share of Istanbul's usable toilets actually work, and dropping them would
 * throw away real answers.
 */
export type AccessType = "public" | "customers" | "permit" | "private";

export type AmenityKey =
  | "wheelchair_accessible"
  | "has_ramp"
  | "baby_changing"
  | "child_friendly"
  | "pet_friendly"
  | "has_drinking_water"
  | "has_wifi"
  | "has_shower"
  | "has_seating"
  | "has_shade"
  | "has_parking"
  | "is_quiet";

export type Amenities = Record<AmenityKey, boolean | null>;

export interface PlaceSource {
  slug: string;
  name: string;
  license: string;
  url: string;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  categories: CategorySlug[];
  status: PlaceStatus;
  price_type: PriceType;
  access: AccessType;
  address_line: string | null;
  opening_hours_raw: string | null;
  is_24h: boolean | null;
  website: string | null;
  phone: string | null;
  description: string | null;
  operator: string | null;
  amenities: Amenities;
  source: PlaceSource;
  /** Only present on radius ("yakınımda") queries, in meters. */
  distance_m?: number | null;
  /** 0..1, see backend/app/services/reliability.py for the real formula. */
  reliability_score: number;
  /** Human-readable freshness, e.g. "3 gün önce doğrulandı". */
  freshness_label: string;
  last_verified_at: string | null;
  verification_count: number;
  report_count: number;
  /** Full OSM tag bag. Present on detail responses, stripped from list
   * responses where it would roughly double the payload for no UI benefit. */
  raw_tags?: Record<string, string>;
}

/** "Yakın" is the default because it answers the product's actual question.
 * "Güvenilir" exists because open data quality is uneven - sometimes the
 * nearest record is a decade-old unverified node and the one 200m further is
 * the one that will actually be there. */
export type SortKey = "distance" | "reliability";

export interface PlaceQuery {
  sort?: SortKey;
  lat?: number;
  lon?: number;
  radius_m?: number;
  bbox?: [number, number, number, number]; // min_lon, min_lat, max_lon, max_lat
  categories?: CategorySlug[];
  amenities?: AmenityKey[];
  freeOnly?: boolean;
  openNow?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface PlaceQueryResult {
  places: Place[];
  total: number;
  /** Echoed back so the UI can explain *why* it returned what it returned. */
  applied: {
    categories: CategorySlug[];
    amenities: AmenityKey[];
    freeOnly: boolean;
    openNow: boolean;
    q: string | null;
    radius_m: number | null;
    /** True when the query had to be widened to return anything - the UI
     * tells the user results were broadened rather than silently changing
     * the meaning of what they asked for. */
    relaxed?: boolean;
    /** Questions the dataset structurally cannot answer, so the UI can say
     * so and point at the real source instead of returning a confident
     * wrong answer. See QUERY_NOTICES in categories.ts. */
    notices?: QueryNotice[];
    /** Exactly what was given up, so the UI can name it. Categories and the
     * free-only flag never appear here: those are never relaxed. */
    relaxedBy?: {
      /** Free text that matched no place name and was dropped. */
      needle?: string;
      /** Amenity filters dropped because our data has no evidence either
       * way - `null` means unknown and is excluded on purpose. */
      amenities?: AmenityKey[];
    };
  };
  /**
   * How many of the *full* result set each further filter would keep.
   *
   * Computed over every match, not the returned page - the page is capped at
   * 200 while a query routinely matches several hundred, so counting
   * client-side quietly under-reported every category. And it is what makes
   * a sparse filter honest: `baby_changing` is recorded for 57 places in the
   * whole country-scale snapshot, and a chip that says so before it is
   * tapped is a useful fact rather than a dead end discovered afterwards.
   */
  facets: {
    categories: Partial<Record<CategorySlug, number>>;
    amenities: Partial<Record<AmenityKey, number>>;
    freeOnly: number;
    /** Places NOT known to be closed - matches the filter's own semantics. */
    notClosed: number;
  };
}

/** A user-submitted signal. Kept separate from `Place` because these never
 * mutate the public record directly - they queue for moderation, exactly
 * like the backend's PlaceReport / PlaceSuggestion tables. */
export type ContributionKind =
  | "suggestion"
  | "report_incorrect"
  | "report_closed"
  /** "Hâlâ burada mı? Evet" - the cheapest, highest-volume signal a civic
   * dataset can collect, and the one that keeps open data from going stale.
   * Unlike the report kinds this applies immediately (see
   * contributions-store), matching the backend, which treats a positive
   * verification as low-risk and time-decays its weight. */
  | "verify_present";

export interface Contribution {
  id: string;
  kind: ContributionKind;
  placeId: string | null;
  placeName: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}
