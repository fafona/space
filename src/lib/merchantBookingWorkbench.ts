import {
  isMerchantBookingTimeAllowed,
  normalizeMerchantBookingTimeRangeOptions,
  splitMerchantBookingDateTime,
  type MerchantBookingRecord,
  type MerchantBookingStatus,
} from "./merchantBookings";

export type MerchantBookingRecurringRule = {
  id: string;
  weekday: number;
  allDay: boolean;
  timeRanges: string[];
};

export type MerchantBookingWorkbenchPublicSettings = {
  minAdvanceMinutes: number | null;
  dailyCutoffTime: string;
  bufferMinutes: number | null;
  recurringRules: MerchantBookingRecurringRule[];
};

export type MerchantBookingWorkbenchSettings = MerchantBookingWorkbenchPublicSettings & {
  customerReminderOffsetsMinutes: number[];
  merchantReminderOffsetsMinutes: number[];
  noShowEnabled: boolean;
  noShowGraceMinutes: number | null;
  calendarSyncToken: string;
  calendarSyncTokenUpdatedAt: string;
};

const WORKBENCH_DEFAULTS: MerchantBookingWorkbenchSettings = {
  minAdvanceMinutes: null,
  dailyCutoffTime: "",
  bufferMinutes: null,
  recurringRules: [],
  customerReminderOffsetsMinutes: [],
  merchantReminderOffsetsMinutes: [],
  noShowEnabled: false,
  noShowGraceMinutes: null,
  calendarSyncToken: "",
  calendarSyncTokenUpdatedAt: "",
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveMinutes(value: unknown) {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 1) return null;
  return Math.min(60 * 24 * 30, numeric);
}

function normalizeClockTime(value: unknown) {
  const normalized = trimText(value);
  const matched = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number.parseInt(matched[1] ?? "", 10);
  const minute = Number.parseInt(matched[2] ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeWeekday(value: unknown) {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 6) return null;
  return numeric;
}

function normalizeReminderOffsets(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : [];
  const next: number[] = [];
  source.forEach((item) => {
    const normalized = normalizePositiveMinutes(item);
    if (!normalized || next.includes(normalized)) return;
    next.push(normalized);
  });
  return next.sort((left, right) => right - left);
}

function normalizeRecurringRules(value: unknown) {
  if (!Array.isArray(value)) return [] as MerchantBookingRecurringRule[];
  const next: MerchantBookingRecurringRule[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Partial<MerchantBookingRecurringRule>;
    const weekday = normalizeWeekday(record.weekday);
    if (weekday === null) return;
    const allDay = record.allDay === true;
    const timeRanges = allDay ? [] : normalizeMerchantBookingTimeRangeOptions(record.timeRanges);
    next.push({
      id: trimText(record.id) || `recurring-${weekday}-${index + 1}`,
      weekday,
      allDay,
      timeRanges,
    });
  });
  return next;
}

function parseLocalDateTime(value: string) {
  const { date, time } = splitMerchantBookingDateTime(value);
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map((item) => Number.parseInt(item, 10));
  const [hour, minute] = time.split(":").map((item) => Number.parseInt(item, 10));
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }
  return parsed;
}

