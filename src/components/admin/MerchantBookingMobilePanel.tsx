"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BookingDateTimeInput from "@/components/booking/BookingDateTimeInput";
import type { MerchantBookingEditableInput, MerchantBookingRecord, MerchantBookingStatus } from "@/lib/merchantBookings";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  getMerchantBookingStatusLabel,
  joinMerchantBookingDateTime,
  normalizeBookingOptionList,
  splitMerchantBookingDateTime,
} from "@/lib/merchantBookings";

type MerchantBookingMobilePanelProps = {
  siteId: string;
  siteName: string;
  storeOptions?: string[];
  itemOptions?: string[];
  titleOptions?: string[];
};

type BookingFilter = "all" | MerchantBookingStatus;

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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function padDateUnit(value: number) {
  return String(value).padStart(2, "0");
}

function getTodayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${padDateUnit(now.getMonth() + 1)}-${padDateUnit(now.getDate())}`;
}

function getAppointmentDayLabel(dateValue: string) {
  const normalized = String(dateValue ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  if (normalized === getTodayDateKey()) return "今天";
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
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()] ?? "";
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

function getFilterChipClass(filter: BookingFilter, key: BookingFilter) {
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

function SummaryField({ value }: { value: string }) {
  return <div className="text-sm text-slate-900">{value || "-"}</div>;
}

function SummaryAppointmentField({
  dateValue,
  timeValue,
  action,
}: {
  dateValue: string;
  timeValue: string;
  action?: ReactNode;
}) {
  const dayLabel = getAppointmentDayLabel(dateValue);
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
}: MerchantBookingMobilePanelProps) {
  const [records, setRecords] = useState<MerchantBookingRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MerchantBookingAdminDraft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BookingFilter>("all");
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
        throw new Error(json?.message || "预约记录读取失败");
      }
      setRecords(json.bookings);
      setDrafts(Object.fromEntries(json.bookings.map((record) => [record.id, createDraft(record)])));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "预约记录读取失败");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

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
        if (filter !== "all" && item.status !== filter) return false;
        return matchesSearch(item, query);
      }),
    [filter, query, records],
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
        const response = await fetch("/api/bookings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            bookingId,
            ...payload,
          }),
        });
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; booking?: MerchantBookingRecord; message?: string }
          | null;
        if (!response.ok || !json?.ok || !json.booking) {
          throw new Error(json?.message || "预约更新失败");
        }
        const nextBooking = json.booking;
        setRecords((current) => current.map((item) => (item.id === nextBooking.id ? nextBooking : item)));
        setDrafts((current) => ({
          ...current,
          [nextBooking.id]: createDraft(nextBooking),
        }));
        return nextBooking;
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : "预约更新失败");
        return null;
      } finally {
        setBusyKey("");
      }
    },
    [siteId],
  );

  const handleDraftChange = useCallback(
    (bookingId: string, key: keyof MerchantBookingAdminDraft, value: string) => {
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
          [key]: value,
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
          {busyKey === `restore:${record.id}` ? "处理中..." : "恢复预约"}
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
            {busyKey === `uncomplete:${record.id}` ? "处理中..." : "取消完成"}
          </button>
        ) : record.status === "confirmed" ? (
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "active" }, "unconfirm")}
            disabled={busyKey === `unconfirm:${record.id}`}
          >
            {busyKey === `unconfirm:${record.id}` ? "处理中..." : "取消确认"}
          </button>
        ) : (
          <button
            type="button"
            className="rounded-full border border-sky-300 bg-sky-100 px-3 py-2 text-xs font-medium text-sky-800 transition hover:bg-sky-200 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "confirmed" }, "confirm")}
            disabled={busyKey === `confirm:${record.id}`}
          >
            {busyKey === `confirm:${record.id}` ? "处理中..." : "确认预约"}
          </button>
        )}
        {record.status !== "completed" ? (
          <button
            type="button"
            className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "completed" }, "complete")}
            disabled={busyKey === `complete:${record.id}`}
          >
            {busyKey === `complete:${record.id}` ? "处理中..." : "完成预约"}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void patchBooking(record.id, { status: "cancelled" }, "cancel")}
          disabled={busyKey === `cancel:${record.id}`}
        >
          {busyKey === `cancel:${record.id}` ? "处理中..." : "取消预约"}
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
                  <div className="text-base font-semibold text-slate-900">预约详情</div>
                  <div className="text-sm text-slate-500">
                    {`${detailDraft.customerName || detailRecord.customerName || "未命名预约"} ${detailDraft.title || detailRecord.title || ""}`.trim()}
                  </div>
                  <div className="text-xs text-slate-500">{`预约编号：${detailRecord.id}`}</div>
                  <div className="text-xs text-slate-500">{`提交时间：${formatDateTime(detailRecord.createdAt)}`}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
                    onClick={closeDetailDialog}
                  >
                    关闭
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                    onClick={() => {
                      void saveDetailDialog();
                    }}
                    disabled={busyKey === `save:${detailRecord.id}`}
                  >
                    {busyKey === `save:${detailRecord.id}` ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-3">
                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">店铺</span>
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
                    <span className="text-xs text-slate-500">项目</span>
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
                    <span className="text-xs text-slate-500">预约时间</span>
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
                    <span className="text-xs text-slate-500">称谓</span>
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
                    <span className="text-xs text-slate-500">姓名</span>
                    <input
                      type="text"
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.customerName}
                      onChange={(event) => handleDraftChange(detailRecord.id, "customerName", event.target.value)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">邮箱</span>
                    <input
                      type="email"
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.email}
                      onChange={(event) => handleDraftChange(detailRecord.id, "email", event.target.value)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">电话</span>
                    <input
                      type="text"
                      className="w-full rounded-[18px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none"
                      value={detailDraft.phone}
                      onChange={(event) => handleDraftChange(detailRecord.id, "phone", event.target.value)}
                    />
                  </label>

                  <label className="space-y-1 text-sm text-slate-700">
                    <span className="text-xs text-slate-500">备注</span>
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
        当前商户信息未准备好，暂时无法读取预约管理。
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-[20px] border border-slate-200 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-900"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索预约号 / 姓名 / 邮箱 / 电话"
            />
            <button
              type="button"
              className="shrink-0 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void loadBookings()}
              disabled={loading}
            >
              {loading ? "刷新中..." : "刷新"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { key: "all" as const, label: `全部 ${counts.total}` },
              { key: "active" as const, label: `待确认 ${counts.active}` },
              { key: "confirmed" as const, label: `已确认 ${counts.confirmed}` },
              { key: "completed" as const, label: `已完成 ${counts.completed}` },
              { key: "cancelled" as const, label: `已取消 ${counts.cancelled}` },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`rounded-full px-3 py-2 text-xs font-medium transition ${getFilterChipClass(filter, item.key)}`}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            正在读取预约记录...
          </div>
        ) : filteredRecords.length > 0 ? (
          <div className="space-y-3">
            {filteredRecords.map((record) => {
              const appointmentParts = splitMerchantBookingDateTime(record.appointmentAt);
              const displayName = record.customerName || "未命名预约";
              const displayTitle = record.title || "";
              return (
                <article
                  key={record.id}
                  className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${getStatusBadgeClass(record.status)}`}>
                          {getMerchantBookingStatusLabel(record.status)}
                        </span>
                        <div className="truncate text-base font-semibold text-slate-900">
                          {displayTitle ? `${displayName} ${displayTitle}` : displayName}
                        </div>
                      </div>
                    </div>
                    {record.email || record.phone ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {record.email ? (
                          <a
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                            href={`mailto:${record.email}`}
                            title="发送邮件"
                            aria-label="发送邮件"
                          >
                            <MailIcon />
                          </a>
                        ) : null}
                        {record.phone ? (
                          <a
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                            href={`tel:${record.phone}`}
                            title="拨打电话"
                            aria-label="拨打电话"
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
                      <SummaryAppointmentField dateValue={appointmentParts.date} timeValue={appointmentParts.time} />
                    </div>
                    <div className="relative flex items-end self-end">
                      {record.note ? (
                        <span
                          className="pointer-events-none absolute bottom-full right-0 mb-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700"
                          title="有备注"
                          aria-label="有备注"
                        >
                          <NoteIcon />
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        onClick={() => openDetailDialog(record)}
                      >
                        详情
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
            还没有匹配到预约记录。
          </div>
        )}
      </div>

      {detailDialog}
    </>
  );
}
