import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  buildMerchantBookingId,
  getMerchantBookingSlotCapacityIssue,
  matchesPersonalMerchantBookingIdentity,
  sanitizeMerchantBookingEditableInput,
  type MerchantBookingActionInput,
  type MerchantBookingCustomerEmailLogKind,
  type MerchantBookingCreateInput,
  type MerchantBookingCustomerEmailLogEntry,
  type MerchantBookingEditableInput,
  type MerchantBookingRecord,
  type MerchantBookingRuleBinding,
  type MerchantBookingStatus,
  type MerchantBookingStoredRecord,
  type MerchantBookingTimelineActor,
  type MerchantBookingTimelineEntry,
  validateMerchantBookingInput,
  withoutMerchantBookingToken,
} from "./merchantBookings";
import {
  getMerchantBookingAutoStatusAtAppointmentTime,
  getMerchantBookingAdvanceIssue,
  getMerchantBookingBufferIssue,
  getMerchantBookingDueReminderOffset,
  getMerchantBookingRecurringIssue,
  shouldMarkMerchantBookingNoShow,
} from "./merchantBookingWorkbench";
import {
  loadMerchantBookingWorkbenchSettings,
  migrateMerchantBookingWorkbenchPersistence,
} from "./merchantBookingWorkbenchStore";
import {
  sendMerchantBookingStatusEmail,
  sendMerchantBookingReminderEmail,
} from "./merchantBookingEmails";
import { resolveMerchantBookingCustomerEmailLocale } from "./merchantBookingCustomerEmail";
import {
  buildMerchantBookingCustomerCalendarUrl,
  buildMerchantBookingPublicSiteUrl,
  buildMerchantBookingSelfServiceUrl,
} from "./merchantBookingSelfService";
import { buildMerchantBookingReminderPushNotification } from "./merchantPushEvents";
import { resolveMerchantBookingRuleEntry, type MerchantBookingRuleLocator } from "./merchantBookingRules";
import {
  loadMerchantBookingRulesSnapshot,
  migrateMerchantBookingRulesPersistence,
} from "./merchantBookingRulesStore";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "./publishedMerchantService";
import type { MerchantPushSubscriptionStoreClient } from "./merchantPushSubscriptionStore";
import { readJsonFileWithBackup, writeJsonFileWithBackup } from "./resilientJsonFileStore";
import { createServerSupabaseServiceClient } from "./superAdminServer";
import { notifyMerchantPushSubscribers } from "./webPush";
import {
  loadMerchantBookingPersistenceValue,
  merchantBookingPersistenceValuesEqual,
  mergeMerchantBookingPersistenceRecords,
  saveMerchantBookingPersistenceValue,
} from "./merchantBookingPersistenceStore";
import {
  mirrorMerchantBookingRecords,
  resolveMerchantBookingDualWriteConfig,
} from "./merchantBookingDualWrite.server";
import {
  loadMerchantBookingsV1,
  loadMerchantBookingsV1Window,
  readMerchantBookingsWithV1Verification,
  type MerchantBookingV1ReadClient,
} from "./merchantBookingsV1Read.server";

type MerchantBookingStoreFile = {
  version: 1;
  records: MerchantBookingStoredRecord[];
};

type MerchantBookingListOptions = {
  includeAutomationState?: boolean;
  includeCustomerEmailLogs?: boolean;
  includeTimeline?: boolean;
};

type MerchantBookingWindowOptions = MerchantBookingListOptions & {
  offset?: number;
  limit?: number;
};

const STORE_VERSION = 1 as const;
const BOOKING_STORE_PATH = path.join(process.cwd(), ".runtime", "merchant-bookings.json");
const LOCK_KEY = "__merchantBookingsQueue";
const DEFAULT_BOOKING_WINDOW_LIMIT = 500;
const MAX_BOOKING_WINDOW_LIMIT = 1000;

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

function normalizeMerchantBookingStore(value: unknown): MerchantBookingStoreFile {
  const parsed = value as Partial<MerchantBookingStoreFile>;
  if (!Array.isArray(parsed?.records)) {
    return { version: STORE_VERSION, records: [] };
  }
  return {
    version: STORE_VERSION,
    records: parsed.records.filter((item) => item && typeof item === "object") as MerchantBookingStoredRecord[],
  };
}

function normalizePersistedMerchantBookingStore(value: unknown): MerchantBookingStoreFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = value as Partial<MerchantBookingStoreFile>;
  if (!Array.isArray(parsed.records)) return null;
  return normalizeMerchantBookingStore(value);
}

async function readLocalMerchantBookingStore(): Promise<MerchantBookingStoreFile> {
  return readJsonFileWithBackup<MerchantBookingStoreFile>(
    BOOKING_STORE_PATH,
    { version: STORE_VERSION, records: [] },
    normalizeMerchantBookingStore,
  );
}

