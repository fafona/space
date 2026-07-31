"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hasMerchantEnterprisePermission,
  merchantEnterprisePermissionsFitActor,
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseEmployee,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRole,
  type MerchantEnterpriseSnapshot,
  type MerchantTask,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";

type EnterpriseTab = "overview" | "tasks" | "employees" | "roles";

type MerchantEnterpriseManagerProps = {
  siteId: string;
  siteName?: string;
  accessToken?: string;
  className?: string;
  standalone?: boolean;
};

type OverviewPayload = {
  ok?: boolean;
  error?: string;
  actor?: MerchantEnterpriseActor;
  snapshot?: MerchantEnterpriseSnapshot;
  needsBootstrap?: boolean;
};

const EMPTY_SNAPSHOT: MerchantEnterpriseSnapshot = {
  roles: [],
  employees: [],
  boards: [],
  columns: [],
  tasks: [],
};

const PRIORITY_META: Record<MerchantTaskPriority, { label: string; className: string }> = {
  low: { label: "低", className: "bg-slate-100 text-slate-600" },
  normal: { label: "普通", className: "bg-blue-50 text-blue-700" },
  high: { label: "高", className: "bg-amber-50 text-amber-700" },
  urgent: { label: "紧急", className: "bg-rose-50 text-rose-700" },
};

