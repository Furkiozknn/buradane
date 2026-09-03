/**
 * Category + amenity metadata: the single source of truth for Turkish labels,
 * colors and icons across the map, chips, cards and detail page.
 *
 * Colors are chosen to stay distinguishable at marker size while sharing one
 * saturation/lightness band, so a dense map reads as a coherent product
 * rather than confetti. Each has a `pin` (marker fill) and `tint` (chip /
 * badge background) role.
 */

import {
  Accessibility,
  Baby,
  Bike,
  BookOpen,
  Car,
  Cross,
  Dog,
  Droplet,
  Dumbbell,
  Armchair,
  Landmark,
  PlugZap,
  ShowerHead,
  Siren,
  ToyBrick,
  Trees,
  Volume2,
  Wifi,
  Toilet,
  TreePalm,
  Clock,
  BadgeTurkishLira,
  type LucideIcon,
} from "lucide-react";

import type { AmenityKey, CategorySlug } from "./types";

export interface CategoryMeta {
  slug: CategorySlug;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** Marker fill + primary accent for this category. */
  pin: string;
  /** Low-saturation background for chips/badges. */
  tint: string;
  /** Text color that passes contrast on `tint`. */
  onTint: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    slug: "tuvalet",
    label: "Tuvalet",
    shortLabel: "Tuvalet",
    icon: Toilet,
    pin: "#4C5FD7",
    tint: "#E4E7FA",
    onTint: "#22307E",
  },
  {
    slug: "park",
    label: "Park",
    shortLabel: "Park",
    icon: Trees,
    pin: "#2F8F4E",
    tint: "#DEF2E4",
    onTint: "#17452A",
  },
  {
    slug: "su",
    label: "İçme Suyu",
    shortLabel: "Su",
    icon: Droplet,
    pin: "#0891B2",
    tint: "#CFFAFE",
    onTint: "#164E63",
  },
  {
    slug: "dinlenme",
    label: "Dinlenme Alanı",
    shortLabel: "Dinlenme",
    icon: Armchair,
    pin: "#9A6B2F",
    tint: "#F5EAD8",
    onTint: "#553818",
  },
  {
    slug: "cocuk-alani",
    label: "Çocuk Alanı",
    shortLabel: "Çocuk",
    icon: ToyBrick,
    pin: "#D6446E",
    tint: "#FBE3EA",
    onTint: "#7A1F38",
  },
  {
    slug: "spor",
    label: "Spor Alanı",
    shortLabel: "Spor",
    icon: Dumbbell,
    pin: "#E2662A",
    tint: "#FBE8DC",
    onTint: "#78330F",
  },
  {
    slug: "otopark",
    label: "Otopark",
    shortLabel: "Otopark",
    icon: Car,
    pin: "#5B6B7C",
    tint: "#E4E9ED",
    onTint: "#2B3742",
  },
  {
    slug: "dus",
    label: "Duş",
    shortLabel: "Duş",
    icon: ShowerHead,
    pin: "#0E9384",
    tint: "#D6F1EC",
    onTint: "#0A4A43",
  },
  {
    slug: "wifi",
    label: "Ücretsiz Wi-Fi",
    shortLabel: "Wi-Fi",
    icon: Wifi,
    pin: "#8B54D9",
    tint: "#EDE2FA",
    onTint: "#4A2278",
  },
  // --- Türkiye-specific -------------------------------------------------
  {
    slug: "cami",
    label: "Cami",
    shortLabel: "Cami",
    icon: Landmark,
    pin: "#6D4C7D",
    tint: "#EDE6F1",
    onTint: "#3B2745",
  },
  {
    slug: "eczane",
    label: "Eczane",
    shortLabel: "Eczane",
    icon: Cross,
    // Red is the pharmacy convention in Turkey; using anything else here
    // would fight what people already recognise on the street.
    pin: "#B91C1C",
    tint: "#FBE3E3",
    onTint: "#6B1010",
  },
  {
    slug: "toplanma-alani",
    label: "Acil Toplanma Alanı",
    shortLabel: "Toplanma",
    icon: Siren,
    pin: "#CA8A04",
    tint: "#FAF0D4",
    onTint: "#6B4903",
  },
  {
    slug: "kutuphane",
    label: "Kütüphane",
    shortLabel: "Kütüphane",
    icon: BookOpen,
    pin: "#1E6091",
    tint: "#DDEAF3",
    onTint: "#123A57",
  },
  {
    slug: "sarj",
    label: "Elektrikli Şarj",
    shortLabel: "Şarj",
    icon: PlugZap,
    pin: "#4D7C0F",
    tint: "#E4EFD3",
    onTint: "#2A4408",
  },
];

