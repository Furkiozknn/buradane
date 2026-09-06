import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as contributionsPOST } from "@/app/api/contributions/route";
import { allPlaces } from "@/lib/places-repository";
import { getPlaceOverrides, setPlaceOverride } from "@/lib/contributions-store";

/**
 * The public write endpoint, attacked.
 *
 * A security review found that the one unauthenticated write in the app
 * could reverse token-gated moderation decisions, accumulate override
 * entries for places that do not exist, and store bodies of unbounded size
 * in a file the PUBLIC read path parses on every request. Each of those is
 * pinned here, at the route, because the route is where the guard lives.
 */

let tempDir: string;
let realPlaceId: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "buradane-abuse-"));
  process.env.BURADANE_DATA_DIR = tempDir;
  realPlaceId = allPlaces()[0].id;
});

afterEach(async () => {
  delete process.env.BURADANE_DATA_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api/contributions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // A distinct address per call so the shared 10-per-10-minutes budget
      // of one test never starves another.
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}`,
      ...headers,
    },
    body: text,
  });
}

describe("public contribution endpoint under abuse", () => {
  it("a tokenless verification cannot resurrect a place an admin closed", async () => {
    // The reversal the review demonstrated: PATCH /api/admin/places/:id is
    // token-gated, but a verification wrote status:"active" unconditionally,
    // so an anonymous click was the stronger authority.
    await setPlaceOverride(realPlaceId, { status: "permanently_closed" });

    const response = await contributionsPOST(
      post({ kind: "verify_present", placeId: realPlaceId }),
    );
    expect(response.status).toBe(201);

    const overrides = await getPlaceOverrides(realPlaceId);
    expect(overrides.status).toBe("permanently_closed");
    // Freshness still moves - that IS what a verification means.
    expect(overrides.verification_count).toBe(1);
    expect(overrides.last_verified_at).toBeTruthy();
  });

  it("rejects a placeId that names no place", async () => {
    const response = await contributionsPOST(
      post({ kind: "verify_present", placeId: "node/does-not-exist-999999" }),
    );
    expect(response.status).toBe(404);
  });

  it("does not let a crafted placeId become a key on the overrides map", async () => {
    for (const hostile of ["__proto__", "constructor", "toString"]) {
      const response = await contributionsPOST(post({ kind: "verify_present", placeId: hostile }));
      expect(response.status).toBe(404);
    }
    // Nothing was written, so nothing could pollute the map.
    const overrides = await getPlaceOverrides(realPlaceId);
    expect(Object.keys(overrides)).toEqual([]);
  });

  it("refuses an oversized body instead of storing it", async () => {
    const huge = "x".repeat(64 * 1024);
    const response = await contributionsPOST(
      post({ kind: "report_incorrect", placeId: realPlaceId, note: huge }),
    );
    expect(response.status).toBe(413);
  });

  it("caps the free-text it does store", async () => {
    const response = await contributionsPOST(
      post({
        kind: "suggestion",
        placeName: "N".repeat(2000),
        note: "A".repeat(5000),
        payload: {
          name: "Test Yeri",
          lat: 41,
          lon: 29,
          categories: ["park"],
          blob: "B".repeat(5000),
        },
      }),
    );
    expect(response.status).toBe(201);
    const stored = (await response.json()) as {
      placeName: string | null;
      note: string | null;
      payload: Record<string, unknown>;
    };
    expect(stored.placeName!.length).toBeLessThanOrEqual(300);
    expect(stored.note!.length).toBeLessThanOrEqual(1000);
    expect((stored.payload.blob as string).length).toBeLessThanOrEqual(500);
  });
});
