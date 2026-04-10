import type { MerchantBookingStatus } from "@/lib/merchantBookings";
import { getUiGlossaryLocale, getUiGlossaryText } from "@/lib/uiGlossary";

export type MerchantBookingFilter = "all" | MerchantBookingStatus;

type BookingActionKey =
  | "processing"
  | "restore"
  | "uncomplete"
  | "unconfirm"
  | "confirm"
  | "complete"
  | "cancel"
  | "detail"
  | "close"
  | "save"
  | "pullToRefresh"
  | "releaseToRefresh"
  | "refreshing";

type BookingFieldKey =
  | "managementTitle"
  | "detailTitle"
  | "managementEmpty"
  | "managementLoading"
  | "missingSite"
  | "searchDesktop"
  | "searchMobile"
  | "bookingId"
  | "createdAt"
  | "submittedAt"
  | "store"
  | "item"
  | "appointmentAt"
  | "title"
  | "customerName"
  | "email"
  | "phone"
  | "note"
  | "replyEmail"
  | "callPhone"
  | "hasNote"
  | "unnamedBooking";

const FIELD_SOURCE: Record<BookingFieldKey, string> = {
  managementTitle: "预约管理",
  detailTitle: "预约详情",
  managementEmpty: "还没有匹配到预约记录。",
  managementLoading: "正在读取预约记录...",
  missingSite: "当前商户信息未准备好，暂时无法读取预约管理。",
  searchDesktop: "搜索预约编号 / 店铺 / 项目 / 姓名 / 邮箱 / 电话 / 备注",
  searchMobile: "搜索预约号 / 姓名 / 邮箱 / 电话",
  bookingId: "预约编号",
  createdAt: "创建时间",
  submittedAt: "提交时间",
  store: "店铺",
  item: "项目",
  appointmentAt: "预约时间",
  title: "称谓",
  customerName: "姓名",
  email: "邮箱",
  phone: "电话",
  note: "备注",
  replyEmail: "回复邮箱",
  callPhone: "拨打电话",
  hasNote: "有备注",
  unnamedBooking: "未命名预约",
};

const ACTION_SOURCE: Record<BookingActionKey, string> = {
  processing: "处理中...",
  restore: "恢复预约",
  uncomplete: "取消完成",
  unconfirm: "取消确认",
  confirm: "确认预约",
  complete: "完成预约",
  cancel: "取消预约",
  detail: "详情",
  close: "关闭",
  save: "保存",
  pullToRefresh: "下拉刷新",
  releaseToRefresh: "松开刷新",
  refreshing: "刷新中...",
};

const STATUS_SOURCE: Record<MerchantBookingStatus, string> = {
  active: "待确认",
  confirmed: "已确认",
  completed: "已完成",
  cancelled: "已取消",
};

const TITLE_SUFFIX_LOCALES = new Set(["zh-cn", "zh-tw", "ja", "ko"]);

function stripAccents(input: string) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toIntlLocale(locale: string | null | undefined) {
  const normalized = String(locale ?? "").trim();
  if (!normalized) return "en-GB";
  if (normalized.toLowerCase() === "zh-cn") return "zh-CN";
  if (normalized.toLowerCase() === "zh-tw") return "zh-TW";
  return normalized;
}

function resolveHonorificBucket(title: string) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) return "";
  const normalized = stripAccents(trimmed).toLowerCase();
  const maleTokens = new Set([
    "先生",
    "sir",
    "mr",
    "mr.",
    "sr",
    "sr.",
    "senor",
    "monsieur",
    "herr",
    "signore",
    "senhor",
    "gentleman",
    "male",
    "пан",
    "pan",
    "bey",
    "dhr",
    "dhr.",
    "mijnheer",
    "domnule",
    "herra",
    "sur",
    "様",
    "님",
  ]);
  const femaleTokens = new Set([
    "女士",
    "lady",
    "miss",
    "ms",
    "ms.",
    "mrs",
    "mrs.",
    "sra",
    "sra.",
    "senora",
    "madame",
    "mme",
    "mme.",
    "frau",
    "signora",
    "sig.ra",
    "senhora",
    "female",
    "mujer",
    "woman",
    "пані",
    "pani",
    "hanim",
    "hanım",
    "mevr",
    "mevr.",
    "doamna",
    "fru",
    "fru.",
    "rouva",
    "sinjura",
    "madamm",
    "様",
    "님",
  ]);
  if (maleTokens.has(normalized)) return "male";
  if (femaleTokens.has(normalized)) return "female";
  return "";
}

export function isSpanishBookingLocale(locale: string | null | undefined) {
  return getUiGlossaryLocale(locale) === "es";
}

export function getMerchantBookingFieldText(key: BookingFieldKey, locale: string) {
  return getUiGlossaryText(FIELD_SOURCE[key], locale);
}

export function getMerchantBookingManagementSubtitle(siteName: string, locale: string) {
  const template = getUiGlossaryText("查看并管理 {site} 收到的预约记录。", locale);
  return template.replace("{site}", siteName);
}

export function getMerchantBookingActionText(key: BookingActionKey, locale: string) {
  return getUiGlossaryText(ACTION_SOURCE[key], locale);
}

export function getMerchantBookingStatusText(status: MerchantBookingStatus, locale: string) {
  return getUiGlossaryText(STATUS_SOURCE[status], locale);
}

export function getMerchantBookingFilterText(filter: MerchantBookingFilter, count: number, locale: string) {
  if (filter === "all") return `${getUiGlossaryText("全部", locale)} ${count}`;
  return `${getMerchantBookingStatusText(filter, locale)} ${count}`;
}

export function getMerchantBookingDisplayTitle(title: string, locale: string) {
  const trimmed = String(title ?? "").trim();
  if (!trimmed) return "";
  const bucket = resolveHonorificBucket(trimmed);
  if (bucket === "male") return getUiGlossaryText("先生", locale);
  if (bucket === "female") return getUiGlossaryText("女士", locale);
  return trimmed;
}

export function formatMerchantBookingDisplayName(name: string, title: string, locale: string) {
  const trimmedName = String(name ?? "").trim();
  const localizedTitle = getMerchantBookingDisplayTitle(title, locale);
  if (!trimmedName && !localizedTitle) {
    return getMerchantBookingFieldText("unnamedBooking", locale);
  }
  const localeKey = getUiGlossaryLocale(locale);
  if (!localizedTitle) return trimmedName;
  if (!trimmedName) return localizedTitle;
  if (TITLE_SUFFIX_LOCALES.has(localeKey)) {
    return `${trimmedName} ${localizedTitle}`;
  }
  return `${localizedTitle} ${trimmedName}`;
}

export function getMerchantBookingDayLabel(dateValue: string, locale: string) {
  const normalized = String(dateValue ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const [year, month, day] = normalized.split("-").map((item) => Number.parseInt(item, 10));
  const date = new Date(year, month - 1, day);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }

  const now = new Date();
  const isToday =
    now.getFullYear() === year &&
    now.getMonth() === month - 1 &&
    now.getDate() === day;
  if (isToday) {
    return getUiGlossaryText("今天", locale);
  }

  return new Intl.DateTimeFormat(toIntlLocale(locale), { weekday: "short" }).format(date);
}

export function formatMerchantBookingDateTime(value: string, locale: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