async function writeLocalMerchantBookingStore(store: MerchantBookingStoreFile) {
  await writeJsonFileWithBackup(BOOKING_STORE_PATH, store);
}

function mergeMerchantBookingStores(
  localStore: MerchantBookingStoreFile,
  remoteStore: MerchantBookingStoreFile,
): MerchantBookingStoreFile {
  return {
    version: STORE_VERSION,
    records: mergeMerchantBookingPersistenceRecords(localStore.records, remoteStore.records),
  };
}

function bookingStoresEqual(left: MerchantBookingStoreFile, right: MerchantBookingStoreFile) {
  return merchantBookingPersistenceValuesEqual(left, right);
}

async function readMerchantBookingStore(): Promise<MerchantBookingStoreFile> {
  const localStore = await readLocalMerchantBookingStore();
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return localStore;

  const remote = await loadMerchantBookingPersistenceValue(
    supabase,
    "records",
    normalizePersistedMerchantBookingStore,
  );
  const remoteStore = remote?.value ?? { version: STORE_VERSION, records: [] };
  const mergedStore = mergeMerchantBookingStores(localStore, remoteStore);

  if (!remote || remote.recoveredFromBackup || !bookingStoresEqual(mergedStore, remoteStore)) {
    await saveMerchantBookingPersistenceValue(
      supabase,
      "records",
      mergedStore,
      new Date().toISOString(),
      remote?.recoveredFromBackup ? { preserveCurrentAsBackup: false } : undefined,
    );
  }
  if (!bookingStoresEqual(mergedStore, localStore)) {
    await writeLocalMerchantBookingStore(mergedStore);
  }
  return mergedStore;
}

async function mirrorSavedMerchantBookingRecords(
  supabase: NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>,
  records: MerchantBookingStoredRecord[],
) {
  const config = resolveMerchantBookingDualWriteConfig();
  if (config.mode === "off") return;
  await mirrorMerchantBookingRecords(
    { rpc: supabase.rpc.bind(supabase) },
    records,
    { config },
  );
}

async function writeMerchantBookingStore(
  store: MerchantBookingStoreFile,
  changedRecords: MerchantBookingStoredRecord[],
) {
  const normalizedStore = normalizeMerchantBookingStore(store);
  const supabase = createServerSupabaseServiceClient();
  if (supabase) {
    await saveMerchantBookingPersistenceValue(supabase, "records", normalizedStore);
  }
  await writeLocalMerchantBookingStore(normalizedStore);
  if (supabase && changedRecords.length > 0) {
    await mirrorSavedMerchantBookingRecords(supabase, changedRecords);
  }
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

function normalizeBookingWindowOffset(value: unknown) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeBookingWindowLimit(value: unknown) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric < 1) return DEFAULT_BOOKING_WINDOW_LIMIT;
  return Math.min(Math.max(numeric, 1), MAX_BOOKING_WINDOW_LIMIT);
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

function appendTimelineEntry(
  record: MerchantBookingStoredRecord,
  entry: MerchantBookingTimelineEntry,
) {
  const currentTimeline = Array.isArray(record.timeline) ? record.timeline : [];
  return {
    ...record,
    timeline: [...currentTimeline, entry].slice(-80),
  };
}

function normalizeTimelineFields(fields: Array<string | null | undefined>) {
  const next: string[] = [];
  fields.forEach((field) => {
    const normalized = trimText(field);
    if (!normalized || next.includes(normalized)) return;
    next.push(normalized);
  });
  return next;
}

function createTimelineEntry(input: {
  actor: MerchantBookingTimelineActor;
  kind: MerchantBookingTimelineEntry["kind"];
  at: string;
  fields?: Array<string | null | undefined>;
  fromStatus?: MerchantBookingStatus;
  toStatus?: MerchantBookingStatus;
  emailKind?: MerchantBookingCustomerEmailLogKind;
  delivery?: "sent" | "failed";
  subject?: string | null;
  senderName?: string | null;
  locale?: string | null;
  minutesBefore?: number | null;
  deliveredCount?: number | null;
  note?: string | null;
}) {
  const entry = {
    id: `evt-${randomBytes(8).toString("hex")}`,
    actor: input.actor,
    kind: input.kind,
    at: input.at,
  } satisfies MerchantBookingTimelineEntry;
  const fields = normalizeTimelineFields(input.fields ?? []);
  return {
    ...entry,
    ...(fields.length > 0 ? { fields } : {}),
    ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
    ...(input.toStatus ? { toStatus: input.toStatus } : {}),
    ...(input.emailKind ? { emailKind: input.emailKind } : {}),
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(trimText(input.subject) ? { subject: trimText(input.subject) } : {}),
    ...(trimText(input.senderName) ? { senderName: trimText(input.senderName) } : {}),
    ...(trimText(input.locale) ? { locale: trimText(input.locale) } : {}),
    ...(typeof input.minutesBefore === "number" && Number.isFinite(input.minutesBefore)
      ? { minutesBefore: Math.max(1, Math.round(input.minutesBefore)) }
      : {}),
    ...(typeof input.deliveredCount === "number" && Number.isFinite(input.deliveredCount)
      ? { deliveredCount: Math.max(0, Math.round(input.deliveredCount)) }
      : {}),
    ...(trimText(input.note) ? { note: trimText(input.note) } : {}),
  } satisfies MerchantBookingTimelineEntry;
}

