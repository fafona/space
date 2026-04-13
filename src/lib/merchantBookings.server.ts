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
import {
  getMerchantBookingAdvanceIssue,
  getMerchantBookingBufferIssue,
  getMerchantBookingRecurringIssue,
  isMerchantBookingReminderDue,
  shouldMarkMerchantBookingNoShow,
} from "./merchantBookingWorkbench";
import { loadMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbenchStore";
import {
  sendMerchantBookingConfirmationEmail,
  sendMerchantBookingReminderEmail,
} from "./merchantBookingEmails";
import { buildMerchantBookingReminderPushNotification } from "./merchantPushEvents";
import { resolveMerchantBookingRuleEntry, type MerchantBookingRuleLocator } from "./merchantBookingRules";
import { loadMerchantBookingRulesSnapshot } from "./merchantBookingRulesStore";
import type { MerchantPushSubscriptionStoreClient } from "./merchantPushSubscriptionStore";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { notifyMerchantPushSubscribers } from "./webPush";

type MerchantBookingStoreFile = {
  version: 1;
  records: MerchantBookingStoredRecord[];
};

const STORE_VERSION = 1 as const;
const BOOKING_STORE_PATH = path.join(process.cwd(), ".runtime", "merchant-bookings.json");
const LOCK_KEY = "__merchantBookingsQueue";

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

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
    bookingBlockId: trimText(input?.bookingBlockId) || undefined,
    bookingViewport: input?.bookingViewport === "mobile" || input?.bookingViewport === "desktop" ? input.bookingViewport : undefined,
  };
}

function normalizeProcessedMinutes(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const next: number[] = [];
  source.forEach((item) => {
    const numeric =
      typeof item === "number" && Number.isFinite(item)
        ? Math.round(item)
        : Number.parseInt(String(item ?? "").trim(), 10);
    if (!Number.isFinite(numeric) || numeric < 1 || next.includes(numeric)) return;
    next.push(numeric);
  });
  return next.sort((left, right) => right - left);
}

function matchesRuleBinding(record: MerchantBookingStoredRecord, binding: MerchantBookingRuleBinding) {
  return record.bookingBlockId === binding.bookingBlockId && record.bookingViewport === binding.bookingViewport;
}

function collectWorkbenchAvailabilityIssues(
  appointmentAt: string,
  siteSettings: Awaited<ReturnType<typeof loadMerchantBookingWorkbenchSettings>>,
) {
  const issues: string[] = [];
  const advanceIssue = getMerchantBookingAdvanceIssue(appointmentAt, siteSettings);
  if (advanceIssue) issues.push(advanceIssue);
  const recurringIssue = getMerchantBookingRecurringIssue(appointmentAt, siteSettings.recurringRules);
  if (recurringIssue) issues.push(recurringIssue);
  return issues;
}

