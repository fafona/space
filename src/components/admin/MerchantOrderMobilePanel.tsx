"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  formatMerchantOrderAmount,
  isMerchantOrderPendingMerchantTouch,
  type MerchantOrderAction,
  type MerchantOrderLineItemInput,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";

type MerchantOrderMobilePanelProps = {
  siteId: string;
  siteName: string;
  darkMode?: boolean;
  onOrdersChange?: (records: MerchantOrderRecord[]) => void;
  onSectionChange?: (section: "booking" | "orders") => void;
};

type MerchantOrderFilter = "all" | MerchantOrderStatus;
type MerchantOrderSortMode = "created_desc" | "created_asc";
type MerchantOrderHistoryVisibility = "none" | "today" | "3d" | "7d";

const MERCHANT_ORDER_SORT_OPTIONS: MerchantOrderSortMode[] = ["created_desc", "created_asc"];
const MERCHANT_ORDER_HISTORY_OPTIONS: MerchantOrderHistoryVisibility[] = ["none", "today", "3d", "7d"];

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

function getDetailItemDraftKey(orderId: string, index: number) {
  return `${orderId}:${index}`;
}

function parseQuantityDraftAllowZero(value: string, fallback: number) {
  const raw = String(value).trim();
  if (raw === "") return fallback;
  const next = Number.parseInt(raw, 10);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, next);
}

function getStatusText(status: MerchantOrderStatus) {
  if (status === "completed") return "已完成";
  if (status === "confirmed") return "已确认";
  if (status === "cancelled") return "已取消";
  return "待确认";
}

