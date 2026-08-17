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
} from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import MerchantCatalogManagerPanel from "@/components/admin/MerchantCatalogManagerPanel";
import type { MerchantCatalogTarget } from "@/lib/merchantCatalog";
import {
  formatMerchantOrderAmount,
  getMerchantOrderErrorMessage,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";
import type {
  MerchantOrderWorkbenchDashboard,
  MerchantOrderWorkbenchTodo,
} from "@/lib/merchantOrderWorkbench";

export type OrderWorkbenchView = "overview" | "analysis" | "catalog" | "export";

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
};

type WorkbenchApiPayload = {
  ok?: boolean;
  dashboard?: unknown;
  error?: string;
  message?: string;
  order?: unknown;
};

type TodoGroup = {
  orderId: string;
  status: MerchantOrderStatus;
  createdAt: string;
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
        const shareData: ShareData = { files: [csvFile] };
        const canShareFiles =
          typeof navigator.share === "function" &&
          typeof navigator.canShare === "function" &&
          (() => {
            try {
              return navigator.canShare(shareData);
            } catch {
              return false;
            }
          })();
        if (!canShareFiles) {
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
    let canShareFiles = false;
    try {
      canShareFiles =
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare(shareData);
    } catch {
      canShareFiles = false;
    }
    if (!canShareFiles) {
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
}: OrderWorkbenchPanelProps) {
  const isOverlay = mode === "overlay";
  const [activeView, setActiveView] = useState<OrderWorkbenchView>(initialView);
  const [portalReady, setPortalReady] = useState(false);
  const [dashboard, setDashboard] = useState<MerchantOrderWorkbenchDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [actingOrderId, setActingOrderId] = useState("");
  const [intentAction, setIntentAction] = useState<{ orderId: string; kind: "contact" | "task" } | null>(null);
  const titleId = useId();
  const mountedRef = useRef(true);
  const dashboardRef = useRef<MerchantOrderWorkbenchDashboard | null>(null);
  const dashboardSiteIdRef = useRef("");
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isOverlay) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !onClose) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOverlay, onClose]);

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
    if (activeView === "catalog" || activeView === "export") {
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

  const todoGroups = useMemo(() => {
    if (!dashboard) return [];
    const byOrderId = new Map<string, TodoGroup>();
    dashboard.todos.forEach((todo) => {
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
        customerName: todo.customerName,
        totalAmount: todo.totalAmount,
        pricePrefix: todo.pricePrefix,
        note: todo.note ?? "",
        todos: [todo],
      });
    });
    return [...byOrderId.values()];
  }, [dashboard]);

  const metricCards = useMemo<MetricCard[]>(() => {
    if (!dashboard) return [];
    const { summary } = dashboard;
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
        description: `超过 ${formatDuration(dashboard.thresholds.confirmationOverdueMinutes)}`,
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
        description: `超过 ${formatDuration(dashboard.thresholds.processingOverdueMinutes)}`,
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
  }, [dashboard]);

  const updateOrderStatus = useCallback(
    async (group: TodoGroup, status: "confirmed" | "completed") => {
      if (actingOrderId || intentAction) return;
      if (status === "completed") {
        const confirmed = window.confirm(
          "完成订单会结算会员权益，并可能自动发放积分或成长值。之后若要回退完成状态，已被使用的积分可能导致回退失败。确定要“完成订单并结算会员权益”吗？",
        );
        if (!confirmed) return;
      }

      setActingOrderId(group.orderId);
      setActionError("");
      setNotice("");
      try {
        const response = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: siteId.trim(),
            orderId: group.orderId,
            status,
          }),
        });
        const payload = (await response.json().catch(() => null)) as WorkbenchApiPayload | null;
        if (!response.ok || !payload?.order) {
          throw new Error(getApiError(payload, "订单保存失败，请稍后重试。"));
        }
        setNotice(status === "completed" ? "订单已完成，会员权益结算已同步。" : "订单已确认并进入处理阶段。");
        await Promise.allSettled([
          loadDashboard(),
          Promise.resolve().then(() => onChanged?.()),
        ]);
      } catch (requestError) {
        setActionError(requestError instanceof Error ? requestError.message : "订单保存失败，请稍后重试。");
      } finally {
        if (mountedRef.current) setActingOrderId("");
      }
    },
    [actingOrderId, intentAction, loadDashboard, onChanged, siteId],
  );

  const runOrderIntent = useCallback(
    async (
      orderId: string,
      kind: "contact" | "task",
      callback: ((targetOrderId: string) => void | Promise<void>) | undefined,
    ) => {
      if (!callback || actingOrderId || intentAction) return;
      setIntentAction({ orderId, kind });
      setActionError("");
      setNotice("");
      try {
        await callback(orderId);
      } catch (requestError) {
        setActionError(
          requestError instanceof Error && requestError.message
            ? requestError.message
            : kind === "contact"
              ? "暂时无法联系该订单客户，请稍后重试。"
              : "暂时无法打开企业任务，请稍后重试。",
        );
      } finally {
        if (mountedRef.current) setIntentAction(null);
      }
    },
    [actingOrderId, intentAction],
  );

  const openOrder = useCallback(
    async (orderId: string) => {
      await onOpenOrder(orderId);
      if (isOverlay) onClose?.();
    },
    [isOverlay, onClose, onOpenOrder],
  );

  const openStatus = useCallback(
    (status: MerchantOrderStatus) => {
      onStatusFilter(status);
      if (isOverlay) onClose?.();
    },
    [isOverlay, onClose, onStatusFilter],
  );

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) onClose?.();
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
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? true : undefined}
      aria-labelledby={titleId}
      aria-busy={(activeView === "overview" || activeView === "analysis") && (loading || refreshing)}
      className={`flex min-h-0 w-full flex-col overflow-hidden border ${shellClassName} ${
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
            {(activeView === "overview" || activeView === "analysis") && refreshing ? (
              <span className={`inline-flex items-center gap-1 text-xs ${mutedTextClassName}`}>
                <RefreshIcon spinning /> 正在同步
              </span>
            ) : null}
          </div>
          <p className={`mt-1 text-xs leading-5 sm:text-sm ${mutedTextClassName}`}>
            {activeView === "overview"
              ? "优先处理超时和客户备注订单，快捷操作后同步完整订单列表。"
              : activeView === "analysis"
                ? "查看基于服务端完整订单记录生成的经营趋势和结构。"
                : activeView === "catalog"
                  ? "把商品经营数据逐步从网站编辑迁移到工作台管理。"
                  : "按日期和状态生成完整订单汇总，客户资料默认不导出。"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeView === "overview" || activeView === "analysis" ? (
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading || refreshing}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
              aria-label="刷新订单工作台"
            >
              <RefreshIcon spinning={refreshing} />
              <span className="hidden sm:inline">刷新</span>
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
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
          ["analysis", "经营分析"],
          ["catalog", "商品目录"],
          ["export", "数据导出"],
        ] as const).map(([view, label]) => {
          const active = activeView === view;
          return (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
        {activeView === "catalog" ? (
          <MerchantCatalogManagerPanel
            siteId={siteId}
            darkMode={darkMode}
            catalogTarget={catalogTarget}
            onChanged={onChanged}
          />
        ) : activeView === "export" ? (
          <OrderExportPanel siteId={siteId} darkMode={darkMode} />
        ) : (
          <>
        {loading && !dashboard ? <LoadingSkeleton darkMode={darkMode} /> : null}

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

        {dashboard ? (
          activeView === "analysis" ? (
            <OrderWorkbenchAnalysis
              dashboard={dashboard}
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
                    共 {dashboard.summary.total} 笔订单，指标由完整订单数据在服务端计算
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
                <span className={`text-xs ${mutedTextClassName}`}>{dashboard.amounts.length} 个金额分组</span>
              </div>
              {dashboard.amounts.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dashboard.amounts.map((amount, index) => (
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
                                onClick={() => void openOrder(group.orderId)}
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
                                  {getTodoLabel(todo, dashboard)}
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
                              onClick={() => void openOrder(group.orderId)}
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
                数据生成于 {formatDateTime(dashboard.generatedAt)} · 待确认 SLA {formatDuration(dashboard.thresholds.confirmationOverdueMinutes)} · 处理 SLA {formatDuration(dashboard.thresholds.processingOverdueMinutes)}
              </p>
              <p className="mt-1">
                “今日”按当前设备 {formatTimezoneOffset(dashboard.timezoneOffsetMinutes)} 时区口径计算。金额不是收入、实付或退款统计。
              </p>
            </footer>
          </div>
          )
        ) : null}
          </>
        )}
      </div>
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
