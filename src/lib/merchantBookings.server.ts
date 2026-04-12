import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildMerchantBookingId,
  getMerchantBookingSlotCapacityIssue,
  sanitizeMerchantBookingEditableInput,
  shouldSendMerchantBookingConfirmationEmail,
  type MerchantBookingActionInput,
  type MerchantBookingCreateInput,
  type MerchantBookingEditableInput,
  type MerchantBookingRecord,
  type MerchantBookingRuleBinding,
  type MerchantBookingStatus,
  type MerchantBookingStoredRecord,
  validateMerchantBookingInput,
  withoutMerchantBookingToken,
} from "./merchantBookings";
import { sendMerchantBookingConfirmationEmail } from "./merchantBookingEmails";
import { resolveMerchantBookingRuleEntry, type MerchantBookingRuleLocator } from "./merchantBookingRules";
import { loadMerchantBookingRulesSnapshot } from "./merchantBookingRulesStore";

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

function sortNewestFirst<T extends { updatedAt?: string; createdAt?: string }>(records: T[]) {
  return [...records].sort((left, right) => {
    const leftTime = new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
    const rightTime = new Date(right.updatedAt ?? right.createdAt ?? 0).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function normalizeBookingRuleBinding(input?: MerchantBookingRuleLocator | null): MerchantBookingRuleBinding {
  return {
    bookingBlockId: String(input?.bookingBlockId ?? "").trim() || undefined,
    bookingViewport: input?.bookingViewport === "mobile" || input?.bookingViewport === "desktop" ? input.bookingViewport : undefined,
  };
}

async function resolveBookingRuleContext(
  siteId: string,
  locator?: MerchantBookingRuleLocator | null,
): Promise<{
  binding: MerchantBookingRuleBinding;
  availableTimeRanges: string[];
  timeSlotRules: NonNullable<ReturnType<typeof resolveMerchantBookingRuleEntry>>["timeSlotRules"];
  blockedDates: string[];
  holidayDates: string[];
}> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) {
    throw new Error("站点信息缺失");
  }
  const snapshot = await loadMerchantBookingRulesSnapshot(normalizedSiteId);
  if (!snapshot) {
    throw new Error("预约规则暂不可用，请稍后重试");
  }
  const rule = resolveMerchantBookingRuleEntry(snapshot, locator);
  if (!rule) {
    throw new Error("预约规则不可验证，请刷新页面后重试");
  }
  return {
    binding: {
      bookingBlockId: rule.blockId,
      bookingViewport: rule.viewport,
    },
    availableTimeRanges: rule.availableTimeRanges,
    timeSlotRules: rule.timeSlotRules,
    blockedDates: rule.blockedDates,
    holidayDates: rule.holidayDates,
  };
}

function matchesRuleBinding(record: MerchantBookingStoredRecord, binding: MerchantBookingRuleBinding) {
  return record.bookingBlockId === binding.bookingBlockId && record.bookingViewport === binding.bookingViewport;
}

export async function listMerchantBookings(siteId: string): Promise<MerchantBookingRecord[]> {
  const normalizedSiteId = String(siteId ?? "").trim();
  if (!normalizedSiteId) return [];
  const store = await readMerchantBookingStore();
  return sortNewestFirst(
    store.records
      .filter((item) => item.siteId === normalizedSiteId)
      .map((item) => withoutMerchantBookingToken(item)),
  );
}

export async function createMerchantBooking(input: MerchantBookingCreateInput): Promise<{
  booking: MerchantBookingRecord;
  editToken: string;
}> {
  const editable = sanitizeMerchantBookingEditableInput(input);
  const ruleContext = await resolveBookingRuleContext(input.siteId, normalizeBookingRuleBinding(input));
  const issues = validateMerchantBookingInput(editable, {
    availableTimeRanges: ruleContext.availableTimeRanges,
    blockedDates: ruleContext.blockedDates,
    holidayDates: ruleContext.holidayDates,
  });
  if (!input.siteId.trim()) {
    issues.push("站点信息缺失");
  }
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const slotCapacityIssue = getMerchantBookingSlotCapacityIssue(
      editable.appointmentAt,
      ruleContext.timeSlotRules,
      store.records.filter((record) => record.siteId === input.siteId.trim() && matchesRuleBinding(record, ruleContext.binding)),
    );
    if (slotCapacityIssue) {
      throw new Error(slotCapacityIssue);
    }
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const nextId = buildMerchantBookingId(
      input.siteId.trim(),
      nowDate,
      store.records.map((item) => item.id),
    );
    if (!nextId) {
      throw new Error("预约编号生成失败");
    }
    const record: MerchantBookingStoredRecord = {
      id: nextId,
      siteId: input.siteId.trim(),
      siteName: String(input.siteName ?? "").trim(),
      ...ruleContext.binding,
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
    const normalizedBinding = normalizeBookingRuleBinding(input);
    const ruleContext = await resolveBookingRuleContext(current.siteId, {
      bookingBlockId: normalizedBinding.bookingBlockId ?? current.bookingBlockId,
      bookingViewport: normalizedBinding.bookingViewport ?? current.bookingViewport,
    });
    const issues = validateMerchantBookingInput(nextEditable, {
      availableTimeRanges: ruleContext.availableTimeRanges,
      blockedDates: ruleContext.blockedDates,
      holidayDates: ruleContext.holidayDates,
    });
    if (issues.length > 0) {
      throw new Error(issues[0]);
    }
    const slotCapacityIssue = getMerchantBookingSlotCapacityIssue(
      nextEditable.appointmentAt,
      ruleContext.timeSlotRules,
      store.records.filter((record) => record.siteId === current.siteId && matchesRuleBinding(record, ruleContext.binding)),
      { excludeBookingId: current.id },
    );
    if (slotCapacityIssue) {
      throw new Error(slotCapacityIssue);
    }
    const next: MerchantBookingStoredRecord = {
      ...current,
      ...ruleContext.binding,
      ...nextEditable,
      status: current.status === "cancelled" ? "active" : current.status,
      updatedAt: new Date().toISOString(),
    };
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next);
  });
}

