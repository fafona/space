"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  formatMerchantOrderAmount,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";

type MerchantOrderManagerDialogProps = {
  open: boolean;
  mode?: "dialog" | "inline";
  showCloseButton?: boolean;
  className?: string;
  siteId: string;
  siteName: string;
  onOrdersChange?: (records: MerchantOrderRecord[]) => void;
  onClose: () => void;
};

type MerchantOrderFilter = "all" | MerchantOrderStatus;

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function formatDateTime(value: string) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
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

function getStatusBadgeClass(status: MerchantOrderStatus) {
  if (status === "confirmed") return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border border-rose-200 bg-rose-50 text-rose-700";
  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function getFilterButtonClass(active: boolean) {
  return active
    ? "rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
    : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600";
}

function buildPrintHtml(order: MerchantOrderRecord) {
  const itemRows = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${item.name || "未命名产品"}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">${item.code || "-"}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${item.unitPriceText}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${formatMerchantOrderAmount(item.subtotal, order.pricePrefix)}</td>
        </tr>`,
    )
    .join("");
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>订单 ${order.id}</title>
    </head>
    <body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:24px;color:#0f172a;">
      <h1 style="margin:0 0 8px;font-size:28px;">订单 ${order.id}</h1>
      <div style="margin-bottom:18px;color:#475569;">${order.siteName || order.siteId} · ${formatDateTime(order.createdAt)}</div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:20px;">
        <div><strong>姓名：</strong>${order.customer.name || "-"}</div>
        <div><strong>电话：</strong>${order.customer.phone || "-"}</div>
        <div><strong>邮箱：</strong>${order.customer.email || "-"}</div>
        <div><strong>状态：</strong>${getStatusText(order.status)}</div>
      </div>
      ${order.customer.note ? `<div style="margin-bottom:20px;"><strong>备注：</strong>${order.customer.note}</div>` : ""}
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr>
            <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:left;">产品</th>
            <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:left;">编号</th>
            <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:center;">数量</th>
            <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:right;">单价</th>
            <th style="padding:8px 10px;border-bottom:2px solid #cbd5e1;text-align:right;">小计</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div style="text-align:right;font-size:20px;font-weight:700;">合计：${formatMerchantOrderAmount(order.totalAmount, order.pricePrefix)}</div>
    </body>
  </html>`;
}

export default function MerchantOrderManagerDialog({
  open,
  mode = "dialog",
  showCloseButton = true,
  className = "",
  siteId,
  siteName,
  onOrdersChange,
  onClose,
}: MerchantOrderManagerDialogProps) {
  const [records, setRecords] = useState<MerchantOrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MerchantOrderFilter>("all");
  const [actionBusyId, setActionBusyId] = useState("");

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
    if (!open || !siteId) return;
    void loadOrders();
  }, [loadOrders, open, siteId]);

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
        record.customer.note,
        record.items.map((item) => `${item.name}\n${item.code}\n${item.description}`).join("\n"),
      ]
        .join("\n")
        .toLowerCase()
        .includes(keyword);
    });
  }, [filter, records, search]);

  const handleOrderAction = useCallback(
    async (order: MerchantOrderRecord, action: "confirm" | "cancel" | "print") => {
      setActionBusyId(order.id);
      setError("");
      setNotice("");
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
          headers: {
            "content-type": "application/json",
          },
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
        setNotice(action === "confirm" ? "订单已确认" : action === "cancel" ? "订单已取消" : "订单已标记为已打印");
      } catch (nextError) {
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单操作失败");
      } finally {
        setActionBusyId("");
      }
    },
    [siteId],
  );

  const content = (
    <div className={mode === "inline" ? className : "w-full max-w-6xl rounded-[28px] bg-white shadow-2xl"}>
      <div className={mode === "inline" ? "space-y-5" : "max-h-[88vh] overflow-hidden rounded-[28px]"}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <div className="text-2xl font-semibold text-slate-900">订单管理</div>
            <div className="mt-1 text-sm text-slate-500">{siteName} 收到的产品订单会集中显示在这里。</div>
            {notice ? <div className="mt-2 text-sm text-emerald-600">{notice}</div> : null}
            {error ? <div className="mt-2 text-sm text-rose-600">{error}</div> : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-500 transition hover:bg-slate-50"
              onClick={onClose}
              aria-label="关闭订单管理"
            >
              ×
            </button>
          ) : null}
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索订单号 / 客户 / 产品"
              className="min-w-[240px] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400"
            />
            {(["all", "pending", "confirmed", "cancelled"] as MerchantOrderFilter[]).map((key) => (
              <button key={key} type="button" className={getFilterButtonClass(filter === key)} onClick={() => setFilter(key)}>
                {key === "all" ? "全部" : getStatusText(key)} {counts[key]}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                正在读取订单...
              </div>
            ) : filteredRecords.length > 0 ? (
              filteredRecords.map((record) => (
                <div key={record.id} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="text-lg font-semibold text-slate-900">{record.id}</div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(record.status)}`}>
                          {getStatusText(record.status)}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-slate-500">{formatDateTime(record.createdAt)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {record.status !== "confirmed" ? (
                        <button
                          type="button"
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
                          onClick={() => void handleOrderAction(record, "confirm")}
                          disabled={actionBusyId === record.id}
                        >
                          确认
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                        onClick={() => void handleOrderAction(record, "print")}
                        disabled={actionBusyId === record.id}
                      >
                        打印{record.printCount > 0 ? ` (${record.printCount})` : ""}
                      </button>
                      {record.status !== "cancelled" ? (
                        <button
                          type="button"
                          className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                          onClick={() => void handleOrderAction(record, "cancel")}
                          disabled={actionBusyId === record.id}
                        >
                          取消
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                    <div className="space-y-3">
                      {record.items.map((item) => (
                        <div key={`${record.id}-${item.productId}-${item.code}`} className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">{item.name || "未命名产品"}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">{item.code || "-"}</div>
                            {item.description ? <div className="mt-2 line-clamp-2 text-sm text-slate-500">{item.description}</div> : null}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm text-slate-500">×{item.quantity}</div>
                            <div className="mt-1 text-base font-semibold text-sky-700">
                              {formatMerchantOrderAmount(item.subtotal, record.pricePrefix)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="text-sm font-semibold text-slate-900">客户信息</div>
                      <div className="grid gap-3 text-sm text-slate-600">
                        <div><span className="text-slate-400">姓名：</span>{record.customer.name || "-"}</div>
                        <div><span className="text-slate-400">电话：</span>{record.customer.phone || "-"}</div>
                        <div><span className="text-slate-400">邮箱：</span>{record.customer.email || "-"}</div>
                        <div><span className="text-slate-400">备注：</span>{record.customer.note || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                        <div className="flex items-center justify-between text-sm text-slate-500">
                          <span>商品数量</span>
                          <span>{record.totalQuantity}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-lg font-semibold text-slate-900">
                          <span>订单合计</span>
                          <span>{formatMerchantOrderAmount(record.totalAmount, record.pricePrefix)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                还没有匹配到订单。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (!open) return null;
  if (mode === "inline") return content;
  return overlay(
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div className="w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
        {content}
      </div>
    </div>,
  );
}
