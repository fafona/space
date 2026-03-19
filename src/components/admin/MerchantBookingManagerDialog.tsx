"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MerchantBookingRecord, MerchantBookingStatus } from "@/lib/merchantBookings";
import {
  buildDefaultBookingItemOptions,
  buildDefaultBookingStoreOptions,
  buildDefaultBookingTitleOptions,
  getMerchantBookingStatusLabel,
  joinMerchantBookingDateTime,
  normalizeBookingOptionList,
  splitMerchantBookingDateTime,
} from "@/lib/merchantBookings";

type MerchantBookingManagerDialogProps = {
  open: boolean;
  siteId: string;
  siteName: string;
  storeOptions?: string[];
  itemOptions?: string[];
  titleOptions?: string[];
  onClose: () => void;
};

type BookingFilter = "all" | MerchantBookingStatus;

type MerchantBookingAdminDraft = {
  store: string;
  item: string;
  appointmentAt: string;
  title: string;
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
  return {
    store: record.store,
    item: record.item,
    appointmentAt: record.appointmentAt,
    title: record.title,
  };
}

function getStatusBadgeClass(status: MerchantBookingStatus) {
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
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
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6.4 3.7c.3-.4.8-.6 1.2-.4l2 1a1 1 0 0 1 .5 1.2l-.6 2a1 1 0 0 0 .2.9l1.2 1.2a1 1 0 0 0 .9.2l2-.6a1 1 0 0 1 1.2.5l1 2a1.1 1.1 0 0 1-.4 1.3l-1.2.8c-.6.4-1.4.5-2 .2-2-.9-3.9-2.4-5.6-4.1-1.7-1.7-3.2-3.6-4.1-5.6a1.8 1.8 0 0 1 .2-2l.8-1.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MerchantBookingManagerDialog({
  open,
  siteId,
  siteName,
  storeOptions = [],
  itemOptions = [],
  titleOptions = [],
  onClose,
}: MerchantBookingManagerDialogProps) {
  const [records, setRecords] = useState<MerchantBookingRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MerchantBookingAdminDraft>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BookingFilter>("all");
  const [busyKey, setBusyKey] = useState("");

  useEffect(() => {
    if (!open || !siteId) return;
    let cancelled = false;
    const load = async () => {
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
        if (!cancelled) {
          setRecords(json.bookings);
          setDrafts(
            Object.fromEntries(json.bookings.map((record) => [record.id, createDraft(record)])),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "预约记录读取失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, siteId]);

  const counts = useMemo(() => {
    const active = records.filter((item) => item.status === "active").length;
    const confirmed = records.filter((item) => item.status === "confirmed").length;
    const cancelled = records.filter((item) => item.status === "cancelled").length;
    return {
      total: records.length,
      active,
      confirmed,
      cancelled,
    };
  }, [records]);

  const filteredRecords = useMemo(
    () =>
      records.filter((item) => {
        if (filter !== "all" && item.status !== filter) return false;
        return matchesSearch(item, query);
      }),
    [records, filter, query],
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

  const patchBooking = async (
    bookingId: string,
    payload: {
      status?: MerchantBookingStatus;
      updates?: Partial<MerchantBookingAdminDraft>;
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
      setRecords((current) =>
        current.map((item) => (item.id === nextBooking.id ? nextBooking : item)),
      );
      setDrafts((current) => ({
        ...current,
        [nextBooking.id]: createDraft(nextBooking),
      }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "预约更新失败");
    } finally {
      setBusyKey("");
    }
  };

  const handleDraftChange = (
    bookingId: string,
    key: keyof MerchantBookingAdminDraft,
    value: string,
  ) => {
    setDrafts((current) => ({
      ...current,
      [bookingId]: {
        ...(current[bookingId] ?? { store: "", item: "", appointmentAt: "", title: "" }),
        [key]: value,
      },
    }));
  };

  const renderStatusActions = (record: MerchantBookingRecord) => {
    if (record.status === "cancelled") {
      return (
        <button
          type="button"
          className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void patchBooking(record.id, { status: "active" }, "restore")}
          disabled={busyKey === `restore:${record.id}`}
        >
          {busyKey === `restore:${record.id}` ? "处理中..." : "恢复预约"}
        </button>
      );
    }

    return (
      <>
        {record.status === "confirmed" ? (
          <button
            type="button"
            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "active" }, "unconfirm")}
            disabled={busyKey === `unconfirm:${record.id}`}
          >
            {busyKey === `unconfirm:${record.id}` ? "处理中..." : "取消确认"}
          </button>
        ) : (
          <button
            type="button"
            className="rounded border bg-black px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={() => void patchBooking(record.id, { status: "confirmed" }, "confirm")}
            disabled={busyKey === `confirm:${record.id}`}
          >
            {busyKey === `confirm:${record.id}` ? "处理中..." : "确认预约"}
          </button>
        )}
        <button
          type="button"
          className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void patchBooking(record.id, { status: "cancelled" }, "cancel")}
          disabled={busyKey === `cancel:${record.id}`}
        >
          {busyKey === `cancel:${record.id}` ? "处理中..." : "取消预约"}
        </button>
      </>
    );
  };

  if (!open) return null;

  return overlay(
    <div
      className="fixed inset-0 z-[2147482800] bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="mx-auto flex h-full max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div className="space-y-1">
            <div className="text-lg font-semibold text-slate-900">预约管理</div>
            <div className="text-sm text-slate-500">{`查看并管理 ${siteName || siteId} 收到的预约记录。`}</div>
          </div>
          <button
            type="button"
            className="rounded border bg-white px-3 py-2 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 border-b px-5 py-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索预约编号 / 店铺 / 项目 / 姓名 / 邮箱 / 电话 / 备注"
            />
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all" as const, label: `全部 ${counts.total}` },
                { key: "active" as const, label: `待确认 ${counts.active}` },
                { key: "confirmed" as const, label: `已确认 ${counts.confirmed}` },
                { key: "cancelled" as const, label: `已取消 ${counts.cancelled}` },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                    filter === item.key ? "border-black bg-black text-white" : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {error ? (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center rounded-2xl border bg-slate-50 text-sm text-slate-500">
              正在读取预约记录...
            </div>
          ) : filteredRecords.length > 0 ? (
            <div className="space-y-4">
              {filteredRecords.map((record) => {
                const draft = drafts[record.id] ?? createDraft(record);
                const appointmentParts = splitMerchantBookingDateTime(draft.appointmentAt);
                return (
                  <article key={record.id} className="rounded-2xl border bg-slate-50 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-900">{record.customerName || "未命名预约"}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${getStatusBadgeClass(record.status)}`}>
                            {getMerchantBookingStatusLabel(record.status)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">{`预约编号：${record.id}`}</div>
                        <div className="text-xs text-slate-500">{`创建时间：${formatDateTime(record.createdAt)}`}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">{renderStatusActions(record)}</div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="space-y-1 text-sm text-slate-700">
                        <span className="text-xs text-slate-500">店铺</span>
                        <select
                          className="w-full rounded border px-3 py-2"
                          value={draft.store}
                          onChange={(event) => handleDraftChange(record.id, "store", event.target.value)}
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
                          className="w-full rounded border px-3 py-2"
                          value={draft.item}
                          onChange={(event) => handleDraftChange(record.id, "item", event.target.value)}
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
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                          <input
                            type="date"
                            className="w-full rounded border px-3 py-2"
                            value={appointmentParts.date}
                            onChange={(event) =>
                              handleDraftChange(
                                record.id,
                                "appointmentAt",
                                joinMerchantBookingDateTime(event.target.value, appointmentParts.time),
                              )
                            }
                          />
                          <input
                            type="time"
                            step={60}
                            className="w-full rounded border px-3 py-2"
                            value={appointmentParts.time}
                            onChange={(event) =>
                              handleDraftChange(
                                record.id,
                                "appointmentAt",
                                joinMerchantBookingDateTime(appointmentParts.date, event.target.value),
                              )
                            }
                          />
                        </div>
                      </label>
                      <label className="space-y-1 text-sm text-slate-700">
                        <span className="text-xs text-slate-500">称谓</span>
                        <select
                          className="w-full rounded border px-3 py-2"
                          value={draft.title}
                          onChange={(event) => handleDraftChange(record.id, "title", event.target.value)}
                        >
                          {selectableTitleOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                        onClick={() =>
                          void patchBooking(
                            record.id,
                            {
                              updates: {
                                store: draft.store,
                                item: draft.item,
                                appointmentAt: draft.appointmentAt,
                                title: draft.title,
                              },
                            },
                            "save",
                          )
                        }
                        disabled={busyKey === `save:${record.id}`}
                      >
                        {busyKey === `save:${record.id}` ? "保存中..." : "保存修改"}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
                      <div>{`姓名：${record.customerName}`}</div>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate">{`邮箱：${record.email}`}</span>
                        {record.email ? (
                          <a
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-white text-slate-700 hover:bg-slate-50"
                            href={`mailto:${record.email}`}
                            title="回复邮箱"
                            aria-label="回复邮箱"
                          >
                            <MailIcon />
                          </a>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate">{`电话：${record.phone}`}</span>
                        {record.phone ? (
                          <a
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border bg-white text-slate-700 hover:bg-slate-50"
                            href={`tel:${record.phone}`}
                            title="拨打电话"
                            aria-label="拨打电话"
                          >
                            <PhoneIcon />
                          </a>
                        ) : null}
                      </div>
                      {record.note ? <div className="md:col-span-2 xl:col-span-3">{`备注：${record.note}`}</div> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed bg-slate-50 px-6 text-center text-sm text-slate-500">
              还没有匹配到预约记录。
            </div>
          )}
        </div>
      </div>
    </div>,
  );
}
