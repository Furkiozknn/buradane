import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";
import { addContribution, listContributions } from "@/lib/contributions-store";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import type { ContributionKind } from "@/lib/types";

const VALID_KINDS: ContributionKind[] = [
  "suggestion",
  "report_incorrect",
  "report_closed",
  "verify_present",
];

/**
 * GET /api/contributions - the moderation queue.
 *
 * Admin-token gated even though it lives outside /api/admin/: it is an
 * admin surface (the only in-app reader is the moderation panel), and its
 * rows carry free-text notes people wrote for moderators, not for the
 * public. The write half below stays open - contributing is the public
 * act, reading the queue is not.
 */
export async function GET(request: Request) {
  const auth = checkAdminAuth(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);
  return NextResponse.json({ contributions: await listContributions() });
}

/**
 * POST /api/contributions - "mekan öner" / "yanlış bilgi bildir" /
 * "kapalı bildir". Always lands as `pending`; nothing a user submits shows
 * up in public search until a moderator approves it.
 */
export async function POST(request: Request) {
  // Rate-limited because this is the only unauthenticated write in the app
  // and it lands in a JSON file with no other size guard. The window is
  // generous on purpose - a person filing 2-3 reports back to back must
  // never notice it - while a script hammering the endpoint gets a 429 and
  // an honest Retry-After instead of a growing file. See rate-limit.ts for
  // what an in-memory limiter can and cannot promise.
  const limit = checkRateLimit(getClientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: `Kısa sürede çok fazla katkı gönderildi. Lütfen ${limit.retryAfterSeconds} saniye sonra tekrar deneyin.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

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
