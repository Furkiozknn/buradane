"use client";

import { useState } from "react";
import { Check, Clock, X } from "lucide-react";

import type { Contribution } from "@/lib/types";

const KIND_LABEL: Record<Contribution["kind"], string> = {
  suggestion: "Mekan önerisi",
  report_incorrect: "Yanlış bilgi bildirimi",
  report_closed: "Kapalı bildirimi",
  // Applied immediately rather than queued, so it appears here as history
  // (already "Onaylandı") rather than as something awaiting a decision.
  verify_present: "Yerinde doğrulama",
};

const REASON_LABEL: Record<string, string> = {
  closed: "Kapalı / artık burada değil",
  wrong_info: "Bilgiler yanlış",
  not_accessible: "Erişilebilir değil",
  paid_now: "Artık ücretli",
  locked: "Kilitli / girilemiyor",
};

export function AdminQueue({ initialContributions }: { initialContributions: Contribution[] }) {
  const [contributions, setContributions] = useState(initialContributions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function moderate(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/contributions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "İşlem başarısız");
      }
      const updated = (await response.json()) as Contribution;
      setContributions((current) => current.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusyId(null);
    }
  }

  if (contributions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-[14px] font-medium text-text">Kuyruk boş</p>
        <p className="mt-1 text-[13px] text-text-secondary">
          Kullanıcılar mekan önerdiğinde ya da sorun bildirdiğinde burada görünür.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="mb-3 rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--danger-soft)", color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {contributions.map((contribution) => {
          const reason = contribution.payload?.reason as string | undefined;
          const isPending = contribution.status === "pending";
          return (
            <li
              key={contribution.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11.5px] font-medium text-text-secondary">
                    {KIND_LABEL[contribution.kind]}
                  </span>
                  <StatusBadge status={contribution.status} />
                  <span className="text-[11.5px] text-text-muted">
                    {new Date(contribution.createdAt).toLocaleString("tr-TR")}
                  </span>
                </div>

                <p className="mt-1.5 text-[14px] font-medium text-text">
                  {contribution.placeName ??
                    (contribution.payload?.name as string | undefined) ??
                    "İsimsiz"}
                </p>

                {reason && (
                  <p className="text-[13px] text-text-secondary">{REASON_LABEL[reason] ?? reason}</p>
                )}
                {contribution.note && (
                  <p className="mt-1 text-[13px] italic text-text-secondary">
                    &ldquo;{contribution.note}&rdquo;
                  </p>
                )}
              </div>

              {isPending ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => moderate(contribution.id, "approve")}
                    disabled={busyId === contribution.id}
                    className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50"
                    style={{ background: "var(--success-soft)", color: "var(--success)" }}
                  >
                    <Check size={15} />
                    Onayla
                  </button>
                  <button
                    type="button"
                    onClick={() => moderate(contribution.id, "reject")}
                    disabled={busyId === contribution.id}
                    className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold disabled:opacity-50"
                    style={{ background: "var(--surface-sunken)", color: "var(--text-secondary)" }}
                  >
                    <X size={15} />
                    Reddet
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function StatusBadge({ status }: { status: Contribution["status"] }) {
  const map = {
    pending: { label: "Bekliyor", bg: "var(--warning-soft)", fg: "var(--warning)", icon: <Clock size={11} /> },
    approved: { label: "Onaylandı", bg: "var(--success-soft)", fg: "var(--success)", icon: <Check size={11} /> },
    rejected: { label: "Reddedildi", bg: "var(--surface-sunken)", fg: "var(--text-muted)", icon: <X size={11} /> },
  } as const;
  const style = map[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
      style={{ background: style.bg, color: style.fg }}
    >
      {style.icon}
      {style.label}
    </span>
  );
}
