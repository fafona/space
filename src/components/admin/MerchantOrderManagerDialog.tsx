"use client";

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import OrderStatusFilterDropdown from "@/components/admin/OrderStatusFilterDropdown";
import OrderWorkbenchPanel, { type OrderWorkbenchView } from "@/components/admin/OrderWorkbenchPanel";
import type { MerchantCatalogTarget } from "@/lib/merchantCatalog";
import { showGlobalToast } from "@/lib/globalToast";
import { fetchWithAdminPerformance } from "@/lib/performanceTelemetry";
import type {
  MerchantBusinessApiClient,
  MerchantBusinessCachePolicy,
} from "@/lib/merchantBusinessApiClient";
import { MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY } from "@/lib/merchantBusinessApiClient";
import {
  MERCHANT_ORDER_STATUSES,
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
  MERCHANT_ORDER_HISTORY_OPTIONS,
  MERCHANT_ORDER_SORT_OPTIONS,
  type MerchantOrderHistoryVisibility,
  type MerchantOrderSortMode,
} from "@/lib/merchantOrderManagerPreferences";
import type { MerchantOrderSourceDetailIntent } from "@/lib/merchantOrderEnterprise";
import { MOBILE_SWIPE_BACK_EVENT } from "@/lib/mobileSwipeBack";
import { useMerchantOrderManagerPreferences } from "@/lib/useMerchantManagerPreferences";
import {
  buildMerchantAdminDataCacheKey,
  readMerchantAdminDataCache,
  writeMerchantAdminDataCache,
} from "@/lib/merchantAdminDataCache";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import {
  MERCHANT_ORDER_OWNER_CACHE_POLICY,
  MERCHANT_ORDER_NO_PERMISSIONS,
  canOpenMerchantOrderWorkbenchView,
  canRunMerchantOrderAction,
  canRunMerchantOrderStatusTransition,
  createMerchantOrderApiRequest,
  hasMerchantOrderFrontendPermission,
  isMerchantOrderEmployeeFrontend,
} from "@/lib/merchantOrderFrontendAccess";

type MerchantOrderManagerDialogProps = {
  open: boolean;
  mode?: "dialog" | "inline";
  showCloseButton?: boolean;
  className?: string;
  siteId: string;
  siteName: string;
  workbenchOpen?: boolean;
  workbenchInitialView?: OrderWorkbenchView;
  workbenchCatalogTarget?: MerchantCatalogTarget | null;
  hideWorkbenchButton?: boolean;
  onWorkbenchOpenChange?: (open: boolean) => void;
  onOrdersChange?: (records: MerchantOrderRecord[]) => void;
  onOpenConversation?: (target: { accountId?: string; email?: string; name?: string }) => void;
  onOpenEnterpriseTask?: (order: MerchantOrderRecord) => void;
  sourceOrderIntent?: MerchantOrderSourceDetailIntent | null;
  onSourceOrderIntentHandled?: (requestId: string) => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
  apiClient?: MerchantBusinessApiClient;
  cachePolicy?: MerchantBusinessCachePolicy;
  permissions?: readonly MerchantStaffBusinessPermission[];
  onClose: () => void;
};

type MerchantOrderFilter = "all" | MerchantOrderStatus;

type MerchantOrderSiteRequestContext = {
  siteId: string;
  generation: number;
};

type MerchantOrderSiteRequest = MerchantOrderSiteRequestContext & {
  controller: AbortController;
};

const MERCHANT_ORDER_RENDER_LIMIT = 250;
const MERCHANT_ORDER_FETCH_LIMIT = 500;

