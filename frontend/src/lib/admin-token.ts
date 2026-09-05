"use client";

/**
 * Client half of the admin token flow.
 *
 * The server half (frontend/src/lib/admin-auth.ts) fails closed and never
 * ships the secret anywhere; this module only handles what the browser has
 * to do with a token the admin typed in: keep it for the session and attach
 * it to admin requests.
 *
 * `sessionStorage`, not `localStorage`, deliberately: the token dies with
 * the tab. An admin secret that silently survives on a shared or borrowed
 * machine for weeks is a worse failure than an admin having to re-paste it
 * tomorrow. And it is never baked into the bundle - `NEXT_PUBLIC_*` would
 * put the secret in every visitor's JavaScript, which is the one wrong
 * answer this design exists to avoid.
 *
 * Every storage access is wrapped: `sessionStorage` throws in some contexts
 * (privacy modes, storage-blocked browsers), and the admin panel degrading
 * to "paste the token again" beats it crashing.
 */

const STORAGE_KEY = "buradane:admin-token";

/** Fired when a request discovers the stored token no longer works, so the
 * gate can drop back to the entry form without polling storage. */
export const ADMIN_TOKEN_CLEARED_EVENT = "buradane:admin-token-cleared";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage being unavailable is survivable: the token just lives in the
    // gate's React state for this page view instead.
  }
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage never worked.
  }
}

/**
 * `fetch` for admin mutations: attaches the stored token and, on a 401,
 * clears it and tells the gate - a token the server just rejected is not
 * going to work on the next click either, so every admin control locking up
 * behind individual per-request errors would only obscure the real state.
 * The 401 response is still returned so the caller can surface the server's
 * own Turkish message for THIS action.
 */
export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-admin-token", token);

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    clearAdminToken();
    try {
      window.dispatchEvent(new Event(ADMIN_TOKEN_CLEARED_EVENT));
    } catch {
      // A missed event only means the gate resets on the next full check.
    }
  }

  return response;
}
