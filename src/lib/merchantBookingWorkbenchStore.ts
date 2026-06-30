import path from "node:path";
import {
  createDefaultMerchantBookingWorkbenchSettings,
  normalizeMerchantBookingWorkbenchSettings,
  type MerchantBookingWorkbenchSettings,
} from "./merchantBookingWorkbench";
import { readJsonFileWithBackup, writeJsonFileWithBackup } from "./resilientJsonFileStore";

type MerchantBookingWorkbenchStoreFile = {
  version: 1;
  settingsBySiteId: Record<string, MerchantBookingWorkbenchSettings>;
};

const STORE_VERSION = 1 as const;
const BOOKING_WORKBENCH_STORE_PATH = path.join(process.cwd(), ".runtime", "merchant-booking-workbench.json");
const LOCK_KEY = "__merchantBookingWorkbenchQueue";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getGlobalLockStore() {
  return globalThis as typeof globalThis & {
    [LOCK_KEY]?: Promise<void>;
  };
}

async function withBookingWorkbenchStoreLock<T>(task: () => Promise<T>) {
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

async function readBookingWorkbenchStore(): Promise<MerchantBookingWorkbenchStoreFile> {
  return readJsonFileWithBackup<MerchantBookingWorkbenchStoreFile>(
    BOOKING_WORKBENCH_STORE_PATH,
    { version: STORE_VERSION, settingsBySiteId: {} },
    (value) => {
      const parsed = value as Partial<MerchantBookingWorkbenchStoreFile>;
      const settingsBySiteId: Record<string, MerchantBookingWorkbenchSettings> = {};
      Object.entries(parsed.settingsBySiteId ?? {}).forEach(([siteId, settings]) => {
        const normalizedSiteId = trimText(siteId);
        if (!normalizedSiteId) return;
        settingsBySiteId[normalizedSiteId] = normalizeMerchantBookingWorkbenchSettings(settings);
      });
      return {
        version: STORE_VERSION,
        settingsBySiteId,
      };
    },
  );
}

async function writeBookingWorkbenchStore(store: MerchantBookingWorkbenchStoreFile) {
  await writeJsonFileWithBackup(BOOKING_WORKBENCH_STORE_PATH, store);
}

export async function loadMerchantBookingWorkbenchSettings(siteId: string) {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) return createDefaultMerchantBookingWorkbenchSettings();
  const store = await readBookingWorkbenchStore();
  return store.settingsBySiteId[normalizedSiteId] ?? createDefaultMerchantBookingWorkbenchSettings();
}

export async function saveMerchantBookingWorkbenchSettings(
  siteId: string,
  settings: MerchantBookingWorkbenchSettings,
) {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) {
    throw new Error("invalid_site_id");
  }
  const normalizedSettings = normalizeMerchantBookingWorkbenchSettings(settings);
  await withBookingWorkbenchStoreLock(async () => {
    const store = await readBookingWorkbenchStore();
    store.settingsBySiteId[normalizedSiteId] = normalizedSettings;
    await writeBookingWorkbenchStore(store);
  });
  return normalizedSettings;
}
