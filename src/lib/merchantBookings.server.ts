import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildMerchantBookingId,
  getMerchantBookingSlotCapacityIssue,
  sanitizeMerchantBookingEditableInput,
  type MerchantBookingActionInput,
  type MerchantBookingCreateInput,
  type MerchantBookingCustomerEmailLogEntry,
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
  getMerchantBookingDueReminderOffset,
  getMerchantBookingRecurringIssue,
  shouldMarkMerchantBookingNoShow,
} from "./merchantBookingWorkbench";
import { loadMerchantBookingWorkbenchSettings } from "./merchantBookingWorkbenchStore";
import {
  sendMerchantBookingStatusEmail,
  sendMerchantBookingReminderEmail,
} from "./merchantBookingEmails";
import { resolveMerchantBookingCustomerEmailLocale } from "./merchantBookingCustomerEmail";
import { buildMerchantBookingReminderPushNotification } from "./merchantPushEvents";
import { resolveMerchantBookingRuleEntry, type MerchantBookingRuleLocator } from "./merchantBookingRules";
import { loadMerchantBookingRulesSnapshot } from "./merchantBookingRulesStore";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "./publishedMerchantService";
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

function collectAutomationSiteIds(records: MerchantBookingStoredRecord[]) {
  return [...new Set(records.map((record) => trimText(record.siteId)).filter(Boolean))];
}

function stampMerchantBookingTouch(
  record: MerchantBookingStoredRecord,
  touchedAt = new Date().toISOString(),
) {
  return {
    ...record,
    merchantTouchedAt: touchedAt,
  };
}

function appendCustomerEmailLog(
  record: MerchantBookingStoredRecord,
  entry: MerchantBookingCustomerEmailLogEntry,
) {
  const currentLogs = Array.isArray(record.customerEmailLogs) ? record.customerEmailLogs : [];
  return {
    ...record,
    customerEmailLogs: [...currentLogs, entry].slice(-40),
  };
}

function createCustomerEmailLogEntry(input: {
  kind: MerchantBookingCustomerEmailLogEntry["kind"];
  sentAt: string;
  locale?: string | null;
  subject?: string | null;
  senderName?: string | null;
  status?: MerchantBookingStatus;
  minutesBefore?: number;
}) {
  return {
    id: `mail-${randomBytes(8).toString("hex")}`,
    kind: input.kind,
    sentAt: input.sentAt,
    locale: trimText(input.locale),
    subject: trimText(input.subject),
    senderName: trimText(input.senderName),
    ...(input.status ? { status: input.status } : {}),
    ...(typeof input.minutesBefore === "number" ? { minutesBefore: input.minutesBefore } : {}),
  } satisfies MerchantBookingCustomerEmailLogEntry;
}

type SiteCustomerEmailRuntime = {
  allowAutoEmail: boolean;
  merchantDisplayName: string;
  senderName: string;
  locale: string;
};

async function loadSiteCustomerEmailRuntime(
  siteId: string,
  settings: Awaited<ReturnType<typeof loadMerchantBookingWorkbenchSettings>>,
  fallbackMerchantName?: string | null,
): Promise<SiteCustomerEmailRuntime> {
  const snapshotSite = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  const allowAutoEmail = Boolean(
    snapshotSite?.permissionConfig?.allowBookingBlock && snapshotSite?.permissionConfig?.allowBookingAutoEmail,
  );
  const merchantDisplayName =
    trimText(snapshotSite?.merchantName) ||
    trimText(snapshotSite?.name) ||
    trimText(fallbackMerchantName) ||
    trimText(siteId);
  const senderName =
    trimText(settings.customerEmailSenderName) || merchantDisplayName;
  const locale = resolveMerchantBookingCustomerEmailLocale(
    settings.customerEmailLocale,
    snapshotSite?.location.countryCode,
  );
  return {
    allowAutoEmail,
    merchantDisplayName,
    senderName,
    locale,
  };
}

