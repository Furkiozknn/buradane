import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Accessibility,
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Clock,
  MapPin,
  Navigation,
} from "lucide-react";

import { AMENITY_BY_KEY, categoryMeta } from "@/lib/categories";
import { listCommunityPlaces, getPlaceOverrides } from "@/lib/contributions-store";
import { applyOverride, getPlaceById } from "@/lib/places-repository";
import type { AmenityKey, Place } from "@/lib/types";

/**
 * Server-rendered, shareable page for one place: /yer/node%2F123456.
 *
 * "Şu tuvaleti arkadaşıma yollayayım" is a primary use of a civic finder,
 * and until this existed every shared link unfurled as the same generic
 * app title - the recipient learned nothing before tapping. This page gives
 * each place real metadata (title, description, OG image) and a readable
 * fallback for anyone who lands here without JavaScript, then hands off to
 * the map.
 *
 * A Turkish URL on purpose: the product is Turkish, its users read Turkish,
 * and /yer/ reads as what it is.
 */

async function loadPlace(rawId: string): Promise<Place | null> {
  // Place ids contain a slash ("node/123"), which arrives percent-encoded.
  const id = decodeURIComponent(rawId);
  const communityPlaces = await listCommunityPlaces();
  const base = getPlaceById(id, communityPlaces);
  if (!base) return null;
  // Same composition as the detail API: admin edits and community
  // verifications layer on read, so this page never shows a state the app
  // itself would not.
  const overrides = await getPlaceOverrides(id);
  const place = applyOverride(base, overrides);
  // A closed or unreviewed record must not gain a shareable, indexable page.
  if (place.status === "pending_review" || place.status === "permanently_closed") return null;
  if (place.access === "private") return null;
  return place;
}

function describe(place: Place): string {
  // Built only from what is actually known. `null` means unknown here as
  // everywhere else - a share description that invents "ücretsiz" or
  // "engelli erişimli" would put the lie in the WhatsApp preview itself.
  const parts: string[] = [];
  parts.push(place.categories.map((slug) => categoryMeta(slug).label).join(", "));
  if (place.district || place.province) {
    parts.push([place.district, place.province].filter(Boolean).join(", "));
  }
  if (place.price_type === "free") parts.push("Ücretsiz");
  if (place.price_type === "paid") parts.push("Ücretli");
  if (place.amenities.wheelchair_accessible === true) parts.push("Engelli erişimli");
  if (place.is_24h === true) parts.push("7/24 açık");
  return parts.join(" · ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const place = await loadPlace(id);
  if (!place) return { title: "Mekan bulunamadı — buradane" };

  const title = `${place.name} — buradane`;
  const description = describe(place);
  return {
    title,
    description,
    openGraph: { title, description, type: "website", locale: "tr_TR" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = await loadPlace(id);
  if (!place) notFound();

  const primary = categoryMeta(place.categories[0]);
  const knownAmenities = (Object.entries(place.amenities) as [AmenityKey, boolean | null][]).filter(
    ([, value]) => value === true,
  );
  const mapHref = `/?p=${encodeURIComponent(place.id)}&y=${place.lat.toFixed(5)}&x=${place.lon.toFixed(5)}&z=17`;
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`;

  return (
    <main className="mx-auto min-h-[100dvh] max-w-lg bg-bg px-4 py-6">
      <Link
        href="/"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-medium text-brand"
      >
        <ArrowLeft size={15} aria-hidden />
        buradane haritasına dön
      </Link>

      <div
        className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl"
        style={{ background: primary.tint }}
      >
        <primary.icon size={36} color={primary.pin} aria-hidden />
      </div>

      <div className="mb-1 flex flex-wrap gap-1.5">
        {place.categories.map((slug) => {
          const meta = categoryMeta(slug);
          return (
            <span
              key={slug}
              className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
              style={{ background: meta.tint, color: meta.onTint }}
            >
              {meta.label}
            </span>
          );
        })}
      </div>

      <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-text">
        {place.name}
      </h1>

      <div className="mt-3 space-y-2 text-[14px] text-text-secondary">
        {(place.address_line || place.district || place.province) && (
          <p className="flex items-start gap-2">
            <MapPin size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {[place.address_line, [place.district, place.province].filter(Boolean).join(", ")]
                .filter(Boolean)
                .join(" — ")}
            </span>
          </p>
        )}
        <p className="flex items-center gap-2">
          <Banknote size={15} className="shrink-0" aria-hidden />
          {place.price_type === "free"
            ? "Ücretsiz"
            : place.price_type === "paid"
              ? "Ücretli"
              : "Ücret bilgisi kayıtlarda yok"}
        </p>
        {place.is_24h === true && (
          <p className="flex items-center gap-2">
            <Clock size={15} className="shrink-0" aria-hidden />
            7/24 açık
          </p>
        )}
        {place.amenities.wheelchair_accessible === true && (
          <p className="flex items-center gap-2">
            <Accessibility size={15} className="shrink-0" aria-hidden />
            Tekerlekli sandalye erişimi var
          </p>
        )}
      </div>

      {place.access !== "public" && (
        <p
          className="mt-4 rounded-lg px-3 py-2 text-[13px] leading-relaxed"
          style={{ background: "var(--warning-soft)", color: "var(--text)" }}
        >
          {place.access === "customers"
            ? "Kayıtlara göre burası müşterilere açık — girmeden önce bir şey almanız gerekebilir."
            : "Kayıtlara göre burası izinle giriliyor — herkese açık olmayabilir."}
        </p>
      )}

      {knownAmenities.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-muted">
            Bilinen özellikler
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {knownAmenities.map(([key]) => (
              <span
                key={key}
                className="rounded-full border border-border px-2.5 py-1 text-[12.5px] text-text-secondary"
              >
                {AMENITY_BY_KEY[key].label}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="mt-5 flex items-center gap-1.5 text-[12.5px] text-text-muted">
        <BadgeCheck size={14} aria-hidden style={{ color: "var(--success)" }} />
        {place.freshness_label} · Kaynak: {place.source.name}
      </p>

      <div className="mt-6 flex flex-col gap-2">
        <Link
          href={mapHref}
          className="flex h-12 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold"
          style={{ background: "var(--brand)", color: "var(--brand-contrast)" }}
        >
          <MapPin size={16} aria-hidden />
          Haritada aç
        </Link>
        <a
          href={directionsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border text-[15px] font-medium text-text"
        >
          <Navigation size={16} aria-hidden />
          Yol tarifi al
        </a>
      </div>
    </main>
  );
}
