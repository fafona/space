import {
  MERCHANT_BOOKING_STATUSES,
  splitMerchantBookingDateTime,
  type MerchantBookingRecord,
  type MerchantBookingStatus,
} from "@/lib/merchantBookings";

export type MerchantBookingSortMode = "appointment" | "submitted";
export type MerchantBookingHistoryVisibility = "none" | "today" | "3d" | "7d";

export type MerchantBookingManagerPreferences = {
  selectedStatuses: MerchantBookingStatus[];
  sortMode: MerchantBookingSortMode;
  historyVisibility: MerchantBookingHistoryVisibility;
};

const STORAGE_KEY_PREFIX = "merchant-space:booking-manager-preferences:v1:";

export const MERCHANT_BOOKING_SORT_MODES: MerchantBookingSortMode[] = ["appointment", "submitted"];
export const MERCHANT_BOOKING_HISTORY_VISIBILITY_OPTIONS: MerchantBookingHistoryVisibility[] = [
  "none",
  "today",
  "3d",
  "7d",
];

export function getDefaultMerchantBookingManagerPreferences(): MerchantBookingManagerPreferences {
  return {
    selectedStatuses: [...MERCHANT_BOOKING_STATUSES],
    sortMode: "appointment",
    historyVisibility: "7d",
  };
}

function normalizeSelectedStatuses(value: unknown) {
  if (!Array.isArray(value)) {
    return [...MERCHANT_BOOKING_STATUSES];
  }
  return MERCHANT_BOOKING_STATUSES.filter((status) => value.includes(status));
}

function normalizeSortMode(value: unknown): MerchantBookingSortMode {
  return value === "submitted" ? "submitted" : "appointment";
}

function normalizeHistoryVisibility(value: unknown): MerchantBookingHistoryVisibility {
  return value === "none" || value === "today" || value === "3d" || value === "7d" ? value : "7d";
}

export function normalizeMerchantBookingManagerPreferences(value: unknown): MerchantBookingManagerPreferences {
  const input = value && typeof value === "object" ? (value as Partial<MerchantBookingManagerPreferences>) : {};
  return {
    selectedStatuses: normalizeSelectedStatuses(input.selectedStatuses),
    sortMode: normalizeSortMode(input.sortMode),
    historyVisibility: normalizeHistoryVisibility(input.historyVisibility),
  };
}

function getStorageKey(siteId: string) {
  return `${STORAGE_KEY_PREFIX}${siteId || "global"}`;
}

export function loadMerchantBookingManagerPreferences(siteId: string): MerchantBookingManagerPreferences {
  if (typeof window === "undefined") {
    return getDefaultMerchantBookingManagerPreferences();
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(siteId));
    if (!raw) return getDefaultMerchantBookingManagerPreferences();
    return normalizeMerchantBookingManagerPreferences(JSON.parse(raw));
  } catch {
    return getDefaultMerchantBookingManagerPreferences();
  }
}

export function saveMerchantBookingManagerPreferences(
  siteId: string,
  value: MerchantBookingManagerPreferences,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getStorageKey(siteId),
      JSON.stringify(normalizeMerchantBookingManagerPreferences(value)),
    );
  } catch {
    // Ignore storage write failures.
  }
}

function getReferenceDayStart(referenceDate: Date) {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime();
}

function getHistoryThresholdStart(
  historyVisibility: MerchantBookingHistoryVisibility,
  referenceDate: Date,
): number | null {
  if (historyVisibility === "none") return null;
  const dayStart = getReferenceDayStart(referenceDate);
  if (historyVisibility === "today") return dayStart;
  const daysBack = historyVisibility === "3d" ? 3 : 7;
  const thresholdDate = new Date(dayStart);
  thresholdDate.setDate(thresholdDate.getDate() - daysBack);
  return thresholdDate.getTime();
}

function parseCalendarDateMillis(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return Number.NaN;
  const year = Number.parseInt(matched[1] ?? "", 10);
  const month = Number.parseInt(matched[2] ?? "", 10);
  const day = Number.parseInt(matched[3] ?? "", 10);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return Number.NaN;
  }
  return date.getTime();
}

