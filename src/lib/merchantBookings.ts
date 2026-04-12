import { getUtf8ByteLength, truncateUtf8ByBytes } from "./merchantProfileBinding";
import type { MerchantBookingRuleViewport } from "./merchantBookingRules";

export const MERCHANT_BOOKING_STATUSES = ["active", "confirmed", "completed", "cancelled"] as const;
export const MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES = 40;
export const MERCHANT_BOOKING_NOTE_MAX_BYTES = 100;

export type MerchantBookingStatus = (typeof MERCHANT_BOOKING_STATUSES)[number];

export type MerchantBookingEditableInput = {
  store: string;
  item: string;
  appointmentAt: string;
  title: string;
  customerName: string;
  email: string;
  phone: string;
  note: string;
};

export type MerchantBookingRuleBinding = {
  bookingBlockId?: string;
  bookingViewport?: MerchantBookingRuleViewport;
};

export type MerchantBookingCreateInput = MerchantBookingEditableInput & MerchantBookingRuleBinding & {
  siteId: string;
  siteName?: string;
};

export type MerchantBookingRecord = MerchantBookingEditableInput & MerchantBookingRuleBinding & {
  id: string;
  siteId: string;
  siteName: string;
  status: MerchantBookingStatus;
  createdAt: string;
  updatedAt: string;
};

export type MerchantBookingConfirmationEmailStatus = "sent" | "failed";

export type MerchantBookingStoredRecord = MerchantBookingRecord & {
  editToken: string;
  confirmationEmailLastAttemptAt?: string;
  confirmationEmailStatus?: MerchantBookingConfirmationEmailStatus;
  confirmationEmailSentAt?: string;
  confirmationEmailMessageId?: string;
  confirmationEmailError?: string;
};

export type MerchantBookingUpdateAction = "update" | "cancel";

export type MerchantBookingTimeSlotRule = {
  timeRange: string;
  maxBookings: number | null;
};

export type MerchantBookingValidationOptions = {
  availableTimeRanges?: unknown;
  blockedDates?: unknown;
  holidayDates?: unknown;
};

export type MerchantBookingActionInput = MerchantBookingRuleBinding & {
  bookingId: string;
  editToken: string;
  action: MerchantBookingUpdateAction;
  updates?: Partial<MerchantBookingEditableInput>;
};

function normalizeSingleLineText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMultiLineText(value: unknown) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function normalizePositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    return normalized >= 1 ? normalized : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