function hasTimelineEntry(
  record: MerchantBookingStoredRecord,
  matcher: (entry: MerchantBookingTimelineEntry) => boolean,
) {
  const timeline = Array.isArray(record.timeline) ? record.timeline : [];
  return timeline.some((entry) => matcher(entry));
}

function collectEditableFieldChanges(
  current: MerchantBookingStoredRecord,
  nextEditable: MerchantBookingEditableInput,
) {
  return normalizeTimelineFields(
    ([
      current.store !== nextEditable.store ? "store" : "",
      current.item !== nextEditable.item ? "item" : "",
      current.appointmentAt !== nextEditable.appointmentAt ? "appointmentAt" : "",
      current.title !== nextEditable.title ? "title" : "",
      current.customerName !== nextEditable.customerName ? "customerName" : "",
      current.email !== nextEditable.email ? "email" : "",
      current.phone !== nextEditable.phone ? "phone" : "",
      current.note !== nextEditable.note ? "note" : "",
    ] satisfies string[]),
  );
}

function appendStatusTimelineEntry(
  record: MerchantBookingStoredRecord,
  input: {
    actor: MerchantBookingTimelineActor;
    at: string;
    fromStatus: MerchantBookingStatus;
    toStatus: MerchantBookingStatus;
    note?: string | null;
  },
) {
  if (input.fromStatus === input.toStatus) return record;
  return appendTimelineEntry(
    record,
    createTimelineEntry({
      actor: input.actor,
      kind: "status_changed",
      at: input.at,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      note: input.note,
    }),
  );
}