export const CATEGORY_BY_SLUG: Record<CategorySlug, CategoryMeta> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c]),
) as Record<CategorySlug, CategoryMeta>;

export function categoryMeta(slug: CategorySlug): CategoryMeta {
  return CATEGORY_BY_SLUG[slug] ?? CATEGORIES[0];
}

export interface AmenityMeta {
  key: AmenityKey;
  label: string;
  /** Shown in the filter row (shorter). */
  filterLabel: string;
  icon: LucideIcon;
  /** Surfaced as a top-level filter chip, not just a detail-page row. */
  filterable: boolean;
}

export const AMENITIES: AmenityMeta[] = [
  {
    key: "wheelchair_accessible",
    label: "Tekerlekli sandalye erişimi",
    filterLabel: "Engelli erişimli",
    icon: Accessibility,
    filterable: true,
  },
  { key: "has_ramp", label: "Rampa", filterLabel: "Rampalı", icon: Accessibility, filterable: false },
  { key: "baby_changing", label: "Bebek bakım alanı", filterLabel: "Bebek bakım", icon: Baby, filterable: true },
  { key: "child_friendly", label: "Çocuk dostu", filterLabel: "Çocuk dostu", icon: ToyBrick, filterable: true },
  { key: "pet_friendly", label: "Evcil hayvan dostu", filterLabel: "Evcil hayvan", icon: Dog, filterable: true },
  {
    key: "has_drinking_water",
    label: "İçme suyu",
    filterLabel: "İçme suyu",
    icon: Droplet,
    filterable: true,
  },
  { key: "has_wifi", label: "Ücretsiz Wi-Fi", filterLabel: "Wi-Fi", icon: Wifi, filterable: true },
  { key: "has_shower", label: "Duş", filterLabel: "Duş", icon: ShowerHead, filterable: false },
  { key: "has_seating", label: "Oturma alanı", filterLabel: "Oturma", icon: Armchair, filterable: false },
  { key: "has_shade", label: "Gölgelik", filterLabel: "Gölgelik", icon: TreePalm, filterable: true },
  { key: "has_parking", label: "Otopark", filterLabel: "Otoparklı", icon: Car, filterable: false },
  { key: "is_quiet", label: "Sakin", filterLabel: "Sakin", icon: Volume2, filterable: false },
];

export const FILTERABLE_AMENITIES = AMENITIES.filter((a) => a.filterable);

export const AMENITY_BY_KEY: Record<AmenityKey, AmenityMeta> = Object.fromEntries(
  AMENITIES.map((a) => [a.key, a]),
) as Record<AmenityKey, AmenityMeta>;

/** Non-amenity filters that live in the same chip row. */
export const EXTRA_FILTERS = [
  // "Şu an açık" would be a promise the data cannot keep - 94.5% of places
  // have no opening hours, so the honest job this filter does is hide the
  // ones known to be closed. The label says that.
  { key: "openNow" as const, label: "Kapalıları gizle", icon: Clock },
  { key: "freeOnly" as const, label: "Ücretsiz", icon: BadgeTurkishLira },
];

export const ALL_CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

/** Used by the "natural language-ish" search: maps free text to the
 * structured filters the query layer already understands. Deliberately a
 * lookup table, not an LLM call - the demo has to answer instantly and
 * offline, and the architecture stays open to a semantic layer later
 * (see README "Arama"). */
