"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BookingStatusFilterDropdown from "@/components/admin/BookingStatusFilterDropdown";
import { useI18n } from "@/components/I18nProvider";
import BookingDateTimeInput from "@/components/booking/BookingDateTimeInput";
import {
  MERCHANT_BOOKING_STATUSES,
  type MerchantBookingEditableInput,
  type MerchantBookingRecord,
  type MerchantBookingStatus,
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
  getMerchantBookingStatusText,
} from "@/lib/merchantBookingLocale";
import { buildMerchantBookingMailtoHref } from "@/lib/merchantBookingMailto";
import usePullToRefresh from "@/lib/usePullToRefresh";

type MerchantBookingMobilePanelProps = {
  siteId: string;
  siteName: string;
  storeOptions?: string[];
  itemOptions?: string[];
  titleOptions?: string[];
  darkMode?: boolean;
  allowBookingEmailPrefill?: boolean;
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

function getStatusBadgeClass(status: MerchantBookingStatus) {
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  if (status === "completed") return "bg-emerald-100 text-emerald-700";
  if (status === "confirmed") return "bg-sky-100 text-sky-700";
  return "bg-amber-100 text-amber-700";
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
  storeOptions = [],
  itemOptions = [],
  titleOptions = [],
  darkMode = false,
  allowBookingEmailPrefill = false,
}: MerchantBookingMobilePanelProps) {
  const { locale } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const loadFailedText = locale.startsWith("es") ? "No se pudieron cargar las citas." : "预约记录读取失败";
  const updateFailedText = locale.startsWith("es") ? "No se pudo actualizar la cita." : "预约更新失败";
  const [records, setRecords] = useState<MerchantBookingRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MerchantBookingAdminDraft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<MerchantBookingStatus[]>(() => [...MERCHANT_BOOKING_STATUSES]);
  const [busyKey, setBusyKey] = useState("");
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);

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

  const counts = useMemo(() => {
    const active = records.filter((item) => item.status === "active").length;
    const confirmed = records.filter((item) => item.status === "confirmed").length;
    const completed = records.filter((item) => item.status === "completed").length;
    const cancelled = records.filter((item) => item.status === "cancelled").length;
    return {
      total: records.length,
      active,
      confirmed,
      completed,
      cancelled,
    };
  }, [records]);

  const filteredRecords = useMemo(
    () =>
      records.filter((item) => {
        if (!selectedStatuses.includes(item.status)) return false;
        return matchesSearch(item, query);
      }),
    [query, records, selectedStatuses],
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
    setDrafts((current) => ({
      ...current,
      [record.id]: createDraft(record),
    }));
    setDetailBookingId(record.id);
  }, []);

  const closeDetailDialog = useCallback(() => {
    setDetailBookingId(null);
  }, []);

  const detailRecord = detailBookingId ? records.find((item) => item.id === detailBookingId) ?? null : null;
  const detailDraft = detailRecord ? drafts[detailRecord.id] ?? createDraft(detailRecord) : null;

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

  const renderStatusActions = (record: MerchantBookingRecord) => {
    if (record.status === "cancelled") {
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
        {record.status !== "completed" ? (
          <button
            type="button"
            className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "completed" }, "complete")}
            disabled={busyKey === `complete:${record.id}`}
          >
            {busyKey === `complete:${record.id}`
              ? getMerchantBookingActionText("processing", locale)
              : getMerchantBookingActionText("complete", locale)}
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
            className="fixed inset-0 z-[2147482950] overflow-y-auto bg-black/45 px-4 pt-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 7rem)" }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDetailDialog();
            }}
          >
            <div
              className="mx-auto my-2 flex w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-[28px] border bg-white shadow-2xl"
              style={{ maxHeight: "calc(100vh - env(safe-area-inset-bottom, 0px) - 8.5rem)" }}
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

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-3">
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
          </div>
          <div className="flex flex-wrap gap-2">
            <BookingStatusFilterDropdown
              locale={locale}
              counts={counts}
              selectedStatuses={selectedStatuses}
              onChange={setSelectedStatuses}
              compact
            />
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
              return (
                <article
                  key={record.id}
                  className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
                >
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
                            href={buildMerchantBookingMailtoHref(record, locale, allowBookingEmailPrefill)}
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
                      {record.note ? (
                        <span
                          className="pointer-events-none absolute bottom-full right-0 mb-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700"
                          title={getMerchantBookingFieldText("hasNote", locale)}
                          aria-label={getMerchantBookingFieldText("hasNote", locale)}
                        >
                          <NoteIcon />
                        </span>
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

      {detailDialog}
    </>
  );
}
