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

import type {
  Amenities,
  CategorySlug,
  Contribution,
  ContributionKind,
  Place,
  PriceType,
} from "./types";
import { AMENITIES } from "./categories";

const AMENITY_KEYS = AMENITIES.map((a) => a.key);

const STORE_PATH = path.join(process.cwd(), "data", "contributions.json");

interface StoreShape {
  contributions: Contribution[];
  /** placeId -> partial Place, applied on read by the detail endpoint. */
  overrides: Record<string, Partial<Place>>;
  /**
   * Places the community added and a moderator approved.
   *
   * Kept beside the OSM snapshot rather than written into it, for the same
   * reason overrides are: the snapshot has to stay re-importable, and a
   * re-pull from Overpass must never silently erase what people contributed.
   */
  places: Place[];
}

const EMPTY: StoreShape = { contributions: [], overrides: {}, places: [] };

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      contributions: parsed.contributions ?? [],
      overrides: parsed.overrides ?? {},
      places: parsed.places ?? [],
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

  // A positive verification ("yes, it's still here") is the one contribution
  // that applies immediately rather than queueing. That mirrors the backend:
  // confirming an existing record is low-risk (it cannot invent or delete
  // anything), its weight decays with time, and holding it for moderation
  // would defeat the entire point of a freshness signal.
  const isVerification = input.kind === "verify_present";

  const contribution: Contribution = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    placeId: input.placeId ?? null,
    placeName: input.placeName ?? null,
    payload: input.payload ?? {},
    note: input.note ?? null,
    status: isVerification ? "approved" : "pending",
    createdAt: new Date().toISOString(),
  };

  store.contributions.push(contribution);

  if (isVerification && contribution.placeId) {
    const existing = store.overrides[contribution.placeId] ?? {};
    const verificationCount = (existing.verification_count ?? 0) + 1;
    store.overrides[contribution.placeId] = {
      ...existing,
      verification_count: verificationCount,
      last_verified_at: contribution.createdAt,
      freshness_label: "Bugün doğrulandı",
      // A place someone just confirmed is standing is, by definition, not
      // closed - so an earlier approved "kapalı" report is superseded.
      status: "active",
      // Deliberately NOT storing reliability_score here. This store has no
      // idea what the place's computed score is, so writing an absolute
      // value would clobber it with a guess - the first version did exactly
      // that and a verification *lowered* a well-documented place from
      // 0.713 to 0.54. The read path owns the score and derives the
      // verification bonus from the count above.
      reliability_score: undefined,
    };
  }

  await writeStore(store);
  return contribution;
}

export type ModerationResult =
  | { ok: true; contribution: Contribution }
  | { ok: false; reason: "not_found" | "unusable_suggestion" };

export async function moderateContribution(
  id: string,
  action: "approve" | "reject",
): Promise<ModerationResult> {
  const store = await readStore();
  const contribution = store.contributions.find((c) => c.id === id);
  if (!contribution) return { ok: false, reason: "not_found" };

  // A suggestion that cannot become a place must not be recorded as
  // approved. Marking it done and creating nothing is the failure this whole
  // change exists to remove; repeating it for bad payloads would just move
  // the lie somewhere quieter.
  if (action === "approve" && contribution.kind === "suggestion" && !contribution.placeId) {
    if (!placeFromSuggestion(contribution)) {
      return { ok: false, reason: "unusable_suggestion" };
    }
  }

  contribution.status = action === "approve" ? "approved" : "rejected";

  // Rejecting after approving is an undo, and has to actually undo. Without
  // this the place stayed on the map while the queue said "Reddedildi".
  if (action === "reject" && contribution.kind === "suggestion" && contribution.placeId) {
    store.places = store.places.filter((p) => p.id !== contribution.placeId);
    contribution.placeId = null;
  }

  // Approving a suggestion is what makes contributing mean anything: before
  // this, the place was marked "Onaylandı" in the queue and then never
  // appeared anywhere, so the moderator was told the work had landed when
  // nothing had. The place joins the community layer, never the snapshot.
  if (action === "approve" && contribution.kind === "suggestion" && !contribution.placeId) {
    const place = placeFromSuggestion(contribution);
    if (place) {
      const existing = store.places.findIndex((p) => p.id === place.id);
      if (existing === -1) store.places.push(place);
      else store.places[existing] = place;
      // Recorded on the contribution so the queue can link to what it created
      // and a second approval cannot mint a duplicate.
      contribution.placeId = place.id;
    }
  }

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
  return { ok: true, contribution };
}

/**
 * Turns an approved suggestion into a real place.
 *
 * Everything the submitter did not tell us stays `null`, exactly as it would
 * for a sparse OSM node - inventing "no" for an amenity nobody mentioned is
 * the one thing this codebase refuses to do anywhere else, and a
 * community-added place is not a licence to start.
 *
 * The source is stated as community rather than OSM. Attribution accuracy is
 * not a formality here: the OSM snapshot is ODbL, and labelling a
 * user-submitted place as OSM data would misattribute it in both directions.
 */
export function placeFromSuggestion(contribution: Contribution): Place | null {
  const payload = contribution.payload as {
    name?: string;
    lat?: number;
    lon?: number;
    categories?: CategorySlug[];
    price_type?: PriceType;
    address_line?: string;
    amenities?: Partial<Amenities>;
  };

  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  // Türkiye's mainland envelope. A suggestion outside it is a bad submission
  // or a bad geocode, and admitting it would put a pin in the sea.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 35.5 || lat > 42.5 || lon < 25.5 || lon > 45) return null;

  const categories = (payload.categories ?? []).filter(Boolean);
  if (categories.length === 0) return null;

  const name = (payload.name ?? contribution.placeName ?? "").trim();
  if (!name) return null;

  const amenities = Object.fromEntries(
    AMENITY_KEYS.map((key) => [key, payload.amenities?.[key] ?? null]),
  ) as Amenities;

  return {
    id: `community/${contribution.id}`,
    name,
    lat,
    lon,
    categories,
    status: "active",
    price_type: payload.price_type ?? "unknown",
    access: "public",
    address_line: payload.address_line?.trim() || null,
    opening_hours_raw: null,
    is_24h: null,
    website: null,
    phone: null,
    description: contribution.note,
    operator: null,
    amenities,
    source: {
      slug: "community",
      name: "Topluluk katkısı",
      license: "Kullanıcı katkısı",
      url: "",
    },
    // One moderator approval and no independent confirmation yet. Starting
    // level with a well-tagged OSM node would overstate it; starting at zero
    // would bury a place somebody stood in front of. It rises the normal way,
    // through verifications.
    reliability_score: 0.5,
    freshness_label: "Topluluk tarafından eklendi",
    last_verified_at: contribution.createdAt,
    verification_count: 0,
    report_count: 0,
  };
}

/** Places the community added and a moderator approved. */
export async function listCommunityPlaces(): Promise<Place[]> {
  const store = await readStore();
  return store.places;
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
