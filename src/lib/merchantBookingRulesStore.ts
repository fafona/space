import path from "node:path";
import type { Block } from "@/data/homeBlocks";
import {
  buildMerchantBookingRulesSnapshot,
  normalizeMerchantBookingRulesSnapshot,
  type MerchantBookingRulesSnapshot,
} from "./merchantBookingRules";
import {
  loadMerchantBookingPersistenceValue,
  merchantBookingPersistenceValuesEqual,
  saveMerchantBookingPersistenceValue,
} from "./merchantBookingPersistenceStore";
import { readJsonFileWithBackup, writeJsonFileWithBackup } from "./resilientJsonFileStore";
import { createServerSupabaseServiceClient } from "./superAdminServer";

type MerchantBookingRulesStoreFile = {
  version: 1;
  snapshots: Record<string, MerchantBookingRulesSnapshot>;
};

const STORE_VERSION = 1 as const;
const BOOKING_RULES_STORE_PATH = path.join(process.cwd(), ".runtime", "merchant-booking-rules.json");
const LOCK_KEY = "__merchantBookingRulesQueue";

function getGlobalLockStore() {
  return globalThis as typeof globalThis & {
    [LOCK_KEY]?: Promise<void>;
  };
}

async function withBookingRulesStoreLock<T>(task: () => Promise<T>) {
  const lockStore = getGlobalLockStore();
  const previous = lockStore[LOCK_KEY] ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  lockStore[LOCK_KEY] = previous.then(() => current);
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function normalizeBookingRulesStore(value: unknown): MerchantBookingRulesStoreFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as Partial<MerchantBookingRulesStoreFile>;
  if (!parsed.snapshots || typeof parsed.snapshots !== "object" || Array.isArray(parsed.snapshots)) {
    return null;
  }
  const nextSnapshots: Record<string, MerchantBookingRulesSnapshot> = {};
  Object.entries(parsed.snapshots).forEach(([siteId, snapshot]) => {
    const normalizedSiteId = siteId.trim();
    const normalized = normalizeMerchantBookingRulesSnapshot(snapshot);
    if (!normalizedSiteId || !normalized) return;
    nextSnapshots[normalizedSiteId] = normalized;
  });
  return {
    version: STORE_VERSION,
    snapshots: nextSnapshots,
  };
}

async function readLocalBookingRulesStore(): Promise<MerchantBookingRulesStoreFile> {
  return readJsonFileWithBackup<MerchantBookingRulesStoreFile>(
    BOOKING_RULES_STORE_PATH,
    { version: STORE_VERSION, snapshots: {} },
    normalizeBookingRulesStore,
  );
}

async function writeLocalBookingRulesStore(store: MerchantBookingRulesStoreFile) {
  await writeJsonFileWithBackup(BOOKING_RULES_STORE_PATH, store);
}

function bookingRulesStoresEqual(left: MerchantBookingRulesStoreFile, right: MerchantBookingRulesStoreFile) {
  return merchantBookingPersistenceValuesEqual(left, right);
}

function snapshotTimestamp(snapshot: MerchantBookingRulesSnapshot) {
  const timestamp = Date.parse(snapshot.publishedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function mergeBookingRulesStores(
  localStore: MerchantBookingRulesStoreFile,
  remoteStore: MerchantBookingRulesStoreFile,
) {
  const snapshots: Record<string, MerchantBookingRulesSnapshot> = {
    ...localStore.snapshots,
  };
  Object.entries(remoteStore.snapshots).forEach(([siteId, snapshot]) => {
    const local = snapshots[siteId];
    if (!local || snapshotTimestamp(snapshot) >= snapshotTimestamp(local)) {
      snapshots[siteId] = snapshot;
    }
  });
  return {
    version: STORE_VERSION,
    snapshots,
  } satisfies MerchantBookingRulesStoreFile;
}

async function readBookingRulesStore(): Promise<MerchantBookingRulesStoreFile> {
  const localStore = await readLocalBookingRulesStore();
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return localStore;

  const remote = await loadMerchantBookingPersistenceValue(
    supabase,
    "rules",
    normalizeBookingRulesStore,
  );
  const remoteStore = remote?.value ?? { version: STORE_VERSION, snapshots: {} };
  const mergedStore = mergeBookingRulesStores(localStore, remoteStore);

  if (!remote || remote.recoveredFromBackup || !bookingRulesStoresEqual(mergedStore, remoteStore)) {
    await saveMerchantBookingPersistenceValue(
      supabase,
      "rules",
      mergedStore,
      new Date().toISOString(),
      remote?.recoveredFromBackup ? { preserveCurrentAsBackup: false } : undefined,
    );
  }
  if (!bookingRulesStoresEqual(mergedStore, localStore)) {
    await writeLocalBookingRulesStore(mergedStore);
  }
  return mergedStore;
}

async function writeBookingRulesStore(store: MerchantBookingRulesStoreFile) {
  const supabase = createServerSupabaseServiceClient();
  if (supabase) {
    await saveMerchantBookingPersistenceValue(supabase, "rules", store);
  }
  await writeLocalBookingRulesStore(store);
}

export async function migrateMerchantBookingRulesPersistence() {
  const store = await readBookingRulesStore();
  return Object.keys(store.snapshots).length;
}

export async function loadMerchantBookingRulesSnapshot(siteId: string) {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return null;
  const store = await readBookingRulesStore();
  return store.snapshots[normalizedSiteId] ?? null;
}

export async function saveMerchantBookingRulesSnapshotForSites(
  siteIds: string[],
  blocks: Block[],
  publishedAt: string,
) {
  const normalizedSiteIds = [...new Set(siteIds.map((siteId) => String(siteId ?? "").trim()).filter(Boolean))];
  if (normalizedSiteIds.length === 0) return;
  await withBookingRulesStoreLock(async () => {
    const store = await readBookingRulesStore();
    normalizedSiteIds.forEach((siteId) => {
      store.snapshots[siteId] = buildMerchantBookingRulesSnapshot(siteId, blocks, publishedAt);
    });
    await writeBookingRulesStore(store);
  });
}
