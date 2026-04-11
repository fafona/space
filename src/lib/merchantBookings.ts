import { getUtf8ByteLength, truncateUtf8ByBytes } from "./merchantProfileBinding";

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

export type MerchantBookingCreateInput = MerchantBookingEditableInput & {
  siteId: string;
  siteName?: string;
};

export type MerchantBookingRecord = MerchantBookingEditableInput & {
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

export type MerchantBookingActionInput = {
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

export function validateMerchantBookingInput(value: MerchantBookingEditableInput) {
  const issues: string[] = [];
  if (!value.store) issues.push("\u8bf7\u9009\u62e9\u9884\u7ea6\u5e97\u94fa");
  if (!value.item) issues.push("\u8bf7\u9009\u62e9\u9884\u7ea6\u9879\u76ee");
  if (!value.appointmentAt) issues.push("\u8bf7\u9009\u62e9\u9884\u7ea6\u65e5\u671f\u65f6\u95f4");
  if (value.appointmentAt && !isValidDateTimeValue(value.appointmentAt)) {
    issues.push("\u9884\u7ea6\u65e5\u671f\u65f6\u95f4\u683c\u5f0f\u65e0\u6548");
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
