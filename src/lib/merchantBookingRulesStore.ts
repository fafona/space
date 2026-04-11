import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Block } from "@/data/homeBlocks";
import {
  buildMerchantBookingRulesSnapshot,
  normalizeMerchantBookingRulesSnapshot,
  type MerchantBookingRulesSnapshot,
} from "./merchantBookingRules";

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

async function ensureBookingRulesStoreFile() {
  await mkdir(path.dirname(BOOKING_RULES_STORE_PATH), { recursive: true });
}

async function readBookingRulesStore(): Promise<MerchantBookingRulesStoreFile> {
  await ensureBookingRulesStoreFile();
  try {
    const raw = await readFile(BOOKING_RULES_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MerchantBookingRulesStoreFile>;
    const nextSnapshots: Record<string, MerchantBookingRulesSnapshot> = {};
    Object.entries(parsed.snapshots ?? {}).forEach(([siteId, snapshot]) => {
      const normalized = normalizeMerchantBookingRulesSnapshot(snapshot);
      if (!normalized) return;
      nextSnapshots[siteId.trim()] = normalized;
    });
    return {
      version: STORE_VERSION,
      snapshots: nextSnapshots,
    };
  } catch {
    return { version: STORE_VERSION, snapshots: {} };
  }
}

async function writeBookingRulesStore(store: MerchantBookingRulesStoreFile) {
  await ensureBookingRulesStoreFile();
  await writeFile(BOOKING_RULES_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
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