function parseAppointmentMillis(record: MerchantBookingRecord) {
  const parts = splitMerchantBookingDateTime(record.appointmentAt);
  if (!parts.date) return Number.POSITIVE_INFINITY;
  const dateMatch = parts.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return Number.POSITIVE_INFINITY;
  const hour = Number.parseInt(parts.time.slice(0, 2) || "0", 10);
  const minute = Number.parseInt(parts.time.slice(3, 5) || "0", 10);
  const year = Number.parseInt(dateMatch[1] ?? "", 10);
  const month = Number.parseInt(dateMatch[2] ?? "", 10);
  const day = Number.parseInt(dateMatch[3] ?? "", 10);
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return date.getTime();
}

function parseCreatedAtMillis(record: MerchantBookingRecord) {
  const timestamp = Date.parse(record.createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function filterMerchantBookingRecordsByHistory(
  records: MerchantBookingRecord[],
  historyVisibility: MerchantBookingHistoryVisibility,
  referenceDate: Date = new Date(),
) {
  const threshold = getHistoryThresholdStart(historyVisibility, referenceDate);
  if (threshold === null) return [...records];
  return records.filter((record) => {
    const { date } = splitMerchantBookingDateTime(record.appointmentAt);
    if (!date) return true;
    const dateMillis = parseCalendarDateMillis(date);
    if (!Number.isFinite(dateMillis)) return true;
    return dateMillis >= threshold;
  });
}

export function sortMerchantBookingRecords(
  records: MerchantBookingRecord[],
  sortMode: MerchantBookingSortMode,
) {
  const next = [...records];
  next.sort((left, right) => {
    if (sortMode === "submitted") {
      const createdDiff = parseCreatedAtMillis(right) - parseCreatedAtMillis(left);
      if (createdDiff !== 0) return createdDiff;
      return parseAppointmentMillis(right) - parseAppointmentMillis(left);
    }
    const appointmentDiff = parseAppointmentMillis(right) - parseAppointmentMillis(left);
    if (appointmentDiff !== 0) return appointmentDiff;
    return parseCreatedAtMillis(right) - parseCreatedAtMillis(left);
  });
  return next;
}

function resolveLocaleBucket(locale: string) {
  const normalized = String(locale ?? "").trim().toLowerCase();
  if (normalized.startsWith("es")) return "es";
  if (normalized.startsWith("en")) return "en";
  return "zh";
}

export function getMerchantBookingSortLabel(locale: string) {
  const bucket = resolveLocaleBucket(locale);
  if (bucket === "es") return "Orden";
  if (bucket === "en") return "Sort";
  return "排序";
}

export function getMerchantBookingSortOptionText(mode: MerchantBookingSortMode, locale: string) {
  const bucket = resolveLocaleBucket(locale);
  if (bucket === "es") {
    return mode === "submitted" ? "Hora de envío" : "Hora de cita";
  }
  if (bucket === "en") {
    return mode === "submitted" ? "Submitted time" : "Appointment time";
  }
  return mode === "submitted" ? "提交时间" : "预约时间";
}

export function getMerchantBookingHistoryVisibilityLabel(locale: string) {
  const bucket = resolveLocaleBucket(locale);
  if (bucket === "es") return "隐藏";
  if (bucket === "en") return "Hide";
  return "隐藏";
}

export function getMerchantBookingHistoryVisibilityText(
  historyVisibility: MerchantBookingHistoryVisibility,
  locale: string,
) {
  const bucket = resolveLocaleBucket(locale);
  if (bucket === "es") {
    if (historyVisibility === "none") return "No ocultar";
    if (historyVisibility === "today") return "Antes de hoy";
    if (historyVisibility === "3d") return "Antes de 3 días";
    return "Antes de 7 días";
  }
  if (bucket === "en") {
    if (historyVisibility === "none") return "Do not hide";
    if (historyVisibility === "today") return "Before today";
    if (historyVisibility === "3d") return "Before 3 days";
    return "Before 7 days";
  }
  if (historyVisibility === "none") return "不隐藏";
  if (historyVisibility === "today") return "今天之前";
  if (historyVisibility === "3d") return "3天之前";
  return "7天之前";
}