async function maybeSendCustomerStatusEmail(input: {
  record: MerchantBookingStoredRecord;
  previousStatus: MerchantBookingStatus | null;
  settings: Awaited<ReturnType<typeof loadMerchantBookingWorkbenchSettings>>;
  runtime: SiteCustomerEmailRuntime;
}) {
  const { record, previousStatus, settings, runtime } = input;
  if (!runtime.allowAutoEmail || settings.customerAutoEmailEnabled !== true) {
    return record;
  }
  if (!settings.customerAutoEmailStatuses.includes(record.status)) {
    return record;
  }
  if (previousStatus === record.status) {
    return record;
  }
  const emailResult = await sendMerchantBookingStatusEmail(record, record.status, {
    locale: runtime.locale,
    senderName: runtime.senderName,
    merchantDisplayName: runtime.merchantDisplayName,
    extraMessage: settings.customerAutoEmailMessageByStatus[record.status],
  }).catch(() => ({
    attempted: true as const,
    attemptedAt: new Date().toISOString(),
    status: "failed" as const,
    error: "booking_status_email_send_failed",
    subject: "",
    locale: runtime.locale,
    senderName: runtime.senderName,
  }));
  if (!(emailResult.attempted && emailResult.status === "sent")) {
    return record;
  }
  return appendCustomerEmailLog(
    record,
    createCustomerEmailLogEntry({
      kind: "status",
      sentAt: emailResult.attemptedAt,
      locale: emailResult.locale,
      subject: emailResult.subject,
      senderName: emailResult.senderName,
      status: record.status,
    }),
  );
}

