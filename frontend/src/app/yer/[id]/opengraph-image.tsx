import { ImageResponse } from "next/og";

import { categoryMeta } from "@/lib/categories";
import { listCommunityPlaces } from "@/lib/contributions-store";
import { getPlaceById } from "@/lib/places-repository";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Share-preview image, generated per place.
 *
 * Deliberately typographic: the category's own color as the ground, the
 * place name large, the locality beneath. No map snapshot - a tile-server
 * screenshot would need network access at render time, would rate-limit
 * against OpenFreeMap on every crawler hit, and a generic beige square of
 * streets says less at WhatsApp-preview size than a large readable name on
 * a category color does.
 *
 * System font only: ImageResponse would need a bundled font file for
 * anything custom, and Turkish diacritics render correctly either way -
 * which is the actual requirement.
 */
export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const place = getPlaceById(decodeURIComponent(id), await listCommunityPlaces());

  const meta = categoryMeta(place?.categories[0] ?? "park");
  const name = place?.name ?? "buradane";
  const locality = place ? [place.district, place.province].filter(Boolean).join(", ") : "";
  const categories = place ? place.categories.map((slug) => categoryMeta(slug).label).join(" · ") : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: meta.pin,
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 600, opacity: 0.92 }}>
          {categories}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: name.length > 32 ? 56 : 74,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: -1,
            }}
          >
            {name}
          </div>
          {locality && <div style={{ display: "flex", fontSize: 36, opacity: 0.92 }}>{locality}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>buradane</div>
          <div style={{ display: "flex", fontSize: 26, opacity: 0.85 }}>Yakınımda ne var?</div>
        </div>
      </div>
    ),
    size,
  );
}