export const SEARCH_SYNONYMS: {
  pattern: RegExp;
  categories?: CategorySlug[];
  amenities?: AmenityKey[];
  freeOnly?: boolean;
  /**
   * A weak trigger is real evidence only when nothing stronger fired. "araç"
   * genuinely suggests a car park, but in "elektrikli araç şarj" it dragged
   * 600 parking lots into a charging-station search. Weak rules still consume
   * their token (so it never leaks into the name filter) - they just yield
   * to a specific match.
   */
  weak?: boolean;
}[] = [
  { pattern: /tuvalet|wc|lavabo|umumi/i, categories: ["tuvalet"] },
  { pattern: /park\b|yeşil|bahçe|koru/i, categories: ["park"] },
  { pattern: /su|çeşme|cesme|içme|susa/i, categories: ["su"], amenities: ["has_drinking_water"] },
  { pattern: /bank|otur|dinlen|mola/i, categories: ["dinlenme"] },
  {
    // Turkish consonant softening: a final k becomes ğ before a vowel-initial
    // suffix, so "çocuk" turns into "çocuğ-umla" the moment anyone writes a
    // natural sentence. Matching only the hard-k form left "çocuğumla" behind
    // as a literal name filter and zeroed out one of the demo's flagship
    // queries. Same shape for other softening stems below.
    pattern: /çocu[kğ]|cocu[kğ]|oyun|kaydırak|salıncak/i,
    categories: ["cocuk-alani"],
    amenities: ["child_friendly"],
  },
  { pattern: /spor|fitness|saha|basketbol|futbol|koşu/i, categories: ["spor"] },
  { pattern: /otopark|park yeri/i, categories: ["otopark"] },
  // "araba"/"araç" on their own usually mean parking, but not next to "şarj".
  { pattern: /araba|araç|arac\b/i, categories: ["otopark"], weak: true },
  { pattern: /duş|dus|yıkan/i, categories: ["dus"] },
  { pattern: /wifi|wi-fi|internet/i, categories: ["wifi"], amenities: ["has_wifi"] },
  { pattern: /cami|mescit|namaz|ibadet|abdest/i, categories: ["cami"] },
  { pattern: /eczane|ilaç|ilac|nöbetçi|nobetci/i, categories: ["eczane"] },
  {
    pattern: /toplanma|deprem|afet|tahliye/i,
    categories: ["toplanma-alani"],
  },
  // "acil" alone is usually urgency ("acil tuvalet lazım"), not a request for
  // an earthquake assembly point - so it only counts when nothing else fired.
  { pattern: /acil/i, categories: ["toplanma-alani"], weak: true },
  { pattern: /kütüphane|kutuphane|kitap|çalış|calis/i, categories: ["kutuphane"] },
  { pattern: /şarj|sarj|elektrikli|elektrik/i, categories: ["sarj"] },
  // "erişim" as well as "erişilebilir": people write "engelli erişimli".
  { pattern: /engelli|tekerlekli|erişim|erisim|erişilebilir|erisilebilir/i, amenities: ["wheelchair_accessible"] },
  // bebek → bebeğ- ("bebeğimin"); "bez" needs to stand alone because the
  // phrase is rarely adjacent ("bezini değiştirebileceğim").
  { pattern: /bebe[kğ]|bez\b|bezini|bezini değiştir/i, amenities: ["baby_changing"] },
  // köpek → köpeğ- ("köpeğimle"), same softening rule as çocuk above.
  { pattern: /köpe[kğ]|kope[kğ]|kedi|evcil|pet/i, amenities: ["pet_friendly"] },
  { pattern: /gölge|golge|serin/i, amenities: ["has_shade"] },
  { pattern: /sakin|sessiz|huzur/i, amenities: ["is_quiet"] },
  { pattern: /ücretsiz|ucretsiz|bedava|parasız/i, freeOnly: true },
];

export { Bike };
