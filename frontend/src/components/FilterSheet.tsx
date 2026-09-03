"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

import { EXTRA_FILTERS, FILTERABLE_AMENITIES } from "@/lib/categories";
import type { AmenityKey } from "@/lib/types";

export interface FilterState {
  amenities: AmenityKey[];
  openNow: boolean;
  freeOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = { amenities: [], openNow: false, freeOnly: false };

export function activeFilterCount(filters: FilterState): number {
  return filters.amenities.length + (filters.openNow ? 1 : 0) + (filters.freeOnly ? 1 : 0);
}

export function FilterSheet({
  filters,
  resultCount,
  onChange,
  onClose,
}: {
  filters: FilterState;
  resultCount: number;
  onChange: (next: FilterState) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleAmenity = (key: AmenityKey) => {
    onChange({
      ...filters,
      amenities: filters.amenities.includes(key)
        ? filters.amenities.filter((a) => a !== key)
        : [...filters.amenities, key],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} role="presentation" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        className="relative w-full max-w-md rounded-t-3xl bg-surface shadow-lg sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 id="filters-title" className="text-[17px] font-bold text-text">
            Filtreler
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="rounded-full px-3 py-1.5 text-[13px] font-medium text-brand hover:bg-brand-soft"
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-sunken"
              aria-label="Kapat"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-text-muted">
            Durum
          </h3>
          <div className="mb-5 flex flex-wrap gap-2">
            {EXTRA_FILTERS.map((filter) => {
              const Icon = filter.icon;
              const isActive = filters[filter.key];
              return (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => onChange({ ...filters, [filter.key]: !isActive })}
                  aria-pressed={isActive}
                  className="flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors"
                  style={{
                    borderColor: isActive ? "var(--brand)" : "var(--border)",
                    background: isActive ? "var(--brand-soft)" : "transparent",
                    color: isActive ? "var(--brand)" : "var(--text-secondary)",
                  }}
                >
                  <Icon size={15} aria-hidden />
                  {filter.label}
                </button>
              );
            })}
          </div>

          {/* The two filters above behave differently on missing data, and
              that difference decides what the user gets back - so it is
              stated rather than left to be discovered. */}
          <p className="-mt-3 mb-5 text-[12.5px] leading-relaxed text-text-muted">
            <strong>Kapalıları gizle</strong>, yalnızca çalışma saati bilinen ve şu an{" "}
            <strong>kapalı</strong> olan mekanları çıkarır. Saati bilinmeyen mekanlar listede
            kalır — açık kaynak verinin %94&apos;ünde çalışma saati yok, onları da elemek
            kapalı olduklarını iddia etmek olurdu.
          </p>

          <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-text-muted">
            Özellikler
          </h3>
          <div className="flex flex-wrap gap-2">
            {FILTERABLE_AMENITIES.map((amenity) => {
              const Icon = amenity.icon;
              const isActive = filters.amenities.includes(amenity.key);
              return (
                <button
                  key={amenity.key}
                  type="button"
                  onClick={() => toggleAmenity(amenity.key)}
                  aria-pressed={isActive}
                  className="flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors"
                  style={{
                    borderColor: isActive ? "var(--brand)" : "var(--border)",
                    background: isActive ? "var(--brand-soft)" : "transparent",
                    color: isActive ? "var(--brand)" : "var(--text-secondary)",
                  }}
                >
                  <Icon size={15} aria-hidden />
                  {amenity.filterLabel}
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-[12.5px] leading-relaxed text-text-muted">
            Bir özellik filtresi yalnızca o bilginin <strong>doğrulanmış</strong> olduğu mekanları
            gösterir. Bilgisi olmayan mekanlar listeden çıkar — bu, olmadığı anlamına gelmez.
          </p>
        </div>

        <div className="border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={resultCount === 0}
            className="h-12 w-full rounded-xl bg-brand text-[15px] font-semibold text-brand-contrast disabled:opacity-40"
          >
            {resultCount === 0 ? "Sonuç yok" : `${resultCount} sonucu göster`}
          </button>
        </div>
      </div>
    </div>
  );
}