function applyStatusMetadata(
  current: MerchantBookingStoredRecord,
  nextStatus: MerchantBookingStatus,
  updatedAt: string,
) {
  return {
    status: nextStatus,
    updatedAt,
    noShowMarkedAt:
      nextStatus === "no_show"
        ? current.noShowMarkedAt || updatedAt
        : current.status === "no_show"
          ? undefined
          : current.noShowMarkedAt,
  } satisfies Pick<MerchantBookingStoredRecord, "status" | "updatedAt" | "noShowMarkedAt">;
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
  const normalizedSiteId = trimText(siteId);
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

async function runMerchantBookingAutomationForSite(siteId: string) {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) {
    return readMerchantBookingStore();
  }
  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const settings = await loadMerchantBookingWorkbenchSettings(normalizedSiteId);
    const now = new Date();
    const nowIso = now.toISOString();
    const supabase = createServerSupabaseServiceClient();
    let changed = false;

    for (let index = 0; index < store.records.length; index += 1) {
      const current = store.records[index];
      if (!current || current.siteId !== normalizedSiteId) continue;
      let next = current;

      if (shouldMarkMerchantBookingNoShow(next, settings, now)) {
        next = {
          ...next,
          ...applyStatusMetadata(next, "no_show", nowIso),
        };
        changed = true;
      }

      if (next.status === "active" || next.status === "confirmed") {
        const customerProcessed = normalizeProcessedMinutes(next.customerReminderProcessedMinutes);
        for (const offset of settings.customerReminderOffsetsMinutes) {
          if (customerProcessed.includes(offset) || !isMerchantBookingReminderDue(next, offset, now)) continue;
          await sendMerchantBookingReminderEmail(next, offset).catch(() => ({
            attempted: false as const,
            reason: "disabled" as const,
          }));
          customerProcessed.push(offset);
        }
        const normalizedCustomerProcessed = normalizeProcessedMinutes(customerProcessed);
        if (JSON.stringify(normalizedCustomerProcessed) !== JSON.stringify(normalizeProcessedMinutes(next.customerReminderProcessedMinutes))) {
          next = {
            ...next,
            customerReminderProcessedMinutes: normalizedCustomerProcessed,
          };
          changed = true;
        }

        const merchantProcessed = normalizeProcessedMinutes(next.merchantReminderProcessedMinutes);
        for (const offset of settings.merchantReminderOffsetsMinutes) {
          if (merchantProcessed.includes(offset) || !isMerchantBookingReminderDue(next, offset, now)) continue;
          if (supabase) {
            const notification = buildMerchantBookingReminderPushNotification({
              siteId: normalizedSiteId,
              booking: next,
              minutesBefore: offset,
            });
            await notifyMerchantPushSubscribers(supabase as unknown as MerchantPushSubscriptionStoreClient, {
              merchantId: normalizedSiteId,
              ...notification,
            }).catch(() => null);
          }
          merchantProcessed.push(offset);
        }
        const normalizedMerchantProcessed = normalizeProcessedMinutes(merchantProcessed);
        if (JSON.stringify(normalizedMerchantProcessed) !== JSON.stringify(normalizeProcessedMinutes(next.merchantReminderProcessedMinutes))) {
          next = {
            ...next,
            merchantReminderProcessedMinutes: normalizedMerchantProcessed,
          };
          changed = true;
        }
      }

      if (next !== current) {
        store.records[index] = next;
      }
    }

    if (changed) {
      await writeMerchantBookingStore(store);
    }

    return store;
  });
}

