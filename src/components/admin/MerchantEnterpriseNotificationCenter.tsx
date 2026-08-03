"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MerchantEnterpriseActor,
  MerchantEnterpriseEmployee,
  MerchantEnterpriseNotification,
  MerchantTask,
} from "@/lib/merchantEnterprise";

type EmployeeActor = Extract<MerchantEnterpriseActor, { type: "employee" }>;

type NotificationPayload = {
  ok?: boolean;
  error?: string;
  notifications?: MerchantEnterpriseNotification[];
  unreadCount?: number;
  nextCursor?: string | null;
};

type MutationPayload = {
  ok?: boolean;
  error?: string;
  unreadCount?: number;
};

type MerchantEnterpriseNotificationCenterProps = {
  siteId: string;
  actor: EmployeeActor;
  employees: readonly MerchantEnterpriseEmployee[];
  tasks: readonly MerchantTask[];
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onOpenTask: (task: MerchantTask) => boolean;
  onOpenWorkflow?: (workflowId: string) => boolean;
  refreshIntervalMs?: number;
};

const DEFAULT_NOTIFICATION_REFRESH_INTERVAL_MS = 30_000;

function formatNotificationTime(value: string) {
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

function notificationDescription(notification: MerchantEnterpriseNotification) {
  if (notification.type === "task_assigned") return "将任务分派给了你";
  if (notification.type === "task_unassigned") return "取消了你的任务分派";
  if (notification.type === "task_commented") return "在任务中发表了评论";
  if (notification.type === "task_due_changed") {
    return notification.payload.dueAt ? "更新了任务截止时间" : "移除了任务截止时间";
  }
  if (notification.type === "workflow_published") return "发布了工作流程";
  return "更新了任务";
}

function readPayloadError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    const error = (payload as { error: string }).error;
    if (error === "permission_denied") return "当前角色已无权查看企业通知。";
    if (error === "enterprise_schema_unavailable") return "企业通知正在升级，请稍后再试。";
  }
  return fallback;
}

