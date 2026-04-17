"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatMerchantOrderAmount,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";

type MerchantOrderMobilePanelProps = {
  siteId: string;
  siteName: string;
  darkMode?: boolean;
  onOrdersChange?: (records: MerchantOrderRecord[]) => void;
};

type MerchantOrderFilter = "all" | MerchantOrderStatus;

function formatDateTime(value: string) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(stamp));
}

function getStatusText(status: MerchantOrderStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "cancelled") return "已取消";
  return "待确认";
}

function getStatusBadgeClass(status: MerchantOrderStatus, darkMode: boolean) {
  if (status === "confirmed") {
    return darkMode ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "cancelled") {
    return darkMode ? "border border-rose-400/30 bg-rose-400/10 text-rose-200" : "border border-rose-200 bg-rose-50 text-rose-700";
  }
  return darkMode ? "border border-amber-400/30 bg-amber-400/10 text-amber-200" : "border border-amber-200 bg-amber-50 text-amber-700";
}

function buildPrintHtml(order: MerchantOrderRecord) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${order.id}</title></head><body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:24px;"><h1>${order.id}</h1><div>${formatDateTime(order.createdAt)}</div><ul>${order.items
    .map((item) => `<li>${item.name || "未命名产品"} × ${item.quantity} - ${formatMerchantOrderAmount(item.subtotal, order.pricePrefix)}</li>`)
    .join("")}</ul><div>合计：${formatMerchantOrderAmount(order.totalAmount, order.pricePrefix)}</div></body></html>`;
}

export default function MerchantOrderMobilePanel({
  siteId,
  siteName,
  darkMode = false,
  onOrdersChange,
}: MerchantOrderMobilePanelProps) {
  const [records, setRecords] = useState<MerchantOrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MerchantOrderFilter>("all");
  const [actionBusyId, setActionBusyId] = useState("");

  const cardClassName = darkMode
    ? "rounded-[26px] border border-white/10 bg-[rgba(15,23,42,0.84)] p-4 shadow-[0_20px_44px_rgba(2,6,23,0.28)]"
    : "rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_36px_rgba(15,23,42,0.08)]";
  const panelClassName = darkMode
    ? "rounded-[28px] border border-white/10 bg-[rgba(15,23,42,0.84)] p-4 shadow-[0_22px_50px_rgba(2,6,23,0.32)]"
    : "rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_22px_50px_rgba(15,23,42,0.08)]";

  const loadOrders = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/orders?siteId=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as { orders?: MerchantOrderRecord[]; message?: string; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "order_list_failed");
      }
      const nextRecords = Array.isArray(payload?.orders) ? payload.orders : [];
      setRecords(nextRecords);
      onOrdersChange?.(nextRecords);
    } catch (nextError) {
      setError(nextError instanceof Error && nextError.message ? nextError.message : "订单读取失败");
    } finally {
      setLoading(false);
    }
  }, [onOrdersChange, siteId]);

  useEffect(() => {
    if (!siteId) return;
    void loadOrders();
  }, [loadOrders, siteId]);

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return records.filter((record) => {
      if (filter !== "all" && record.status !== filter) return false;
      if (!keyword) return true;
      return [
        record.id,
        record.customer.name,
        record.customer.phone,
        record.customer.email,
        record.items.map((item) => `${item.name}\n${item.code}`).join("\n"),
      ]
        .join("\n")
        .toLowerCase()
        .includes(keyword);
    });
  }, [filter, records, search]);

  const counts = useMemo(
    () =>
      records.reduce(
        (summary, item) => {
          summary.all += 1;
          summary[item.status] += 1;
          return summary;
        },
        { all: 0, pending: 0, confirmed: 0, cancelled: 0 } as Record<MerchantOrderFilter, number>,
      ),
    [records],
  );

  const handleOrderAction = useCallback(
    async (order: MerchantOrderRecord, action: "confirm" | "cancel" | "print") => {
      setActionBusyId(order.id);
      setError("");
      try {
        if (action === "print" && typeof window !== "undefined") {
          const popup = window.open("", "_blank", "noopener,noreferrer,width=920,height=760");
          if (popup) {
            popup.document.open();
            popup.document.write(buildPrintHtml(order));
            popup.document.close();
            popup.focus();
            popup.print();
          }
        }
        const response = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId,
            orderId: order.id,
            action,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { order?: MerchantOrderRecord; message?: string; error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || "order_update_failed");
        }
        const nextOrder = payload?.order ?? null;
        setRecords((current) => current.map((item) => (item.id === order.id && nextOrder ? nextOrder : item)));
      } catch (nextError) {
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单操作失败");
      } finally {
        setActionBusyId("");
      }
    },
    [siteId],
  );

  return (
    <div className="space-y-4 py-4">
      <div className={panelClassName}>
        <div className={`text-lg font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>订单管理</div>
        <div className={`mt-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>{siteName} 的产品订单会在这里集中处理。</div>
        {error ? <div className="mt-2 text-sm text-rose-500">{error}</div> : null}
        <div className="mt-4 space-y-3">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索订单号 / 客户 / 产品"
            className={`w-full rounded-[20px] border px-4 py-3 text-sm outline-none ${
              darkMode ? "border-white/10 bg-white/5 text-white placeholder:text-slate-400" : "border-slate-200 bg-white text-slate-900"
            }`}
          />
          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "confirmed", "cancelled"] as MerchantOrderFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className={
                  filter === key
                    ? darkMode
                      ? "rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                      : "rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                    : darkMode
                      ? "rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
                      : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600"
                }
                onClick={() => setFilter(key)}
              >
                {key === "all" ? "全部" : getStatusText(key)} {counts[key]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {loading ? (
        <div className={panelClassName}>
          <div className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>正在读取订单...</div>
        </div>
      ) : filteredRecords.length > 0 ? (
        filteredRecords.map((record) => (
          <div key={record.id} className={cardClassName}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-lg font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>{record.id}</div>
                <div className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{formatDateTime(record.createdAt)}</div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(record.status, darkMode)}`}>
                {getStatusText(record.status)}
              </span>
            </div>
            <div className={`mt-4 grid gap-2 text-sm ${darkMode ? "text-slate-200" : "text-slate-600"}`}>
              <div>姓名：{record.customer.name || "-"}</div>
              <div>电话：{record.customer.phone || "-"}</div>
              <div>邮箱：{record.customer.email || "-"}</div>
              {record.customer.note ? <div>备注：{record.customer.note}</div> : null}
            </div>
            <div className="mt-4 space-y-2">
              {record.items.map((item) => (
                <div key={`${record.id}-${item.productId}-${item.code}`} className={`rounded-2xl border px-3 py-3 text-sm ${darkMode ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-100 bg-slate-50 text-slate-700"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{item.name || "未命名产品"}</div>
                      <div className={`mt-1 text-xs ${darkMode ? "text-slate-400" : "text-slate-400"}`}>{item.code || "-"}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div>×{item.quantity}</div>
                      <div className="mt-1 font-semibold text-sky-500">{formatMerchantOrderAmount(item.subtotal, record.pricePrefix)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>合计 {record.totalQuantity} 件</div>
              <div className={`text-lg font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                {formatMerchantOrderAmount(record.totalAmount, record.pricePrefix)}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {record.status !== "confirmed" ? (
                <button
                  type="button"
                  className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  onClick={() => void handleOrderAction(record, "confirm")}
                  disabled={actionBusyId === record.id}
                >
                  确认
                </button>
              ) : null}
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${darkMode ? "bg-white/10 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                onClick={() => void handleOrderAction(record, "print")}
                disabled={actionBusyId === record.id}
              >
                打印
              </button>
              {record.status !== "cancelled" ? (
                <button
                  type="button"
                  className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  onClick={() => void handleOrderAction(record, "cancel")}
                  disabled={actionBusyId === record.id}
                >
                  取消
                </button>
              ) : null}
            </div>
          </div>
        ))
      ) : (
        <div className={panelClassName}>
          <div className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>还没有匹配到订单。</div>
        </div>
      )}
    </div>
  );
}