function toClockMinutes(value: string) {
  const normalized = normalizeClockTime(value);
  if (!normalized) return Number.NaN;
  const [hourText, minuteText] = normalized.split(":");
  return Number.parseInt(hourText ?? "", 10) * 60 + Number.parseInt(minuteText ?? "", 10);
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function createDefaultMerchantBookingWorkbenchSettings(): MerchantBookingWorkbenchSettings {
  return {
    ...WORKBENCH_DEFAULTS,
    recurringRules: [],
    customerReminderOffsetsMinutes: [],
    merchantReminderOffsetsMinutes: [],
  };
}

export function normalizeMerchantBookingWorkbenchSettings(value: unknown): MerchantBookingWorkbenchSettings {
  const source = value && typeof value === "object" ? (value as Partial<MerchantBookingWorkbenchSettings>) : {};
  return {
    minAdvanceMinutes: normalizePositiveMinutes(source.minAdvanceMinutes),
    dailyCutoffTime: normalizeClockTime(source.dailyCutoffTime),
    bufferMinutes: normalizePositiveMinutes(source.bufferMinutes),
    recurringRules: normalizeRecurringRules(source.recurringRules),
    customerReminderOffsetsMinutes: normalizeReminderOffsets(source.customerReminderOffsetsMinutes),
    merchantReminderOffsetsMinutes: normalizeReminderOffsets(source.merchantReminderOffsetsMinutes),
    noShowEnabled: source.noShowEnabled === true,
    noShowGraceMinutes: normalizePositiveMinutes(source.noShowGraceMinutes),
    calendarSyncToken: trimText(source.calendarSyncToken),
    calendarSyncTokenUpdatedAt: trimText(source.calendarSyncTokenUpdatedAt),
  };
}

export function getMerchantBookingWorkbenchPublicSettings(
  value: unknown,
): MerchantBookingWorkbenchPublicSettings {
  const normalized = normalizeMerchantBookingWorkbenchSettings(value);
  return {
    minAdvanceMinutes: normalized.minAdvanceMinutes,
    dailyCutoffTime: normalized.dailyCutoffTime,
    bufferMinutes: normalized.bufferMinutes,
    recurringRules: normalized.recurringRules,
  };
}

export function formatMerchantBookingReminderOffset(minutes: number) {
  const normalized = normalizePositiveMinutes(minutes);
  if (!normalized) return "";
  if (normalized % (60 * 24) === 0) {
    return `${normalized / (60 * 24)} 天前`;
  }
  if (normalized % 60 === 0) {
    return `${normalized / 60} 小时前`;
  }
  return `${normalized} 分钟前`;
}

export function getMerchantBookingAdvanceIssue(
  appointmentAt: string,
  settings: MerchantBookingWorkbenchPublicSettings | null | undefined,
  now = new Date(),
) {
  const appointmentDate = parseLocalDateTime(appointmentAt);
  if (!appointmentDate) return "";

  const minAdvanceMinutes = settings?.minAdvanceMinutes ?? null;
  if (minAdvanceMinutes && appointmentDate.getTime() - now.getTime() < minAdvanceMinutes * 60 * 1000) {
    return `当前预约需至少提前 ${minAdvanceMinutes} 分钟提交`;
  }

  const cutoffTime = settings?.dailyCutoffTime ?? "";
  if (cutoffTime && isSameCalendarDay(appointmentDate, now)) {
    const cutoffClockMinutes = toClockMinutes(cutoffTime);
    const nowClockMinutes = now.getHours() * 60 + now.getMinutes();
    if (Number.isFinite(cutoffClockMinutes) && nowClockMinutes >= cutoffClockMinutes) {
      return "已过今日截止时间，请选择明天或之后的预约日期";
    }
  }

  return "";
}

export function getMerchantBookingRecurringIssue(
  appointmentAt: string,
  recurringRules: MerchantBookingRecurringRule[] | null | undefined,
) {
  const appointmentDate = parseLocalDateTime(appointmentAt);
  if (!appointmentDate) return "";
  const { time } = splitMerchantBookingDateTime(appointmentAt);
  const weekday = appointmentDate.getDay();
  const rules = normalizeRecurringRules(recurringRules);
  for (const rule of rules) {
    if (rule.weekday !== weekday) continue;
    if (rule.allDay) {
      return "该日期属于固定休息日，当前不可预约";
    }
    if (time && rule.timeRanges.length > 0 && isMerchantBookingTimeAllowed(time, rule.timeRanges)) {
      return "该时间属于固定停约时段，请选择其他时间";
    }
  }
  return "";
}

export function getMerchantBookingBufferIssue(
  targetBooking: Pick<MerchantBookingRecord, "appointmentAt" | "store" | "item">,
  bufferMinutes: number | null | undefined,
  records: Array<Pick<MerchantBookingRecord, "id" | "appointmentAt" | "status" | "store" | "item">>,
  options?: { excludeBookingId?: string | null },
) {
  const normalizedBufferMinutes = normalizePositiveMinutes(bufferMinutes);
  if (!normalizedBufferMinutes) return "";
  const targetDate = parseLocalDateTime(targetBooking.appointmentAt);
  if (!targetDate) return "";
  const targetStore = trimText(targetBooking.store);
  const targetItem = trimText(targetBooking.item);
  const targetTimestamp = targetDate.getTime();
  const conflict = records.some((record) => {
    if (options?.excludeBookingId && record.id === options.excludeBookingId) return false;
    if (record.status !== "active" && record.status !== "confirmed") return false;
    if (trimText(record.store) !== targetStore || trimText(record.item) !== targetItem) return false;
    const currentDate = parseLocalDateTime(record.appointmentAt);
    if (!currentDate) return false;
    return Math.abs(currentDate.getTime() - targetTimestamp) < normalizedBufferMinutes * 60 * 1000;
  });
  return conflict ? `当前同店铺同项目的预约至少需要间隔 ${normalizedBufferMinutes} 分钟` : "";
}

export function shouldMarkMerchantBookingNoShow(
  booking: Pick<MerchantBookingRecord, "status" | "appointmentAt">,
  settings: Pick<MerchantBookingWorkbenchSettings, "noShowEnabled" | "noShowGraceMinutes">,
  now = new Date(),
) {
  if (!settings.noShowEnabled || !settings.noShowGraceMinutes) return false;
  if (booking.status !== "active" && booking.status !== "confirmed") return false;
  const appointmentDate = parseLocalDateTime(booking.appointmentAt);
  if (!appointmentDate) return false;
  return appointmentDate.getTime() + settings.noShowGraceMinutes * 60 * 1000 <= now.getTime();
}

export function isMerchantBookingReminderDue(
  booking: Pick<MerchantBookingRecord, "status" | "appointmentAt">,
  offsetMinutes: number,
  now = new Date(),
) {
  const normalizedOffset = normalizePositiveMinutes(offsetMinutes);
  if (!normalizedOffset) return false;
  if (booking.status !== "active" && booking.status !== "confirmed") return false;
  const appointmentDate = parseLocalDateTime(booking.appointmentAt);
  if (!appointmentDate) return false;
  const remainingMinutes = Math.floor((appointmentDate.getTime() - now.getTime()) / 60000);
  return remainingMinutes > 0 && remainingMinutes <= normalizedOffset;
}

export function buildMerchantBookingReminderSummary(
  records: Array<Pick<MerchantBookingRecord, "status" | "appointmentAt">>,
  settings: MerchantBookingWorkbenchSettings,
  now = new Date(),
) {
  const activeRecords = records.filter((record) => record.status === "active" || record.status === "confirmed");
  const dueCustomerReminderCount = activeRecords.filter((record) =>
    settings.customerReminderOffsetsMinutes.some((offset) => isMerchantBookingReminderDue(record, offset, now)),
  ).length;
  const dueMerchantReminderCount = activeRecords.filter((record) =>
    settings.merchantReminderOffsetsMinutes.some((offset) => isMerchantBookingReminderDue(record, offset, now)),
  ).length;
  const pendingNoShowCount = activeRecords.filter((record) => shouldMarkMerchantBookingNoShow(record, settings, now)).length;
  return {
    dueCustomerReminderCount,
    dueMerchantReminderCount,
    pendingNoShowCount,
  };
}

export function isMerchantBookingStatusOpen(status: MerchantBookingStatus) {
  return status === "active" || status === "confirmed";
}
