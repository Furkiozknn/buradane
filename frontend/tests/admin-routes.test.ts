import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as adminAuthGET } from "@/app/api/admin/auth/route";
import { PATCH as placePATCH, DELETE as placeDELETE } from "@/app/api/admin/places/[id]/route";
import { PATCH as contributionPATCH } from "@/app/api/admin/contributions/[id]/route";

/**
 * Route-level auth tests: the handlers themselves, not the helper.
 *
 * security.test.ts proves checkAdminAuth works in isolation - and that
 * proved nothing about the routes, which is exactly how DELETE
 * /api/admin/places/:id shipped with NO guard at all while the commit
 * message said the admin API was protected. Two independent reviewers
 * found it; this file exists so the third time a handler forgets the two
 * guard lines, a test goes red instead of a reviewer going looking.
 *
 * Next.js route handlers are plain functions taking (Request, context), so
 * calling them directly needs no server - the same reason the gap was so
 * cheap to close and so inexcusable to leave open.
 */

const TOKEN_VAR = "BURADANE_ADMIN_TOKEN";
const TOKEN = "route-test-token";

let tempDir: string;

beforeEach(async () => {
  process.env[TOKEN_VAR] = TOKEN;
  // The store must never touch real runtime data from tests.
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "buradane-routes-"));
  process.env.BURADANE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env[TOKEN_VAR];
  delete process.env.BURADANE_DATA_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

function req(headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("admin route guards", () => {
  it("PATCH place: no token → 401, wrong token → 401", async () => {
    expect((await placePATCH(req({}, { status: "active" }), ctx("node/1"))).status).toBe(401);
    expect(
      (await placePATCH(req({ "x-admin-token": "yanlis" }, { status: "active" }), ctx("node/1")))
        .status,
    ).toBe(401);
  });

  it("DELETE place: no token → 401 - the guard two reviews found missing", async () => {
    const response = await placeDELETE(req(), ctx("node/1"));
    expect(response.status).toBe(401);
  });

  it("DELETE place: wrong token → 401", async () => {
    const response = await placeDELETE(req({ "x-admin-token": "yanlis" }), ctx("node/1"));
    expect(response.status).toBe(401);
  });

  it("DELETE place: valid token reaches the handler (404 for a ghost id)", async () => {
    // Auth must run BEFORE existence: a 404 on an unauthenticated request
    // would leak which ids exist.
    const response = await placeDELETE(req({ "x-admin-token": TOKEN }), ctx("node/boyle-yok"));
    expect(response.status).toBe(404);
  });

  it("PATCH contribution: no token → 401, and auth precedes existence", async () => {
    expect(
      (await contributionPATCH(req({}, { action: "approve" }), ctx("hayalet"))).status,
    ).toBe(401);
    expect(
      (
        await contributionPATCH(
          req({ "x-admin-token": TOKEN }, { action: "approve" }),
          ctx("hayalet"),
        )
      ).status,
    ).toBe(404);
  });

  it("auth probe: no token → 401 with a body, valid token → 204", async () => {
    const denied = await adminAuthGET(req());
    expect(denied.status).toBe(401);
    const granted = await adminAuthGET(req({ "x-admin-token": TOKEN }));
    expect(granted.status).toBe(204);
  });

  it("fails CLOSED at the route when no token is configured", async () => {
    delete process.env[TOKEN_VAR];
    expect((await placeDELETE(req({ "x-admin-token": "her sey" }), ctx("node/1"))).status).toBe(401);
    expect(
      (await placePATCH(req({ "x-admin-token": "her sey" }, {}), ctx("node/1"))).status,
    ).toBe(401);
  });
});
