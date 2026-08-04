"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  type MerchantEnterpriseAuditEntityType,
  type MerchantEnterpriseAuditEvent,
  type MerchantEnterpriseRole,
  type MerchantTaskBoard,
} from "@/lib/merchantEnterprise";

type AuditPayload = {
  ok?: boolean;
  error?: string;
  events?: MerchantEnterpriseAuditEvent[];
  nextCursor?: string | null;
};

type MerchantEnterpriseAuditLogProps = {
  siteId: string;
  roles: readonly MerchantEnterpriseRole[];
  boards: readonly MerchantTaskBoard[];
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const ENTITY_FILTERS: ReadonlyArray<{
  value: MerchantEnterpriseAuditEntityType | "all";
  label: string;
}> = [
  { value: "all", label: "全部对象" },
  { value: "workspace", label: "工作区" },
  { value: "role", label: "角色权限" },
  { value: "board", label: "任务看板" },
  { value: "column", label: "工作列" },
  { value: "employee", label: "员工账号" },
  { value: "invitation", label: "员工邀请" },
  { value: "workflow", label: "工作流程" },
  { value: "automation", label: "流程自动化" },
];

const EVENT_LABELS: Record<string, string> = {
  "workspace.bootstrapped": "初始化了企业工作区",
  "role.created": "创建了角色",
  "role.updated": "更新了角色",
  "role.board_scope_changed": "调整了角色看板范围",
  "board.created": "创建了任务看板",
  "board.updated": "更新了任务看板",
  "column.created": "创建了工作列",
  "column.updated": "更新了工作列",
  "employee.created": "创建了员工账号",
  "employee.updated": "更新了员工账号",
  "employee.renamed": "修改了员工姓名",
  "employee.role_changed": "变更了员工角色",
  "employee.disabled": "停用了员工账号",
  "employee.restored": "恢复了员工账号",
  "employee.removed": "移除了员工账号",
  "invitation.reserved": "生成了员工邀请",
  "invitation.revoked": "撤销了员工邀请",
  "invitation.removed": "移除了待接受邀请",
  "invitation.accepted": "接受了员工邀请",
  "invitation.delivery_finalized": "更新了邀请发送结果",
  "invitation.auth_bound": "完成了员工登录绑定",
  "workflow.created": "创建了工作流程",
  "workflow.updated": "更新了工作流程草稿",
  "workflow.published": "发布了工作流程",
  "workflow.archived": "归档了工作流程",
  "workflow.restored": "恢复了工作流程",
  "automation.created": "创建了自动化规则",
  "automation.updated": "更新了自动化规则",
  "automation.paused": "暂停了自动化规则",
  "automation.resumed": "启用了自动化规则",
  "automation.archived": "归档了自动化规则",
  "automation.fired": "触发了自动化规则",
  "automation.failed": "自动化规则执行失败",
};

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  description: "说明",
  permissions: "权限",
  status: "状态",
  is_system: "系统角色",
  access_scope: "看板范围",
  system_key: "系统标识",
  board_id: "任务看板",
  color: "颜色",
  position: "排序",
  is_done: "完成列",
  display_name: "员工姓名",
  role_id: "角色",
  auth_bound: "登录绑定",
  invitation_version: "邀请版本",
  invitation_delivery_status: "发送状态",
  invitation_sent_at: "发送时间",
  invitation_expires_at: "失效时间",
  invitation_revoked_at: "撤销时间",
  accepted_at: "接受时间",
  initialized: "初始化",
  title: "标题",
  category: "分类",
  published_version: "发布版本",
  step_count: "步骤数量",
};

const STATUS_LABELS: Record<string, string> = {
  active: "启用",
  archived: "已归档",
  invited: "待接受",
  disabled: "已停用",
  none: "未发送",
  legacy: "旧邀请",
  sending: "发送中",
  sent: "已发送",
  failed: "发送失败",
  revoked: "已撤销",
  all: "全部看板",
  restricted: "指定看板",
  draft: "草稿",
  published: "已发布",
};

const permissionLabelByKey = new Map<string, string>(
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG.map((permission) => [
    permission.key,
    permission.label,
  ]),
);

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return formatAuditTime(date.toISOString());
}

function readAuditError(payload: unknown, fallback: string) {
  const code =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "";
  if (code === "permission_denied") return "当前角色没有查看企业操作记录的权限。";
  if (code === "enterprise_schema_unavailable") return "企业操作记录正在升级，请稍后再试。";
  if (code === "invalid_enterprise_audit_cursor") return "记录列表已变化，请重新加载。";
  return fallback;
}

function changedFields(event: MerchantEnterpriseAuditEvent) {
  const keys = new Set([
    ...Object.keys(event.beforeData),
    ...Object.keys(event.afterData),
  ]);
  return [...keys].filter(
    (key) =>
      JSON.stringify(event.beforeData[key]) !== JSON.stringify(event.afterData[key]),
  );
}