export default function MerchantEnterpriseNotificationCenter({
  siteId,
  actor,
  employees,
  tasks,
  apiFetch,
  onOpenTask,
  onOpenWorkflow,
  refreshIntervalMs = DEFAULT_NOTIFICATION_REFRESH_INTERVAL_MS,
}: MerchantEnterpriseNotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<MerchantEnterpriseNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task] as const)),
    [tasks],
  );
  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee] as const)),
    [employees],
  );

  const loadNotifications = useCallback(
    async (
      options: { append?: boolean; silent?: boolean; cursor?: string | null } = {},
    ) => {
      const requestSequence = ++requestSequenceRef.current;
      if (options.append) setLoadingMore(true);
      else if (!options.silent) setLoading(true);
      if (!options.silent) setError("");
      try {
        const query = new URLSearchParams({ siteId, limit: "20" });
        if (options.append && options.cursor) query.set("cursor", options.cursor);
        const response = await apiFetch(
          `/api/merchant-enterprise/notifications?${query.toString()}`,
        );
        const payload = (await response.json().catch(() => null)) as NotificationPayload | null;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.notifications)) {
          throw new Error(
            readPayloadError(payload, "企业通知加载失败，请稍后重试。"),
          );
        }
        if (requestSequence !== requestSequenceRef.current) return;
        setNotifications((current) => {
          const incoming = payload.notifications ?? [];
          if (!options.append) return incoming;
          const merged = new Map(current.map((item) => [item.id, item] as const));
          incoming.forEach((item) => merged.set(item.id, item));
          return [...merged.values()];
        });
        setUnreadCount(
          Number.isSafeInteger(payload.unreadCount) && Number(payload.unreadCount) >= 0
            ? Number(payload.unreadCount)
            : 0,
        );
        setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
        setError("");
      } catch (loadError) {
        if (requestSequence !== requestSequenceRef.current) return;
        if (!options.silent) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "企业通知加载失败，请稍后重试。",
          );
        }
      } finally {
        if (requestSequence === requestSequenceRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [apiFetch, siteId],
  );

  useEffect(() => {
    void loadNotifications();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadNotifications]);

  useEffect(() => {
    const intervalMs = Math.max(5_000, refreshIntervalMs);
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void loadNotifications({ silent: true });
      }
    };
    const intervalId = window.setInterval(refreshIfVisible, intervalMs);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadNotifications, refreshIntervalMs]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const markRead = useCallback(
    async (input: { notificationId?: string; all?: true }) => {
      const response = await apiFetch("/api/merchant-enterprise/notifications", {
        method: "PATCH",
        body: JSON.stringify({ siteId, ...input }),
      });
      const payload = (await response.json().catch(() => null)) as MutationPayload | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(readPayloadError(payload, "通知状态保存失败，请稍后重试。"));
      }
      return Number.isSafeInteger(payload.unreadCount) && Number(payload.unreadCount) >= 0
        ? Number(payload.unreadCount)
        : 0;
    },
    [apiFetch, siteId],
  );

  async function markAllRead() {
    if (mutationBusy || unreadCount === 0) return;
    setMutationBusy(true);
    setError("");
    try {
      const nextUnreadCount = await markRead({ all: true });
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((notification) =>
          notification.readAt ? notification : { ...notification, readAt },
        ),
      );
      setUnreadCount(nextUnreadCount);
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "通知状态保存失败，请稍后重试。",
      );
    } finally {
      setMutationBusy(false);
    }
  }

  async function openNotification(notification: MerchantEnterpriseNotification) {
    if (notification.type === "workflow_published") {
      if (!notification.workflowId || !onOpenWorkflow?.(notification.workflowId)) return;
    } else {
      const task = notification.taskId ? taskById.get(notification.taskId) : undefined;
      if (!task || !onOpenTask(task)) return;
    }
    setOpen(false);
    if (!notification.readAt) {
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      void markRead({ notificationId: notification.id })
        .then(setUnreadCount)
        .catch(() => {
          // Reading a notification must never block opening the task.
          void loadNotifications({ silent: true });
        });
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="relative min-h-9 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        aria-label={`企业通知${unreadCount > 0 ? `，${unreadCount} 条未读` : "，暂无未读"}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void loadNotifications({ silent: true });
        }}
      >
        <span aria-hidden="true">通知</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          role="dialog"
          aria-label="企业通知"
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left text-slate-900 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">企业通知</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {unreadCount > 0 ? `${unreadCount} 条未读` : "已全部读完"}
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-semibold text-blue-700 disabled:text-slate-400"
              disabled={mutationBusy || unreadCount === 0}
              onClick={() => void markAllRead()}
            >
              全部已读
            </button>
          </div>

          <div className="max-h-[min(32rem,65vh)] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">正在加载通知…</p>
            ) : null}
            {!loading && error ? (
              <div className="m-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                <p>{error}</p>
                <button
                  type="button"
                  className="mt-2 font-semibold underline"
                  onClick={() => void loadNotifications()}
                >
                  重新加载
                </button>
              </div>
            ) : null}
            {!loading && notifications.length === 0 && !error ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">暂无企业通知。</p>
            ) : null}
            {notifications.map((notification) => {
              const task = notification.taskId
                ? taskById.get(notification.taskId)
                : undefined;
              const workflowAvailable = Boolean(
                notification.type === "workflow_published" &&
                  notification.workflowId &&
                  onOpenWorkflow,
              );
              const actorLabel =
                notification.actorType === "owner"
                  ? "企业负责人"
                  : notification.actorType === "employee"
                    ? notification.actorId === actor.id
                      ? "你"
                      : employeeById.get(notification.actorId)?.displayName || "企业员工"
                    : "系统";
              return (
                <button
                  key={notification.id}
                  type="button"
                  className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 disabled:cursor-default ${
                    notification.readAt ? "bg-white" : "bg-blue-50/70"
                  }`}
                  disabled={!task && !workflowAvailable}
                  onClick={() => void openNotification(notification)}
                >
                  <span className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        notification.readAt ? "bg-slate-200" : "bg-blue-600"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-5 text-slate-800">
                        <span className="font-semibold">{actorLabel}</span>
                        {notificationDescription(notification)}
                      </span>
                      <span className="mt-1 block truncate text-sm font-medium text-slate-950">
                        {notification.type === "workflow_published"
                          ? notification.payload.workflowTitle || "工作流程"
                          : task?.title || "该任务当前不可访问"}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {formatNotificationTime(notification.createdAt)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
            {nextCursor ? (
              <div className="p-3 text-center">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-45"
                  disabled={loadingMore}
                  onClick={() =>
                    void loadNotifications({ append: true, cursor: nextCursor })
                  }
                >
                  {loadingMore ? "加载中…" : "查看更多"}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