export async function updateMerchantBookingStatusBySite(input: {
  siteId: string;
  bookingId: string;
  status: MerchantBookingStatus;
}): Promise<MerchantBookingRecord> {
  const siteId = String(input.siteId ?? "").trim();
  const bookingId = String(input.bookingId ?? "").trim();
  if (!siteId || !bookingId) {
    throw new Error("预约记录参数缺失");
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const targetIndex = store.records.findIndex((item) => item.id === bookingId && item.siteId === siteId);
    if (targetIndex < 0) {
      throw new Error("未找到对应预约记录");
    }
    const current = store.records[targetIndex];
    if (!current) {
      throw new Error("未找到对应预约记录");
    }
    const nextStatus = input.status;
    let next: MerchantBookingStoredRecord = {
      ...current,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };
    if (
      shouldSendMerchantBookingConfirmationEmail({
        currentStatus: current.status,
        nextStatus,
        confirmationEmailLastAttemptAt: current.confirmationEmailLastAttemptAt,
      })
    ) {
      const emailResult = await sendMerchantBookingConfirmationEmail(next);
      if (emailResult.attempted) {
        next = {
          ...next,
          confirmationEmailLastAttemptAt: emailResult.attemptedAt,
          confirmationEmailStatus: emailResult.status,
          confirmationEmailSentAt:
            emailResult.status === "sent" ? emailResult.attemptedAt : current.confirmationEmailSentAt,
          confirmationEmailMessageId:
            emailResult.status === "sent" ? emailResult.messageId : current.confirmationEmailMessageId,
          confirmationEmailError: emailResult.status === "failed" ? emailResult.error : undefined,
        };
      }
    }
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next);
  });
}

export async function updateMerchantBookingBySite(input: {
  siteId: string;
  bookingId: string;
  status?: MerchantBookingStatus;
  bookingBlockId?: string;
  bookingViewport?: MerchantBookingRuleBinding["bookingViewport"];
  updates?: Partial<MerchantBookingEditableInput>;
}): Promise<MerchantBookingRecord> {
  const siteId = String(input.siteId ?? "").trim();
  const bookingId = String(input.bookingId ?? "").trim();
  if (!siteId || !bookingId) {
    throw new Error("预约记录参数缺失");
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const targetIndex = store.records.findIndex((item) => item.id === bookingId && item.siteId === siteId);
    if (targetIndex < 0) {
      throw new Error("未找到对应预约记录");
    }
    const current = store.records[targetIndex];
    if (!current) {
      throw new Error("未找到对应预约记录");
    }

    const hasEditableUpdates = Boolean(input.updates);
    const nextEditable = hasEditableUpdates
      ? sanitizeMerchantBookingEditableInput(input.updates, current)
      : sanitizeMerchantBookingEditableInput(current, current);
    let nextBinding: MerchantBookingRuleBinding = {
      bookingBlockId: current.bookingBlockId,
      bookingViewport: current.bookingViewport,
    };
    if (hasEditableUpdates) {
      const normalizedBinding = normalizeBookingRuleBinding(input);
      const ruleContext = await resolveBookingRuleContext(siteId, {
        bookingBlockId: normalizedBinding.bookingBlockId ?? current.bookingBlockId,
        bookingViewport: normalizedBinding.bookingViewport ?? current.bookingViewport,
      });
      const issues = validateMerchantBookingInput(nextEditable, {
        availableTimeRanges: ruleContext.availableTimeRanges,
        blockedDates: ruleContext.blockedDates,
        holidayDates: ruleContext.holidayDates,
      });
      if (issues.length > 0) {
        throw new Error(issues[0]);
      }
      const slotCapacityIssue = getMerchantBookingSlotCapacityIssue(
        nextEditable.appointmentAt,
        ruleContext.timeSlotRules,
        store.records.filter((record) => record.siteId === siteId && matchesRuleBinding(record, ruleContext.binding)),
        { excludeBookingId: current.id },
      );
      if (slotCapacityIssue) {
        throw new Error(slotCapacityIssue);
      }
      nextBinding = ruleContext.binding;
    }

    const nextStatus = input.status ?? current.status;
    let next: MerchantBookingStoredRecord = {
      ...current,
      ...nextBinding,
      ...nextEditable,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };
    if (
      shouldSendMerchantBookingConfirmationEmail({
        currentStatus: current.status,
        nextStatus,
        confirmationEmailLastAttemptAt: current.confirmationEmailLastAttemptAt,
      })
    ) {
      const emailResult = await sendMerchantBookingConfirmationEmail(next);
      if (emailResult.attempted) {
        next = {
          ...next,
          confirmationEmailLastAttemptAt: emailResult.attemptedAt,
          confirmationEmailStatus: emailResult.status,
          confirmationEmailSentAt:
            emailResult.status === "sent" ? emailResult.attemptedAt : current.confirmationEmailSentAt,
          confirmationEmailMessageId:
            emailResult.status === "sent" ? emailResult.messageId : current.confirmationEmailMessageId,
          confirmationEmailError: emailResult.status === "failed" ? emailResult.error : undefined,
        };
      }
    }
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next);
  });
}
