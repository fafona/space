"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import MerchantCatalogManagerPanel, {
  type MerchantCatalogLeaveState,
} from "@/components/admin/MerchantCatalogManagerPanel";
import type { MerchantCatalogTarget } from "@/lib/merchantCatalog";
import {
  formatMerchantOrderAmount,
  getMerchantOrderErrorMessage,
  normalizeMerchantOrderRecord,
  normalizeMerchantOrderRecords,
  type MerchantOrderAction,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";
import {
  getMerchantOrderPrintAttemptText,
  MERCHANT_ORDER_PRINT_STARTED_TEXT,
  prepareMerchantOrderPrintWindow,
  startMerchantOrderPrint,
} from "@/lib/merchantOrderPrint";
import type {
  MerchantOrderWorkbenchDashboard,
  MerchantOrderWorkbenchTodo,
} from "@/lib/merchantOrderWorkbench";
import { MOBILE_SWIPE_BACK_EVENT } from "@/lib/mobileSwipeBack";

export type OrderWorkbenchView = "overview" | "orders" | "analysis" | "catalog" | "export";

export function getOrderWorkbenchContentScrollClassName(mode: "inline" | "overlay") {
  return `min-h-0 flex-1 overflow-y-auto${mode === "overlay" ? " overscroll-contain" : ""}`;
}

export type OrderWorkbenchPanelProps = {
  siteId: string;
  mode?: "inline" | "overlay";
  initialView?: OrderWorkbenchView;
  catalogTarget?: MerchantCatalogTarget | null;
  darkMode?: boolean;
  onClose?: () => void;
  onOpenOrder: (orderId: string) => void | Promise<void>;
  onContactOrder?: (orderId: string) => void | Promise<void>;
  onOpenEnterpriseTask?: (orderId: string) => void | Promise<void>;
  onStatusFilter: (status: MerchantOrderStatus) => void;
  onChanged?: () => void | Promise<void>;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
};

type WorkbenchApiPayload = {
  ok?: boolean;
  dashboard?: unknown;
  error?: string;
  message?: string;
  order?: unknown;
  orders?: unknown;
  offset?: unknown;
  limit?: unknown;
  hasMore?: unknown;
};

type OrderListStatusFilter = "all" | MerchantOrderStatus;

type WorkbenchOrderAction = Extract<
  MerchantOrderAction,
  "confirm" | "complete" | "cancel" | "restore" | "uncomplete"
>;

type WorkbenchOrderMutationAction = WorkbenchOrderAction | "print";

type OrderMutationState = {
  orderId: string;
  action: WorkbenchOrderMutationAction;
};

type OrderIntentState = {
  orderId: string;
  kind: "contact" | "task" | "full";
};

type TodoGroup = {
  orderId: string;
  status: MerchantOrderStatus;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  totalAmount: number;
  pricePrefix: string;
  note: string;
  todos: MerchantOrderWorkbenchTodo[];
};

type MetricCard = {
  key: string;
  label: string;
  value: number;
  description: string;
  tone: "amber" | "rose" | "sky" | "violet" | "emerald" | "slate";
  status?: MerchantOrderStatus;
};

const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useDialogFocusTrap(containerRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
      );
    (getFocusable()[0] ?? container).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest<HTMLElement>("[data-order-focus-trap]") !== container) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [containerRef, enabled]);
}

type OrderExportApiPayload = {
  error?: string;
  message?: string;
};

type PendingOrderExportShare = {
  siteId: string;
  requestSequence: number;
  file: File;
};

const ORDER_EXPORT_STATUSES: Array<{ value: MerchantOrderStatus; label: string }> = [
  { value: "pending", label: "待确认" },
  { value: "confirmed", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

const ORDER_EXPORT_MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1_000;
const CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE = "当前App版本暂不能保存CSV，请在浏览器后台导出";
const ORDER_LIST_WINDOW_LIMIT = 100;

function isCapacitorAndroidRuntime() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") return true;
  } catch {
    // Fall through to the bridge markers used by the remote admin shell.
  }
  const capacitor = (window as Window & {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }).Capacitor;
  const native =
    capacitor?.isNativePlatform?.() === true || document.documentElement.dataset.capacitor === "true";
  const platform =
    capacitor?.getPlatform?.().trim().toLowerCase() ||
    String(document.documentElement.dataset.capacitorPlatform ?? "").trim().toLowerCase();
  return native && platform === "android";
}

function canShareOrderExportFile(file: File) {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function formatLocalDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDefaultOrderExportRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  return { startDate: formatLocalDateInput(start), endDate: formatLocalDateInput(today) };
}

function parseLocalDateInput(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function getOrderExportFilename(response: Response) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      const decoded = decodeURIComponent(encoded).replace(/[\\/:*?"<>|]+/g, "-").trim();
      if (decoded) return decoded;
    } catch {
      // Fall back to the ASCII filename below.
    }
  }
  const ascii = /filename="?([^";]+)"?/i.exec(disposition)?.[1]?.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return ascii || `orders-${new Date().toISOString().slice(0, 10)}.csv`;
}

function getOrderExportError(payload: OrderExportApiPayload | null, status: number) {
  if (payload?.message?.trim()) return payload.message.trim();
  if (status === 413) return "符合条件的订单过多或文件过大，请缩短日期范围后重试。";
  if (status === 401) return "登录状态已失效，请刷新后台后重试。";
  if (status === 403) return "当前账号没有导出该商户订单的权限。";
  if (status === 503) return "订单数据暂时不可用，请稍后重试。";
  if (
    payload?.error === "invalid_order_export_range" ||
    payload?.error === "order_export_range_too_large"
  ) return "日期范围无效，单次最多导出 366 天。";
  if (payload?.error === "invalid_order_export_statuses") return "请至少选择一种订单状态。";
  return "订单导出失败，请稍后重试。";
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`}
    >
      <path
        d="M16 7a6.5 6.5 0 1 0 .2 5.4M16 3v4h-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m4.5 10 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function TaskIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="4" y="3.5" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="m7 8 1.2 1.2L10.5 7M7 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDateTime(value: string) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(stamp));
}

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  if (safeMinutes < 60) return `${safeMinutes} 分钟`;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours < 24) return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} 天 ${remainingHours} 小时` : `${days} 天`;
}

function formatTimezoneOffset(minutes: number) {
  const normalized = Number.isFinite(minutes) ? Math.round(minutes) : 0;
  const sign = normalized >= 0 ? "+" : "-";
  const absolute = Math.abs(normalized);
  const hours = Math.floor(absolute / 60);
  const remainingMinutes = absolute % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
}

function getStatusLabel(status: MerchantOrderStatus) {
  if (status === "confirmed") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "cancelled") return "已取消";
  return "待确认";
}

function getTodoLabel(todo: MerchantOrderWorkbenchTodo, dashboard: MerchantOrderWorkbenchDashboard) {
  if (todo.kind === "pending_confirmation") return "等待确认";
  if (todo.kind === "processing") return "处理中";
  if (todo.kind === "confirmation_overdue") {
    const overdue = Math.max(0, todo.ageMinutes - dashboard.thresholds.confirmationOverdueMinutes);
    return overdue > 0 ? `确认超时 ${formatDuration(overdue)}` : "刚达到确认时限";
  }
  if (todo.kind === "processing_overdue") {
    const overdue = Math.max(0, todo.ageMinutes - dashboard.thresholds.processingOverdueMinutes);
    return overdue > 0 ? `处理超时 ${formatDuration(overdue)}` : "刚达到处理时限";
  }
  return "客户有备注";
}

function getMetricToneClass(tone: MetricCard["tone"], darkMode: boolean) {
  if (tone === "amber") {
    return darkMode
      ? "border-amber-400/25 bg-amber-400/10 text-amber-100 hover:border-amber-300/50"
      : "border-amber-200 bg-amber-50 text-amber-950 hover:border-amber-300";
  }
  if (tone === "rose") {
    return darkMode
      ? "border-rose-400/25 bg-rose-400/10 text-rose-100 hover:border-rose-300/50"
      : "border-rose-200 bg-rose-50 text-rose-950 hover:border-rose-300";
  }
  if (tone === "sky") {
    return darkMode
      ? "border-sky-400/25 bg-sky-400/10 text-sky-100 hover:border-sky-300/50"
      : "border-sky-200 bg-sky-50 text-sky-950 hover:border-sky-300";
  }
  if (tone === "violet") {
    return darkMode
      ? "border-violet-400/25 bg-violet-400/10 text-violet-100 hover:border-violet-300/50"
      : "border-violet-200 bg-violet-50 text-violet-950 hover:border-violet-300";
  }
  if (tone === "emerald") {
    return darkMode
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100 hover:border-emerald-300/50"
      : "border-emerald-200 bg-emerald-50 text-emerald-950 hover:border-emerald-300";
  }
  return darkMode
    ? "border-slate-600 bg-slate-800/80 text-slate-100 hover:border-slate-500"
    : "border-slate-200 bg-white text-slate-900 hover:border-slate-300";
}

