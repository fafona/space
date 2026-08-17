"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { showGlobalToast } from "@/lib/globalToast";
import OrderWorkbenchPanel from "@/components/admin/OrderWorkbenchPanel";
import {
  formatMerchantOrderAmount,
  isMerchantOrderPendingMerchantTouch,
  type MerchantOrderAction,
  type MerchantOrderLineItemInput,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";
import {
  getMerchantOrderPrintAttemptText,
  prepareMerchantOrderPrintWindow,
  startMerchantOrderPrint,
} from "@/lib/merchantOrderPrint";
import {
  buildMerchantAdminDataCacheKey,
  readMerchantAdminDataCache,
  writeMerchantAdminDataCache,
} from "@/lib/merchantAdminDataCache";
import type { MerchantOrderSourceDetailIntent } from "@/lib/merchantOrderEnterprise";
import { MOBILE_SWIPE_BACK_EVENT } from "@/lib/mobileSwipeBack";

type MerchantOrderMobilePanelProps = {
  siteId: string;
  siteName: string;
  darkMode?: boolean;
  onOrdersChange?: (records: MerchantOrderRecord[]) => void;
  onOpenConversation?: (target: { accountId?: string; email?: string; name?: string }) => void;
  onOpenEnterpriseTask?: (order: MerchantOrderRecord) => void;
  sourceOrderIntent?: MerchantOrderSourceDetailIntent | null;
  onSourceOrderIntentHandled?: (requestId: string) => void;
  onSectionChange?: (section: "booking" | "orders") => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
};

type MerchantOrderFilter = "all" | MerchantOrderStatus;
type MerchantOrderSortMode = "created_desc" | "created_asc";
type MerchantOrderHistoryVisibility = "none" | "today" | "3d" | "7d";

type MerchantOrderSiteRequestContext = {
  siteId: string;
  generation: number;
};

type MerchantOrderSiteRequest = MerchantOrderSiteRequestContext & {
  controller: AbortController;
};

const MERCHANT_ORDER_SORT_OPTIONS: MerchantOrderSortMode[] = ["created_desc", "created_asc"];
const MERCHANT_ORDER_HISTORY_OPTIONS: MerchantOrderHistoryVisibility[] = ["none", "today", "3d", "7d"];
const MERCHANT_ORDER_FETCH_LIMIT = 500;
const MERCHANT_ORDER_MOBILE_RENDER_LIMIT = 100;

function createAbortedOrderRequestError() {
  const error = new Error("order_request_aborted");
  error.name = "AbortError";
  return error;
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

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.25 5.75A1.75 1.75 0 0 1 6 4h8a1.75 1.75 0 0 1 1.75 1.75v5.5A1.75 1.75 0 0 1 14 13H9.15l-3.4 2.6V13.4A1.75 1.75 0 0 1 4.25 11.75v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function readCachedOrderRecords(siteId: string) {
  const cached = readMerchantAdminDataCache<MerchantOrderRecord[]>(
    buildMerchantAdminDataCacheKey("orders", siteId),
  );
  return Array.isArray(cached) ? cached : [];
}

function writeCachedOrderRecords(siteId: string, records: MerchantOrderRecord[]) {
  writeMerchantAdminDataCache(buildMerchantAdminDataCacheKey("orders", siteId), records);
}

export default function MerchantOrderMobilePanel({
  siteId,
  siteName,
  darkMode = false,
  onOrdersChange,
  onOpenConversation,
  onOpenEnterpriseTask,
  sourceOrderIntent = null,
  onSourceOrderIntentHandled,
  onSectionChange,
  registerLeaveGuard,
}: MerchantOrderMobilePanelProps) {
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<MerchantOrderRecord[]>(() => readCachedOrderRecords(siteId));
  const [loading, setLoading] = useState(false);
  const [loadingMoreRecords, setLoadingMoreRecords] = useState(false);
  const [hasMoreRemoteRecords, setHasMoreRemoteRecords] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [renderLimit, setRenderLimit] = useState(MERCHANT_ORDER_MOBILE_RENDER_LIMIT);
  const [filter, setFilter] = useState<MerchantOrderFilter>("all");
  const [sortMode, setSortMode] = useState<MerchantOrderSortMode>("created_desc");
  const [historyVisibility, setHistoryVisibility] = useState<MerchantOrderHistoryVisibility>("none");
  const managerBusyRef = useRef(false);
  const [busyKey, setBusyKeyState] = useState("");
  const setBusyKey = useCallback((nextBusyKey: string) => {
    managerBusyRef.current = Boolean(nextBusyKey);
    setBusyKeyState(nextBusyKey);
  }, []);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [externalDetailOrder, setExternalDetailOrder] = useState<MerchantOrderRecord | null>(null);
  const [detailQuantityDrafts, setDetailQuantityDrafts] = useState<Record<string, string>>({});
  const [detailDraftConflict, setDetailDraftConflict] = useState("");
  const detailDraftBaseOrderRef = useRef<MerchantOrderRecord | null>(null);
  const [mobileCustomerInfoOpen, setMobileCustomerInfoOpen] = useState(false);
  const handledSourceOrderIntentRef = useRef("");
  const workbenchLeaveGuardRef = useRef<(() => boolean) | null>(null);
  const detailLeaveGuardRef = useRef<(() => boolean) | null>(null);
  const detailDialogRef = useRef<HTMLDivElement | null>(null);
  const detailCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailPreviouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const detailDialogTitleId = useId();
  const siteRequestIdentityRef = useRef<MerchantOrderSiteRequestContext>({ siteId, generation: 0 });
  if (siteRequestIdentityRef.current.siteId !== siteId) {
    siteRequestIdentityRef.current = {
      siteId,
      generation: siteRequestIdentityRef.current.generation + 1,
    };
  }
  const activeRequestControllersRef = useRef(new Set<AbortController>());
  const listRequestSequenceRef = useRef(0);
  const nextOrderOffsetRef = useRef(0);
  const detailRequestSequenceRef = useRef(0);
  const captureSiteRequestContext = useCallback(
    (): MerchantOrderSiteRequestContext => ({ ...siteRequestIdentityRef.current }),
    [],
  );
  const isSiteRequestCurrent = useCallback((request: MerchantOrderSiteRequestContext) => {
    const current = siteRequestIdentityRef.current;
    return current.siteId === request.siteId && current.generation === request.generation;
  }, []);
  const beginSiteRequest = useCallback((requestSiteId: string): MerchantOrderSiteRequest | null => {
    const current = siteRequestIdentityRef.current;
    if (!requestSiteId || current.siteId !== requestSiteId) return null;
    const controller = new AbortController();
    activeRequestControllersRef.current.add(controller);
    return { siteId: requestSiteId, generation: current.generation, controller };
  }, []);
  const finishSiteRequest = useCallback((request: MerchantOrderSiteRequest | null) => {
    if (request) activeRequestControllersRef.current.delete(request.controller);
  }, []);
  const confirmManagerBusyLeave = useCallback(() => {
    if (!managerBusyRef.current) return true;
    setError("订单操作正在进行，请等待完成后再离开订单管理。");
    return false;
  }, []);
  const getActiveLeaveGuard = useCallback(
    () => detailLeaveGuardRef.current ?? workbenchLeaveGuardRef.current ?? confirmManagerBusyLeave,
    [confirmManagerBusyLeave],
  );
  const publishActiveLeaveGuard = useCallback(() => {
    registerLeaveGuard?.(getActiveLeaveGuard());
  }, [getActiveLeaveGuard, registerLeaveGuard]);
  const handleRegisterWorkbenchLeaveGuard = useCallback(
    (guard: (() => boolean) | null) => {
      workbenchLeaveGuardRef.current = guard;
      publishActiveLeaveGuard();
    },
    [publishActiveLeaveGuard],
  );
  const handleRegisterDetailLeaveGuard = useCallback(
    (guard: (() => boolean) | null) => {
      detailLeaveGuardRef.current = guard;
      publishActiveLeaveGuard();
    },
    [publishActiveLeaveGuard],
  );
  useEffect(() => {
    publishActiveLeaveGuard();
    return () => registerLeaveGuard?.(null);
  }, [publishActiveLeaveGuard, registerLeaveGuard]);
  const currentSiteRecords = useMemo(
    () => records.filter((record) => record.siteId === siteId),
    [records, siteId],
  );

  const cardClassName = darkMode
    ? "rounded-[26px] border border-white/10 bg-[rgba(15,23,42,0.84)] p-4 shadow-[0_20px_44px_rgba(2,6,23,0.28)]"
    : "rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_36px_rgba(15,23,42,0.08)]";
  const emptyPanelClassName = darkMode
    ? "rounded-[28px] border border-white/10 bg-[rgba(15,23,42,0.84)] px-5 py-8 text-center text-sm text-slate-300 shadow-[0_22px_50px_rgba(2,6,23,0.32)]"
    : "rounded-[28px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_22px_50px_rgba(15,23,42,0.08)]";
  const toolbarClassName = `sticky top-0 z-20 -mx-4 space-y-2.5 border-b border-slate-200/80 px-4 pb-3 pt-[calc(var(--faolla-mobile-safe-top)+0.25rem)] shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur ${
    darkMode
      ? "bg-[rgba(15,23,42,0.96)] supports-[backdrop-filter]:bg-[rgba(15,23,42,0.9)]"
      : "bg-[rgba(248,250,252,0.96)] supports-[backdrop-filter]:bg-[rgba(248,250,252,0.9)]"
  }`;
  const filterSelectShellClassName = darkMode
    ? "faolla-mobile-filter-select rounded-[16px] border border-slate-700 bg-slate-900/75 py-1.5 pl-4 pr-9 text-slate-100 shadow-sm"
    : "faolla-mobile-filter-select rounded-[16px] border border-slate-200 bg-white py-1.5 pl-4 pr-9 text-slate-900 shadow-sm";
  const filterSelectLabelClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const filterSelectIconClassName = darkMode ? "text-slate-500" : "text-slate-400";
  const overflowMenuButtonClassName = overflowMenuOpen
    ? darkMode
      ? "faolla-mobile-business-menu-button relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border border-amber-300/40 bg-amber-200/10 text-amber-100 shadow-sm"
      : "faolla-mobile-business-menu-button relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border border-slate-300 bg-slate-900 text-white shadow-sm"
    : darkMode
      ? "faolla-mobile-business-menu-button relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/5 text-slate-100 shadow-sm transition hover:bg-white/10"
      : "faolla-mobile-business-menu-button relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50";
  const overflowMenuPanelClassName = darkMode
    ? "absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(18rem,calc(100vw-2rem))] rounded-[24px] border border-white/10 bg-[rgba(15,23,42,0.98)] p-3 shadow-[0_24px_60px_rgba(2,6,23,0.4)]"
    : "absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(18rem,calc(100vw-2rem))] rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.18)]";
  const overflowMenuPrimaryButtonClassName = darkMode
    ? "w-full rounded-[18px] border border-amber-300/30 bg-amber-200/10 px-3.5 py-3 text-left text-[13px] font-semibold text-amber-100 shadow-sm transition hover:bg-amber-200/15"
    : "w-full rounded-[18px] border border-[#d8c7a5] bg-[linear-gradient(135deg,#fffdfa_0%,#f6efe1_62%,#ecdfc2_100%)] px-3.5 py-3 text-left text-[13px] font-semibold text-slate-800 shadow-sm transition hover:brightness-[0.99]";
  const detailPanelClassName = darkMode
    ? "flex w-full max-w-lg max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[rgba(15,23,42,0.98)] shadow-[0_32px_80px_rgba(2,6,23,0.52)]"
    : "flex w-full max-w-lg max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_72px_rgba(15,23,42,0.2)]";

  useEffect(() => {
    const activeRequestControllers = activeRequestControllersRef.current;
    return () => {
      activeRequestControllers.forEach((controller) => controller.abort());
      activeRequestControllers.clear();
      listRequestSequenceRef.current += 1;
      detailRequestSequenceRef.current += 1;
    };
  }, [siteId]);

  const loadOrders = useCallback(async () => {
    if (!siteId) return;
    const request = beginSiteRequest(siteId);
    if (!request) return;
    const requestSequence = listRequestSequenceRef.current + 1;
    listRequestSequenceRef.current = requestSequence;
    const cachedRecords = readCachedOrderRecords(siteId).filter((record) => record.siteId === siteId);
    if (cachedRecords.length > 0) {
      setRecords(cachedRecords);
      setLoading(false);
    } else {
      setRecords([]);
      setLoading(true);
    }
    setError("");
    try {
      const response = await fetch(
        `/api/orders?siteId=${encodeURIComponent(siteId)}&offset=0&limit=${MERCHANT_ORDER_FETCH_LIMIT}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.controller.signal,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { orders?: MerchantOrderRecord[]; hasMore?: boolean; offset?: number; message?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "order_list_failed");
      }
      const nextRecords = Array.isArray(payload?.orders) ? payload.orders : [];
      if (nextRecords.some((record) => record.siteId !== request.siteId)) {
        throw new Error("订单列表返回了其他商户数据，请刷新后重试。");
      }
      if (
        request.controller.signal.aborted ||
        !isSiteRequestCurrent(request) ||
        listRequestSequenceRef.current !== requestSequence
      ) return;
      const responseOffset =
        typeof payload?.offset === "number" && Number.isFinite(payload.offset)
          ? Math.max(0, Math.trunc(payload.offset))
          : 0;
      nextOrderOffsetRef.current = responseOffset + nextRecords.length;
      setHasMoreRemoteRecords(Boolean(payload?.hasMore));
      writeCachedOrderRecords(request.siteId, nextRecords);
      setRecords(nextRecords);
      setExternalDetailOrder((current) =>
        current?.siteId === request.siteId
          ? nextRecords.find((record) => record.id === current.id) ?? current
          : null,
      );
    } catch (nextError) {
      if (
        request.controller.signal.aborted ||
        !isSiteRequestCurrent(request) ||
        listRequestSequenceRef.current !== requestSequence
      ) return;
      setHasMoreRemoteRecords(false);
      setError(cachedRecords.length > 0 ? "" : nextError instanceof Error && nextError.message ? nextError.message : "订单读取失败");
    } finally {
      finishSiteRequest(request);
      if (isSiteRequestCurrent(request) && listRequestSequenceRef.current === requestSequence) {
        setLoading(false);
      }
    }
  }, [beginSiteRequest, finishSiteRequest, isSiteRequestCurrent, siteId]);

  const loadMoreOrders = useCallback(async () => {
    if (!siteId || loading || loadingMoreRecords || !hasMoreRemoteRecords) return;
    const request = beginSiteRequest(siteId);
    if (!request) return;
    const requestSequence = listRequestSequenceRef.current + 1;
    listRequestSequenceRef.current = requestSequence;
    const requestOffset = nextOrderOffsetRef.current;
    setLoadingMoreRecords(true);
    setError("");
    try {
      const response = await fetch(
        `/api/orders?siteId=${encodeURIComponent(siteId)}&offset=${requestOffset}&limit=${MERCHANT_ORDER_FETCH_LIMIT}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.controller.signal,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { orders?: MerchantOrderRecord[]; hasMore?: boolean; offset?: number; message?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || "order_list_failed");
      }
      const nextRecords = Array.isArray(payload?.orders) ? payload.orders : [];
      if (nextRecords.some((record) => record.siteId !== request.siteId)) {
        throw new Error("订单列表返回了其他商户数据，请刷新后重试。");
      }
      if (
        request.controller.signal.aborted ||
        !isSiteRequestCurrent(request) ||
        listRequestSequenceRef.current !== requestSequence
      ) return;
      const responseOffset =
        typeof payload?.offset === "number" && Number.isFinite(payload.offset)
          ? Math.max(0, Math.trunc(payload.offset))
          : requestOffset;
      nextOrderOffsetRef.current = responseOffset + nextRecords.length;
      setHasMoreRemoteRecords(Boolean(payload?.hasMore));
      setExternalDetailOrder((current) =>
        current?.siteId === request.siteId
          ? nextRecords.find((record) => record.id === current.id) ?? current
          : null,
      );
      setRecords((current) => {
        if (!isSiteRequestCurrent(request) || listRequestSequenceRef.current !== requestSequence) return current;
        const currentSiteRecords = current.filter((record) => record.siteId === request.siteId);
        const existingIds = new Set(currentSiteRecords.map((record) => record.id));
        const mergedRecords = [...currentSiteRecords, ...nextRecords.filter((record) => !existingIds.has(record.id))];
        writeCachedOrderRecords(request.siteId, mergedRecords);
        return mergedRecords;
      });
    } catch (nextError) {
      if (
        request.controller.signal.aborted ||
        !isSiteRequestCurrent(request) ||
        listRequestSequenceRef.current !== requestSequence
      ) return;
      setError(nextError instanceof Error && nextError.message ? nextError.message : "order_list_failed");
    } finally {
      finishSiteRequest(request);
      if (isSiteRequestCurrent(request) && listRequestSequenceRef.current === requestSequence) {
        setLoadingMoreRecords(false);
      }
    }
  }, [
    beginSiteRequest,
    finishSiteRequest,
    hasMoreRemoteRecords,
    isSiteRequestCurrent,
    loading,
    loadingMoreRecords,
    siteId,
  ]);

  useEffect(() => {
    handledSourceOrderIntentRef.current = "";
    setExternalDetailOrder(null);
    setDetailOrderId("");
    setBusyKey("");
    setLoadingMoreRecords(false);
    setHasMoreRemoteRecords(false);
    nextOrderOffsetRef.current = 0;
  }, [setBusyKey, siteId]);

  useEffect(() => {
    if (!sourceOrderIntent || sourceOrderIntent.siteId !== siteId) return;
    if (handledSourceOrderIntentRef.current === sourceOrderIntent.requestId) return;
    handledSourceOrderIntentRef.current = sourceOrderIntent.requestId;
    const sourceOrder = sourceOrderIntent.order;
    if (
      sourceOrderIntent.orderId !== sourceOrder.id ||
      sourceOrder.siteId !== siteId
    ) {
      setError("来源订单信息无效，请返回企业任务后重试。");
      onSourceOrderIntentHandled?.(sourceOrderIntent.requestId);
      return;
    }
    setExternalDetailOrder(sourceOrder);
    setDetailOrderId(sourceOrder.id);
    setMobileCustomerInfoOpen(false);
    setWorkbenchOpen(false);
    onSourceOrderIntentHandled?.(sourceOrderIntent.requestId);
  }, [onSourceOrderIntentHandled, siteId, sourceOrderIntent]);

  useEffect(() => {
    if (!siteId) return;
    void loadOrders();
  }, [loadOrders, siteId]);

  useEffect(() => {
    onOrdersChange?.(currentSiteRecords);
  }, [currentSiteRecords, onOrdersChange]);

  useEffect(() => {
    if (!error) return;
    showGlobalToast(error, { tone: "error" });
    const timer = window.setTimeout(() => setError(""), 3000);
    return () => window.clearTimeout(timer);
  }, [error]);

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
    () => filterMerchantOrdersByHistory(currentSiteRecords, historyVisibility),
    [currentSiteRecords, historyVisibility],
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

  useEffect(() => {
    setRenderLimit(MERCHANT_ORDER_MOBILE_RENDER_LIMIT);
  }, [filter, historyVisibility, search, sortMode]);

  const renderedRecords = useMemo(
    () => filteredRecords.slice(0, renderLimit),
    [filteredRecords, renderLimit],
  );

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
    () =>
      detailOrderId
        ? externalDetailOrder?.id === detailOrderId && externalDetailOrder.siteId === siteId
          ? externalDetailOrder
          : currentSiteRecords.find((record) => record.id === detailOrderId) ?? null
        : null,
    [currentSiteRecords, detailOrderId, externalDetailOrder, siteId],
  );

  useEffect(() => {
    setMobileCustomerInfoOpen(false);
  }, [detailOrder?.id]);

  const requestOrderAction = useCallback(
    async (order: MerchantOrderRecord, action: MerchantOrderAction) => {
      const request = beginSiteRequest(siteId);
      if (!request || order.siteId !== request.siteId) throw createAbortedOrderRequestError();
      try {
        const response = await fetch("/api/orders", {
          method: "PATCH",
          keepalive: action === "touch",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: request.siteId,
            orderId: order.id,
            action,
            ...(action === "print" ? { expectedUpdatedAt: order.updatedAt } : {}),
          }),
          signal: request.controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | { order?: MerchantOrderRecord; message?: string; error?: string }
          | null;
        if (request.controller.signal.aborted || !isSiteRequestCurrent(request)) {
          throw createAbortedOrderRequestError();
        }
        if (!response.ok || !payload?.order) {
          throw new Error(payload?.message || payload?.error || "订单保存失败，请稍后重试。");
        }
        if (payload.order.siteId !== request.siteId || payload.order.id !== order.id) {
          throw new Error("订单保存返回了其他商户数据，请刷新后重试。");
        }
        return payload.order;
      } finally {
        finishSiteRequest(request);
      }
    },
    [beginSiteRequest, finishSiteRequest, isSiteRequestCurrent, siteId],
  );

  const requestOrderStatusUpdate = useCallback(
    async (
      order: MerchantOrderRecord,
      status: MerchantOrderStatus,
      items?: MerchantOrderLineItemInput[],
    ) => {
      const request = beginSiteRequest(siteId);
      if (!request || order.siteId !== request.siteId) throw createAbortedOrderRequestError();
      try {
        const response = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: request.siteId,
            orderId: order.id,
            status,
            expectedUpdatedAt: order.updatedAt,
            ...(items ? { items } : {}),
          }),
          signal: request.controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | { order?: MerchantOrderRecord; message?: string; error?: string }
          | null;
        if (request.controller.signal.aborted || !isSiteRequestCurrent(request)) {
          throw createAbortedOrderRequestError();
        }
        if (!response.ok || !payload?.order) {
          throw new Error(payload?.message || payload?.error || "订单保存失败，请稍后重试。");
        }
        if (payload.order.siteId !== request.siteId || payload.order.id !== order.id) {
          throw new Error("订单保存返回了其他商户数据，请刷新后重试。");
        }
        return payload.order;
      } finally {
        finishSiteRequest(request);
      }
    },
    [beginSiteRequest, finishSiteRequest, isSiteRequestCurrent, siteId],
  );

  const requestExactOrder = useCallback(
    async (orderId: string) => {
      const request = beginSiteRequest(siteId);
      if (!request) throw createAbortedOrderRequestError();
      try {
        const response = await fetch(
          `/api/orders?siteId=${encodeURIComponent(request.siteId)}&orderId=${encodeURIComponent(orderId)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.controller.signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | { order?: MerchantOrderRecord; message?: string; error?: string }
          | null;
        if (request.controller.signal.aborted || !isSiteRequestCurrent(request)) {
          throw createAbortedOrderRequestError();
        }
        if (!response.ok || !payload?.order) {
          throw new Error(payload?.message || payload?.error || "没有找到该订单，请刷新后重试。");
        }
        if (payload.order.siteId !== request.siteId || payload.order.id !== orderId) {
          throw new Error("订单详情返回了其他商户数据，请刷新后重试。");
        }
        return payload.order;
      } finally {
        finishSiteRequest(request);
      }
    },
    [beginSiteRequest, finishSiteRequest, isSiteRequestCurrent, siteId],
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

  const rebaseDetailQuantityDrafts = useCallback((order: MerchantOrderRecord | null) => {
    detailDraftBaseOrderRef.current = order;
    setDetailQuantityDrafts((current) => {
      if (!order) return Object.keys(current).length === 0 ? current : {};
      return Object.fromEntries(
        order.items.map((item, index) => [getDetailItemDraftKey(order.id, index), String(item.quantity)]),
      );
    });
    setDetailDraftConflict((current) => (current ? "" : current));
  }, []);

  useEffect(() => {
    if (!detailOrder) {
      rebaseDetailQuantityDrafts(null);
      return;
    }
    const baseOrder = detailDraftBaseOrderRef.current;
    if (
      !baseOrder ||
      baseOrder.siteId !== detailOrder.siteId ||
      baseOrder.id !== detailOrder.id
    ) {
      rebaseDetailQuantityDrafts(detailOrder);
      return;
    }
    const hasLocalChanges = hasDetailQuantityDraftChanges(baseOrder);
    if (!hasLocalChanges) {
      if (baseOrder.updatedAt !== detailOrder.updatedAt) rebaseDetailQuantityDrafts(detailOrder);
      return;
    }
    if (baseOrder.updatedAt !== detailOrder.updatedAt) {
      setDetailDraftConflict((current) =>
        current || "订单已在其他操作中更新。本地数量草稿已冻结；请放弃草稿并加载最新内容后重新修改。",
      );
    }
  }, [detailOrder, hasDetailQuantityDraftChanges, rebaseDetailQuantityDrafts]);

  const detailDraftComparisonOrder =
    detailOrder &&
    detailDraftBaseOrderRef.current?.siteId === detailOrder.siteId &&
    detailDraftBaseOrderRef.current.id === detailOrder.id
      ? detailDraftBaseOrderRef.current
      : detailOrder;
  const detailHasQuantityDraftChanges = detailDraftComparisonOrder
    ? hasDetailQuantityDraftChanges(detailDraftComparisonOrder)
    : false;
  const detailHasQuantityDraftChangesRef = useRef(false);
  const detailBusyRef = useRef(false);
  const detailDraftConflictRef = useRef("");
  detailHasQuantityDraftChangesRef.current = detailHasQuantityDraftChanges;
  detailBusyRef.current = Boolean(busyKey);
  detailDraftConflictRef.current = detailDraftConflict;

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
    async (orderId: string, fallbackOrder?: MerchantOrderRecord) => {
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId) return;
      const currentOrder =
        (fallbackOrder?.id === orderId && fallbackOrder.siteId === operation.siteId ? fallbackOrder : null) ??
        currentSiteRecords.find((item) => item.id === orderId);
      if (!currentOrder || !isMerchantOrderPendingMerchantTouch(currentOrder)) return;
      const touchedAt = new Date().toISOString();
      setRecords((current) =>
        isSiteRequestCurrent(operation)
          ? current.map((item) => (item.id === orderId ? { ...item, merchantTouchedAt: touchedAt } : item))
          : current,
      );
      try {
        const nextOrder = await requestOrderAction(currentOrder, "touch");
        if (!isSiteRequestCurrent(operation)) return;
        setRecords((current) =>
          isSiteRequestCurrent(operation)
            ? current.map((item) => (item.id === orderId ? nextOrder : item))
            : current,
        );
      } catch {
        if (!isSiteRequestCurrent(operation)) return;
        setRecords((current) =>
          isSiteRequestCurrent(operation)
            ? current.map((item) => (item.id === orderId ? currentOrder : item))
            : current,
        );
      }
    },
    [captureSiteRequestContext, currentSiteRecords, isSiteRequestCurrent, requestOrderAction, siteId],
  );

  const openListConversation = useCallback(
    async (orderId: string) => {
      if (!onOpenConversation || managerBusyRef.current) return;
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId) return;
      setBusyKey(`contact:${orderId}`);
      setError("");
      try {
        const order = await requestExactOrder(orderId);
        if (!isSiteRequestCurrent(operation)) return;
        if (!order.customerAccountId && !order.customerLoginEmail) {
          throw new Error("该订单客户未绑定账号或登录邮箱，暂时无法打开会话。");
        }
        await markOrderTouched(order.id, order);
        if (!isSiteRequestCurrent(operation)) return;
        setBusyKey("");
        onOpenConversation({
          accountId: order.customerAccountId,
          email: order.customerLoginEmail,
          name: order.customer.name,
        });
      } catch (nextError) {
        if (!isSiteRequestCurrent(operation)) return;
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单读取失败");
      } finally {
        if (isSiteRequestCurrent(operation)) setBusyKey("");
      }
    },
    [
      captureSiteRequestContext,
      isSiteRequestCurrent,
      markOrderTouched,
      onOpenConversation,
      requestExactOrder,
      setBusyKey,
      siteId,
    ],
  );

  const patchOrderStatus = useCallback(
    async (
      order: MerchantOrderRecord,
      status: MerchantOrderStatus,
      busyLabel: string,
      options: { persistDetailDraft?: boolean } = {},
    ) => {
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId || order.siteId !== operation.siteId) return;
      const targetsOpenDetail = detailOrderId === order.id;
      if (targetsOpenDetail && detailDraftConflictRef.current) {
        setError(detailDraftConflictRef.current);
        return;
      }
      const canPersistOpenDetailDraft =
        options.persistDetailDraft &&
        order.status !== "completed" &&
        order.status !== "cancelled" &&
        (status === "confirmed" || status === "completed");
      if (
        targetsOpenDetail &&
        detailHasQuantityDraftChangesRef.current &&
        !canPersistOpenDetailDraft
      ) {
        setError("商品数量有尚未保存的修改。请先用“确认”或“完成”保存数量，或关闭详情并确认放弃后再更改状态。");
        return;
      }
      setBusyKey(`${busyLabel}:${order.id}`);
      setError("");
      try {
        const draftItems =
          options.persistDetailDraft &&
          order.status !== "completed" &&
          order.status !== "cancelled" &&
          (status === "confirmed" || status === "completed") &&
          hasDetailQuantityDraftChanges(order)
            ? buildDetailDraftItemsInput(order)
            : undefined;
        const nextOrder = await requestOrderStatusUpdate(order, status, draftItems);
        if (!isSiteRequestCurrent(operation)) return;
        if (targetsOpenDetail && draftItems) rebaseDetailQuantityDrafts(nextOrder);
        setRecords((current) =>
          isSiteRequestCurrent(operation)
            ? current.map((item) => (item.id === order.id ? nextOrder : item))
            : current,
        );
        setExternalDetailOrder((current) =>
          isSiteRequestCurrent(operation) && current?.id === order.id ? nextOrder : current,
        );
      } catch (nextError) {
        if (!isSiteRequestCurrent(operation)) return;
        const message =
          nextError instanceof Error && nextError.message ? nextError.message : "订单保存失败，请稍后重试。";
        setError(`保存失败，修改未生效：${message}`);
      } finally {
        if (isSiteRequestCurrent(operation)) setBusyKey("");
      }
    },
    [
      buildDetailDraftItemsInput,
      captureSiteRequestContext,
      hasDetailQuantityDraftChanges,
      isSiteRequestCurrent,
      requestOrderStatusUpdate,
      detailOrderId,
      rebaseDetailQuantityDrafts,
      setBusyKey,
      siteId,
    ],
  );

  const printOrder = useCallback(
    async (order: MerchantOrderRecord) => {
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId || order.siteId !== operation.siteId) return;
      const preparedPrintWindow = prepareMerchantOrderPrintWindow();
      if (!preparedPrintWindow) {
        setError("浏览器阻止了打印窗口，请允许弹窗后重试。打印尝试未记录。");
        return;
      }
      setBusyKey(`print:${order.id}`);
      setError("");
      let printStarted = false;
      try {
        const latestOrder = await requestExactOrder(order.id);
        if (!isSiteRequestCurrent(operation)) {
          preparedPrintWindow.close();
          return;
        }
        if (latestOrder.updatedAt !== order.updatedAt) {
          setRecords((current) =>
            current.map((item) => (item.id === latestOrder.id ? latestOrder : item)),
          );
          setExternalDetailOrder((current) =>
            current?.id === latestOrder.id ? latestOrder : current,
          );
          preparedPrintWindow.close();
          throw new Error("订单内容已更新，已刷新当前详情，请核对后重新打印。");
        }
        if (!startMerchantOrderPrint(latestOrder, { formatDateTime }, preparedPrintWindow)) {
          throw new Error("浏览器阻止了打印窗口，请允许弹窗后重试。");
        }
        printStarted = true;
        const nextOrder = await requestOrderAction(latestOrder, "print");
        if (!isSiteRequestCurrent(operation)) return;
        setRecords((current) =>
          isSiteRequestCurrent(operation)
            ? current.map((item) => (item.id === order.id ? nextOrder : item))
            : current,
        );
        setExternalDetailOrder((current) =>
          isSiteRequestCurrent(operation) && current?.id === order.id ? nextOrder : current,
        );
      } catch (nextError) {
        if (!printStarted && !preparedPrintWindow.closed) preparedPrintWindow.close();
        if (!isSiteRequestCurrent(operation)) return;
        const message = nextError instanceof Error && nextError.message ? nextError.message : "订单操作失败";
        setError(printStarted ? `打印已发起，但打印尝试记录失败：${message}` : message);
      } finally {
        if (isSiteRequestCurrent(operation)) setBusyKey("");
      }
    },
    [
      captureSiteRequestContext,
      isSiteRequestCurrent,
      requestExactOrder,
      requestOrderAction,
      setBusyKey,
      siteId,
    ],
  );

  const openDetailDialog = useCallback(
    (order: MerchantOrderRecord) => {
      if (order.siteId !== siteId) return;
      detailRequestSequenceRef.current += 1;
      setExternalDetailOrder(null);
      setDetailOrderId(order.id);
    },
    [siteId],
  );

  const resolveWorkbenchActionOrder = useCallback(
    async (orderId: string) => requestExactOrder(orderId),
    [requestExactOrder],
  );

  const contactWorkbenchOrder = useCallback(
    async (orderId: string) => {
      if (!onOpenConversation) return;
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId) return;
      const order = await resolveWorkbenchActionOrder(orderId);
      if (!isSiteRequestCurrent(operation)) return;
      if (!order.customerAccountId && !order.customerLoginEmail) {
        throw new Error("该订单客户未绑定账号或登录邮箱，暂时无法打开会话。");
      }
      await markOrderTouched(order.id, order);
      if (!isSiteRequestCurrent(operation)) return;
      handleRegisterWorkbenchLeaveGuard(null);
      setWorkbenchOpen(false);
      onOpenConversation({
        accountId: order.customerAccountId,
        email: order.customerLoginEmail,
        name: order.customer.name,
      });
    },
    [
      captureSiteRequestContext,
      handleRegisterWorkbenchLeaveGuard,
      isSiteRequestCurrent,
      markOrderTouched,
      onOpenConversation,
      resolveWorkbenchActionOrder,
      siteId,
    ],
  );

  const openWorkbenchEnterpriseTask = useCallback(
    async (orderId: string) => {
      if (!onOpenEnterpriseTask) return;
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId) return;
      const order = await resolveWorkbenchActionOrder(orderId);
      if (!isSiteRequestCurrent(operation)) return;
      handleRegisterWorkbenchLeaveGuard(null);
      setWorkbenchOpen(false);
      onOpenEnterpriseTask(order);
    },
    [
      captureSiteRequestContext,
      handleRegisterWorkbenchLeaveGuard,
      isSiteRequestCurrent,
      onOpenEnterpriseTask,
      resolveWorkbenchActionOrder,
      siteId,
    ],
  );

  const openWorkbenchOrder = useCallback(
    async (orderId: string) => {
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId) return;
      const requestSequence = detailRequestSequenceRef.current + 1;
      detailRequestSequenceRef.current = requestSequence;
      setBusyKey(`detail:${orderId}`);
      setError("");
      try {
        const nextOrder = await requestExactOrder(orderId);
        if (
          !isSiteRequestCurrent(operation) ||
          detailRequestSequenceRef.current !== requestSequence
        ) return;
        handleRegisterWorkbenchLeaveGuard(null);
        setWorkbenchOpen(false);
        setExternalDetailOrder(nextOrder);
        setDetailOrderId(nextOrder.id);
      } catch (nextError) {
        if (
          !isSiteRequestCurrent(operation) ||
          detailRequestSequenceRef.current !== requestSequence
        ) return;
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单读取失败");
        throw nextError;
      } finally {
        if (
          isSiteRequestCurrent(operation) &&
          detailRequestSequenceRef.current === requestSequence
        ) setBusyKey("");
      }
    },
    [
      captureSiteRequestContext,
      handleRegisterWorkbenchLeaveGuard,
      isSiteRequestCurrent,
      requestExactOrder,
      setBusyKey,
      siteId,
    ],
  );

  const openWorkbenchStatus = useCallback((status: MerchantOrderStatus) => {
    setSearch("");
    setHistoryVisibility("none");
    setFilter(status);
    setWorkbenchOpen(false);
  }, []);

  const confirmDetailLeave = useCallback(() => {
    if (detailBusyRef.current) {
      setError("订单操作正在进行，请等待完成后再关闭详情。");
      return false;
    }
    if (
      detailHasQuantityDraftChangesRef.current &&
      typeof window !== "undefined" &&
      !window.confirm("商品数量有尚未保存的修改。关闭详情将放弃这些修改，仍要关闭吗？")
    ) return false;
    return true;
  }, []);

  const finalizeDetailClose = useCallback(() => {
    handleRegisterDetailLeaveGuard(null);
    rebaseDetailQuantityDrafts(null);
    detailRequestSequenceRef.current += 1;
    setDetailOrderId("");
    setExternalDetailOrder(null);
  }, [handleRegisterDetailLeaveGuard, rebaseDetailQuantityDrafts]);

  const closeDetailDialog = useCallback(() => {
    if (!confirmDetailLeave()) return false;
    finalizeDetailClose();
    return true;
  }, [confirmDetailLeave, finalizeDetailClose]);

  const discardDetailQuantityDrafts = useCallback(() => {
    if (!detailOrder || detailBusyRef.current) return false;
    if (
      detailHasQuantityDraftChangesRef.current &&
      typeof window !== "undefined" &&
      !window.confirm("确定放弃当前商品数量修改并加载最新订单内容吗？")
    ) return false;
    rebaseDetailQuantityDrafts(detailOrder);
    return true;
  }, [detailOrder, rebaseDetailQuantityDrafts]);

  useEffect(() => {
    if (!detailOrder || workbenchOpen) return;
    handleRegisterDetailLeaveGuard(confirmDetailLeave);
    return () => handleRegisterDetailLeaveGuard(null);
  }, [confirmDetailLeave, detailOrder, handleRegisterDetailLeaveGuard, workbenchOpen]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasProtectedDetailDraft = Boolean(
        detailOrder && !workbenchOpen && detailHasQuantityDraftChangesRef.current,
      );
      if (!managerBusyRef.current && !hasProtectedDetailDraft) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [detailOrder, workbenchOpen]);

  useEffect(() => {
    if (!detailOrderId || workbenchOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    detailPreviouslyFocusedElementRef.current = previousFocus;
    const animationFrame = window.requestAnimationFrame(() => {
      const closeButton = detailCloseButtonRef.current;
      if (closeButton && !closeButton.disabled) closeButton.focus();
      else detailDialogRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      const restoreTarget = detailPreviouslyFocusedElementRef.current;
      detailPreviouslyFocusedElementRef.current = null;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [detailOrderId, workbenchOpen]);

  useEffect(() => {
    if (!detailOrder || workbenchOpen) return;
    const handleDetailKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDetailDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = detailDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDetailKeyDown, true);
    return () => window.removeEventListener("keydown", handleDetailKeyDown, true);
  }, [closeDetailDialog, detailOrder, workbenchOpen]);

  useEffect(() => {
    if (workbenchOpen || (!detailOrder && !busyKey)) return;
    const handleMobileSwipeBack = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (detailOrder) closeDetailDialog();
      else confirmManagerBusyLeave();
    };
    window.addEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack, true);
    return () => window.removeEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack, true);
  }, [busyKey, closeDetailDialog, confirmManagerBusyLeave, detailOrder, workbenchOpen]);

  const openDetailEnterpriseTask = useCallback(
    async (order: MerchantOrderRecord) => {
      if (!onOpenEnterpriseTask) return;
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId || order.siteId !== operation.siteId) return;
      if (!confirmDetailLeave()) return;
      const requestSequence = detailRequestSequenceRef.current + 1;
      detailRequestSequenceRef.current = requestSequence;
      setBusyKey(`detail-task:${order.id}`);
      setError("");
      try {
        const latestOrder = await requestExactOrder(order.id);
        if (
          !isSiteRequestCurrent(operation) ||
          detailRequestSequenceRef.current !== requestSequence
        ) return;
        setBusyKey("");
        finalizeDetailClose();
        onOpenEnterpriseTask(latestOrder);
      } catch (nextError) {
        if (
          !isSiteRequestCurrent(operation) ||
          detailRequestSequenceRef.current !== requestSequence
        ) return;
        setError(nextError instanceof Error && nextError.message ? nextError.message : "订单读取失败");
      } finally {
        if (
          isSiteRequestCurrent(operation) &&
          detailRequestSequenceRef.current === requestSequence
        ) setBusyKey("");
      }
    },
    [
      captureSiteRequestContext,
      confirmDetailLeave,
      finalizeDetailClose,
      isSiteRequestCurrent,
      onOpenEnterpriseTask,
      requestExactOrder,
      setBusyKey,
      siteId,
    ],
  );

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
    (record: MerchantOrderRecord) => {
      const isOrderBusy = busyKey.endsWith(`:${record.id}`);
      const isBusy = (label: string) => busyKey === `${label}:${record.id}`;
      return (
        <>
          {record.status === "confirmed" ? (
            <button
              type="button"
              className={
                darkMode
                  ? "rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                  : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              }
              onClick={() => void patchOrderStatus(record, "pending", "unconfirm")}
              disabled={isOrderBusy}
            >
              {isBusy("unconfirm") ? "处理中" : "取消确认"}
            </button>
          ) : record.status === "cancelled" ? (
            <button
              type="button"
              className={
                darkMode
                  ? "rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
                  : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              }
              onClick={() => void patchOrderStatus(record, "pending", "restore")}
              disabled={isOrderBusy}
            >
              {isBusy("restore") ? "处理中" : "恢复待确认"}
            </button>
          ) : (
            <button
              type="button"
              className={
                darkMode
                  ? "rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-medium text-sky-100 transition hover:bg-sky-400/20 disabled:opacity-50"
                  : "rounded-full border border-sky-300 bg-sky-100 px-3 py-2 text-xs font-medium text-sky-800 transition hover:bg-sky-200 disabled:opacity-50"
              }
              onClick={() => void patchOrderStatus(record, "confirmed", "confirm")}
              disabled={isOrderBusy}
            >
              {isBusy("confirm") ? "处理中" : "确认"}
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
              onClick={() => void patchOrderStatus(record, "completed", "complete")}
              disabled={isOrderBusy}
            >
              {isBusy("complete") ? (
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
              onClick={() => void patchOrderStatus(record, "confirmed", "uncomplete")}
              disabled={isOrderBusy}
            >
              {isBusy("uncomplete") ? "处理中" : "取消完成"}
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
              onClick={() => void patchOrderStatus(record, "cancelled", "cancel")}
              disabled={isOrderBusy}
            >
              {isBusy("cancel") ? "处理中" : "取消"}
            </button>
          ) : null}
        </>
      );
    },
    [busyKey, darkMode, patchOrderStatus],
  );

  const detailOrderBusy = detailOrder ? busyKey.endsWith(`:${detailOrder.id}`) : false;
  const isDetailOrderActionBusy = (label: string) => (detailOrder ? busyKey === `${label}:${detailOrder.id}` : false);

  const detailOverlay = detailOrder ? (
    <div
      className="fixed inset-0 z-[2147483000] flex items-start justify-center overflow-hidden overscroll-none bg-black/55 px-4 pb-[calc(var(--faolla-mobile-safe-bottom)+6.5rem)] pt-4"
      onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) closeDetailDialog();
      }}
    >
      <div
        ref={detailDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={detailDialogTitleId}
        tabIndex={-1}
        className={`mx-auto ${detailPanelClassName}`}
      >
        <h2 id={detailDialogTitleId} className="sr-only">{`订单详情 ${detailOrder.id}`}</h2>
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
            ref={detailCloseButtonRef}
            type="button"
            className={`rounded-full px-3 py-2 text-sm font-medium disabled:opacity-50 ${darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            onClick={closeDetailDialog}
            disabled={Boolean(busyKey)}
            data-mobile-swipe-back-control="true"
          >
            关闭
          </button>
        </div>

        {detailHasQuantityDraftChanges || detailDraftConflict ? (
          <div
            className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 text-sm ${
              darkMode
                ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
            role="status"
          >
            <span>{detailDraftConflict || "商品数量有尚未保存的修改。确认或完成订单时会一并保存。"}</span>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                darkMode ? "border border-amber-300/30 bg-white/10" : "border border-amber-300 bg-white"
              }`}
              onClick={discardDetailQuantityDrafts}
              disabled={Boolean(busyKey)}
            >
              放弃修改并加载最新
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(var(--faolla-mobile-safe-bottom)+1.25rem)] pt-4">
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
                  const isDetailActionBusy =
                    detailOrderBusy || detailOrder.status === "completed" || detailOrder.status === "cancelled";
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
                  onClick={() => void patchOrderStatus(detailOrder, "pending", "unconfirm")}
                  disabled={detailOrderBusy}
                >
                  {isDetailOrderActionBusy("unconfirm") ? "处理中" : "取消确认"}
                </button>
              ) : detailOrder.status === "cancelled" ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"
                  }`}
                  onClick={() => void patchOrderStatus(detailOrder, "pending", "restore")}
                  disabled={detailOrderBusy}
                >
                  {isDetailOrderActionBusy("restore") ? "处理中" : "恢复待确认"}
                </button>
              ) : (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode
                      ? "border border-sky-400/30 bg-sky-400/10 text-sky-100"
                      : "border border-sky-300 bg-sky-100 text-sky-800"
                  } disabled:opacity-40`}
                  onClick={() => void patchOrderStatus(detailOrder, "confirmed", "confirm", { persistDetailDraft: true })}
                  disabled={detailOrderBusy}
                >
                  {isDetailOrderActionBusy("confirm") ? "处理中" : "确认"}
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
                  onClick={() => void patchOrderStatus(detailOrder, "completed", "complete", { persistDetailDraft: true })}
                  disabled={detailOrderBusy}
                >
                  {isDetailOrderActionBusy("complete") ? (
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
                  onClick={() => void patchOrderStatus(detailOrder, "confirmed", "uncomplete")}
                  disabled={detailOrderBusy}
                >
                  {isDetailOrderActionBusy("uncomplete") ? "处理中" : "取消完成"}
                </button>
              ) : null}
              {onOpenEnterpriseTask ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode
                      ? "border border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                      : "border border-cyan-200 bg-cyan-50 text-cyan-800"
                  }`}
                  onClick={() => void openDetailEnterpriseTask(detailOrder)}
                  disabled={Boolean(busyKey)}
                >
                  创建/查看企业任务
                </button>
              ) : null}
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  darkMode ? "bg-white/10 text-white" : "border border-slate-200 bg-white text-slate-700"
                }`}
                onClick={() => void printOrder(detailOrder)}
                disabled={detailOrderBusy}
              >
                {isDetailOrderActionBusy("print")
                  ? "正在发起"
                  : getMerchantOrderPrintAttemptText(detailOrder.printCount)}
              </button>
              {detailOrder.status !== "cancelled" ? (
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    darkMode ? "border border-white/10 bg-white/5 text-white" : "border border-slate-200 bg-white text-slate-700"
                  } disabled:opacity-40`}
                  onClick={() => void patchOrderStatus(detailOrder, "cancelled", "cancel")}
                  disabled={detailOrderBusy}
                >
                  {isDetailOrderActionBusy("cancel") ? "处理中" : "取消"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const workbenchDialog = workbenchOpen ? (
    <OrderWorkbenchPanel
      siteId={siteId}
      mode="overlay"
      darkMode={darkMode}
      onClose={() => setWorkbenchOpen(false)}
      onOpenOrder={openWorkbenchOrder}
      onContactOrder={onOpenConversation ? contactWorkbenchOrder : undefined}
      onOpenEnterpriseTask={onOpenEnterpriseTask ? openWorkbenchEnterpriseTask : undefined}
      onStatusFilter={openWorkbenchStatus}
      onChanged={loadOrders}
      registerLeaveGuard={handleRegisterWorkbenchLeaveGuard}
    />
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
                  className={`faolla-mobile-business-segment inline-flex h-9 shrink-0 items-center rounded-[18px] p-0.5 shadow-sm ${
                    darkMode ? "border border-white/10 bg-white/5" : "border border-slate-200 bg-white"
                  }`}
                >
                  <button
                    type="button"
                    className={`faolla-mobile-business-segment-button h-8 rounded-[16px] px-3 py-0 text-[12px] font-semibold transition ${
                      darkMode ? "text-slate-300 hover:bg-white/5" : "text-slate-500 hover:bg-slate-100"
                    }`}
                    onClick={() => onSectionChange("booking")}
                  >
                    预约
                  </button>
                  <button
                    type="button"
                    className="faolla-mobile-business-segment-button h-8 rounded-[16px] bg-slate-900 px-3 py-0 text-[12px] font-semibold text-white shadow-sm"
                    onClick={() => onSectionChange("orders")}
                  >
                    订单
                  </button>
                </div>
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] bg-slate-900 text-[12px] font-semibold text-white shadow-sm">
                  订单
                </div>
              )}
              <div
                  className={`faolla-mobile-business-search flex h-9 min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[18px] border px-3 py-1.5 shadow-sm ${
                  darkMode ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-[#f3f4f6] text-slate-900"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
                  <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索订单号 / 客户 / 产品"
                  className={`min-w-0 flex-1 bg-transparent text-[13px] leading-4 outline-none ${
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
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
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
                              className="w-full min-w-0 appearance-none bg-transparent pl-1 pr-9 text-[13px] font-medium outline-none"
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
                              className="w-full min-w-0 appearance-none bg-transparent pl-1 pr-9 text-[13px] font-medium outline-none"
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
                      ? "rounded-full bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                      : "rounded-full bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"
                    : darkMode
                      ? "rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200"
                      : "rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600"
                }
                onClick={() => setFilter(key)}
              >
                {key === "all" ? "全部" : getStatusText(key)} {counts[key]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className={emptyPanelClassName}>正在读取订单...</div>
        ) : filteredRecords.length > 0 ? (
          <>
          {renderedRecords.map((record) => {
            const displayName = record.customer.name || "未命名客户";
            const isNewRecord = isMerchantOrderPendingMerchantTouch(record);
            const canOpenConversation = Boolean(record.customerAccountId || record.customerLoginEmail);
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
                      {canOpenConversation ? (
                        <button
                          type="button"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
                          onClick={() => void openListConversation(record.id)}
                          disabled={Boolean(busyKey)}
                          title="打开与客户的会话"
                          aria-label="打开与客户的会话"
                        >
                          <ChatIcon />
                        </button>
                      ) : null}
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
          })}
          {filteredRecords.length > renderedRecords.length || hasMoreRemoteRecords ? (
            <button
              type="button"
              className={`w-full rounded-[20px] border px-4 py-3 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                darkMode
                  ? "border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => {
                if (filteredRecords.length > renderedRecords.length) {
                  setRenderLimit((current) => current + MERCHANT_ORDER_MOBILE_RENDER_LIMIT);
                  return;
                }
                void loadMoreOrders();
              }}
              disabled={loadingMoreRecords}
            >
              {loadingMoreRecords ? "加载中" : "显示更多"}
            </button>
          ) : null}
          </>
        ) : (
          <div className={emptyPanelClassName}>还没有匹配到订单。</div>
        )}
      </div>
      {workbenchDialog}
      {detailOverlay}
    </>
  );
}
