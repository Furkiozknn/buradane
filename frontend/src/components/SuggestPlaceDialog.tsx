"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MapPin, X } from "lucide-react";

import { CATEGORIES } from "@/lib/categories";
import type { CategorySlug } from "@/lib/types";

/**
 * "Yer öner" - the lowest-friction contribution path. Location comes from
 * wherever the map is currently centered rather than asking the user to type
 * coordinates: they have already panned to the spot they mean.
 *
 * Submissions land as `pending` and are invisible to public search until a
 * moderator approves them - same rule the backend enforces, see
 * backend/app/services/moderation.py.
 */
export function SuggestPlaceDialog({
  center,
  onClose,
}: {
  center: { lat: number; lon: number };
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<CategorySlug[]>([]);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (slug: CategorySlug) =>
    setSelected((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );

  const canSubmit = name.trim().length >= 2 && selected.length > 0 && state !== "sending";

  async function submit() {
    if (!canSubmit) return;
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "suggestion",
          placeName: name.trim(),
          payload: {
            name: name.trim(),
            lat: center.lat,
            lon: center.lon,
            categories: selected,
          },
          note: note.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Öneri gönderilemedi");
      }
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} role="presentation" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggest-title"
        tabIndex={-1}
        className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-lg outline-none sm:rounded-3xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="suggest-title" className="text-[17px] font-bold text-text">
              Yer öner
            </h2>
            <p className="mt-0.5 text-[13px] text-text-secondary">
              Bildiğin bir yeri ekleyerek herkese yardımcı ol.
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

        {state === "done" ? (
          <div className="py-6 text-center">
            <span
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "var(--success-soft)" }}
            >
              <Check size={24} style={{ color: "var(--success)" }} />
            </span>
            <p className="text-[15px] font-semibold text-text">Önerin alındı, teşekkürler.</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Moderasyon onayından sonra haritada görünecek.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-11 w-full rounded-xl bg-brand font-semibold text-brand-contrast"
            >
              Kapat
            </button>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="text-[13px] font-medium text-text-secondary">Mekan adı</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="Örn. Sahil Parkı Çeşmesi"
                className="mt-1 h-12 w-full rounded-xl border border-border bg-surface px-3 text-[16px] outline-none focus:border-brand"
              />
            </label>

            <fieldset className="mt-4">
              <legend className="text-[13px] font-medium text-text-secondary">
                Kategori <span className="text-text-muted">(birden fazla seçebilirsin)</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {CATEGORIES.map((category) => {
                  const Icon = category.icon;
                  const isSelected = selected.includes(category.slug);
                  return (
                    <button
                      key={category.slug}
                      type="button"
                      onClick={() => toggle(category.slug)}
                      aria-pressed={isSelected}
                      className="flex h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors"
                      style={{
                        borderColor: isSelected ? category.pin : "var(--border)",
                        background: isSelected ? category.tint : "transparent",
                        color: isSelected ? category.onTint : "var(--text-secondary)",
                      }}
                    >
                      <Icon size={15} color={isSelected ? category.onTint : category.pin} aria-hidden />
                      {category.shortLabel}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5">
              <MapPin size={16} className="shrink-0 text-brand" aria-hidden />
              <p className="text-[12.5px] text-text-secondary">
                Konum, haritanın şu anki merkezi:{" "}
                <span className="tabular-nums text-text">
                  {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
                </span>
                . Haritayı kaydırıp tekrar açarak değiştirebilirsin.
              </p>
            </div>

            <label className="mt-3 block">
              <span className="text-[13px] font-medium text-text-secondary">Not (isteğe bağlı)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ücretsiz mi, erişilebilir mi, saatleri var mı?"
                className="mt-1 w-full resize-none rounded-xl border border-border bg-surface p-3 text-[16px] outline-none focus:border-brand"
              />
            </label>

            {error && (
              <p className="mt-2 text-[13px]" style={{ color: "var(--danger)" }} role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="mt-4 h-12 w-full rounded-xl bg-brand text-[15px] font-semibold text-brand-contrast transition-opacity disabled:opacity-40"
            >
              {state === "sending" ? "Gönderiliyor…" : "Öneriyi gönder"}
            </button>
            <p className="mt-2 text-center text-[11.5px] text-text-muted">
              Önerin moderasyon onayına düşer, hemen yayınlanmaz.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
