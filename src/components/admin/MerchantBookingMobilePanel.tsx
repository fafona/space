"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BookingWorkbenchDialog from "@/components/admin/BookingWorkbenchDialog";
import BookingStatusFilterDropdown from "@/components/admin/BookingStatusFilterDropdown";
import { useI18n } from "@/components/I18nProvider";
import BookingDateTimeInput from "@/components/booking/BookingDateTimeInput";
import BookingQuickTimeRangePicker from "@/components/booking/BookingQuickTimeRangePicker";
import {
  MERCHANT_BOOKING_STATUSES,
  type MerchantBookingCustomerEmailLogEntry,
  type MerchantBookingEditableInput,
  type MerchantBookingRecord,
  type MerchantBookingStatus,
  type MerchantBookingTimelineEntry,
  isMerchantBookingPendingMerchantTouch,
} from "@/lib/merchantBookings";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  joinMerchantBookingDateTime,
  normalizeMerchantBookingCustomerNameInput,
  normalizeMerchantBookingNoteInput,
  normalizeBookingOptionList,
  splitMerchantBookingDateTime,
} from "@/lib/merchantBookings";
import {
  formatMerchantBookingDateTime,
  formatMerchantBookingDisplayName,
  getMerchantBookingActionText,
  getMerchantBookingDayLabel,
  getMerchantBookingFieldText,
  getMerchantBookingFilterText,
  getMerchantBookingStatusText,
  type MerchantBookingFilter,
} from "@/lib/merchantBookingLocale";
import { buildMerchantBookingMailtoHref } from "@/lib/merchantBookingMailto";
import { buildMerchantBookingsCsv } from "@/lib/merchantBookingCsv";
import {
  filterMerchantBookingRecordsByHistory,
  getMerchantBookingHistoryVisibilityLabel,
  getMerchantBookingHistoryVisibilityText,
  getMerchantBookingSortLabel,
  getMerchantBookingSortOptionText,
  loadMerchantBookingManagerPreferences,
  MERCHANT_BOOKING_HISTORY_VISIBILITY_OPTIONS,
  MERCHANT_BOOKING_SORT_MODES,
  saveMerchantBookingManagerPreferences,
  sortMerchantBookingRecords,
  type MerchantBookingHistoryVisibility,
  type MerchantBookingSortMode,
} from "@/lib/merchantBookingManagerPreferences";
import {
  buildMerchantBookingReminderOffsetLabel,
  resolveMerchantBookingCustomerEmailLocale,
} from "@/lib/merchantBookingCustomerEmail";
import { normalizeMerchantBookingWorkbenchSettings } from "@/lib/merchantBookingWorkbench";
import { resolveMerchantBookingRuleEntry, type MerchantBookingRulesSnapshot } from "@/lib/merchantBookingRules";
import usePullToRefresh from "@/lib/usePullToRefresh";

type MerchantBookingMobilePanelProps = {
  siteId: string;
  siteName: string;
  siteCountryCode?: string;
  storeOptions?: string[];
  itemOptions?: string[];
  titleOptions?: string[];
  bookingRulesSnapshot?: MerchantBookingRulesSnapshot | null;
  darkMode?: boolean;
  allowBookingEmailPrefill?: boolean;
  allowCustomerAutoEmail?: boolean;
  onRecordsChange?: (records: MerchantBookingRecord[]) => void;
};

type MerchantBookingAdminDraft = {
  store: string;
  item: string;
  appointmentDateInput: string;
  appointmentTimeInput: string;
  title: string;
  customerName: string;
  email: string;
  phone: string;
  note: string;
};

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function matchesSearch(record: MerchantBookingRecord, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return [
    record.id,
    record.store,
    record.item,
    record.title,
    record.customerName,
    record.email,
    record.phone,
    record.note,
  ]
    .join("\n")
    .toLowerCase()
    .includes(keyword);
}

function createDraft(record: MerchantBookingRecord): MerchantBookingAdminDraft {
  const appointmentParts = splitMerchantBookingDateTime(record.appointmentAt);
  return {
    store: record.store,
    item: record.item,
    appointmentDateInput: appointmentParts.date,
    appointmentTimeInput: appointmentParts.time,
    title: record.title,
    customerName: record.customerName,
    email: record.email,
    phone: record.phone,
    note: record.note,
  };
}

function createStatusCounts(records: MerchantBookingRecord[]) {
  const counts = {
    total: records.length,
  } as Record<MerchantBookingStatus, number> & { total: number };

  MERCHANT_BOOKING_STATUSES.forEach((status) => {
    counts[status] = 0;
  });
  records.forEach((record) => {
    counts[record.status] += 1;
  });
  return counts;
}

function getStatusBadgeClass(status: MerchantBookingStatus) {
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  if (status === "no_show") return "bg-rose-100 text-rose-700";
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "confirmed") return "bg-sky-100 text-sky-700";
  return "bg-amber-100 text-amber-700";
}

function getFilterChipClass(filter: MerchantBookingFilter, key: MerchantBookingFilter) {
  const isActive = filter === key;
  if (key === "active") {
    return isActive
      ? "border border-amber-300 bg-amber-100 text-amber-800"
      : "border border-amber-200 bg-amber-50 text-amber-700";
  }
  if (key === "confirmed") {
    return isActive
      ? "border border-sky-300 bg-sky-100 text-sky-800"
      : "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (key === "completed") {
    return isActive
      ? "border border-emerald-300 bg-emerald-100 text-emerald-800"
      : "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (key === "no_show") {
    return isActive
      ? "border border-rose-300 bg-rose-100 text-rose-800"
      : "border border-rose-200 bg-rose-50 text-rose-700";
  }
  if (key === "cancelled") {
    return isActive
      ? "border border-slate-300 bg-slate-200 text-slate-800"
      : "border border-slate-200 bg-slate-100 text-slate-600";
  }
  return isActive ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600";
}

function MailIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m4 6 6 4 6-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M6.62 10.79a15.53 15.53 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.4 21 3 13.6 3 4c0-.55.45-1 1-1h3.49c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.19 2.2z" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 3.75h5.75L15.25 7v9.25H6A1.25 1.25 0 0 1 4.75 15V5A1.25 1.25 0 0 1 6 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11.75 3.75V7h3.25" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 10h5M7.5 12.75h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ActionCloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
      <path
        d="M5 5l6 6M11 5l-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActionCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-[22px] w-[22px]">
      <path
        d="M3.5 8.25 6.5 11l6-6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getCustomerEmailBadgeText(count: number, locale: string) {
  return locale.startsWith("es") ? `Correos ${count}` : `已发邮件 ${count}`;
}

function getCustomerEmailLogHeading(locale: string) {
  return locale.startsWith("es") ? "Historial de correos" : "客户邮件记录";
}

function getCustomerEmailLogTypeText(entry: MerchantBookingCustomerEmailLogEntry, locale: string) {
  if (entry.kind === "reminder") {
    const offsetLabel = buildMerchantBookingReminderOffsetLabel(entry.minutesBefore ?? 0, locale);
    return locale.startsWith("es") ? `Recordatorio · ${offsetLabel}` : `提醒邮件 · ${offsetLabel}`;
  }
  const statusLabel = entry.status ? getMerchantBookingStatusText(entry.status, locale) : locale.startsWith("es") ? "actualización" : "状态更新";
  return locale.startsWith("es") ? `Estado · ${statusLabel}` : `状态邮件 · ${statusLabel}`;
}

function getCustomerEmailSenderMeta(entry: MerchantBookingCustomerEmailLogEntry, locale: string) {
  const parts: string[] = [];
  if (entry.senderName) {
    parts.push(locale.startsWith("es") ? `Remitente: ${entry.senderName}` : `发件人：${entry.senderName}`);
  }
  if (entry.locale) {
    parts.push(locale.startsWith("es") ? `Idioma: ${entry.locale}` : `语言：${entry.locale}`);
  }
  return parts.join(" · ");
}

function getTimelineFieldLabel(field: string, locale: string) {
  if (
    field === "store" ||
    field === "item" ||
    field === "appointmentAt" ||
    field === "title" ||
    field === "customerName" ||
    field === "email" ||
    field === "phone" ||
    field === "note"
  ) {
    return getMerchantBookingFieldText(field, locale);
  }
  return field;
}

function getTimelineEntryTitle(entry: MerchantBookingTimelineEntry, locale: string) {
  const actorLabel =
    entry.actor === "merchant"
      ? locale.startsWith("es")
        ? "El comercio"
        : "商家"
      : entry.actor === "system"
        ? locale.startsWith("es")
          ? "El sistema"
          : "系统"
        : locale.startsWith("es")
          ? "El cliente"
          : "客户";

  if (entry.kind === "created") {
    return locale.startsWith("es") ? "El cliente creó la reserva" : "客户创建了预约";
  }
  if (entry.kind === "acknowledged") {
    return locale.startsWith("es") ? "El comercio revisó la reserva" : "商家已查看预约";
  }
  if (entry.kind === "updated") {
    return locale.startsWith("es") ? `${actorLabel} actualizó la reserva` : `${actorLabel}修改了预约`;
  }
  if (entry.kind === "status_changed") {
    const nextLabel = entry.toStatus ? getMerchantBookingStatusText(entry.toStatus, locale) : "-";
    return locale.startsWith("es") ? `Estado → ${nextLabel}` : `状态改为 ${nextLabel}`;
  }
  if (entry.kind === "customer_email") {
    const deliveryLabel =
      entry.delivery === "failed"
        ? locale.startsWith("es")
          ? "falló"
          : "失败"
        : locale.startsWith("es")
          ? "enviado"
          : "已发送";
    if (entry.emailKind === "reminder") {
      return locale.startsWith("es") ? `Recordatorio por correo ${deliveryLabel}` : `客户提醒邮件${deliveryLabel}`;
    }
    if (entry.emailKind === "manual") {
      return locale.startsWith("es") ? `Correo manual ${deliveryLabel}` : `手动客户邮件${deliveryLabel}`;
    }
    return locale.startsWith("es") ? `Correo de estado ${deliveryLabel}` : `状态邮件${deliveryLabel}`;
  }
  if (entry.kind === "merchant_reminder") {
    return entry.delivery === "failed"
      ? locale.startsWith("es")
        ? "Push al comercio falló"
        : "商家提醒推送失败"
      : locale.startsWith("es")
        ? "Push al comercio enviado"
        : "商家提醒已推送";
  }
  return locale.startsWith("es") ? "Actividad de reserva" : "预约动态";
}

function getTimelineEntryMeta(entry: MerchantBookingTimelineEntry, locale: string) {
  const parts: string[] = [];
  if (entry.fields?.length) {
    parts.push(entry.fields.map((field) => getTimelineFieldLabel(field, locale)).join(" · "));
  }
  if (entry.fromStatus && entry.toStatus) {
    parts.push(`${getMerchantBookingStatusText(entry.fromStatus, locale)} → ${getMerchantBookingStatusText(entry.toStatus, locale)}`);
  }
  if (typeof entry.minutesBefore === "number") {
    parts.push(buildMerchantBookingReminderOffsetLabel(entry.minutesBefore, locale));
  }
  if (typeof entry.deliveredCount === "number" && entry.deliveredCount > 0) {
    parts.push(locale.startsWith("es") ? `${entry.deliveredCount} dispositivos` : `${entry.deliveredCount} 台设备`);
  }
  if (entry.subject) parts.push(entry.subject);
  if (entry.senderName) parts.push(locale.startsWith("es") ? `Remitente ${entry.senderName}` : `发件人 ${entry.senderName}`);
  if (entry.locale) parts.push(entry.locale);
  if (entry.note) parts.push(entry.note);
  return parts.join(" · ");
}