function buildCustomerActionLinks(record: MerchantBookingStoredRecord, publicSiteUrl: string) {
  const manageUrl = buildMerchantBookingSelfServiceUrl(publicSiteUrl, record, record.editToken);
  const calendarUrl = buildMerchantBookingCustomerCalendarUrl(publicSiteUrl, record.id, record.editToken);
  return {
    manageUrl,
    calendarUrl,
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
  publicSiteUrl: string;
};

function resolveCustomerEmailSendFailureMessage(
  result: Awaited<ReturnType<typeof sendMerchantBookingStatusEmail>>,
) {
  if (!result.attempted) {
    return result.reason === "missing_email" ? "该预约未填写客户邮箱" : "客户邮件发送功能未配置";
  }
  if (result.status === "sent") {
    return "客户邮件发送失败";
  }
  return trimText(result.error) || "客户邮件发送失败";
}

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
  const publicSiteUrl = buildMerchantBookingPublicSiteUrl(snapshotSite, siteId);
  return {
    allowAutoEmail,
    merchantDisplayName,
    senderName,
    locale,
    publicSiteUrl,
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
  const actionLinks = buildCustomerActionLinks(record, runtime.publicSiteUrl);
  const emailResult = await sendMerchantBookingStatusEmail(record, record.status, {
    locale: runtime.locale,
    senderName: runtime.senderName,
    merchantDisplayName: runtime.merchantDisplayName,
    extraMessage: settings.customerAutoEmailMessageByStatus[record.status],
    actionLinks,
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
    if (
      emailResult.attempted &&
      !hasTimelineEntry(
        record,
        (entry) =>
          entry.kind === "customer_email" &&
          entry.emailKind === "status" &&
          entry.delivery === "failed" &&
          entry.toStatus === record.status,
      )
    ) {
      return appendTimelineEntry(
        record,
        createTimelineEntry({
          actor: "system",
          kind: "customer_email",
          at: emailResult.attemptedAt,
          emailKind: "status",
          delivery: "failed",
          toStatus: record.status,
          subject: emailResult.subject,
          senderName: emailResult.senderName,
          locale: emailResult.locale,
          note: emailResult.error,
        }),
      );
    }
    return record;
  }
  return appendTimelineEntry(
    appendCustomerEmailLog(
      record,
      createCustomerEmailLogEntry({
        kind: "status",
        sentAt: emailResult.attemptedAt,
        locale: emailResult.locale,
        subject: emailResult.subject,
        senderName: emailResult.senderName,
        status: record.status,
      }),
    ),
    createTimelineEntry({
      actor: "system",
      kind: "customer_email",
      at: emailResult.attemptedAt,
      emailKind: "status",
      delivery: "sent",
      toStatus: record.status,
      subject: emailResult.subject,
      senderName: emailResult.senderName,
      locale: emailResult.locale,
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
    const changedRecords: MerchantBookingStoredRecord[] = [];

    for (let index = 0; index < store.records.length; index += 1) {
      const current = store.records[index];
      if (!current || current.siteId !== normalizedSiteId) continue;
      let next = current;
      const previousStatus = current.status;
      const autoStatusAtAppointmentTime = getMerchantBookingAutoStatusAtAppointmentTime(next, settings, now);

      if (autoStatusAtAppointmentTime) {
        next = {
          ...next,
          ...applyStatusMetadata(next, autoStatusAtAppointmentTime, nowIso),
        };
        next = appendStatusTimelineEntry(next, {
          actor: "system",
          at: nowIso,
          fromStatus: previousStatus,
          toStatus: autoStatusAtAppointmentTime,
          note: "auto",
        });
        changed = true;
      } else if (shouldMarkMerchantBookingNoShow(next, settings, now)) {
        next = {
          ...next,
          ...applyStatusMetadata(next, "no_show", nowIso),
        };
        next = appendStatusTimelineEntry(next, {
          actor: "system",
          at: nowIso,
          fromStatus: previousStatus,
          toStatus: "no_show",
          note: "auto",
        });
        changed = true;
      }

      if ((next.status === "no_show" || next.status === "completed") && previousStatus !== next.status) {
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
          const actionLinks = buildCustomerActionLinks(next, emailRuntime.publicSiteUrl);
          const emailResult = await sendMerchantBookingReminderEmail(next, dueCustomerOffset, {
            locale: emailRuntime.locale,
            senderName: emailRuntime.senderName,
            merchantDisplayName: emailRuntime.merchantDisplayName,
            actionLinks,
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
            next = appendTimelineEntry(
              appendCustomerEmailLog(
                next,
                createCustomerEmailLogEntry({
                  kind: "reminder",
                  sentAt: emailResult.attemptedAt,
                  locale: emailResult.locale,
                  subject: emailResult.subject,
                  senderName: emailResult.senderName,
                  minutesBefore: dueCustomerOffset,
                }),
              ),
              createTimelineEntry({
                actor: "system",
                kind: "customer_email",
                at: emailResult.attemptedAt,
                emailKind: "reminder",
                delivery: "sent",
                subject: emailResult.subject,
                senderName: emailResult.senderName,
                locale: emailResult.locale,
                minutesBefore: dueCustomerOffset,
              }),
            );
            changed = true;
          } else if (
            emailResult.attempted &&
            !hasTimelineEntry(
              next,
              (entry) =>
                entry.kind === "customer_email" &&
                entry.emailKind === "reminder" &&
                entry.delivery === "failed" &&
                entry.minutesBefore === dueCustomerOffset,
            )
          ) {
            next = appendTimelineEntry(
              next,
              createTimelineEntry({
                actor: "system",
                kind: "customer_email",
                at: emailResult.attemptedAt,
                emailKind: "reminder",
                delivery: "failed",
                subject: emailResult.subject,
                senderName: emailResult.senderName,
                locale: emailResult.locale,
                minutesBefore: dueCustomerOffset,
                note: emailResult.error,
              }),
            );
            changed = true;
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
            next = appendTimelineEntry(
              next,
              createTimelineEntry({
                actor: "system",
                kind: "merchant_reminder",
                at: nowIso,
                delivery: "sent",
                minutesBefore: dueMerchantOffset,
                deliveredCount: delivery.delivered,
              }),
            );
            changed = true;
          } else if (
            !hasTimelineEntry(
              next,
              (entry) =>
                entry.kind === "merchant_reminder" &&
                entry.delivery === "failed" &&
                entry.minutesBefore === dueMerchantOffset,
            )
          ) {
            next = appendTimelineEntry(
              next,
              createTimelineEntry({
                actor: "system",
                kind: "merchant_reminder",
                at: nowIso,
                delivery: "failed",
                minutesBefore: dueMerchantOffset,
                note: delivery ? "no_subscriber_delivery" : "push_delivery_failed",
              }),
            );
            changed = true;
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
        changedRecords.push(next);
      }
    }

    if (changed) {
      await writeMerchantBookingStore(store, changedRecords);
    }

    return store;
  });
}

export async function runMerchantBookingAutomationForAllSites() {
  const store = await readMerchantBookingStore();
  const migratedWorkbenchSiteCount = await migrateMerchantBookingWorkbenchPersistence();
  const migratedRulesSiteCount = await migrateMerchantBookingRulesPersistence();
  const siteIds = collectAutomationSiteIds(store.records);
  for (const siteId of siteIds) {
    await runMerchantBookingAutomationForSite(siteId);
  }
  return {
    processedSiteCount: siteIds.length,
    siteIds,
    migratedWorkbenchSiteCount,
    migratedRulesSiteCount,
  };
}

export async function listMerchantBookings(
  siteId: string,
  options?: MerchantBookingListOptions,
): Promise<MerchantBookingRecord[]> {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) return [];
  let store: MerchantBookingStoreFile;
  try {
    store = await runMerchantBookingAutomationForSite(normalizedSiteId);
  } catch {
    store = await readMerchantBookingStore();
  }
  const legacyRecords = sortNewestFirst(
    store.records
      .filter((item) => item.siteId === normalizedSiteId)
      .map((item) => withoutMerchantBookingToken(item, options)),
  );
  const result = await readMerchantBookingsWithV1Verification({
    siteId: normalizedSiteId,
    loadLegacy: async () => ({ records: legacyRecords }),
    loadV1: async () => {
      const supabase = createServerSupabaseServiceClient();
      if (!supabase) return null;
      return loadMerchantBookingsV1(
        supabase as unknown as MerchantBookingV1ReadClient,
        normalizedSiteId,
        options,
      );
    },
  });
  return result.records;
}

export async function listMerchantBookingsWindow(
  siteId: string,
  options?: MerchantBookingWindowOptions,
): Promise<{ records: MerchantBookingRecord[]; offset: number; limit: number; total: number; hasMore: boolean }> {
  const normalizedSiteId = trimText(siteId);
  const offset = normalizeBookingWindowOffset(options?.offset);
  const limit = normalizeBookingWindowLimit(options?.limit);
  if (!normalizedSiteId) return { records: [], offset, limit, total: 0, hasMore: false };
  let store: MerchantBookingStoreFile;
  try {
    store = await runMerchantBookingAutomationForSite(normalizedSiteId);
  } catch {
    store = await readMerchantBookingStore();
  }
  const sortedRecords = sortNewestFirst(store.records.filter((item) => item.siteId === normalizedSiteId));
  const windowRecords = sortedRecords.slice(offset, offset + limit);
  const legacyWindow = {
    records: windowRecords.map((item) => withoutMerchantBookingToken(item, options)),
    offset,
    limit,
    total: sortedRecords.length,
    hasMore: offset + windowRecords.length < sortedRecords.length,
  };
  return readMerchantBookingsWithV1Verification({
    siteId: normalizedSiteId,
    loadLegacy: async () => legacyWindow,
    loadV1: async () => {
      const supabase = createServerSupabaseServiceClient();
      if (!supabase) return null;
      return loadMerchantBookingsV1Window(
        supabase as unknown as MerchantBookingV1ReadClient,
        normalizedSiteId,
        {
          ...options,
          offset,
          limit,
        },
      );
    },
  });
}

export async function listPersonalMerchantBookings(
  input: { accountId?: string | null; userId?: string | null },
  options?: { includeAutomationState?: boolean; includeCustomerEmailLogs?: boolean; includeTimeline?: boolean },
): Promise<MerchantBookingRecord[]> {
  const lookup = {
    accountId: trimText(input.accountId),
    userId: trimText(input.userId),
  };
  if (!lookup.accountId && !lookup.userId) return [];

  let store = await readMerchantBookingStore();
  const siteIds = Array.from(
    new Set(
      store.records
        .filter((record) => matchesPersonalMerchantBookingIdentity(record, lookup))
        .map((record) => record.siteId)
        .filter(Boolean),
    ),
  );
  let automationCompleted = false;
  for (const siteId of siteIds) {
    try {
      await runMerchantBookingAutomationForSite(siteId);
      automationCompleted = true;
    } catch {
      // Personal consumption lists must remain readable even when reminder/status automation is temporarily unavailable.
    }
  }
  if (automationCompleted) {
    store = await readMerchantBookingStore();
  }

  return sortNewestFirst(
    store.records
      .filter((record) => matchesPersonalMerchantBookingIdentity(record, lookup))
      .map((record) => withoutMerchantBookingToken(record, options)),
  );
}

export async function attachPersonalMerchantBookingsByGuestHash(input: {
  guestHash: string;
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
  records: Array<{ siteId?: string | null; bookingId?: string | null }>;
}) {
  const guestHash = trimText(input.guestHash);
  const accountId = trimText(input.accountId);
  const userId = trimText(input.userId);
  const email = trimText(input.email).toLowerCase();
  if (!guestHash || (!accountId && !userId)) return [];

  const targetKeys = new Set<string>();
  for (const record of Array.isArray(input.records) ? input.records : []) {
    const siteId = trimText(record?.siteId);
    const bookingId = trimText(record?.bookingId);
    if (!siteId || !bookingId) continue;
    targetKeys.add(`${siteId}:${bookingId}`);
    if (targetKeys.size >= 200) break;
  }
  if (targetKeys.size === 0) return [];

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const attached: MerchantBookingRecord[] = [];
    const changedRecords: MerchantBookingStoredRecord[] = [];
    let changed = false;
    store.records = store.records.map((record) => {
      if (!targetKeys.has(`${record.siteId}:${record.id}`)) return record;
      if (trimText(record.customerGuestHash) !== guestHash) return record;
      const hasCanonicalOwner = Boolean(
        trimText(record.customerAccountId) || trimText(record.customerUserId),
      );
      if (
        hasCanonicalOwner &&
        !matchesPersonalMerchantBookingIdentity(record, { accountId, userId })
      ) {
        return record;
      }
      const next: MerchantBookingStoredRecord = {
        ...record,
        customerAccountId: accountId || record.customerAccountId,
        customerUserId: userId || record.customerUserId,
        customerLoginEmail: email || record.customerLoginEmail,
      };
      changed = true;
      changedRecords.push(next);
      attached.push(withoutMerchantBookingToken(next, { includeAutomationState: true, includeCustomerEmailLogs: true, includeTimeline: true }));
      return next;
    });
    if (changed) {
      await writeMerchantBookingStore(store, changedRecords);
    }
    return sortNewestFirst(attached);
  });
}

export async function cancelPersonalMerchantBooking(input: {
  bookingId: string;
  accountId?: string | null;
  userId?: string | null;
}): Promise<MerchantBookingRecord> {
  const bookingId = trimText(input.bookingId);
  const lookup = {
    accountId: trimText(input.accountId),
    userId: trimText(input.userId),
  };
  if (!bookingId || (!lookup.accountId && !lookup.userId)) {
    throw new Error("booking_not_found");
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const targetIndex = store.records.findIndex((record) => record.id === bookingId);
    if (targetIndex < 0) throw new Error("booking_not_found");
    const current = store.records[targetIndex];
    if (!matchesPersonalMerchantBookingIdentity(current, lookup)) throw new Error("booking_not_found");
    if (current.status !== "active" || trimText(current.merchantTouchedAt)) {
      throw new Error("booking_customer_action_locked");
    }

    const now = new Date().toISOString();
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(current.siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(current.siteId, workbenchSettings, current.siteName);
    let next: MerchantBookingStoredRecord = {
      ...current,
      ...applyStatusMetadata(current, "cancelled", now),
    };
    next = appendStatusTimelineEntry(next, {
      actor: "customer",
      at: next.updatedAt,
      fromStatus: current.status,
      toStatus: "cancelled",
    });
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeAutomationState: true, includeCustomerEmailLogs: true, includeTimeline: true });
  });
}

