export const MERCHANT_BOOKING_STATUSES = ["active", "cancelled"] as const;

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

function isValidDateTimeValue(value: string) {
  if (!value) return false;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const time = new Date(normalized).getTime();
  return Number.isFinite(time);
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

export function withoutMerchantBookingToken(record: MerchantBookingStoredRecord): MerchantBookingRecord {
  const { editToken, ...publicRecord } = record;
  void editToken;
  return publicRecord;
}
