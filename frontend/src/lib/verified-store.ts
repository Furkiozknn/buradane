/**
 * Which places this device has already confirmed as "still here", and when.
 *
 * The confirm button used to vanish after one tap and come back on the next
 * visit, so nothing on screen said the tap had counted and nothing stopped a
 * second one. Stored per device and per place, account-free like the saved
 * places (use-favorites.ts): the count everyone sees comes from the server,
 * this only remembers *this* person's own tap so the panel can say so.
 *
 * Pure functions over a storage-shaped object so the rules are testable
 * without a browser.
 */

export const VERIFIED_STORAGE_KEY = "buradane:dogrulananlar:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type VerifiedMap = Record<string, string>;

function read(storage: StorageLike): VerifiedMap {
  try {
    const raw = storage.getItem(VERIFIED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: VerifiedMap = {};
    for (const [id, when] of Object.entries(parsed)) {
      if (typeof when === "string") out[id] = when;
    }
    return out;
  } catch {
    // Corrupt or blocked storage must never break the detail panel.
    return {};
  }
}

/** Local calendar day, so "today" means the user's today. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function wasVerifiedToday(storage: StorageLike, placeId: string, now: Date = new Date()): boolean {
  const when = read(storage)[placeId];
  if (!when) return false;
  const then = new Date(when);
  return !Number.isNaN(then.getTime()) && dayKey(then) === dayKey(now);
}

export function markVerified(storage: StorageLike, placeId: string, now: Date = new Date()): void {
  const map = read(storage);
  map[placeId] = now.toISOString();
  // Keep the newest 200 so the list cannot grow without bound.
  const kept = Object.entries(map)
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, 200);
  try {
    storage.setItem(VERIFIED_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage full or blocked: the tap still counted server-side.
  }
}