function getStatusBadgeClass(status: MerchantOrderStatus, darkMode: boolean) {
  if (status === "confirmed") {
    return darkMode
      ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
      : "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "completed") {
    return darkMode
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "cancelled") {
    return darkMode
      ? "border-slate-500/40 bg-slate-500/10 text-slate-300"
      : "border-slate-200 bg-slate-100 text-slate-600";
  }
  return darkMode
    ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function getApiError(payload: WorkbenchApiPayload | null, fallback: string) {
  return getMerchantOrderErrorMessage(payload?.message || payload?.error || fallback);
}

function getOrderActionLabel(action: WorkbenchOrderAction) {
  if (action === "confirm") return "确认订单";
  if (action === "complete") return "完成订单";
  if (action === "cancel") return "取消订单";
  if (action === "restore") return "恢复待确认";
  return "恢复处理中";
}

function getOrderActionSuccessMessage(action: WorkbenchOrderAction) {
  if (action === "confirm") return "订单已确认并进入处理阶段。";
  if (action === "complete") return "订单已完成，相关会员权益处理已同步。";
  if (action === "cancel") return "订单已取消。";
  if (action === "restore") return "订单已恢复为待确认。";
  return "订单已恢复为处理中。";
}

function getOrderActionConfirmation(action: WorkbenchOrderAction) {
  if (action === "complete") {
    return "完成订单会处理相关会员权益，并可能自动发放积分或成长值。之后回退时，已被使用的积分可能导致回退失败。确定完成该订单吗？";
  }
  if (action === "cancel") return "确定取消该订单吗？请先核对客户备注和商品明细。";
  if (action === "restore") return "确定把该订单恢复为待确认吗？";
  if (action === "uncomplete") return "确定把该订单从已完成恢复为处理中吗？相关会员权益回退可能失败。";
  return "";
}

function getAvailableOrderActions(status: MerchantOrderStatus): WorkbenchOrderAction[] {
  if (status === "pending") return ["confirm", "cancel"];
  if (status === "confirmed") return ["complete", "cancel"];
  if (status === "completed") return ["uncomplete", "cancel"];
  return ["restore"];
}

function getOrderSearchText(order: MerchantOrderRecord) {
  return [
    order.id,
    order.customer.name,
    order.customer.phone,
    order.customer.email,
    order.customer.note,
    order.customerLoginEmail,
    ...order.items.flatMap((item) => [item.name, item.code, item.tag, item.description]),
  ]
    .join("\n")
    .toLowerCase();
}

function mergeOrderWindows(current: MerchantOrderRecord[], nextWindow: MerchantOrderRecord[]) {
  const byId = new Map(current.map((order) => [order.id, order]));
  nextWindow.forEach((order) => byId.set(order.id, order));
  return [...byId.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function fetchExactMerchantOrder(siteId: string, orderId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ siteId, orderId });
  const response = await fetch(`/api/orders?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const payload = (await response.json().catch(() => null)) as WorkbenchApiPayload | null;
  const order = normalizeMerchantOrderRecord(
    payload?.order && typeof payload.order === "object"
      ? (payload.order as Partial<MerchantOrderRecord>)
      : {},
  );
  if (!response.ok || !payload?.ok || !order) {
    throw new Error(getApiError(payload, "订单详情读取失败，请稍后重试。"));
  }
  if (order.siteId !== siteId || order.id !== orderId) {
    throw new Error("订单详情与当前商户不匹配，请刷新后重试。");
  }
  return order;
}

function isMerchantOrderWorkbenchDashboard(value: unknown): value is MerchantOrderWorkbenchDashboard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MerchantOrderWorkbenchDashboard>;
  const analytics = candidate.analytics;
  return Boolean(
    candidate.summary &&
      candidate.thresholds &&
      Array.isArray(candidate.amounts) &&
      Array.isArray(candidate.todos) &&
      analytics &&
      Array.isArray(analytics.dailyTrend) &&
      analytics.statusDistribution &&
      analytics.recent30Days &&
      Array.isArray(analytics.topProducts) &&
      Array.isArray(analytics.averageOrderAmounts),
  );
}

function LoadingSkeleton({ darkMode }: { darkMode: boolean }) {
  const blockClassName = darkMode ? "bg-slate-800" : "bg-slate-200";
  return (
    <div className="animate-pulse space-y-6" aria-label="正在加载订单工作台">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className={`h-28 rounded-2xl ${blockClassName}`} />
        ))}
      </div>
      <div className={`h-28 rounded-2xl ${blockClassName}`} />
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={`h-36 rounded-2xl ${blockClassName}`} />
        ))}
      </div>
    </div>
  );
}

function OrderWorkbenchAnalysis({
  dashboard,
  darkMode,
  onStatusFilter,
}: {
  dashboard: MerchantOrderWorkbenchDashboard;
  darkMode: boolean;
  onStatusFilter: (status: MerchantOrderStatus) => void;
}) {
  const analysisId = useId();
  const { analytics } = dashboard;
  const trendMaximum = Math.max(
    1,
    ...analytics.dailyTrend.flatMap((entry) => [entry.createdCount, entry.completedCount, entry.cancelledCount]),
  );
  const productMaximum = Math.max(1, ...analytics.topProducts.map((product) => product.quantity));
  const surfaceClassName = darkMode
    ? "border-slate-700/80 bg-slate-900/80"
    : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const statusEntries: Array<{
    status: MerchantOrderStatus;
    label: string;
    count: number;
    tone: string;
    bar: string;
  }> = [
    {
      status: "pending",
      label: "待确认",
      count: analytics.statusDistribution.pending,
      tone: darkMode
        ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
        : "border-amber-200 bg-amber-50 text-amber-900",
      bar: "bg-amber-500",
    },
    {
      status: "confirmed",
      label: "处理中",
      count: analytics.statusDistribution.confirmed,
      tone: darkMode
        ? "border-sky-400/25 bg-sky-400/10 text-sky-100"
        : "border-sky-200 bg-sky-50 text-sky-900",
      bar: "bg-sky-500",
    },
    {
      status: "completed",
      label: "已完成",
      count: analytics.statusDistribution.completed,
      tone: darkMode
        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
        : "border-emerald-200 bg-emerald-50 text-emerald-900",
      bar: "bg-emerald-500",
    },
    {
      status: "cancelled",
      label: "已取消",
      count: analytics.statusDistribution.cancelled,
      tone: darkMode
        ? "border-rose-400/25 bg-rose-400/10 text-rose-100"
        : "border-rose-200 bg-rose-50 text-rose-900",
      bar: "bg-rose-500",
    },
  ];

  if (dashboard.summary.total === 0) {
    return (
      <div className="space-y-4">
        <div
          className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
            darkMode
              ? "border-sky-400/25 bg-sky-400/10 text-sky-100"
              : "border-sky-200 bg-sky-50 text-sky-800"
          }`}
        >
          经营分析基于订单记录和账面金额，不代表支付收入、实付金额或退款结果。
        </div>
        <div className={`rounded-2xl border border-dashed px-5 py-14 text-center ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <p className="text-sm font-bold">暂无可分析的订单记录</p>
          <p className={`mt-2 text-xs leading-5 ${mutedTextClassName}`}>产生订单后，这里会显示趋势、状态、商品和账面金额分析。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
          darkMode
            ? "border-sky-400/25 bg-sky-400/10 text-sky-100"
            : "border-sky-200 bg-sky-50 text-sky-800"
        }`}
      >
        <strong>统计口径：</strong>以下数据来自订单记录和账面金额，不代表支付收入、实付金额或退款结果；不同价格前缀不合并。
      </div>

      <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby={`${analysisId}-trend-title`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id={`${analysisId}-trend-title`} className="text-sm font-bold sm:text-base">近 14 日订单趋势</h3>
            <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>按工作台时区统计创建、完成和取消记录</p>
          </div>
          <div className={`flex flex-wrap gap-3 text-[11px] ${mutedTextClassName}`} aria-label="趋势图图例">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />创建</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />完成</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />取消</span>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto pb-2">
          <div
            className="grid min-w-[42rem] gap-2"
            style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}
          >
            {analytics.dailyTrend.map((entry) => (
              <div
                key={entry.date}
                className="min-w-0 text-center"
                role="img"
                aria-label={`${entry.date}：创建 ${entry.createdCount}，完成 ${entry.completedCount}，取消 ${entry.cancelledCount}`}
              >
                <div aria-hidden="true" className={`flex h-32 items-end justify-center gap-1 rounded-lg px-1 pt-2 ${darkMode ? "bg-slate-950/60" : "bg-slate-50"}`}>
                  {([
                    [entry.createdCount, "bg-sky-500"],
                    [entry.completedCount, "bg-emerald-500"],
                    [entry.cancelledCount, "bg-rose-500"],
                  ] as const).map(([count, color], index) => (
                    <span
                      key={index}
                      className={`w-2.5 rounded-t-sm ${color} ${count === 0 ? "opacity-20" : ""}`}
                      style={{ height: count === 0 ? "2px" : `${Math.max(8, (count / trendMaximum) * 100)}%` }}
                      title={`${index === 0 ? "创建" : index === 1 ? "完成" : "取消"} ${count}`}
                    />
                  ))}
                </div>
                <p aria-hidden="true" className={`mt-1.5 text-[11px] font-semibold ${mutedTextClassName}`}>{entry.date.slice(5).replace("-", "/")}</p>
                <p aria-hidden="true" className={`mt-0.5 whitespace-nowrap text-[11px] tabular-nums ${mutedTextClassName}`}>
                  {entry.createdCount}/{entry.completedCount}/{entry.cancelledCount}
                </p>
              </div>
            ))}
          </div>
        </div>
        {analytics.dailyTrend.every(
          (entry) => entry.createdCount === 0 && entry.completedCount === 0 && entry.cancelledCount === 0,
        ) ? (
          <p className={`mt-2 text-center text-xs ${mutedTextClassName}`}>近 14 日暂无创建、完成或取消记录</p>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby={`${analysisId}-status-title`}>
          <h3 id={`${analysisId}-status-title`} className="text-sm font-bold sm:text-base">全量订单状态分布</h3>
          <p className={`mt-1 text-xs ${mutedTextClassName}`}>点击状态进入对应订单列表</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {statusEntries.map((entry) => {
              const percentage = dashboard.summary.total > 0 ? (entry.count / dashboard.summary.total) * 100 : 0;
              return (
                <button
                  key={entry.status}
                  type="button"
                  onClick={() => onStatusFilter(entry.status)}
                  className={`rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${entry.tone}`}
                  aria-label={`查看${entry.label}订单，共 ${entry.count} 笔`}
                >
                  <span className="text-xs font-semibold opacity-75">{entry.label}</span>
                  <span className="mt-1 block text-2xl font-black tabular-nums">{entry.count}</span>
                  <span className={`mt-2 block h-1.5 overflow-hidden rounded-full ${darkMode ? "bg-slate-800" : "bg-white/80"}`}>
                    <span className={`block h-full rounded-full ${entry.bar}`} style={{ width: `${percentage}%` }} />
                  </span>
                  <span className="mt-1 block text-[11px] opacity-65">占全部订单 {percentage.toFixed(1)}%</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby={`${analysisId}-recent-title`}>
          <h3 id={`${analysisId}-recent-title`} className="text-sm font-bold sm:text-base">近 30 日订单记录</h3>
          <p className={`mt-1 text-xs ${mutedTextClassName}`}>今天及此前 29 个日历日</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              ["创建", analytics.recent30Days.createdCount, "text-sky-500"],
              ["完成", analytics.recent30Days.completedCount, "text-emerald-500"],
              ["取消", analytics.recent30Days.cancelledCount, "text-rose-500"],
            ].map(([label, count, color]) => (
              <div key={String(label)} className={`rounded-2xl border px-3 py-4 text-center ${darkMode ? "border-slate-700 bg-slate-950/55" : "border-slate-100 bg-slate-50"}`}>
                <p className={`text-xs font-semibold ${mutedTextClassName}`}>{label}</p>
                <p className={`mt-2 text-2xl font-black tabular-nums sm:text-3xl ${color}`}>{count}</p>
                <p className={`mt-1 text-[11px] ${mutedTextClassName}`}>笔订单记录</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby={`${analysisId}-products-title`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`${analysisId}-products-title`} className="text-sm font-bold sm:text-base">Top 8 商品</h3>
              <p className={`mt-1 text-xs ${mutedTextClassName}`}>按全部未取消订单中的商品数量排序</p>
            </div>
            <span className={`text-xs ${mutedTextClassName}`}>{analytics.topProducts.length} 个商品</span>
          </div>
          {analytics.topProducts.length > 0 ? (
            <div className="mt-4 space-y-3">
              {analytics.topProducts.map((product, index) => (
                <div key={product.productId}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-semibold" title={product.name || product.productId}>
                      {index + 1}. {product.name || product.productId}
                    </span>
                    <span className={`shrink-0 tabular-nums ${mutedTextClassName}`}>
                      {product.quantity} 件 · {product.orderCount} 笔订单
                    </span>
                  </div>
                  <div className={`mt-1.5 h-2 overflow-hidden rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${(product.quantity / productMaximum) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
              暂无未取消订单的商品记录
            </p>
          )}
        </section>

        <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby={`${analysisId}-average-title`}>
          <h3 id={`${analysisId}-average-title`} className="text-sm font-bold sm:text-base">平均订单账面金额</h3>
          <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>包含全部未取消订单，按 pricePrefix 分组，不跨前缀合计</p>
          {analytics.averageOrderAmounts.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {analytics.averageOrderAmounts.map((amount, index) => (
                <div key={`${amount.pricePrefix}:${index}`} className={`rounded-2xl border px-4 py-4 ${darkMode ? "border-slate-700 bg-slate-950/55" : "border-slate-100 bg-slate-50"}`}>
                  <p className={`truncate text-xs font-semibold ${mutedTextClassName}`}>{amount.pricePrefix || "未设置价格前缀"}</p>
                  <p className="mt-2 text-xl font-black tabular-nums">{formatMerchantOrderAmount(amount.averageOrderAmount, amount.pricePrefix)}</p>
                  <p className={`mt-1 text-[11px] ${mutedTextClassName}`}>基于 {amount.orderCount} 笔未取消订单</p>
                </div>
              ))}
            </div>
          ) : (
            <p className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
              暂无可计算平均账面金额的订单
            </p>
          )}
        </section>
      </div>

      <footer className={`border-t pt-4 text-xs leading-5 ${darkMode ? "border-slate-800" : "border-slate-200"} ${mutedTextClassName}`}>
        数据生成于 {formatDateTime(dashboard.generatedAt)} · 所有日历日均按固定 {formatTimezoneOffset(dashboard.timezoneOffsetMinutes)} 偏移计算
      </footer>
    </div>
  );
}

function OrderExportPanel({ siteId, darkMode }: { siteId: string; darkMode: boolean }) {
  const [range, setRange] = useState(getDefaultOrderExportRange);
  const [statuses, setStatuses] = useState<MerchantOrderStatus[]>(() =>
    ORDER_EXPORT_STATUSES.map((item) => item.value),
  );
  const [includeCustomerData, setIncludeCustomerData] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [capacitorAndroid, setCapacitorAndroid] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingOrderExportShare | null>(null);
  const [sharing, setSharing] = useState(false);
  const requestSequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const activeSiteIdRef = useRef(siteId.trim());
  activeSiteIdRef.current = siteId.trim();
  const sectionTitleId = useId();

  useEffect(() => {
    setCapacitorAndroid(isCapacitorAndroidRuntime());
  }, []);

  useEffect(() => {
    requestSequenceRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setExporting(false);
    setError("");
    setNotice("");
    setIncludeCustomerData(false);
    setPendingShare(null);
    setSharing(false);
  }, [siteId]);

  useEffect(
    () => () => {
      requestSequenceRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  const invalidatePendingShareForFilterChange = () => {
    if (!pendingShare) return;
    setPendingShare(null);
    setError("");
    setNotice("导出条件已变化，原 CSV 已失效；请按当前条件重新生成后再分享。");
  };

  const toggleStatus = (status: MerchantOrderStatus) => {
    invalidatePendingShareForFilterChange();
    setStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  };

  const submitExport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (exporting || sharing) return;
    const normalizedSiteId = activeSiteIdRef.current;
    const start = parseLocalDateInput(range.startDate);
    const end = parseLocalDateInput(range.endDate);
    if (!normalizedSiteId || !start || !end || start.getTime() > end.getTime()) {
      setError("请选择有效的开始和结束日期，结束日期不能早于开始日期。");
      setNotice("");
      return;
    }
    const endExclusive = new Date(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const exportRangeDurationMs = endExclusive.getTime() - start.getTime();
    if (exportRangeDurationMs > ORDER_EXPORT_MAX_RANGE_MS) {
      setError(
        "按当前设备时区换算后，所选范围超过后端 366×24 小时上限（夏令时可能让 366 个自然日多出 1 小时）。请将结束日期至少提前一天。",
      );
      setNotice("");
      return;
    }
    if (statuses.length === 0) {
      setError("请至少选择一种订单状态。");
      setNotice("");
      return;
    }
    if (isCapacitorAndroidRuntime()) {
      let shareProbe: File;
      try {
        shareProbe = new File([""], "faolla-order-export.csv", { type: "text/csv;charset=utf-8" });
      } catch {
        setError(CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE);
        setNotice("");
        return;
      }
      if (!canShareOrderExportFile(shareProbe)) {
        setError(CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE);
        setNotice("");
        return;
      }
    }
    if (
      includeCustomerData &&
      !window.confirm(
        "导出文件将包含客户姓名、电话、联系邮箱和客户备注。请仅在业务确有需要时保存，并按隐私要求妥善保管。确定继续吗？",
      )
    ) {
      return;
    }
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setExporting(true);
    setError("");
    setNotice("");
    setPendingShare(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const response = await fetch("/api/orders/export", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          siteId: normalizedSiteId,
          createdFrom: start.toISOString(),
          createdToExclusive: endExclusive.toISOString(),
          statuses,
          includeCustomerData,
          timezone,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as OrderExportApiPayload | null;
        throw new Error(getOrderExportError(payload, response.status));
      }
      const blob = await response.blob();
      if (
        requestSequenceRef.current !== requestSequence ||
        activeSiteIdRef.current !== normalizedSiteId
      ) return;
      const fileName = getOrderExportFilename(response);
      if (isCapacitorAndroidRuntime()) {
        let csvFile: File;
        try {
          csvFile = new File([blob], fileName, {
            type: blob.type || "text/csv;charset=utf-8",
            lastModified: Date.now(),
          });
        } catch {
          setError(CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE);
          return;
        }
        if (!canShareOrderExportFile(csvFile)) {
          setError(CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE);
          return;
        }
        setPendingShare({
          siteId: normalizedSiteId,
          requestSequence,
          file: csvFile,
        });
        setNotice("订单汇总 CSV 已生成。请点击“打开系统分享并保存”，再选择文件、云盘或其他应用。");
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setNotice("订单汇总文件已生成并交给当前设备下载；如未自动保存，请检查浏览器下载记录。");
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      if (
        requestSequenceRef.current !== requestSequence ||
        activeSiteIdRef.current !== normalizedSiteId
      ) return;
      setError(requestError instanceof Error ? requestError.message : "订单导出失败，请稍后重试。");
    } finally {
      if (
        requestSequenceRef.current === requestSequence &&
        activeSiteIdRef.current === normalizedSiteId
      ) {
        controllerRef.current = null;
        setExporting(false);
      }
    }
  };

  const sharePendingExport = async () => {
    const pending = pendingShare;
    if (!pending || sharing || exporting) return;
    if (
      pending.siteId !== activeSiteIdRef.current ||
      pending.requestSequence !== requestSequenceRef.current
    ) {
      setPendingShare(null);
      setError("当前商户已变化，请重新生成 CSV 后再分享。");
      setNotice("");
      return;
    }
    const shareData: ShareData = { files: [pending.file] };
    if (!canShareOrderExportFile(pending.file)) {
      setPendingShare(null);
      setError(CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE);
      setNotice("");
      return;
    }

    setSharing(true);
    setError("");
    try {
      // This call intentionally happens directly in the click handler before
      // the first await, preserving the Web Share transient user activation.
      await navigator.share({
        ...shareData,
        title: "订单汇总 CSV",
      });
      if (
        pending.siteId !== activeSiteIdRef.current ||
        pending.requestSequence !== requestSequenceRef.current
      ) return;
      setPendingShare(null);
      setNotice("订单汇总 CSV 已交给系统分享面板保存。");
    } catch (shareError) {
      if (
        pending.siteId !== activeSiteIdRef.current ||
        pending.requestSequence !== requestSequenceRef.current
      ) return;
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        setNotice("已取消 CSV 分享；文件仍保留在当前页面，可再次打开系统分享。");
        return;
      }
      setPendingShare(null);
      setError(CAPACITOR_ANDROID_CSV_UNAVAILABLE_MESSAGE);
      setNotice("");
    } finally {
      if (
        pending.siteId === activeSiteIdRef.current &&
        pending.requestSequence === requestSequenceRef.current
      ) {
        setSharing(false);
      }
    }
  };

  const surfaceClassName = darkMode
    ? "border-slate-700/80 bg-slate-900/80"
    : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const inputClassName = darkMode
    ? "border-slate-700 bg-slate-950 text-slate-100 focus:border-sky-400"
    : "border-slate-200 bg-white text-slate-900 focus:border-sky-500";
  const exportBusy = exporting || sharing;

  return (
    <div className="mx-auto max-w-4xl space-y-5" aria-busy={exportBusy}>
      <section aria-labelledby={sectionTitleId} className={`rounded-2xl border p-4 sm:p-6 ${surfaceClassName}`}>
        <div>
          <h3 id={sectionTitleId} className="text-base font-bold sm:text-lg">
            导出订单汇总 CSV
          </h3>
          <p className={`mt-2 text-sm leading-6 ${mutedTextClassName}`}>
            由服务端完整订单记录生成，不受订单列表每页加载数量影响。单次最多 366 天、10,000 笔订单和 25 MB。
          </p>
        </div>

        <form className="mt-6 space-y-6" onSubmit={(event) => void submitExport(event)}>
          <fieldset disabled={exportBusy} className="space-y-3">
            <legend className="text-sm font-bold">下单日期范围</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                <span>开始日期</span>
                <input
                  type="date"
                  value={range.startDate}
                  onChange={(event) => {
                    invalidatePendingShareForFilterChange();
                    setRange((current) => ({ ...current, startDate: event.target.value }));
                  }}
                  className={`h-11 w-full rounded-xl border px-3 outline-none transition ${inputClassName}`}
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>结束日期（含当天）</span>
                <input
                  type="date"
                  value={range.endDate}
                  onChange={(event) => {
                    invalidatePendingShareForFilterChange();
                    setRange((current) => ({ ...current, endDate: event.target.value }));
                  }}
                  className={`h-11 w-full rounded-xl border px-3 outline-none transition ${inputClassName}`}
                />
              </label>
            </div>
            <p className={`text-xs leading-5 ${mutedTextClassName}`}>
              日期边界按当前设备时区换算，文件中的时间字段统一保留 UTC，避免夏令时歧义。
            </p>
          </fieldset>

          <fieldset disabled={exportBusy}>
            <legend className="text-sm font-bold">订单状态</legend>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ORDER_EXPORT_STATUSES.map((item) => {
                const checked = statuses.includes(item.value);
                return (
                  <label
                    key={item.value}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${
                      checked
                        ? darkMode
                          ? "border-sky-400/50 bg-sky-400/10 text-sky-100"
                          : "border-sky-300 bg-sky-50 text-sky-800"
                        : darkMode
                          ? "border-slate-700 bg-slate-950 text-slate-300"
                          : "border-slate-200 bg-slate-50 text-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStatus(item.value)}
                      className="h-4 w-4 accent-sky-600"
                    />
                    {item.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset disabled={exportBusy}>
            <legend className="text-sm font-bold">客户资料</legend>
            <label
              className={`mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${
                includeCustomerData
                  ? darkMode
                    ? "border-amber-400/40 bg-amber-400/10"
                    : "border-amber-200 bg-amber-50"
                  : darkMode
                    ? "border-slate-700 bg-slate-950"
                    : "border-slate-200 bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={includeCustomerData}
                onChange={(event) => {
                  invalidatePendingShareForFilterChange();
                  setIncludeCustomerData(event.target.checked);
                }}
                className="mt-0.5 h-4 w-4 accent-amber-600"
              />
              <span>
                <span className="block text-sm font-bold">包含客户姓名、电话、联系邮箱和客户备注</span>
                <span className={`mt-1 block text-xs leading-5 ${mutedTextClassName}`}>
                  默认不导出客户资料。账号编号、登录邮箱、访客标识和客户端幂等编号始终不会导出。
                </span>
              </span>
            </label>
          </fieldset>

          {error ? (
            <div
              role="alert"
              className={`rounded-xl border px-4 py-3 text-sm ${
                darkMode
                  ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {error}
            </div>
          ) : null}
          <div aria-live="polite">
            {notice ? (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  darkMode
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {notice}
              </div>
            ) : null}
          </div>

          {pendingShare ? (
            <div
              className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                darkMode
                  ? "border-sky-400/30 bg-sky-400/10 text-sky-100"
                  : "border-sky-200 bg-sky-50 text-sky-800"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-bold">CSV 已生成，等待系统分享</p>
                <p className="mt-1 truncate text-xs opacity-80" title={pendingShare.file.name}>
                  {pendingShare.file.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void sharePendingExport()}
                disabled={exportBusy}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sharing ? <RefreshIcon spinning /> : null}
                {sharing ? "正在打开系统分享" : "打开系统分享并保存"}
              </button>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className={`text-xs leading-5 ${mutedTextClassName}`}>
              导出的是账面订单额，不代表实付、收入、退款、税费或支付状态；不同价格前缀不可直接合计。
            </p>
            <button
              type="submit"
              disabled={exportBusy}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportBusy ? <RefreshIcon spinning /> : null}
              {exporting
                ? "正在生成"
                : sharing
                  ? "正在分享"
                  : capacitorAndroid
                    ? pendingShare
                      ? "重新生成 CSV"
                      : "生成 CSV"
                    : "生成并下载 CSV"}
            </button>
          </div>
        </form>
      </section>

      <section className={`rounded-2xl border px-4 py-4 text-xs leading-6 sm:px-5 ${surfaceClassName} ${mutedTextClassName}`}>
        <p className="font-semibold">文件内容边界</p>
        <p className="mt-1">
          每笔订单占一行，包含订单状态、时间、价格前缀、账面金额、商品数量和商品摘要。当前订单模型没有可靠的支付、退款、库存、配送、发票和内部备注字段，因此不会伪造这些列。
        </p>
      </section>
    </div>
  );
}

function OrderListView({
  records,
  visibleRecords,
  statusFilter,
  search,
  loading,
  loadingMore,
  refreshing,
  hasMore,
  error,
  actionError,
  notice,
  darkMode,
  onStatusFilterChange,
  onSearchChange,
  onRefresh,
  onLoadMore,
  onOpenOrder,
  onOpenFullList,
}: {
  records: MerchantOrderRecord[];
  visibleRecords: MerchantOrderRecord[];
  statusFilter: OrderListStatusFilter;
  search: string;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  hasMore: boolean;
  error: string;
  actionError: string;
  notice: string;
  darkMode: boolean;
  onStatusFilterChange: (status: OrderListStatusFilter) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenOrder: (orderId: string) => void;
  onOpenFullList: (() => void) | null;
}) {
  const surfaceClassName = darkMode
    ? "border-slate-700/80 bg-slate-900/80"
    : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const inputClassName = darkMode
    ? "border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500"
    : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400";
  const secondaryButtonClassName = darkMode
    ? "border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";

  return (
    <div className="space-y-4" aria-busy={loading || loadingMore || refreshing}>
      <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="workbench-order-list-title">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 id="workbench-order-list-title" className="text-base font-bold">订单列表</h3>
            <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
              当前已从服务端载入 {records.length} 笔；搜索只覆盖这批已加载范围，继续加载会扩大搜索范围。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="min-w-0 sm:w-72">
              <span className="sr-only">搜索已加载订单</span>
              <input
                type="search"
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="订单号、客户、备注或商品"
                className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 ${inputClassName}`}
              />
            </label>
            <label className="min-w-0 sm:w-40">
              <span className="sr-only">按订单状态筛选</span>
              <select
                value={statusFilter}
                onChange={(event) => onStatusFilterChange(event.target.value as OrderListStatusFilter)}
                className={`h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 ${inputClassName}`}
              >
                <option value="all">全部状态</option>
                <option value="pending">待确认</option>
                <option value="confirmed">处理中</option>
                <option value="completed">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || loadingMore || refreshing}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
            >
              <RefreshIcon spinning={refreshing} />
              刷新
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
            darkMode
              ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          <span>{error}</span>
          <button type="button" onClick={onRefresh} className="rounded-xl border border-current/30 px-3 py-2 font-semibold">
            重试
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {actionError}
        </div>
      ) : null}

      {notice ? (
        <div aria-live="polite" className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {notice}
        </div>
      ) : null}

      {loading && records.length === 0 ? <LoadingSkeleton darkMode={darkMode} /> : null}

      {!loading && visibleRecords.length === 0 ? (
        <div className={`rounded-2xl border border-dashed px-5 py-12 text-center ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
          <p className="text-sm font-bold">已加载范围内没有匹配订单</p>
          <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
            {hasMore ? "可以继续加载更多订单后再搜索。" : "请调整搜索词或状态筛选。"}
          </p>
        </div>
      ) : null}

      {visibleRecords.length > 0 ? (
        <div className="space-y-3">
          {visibleRecords.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => onOpenOrder(order.id)}
              className={`block w-full rounded-2xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:p-5 ${
                darkMode
                  ? "border-slate-700/80 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900"
                  : "border-slate-200 bg-white hover:border-sky-200 hover:shadow-sm"
              }`}
            >
              <span className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="max-w-full truncate text-sm" title={order.id}>订单 {order.id}</strong>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(order.status, darkMode)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                    {order.customer.note ? (
                      <span className={darkMode ? "text-xs font-semibold text-violet-200" : "text-xs font-semibold text-violet-700"}>有客户备注</span>
                    ) : null}
                  </span>
                  <span className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${mutedTextClassName}`}>
                    <span>客户：{order.customer.name || "未填写姓名"}</span>
                    <span>下单：{formatDateTime(order.createdAt)}</span>
                    <span>{order.items.length} 项 · 共 {order.totalQuantity} 件</span>
                  </span>
                  {order.customer.note ? (
                    <span className={`mt-2 block line-clamp-2 whitespace-pre-wrap text-xs leading-5 ${darkMode ? "text-violet-200" : "text-violet-800"}`}>
                      {order.customer.note}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center justify-between gap-4 lg:justify-end">
                  <strong className="text-base tabular-nums">{formatMerchantOrderAmount(order.totalAmount, order.pricePrefix)}</strong>
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold ${darkMode ? "text-sky-200" : "text-sky-700"}`}>
                    查看并处置 <ChevronIcon />
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-xs ${mutedTextClassName}`}>
          当前匹配 {visibleRecords.length} 笔 · 已载入 {records.length} 笔服务端窗口
        </p>
        <div className="flex flex-wrap gap-2">
          {onOpenFullList ? (
            <button
              type="button"
              onClick={onOpenFullList}
              className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-4 py-2 text-sm font-semibold transition ${secondaryButtonClassName}`}
            >
              在完整管理中查看此状态
            </button>
          ) : null}
          {hasMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading || loadingMore || refreshing}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? <RefreshIcon spinning /> : null}
              {loadingMore ? "正在加载" : `继续加载 ${ORDER_LIST_WINDOW_LIMIT} 笔`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OrderDetailDrawer({
  orderId,
  order,
  loading,
  error,
  actionError,
  notice,
  mutation,
  intentAction,
  darkMode,
  onClose,
  onRetry,
  onAction,
  onPrint,
  onContact,
  onOpenTask,
  onOpenFullOrder,
}: {
  orderId: string;
  order: MerchantOrderRecord | null;
  loading: boolean;
  error: string;
  actionError: string;
  notice: string;
  mutation: OrderMutationState | null;
  intentAction: OrderIntentState | null;
  darkMode: boolean;
  onClose: () => void;
  onRetry: () => void;
  onAction: (order: MerchantOrderRecord, action: WorkbenchOrderAction) => void;
  onPrint: (order: MerchantOrderRecord) => void;
  onContact?: (orderId: string) => void;
  onOpenTask?: (orderId: string) => void;
  onOpenFullOrder: (orderId: string) => void;
}) {
  const drawerTitleId = useId();
  const drawerRef = useRef<HTMLElement | null>(null);
  const actionBusy = Boolean(mutation || intentAction);
  const thisOrderMutation = mutation?.orderId === orderId ? mutation : null;
  const surfaceClassName = darkMode ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900";
  const cardClassName = darkMode ? "border-slate-700 bg-slate-900/80" : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const secondaryButtonClassName = darkMode
    ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

  useDialogFocusTrap(drawerRef, true);

  return (
    <div
      className="absolute inset-0 z-40 flex justify-end bg-slate-950/45 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionBusy) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        tabIndex={-1}
        data-order-focus-trap="detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby={drawerTitleId}
        aria-busy={loading || Boolean(thisOrderMutation)}
        className={`flex h-full w-full max-w-3xl flex-col overflow-hidden border-l shadow-2xl ${surfaceClassName}`}
      >
        <header className={`flex shrink-0 items-start justify-between gap-4 border-b px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 sm:py-5 ${darkMode ? "border-slate-800" : "border-slate-200"}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={drawerTitleId} className="truncate text-lg font-bold">订单详情与处置</h3>
              {order ? (
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(order.status, darkMode)}`}>
                  {getStatusLabel(order.status)}
                </span>
              ) : null}
              {loading ? <span className={`inline-flex items-center gap-1 text-xs ${mutedTextClassName}`}><RefreshIcon spinning /> 正在核对最新详情</span> : null}
            </div>
            <p className={`mt-1 truncate text-xs ${mutedTextClassName}`} title={orderId}>订单 {orderId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={actionBusy}
            data-mobile-swipe-back-control="true"
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
            aria-label="关闭订单详情"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          {error ? (
            <div role="alert" className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              <p>{error}</p>
              <button type="button" onClick={onRetry} disabled={loading || actionBusy} className="mt-3 rounded-xl border border-current/30 px-3 py-2 font-semibold disabled:opacity-50">
                重新读取
              </button>
            </div>
          ) : null}

          {actionError ? (
            <div role="alert" className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {actionError}
            </div>
          ) : null}

          {notice ? (
            <div aria-live="polite" className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {notice}
            </div>
          ) : null}

          {loading && !order ? <LoadingSkeleton darkMode={darkMode} /> : null}

          {order ? (
            <div className="space-y-4">
              <section className={`rounded-2xl border p-4 sm:p-5 ${cardClassName}`} aria-labelledby={`${drawerTitleId}-customer`}>
                <h4 id={`${drawerTitleId}-customer`} className="text-sm font-bold">客户与订单</h4>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className={mutedTextClassName}>客户</dt><dd className="mt-1 break-words font-semibold">{order.customer.name || "未填写"}</dd></div>
                  <div><dt className={mutedTextClassName}>下单时间</dt><dd className="mt-1">{formatDateTime(order.createdAt)}</dd></div>
                  <div><dt className={mutedTextClassName}>电话</dt><dd className="mt-1 break-all">{order.customer.phone || "未填写"}</dd></div>
                  <div><dt className={mutedTextClassName}>邮箱</dt><dd className="mt-1 break-all">{order.customer.email || order.customerLoginEmail || "未填写"}</dd></div>
                  <div><dt className={mutedTextClassName}>最近更新</dt><dd className="mt-1">{formatDateTime(order.updatedAt)}</dd></div>
                  <div><dt className={mutedTextClassName}>账面订单额</dt><dd className="mt-1 font-bold tabular-nums">{formatMerchantOrderAmount(order.totalAmount, order.pricePrefix)}</dd></div>
                </dl>
                <div className={`mt-4 rounded-xl border px-3 py-3 ${darkMode ? "border-violet-400/20 bg-violet-400/5" : "border-violet-100 bg-violet-50/70"}`}>
                  <p className={`text-xs font-semibold ${darkMode ? "text-violet-200" : "text-violet-800"}`}>客户备注</p>
                  <p className={`mt-1 whitespace-pre-wrap break-words text-sm leading-6 ${order.customer.note ? "" : mutedTextClassName}`}>
                    {order.customer.note || "客户未填写备注"}
                  </p>
                </div>
              </section>

              <section className={`rounded-2xl border p-4 sm:p-5 ${cardClassName}`} aria-labelledby={`${drawerTitleId}-items`}>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h4 id={`${drawerTitleId}-items`} className="text-sm font-bold">商品明细</h4>
                    <p className={`mt-1 text-xs ${mutedTextClassName}`}>数量仅供核对，工作台详情不修改订单商品。</p>
                  </div>
                  <span className={`text-xs ${mutedTextClassName}`}>{order.items.length} 项 · 共 {order.totalQuantity} 件</span>
                </div>
                <div className="mt-3 space-y-2">
                  {order.items.map((item, index) => (
                    <div key={`${order.id}:${item.productId}:${item.code}:${index}`} className={`rounded-xl border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold">{item.name || "未命名商品"}</p>
                          <p className={`mt-1 text-xs ${mutedTextClassName}`}>
                            {[item.code, item.tag].filter(Boolean).join(" · ") || "无商品编号或分类"}
                          </p>
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <p className="text-sm font-bold tabular-nums">{formatMerchantOrderAmount(item.subtotal, order.pricePrefix)}</p>
                          <p className={`mt-1 text-xs ${mutedTextClassName}`}>
                            {formatMerchantOrderAmount(item.unitPrice, order.pricePrefix)} × {item.quantity}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className={`rounded-2xl border p-4 sm:p-5 ${cardClassName}`} aria-labelledby={`${drawerTitleId}-actions`}>
                <h4 id={`${drawerTitleId}-actions`} className="text-sm font-bold">订单处置</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>操作前会重新读取订单；若检测到其他入口已更新，会先刷新详情并要求重新确认。</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {getAvailableOrderActions(order.status).map((action) => {
                    const primary = action === "confirm" || action === "complete";
                    const destructive = action === "cancel";
                    return (
                      <button
                        key={action}
                        type="button"
                        onClick={() => onAction(order, action)}
                        disabled={actionBusy || loading || Boolean(error)}
                        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          primary
                            ? action === "complete"
                              ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                              : "border-amber-500 bg-amber-500 text-white hover:bg-amber-600"
                            : destructive
                              ? darkMode
                                ? "border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
                                : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                              : secondaryButtonClassName
                        }`}
                      >
                        {thisOrderMutation?.action === action ? <RefreshIcon spinning /> : null}
                        {thisOrderMutation?.action === action ? "正在处理" : getOrderActionLabel(action)}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => onPrint(order)}
                    disabled={actionBusy || loading || Boolean(error)}
                    className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
                  >
                    {thisOrderMutation?.action === "print" ? <RefreshIcon spinning /> : null}
                    {thisOrderMutation?.action === "print"
                      ? "正在记录"
                      : getMerchantOrderPrintAttemptText(order.printCount)}
                  </button>
                </div>
                <div className={`mt-4 border-t pt-4 ${darkMode ? "border-slate-800" : "border-slate-200"}`}>
                  <div className="flex flex-wrap gap-2">
                    {onContact ? (
                      <button type="button" onClick={() => onContact(order.id)} disabled={actionBusy} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}>
                        {intentAction?.orderId === order.id && intentAction.kind === "contact" ? <RefreshIcon spinning /> : <ChatIcon />}
                        联系客户
                      </button>
                    ) : null}
                    {onOpenTask ? (
                      <button type="button" onClick={() => onOpenTask(order.id)} disabled={actionBusy} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}>
                        {intentAction?.orderId === order.id && intentAction.kind === "task" ? <RefreshIcon spinning /> : <TaskIcon />}
                        创建/查看企业任务
                      </button>
                    ) : null}
                    <button type="button" onClick={() => onOpenFullOrder(order.id)} disabled={actionBusy} className={`inline-flex min-h-10 items-center gap-1 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${secondaryButtonClassName}`}>
                      {intentAction?.orderId === order.id && intentAction.kind === "full" ? <RefreshIcon spinning /> : null}
                      在完整订单管理中打开 <ChevronIcon />
                    </button>
                  </div>
                </div>
              </section>

              <p className={`text-xs leading-5 ${mutedTextClassName}`}>
                当前订单模型不包含可靠的支付、退款、库存、配送或发票状态，工作台不会推断或展示这些语义。
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export default function OrderWorkbenchPanel({
  siteId,
  mode = "inline",
  initialView = "overview",
  catalogTarget = null,
  darkMode = false,
  onClose,
  onOpenOrder,
  onContactOrder,
  onOpenEnterpriseTask,
  onStatusFilter,
  onChanged,
  registerLeaveGuard,
}: OrderWorkbenchPanelProps) {
  const isOverlay = mode === "overlay";
  const [activeView, setActiveView] = useState<OrderWorkbenchView>(initialView);
  const [catalogLeaveState, setCatalogLeaveState] = useState<MerchantCatalogLeaveState>("clean");
  const catalogLeaveStateRef = useRef<MerchantCatalogLeaveState>("clean");
  const [leaveGuardMessage, setLeaveGuardMessage] = useState("");
  const [portalReady, setPortalReady] = useState(false);
  const [dashboard, setDashboard] = useState<MerchantOrderWorkbenchDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [actingOrderId, setActingOrderId] = useState("");
  const [intentAction, setIntentAction] = useState<OrderIntentState | null>(null);
  const intentActionRef = useRef<OrderIntentState | null>(null);
  const intentActionSequenceRef = useRef(0);
  const [orderRecords, setOrderRecords] = useState<MerchantOrderRecord[]>([]);
  const orderRecordsRef = useRef<MerchantOrderRecord[]>([]);
  orderRecordsRef.current = orderRecords;
  const [orderListStatusFilter, setOrderListStatusFilter] = useState<OrderListStatusFilter>("all");
  const [orderListSearch, setOrderListSearch] = useState("");
  const [orderListLoading, setOrderListLoading] = useState(false);
  const [orderListLoadingMore, setOrderListLoadingMore] = useState(false);
  const [orderListRefreshing, setOrderListRefreshing] = useState(false);
  const [orderListHasMore, setOrderListHasMore] = useState(false);
  const [orderListError, setOrderListError] = useState("");
  const orderListSiteIdRef = useRef("");
  const orderListHydratedSiteIdRef = useRef("");
  const orderListRequestSequenceRef = useRef(0);
  const orderListNextOffsetRef = useRef(0);
  const orderListAbortControllerRef = useRef<AbortController | null>(null);
  const orderListBusyRef = useRef(false);
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detailOrder, setDetailOrder] = useState<MerchantOrderRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailRequestSequenceRef = useRef(0);
  const detailAbortControllerRef = useRef<AbortController | null>(null);
  const [orderMutation, setOrderMutation] = useState<OrderMutationState | null>(null);
  const orderMutationRef = useRef<OrderMutationState | null>(null);
  const orderMutationSequenceRef = useRef(0);
  const titleId = useId();
  const workbenchDialogRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const dashboardRef = useRef<MerchantOrderWorkbenchDashboard | null>(null);
  const dashboardSiteIdRef = useRef("");
  const requestSequenceRef = useRef(0);
  const initialViewPropRef = useRef(initialView);
  const renderedSiteId = siteId.trim();
  const dashboardForCurrentSite =
    dashboardSiteIdRef.current === renderedSiteId ? dashboard : null;
  const orderRecordsForCurrentSite = useMemo(
    () => (orderListSiteIdRef.current === renderedSiteId ? orderRecords : []),
    [orderRecords, renderedSiteId],
  );
  const detailOrderIdForCurrentSite =
    orderListSiteIdRef.current === renderedSiteId ? detailOrderId : "";
  const detailOrderForCurrentSite =
    detailOrder?.siteId === renderedSiteId ? detailOrder : null;

  useDialogFocusTrap(workbenchDialogRef, isOverlay && portalReady);

  const closeOrderDetail = useCallback(() => {
    if (orderMutationRef.current) {
      setLeaveGuardMessage("订单状态正在更新，请等待当前操作完成后再关闭详情。");
      return false;
    }
    if (intentActionRef.current) {
      setLeaveGuardMessage("正在打开订单关联功能，请等待当前操作完成后再关闭详情。");
      return false;
    }
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    detailRequestSequenceRef.current += 1;
    setDetailOrderId("");
    setDetailOrder(null);
    setDetailLoading(false);
    setDetailError("");
    return true;
  }, []);

  const requestCatalogLeave = useCallback(() => {
    if (orderMutationRef.current) {
      setLeaveGuardMessage("订单状态正在更新，请等待当前操作完成后再离开工作台。");
      return false;
    }
    if (intentActionRef.current) {
      setLeaveGuardMessage("正在打开订单关联功能，请等待当前操作完成后再离开工作台。");
      return false;
    }
    const currentLeaveState = catalogLeaveStateRef.current;
    if (activeView !== "catalog" || currentLeaveState === "clean") {
      catalogLeaveStateRef.current = "clean";
      setCatalogLeaveState("clean");
      setLeaveGuardMessage("");
      return true;
    }
    if (currentLeaveState === "busy") {
      setLeaveGuardMessage("商品目录正在读取、上传或保存，请等待当前操作完成后再离开。");
      return false;
    }
    const confirmed = window.confirm(
      currentLeaveState === "uploaded_uncommitted"
        ? "已有商品图片上传成功，但尚未写入商品目录。现在离开会放弃当前批次，这些图片可能成为未引用资源。仍要离开吗？"
        : "商品目录中有尚未保存或确认的更改。现在离开会放弃这些更改。仍要离开吗？",
    );
    if (!confirmed) {
      setLeaveGuardMessage("已保留当前商品目录内容，请完成或取消编辑后再离开。");
      return false;
    }
    catalogLeaveStateRef.current = "clean";
    setCatalogLeaveState("clean");
    setLeaveGuardMessage("");
    return true;
  }, [activeView]);

  const requestClose = useCallback(() => {
    if (detailOrderId) {
      closeOrderDetail();
      return;
    }
    if (!requestCatalogLeave()) return;
    onClose?.();
  }, [closeOrderDetail, detailOrderId, onClose, requestCatalogLeave]);

  const requestViewChange = useCallback(
    (view: OrderWorkbenchView) => {
      if (view === activeView) return;
      if (detailOrderId && !closeOrderDetail()) return;
      if (!requestCatalogLeave()) return;
      setActiveView(view);
    },
    [activeView, closeOrderDetail, detailOrderId, requestCatalogLeave],
  );

  const handleCatalogLeaveStateChange = useCallback((state: MerchantCatalogLeaveState) => {
    catalogLeaveStateRef.current = state;
    setCatalogLeaveState(state);
    setLeaveGuardMessage("");
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (initialViewPropRef.current === initialView) return;
    if (activeView === initialView) {
      initialViewPropRef.current = initialView;
      return;
    }
    if (detailOrderId && !closeOrderDetail()) return;
    if (!requestCatalogLeave()) return;
    initialViewPropRef.current = initialView;
    setActiveView(initialView);
  }, [activeView, catalogLeaveState, closeOrderDetail, detailOrderId, initialView, requestCatalogLeave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      orderListAbortControllerRef.current?.abort();
      detailAbortControllerRef.current?.abort();
      orderListRequestSequenceRef.current += 1;
      detailRequestSequenceRef.current += 1;
      orderMutationSequenceRef.current += 1;
      intentActionSequenceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!isOverlay && !detailOrderId) return;
    const previousOverflow = document.body.style.overflow;
    if (isOverlay) document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!detailOrderId && !onClose)) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (isOverlay) document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailOrderId, isOverlay, onClose, requestClose]);

  useEffect(() => {
    if (!onClose || typeof window === "undefined") return;
    const handleMobileSwipeBack = (event: Event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestClose();
    };
    window.addEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack, true);
    return () => window.removeEventListener(MOBILE_SWIPE_BACK_EVENT, handleMobileSwipeBack, true);
  }, [onClose, requestClose]);

  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(requestCatalogLeave);
    return () => registerLeaveGuard(null);
  }, [registerLeaveGuard, requestCatalogLeave]);

  useEffect(() => {
    if (catalogLeaveState === "clean" && !orderMutation && !intentAction) return;
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedUnload);
    return () => window.removeEventListener("beforeunload", preventUnsavedUnload);
  }, [catalogLeaveState, intentAction, orderMutation]);

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    const normalizedSiteId = siteId.trim();
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    const hasCurrentDashboard = dashboardRef.current !== null;
    if (!normalizedSiteId) {
      dashboardRef.current = null;
      setDashboard(null);
      setError("缺少商户编号，暂时无法加载订单工作台。");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setError("");
    setLoading(!hasCurrentDashboard);
    setRefreshing(hasCurrentDashboard);
    try {
      const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
      const query = new URLSearchParams({
        siteId: normalizedSiteId,
        timezoneOffsetMinutes: String(timezoneOffsetMinutes),
      });
      const response = await fetch(`/api/orders/workbench?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as WorkbenchApiPayload | null;
      if (!response.ok || !payload?.ok || !isMerchantOrderWorkbenchDashboard(payload.dashboard)) {
        throw new Error(getApiError(payload, "订单工作台加载失败，请稍后重试。"));
      }
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== requestSequence ||
        dashboardSiteIdRef.current !== normalizedSiteId
      ) return;
      dashboardRef.current = payload.dashboard;
      setDashboard(payload.dashboard);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      if (!mountedRef.current || requestSequenceRef.current !== requestSequence) return;
      setError(requestError instanceof Error ? requestError.message : "订单工作台加载失败，请稍后重试。");
    } finally {
      if (mountedRef.current && requestSequenceRef.current === requestSequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [siteId]);

  useEffect(() => {
    const normalizedSiteId = siteId.trim();
    if (dashboardSiteIdRef.current !== normalizedSiteId) {
      requestSequenceRef.current += 1;
      dashboardSiteIdRef.current = normalizedSiteId;
      dashboardRef.current = null;
      setDashboard(null);
      setActionError("");
      setNotice("");
    }
    if (activeView !== "overview" && activeView !== "analysis") {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (dashboardRef.current) {
      setDashboard(dashboardRef.current);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => {
      controller.abort();
      requestSequenceRef.current += 1;
    };
  }, [activeView, loadDashboard, siteId]);

  const applyUpdatedOrder = useCallback((nextOrder: MerchantOrderRecord) => {
    if (nextOrder.siteId !== orderListSiteIdRef.current) return;
    setOrderRecords((current) => {
      if (!current.some((order) => order.id === nextOrder.id)) return current;
      const next = current.map((order) => (order.id === nextOrder.id ? nextOrder : order));
      orderRecordsRef.current = next;
      return next;
    });
    setDetailOrder((current) => (current?.id === nextOrder.id ? nextOrder : current));
  }, []);

  const loadOrderWindow = useCallback(
    async ({ append = false }: { append?: boolean } = {}) => {
      const normalizedSiteId = siteId.trim();
      if (!normalizedSiteId || orderListSiteIdRef.current !== normalizedSiteId) {
        if (!normalizedSiteId) setOrderListError("缺少商户编号，暂时无法读取订单列表。");
        return;
      }
      if (append && orderListBusyRef.current) return;

      orderListAbortControllerRef.current?.abort();
      const controller = new AbortController();
      orderListAbortControllerRef.current = controller;
      const requestSequence = orderListRequestSequenceRef.current + 1;
      orderListRequestSequenceRef.current = requestSequence;
      orderListBusyRef.current = true;
      const hasHydratedWindow = orderListHydratedSiteIdRef.current === normalizedSiteId;
      const offset = append ? orderListNextOffsetRef.current : 0;
      setOrderListError("");
      setOrderListLoading(append ? false : !hasHydratedWindow);
      setOrderListRefreshing(append ? false : hasHydratedWindow);
      setOrderListLoadingMore(append);

      try {
        const query = new URLSearchParams({
          siteId: normalizedSiteId,
          offset: String(offset),
          limit: String(ORDER_LIST_WINDOW_LIMIT),
        });
        const response = await fetch(`/api/orders?${query.toString()}`, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as WorkbenchApiPayload | null;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.orders)) {
          throw new Error(getApiError(payload, "订单列表读取失败，请稍后重试。"));
        }
        const nextWindow = normalizeMerchantOrderRecords(payload.orders).filter(
          (order) => order.siteId === normalizedSiteId,
        );
        const responseOffset =
          typeof payload.offset === "number" && Number.isFinite(payload.offset)
            ? Math.max(0, Math.trunc(payload.offset))
            : offset;
        const nextOffset = responseOffset + payload.orders.length;
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          orderListRequestSequenceRef.current !== requestSequence ||
          orderListSiteIdRef.current !== normalizedSiteId
        ) return;

        const nextRecords = append
          ? mergeOrderWindows(orderRecordsRef.current, nextWindow)
          : nextWindow;
        orderRecordsRef.current = nextRecords;
        orderListNextOffsetRef.current = nextOffset;
        orderListHydratedSiteIdRef.current = normalizedSiteId;
        setOrderRecords(nextRecords);
        setOrderListHasMore(payload.hasMore === true);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (
          !mountedRef.current ||
          orderListRequestSequenceRef.current !== requestSequence ||
          orderListSiteIdRef.current !== normalizedSiteId
        ) return;
        setOrderListError(requestError instanceof Error ? requestError.message : "订单列表读取失败，请稍后重试。");
      } finally {
        if (orderListRequestSequenceRef.current === requestSequence) {
          orderListBusyRef.current = false;
          if (orderListAbortControllerRef.current === controller) {
            orderListAbortControllerRef.current = null;
          }
          if (mountedRef.current) {
            setOrderListLoading(false);
            setOrderListLoadingMore(false);
            setOrderListRefreshing(false);
          }
        }
      }
    },
    [siteId],
  );

  useEffect(() => {
    const normalizedSiteId = siteId.trim();
    orderListAbortControllerRef.current?.abort();
    detailAbortControllerRef.current?.abort();
    orderListAbortControllerRef.current = null;
    detailAbortControllerRef.current = null;
    orderListRequestSequenceRef.current += 1;
    detailRequestSequenceRef.current += 1;
    orderMutationSequenceRef.current += 1;
    intentActionSequenceRef.current += 1;
    orderMutationRef.current = null;
    intentActionRef.current = null;
    orderListBusyRef.current = false;
    orderListSiteIdRef.current = normalizedSiteId;
    orderListHydratedSiteIdRef.current = "";
    orderListNextOffsetRef.current = 0;
    orderRecordsRef.current = [];
    setOrderRecords([]);
    setOrderListHasMore(false);
    setOrderListError("");
    setOrderListLoading(false);
    setOrderListLoadingMore(false);
    setOrderListRefreshing(false);
    setOrderListSearch("");
    setOrderListStatusFilter("all");
    setDetailOrderId("");
    setDetailOrder(null);
    setDetailLoading(false);
    setDetailError("");
    setOrderMutation(null);
    setActingOrderId("");
    setIntentAction(null);
  }, [siteId]);

  useEffect(() => {
    const normalizedSiteId = siteId.trim();
    if (
      activeView !== "orders" ||
      !normalizedSiteId ||
      orderListHydratedSiteIdRef.current === normalizedSiteId
    ) return;
    void loadOrderWindow();
  }, [activeView, loadOrderWindow, siteId]);

  const loadOrderDetail = useCallback(
    async (orderId: string) => {
      const normalizedSiteId = siteId.trim();
      const normalizedOrderId = orderId.trim();
      if (!normalizedSiteId || !normalizedOrderId || orderMutationRef.current) return;

      detailAbortControllerRef.current?.abort();
      const controller = new AbortController();
      detailAbortControllerRef.current = controller;
      const requestSequence = detailRequestSequenceRef.current + 1;
      detailRequestSequenceRef.current = requestSequence;
      const cachedOrder = orderRecordsRef.current.find((order) => order.id === normalizedOrderId) ?? null;
      setDetailOrderId(normalizedOrderId);
      setDetailOrder(cachedOrder);
      setDetailLoading(true);
      setDetailError("");
      setActionError("");
      setNotice("");
      setLeaveGuardMessage("");

      try {
        const nextOrder = await fetchExactMerchantOrder(normalizedSiteId, normalizedOrderId, controller.signal);
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          detailRequestSequenceRef.current !== requestSequence ||
          orderListSiteIdRef.current !== normalizedSiteId
        ) return;
        applyUpdatedOrder(nextOrder);
        setDetailOrder(nextOrder);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        if (
          !mountedRef.current ||
          detailRequestSequenceRef.current !== requestSequence ||
          orderListSiteIdRef.current !== normalizedSiteId
        ) return;
        setDetailError(requestError instanceof Error ? requestError.message : "订单详情读取失败，请稍后重试。");
      } finally {
        if (detailRequestSequenceRef.current === requestSequence) {
          if (detailAbortControllerRef.current === controller) detailAbortControllerRef.current = null;
          if (mountedRef.current) setDetailLoading(false);
        }
      }
    },
    [applyUpdatedOrder, siteId],
  );

  const visibleOrderRecords = useMemo(() => {
    const keyword = orderListSearch.trim().toLowerCase();
    return orderRecordsForCurrentSite.filter((order) => {
      if (orderListStatusFilter !== "all" && order.status !== orderListStatusFilter) return false;
      return !keyword || getOrderSearchText(order).includes(keyword);
    });
  }, [orderListSearch, orderListStatusFilter, orderRecordsForCurrentSite]);

  const runOrderAction = useCallback(
    async (
      target: { id: string; status: MerchantOrderStatus; updatedAt?: string },
      action: WorkbenchOrderAction,
    ) => {
      if (orderMutationRef.current || intentActionRef.current) return;
      const confirmation = getOrderActionConfirmation(action);
      if (confirmation && !window.confirm(confirmation)) return;
      const mutationSiteId = siteId.trim();
      if (!mutationSiteId || orderListSiteIdRef.current !== mutationSiteId) {
        setActionError("当前商户已变化，请刷新订单后重试。");
        return;
      }

      const mutationSequence = orderMutationSequenceRef.current + 1;
      orderMutationSequenceRef.current = mutationSequence;
      const mutationState: OrderMutationState = { orderId: target.id, action };
      orderMutationRef.current = mutationState;
      setOrderMutation(mutationState);
      setActingOrderId(target.id);
      setActionError("");
      setDetailError("");
      setNotice("");
      setLeaveGuardMessage("");

      try {
        const latestOrder = await fetchExactMerchantOrder(mutationSiteId, target.id);
        if (
          !mountedRef.current ||
          orderMutationSequenceRef.current !== mutationSequence ||
          orderListSiteIdRef.current !== mutationSiteId
        ) return;
        if (
          latestOrder.status !== target.status ||
          (target.updatedAt && latestOrder.updatedAt !== target.updatedAt)
        ) {
          applyUpdatedOrder(latestOrder);
          setDetailOrder((current) => (current?.id === latestOrder.id ? latestOrder : current));
          throw new Error("订单已在其他入口更新，详情已刷新。请重新核对后再操作。");
        }

        const response = await fetch("/api/orders", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: mutationSiteId,
            orderId: target.id,
            action,
            expectedUpdatedAt: latestOrder.updatedAt,
          }),
        });
        const payload = (await response.json().catch(() => null)) as WorkbenchApiPayload | null;
        const updatedOrder = normalizeMerchantOrderRecord(
          payload?.order && typeof payload.order === "object"
            ? (payload.order as Partial<MerchantOrderRecord>)
            : {},
        );
        if (!response.ok || !payload?.ok || !updatedOrder) {
          throw new Error(getApiError(payload, "订单保存失败，请稍后重试。"));
        }
        if (updatedOrder.siteId !== mutationSiteId || updatedOrder.id !== target.id) {
          throw new Error("订单保存响应与当前商户不匹配，请刷新后核对。");
        }
        if (
          !mountedRef.current ||
          orderMutationSequenceRef.current !== mutationSequence ||
          orderListSiteIdRef.current !== mutationSiteId
        ) return;
        applyUpdatedOrder(updatedOrder);
        setDetailOrder((current) => (current?.id === updatedOrder.id ? updatedOrder : current));
        setNotice(getOrderActionSuccessMessage(action));
        void Promise.allSettled([
          loadDashboard(),
          Promise.resolve().then(() => onChanged?.()),
        ]);
      } catch (requestError) {
        if (
          !mountedRef.current ||
          orderMutationSequenceRef.current !== mutationSequence ||
          orderListSiteIdRef.current !== mutationSiteId
        ) return;
        setActionError(requestError instanceof Error ? requestError.message : "订单保存失败，请稍后重试。");
      } finally {
        if (orderMutationSequenceRef.current === mutationSequence) {
          orderMutationRef.current = null;
          if (mountedRef.current) {
            setOrderMutation(null);
            setActingOrderId("");
          }
        }
      }
    },
    [applyUpdatedOrder, loadDashboard, onChanged, siteId],
  );

  const printOrder = useCallback(
    async (order: MerchantOrderRecord) => {
      if (orderMutationRef.current || intentActionRef.current) return;
      setActionError("");
      setNotice("");
      const mutationSiteId = siteId.trim();
      if (!mutationSiteId || order.siteId !== mutationSiteId || orderListSiteIdRef.current !== mutationSiteId) {
        setActionError("当前商户已变化，请刷新订单后重试。打印尝试未记录。");
        return;
      }
      const preparedPrintWindow = prepareMerchantOrderPrintWindow();
      if (!preparedPrintWindow) {
        setActionError("浏览器阻止了打印窗口，请允许弹窗后重试。打印尝试未记录。");
        return;
      }

      const mutationSequence = orderMutationSequenceRef.current + 1;
      orderMutationSequenceRef.current = mutationSequence;
      const mutationState: OrderMutationState = { orderId: order.id, action: "print" };
      orderMutationRef.current = mutationState;
      setOrderMutation(mutationState);
      setActingOrderId(order.id);
      setLeaveGuardMessage("");
      let printStarted = false;
      try {
        const latestOrder = await fetchExactMerchantOrder(mutationSiteId, order.id);
        if (
          !mountedRef.current ||
          orderMutationSequenceRef.current !== mutationSequence ||
          orderListSiteIdRef.current !== mutationSiteId
        ) {
          preparedPrintWindow.close();
          return;
        }
        if (latestOrder.updatedAt !== order.updatedAt) {
          applyUpdatedOrder(latestOrder);
          setDetailOrder((current) => (current?.id === latestOrder.id ? latestOrder : current));
          throw new Error("订单已在其他入口更新，详情已刷新。请重新核对后再打印。");
        }
        if (!startMerchantOrderPrint(latestOrder, { formatDateTime }, preparedPrintWindow)) {
          throw new Error("打印窗口无法使用，请允许弹窗后重试。打印尝试未记录。");
        }
        printStarted = true;

        const response = await fetch("/api/orders", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: mutationSiteId,
            orderId: order.id,
            action: "print",
            expectedUpdatedAt: latestOrder.updatedAt,
          }),
        });
        const payload = (await response.json().catch(() => null)) as WorkbenchApiPayload | null;
        const updatedOrder = normalizeMerchantOrderRecord(
          payload?.order && typeof payload.order === "object"
            ? (payload.order as Partial<MerchantOrderRecord>)
            : {},
        );
        if (!response.ok || !payload?.ok || !updatedOrder) {
          throw new Error(getApiError(payload, "打印尝试记录失败，请稍后刷新核对。"));
        }
        if (updatedOrder.siteId !== mutationSiteId || updatedOrder.id !== order.id) {
          throw new Error("打印记录响应与当前商户不匹配，请刷新后核对。");
        }
        if (
          !mountedRef.current ||
          orderMutationSequenceRef.current !== mutationSequence ||
          orderListSiteIdRef.current !== mutationSiteId
        ) return;
        applyUpdatedOrder(updatedOrder);
        setDetailOrder((current) => (current?.id === updatedOrder.id ? updatedOrder : current));
        setNotice(`${MERCHANT_ORDER_PRINT_STARTED_TEXT}，打印尝试已记录。`);
        void Promise.allSettled([
          loadDashboard(),
          Promise.resolve().then(() => onChanged?.()),
        ]);
      } catch (requestError) {
        if (
          !mountedRef.current ||
          orderMutationSequenceRef.current !== mutationSequence ||
          orderListSiteIdRef.current !== mutationSiteId
        ) {
          if (!printStarted) preparedPrintWindow.close();
          return;
        }
        const reason = requestError instanceof Error ? requestError.message : "打印尝试记录失败。";
        if (!printStarted) {
          preparedPrintWindow.close();
          setActionError(reason);
        } else {
          setActionError(`${MERCHANT_ORDER_PRINT_STARTED_TEXT}，但${reason}`);
        }
      } finally {
        if (orderMutationSequenceRef.current === mutationSequence) {
          orderMutationRef.current = null;
          if (mountedRef.current) {
            setOrderMutation(null);
            setActingOrderId("");
          }
        }
      }
    },
    [applyUpdatedOrder, loadDashboard, onChanged, siteId],
  );

  const todoGroups = useMemo(() => {
    if (!dashboardForCurrentSite) return [];
    const byOrderId = new Map<string, TodoGroup>();
    dashboardForCurrentSite.todos.forEach((todo) => {
      const current = byOrderId.get(todo.orderId);
      if (current) {
        current.todos.push(todo);
        if (!current.note && todo.note) current.note = todo.note;
        return;
      }
      byOrderId.set(todo.orderId, {
        orderId: todo.orderId,
        status: todo.status,
        createdAt: todo.createdAt,
        updatedAt: todo.updatedAt,
        customerName: todo.customerName,
        totalAmount: todo.totalAmount,
        pricePrefix: todo.pricePrefix,
        note: todo.note ?? "",
        todos: [todo],
      });
    });
    return [...byOrderId.values()];
  }, [dashboardForCurrentSite]);

  const metricCards = useMemo<MetricCard[]>(() => {
    if (!dashboardForCurrentSite) return [];
    const { summary } = dashboardForCurrentSite;
    return [
      {
        key: "pending",
        label: "待确认",
        value: summary.pending,
        description: "等待商家接单",
        tone: "amber",
        status: "pending",
      },
      {
        key: "confirmationOverdue",
        label: "超时待确认",
        value: summary.confirmationOverdue,
        description: `超过 ${formatDuration(dashboardForCurrentSite.thresholds.confirmationOverdueMinutes)}`,
        tone: "rose",
        status: "pending",
      },
      {
        key: "processing",
        label: "处理中",
        value: summary.processing,
        description: "已确认未完成",
        tone: "sky",
        status: "confirmed",
      },
      {
        key: "processingOverdue",
        label: "超时处理中",
        value: summary.processingOverdue,
        description: `超过 ${formatDuration(dashboardForCurrentSite.thresholds.processingOverdueMinutes)}`,
        tone: "violet",
        status: "confirmed",
      },
      {
        key: "completedToday",
        label: "今日完成",
        value: summary.completedToday,
        description: "按当前设备时区",
        tone: "emerald",
        status: "completed",
      },
      {
        key: "cancelledToday",
        label: "今日取消",
        value: summary.cancelledToday,
        description: "按当前设备时区",
        tone: "slate",
        status: "cancelled",
      },
      {
        key: "customerNote",
        label: "有备注",
        value: summary.customerNote,
        description: "在下方待办处理",
        tone: "slate",
      },
    ];
  }, [dashboardForCurrentSite]);

  const updateOrderStatus = useCallback(
    async (group: TodoGroup, status: "confirmed" | "completed") => {
      await runOrderAction(
        { id: group.orderId, status: group.status, updatedAt: group.updatedAt },
        status === "completed" ? "complete" : "confirm",
      );
    },
    [runOrderAction],
  );

  const runOrderIntent = useCallback(
    async (
      orderId: string,
      kind: OrderIntentState["kind"],
      callback: ((targetOrderId: string) => void | Promise<void>) | undefined,
    ) => {
      if (!callback || orderMutationRef.current || intentActionRef.current) return false;
      const intentSiteId = siteId.trim();
      const sequence = intentActionSequenceRef.current + 1;
      intentActionSequenceRef.current = sequence;
      const nextIntent: OrderIntentState = { orderId, kind };
      intentActionRef.current = nextIntent;
      setIntentAction(nextIntent);
      setActionError("");
      setNotice("");
      try {
        await callback(orderId);
        return true;
      } catch (requestError) {
        if (
          !mountedRef.current ||
          intentActionSequenceRef.current !== sequence ||
          orderListSiteIdRef.current !== intentSiteId
        ) return false;
        setActionError(
          requestError instanceof Error && requestError.message
            ? requestError.message
            : kind === "contact"
              ? "暂时无法联系该订单客户，请稍后重试。"
              : kind === "task"
                ? "暂时无法打开企业任务，请稍后重试。"
                : "暂时无法打开完整订单管理，请稍后重试。",
        );
        return false;
      } finally {
        if (intentActionSequenceRef.current === sequence) {
          intentActionRef.current = null;
          if (mountedRef.current) setIntentAction(null);
        }
      }
    },
    [siteId],
  );

  const openFullOrder = useCallback(
    async (orderId: string) => {
      const opened = await runOrderIntent(orderId, "full", onOpenOrder);
      if (opened && mountedRef.current && isOverlay) onClose?.();
    },
    [isOverlay, onClose, onOpenOrder, runOrderIntent],
  );

  const openStatus = useCallback(
    (status: MerchantOrderStatus) => {
      setOrderListStatusFilter(status);
      setOrderListSearch("");
      requestViewChange("orders");
    },
    [requestViewChange],
  );

  const openFilteredFullOrderList = useCallback(() => {
    if (orderListStatusFilter === "all") return;
    onStatusFilter(orderListStatusFilter);
    if (isOverlay) onClose?.();
  }, [isOverlay, onClose, onStatusFilter, orderListStatusFilter]);

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) requestClose();
  };

  const shellClassName = darkMode
    ? "border-slate-700/80 bg-slate-950 text-slate-100"
    : "border-slate-200 bg-slate-50 text-slate-900";
  const surfaceClassName = darkMode
    ? "border-slate-700/80 bg-slate-900/80"
    : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleTextClassName = darkMode ? "text-slate-300" : "text-slate-600";
  const secondaryButtonClassName = darkMode
    ? "border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";

  const content: ReactNode = (
    <section
      ref={workbenchDialogRef}
      tabIndex={isOverlay ? -1 : undefined}
      data-order-focus-trap={isOverlay ? "workbench" : undefined}
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? true : undefined}
      aria-labelledby={titleId}
      aria-busy={
        activeView === "orders"
          ? orderListLoading || orderListLoadingMore || orderListRefreshing
          : (activeView === "overview" || activeView === "analysis") && (loading || refreshing)
      }
      className={`relative flex min-h-0 w-full flex-col overflow-hidden border ${shellClassName} ${
        isOverlay
          ? "h-[100dvh] rounded-none shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:max-w-7xl sm:rounded-3xl"
          : "min-h-[32rem] rounded-3xl"
      }`}
    >
      <header
        className={`flex shrink-0 items-start justify-between gap-4 border-b px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 sm:py-5 ${
          darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"
        }`}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-lg font-bold sm:text-xl">
              订单工作台
            </h2>
            {((activeView === "overview" || activeView === "analysis") && refreshing) ||
            (activeView === "orders" && orderListRefreshing) ? (
              <span className={`inline-flex items-center gap-1 text-xs ${mutedTextClassName}`}>
                <RefreshIcon spinning /> 正在同步
              </span>
            ) : null}
          </div>
          <p className={`mt-1 text-xs leading-5 sm:text-sm ${mutedTextClassName}`}>
            {activeView === "overview"
              ? "优先处理超时和客户备注订单，快捷操作后同步完整订单列表。"
              : activeView === "orders"
                ? "在已加载的服务端订单窗口中筛选、核对详情并安全处置。"
              : activeView === "analysis"
                ? "查看基于服务端完整订单记录生成的经营趋势和结构。"
                : activeView === "catalog"
                  ? "把商品经营数据逐步从网站编辑迁移到工作台管理。"
                  : "按日期和状态生成完整订单汇总，客户资料默认不导出。"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeView === "overview" || activeView === "analysis" || activeView === "orders" ? (
            <button
              type="button"
              onClick={() => {
                if (activeView === "orders") {
                  void loadOrderWindow();
                } else {
                  void loadDashboard();
                }
              }}
              disabled={
                activeView === "orders"
                  ? orderListLoading || orderListLoadingMore || orderListRefreshing
                  : loading || refreshing
              }
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
              aria-label="刷新订单工作台"
            >
              <RefreshIcon spinning={activeView === "orders" ? orderListRefreshing : refreshing} />
              <span className="hidden sm:inline">刷新</span>
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={requestClose}
              data-mobile-swipe-back-control={isOverlay ? "true" : undefined}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition ${secondaryButtonClassName}`}
              aria-label="关闭订单工作台"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </header>

      <nav
        aria-label="订单工作台功能"
        className={`flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2 sm:px-6 ${
          darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"
        }`}
      >
        {([
          ["overview", "概览"],
          ["orders", "订单"],
          ["analysis", "经营分析"],
          ["catalog", "商品目录"],
          ["export", "数据导出"],
        ] as const).map(([view, label]) => {
          const active = activeView === view;
          return (
            <button
              key={view}
              type="button"
              onClick={() => requestViewChange(view)}
              aria-current={active ? "page" : undefined}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                active
                  ? darkMode
                    ? "bg-sky-400/15 text-sky-200"
                    : "bg-sky-50 text-sky-700"
                  : darkMode
                    ? "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {leaveGuardMessage ? (
        <div
          role="alert"
          className={`shrink-0 border-b px-4 py-2.5 text-xs font-semibold leading-5 sm:px-6 ${
            darkMode
              ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {leaveGuardMessage}
        </div>
      ) : null}

      <div className={`${getOrderWorkbenchContentScrollClassName(mode)} px-4 py-5 sm:px-6 sm:py-6`}>
        {activeView === "catalog" ? (
          <MerchantCatalogManagerPanel
            key={renderedSiteId}
            siteId={siteId}
            darkMode={darkMode}
            catalogTarget={catalogTarget}
            onChanged={onChanged}
            onLeaveStateChange={handleCatalogLeaveStateChange}
          />
        ) : activeView === "orders" ? (
          <OrderListView
            records={orderRecordsForCurrentSite}
            visibleRecords={visibleOrderRecords}
            statusFilter={orderListStatusFilter}
            search={orderListSearch}
            loading={orderListLoading}
            loadingMore={orderListLoadingMore}
            refreshing={orderListRefreshing}
            hasMore={orderListHasMore}
            error={orderListError}
            actionError={actionError}
            notice={notice}
            darkMode={darkMode}
            onStatusFilterChange={setOrderListStatusFilter}
            onSearchChange={setOrderListSearch}
            onRefresh={() => void loadOrderWindow()}
            onLoadMore={() => void loadOrderWindow({ append: true })}
            onOpenOrder={(orderId) => void loadOrderDetail(orderId)}
            onOpenFullList={orderListStatusFilter === "all" ? null : openFilteredFullOrderList}
          />
        ) : activeView === "export" ? (
          <OrderExportPanel key={renderedSiteId} siteId={siteId} darkMode={darkMode} />
        ) : (
          <>
        {loading && !dashboardForCurrentSite ? <LoadingSkeleton darkMode={darkMode} /> : null}

        {error ? (
          <div
            role="alert"
            className={`mb-5 flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
              darkMode
                ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading || refreshing}
              className="shrink-0 rounded-xl border border-current/30 px-3 py-2 font-semibold transition hover:bg-current/10 disabled:opacity-50"
            >
              重试
            </button>
          </div>
        ) : null}

        {actionError ? (
          <div
            role="alert"
            className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
              darkMode
                ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                : "border-rose-200 bg-rose-50 text-rose-700"
            }`}
          >
            {actionError}
          </div>
        ) : null}

        <div aria-live="polite">
          {notice ? (
            <div
              className={`mb-5 flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
                darkMode
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              <CheckIcon /> {notice}
            </div>
          ) : null}
        </div>

        {dashboardForCurrentSite ? (
          activeView === "analysis" ? (
            <OrderWorkbenchAnalysis
              dashboard={dashboardForCurrentSite}
              darkMode={darkMode}
              onStatusFilter={openStatus}
            />
          ) : (
          <div className="space-y-6">
            <section aria-labelledby="order-workbench-overview-title">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="order-workbench-overview-title" className="text-sm font-bold sm:text-base">
                    需要关注
                  </h3>
                  <p className={`mt-1 text-xs ${mutedTextClassName}`}>
                     共 {dashboardForCurrentSite.summary.total} 笔订单，指标由完整订单数据在服务端计算
                  </p>
                </div>
                <p className={`text-xs ${mutedTextClassName}`}>点击指标进入对应订单筛选</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
                {metricCards.map((metric) => {
                  const body = (
                    <>
                      <span className="text-xs font-medium opacity-75">{metric.label}</span>
                      <strong className="mt-2 block text-2xl font-black tabular-nums sm:text-3xl">{metric.value}</strong>
                      <span className="mt-1 block text-[11px] leading-4 opacity-65">{metric.description}</span>
                    </>
                  );
                  const className = `min-h-28 rounded-2xl border p-3 text-left transition sm:p-4 ${getMetricToneClass(
                    metric.tone,
                    darkMode,
                  )}`;
                  return metric.status ? (
                    <button
                      key={metric.key}
                      type="button"
                      onClick={() => openStatus(metric.status as MerchantOrderStatus)}
                      className={`${className} focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
                      aria-label={`查看${metric.label}订单，共 ${metric.value} 笔`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div key={metric.key} className={className} title="备注订单可能同时包含待确认和处理中状态，请在下方待办直接处理">
                      {body}
                    </div>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="order-workbench-amount-title" className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 id="order-workbench-amount-title" className="text-sm font-bold sm:text-base">
                    未取消订单账面总额
                  </h3>
                  <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                    仅汇总未取消订单；不同价格前缀分别展示，不跨币种或前缀合计
                  </p>
                </div>
                <span className={`text-xs ${mutedTextClassName}`}>{dashboardForCurrentSite.amounts.length} 个金额分组</span>
              </div>
              {dashboardForCurrentSite.amounts.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dashboardForCurrentSite.amounts.map((amount, index) => (
                    <div
                      key={`${amount.pricePrefix}:${index}`}
                      className={`rounded-xl border px-4 py-3 ${
                        darkMode ? "border-slate-700 bg-slate-950/60" : "border-slate-100 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`truncate text-xs font-medium ${mutedTextClassName}`}>
                          {amount.pricePrefix || "未设置价格前缀"}
                        </span>
                        <span className={`shrink-0 text-[11px] ${mutedTextClassName}`}>{amount.orderCount} 笔未取消</span>
                      </div>
                      <p className="mt-2 text-xl font-black tabular-nums">
                        {formatMerchantOrderAmount(amount.totalAmount, amount.pricePrefix)}
                      </p>
                      <p className={`mt-1 text-xs ${mutedTextClassName}`}>
                        今日完成订单额 {amount.completedTodayCount} 笔 · {formatMerchantOrderAmount(amount.completedTodayAmount, amount.pricePrefix)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={`mt-4 rounded-xl border border-dashed px-4 py-5 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                  暂无可汇总的未取消订单金额
                </p>
              )}
            </section>

            <section aria-labelledby="order-workbench-todo-title">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="order-workbench-todo-title" className="text-sm font-bold sm:text-base">
                    待办订单
                  </h3>
                  <p className={`mt-1 text-xs ${mutedTextClassName}`}>
                    同一订单的超时和备注原因已合并，避免重复操作
                  </p>
                </div>
                <span className={`text-xs ${mutedTextClassName}`}>{todoGroups.length} 笔需处理</span>
              </div>

              {todoGroups.length > 0 ? (
                <div className="space-y-3">
                  {todoGroups.map((group) => {
                    const isActing = actingOrderId === group.orderId;
                    const isContacting = intentAction?.orderId === group.orderId && intentAction.kind === "contact";
                    const isOpeningTask = intentAction?.orderId === group.orderId && intentAction.kind === "task";
                    const anyActionRunning = Boolean(actingOrderId || intentAction);
                    return (
                      <article key={group.orderId} className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void loadOrderDetail(group.orderId)}
                                className="max-w-full truncate text-left text-sm font-bold underline-offset-4 hover:underline"
                                title={group.orderId}
                              >
                                订单 {group.orderId}
                              </button>
                              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getStatusBadgeClass(group.status, darkMode)}`}>
                                {getStatusLabel(group.status)}
                              </span>
                              {group.todos
                                .filter((todo) => todo.kind !== "pending_confirmation" && todo.kind !== "processing")
                                .map((todo) => (
                                <span
                                  key={todo.id}
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    todo.kind === "customer_note"
                                      ? darkMode
                                        ? "bg-violet-400/10 text-violet-200"
                                        : "bg-violet-50 text-violet-700"
                                      : darkMode
                                        ? "bg-rose-400/10 text-rose-200"
                                        : "bg-rose-50 text-rose-700"
                                  }`}
                                >
                                  {getTodoLabel(todo, dashboardForCurrentSite)}
                                </span>
                                ))}
                            </div>
                            <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs ${subtleTextClassName}`}>
                              <span>客户：{group.customerName || "未填写姓名"}</span>
                              <span>下单：{formatDateTime(group.createdAt)}</span>
                              <span className="font-semibold tabular-nums">
                                金额：{formatMerchantOrderAmount(group.totalAmount, group.pricePrefix)}
                              </span>
                            </div>
                            {group.note ? (
                              <p
                                className={`mt-3 whitespace-pre-wrap break-words rounded-xl border px-3 py-2 text-sm leading-6 ${
                                  darkMode
                                    ? "border-violet-400/20 bg-violet-400/5 text-violet-100"
                                    : "border-violet-100 bg-violet-50/70 text-violet-900"
                                }`}
                              >
                                <span className="font-semibold">客户备注：</span>
                                {group.note}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[42rem] lg:justify-end">
                            {group.status === "pending" ? (
                              <button
                                type="button"
                                onClick={() => void updateOrderStatus(group, "confirmed")}
                                disabled={anyActionRunning}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isActing ? <RefreshIcon spinning /> : <CheckIcon />}
                                {isActing ? "正在确认" : "确认订单"}
                              </button>
                            ) : null}
                            {group.status === "confirmed" ? (
                              <button
                                type="button"
                                onClick={() => void updateOrderStatus(group, "completed")}
                                disabled={anyActionRunning}
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isActing ? <RefreshIcon spinning /> : <CheckIcon />}
                                {isActing ? "正在结算" : "完成并结算会员权益"}
                              </button>
                            ) : null}
                            {onContactOrder ? (
                              <button
                                type="button"
                                onClick={() => void runOrderIntent(group.orderId, "contact", onContactOrder)}
                                disabled={anyActionRunning}
                                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  darkMode
                                    ? "border-sky-400/30 bg-sky-400/10 text-sky-100 hover:bg-sky-400/15"
                                    : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                                }`}
                              >
                                {isContacting ? <RefreshIcon spinning /> : <ChatIcon />}
                                {isContacting ? "正在打开" : "联系客户"}
                              </button>
                            ) : null}
                            {onOpenEnterpriseTask ? (
                              <button
                                type="button"
                                onClick={() => void runOrderIntent(group.orderId, "task", onOpenEnterpriseTask)}
                                disabled={anyActionRunning}
                                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  darkMode
                                    ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15"
                                    : "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100"
                                }`}
                              >
                                {isOpeningTask ? <RefreshIcon spinning /> : <TaskIcon />}
                                {isOpeningTask ? "正在打开" : "创建/查看企业任务"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void loadOrderDetail(group.orderId)}
                              disabled={anyActionRunning}
                              className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
                            >
                              查看详情
                              <ChevronIcon />
                            </button>
                          </div>
                        </div>
                        <p className={`mt-3 text-[11px] leading-5 ${mutedTextClassName}`}>
                          如需取消订单，请进入详情核对订单和客户信息后操作；工作台不提供危险的一键取消。
                        </p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className={`rounded-2xl border border-dashed px-5 py-12 text-center ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                  <div
                    className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full ${
                      darkMode ? "bg-emerald-400/10 text-emerald-200" : "bg-emerald-50 text-emerald-600"
                    }`}
                  >
                    <CheckIcon />
                  </div>
                  <p className="mt-3 text-sm font-bold">当前没有待确认或处理中的订单</p>
                  <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                    新订单、处理中订单和相关异常会自动进入这里
                  </p>
                </div>
              )}
            </section>

            <footer className={`border-t pt-4 text-xs leading-5 ${darkMode ? "border-slate-800" : "border-slate-200"} ${mutedTextClassName}`}>
              <p>
                数据生成于 {formatDateTime(dashboardForCurrentSite.generatedAt)} · 固定处理时效参考线：待确认 {formatDuration(dashboardForCurrentSite.thresholds.confirmationOverdueMinutes)}，处理中 {formatDuration(dashboardForCurrentSite.thresholds.processingOverdueMinutes)}
              </p>
              <p className="mt-1">
                参考线只影响工作台标色与排序，不发送提醒、也不构成履约保证。“今日”按当前设备 {formatTimezoneOffset(dashboardForCurrentSite.timezoneOffsetMinutes)} 时区口径计算；金额不是收入、实付或退款统计。
              </p>
            </footer>
          </div>
          )
        ) : null}
          </>
        )}
      </div>
      {detailOrderIdForCurrentSite ? (
        <OrderDetailDrawer
          orderId={detailOrderIdForCurrentSite}
          order={detailOrderForCurrentSite}
          loading={detailLoading}
          error={detailError}
          actionError={actionError}
          notice={notice}
          mutation={orderMutation}
          intentAction={intentAction}
          darkMode={darkMode}
          onClose={() => {
            closeOrderDetail();
          }}
          onRetry={() => void loadOrderDetail(detailOrderIdForCurrentSite)}
          onAction={(order, action) => {
            void runOrderAction(
              { id: order.id, status: order.status, updatedAt: order.updatedAt },
              action,
            );
          }}
          onPrint={(order) => void printOrder(order)}
          onContact={
            onContactOrder
              ? (orderId) => void runOrderIntent(orderId, "contact", onContactOrder)
              : undefined
          }
          onOpenTask={
            onOpenEnterpriseTask
              ? (orderId) => void runOrderIntent(orderId, "task", onOpenEnterpriseTask)
              : undefined
          }
          onOpenFullOrder={(orderId) => void openFullOrder(orderId)}
        />
      ) : null}
    </section>
  );

  if (!isOverlay) return content;
  if (!portalReady) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[2147482940] flex items-center justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:p-6"
      onMouseDown={handleBackdropMouseDown}
    >
      {content}
    </div>,
    document.body,
  );
}