export async function listMerchantBookings(siteId: string): Promise<MerchantBookingRecord[]> {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) return [];
  const store = await runMerchantBookingAutomationForSite(normalizedSiteId);
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
  const siteId = trimText(input.siteId);
  const editable = sanitizeMerchantBookingEditableInput(input);
  const ruleContext = await resolveBookingRuleContext(siteId, normalizeBookingRuleBinding(input));
  const workbenchSettings = await loadMerchantBookingWorkbenchSettings(siteId);
  const issues = validateMerchantBookingInput(editable, {
    availableTimeRanges: ruleContext.availableTimeRanges,
    blockedDates: ruleContext.blockedDates,
    holidayDates: ruleContext.holidayDates,
  });
  issues.push(...collectWorkbenchAvailabilityIssues(editable.appointmentAt, workbenchSettings));
  if (!siteId) {
    issues.push("站点信息缺失");
  }
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const boundRecords = store.records.filter((record) => record.siteId === siteId && matchesRuleBinding(record, ruleContext.binding));
    const slotCapacityIssue = getMerchantBookingSlotCapacityIssue(
      editable.appointmentAt,
      ruleContext.timeSlotRules,
      boundRecords,
    );
    if (slotCapacityIssue) {
      throw new Error(slotCapacityIssue);
    }
    const bufferIssue = getMerchantBookingBufferIssue(
      editable.appointmentAt,
      workbenchSettings.bufferMinutes,
      boundRecords,
    );
    if (bufferIssue) {
      throw new Error(bufferIssue);
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const nextId = buildMerchantBookingId(
      siteId,
      nowDate,
      store.records.map((item) => item.id),
    );
    if (!nextId) {
      throw new Error("预约编号生成失败");
    }

    const record: MerchantBookingStoredRecord = {
      id: nextId,
      siteId,
      siteName: trimText(input.siteName),
      ...ruleContext.binding,
      ...editable,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      editToken: createEditToken(),
      customerReminderProcessedMinutes: [],
      merchantReminderProcessedMinutes: [],
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
  const bookingId = trimText(input.bookingId);
  const editToken = trimText(input.editToken);
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
        ...applyStatusMetadata(current, "cancelled", new Date().toISOString()),
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
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(current.siteId);
    const issues = validateMerchantBookingInput(nextEditable, {
      availableTimeRanges: ruleContext.availableTimeRanges,
      blockedDates: ruleContext.blockedDates,
      holidayDates: ruleContext.holidayDates,
    });
    issues.push(...collectWorkbenchAvailabilityIssues(nextEditable.appointmentAt, workbenchSettings));
    if (issues.length > 0) {
      throw new Error(issues[0]);
    }

    const boundRecords = store.records.filter((record) => record.siteId === current.siteId && matchesRuleBinding(record, ruleContext.binding));
    const slotCapacityIssue = getMerchantBookingSlotCapacityIssue(
      nextEditable.appointmentAt,
      ruleContext.timeSlotRules,
      boundRecords,
      { excludeBookingId: current.id },
    );
    if (slotCapacityIssue) {
      throw new Error(slotCapacityIssue);
    }
    const bufferIssue = getMerchantBookingBufferIssue(
      nextEditable.appointmentAt,
      workbenchSettings.bufferMinutes,
      boundRecords,
      { excludeBookingId: current.id },
    );
    if (bufferIssue) {
      throw new Error(bufferIssue);
    }

    const next: MerchantBookingStoredRecord = {
      ...current,
      ...ruleContext.binding,
      ...nextEditable,
      status: current.status === "cancelled" || current.status === "no_show" ? "active" : current.status,
      updatedAt: new Date().toISOString(),
      noShowMarkedAt: current.status === "no_show" ? undefined : current.noShowMarkedAt,
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
  const siteId = trimText(input.siteId);
  const bookingId = trimText(input.bookingId);
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
      ...applyStatusMetadata(current, nextStatus, new Date().toISOString()),
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
  const siteId = trimText(input.siteId);
  const bookingId = trimText(input.bookingId);
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
      const workbenchSettings = await loadMerchantBookingWorkbenchSettings(siteId);
      const issues = validateMerchantBookingInput(nextEditable, {
        availableTimeRanges: ruleContext.availableTimeRanges,
        blockedDates: ruleContext.blockedDates,
        holidayDates: ruleContext.holidayDates,
      });
      issues.push(...collectWorkbenchAvailabilityIssues(nextEditable.appointmentAt, workbenchSettings));
      if (issues.length > 0) {
        throw new Error(issues[0]);
      }
      const boundRecords = store.records.filter((record) => record.siteId === siteId && matchesRuleBinding(record, ruleContext.binding));
      const slotCapacityIssue = getMerchantBookingSlotCapacityIssue(
        nextEditable.appointmentAt,
        ruleContext.timeSlotRules,
        boundRecords,
        { excludeBookingId: current.id },
      );
      if (slotCapacityIssue) {
        throw new Error(slotCapacityIssue);
      }
      const bufferIssue = getMerchantBookingBufferIssue(
        nextEditable.appointmentAt,
        workbenchSettings.bufferMinutes,
        boundRecords,
        { excludeBookingId: current.id },
      );
      if (bufferIssue) {
        throw new Error(bufferIssue);
      }
      nextBinding = ruleContext.binding;
    }

    const nextStatus = input.status ?? current.status;
    let next: MerchantBookingStoredRecord = {
      ...current,
      ...nextBinding,
      ...nextEditable,
      ...applyStatusMetadata(current, nextStatus, new Date().toISOString()),
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
