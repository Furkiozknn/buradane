"use client";

import { useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Bookmark,
  Check,
  CircleAlert,
  Clock,
  ExternalLink,
  Flag,
  Globe,
  MapPin,
  Navigation,
  Phone,
  Share2,
  ShieldCheck,
} from "lucide-react";

import { AMENITIES, categoryMeta } from "@/lib/categories";
import { formatDistance, walkingMinutes } from "@/lib/geo";
import { humanizeOpeningHours, isOpenNow, openStateLabel } from "@/lib/opening-hours";
import { directionsUrl, osmUrl } from "@/lib/directions";
import type { Place } from "@/lib/types";
import { ReportDialog } from "./ReportDialog";

export function PlaceDetail({
  place,
  onBack,
  onVerified,
  isFavorite = false,
  onToggleFavorite,
}: {
  place: Place;
  onBack: () => void;
  /** Lets the list/map pick up the new freshness immediately instead of
   * waiting for the next query. */
  onVerified?: (placeId: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (placeId: string) => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [shared, setShared] = useState(false);
  const primary = categoryMeta(place.categories[0]);
  const Icon = primary.icon;
  const openState = isOpenNow(place.opening_hours_raw);
  const hours = humanizeOpeningHours(place.opening_hours_raw);

  // Split into what we know is true, and what we genuinely don't know. The
  // second list matters: hiding unknowns would let the UI imply "no".
  /** Native share sheet where it exists (mobile), clipboard fallback
   * everywhere else.
   *
   * Shares /yer/<id>, not the current map URL: the map URL works but
   * unfurls as the generic app title, while the place page carries real
   * metadata and a per-place preview image - and in a messaging app the
   * unfurl IS the message. The recipient still reaches the map in one tap
   * from that page. */
  async function share() {
    const url = `${window.location.origin}/yer/${encodeURIComponent(place.id)}`;
    const text = `${place.name} — ${primary.label}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "buradane", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // User dismissed the share sheet, or the clipboard is blocked. Neither
      // is an error worth interrupting them over.
    }
  }

  async function confirmStillHere() {
    setVerifyState("sending");
    try {
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "verify_present",
          placeId: place.id,
          placeName: place.name,
        }),
      });
      if (!response.ok) throw new Error("Doğrulama gönderilemedi");
      setVerifyState("done");
      onVerified?.(place.id);
    } catch {
      setVerifyState("error");
    }
  }

  const known = AMENITIES.filter((a) => place.amenities[a.key] === true);
  const absent = AMENITIES.filter((a) => place.amenities[a.key] === false);
  const unknown = AMENITIES.filter(
    (a) => place.amenities[a.key] === null && ["wheelchair_accessible", "baby_changing", "has_drinking_water"].includes(a.key),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-sunken"
          aria-label="Listeye dön"
        >
          <ArrowLeft size={20} />
        </button>
        <span className="text-[13px] font-medium text-text-secondary">Mekan detayı</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        {/* Hero: no stock photography. The dataset has no images, and faking
            them would be the single most dishonest thing this demo could do. */}
        <div
          className="flex h-28 items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${primary.tint}, var(--surface))` }}
        >
          <span
            className="flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm"
            style={{ background: primary.pin }}
          >
            <Icon size={30} color="#FFFFFF" aria-hidden />
          </span>
        </div>

        <div className="px-4 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {place.categories.map((slug) => {
              const meta = categoryMeta(slug);
              return (
                <span
                  key={slug}
                  className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium"
                  style={{ background: meta.tint, color: meta.onTint }}
                >
                  {meta.label}
                </span>
              );
            })}
          </div>

          <h1 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.01em] text-text">
            {place.name}
          </h1>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] text-text-secondary">
            {place.distance_m != null && (
              <span className="font-medium text-brand">
                {formatDistance(place.distance_m)} · yürüyerek {walkingMinutes(place.distance_m)} dk
              </span>
            )}
            <span>{place.price_type === "free" ? "Ücretsiz" : place.price_type === "paid" ? "Ücretli" : "Ücret bilgisi yok"}</span>
            <span
              style={{
                color:
                  openState === "open"
                    ? "var(--success)"
                    : openState === "closed"
                      ? "var(--warning)"
                      : "var(--text-muted)",
              }}
            >
              {openStateLabel(openState)}
            </span>
          </p>

          {/* Stated up front, not buried in the amenity list: being turned
              away at the door is the failure this app exists to prevent, and
              a condition someone can plan around is only useful before they
              walk. */}
          {place.access !== "public" && (
            <p
              className="mt-2 rounded-lg px-3 py-2 text-[12.5px] leading-relaxed"
              // Body text in --text, not --warning: amber on amber-soft
              // measured 4.51:1, which passes AA by a hundredth and breaks
              // the moment either token is nudged. The background already
              // carries the "there is a condition" signal; the sentence only
              // has to be readable.
              style={{ background: "var(--warning-soft)", color: "var(--text)" }}
            >
              {place.access === "customers"
                ? "OpenStreetMap kaydına göre burası müşterilere açık — girmeden önce bir şey almanız gerekebilir."
                : "OpenStreetMap kaydına göre burası izinle giriliyor — herkese açık olmayabilir."}
            </p>
          )}

          {/* `wheelchair=limited` is neither a yes nor a no, so it is not
              flattened into the boolean amenity - but hiding it would drop
              real information from the people who most need it. */}
          {place.raw_tags?.wheelchair === "limited" && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-text-secondary">
              Tekerlekli sandalye erişimi <strong>kısmen</strong> mümkün olarak kaydedilmiş.
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <a
              href={directionsUrl(place)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-brand-contrast transition-colors hover:bg-brand-hover"
            >
              <Navigation size={18} />
              Yol tarifi
            </a>
            <button
              type="button"
              onClick={() => onToggleFavorite?.(place.id)}
              aria-pressed={isFavorite}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border transition-colors hover:bg-surface-sunken"
              aria-label={isFavorite ? "Kayıtlılardan çıkar" : "Kaydet"}
              style={{ color: isFavorite ? "var(--brand)" : "var(--text-secondary)" }}
            >
              <Bookmark size={18} fill={isFavorite ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={share}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-sunken"
              aria-label="Bu yeri paylaş"
            >
              {shared ? <Check size={18} style={{ color: "var(--success)" }} /> : <Share2 size={18} />}
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-4 text-[14px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken"
            >
              <Flag size={16} />
              Sorun bildir
            </button>
          </div>

          {/* The freshness loop. Open civic data decays silently; one tap
              from someone who is physically standing there is the cheapest
              possible fix, so it gets a first-class slot rather than being
              buried in a menu. */}
          <div className="mt-3 rounded-xl border border-border p-3">
            {verifyState === "done" ? (
              <p className="flex items-center gap-2 text-[13.5px] font-medium" style={{ color: "var(--success)" }}>
                <BadgeCheck size={16} />
                Teşekkürler, kaydettik. Bugün doğrulandı olarak işaretlendi.
              </p>
            ) : (
              <>
                <p className="text-[13.5px] font-medium text-text">Bu yer hâlâ burada mı?</p>
                <p className="mt-0.5 text-[12.5px] text-text-secondary">
                  Şu an oradaysan tek dokunuşla herkes için güncelleyebilirsin.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmStillHere}
                    disabled={verifyState === "sending"}
                    className="h-10 flex-1 rounded-lg text-[13.5px] font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: "var(--success-soft)", color: "var(--success)" }}
                  >
                    {verifyState === "sending" ? "Gönderiliyor…" : "Evet, burada"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen(true)}
                    className="h-10 flex-1 rounded-lg border border-border text-[13.5px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken"
                  >
                    Yok, kapanmış
                  </button>
                </div>
                {verifyState === "error" && (
                  <p className="mt-2 text-[12.5px]" style={{ color: "var(--danger)" }} role="alert">
                    Gönderilemedi, tekrar dener misin?
                  </p>
                )}
              </>
            )}
          </div>

          {place.status === "temporarily_closed" && (
            <div
              className="mt-3 flex items-start gap-2 rounded-xl p-3 text-[13px]"
              style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
            >
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>Bu mekan için &quot;kapalı&quot; bildirimi onaylandı. Gitmeden önce teyit etmenizi öneririz.</span>
            </div>
          )}

          {(place.address_line || hours.length > 0 || place.phone || place.website) && (
            <section className="mt-5 space-y-2.5">
              {place.address_line && <InfoRow icon={<MapPin size={16} />}>{place.address_line}</InfoRow>}
              {hours.length > 0 && (
                <InfoRow icon={<Clock size={16} />}>
                  <span className="space-y-0.5">
                    {hours.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                </InfoRow>
              )}
              {place.phone && (
                <InfoRow icon={<Phone size={16} />}>
                  <a href={`tel:${place.phone}`} className="text-brand underline-offset-2 hover:underline">
                    {place.phone}
                  </a>
                </InfoRow>
              )}
              {place.website && (
                <InfoRow icon={<Globe size={16} />}>
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-brand underline-offset-2 hover:underline"
                  >
                    {place.website}
                  </a>
                </InfoRow>
              )}
            </section>
          )}

          {known.length > 0 && (
            <Section title="Özellikler">
              <ul className="grid grid-cols-2 gap-2">
                {known.map((amenity) => {
                  const AIcon = amenity.icon;
                  return (
                    <li
                      key={amenity.key}
                      className="flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-[13px] text-text"
                    >
                      <AIcon size={15} className="shrink-0 text-brand" aria-hidden />
                      {amenity.label}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {absent.length > 0 && (
            <Section title="Bulunmayan özellikler">
              <p className="text-[13px] text-text-secondary">
                {absent.map((a) => a.label).join(" · ")}
              </p>
            </Section>
          )}

          {unknown.length > 0 && (
            <Section title="Bilinmeyen bilgiler">
              <p className="text-[13px] text-text-secondary">
                {unknown.map((a) => a.label).join(" · ")} bilgisi kayıtlarda yok.
              </p>
              <p className="mt-1.5 text-[12.5px] text-text-muted">
                Buradaysanız bildirerek herkese yardımcı olabilirsiniz.
              </p>
            </Section>
          )}

          <Section title="Güvenilirlik ve kaynak">
            <div className="space-y-2.5 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <ShieldCheck size={16} className="text-brand" aria-hidden />
                  Güvenilirlik
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-text">
                  %{Math.round(place.reliability_score * 100)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="presentation">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(place.reliability_score * 100)}%`,
                    background:
                      place.reliability_score >= 0.6
                        ? "var(--success)"
                        : place.reliability_score >= 0.4
                          ? "var(--warning)"
                          : "var(--danger)",
                  }}
                />
              </div>
              <p className="flex items-center gap-1.5 text-[12.5px] text-text-secondary">
                <BadgeCheck size={14} aria-hidden />
                {place.freshness_label}
                {place.verification_count > 0 && <> · {place.verification_count} kişi doğruladı</>}
              </p>
              <p className="text-[12.5px] text-text-muted">
                Kaynak: {place.source.name} ({place.source.license})
              </p>
              <a
                href={osmUrl(place)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand underline-offset-2 hover:underline"
              >
                Kaynak kaydını gör
                <ExternalLink size={12} />
              </a>
            </div>
          </Section>
        </div>
      </div>

      {reportOpen && <ReportDialog place={place} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[13.5px] text-text">
      <span className="mt-0.5 shrink-0 text-text-muted" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