function overlay(children: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

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

function getStatusBadgeClass(status: MerchantOrderStatus) {
  if (status === "completed") return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "confirmed") return "border border-sky-200 bg-sky-50 text-sky-700";
  if (status === "cancelled") return "border border-rose-200 bg-rose-50 text-rose-700";
  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function getFilterChipClass(filter: MerchantOrderFilter, key: MerchantOrderFilter) {
  const isActive = filter === key;
  if (key === "pending") {
    return isActive
      ? "border-2 border-amber-500 bg-amber-500 text-white shadow-[0_8px_18px_rgba(245,158,11,0.24)]"
      : "border border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300";
  }
  if (key === "confirmed") {
    return isActive
      ? "border-2 border-sky-500 bg-sky-500 text-white shadow-[0_8px_18px_rgba(14,165,233,0.24)]"
      : "border border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300";
  }
  if (key === "completed") {
    return isActive
      ? "border-2 border-emerald-500 bg-emerald-500 text-white shadow-[0_8px_18px_rgba(16,185,129,0.24)]"
      : "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300";
  }
  if (key === "cancelled") {
    return isActive
      ? "border-2 border-slate-600 bg-slate-700 text-white shadow-[0_8px_18px_rgba(51,65,85,0.22)]"
      : "border border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300";
  }
  return isActive
    ? "border-2 border-slate-950 bg-slate-950 text-white shadow-[0_8px_18px_rgba(15,23,42,0.22)]"
    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300";
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

const requestOwnerOrderApi: MerchantBusinessApiClient = (path, init) =>
  fetchWithAdminPerformance(path, init);

export default function MerchantOrderManagerDialog({
  open,
  mode = "dialog",
  showCloseButton = true,
  className = "",
  siteId,
  workbenchOpen: controlledWorkbenchOpen,
  workbenchInitialView = "overview",
  workbenchCatalogTarget = null,
  hideWorkbenchButton = false,
  onWorkbenchOpenChange,
  onOrdersChange,
  onOpenConversation,
  onOpenEnterpriseTask,
  sourceOrderIntent = null,
  onSourceOrderIntentHandled,
  registerLeaveGuard,
  apiClient,
  cachePolicy,
  permissions,
  onClose,
}: MerchantOrderManagerDialogProps) {
  const isInline = mode === "inline";
  const employeeMode = isMerchantOrderEmployeeFrontend({
    apiClient,
    cachePolicy,
    permissions,
  });
  const effectiveCachePolicy =
    employeeMode
      ? MERCHANT_BUSINESS_EMPLOYEE_CACHE_POLICY
      : cachePolicy ?? MERCHANT_ORDER_OWNER_CACHE_POLICY;
  const effectivePermissions =
    employeeMode && permissions === undefined
      ? MERCHANT_ORDER_NO_PERMISSIONS
      : permissions;
  const requestOrderApi = useMemo(
    () =>
      createMerchantOrderApiRequest({
        apiClient,
        employeeMode,
        ownerFetch: requestOwnerOrderApi,
      }),
    [apiClient, employeeMode],
  );
  const canViewOrders = hasMerchantOrderFrontendPermission(effectivePermissions, "orders.view");
  const canViewCustomerData = hasMerchantOrderFrontendPermission(
    effectivePermissions,
    "orders.customer_data.view",
  );
  const canManageOrderStatus = hasMerchantOrderFrontendPermission(
    effectivePermissions,
    "orders.status.manage",
  );
  const canCompleteOrders = hasMerchantOrderFrontendPermission(
    effectivePermissions,
    "orders.complete",
  );
  const canUpdateOrderItems = hasMerchantOrderFrontendPermission(
    effectivePermissions,
    "orders.items.update",
  );
  const canPrintOrders = hasMerchantOrderFrontendPermission(effectivePermissions, "orders.print");
  const canOpenOwnerEnterpriseTask = !employeeMode && Boolean(onOpenEnterpriseTask);
  const canOpenWorkbench = (["overview", "orders", "analysis", "catalog", "export"] as const).some(
    (view) => canOpenMerchantOrderWorkbenchView(effectivePermissions, view),
  );
  const permissionFingerprint = effectivePermissions?.join("\u0001") ?? "owner";
  const [records, setRecords] = useState<MerchantOrderRecord[]>(() =>
    canViewOrders && effectiveCachePolicy.allowPersistentRead
      ? readCachedOrderRecords(siteId)
      : [],
  );
  const [loading, setLoading] = useState(false);
  const [loadingMoreRecords, setLoadingMoreRecords] = useState(false);
  const [hasMoreRemoteRecords, setHasMoreRemoteRecords] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [renderLimit, setRenderLimit] = useState(MERCHANT_ORDER_RENDER_LIMIT);
  const [filter, setFilter] = useState<MerchantOrderFilter>("all");
  const {
    selectedStatuses,
    setSelectedStatuses,
    sortMode,
    setSortMode,
    historyVisibility,
    setHistoryVisibility,
  } = useMerchantOrderManagerPreferences(siteId, { cachePolicy: effectiveCachePolicy });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const managerBusyRef = useRef(false);
  const [busyKey, setBusyKeyState] = useState("");
  const setBusyKey = useCallback((nextBusyKey: string) => {
    managerBusyRef.current = Boolean(nextBusyKey);
    setBusyKeyState(nextBusyKey);
  }, []);
  const [internalWorkbenchOpen, setInternalWorkbenchOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [externalDetailOrder, setExternalDetailOrder] = useState<MerchantOrderRecord | null>(null);
  const [detailQuantityDrafts, setDetailQuantityDrafts] = useState<Record<string, string>>({});
  const [detailDraftConflict, setDetailDraftConflict] = useState("");
  const detailDraftBaseOrderRef = useRef<MerchantOrderRecord | null>(null);
  const handledSourceOrderIntentRef = useRef("");
  const workbenchLeaveGuardRef = useRef<(() => boolean) | null>(null);
  const detailLeaveGuardRef = useRef<(() => boolean) | null>(null);
  const managerDialogRef = useRef<HTMLDivElement | null>(null);
  const managerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const managerPreviouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const detailDialogRef = useRef<HTMLDivElement | null>(null);
  const detailCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailPreviouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const managerDialogTitleId = useId();
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
  const deferredSearch = useDeferredValue(search);
  const isWorkbenchOpenControlled = controlledWorkbenchOpen !== undefined;
  const workbenchOpen = controlledWorkbenchOpen ?? internalWorkbenchOpen;
  const setWorkbenchOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isWorkbenchOpenControlled) {
        setInternalWorkbenchOpen(nextOpen);
      }
      onWorkbenchOpenChange?.(nextOpen);
    },
    [isWorkbenchOpenControlled, onWorkbenchOpenChange],
  );
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
  const requestDialogClose = useCallback(() => {
    if (!getActiveLeaveGuard()()) return false;
    handleRegisterWorkbenchLeaveGuard(null);
    onClose();
    return true;
  }, [getActiveLeaveGuard, handleRegisterWorkbenchLeaveGuard, onClose]);
  useEffect(() => {
    publishActiveLeaveGuard();
    return () => registerLeaveGuard?.(null);
  }, [publishActiveLeaveGuard, registerLeaveGuard]);
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
  const currentSiteRecords = useMemo(
    () => records.filter((record) => record.siteId === siteId),
    [records, siteId],
  );

  const workbenchButtonClassName = workbenchOpen
    ? "inline-flex items-center justify-center rounded-[18px] rounded-tl-[8px] rounded-br-[24px] border border-[#34d399] bg-[linear-gradient(135deg,#0f172a_0%,#0f766e_58%,#10b981_100%)] px-4 py-2 text-sm font-semibold tracking-[0.03em] text-white shadow-[0_18px_34px_rgba(15,118,110,0.28)] ring-1 ring-[#99f6e4]/60 transition"
    : "inline-flex items-center justify-center rounded-[18px] rounded-tl-[8px] rounded-br-[24px] border border-[#f59e0b] bg-[linear-gradient(135deg,#fef3c7_0%,#f59e0b_38%,#f97316_100%)] px-4 py-2 text-sm font-semibold tracking-[0.03em] text-slate-950 shadow-[0_16px_30px_rgba(249,115,22,0.28)] ring-1 ring-[#fde68a]/80 transition hover:-translate-y-[1px] hover:brightness-[1.03] hover:shadow-[0_20px_34px_rgba(249,115,22,0.34)]";
  const toolbarSelectClassName =
    "inline-flex h-9 min-w-[224px] items-center justify-between gap-3 rounded-full border border-slate-200 bg-white px-3 py-0 text-sm text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)]";
  const toolbarSelectFieldClassName = "relative h-full w-[138px] min-w-[138px] flex-none";
  const toolbarSelectInputClassName =
    "pc-select-compact block h-full w-full appearance-none bg-transparent pr-8 text-sm font-semibold leading-none text-slate-900 outline-none";
  const toolbarSelectChevronClassName = "hidden";
  const compactBatchButtonClassName = selectionMode
    ? "rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-[0_10px_20px_rgba(15,23,42,0.14)] transition"
    : "rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:bg-slate-50";

  useEffect(() => {
    if (!open) {
      setWorkbenchOpen(false);
    }
  }, [open, setWorkbenchOpen]);

  useEffect(() => {
    if (!canOpenWorkbench && workbenchOpen) setWorkbenchOpen(false);
  }, [canOpenWorkbench, setWorkbenchOpen, workbenchOpen]);

  useEffect(() => {
    if (!error) return;
    showGlobalToast(error, { tone: "error" });
    const timer = window.setTimeout(() => setError(""), 3000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const activeRequestControllers = activeRequestControllersRef.current;
    return () => {
      activeRequestControllers.forEach((controller) => controller.abort());
      activeRequestControllers.clear();
      listRequestSequenceRef.current += 1;
      detailRequestSequenceRef.current += 1;
    };
  }, [siteId]);

  useEffect(() => {
    activeRequestControllersRef.current.forEach((controller) => controller.abort());
    activeRequestControllersRef.current.clear();
    listRequestSequenceRef.current += 1;
    detailRequestSequenceRef.current += 1;
    siteRequestIdentityRef.current = {
      ...siteRequestIdentityRef.current,
      generation: siteRequestIdentityRef.current.generation + 1,
    };
  }, [apiClient, employeeMode, permissionFingerprint]);

  const loadOrders = useCallback(async () => {
    if (!siteId || !canViewOrders) {
      setRecords([]);
      setHasMoreRemoteRecords(false);
      setLoading(false);
      return;
    }
    const request = beginSiteRequest(siteId);
    if (!request) return;
    const requestSequence = listRequestSequenceRef.current + 1;
    listRequestSequenceRef.current = requestSequence;
    const cachedRecords = effectiveCachePolicy.allowPersistentRead
      ? readCachedOrderRecords(siteId).filter((record) => record.siteId === siteId)
      : [];
    if (cachedRecords.length > 0) {
      setRecords(cachedRecords);
      onOrdersChange?.(cachedRecords);
      setLoading(false);
    } else {
      setRecords([]);
      setLoading(true);
    }
    setError("");
    try {
      const response = await requestOrderApi(
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
      if (effectiveCachePolicy.allowPersistentWrite) {
        writeCachedOrderRecords(request.siteId, nextRecords);
      }
      setRecords(nextRecords);
      setExternalDetailOrder((current) =>
        current?.siteId === request.siteId
          ? nextRecords.find((record) => record.id === current.id) ?? current
          : null,
      );
      onOrdersChange?.(nextRecords);
    } catch (nextError) {
      if (
        request.controller.signal.aborted ||
        !isSiteRequestCurrent(request) ||
        listRequestSequenceRef.current !== requestSequence
      ) return;
      setHasMoreRemoteRecords(false);
      const keepStaleRecords =
        effectiveCachePolicy.allowStaleOnError && cachedRecords.length > 0;
      if (!keepStaleRecords) setRecords([]);
      setError(
        keepStaleRecords
          ? ""
          : nextError instanceof Error && nextError.message
            ? nextError.message
            : "订单读取失败",
      );
    } finally {
      finishSiteRequest(request);
      if (isSiteRequestCurrent(request) && listRequestSequenceRef.current === requestSequence) {
        setLoading(false);
      }
    }
  }, [
    beginSiteRequest,
    canViewOrders,
    effectiveCachePolicy.allowPersistentRead,
    effectiveCachePolicy.allowPersistentWrite,
    effectiveCachePolicy.allowStaleOnError,
    finishSiteRequest,
    isSiteRequestCurrent,
    onOrdersChange,
    requestOrderApi,
    siteId,
  ]);

  const loadMoreOrders = useCallback(async () => {
    if (!siteId || !canViewOrders || loading || loadingMoreRecords || !hasMoreRemoteRecords) return;
    const request = beginSiteRequest(siteId);
    if (!request) return;
    const requestSequence = listRequestSequenceRef.current + 1;
    listRequestSequenceRef.current = requestSequence;
    const requestOffset = nextOrderOffsetRef.current;
    setLoadingMoreRecords(true);
    setError("");
    try {
      const response = await requestOrderApi(
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
        if (effectiveCachePolicy.allowPersistentWrite) {
          writeCachedOrderRecords(request.siteId, mergedRecords);
        }
        onOrdersChange?.(mergedRecords);
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
    canViewOrders,
    effectiveCachePolicy.allowPersistentWrite,
    finishSiteRequest,
    hasMoreRemoteRecords,
    isSiteRequestCurrent,
    loading,
    loadingMoreRecords,
    onOrdersChange,
    requestOrderApi,
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
    setSelectedOrderIds([]);
    setSelectionMode(false);
  }, [setBusyKey, siteId]);

  useEffect(() => {
    if (!open || !sourceOrderIntent || sourceOrderIntent.siteId !== siteId) return;
    if (handledSourceOrderIntentRef.current === sourceOrderIntent.requestId) return;
    handledSourceOrderIntentRef.current = sourceOrderIntent.requestId;
    if (employeeMode) {
      onSourceOrderIntentHandled?.(sourceOrderIntent.requestId);
      return;
    }
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
    setWorkbenchOpen(false);
    onSourceOrderIntentHandled?.(sourceOrderIntent.requestId);
  }, [
    onSourceOrderIntentHandled,
    employeeMode,
    open,
    setWorkbenchOpen,
    siteId,
    sourceOrderIntent,
  ]);

  useEffect(() => {
    if (!open || !siteId || !canViewOrders) {
      if (!canViewOrders) {
        setRecords([]);
        setHasMoreRemoteRecords(false);
        setLoading(false);
        setDetailOrderId("");
        setExternalDetailOrder(null);
        setSelectedOrderIds([]);
        setSelectionMode(false);
        setWorkbenchOpen(false);
      }
      return;
    }
    void loadOrders();
  }, [canViewOrders, loadOrders, open, setWorkbenchOpen, siteId]);

  useEffect(() => {
    onOrdersChange?.(currentSiteRecords);
  }, [currentSiteRecords, onOrdersChange]);

  useEffect(() => {
    if (!selectionMode && selectedOrderIds.length > 0) {
      setSelectedOrderIds([]);
    }
  }, [selectedOrderIds.length, selectionMode]);

  useEffect(() => {
    if (canManageOrderStatus) return;
    setSelectionMode(false);
    setSelectedOrderIds([]);
  }, [canManageOrderStatus]);

  useEffect(() => {
    setRenderLimit(MERCHANT_ORDER_RENDER_LIMIT);
  }, [deferredSearch, filter, historyVisibility, selectedStatuses, sortMode]);

  const historyFilteredRecords = useMemo(
    () => filterMerchantOrdersByHistory(currentSiteRecords, historyVisibility),
    [currentSiteRecords, historyVisibility],
  );

  const orderSearchTextById = useMemo(
    () =>
      new Map(
        currentSiteRecords.map((record) => [
          record.id,
          [
            record.id,
            ...(canViewCustomerData
              ? [
                  record.customer.name,
                  record.customer.phone,
                  record.customer.email,
                  record.customer.note,
                ]
              : []),
            record.items.map((item) => `${item.name}\n${item.code}\n${item.description}`).join("\n"),
          ]
            .join("\n")
            .toLowerCase(),
        ]),
      ),
    [canViewCustomerData, currentSiteRecords],
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

  const filteredRecords = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    return sortMerchantOrders(
      historyFilteredRecords.filter((record) => {
        if (filter === "all") {
          if (!selectedStatuses.includes(record.status)) return false;
        } else if (record.status !== filter) {
          return false;
        }
        if (!keyword) return true;
        return (orderSearchTextById.get(record.id) ?? "").includes(keyword);
      }),
      sortMode,
    );
  }, [deferredSearch, filter, historyFilteredRecords, orderSearchTextById, selectedStatuses, sortMode]);

  const renderedRecords = useMemo(
    () => filteredRecords.slice(0, renderLimit),
    [filteredRecords, renderLimit],
  );

  const visibleRecordIdSet = useMemo(() => new Set(filteredRecords.map((record) => record.id)), [filteredRecords]);
  const selectedRecordSet = useMemo(() => new Set(selectedOrderIds), [selectedOrderIds]);
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
    if (!selectionMode) return;
    setSelectedOrderIds((current) => {
      const next = current.filter((id) => visibleRecordIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [selectionMode, visibleRecordIdSet]);

  const requestOrderAction = useCallback(
    async (order: MerchantOrderRecord, action: MerchantOrderAction) => {
      if (!canRunMerchantOrderAction(effectivePermissions, action)) {
        throw new Error("order_permission_denied");
      }
      const request = beginSiteRequest(siteId);
      if (!request || order.siteId !== request.siteId) throw createAbortedOrderRequestError();
      try {
        const response = await requestOrderApi("/api/orders", {
          method: "PATCH",
          keepalive: action === "touch",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            siteId: request.siteId,
            orderId: order.id,
            action,
            ...(action === "touch" ? {} : { expectedUpdatedAt: order.updatedAt }),
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
    [
      beginSiteRequest,
      finishSiteRequest,
      isSiteRequestCurrent,
      effectivePermissions,
      requestOrderApi,
      siteId,
    ],
  );

  const requestOrderStatusUpdate = useCallback(
    async (
      order: MerchantOrderRecord,
      status: MerchantOrderStatus,
      items?: MerchantOrderLineItemInput[],
    ) => {
      if (
        !canRunMerchantOrderStatusTransition(effectivePermissions, order.status, status) ||
        (items &&
          !hasMerchantOrderFrontendPermission(effectivePermissions, "orders.items.update"))
      ) {
        throw new Error("order_permission_denied");
      }
      if (order.status === "completed" || status === "completed") {
        throw new Error("order_completion_action_required");
      }
      const request = beginSiteRequest(siteId);
      if (!request || order.siteId !== request.siteId) throw createAbortedOrderRequestError();
      try {
        const response = await requestOrderApi("/api/orders", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
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
    [
      beginSiteRequest,
      finishSiteRequest,
      isSiteRequestCurrent,
      effectivePermissions,
      requestOrderApi,
      siteId,
    ],
  );

  const requestOrderItemsUpdate = useCallback(
    async (order: MerchantOrderRecord, items: MerchantOrderLineItemInput[]) => {
      if (!hasMerchantOrderFrontendPermission(effectivePermissions, "orders.items.update")) {
        throw new Error("order_permission_denied");
      }
      const request = beginSiteRequest(siteId);
      if (!request || order.siteId !== request.siteId) throw createAbortedOrderRequestError();
      try {
        const response = await requestOrderApi("/api/orders", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: request.siteId,
            orderId: order.id,
            items,
            expectedUpdatedAt: order.updatedAt,
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
          throw new Error(payload?.message || payload?.error || "订单商品保存失败，请稍后重试。");
        }
        if (payload.order.siteId !== request.siteId || payload.order.id !== order.id) {
          throw new Error("订单商品保存返回了其他商户数据，请刷新后重试。");
        }
        return payload.order;
      } finally {
        finishSiteRequest(request);
      }
    },
    [
      beginSiteRequest,
      finishSiteRequest,
      isSiteRequestCurrent,
      effectivePermissions,
      requestOrderApi,
      siteId,
    ],
  );

  const requestBatchOrderStatusUpdate = useCallback(
    async (orderIds: string[], status: MerchantOrderStatus) => {
      if (
        status === "completed" ||
        !hasMerchantOrderFrontendPermission(effectivePermissions, "orders.status.manage")
      ) {
        throw new Error("order_permission_denied");
      }
      const request = beginSiteRequest(siteId);
      if (!request) throw createAbortedOrderRequestError();
      try {
        const response = await requestOrderApi("/api/orders", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            siteId: request.siteId,
            orderIds,
            status,
          }),
          signal: request.controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | { orders?: MerchantOrderRecord[]; hasMore?: boolean; message?: string; error?: string }
          | null;
        if (request.controller.signal.aborted || !isSiteRequestCurrent(request)) {
          throw createAbortedOrderRequestError();
        }
        if (!response.ok || !Array.isArray(payload?.orders)) {
          throw new Error(payload?.message || payload?.error || "订单保存失败，请稍后重试。");
        }
        const requestedOrderIds = new Set(orderIds);
        if (payload.orders.some((order) => order.siteId !== request.siteId || !requestedOrderIds.has(order.id))) {
          throw new Error("订单保存返回了其他商户数据，请刷新后重试。");
        }
        return payload.orders;
      } finally {
        finishSiteRequest(request);
      }
    },
    [
      beginSiteRequest,
      finishSiteRequest,
      isSiteRequestCurrent,
      effectivePermissions,
      requestOrderApi,
      siteId,
    ],
  );

  const requestExactOrder = useCallback(
    async (orderId: string) => {
      if (!canViewOrders) throw new Error("order_permission_denied");
      const request = beginSiteRequest(siteId);
      if (!request) throw createAbortedOrderRequestError();
      try {
        const response = await requestOrderApi(
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
    [
      beginSiteRequest,
      canViewOrders,
      finishSiteRequest,
      isSiteRequestCurrent,
      requestOrderApi,
      siteId,
    ],
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
      if (!canViewCustomerData || !onOpenConversation || managerBusyRef.current) return;
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
      canViewCustomerData,
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
      if (!canRunMerchantOrderStatusTransition(effectivePermissions, order.status, status)) {
        setError("当前账号没有执行此订单状态操作的权限。");
        return;
      }
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
      let itemUpdateCompleted = false;
      try {
        const draftItems =
          options.persistDetailDraft &&
          order.status !== "completed" &&
          order.status !== "cancelled" &&
          (status === "confirmed" || status === "completed") &&
          hasDetailQuantityDraftChanges(order)
            ? buildDetailDraftItemsInput(order)
            : undefined;
        if (
          draftItems &&
          !hasMerchantOrderFrontendPermission(effectivePermissions, "orders.items.update")
        ) {
          throw new Error("当前账号没有修改订单商品的权限。");
        }
        const completionAction =
          status === "completed"
            ? "complete"
            : order.status === "completed"
              ? "uncomplete"
              : null;
        let nextOrder: MerchantOrderRecord;
        if (completionAction) {
          const orderWithItems = draftItems
            ? await requestOrderItemsUpdate(order, draftItems)
            : order;
          if (draftItems) {
            itemUpdateCompleted = true;
            if (!isSiteRequestCurrent(operation)) return;
            if (targetsOpenDetail) rebaseDetailQuantityDrafts(orderWithItems);
            setRecords((current) =>
              current.map((item) =>
                item.id === order.id ? orderWithItems : item,
              ),
            );
            setExternalDetailOrder((current) =>
              current?.id === order.id ? orderWithItems : current,
            );
          }
          nextOrder = await requestOrderAction(orderWithItems, completionAction);
        } else {
          nextOrder = await requestOrderStatusUpdate(order, status, draftItems);
        }
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
        setError(
          itemUpdateCompleted
            ? `商品数量已保存，但订单状态修改失败：${message}`
            : `保存失败，修改未生效：${message}`,
        );
      } finally {
        if (isSiteRequestCurrent(operation)) setBusyKey("");
      }
    },
    [
      buildDetailDraftItemsInput,
      captureSiteRequestContext,
      hasDetailQuantityDraftChanges,
      isSiteRequestCurrent,
      effectivePermissions,
      requestOrderAction,
      requestOrderItemsUpdate,
      requestOrderStatusUpdate,
      detailOrderId,
      rebaseDetailQuantityDrafts,
      setBusyKey,
      siteId,
    ],
  );

  const saveDetailOrderItems = useCallback(
    async (order: MerchantOrderRecord) => {
      if (
        !canUpdateOrderItems ||
        order.status === "completed" ||
        order.status === "cancelled"
      ) return;
      if (detailDraftConflictRef.current) {
        setError(detailDraftConflictRef.current);
        return;
      }
      if (!hasDetailQuantityDraftChanges(order)) return;
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId || order.siteId !== operation.siteId) return;
      setBusyKey(`items:${order.id}`);
      setError("");
      try {
        const nextOrder = await requestOrderItemsUpdate(
          order,
          buildDetailDraftItemsInput(order),
        );
        if (!isSiteRequestCurrent(operation)) return;
        rebaseDetailQuantityDrafts(nextOrder);
        setRecords((current) =>
          current.map((item) => (item.id === order.id ? nextOrder : item)),
        );
        setExternalDetailOrder((current) =>
          current?.id === order.id ? nextOrder : current,
        );
      } catch (nextError) {
        if (!isSiteRequestCurrent(operation)) return;
        setError(
          nextError instanceof Error && nextError.message
            ? nextError.message
            : "订单商品保存失败，请稍后重试。",
        );
      } finally {
        if (isSiteRequestCurrent(operation)) setBusyKey("");
      }
    },
    [
      buildDetailDraftItemsInput,
      canUpdateOrderItems,
      captureSiteRequestContext,
      hasDetailQuantityDraftChanges,
      isSiteRequestCurrent,
      rebaseDetailQuantityDrafts,
      requestOrderItemsUpdate,
      setBusyKey,
      siteId,
    ],
  );

  const printOrder = useCallback(
    async (order: MerchantOrderRecord) => {
      if (!canPrintOrders) {
        setError("当前账号没有打印订单的权限。");
        return;
      }
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
      canPrintOrders,
      setBusyKey,
      siteId,
    ],
  );

  const runBatchOrderStatusUpdate = useCallback(
    async (status: MerchantOrderStatus, busyLabel: string) => {
      if (!canManageOrderStatus || status === "completed") {
        setError("当前账号没有批量修改订单状态的权限。");
        return;
      }
      if (selectedOrderIds.length === 0) return;
      const operation = captureSiteRequestContext();
      if (operation.siteId !== siteId) return;
      setBusyKey(`batch:${busyLabel}`);
      setError("");
      try {
        const updatedOrders = await requestBatchOrderStatusUpdate(selectedOrderIds, status);
        if (!isSiteRequestCurrent(operation)) return;
        const updatedById = new Map(updatedOrders.map((item) => [item.id, item]));
        setRecords((current) =>
          isSiteRequestCurrent(operation)
            ? current.map((item) => updatedById.get(item.id) ?? item)
            : current,
        );
        setSelectedOrderIds([]);
        setSelectionMode(false);
      } catch (nextError) {
        if (!isSiteRequestCurrent(operation)) return;
        setError(nextError instanceof Error && nextError.message ? nextError.message : "批量操作失败");
      } finally {
        if (isSiteRequestCurrent(operation)) setBusyKey("");
      }
    },
    [
      captureSiteRequestContext,
      canManageOrderStatus,
      isSiteRequestCurrent,
      requestBatchOrderStatusUpdate,
      selectedOrderIds,
      setBusyKey,
      siteId,
    ],
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

  useEffect(() => {
    if (!open || isInline) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    managerPreviouslyFocusedElementRef.current = previousFocus;
    const animationFrame = window.requestAnimationFrame(() => {
      const closeButton = managerCloseButtonRef.current;
      if (closeButton && !closeButton.disabled) closeButton.focus();
      else managerDialogRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
      const restoreTarget = managerPreviouslyFocusedElementRef.current;
      managerPreviouslyFocusedElementRef.current = null;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [isInline, open]);

  useEffect(() => {
    if (!open || isInline) return;
    const handleManagerKeyDown = (event: KeyboardEvent) => {
      if (detailOrder || workbenchOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        requestDialogClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = managerDialogRef.current;
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
    window.addEventListener("keydown", handleManagerKeyDown, true);
    return () => window.removeEventListener("keydown", handleManagerKeyDown, true);
  }, [detailOrder, isInline, open, requestDialogClose, workbenchOpen]);

  useEffect(() => {
    if (!open || isInline) return;
    const handleManagerMobileSwipeBack = (event: Event) => {
      if (detailOrder || workbenchOpen) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestDialogClose();
    };
    window.addEventListener(MOBILE_SWIPE_BACK_EVENT, handleManagerMobileSwipeBack, true);
    return () => window.removeEventListener(MOBILE_SWIPE_BACK_EVENT, handleManagerMobileSwipeBack, true);
  }, [detailOrder, isInline, open, requestDialogClose, workbenchOpen]);

  const openDetailEnterpriseTask = useCallback(
    async (order: MerchantOrderRecord) => {
      if (!canOpenOwnerEnterpriseTask || !onOpenEnterpriseTask) return;
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
      canOpenOwnerEnterpriseTask,
      confirmDetailLeave,
      finalizeDetailClose,
      isSiteRequestCurrent,
      onOpenEnterpriseTask,
      requestExactOrder,
      setBusyKey,
      siteId,
    ],
  );

  const openDetailDialog = useCallback(
    (record: MerchantOrderRecord) => {
      if (record.siteId !== siteId) return;
      detailRequestSequenceRef.current += 1;
      setExternalDetailOrder(null);
      setDetailOrderId(record.id);
    },
    [siteId],
  );

  const resolveWorkbenchActionOrder = useCallback(
    async (orderId: string) => requestExactOrder(orderId),
    [requestExactOrder],
  );

  const contactWorkbenchOrder = useCallback(
    async (orderId: string) => {
      if (!canViewCustomerData || !onOpenConversation) return;
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
      canViewCustomerData,
      handleRegisterWorkbenchLeaveGuard,
      isSiteRequestCurrent,
      markOrderTouched,
      onOpenConversation,
      resolveWorkbenchActionOrder,
      setWorkbenchOpen,
      siteId,
    ],
  );

  const openWorkbenchEnterpriseTask = useCallback(
    async (orderId: string) => {
      if (!canOpenOwnerEnterpriseTask || !onOpenEnterpriseTask) return;
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
      canOpenOwnerEnterpriseTask,
      handleRegisterWorkbenchLeaveGuard,
      isSiteRequestCurrent,
      onOpenEnterpriseTask,
      resolveWorkbenchActionOrder,
      setWorkbenchOpen,
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
        setBusyKey("");
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
      setWorkbenchOpen,
      siteId,
    ],
  );

  const openWorkbenchStatus = useCallback(
    (status: MerchantOrderStatus) => {
      setSearch("");
      setHistoryVisibility("none");
      setFilter(status);
      if (!selectedStatuses.includes(status)) {
        setSelectedStatuses((current) => [...current, status]);
      }
      setWorkbenchOpen(false);
    },
    [selectedStatuses, setHistoryVisibility, setSelectedStatuses, setWorkbenchOpen],
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

  const renderOrderActions = useCallback(
    (record: MerchantOrderRecord, options: { persistDetailDraft?: boolean } = {}) => {
      const isBatchBusy = busyKey.startsWith("batch:");
      const isOrderBusy = busyKey.endsWith(`:${record.id}`);
      const isBusy = (label: string) => busyKey === `${label}:${record.id}`;
      const disabled = isBatchBusy || isOrderBusy;
      return (
        <>
          {canManageOrderStatus ? record.status === "confirmed" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "pending", "unconfirm", options)}
              disabled={disabled}
            >
              {isBusy("unconfirm") ? "处理中" : "取消确认"}
            </button>
          ) : record.status === "cancelled" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "pending", "restore", options)}
              disabled={disabled}
            >
              {isBusy("restore") ? "处理中" : "恢复待确认"}
            </button>
          ) : (
            <button
              type="button"
              className="rounded border border-sky-300 bg-sky-100 px-3 py-1.5 text-[13px] leading-5 text-sky-800 hover:bg-sky-200 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "confirmed", "confirm", options)}
              disabled={disabled}
            >
              {isBusy("confirm") ? "处理中" : "确认"}
            </button>
          ) : null}
          {canCompleteOrders ? record.status === "confirmed" ? (
            <button
              type="button"
              className="rounded border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[13px] leading-5 text-white hover:bg-emerald-700 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "completed", "complete", options)}
              disabled={disabled}
            >
              {isBusy("complete") ? "处理中" : "完成"}
            </button>
          ) : record.status === "completed" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "confirmed", "uncomplete", options)}
              disabled={disabled}
            >
              {isBusy("uncomplete") ? "处理中" : "取消完成"}
            </button>
          ) : null : null}
          {canPrintOrders ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void printOrder(record)}
              disabled={disabled}
            >
              {isBusy("print") ? "正在发起" : getMerchantOrderPrintAttemptText(record.printCount)}
            </button>
          ) : null}
          {canManageOrderStatus && record.status !== "cancelled" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "cancelled", "cancel", options)}
              disabled={disabled}
            >
              {isBusy("cancel") ? "处理中" : "取消"}
            </button>
          ) : null}
        </>
      );
    },
    [
      busyKey,
      canCompleteOrders,
      canManageOrderStatus,
      canPrintOrders,
      patchOrderStatus,
      printOrder,
    ],
  );

  const renderStatusActions = useCallback(
    (record: MerchantOrderRecord) => {
      const isBatchBusy = busyKey.startsWith("batch:");
      const isOrderBusy = busyKey.endsWith(`:${record.id}`);
      const isBusy = (label: string) => busyKey === `${label}:${record.id}`;
      const disabled = isBatchBusy || isOrderBusy;
      return (
        <>
          {canManageOrderStatus ? record.status === "confirmed" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "pending", "unconfirm")}
              disabled={disabled}
              data-skip-selection-toggle="true"
            >
              {isBusy("unconfirm") ? "处理中" : "取消确认"}
            </button>
          ) : record.status === "cancelled" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "pending", "restore")}
              disabled={disabled}
              data-skip-selection-toggle="true"
            >
              {isBusy("restore") ? "处理中" : "恢复待确认"}
            </button>
          ) : (
            <button
              type="button"
              className="rounded border border-sky-300 bg-sky-100 px-3 py-1.5 text-[13px] leading-5 text-sky-800 hover:bg-sky-200 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "confirmed", "confirm")}
              disabled={disabled}
              data-skip-selection-toggle="true"
            >
              {isBusy("confirm") ? "处理中" : "确认"}
            </button>
          ) : null}
          {canCompleteOrders ? record.status === "confirmed" ? (
            <button
              type="button"
              className="rounded border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[13px] leading-5 text-white hover:bg-emerald-700 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "completed", "complete")}
              disabled={disabled}
              data-skip-selection-toggle="true"
            >
              {isBusy("complete") ? "处理中" : "完成"}
            </button>
          ) : record.status === "completed" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "confirmed", "uncomplete")}
              disabled={disabled}
              data-skip-selection-toggle="true"
            >
              {isBusy("uncomplete") ? "处理中" : "取消完成"}
            </button>
          ) : null : null}
          {canManageOrderStatus && record.status !== "cancelled" ? (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => void patchOrderStatus(record, "cancelled", "cancel")}
              disabled={disabled}
              data-skip-selection-toggle="true"
            >
              {isBusy("cancel") ? "处理中" : "取消"}
            </button>
          ) : null}
        </>
      );
    },
    [busyKey, canCompleteOrders, canManageOrderStatus, patchOrderStatus],
  );

  const isSidebarWorkbenchMode = isInline && hideWorkbenchButton;
  const workbenchDialog = workbenchOpen && canOpenWorkbench ? (
    <OrderWorkbenchPanel
      siteId={siteId}
      mode={isSidebarWorkbenchMode ? "inline" : "overlay"}
      initialView={workbenchInitialView}
      catalogTarget={workbenchCatalogTarget}
      onClose={() => setWorkbenchOpen(false)}
      onOpenOrder={openWorkbenchOrder}
      onContactOrder={canViewCustomerData && onOpenConversation ? contactWorkbenchOrder : undefined}
      onOpenEnterpriseTask={canOpenOwnerEnterpriseTask ? openWorkbenchEnterpriseTask : undefined}
      onStatusFilter={openWorkbenchStatus}
      onChanged={loadOrders}
      registerLeaveGuard={handleRegisterWorkbenchLeaveGuard}
      apiClient={apiClient}
      cachePolicy={effectiveCachePolicy}
      permissions={effectivePermissions}
    />
  ) : null;

  if (isSidebarWorkbenchMode && workbenchOpen && workbenchDialog) return workbenchDialog;

  const detailDialog = detailOrder
    ? overlay(
        <div
          className="fixed inset-0 z-[2147482940] flex items-center justify-center bg-black/45 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDetailDialog();
            }
          }}
        >
          <div
            ref={detailDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={detailDialogTitleId}
            tabIndex={-1}
            className="flex max-h-[90vh] w-full max-w-[84rem] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-7 py-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(detailOrder.status)}`}>
                    {getStatusText(detailOrder.status)}
                  </span>
                  <div id={detailDialogTitleId} className="truncate text-xl font-semibold text-slate-950">
                    {canViewCustomerData ? detailOrder.customer.name || "未命名客户" : "客户"}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span>{`订单号: ${detailOrder.id}`}</span>
                  <span>{`下单时间: ${formatDateTime(detailOrder.createdAt)}`}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canOpenOwnerEnterpriseTask ? (
                  <button
                    type="button"
                    className="rounded border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[13px] font-semibold leading-5 text-cyan-800 hover:bg-cyan-100"
                    onClick={() => void openDetailEnterpriseTask(detailOrder)}
                    disabled={Boolean(busyKey)}
                  >
                    创建/查看企业任务
                  </button>
                ) : null}
                {renderOrderActions(detailOrder, { persistDetailDraft: true })}
                <button
                  ref={detailCloseButtonRef}
                  type="button"
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  onClick={closeDetailDialog}
                  disabled={Boolean(busyKey)}
                  data-mobile-swipe-back-control="true"
                >
                  关闭
                </button>
              </div>
            </div>

            {canUpdateOrderItems && (detailHasQuantityDraftChanges || detailDraftConflict) ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-7 py-3 text-sm text-amber-900" role="status">
                <span>
                  {detailDraftConflict || "商品数量有尚未保存的修改。确认或完成订单时会一并保存。"}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-amber-400 bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    onClick={() => void saveDetailOrderItems(detailOrder)}
                    disabled={Boolean(busyKey) || Boolean(detailDraftConflict)}
                  >
                    {busyKey === `items:${detailOrder.id}` ? "保存中" : "保存商品数量"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:opacity-50"
                    onClick={discardDetailQuantityDrafts}
                    disabled={Boolean(busyKey)}
                  >
                    放弃修改并加载最新
                  </button>
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.85fr)]">
                <div className="space-y-3">
                  <div className="flex h-[min(72vh,58rem)] min-h-[24rem] max-h-[calc(90vh-12rem)] flex-col rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">商品明细</div>
                    <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                      {detailPreviewEntries.length === 0 ? (
                        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                          该订单当前没有商品。
                        </div>
                      ) : null}
                      {detailPreviewEntries.map(({ item, index, quantity, subtotal }) => {
                        const itemDraftKey = getDetailItemDraftKey(detailOrder.id, index);
                        const draftQuantity = detailQuantityDrafts[itemDraftKey] ?? String(quantity);
                        const isDetailActionBusy =
                          busyKey.endsWith(`:${detailOrder.id}`) ||
                          !canUpdateOrderItems ||
                          detailOrder.status === "completed" ||
                          detailOrder.status === "cancelled";
                        return (
                          <div
                            key={`${detailOrder.id}-${item.productId}-${item.code}-${index}`}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                  {item.code ? (
                                    <span className="text-xs uppercase tracking-[0.18em] text-slate-400">{item.code}</span>
                                  ) : null}
                                  <div className="break-words text-sm font-semibold text-slate-900">{item.name || "未命名产品"}</div>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-3">
                                <div className="text-sm font-semibold text-sky-700">
                                  {formatMerchantOrderAmount(subtotal, detailOrder.pricePrefix)}
                                </div>
                                <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-1 shadow-sm">
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => stepDetailItemQuantity(detailOrder, index, -1)}
                                    disabled={isDetailActionBusy}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    className="h-8 w-14 rounded-full border border-slate-200 bg-white px-2 text-center text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
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
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                </div>

                <div className="space-y-3">
                  {canViewCustomerData ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">客户信息</div>
                    <div className="mt-3 grid gap-3 text-sm text-slate-600">
                      <div>
                        <span className="text-slate-400">姓名：</span>
                        {detailOrder.customer.name || "-"}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">邮箱：</span>
                        <span className="min-w-0 flex-1 break-all">{detailOrder.customer.email || "-"}</span>
                        {detailOrder.customer.email ? (
                          <a
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
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
                        <span className="text-slate-400">电话：</span>
                        <span className="min-w-0 flex-1 break-all">{detailOrder.customer.phone || "-"}</span>
                        {detailOrder.customer.phone ? (
                          <a
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
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
                      <div className="grid gap-1">
                        <span className="text-slate-400">备注：</span>
                        <div className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-700">
                          {detailOrder.customer.note || "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      当前角色无权查看客户联系方式和备注。
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between text-sm text-slate-500">
                      <span>商品数量</span>
                      <span>{detailPreviewTotalQuantity}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-lg font-semibold text-slate-900">
                      <span>订单合计</span>
                      <span>{formatMerchantOrderAmount(detailPreviewTotalAmount, detailOrder.pricePrefix)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
      )
    : null;

  const content = (
    <div className={isInline ? "w-full py-6" : "max-h-[88vh] overflow-hidden rounded-[28px]"}>
      <div
        className={`flex min-h-[540px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white ${
          isInline ? "max-h-none shadow-[0_12px_32px_rgba(15,23,42,0.05)]" : "max-h-[88vh] shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
        }`}
      >
        <div
          className={`${
            isInline ? "bg-white" : ""
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-5">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <div id={managerDialogTitleId} className="text-[26px] font-bold leading-8 text-slate-950">订单管理</div>
                {canOpenWorkbench ? (
                <button
                  type="button"
                  className={hideWorkbenchButton ? "hidden" : workbenchButtonClassName}
                  onClick={() => setWorkbenchOpen(true)}
                >
                  工作台
                </button>
                ) : null}

                <label className={toolbarSelectClassName}>
                  <span className="whitespace-nowrap text-xs font-medium text-slate-500">排序</span>
                  <div className={toolbarSelectFieldClassName}>
                    <select
                      className={toolbarSelectInputClassName}
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value as MerchantOrderSortMode)}
                    >
                      {MERCHANT_ORDER_SORT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {getOrderSortOptionText(option)}
                        </option>
                      ))}
                    </select>
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                      className={toolbarSelectChevronClassName}
                    >
                      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </label>

                <label className={toolbarSelectClassName}>
                  <span className="whitespace-nowrap text-xs font-medium text-slate-500">隐藏</span>
                  <div className={toolbarSelectFieldClassName}>
                    <select
                      className={toolbarSelectInputClassName}
                      value={historyVisibility}
                      onChange={(event) => setHistoryVisibility(event.target.value as MerchantOrderHistoryVisibility)}
                    >
                      {MERCHANT_ORDER_HISTORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {getOrderHistoryVisibilityText(option)}
                        </option>
                      ))}
                    </select>
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                      className={toolbarSelectChevronClassName}
                    >
                      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </label>

                {canManageOrderStatus ? (
                <button
                  type="button"
                  className={compactBatchButtonClassName}
                  onClick={() => setSelectionMode((current) => !current)}
                >
                  {selectionMode ? "完成批量" : "批量"}
                </button>
                ) : null}
              </div>
            </div>

            {!isInline && showCloseButton ? (
              <button
                ref={managerCloseButtonRef}
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                onClick={requestDialogClose}
                aria-label="关闭订单管理"
                disabled={Boolean(busyKey)}
                data-mobile-swipe-back-control="true"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="space-y-3 border-b border-slate-200 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                placeholder="搜索订单号 / 客户 / 产品"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <OrderStatusFilterDropdown
                  counts={counts}
                  selectedStatuses={selectedStatuses}
                  onPress={() => setFilter("all")}
                  onChange={(statuses) => {
                    setSelectedStatuses(statuses);
                    setFilter("all");
                  }}
                />
                {MERCHANT_ORDER_STATUSES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`inline-flex h-10 items-center justify-center rounded-full px-3 py-2 text-sm font-semibold transition-colors ${getFilterChipClass(filter, key)}`}
                    onClick={() => {
                      setFilter(key);
                      if (!selectedStatuses.includes(key)) {
                        setSelectedStatuses((current) => [...current, key]);
                      }
                    }}
                  >
                    {key === "pending"
                      ? `待确认 ${counts.pending}`
                      : key === "confirmed"
                        ? `已确认 ${counts.confirmed}`
                        : key === "completed"
                          ? `已完成 ${counts.completed}`
                          : `已取消 ${counts.cancelled}`}
                  </button>
                ))}
              </div>
            </div>

            {canManageOrderStatus && selectionMode ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
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
                      onClick={() => void runBatchOrderStatusUpdate("confirmed", "confirm")}
                      disabled={busyKey.startsWith("batch:")}
                    >
                      {busyKey === "batch:confirm" ? "处理中" : "批量确认"}
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                      onClick={() => void runBatchOrderStatusUpdate("cancelled", "cancel")}
                      disabled={busyKey.startsWith("batch:")}
                    >
                      {busyKey === "batch:cancel" ? "处理中" : "批量取消"}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {!canViewOrders ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                当前角色没有查看订单的权限。
              </div>
            ) : loading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                正在读取订单...
              </div>
            ) : filteredRecords.length > 0 ? (
              <>
              {renderedRecords.map((record) => {
                const canOpenConversation = canViewCustomerData && Boolean(record.customerAccountId || record.customerLoginEmail);
                const displayName = canViewCustomerData
                  ? record.customer.name || "未命名客户"
                  : "客户";
                return (
                  <div
                    key={record.id}
                    className={selectionMode ? "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3" : undefined}
                  >
                    {selectionMode ? (
                      <label className="mt-4 inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white shadow-sm transition hover:border-slate-500">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selectedRecordSet.has(record.id)}
                          onChange={() => toggleSelectedOrder(record.id)}
                          aria-label="Select order"
                        />
                        <span
                          className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
                            selectedRecordSet.has(record.id)
                              ? "border-slate-950 bg-slate-950 text-white"
                              : "border-slate-300 bg-white"
                          }`}
                          aria-hidden="true"
                        >
                          {selectedRecordSet.has(record.id) ? (
                            <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
                              <path d="m3.5 8.2 2.7 2.7 6.3-6.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : null}
                        </span>
                      </label>
                    ) : null}
                    <article
                      className="relative overflow-visible rounded-[22px] border border-slate-200 bg-slate-50/80 p-3.5 shadow-sm"
                      onClick={(event) => handleSelectionCardClick(event, record.id)}
                    >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-5 gap-y-2">
                        <div className="min-w-[240px] flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${getStatusBadgeClass(record.status)}`}>
                              {getStatusText(record.status)}
                            </span>
                            <div className="truncate text-base font-semibold text-slate-900">{displayName}</div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>{`订单号: ${record.id}`}</span>
                            <span>{`下单时间: ${formatDateTime(record.createdAt)}`}</span>
                          </div>
                        </div>
                        {canViewCustomerData && (record.customerAccountId || canOpenConversation || record.customer.email || record.customer.phone) ? (
                          <div className="grid min-w-[580px] grid-cols-[5.75rem_2rem_minmax(12rem,1fr)_2rem_9rem_2rem] items-center gap-2 text-[13px] leading-5 text-slate-700">
                            <span
                              className={`inline-flex h-8 w-[5.75rem] items-center justify-center rounded-full bg-white px-2 text-xs font-semibold text-slate-600 shadow-sm ${record.customerAccountId ? "" : "invisible"}`}
                              aria-hidden={!record.customerAccountId}
                            >
                              {record.customerAccountId || "00000000"}
                            </span>
                            {canOpenConversation ? (
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800"
                                onClick={() => void openListConversation(record.id)}
                                disabled={Boolean(busyKey)}
                                title="打开与客户的会话"
                                aria-label="打开与客户的会话"
                                data-skip-selection-toggle="true"
                              >
                                <ChatIcon />
                              </button>
                            ) : (
                              <span className="h-8 w-8" aria-hidden="true" />
                            )}
                            <span className="min-w-0 truncate text-right">{record.customer.email || "-"}</span>
                            {record.customer.email ? (
                              <a
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-sm transition hover:opacity-90"
                                href={`mailto:${record.customer.email}`}
                              onClick={() => {
                                void markOrderTouched(record.id);
                              }}
                              title="发送邮件"
                              aria-label="发送邮件"
                              data-skip-selection-toggle="true"
                            >
                              <MailIcon />
                              </a>
                            ) : (
                              <span className="h-8 w-8" aria-hidden="true" />
                            )}
                            <span className="min-w-0 truncate text-right">{record.customer.phone || "-"}</span>
                            {record.customer.phone ? (
                              <a
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#007AFF] text-white shadow-sm transition hover:bg-[#0066D6]"
                                href={`tel:${record.customer.phone}`}
                                onClick={() => {
                                  void markOrderTouched(record.id);
                                }}
                                title="拨打电话"
                                aria-label="拨打电话"
                                data-skip-selection-toggle="true"
                              >
                                <PhoneIcon />
                              </a>
                            ) : (
                              <span className="h-8 w-8" aria-hidden="true" />
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <div className="text-right text-lg font-semibold text-slate-900">
                          {formatMerchantOrderAmount(record.totalAmount, record.pricePrefix)}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {renderStatusActions(record)}
                          <button
                            type="button"
                            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-[13px] leading-5 text-slate-700 hover:bg-slate-50"
                            onClick={() => openDetailDialog(record)}
                            data-skip-selection-toggle="true"
                          >
                            详情
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                  </div>
                );
              })}
              {filteredRecords.length > renderedRecords.length || hasMoreRemoteRecords ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-4 text-center text-sm text-slate-500">
                  <div>当前筛选结果 {filteredRecords.length} 条，已显示 {renderedRecords.length} 条。</div>
                  <button
                    type="button"
                    className="mt-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => {
                      if (filteredRecords.length > renderedRecords.length) {
                        setRenderLimit((current) => current + MERCHANT_ORDER_RENDER_LIMIT);
                        return;
                      }
                      void loadMoreOrders();
                    }}
                    disabled={loadingMoreRecords}
                  >
                    显示更多
                  </button>
                </div>
              ) : null}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                还没有匹配到订单。
              </div>
            )}
          </div>
        </div>
      </div>
      {workbenchDialog}
      {detailDialog}
    </div>
  );

  if (!open) return null;
  if (isInline) return content;
  return overlay(
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/55 p-4" onClick={requestDialogClose}>
      <div
        ref={managerDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={managerDialogTitleId}
        tabIndex={-1}
        className={`w-full max-w-6xl ${className}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        {content}
      </div>
    </div>,
  );
}
