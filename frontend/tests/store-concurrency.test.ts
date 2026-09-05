import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addContribution,
  listContributions,
  moderateContribution,
  setPlaceOverride,
} from "@/lib/contributions-store";

/**
 * The store is a whole-file JSON read-modify-write. Before the lock, two
 * interleaved writers both read the same file and both wrote the whole
 * thing back - last writer wins, the other side's contribution silently
 * gone, unrecoverable. Two people tapping "Evet, burada" at the same moment
 * is the app's single most common write, so this was not a hypothetical.
 *
 * Isolation: BURADANE_DATA_DIR points every test at its own temp directory,
 * so the suite can hammer the store without ever touching the real
 * data/contributions.json - the file that holds actual runtime state.
 */

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "buradane-store-"));
  process.env.BURADANE_DATA_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.BURADANE_DATA_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("store concurrency", () => {
  it("loses no contribution when many land at once", async () => {
    // Fired without awaiting in between - the exact interleaving that used
    // to make last-writer-wins eat everyone else's write.
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        addContribution({
          kind: "verify_present",
          placeId: `node/${i}`,
          placeName: `Mekan ${i}`,
        }),
      ),
    );

    const stored = await listContributions();
    expect(stored).toHaveLength(N);
    // Every distinct place made it - not N copies of the winner.
    expect(new Set(stored.map((c) => c.placeId)).size).toBe(N);
  });

  it("counts concurrent verifications of the SAME place without losing any", async () => {
    // Same row, same field, incremented - the hardest case for a
    // read-modify-write race, and exactly what simultaneous "Evet, burada"
    // taps produce.
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () =>
        addContribution({ kind: "verify_present", placeId: "node/1", placeName: "Çeşme" }),
      ),
    );

    const raw = JSON.parse(await fs.readFile(path.join(tempDir, "contributions.json"), "utf-8"));
    expect(raw.overrides["node/1"].verification_count).toBe(N);
  });

  it("keeps mixed writers consistent", async () => {
    // Contributions, moderation and admin overrides all share the one file;
    // the lock has to serialise across kinds, not just within one.
    const [suggestion] = await Promise.all([
      addContribution({
        kind: "suggestion",
        placeName: "Karışık Yük Testi",
        payload: { name: "Karışık Yük Testi", lat: 41.01, lon: 28.97, categories: ["su"] },
      }),
      addContribution({ kind: "verify_present", placeId: "node/2", placeName: "A" }),
      setPlaceOverride("node/3", { status: "temporarily_closed" }),
    ]);

    const result = await moderateContribution(suggestion.id, "approve");
    expect(result.ok).toBe(true);

    const raw = JSON.parse(await fs.readFile(path.join(tempDir, "contributions.json"), "utf-8"));
    expect(raw.contributions).toHaveLength(2);
    expect(raw.overrides["node/2"].verification_count).toBe(1);
    expect(raw.overrides["node/3"].status).toBe("temporarily_closed");
    expect(raw.places).toHaveLength(1);
  });

  it("never leaves a torn file behind", async () => {
    // Write-then-rename means the store file on disk is always a complete
    // JSON document; temp files must not accumulate either.
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        addContribution({ kind: "verify_present", placeId: `node/${i}`, placeName: "x" }),
      ),
    );
    const entries = await fs.readdir(tempDir);
    expect(entries).toEqual(["contributions.json"]);
    // Parses cleanly - a truncated write would throw here.
    JSON.parse(await fs.readFile(path.join(tempDir, "contributions.json"), "utf-8"));
  });

  it("keeps serving after one operation fails", async () => {
    // The queue must not stay poisoned by a rejected operation: the failure
    // belongs to its caller, not to every write that comes after.
    const bad = moderateContribution("boyle-bir-id-yok", "approve");
    await expect(bad).resolves.toEqual({ ok: false, reason: "not_found" });

    await addContribution({ kind: "verify_present", placeId: "node/9", placeName: "Sonrası" });
    expect(await listContributions()).toHaveLength(1);
  });
});