function getStatusBadgeClass(status: MerchantOrderStatus, darkMode: boolean) {
  if (status === "completed") {
    return darkMode
      ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "confirmed") {
    return darkMode
      ? "border border-sky-400/30 bg-sky-400/10 text-sky-200"
      : "border border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "cancelled") {
    return darkMode
      ? "border border-rose-400/30 bg-rose-400/10 text-rose-200"
      : "border border-rose-200 bg-rose-50 text-rose-700";
  }
  return darkMode
    ? "border border-amber-400/30 bg-amber-400/10 text-amber-200"
    : "border border-amber-200 bg-amber-50 text-amber-700";
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>${order.id}</title></head><body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:24px;"><h1>${order.id}</h1><div>${formatDateTime(order.createdAt)}</div><ul>${order.items
    .map((item) => `<li>${item.name || "未命名产品"} × ${item.quantity} - ${formatMerchantOrderAmount(item.subtotal, order.pricePrefix)}</li>`)
    .join("")}</ul><div>合计：${formatMerchantOrderAmount(order.totalAmount, order.pricePrefix)}</div></body></html>`;
}

export default function MerchantOrderMobilePanel({
  siteId,
  siteName,
  darkMode = false,
  onOrdersChange,
  onSectionChange,
}: MerchantOrderMobilePanelProps) {
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<MerchantOrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MerchantOrderFilter>("all");
  const [sortMode, setSortMode] = useState<MerchantOrderSortMode>("created_desc");
  const [historyVisibility, setHistoryVisibility] = useState<MerchantOrderHistoryVisibility>("none");
  const [actionBusyId, setActionBusyId] = useState("");
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailQuantityDrafts, setDetailQuantityDrafts] = useState<Record<string, string>>({});
  const [mobileCustomerInfoOpen, setMobileCustomerInfoOpen] = useState(false);

  const cardClassName = darkMode
    ? "rounded-[26px] border border-white/10 bg-[rgba(15,23,42,0.84)] p-4 shadow-[0_20px_44px_rgba(2,6,23,0.28)]"
    : "rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_36px_rgba(15,23,42,0.08)]";
  const emptyPanelClassName = darkMode
    ? "rounded-[28px] border border-white/10 bg-[rgba(15,23,42,0.84)] px-5 py-8 text-center text-sm text-slate-300 shadow-[0_22px_50px_rgba(2,6,23,0.32)]"
    : "rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_22px_50px_rgba(15,23,42,0.08)]";
  const toolbarClassName = `sticky top-0 z-20 -mx-4 space-y-2.5 border-b border-slate-200/80 px-4 pb-3 pt-0 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur ${
    darkMode
      ? "bg-[rgba(15,23,42,0.96)] supports-[backdrop-filter]:bg-[rgba(15,23,42,0.9)]"
      : "bg-[rgba(248,250,252,0.96)] supports-[backdrop-filter]:bg-[rgba(248,250,252,0.9)]"
  }`;
  const filterSelectShellClassName = darkMode
    ? "rounded-[18px] border border-slate-700 bg-slate-900/75 px-3 py-2.5 text-slate-100 shadow-sm"
    : "rounded-[18px] border border-slate-200 bg-white px-3 py-2.5 text-slate-900 shadow-sm";
  const filterSelectLabelClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const filterSelectIconClassName = darkMode ? "text-slate-500" : "text-slate-400";
  const overflowMenuButtonClassName = overflowMenuOpen
    ? darkMode
      ? "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-amber-300/40 bg-amber-200/10 text-amber-100 shadow-sm"
      : "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-300 bg-slate-900 text-white shadow-sm"
    : darkMode
      ? "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-100 shadow-sm transition hover:bg-white/10"
      : "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50";
  const overflowMenuPanelClassName = darkMode
    ? "absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(18rem,calc(100vw-2rem))] rounded-[24px] border border-white/10 bg-[rgba(15,23,42,0.98)] p-3 shadow-[0_24px_60px_rgba(2,6,23,0.4)]"
    : "absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(18rem,calc(100vw-2rem))] rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.18)]";
  const overflowMenuPrimaryButtonClassName = darkMode
    ? "w-full rounded-[18px] border border-amber-300/30 bg-amber-200/10 px-3.5 py-3 text-left text-[13px] font-semibold text-amber-100 shadow-sm transition hover:bg-amber-200/15"
    : "w-full rounded-[18px] border border-[#d8c7a5] bg-[linear-gradient(135deg,#fffdfa_0%,#f6efe1_62%,#ecdfc2_100%)] px-3.5 py-3 text-left text-[13px] font-semibold text-slate-800 shadow-sm transition hover:brightness-[0.99]";
  const detailPanelClassName = darkMode
    ? "flex w-full max-w-lg max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(15,23,42,0.98)] shadow-[0_32px_80px_rgba(2,6,23,0.52)]"
    : "flex w-full max-w-lg max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_72px_rgba(15,23,42,0.2)]";

  const loadOrders = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
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
      setRecords(Array.isArray(payload?.orders) ? payload.orders : []);
    } catch (nextError) {
      setError(nextError instanceof Error && nextError.message ? nextError.message : "订单读取失败");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    if (!siteId) return;
    void loadOrders();
  }, [loadOrders, siteId]);

  useEffect(() => {
    onOrdersChange?.(records);
  }, [onOrdersChange, records]);

  useEffect(() => {
    if (!overflowMenuOpen || typeof document === "undefined") return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (overflowMenuRef.current?.contains(target)) return;
      setOverflowMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [overflowMenuOpen]);

  const historyFilteredRecords = useMemo(
    () => filterMerchantOrdersByHistory(records, historyVisibility),
    [historyVisibility, records],
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
          record.items.map((item) => `${item.name}\n${item.code}`).join("\n"),
        ]
          .join("\n")
          .toLowerCase()
          .includes(keyword);
      }),
      sortMode,
    );
  }, [filter, historyFilteredRecords, search, sortMode]);

  const counts = useMemo(
    () =>
      historyFilteredRecords.reduce(
        (summary, item) => {
          summary.all += 1;
          summary[item.status] += 1;
          return summary;
        },
        { all: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0 } as Record<MerchantOrderFilter, number>,
      ),
    [historyFilteredRecords],
  );

  const detailOrder = useMemo(
    () => (detailOrderId ? records.find((record) => record.id === detailOrderId) ?? null : null),
    [detailOrderId, records],
  );

  useEffect(() => {
    if (!detailOrder) {
      setDetailQuantityDrafts({});
      setMobileCustomerInfoOpen(false);
      return;
    }
    setDetailQuantityDrafts(
      Object.fromEntries(detailOrder.items.map((item, index) => [getDetailItemDraftKey(detailOrder.id, index), String(item.quantity)])),
    );
    setMobileCustomerInfoOpen(false);
  }, [detailOrder]);

  const requestOrderAction = useCallback(
    async (orderId: string, action: MerchantOrderAction) => {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        keepalive: action === "touch",
        headers: { "content-type": "application/json" },
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

  const requestOrderItemsUpdate = useCallback(
    async (orderId: string, items: MerchantOrderLineItemInput[]) => {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId,
          orderId,
          items,
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

  const buildDetailDraftItemsInput = useCallback(
    (order: MerchantOrderRecord) =>
      order.items.flatMap((item, index) => {
        const nextQuantity = parseQuantityDraftAllowZero(
          detailQuantityDrafts[getDetailItemDraftKey(order.id, index)] ?? String(item.quantity),
          item.quantity,
        );
        if (nextQuantity <= 0) return [];
        return [
          {
            productId: item.productId,
            code: item.code,
            name: item.name,
            description: item.description,
            imageUrl: item.imageUrl,
            tag: item.tag,
            quantity: nextQuantity,
            unitPrice: item.unitPrice,
            unitPriceText: item.unitPriceText,
          },
        ];
      }),
    [detailQuantityDrafts],
  );

  const hasDetailQuantityDraftChanges = useCallback(
    (order: MerchantOrderRecord) => {
      const nextItems = buildDetailDraftItemsInput(order);
      if (nextItems.length !== order.items.length) return true;
      return order.items.some((item, index) => {
        const nextItem = nextItems[index];
        return !nextItem || Number(nextItem.quantity ?? item.quantity) !== item.quantity;
      });
    },
    [buildDetailDraftItemsInput],
  );

  const detailPreviewEntries = useMemo(() => {
    if (!detailOrder) return [];
    return detailOrder.items
      .map((item, index) => {
        const quantity = parseQuantityDraftAllowZero(
          detailQuantityDrafts[getDetailItemDraftKey(detailOrder.id, index)] ?? String(item.quantity),
          item.quantity,
        );
        return {
          item,
          index,
          quantity,
          subtotal: Number((item.unitPrice * quantity).toFixed(2)),
        };
      })
      .filter((entry) => entry.quantity > 0);
  }, [detailOrder, detailQuantityDrafts]);

  const detailPreviewTotalQuantity = useMemo(
    () => detailPreviewEntries.reduce((sum, entry) => sum + entry.quantity, 0),
    [detailPreviewEntries],
  );

  const detailPreviewTotalAmount = useMemo(
    () => Number(detailPreviewEntries.reduce((sum, entry) => sum + entry.subtotal, 0).toFixed(2)),
    [detailPreviewEntries],
  );

  const markOrderTouched = useCallback(
    async (orderId: string) => {
      const currentOrder = records.find((item) => item.id === orderId);
      if (!currentOrder || !isMerchantOrderPendingMerchantTouch(currentOrder)) return;
      const touchedAt = new Date().toISOString();
      setRecords((current) =>
        current.map((item) => (item.id === orderId ? { ...item, merchantTouchedAt: touchedAt } : item)),
      );
      try {
        const nextOrder = await requestOrderAction(orderId, "touch");
        setRecords((current) => current.map((item) => (item.id === orderId ? nextOrder : item)));
      } catch {
        setRecords((current) => current.map((item) => (item.id === orderId ? currentOrder : item)));
      }
    },
    [records, requestOrderAction],
  );

  const handleOrderAction = useCallback(
    async (
      order: MerchantOrderRecord,
      action: "confirm" | "cancel" | "restore" | "complete" | "uncomplete" | "print",
      options: { persistDetailDraft?: boolean } = {},
    ) => {
      setActionBusyId(order.id);
      setError("");
      try {
        let baseOrder = order;
        if (options.persistDetailDraft && (action === "confirm" || action === "complete") && hasDetailQuantityDraftChanges(order)) {
          baseOrder = await requestOrderItemsUpdate(order.id, buildDetailDraftItemsInput(order));
          setRecords((current) => current.map((item) => (item.id === order.id ? baseOrder : item)));
        }
        if (action === "print" && typeof window !== "undefined") {
          const popup = window.open("", "_blank", "noopener,noreferrer,width=920,height=760");
          if (popup) {
            popup.document.open();
            popup.document.write(buildPrintHtml(baseOrder));
            popup.document.close();
            popup.focus();
            popup.print();
          }
        }
        const nextOrder = await requestOrderAction(baseOrder.id, action);
        setRecords((current) => current.map((item) => (item.id === order.id ? nextOrder : item)));
      } catch (nextError) {
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单操作失败");
      } finally {
        setActionBusyId("");
      }
    },
    [buildDetailDraftItemsInput, hasDetailQuantityDraftChanges, requestOrderAction, requestOrderItemsUpdate],
  );

  const openDetailDialog = useCallback(
    (order: MerchantOrderRecord) => {
      setDetailOrderId(order.id);
      void markOrderTouched(order.id);
    },
    [markOrderTouched],
  );

  const closeDetailDialog = useCallback(() => {
    setDetailOrderId("");
  }, []);

  const handleDetailQuantityDraftChange = useCallback((orderId: string, itemIndex: number, value: string) => {
    const nextValue = value.replace(/[^\d]/g, "");
    setDetailQuantityDrafts((current) => ({
      ...current,
      [getDetailItemDraftKey(orderId, itemIndex)]: nextValue,
    }));
  }, []);

  const normalizeDetailItemQuantityDraft = useCallback((order: MerchantOrderRecord, itemIndex: number, value: string | number) => {
    const currentItem = order.items[itemIndex];
    if (!currentItem) return;
    const draftKey = getDetailItemDraftKey(order.id, itemIndex);
    const nextQuantity = parseQuantityDraftAllowZero(String(value), currentItem.quantity);
    setDetailQuantityDrafts((current) => ({
      ...current,
      [draftKey]: String(nextQuantity),
    }));
  }, []);

  const stepDetailItemQuantity = useCallback(
    (order: MerchantOrderRecord, itemIndex: number, delta: number) => {
      const currentItem = order.items[itemIndex];
      if (!currentItem) return;
      const draftKey = getDetailItemDraftKey(order.id, itemIndex);
      const baseQuantity = parseQuantityDraftAllowZero(
        detailQuantityDrafts[draftKey] ?? String(currentItem.quantity),
        currentItem.quantity,
      );
      setDetailQuantityDrafts((current) => ({
        ...current,
        [draftKey]: String(Math.max(0, baseQuantity + delta)),
      }));
    },
    [detailQuantityDrafts],
  );

  const renderStatusActions = useCallback(
    (record: MerchantOrderRecord) => (
      <>
        {record.status === "confirmed" ? (
          <button
            type="button"
            className={
              darkMode
                ? "rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            }
            onClick={() => void handleOrderAction(record, "restore")}
            disabled={actionBusyId === record.id}
          >
            取消确认
          </button>
        ) : record.status === "cancelled" ? (
          <button
            type="button"
            className={
              darkMode
                ? "rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            }
            onClick={() => void handleOrderAction(record, "restore")}
            disabled={actionBusyId === record.id}
          >
            恢复待确认
          </button>
        ) : (
          <button
            type="button"
            className={
              darkMode
                ? "rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:bg-sky-400/20 disabled:opacity-50"
                : "rounded-full border border-sky-300 bg-sky-100 px-3 py-2 text-xs font-medium text-sky-800 transition hover:bg-sky-200 disabled:opacity-50"
            }
            onClick={() => void handleOrderAction(record, "confirm")}
            disabled={actionBusyId === record.id}
          >
            确认
          </button>
        )}
        {record.status === "confirmed" ? (
          <button
            type="button"
            className={
              darkMode
                ? "inline-flex h-[38px] min-w-[54px] items-center justify-center rounded-[14px] border border-emerald-400/30 bg-emerald-400/10 px-3 text-emerald-100 shadow-[0_10px_24px_rgba(16,185,129,0.18)] transition hover:-translate-y-[1px] hover:bg-emerald-400/15 disabled:opacity-50"
                : "inline-flex h-[38px] min-w-[54px] items-center justify-center rounded-[14px] border border-emerald-200 bg-[linear-gradient(180deg,#ffffff_0%,#ecfdf5_100%)] px-3 text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.13)] transition hover:-translate-y-[1px] hover:border-emerald-300 hover:shadow-[0_12px_28px_rgba(16,185,129,0.17)] disabled:opacity-50"
            }
            onClick={() => void handleOrderAction(record, "complete")}
            disabled={actionBusyId === record.id}
          >
            {actionBusyId === record.id ? (
              <span className="text-xs font-semibold tracking-[0.18em]">...</span>
            ) : (
              <span className="inline-flex items-center justify-center">
                <ActionCheckIcon />
              </span>
            )}
          </button>
        ) : record.status === "completed" ? (
          <button
            type="button"
            className={
              darkMode
                ? "rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            }
            onClick={() => void handleOrderAction(record, "uncomplete")}
            disabled={actionBusyId === record.id}
          >
            取消完成
          </button>
        ) : null}
        {record.status !== "cancelled" ? (
          <button
            type="button"
            className={
              darkMode
                ? "rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            }
            onClick={() => void handleOrderAction(record, "cancel")}
            disabled={actionBusyId === record.id}
          >
            取消
          </button>
        ) : null}
      </>
    ),
    [actionBusyId, darkMode, handleOrderAction],
  );

  const detailOverlay = detailOrder ? (
    <div
      className="fixed inset-0 z-[2147483000] flex items-start justify-center overflow-hidden overscroll-none bg-black/55 px-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-4"
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) closeDetailDialog();
      }}
    >
      <div className={`mx-auto ${detailPanelClassName}`}>
        <div className={`flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4 ${darkMode ? "border-white/10" : "border-slate-200"}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(detailOrder.status, darkMode)}`}>
                {getStatusText(detailOrder.status)}
              </span>
              <button
                type="button"
                className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm font-semibold transition ${
                  darkMode
                    ? "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                    : "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                }`}
                onClick={() => setMobileCustomerInfoOpen((current) => !current)}
              >
                <span className="truncate">{detailOrder.customer.name || "未命名客户"}</span>
                <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  {mobileCustomerInfoOpen ? "收起" : "客户信息"}
                </span>
              </button>
            </div>
            <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
              <span>{`订单号: ${detailOrder.id}`}</span>
              <span>{`下单时间: ${formatDateTime(detailOrder.createdAt)}`}</span>
            </div>
            {mobileCustomerInfoOpen ? (
              <div
                className={`mt-3 rounded-[22px] border px-4 py-4 ${
                  darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className={`grid gap-3 text-sm ${darkMode ? "text-slate-200" : "text-slate-600"}`}>
                  <div>
                    <span className={darkMode ? "text-slate-400" : "text-slate-400"}>姓名：</span>
                    {detailOrder.customer.name || "-"}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={darkMode ? "text-slate-400" : "text-slate-400"}>邮箱：</span>
                    <span className="min-w-0 flex-1 break-all">{detailOrder.customer.email || "-"}</span>
                    {detailOrder.customer.email ? (
                      <a
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                        href={`mailto:${detailOrder.customer.email}`}
                        onClick={() => {
                          void markOrderTouched(detailOrder.id);
                        }}
                        title="发送邮件"
                        aria-label="发送邮件"
                      >
                        <MailIcon />
                      </a>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={darkMode ? "text-slate-400" : "text-slate-400"}>电话：</span>
                    <span className="min-w-0 flex-1 break-all">{detailOrder.customer.phone || "-"}</span>
                    {detailOrder.customer.phone ? (
                      <a
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                        href={`tel:${detailOrder.customer.phone}`}
                        onClick={() => {
                          void markOrderTouched(detailOrder.id);
                        }}
                        title="拨打电话"
                        aria-label="拨打电话"
                      >
                        <PhoneIcon />
                      </a>
                    ) : null}
                  </div>
                  {detailOrder.customer.note ? (
                    <div className="grid gap-1">
                      <span className={darkMode ? "text-slate-400" : "text-slate-400"}>备注：</span>
                      <div
                        className={`max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-xl px-3 py-2 ${
                          darkMode ? "border border-white/10 bg-white/5 text-slate-100" : "border border-slate-200 bg-white text-slate-700"
                        }`}
                      >
                        {detailOrder.customer.note}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`rounded-full px-3 py-2 text-sm font-medium ${darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            onClick={closeDetailDialog}
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4">
          <div className="space-y-3">
            <div className={`flex max-h-[min(42vh,24rem)] min-h-[14rem] flex-col rounded-[24px] border px-4 py-4 ${darkMode ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}>
              <div className={`text-sm font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>商品明细</div>
              <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
                {detailPreviewEntries.length === 0 ? (
                  <div
                    className={`flex min-h-28 items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-center text-sm ${
                      darkMode ? "border-white/10 bg-white/5 text-slate-300" : "border-slate-300 bg-white text-slate-500"
                    }`}
                  >
                    该订单当前没有商品。
                  </div>
                ) : null}
                {detailPreviewEntries.map(({ item, index, quantity, subtotal }) => {
                  const itemDraftKey = getDetailItemDraftKey(detailOrder.id, index);
                  const draftQuantity = detailQuantityDrafts[itemDraftKey] ?? String(quantity);
                  const isDetailActionBusy = actionBusyId === detailOrder.id;
                  return (
                    <div
                      key={`${detailOrder.id}-${item.productId}-${item.code}-${index}`}
                      className={`rounded-2xl border px-3 py-3 text-sm ${
                        darkMode ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          {item.code ? (
                            <div className={`text-xs uppercase tracking-[0.18em] ${darkMode ? "text-slate-400" : "text-slate-400"}`}>
                              {item.code}
                            </div>
                          ) : null}
                          <div className="font-semibold">{item.name || "未命名产品"}</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <div className="font-semibold text-sky-500">
                            {formatMerchantOrderAmount(subtotal, detailOrder.pricePrefix)}
                          </div>
                          <div
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-1 shadow-sm ${
                              darkMode ? "border border-white/10 bg-white/5" : "border border-slate-200 bg-slate-50"
                            }`}
                          >
                            <button
                              type="button"
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                darkMode ? "border border-white/10 bg-slate-950/60 text-white hover:bg-slate-900" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              onClick={() => stepDetailItemQuantity(detailOrder, index, -1)}
                              disabled={isDetailActionBusy}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              className={`h-8 w-14 rounded-full border px-2 text-center text-sm font-semibold outline-none transition disabled:cursor-not-allowed ${
                                darkMode
                                  ? "border-white/10 bg-slate-950/60 text-white focus:border-white/20 focus:bg-slate-950"
                                  : "border-slate-200 bg-white text-slate-900 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                              }`}
                              value={draftQuantity}
                              onChange={(event) => handleDetailQuantityDraftChange(detailOrder.id, index, event.target.value)}
                              onBlur={(event) => {
                                normalizeDetailItemQuantityDraft(detailOrder, index, event.target.value);
                              }}
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                normalizeDetailItemQuantityDraft(detailOrder, index, event.currentTarget.value);
                                event.currentTarget.blur();
                              }}
                              disabled={isDetailActionBusy}
                            />
                            <button
                              type="button"
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                darkMode ? "border border-white/10 bg-slate-950/60 text-white hover:bg-slate-900" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                              onClick={() => stepDetailItemQuantity(detailOrder, index, 1)}
                              disabled={isDetailActionBusy}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-500"}`}>合计 {detailPreviewTotalQuantity} 件</div>
              <div className={`text-lg font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                {formatMerchantOrderAmount(detailPreviewTotalAmount, detailOrder.pricePrefix)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {detailOrder.status === "confirmed" ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"
                  }`}
                  onClick={() => void handleOrderAction(detailOrder, "restore")}
                  disabled={actionBusyId === detailOrder.id}
                >
                  取消确认
                </button>
              ) : detailOrder.status === "cancelled" ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"
                  }`}
                  onClick={() => void handleOrderAction(detailOrder, "restore")}
                  disabled={actionBusyId === detailOrder.id}
                >
                  恢复待确认
                </button>
              ) : (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode
                      ? "border border-sky-400/30 bg-sky-400/10 text-sky-100"
                      : "border border-sky-300 bg-sky-100 text-sky-800"
                  } disabled:opacity-40`}
                  onClick={() => void handleOrderAction(detailOrder, "confirm", { persistDetailDraft: true })}
                  disabled={actionBusyId === detailOrder.id}
                >
                  确认
                </button>
              )}
              {detailOrder.status === "confirmed" ? (
                <button
                  type="button"
                  className={`inline-flex h-[38px] min-w-[54px] items-center justify-center rounded-[14px] px-3 text-sm font-semibold ${
                    darkMode
                      ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-100 shadow-[0_10px_24px_rgba(16,185,129,0.18)]"
                      : "border border-emerald-200 bg-[linear-gradient(180deg,#ffffff_0%,#ecfdf5_100%)] text-emerald-700 shadow-[0_10px_24px_rgba(16,185,129,0.13)]"
                  } disabled:opacity-40`}
                  onClick={() => void handleOrderAction(detailOrder, "complete", { persistDetailDraft: true })}
                  disabled={actionBusyId === detailOrder.id}
                >
                  {actionBusyId === detailOrder.id ? (
                    <span className="text-xs font-semibold tracking-[0.18em]">...</span>
                  ) : (
                    <span className="inline-flex items-center justify-center">
                      <ActionCheckIcon />
                    </span>
                  )}
                </button>
              ) : detailOrder.status === "completed" ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"
                  }`}
                  onClick={() => void handleOrderAction(detailOrder, "uncomplete")}
                  disabled={actionBusyId === detailOrder.id}
                >
                  取消完成
                </button>
              ) : null}
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  darkMode ? "bg-white/10 text-white" : "border border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => void handleOrderAction(detailOrder, "print")}
                disabled={actionBusyId === detailOrder.id}
              >
                打印
              </button>
              {detailOrder.status !== "cancelled" ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"
                  } disabled:opacity-40`}
                  onClick={() => void handleOrderAction(detailOrder, "cancel")}
                  disabled={actionBusyId === detailOrder.id}
                >
                  取消
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const workbenchDialog = workbenchOpen ? (
    <div
      className="fixed inset-0 z-[2147482940] flex items-center justify-center bg-black/45 px-4"
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) setWorkbenchOpen(false);
      }}
    >
      <div className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="text-base font-semibold text-slate-900">订单工作台</div>
        <div className="mt-2 text-sm leading-6 text-slate-500">这里先保留入口，工作台内功能下一步继续做。</div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setWorkbenchOpen(false)}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="space-y-4 pb-4">
        <div className="sr-only">{siteName}</div>
        <div className={toolbarClassName}>
          <div className="relative">
            <div className="flex items-center gap-2.5">
              {onSectionChange ? (
                <div
                  className={`inline-flex shrink-0 items-center rounded-[20px] p-1 shadow-sm ${
                    darkMode ? "border border-white/10 bg-white/5" : "border border-slate-200 bg-white"
                  }`}
                >
                  <button
                    type="button"
                    className={`rounded-[16px] px-3.5 py-2 text-[12px] font-semibold transition ${
                      darkMode ? "text-slate-300 hover:bg-white/5" : "text-slate-500 hover:bg-slate-100"
                    }`}
                    onClick={() => onSectionChange("booking")}
                  >
                    预约
                  </button>
                  <button
                    type="button"
                    className="rounded-[16px] bg-slate-900 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm"
                    onClick={() => onSectionChange("orders")}
                  >
                    订单
                  </button>
                </div>
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-[12px] font-semibold text-white shadow-sm">
                  订单
                </div>
              )}
              <div
                className={`flex min-h-[41px] min-w-0 flex-1 items-center gap-2.5 rounded-[20px] border px-3.5 py-2 shadow-sm ${
                  darkMode ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-[#f3f4f6] text-slate-900"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-slate-400" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
                  <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索订单号 / 客户 / 产品"
                  className={`min-w-0 flex-1 bg-transparent text-[14px] leading-5 outline-none ${
                    darkMode ? "text-white placeholder:text-slate-400" : "text-slate-900 placeholder:text-slate-400"
                  }`}
                />
              </div>
              <div ref={overflowMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  className={overflowMenuButtonClassName}
                  onClick={() => setOverflowMenuOpen((current) => !current)}
                  aria-label="更多操作"
                  aria-expanded={overflowMenuOpen}
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
                {overflowMenuOpen ? (
                  <div className={overflowMenuPanelClassName}>
                    <div className="space-y-3">
                      <button
                        type="button"
                        className={overflowMenuPrimaryButtonClassName}
                        onClick={() => {
                          setOverflowMenuOpen(false);
                          setWorkbenchOpen(true);
                        }}
                      >
                        工作台
                      </button>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2.5">
                          <span className={`shrink-0 text-[12px] font-medium ${filterSelectLabelClassName}`}>排序</span>
                          <div className={`relative min-w-0 flex-1 ${filterSelectShellClassName}`}>
                            <select
                              className="w-full min-w-0 appearance-none bg-transparent pr-6 text-[13px] font-medium outline-none"
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
                              className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${filterSelectIconClassName}`}
                            >
                              <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </label>
                        <label className="flex items-center gap-2.5">
                          <span className={`shrink-0 text-[12px] font-medium ${filterSelectLabelClassName}`}>隐藏</span>
                          <div className={`relative min-w-0 flex-1 ${filterSelectShellClassName}`}>
                            <select
                              className="w-full min-w-0 appearance-none bg-transparent pr-6 text-[13px] font-medium outline-none"
                              value={historyVisibility}
                              onChange={(event) => setHistoryVisibility(event.target.value as MerchantOrderHistoryVisibility)}
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
                              className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${filterSelectIconClassName}`}
                            >
                              <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "confirmed", "completed", "cancelled"] as MerchantOrderFilter[]).map((key) => (
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

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className={emptyPanelClassName}>正在读取订单...</div>
        ) : filteredRecords.length > 0 ? (
          filteredRecords.map((record) => {
            const displayName = record.customer.name || "未命名客户";
            const isNewRecord = isMerchantOrderPendingMerchantTouch(record);
            return (
              <div key={record.id} className={`${cardClassName} relative overflow-visible`}>
                {isNewRecord ? (
                  <span className="absolute left-4 top-0 z-10 inline-flex -translate-y-1/2 items-center rounded-[14px] border border-white/70 bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(16,185,129,0.24)]">
                    NEW
                  </span>
                ) : null}

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(record.status, darkMode)}`}>
                        {getStatusText(record.status)}
                      </span>
                      <div className={`truncate text-base font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>{displayName}</div>
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs ${darkMode ? "text-slate-300" : "text-slate-500"}`}>
                      <span>{`订单号: ${record.id}`}</span>
                      <span>{`下单时间: ${formatDateTime(record.createdAt)}`}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className={`text-right text-lg font-semibold ${darkMode ? "text-white" : "text-slate-900"}`}>
                      {formatMerchantOrderAmount(record.totalAmount, record.pricePrefix)}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {record.customer.email ? (
                        <a
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                          href={`mailto:${record.customer.email}`}
                          onClick={() => {
                            void markOrderTouched(record.id);
                          }}
                          title="发送邮件"
                          aria-label="发送邮件"
                        >
                          <MailIcon />
                        </a>
                      ) : null}
                      {record.customer.phone ? (
                        <a
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                          href={`tel:${record.customer.phone}`}
                          onClick={() => {
                            void markOrderTouched(record.id);
                          }}
                          title="拨打电话"
                          aria-label="拨打电话"
                        >
                          <PhoneIcon />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {renderStatusActions(record)}
                  <button
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${
                      darkMode ? "bg-white/10 text-white" : "border border-slate-200 bg-white text-slate-700"
                    }`}
                    onClick={() => openDetailDialog(record)}
                  >
                    详情
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className={emptyPanelClassName}>还没有匹配到订单。</div>
        )}
      </div>
      {workbenchDialog}
      {detailOverlay}
    </>
  );
}