export default function MerchantEnterpriseAuditLog({
  siteId,
  roles,
  boards,
  apiFetch,
}: MerchantEnterpriseAuditLogProps) {
  const [events, setEvents] = useState<MerchantEnterpriseAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<MerchantEnterpriseAuditEntityType | "all">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestSequenceRef = useRef(0);
  const roleById = useMemo(
    () => new Map(roles.map((role) => [role.id, role.name] as const)),
    [roles],
  );
  const boardById = useMemo(
    () => new Map(boards.map((board) => [board.id, board.name] as const)),
    [boards],
  );

  const loadEvents = useCallback(
    async (options: { append?: boolean; cursor?: string | null } = {}) => {
      const requestSequence = ++requestSequenceRef.current;
      if (options.append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ siteId, limit: "50" });
        if (entityType !== "all") params.set("entityType", entityType);
        if (options.append && options.cursor) params.set("cursor", options.cursor);
        const response = await apiFetch(
          `/api/merchant-enterprise/audit-events?${params.toString()}`,
        );
        const payload = (await response.json().catch(() => null)) as AuditPayload | null;
        if (!response.ok || !payload?.ok || !Array.isArray(payload.events)) {
          throw new Error(readAuditError(payload, "企业操作记录加载失败，请稍后重试。"));
        }
        if (requestSequence !== requestSequenceRef.current) return;
        setEvents((current) => {
          const incoming = payload.events ?? [];
          if (!options.append) return incoming;
          const merged = new Map(current.map((event) => [event.id, event] as const));
          incoming.forEach((event) => merged.set(event.id, event));
          return [...merged.values()];
        });
        setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
      } catch (loadError) {
        if (requestSequence !== requestSequenceRef.current) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "企业操作记录加载失败，请稍后重试。",
        );
      } finally {
        if (requestSequence === requestSequenceRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [apiFetch, entityType, siteId],
  );

  useEffect(() => {
    void loadEvents();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [loadEvents]);

  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedQuery) return events;
    return events.filter((event) =>
      [
        event.actorLabel,
        event.targetLabel,
        EVENT_LABELS[event.eventType] || event.eventType,
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedQuery),
    );
  }, [events, query]);

  function formatValue(field: string, value: unknown) {
    if (value === null || value === undefined || value === "") return "无";
    if (field === "permissions" && Array.isArray(value)) {
      const labels = value
        .filter((item): item is string => typeof item === "string")
        .map((permission) => permissionLabelByKey.get(permission) || permission);
      return labels.length > 0 ? labels.join("、") : "无权限";
    }
    if (field === "role_id" && typeof value === "string") {
      return roleById.get(value) || "已删除或不可见角色";
    }
    if (field === "board_id" && typeof value === "string") {
      return boardById.get(value) || "已归档或不可见看板";
    }
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "string") {
      if (STATUS_LABELS[value]) return STATUS_LABELS[value];
      if (/(?:_at|At)$/.test(field)) return formatTimestamp(value);
      return value;
    }
    if (Array.isArray(value)) return value.join("、") || "无";
    if (typeof value === "number") return String(value);
    return "已更新";
  }

  return (
    <section className="mt-5 space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">企业操作记录</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              记录员工、角色、看板、工作流程、流程自动化和邀请的关键管理变化。记录不可修改或删除。
            </p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45"
            disabled={loading}
            onClick={() => void loadEvents()}
          >
            {loading ? "刷新中…" : "刷新记录"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className="text-xs font-medium text-slate-600">
            搜索操作人或对象
            <input
              type="search"
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              placeholder="例如：管理员、员工姓名或看板"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            对象类型
            <select
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              value={entityType}
              onChange={(event) =>
                setEntityType(event.target.value as MerchantEnterpriseAuditEntityType | "all")
              }
            >
              {ENTITY_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">正在加载操作记录…</div>
        ) : null}
        {!loading && visibleEvents.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            {events.length === 0 ? "暂无企业操作记录。" : "没有符合筛选条件的记录。"}
          </div>
        ) : null}
        {!loading ? (
          <ol className="divide-y divide-slate-100">
            {visibleEvents.map((event) => {
              const fields = changedFields(event).slice(0, 8);
              return (
                <li key={event.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-6 text-slate-800">
                        <span className="font-semibold text-slate-950">{event.actorLabel}</span>
                        <span className="mx-1">{EVENT_LABELS[event.eventType] || "更新了企业配置"}</span>
                        <span className="font-semibold text-slate-950">“{event.targetLabel}”</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatAuditTime(event.createdAt)}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {ENTITY_FILTERS.find((filter) => filter.value === event.entityType)?.label || "企业对象"}
                    </span>
                  </div>
                  {fields.length > 0 ? (
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                      {fields.map((field) => (
                        <div key={field} className="rounded-xl bg-slate-50 px-3 py-2 text-xs">
                          <dt className="font-semibold text-slate-600">{FIELD_LABELS[field] || field}</dt>
                          <dd className="mt-1 break-words text-slate-700">
                            <span className="text-slate-500">{formatValue(field, event.beforeData[field])}</span>
                            <span className="mx-1.5" aria-hidden="true">→</span>
                            <span className="font-medium text-slate-900">{formatValue(field, event.afterData[field])}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        {nextCursor && !loading && !query.trim() ? (
          <div className="border-t border-slate-100 p-4 text-center">
            <button
              type="button"
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-45"
              disabled={loadingMore}
              onClick={() => void loadEvents({ append: true, cursor: nextCursor })}
            >
              {loadingMore ? "加载中…" : "查看更多记录"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
