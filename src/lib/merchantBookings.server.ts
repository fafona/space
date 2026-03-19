import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sanitizeMerchantBookingEditableInput,
  type MerchantBookingActionInput,
  type MerchantBookingCreateInput,
  type MerchantBookingRecord,
  type MerchantBookingStoredRecord,
  validateMerchantBookingInput,
  withoutMerchantBookingToken,
} from "./merchantBookings";

type MerchantBookingStoreFile = {
  version: 1;
  records: MerchantBookingStoredRecord[];
};

const STORE_VERSION = 1 as const;
const BOOKING_STORE_PATH = path.join(process.cwd(), ".runtime", "merchant-bookings.json");
const LOCK_KEY = "__merchantBookingsQueue";

function getGlobalLockStore() {
  return globalThis as typeof globalThis & {
    [LOCK_KEY]?: Promise<void>;
  };
}

async function withBookingStoreLock<T>(task: () => Promise<T>) {
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

async function ensureBookingStoreFile() {
  await mkdir(path.dirname(BOOKING_STORE_PATH), { recursive: true });
}

async function readMerchantBookingStore(): Promise<MerchantBookingStoreFile> {
  await ensureBookingStoreFile();
  try {
    const raw = await readFile(BOOKING_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<MerchantBookingStoreFile>;
    if (!Array.isArray(parsed.records)) {
      return { version: STORE_VERSION, records: [] };
    }
    return {
      version: STORE_VERSION,
      records: parsed.records.filter((item) => item && typeof item === "object") as MerchantBookingStoredRecord[],
    };
  } catch {
    return { version: STORE_VERSION, records: [] };
  }
}

async function writeMerchantBookingStore(store: MerchantBookingStoreFile) {
  await ensureBookingStoreFile();
  await writeFile(BOOKING_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function createEditToken() {
  return randomBytes(18).toString("hex");
}

export async function createMerchantBooking(input: MerchantBookingCreateInput): Promise<{
  booking: MerchantBookingRecord;
  editToken: string;
}> {
  const editable = sanitizeMerchantBookingEditableInput(input);
  const issues = validateMerchantBookingInput(editable);
  if (!input.siteId.trim()) {
    issues.push("站点信息缺失");
  }
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const now = new Date().toISOString();
    const record: MerchantBookingStoredRecord = {
      id: randomUUID(),
      siteId: input.siteId.trim(),
      siteName: String(input.siteName ?? "").trim(),
      ...editable,
      status: "active",
      createdAt: now,
      updatedAt: now,
      editToken: createEditToken(),
    };
    store.records.unshift(record);
    await writeMerchantBookingStore(store);
    return {
      booking: withoutMerchantBookingToken(record),
      editToken: record.editToken,
    };
  });
}

export async function updateMerchantBooking(input: MerchantBookingActionInput): Promise<MerchantBookingRecord> {
  const bookingId = String(input.bookingId ?? "").trim();
  const editToken = String(input.editToken ?? "").trim();
  if (!bookingId || !editToken) {
    throw new Error("预约凭证缺失");
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const targetIndex = store.records.findIndex((item) => item.id === bookingId);
    if (targetIndex < 0) {
      throw new Error("预约记录不存在");
    }
    const current = store.records[targetIndex];
    if (!current || current.editToken !== editToken) {
      throw new Error("预约凭证无效");
    }

    if (input.action === "cancel") {
      const next: MerchantBookingStoredRecord = {
        ...current,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      };
      store.records[targetIndex] = next;
      await writeMerchantBookingStore(store);
      return withoutMerchantBookingToken(next);
    }

    const nextEditable = sanitizeMerchantBookingEditableInput(input.updates, current);
    const issues = validateMerchantBookingInput(nextEditable);
    if (issues.length > 0) {
      throw new Error(issues[0]);
    }
    const next: MerchantBookingStoredRecord = {
      ...current,
      ...nextEditable,
      status: current.status === "cancelled" ? "active" : current.status,
      updatedAt: new Date().toISOString(),
    };
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next);
  });
}
