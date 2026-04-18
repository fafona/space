"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
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
type MerchantOrderSortMode = "created_desc" | "created_asc";
type MerchantOrderHistoryVisibility = "none" | "today" | "3d" | "7d";

const MERCHANT_ORDER_SORT_OPTIONS: MerchantOrderSortMode[] = ["created_desc", "created_asc"];
const MERCHANT_ORDER_HISTORY_OPTIONS: MerchantOrderHistoryVisibility[] = ["none", "today", "3d", "7d"];

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

function getOrderSortOptionText(mode: MerchantOrderSortMode) {
  return mode === "created_asc" ? "最早下单" : "最新下单";
}

function getOrderHistoryVisibilityText(value: MerchantOrderHistoryVisibility) {
  if (value === "none") return "不隐藏";
  if (value === "today") return "今天之前";
  if (value === "3d") return "3天之前";
  return "7天之前";
}

function toTimestamp(value: string) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : 0;
}

function filterMerchantOrdersByHistory(
  records: MerchantOrderRecord[],
  historyVisibility: MerchantOrderHistoryVisibility,
) {
  if (historyVisibility === "none") return records;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const daysBack = historyVisibility === "today" ? 0 : historyVisibility === "3d" ? 3 : 7;
  const threshold = startOfToday - daysBack * 24 * 60 * 60 * 1000;
  return records.filter((record) => toTimestamp(record.createdAt) >= threshold);
}

