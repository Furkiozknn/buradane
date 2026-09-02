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

export type CategorySlug =
  | "tuvalet"
  | "park"
  | "su"
  | "dinlenme"
  | "cocuk-alani"
  | "spor"
  | "otopark"
  | "dus"
  | "wifi";

export type PlaceStatus = "active" | "temporarily_closed" | "permanently_closed" | "pending_review";

export type PriceType = "free" | "paid" | "unknown";

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

export interface PlaceQuery {
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
    /** True when a free-text needle was dropped because it would have
     * returned nothing on its own - the UI tells the user results were
     * broadened rather than silently changing the meaning of their query. */
    relaxed?: boolean;
  };
}

/** A user-submitted signal. Kept separate from `Place` because these never
 * mutate the public record directly - they queue for moderation, exactly
 * like the backend's PlaceReport / PlaceSuggestion tables. */
export type ContributionKind = "suggestion" | "report_incorrect" | "report_closed";

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