function can(
  actor: MerchantEnterpriseActor | null,
  permission: MerchantEnterprisePermission,
) {
  return hasMerchantEnterprisePermission(actor, permission);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function readApiError(payload: unknown, fallback: string) {
  const code =
    payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "";
  if (code === "enterprise_schema_unavailable") return "企业管理数据库尚未初始化，请先部署对应数据库迁移。";
  if (code === "enterprise_management_disabled") return "当前商户尚未开通企业管理。";
  if (code === "permission_denied") return "当前账号没有执行此操作的权限。";
  if (code === "permission_escalation_denied") return "不能授予高于当前账号的权限，也不能修改自己的管理角色。";
  if (code === "merchant_access_denied") return "当前账号不属于这个企业。";
  if (code === "enterprise_version_conflict") return "数据已被其他人更新，已为你重新加载。";
  if (code === "invalid_version") return "数据版本无效，请重新加载后再试。";
  if (code === "employee_email_already_registered") return "该邮箱已注册为其他 Faolla 身份，请使用独立的员工邮箱。";
  if (code === "unauthorized") return "登录状态已失效，请重新登录。";
  return fallback;
}

function RoleEditor({
  role,
  busy,
  onSave,
}: {
  role: MerchantEnterpriseRole;
  busy: boolean;
  onSave: (role: MerchantEnterpriseRole, permissions: MerchantEnterprisePermission[]) => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<MerchantEnterprisePermission[]>(role.permissions);

  useEffect(() => {
    setPermissions(role.permissions);
  }, [role]);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-950">{role.name}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">{role.description || "未填写角色说明"}</div>
        </div>
        {role.isSystem ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">系统角色</span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {MERCHANT_ENTERPRISE_PERMISSION_CATALOG.map((permission) => {
          const checked = permissions.includes(permission.key);
          return (
            <label
              key={`${role.id}-${permission.key}`}
              className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                onChange={(event) => {
                  setPermissions((current) =>
                    event.target.checked
                      ? Array.from(new Set([...current, permission.key]))
                      : current.filter((item) => item !== permission.key),
                  );
                }}
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">{permission.label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{permission.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
        disabled={busy}
        onClick={() => void onSave(role, permissions)}
      >
        保存权限
      </button>
    </article>
  );
}

export default function MerchantEnterpriseManager(props: MerchantEnterpriseManagerProps) {
  // Reset every tenant-scoped state value before rendering a different merchant or access token.
  const accessScopeKey = JSON.stringify([props.siteId, props.accessToken ?? ""]);
  return <MerchantEnterpriseManagerContent key={accessScopeKey} {...props} />;
}

function MerchantEnterpriseManagerContent({
  siteId,
  siteName = "",
  accessToken = "",
  className = "",
  standalone = false,
}: MerchantEnterpriseManagerProps) {
  const [tab, setTab] = useState<EnterpriseTab>("overview");
  const [actor, setActor] = useState<MerchantEnterpriseActor | null>(null);
  const [snapshot, setSnapshot] = useState<MerchantEnterpriseSnapshot>(EMPTY_SNAPSHOT);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const overviewRequestSequenceRef = useRef(0);
  const overviewAbortControllerRef = useRef<AbortController | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState<MerchantTaskPriority>("normal");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");

  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeRoleId, setEmployeeRoleId] = useState("");
  const [failedInvitationEmployeeIds, setFailedInvitationEmployeeIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      if (accessToken) headers.set("x-merchant-access-token", accessToken);
      return fetch(path, {
        ...init,
        headers,
        credentials: "include",
        cache: "no-store",
      });
    },
    [accessToken],
  );

  const loadOverview = useCallback(async () => {
    const requestSequence = overviewRequestSequenceRef.current + 1;
    overviewRequestSequenceRef.current = requestSequence;
    overviewAbortControllerRef.current?.abort();
    overviewAbortControllerRef.current = null;
    setActor(null);
    setSnapshot(EMPTY_SNAPSHOT);
    setNeedsBootstrap(false);
    setMessage(null);

    if (!/^\d{8}$/.test(siteId)) {
      setMessage({ kind: "error", text: "缺少有效的商户编号。" });
      setLoading(false);
      return false;
    }

    const controller = new AbortController();
    overviewAbortControllerRef.current = controller;
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/merchant-enterprise/overview?siteId=${encodeURIComponent(siteId)}`,
        { signal: controller.signal },
      );
      const payload = (await response.json().catch(() => null)) as OverviewPayload | null;
      if (
        controller.signal.aborted ||
        requestSequence !== overviewRequestSequenceRef.current
      ) {
        return false;
      }
      if (!response.ok || !payload?.ok || !payload.actor || !payload.snapshot) {
        throw new Error(readApiError(payload, "企业管理加载失败。"));
      }
      setActor(payload.actor);
      setSnapshot(payload.snapshot);
      setNeedsBootstrap(payload.needsBootstrap === true);
      setMessage(null);
      return true;
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestSequence !== overviewRequestSequenceRef.current
      ) {
        return false;
      }
      setActor(null);
      setSnapshot(EMPTY_SNAPSHOT);
      setNeedsBootstrap(false);
      setFailedInvitationEmployeeIds(new Set());
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "企业管理加载失败。",
      });
      return false;
    } finally {
      if (
        !controller.signal.aborted &&
        requestSequence === overviewRequestSequenceRef.current
      ) {
        if (overviewAbortControllerRef.current === controller) {
          overviewAbortControllerRef.current = null;
        }
        setLoading(false);
      }
    }
  }, [apiFetch, siteId]);

  useEffect(() => {
    void loadOverview();
    return () => {
      overviewRequestSequenceRef.current += 1;
      overviewAbortControllerRef.current?.abort();
      overviewAbortControllerRef.current = null;
    };
  }, [loadOverview]);

  const activeRoles = snapshot.roles.filter((role) => role.status === "active");
  const assignableRoles = actor
    ? activeRoles.filter((role) => merchantEnterprisePermissionsFitActor(actor, role.permissions))
    : [];
  const activeEmployees = snapshot.employees.filter((employee) => employee.status === "active");
  const activeBoards = snapshot.boards.filter((board) => board.status === "active");
  const activeBoard = activeBoards[0] ?? null;
  const activeColumns = snapshot.columns
    .filter((column) => column.status === "active" && column.boardId === activeBoard?.id)
    .sort((left, right) => left.position - right.position);
  const visibleTasks = snapshot.tasks.filter(
    (task) => !task.archivedAt && task.boardId === activeBoard?.id,
  );
  const employeeById = useMemo(
    () => new Map(snapshot.employees.map((employee) => [employee.id, employee] as const)),
    [snapshot.employees],
  );
  const roleById = useMemo(
    () => new Map(snapshot.roles.map((role) => [role.id, role] as const)),
    [snapshot.roles],
  );

  const mutate = useCallback(
    async (path: string, method: "POST" | "PATCH", body: Record<string, unknown>, success: string) => {
      setBusy(true);
      setMessage({ kind: "info", text: "正在保存..." });
      try {
        const response = await apiFetch(path, {
          method,
          body: JSON.stringify({ siteId, ...body }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(readApiError(payload, "保存失败，请稍后重试。"));
        }
        const reloaded = await loadOverview();
        if (!reloaded) return null;
        setMessage({ kind: "success", text: success });
        return payload;
      } catch (error) {
        const text = error instanceof Error ? error.message : "保存失败，请稍后重试。";
        setMessage({ kind: "error", text });
        if (text.includes("重新加载")) await loadOverview();
        return null;
      } finally {
        setBusy(false);
      }
    },
    [apiFetch, loadOverview, siteId],
  );

  async function bootstrap() {
    const payload = await mutate(
      "/api/merchant-enterprise/overview",
      "POST",
      {},
      "企业工作区已初始化。",
    );
    if (payload?.snapshot) {
      setSnapshot(payload.snapshot as MerchantEnterpriseSnapshot);
      setNeedsBootstrap(false);
    }
  }

  async function createTask() {
    if (!activeBoard || !activeColumns[0] || !taskTitle.trim()) {
      setMessage({ kind: "error", text: "请先填写任务标题。" });
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/tasks",
      "POST",
      {
        boardId: activeBoard.id,
        columnId: activeColumns[0].id,
        title: taskTitle,
        description: taskDescription,
        priority: taskPriority,
        dueAt: taskDueAt ? new Date(`${taskDueAt}T23:59:59`).toISOString() : null,
        assigneeIds: taskAssigneeId ? [taskAssigneeId] : [],
        operationId: createClientMutationOperationId("enterprise-task-create"),
      },
      "任务已创建。",
    );
    if (payload) {
      setTaskTitle("");
      setTaskDescription("");
      setTaskPriority("normal");
      setTaskDueAt("");
      setTaskAssigneeId("");
    }
  }

  async function moveTask(task: MerchantTask, columnId: string) {
    if (task.columnId === columnId || busy) return;
    await mutate(
      "/api/merchant-enterprise/tasks",
      "PATCH",
      {
        taskId: task.id,
        version: task.version,
        columnId,
        position: Date.now(),
        operationId: createClientMutationOperationId("enterprise-task-move"),
      },
      "任务状态已更新。",
    );
  }

  async function assignTask(task: MerchantTask, employeeId: string) {
    await mutate(
      "/api/merchant-enterprise/tasks",
      "PATCH",
      {
        taskId: task.id,
        version: task.version,
        assigneeIds: employeeId ? [employeeId] : [],
        operationId: createClientMutationOperationId("enterprise-task-assign"),
      },
      "任务负责人已更新。",
    );
  }

  async function inviteEmployee() {
    if (!employeeName.trim() || !employeeEmail.trim() || !employeeRoleId) {
      setMessage({ kind: "error", text: "请填写员工姓名、邮箱并选择角色。" });
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "POST",
      {
        displayName: employeeName,
        email: employeeEmail,
        roleId: employeeRoleId,
      },
      "员工记录已创建。",
    );
    if (payload) {
      const invitedEmployeeId =
        typeof payload.employee?.id === "string" ? payload.employee.id.trim() : "";
      const invitationSent = payload.invitation?.status === "sent";
      if (invitedEmployeeId) {
        setFailedInvitationEmployeeIds((current) => {
          const next = new Set(current);
          if (invitationSent) next.delete(invitedEmployeeId);
          else next.add(invitedEmployeeId);
          return next;
        });
      }
      setEmployeeName("");
      setEmployeeEmail("");
      setEmployeeRoleId("");
      setMessage({
        kind: invitationSent ? "success" : "info",
        text:
          invitationSent
            ? "邀请邮件已发送，员工接受后即可进入企业工作台。"
            : "员工记录已保存，但邀请邮件暂未发出，可稍后重试。",
      });
    }
  }

  async function resendEmployeeInvitation(employee: MerchantEnterpriseEmployee) {
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        action: "resend_invite",
        employeeId: employee.id,
        version: employee.version,
      },
      "邀请邮件已重新发送。",
    );
    if (!payload) return;
    const invitationSent = payload.invitation?.status === "sent";
    setFailedInvitationEmployeeIds((current) => {
      const next = new Set(current);
      if (invitationSent) next.delete(employee.id);
      else next.add(employee.id);
      return next;
    });
    setMessage({
      kind: invitationSent ? "success" : "info",
      text: invitationSent
        ? "邀请邮件已重新发送，员工接受后即可进入企业工作台。"
        : "邀请邮件暂未发出，请稍后重试。",
    });
  }

  async function updateEmployeeStatus(
    employee: MerchantEnterpriseEmployee,
    status: "active" | "disabled",
  ) {
    await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: employee.id,
        version: employee.version,
        status,
      },
      status === "disabled" ? "员工账号已停用。" : "员工账号已恢复。",
    );
  }

  async function updateEmployeeRole(
    employee: MerchantEnterpriseEmployee,
    roleId: string,
  ) {
    if (!roleId || roleId === employee.roleId) return;
    await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: employee.id,
        version: employee.version,
        roleId,
      },
      "员工角色已更新。",
    );
  }

  async function createRole() {
    if (!roleName.trim()) {
      setMessage({ kind: "error", text: "请填写角色名称。" });
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/roles",
      "POST",
      {
        name: roleName,
        description: roleDescription,
        permissions: ["enterprise.view", "tasks.view"],
      },
      "角色已创建。",
    );
    if (payload) {
      setRoleName("");
      setRoleDescription("");
    }
  }

  async function saveRole(
    role: MerchantEnterpriseRole,
    permissions: MerchantEnterprisePermission[],
  ) {
    await mutate(
      "/api/merchant-enterprise/roles",
      "PATCH",
      { roleId: role.id, version: role.version, permissions },
      "角色权限已保存。",
    );
  }

  const wrapperClassName = standalone
    ? `min-h-screen bg-[#f3f6fb] p-4 sm:p-6 ${className}`
    : `min-h-[calc(100vh-8rem)] py-6 ${className}`;

  if (loading) {
    return (
      <div className={wrapperClassName}>
        <div className="mx-auto max-w-7xl animate-pulse space-y-4">
          <div className="h-24 rounded-3xl bg-white" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-32 rounded-2xl bg-white" />
            <div className="h-32 rounded-2xl bg-white" />
            <div className="h-32 rounded-2xl bg-white" />
          </div>
        </div>
      </div>
    );
  }

  if (!actor) {
    return (
      <div className={wrapperClassName}>
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-950">企业管理暂不可用</div>
          <div className="mt-2 text-sm leading-6 text-rose-700">{message?.text || "无法验证当前账号。"}</div>
          <button
            type="button"
            className="mt-5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => void loadOverview()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#0f172a,#1e3a5f_58%,#0f766e)] px-6 py-6 text-white shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/80">Enterprise workspace</div>
              <h1 className="mt-2 text-2xl font-bold">企业管理</h1>
              <p className="mt-2 text-sm text-slate-200">
                {siteName || siteId} · 任务、员工和角色权限统一管理
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-right backdrop-blur">
              <div className="text-xs text-slate-200">当前身份</div>
              <div className="mt-1 text-sm font-semibold">
                {actor.displayName} · {actor.type === "owner" ? "企业负责人" : "员工"}
              </div>
            </div>
          </div>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {(
            [
              ["overview", "工作台", "enterprise.view"],
              ["tasks", "任务看板", "tasks.view"],
              ["employees", "员工账号", "employees.view"],
              ["roles", "角色权限", "roles.view"],
            ] as const
          )
            .filter((item) => can(actor, item[2]))
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  tab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
        </nav>

        {message ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              message.kind === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : message.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {message.text}
          </div>
        ) : null}

        {needsBootstrap ? (
          <section className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-lg font-semibold text-amber-950">初始化企业工作区</h2>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              将创建管理员、主管、员工三个基础角色，以及“待处理、进行中、受阻、已完成”任务列。
            </p>
            <button
              type="button"
              className="mt-4 rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || !can(actor, "boards.manage") || !can(actor, "roles.manage")}
              onClick={() => void bootstrap()}
            >
              开始初始化
            </button>
          </section>
        ) : null}

        {!needsBootstrap && tab === "overview" ? (
          <div className="mt-5 space-y-5">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "未完成任务", value: visibleTasks.filter((task) => !task.completedAt).length, tone: "text-blue-700" },
                { label: "已完成任务", value: visibleTasks.filter((task) => task.completedAt).length, tone: "text-emerald-700" },
                {
                  label: "团队成员",
                  value: can(actor, "employees.view") ? activeEmployees.length : "—",
                  tone: "text-violet-700",
                },
                {
                  label: "已逾期",
                  value: visibleTasks.filter(
                    (task) => task.dueAt && !task.completedAt && Date.parse(task.dueAt) < Date.now(),
                  ).length,
                  tone: "text-rose-700",
                },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm text-slate-500">{item.label}</div>
                  <div className={`mt-3 text-3xl font-bold ${item.tone}`}>{item.value}</div>
                </div>
              ))}
            </section>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">最近任务</h2>
                  <p className="mt-1 text-sm text-slate-500">优先显示即将到期和最近更新的工作。</p>
                </div>
                {can(actor, "tasks.view") ? (
                  <button type="button" className="text-sm font-semibold text-blue-700" onClick={() => setTab("tasks")}>
                    查看看板
                  </button>
                ) : null}
              </div>
              <div className="mt-4 divide-y divide-slate-100">
                {visibleTasks.slice(0, 6).map((task) => (
                  <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-medium text-slate-900">{task.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {activeColumns.find((column) => column.id === task.columnId)?.name || "未分类"}
                        {task.dueAt ? ` · 截止 ${formatDate(task.dueAt)}` : ""}
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PRIORITY_META[task.priority].className}`}>
                      {PRIORITY_META[task.priority].label}
                    </span>
                  </div>
                ))}
                {visibleTasks.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">还没有任务，可以从任务看板创建第一项工作。</div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {!needsBootstrap && tab === "tasks" ? (
          <div className="mt-5 space-y-5">
            {can(actor, "tasks.create") ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_140px_160px_180px_auto]">
                  <input
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="任务标题"
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="简要说明（可选）"
                    value={taskDescription}
                    onChange={(event) => setTaskDescription(event.target.value)}
                  />
                  <select
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={taskPriority}
                    onChange={(event) => setTaskPriority(event.target.value as MerchantTaskPriority)}
                  >
                    {(Object.keys(PRIORITY_META) as MerchantTaskPriority[]).map((item) => (
                      <option key={item} value={item}>{PRIORITY_META[item].label}优先级</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={taskDueAt}
                    onChange={(event) => setTaskDueAt(event.target.value)}
                  />
                  <select
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={taskAssigneeId}
                    onChange={(event) => setTaskAssigneeId(event.target.value)}
                    disabled={!can(actor, "tasks.assign")}
                  >
                    <option value="">暂不分派</option>
                    {activeEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.displayName}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                    disabled={busy || !taskTitle.trim()}
                    onClick={() => void createTask()}
                  >
                    新建任务
                  </button>
                </div>
              </section>
            ) : null}
            <section className="overflow-x-auto pb-3">
              <div className="grid min-w-[980px] gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(activeColumns.length, 1)}, minmax(230px, 1fr))` }}>
                {activeColumns.map((column, columnIndex) => {
                  const tasks = visibleTasks.filter((task) => task.columnId === column.id);
                  return (
                    <div
                      key={column.id}
                      className="min-h-[420px] rounded-3xl border border-slate-200 bg-slate-100/80 p-3"
                      onDragOver={(event) => {
                        if (can(actor, "tasks.update")) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const task = visibleTasks.find((item) => item.id === draggingTaskId);
                        setDraggingTaskId("");
                        if (task) void moveTask(task, column.id);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 px-1 py-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.color }} />
                          <h3 className="font-semibold text-slate-900">{column.name}</h3>
                        </div>
                        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{tasks.length}</span>
                      </div>
                      <div className="mt-2 space-y-3">
                        {tasks.map((task) => {
                          const assigned = task.assigneeIds
                            .map((id) => employeeById.get(id)?.displayName)
                            .filter(Boolean)
                            .join("、");
                          const overdue = Boolean(task.dueAt && !task.completedAt && Date.parse(task.dueAt) < Date.now());
                          return (
                            <article
                              key={task.id}
                              draggable={can(actor, "tasks.update")}
                              onDragStart={() => setDraggingTaskId(task.id)}
                              onDragEnd={() => setDraggingTaskId("")}
                              className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
                                draggingTaskId === task.id ? "opacity-45" : "border-slate-200"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="font-semibold leading-5 text-slate-950">{task.title}</h4>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${PRIORITY_META[task.priority].className}`}>
                                  {PRIORITY_META[task.priority].label}
                                </span>
                              </div>
                              {task.description ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{task.description}</p> : null}
                              {task.dueAt ? (
                                <div className={`mt-3 text-xs font-medium ${overdue ? "text-rose-600" : "text-slate-500"}`}>
                                  {overdue ? "已逾期 · " : "截止 · "}{formatDate(task.dueAt)}
                                </div>
                              ) : null}
                              <div className="mt-3 text-xs text-slate-500">负责人：{assigned || "未分派"}</div>
                              {can(actor, "tasks.assign") ? (
                                <select
                                  className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                                  value={task.assigneeIds[0] ?? ""}
                                  onChange={(event) => void assignTask(task, event.target.value)}
                                  disabled={busy}
                                >
                                  <option value="">未分派</option>
                                  {activeEmployees.map((employee) => (
                                    <option key={employee.id} value={employee.id}>{employee.displayName}</option>
                                  ))}
                                </select>
                              ) : null}
                              {can(actor, "tasks.update") ? (
                                <div className="mt-3 flex gap-2">
                                  <button
                                    type="button"
                                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-35"
                                    disabled={busy || columnIndex === 0}
                                    onClick={() => {
                                      const previous = activeColumns[columnIndex - 1];
                                      if (previous) void moveTask(task, previous.id);
                                    }}
                                  >
                                    上一步
                                  </button>
                                  <button
                                    type="button"
                                    className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-35"
                                    disabled={busy || columnIndex === activeColumns.length - 1}
                                    onClick={() => {
                                      const next = activeColumns[columnIndex + 1];
                                      if (next) void moveTask(task, next.id);
                                    }}
                                  >
                                    下一步
                                  </button>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}

        {!needsBootstrap && tab === "employees" ? (
          <div className="mt-5 space-y-5">
            {can(actor, "employees.manage") ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">开设员工账号</h2>
                <p className="mt-1 text-sm text-slate-500">员工通过邮件邀请加入；不会获得商户负责人的订单、发布等全权身份。</p>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1.2fr_1fr_auto]">
                  <input
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="员工姓名"
                    value={employeeName}
                    onChange={(event) => setEmployeeName(event.target.value)}
                  />
                  <input
                    type="email"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="员工邮箱"
                    value={employeeEmail}
                    onChange={(event) => setEmployeeEmail(event.target.value)}
                  />
                  <select
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={employeeRoleId}
                    onChange={(event) => setEmployeeRoleId(event.target.value)}
                  >
                    <option value="">选择角色</option>
                    {assignableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                  <button
                    type="button"
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                    disabled={busy}
                    onClick={() => void inviteEmployee()}
                  >
                    发送邀请
                  </button>
                </div>
              </section>
            ) : null}
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-950">员工账号</h2>
                <p className="mt-1 text-sm text-slate-500">共 {snapshot.employees.length} 个账号</p>
              </div>
              <div className="divide-y divide-slate-100">
                {snapshot.employees.map((employee) => {
                  const invitationNeedsRetry =
                    failedInvitationEmployeeIds.has(employee.id) ||
                    employee.status === "invited";
                  return (
                    <div key={employee.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{employee.displayName}</div>
                        <div className="mt-1 truncate text-sm text-slate-500">{employee.email || "邮箱仅管理员可见"}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        {can(actor, "employees.manage") &&
                        !(actor.type === "employee" && actor.id === employee.id) &&
                        assignableRoles.some((role) => role.id === employee.roleId) ? (
                          <select
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
                            value={employee.roleId}
                            disabled={busy}
                            onChange={(event) => void updateEmployeeRole(employee, event.target.value)}
                          >
                            {assignableRoles.map((role) => (
                              <option key={role.id} value={role.id}>{role.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {roleById.get(employee.roleId)?.name || "未分配角色"}
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          employee.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : employee.status === "disabled"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                        }`}>
                          {employee.status === "active" ? "已加入" : employee.status === "disabled" ? "已停用" : "待接受"}
                        </span>
                        {can(actor, "employees.manage") && invitationNeedsRetry ? (
                          <button
                            type="button"
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-45"
                            disabled={busy}
                            onClick={() => void resendEmployeeInvitation(employee)}
                          >
                            重发邀请
                          </button>
                        ) : null}
                        {can(actor, "employees.manage") && employee.status !== "invited" ? (
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                            disabled={busy}
                            onClick={() => void updateEmployeeStatus(employee, employee.status === "disabled" ? "active" : "disabled")}
                          >
                            {employee.status === "disabled" ? "恢复" : "停用"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {snapshot.employees.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">还没有员工账号。</div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {!needsBootstrap && tab === "roles" ? (
          <div className="mt-5 space-y-5">
            {can(actor, "roles.manage") ? (
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">新建角色</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                  <input
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="角色名称"
                    value={roleName}
                    onChange={(event) => setRoleName(event.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="角色说明"
                    value={roleDescription}
                    onChange={(event) => setRoleDescription(event.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                    disabled={busy}
                    onClick={() => void createRole()}
                  >
                    创建角色
                  </button>
                </div>
              </section>
            ) : null}
            <section className="grid gap-4 lg:grid-cols-2">
              {activeRoles.map((role) =>
                can(actor, "roles.manage") ? (
                  <RoleEditor key={role.id} role={role} busy={busy} onSave={saveRole} />
                ) : (
                  <article key={role.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="font-semibold text-slate-950">{role.name}</div>
                    <div className="mt-1 text-sm text-slate-500">{role.description}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {role.permissions.map((permission) => (
                        <span key={permission} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                          {MERCHANT_ENTERPRISE_PERMISSION_CATALOG.find((item) => item.key === permission)?.label || permission}
                        </span>
                      ))}
                    </div>
                  </article>
                ),
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
