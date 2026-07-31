"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  buildMerchantEnterpriseTaskOverview,
  buildMerchantTaskEditChanges,
  filterMerchantTasks,
  hasMerchantEnterprisePermission,
  merchantEnterprisePermissionsFitActor,
  MAX_MERCHANT_TASK_ASSIGNEES,
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  toggleMerchantEnterprisePermissionSelection,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseEmployee,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRole,
  type MerchantEnterpriseSnapshot,
  type MerchantTask,
  type MerchantTaskBoard,
  type MerchantTaskColumn,
  type MerchantTaskEvent,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import {
  planMerchantTaskReorder,
  sortMerchantTaskOrderItems,
} from "@/lib/merchantTaskOrdering";

export type MerchantEnterpriseView = "overview" | "tasks" | "employees" | "roles";

export type MerchantEnterpriseExternalNavigation = {
  mode: "external";
  activeView: MerchantEnterpriseView;
  onViewChange: (view: MerchantEnterpriseView) => void;
  onAvailableViewsChange?: (views: readonly MerchantEnterpriseView[]) => void;
};

const MERCHANT_ENTERPRISE_VIEW_ITEMS = [
  { key: "overview", label: "工作台", permission: "enterprise.view" },
  { key: "tasks", label: "任务看板", permission: "tasks.view" },
  { key: "employees", label: "员工账号", permission: "employees.view" },
  { key: "roles", label: "角色权限", permission: "roles.view" },
] as const satisfies ReadonlyArray<{
  key: MerchantEnterpriseView;
  label: string;
  permission: MerchantEnterprisePermission;
}>;

const MERCHANT_ENTERPRISE_VIEW_PERMISSIONS = Object.fromEntries(
  MERCHANT_ENTERPRISE_VIEW_ITEMS.map((item) => [item.key, item.permission]),
) as Record<MerchantEnterpriseView, MerchantEnterprisePermission>;

type MerchantEnterpriseManagerProps = {
  siteId: string;
  siteName?: string;
  accessToken?: string;
  className?: string;
  standalone?: boolean;
  navigation?: MerchantEnterpriseExternalNavigation;
};

type OverviewPayload = {
  ok?: boolean;
  error?: string;
  actor?: MerchantEnterpriseActor;
  snapshot?: MerchantEnterpriseSnapshot;
  needsBootstrap?: boolean;
};

type TaskEventsPayload = {
  ok?: boolean;
  error?: string;
  events?: MerchantTaskEvent[];
  event?: MerchantTaskEvent;
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function taskEventPayload(event: MerchantTaskEvent) {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : {};
}

function taskEventActorLabel(
  event: MerchantTaskEvent,
  actor: MerchantEnterpriseActor,
  employees: readonly MerchantEnterpriseEmployee[],
) {
  if (event.actorType === "system") return "系统";
  if (event.actorType === "employee") {
    return employees.find((employee) => employee.id === event.actorId)?.displayName || "企业员工";
  }
  return event.actorId && event.actorId === actor.id ? actor.displayName : "企业负责人";
}

const TASK_EVENT_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  description: "说明",
  priority: "优先级",
  due_at: "截止日期",
  dueAt: "截止日期",
  assigneeIds: "负责人",
};

function taskEventDescription(
  event: MerchantTaskEvent,
  columns: readonly MerchantTaskColumn[],
) {
  if (event.eventType === "created") return "创建了任务";
  if (event.eventType === "archived") return "归档了任务";
  if (event.eventType === "restored") return "恢复了任务";
  if (event.eventType === "commented") return "发表了评论";
  if (event.eventType === "moved") {
    const payload = taskEventPayload(event);
    const fromColumnId = typeof payload.fromColumnId === "string" ? payload.fromColumnId : "";
    const toColumnId = typeof payload.toColumnId === "string" ? payload.toColumnId : "";
    if (fromColumnId && toColumnId && fromColumnId !== toColumnId) {
      const fromColumn = columns.find((column) => column.id === fromColumnId)?.name || "原工作列";
      const toColumn = columns.find((column) => column.id === toColumnId)?.name || "新工作列";
      return `将任务从“${fromColumn}”移动到“${toColumn}”`;
    }
    return "调整了任务顺序";
  }
  if (event.eventType === "updated") {
    const fields = taskEventPayload(event).fields;
    const labels = Array.isArray(fields)
      ? Array.from(
          new Set(
            fields
              .filter((field): field is string => typeof field === "string")
              .map((field) => TASK_EVENT_FIELD_LABELS[field] || "")
              .filter(Boolean),
          ),
        )
      : [];
    return labels.length > 0 ? `更新了${labels.join("、")}` : "更新了任务";
  }
  return "更新了任务动态";
}

type InvitationAwareEmployee = MerchantEnterpriseEmployee & {
  invitationVersion?: number;
  invitationExpiresAt?: string | null;
  invitationRevokedAt?: string | null;
  invitationSentAt?: string | null;
  invitationDeliveryStatus?: "none" | "legacy" | "sending" | "sent" | "failed" | "revoked";
};

const TASK_DND_PREFIX = "enterprise-task:";
const COLUMN_DND_PREFIX = "enterprise-column:";

type TaskDndData = {
  type: "task";
  taskId: string;
  columnId: string;
  taskTitle: string;
};

type ColumnDndData = {
  type: "column";
  columnId: string;
  columnName: string;
};

function taskDndId(taskId: string) {
  return `${TASK_DND_PREFIX}${taskId}`;
}

function columnDndId(columnId: string) {
  return `${COLUMN_DND_PREFIX}${columnId}`;
}

function taskDndData(value: unknown): TaskDndData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<TaskDndData>;
  return data.type === "task" && typeof data.taskId === "string" && typeof data.columnId === "string"
    ? {
        type: "task",
        taskId: data.taskId,
        columnId: data.columnId,
        taskTitle: typeof data.taskTitle === "string" ? data.taskTitle : "任务",
      }
    : null;
}

function columnDndData(value: unknown): ColumnDndData | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<ColumnDndData>;
  return data.type === "column" && typeof data.columnId === "string"
    ? {
        type: "column",
        columnId: data.columnId,
        columnName: typeof data.columnName === "string" ? data.columnName : "工作列",
      }
    : null;
}

const TASK_DND_ANNOUNCEMENTS: Announcements = {
  onDragStart({ active }) {
    const task = taskDndData(active.data.current);
    return task ? `已拿起任务“${task.taskTitle}”。` : "已开始移动任务。";
  },
  onDragOver({ over }) {
    const task = taskDndData(over?.data.current);
    if (task) return `当前位于任务“${task.taskTitle}”附近。`;
    const column = columnDndData(over?.data.current);
    return column ? `当前位于“${column.columnName}”工作列。` : undefined;
  },
  onDragEnd({ active, over }) {
    const task = taskDndData(active.data.current);
    if (!over) return task ? `任务“${task.taskTitle}”未移动。` : "任务未移动。";
    return task
      ? `已放下任务“${task.taskTitle}”。位置变化将自动保存。`
      : "已放下任务，位置变化将自动保存。";
  },
  onDragCancel({ active }) {
    const task = taskDndData(active.data.current);
    return task ? `已取消移动任务“${task.taskTitle}”。` : "已取消移动任务。";
  },
};

const TASK_DND_SCREEN_READER_INSTRUCTIONS = {
  draggable: "按空格键拿起任务，使用方向键移动，按空格键放下，按 Esc 键取消。",
};

function employeeInvitationPresentation(employee: MerchantEnterpriseEmployee, nowMs = Date.now()) {
  const value = employee as InvitationAwareEmployee;
  if (employee.status === "active") {
    return { state: "joined" as const, label: "已加入", detail: "", tone: "bg-emerald-50 text-emerald-700" };
  }
  if (employee.status === "disabled") {
    return { state: "disabled" as const, label: "已停用", detail: "", tone: "bg-rose-50 text-rose-700" };
  }
  const expiresAtMs = value.invitationExpiresAt
    ? Date.parse(value.invitationExpiresAt)
    : Number.NaN;
  if (value.invitationRevokedAt || value.invitationDeliveryStatus === "revoked") {
    return {
      state: "revoked" as const,
      label: "邀请已撤销",
      detail: "可生成一封全新的邀请邮件",
      tone: "bg-slate-100 text-slate-700",
    };
  }
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return {
      state: "expired" as const,
      label: "邀请已过期",
      detail: "旧邮件已失效",
      tone: "bg-rose-50 text-rose-700",
    };
  }
  if (value.invitationDeliveryStatus === "failed") {
    return {
      state: "failed" as const,
      label: "发送失败",
      detail: "员工记录已保留",
      tone: "bg-amber-50 text-amber-700",
    };
  }
  if (value.invitationDeliveryStatus === "sending") {
    return {
      state: "sending" as const,
      label: "正在发送",
      detail: "如长时间未完成可重新发送",
      tone: "bg-blue-50 text-blue-700",
    };
  }
  return {
    state: "pending" as const,
    label: "待接受",
    detail: value.invitationExpiresAt
      ? `有效期至 ${formatDate(value.invitationExpiresAt)}`
      : "等待员工从邀请邮件加入",
    tone: "bg-amber-50 text-amber-700",
  };
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
  if (code === "invalid_permission_dependencies") return "权限组合不完整，请保留关联的查看权限。";
  if (code === "role_in_use") return "该角色仍分配给员工，请先为这些员工更换角色。";
  if (code === "system_role_protected") return "系统预设角色不能归档。";
  if (code === "role_name_conflict") return "已有同名的启用角色，请先修改其中一个角色名称。";
  if (code === "board_in_use") return "该看板仍有未归档任务，请先处理或归档这些任务。";
  if (code === "column_in_use") return "该工作列仍有未归档任务，暂时不能归档或改变完成属性。";
  if (code === "last_active_board") return "至少需要保留一个启用的看板。";
  if (code === "last_active_column") return "每个启用看板至少需要保留一个工作列。";
  if (code === "board_limit_reached" || code === "board_limit_exceeded") return "当前企业最多可启用 50 个看板。";
  if (code === "column_limit_reached" || code === "column_limit_exceeded") return "每个看板最多可启用 30 个工作列。";
  if (code === "inactive_board") return "该看板已归档，请先恢复看板。";
  if (code === "inactive_column") return "该工作列已归档，请先恢复工作列。";
  if (code === "board_has_no_active_columns") return "启用看板前至少需要保留一个可用工作列。";
  if (code === "board_name_conflict") return "当前企业已有同名的启用看板。";
  if (code === "column_name_conflict") return "当前看板已有同名的启用工作列。";
  if (code === "invalid_task_assignees") return "负责人中包含已停用或不属于本企业的员工，请重新选择。";
  if (code === "invalid_task_board") return "任务看板已变更，请刷新后重新操作。";
  if (code === "invalid_task_column") return "目标工作列已变更或不可用，请刷新后重新操作。";
  if (code === "invalid_task_due_at") return "截止日期无效，请重新选择。";
  if (code === "invalid_task_comment") return "评论需为 1–2000 个字符。";
  if (code === "invalid_task_archived") return "已归档任务不能继续发表评论。";
  if (code === "invalid_task_move" || code === "invalid_task_target_index") {
    return "任务排序位置无效，请刷新后重新操作。";
  }
  if (code === "merchant_access_denied") return "当前账号不属于这个企业。";
  if (code === "merchant_role_invalid") return "当前员工角色的权限配置不完整，请联系企业负责人修正。";
  if (code === "enterprise_version_conflict") return "数据已被其他人更新，已为你重新加载。";
  if (code === "invalid_version") return "数据版本无效，请重新加载后再试。";
  if (code === "employee_email_already_registered") return "该邮箱已注册为其他 Faolla 身份，请使用独立的员工邮箱。";
  if (code === "employee_invitation_cooldown") return "邀请刚刚发送过，请稍后再试。";
  if (code === "employee_invitation_not_accepted") return "员工尚未接受邀请，不能直接启用账号。";
  if (code === "employee_invitation_revoke_required") return "待接受账号请使用“撤销邀请”，不能直接停用。";
  if (code === "employee_invitation_not_pending") return "该员工当前没有可操作的待处理邀请。";
  if (code === "employee_invitation_revoked") return "该邀请已经撤销，请刷新后重新生成邀请。";
  if (code === "employee_invitation_expired") return "该邀请已经过期，请重新生成邀请。";
  if (code === "employee_invitation_superseded") return "邀请已被更新，请刷新后再试。";
  if (code === "employee_invitation_renew_required") return "该邀请已失效，请生成一封新邀请。";
  if (code === "employee_invitation_renew_not_required") return "当前邀请仍然有效，请使用重发邀请。";
  if (code === "unauthorized") return "登录状态已失效，请重新登录。";
  return fallback;
}

