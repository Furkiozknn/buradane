/**
 * "Bu yer hâlâ burada mı?" - what the panel remembers about YOUR tap.
 *
 * Before this the confirm buttons just disappeared and came back next visit,
 * so nothing said the tap had counted. These tests lock the memory rules.
 */

import { describe, expect, it } from "vitest";

import { VERIFIED_STORAGE_KEY, markVerified, wasVerifiedToday, type StorageLike } from "@/lib/verified-store";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const noon = new Date(2026, 8, 29, 12, 0);

describe("verified-store", () => {
  it("is not verified until the person taps", () => {
    expect(wasVerifiedToday(fakeStorage(), "node/1", noon)).toBe(false);
  });

  it("remembers a tap for the rest of that day, per place", () => {
    const storage = fakeStorage();
    markVerified(storage, "node/1", noon);
    expect(wasVerifiedToday(storage, "node/1", new Date(2026, 8, 29, 23, 59))).toBe(true);
    expect(wasVerifiedToday(storage, "node/2", noon)).toBe(false);
  });

  it("offers the button again the next day", () => {
    const storage = fakeStorage();
    markVerified(storage, "node/1", noon);
    expect(wasVerifiedToday(storage, "node/1", new Date(2026, 8, 30, 0, 1))).toBe(false);
  });

  it("survives corrupt storage instead of breaking the panel", () => {
    expect(wasVerifiedToday(fakeStorage({ [VERIFIED_STORAGE_KEY]: "{not json" }), "node/1", noon)).toBe(false);
    expect(wasVerifiedToday(fakeStorage({ [VERIFIED_STORAGE_KEY]: "[1,2]" }), "node/1", noon)).toBe(false);
    const storage = fakeStorage({ [VERIFIED_STORAGE_KEY]: "{not json" });
    markVerified(storage, "node/1", noon);
    expect(wasVerifiedToday(storage, "node/1", noon)).toBe(true);
  });

  it("does not throw when writing is blocked", () => {
    const blocked: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => markVerified(blocked, "node/1", noon)).not.toThrow();
  });

  it("keeps only the newest 200 places", () => {
    const storage = fakeStorage();
    for (let i = 0; i < 205; i++) markVerified(storage, `node/${i}`, new Date(2026, 8, 29, 8, 0, i));
    const kept = Object.keys(JSON.parse(storage.data[VERIFIED_STORAGE_KEY]));
    expect(kept).toHaveLength(200);
    expect(kept).not.toContain("node/0");
    expect(kept).toContain("node/204");
  });
});