export async function updatePersonalMerchantBooking(input: {
  bookingId: string;
  action: "update" | "cancel" | "restore";
  accountId?: string | null;
  userId?: string | null;
  updates?: Partial<MerchantBookingEditableInput>;
}): Promise<MerchantBookingRecord> {
  const bookingId = trimText(input.bookingId);
  const lookup = {
    accountId: trimText(input.accountId),
    userId: trimText(input.userId),
  };
  if (!bookingId || (!lookup.accountId && !lookup.userId)) {
    throw new Error("booking_not_found");
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const targetIndex = store.records.findIndex((record) => record.id === bookingId);
    if (targetIndex < 0) throw new Error("booking_not_found");
    const current = store.records[targetIndex];
    if (!matchesPersonalMerchantBookingIdentity(current, lookup)) throw new Error("booking_not_found");
    if (trimText(current.merchantTouchedAt)) {
      throw new Error("booking_customer_action_locked");
    }

    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(current.siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(current.siteId, workbenchSettings, current.siteName);
    const now = new Date().toISOString();

    if (input.action === "cancel") {
      if (current.status !== "active") throw new Error("booking_customer_action_locked");
      let next: MerchantBookingStoredRecord = {
        ...current,
        ...applyStatusMetadata(current, "cancelled", now),
      };
      next = appendStatusTimelineEntry(next, {
        actor: "customer",
        at: next.updatedAt,
        fromStatus: current.status,
        toStatus: "cancelled",
      });
      next = await maybeSendCustomerStatusEmail({
        record: next,
        previousStatus: current.status,
        settings: workbenchSettings,
        runtime: emailRuntime,
      });
      store.records[targetIndex] = next;
      await writeMerchantBookingStore(store, [next]);
      return withoutMerchantBookingToken(next, { includeAutomationState: true, includeCustomerEmailLogs: true, includeTimeline: true });
    }

    if (input.action === "restore" && current.status !== "cancelled") {
      throw new Error("booking_customer_action_locked");
    }
    if (input.action === "update" && current.status !== "active") {
      throw new Error("booking_customer_action_locked");
    }

    const hasEditableUpdates = input.action === "update";
    const nextEditable = hasEditableUpdates
      ? sanitizeMerchantBookingEditableInput(input.updates, current)
      : sanitizeMerchantBookingEditableInput(current, current);
    const ruleContext = await resolveBookingRuleContext(current.siteId, {
      bookingBlockId: current.bookingBlockId,
      bookingViewport: current.bookingViewport,
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
    if (slotCapacityIssue) throw new Error(slotCapacityIssue);
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
    if (bufferIssue) throw new Error(bufferIssue);

    const changedFields = hasEditableUpdates ? collectEditableFieldChanges(current, nextEditable) : [];
    const nextStatus: MerchantBookingStatus = input.action === "restore" ? "active" : current.status;
    let next: MerchantBookingStoredRecord = {
      ...current,
      ...ruleContext.binding,
      ...nextEditable,
      ...buildAutomationStateForEditableUpdate(current, nextEditable),
      ...applyStatusMetadata(current, nextStatus, now),
      noShowMarkedAt: current.appointmentAt === nextEditable.appointmentAt ? current.noShowMarkedAt : undefined,
    };
    if (changedFields.length > 0) {
      next = appendTimelineEntry(
        next,
        createTimelineEntry({
          actor: "customer",
          kind: "updated",
          at: now,
          fields: changedFields,
        }),
      );
    }
    next = appendStatusTimelineEntry(next, {
      actor: "customer",
      at: now,
      fromStatus: current.status,
      toStatus: next.status,
    });
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeAutomationState: true, includeCustomerEmailLogs: true, includeTimeline: true });
  });
}