function downloadBookingsCsv(records: MerchantBookingRecord[], locale: string, siteId: string) {
  if (typeof document === "undefined" || records.length === 0) return;
  const blob = new Blob([buildMerchantBookingsCsv(records, locale)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bookings-${siteId || "export"}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SummaryField({ value }: { value: string }) {
  return <div className="text-sm text-slate-900">{value || "-"}</div>;
}

function SummaryAppointmentField({
  dateValue,
  timeValue,
  action,
  locale,
}: {
  dateValue: string;
  timeValue: string;
  action?: ReactNode;
  locale: string;
}) {
  const dayLabel = getMerchantBookingDayLabel(dateValue, locale);
  const hasValue = Boolean(dateValue || timeValue);

  return (
    <div className="flex items-center justify-between gap-3">
      {hasValue ? (
        <div className="min-w-0 flex flex-wrap items-center gap-2 text-sm text-slate-900">
          <span>{dateValue || "-"}</span>
          {dayLabel ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              {dayLabel}
            </span>
          ) : null}
          {timeValue ? (
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">
              {timeValue}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-slate-900">-</div>
      )}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export default function MerchantBookingMobilePanel({
  siteId,
  siteName,
  siteCountryCode = "",
  storeOptions = [],
  itemOptions = [],
  titleOptions = [],
  bookingRulesSnapshot = null,
  darkMode = false,
  allowBookingEmailPrefill = false,
  allowCustomerAutoEmail = false,
  onRecordsChange,
}: MerchantBookingMobilePanelProps) {
  const { locale } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const detailDialogScrollViewportRef = useRef<HTMLDivElement>(null);
  const defaultCustomerEmailLocale = useMemo(
    () => resolveMerchantBookingCustomerEmailLocale("", siteCountryCode),
    [siteCountryCode],
  );
  const isIosBrowser =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(String(navigator.userAgent ?? ""));
  const loadFailedText = locale.startsWith("es") ? "No se pudieron cargar las citas." : "预约记录读取失败";
  const updateFailedText = locale.startsWith("es") ? "No se pudo actualizar la cita." : "预约更新失败";
  const [records, setRecords] = useState<MerchantBookingRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MerchantBookingAdminDraft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MerchantBookingFilter>("all");
  const [selectedStatuses, setSelectedStatuses] = useState<MerchantBookingStatus[]>(
    () => loadMerchantBookingManagerPreferences(siteId).selectedStatuses,
  );
  const [sortMode, setSortMode] = useState<MerchantBookingSortMode>(
    () => loadMerchantBookingManagerPreferences(siteId).sortMode,
  );
  const [historyVisibility, setHistoryVisibility] = useState<MerchantBookingHistoryVisibility>(
    () => loadMerchantBookingManagerPreferences(siteId).historyVisibility,
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookingIds, setSelectedBookingIds] = useState<string[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [customerEmailLocale, setCustomerEmailLocale] = useState(defaultCustomerEmailLocale);
  const [customerEmailLocaleLoaded, setCustomerEmailLocaleLoaded] = useState(false);
  const workbenchButtonClassName = workbenchOpen
    ? "shrink-0 rounded-[18px] rounded-tl-[8px] rounded-br-[24px] border border-[#c7b48f] bg-[linear-gradient(135deg,#1f2b46_0%,#233657_100%)] px-3.5 py-2 text-[12px] font-semibold tracking-[0.02em] text-[#f7e8c2] shadow-[0_14px_26px_rgba(15,23,42,0.22)] ring-1 ring-[#efe2bf]/60 transition"
    : "shrink-0 rounded-[18px] rounded-tl-[8px] rounded-br-[24px] border border-[#d8c7a5] bg-[linear-gradient(135deg,#fffdfa_0%,#f6efe1_62%,#ecdfc2_100%)] px-3.5 py-2 text-[12px] font-semibold tracking-[0.02em] text-slate-800 shadow-[0_12px_24px_rgba(148,119,66,0.14)] transition active:scale-[0.98]";
  const filterSelectShellClassName = darkMode
    ? "rounded-[18px] border border-slate-700 bg-slate-900/75 px-3 py-2.5 text-slate-100 shadow-sm"
    : "rounded-[18px] border border-slate-200 bg-white px-3 py-2.5 text-slate-900 shadow-sm";
  const filterSelectLabelClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const filterSelectIconClassName = darkMode ? "text-slate-500" : "text-slate-400";

  useEffect(() => {
    setCustomerEmailLocale(defaultCustomerEmailLocale);
    setCustomerEmailLocaleLoaded(false);
  }, [defaultCustomerEmailLocale]);

  const loadWorkbenchCustomerEmailLocale = useCallback(async () => {
    if (!siteId) return defaultCustomerEmailLocale;
    if (customerEmailLocaleLoaded) return customerEmailLocale;
    try {
      const response = await fetch(`/api/bookings/workbench?siteId=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; settings?: unknown }
        | null;
      if (!response.ok || !json?.ok) {
        throw new Error("load_workbench_locale_failed");
      }
      const normalized = normalizeMerchantBookingWorkbenchSettings(json.settings);
      const resolvedLocale = resolveMerchantBookingCustomerEmailLocale(
        normalized.customerEmailLocale,
        siteCountryCode,
      );
      setCustomerEmailLocale(resolvedLocale);
      setCustomerEmailLocaleLoaded(true);
      return resolvedLocale;
    } catch {
      return customerEmailLocale || defaultCustomerEmailLocale;
    }
  }, [
    customerEmailLocale,
    customerEmailLocaleLoaded,
    defaultCustomerEmailLocale,
    siteCountryCode,
    siteId,
  ]);

  const loadBookings = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/bookings?siteId=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; bookings?: MerchantBookingRecord[]; message?: string }
        | null;
      if (!response.ok || !json?.ok || !Array.isArray(json.bookings)) {
        throw new Error(json?.message || loadFailedText);
      }
      setRecords(json.bookings);
      setDrafts(Object.fromEntries(json.bookings.map((record) => [record.id, createDraft(record)])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : loadFailedText);
    } finally {
      setLoading(false);
    }
  }, [loadFailedText, siteId]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    const loadWorkbenchLocale = async () => {
      try {
        const resolvedLocale = await loadWorkbenchCustomerEmailLocale();
        if (!cancelled) setCustomerEmailLocale(resolvedLocale);
      } catch {
        // Keep the merchant-country default when workbench settings are unavailable.
      }
    };
    void loadWorkbenchLocale();
    return () => {
      cancelled = true;
    };
  }, [loadWorkbenchCustomerEmailLocale, siteId]);

  useEffect(() => {
    onRecordsChange?.(records);
  }, [onRecordsChange, records]);

  useEffect(() => {
    if (!selectionMode && selectedBookingIds.length > 0) {
      setSelectedBookingIds([]);
    }
  }, [selectedBookingIds.length, selectionMode]);

  useEffect(() => {
    const preferences = loadMerchantBookingManagerPreferences(siteId);
    setSelectedStatuses(preferences.selectedStatuses);
    setSortMode(preferences.sortMode);
    setHistoryVisibility(preferences.historyVisibility);
  }, [siteId]);

  useEffect(() => {
    saveMerchantBookingManagerPreferences(siteId, {
      selectedStatuses,
      sortMode,
      historyVisibility,
    });
  }, [historyVisibility, selectedStatuses, siteId, sortMode]);

  const {
    pullDistance,
    readyToRefresh,
    refreshing: pullRefreshing,
    bind: pullToRefreshBind,
  } = usePullToRefresh({
    disabled: loading || Boolean(detailBookingId),
    getScrollElement: () => (rootRef.current?.parentElement instanceof HTMLElement ? rootRef.current.parentElement : null),
    onRefresh: loadBookings,
  });

  const historyFilteredRecords = useMemo(
    () => filterMerchantBookingRecordsByHistory(records, historyVisibility),
    [historyVisibility, records],
  );

  const counts = useMemo(() => createStatusCounts(historyFilteredRecords), [historyFilteredRecords]);

  const filteredRecords = useMemo(
    () =>
      sortMerchantBookingRecords(
        historyFilteredRecords.filter((item) => {
        if (filter === "all") {
          if (!selectedStatuses.includes(item.status)) return false;
        } else if (item.status !== filter) {
          return false;
        }
        return matchesSearch(item, query);
        }),
        sortMode,
      ),
    [filter, historyFilteredRecords, query, selectedStatuses, sortMode],
  );
  const selectedRecordSet = useMemo(() => new Set(selectedBookingIds), [selectedBookingIds]);
  const selectedRecords = useMemo(
    () => records.filter((record) => selectedRecordSet.has(record.id)),
    [records, selectedRecordSet],
  );

  const selectableStoreOptions = useMemo(
    () =>
      normalizeBookingOptionList(
        [...storeOptions, ...records.map((record) => record.store)],
        buildDefaultBookingStoreOptions(siteName),
      ),
    [records, siteName, storeOptions],
  );

  const selectableItemOptions = useMemo(
    () =>
      normalizeBookingOptionList(
        [...itemOptions, ...records.map((record) => record.item)],
        buildDefaultBookingItemOptions(),
      ),
    [itemOptions, records],
  );

  const selectableTitleOptions = useMemo(
    () =>
      normalizeBookingOptionList(
        [...titleOptions, ...records.map((record) => record.title)],
        buildDefaultBookingTitleOptions(),
      ),
    [records, titleOptions],
  );

  const patchBooking = useCallback(
    async (
      bookingId: string,
      payload: {
        status?: MerchantBookingStatus;
        updates?: Partial<MerchantBookingEditableInput>;
      },
      busyLabel: string,
    ) => {
      setBusyKey(`${busyLabel}:${bookingId}`);
      setError("");
      try {
        const currentRecord = records.find((item) => item.id === bookingId) ?? null;
        const response = await fetch("/api/bookings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            bookingId,
            bookingBlockId: currentRecord?.bookingBlockId,
            bookingViewport: currentRecord?.bookingViewport,
            ...payload,
          }),
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; booking?: MerchantBookingRecord; message?: string }
          | null;
        if (!response.ok || !json?.ok || !json.booking) {
          throw new Error(json?.message || updateFailedText);
        }
        const nextBooking = json.booking;
        setRecords((current) => current.map((item) => (item.id === nextBooking.id ? nextBooking : item)));
        setDrafts((current) => ({
          ...current,
          [nextBooking.id]: createDraft(nextBooking),
        }));
        return nextBooking;
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : updateFailedText);
        return null;
      } finally {
        setBusyKey("");
      }
    },
    [records, siteId, updateFailedText],
  );

  const runBatchStatusUpdate = useCallback(
    async (status: MerchantBookingStatus, busyLabel: string) => {
      if (selectedBookingIds.length === 0) return;
      setBusyKey(`batch:${busyLabel}`);
      setError("");
      try {
        const response = await fetch("/api/bookings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            bookingIds: selectedBookingIds,
            status,
          }),
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; bookings?: MerchantBookingRecord[]; message?: string }
          | null;
        if (!response.ok || !json?.ok || !Array.isArray(json.bookings)) {
          throw new Error(json?.message || updateFailedText);
        }
        const updatedById = new Map(json.bookings.map((item) => [item.id, item]));
        setRecords((current) => current.map((item) => updatedById.get(item.id) ?? item));
        setDrafts((current) => {
          const next = { ...current };
          json.bookings?.forEach((item) => {
            next[item.id] = createDraft(item);
          });
          return next;
        });
        setSelectedBookingIds([]);
        setSelectionMode(false);
      } catch (batchError) {
        setError(batchError instanceof Error ? batchError.message : updateFailedText);
      } finally {
        setBusyKey("");
      }
    },
    [selectedBookingIds, siteId, updateFailedText],
  );

  const markBookingTouched = useCallback(
    async (bookingId: string) => {
      const currentRecord = records.find((item) => item.id === bookingId);
      if (!currentRecord || !isMerchantBookingPendingMerchantTouch(currentRecord)) return currentRecord ?? null;
      const touchedAt = new Date().toISOString();
      setRecords((current) =>
        current.map((item) => (item.id === bookingId ? { ...item, merchantTouchedAt: touchedAt } : item)),
      );
      try {
        const response = await fetch("/api/bookings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            bookingId,
            markTouched: true,
          }),
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; booking?: MerchantBookingRecord }
          | null;
        if (!response.ok || !json?.ok || !json.booking) {
          throw new Error("mark_touched_failed");
        }
        setRecords((current) => current.map((item) => (item.id === bookingId ? json.booking! : item)));
        return json.booking;
      } catch {
        return null;
      }
    },
    [records, siteId],
  );

  const handleDraftChange = useCallback(
    (bookingId: string, key: keyof MerchantBookingAdminDraft, value: string) => {
      const nextValue =
        key === "customerName"
          ? normalizeMerchantBookingCustomerNameInput(value)
          : key === "note"
            ? normalizeMerchantBookingNoteInput(value)
            : value;
      setDrafts((current) => ({
        ...current,
        [bookingId]: {
          ...(current[bookingId] ?? {
            store: "",
            item: "",
            appointmentDateInput: "",
            appointmentTimeInput: "",
            title: "",
            customerName: "",
            email: "",
            phone: "",
            note: "",
          }),
          [key]: nextValue,
        },
      }));
    },
    [],
  );

  const openDetailDialog = useCallback((record: MerchantBookingRecord) => {
    void markBookingTouched(record.id);
    setDrafts((current) => ({
      ...current,
      [record.id]: createDraft(record),
    }));
    setDetailBookingId(record.id);
  }, [markBookingTouched]);

  const closeDetailDialog = useCallback(() => {
    setDetailBookingId(null);
  }, []);

  const detailRecord = detailBookingId ? records.find((item) => item.id === detailBookingId) ?? null : null;
  const detailDraft = detailRecord ? drafts[detailRecord.id] ?? createDraft(detailRecord) : null;
  const detailCustomerEmailLogs = useMemo(
    () =>
      [...(detailRecord?.customerEmailLogs ?? [])].sort(
        (left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime(),
      ),
    [detailRecord],
  );
  const detailTimeline = useMemo(
    () =>
      [...(detailRecord?.timeline ?? [])].sort(
        (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
      ),
    [detailRecord],
  );
  const detailAvailableTimeRanges = useMemo(
    () =>
      detailRecord
        ? resolveMerchantBookingRuleEntry(bookingRulesSnapshot, {
            bookingBlockId: detailRecord.bookingBlockId,
            bookingViewport: detailRecord.bookingViewport,
          })?.availableTimeRanges ?? []
        : [],
    [bookingRulesSnapshot, detailRecord],
  );

  useEffect(() => {
    if (!detailBookingId || !isIosBrowser || typeof document === "undefined" || typeof window === "undefined") return () => {};

    let scrollTimer = 0;
    const scrollFocusedFieldIntoView = (delay = 0) => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        const activeElement = document.activeElement;
        const viewport = detailDialogScrollViewportRef.current;
        if (!(activeElement instanceof HTMLElement) || !viewport || !viewport.contains(activeElement)) return;
        activeElement.scrollIntoView({
          behavior: delay === 0 ? "auto" : "smooth",
          block: "center",
          inline: "nearest",
        });
      }, delay);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const viewport = detailDialogScrollViewportRef.current;
      if (!(target instanceof HTMLElement) || !viewport || !viewport.contains(target)) return;
      scrollFocusedFieldIntoView(220);
      scrollFocusedFieldIntoView(420);
    };

    const handleViewportResize = () => {
      scrollFocusedFieldIntoView(160);
    };

    document.addEventListener("focusin", handleFocusIn);
    window.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("scroll", handleViewportResize);
    return () => {
      window.clearTimeout(scrollTimer);
      document.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("scroll", handleViewportResize);
    };
  }, [detailBookingId, isIosBrowser]);

  const saveDetailDialog = useCallback(async () => {
    if (!detailRecord || !detailDraft) return;
    const nextBooking = await patchBooking(
      detailRecord.id,
      {
        updates: {
          store: detailDraft.store,
          item: detailDraft.item,
          appointmentAt: joinMerchantBookingDateTime(detailDraft.appointmentDateInput, detailDraft.appointmentTimeInput),
          title: detailDraft.title,
          customerName: detailDraft.customerName,
          email: detailDraft.email,
          phone: detailDraft.phone,
          note: detailDraft.note,
        },
      },
      "save",
    );
    if (nextBooking) {
      setDetailBookingId(null);
    }
  }, [detailDraft, detailRecord, patchBooking]);

  const toggleSelectedBooking = useCallback((bookingId: string) => {
    setSelectedBookingIds((current) =>
      current.includes(bookingId) ? current.filter((item) => item !== bookingId) : [...current, bookingId],
    );
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    const visibleIds = filteredRecords.map((item) => item.id);
    setSelectedBookingIds((current) =>
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }, [filteredRecords]);

  const renderStatusActions = (record: MerchantBookingRecord) => {
    if (record.status === "cancelled" || record.status === "no_show") {
      return (
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void patchBooking(record.id, { status: "active" }, "restore")}
          disabled={busyKey === `restore:${record.id}`}
        >
          {busyKey === `restore:${record.id}`
            ? getMerchantBookingActionText("processing", locale)
            : getMerchantBookingActionText("restore", locale)}
        </button>
      );
    }

    return (
      <>
        {record.status === "completed" ? (
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "confirmed" }, "uncomplete")}
            disabled={busyKey === `uncomplete:${record.id}`}
          >
            {busyKey === `uncomplete:${record.id}`
              ? getMerchantBookingActionText("processing", locale)
              : getMerchantBookingActionText("uncomplete", locale)}
          </button>
        ) : record.status === "confirmed" ? (
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "active" }, "unconfirm")}
            disabled={busyKey === `unconfirm:${record.id}`}
          >
            {busyKey === `unconfirm:${record.id}`
              ? getMerchantBookingActionText("processing", locale)
              : getMerchantBookingActionText("unconfirm", locale)}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-full border border-sky-300 bg-sky-100 px-3 py-2 text-xs font-medium text-sky-800 transition hover:bg-sky-200 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "confirmed" }, "confirm")}
            disabled={busyKey === `confirm:${record.id}`}
          >
            {busyKey === `confirm:${record.id}`
              ? getMerchantBookingActionText("processing", locale)
              : getMerchantBookingActionText("confirm", locale)}
          </button>
        )}
        {(record.status === "active" || record.status === "confirmed") ? (
          <button
            type="button"
            className="inline-flex h-[38px] min-w-[54px] items-center justify-center rounded-[14px] border border-rose-200 bg-[linear-gradient(180deg,#ffffff_0%,#fff1f2_100%)] px-3 text-rose-700 shadow-[0_10px_24px_rgba(244,63,94,0.12)] transition hover:-translate-y-[1px] hover:border-rose-300 hover:shadow-[0_12px_28px_rgba(244,63,94,0.16)] disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "no_show" }, "noshow")}
            disabled={busyKey === `noshow:${record.id}`}
            title={getMerchantBookingActionText("noshow", locale)}
            aria-label={getMerchantBookingActionText("noshow", locale)}
          >
            {busyKey === `noshow:${record.id}` ? (
              <span className="text-xs font-semibold tracking-[0.18em]">...</span>
            ) : (
              <span className="inline-flex items-center justify-center text-rose-600">
                <ActionCloseIcon />
              </span>
            )}
          </button>
        ) : null}
        {record.status !== "completed" ? (
          <button
            type="button"
            className="inline-flex h-[38px] min-w-[54px] items-center justify-center rounded-[14px] border border-emerald-200 bg-[linear-gradient(180deg,#ffffff_0%,#ecfdf5_100%)] px-3 text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.13)] transition hover:-translate-y-[1px] hover:border-emerald-300 hover:shadow-[0_12px_28px_rgba(16,185,129,0.17)] disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "completed" }, "complete")}
            disabled={busyKey === `complete:${record.id}`}
            title={getMerchantBookingActionText("complete", locale)}
            aria-label={getMerchantBookingActionText("complete", locale)}
          >
            {busyKey === `complete:${record.id}` ? (
              <span className="text-xs font-semibold tracking-[0.18em]">...</span>
            ) : (
              <span className="inline-flex items-center justify-center text-emerald-600">
                <ActionCheckIcon />
              </span>
            )}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void patchBooking(record.id, { status: "cancelled" }, "cancel")}
          disabled={busyKey === `cancel:${record.id}`}
        >
          {busyKey === `cancel:${record.id}`
            ? getMerchantBookingActionText("processing", locale)
            : getMerchantBookingActionText("cancel", locale)}
        </button>
      </>
    );
  };

  const detailDialog =
    detailRecord && detailDraft
        ? overlay(
          <div
            className="fixed inset-0 z-[2147482950] flex justify-center overflow-hidden bg-black/45 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDetailDialog();
            }}
          >
            <div
              className="mx-auto flex w-full max-w-xl max-h-full min-h-0 flex-col overflow-hidden rounded-[28px] border bg-white shadow-2xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b px-4 py-4">
                <div className="space-y-1">
                  <div className="text-base font-semibold text-slate-900">{getMerchantBookingFieldText("detailTitle", locale)}</div>
                  <div className="text-sm text-slate-500">
                    {formatMerchantBookingDisplayName(
                      detailDraft.customerName || detailRecord.customerName,
                      detailDraft.title || detailRecord.title,
                      locale,
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{`${getMerchantBookingFieldText("bookingId", locale)}: ${detailRecord.id}`}</div>
                  <div className="text-xs text-slate-500">
                    {`${getMerchantBookingFieldText("submittedAt", locale)}: ${formatMerchantBookingDateTime(detailRecord.createdAt, locale)}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                    onClick={closeDetailDialog}
                  >
                    {getMerchantBookingActionText("close", locale)}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                    onClick={() => {
                      void saveDetailDialog();
                    }}
                    disabled={busyKey === `save:${detailRecord.id}`}
                  >
                    {busyKey === `save:${detailRecord.id}`
                      ? getMerchantBookingActionText("processing", locale)
                      : getMerchantBookingActionText("save", locale)}
                  </button>
                </div>
              </div>

              <div
                ref={detailDialogScrollViewportRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                <div className="grid gap-3">
                  {detailCustomerEmailLogs.length > 0 ? (
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold text-slate-900">{getCustomerEmailLogHeading(locale)}</div>
                      <div className="mt-3 space-y-2">
                        {detailCustomerEmailLogs.map((entry) => (
                          <div key={entry.id} className="rounded-[18px] border border-slate-200 bg-white px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-slate-900">
                                {getCustomerEmailLogTypeText(entry, locale)}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatMerchantBookingDateTime(entry.sentAt, locale)}
                              </div>
                            </div>
                            {entry.subject ? <div className="mt-1 text-xs text-slate-600">{entry.subject}</div> : null}
                            {getCustomerEmailSenderMeta(entry, locale) ? (
                              <div className="mt-1 text-xs text-slate-500">{getCustomerEmailSenderMeta(entry, locale)}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {detailTimeline.length > 0 ? (
                    <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        {locale.startsWith("es") ? "Línea de tiempo" : "预约时间线"}
                      </div>
                      <div className="mt-3 space-y-2">
                        {detailTimeline.map((entry) => (
                          <div key={entry.id} className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium text-slate-900">{getTimelineEntryTitle(entry, locale)}</div>
                              <div className="text-xs text-slate-500">{formatMerchantBookingDateTime(entry.at, locale)}</div>
                            </div>
                            {getTimelineEntryMeta(entry, locale) ? (
                              <div className="mt-1 text-xs leading-5 text-slate-600">{getTimelineEntryMeta(entry, locale)}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("store", locale)}</span>
                    <select
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.store}
                      onChange={(event) => handleDraftChange(detailRecord.id, "store", event.target.value)}
                    >
                      {selectableStoreOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("item", locale)}</span>
                    <select
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.item}
                      onChange={(event) => handleDraftChange(detailRecord.id, "item", event.target.value)}
                    >
                      {selectableItemOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("appointmentAt", locale)}</span>
                    <BookingDateTimeInput
                      dateValue={detailDraft.appointmentDateInput}
                      timeValue={detailDraft.appointmentTimeInput}
                      dateInputClassName="min-w-[180px] flex-1 rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900"
                      timeInputClassName="w-[116px] shrink-0 rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900"
                      onDateChange={(value) => handleDraftChange(detailRecord.id, "appointmentDateInput", value)}
                      onTimeChange={(value) => handleDraftChange(detailRecord.id, "appointmentTimeInput", value)}
                    />
                    <BookingQuickTimeRangePicker
                      ranges={detailAvailableTimeRanges}
                      selectedTime={detailDraft.appointmentTimeInput}
                      className="pt-1"
                      onSelect={(nextTime) => handleDraftChange(detailRecord.id, "appointmentTimeInput", nextTime)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("title", locale)}</span>
                    <select
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.title}
                      onChange={(event) => handleDraftChange(detailRecord.id, "title", event.target.value)}
                    >
                      {selectableTitleOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("customerName", locale)}</span>
                    <input
                      type="text"
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.customerName}
                      onChange={(event) => handleDraftChange(detailRecord.id, "customerName", event.target.value)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("email", locale)}</span>
                    <input
                      type="email"
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.email}
                      onChange={(event) => handleDraftChange(detailRecord.id, "email", event.target.value)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("phone", locale)}</span>
                    <input
                      type="text"
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.phone}
                      onChange={(event) => handleDraftChange(detailRecord.id, "phone", event.target.value)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">{getMerchantBookingFieldText("note", locale)}</span>
                    <textarea
                      className="min-h-[120px] w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.note}
                      onChange={(event) => handleDraftChange(detailRecord.id, "note", event.target.value)}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>,
        )
      : null;

  if (!siteId) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
        {getMerchantBookingFieldText("missingSite", locale)}
      </div>
    );
  }

  return (
    <>
      <div ref={rootRef} className="space-y-3" {...pullToRefreshBind}>
        <div
          className={`sticky top-0 z-20 -mx-4 space-y-2.5 border-b border-slate-200/80 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur ${
            darkMode
              ? "bg-[rgba(15,23,42,0.96)] supports-[backdrop-filter]:bg-[rgba(15,23,42,0.9)]"
              : "bg-[rgba(248,250,252,0.96)] supports-[backdrop-filter]:bg-[rgba(248,250,252,0.9)]"
          }`}
        >
          <div
            className="overflow-hidden transition-[max-height,opacity,padding] duration-150"
            style={{
              maxHeight: pullDistance > 0 || pullRefreshing ? `${Math.max(36, Math.round(pullDistance))}px` : "0px",
              opacity: pullDistance > 0 || pullRefreshing ? 1 : 0,
              paddingTop: pullDistance > 0 || pullRefreshing ? "0.25rem" : "0px",
            }}
          >
            <div className="flex justify-center">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium shadow-sm ${
                  darkMode
                    ? "border border-slate-700/70 bg-slate-900/80 text-slate-200"
                    : "border border-slate-200 bg-white/95 text-slate-500"
                }`}
              >
                {pullRefreshing
                  ? getMerchantBookingActionText("refreshing", locale)
                  : readyToRefresh
                    ? getMerchantBookingActionText("releaseToRefresh", locale)
                    : getMerchantBookingActionText("pullToRefresh", locale)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-sm font-semibold text-white shadow-sm">
              预约
            </div>
            <div className="flex min-h-[41px] min-w-0 flex-1 items-center gap-2.5 rounded-[20px] border border-slate-200 bg-[#f3f4f6] px-3.5 py-2 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-slate-400" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
                <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
              <input
                className="min-w-0 flex-1 bg-transparent text-[14px] leading-5 text-slate-900 outline-none placeholder:text-slate-400"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={getMerchantBookingFieldText("searchMobile", locale)}
              />
            </div>
            <button
              type="button"
              className={workbenchButtonClassName}
              onClick={() => setWorkbenchOpen(true)}
            >
              {getMerchantBookingFieldText("workbenchButton", locale)}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <BookingStatusFilterDropdown
              locale={locale}
              counts={counts}
              selectedStatuses={selectedStatuses}
              onPress={() => setFilter("all")}
              onChange={(statuses) => {
                setSelectedStatuses(statuses);
                setFilter("all");
              }}
              compact
            />
            {MERCHANT_BOOKING_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={`rounded-full px-3 py-2 text-xs font-medium transition ${getFilterChipClass(filter, status)}`}
                onClick={() => {
                  setFilter(status);
                  if (!selectedStatuses.includes(status)) {
                    setSelectedStatuses((current) => [...current, status]);
                  }
                }}
              >
                {getMerchantBookingFilterText(status, counts[status], locale)}
                </button>
              ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className={`flex min-w-0 items-center gap-2 ${filterSelectShellClassName}`}>
              <span className={`shrink-0 text-[11px] font-medium ${filterSelectLabelClassName}`}>
                {getMerchantBookingSortLabel(locale)}
              </span>
              <div className="relative min-w-0 flex-1">
                <select
                  className="w-full min-w-0 appearance-none bg-transparent pr-5 text-[13px] font-medium outline-none"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as MerchantBookingSortMode)}
                >
                  {MERCHANT_BOOKING_SORT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {getMerchantBookingSortOptionText(mode, locale)}
                    </option>
                  ))}
                </select>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className={`pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 ${filterSelectIconClassName}`}
                >
                  <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </label>
            <label className={`flex min-w-0 items-center gap-2 ${filterSelectShellClassName}`}>
              <span className={`shrink-0 text-[11px] font-medium ${filterSelectLabelClassName}`}>
                {getMerchantBookingHistoryVisibilityLabel(locale)}
              </span>
              <div className="relative min-w-0 flex-1">
                <select
                  className="w-full min-w-0 appearance-none bg-transparent pr-5 text-[13px] font-medium outline-none"
                  value={historyVisibility}
                  onChange={(event) =>
                    setHistoryVisibility(event.target.value as MerchantBookingHistoryVisibility)
                  }
                >
                  {MERCHANT_BOOKING_HISTORY_VISIBILITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {getMerchantBookingHistoryVisibilityText(value, locale)}
                    </option>
                  ))}
                </select>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className={`pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 ${filterSelectIconClassName}`}
                >
                  <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                selectionMode ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"
              }`}
              onClick={() => setSelectionMode((current) => !current)}
            >
              {locale.startsWith("es") ? "Lote" : "批量"}
            </button>
            {selectionMode ? (
              <>
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                  onClick={toggleSelectAllFiltered}
                >
                  {selectedRecordSet.size > 0 && filteredRecords.every((item) => selectedRecordSet.has(item.id))
                    ? locale.startsWith("es")
                      ? "Quitar visibles"
                      : "取消当前页"
                    : locale.startsWith("es")
                      ? "Seleccionar visibles"
                      : "全选当前页"}
                </button>
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                  {locale.startsWith("es") ? `${selectedBookingIds.length} seleccionadas` : `已选 ${selectedBookingIds.length} 条`}
                </span>
                {selectedBookingIds.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700"
                      onClick={() => void runBatchStatusUpdate("confirmed", "batch-confirm")}
                      disabled={busyKey === "batch:batch-confirm"}
                    >
                      {locale.startsWith("es") ? "Confirmar" : "批量确认"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"
                      onClick={() => void runBatchStatusUpdate("completed", "batch-complete")}
                      disabled={busyKey === "batch:batch-complete"}
                    >
                      {locale.startsWith("es") ? "Completar" : "批量完成"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
                      onClick={() => void runBatchStatusUpdate("no_show", "batch-noshow")}
                      disabled={busyKey === "batch:batch-noshow"}
                    >
                      {locale.startsWith("es") ? "No show" : "批量未到店"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                      onClick={() => void runBatchStatusUpdate("cancelled", "batch-cancel")}
                      disabled={busyKey === "batch:batch-cancel"}
                    >
                      {locale.startsWith("es") ? "Cancelar" : "批量取消"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700"
                      onClick={() => downloadBookingsCsv(selectedRecords, locale, siteId)}
                    >
                      CSV
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            {getMerchantBookingFieldText("managementLoading", locale)}
          </div>
        ) : filteredRecords.length > 0 ? (
          <div className="space-y-3">
            {filteredRecords.map((record) => {
              const appointmentParts = splitMerchantBookingDateTime(record.appointmentAt);
              const displayName = formatMerchantBookingDisplayName(record.customerName, record.title, locale);
              const isNewRecord = isMerchantBookingPendingMerchantTouch(record);
              return (
                <article
                  key={record.id}
                  className="relative overflow-visible rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
                >
                  {isNewRecord ? (
                    <span className="absolute left-3 top-0 z-10 inline-flex -translate-y-1/2 items-center rounded-[14px] border border-white/70 bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(16,185,129,0.28)]">
                      NEW
                    </span>
                  ) : null}
                  {selectionMode ? (
                    <label className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm">
                      <input
                        type="checkbox"
                        checked={selectedRecordSet.has(record.id)}
                        onChange={() => toggleSelectedBooking(record.id)}
                      />
                      {locale.startsWith("es") ? "Seleccionar" : "选中"}
                    </label>
                  ) : null}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${getStatusBadgeClass(record.status)}`}>
                          {getMerchantBookingStatusText(record.status, locale)}
                        </span>
                        <div className="truncate text-base font-semibold text-slate-900">
                          {displayName}
                        </div>
                      </div>
                    </div>
                    {record.email || record.phone ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {record.email ? (
                          <a
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                            href={buildMerchantBookingMailtoHref(record, customerEmailLocale, allowBookingEmailPrefill)}
                            onClick={async (event) => {
                              void markBookingTouched(record.id);
                              if (customerEmailLocaleLoaded) return;
                              event.preventDefault();
                              const resolvedLocale = await loadWorkbenchCustomerEmailLocale();
                              const href = buildMerchantBookingMailtoHref(
                                record,
                                resolvedLocale,
                                allowBookingEmailPrefill,
                              );
                              if (typeof window !== "undefined" && href) {
                                window.location.href = href;
                              }
                            }}
                            title={getMerchantBookingFieldText("replyEmail", locale)}
                            aria-label={getMerchantBookingFieldText("replyEmail", locale)}
                          >
                            <MailIcon />
                          </a>
                        ) : null}
                        {record.phone ? (
                          <a
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                            href={`tel:${record.phone}`}
                            onClick={() => {
                              void markBookingTouched(record.id);
                            }}
                            title={getMerchantBookingFieldText("callPhone", locale)}
                            aria-label={getMerchantBookingFieldText("callPhone", locale)}
                          >
                            <PhoneIcon />
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">{renderStatusActions(record)}</div>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3">
                    <div className="grid content-start gap-1">
                      <SummaryField value={record.store} />
                      <SummaryField value={record.item} />
                      <SummaryAppointmentField dateValue={appointmentParts.date} timeValue={appointmentParts.time} locale={locale} />
                    </div>
                    <div className="relative flex items-end self-end">
                      {(record.customerEmailLogs?.length || record.note) ? (
                        <div className="pointer-events-none absolute bottom-full right-0 mb-1 flex flex-col items-end gap-1">
                          {record.customerEmailLogs?.length ? (
                            <span
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                              title={getCustomerEmailBadgeText(record.customerEmailLogs.length, locale)}
                              aria-label={getCustomerEmailBadgeText(record.customerEmailLogs.length, locale)}
                            >
                              <MailIcon />
                              <span>{record.customerEmailLogs.length}</span>
                            </span>
                          ) : null}
                          {record.note ? (
                            <span
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700"
                              title={getMerchantBookingFieldText("hasNote", locale)}
                              aria-label={getMerchantBookingFieldText("hasNote", locale)}
                            >
                              <NoteIcon />
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        onClick={() => openDetailDialog(record)}
                      >
                        {getMerchantBookingActionText("detail", locale)}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            {getMerchantBookingFieldText("managementEmpty", locale)}
          </div>
        )}
      </div>

      <BookingWorkbenchDialog
        open={workbenchOpen}
        siteId={siteId}
        siteName={siteName}
        siteCountryCode={siteCountryCode}
        records={records}
        bookingRulesSnapshot={bookingRulesSnapshot}
        darkMode={darkMode}
        allowCustomerAutoEmail={allowCustomerAutoEmail}
        onSettingsSaved={(settings) => {
          setCustomerEmailLocale(
            resolveMerchantBookingCustomerEmailLocale(settings.customerEmailLocale, siteCountryCode),
          );
          setCustomerEmailLocaleLoaded(true);
        }}
        onClose={() => setWorkbenchOpen(false)}
      />
      {detailDialog}
    </>
  );
}
