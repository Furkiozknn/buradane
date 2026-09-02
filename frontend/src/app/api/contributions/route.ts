import { NextResponse } from "next/server";

import { addContribution, listContributions } from "@/lib/contributions-store";
import type { ContributionKind } from "@/lib/types";

const VALID_KINDS: ContributionKind[] = [
  "suggestion",
  "report_incorrect",
  "report_closed",
  "verify_present",
];

/** GET /api/contributions - the moderation queue (admin panel reads this). */
export async function GET() {
  return NextResponse.json({ contributions: await listContributions() });
}

/**
 * POST /api/contributions - "mekan öner" / "yanlış bilgi bildir" /
 * "kapalı bildir". Always lands as `pending`; nothing a user submits shows
 * up in public search until a moderator approves it.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi" }, { status: 400 });
  }

  const kind = body.kind as ContributionKind;
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `Bilinmeyen katkı türü. Beklenen: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  if (kind === "suggestion") {
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const lat = Number(payload.lat);
    const lon = Number(payload.lon);
    const categories = Array.isArray(payload.categories) ? payload.categories : [];

    if (name.length < 2) {
      return NextResponse.json({ error: "Mekan adı en az 2 karakter olmalı" }, { status: 400 });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return NextResponse.json({ error: "Geçerli bir konum gerekli" }, { status: 400 });
    }
    if (categories.length === 0) {
      return NextResponse.json({ error: "En az bir kategori seçilmeli" }, { status: 400 });
    }
  } else if (typeof body.placeId !== "string" || !body.placeId) {
    return NextResponse.json({ error: "Rapor için placeId gerekli" }, { status: 400 });
  }

  const contribution = await addContribution({
    kind,
    placeId: typeof body.placeId === "string" ? body.placeId : null,
    placeName: typeof body.placeName === "string" ? body.placeName : null,
    payload: (body.payload ?? {}) as Record<string, unknown>,
    note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
  });

  return NextResponse.json(contribution, { status: 201 });
}