function sortMerchantOrders(records: MerchantOrderRecord[], sortMode: MerchantOrderSortMode) {
  return [...records].sort((left, right) => {
    const delta = toTimestamp(right.createdAt) - toTimestamp(left.createdAt);
    return sortMode === "created_asc" ? -delta : delta;
  });
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
  const isInline = mode === "inline";
  const [records, setRecords] = useState<MerchantOrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MerchantOrderFilter>("all");
  const [sortMode, setSortMode] = useState<MerchantOrderSortMode>("created_desc");
  const [historyVisibility, setHistoryVisibility] = useState<MerchantOrderHistoryVisibility>("none");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [actionBusyId, setActionBusyId] = useState("");
  const [batchBusyKey, setBatchBusyKey] = useState("");
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  const workbenchButtonClassName = workbenchOpen
    ? "inline-flex items-center justify-center rounded-[18px] rounded-tl-[8px] rounded-br-[24px] border border-[#34d399] bg-[linear-gradient(135deg,#0f172a_0%,#0f766e_58%,#10b981_100%)] px-4 py-2 text-sm font-semibold tracking-[0.03em] text-white shadow-[0_18px_34px_rgba(15,118,110,0.28)] ring-1 ring-[#99f6e4]/60 transition"
    : "inline-flex items-center justify-center rounded-[18px] rounded-tl-[8px] rounded-br-[24px] border border-[#f59e0b] bg-[linear-gradient(135deg,#fef3c7_0%,#f59e0b_38%,#f97316_100%)] px-4 py-2 text-sm font-semibold tracking-[0.03em] text-slate-950 shadow-[0_16px_30px_rgba(249,115,22,0.28)] ring-1 ring-[#fde68a]/80 transition hover:-translate-y-[1px] hover:brightness-[1.03] hover:shadow-[0_20px_34px_rgba(249,115,22,0.34)]";
  const toolbarSelectClassName =
    "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)]";
  const compactBatchButtonClassName = selectionMode
    ? "rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)] transition"
    : "rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:bg-slate-50";

  const loadOrders = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/orders?siteId=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as
        | { orders?: MerchantOrderRecord[]; message?: string; error?: string }
        | null;
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

  useEffect(() => {
    onOrdersChange?.(records);
  }, [onOrdersChange, records]);

  useEffect(() => {
    if (!selectionMode && selectedOrderIds.length > 0) {
      setSelectedOrderIds([]);
    }
  }, [selectedOrderIds.length, selectionMode]);

  const historyFilteredRecords = useMemo(
    () => filterMerchantOrdersByHistory(records, historyVisibility),
    [historyVisibility, records],
  );

  const counts = useMemo(
    () =>
      historyFilteredRecords.reduce(
        (summary, item) => {
          summary.all += 1;
          summary[item.status] += 1;
          return summary;
        },
        { all: 0, pending: 0, confirmed: 0, cancelled: 0 } as Record<MerchantOrderFilter, number>,
      ),
    [historyFilteredRecords],
  );

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return sortMerchantOrders(
      historyFilteredRecords.filter((record) => {
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
      }),
      sortMode,
    );
  }, [filter, historyFilteredRecords, search, sortMode]);

  const visibleRecordIdSet = useMemo(() => new Set(filteredRecords.map((record) => record.id)), [filteredRecords]);
  const selectedRecordSet = useMemo(() => new Set(selectedOrderIds), [selectedOrderIds]);

  useEffect(() => {
    if (!selectionMode) return;
    setSelectedOrderIds((current) => {
      const next = current.filter((id) => visibleRecordIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [selectionMode, visibleRecordIdSet]);

  const requestOrderAction = useCallback(
    async (orderId: string, action: "confirm" | "cancel" | "print") => {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          siteId,
          orderId,
          action,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { order?: MerchantOrderRecord; message?: string; error?: string }
        | null;
      if (!response.ok || !payload?.order) {
        throw new Error(payload?.message || payload?.error || "order_update_failed");
      }
      return payload.order;
    },
    [siteId],
  );

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
        const nextOrder = await requestOrderAction(order.id, action);
        setRecords((current) => current.map((item) => (item.id === order.id ? nextOrder : item)));
        setNotice(action === "confirm" ? "订单已确认" : action === "cancel" ? "订单已取消" : "订单已标记为已打印");
      } catch (nextError) {
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单操作失败");
      } finally {
        setActionBusyId("");
      }
    },
    [requestOrderAction],
  );

  const runBatchOrderAction = useCallback(
    async (action: "confirm" | "cancel") => {
      if (selectedOrderIds.length === 0) return;
      setBatchBusyKey(action);
      setError("");
      setNotice("");
      try {
        const updatedOrders: MerchantOrderRecord[] = [];
        for (const orderId of selectedOrderIds) {
          const nextOrder = await requestOrderAction(orderId, action);
          updatedOrders.push(nextOrder);
        }
        const updatedById = new Map(updatedOrders.map((item) => [item.id, item]));
        setRecords((current) => current.map((item) => updatedById.get(item.id) ?? item));
        setSelectedOrderIds([]);
        setSelectionMode(false);
        setNotice(action === "confirm" ? "已完成批量确认" : "已完成批量取消");
      } catch (nextError) {
        setError(nextError instanceof Error && nextError.message ? nextError.message : "批量操作失败");
      } finally {
        setBatchBusyKey("");
      }
    },
    [requestOrderAction, selectedOrderIds],
  );

  const toggleSelectedOrder = useCallback((orderId: string) => {
    setSelectedOrderIds((current) =>
      current.includes(orderId) ? current.filter((item) => item !== orderId) : [...current, orderId],
    );
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    const visibleIds = filteredRecords.map((item) => item.id);
    setSelectedOrderIds((current) =>
      visibleIds.every((id) => current.includes(id))
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }, [filteredRecords]);

  const handleSelectionCardClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>, orderId: string) => {
      if (!selectionMode) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, input, textarea, select, label, [role="button"], [data-skip-selection-toggle="true"]')) {
        return;
      }
      toggleSelectedOrder(orderId);
    },
    [selectionMode, toggleSelectedOrder],
  );

  const workbenchDialog = workbenchOpen
    ? overlay(
        <div
          className="fixed inset-0 z-[2147482940] flex items-center justify-center bg-black/45 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWorkbenchOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="text-base font-semibold text-slate-900">订单工作台</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">这里先保留入口，工作台内功能下一步继续做。</div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                onClick={() => setWorkbenchOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>,
      )
    : null;

  const content = (
    <div className={isInline ? "w-full" : "w-full max-w-6xl rounded-[28px] bg-white shadow-2xl"}>
      <div className={isInline ? "space-y-5" : "max-h-[88vh] overflow-hidden rounded-[28px]"}>
        <div
          className={`${
            isInline
              ? "sticky top-0 z-20 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/90"
              : ""
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-5">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="text-2xl font-semibold text-slate-900">订单管理</div>
                <button
                  type="button"
                  className={workbenchButtonClassName}
                  onClick={() => setWorkbenchOpen(true)}
                >
                  工作台
                </button>
                <label className={toolbarSelectClassName}>
                  <span className="text-xs font-medium text-slate-500">排序</span>
                  <div className="relative">
                    <select
                      className="appearance-none bg-transparent pr-5 text-sm font-medium text-slate-900 outline-none"
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value as MerchantOrderSortMode)}
                    >
                      {MERCHANT_ORDER_SORT_OPTIONS.map((mode) => (
                        <option key={mode} value={mode}>
                          {getOrderSortOptionText(mode)}
                        </option>
                      ))}
                    </select>
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                      className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    >
                      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </label>
                <label className={toolbarSelectClassName}>
                  <span className="text-xs font-medium text-slate-500">隐藏</span>
                  <div className="relative">
                    <select
                      className="appearance-none bg-transparent pr-5 text-sm font-medium text-slate-900 outline-none"
                      value={historyVisibility}
                      onChange={(event) =>
                        setHistoryVisibility(event.target.value as MerchantOrderHistoryVisibility)
                      }
                    >
                      {MERCHANT_ORDER_HISTORY_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {getOrderHistoryVisibilityText(value)}
                        </option>
                      ))}
                    </select>
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                      className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    >
                      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </label>
                <button
                  type="button"
                  className={compactBatchButtonClassName}
                  onClick={() => setSelectionMode((current) => !current)}
                >
                  批量
                </button>
              </div>
              <div className="text-sm text-slate-500">{siteName} 收到的产品订单会集中显示在这里。</div>
              {notice ? <div className="text-sm text-emerald-600">{notice}</div> : null}
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

          <div className="space-y-3 border-b border-slate-200 px-6 py-5">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索订单号 / 客户 / 产品"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400"
              />
              <div className="flex flex-wrap gap-2">
                {(["all", "pending", "confirmed", "cancelled"] as MerchantOrderFilter[]).map((key) => (
                  <button key={key} type="button" className={getFilterButtonClass(filter === key)} onClick={() => setFilter(key)}>
                    {key === "all" ? "全部" : getStatusText(key)} {counts[key]}
                  </button>
                ))}
              </div>
            </div>

            {selectionMode ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  onClick={toggleSelectAllFiltered}
                >
                  {selectedRecordSet.size > 0 && filteredRecords.every((item) => selectedRecordSet.has(item.id))
                    ? "取消当前页"
                    : "全选当前页"}
                </button>
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                  已选 {selectedOrderIds.length} 条
                </span>
                {selectedOrderIds.length > 0 ? (
                  <>
                    <button
                      type="button"
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
                      onClick={() => void runBatchOrderAction("confirm")}
                      disabled={batchBusyKey === "confirm"}
                    >
                      批量确认
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                      onClick={() => void runBatchOrderAction("cancel")}
                      disabled={batchBusyKey === "cancel"}
                    >
                      批量取消
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                正在读取订单...
              </div>
            ) : filteredRecords.length > 0 ? (
              filteredRecords.map((record) => (
                <article
                  key={record.id}
                  className="relative rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"
                  onClick={(event) => handleSelectionCardClick(event, record.id)}
                >
                  {selectionMode ? (
                    <label className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm">
                      <input
                        type="checkbox"
                        checked={selectedRecordSet.has(record.id)}
                        onChange={() => toggleSelectedOrder(record.id)}
                      />
                      选中
                    </label>
                  ) : null}

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
                          disabled={Boolean(actionBusyId) || Boolean(batchBusyKey)}
                        >
                          确认
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
                        onClick={() => void handleOrderAction(record, "print")}
                        disabled={Boolean(actionBusyId) || Boolean(batchBusyKey)}
                      >
                        打印{record.printCount > 0 ? ` (${record.printCount})` : ""}
                      </button>
                      {record.status !== "cancelled" ? (
                        <button
                          type="button"
                          className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                          onClick={() => void handleOrderAction(record, "cancel")}
                          disabled={Boolean(actionBusyId) || Boolean(batchBusyKey)}
                        >
                          取消
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
                    <div className="space-y-3">
                      {record.items.map((item) => (
                        <div
                          key={`${record.id}-${item.productId}-${item.code}`}
                          className="flex items-start justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3"
                        >
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
                </article>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                还没有匹配到订单。
              </div>
            )}
          </div>
        </div>
      </div>
      {workbenchDialog}
    </div>
  );

  if (!open) return null;
  if (isInline) return content;
  return overlay(
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div className={`w-full max-w-6xl ${className}`.trim()} onClick={(event) => event.stopPropagation()}>
        {content}
      </div>
    </div>,
  );
}