function isValidCalendarDate(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return false;
  const year = Number.parseInt(matched[1] ?? "", 10);
  const month = Number.parseInt(matched[2] ?? "", 10);
  const day = Number.parseInt(matched[3] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function normalizeBookingOptionList(value: unknown, fallback: string[] = []) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : fallback;
  const next: string[] = [];
  source.forEach((item) => {
    const normalized = normalizeSingleLineText(item);
    if (!normalized) return;
    if (!next.includes(normalized)) next.push(normalized);
  });
  return next;
}

function normalizeBookingTimeValue(value: unknown) {
  const normalized = normalizeSingleLineText(value);
  const matched = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number.parseInt(matched[1] ?? "", 10);
  const minute = Number.parseInt(matched[2] ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function toBookingTimeMinutes(value: string) {
  const normalized = normalizeBookingTimeValue(value);
  if (!normalized) return Number.NaN;
  const [hourText, minuteText] = normalized.split(":");
  return Number.parseInt(hourText ?? "", 10) * 60 + Number.parseInt(minuteText ?? "", 10);
}

export function normalizeMerchantBookingTimeRangeOptions(value: unknown, fallback: string[] = []) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : fallback;
  const next: string[] = [];
  source.forEach((item) => {
    const normalized = normalizeSingleLineText(item)
      .replace(/[~～—–－至]+/gu, "-")
      .replace(/\s*-\s*/g, "-");
    if (!normalized) return;
    if (/^\d{1,2}:\d{2}$/.test(normalized)) {
      const exact = normalizeBookingTimeValue(normalized);
      if (exact && !next.includes(exact)) next.push(exact);
      return;
    }
    const matched = normalized.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    if (!matched) return;
    const start = normalizeBookingTimeValue(matched[1] ?? "");
    const end = normalizeBookingTimeValue(matched[2] ?? "");
    if (!start || !end) return;
    const startMinutes = toBookingTimeMinutes(start);
    const endMinutes = toBookingTimeMinutes(end);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes > endMinutes) return;
    const range = `${start}-${end}`;
    if (!next.includes(range)) next.push(range);
  });
  return next;
}

export function normalizeMerchantBookingTimeSlotRules(value: unknown, fallbackRanges: unknown = []): MerchantBookingTimeSlotRule[] {
  const source = Array.isArray(value) ? value : [];
  const next: MerchantBookingTimeSlotRule[] = [];
  source.forEach((item) => {
    if (typeof item === "string") {
      const timeRange = normalizeMerchantBookingTimeRangeOptions([item])[0];
      if (!timeRange || next.some((entry) => entry.timeRange === timeRange)) return;
      next.push({ timeRange, maxBookings: null });
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Partial<MerchantBookingTimeSlotRule> & { range?: unknown };
    const timeRange = normalizeMerchantBookingTimeRangeOptions([record.timeRange ?? record.range ?? ""])[0];
    if (!timeRange || next.some((entry) => entry.timeRange === timeRange)) return;
    next.push({
      timeRange,
      maxBookings: normalizePositiveInteger(record.maxBookings),
    });
  });
  if (next.length > 0) return next;
  return normalizeMerchantBookingTimeRangeOptions(fallbackRanges).map((timeRange) => ({
    timeRange,
    maxBookings: null,
  }));
}

export function normalizeMerchantBookingDateList(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  const next: string[] = [];
  source.forEach((item) => {
    const normalized = normalizeSingleLineText(item);
    if (!normalized || !isValidCalendarDate(normalized) || next.includes(normalized)) return;
    next.push(normalized);
  });
  return next.sort();
}

export function isMerchantBookingTimeAllowed(timeValue: string, configuredRanges: unknown) {
  const normalizedTime = normalizeBookingTimeValue(timeValue);
  const ranges = normalizeMerchantBookingTimeRangeOptions(configuredRanges);
  if (ranges.length === 0) return true;
  if (!normalizedTime) return false;
  const currentMinutes = toBookingTimeMinutes(normalizedTime);
  return ranges.some((item) => {
    if (!item.includes("-")) return item === normalizedTime;
    const [start, end] = item.split("-");
    const startMinutes = toBookingTimeMinutes(start ?? "");
    const endMinutes = toBookingTimeMinutes(end ?? "");
    return (
      Number.isFinite(startMinutes) &&
      Number.isFinite(endMinutes) &&
      currentMinutes >= startMinutes &&
      currentMinutes <= endMinutes
    );
  });
}

export function getMerchantBookingMatchedTimeSlotRule(
  timeValue: string | null | undefined,
  slotRules: unknown,
) {
  const normalizedTime = normalizeBookingTimeValue(timeValue);
  if (!normalizedTime) return null;
  const normalizedRules = normalizeMerchantBookingTimeSlotRules(slotRules);
  return normalizedRules.find((rule) => isMerchantBookingTimeAllowed(normalizedTime, [rule.timeRange])) ?? null;
}

export function getMerchantBookingDateAvailabilityIssue(
  dateValue: string | null | undefined,
  blockedDates: unknown,
  holidayDates: unknown,
) {
  const normalizedDate = normalizeSingleLineText(dateValue);
  if (!normalizedDate || !isValidCalendarDate(normalizedDate)) return "";
  if (normalizeMerchantBookingDateList(blockedDates).includes(normalizedDate)) {
    return "该日期已被加入黑名单，请选择其他日期";
  }
  if (normalizeMerchantBookingDateList(holidayDates).includes(normalizedDate)) {
    return "该日期为节假日，不可预约";
  }
  return "";
}

export function getMerchantBookingSlotCapacityIssue(
  appointmentAt: string,
  slotRules: unknown,
  records: Array<Pick<MerchantBookingRecord, "id" | "appointmentAt" | "status">>,
  options?: { excludeBookingId?: string | null },
) {
  const { date, time } = splitMerchantBookingDateTime(appointmentAt);
  if (!date || !time) return "";
  const matchedRule = getMerchantBookingMatchedTimeSlotRule(time, slotRules);
  if (!matchedRule?.maxBookings) return "";
  const occupiedCount = records.filter((record) => {
    if (options?.excludeBookingId && record.id === options.excludeBookingId) return false;
    if (record.status !== "active" && record.status !== "confirmed") return false;
    const target = splitMerchantBookingDateTime(record.appointmentAt);
    return target.date === date && isMerchantBookingTimeAllowed(target.time, [matchedRule.timeRange]);
  }).length;
  if (occupiedCount >= matchedRule.maxBookings) {
    return "该预约时段人数已满，请选择其他时间";
  }
  return "";
}

export function getMerchantBookingTimeAvailabilityIssue(timeValue: string | null | undefined, configuredRanges: unknown) {
  const rawValue = normalizeSingleLineText(timeValue);
  if (!rawValue) return "";
  const normalizedTime = normalizeBookingTimeValue(rawValue);
  const ranges = normalizeMerchantBookingTimeRangeOptions(configuredRanges);
  if (ranges.length === 0 || !normalizedTime) return "";
  if (isMerchantBookingTimeAllowed(normalizedTime, ranges)) return "";
  return "预约时间需在可预约时段内";
}

export function buildDefaultBookingStoreOptions(siteName?: string) {
  const normalizedSiteName = normalizeSingleLineText(siteName);
  return normalizedSiteName ? [normalizedSiteName] : ["\u4e3b\u5e97"];
}

export function buildDefaultBookingItemOptions() {
  return ["\u54a8\u8be2\u9884\u7ea6", "\u5230\u5e97\u670d\u52a1"];
}

export function buildDefaultBookingTitleOptions() {
  return ["\u5148\u751f", "\u5973\u58eb"];
}

export function createEmptyMerchantBookingInput(): MerchantBookingEditableInput {
  return {
    store: "",
    item: "",
    appointmentAt: "",
    title: "",
    customerName: "",
    email: "",
    phone: "",
    note: "",
  };
}

export function sanitizeMerchantBookingEditableInput(
  value: Partial<MerchantBookingEditableInput> | null | undefined,
  fallback?: MerchantBookingEditableInput,
): MerchantBookingEditableInput {
  const base = fallback ?? createEmptyMerchantBookingInput();
  return {
    store: normalizeSingleLineText(value?.store ?? base.store),
    item: normalizeSingleLineText(value?.item ?? base.item),
    appointmentAt: normalizeSingleLineText(value?.appointmentAt ?? base.appointmentAt),
    title: normalizeSingleLineText(value?.title ?? base.title),
    customerName: normalizeSingleLineText(value?.customerName ?? base.customerName),
    email: normalizeSingleLineText(value?.email ?? base.email).toLowerCase(),
    phone: normalizeSingleLineText(value?.phone ?? base.phone),
    note: normalizeMultiLineText(value?.note ?? base.note),
  };
}

export function splitMerchantBookingDateTime(value: string) {
  const normalized = normalizeSingleLineText(value);
  if (!normalized) {
    return { date: "", time: "" };
  }
  const [datePart = "", rawTimePart = ""] = normalized.replace(" ", "T").split("T");
  const timePart = rawTimePart.slice(0, 5);
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "",
    time: /^\d{2}:\d{2}$/.test(timePart) ? timePart : "",
  };
}

export function joinMerchantBookingDateTime(date: string, time: string) {
  const normalizedDate = normalizeSingleLineText(date);
  const normalizedTime = normalizeSingleLineText(time);
  if (normalizedDate && normalizedTime) return `${normalizedDate}T${normalizedTime}`;
  return normalizedDate || normalizedTime;
}

function isValidDateTimeValue(value: string) {
  if (!value) return false;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!matched) return false;
  const year = Number.parseInt(matched[1] ?? "", 10);
  const month = Number.parseInt(matched[2] ?? "", 10);
  const day = Number.parseInt(matched[3] ?? "", 10);
  const hour = Number.parseInt(matched[4] ?? "", 10);
  const minute = Number.parseInt(matched[5] ?? "", 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return false;
  }
  const timestamp = new Date(normalized);
  return (
    Number.isFinite(timestamp.getTime()) &&
    timestamp.getFullYear() === year &&
    timestamp.getMonth() + 1 === month &&
    timestamp.getDate() === day &&
    timestamp.getHours() === hour &&
    timestamp.getMinutes() === minute
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeMerchantBookingCustomerNameInput(value: string | null | undefined) {
  return truncateUtf8ByBytes(String(value ?? ""), MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES);
}

export function normalizeMerchantBookingNoteInput(value: string | null | undefined) {
  return truncateUtf8ByBytes(String(value ?? "").replace(/\r\n/g, "\n"), MERCHANT_BOOKING_NOTE_MAX_BYTES);
}

export function getMerchantBookingCustomerNameError(value: string | null | undefined) {
  if (getUtf8ByteLength(normalizeSingleLineText(value)) > MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES) {
    return `\u59d3\u540d\u6700\u591a ${MERCHANT_BOOKING_CUSTOMER_NAME_MAX_BYTES} \u5b57\u8282`;
  }
  return "";
}

export function getMerchantBookingNoteError(value: string | null | undefined) {
  if (getUtf8ByteLength(normalizeMultiLineText(value)) > MERCHANT_BOOKING_NOTE_MAX_BYTES) {
    return `\u5907\u6ce8\u6700\u591a ${MERCHANT_BOOKING_NOTE_MAX_BYTES} \u5b57\u8282`;
  }
  return "";
}

export function validateMerchantBookingInput(value: MerchantBookingEditableInput, options?: MerchantBookingValidationOptions) {
  const issues: string[] = [];
  if (!value.store) issues.push("\u8bf7\u9009\u62e9\u9884\u7ea6\u5e97\u94fa");
  if (!value.item) issues.push("\u8bf7\u9009\u62e9\u9884\u7ea6\u9879\u76ee");
  if (!value.appointmentAt) issues.push("\u8bf7\u9009\u62e9\u9884\u7ea6\u65e5\u671f\u65f6\u95f4");
  if (value.appointmentAt && !isValidDateTimeValue(value.appointmentAt)) {
    issues.push("\u9884\u7ea6\u65e5\u671f\u65f6\u95f4\u683c\u5f0f\u65e0\u6548");
  }
  if (value.appointmentAt && isValidDateTimeValue(value.appointmentAt)) {
    const { date, time } = splitMerchantBookingDateTime(value.appointmentAt);
    const dateAvailabilityIssue = getMerchantBookingDateAvailabilityIssue(date, options?.blockedDates, options?.holidayDates);
    if (dateAvailabilityIssue) issues.push(dateAvailabilityIssue);
    const timeAvailabilityIssue = getMerchantBookingTimeAvailabilityIssue(time, options?.availableTimeRanges);
    if (timeAvailabilityIssue) issues.push(timeAvailabilityIssue);
  }
  if (!value.title) issues.push("\u8bf7\u9009\u62e9\u79f0\u8c13");
  if (!value.customerName) issues.push("\u8bf7\u586b\u5199\u79f0\u8c13\u6216\u59d3\u540d");
  const customerNameError = getMerchantBookingCustomerNameError(value.customerName);
  if (customerNameError) issues.push(customerNameError);
  if (!value.email) issues.push("\u8bf7\u586b\u5199\u90ae\u7bb1");
  if (value.email && !isValidEmail(value.email)) issues.push("\u90ae\u7bb1\u683c\u5f0f\u65e0\u6548");
  if (!value.phone) issues.push("\u8bf7\u586b\u5199\u7535\u8bdd");
  const noteError = getMerchantBookingNoteError(value.note);
  if (noteError) issues.push(noteError);
  return issues;
}

export function formatMerchantBookingDateTime(value: string) {
  const normalized = normalizeSingleLineText(value);
  if (!normalized) return "";
  return normalized.replace("T", " ");
}

function padBookingSequence(value: number) {
  return String(Math.max(0, Math.trunc(value))).padStart(4, "0");
}

export function formatMerchantBookingIdDate(value: Date | string) {
  const source = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(source.getTime())) return "";
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function buildMerchantBookingId(siteId: string, createdAt: Date | string, existingIds: string[]) {
  const normalizedSiteId = normalizeSingleLineText(siteId);
  const datePart = formatMerchantBookingIdDate(createdAt);
  if (!normalizedSiteId || !datePart) {
    return "";
  }
  const prefix = `R${normalizedSiteId}${datePart}`;
  const maxSequence = existingIds.reduce((highest, currentId) => {
    if (!currentId.startsWith(prefix)) return highest;
    const sequence = Number.parseInt(currentId.slice(prefix.length), 10);
    return Number.isFinite(sequence) ? Math.max(highest, sequence) : highest;
  }, 0);
  return `${prefix}${padBookingSequence(maxSequence + 1)}`;
}

export function shouldSendMerchantBookingConfirmationEmail(input: {
  currentStatus: MerchantBookingStatus;
  nextStatus: MerchantBookingStatus;
  confirmationEmailLastAttemptAt?: string | null;
}) {
  return (
    input.currentStatus !== "confirmed" &&
    input.nextStatus === "confirmed" &&
    !normalizeSingleLineText(input.confirmationEmailLastAttemptAt ?? "")
  );
}

export function getMerchantBookingStatusLabel(status: MerchantBookingStatus) {
  if (status === "confirmed") return "\u5df2\u786e\u8ba4";
  if (status === "completed") return "\u5df2\u5b8c\u6210";
  if (status === "cancelled") return "\u5df2\u53d6\u6d88";
  return "\u5f85\u786e\u8ba4";
}

export function withoutMerchantBookingToken(record: MerchantBookingStoredRecord): MerchantBookingRecord {
  const {
    editToken,
    confirmationEmailLastAttemptAt,
    confirmationEmailStatus,
    confirmationEmailSentAt,
    confirmationEmailMessageId,
    confirmationEmailError,
    ...publicRecord
  } = record;
  void editToken;
  void confirmationEmailLastAttemptAt;
  void confirmationEmailStatus;
  void confirmationEmailSentAt;
  void confirmationEmailMessageId;
  void confirmationEmailError;
  return publicRecord;
}
