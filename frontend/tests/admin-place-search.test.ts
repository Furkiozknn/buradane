import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as adminPlacesGET } from "@/app/api/admin/places/route";
import { GET as publicPlacesGET } from "@/app/api/places/route";
import { adminPlaceSearchUrl, readAdminSearch } from "@/lib/admin-place-search";
import { setPlaceOverride } from "@/lib/contributions-store";
import { placesOfProvince } from "@/lib/places-repository";
import type { Place } from "@/lib/types";

/**
 * The admin place editor could never find a place.
 *
 * It searched through the public `GET /api/places?q=...&limit=12` with no
 * location. Since the national dataset landed, that route refuses any query
 * without a scope (400, "Arama için konum gerekli"), and the editor's
 * `if (!response.ok) return;` turned the refusal into an empty list with no
 * message. These tests pin the replacement: an admin-only, province-scoped
 * search route, and a client helper that surfaces a non-OK answer instead
 * of swallowing it. The public route's scope rule is asserted unchanged.
 */

const TOKEN_VAR = "BURADANE_ADMIN_TOKEN";
const TOKEN = "admin-search-test-token";
const TRUST_PROXY_VAR = "BURADANE_TRUST_PROXY";
const PROVINCE = "bayburt";

let tempDir: string;
let ipCounter = 0;
let testIp: string;

beforeEach(async () => {
  process.env[TOKEN_VAR] = TOKEN;
  process.env[TRUST_PROXY_VAR] = "1";
  testIp = `10.40.50.${ipCounter++}`;
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "buradane-admin-search-"));
  process.env.BURADANE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env[TOKEN_VAR];
  delete process.env[TRUST_PROXY_VAR];
  delete process.env.BURADANE_DATA_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

function get(url: string, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "x-forwarded-for": testIp };
  if (token) headers["x-admin-token"] = token;
  return new Request(`http://localhost${url}`, { headers });
}

async function json(response: Response): Promise<{ places?: Place[]; error?: string }> {
  return (await response.json()) as { places?: Place[]; error?: string };
}

/** A real, named record from the province file - no fixture to drift. */
function aNamedPlace(): Place {
  const place = placesOfProvince(PROVINCE).find((p) => p.name && p.name.trim().length >= 4);
  if (!place) throw new Error(`no named place in ${PROVINCE}`);
  return place;
}

describe("admin place search: the editor's request", () => {
  it("the URL the editor builds is answered with places, not a 400", async () => {
    const target = aNamedPlace();
    const url = adminPlaceSearchUrl(PROVINCE, target.name);
    expect(url.startsWith("/api/admin/places?")).toBe(true);

    const response = await adminPlacesGET(get(url));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.places?.map((p) => p.id)).toContain(target.id);
  });

  it("the old editor request is still refused by the public route - its scope rule is unchanged", async () => {
    const response = await publicPlacesGET(
      new Request("http://localhost/api/places?q=eczane&limit=12"),
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/konum gerekli/);
  });
});

describe("GET /api/admin/places", () => {
  it("requires the admin token before anything else", async () => {
    expect((await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=cami`, null))).status).toBe(401);
    expect(
      (await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=cami`, "yanlis"))).status,
    ).toBe(401);
    // Validation must not run first: an anonymous caller learns nothing
    // about which provinces exist.
    expect((await adminPlacesGET(get("/api/admin/places?province=yok&q=cami", null))).status).toBe(401);
  });

  it("requires a known province and a 2..120 character query", async () => {
    expect((await adminPlacesGET(get("/api/admin/places?q=cami"))).status).toBe(400);
    const unknown = await adminPlacesGET(get("/api/admin/places?province=atlantis&q=cami"));
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error).toMatch(/Bilinmeyen il/);
    expect((await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=c`))).status).toBe(400);
    expect(
      (await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=${"a".repeat(121)}`))).status,
    ).toBe(400);
  });

  it("caps the page and stays inside the province", async () => {
    const response = await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=ce&limit=500`));
    expect(response.status).toBe(200);
    const places = (await json(response)).places ?? [];
    expect(places.length).toBeLessThanOrEqual(50);
    const ids = new Set(placesOfProvince(PROVINCE).map((p) => p.id));
    for (const place of places) expect(ids.has(place.id)).toBe(true);

    const two = await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=ce&limit=2`));
    expect((await json(two)).places).toHaveLength(2);
  });

  it("finds a place by its OSM id", async () => {
    const target = aNamedPlace();
    const response = await adminPlacesGET(
      get(`/api/admin/places?province=${PROVINCE}&q=${encodeURIComponent(target.id)}`),
    );
    expect((await json(response)).places?.map((p) => p.id)).toEqual([target.id]);
  });

  it("finds a place the admin closed and renamed, so the edit can be reverted", async () => {
    const target = aNamedPlace();
    await setPlaceOverride(target.id, { status: "permanently_closed", name: "Zzqx Kapanan Yer" });

    const response = await adminPlacesGET(get(`/api/admin/places?province=${PROVINCE}&q=zzqx`));
    const places = (await json(response)).places ?? [];
    expect(places.map((p) => p.id)).toEqual([target.id]);
    expect(places[0].status).toBe("permanently_closed");
    expect(places[0].name).toBe("Zzqx Kapanan Yer");
  });
});

describe("readAdminSearch: a refused search is shown, not swallowed", () => {
  it("returns the server's own message on a non-OK answer", async () => {
    const outcome = await readAdminSearch(
      new Response(JSON.stringify({ error: "Arama için konum gerekli" }), { status: 400 }),
    );
    expect(outcome).toEqual({ ok: false, error: "Arama için konum gerekli" });
  });

  it("falls back to the status line when the body is not JSON", async () => {
    const outcome = await readAdminSearch(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(outcome).toEqual({ ok: false, error: "Arama başarısız (HTTP 502)" });
  });

  it("returns the places on success", async () => {
    const outcome = await readAdminSearch(new Response(JSON.stringify({ places: [] }), { status: 200 }));
    expect(outcome).toEqual({ ok: true, places: [] });
  });
});
