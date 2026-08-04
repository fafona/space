"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  normalizeMerchantEnterpriseTodoPage,
  type MerchantEnterpriseTodo,
  type MerchantEnterpriseTodoCounts,
} from "@/lib/merchantEnterpriseTodos";

const TODO_API = "/api/merchant-enterprise/todos";
const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const PAGE_SIZE = 20;

export type MerchantEnterpriseTodoCategory = "all" | "tasks" | "workflows";

export type MerchantEnterpriseTodoCenterProps = {
  siteId: string;
  actor: MerchantEnterpriseActor;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onOpenTask: (taskId: string) => void;
  onOpenWorkflow: (workflowId: string, executionId?: string) => void;
  onCountChange?: (count: number) => void;
  refreshIntervalMs?: number;
};

type LoadOptions = {
  append?: boolean;
  cursor?: string | null;
  silent?: boolean;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPayloadError(payload: unknown, fallback: string) {
  const code = object(payload)?.error;
  if (code === "permission_denied" || code === "merchant_access_denied") {
    return "当前账号已无权查看企业待办。";
  }
  if (code === "enterprise_schema_unavailable") {
    return "企业待办正在升级，请稍后再试。";
  }
  if (code === "invalid_enterprise_todo_query") {
    return "待办筛选条件无效，请刷新页面后重试。";
  }
  return fallback;
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function priorityLabel(priority: string) {
  if (priority === "urgent") return "紧急";
  if (priority === "high") return "高优先级";
  if (priority === "low") return "低优先级";
  return "普通";
}

function reasonLabel(reason: MerchantEnterpriseTodo["reasons"][number]) {
  if (reason === "assigned_to_me") return "已分配给我";
  if (reason === "overdue") return "超过截止时间";
  if (reason === "due_soon") return "即将到期";
  if (reason === "unassigned") return "尚未分配负责人";
  if (reason === "acknowledgement_required") return "需要确认最新发布版本";
  if (reason === "execution_in_progress") return "有未完成的执行记录";
  return "员工反馈等待处理";
}

function itemPresentation(item: MerchantEnterpriseTodo) {
  if (item.kind === "task") {
    return {
      kindLabel: "任务待办",
      actionLabel: "打开任务",
      tone: "border-blue-200 bg-blue-50 text-blue-700",
      meta: [item.boardName, priorityLabel(item.priority)].filter(Boolean),
    };
  }
  if (item.kind === "workflow_acknowledgement") {
    return {
      kindLabel: "待阅读确认",
      actionLabel: "阅读并确认",
      tone: "border-violet-200 bg-violet-50 text-violet-700",
      meta: [`发布版本 v${item.revisionNo}`],
    };
  }
  if (item.kind === "workflow_execution") {
    return {
      kindLabel: "流程执行中",
      actionLabel: "继续执行",
      tone: "border-cyan-200 bg-cyan-50 text-cyan-700",
      meta: [
        `发布版本 v${item.revisionNo}`,
        `已完成 ${item.completedSteps}/${item.totalSteps} 步`,
      ],
    };
  }
  return {
    kindLabel: "待处理反馈",
    actionLabel: "处理反馈",
    tone: "border-amber-200 bg-amber-50 text-amber-800",
    meta: [`${item.employeeName} · 版本 v${item.revisionNo}`],
  };
}

function urgencyPresentation(item: MerchantEnterpriseTodo) {
  if (item.urgency === "overdue") {
    return {
      label: "已逾期",
      className: "bg-rose-100 text-rose-700",
    };
  }
  if (item.urgency === "due_soon") {
    return {
      label: "即将到期",
      className: "bg-amber-100 text-amber-800",
    };
  }
  return null;
}

function emptyMessage(category: MerchantEnterpriseTodoCategory) {
  if (category === "tasks") return "暂无需要处理的任务待办。";
  if (category === "workflows") return "暂无需要处理的工作流程待办。";
  return "目前没有待办，所有事项都已处理完成。";
}

export default function MerchantEnterpriseTodoCenter({
  siteId,
  actor,
  apiFetch,
  onOpenTask,
  onOpenWorkflow,
  onCountChange,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: MerchantEnterpriseTodoCenterProps) {
  const [category, setCategory] =
    useState<MerchantEnterpriseTodoCategory>("all");
  const [items, setItems] = useState<MerchantEnterpriseTodo[]>([]);
  const [counts, setCounts] = useState<MerchantEnterpriseTodoCounts | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const scope = `${siteId}:${actor.siteId}:${actor.type}:${actor.id}:${category}`;
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;

  const loadTodos = useCallback(
    async (options: LoadOptions = {}) => {
      if (!/^\d{8}$/.test(siteId) || actor.siteId !== siteId) {
        setLoading(false);
        setLoadingMore(false);
        setError("当前账号与企业空间不匹配，无法加载待办。");
        return;
      }

      const requestSequence = ++requestSequenceRef.current;
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      const isCurrentRequest = () =>
        requestSequenceRef.current === requestSequence &&
        activeScopeRef.current === scope &&
        !controller.signal.aborted;

      if (options.append) setLoadingMore(true);
      else if (!options.silent) setLoading(true);
      if (!options.silent) setError("");

      try {
        const query = new URLSearchParams({
          siteId,
          category,
          limit: String(PAGE_SIZE),
        });
        if (options.append && options.cursor) {
          query.set("cursor", options.cursor);
        }
        const response = await apiFetch(`${TODO_API}?${query.toString()}`, {
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok || object(payload)?.ok !== true) {
          throw new Error(
            readPayloadError(payload, "企业待办加载失败，请稍后重试。"),
          );
        }
        const page = normalizeMerchantEnterpriseTodoPage(payload);
        const categoryMismatch = page?.items.some((item) =>
          category === "tasks"
            ? item.kind !== "task"
            : category === "workflows"
              ? item.kind === "task"
              : false,
        );
        if (
          !page ||
          page.merchantId !== siteId ||
          page.items.length > PAGE_SIZE ||
          categoryMismatch ||
          (options.append && page.nextCursor === options.cursor) ||
          !isCurrentRequest()
        ) {
          if (!isCurrentRequest()) return;
          throw new Error("企业待办数据无法验证，请稍后重试。");
        }

        setItems((current) => {
          if (!options.append) return page.items;
          const merged = new Map(current.map((item) => [item.id, item] as const));
          page.items.forEach((item) => merged.set(item.id, item));
          return [...merged.values()];
        });
        setCounts(page.counts);
        setNextCursor(page.nextCursor);
        setLastUpdatedAt(new Date().toISOString());
        setError("");
      } catch (loadError) {
        if (!isCurrentRequest() || isAbortError(loadError)) return;
        if (!options.silent) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "企业待办加载失败，请稍后重试。",
          );
        }
      } finally {
        if (isCurrentRequest()) {
          setLoading(false);
          setLoadingMore(false);
          if (requestControllerRef.current === controller) {
            requestControllerRef.current = null;
          }
        }
      }
    },
    [actor.siteId, apiFetch, category, scope, siteId],
  );

  useEffect(() => {
    setItems([]);
    setCounts(null);
    setNextCursor(null);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setLastUpdatedAt(null);
    void loadTodos();
    return () => {
      requestSequenceRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [loadTodos, scope]);

  useEffect(() => {
    const intervalMs = Math.max(1_000, refreshIntervalMs);
    let intervalId: number | null = null;

    const stopPolling = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadTodos({ silent: true });
      }
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === "visible") {
        intervalId = window.setInterval(refresh, intervalMs);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
        requestSequenceRef.current += 1;
        requestControllerRef.current?.abort();
        requestControllerRef.current = null;
        return;
      }
      refresh();
      startPolling();
    };
    const handleFocus = () => refresh();

    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadTodos, refreshIntervalMs]);

  const openCount = counts?.openCount ?? null;
  useEffect(() => {
    if (openCount !== null) onCountChange?.(openCount);
  }, [onCountChange, openCount]);

  const workflowCount = counts
    ? counts.acknowledgementCount + counts.executionCount + counts.feedbackCount
    : 0;
  const categoryCounts: Record<MerchantEnterpriseTodoCategory, number | null> = {
    all: counts?.openCount ?? null,
    tasks: counts?.taskCount ?? null,
    workflows: counts ? workflowCount : null,
  };
  const statisticCards = useMemo(
    () => [
      {
        key: "task",
        label: "任务待办",
        value: counts?.taskCount ?? 0,
        tone: "text-blue-700",
      },
      {
        key: "acknowledgement",
        label: "待阅读确认",
        value: counts?.acknowledgementCount ?? 0,
        tone: "text-violet-700",
      },
      {
        key: "execution",
        label: "流程执行中",
        value: counts?.executionCount ?? 0,
        tone: "text-cyan-700",
      },
      {
        key: "feedback",
        label: "待处理反馈",
        value: counts?.feedbackCount ?? 0,
        tone: "text-amber-700",
      },
    ],
    [counts],
  );

  function openTodo(item: MerchantEnterpriseTodo) {
    if (item.kind === "task") {
      onOpenTask(item.taskId);
      return;
    }
    if (
      item.kind === "workflow_execution" ||
      item.kind === "workflow_feedback"
    ) {
      onOpenWorkflow(item.workflowId, item.executionId);
      return;
    }
    onOpenWorkflow(item.workflowId);
  }

  return (
    <section
      className="space-y-4"
      aria-labelledby="enterprise-todo-heading"
      data-enterprise-todo-center
    >
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="enterprise-todo-heading" className="text-xl font-bold text-slate-950">
                统一待办
              </h2>
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
                {counts?.openCount ?? 0}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              汇总需要你处理的任务、流程阅读、执行事项和员工反馈。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdatedAt ? (
              <span className="hidden text-xs text-slate-400 sm:inline">
                更新于 {formatTime(lastUpdatedAt)}
              </span>
            ) : null}
            <button
              type="button"
              className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-45"
              disabled={loading || loadingMore}
              onClick={() => void loadTodos()}
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {statisticCards.map((card) => (
            <div key={card.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-xs text-slate-500">{card.label}</div>
              <div className={`mt-1 text-2xl font-bold ${card.tone}`}>
                {counts ? card.value : "—"}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">
            已逾期 {counts?.overdueCount ?? 0}
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">
            即将到期 {counts?.dueSoonCount ?? 0}
          </span>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div
            role="tablist"
            aria-label="待办分类"
            className="inline-flex rounded-xl bg-slate-100 p-1"
          >
            {(
              [
                ["all", "全部"],
                ["tasks", "任务"],
                ["workflows", "工作流程"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={category === value}
                className={`min-h-9 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  category === value
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setCategory(value)}
              >
                {label}
                {categoryCounts[value] !== null ? (
                  <span className="ml-1 text-xs text-slate-400">
                    {categoryCounts[value]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">每页最多 {PAGE_SIZE} 项</span>
        </div>

        {loading && items.length === 0 ? (
          <div className="px-4 py-14 text-center sm:px-5" aria-live="polite">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
            <p className="mt-3 text-sm text-slate-500">正在整理企业待办…</p>
          </div>
        ) : null}

        {!loading && error && items.length === 0 ? (
          <div className="px-4 py-12 text-center sm:px-5" role="alert">
            <p className="text-sm text-rose-700">{error}</p>
            <button
              type="button"
              className="mt-3 min-h-10 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={() => void loadTodos()}
            >
              重新加载
            </button>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <div className="px-4 py-14 text-center sm:px-5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-xl text-emerald-700" aria-hidden="true">
              ✓
            </div>
            <h3 className="mt-3 font-semibold text-slate-900">当前没有待办</h3>
            <p className="mt-1 text-sm text-slate-500">{emptyMessage(category)}</p>
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {items.map((item) => {
              const presentation = itemPresentation(item);
              const urgency = urgencyPresentation(item);
              return (
                <article key={item.id} className="px-4 py-4 sm:px-5" data-todo-kind={item.kind}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${presentation.tone}`}>
                          {presentation.kindLabel}
                        </span>
                        {urgency ? (
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${urgency.className}`}>
                            {urgency.label}
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-2 truncate font-semibold text-slate-950">{item.title}</h3>
                      {item.subtitle ? (
                        <p className="mt-1 text-sm leading-6 text-slate-600">{item.subtitle}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        {presentation.meta.map((value) => (
                          <span key={value}>{value}</span>
                        ))}
                        {item.dueAt ? <span>截止 {formatTime(item.dueAt)}</span> : null}
                        {!item.dueAt && item.attentionAt ? (
                          <span>更新 {formatTime(item.attentionAt)}</span>
                        ) : null}
                      </div>
                      {item.reasons.length > 0 ? (
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          {item.reasons.map(reasonLabel).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="min-h-10 shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                      onClick={() => openTodo(item)}
                    >
                      {presentation.actionLabel}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {items.length > 0 && error ? (
          <div className="border-t border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => void loadTodos()}
            >
              重试
            </button>
          </div>
        ) : null}

        {nextCursor ? (
          <div className="border-t border-slate-100 p-4 text-center">
            <button
              type="button"
              className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45"
              disabled={loading || loadingMore}
              onClick={() =>
                void loadTodos({ append: true, cursor: nextCursor })
              }
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
