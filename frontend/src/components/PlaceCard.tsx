"use client";

import { BadgeCheck, ChevronRight, CircleAlert, Navigation } from "lucide-react";

import { AMENITY_BY_KEY, categoryMeta } from "@/lib/categories";
import { bearingDegrees, bearingLabel, formatDistance, walkingMinutes, type LatLon } from "@/lib/geo";
import { DirectionArrow } from "./DirectionArrow";
import { isOpenNow } from "@/lib/opening-hours";
import type { AmenityKey, Place } from "@/lib/types";
import { directionsUrl } from "@/lib/directions";

/** Amenities worth surfacing on a compact card, in priority order. Only ones
 * that are definitively `true` are shown - an unknown value is not a feature. */
const CARD_AMENITY_ORDER: AmenityKey[] = [
  "wheelchair_accessible",
  "has_drinking_water",
  "baby_changing",
  "child_friendly",
  "has_wifi",
  "has_shade",
  "pet_friendly",
];

export function PlaceCard({
  place,
  active,
  origin,
  onSelect,
  onOpenDetail,
}: {
  place: Place;
  active?: boolean;
  /** Where the user is (or the map centre when location is unknown) - the
   * point the direction arrow points *from*. */
  origin?: LatLon | null;
  onSelect: (place: Place) => void;
  onOpenDetail: (place: Place) => void;
}) {
  const primary = categoryMeta(place.categories[0]);
  const Icon = primary.icon;
  const openState = isOpenNow(place.opening_hours_raw);
  const features = CARD_AMENITY_ORDER.filter((key) => place.amenities[key] === true).slice(0, 3);
  const isClosed = place.status === "temporarily_closed";
  const lowConfidence = place.reliability_score < 0.45;
  const bearing =
    origin && place.distance_m != null
      ? bearingDegrees(origin, { lat: place.lat, lon: place.lon })
      : null;

  return (
    <article
      className="group relative flex gap-3 rounded-2xl border bg-surface p-3 transition-colors"
      style={{ borderColor: active ? primary.pin : "var(--border)" }}
    >
      <button
        type="button"
        onClick={() => onOpenDetail(place)}
        onFocus={() => onSelect(place)}
        onMouseEnter={() => onSelect(place)}
        className="absolute inset-0 rounded-2xl"
        aria-label={`${primary.label}. ${place.name}. ${
          place.distance_m != null
            ? `${formatDistance(place.distance_m)} uzaklıkta${
                bearing != null ? `, ${bearingLabel(bearing)} yönünde` : ""
              }.`
            : ""
        } Detayları aç.`}
      />

      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{ background: primary.tint }}
        aria-hidden
      >
        <Icon size={20} color={primary.pin} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold leading-tight text-text">{place.name}</h3>
          {place.distance_m != null && (
            <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold tabular-nums text-brand">
              {bearing != null && <DirectionArrow degrees={bearing} size={12} />}
              {formatDistance(place.distance_m)}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-[12.5px] text-text-secondary">
          {primary.label}
          {place.distance_m != null && <> · yürüyerek {walkingMinutes(place.distance_m)} dk</>}
          {place.price_type === "free" && <> · Ücretsiz</>}
          {place.price_type === "paid" && <> · Ücretli</>}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {isClosed ? (
            <Badge tone="danger" icon={<CircleAlert size={12} />}>
              Geçici olarak kapalı
            </Badge>
          ) : openState === "open" ? (
            <Badge tone="success">Şu an açık</Badge>
          ) : openState === "closed" ? (
            <Badge tone="warning">Şu an kapalı</Badge>
          ) : null}

          {features.map((key) => (
            <Badge key={key} tone="neutral">
              {AMENITY_BY_KEY[key].filterLabel}
            </Badge>
          ))}

          {lowConfidence ? (
            <Badge tone="warning" icon={<CircleAlert size={12} />}>
              Bilgi güncelliği düşük
            </Badge>
          ) : (
            <Badge tone="neutral" icon={<BadgeCheck size={12} />}>
              {place.freshness_label}
            </Badge>
          )}
        </div>
      </div>

      <div className="relative flex shrink-0 flex-col items-center justify-center gap-1">
        <a
          href={directionsUrl(place)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand transition-colors hover:bg-brand hover:text-brand-contrast"
          aria-label={`${place.name} için yol tarifi al`}
        >
          <Navigation size={17} />
        </a>
        <ChevronRight size={16} className="text-text-muted" aria-hidden />
      </div>
    </article>
  );
}

function Badge({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: "success" | "warning" | "danger" | "neutral";
  icon?: React.ReactNode;
}) {
  const styles: Record<string, { bg: string; fg: string }> = {
    success: { bg: "var(--success-soft)", fg: "var(--success)" },
    warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
    danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
    neutral: { bg: "var(--surface-sunken)", fg: "var(--text-secondary)" },
  };
  const style = styles[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: style.bg, color: style.fg }}
    >
      {icon}
      {children}
    </span>
  );
}

export function PlaceCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-surface p-3">
      <div className="skeleton h-11 w-11 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2 py-0.5">
        <div className="skeleton h-3.5 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton h-4 w-1/2 rounded-full" />
      </div>
    </div>
  );
}
