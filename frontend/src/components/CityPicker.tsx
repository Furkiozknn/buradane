"use client";

import { useEffect } from "react";
import { MapPin, X } from "lucide-react";

export interface CityOption {
  slug: string;
  label: string;
  count: number;
  center: { lat: number; lon: number };
}

/**
 * City switcher.
 *
 * This is the recovery path the permission-denied state needs: when we can't
 * locate someone, "pick your city" is a far better answer than a blank map
 * or a re-prompt the browser will silently swallow. It doubles as the way to
 * browse another city on purpose.
 */
export function CityPicker({
  cities,
  activeCity,
  onSelect,
  onClose,
}: {
  cities: CityOption[];
  activeCity: string | null;
  onSelect: (city: CityOption) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} role="presentation" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-title"
        className="relative w-full max-w-md rounded-t-3xl bg-surface p-5 shadow-lg sm:rounded-3xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="city-title" className="text-[17px] font-bold text-text">
              Şehir seç
            </h2>
            <p className="mt-0.5 text-[13px] text-text-secondary">
              Konumun kapalıysa buradan devam edebilirsin.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-sunken"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>

        <ul className="space-y-1.5">
          {cities.map((city) => {
            const isActive = city.slug === activeCity;
            return (
              <li key={city.slug}>
                <button
                  type="button"
                  onClick={() => onSelect(city)}
                  aria-current={isActive ? "true" : undefined}
                  className="flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors"
                  style={{
                    borderColor: isActive ? "var(--brand)" : "var(--border)",
                    background: isActive ? "var(--brand-soft)" : "transparent",
                  }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: isActive ? "var(--brand)" : "var(--surface-sunken)" }}
                  >
                    <MapPin
                      size={17}
                      color={isActive ? "var(--brand-contrast)" : "var(--text-secondary)"}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-text">{city.label}</span>
                    <span className="block text-[12.5px] tabular-nums text-text-secondary">
                      {city.count.toLocaleString("tr-TR")} kayıtlı yer
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-center text-[11.5px] text-text-muted">
          Daha fazla şehir yolda — veri il il ekleniyor.
        </p>
      </div>
    </div>
  );
}
