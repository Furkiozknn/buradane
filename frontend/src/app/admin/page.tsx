import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { listContributions, listOverrides } from "@/lib/contributions-store";
import { allPlaces, categoryCounts, datasetMeta } from "@/lib/places-repository";
import { AdminQueue } from "@/components/AdminQueue";
import { AdminTokenGate } from "@/components/AdminTokenGate";
import { AdminPlaceEditor } from "@/components/AdminPlaceEditor";
import { CATEGORIES } from "@/lib/categories";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [contributions, overrides] = await Promise.all([listContributions(), listOverrides()]);
  const places = allPlaces();
  const counts = categoryCounts(places);
  const meta = datasetMeta();

  const pending = contributions.filter((c) => c.status === "pending");

  return (
    <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <Link
            href="/"
            className="mb-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
          >
            <ArrowLeft size={14} />
            Haritaya dön
          </Link>
          <h1 className="text-2xl font-bold tracking-[-0.01em] text-text">Yönetim paneli</h1>
          <p className="mt-1 text-[13.5px] text-text-secondary">
            Veri kaynağı: {meta.source} · {meta.count.toLocaleString("tr-TR")} kayıt · anlık görüntü{" "}
            {new Date(meta.generated_at).toLocaleDateString("tr-TR")}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-text-muted">
            {meta.cities.map((city) => (
              <span key={city.slug}>
                {city.label}:{" "}
                <span className="tabular-nums">{city.count.toLocaleString("tr-TR")}</span>
              </span>
            ))}
          </p>
        </div>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Toplam mekan" value={places.length.toLocaleString("tr-TR")} />
        <Stat label="Bekleyen bildirim" value={String(pending.length)} highlight={pending.length > 0} />
        <Stat label="Toplam katkı" value={String(contributions.length)} />
        <Stat label="Uygulanan düzeltme" value={String(Object.keys(overrides).length)} />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-[15px] font-semibold text-text">Kategori dağılımı</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((category) => {
            const Icon = category.icon;
            const count = counts[category.slug] ?? 0;
            return (
              <div
                key={category.slug}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-surface p-3"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: category.tint }}
                >
                  <Icon size={17} color={category.pin} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-text">{category.shortLabel}</p>
                  <p className="text-[12px] tabular-nums text-text-secondary">
                    {count.toLocaleString("tr-TR")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* One gate around both tools, not one each: a single token entry,
          and the mutation routes behind them re-verify every request anyway
          (the gate is honest UI, not the security boundary). */}
      <AdminTokenGate>
        <section className="mb-8">
          <h2 className="mb-3 text-[15px] font-semibold text-text">Mekan düzenle</h2>
          <AdminPlaceEditor />
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold text-text">
            Moderasyon kuyruğu
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning">
                {pending.length} bekliyor
              </span>
            )}
          </h2>
          <AdminQueue initialContributions={contributions} />
        </section>
      </AdminTokenGate>
    </main>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="rounded-xl border p-3.5"
      style={{
        borderColor: highlight ? "var(--warning)" : "var(--border)",
        background: highlight ? "var(--warning-soft)" : "var(--surface)",
      }}
    >
      <p className="text-[12px] font-medium text-text-secondary">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-text">{value}</p>
    </div>
  );
}
