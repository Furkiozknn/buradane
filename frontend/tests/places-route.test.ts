import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { GET as placesGET } from "@/app/api/places/route";

/**
 * GET /api/places - the route handler the live map actually calls.
 *
 * Every guard in it was written after a measured incident (a 42 MB
 * response from `limit=-1`, an 18 s country-wide scan from an unscoped
 * query, a 34 s one from `radius_m=5000000`), yet none of them had a test:
 * the suite exercised queryPlaces() directly and never the door in front
 * of it. These pin the doors.
 */

// Sultanahmet, the same viewport the README screenshot shows.
const OK_BBOX = "28.97,41.00,28.99,41.01";

function get(query: string, headers: Record<string, string> = {}) {
  return placesGET(new Request(`http://localhost/api/places?${query}`, { headers }));
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: string };
  return body.error ?? "";
}

describe("GET /api/places - coordinate validation", () => {
  it("answers a valid viewport with real places", async () => {
    const response = await get(`bbox=${OK_BBOX}&limit=5`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { places: unknown[]; total: number };
    expect(body.places.length).toBe(5);
    expect(body.total).toBeGreaterThan(5);
  });

  // The next three answered 200 + an empty list before - indistinguishable
  // from "there is nothing here". The backend already refused them.
  it("refuses an inverted bbox instead of answering an empty 200", async () => {
    const response = await get("bbox=28.99,41.01,28.97,41.00");
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/min ≤ max/);
  });

  it("refuses a bbox outside the globe", async () => {
    const response = await get("bbox=500,40,501,41");
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/-180\.\.180/);
  });

  it("refuses lat/lon outside the globe", async () => {
    const response = await get("lat=500&lon=29&radius_m=1000");
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/-90\.\.90/);
  });

  it("refuses non-numeric bbox parts", async () => {
    expect((await get("bbox=nan,41,29,41.1")).status).toBe(400);
    expect((await get("bbox=1,2,3")).status).toBe(400);
  });

  it("requires lat and lon together", async () => {
    expect((await get("lat=41&radius_m=1000")).status).toBe(400);
  });
});

describe("GET /api/places - cost guards", () => {
  it("refuses a query with no geography (the 18 s national scan)", async () => {
    const response = await get("category=tuvalet");
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/konum gerekli/);
  });

  it("refuses a country-sized bbox", async () => {
    const response = await get("bbox=26,36,45,42");
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(/çok geniş/);
  });

  it("refuses an over-long free-text query", async () => {
    const response = await get(`bbox=${OK_BBOX}&q=${"a".repeat(121)}`);
    expect(response.status).toBe(400);
  });

  it("clamps limit to at least one and at most 300", async () => {
    const negative = (await (await get(`bbox=${OK_BBOX}&limit=-1`)).json()) as { places: unknown[] };
    expect(negative.places.length).toBe(1);

    const huge = (await (await get("lat=41.0082&lon=28.9784&radius_m=5000&limit=100000")).json()) as {
      places: unknown[];
      total: number;
    };
    expect(huge.total).toBeGreaterThan(300);
    expect(huge.places.length).toBe(300);
  });

  it("gzips the body when the client accepts it", async () => {
    const response = await get(`bbox=${OK_BBOX}&limit=3`, { "accept-encoding": "gzip, br" });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const body = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"));
    expect(body.places).toHaveLength(3);
  });
});
