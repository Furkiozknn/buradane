/**
 * Community contributions + admin overrides, persisted to a JSON file.
 *
 * The brief's requirement is that "mekan öner" / "yanlış bilgi bildir" /
 * "kapalı bildir" and the admin panel genuinely work end-to-end in the demo,
 * not that they're wired to the production database. So this is a real,
 * persistent store (survives restarts) with the same *semantics* the backend
 * enforces:
 *
 *   - a suggestion lands as `pending`, never visible in public search
 *   - a report never mutates the place record directly
 *   - only an explicit moderation action (approve) produces an override
 *     that read paths layer on top of the immutable OSM snapshot
 *
 * Replacing it with the FastAPI endpoints means swapping this module's four
 * functions - the semantics above already match backend/app/services/
 * moderation.py, so nothing above this layer changes.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { Contribution, ContributionKind, Place } from "./types";

const STORE_PATH = path.join(process.cwd(), "data", "contributions.json");

interface StoreShape {
  contributions: Contribution[];
  /** placeId -> partial Place, applied on read by the detail endpoint. */
  overrides: Record<string, Partial<Place>>;
}

const EMPTY: StoreShape = { contributions: [], overrides: {} };

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      contributions: parsed.contributions ?? [],
      overrides: parsed.overrides ?? {},
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...EMPTY };
    // A corrupt store must not take down the whole app - the demo degrades
    // to "no contributions yet" and logs, rather than 500ing every request.
    console.error("contributions store okunamadı, boş kabul ediliyor:", error);
    return { ...EMPTY };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

export async function listContributions(): Promise<Contribution[]> {
  const store = await readStore();
  return [...store.contributions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addContribution(input: {
  kind: ContributionKind;
  placeId?: string | null;
  placeName?: string | null;
  payload?: Record<string, unknown>;
  note?: string | null;
}): Promise<Contribution> {
  const store = await readStore();

  const contribution: Contribution = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    placeId: input.placeId ?? null,
    placeName: input.placeName ?? null,
    payload: input.payload ?? {},
    note: input.note ?? null,
    status: "pending", // never auto-published, same rule as the backend
    createdAt: new Date().toISOString(),
  };

  store.contributions.push(contribution);
  await writeStore(store);
  return contribution;
}

export async function moderateContribution(
  id: string,
  action: "approve" | "reject",
): Promise<Contribution | null> {
  const store = await readStore();
  const contribution = store.contributions.find((c) => c.id === id);
  if (!contribution) return null;

  contribution.status = action === "approve" ? "approved" : "rejected";

  // Approving a "closed" report is the only path that changes what the
  // public sees - and even then it sets a status, it doesn't delete data.
  if (action === "approve" && contribution.placeId) {
    if (contribution.kind === "report_closed") {
      store.overrides[contribution.placeId] = {
        ...(store.overrides[contribution.placeId] ?? {}),
        status: "temporarily_closed",
      };
    }
    if (contribution.kind === "report_incorrect") {
      store.overrides[contribution.placeId] = {
        ...(store.overrides[contribution.placeId] ?? {}),
        // Surfaces as "Bilgi güncelliği düşük" in the UI rather than
        // silently hiding the disputed record.
        reliability_score: 0.25,
      };
    }
  }

  await writeStore(store);
  return contribution;
}

export async function getPlaceOverrides(placeId: string): Promise<Partial<Place>> {
  const store = await readStore();
  return store.overrides[placeId] ?? {};
}

export async function setPlaceOverride(placeId: string, patch: Partial<Place>): Promise<void> {
  const store = await readStore();
  store.overrides[placeId] = { ...(store.overrides[placeId] ?? {}), ...patch };
  await writeStore(store);
}

export async function clearPlaceOverride(placeId: string): Promise<void> {
  const store = await readStore();
  delete store.overrides[placeId];
  await writeStore(store);
}

export async function listOverrides(): Promise<Record<string, Partial<Place>>> {
  return (await readStore()).overrides;
}

/** Approved suggestions become real, queryable places in the demo - stored
 * separately from the OSM snapshot so the two never get confused. */
export async function listApprovedSuggestions(): Promise<Contribution[]> {
  const store = await readStore();
  return store.contributions.filter((c) => c.kind === "suggestion" && c.status === "approved");
}
