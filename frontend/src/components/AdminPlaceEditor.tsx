"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Search } from "lucide-react";
import { adminFetch } from "@/lib/admin-token";

import { AMENITIES, categoryMeta } from "@/lib/categories";
import type { AmenityKey, Place, PlaceStatus, PriceType } from "@/lib/types";

const STATUS_LABEL: Record<PlaceStatus, string> = {
  active: "Aktif",
  temporarily_closed: "Geçici kapalı",
  permanently_closed: "Kalıcı kapalı",
  pending_review: "İncelemede",
};

const PRICE_LABEL: Record<PriceType, string> = {
  free: "Ücretsiz",
  paid: "Ücretli",
  unknown: "Bilinmiyor",
};

/** Only the amenities a moderator can realistically confirm from a report or
 * a photo. The long tail stays where OSM put it. */
const EDITABLE_AMENITIES: AmenityKey[] = [
  "wheelchair_accessible",
  "baby_changing",
  "has_drinking_water",
  "child_friendly",
  "has_wifi",
  "has_shade",
];

export function AdminPlaceEditor() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const requestIdRef = useRef(0);

  // Debounced search against the same public endpoint the app uses - the
  // admin sees exactly what users see, overrides included.
  useEffect(() => {
    if (term.trim().length < 2) {
      // Deferred rather than set synchronously: clearing during the effect
      // body is the cascading-render pattern React warns about, and there is
      // no reason this can't happen on the next tick.
      const clear = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(clear);
    }
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/places?q=${encodeURIComponent(term.trim())}&limit=12`);
        if (!response.ok) return;
        const data = await response.json();
        if (requestId !== requestIdRef.current) return;
        setResults(data.places ?? []);
      } catch {
        // A failed lookup just shows nothing; the admin can retype.
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!selected) return;
      setSaving(true);
      setMessage(null);
      try {
        const response = await adminFetch(`/api/admin/places/${encodeURIComponent(selected.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Kaydedilemedi");
        setSelected(data as Place);
        setMessage({ kind: "ok", text: "Kaydedildi" });
      } catch (error) {
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Bilinmeyen hata" });
      } finally {
        setSaving(false);
      }
    },
    [selected],
  );

  const revert = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await adminFetch(`/api/admin/places/${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Geri alınamadı");
      setSelected(data as Place);
      setMessage({ kind: "ok", text: "Düzeltmeler geri alındı, kaynak kayda dönüldü" });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Bilinmeyen hata" });
    } finally {
      setSaving(false);
    }
  }, [selected]);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <label className="block">
        <span className="text-[13px] font-medium text-text-secondary">Mekan ara</span>
        <span className="mt-1 flex h-11 items-center gap-2 rounded-xl border border-border px-3">
          <Search size={16} className="shrink-0 text-text-muted" aria-hidden />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="İsim ya da adres"
            className="h-full w-full bg-transparent text-[15px] outline-none placeholder:text-text-muted"
          />
        </span>
      </label>

      {results.length > 0 && !selected && (
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {results.map((place) => {
            const meta = categoryMeta(place.categories[0]);
            const Icon = meta.icon;
            return (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(place);
                    setMessage(null);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-surface-sunken"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: meta.tint }}
                  >
                    <Icon size={15} color={meta.pin} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-text">{place.name}</span>
                    <span className="block truncate text-[12px] text-text-secondary">
                      {meta.label}
                      {place.address_line ? ` · ${place.address_line}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-text">{selected.name}</p>
              <p className="truncate text-[12px] text-text-muted">{selected.id}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setMessage(null);
              }}
              className="shrink-0 text-[13px] font-medium text-brand"
            >
              Vazgeç
            </button>
          </div>

          <label className="block">
            <span className="text-[13px] font-medium text-text-secondary">Ad</span>
            <input
              defaultValue={selected.name}
              key={`${selected.id}:${selected.name}`}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== selected.name) void patch({ name: value });
              }}
              className="mt-1 h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px] outline-none focus:border-brand"
            />
          </label>

          <Field label="Durum">
            {(Object.keys(STATUS_LABEL) as PlaceStatus[]).map((status) => (
              <Chip
                key={status}
                active={selected.status === status}
                onClick={() => void patch({ status })}
                disabled={saving}
              >
                {STATUS_LABEL[status]}
              </Chip>
            ))}
          </Field>

          <Field label="Ücret">
            {(Object.keys(PRICE_LABEL) as PriceType[]).map((price) => (
              <Chip
                key={price}
                active={selected.price_type === price}
                onClick={() => void patch({ price_type: price })}
                disabled={saving}
              >
                {PRICE_LABEL[price]}
              </Chip>
            ))}
          </Field>

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-text-secondary">Özellikler</p>
            <div className="space-y-1.5">
              {EDITABLE_AMENITIES.map((key) => {
                const meta = AMENITIES.find((a) => a.key === key);
                const value = selected.amenities[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-[13.5px] text-text">{meta?.label ?? key}</span>
                    <div className="flex shrink-0 gap-1">
                      {[
                        { v: true, label: "Var" },
                        { v: false, label: "Yok" },
                        { v: null, label: "Bilinmiyor" },
                      ].map((option) => (
                        <Chip
                          key={String(option.v)}
                          active={value === option.v}
                          onClick={() => void patch({ amenities: { [key]: option.v } })}
                          disabled={saving}
                          small
                        >
                          {option.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={revert}
              disabled={saving}
              className="flex items-center gap-1.5 text-[13px] font-medium text-text-secondary hover:text-text disabled:opacity-50"
            >
              <RotateCcw size={14} aria-hidden />
              Kaynak kayda dön
            </button>
            {message && (
              <span
                className="flex items-center gap-1 text-[13px] font-medium"
                style={{ color: message.kind === "ok" ? "var(--success)" : "var(--danger)" }}
                role="status"
              >
                {message.kind === "ok" && <Check size={14} aria-hidden />}
                {message.text}
              </span>
            )}
          </div>

          <p className="text-[11.5px] leading-relaxed text-text-muted">
            Düzenlemeler OSM anlık görüntüsünün üzerine <strong>katman</strong> olarak yazılır;
            kaynak kayıt değişmez, yeniden içe aktarımda kaybolmaz ve tek tuşla geri alınabilir.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-text-secondary">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  disabled,
  small,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full border font-medium transition-colors disabled:opacity-50 ${
        small ? "h-8 px-2.5 text-[12px]" : "h-9 px-3 text-[13px]"
      }`}
      style={{
        borderColor: active ? "var(--brand)" : "var(--border)",
        background: active ? "var(--brand-soft)" : "transparent",
        color: active ? "var(--brand)" : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  );
}
