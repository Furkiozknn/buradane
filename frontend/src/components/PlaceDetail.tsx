"use client";

import { useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  CircleAlert,
  Clock,
  ExternalLink,
  Flag,
  Globe,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
} from "lucide-react";

import { AMENITIES, categoryMeta } from "@/lib/categories";
import { formatDistance, walkingMinutes } from "@/lib/geo";
import { humanizeOpeningHours, isOpenNow, openStateLabel } from "@/lib/opening-hours";
import { directionsUrl, osmUrl } from "@/lib/directions";
import type { Place } from "@/lib/types";
import { ReportDialog } from "./ReportDialog";

export function PlaceDetail({ place, onBack }: { place: Place; onBack: () => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const primary = categoryMeta(place.categories[0]);
  const Icon = primary.icon;
  const openState = isOpenNow(place.opening_hours_raw);
  const hours = humanizeOpeningHours(place.opening_hours_raw);

  // Split into what we know is true, and what we genuinely don't know. The
  // second list matters: hiding unknowns would let the UI imply "no".
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
              onClick={() => setReportOpen(true)}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-4 text-[14px] font-medium text-text-secondary transition-colors hover:bg-surface-sunken"
            >
              <Flag size={16} />
              Sorun bildir
            </button>
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
