export const MERCHANT_BOOKING_STATUSES = ["active", "confirmed", "completed", "cancelled"] as const;

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

export type MerchantBookingStoredRecord = MerchantBookingRecord & {
  editToken: string;
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

export function buildDefaultBookingStoreOptions(siteName?: string) {
  const normalizedSiteName = normalizeSingleLineText(siteName);
  return normalizedSiteName ? [normalizedSiteName] : ["主店"];
}

export function buildDefaultBookingItemOptions() {
  return ["咨询预约", "到店服务"];
}

export function buildDefaultBookingTitleOptions() {
  return ["先生", "女士"];
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

export function validateMerchantBookingInput(value: MerchantBookingEditableInput) {
  const issues: string[] = [];
  if (!value.store) issues.push("请选择预约店铺");
  if (!value.item) issues.push("请选择预约项目");
  if (!value.appointmentAt) issues.push("请选择预约日期时间");
  if (value.appointmentAt && !isValidDateTimeValue(value.appointmentAt)) issues.push("预约日期时间格式无效");
  if (!value.title) issues.push("请选择称谓");
  if (!value.customerName) issues.push("请填写称谓或姓名");
  if (!value.email) issues.push("请填写邮箱");
  if (value.email && !isValidEmail(value.email)) issues.push("邮箱格式无效");
  if (!value.phone) issues.push("请填写电话");
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

export function getMerchantBookingStatusLabel(status: MerchantBookingStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "待确认";
}

export function withoutMerchantBookingToken(record: MerchantBookingStoredRecord): MerchantBookingRecord {
  const { editToken, ...publicRecord } = record;
  void editToken;
  return publicRecord;
}