type TaskDraft = {
  title: string;
  description: string;
  priority: MerchantTaskPriority;
  dueAt: string;
  columnId: string;
  assigneeIds: string[];
};

function taskDateInputValue(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function EnterpriseCalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 2.75v2.5M14 2.75v2.5M3.75 7.25h12.5M5.5 4.5h9a1.75 1.75 0 0 1 1.75 1.75v8.25A1.75 1.75 0 0 1 14.5 16.25h-9A1.75 1.75 0 0 1 3.75 14.5V6.25A1.75 1.75 0 0 1 5.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function openEnterpriseDatePicker(input: HTMLInputElement | null) {
  if (!input) return;
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  try {
    pickerInput.focus({ preventScroll: true });
  } catch {
    pickerInput.focus();
  }
  if (typeof pickerInput.showPicker === "function") {
    try {
      pickerInput.showPicker();
      return;
    } catch {
      // Fall back to a native click for embedded browsers without showPicker support.
    }
  }
  try {
    pickerInput.click();
  } catch {
    // Some embedded browsers do not expose a native date picker.
  }
}

function EnterpriseDateField({
  value,
  disabled = false,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    if (!disabled) openEnterpriseDatePicker(pickerInputRef.current);
  };

  return (
    <span className="relative mt-1.5 block">
      <input
        type="text"
        readOnly
        inputMode="numeric"
        autoComplete="off"
        data-no-translate="1"
        translate="no"
        className="w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 pr-16 text-sm disabled:cursor-not-allowed disabled:bg-slate-50"
        value={value}
        placeholder="YYYY-MM-DD"
        disabled={disabled}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          openPicker();
        }}
      />
      {value ? (
        <button
          type="button"
          className="absolute inset-y-0 right-9 inline-flex w-7 items-center justify-center rounded-lg text-base text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="清除截止日期"
          disabled={disabled}
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
      <button
        type="button"
        className="absolute inset-y-0 right-1 inline-flex w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-45"
        aria-label="打开截止日期选择器"
        disabled={disabled}
        onClick={openPicker}
      >
        <EnterpriseCalendarIcon />
      </button>
      <input
        ref={pickerInputRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 opacity-0"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

function TaskDragHandleIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <circle cx="6" cy="5" r="1.25" />
      <circle cx="14" cy="5" r="1.25" />
      <circle cx="6" cy="10" r="1.25" />
      <circle cx="14" cy="10" r="1.25" />
      <circle cx="6" cy="15" r="1.25" />
      <circle cx="14" cy="15" r="1.25" />
    </svg>
  );
}

function SortableTaskShell({
  task,
  dragDisabled,
  dragDisabledReason,
  showDragHandle,
  children,
}: {
  task: MerchantTask;
  dragDisabled: boolean;
  dragDisabledReason: string;
  showDragHandle: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: taskDndId(task.id),
    disabled: dragDisabled,
    data: {
      type: "task",
      taskId: task.id,
      columnId: task.columnId,
      taskTitle: task.title,
    } satisfies TaskDndData,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`relative rounded-2xl border bg-white p-4 shadow-sm transition-shadow ${
        isDragging
          ? "z-10 border-blue-300 opacity-35 shadow-lg"
          : task.archivedAt
            ? "border-amber-200"
            : "border-slate-200"
      }`}
    >
      {showDragHandle ? (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="absolute right-2 top-2 hidden h-11 w-11 touch-none items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-35 sm:inline-flex sm:h-8 sm:w-8"
          {...attributes}
          {...listeners}
          aria-label={`拖动任务：${task.title}`}
          title={dragDisabled ? dragDisabledReason : "拖动任务排序"}
          disabled={dragDisabled}
        >
          <TaskDragHandleIcon />
        </button>
      ) : null}
      <div className={showDragHandle ? "sm:pr-7" : ""}>{children}</div>
    </article>
  );
}

function SortableTaskColumn({
  column,
  taskIds,
  dragDisabled,
  children,
}: {
  column: MerchantTaskColumn;
  taskIds: string[];
  dragDisabled: boolean;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDndId(column.id),
    disabled: dragDisabled,
    data: {
      type: "column",
      columnId: column.id,
      columnName: column.name,
    } satisfies ColumnDndData,
  });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[360px] w-[calc(100dvw-3.75rem)] shrink-0 snap-start rounded-3xl border p-3 transition-colors sm:min-h-[420px] sm:w-auto ${
        isOver && !dragDisabled
          ? "border-blue-300 bg-blue-50/80"
          : "border-slate-200 bg-slate-100/80"
      }`}
    >
      <SortableContext items={taskIds.map(taskDndId)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

function TaskDragPreview({ task }: { task: MerchantTask }) {
  return (
    <article
      aria-hidden="true"
      className="w-[260px] rotate-1 rounded-2xl border border-blue-300 bg-white p-4 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold leading-5 text-slate-950">{task.title}</h4>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${PRIORITY_META[task.priority].className}`}>
          {PRIORITY_META[task.priority].label}
        </span>
      </div>
      {task.description ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{task.description}</p>
      ) : null}
    </article>
  );
}