function buildAutomationStateForEditableUpdate(
  current: MerchantBookingStoredRecord,
  nextEditable: MerchantBookingEditableInput,
) {
  if (current.appointmentAt === nextEditable.appointmentAt) {
    return {
      customerReminderProcessedMinutes: current.customerReminderProcessedMinutes,
      merchantReminderProcessedMinutes: current.merchantReminderProcessedMinutes,
    } satisfies Pick<
      MerchantBookingStoredRecord,
      "customerReminderProcessedMinutes" | "merchantReminderProcessedMinutes"
    >;
  }

  return {
    customerReminderProcessedMinutes: [],
    merchantReminderProcessedMinutes: [],
  } satisfies Pick<MerchantBookingStoredRecord, "customerReminderProcessedMinutes" | "merchantReminderProcessedMinutes">;
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
    const emailRuntime = await loadSiteCustomerEmailRuntime(normalizedSiteId, settings);
    const now = new Date();
    const nowIso = now.toISOString();
    const supabase = createServerSupabaseServiceClient();
    let changed = false;

    for (let index = 0; index < store.records.length; index += 1) {
      const current = store.records[index];
      if (!current || current.siteId !== normalizedSiteId) continue;
      let next = current;
      const previousStatus = current.status;

      if (shouldMarkMerchantBookingNoShow(next, settings, now)) {
        next = {
          ...next,
          ...applyStatusMetadata(next, "no_show", nowIso),
        };
        changed = true;
      }

      if (next.status === "no_show" && previousStatus !== "no_show") {
        const nextWithEmail = await maybeSendCustomerStatusEmail({
          record: next,
          previousStatus,
          settings,
          runtime: emailRuntime,
        });
        if (nextWithEmail !== next) {
          next = nextWithEmail;
          changed = true;
        }
      }

      if (next.status === "active" || next.status === "confirmed") {
        const customerProcessed = normalizeProcessedMinutes(next.customerReminderProcessedMinutes);
        const dueCustomerOffset =
          emailRuntime.allowAutoEmail && settings.customerAutoEmailEnabled === true
            ? getMerchantBookingDueReminderOffset(next, settings.customerReminderOffsetsMinutes, now)
            : null;
        if (dueCustomerOffset && !customerProcessed.includes(dueCustomerOffset)) {
          const emailResult = await sendMerchantBookingReminderEmail(next, dueCustomerOffset, {
            locale: emailRuntime.locale,
            senderName: emailRuntime.senderName,
            merchantDisplayName: emailRuntime.merchantDisplayName,
          }).catch(() => ({
            attempted: true as const,
            attemptedAt: nowIso,
            status: "failed" as const,
            error: "booking_reminder_send_failed",
            subject: "",
            locale: emailRuntime.locale,
            senderName: emailRuntime.senderName,
          }));
          if (emailResult.attempted && emailResult.status === "sent") {
            customerProcessed.push(dueCustomerOffset);
            next = appendCustomerEmailLog(
              next,
              createCustomerEmailLogEntry({
                kind: "reminder",
                sentAt: emailResult.attemptedAt,
                locale: emailResult.locale,
                subject: emailResult.subject,
                senderName: emailResult.senderName,
                minutesBefore: dueCustomerOffset,
              }),
            );
          }
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
        const dueMerchantOffset = getMerchantBookingDueReminderOffset(next, settings.merchantReminderOffsetsMinutes, now);
        if (dueMerchantOffset && !merchantProcessed.includes(dueMerchantOffset) && supabase) {
          const notification = buildMerchantBookingReminderPushNotification({
            siteId: normalizedSiteId,
            booking: next,
            minutesBefore: dueMerchantOffset,
          });
          const delivery = await notifyMerchantPushSubscribers(supabase as unknown as MerchantPushSubscriptionStoreClient, {
            merchantId: normalizedSiteId,
            ...notification,
          }).catch(() => null);
          if (delivery && delivery.delivered > 0) {
            merchantProcessed.push(dueMerchantOffset);
          }
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

export async function runMerchantBookingAutomationForAllSites() {
  const store = await readMerchantBookingStore();
  const siteIds = collectAutomationSiteIds(store.records);
  for (const siteId of siteIds) {
    await runMerchantBookingAutomationForSite(siteId);
  }
  return {
    processedSiteCount: siteIds.length,
    siteIds,
  };
}

export async function listMerchantBookings(
  siteId: string,
  options?: { includeAutomationState?: boolean; includeCustomerEmailLogs?: boolean },
): Promise<MerchantBookingRecord[]> {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) return [];
  const store = await runMerchantBookingAutomationForSite(normalizedSiteId);
  return sortNewestFirst(
    store.records
      .filter((item) => item.siteId === normalizedSiteId)
      .map((item) => withoutMerchantBookingToken(item, options)),
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
  const emailRuntime = await loadSiteCustomerEmailRuntime(siteId, workbenchSettings, input.siteName);
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
      {
        appointmentAt: editable.appointmentAt,
        store: editable.store,
        item: editable.item,
      },
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

    let record: MerchantBookingStoredRecord = {
      id: nextId,
      siteId,
      siteName: trimText(input.siteName),
      ...ruleContext.binding,
      ...editable,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      editToken: createEditToken(),
      merchantTouchedAt: "",
      customerReminderProcessedMinutes: [],
      merchantReminderProcessedMinutes: [],
    };
    record = await maybeSendCustomerStatusEmail({
      record,
      previousStatus: null,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
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
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(current.siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(current.siteId, workbenchSettings, current.siteName);

    if (input.action === "cancel") {
      let next: MerchantBookingStoredRecord = {
        ...current,
        ...applyStatusMetadata(current, "cancelled", new Date().toISOString()),
      };
      next = await maybeSendCustomerStatusEmail({
        record: next,
        previousStatus: current.status,
        settings: workbenchSettings,
        runtime: emailRuntime,
      });
      store.records[targetIndex] = next;
      await writeMerchantBookingStore(store);
      return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true });
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
      {
        appointmentAt: nextEditable.appointmentAt,
        store: nextEditable.store,
        item: nextEditable.item,
      },
      workbenchSettings.bufferMinutes,
      boundRecords,
      { excludeBookingId: current.id },
    );
    if (bufferIssue) {
      throw new Error(bufferIssue);
    }

    let next: MerchantBookingStoredRecord = {
      ...current,
      ...ruleContext.binding,
      ...nextEditable,
      ...buildAutomationStateForEditableUpdate(current, nextEditable),
      status: current.status === "cancelled" || current.status === "no_show" ? "active" : current.status,
      updatedAt: new Date().toISOString(),
      noShowMarkedAt:
        current.appointmentAt === nextEditable.appointmentAt && current.status !== "no_show"
          ? current.noShowMarkedAt
          : undefined,
    };
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true });
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
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(siteId, workbenchSettings, current.siteName);

    const nextStatus = input.status;
    const touchedAt = new Date().toISOString();
    let next: MerchantBookingStoredRecord = {
      ...current,
      ...applyStatusMetadata(current, nextStatus, touchedAt),
    };
    next = stampMerchantBookingTouch(next, touchedAt);
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true });
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
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(siteId, workbenchSettings, current.siteName);

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
        {
          appointmentAt: nextEditable.appointmentAt,
          store: nextEditable.store,
          item: nextEditable.item,
        },
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
    const touchedAt = new Date().toISOString();
    let next: MerchantBookingStoredRecord = {
      ...current,
      ...nextBinding,
      ...nextEditable,
      ...buildAutomationStateForEditableUpdate(current, nextEditable),
      ...applyStatusMetadata(current, nextStatus, touchedAt),
    };
    next = stampMerchantBookingTouch(next, touchedAt);
    if (current.appointmentAt !== nextEditable.appointmentAt && next.status !== "no_show") {
      next = {
        ...next,
        noShowMarkedAt: undefined,
      };
    }
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true });
  });
}

export async function acknowledgeMerchantBookingBySite(input: {
  siteId: string;
  bookingId: string;
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
    const next = stampMerchantBookingTouch(current);
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true });
  });
}
