"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MerchantBookingRecord, MerchantBookingStatus } from "@/lib/merchantBookings";

type MerchantBookingManagerDialogProps = {
  open: boolean;
  siteId: string;
  siteName: string;
  onClose: () => void;
};

type BookingFilter = "all" | "active" | "cancelled";

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

export default function MerchantBookingManagerDialog({
  open,
  siteId,
  siteName,
  onClose,
}: MerchantBookingManagerDialogProps) {
  const [records, setRecords] = useState<MerchantBookingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BookingFilter>("all");
  const [busyId, setBusyId] = useState("");

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
    const cancelled = records.filter((item) => item.status === "cancelled").length;
    return {
      total: records.length,
      active,
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

  const updateStatus = async (bookingId: string, status: MerchantBookingStatus) => {
    setBusyId(bookingId);
    setError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          bookingId,
          status,
        }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; booking?: MerchantBookingRecord; message?: string }
        | null;
      if (!response.ok || !json?.ok || !json.booking) {
        throw new Error(json?.message || "预约状态更新失败");
      }
      setRecords((current) =>
        current.map((item) => (item.id === json.booking?.id ? json.booking : item)),
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "预约状态更新失败");
    } finally {
      setBusyId("");
    }
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
                { key: "active" as const, label: `进行中 ${counts.active}` },
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
                const isCancelled = record.status === "cancelled";
                return (
                  <article key={record.id} className="rounded-2xl border bg-slate-50 p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-900">{record.customerName || "未命名预约"}</div>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] ${
                              isCancelled ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {isCancelled ? "已取消" : "进行中"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">{`预约编号：${record.id}`}</div>
                        <div className="text-xs text-slate-500">{`创建时间：${formatDateTime(record.createdAt)}`}</div>
                      </div>
                      <div className="flex gap-2">
                        {isCancelled ? (
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => void updateStatus(record.id, "active")}
                            disabled={busyId === record.id}
                          >
                            {busyId === record.id ? "处理中..." : "恢复预约"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => void updateStatus(record.id, "cancelled")}
                            disabled={busyId === record.id}
                          >
                            {busyId === record.id ? "处理中..." : "取消预约"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
                      <div>{`店铺：${record.store}`}</div>
                      <div>{`项目：${record.item}`}</div>
                      <div>{`预约时间：${formatDateTime(record.appointmentAt)}`}</div>
                      <div>{`称谓：${record.title}`}</div>
                      <div>{`邮箱：${record.email}`}</div>
                      <div>{`电话：${record.phone}`}</div>
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