function TaskEditor({
  task,
  actor,
  columns,
  employees,
  busy,
  canUpdate,
  canAssign,
  canArchive,
  onSave,
  onArchive,
  onLoadEvents,
  onComment,
  onClose,
}: {
  task: MerchantTask;
  actor: MerchantEnterpriseActor;
  columns: MerchantEnterpriseSnapshot["columns"];
  employees: MerchantEnterpriseEmployee[];
  busy: boolean;
  canUpdate: boolean;
  canAssign: boolean;
  canArchive: boolean;
  onSave: (task: MerchantTask, draft: TaskDraft) => Promise<void>;
  onArchive: (task: MerchantTask, archived: boolean) => Promise<void>;
  onLoadEvents: (taskId: string, signal?: AbortSignal) => Promise<MerchantTaskEvent[]>;
  onComment: (
    task: MerchantTask,
    text: string,
    operationId: string,
  ) => Promise<MerchantTaskEvent>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<MerchantTaskPriority>(task.priority);
  const [dueAt, setDueAt] = useState(taskDateInputValue(task.dueAt));
  const [columnId, setColumnId] = useState(task.columnId);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.assigneeIds);
  const [events, setEvents] = useState<MerchantTaskEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentNotice, setCommentNotice] = useState("");
  const commentMutationRef = useRef<{ text: string; operationId: string } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setDueAt(taskDateInputValue(task.dueAt));
    setColumnId(task.columnId);
    setAssigneeIds(task.assigneeIds);
  }, [task]);

  const refreshEvents = useCallback(
    async (signal?: AbortSignal) => {
      setEventsLoading(true);
      setEventsError("");
      try {
        const nextEvents = await onLoadEvents(task.id, signal);
        if (!signal?.aborted) setEvents(nextEvents);
      } catch (error) {
        if (signal?.aborted) return;
        setEventsError(error instanceof Error ? error.message : "任务动态加载失败，请稍后重试。");
      } finally {
        if (!signal?.aborted) setEventsLoading(false);
      }
    },
    [onLoadEvents, task.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshEvents(controller.signal);
    return () => controller.abort();
  }, [refreshEvents]);

  async function submitComment() {
    const text = commentText.trim();
    if (!text || text.length > 2000 || commentBusy || task.archivedAt) return;
    if (commentMutationRef.current?.text !== text) {
      commentMutationRef.current = {
        text,
        operationId: createClientMutationOperationId("enterprise-task-comment"),
      };
    }
    setCommentBusy(true);
    setCommentNotice("");
    try {
      const event = await onComment(
        task,
        text,
        commentMutationRef.current.operationId,
      );
      setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)]);
      setCommentText("");
      setCommentNotice("评论已发布。");
      commentMutationRef.current = null;
    } catch (error) {
      setCommentNotice(error instanceof Error ? error.message : "评论发布失败，请稍后重试。");
    } finally {
      setCommentBusy(false);
    }
  }

  const selectableEmployees = employees.filter(
    (employee) => employee.status === "active" || task.assigneeIds.includes(employee.id),
  );
  const canSave = canUpdate || canAssign;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-stretch justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-task-editor-title"
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:block sm:h-auto sm:max-h-[92vh] sm:overflow-y-auto sm:rounded-3xl sm:p-6"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:border-0 sm:p-0">
          <div className="min-w-0">
            <h2 id="enterprise-task-editor-title" className="!text-xl !font-bold !text-slate-950">
              {canSave ? "编辑任务" : "任务详情"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {task.archivedAt ? `已归档于 ${formatDate(task.archivedAt)}` : `更新于 ${formatDate(task.updatedAt)}`}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 sm:min-h-0"
            disabled={busy}
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:mt-5 sm:block sm:overflow-visible sm:p-0">
          <label className="block text-sm font-medium text-slate-700">
            任务标题
            <input
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              value={title}
              maxLength={240}
              disabled={!canUpdate}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            任务说明
            <textarea
              className="mt-1.5 min-h-28 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              value={description}
              maxLength={10000}
              disabled={!canUpdate}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">
              所在列
              <select
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                value={columnId}
                disabled={!canUpdate || Boolean(task.archivedAt)}
                onChange={(event) => setColumnId(event.target.value)}
              >
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>{column.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              优先级
              <select
                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                value={priority}
                disabled={!canUpdate}
                onChange={(event) => setPriority(event.target.value as MerchantTaskPriority)}
              >
                {(Object.keys(PRIORITY_META) as MerchantTaskPriority[]).map((item) => (
                  <option key={item} value={item}>{PRIORITY_META[item].label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              截止日期
              <EnterpriseDateField
                value={dueAt}
                disabled={!canUpdate}
                onChange={setDueAt}
              />
            </label>
          </div>

          <fieldset className="rounded-2xl border border-slate-200 p-4" disabled={!canAssign}>
            <legend className="px-1 text-sm font-semibold text-slate-800">负责人（可多选）</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {selectableEmployees.map((employee) => {
                const checked = assigneeIds.includes(employee.id);
                return (
                  <label key={employee.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={
                        !checked &&
                        assigneeIds.length >= MAX_MERCHANT_TASK_ASSIGNEES
                      }
                      onChange={(event) => {
                        setAssigneeIds((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, employee.id]))
                            : current.filter((id) => id !== employee.id),
                        );
                      }}
                    />
                    <span>{employee.displayName}</span>
                    {employee.status !== "active" ? (
                      <span className="ml-auto text-xs text-amber-700">非活跃</span>
                    ) : null}
                  </label>
                );
              })}
              {selectableEmployees.length === 0 ? (
                <div className="text-sm text-slate-500">暂无可分派的员工。</div>
              ) : null}
              {assigneeIds.length >= MAX_MERCHANT_TASK_ASSIGNEES ? (
                <div className="text-sm text-amber-700 sm:col-span-2">
                  每个任务最多可分派 {MAX_MERCHANT_TASK_ASSIGNEES} 名员工。
                </div>
              ) : null}
            </div>
          </fieldset>

          <section
            aria-labelledby="enterprise-task-events-title"
            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 id="enterprise-task-events-title" className="font-semibold text-slate-900">
                  任务动态
                </h3>
                <p className="mt-1 text-xs text-slate-500">最近 50 条操作与评论，最新内容在前。</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-45"
                disabled={eventsLoading || commentBusy}
                onClick={() => void refreshEvents()}
              >
                {eventsLoading ? "刷新中…" : "刷新动态"}
              </button>
            </div>

            {canUpdate && !task.archivedAt ? (
              <form
                className="mt-4 rounded-2xl border border-slate-200 bg-white p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitComment();
                }}
              >
                <label className="block text-sm font-medium text-slate-700">
                  添加评论
                  <textarea
                    className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={commentText}
                    maxLength={2000}
                    placeholder="记录进展、问题或交接说明"
                    disabled={commentBusy}
                    onChange={(event) => {
                      setCommentText(event.target.value);
                      setCommentNotice("");
                    }}
                  />
                </label>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">{commentText.length}/2000</span>
                  <button
                    type="submit"
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                    disabled={commentBusy || !commentText.trim()}
                  >
                    {commentBusy ? "发布中…" : "发表评论"}
                  </button>
                </div>
              </form>
            ) : task.archivedAt ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                已归档任务保留历史动态，恢复后可继续评论。
              </div>
            ) : null}

            {commentNotice ? (
              <div
                role="status"
                aria-live="polite"
                className={`mt-3 text-sm ${commentNotice === "评论已发布。" ? "text-emerald-700" : "text-rose-700"}`}
              >
                {commentNotice}
              </div>
            ) : null}

            <div className="mt-4">
              {eventsError ? (
                <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {eventsError}
                </div>
              ) : null}
              {eventsError && events.length === 0 ? null : eventsLoading && events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  正在加载任务动态…
                </div>
              ) : events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  暂无任务动态。
                </div>
              ) : (
                <ol className="space-y-3 pr-1 sm:max-h-80 sm:overflow-y-auto">
                  {events.map((event) => {
                    const payload = taskEventPayload(event);
                    const comment = typeof payload.text === "string" ? payload.text : "";
                    return (
                      <li key={event.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">
                              {taskEventActorLabel(event, actor, employees)}
                            </span>{" "}
                            {taskEventDescription(event, columns)}
                          </div>
                          <time className="shrink-0 text-[11px] text-slate-400" dateTime={event.createdAt}>
                            {formatDateTime(event.createdAt)}
                          </time>
                        </div>
                        {event.eventType === "commented" && comment ? (
                          <div className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                            {comment}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:mt-6 sm:border-0 sm:p-0">
          {canArchive ? (
            <button
              type="button"
              className={`rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-45 ${
                task.archivedAt
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
              disabled={busy}
              onClick={() => void onArchive(task, !task.archivedAt)}
            >
              {task.archivedAt ? "恢复任务" : "归档任务"}
            </button>
          ) : <span />}
          {canSave ? (
            <button
              type="button"
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || (canUpdate && !title.trim())}
              onClick={() =>
                void onSave(task, {
                  title,
                  description,
                  priority,
                  dueAt,
                  columnId,
                  assigneeIds,
                })
              }
            >
              保存任务
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function RoleEditor({
  role,
  busy,
  editable,
  unavailableReason,
  grantablePermissions,
  onSave,
  onStatusChange,
}: {
  role: MerchantEnterpriseRole;
  busy: boolean;
  editable: boolean;
  unavailableReason?: string;
  grantablePermissions: readonly MerchantEnterprisePermission[];
  onSave: (
    role: MerchantEnterpriseRole,
    input: { name: string; description: string; permissions: MerchantEnterprisePermission[] },
  ) => Promise<void>;
  onStatusChange: (role: MerchantEnterpriseRole, status: "active" | "archived") => Promise<void>;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [permissions, setPermissions] = useState<MerchantEnterprisePermission[]>(role.permissions);

  useEffect(() => {
    setName(role.name);
    setDescription(role.description);
    setPermissions(role.permissions);
  }, [role]);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {role.isSystem ? (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">系统角色</span>
          ) : null}
          {role.status === "archived" ? (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">已归档</span>
          ) : null}
        </div>
        {!editable && unavailableReason ? (
          <span className="text-right text-xs leading-5 text-slate-500">{unavailableReason}</span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">
          角色名称
          <input
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            value={name}
            maxLength={80}
            disabled={!editable}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          角色说明
          <input
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            value={description}
            maxLength={1000}
            disabled={!editable}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {MERCHANT_ENTERPRISE_PERMISSION_CATALOG.map((permission) => {
          const checked = permissions.includes(permission.key);
          const canGrant = grantablePermissions.includes(permission.key);
          return (
            <label
              key={`${role.id}-${permission.key}`}
              className={`flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 ${
                editable && canGrant ? "" : "bg-slate-50 opacity-70"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                disabled={!editable || !canGrant}
                onChange={(event) => {
                  setPermissions((current) =>
                    toggleMerchantEnterprisePermissionSelection(
                      current,
                      permission.key,
                      event.target.checked,
                    ),
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
      {editable ? (
        <div className="mt-4 flex flex-wrap justify-between gap-3">
          {!role.isSystem ? (
            <button
              type="button"
              className={`rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-45 ${
                role.status === "archived"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
              disabled={busy}
              onClick={() => void onStatusChange(role, role.status === "archived" ? "active" : "archived")}
            >
              {role.status === "archived" ? "恢复角色" : "归档角色"}
            </button>
          ) : <span />}
          <button
            type="button"
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            disabled={busy || !name.trim()}
            onClick={() => void onSave(role, { name, description, permissions })}
          >
            保存角色
          </button>
        </div>
      ) : null}
    </article>
  );
}

function BoardSettings({
  boards,
  columns,
  selectedBoardId,
  busy,
  onSelectBoard,
  onCreateBoard,
  onSaveBoard,
  onSetBoardStatus,
  onMoveBoard,
  onCreateColumn,
  onSaveColumn,
  onSetColumnStatus,
  onMoveColumn,
}: {
  boards: MerchantTaskBoard[];
  columns: MerchantTaskColumn[];
  selectedBoardId: string;
  busy: boolean;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (input: { name: string; description: string }) => Promise<MerchantTaskBoard | null>;
  onSaveBoard: (
    board: MerchantTaskBoard,
    input: { name: string; description: string },
  ) => Promise<void>;
  onSetBoardStatus: (
    board: MerchantTaskBoard,
    status: "active" | "archived",
  ) => Promise<void>;
  onMoveBoard: (board: MerchantTaskBoard, position: number) => Promise<void>;
  onCreateColumn: (
    board: MerchantTaskBoard,
    input: { name: string; color: string; isDone: boolean },
  ) => Promise<boolean>;
  onSaveColumn: (
    column: MerchantTaskColumn,
    input: { name: string; color: string; isDone: boolean },
  ) => Promise<void>;
  onSetColumnStatus: (
    column: MerchantTaskColumn,
    status: "active" | "archived",
  ) => Promise<void>;
  onMoveColumn: (column: MerchantTaskColumn, position: number) => Promise<void>;
}) {
  const sortedBoards = [...boards].sort(
    (left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt),
  );
  const selectedBoard =
    sortedBoards.find((board) => board.id === selectedBoardId && board.status === "active") ??
    sortedBoards.find((board) => board.status === "active") ??
    null;
  const selectedColumns = [...columns]
    .filter((column) => column.boardId === selectedBoard?.id)
    .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt));
  const activeBoardOrder = sortedBoards.filter((board) => board.status === "active");
  const activeColumnOrder = selectedColumns.filter((column) => column.status === "active");
  const [newBoardName, setNewBoardName] = useState("");
  const [newBoardDescription, setNewBoardDescription] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnColor, setNewColumnColor] = useState("#64748b");
  const [newColumnIsDone, setNewColumnIsDone] = useState(false);

  return (
    <section className="rounded-3xl border border-cyan-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">看板与工作列设置</h2>
          <p className="mt-1 text-sm text-slate-500">
            归档不会删除历史数据；有进行中任务的看板或工作列需要先清空。
          </p>
        </div>
        <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
          {activeBoardOrder.length} 个启用看板
        </span>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-dashed border-slate-300 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto]">
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="新看板名称"
                maxLength={120}
                value={newBoardName}
                onChange={(event) => setNewBoardName(event.target.value)}
              />
              <input
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="看板说明（可选）"
                maxLength={2000}
                value={newBoardDescription}
                onChange={(event) => setNewBoardDescription(event.target.value)}
              />
              <button
                type="button"
                className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                disabled={busy || !newBoardName.trim()}
                onClick={() => {
                  void onCreateBoard({
                    name: newBoardName,
                    description: newBoardDescription,
                  }).then((created) => {
                    if (!created) return;
                    setNewBoardName("");
                    setNewBoardDescription("");
                    onSelectBoard(created.id);
                  });
                }}
              >
                新建看板
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {sortedBoards.map((board) => {
              const activeIndex = activeBoardOrder.findIndex((item) => item.id === board.id);
              return (
                <BoardSettingsRow
                  key={board.id}
                  board={board}
                  selected={selectedBoard?.id === board.id}
                  busy={busy}
                  activeIndex={activeIndex}
                  activeCount={activeBoardOrder.length}
                  onSelect={onSelectBoard}
                  onSave={onSaveBoard}
                  onStatus={onSetBoardStatus}
                  onMove={onMoveBoard}
                />
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4">
          {!selectedBoard ? (
            <div className="grid min-h-48 place-items-center text-center text-sm text-slate-500">
              请先恢复或新建一个看板。
            </div>
          ) : (
            <>
              <div>
                <h3 className="font-semibold text-slate-950">{selectedBoard.name} · 工作列</h3>
                <p className="mt-1 text-xs text-slate-500">
                  “完成列”中的任务会自动记录完成时间；改变已有列属性前需先清空任务。
                </p>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <input
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="新工作列名称"
                  maxLength={80}
                  value={newColumnName}
                  onChange={(event) => setNewColumnName(event.target.value)}
                />
                <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
                  <input
                    type="color"
                    className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
                    value={newColumnColor}
                    onChange={(event) => setNewColumnColor(event.target.value)}
                  />
                  颜色
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={newColumnIsDone}
                    onChange={(event) => setNewColumnIsDone(event.target.checked)}
                  />
                  完成列
                </label>
                <button
                  type="button"
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                  disabled={busy || !newColumnName.trim()}
                  onClick={() => {
                    void onCreateColumn(selectedBoard, {
                      name: newColumnName,
                      color: newColumnColor,
                      isDone: newColumnIsDone,
                    }).then((created) => {
                      if (!created) return;
                      setNewColumnName("");
                      setNewColumnColor("#64748b");
                      setNewColumnIsDone(false);
                    });
                  }}
                >
                  新增工作列
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {selectedColumns.map((column) => {
                  const activeIndex = activeColumnOrder.findIndex((item) => item.id === column.id);
                  return (
                    <ColumnSettingsRow
                      key={column.id}
                      column={column}
                      busy={busy}
                      activeIndex={activeIndex}
                      activeCount={activeColumnOrder.length}
                      onSave={onSaveColumn}
                      onStatus={onSetColumnStatus}
                      onMove={onMoveColumn}
                    />
                  );
                })}
                {selectedColumns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500">
                    这个看板还没有工作列。
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function BoardSettingsRow({
  board,
  selected,
  busy,
  activeIndex,
  activeCount,
  onSelect,
  onSave,
  onStatus,
  onMove,
}: {
  board: MerchantTaskBoard;
  selected: boolean;
  busy: boolean;
  activeIndex: number;
  activeCount: number;
  onSelect: (boardId: string) => void;
  onSave: (
    board: MerchantTaskBoard,
    input: { name: string; description: string },
  ) => Promise<void>;
  onStatus: (board: MerchantTaskBoard, status: "active" | "archived") => Promise<void>;
  onMove: (board: MerchantTaskBoard, position: number) => Promise<void>;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);

  useEffect(() => {
    setName(board.name);
    setDescription(board.description);
  }, [board]);

  return (
    <article
      className={`rounded-2xl border p-3 ${
        selected ? "border-cyan-400 bg-cyan-50/50" : "border-slate-200 bg-white"
      } ${board.status === "archived" ? "opacity-70" : ""}`}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_1.2fr_auto]">
        <input
          className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold"
          value={name}
          maxLength={120}
          disabled={busy}
          onFocus={() => {
            if (board.status === "active") onSelect(board.id);
          }}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 text-xs"
          value={description}
          maxLength={2000}
          placeholder="说明"
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-45"
          disabled={busy || !name.trim() || (name === board.name && description === board.description)}
          onClick={() => void onSave(board, { name, description })}
        >
          保存
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {board.status === "active" ? (
            <>
              <button
                type="button"
                aria-label={`将看板“${board.name}”前移`}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                disabled={busy || activeIndex <= 0}
                onClick={() => void onMove(board, Math.max(0, board.position - 1))}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`将看板“${board.name}”后移`}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                disabled={busy || activeIndex < 0 || activeIndex >= activeCount - 1}
                onClick={() => void onMove(board, board.position + 1)}
              >
                →
              </button>
              {!selected ? (
                <button
                  type="button"
                  className="rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700"
                  onClick={() => onSelect(board.id)}
                >
                  管理工作列
                </button>
              ) : (
                <span className="rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-800">
                  当前看板
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              已归档
            </span>
          )}
        </div>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-45 ${
            board.status === "archived"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          disabled={busy}
          onClick={() => {
            const nextStatus = board.status === "archived" ? "active" : "archived";
            if (
              nextStatus === "archived" &&
              !window.confirm(`确认归档看板“${board.name}”吗？有进行中任务时将不会执行。`)
            ) {
              return;
            }
            void onStatus(board, nextStatus);
          }}
        >
          {board.status === "archived" ? "恢复" : "归档"}
        </button>
      </div>
    </article>
  );
}

function ColumnSettingsRow({
  column,
  busy,
  activeIndex,
  activeCount,
  onSave,
  onStatus,
  onMove,
}: {
  column: MerchantTaskColumn;
  busy: boolean;
  activeIndex: number;
  activeCount: number;
  onSave: (
    column: MerchantTaskColumn,
    input: { name: string; color: string; isDone: boolean },
  ) => Promise<void>;
  onStatus: (column: MerchantTaskColumn, status: "active" | "archived") => Promise<void>;
  onMove: (column: MerchantTaskColumn, position: number) => Promise<void>;
}) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color);
  const [isDone, setIsDone] = useState(column.isDone);

  useEffect(() => {
    setName(column.name);
    setColor(column.color);
    setIsDone(column.isDone);
  }, [column]);

  return (
    <article
      className={`rounded-xl border border-slate-200 bg-white p-3 ${
        column.status === "archived" ? "opacity-65" : ""
      }`}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          className="min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold"
          value={name}
          maxLength={80}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600">
          <input
            type="color"
            className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
            value={color}
            disabled={busy}
            onChange={(event) => setColor(event.target.value)}
          />
          颜色
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={isDone}
            disabled={busy}
            onChange={(event) => setIsDone(event.target.checked)}
          />
          完成列
        </label>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-45"
          disabled={
            busy ||
            !name.trim() ||
            (name === column.name && color === column.color && isDone === column.isDone)
          }
          onClick={() => void onSave(column, { name, color, isDone })}
        >
          保存
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {column.status === "active" ? (
            <>
              <button
                type="button"
                aria-label={`将工作列“${column.name}”前移`}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                disabled={busy || activeIndex <= 0}
                onClick={() => void onMove(column, Math.max(0, column.position - 1))}
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`将工作列“${column.name}”后移`}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-30"
                disabled={busy || activeIndex < 0 || activeIndex >= activeCount - 1}
                onClick={() => void onMove(column, column.position + 1)}
              >
                →
              </button>
            </>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              已归档
            </span>
          )}
        </div>
        <button
          type="button"
          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-45 ${
            column.status === "archived"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
          disabled={busy}
          onClick={() => {
            const nextStatus = column.status === "archived" ? "active" : "archived";
            if (
              nextStatus === "archived" &&
              !window.confirm(`确认归档工作列“${column.name}”吗？有进行中任务时将不会执行。`)
            ) {
              return;
            }
            void onStatus(column, nextStatus);
          }}
        >
          {column.status === "archived" ? "恢复" : "归档"}
        </button>
      </div>
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
  navigation,
}: MerchantEnterpriseManagerProps) {
  const [internalView, setInternalView] = useState<MerchantEnterpriseView>("overview");
  const [actor, setActor] = useState<MerchantEnterpriseActor | null>(null);
  const [snapshot, setSnapshot] = useState<MerchantEnterpriseSnapshot>(EMPTY_SNAPSHOT);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState("");
  const overviewRequestSequenceRef = useRef(0);
  const overviewAbortControllerRef = useRef<AbortController | null>(null);
  const taskCreateMutationRef = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const taskSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const usesExternalNavigation = navigation?.mode === "external";
  const requestedView = usesExternalNavigation ? navigation.activeView : internalView;
  const requestedViewAllowed = actor
    ? can(actor, MERCHANT_ENTERPRISE_VIEW_PERMISSIONS[requestedView])
    : true;
  const tab = requestedViewAllowed ? requestedView : "overview";
  const onExternalViewChange = navigation?.onViewChange;
  const onAvailableViewsChange = navigation?.onAvailableViewsChange;
  const selectView = useCallback(
    (view: MerchantEnterpriseView) => {
      if (!usesExternalNavigation) setInternalView(view);
      onExternalViewChange?.(view);
    },
    [onExternalViewChange, usesExternalNavigation],
  );

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState<MerchantTaskPriority>("normal");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskAssigneeIds, setTaskAssigneeIds] = useState<string[]>([]);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<MerchantTaskPriority | "all">("all");
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState("all");
  const [taskArchiveView, setTaskArchiveView] = useState<"active" | "archived">("active");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const [mobileTaskComposerOpen, setMobileTaskComposerOpen] = useState(false);
  const [overviewNowMs, setOverviewNowMs] = useState(() => Date.now());

  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeRoleId, setEmployeeRoleId] = useState("");
  const [failedInvitationEmployeeIds, setFailedInvitationEmployeeIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<MerchantEnterprisePermission[]>([
    "enterprise.view",
  ]);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      if (accessToken) headers.set("x-merchant-access-token", accessToken);
      return fetch(path, {
        ...init,
        headers,
        credentials: accessToken ? "omit" : "include",
        cache: "no-store",
      });
    },
    [accessToken],
  );

  const loadTaskEvents = useCallback(
    async (taskId: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({ siteId, taskId });
      const response = await apiFetch(`/api/merchant-enterprise/task-events?${params.toString()}`, {
        signal,
      });
      const payload = (await response.json().catch(() => null)) as TaskEventsPayload | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.events)) {
        throw new Error(readApiError(payload, "任务动态加载失败，请稍后重试。"));
      }
      return payload.events;
    },
    [apiFetch, siteId],
  );

  const createTaskComment = useCallback(
    async (task: MerchantTask, text: string, operationId: string) => {
      const response = await apiFetch("/api/merchant-enterprise/task-events", {
        method: "POST",
        body: JSON.stringify({
          siteId,
          taskId: task.id,
          text,
          operationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TaskEventsPayload | null;
      if (!response.ok || !payload?.ok || !payload.event) {
        throw new Error(readApiError(payload, "评论发布失败，请稍后重试。"));
      }
      return payload.event;
    },
    [apiFetch, siteId],
  );

  const loadOverview = useCallback(async (options: { preserveData?: boolean } = {}) => {
    const preserveData = options.preserveData === true;
    const requestSequence = overviewRequestSequenceRef.current + 1;
    overviewRequestSequenceRef.current = requestSequence;
    overviewAbortControllerRef.current?.abort();
    overviewAbortControllerRef.current = null;
    if (!preserveData) {
      setActor(null);
      setSnapshot(EMPTY_SNAPSHOT);
      setNeedsBootstrap(false);
      setMessage(null);
    }

    if (!/^\d{8}$/.test(siteId)) {
      setMessage({ kind: "error", text: "缺少有效的商户编号。" });
      setLoading(false);
      return false;
    }

    const controller = new AbortController();
    overviewAbortControllerRef.current = controller;
    if (!preserveData) setLoading(true);
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
      if (!preserveData) setMessage(null);
      return true;
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestSequence !== overviewRequestSequenceRef.current
      ) {
        return false;
      }
      if (!preserveData) {
        setActor(null);
        setSnapshot(EMPTY_SNAPSHOT);
        setNeedsBootstrap(false);
        setFailedInvitationEmployeeIds(new Set());
      }
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
        if (!preserveData) setLoading(false);
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

  useEffect(() => {
    const intervalId = window.setInterval(() => setOverviewNowMs(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!actor) return;
    if (requestedView !== tab) selectView(tab);
  }, [actor, requestedView, selectView, tab]);

  const availableViewKey = actor
    ? MERCHANT_ENTERPRISE_VIEW_ITEMS
        .filter((item) => can(actor, item.permission))
        .map((item) => item.key)
        .join("|")
    : "";
  useEffect(() => {
    if (!usesExternalNavigation || !onAvailableViewsChange) return;
    const views = availableViewKey
      ? (availableViewKey.split("|") as MerchantEnterpriseView[])
      : [];
    onAvailableViewsChange(views);
  }, [availableViewKey, onAvailableViewsChange, usesExternalNavigation]);

  const activeRoles = snapshot.roles.filter((role) => role.status === "active");
  const assignableRoles = actor
    ? activeRoles.filter((role) => merchantEnterprisePermissionsFitActor(actor, role.permissions))
    : [];
  const activeEmployees = snapshot.employees.filter((employee) => employee.status === "active");
  const activeBoards = snapshot.boards.filter((board) => board.status === "active");
  const activeBoard =
    activeBoards.find((board) => board.id === selectedBoardId) ??
    activeBoards[0] ??
    null;
  useEffect(() => {
    const resolvedBoardId = activeBoard?.id ?? "";
    if (selectedBoardId !== resolvedBoardId) setSelectedBoardId(resolvedBoardId);
  }, [activeBoard?.id, selectedBoardId]);
  const activeColumns = snapshot.columns
    .filter((column) => column.status === "active" && column.boardId === activeBoard?.id)
    .sort((left, right) => left.position - right.position);
  const boardTasks = snapshot.tasks.filter((task) => task.boardId === activeBoard?.id);
  const visibleTasks = filterMerchantTasks(boardTasks, { archive: "active" });
  const overviewTaskSummary = useMemo(
    () =>
      buildMerchantEnterpriseTaskOverview(
        {
          boards: snapshot.boards,
          tasks: snapshot.tasks,
        },
        overviewNowMs,
      ),
    [overviewNowMs, snapshot.boards, snapshot.tasks],
  );
  const filteredTasks = filterMerchantTasks(boardTasks, {
    archive: taskArchiveView,
    query: taskQuery,
    priority: taskPriorityFilter,
    assigneeId: taskAssigneeFilter,
  });
  const hasTaskFilters =
    Boolean(taskQuery.trim()) ||
    taskPriorityFilter !== "all" ||
    taskAssigneeFilter !== "all";
  const activeTaskFilterCount =
    Number(Boolean(taskQuery.trim())) +
    Number(taskPriorityFilter !== "all") +
    Number(taskAssigneeFilter !== "all") +
    Number(taskArchiveView !== "active");
  function clearTaskFilters() {
    setTaskQuery("");
    setTaskPriorityFilter("all");
    setTaskAssigneeFilter("all");
    setTaskArchiveView("active");
  }
  const taskDragEnabled =
    taskArchiveView === "active" &&
    can(actor, "tasks.update") &&
    !busy &&
    !hasTaskFilters;
  const taskDragDisabledReason = hasTaskFilters
    ? "清除任务筛选后可拖动排序"
    : busy
      ? "正在保存，请稍候"
      : taskArchiveView !== "active"
        ? "归档任务不能移动"
        : "当前账号没有移动任务的权限";
  const draggingTask = visibleTasks.find((task) => task.id === draggingTaskId) ?? null;
  const editingTask =
    snapshot.tasks.find((task) => task.id === editingTaskId) ?? null;
  const archivedTaskCount = boardTasks.filter((task) => Boolean(task.archivedAt)).length;
  const grantablePermissions =
    actor?.type === "owner"
      ? MERCHANT_ENTERPRISE_PERMISSION_CATALOG.map((permission) => permission.key)
      : actor?.permissions ?? [];
  const employeeById = useMemo(
    () => new Map(snapshot.employees.map((employee) => [employee.id, employee] as const)),
    [snapshot.employees],
  );
  const roleById = useMemo(
    () => new Map(snapshot.roles.map((role) => [role.id, role] as const)),
    [snapshot.roles],
  );

  const mutate = useCallback(
    async (
      path: string,
      method: "POST" | "PATCH",
      body: Record<string, unknown>,
      success: string,
      options?: { reload?: boolean },
    ) => {
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
        if (options?.reload === false) {
          setMessage({ kind: "success", text: success });
          return payload;
        }
        const reloaded = await loadOverview({ preserveData: true });
        if (!reloaded) {
          setMessage({ kind: "info", text: "已保存，但列表刷新失败，请手动刷新页面确认。" });
        } else {
          setMessage({ kind: "success", text: success });
        }
        return payload;
      } catch (error) {
        const text = error instanceof Error ? error.message : "保存失败，请稍后重试。";
        setMessage({ kind: "error", text });
        if (text.includes("重新加载")) await loadOverview({ preserveData: true });
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

  async function createBoard(input: {
    name: string;
    description: string;
  }): Promise<MerchantTaskBoard | null> {
    const payload = await mutate(
      "/api/merchant-enterprise/boards",
      "POST",
      {
        name: input.name,
        description: input.description,
        operationId: createClientMutationOperationId("enterprise-board-create"),
      },
      "看板和默认工作列已创建。",
    );
    return payload?.board ? (payload.board as MerchantTaskBoard) : null;
  }

  async function saveBoard(
    board: MerchantTaskBoard,
    input: { name: string; description: string },
  ) {
    await mutate(
      "/api/merchant-enterprise/boards",
      "PATCH",
      {
        boardId: board.id,
        version: board.version,
        name: input.name,
        description: input.description,
        operationId: createClientMutationOperationId("enterprise-board-edit"),
      },
      "看板信息已保存。",
    );
  }

  async function setBoardStatus(
    board: MerchantTaskBoard,
    status: "active" | "archived",
  ) {
    await mutate(
      "/api/merchant-enterprise/boards",
      "PATCH",
      {
        boardId: board.id,
        version: board.version,
        status,
        operationId: createClientMutationOperationId(
          status === "archived" ? "enterprise-board-archive" : "enterprise-board-restore",
        ),
      },
      status === "archived" ? "看板已归档。" : "看板已恢复。",
    );
  }

  async function moveBoard(board: MerchantTaskBoard, position: number) {
    await mutate(
      "/api/merchant-enterprise/boards",
      "PATCH",
      {
        boardId: board.id,
        version: board.version,
        position,
        operationId: createClientMutationOperationId("enterprise-board-move"),
      },
      "看板顺序已更新。",
    );
  }

  async function createColumn(
    board: MerchantTaskBoard,
    input: { name: string; color: string; isDone: boolean },
  ) {
    const payload = await mutate(
      "/api/merchant-enterprise/columns",
      "POST",
      {
        boardId: board.id,
        name: input.name,
        color: input.color,
        isDone: input.isDone,
        operationId: createClientMutationOperationId("enterprise-column-create"),
      },
      "工作列已创建。",
    );
    return Boolean(payload?.column);
  }

  async function saveColumn(
    column: MerchantTaskColumn,
    input: { name: string; color: string; isDone: boolean },
  ) {
    await mutate(
      "/api/merchant-enterprise/columns",
      "PATCH",
      {
        boardId: column.boardId,
        columnId: column.id,
        version: column.version,
        name: input.name,
        color: input.color,
        isDone: input.isDone,
        operationId: createClientMutationOperationId("enterprise-column-edit"),
      },
      "工作列已保存。",
    );
  }

  async function setColumnStatus(
    column: MerchantTaskColumn,
    status: "active" | "archived",
  ) {
    await mutate(
      "/api/merchant-enterprise/columns",
      "PATCH",
      {
        boardId: column.boardId,
        columnId: column.id,
        version: column.version,
        status,
        operationId: createClientMutationOperationId(
          status === "archived" ? "enterprise-column-archive" : "enterprise-column-restore",
        ),
      },
      status === "archived" ? "工作列已归档。" : "工作列已恢复。",
    );
  }

  async function moveColumn(column: MerchantTaskColumn, position: number) {
    await mutate(
      "/api/merchant-enterprise/columns",
      "PATCH",
      {
        boardId: column.boardId,
        columnId: column.id,
        version: column.version,
        position,
        operationId: createClientMutationOperationId("enterprise-column-move"),
      },
      "工作列顺序已更新。",
    );
  }

  async function createTask() {
    if (!activeBoard || !activeColumns[0] || !taskTitle.trim()) {
      setMessage({ kind: "error", text: "请先填写任务标题。" });
      return;
    }
    const taskInput = {
      boardId: activeBoard.id,
      columnId: activeColumns[0].id,
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      priority: taskPriority,
      dueAt: taskDueAt ? new Date(`${taskDueAt}T23:59:59`).toISOString() : null,
      assigneeIds: can(actor, "tasks.assign") ? taskAssigneeIds : [],
    };
    const fingerprint = JSON.stringify(taskInput);
    if (taskCreateMutationRef.current?.fingerprint !== fingerprint) {
      taskCreateMutationRef.current = {
        fingerprint,
        operationId: createClientMutationOperationId("enterprise-task-create"),
      };
    }
    const operationId = taskCreateMutationRef.current.operationId;
    const payload = await mutate(
      "/api/merchant-enterprise/tasks",
      "POST",
      {
        ...taskInput,
        operationId,
      },
      "任务已创建。",
    );
    if (payload) {
      taskCreateMutationRef.current = null;
      setTaskTitle("");
      setTaskDescription("");
      setTaskPriority("normal");
      setTaskDueAt("");
      setTaskAssigneeIds([]);
      setMobileTaskComposerOpen(false);
    }
  }

  async function reorderTask(task: MerchantTask, columnId: string, targetIndex: number) {
    if (busy || !can(actor, "tasks.update")) return null;
    return mutate(
      "/api/merchant-enterprise/tasks",
      "PATCH",
      {
        taskId: task.id,
        version: task.version,
        columnId,
        targetIndex,
        operationId: createClientMutationOperationId("enterprise-task-reorder"),
      },
      task.columnId === columnId ? "任务顺序已更新。" : "任务状态已更新。",
    );
  }

  async function moveTask(task: MerchantTask, columnId: string) {
    const plan = planMerchantTaskReorder(visibleTasks, {
      taskId: task.id,
      targetColumnId: columnId,
      placement: "end",
    });
    if (plan.kind === "move") await reorderTask(task, plan.columnId, plan.targetIndex);
  }

  async function moveTaskWithinColumn(task: MerchantTask, direction: -1 | 1) {
    const columnTasks = sortMerchantTaskOrderItems(
      visibleTasks.filter((candidate) => candidate.columnId === task.columnId),
    );
    const taskIndex = columnTasks.findIndex((candidate) => candidate.id === task.id);
    const targetTask = columnTasks[taskIndex + direction];
    if (taskIndex < 0 || !targetTask) return;
    const plan = planMerchantTaskReorder(visibleTasks, {
      taskId: task.id,
      targetColumnId: task.columnId,
      targetTaskId: targetTask.id,
      placement: direction < 0 ? "before" : "after",
    });
    if (plan.kind === "move") await reorderTask(task, plan.columnId, plan.targetIndex);
  }

  function handleTaskDragStart(event: DragStartEvent) {
    if (!taskDragEnabled) return;
    const task = taskDndData(event.active.data.current);
    setDraggingTaskId(task?.taskId ?? "");
  }

  function handleTaskDragEnd(event: DragEndEvent) {
    setDraggingTaskId("");
    if (!taskDragEnabled || !event.over) return;
    const activeData = taskDndData(event.active.data.current);
    if (!activeData) return;
    const activeTask = visibleTasks.find((task) => task.id === activeData.taskId);
    if (!activeTask) return;

    const overTask = taskDndData(event.over.data.current);
    const overColumn = columnDndData(event.over.data.current);
    const targetColumnId = overTask?.columnId ?? overColumn?.columnId ?? "";
    if (!targetColumnId) return;

    let placement: "before" | "after" | "end" = "end";
    if (overTask) {
      if (activeTask.columnId === overTask.columnId) {
        const orderedIds = sortMerchantTaskOrderItems(
          visibleTasks.filter((task) => task.columnId === activeTask.columnId),
        ).map((task) => task.id);
        placement = orderedIds.indexOf(activeTask.id) < orderedIds.indexOf(overTask.taskId)
          ? "after"
          : "before";
      } else placement = "before";
    }

    const plan = planMerchantTaskReorder(visibleTasks, {
      taskId: activeTask.id,
      targetColumnId,
      ...(overTask ? { targetTaskId: overTask.taskId } : {}),
      placement,
    });
    if (plan.kind === "move") {
      void reorderTask(activeTask, plan.columnId, plan.targetIndex);
    }
  }

  async function reconcilePartiallySavedTaskMove() {
    const reloaded = await loadOverview({ preserveData: true });
    setMessage({
      kind: "error",
      text: reloaded
        ? "任务详情已保存，但刚才无法确认所在列更新结果；已刷新最新状态，请核对后再操作。"
        : "任务详情已保存，但无法确认所在列更新结果；请手动刷新页面后核对。",
    });
  }

  async function saveTask(task: MerchantTask, draft: TaskDraft) {
    if (!actor) return;
    const nextDueAt =
      draft.dueAt === taskDateInputValue(task.dueAt)
        ? task.dueAt
        : draft.dueAt
          ? new Date(`${draft.dueAt}T23:59:59`).toISOString()
          : null;
    const result = buildMerchantTaskEditChanges(
      actor,
      task,
      {
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        dueAt: nextDueAt,
        columnId: draft.columnId,
        assigneeIds: draft.assigneeIds,
      },
      snapshot.employees,
    );
    if (!result.ok) {
      if (result.error === "inactive_assignee") {
        const inactiveAssigneeName =
          employeeById.get(result.employeeId ?? "")?.displayName || "未知员工";
        setMessage({
          kind: "error",
          text: `请先移除非活跃员工“${inactiveAssigneeName}”，再保存负责人。`,
        });
      } else {
        setMessage({
          kind: "error",
          text: `每个任务最多可分派 ${MAX_MERCHANT_TASK_ASSIGNEES} 名员工。`,
        });
      }
      return;
    }
    const targetColumnId =
      typeof result.changes.columnId === "string" ? result.changes.columnId : "";
    const editChanges: Record<string, unknown> = { ...result.changes };
    delete editChanges.columnId;
    const hasDetailChanges = Object.keys(editChanges).length > 0;
    const hasColumnChange = Boolean(targetColumnId && targetColumnId !== task.columnId);
    if (!hasDetailChanges && !hasColumnChange) {
      setMessage({ kind: "info", text: "任务没有需要保存的修改。" });
      return;
    }

    let taskForMove = task;
    if (hasDetailChanges) {
      const payload = await mutate(
        "/api/merchant-enterprise/tasks",
        "PATCH",
        {
          taskId: task.id,
          version: task.version,
          operationId: createClientMutationOperationId("enterprise-task-edit"),
          ...editChanges,
        },
        hasColumnChange ? "任务详情已保存，正在更新所在列。" : "任务已保存。",
        hasColumnChange ? { reload: false } : undefined,
      );
      if (!payload) return;
      if (payload.task) taskForMove = payload.task as MerchantTask;
    }

    if (hasColumnChange) {
      const plan = planMerchantTaskReorder(visibleTasks, {
        taskId: task.id,
        targetColumnId,
        placement: "end",
      });
      if (plan.kind !== "move") {
        if (hasDetailChanges) await reconcilePartiallySavedTaskMove();
        else setMessage({ kind: "error", text: "无法确定任务的新位置，请刷新页面后重试。" });
        return;
      }
      const payload = await reorderTask(taskForMove, plan.columnId, plan.targetIndex);
      if (!payload) {
        if (hasDetailChanges) await reconcilePartiallySavedTaskMove();
        return;
      }
    }

    setEditingTaskId("");
  }

  async function setTaskArchived(task: MerchantTask, archived: boolean) {
    if (archived && !window.confirm(`确认归档任务“${task.title}”吗？之后可从归档任务中恢复。`)) {
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/tasks",
      "PATCH",
      {
        taskId: task.id,
        version: task.version,
        archived,
        operationId: createClientMutationOperationId(
          archived ? "enterprise-task-archive" : "enterprise-task-restore",
        ),
      },
      archived ? "任务已归档。" : "任务已恢复。",
    );
    if (payload) setEditingTaskId("");
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

  async function sendEmployeeInvitation(
    employee: MerchantEnterpriseEmployee,
    action: "resend_invite" | "renew_invite",
  ) {
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        action,
        employeeId: employee.id,
        version: employee.version,
      },
      action === "renew_invite" ? "新邀请邮件已发送。" : "邀请邮件已重新发送。",
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

  async function revokeEmployeeInvitation(employee: MerchantEnterpriseEmployee) {
    if (!window.confirm(`确认撤销发给“${employee.displayName}”的邀请吗？旧邮件将立即失效。`)) {
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        action: "revoke_invite",
        employeeId: employee.id,
        version: employee.version,
      },
      "邀请已撤销，旧邮件不再有效。",
    );
    if (!payload) return;
    setFailedInvitationEmployeeIds((current) => {
      const next = new Set(current);
      next.delete(employee.id);
      return next;
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
        permissions: rolePermissions,
      },
      "角色已创建。",
    );
    if (payload) {
      setRoleName("");
      setRoleDescription("");
      setRolePermissions(["enterprise.view"]);
    }
  }

  async function saveRole(
    role: MerchantEnterpriseRole,
    input: {
      name: string;
      description: string;
      permissions: MerchantEnterprisePermission[];
    },
  ) {
    await mutate(
      "/api/merchant-enterprise/roles",
      "PATCH",
      {
        roleId: role.id,
        version: role.version,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
      },
      "角色已保存。",
    );
  }

  async function updateRoleStatus(
    role: MerchantEnterpriseRole,
    status: "active" | "archived",
  ) {
    if (
      status === "archived" &&
      !window.confirm(`确认归档角色“${role.name}”吗？已分配给员工的角色无法归档。`)
    ) {
      return;
    }
    await mutate(
      "/api/merchant-enterprise/roles",
      "PATCH",
      { roleId: role.id, version: role.version, status },
      status === "archived" ? "角色已归档。" : "角色已恢复。",
    );
  }

  function roleEditAvailability(role: MerchantEnterpriseRole) {
    if (!actor) {
      return { editable: false, reason: "正在验证当前账号。" };
    }
    if (!can(actor, "roles.manage")) {
      return { editable: false, reason: "当前账号只能查看角色。" };
    }
    if (actor.type === "owner") return { editable: true, reason: "" };
    if (role.isSystem) return { editable: false, reason: "员工不能修改系统角色。" };
    if (actor.roleId === role.id) return { editable: false, reason: "不能修改自己的角色。" };
    if (!merchantEnterprisePermissionsFitActor(actor, role.permissions)) {
      return { editable: false, reason: "该角色权限高于当前账号。" };
    }
    return { editable: true, reason: "" };
  }

  const mobileSafeControlClassName =
    "[&_input]:!text-base [&_select]:!text-base [&_textarea]:!text-base sm:[&_input]:!text-sm sm:[&_select]:!text-sm sm:[&_textarea]:!text-sm";
  const wrapperClassName = standalone
    ? `min-h-screen min-w-0 overflow-x-hidden bg-[#f3f6fb] p-4 sm:p-6 ${mobileSafeControlClassName} ${className}`
    : `min-h-[calc(100vh-8rem)] min-w-0 overflow-x-hidden py-6 ${mobileSafeControlClassName} ${className}`;

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
        <header className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#0f172a,#1e3a5f_58%,#0f766e)] px-4 py-5 text-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/80">Enterprise workspace</div>
              <h1 className="mt-2 !text-2xl !font-bold !text-white">企业管理</h1>
              <p className="mt-2 break-words text-sm text-slate-200">
                {siteName || siteId} · 任务、员工和角色权限统一管理
              </p>
            </div>
            <div className="w-full min-w-0 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-left backdrop-blur sm:w-auto sm:text-right">
              <div className="text-xs text-slate-200">当前身份</div>
              <div className="mt-1 break-words text-sm font-semibold">
                {actor.displayName} · {actor.type === "owner" ? "企业负责人" : "员工"}
              </div>
            </div>
          </div>
        </header>

        {!usesExternalNavigation ? (
          <nav
            aria-label="企业管理功能"
            className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:flex sm:overflow-x-auto"
          >
            {MERCHANT_ENTERPRISE_VIEW_ITEMS
              .filter((item) => can(actor, item.permission))
              .map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`min-h-11 w-full rounded-xl px-3 py-2 text-sm font-semibold transition sm:w-auto sm:shrink-0 sm:px-4 ${
                  tab === key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => selectView(key)}
              >
                {label}
              </button>
              ))}
          </nav>
        ) : null}

        {message ? (
          <div
            role={message.kind === "error" ? "alert" : "status"}
            aria-live="polite"
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
                {
                  label: "未完成任务",
                  value: can(actor, "tasks.view")
                    ? overviewTaskSummary.incompleteTaskCount
                    : "—",
                  tone: "text-blue-700",
                },
                {
                  label: "已完成任务",
                  value: can(actor, "tasks.view")
                    ? overviewTaskSummary.completedTaskCount
                    : "—",
                  tone: "text-emerald-700",
                },
                {
                  label: "团队成员",
                  value: can(actor, "employees.view") ? activeEmployees.length : "—",
                  tone: "text-violet-700",
                },
                {
                  label: "已逾期",
                  value: can(actor, "tasks.view")
                    ? overviewTaskSummary.overdueTaskCount
                    : "—",
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
                  <p className="mt-1 text-sm text-slate-500">汇总全部启用看板，优先显示即将到期和最近更新的工作。</p>
                </div>
                {can(actor, "tasks.view") ? (
                  <button type="button" className="text-sm font-semibold text-blue-700" onClick={() => selectView("tasks")}>
                    查看看板
                  </button>
                ) : null}
              </div>
              <div className="mt-4 divide-y divide-slate-100">
                {!can(actor, "tasks.view") ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    当前角色没有查看任务的权限。
                  </div>
                ) : null}
                {can(actor, "tasks.view")
                  ? overviewTaskSummary.recentTasks.slice(0, 6).map((task) => {
                      const boardName = snapshot.boards.find((board) => board.id === task.boardId)?.name;
                      const columnName = snapshot.columns.find((column) => column.id === task.columnId)?.name;
                      return (
                        <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <div>
                            <div className="font-medium text-slate-900">{task.title}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {boardName ? `${boardName} · ` : ""}
                              {columnName || "未分类"}
                              {task.dueAt ? ` · 截止 ${formatDate(task.dueAt)}` : ""}
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PRIORITY_META[task.priority].className}`}>
                            {PRIORITY_META[task.priority].label}
                          </span>
                        </div>
                      );
                    })
                  : null}
                {can(actor, "tasks.view") && overviewTaskSummary.tasks.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">还没有任务，可以从任务看板创建第一项工作。</div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {!needsBootstrap && tab === "tasks" ? (
          <div className="mt-5 space-y-5">
            <section className="flex flex-wrap items-end justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="min-w-[240px] text-xs font-medium text-slate-600">
                当前看板
                <select
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
                  value={activeBoard?.id ?? ""}
                  disabled={activeBoards.length === 0}
                  onChange={(event) => setSelectedBoardId(event.target.value)}
                >
                  {activeBoards.length === 0 ? <option value="">暂无启用看板</option> : null}
                  {activeBoards.map((board) => (
                    <option key={board.id} value={board.id}>{board.name}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                {activeBoard?.description ? (
                  <span className="max-w-xl text-xs leading-5 text-slate-500">{activeBoard.description}</span>
                ) : null}
                {can(actor, "boards.manage") ? (
                  <button
                    type="button"
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                      showBoardSettings
                        ? "border-cyan-700 bg-cyan-700 text-white"
                        : "border-cyan-200 bg-cyan-50 text-cyan-700"
                    }`}
                    onClick={() => setShowBoardSettings((current) => !current)}
                  >
                    {showBoardSettings ? "收起看板设置" : "管理看板与工作列"}
                  </button>
                ) : null}
              </div>
            </section>

            {can(actor, "boards.manage") && showBoardSettings ? (
              <BoardSettings
                boards={snapshot.boards}
                columns={snapshot.columns}
                selectedBoardId={activeBoard?.id ?? ""}
                busy={busy}
                onSelectBoard={setSelectedBoardId}
                onCreateBoard={createBoard}
                onSaveBoard={saveBoard}
                onSetBoardStatus={setBoardStatus}
                onMoveBoard={moveBoard}
                onCreateColumn={createColumn}
                onSaveColumn={saveColumn}
                onSetColumnStatus={setColumnStatus}
                onMoveColumn={moveColumn}
              />
            ) : null}

            {can(actor, "tasks.create") ? (
              <>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center justify-between rounded-2xl bg-blue-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-sm sm:hidden"
                  aria-expanded={mobileTaskComposerOpen}
                  aria-controls="merchant-enterprise-task-composer"
                  onClick={() => setMobileTaskComposerOpen((current) => !current)}
                >
                  <span>{mobileTaskComposerOpen ? "收起新建任务" : "新建任务"}</span>
                  <span aria-hidden="true">{mobileTaskComposerOpen ? "−" : "+"}</span>
                </button>
                <section
                  id="merchant-enterprise-task-composer"
                  className={`${mobileTaskComposerOpen ? "block" : "hidden"} rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:block`}
                >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">新建任务</h2>
                    <p className="mt-1 text-sm text-slate-500">任务创建后可继续补充详情或跨列推进。</p>
                  </div>
                  <button
                    type="button"
                    className="hidden rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45 sm:inline-flex"
                    disabled={busy || !taskTitle.trim() || !activeBoard || activeColumns.length === 0}
                    onClick={() => void createTask()}
                  >
                    新建任务
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <label className="block text-xs font-medium text-slate-600 md:col-span-2">
                    任务标题
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      placeholder="例如：确认周五交付清单"
                      value={taskTitle}
                      maxLength={240}
                      onChange={(event) => setTaskTitle(event.target.value)}
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    优先级
                    <select
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      value={taskPriority}
                      onChange={(event) => setTaskPriority(event.target.value as MerchantTaskPriority)}
                    >
                      {(Object.keys(PRIORITY_META) as MerchantTaskPriority[]).map((item) => (
                        <option key={item} value={item}>{PRIORITY_META[item].label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    截止日期
                    <EnterpriseDateField
                      value={taskDueAt}
                      onChange={setTaskDueAt}
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600 md:col-span-2">
                    简要说明
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      placeholder="可选"
                      value={taskDescription}
                      onChange={(event) => setTaskDescription(event.target.value)}
                    />
                  </label>
                  {can(actor, "tasks.assign") ? (
                    <fieldset className="rounded-2xl border border-slate-200 px-3 pb-3 md:col-span-2">
                      <legend className="px-1 text-xs font-medium text-slate-600">负责人（可多选）</legend>
                      <div className="mt-1 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                        {activeEmployees.map((employee) => (
                          <label key={employee.id} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={taskAssigneeIds.includes(employee.id)}
                              disabled={
                                !taskAssigneeIds.includes(employee.id) &&
                                taskAssigneeIds.length >= MAX_MERCHANT_TASK_ASSIGNEES
                              }
                              onChange={(event) => {
                                setTaskAssigneeIds((current) =>
                                  event.target.checked
                                    ? Array.from(new Set([...current, employee.id]))
                                    : current.filter((id) => id !== employee.id),
                                );
                              }}
                            />
                            {employee.displayName}
                          </label>
                        ))}
                        {activeEmployees.length === 0 ? (
                          <span className="text-xs text-slate-500">暂无可分派员工</span>
                        ) : null}
                      </div>
                    </fieldset>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mt-4 min-h-11 w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45 sm:hidden"
                  disabled={busy || !taskTitle.trim() || !activeBoard || activeColumns.length === 0}
                  onClick={() => void createTask()}
                >
                  创建任务
                </button>
                </section>
              </>
            ) : null}

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-0 w-full flex-1 text-xs font-medium text-slate-600 sm:min-w-[220px]">
                  搜索任务
                  <input
                    type="search"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="搜索标题或说明"
                    value={taskQuery}
                    onChange={(event) => setTaskQuery(event.target.value)}
                  />
                </label>
                <label className="w-full min-w-0 text-xs font-medium text-slate-600 sm:w-auto">
                  优先级
                  <select
                    className="mt-1.5 block w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={taskPriorityFilter}
                    onChange={(event) => setTaskPriorityFilter(event.target.value as MerchantTaskPriority | "all")}
                  >
                    <option value="all">全部优先级</option>
                    {(Object.keys(PRIORITY_META) as MerchantTaskPriority[]).map((item) => (
                      <option key={item} value={item}>{PRIORITY_META[item].label}</option>
                    ))}
                  </select>
                </label>
                <label className="w-full min-w-0 text-xs font-medium text-slate-600 sm:w-auto">
                  负责人
                  <select
                    className="mt-1.5 block w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    value={taskAssigneeFilter}
                    onChange={(event) => setTaskAssigneeFilter(event.target.value)}
                  >
                    <option value="all">全部负责人</option>
                    <option value="unassigned">未分派</option>
                    {snapshot.employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.displayName}</option>
                    ))}
                  </select>
                </label>
                <div className="flex w-full rounded-xl bg-slate-100 p-1 sm:w-auto" aria-label="任务归档状态">
                  <button
                    type="button"
                    className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold sm:min-h-0 sm:flex-none ${
                      taskArchiveView === "active" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                    }`}
                    onClick={() => setTaskArchiveView("active")}
                  >
                    进行中
                  </button>
                  <button
                    type="button"
                    className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold sm:min-h-0 sm:flex-none ${
                      taskArchiveView === "archived" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"
                    }`}
                    onClick={() => setTaskArchiveView("archived")}
                  >
                    已归档 {archivedTaskCount > 0 ? `(${archivedTaskCount})` : ""}
                  </button>
                </div>
                {activeTaskFilterCount > 0 ? (
                  <button
                    type="button"
                    className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 sm:min-h-0"
                    onClick={clearTaskFilters}
                  >
                    清除筛选 ({activeTaskFilterCount})
                  </button>
                ) : null}
                <div className="pb-2 text-xs text-slate-500">筛选结果 {filteredTasks.length} 项</div>
              </div>
            </section>

            {!activeBoard || activeColumns.length === 0 ? (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
                当前没有可用的任务看板或工作列，请由管理员重新初始化工作区。
              </section>
            ) : (
              <DndContext
                accessibility={{
                  announcements: TASK_DND_ANNOUNCEMENTS,
                  screenReaderInstructions: TASK_DND_SCREEN_READER_INSTRUCTIONS,
                }}
                sensors={taskSensors}
                collisionDetection={closestCorners}
                onDragStart={handleTaskDragStart}
                onDragCancel={() => setDraggingTaskId("")}
                onDragEnd={handleTaskDragEnd}
              >
                {taskArchiveView === "active" && can(actor, "tasks.update") ? (
                  <div className={`rounded-2xl border px-4 py-3 text-xs ${
                    hasTaskFilters
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-blue-100 bg-blue-50 text-blue-700"
                  }`}>
                    {hasTaskFilters
                      ? "当前有筛选条件。清除筛选后可拖动卡片排序。"
                      : "拖动卡片右上角手柄可跨列移动或调整同列顺序；也可使用键盘或卡片下方按钮。"}
                  </div>
                ) : null}
                <section
                  data-enterprise-board-scroll
                  className="-mx-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-1 pb-3 pt-3 sm:mx-0 sm:snap-none sm:px-0"
                >
                  <div
                    className="flex w-max min-w-full gap-3 sm:grid sm:w-auto sm:min-w-[920px] sm:gap-4"
                    style={{ gridTemplateColumns: `repeat(${Math.max(activeColumns.length, 1)}, minmax(230px, 1fr))` }}
                  >
                    {activeColumns.map((column, columnIndex) => {
                      const tasks = sortMerchantTaskOrderItems(
                        filteredTasks.filter((task) => task.columnId === column.id),
                      );
                      return (
                        <SortableTaskColumn
                          key={column.id}
                          column={column}
                          taskIds={tasks.map((task) => task.id)}
                          dragDisabled={!taskDragEnabled}
                        >
                          <div className="flex items-center justify-between gap-2 px-1 py-2">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: column.color }} />
                              <h3 className="font-semibold text-slate-900">{column.name}</h3>
                            </div>
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{tasks.length}</span>
                          </div>
                          <div className="mt-2 space-y-3">
                            {tasks.map((task, taskIndex) => {
                              const assigned = task.assigneeIds
                                .map((id) => employeeById.get(id)?.displayName)
                                .filter(Boolean)
                                .join("、");
                              const overdue = Boolean(task.dueAt && !task.completedAt && Date.parse(task.dueAt) < Date.now());
                              const reorderControlsDisabled = busy || hasTaskFilters;
                              return (
                                <SortableTaskShell
                                  key={task.id}
                                  task={task}
                                  dragDisabled={!taskDragEnabled}
                                  dragDisabledReason={taskDragDisabledReason}
                                  showDragHandle={taskArchiveView === "active" && can(actor, "tasks.update")}
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
                                  <button
                                    type="button"
                                    className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700"
                                    onClick={() => setEditingTaskId(task.id)}
                                  >
                                    {can(actor, "tasks.update") || can(actor, "tasks.assign") || can(actor, "tasks.archive")
                                      ? "管理任务"
                                      : "查看详情"}
                                  </button>
                                  {taskArchiveView === "active" && can(actor, "tasks.update") ? (
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                      <button
                                        type="button"
                                        className="min-h-11 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-35 sm:min-h-0"
                                        disabled={reorderControlsDisabled || taskIndex === 0}
                                        onClick={() => void moveTaskWithinColumn(task, -1)}
                                      >
                                        上移
                                      </button>
                                      <button
                                        type="button"
                                        className="min-h-11 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-35 sm:min-h-0"
                                        disabled={reorderControlsDisabled || taskIndex === tasks.length - 1}
                                        onClick={() => void moveTaskWithinColumn(task, 1)}
                                      >
                                        下移
                                      </button>
                                      <button
                                        type="button"
                                        className="min-h-11 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-35 sm:min-h-0"
                                        disabled={reorderControlsDisabled || columnIndex === 0}
                                        onClick={() => {
                                          const previous = activeColumns[columnIndex - 1];
                                          if (previous) void moveTask(task, previous.id);
                                        }}
                                      >
                                        上一列
                                      </button>
                                      <button
                                        type="button"
                                        className="min-h-11 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-35 sm:min-h-0"
                                        disabled={reorderControlsDisabled || columnIndex === activeColumns.length - 1}
                                        onClick={() => {
                                          const next = activeColumns[columnIndex + 1];
                                          if (next) void moveTask(task, next.id);
                                        }}
                                      >
                                        下一列
                                      </button>
                                    </div>
                                  ) : null}
                                </SortableTaskShell>
                              );
                            })}
                            {tasks.length === 0 ? (
                              <div className={`rounded-2xl border border-dashed px-3 py-8 text-center text-xs ${
                                draggingTask && taskDragEnabled
                                  ? "border-blue-300 bg-blue-50/50 text-blue-500"
                                  : "border-slate-300 text-slate-400"
                              }`}>
                                {draggingTask && taskDragEnabled ? "拖到这里" : "此列暂无匹配任务"}
                              </div>
                            ) : null}
                          </div>
                        </SortableTaskColumn>
                      );
                    })}
                  </div>
                </section>
                <DragOverlay>
                  {draggingTask ? <TaskDragPreview task={draggingTask} /> : null}
                </DragOverlay>
              </DndContext>
            )}
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
                  const previousInvitationFailed =
                    failedInvitationEmployeeIds.has(employee.id);
                  const invitationPresentation = employeeInvitationPresentation(employee);
                  const invitationNeedsAction = employee.status === "invited";
                  const invitationNeedsRenewal =
                    invitationPresentation.state === "expired" ||
                    invitationPresentation.state === "revoked";
                  return (
                    <div key={employee.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{employee.displayName}</div>
                        <div className="mt-1 truncate text-sm text-slate-500">{employee.email || "邮箱仅管理员可见"}</div>
                      </div>
                      <div className="flex max-w-full flex-wrap items-center justify-end gap-3">
                        {can(actor, "employees.manage") &&
                        !(actor.type === "employee" && actor.id === employee.id) &&
                        assignableRoles.some((role) => role.id === employee.roleId) ? (
                          <select
                            className="max-w-[12rem] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
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
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${invitationPresentation.tone}`}>
                          {previousInvitationFailed && invitationPresentation.state === "pending"
                            ? "发送失败"
                            : invitationPresentation.label}
                        </span>
                        {invitationPresentation.detail ? (
                          <span className="max-w-[13rem] text-right text-[11px] leading-4 text-slate-500">
                            {invitationPresentation.detail}
                          </span>
                        ) : null}
                        {can(actor, "employees.manage") && invitationNeedsAction ? (
                          <button
                            type="button"
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-45"
                            disabled={busy}
                            onClick={() =>
                              void sendEmployeeInvitation(
                                employee,
                                invitationNeedsRenewal ? "renew_invite" : "resend_invite",
                              )
                            }
                          >
                            {invitationNeedsRenewal
                              ? "生成新邀请"
                              : previousInvitationFailed || invitationPresentation.state === "failed"
                                ? "重试邀请"
                                : "重发邀请"}
                          </button>
                        ) : null}
                        {can(actor, "employees.manage") &&
                        invitationNeedsAction &&
                        !invitationNeedsRenewal ? (
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-45"
                            disabled={busy}
                            onClick={() => void revokeEmployeeInvitation(employee)}
                          >
                            撤销邀请
                          </button>
                        ) : null}
                        {can(actor, "employees.manage") &&
                        employee.status !== "invited" &&
                        !(actor.type === "employee" && actor.id === employee.id) ? (
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
                <p className="mt-1 text-sm text-slate-500">勾选管理权限时会自动补齐所需的查看权限。</p>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                  <label className="block text-xs font-medium text-slate-600">
                    角色名称
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      value={roleName}
                      maxLength={80}
                      onChange={(event) => setRoleName(event.target.value)}
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    角色说明
                    <input
                      className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      value={roleDescription}
                      maxLength={1000}
                      onChange={(event) => setRoleDescription(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="self-end rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                    disabled={busy || !roleName.trim()}
                    onClick={() => void createRole()}
                  >
                    创建角色
                  </button>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {MERCHANT_ENTERPRISE_PERMISSION_CATALOG.map((permission) => {
                    const checked = rolePermissions.includes(permission.key);
                    const canGrant = grantablePermissions.includes(permission.key);
                    return (
                      <label
                        key={`new-${permission.key}`}
                        className={`flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2 ${
                          canGrant ? "" : "bg-slate-50 opacity-60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          disabled={!canGrant}
                          onChange={(event) =>
                            setRolePermissions((current) =>
                              toggleMerchantEnterprisePermissionSelection(
                                current,
                                permission.key,
                                event.target.checked,
                              ),
                            )
                          }
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">{permission.label}</span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{permission.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section className="grid gap-4 lg:grid-cols-2">
              {snapshot.roles.map((role) => {
                const availability = roleEditAvailability(role);
                return (
                  <RoleEditor
                    key={role.id}
                    role={role}
                    busy={busy}
                    editable={availability.editable}
                    unavailableReason={availability.reason}
                    grantablePermissions={grantablePermissions}
                    onSave={saveRole}
                    onStatusChange={updateRoleStatus}
                  />
                );
              })}
              {snapshot.roles.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 lg:col-span-2">
                  还没有角色，请先初始化企业工作区。
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {editingTask ? (
          <TaskEditor
            key={`${editingTask.id}:${editingTask.version}`}
            task={editingTask}
            actor={actor}
            columns={snapshot.columns.filter(
              (column) => column.boardId === editingTask.boardId && column.status === "active",
            )}
            employees={snapshot.employees}
            busy={busy}
            canUpdate={can(actor, "tasks.update")}
            canAssign={can(actor, "tasks.assign")}
            canArchive={can(actor, "tasks.archive")}
            onSave={saveTask}
            onArchive={setTaskArchived}
            onLoadEvents={loadTaskEvents}
            onComment={createTaskComment}
            onClose={() => setEditingTaskId("")}
          />
        ) : null}
      </div>
    </div>
  );
}
