import type { Place } from "./types";

/**
 * The admin place editor's search request and response handling, kept out
 * of the component so the node-only test suite can pin it.
 *
 * The editor once searched through the public `/api/places?q=` with no
 * location; that route requires a scope and answered 400, and the editor's
 * `if (!response.ok) return;` turned every search into a silent empty list.
 * Both halves of that bug live here now: the URL names the admin route and
 * a province, and a non-OK answer becomes a message the admin can read.
 */

export function adminPlaceSearchUrl(province: string, term: string, limit = 12): string {
  const params = new URLSearchParams({ province, q: term.trim(), limit: String(limit) });
  return `/api/admin/places?${params.toString()}`;
}

export type AdminSearchOutcome = { ok: true; places: Place[] } | { ok: false; error: string };

export async function readAdminSearch(response: Response): Promise<AdminSearchOutcome> {
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // A proxy error page or an empty body - the status line still says
    // what happened, so fall through to the generic message below.
  }
  const body = (data ?? {}) as { places?: Place[]; error?: unknown };
  if (!response.ok) {
    const error =
      typeof body.error === "string" && body.error
        ? body.error
        : `Arama başarısız (HTTP ${response.status})`;
    return { ok: false, error };
  }
  return { ok: true, places: Array.isArray(body.places) ? body.places : [] };
}