async function resolveStoredBookingByEditToken(input: {
  bookingId: string;
  editToken: string;
}) {
  const bookingId = trimText(input.bookingId);
  const editToken = trimText(input.editToken);
  if (!bookingId || !editToken) return null;

  let store = await readMerchantBookingStore();
  let record = store.records.find((item) => item.id === bookingId) ?? null;
  if (record?.siteId) {
    store = await runMerchantBookingAutomationForSite(record.siteId);
    record = store.records.find((item) => item.id === bookingId) ?? null;
  }
  if (!record || record.editToken !== editToken) return null;
  return record;
}

export async function getMerchantBookingByEditToken(
  input: {
    bookingId: string;
    editToken: string;
  },
  options?: { includeAutomationState?: boolean; includeCustomerEmailLogs?: boolean; includeTimeline?: boolean },
) {
  const record = await resolveStoredBookingByEditToken(input);
  if (!record) {
    throw new Error("预约凭证无效");
  }
  return withoutMerchantBookingToken(record, options);
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
      customerAccountId: trimText(input.customerAccountId),
      customerUserId: trimText(input.customerUserId),
      customerLoginEmail: trimText(input.customerLoginEmail).toLowerCase(),
      customerGuestHash: trimText(input.customerGuestHash),
      ...ruleContext.binding,
      ...editable,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      editToken: createEditToken(),
      merchantTouchedAt: "",
      customerReminderProcessedMinutes: [],
      merchantReminderProcessedMinutes: [],
      timeline: [
        createTimelineEntry({
          actor: "customer",
          kind: "created",
          at: nowIso,
        }),
      ],
    };
    record = await maybeSendCustomerStatusEmail({
      record,
      previousStatus: null,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records.unshift(record);
    await writeMerchantBookingStore(store, [record]);
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
      next = appendStatusTimelineEntry(next, {
        actor: "customer",
        at: next.updatedAt,
        fromStatus: current.status,
        toStatus: "cancelled",
      });
      next = await maybeSendCustomerStatusEmail({
        record: next,
        previousStatus: current.status,
        settings: workbenchSettings,
        runtime: emailRuntime,
      });
      store.records[targetIndex] = next;
      await writeMerchantBookingStore(store, [next]);
      return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true });
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

    const changedFields = collectEditableFieldChanges(current, nextEditable);
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
    if (changedFields.length > 0) {
      next = appendTimelineEntry(
        next,
        createTimelineEntry({
          actor: "customer",
          kind: "updated",
          at: next.updatedAt,
          fields: changedFields,
        }),
      );
    }
    next = appendStatusTimelineEntry(next, {
      actor: "customer",
      at: next.updatedAt,
      fromStatus: current.status,
      toStatus: next.status,
    });
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true });
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
    next = appendStatusTimelineEntry(next, {
      actor: "merchant",
      at: touchedAt,
      fromStatus: current.status,
      toStatus: nextStatus,
    });
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true });
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
    const changedFields = hasEditableUpdates ? collectEditableFieldChanges(current, nextEditable) : [];
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
    if (changedFields.length > 0) {
      next = appendTimelineEntry(
        next,
        createTimelineEntry({
          actor: "merchant",
          kind: "updated",
          at: touchedAt,
          fields: changedFields,
        }),
      );
    }
    next = appendStatusTimelineEntry(next, {
      actor: "merchant",
      at: touchedAt,
      fromStatus: current.status,
      toStatus: nextStatus,
    });
    next = await maybeSendCustomerStatusEmail({
      record: next,
      previousStatus: current.status,
      settings: workbenchSettings,
      runtime: emailRuntime,
    });
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true });
  });
}

