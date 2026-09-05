"use client";

import { useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";

import { TOTALS, findProvince, foldAscii } from "@/lib/administrative";

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
  nearestCity,
  onSelect,
  onClose,
}: {
  cities: CityOption[];
  activeCity: string | null;
  /** Slug of the city closest to the device, when we have a fix. Marked
   * rather than sorted to the top: a list that reorders itself between
   * openings costs more in muscle memory than the hint is worth. */
  nearestCity?: string | null;
  onSelect: (city: CityOption) => void;
  onClose: () => void;
}) {
  // Turkish collation, not the default. "İstanbul" and "İzmir" sort under a
  // dotted İ that ASCII ordering puts in the wrong place entirely, which in
  // a Turkish city list reads as a bug.
  const sorted = [...cities].sort((a, b) => a.label.localeCompare(b.label, "tr"));

  // A scrollable list works at nine entries and stops working at eighty-one:
  // finding Yozgat by scrolling past seventy rows is not finding, it is
  // searching the slow way. Folded matching so "igdir" finds "Iğdır" - the
  // same rule the main search follows, because a filter that demands the
  // correct keyboard would lock out exactly the people typing on one that
  // lacks it.
  const [filter, setFilter] = useState("");
  const visible = filter.trim()
    ? sorted.filter((city) => foldAscii(city.label).includes(foldAscii(filter)))
    : sorted;

  // Resolved through the province table rather than counted as city files:
  // the two are the same today, but a city slug is a fetch unit and a
  // province is an administrative fact, and they will diverge the moment a
  // province is fetched as two bounding boxes.
  const coveredProvinces = new Set(
    cities.map((c) => findProvince(c.label)?.code).filter((code): code is number => code !== undefined),
  ).size;
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
              Başka bir şehre bakabilir, konumun kapalıysa buradan devam edebilirsin.
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

        {/* Shown from ten entries up: below that the list fits on screen and
            a search box would just push it down. */}
        {cities.length >= 10 && (
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="İl ara…"
            aria-label="İl ara"
            className="mb-2 h-11 w-full rounded-xl border border-border bg-transparent px-3 text-[16px] outline-none focus:border-brand"
          />
        )}

        {visible.length === 0 && (
          <p className="py-6 text-center text-[13.5px] text-text-secondary" role="status">
            &ldquo;{filter}&rdquo; ile eşleşen il yok.
          </p>
        )}

        {/* Scrolls: at nine cities the list already outgrew a small phone,
            and without this the ones at the bottom simply could not be
            reached. Sized in vh so it keeps working as provinces are added. */}
        <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {visible.map((city) => {
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
                    <span className="flex items-center gap-1.5 text-[15px] font-semibold text-text">
                      {city.label}
                      {city.slug === nearestCity && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                          style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                        >
                          en yakın
                        </span>
                      )}
                    </span>
                    <span className="block text-[12.5px] tabular-nums text-text-secondary">
                      {city.count.toLocaleString("tr-TR")} kayıtlı yer
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Coverage stated as a fraction. "6 il" on its own means nothing;
            "81 ilin 6'sı" is the difference between a reader assuming the
            app covers the country and knowing exactly how far along it is.
            Counted from the cities actually loaded, so it cannot drift out
            of step with the data the way a written number would. */}
        <p className="mt-3 text-center text-[11.5px] text-text-muted">
          {/* "tanesi", not the numeric possessive: the correct suffix depends
              on how the number is *pronounced* (7'si, 8'i, 9'u, 40'ı, 81'i),
              so a template that appends one is wrong for most values it will
              ever hold as coverage grows from 1 to 81. */}
          Türkiye&apos;deki {TOTALS.provinces} ilin{" "}
          <strong className="font-semibold text-text-secondary">{coveredProvinces}</strong> tanesi
          kapsanıyor — veri il il ekleniyor.
        </p>
      </div>
    </div>
  );
}
