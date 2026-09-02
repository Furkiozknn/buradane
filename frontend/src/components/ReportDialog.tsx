"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import type { ContributionKind, Place } from "@/lib/types";

const REPORT_OPTIONS: { kind: ContributionKind; reason: string; label: string }[] = [
  { kind: "report_closed", reason: "closed", label: "Kapalı / artık burada değil" },
  { kind: "report_incorrect", reason: "wrong_info", label: "Bilgiler yanlış" },
  { kind: "report_incorrect", reason: "not_accessible", label: "Erişilebilir değil" },
  { kind: "report_incorrect", reason: "paid_now", label: "Artık ücretli" },
  { kind: "report_incorrect", reason: "locked", label: "Kilitli / girilemiyor" },
];

export function ReportDialog({ place, onClose }: { place: Place; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the dialog on open - both are basic
  // dialog obligations that get skipped surprisingly often.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (selected === null) return;
    const option = REPORT_OPTIONS[selected];
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: option.kind,
          placeId: place.id,
          placeName: place.name,
          payload: { reason: option.reason },
          note: note.trim() || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Bildirim gönderilemedi");
      }
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Bilinmeyen bir hata oluştu");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        role="presentation"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-3xl bg-surface p-5 shadow-lg outline-none sm:rounded-3xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="report-title" className="text-[17px] font-bold text-text">
              Sorun bildir
            </h2>
            <p className="mt-0.5 text-[13px] text-text-secondary">{place.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-sunken"
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
            <p className="text-[15px] font-semibold text-text">Bildirimin alındı, teşekkürler.</p>
            <p className="mt-1 text-[13px] text-text-secondary">
              Moderasyon ekibi kontrol edene kadar mekan bilgisi değişmez.
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
            <fieldset className="space-y-1.5">
              <legend className="sr-only">Sorun türü</legend>
              {REPORT_OPTIONS.map((option, index) => (
                <label
                  key={option.reason}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-[14px] transition-colors"
                  style={{
                    borderColor: selected === index ? "var(--brand)" : "var(--border)",
                    background: selected === index ? "var(--brand-soft)" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    checked={selected === index}
                    onChange={() => setSelected(index)}
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <label className="mt-3 block">
              <span className="text-[13px] font-medium text-text-secondary">Ek not (isteğe bağlı)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={500}
                className="mt-1 w-full resize-none rounded-xl border border-border bg-surface p-3 text-[16px] outline-none focus:border-brand"
                placeholder="Ne gördüğünü kısaca yazabilirsin"
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
              disabled={selected === null || state === "sending"}
              className="mt-3 h-12 w-full rounded-xl bg-brand text-[15px] font-semibold text-brand-contrast transition-opacity disabled:opacity-40"
            >
              {state === "sending" ? "Gönderiliyor…" : "Bildir"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
