import { NextResponse } from "next/server";

import { adminAuthErrorResponse, checkAdminAuth } from "@/lib/admin-auth";
import { addContribution, listContributions } from "@/lib/contributions-store";
import { getPlaceById } from "@/lib/places-repository";
import { checkRateLimit, getClientKey } from "@/lib/rate-limit";
import type { ContributionKind } from "@/lib/types";

const VALID_KINDS: ContributionKind[] = [
  "suggestion",
  "report_incorrect",
  "report_closed",
  "verify_present",
];

const MAX_BODY_BYTES = 32 * 1024;
const MAX_PAYLOAD_KEYS = 30;
const MAX_PAYLOAD_STRING = 500;

/**
 * `payload` is stored verbatim, so it is the one field a caller could grow
 * without limit. Kept permissive in shape (the demo's suggestion payload
 * evolves) but bounded in size: a fixed number of keys, each scalar capped,
 * nested objects flattened away rather than walked.
 */
function cappedPayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value).slice(0, MAX_PAYLOAD_KEYS)) {
    if (typeof raw === "string") out[key.slice(0, 60)] = raw.slice(0, MAX_PAYLOAD_STRING);
    else if (typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      out[key.slice(0, 60)] = raw;
    } else if (Array.isArray(raw)) {
      out[key.slice(0, 60)] = raw
        .slice(0, MAX_PAYLOAD_KEYS)
        .filter((item) => typeof item === "string" || typeof item === "number")
        .map((item) => (typeof item === "string" ? item.slice(0, MAX_PAYLOAD_STRING) : item));
    }
  }
  return out;
}

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

  // Body size ceiling. App Router route handlers have NO default limit (the
  // documented one applies to Pages API routes and Server Actions), and
  // every contribution is appended to one JSON file that the public read
  // path parses on each request - so an unbounded body is not just storage,
  // it is an amplification bomb aimed at every later reader. 32 KB is far
  // above any real submission (a name, coordinates, a note capped at 1000
  // chars) and far below anything that hurts.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Gönderilen veri çok büyük" }, { status: 413 });
  }
  const rawBody = await request.text();
  // Re-checked after reading: content-length is a claim, not a guarantee.
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Gönderilen veri çok büyük" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Geçersiz JSON gövdesi" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
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
  } else if (!getPlaceById(body.placeId)) {
    // The id must name a real place. Without this the store accumulated
    // override entries for ids that do not exist - unbounded growth driven
    // entirely by the caller - and those ids became keys on a plain object,
    // so "__proto__"/"constructor"/"toString" ended up as own properties of
    // the overrides map. Existence is public information (anyone can list
    // places), so a 404 here leaks nothing.
    return NextResponse.json({ error: "Mekan bulunamadı" }, { status: 404 });
  }

  const contribution = await addContribution({
    kind,
    placeId: typeof body.placeId === "string" ? body.placeId : null,
    // Every free-text field is capped. `note` always was; these were not,
    // and they are stored verbatim in the same file.
    placeName: typeof body.placeName === "string" ? body.placeName.slice(0, 300) : null,
    payload: cappedPayload(body.payload),
    note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
  });

  return NextResponse.json(contribution, { status: 201 });
}