export async function updateMerchantBookingsBatchBySite(input: {
  siteId: string;
  bookingIds: string[];
  status: MerchantBookingStatus;
}) {
  const siteId = trimText(input.siteId);
  const bookingIds = [...new Set((Array.isArray(input.bookingIds) ? input.bookingIds : []).map((item) => trimText(item)).filter(Boolean))];
  if (!siteId || bookingIds.length === 0) {
    throw new Error("棰勭害璁板綍鍙傛暟缂哄け");
  }

  return withBookingStoreLock(async () => {
    const store = await readMerchantBookingStore();
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(siteId, workbenchSettings);
    const nextRecords: MerchantBookingRecord[] = [];
    const changedRecords: MerchantBookingStoredRecord[] = [];

    for (const bookingId of bookingIds) {
      const targetIndex = store.records.findIndex((item) => item.id === bookingId && item.siteId === siteId);
      if (targetIndex < 0) continue;
      const current = store.records[targetIndex];
      if (!current || current.status === input.status) continue;
      const touchedAt = new Date().toISOString();
      let next: MerchantBookingStoredRecord = {
        ...current,
        ...applyStatusMetadata(current, input.status, touchedAt),
      };
      next = stampMerchantBookingTouch(next, touchedAt);
      next = appendStatusTimelineEntry(next, {
        actor: "merchant",
        at: touchedAt,
        fromStatus: current.status,
        toStatus: input.status,
      });
      next = await maybeSendCustomerStatusEmail({
        record: next,
        previousStatus: current.status,
        settings: workbenchSettings,
        runtime: emailRuntime,
      });
      store.records[targetIndex] = next;
      changedRecords.push(next);
      nextRecords.push(withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true }));
    }

    if (nextRecords.length === 0) {
      throw new Error("未找到可批量更新的预约");
    }
    await writeMerchantBookingStore(store, changedRecords);
    return nextRecords;
  });
}

export async function sendMerchantBookingManualEmailBySite(input: {
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
    const workbenchSettings = await loadMerchantBookingWorkbenchSettings(siteId);
    const emailRuntime = await loadSiteCustomerEmailRuntime(siteId, workbenchSettings, current.siteName);
    const touchedAt = new Date().toISOString();
    let next: MerchantBookingStoredRecord = stampMerchantBookingTouch(current, touchedAt);
    const actionLinks = buildCustomerActionLinks(next, emailRuntime.publicSiteUrl);
    const emailResult = await sendMerchantBookingStatusEmail(next, next.status, {
      locale: emailRuntime.locale,
      senderName: emailRuntime.senderName,
      merchantDisplayName: emailRuntime.merchantDisplayName,
      extraMessage: workbenchSettings.customerAutoEmailMessageByStatus[next.status],
      actionLinks,
    }).catch(() => ({
      attempted: true as const,
      attemptedAt: touchedAt,
      status: "failed" as const,
      error: "booking_manual_email_send_failed",
      subject: "",
      locale: emailRuntime.locale,
      senderName: emailRuntime.senderName,
    }));
    if (!(emailResult.attempted && emailResult.status === "sent")) {
      if (emailResult.attempted) {
        next = appendTimelineEntry(
          next,
          createTimelineEntry({
            actor: "merchant",
            kind: "customer_email",
            at: emailResult.attemptedAt,
            emailKind: "manual",
            delivery: "failed",
            toStatus: next.status,
            subject: emailResult.subject,
            senderName: emailResult.senderName,
            locale: emailResult.locale,
            note: emailResult.error,
          }),
        );
      }
      store.records[targetIndex] = next;
      await writeMerchantBookingStore(store, [next]);
      throw new Error(resolveCustomerEmailSendFailureMessage(emailResult));
    }
    next = appendTimelineEntry(
      appendCustomerEmailLog(
        next,
        createCustomerEmailLogEntry({
          kind: "manual",
          sentAt: emailResult.attemptedAt,
          locale: emailResult.locale,
          subject: emailResult.subject,
          senderName: emailResult.senderName,
          status: next.status,
        }),
      ),
      createTimelineEntry({
        actor: "merchant",
        kind: "customer_email",
        at: emailResult.attemptedAt,
        emailKind: "manual",
        delivery: "sent",
        toStatus: next.status,
        subject: emailResult.subject,
        senderName: emailResult.senderName,
        locale: emailResult.locale,
      }),
    );
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true });
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
    let next: MerchantBookingStoredRecord = stampMerchantBookingTouch(current);
    if (!current.merchantTouchedAt) {
      next = appendTimelineEntry(
        next,
        createTimelineEntry({
          actor: "merchant",
          kind: "acknowledged",
          at: next.merchantTouchedAt || new Date().toISOString(),
        }),
      );
    }
    store.records[targetIndex] = next;
    await writeMerchantBookingStore(store, [next]);
    return withoutMerchantBookingToken(next, { includeCustomerEmailLogs: true, includeTimeline: true });
  });
}
