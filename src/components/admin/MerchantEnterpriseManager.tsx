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
  buildMerchantTaskEditChanges,
  canMerchantEnterpriseEmployeeCoverBoards,
  canCreateMerchantEnterpriseBoards,
  filterMerchantTasks,
  getMerchantEmployeeRoleTransitionAffectedTasks,
  getMerchantEnterpriseDefaultTaskAssigneeFilter,
  getMerchantEnterpriseDefaultRoleBoardAccess,
  getMerchantTaskCompletionTransition,
  hasMerchantEnterprisePermission,
  merchantEnterpriseBoardAccessFitsActor,
  merchantEnterprisePermissionsFitActor,
  merchantEnterpriseRoleFitsActor,
  MAX_MERCHANT_TASK_ASSIGNEES,
  MAX_MERCHANT_TASK_CHECKLIST_ITEMS,
  MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH,
  MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  toggleMerchantEnterprisePermissionSelection,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseEmployee,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRole,
  type MerchantEnterpriseSnapshot,
  type MerchantTask,
  type MerchantTaskBoard,
  type MerchantTaskChecklistItem,
  type MerchantTaskColumn,
  type MerchantTaskEvent,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import { isValidAuthEmail, normalizeAuthEmail } from "@/lib/authCredentialValidation";
import { createClientMutationOperationId } from "@/lib/mutationOperationId";
import {
  getMerchantLinkedOrderSummaryErrorMessage,
  getMerchantOrderTaskSource,
  type MerchantLinkedOrderSummary,
  type MerchantOrderTaskDraftIntent,
} from "@/lib/merchantOrderEnterprise";
import {
  formatMerchantOrderAmount,
  getMerchantOrderStatusLabel,
} from "@/lib/merchantOrders";
import {
  planMerchantTaskReorder,
  sortMerchantTaskOrderItems,
} from "@/lib/merchantTaskOrdering";
import {
  buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint,
  buildMerchantEnterpriseCurrentOperationsFallback,
  buildMerchantEnterpriseCurrentOperationsRequestKey,
  normalizeMerchantEnterpriseCurrentOperations,
  type MerchantEnterpriseCurrentOperations,
  type MerchantEnterpriseCurrentOperationsPriorityTask,
} from "@/lib/merchantEnterpriseCurrentOperations";
import MerchantEnterpriseNotificationCenter from "@/components/admin/MerchantEnterpriseNotificationCenter";
import MerchantEnterpriseAuditLog from "@/components/admin/MerchantEnterpriseAuditLog";
import MerchantEnterpriseTodoCenter from "@/components/admin/MerchantEnterpriseTodoCenter";
import MerchantEnterpriseAutomationManager from "@/components/admin/MerchantEnterpriseAutomationManager";
import { normalizeMerchantEnterpriseTodoPage } from "@/lib/merchantEnterpriseTodos";
import { isMerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import MerchantTaskWorkflowBindingCard from "@/components/admin/MerchantTaskWorkflowBindingCard";
import EnterpriseWorkflowsPanel, {
  type EnterpriseWorkflowApiFetch,
} from "@/app/enterprise/[siteId]/EnterpriseWorkflowsPanel";
import { WorkflowPermissionGapCard } from "@/app/enterprise/[siteId]/EnterpriseWorkflowGovernance";

export type MerchantEnterpriseView =
  | "overview"
  | "todos"
  | "tasks"
  | "workflows"
  | "automations"
  | "employees"
  | "roles"
  | "audit";

export type MerchantEnterpriseExternalNavigation = {
  mode: "external";
  activeView: MerchantEnterpriseView;
  onViewChange: (view: MerchantEnterpriseView) => void;
  onAvailableViewsChange?: (views: readonly MerchantEnterpriseView[]) => void;
  registerViewChangeGuard?: (
    guard: ((view: MerchantEnterpriseView | null) => boolean) | null,
  ) => void;
};

const MERCHANT_ENTERPRISE_VIEW_ITEMS = [
  { key: "overview", label: "工作台", permission: "enterprise.view" },
  { key: "todos", label: "待办中心", permission: "enterprise.view" },
  { key: "tasks", label: "任务看板", permission: "tasks.view" },
  { key: "workflows", label: "工作流程", permission: "workflows.view" },
  { key: "automations", label: "流程自动化", permission: "automations.view" },
  { key: "employees", label: "员工账号", permission: "employees.view" },
  { key: "roles", label: "角色权限", permission: "roles.view" },
  { key: "audit", label: "操作记录", permission: "audit.view" },
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
  collaborationRefreshIntervalMs?: number;
  navigation?: MerchantEnterpriseExternalNavigation;
  taskDraftIntent?: MerchantOrderTaskDraftIntent | null;
  onTaskDraftIntentHandled?: (requestId: string) => void;
  onOpenSourceOrder?: (input: { siteId: string; orderId: string }) => Promise<void> | void;
  onTodoCountChange?: (count: number) => void;
  registerLeaveGuard?: (guard: (() => boolean) | null) => void;
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

type TaskChecklistPayload = {
  ok?: boolean;
  error?: string;
  items?: MerchantTaskChecklistItem[];
  item?: MerchantTaskChecklistItem;
};

type LinkedOrderSummaryPayload = {
  ok?: boolean;
  error?: string;
  summary?: MerchantLinkedOrderSummary;
};

type CurrentOperationsViewState = {
  requestKey: string;
  status: "idle" | "loading" | "ready" | "error";
  data: MerchantEnterpriseCurrentOperations | null;
  error: string;
  errorCode: string;
  authorizationFingerprint: string;
};

const EMPTY_CURRENT_OPERATIONS_STATE: CurrentOperationsViewState = {
  requestKey: "",
  status: "idle",
  data: null,
  error: "",
  errorCode: "",
  authorizationFingerprint: "",
};

class CurrentOperationsRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly authorizationFingerprint: string,
  ) {
    super(message);
    this.name = "CurrentOperationsRequestError";
  }
}

type TaskChecklistItemChange =
  | { text: string }
  | { completed: boolean }
  | { archived: boolean };

const EMPTY_SNAPSHOT: MerchantEnterpriseSnapshot = {
  roles: [],
  employees: [],
  boards: [],
  columns: [],
  tasks: [],
};

const MERCHANT_ENTERPRISE_REQUEST_TIMEOUT_MS = 30_000;
const MERCHANT_ENTERPRISE_WORKFLOW_FOCUS_TIMEOUT_MS = 30_000;
const DEFAULT_MERCHANT_ENTERPRISE_COLLABORATION_REFRESH_INTERVAL_MS = 30_000;
const MIN_MERCHANT_ENTERPRISE_COLLABORATION_REFRESH_INTERVAL_MS = 250;
const MERCHANT_ENTERPRISE_STALE_INTERVAL_MULTIPLIER = 3;

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

function haveSameStringValues(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function normalizeCollaborationRefreshInterval(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MERCHANT_ENTERPRISE_COLLABORATION_REFRESH_INTERVAL_MS;
  }
  return Math.max(
    MIN_MERCHANT_ENTERPRISE_COLLABORATION_REFRESH_INTERVAL_MS,
    Math.round(Number(value)),
  );
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
  if (event.eventType === "checklist_item_created") return "新增了清单项";
  if (event.eventType === "checklist_item_updated") return "修改了清单项";
  if (event.eventType === "checklist_item_completed") return "完成了清单项";
  if (event.eventType === "checklist_item_reopened") return "恢复了清单项";
  if (event.eventType === "checklist_item_archived") return "移除了清单项";
  if (event.eventType === "checklist_item_restored") return "恢复了清单项";
  if (event.eventType === "workflow_bound") {
    const payload = taskEventPayload(event);
    const revisionNo = typeof payload.revisionNo === "number" ? payload.revisionNo : null;
    const generatedChecklistCount =
      typeof payload.generatedChecklistCount === "number" ? payload.generatedChecklistCount : null;
    if (revisionNo && generatedChecklistCount !== null) {
      return `应用了工作流程 v${revisionNo}，生成 ${generatedChecklistCount} 项清单`;
    }
    if (revisionNo) return `应用了工作流程 v${revisionNo}`;
    return "应用了工作流程";
  }
  if (event.eventType === "workflow_execution_started") {
    const payload = taskEventPayload(event);
    const revisionNo = typeof payload.revisionNo === "number" ? payload.revisionNo : null;
    const generatedChecklistCount =
      typeof payload.generatedChecklistCount === "number" ? payload.generatedChecklistCount : 0;
    const versionLabel = revisionNo ? ` v${revisionNo}` : "";
    const checklistLabel = generatedChecklistCount > 0
      ? `，生成 ${generatedChecklistCount} 项清单`
      : "";
    return `开始执行工作流程${versionLabel}${checklistLabel}`;
  }
  if (event.eventType === "employee_offboarded") {
    return typeof taskEventPayload(event).replacementEmployeeId === "string"
      ? "因员工停用转交了负责人"
      : "因员工停用解除了负责人";
  }
  if (event.eventType === "employee_role_transitioned") {
    return typeof taskEventPayload(event).replacementEmployeeId === "string"
      ? "因员工角色变更转交了负责人"
      : "因员工角色变更解除了负责人";
  }
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
      label: "等待发送",
      detail: "系统会自动发送，失败时自动重试",
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

function readApiErrorCode(payload: unknown) {
  return (
    payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : ""
  );
}

function readCurrentOperationsAuthorizationFingerprint(payload: unknown) {
  const value =
    payload && typeof payload === "object"
      ? (payload as { authorizationFingerprint?: unknown })
          .authorizationFingerprint
      : null;
  return typeof value === "string" &&
    value === value.trim() &&
    value.length <= 65536
    ? value
    : "";
}

function readApiError(payload: unknown, fallback: string) {
  const code = readApiErrorCode(payload);
  if (code === "enterprise_schema_unavailable") return "企业管理数据库尚未初始化，请先部署对应数据库迁移。";
  if (code === "enterprise_management_disabled") return "当前商户尚未开通企业管理。";
  if (code === "permission_denied") return "当前账号没有执行此操作的权限。";
  if (code === "permission_escalation_denied") return "不能授予高于当前账号的权限，也不能修改自己的管理角色。";
  if (code === "staff_business_access_disabled") {
    return "当前站点尚未启用员工业务权限；关闭期间只能移除角色中已有的业务权限。";
  }
  if (code === "business_permission_strip_requires_separate_update") {
    return "移除全部员工业务权限时不能同时修改角色资料或看板范围，请分开保存。";
  }
  if (code === "invalid_role_board_access") return "看板访问范围无效，请重新选择后保存。";
  if (code === "role_board_access_in_use") return "该角色仍有员工负责新范围之外的未完成任务，请先调整负责人或任务。";
  if (code === "employee_board_access_in_use") return "该员工仍有新角色无法访问的未完成任务，请先调整负责人。";
  if (code === "employee_role_transition_required") {
    return "员工任务状态已变化，请重新加载后选择解除负责人或转交任务。";
  }
  if (code === "employee_role_transition_replacement_invalid") {
    return "接手员工当前不可用，或无权访问全部受影响看板。";
  }
  if (code === "employee_role_transition_scope_denied") {
    return "当前账号无权调整此次角色变更涉及的全部任务，请由企业负责人处理。";
  }
  if (code === "invalid_employee_role_transition") return "员工角色变更参数无效，请重新选择。";
  if (code === "task_assignee_board_access_denied") return "部分负责人无权访问当前看板，请调整角色范围或负责人。";
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
  if (code === "invalid_employee_email") return "请输入有效的员工邮箱地址。";
  if (code === "employee_email_in_use") return "该邮箱已存在于当前企业的员工列表中。";
  if (code === "employee_email_change_requires_reinvite") return "员工邮箱不能直接修改；请移除待接受账号后使用正确邮箱重新邀请。";
  if (code === "employee_email_already_registered") return "该邮箱已注册为其他 Faolla 身份，请使用独立的员工邮箱。";
  if (code === "employee_not_found") return "该员工记录已不存在，已为你重新加载。";
  if (code === "employee_invitation_cooldown") return "邀请刚刚发送过，请稍后再试。";
  if (code === "employee_invitation_not_accepted") return "员工尚未接受邀请，不能直接启用账号。";
  if (code === "employee_invitation_revoke_required") return "待接受账号请使用“撤销邀请”，不能直接停用。";
  if (code === "employee_open_tasks_require_resolution") {
    return "该员工仍负责未完成任务，请选择解除负责人或转交后再停用。";
  }
  if (code === "employee_offboarding_replacement_invalid") {
    return "接手员工当前不可用，或无权访问相关任务看板。";
  }
  if (code === "employee_offboarding_scope_denied") {
    return "当前账号无权调整该员工负责的全部任务，请由企业负责人处理。";
  }
  if (code === "employee_invitation_not_pending") return "邀请状态已变化，已为你重新加载。";
  if (code === "employee_invitation_revoked") return "该邀请已经撤销，请刷新后重新生成邀请。";
  if (code === "employee_invitation_expired") return "该邀请已经过期，请重新生成邀请。";
  if (code === "employee_invitation_superseded") return "邀请已被更新，请刷新后再试。";
  if (code === "employee_invitation_renew_required") {
    return "该邀请来自旧发送方式或已失效，请先撤销，再生成一封新邀请。";
  }
  if (code === "employee_invitation_renew_not_required") return "当前邀请仍然有效，请使用重发邀请。";
  if (code === "employee_invitation_in_use") return "该待接受账号仍关联任务，请先移除相关任务负责人后再移除邀请。";
  if (code === "unauthorized") return "登录状态已失效，请重新登录。";
  return fallback;
}

function readChecklistApiError(payload: unknown, fallback: string) {
  const code =
    payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "";
  if (code === "task_checklist_limit_reached") return "当前任务的清单项已达上限。";
  if (code === "task_checklist_item_not_found") return "该清单项已不存在，已为你重新加载。";
  if (code === "invalid_task_checklist_text") return "清单项需为 1–500 个字符。";
  if (code === "invalid_task_checklist_version") return "清单数据版本无效，已为你重新加载。";
  if (code === "invalid_task_archived") return "已归档任务不能修改清单。";
  if (code === "enterprise_operation_in_progress") return "操作正在处理中，请稍后重试。";
  return readApiError(payload, fallback);
}

type TaskDraft = {
  title: string;
  description: string;
  priority: MerchantTaskPriority;
  dueAt: string;
  columnId: string;
  assigneeIds: string[];
};

type EmployeeOffboardingMode = "unassign" | "reassign";
type EmployeeRoleTransitionMode = "unassign" | "reassign";

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
  canViewWorkflows,
  apiFetch,
  onSave,
  onArchive,
  onLoadEvents,
  onComment,
  onLoadChecklist,
  onCreateChecklistItem,
  onUpdateChecklistItem,
  onLoadLinkedOrderSummary,
  onOpenSourceOrder,
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
  canViewWorkflows: boolean;
  apiFetch: EnterpriseWorkflowApiFetch;
  onSave: (task: MerchantTask, draft: TaskDraft) => Promise<void>;
  onArchive: (task: MerchantTask, archived: boolean) => Promise<void>;
  onLoadEvents: (taskId: string, signal?: AbortSignal) => Promise<MerchantTaskEvent[]>;
  onComment: (
    task: MerchantTask,
    text: string,
    operationId: string,
  ) => Promise<MerchantTaskEvent>;
  onLoadChecklist: (
    taskId: string,
    signal?: AbortSignal,
  ) => Promise<MerchantTaskChecklistItem[]>;
  onCreateChecklistItem: (
    task: MerchantTask,
    text: string,
    operationId: string,
  ) => Promise<MerchantTaskChecklistItem>;
  onUpdateChecklistItem: (
    task: MerchantTask,
    item: MerchantTaskChecklistItem,
    change: TaskChecklistItemChange,
    operationId: string,
  ) => Promise<MerchantTaskChecklistItem>;
  onLoadLinkedOrderSummary?: (
    taskId: string,
    signal?: AbortSignal,
  ) => Promise<MerchantLinkedOrderSummary>;
  onOpenSourceOrder?: (orderId: string) => Promise<void> | void;
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
  const [checklistItems, setChecklistItems] = useState<MerchantTaskChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(true);
  const [checklistError, setChecklistError] = useState("");
  const [checklistNotice, setChecklistNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [checklistMutationId, setChecklistMutationId] = useState("");
  const [editingChecklistItemId, setEditingChecklistItemId] = useState("");
  const [editingChecklistText, setEditingChecklistText] = useState("");
  const [sourceOrderBusy, setSourceOrderBusy] = useState(false);
  const [sourceOrderError, setSourceOrderError] = useState("");
  const [linkedOrderSummary, setLinkedOrderSummary] =
    useState<MerchantLinkedOrderSummary | null>(null);
  const [linkedOrderSummaryBusy, setLinkedOrderSummaryBusy] = useState(false);
  const [linkedOrderSummaryError, setLinkedOrderSummaryError] = useState("");
  const linkedOrderSummaryAbortRef = useRef<AbortController | null>(null);
  const commentMutationRef = useRef<{ text: string; operationId: string } | null>(null);
  const checklistCreateMutationRef = useRef<{
    text: string;
    operationId: string;
  } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestCloseRef = useRef<() => void>(onClose);

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
      requestCloseRef.current();
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

  useEffect(() => {
    linkedOrderSummaryAbortRef.current?.abort();
    linkedOrderSummaryAbortRef.current = null;
    setLinkedOrderSummary(null);
    setLinkedOrderSummaryBusy(false);
    setLinkedOrderSummaryError("");
    return () => {
      linkedOrderSummaryAbortRef.current?.abort();
      linkedOrderSummaryAbortRef.current = null;
    };
  }, [task.id]);

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

  const refreshChecklist = useCallback(
    async (signal?: AbortSignal) => {
      setChecklistLoading(true);
      setChecklistError("");
      try {
        const items = await onLoadChecklist(task.id, signal);
        if (!signal?.aborted) setChecklistItems(items);
      } catch (error) {
        if (signal?.aborted) return;
        setChecklistError(
          error instanceof Error ? error.message : "任务清单加载失败，请稍后重试。",
        );
      } finally {
        if (!signal?.aborted) setChecklistLoading(false);
      }
    },
    [onLoadChecklist, task.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshChecklist(controller.signal);
    return () => controller.abort();
  }, [refreshChecklist]);

  function replaceChecklistItem(item: MerchantTaskChecklistItem) {
    setChecklistItems((current) => {
      if (item.archivedAt) return current.filter((candidate) => candidate.id !== item.id);
      const nextItems = current.some((candidate) => candidate.id === item.id)
        ? current.map((candidate) => (candidate.id === item.id ? item : candidate))
        : [...current, item];
      return nextItems.sort(
        (left, right) =>
          left.position - right.position ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    });
  }

  async function submitChecklistItem() {
    const text = checklistDraft.trim();
    if (!text || busy || checklistMutationId || task.archivedAt) return;
    if (checklistCreateMutationRef.current?.text !== text) {
      checklistCreateMutationRef.current = {
        text,
        operationId: createClientMutationOperationId("enterprise-task-checklist-create"),
      };
    }
    setChecklistMutationId("create");
    setChecklistNotice(null);
    try {
      const item = await onCreateChecklistItem(
        task,
        text,
        checklistCreateMutationRef.current.operationId,
      );
      replaceChecklistItem(item);
      setChecklistDraft("");
      setChecklistNotice({ kind: "success", text: "清单项已新增。" });
      checklistCreateMutationRef.current = null;
      await refreshEvents();
    } catch (error) {
      const text = error instanceof Error ? error.message : "清单项新增失败，请稍后重试。";
      setChecklistNotice({ kind: "error", text });
      if (text.includes("重新加载")) await refreshChecklist();
    } finally {
      setChecklistMutationId("");
    }
  }

  async function updateChecklistItem(
    item: MerchantTaskChecklistItem,
    change: TaskChecklistItemChange,
    success: string,
  ) {
    if (busy || checklistMutationId || task.archivedAt) return;
    setChecklistMutationId(item.id);
    setChecklistNotice(null);
    try {
      const updatedItem = await onUpdateChecklistItem(
        task,
        item,
        change,
        createClientMutationOperationId("enterprise-task-checklist-update"),
      );
      replaceChecklistItem(updatedItem);
      setEditingChecklistItemId("");
      setEditingChecklistText("");
      setChecklistNotice({ kind: "success", text: success });
      await refreshEvents();
    } catch (error) {
      const text = error instanceof Error ? error.message : "清单项保存失败，请稍后重试。";
      setChecklistNotice({ kind: "error", text });
      if (text.includes("重新加载")) await refreshChecklist();
    } finally {
      setChecklistMutationId("");
    }
  }

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
  const currentColumn = columns.find((column) => column.id === task.columnId);
  const taskCompleted = currentColumn ? currentColumn.isDone : Boolean(task.completedAt);
  const completionTransition = getMerchantTaskCompletionTransition(task, columns);
  const completionUnavailableMessage = task.archivedAt
    ? "已归档任务需先恢复，才能更改完成状态。"
    : !canUpdate
      ? "当前账号没有修改任务完成状态的权限。"
      : !currentColumn
        ? "任务所在工作列不可用，暂时不能切换完成状态。"
        : taskCompleted
          ? "当前看板没有可用的进行中工作列，请先在看板设置中配置。"
          : "当前看板没有可用的完成工作列，请先在看板设置中配置。";
  const completedChecklistItemCount = checklistItems.filter((item) => item.completed).length;
  const checklistProgress = checklistItems.length > 0
    ? Math.round((completedChecklistItemCount / checklistItems.length) * 100)
    : 0;
  const checklistAtLimit = checklistItems.length >= MAX_MERCHANT_TASK_CHECKLIST_ITEMS;
  const checklistBusy = busy || Boolean(checklistMutationId);
  const orderSource = getMerchantOrderTaskSource(task);
  const canViewLinkedOrderSummary = Boolean(
    orderSource &&
      actor.type === "employee" &&
      can(actor, "orders.linked.view") &&
      task.assigneeIds.includes(actor.id) &&
      onLoadLinkedOrderSummary,
  );
  const draftDueAtTimestamp = dueAt ? Date.parse(`${dueAt}T23:59:59`) : Number.NaN;
  const normalizedDraftDueAt =
    dueAt === taskDateInputValue(task.dueAt)
      ? task.dueAt
      : Number.isFinite(draftDueAtTimestamp)
        ? new Date(draftDueAtTimestamp).toISOString()
        : null;
  const taskDraftChanges = buildMerchantTaskEditChanges(
    actor,
    task,
    {
      title,
      description,
      priority,
      dueAt: normalizedDraftDueAt,
      columnId,
      assigneeIds,
    },
    employees,
  );
  const editedChecklistItem = checklistItems.find(
    (item) => item.id === editingChecklistItemId,
  );
  const hasUnsavedSourceExitDraft =
    (!taskDraftChanges.ok || Object.keys(taskDraftChanges.changes).length > 0) ||
    Boolean(commentText.trim()) ||
    Boolean(checklistDraft.trim()) ||
    Boolean(
      editedChecklistItem &&
      editingChecklistText.trim() !== editedChecklistItem.text,
    );

  function requestClose() {
    if (
      hasUnsavedSourceExitDraft &&
      typeof window !== "undefined" &&
      !window.confirm("当前任务有尚未保存的修改或输入。关闭任务详情将放弃这些内容，是否继续？")
    ) {
      return;
    }
    onClose();
  }
  requestCloseRef.current = requestClose;

  function taskEditorDraft(nextColumnId = columnId): TaskDraft {
    return {
      title,
      description,
      priority,
      dueAt,
      columnId: nextColumnId,
      assigneeIds,
    };
  }

  async function openSourceOrder() {
    if (!orderSource || !onOpenSourceOrder || sourceOrderBusy || checklistBusy || commentBusy) {
      return;
    }
    if (
      hasUnsavedSourceExitDraft &&
      typeof window !== "undefined" &&
      !window.confirm("当前任务有尚未保存的修改或输入。查看来源订单将离开任务详情，是否继续？")
    ) {
      return;
    }
    setSourceOrderBusy(true);
    setSourceOrderError("");
    try {
      await onOpenSourceOrder(orderSource.sourceId);
    } catch (error) {
      setSourceOrderError(
        error instanceof Error && error.message
          ? error.message
          : "来源订单读取失败，请稍后重试。",
      );
    } finally {
      setSourceOrderBusy(false);
    }
  }

  async function showLinkedOrderSummary() {
    if (
      !canViewLinkedOrderSummary ||
      !onLoadLinkedOrderSummary ||
      linkedOrderSummaryBusy
    ) {
      return;
    }
    linkedOrderSummaryAbortRef.current?.abort();
    const controller = new AbortController();
    linkedOrderSummaryAbortRef.current = controller;
    setLinkedOrderSummaryBusy(true);
    setLinkedOrderSummaryError("");
    try {
      const summary = await onLoadLinkedOrderSummary(task.id, controller.signal);
      if (!controller.signal.aborted) setLinkedOrderSummary(summary);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLinkedOrderSummaryError(
        error instanceof Error && error.message
          ? error.message
          : getMerchantLinkedOrderSummaryErrorMessage("linked_order_summary_failed"),
      );
    } finally {
      if (linkedOrderSummaryAbortRef.current === controller) {
        linkedOrderSummaryAbortRef.current = null;
        setLinkedOrderSummaryBusy(false);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-stretch justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) requestClose();
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
            onClick={requestClose}
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:mt-5 sm:block sm:overflow-visible sm:p-0">
          {orderSource ? (
            <section
              data-enterprise-task-order-source
              aria-label="来源订单"
              className="rounded-2xl border border-cyan-200 bg-cyan-50/80 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
                    来源订单
                  </div>
                  <div className="mt-1 break-all text-sm font-semibold text-cyan-950" data-no-translate="1">
                    #{orderSource.sourceId}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-cyan-800">
                    来源关联不可修改；编辑任务标题或说明不会改变原订单。
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {actor.type === "owner" && onOpenSourceOrder ? (
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-45 sm:min-h-0"
                      disabled={busy || sourceOrderBusy || checklistBusy || commentBusy}
                      onClick={() => void openSourceOrder()}
                    >
                      {sourceOrderBusy ? "读取中…" : "查看来源订单"}
                    </button>
                  ) : null}
                  {canViewLinkedOrderSummary ? (
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-cyan-300 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 disabled:opacity-45 sm:min-h-0"
                      disabled={busy || linkedOrderSummaryBusy}
                      onClick={() => void showLinkedOrderSummary()}
                    >
                      {linkedOrderSummaryBusy
                        ? "读取中…"
                        : linkedOrderSummary
                          ? "刷新订单摘要"
                          : "查看订单摘要"}
                    </button>
                  ) : null}
                </div>
              </div>
              {sourceOrderError ? (
                <div role="alert" className="mt-3 text-sm text-rose-700">
                  {sourceOrderError}
                </div>
              ) : null}
              {linkedOrderSummaryError ? (
                <div role="alert" className="mt-3 text-sm text-rose-700">
                  {linkedOrderSummaryError}
                </div>
              ) : null}
              {linkedOrderSummary ? (
                <div
                  data-enterprise-linked-order-summary
                  className="mt-4 rounded-xl border border-cyan-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-semibold text-slate-900">
                      {getMerchantOrderStatusLabel(linkedOrderSummary.status)} · {formatDateTime(linkedOrderSummary.createdAt)}
                    </span>
                    <span className="font-semibold text-cyan-800">
                      {linkedOrderSummary.totalQuantity} 件 · {formatMerchantOrderAmount(
                        linkedOrderSummary.totalAmount,
                        linkedOrderSummary.pricePrefix,
                      )}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {linkedOrderSummary.items.map((item, index) => (
                      <div
                        key={`${item.code}:${item.name}:${index}`}
                        className="rounded-lg bg-slate-50 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900">{item.name || item.code || "商品"}</div>
                            {item.code ? (
                              <div className="mt-0.5 text-xs text-slate-500" data-no-translate="1">
                                {item.code}
                              </div>
                            ) : null}
                            {item.specification ? (
                              <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                                {item.specification}
                              </div>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-right text-xs text-slate-600">
                            <div>{item.quantity} × {formatMerchantOrderAmount(item.unitPrice, linkedOrderSummary.pricePrefix)}</div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {formatMerchantOrderAmount(item.subtotal, linkedOrderSummary.pricePrefix)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
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

          <section
            aria-label="任务完成状态"
            className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
              taskCompleted
                ? "border-emerald-200 bg-emerald-50/70"
                : "border-blue-100 bg-blue-50/60"
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  taskCompleted
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-blue-100 text-blue-700"
                }`}>
                  {taskCompleted ? "已完成" : "进行中"}
                </span>
                <span className="text-sm font-semibold text-slate-900">任务状态</span>
              </div>
              {canUpdate && !task.archivedAt && completionTransition ? (
                <p className="mt-1.5 text-xs leading-5 text-slate-600">
                  {completionTransition.action === "complete" ? "完成后" : "重新打开后"}
                  将移至“{completionTransition.targetColumnName}”；上方尚未保存的修改会一并保存。
                </p>
              ) : (
                <p className="mt-1.5 text-xs leading-5 text-slate-600">
                  {completionUnavailableMessage}
                </p>
              )}
            </div>
            {canUpdate && !task.archivedAt && completionTransition ? (
              <button
                type="button"
                className={`min-h-11 shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-45 ${
                  completionTransition.action === "complete"
                    ? "bg-emerald-600"
                    : "bg-blue-600"
                }`}
                disabled={busy || !title.trim()}
                aria-label={`${
                  completionTransition.action === "complete" ? "完成任务" : "重新打开任务"
                }：${task.title}，移至${completionTransition.targetColumnName}`}
                onClick={() =>
                  void onSave(
                    task,
                    taskEditorDraft(completionTransition.targetColumnId),
                  )
                }
              >
                {completionTransition.action === "complete" ? "保存并完成" : "保存并重新打开"}
              </button>
            ) : null}
          </section>

          {canViewWorkflows ? (
            <MerchantTaskWorkflowBindingCard
              task={task}
              apiFetch={apiFetch}
              canBind={canUpdate}
              onChecklistChanged={async () => {
                await Promise.all([refreshChecklist(), refreshEvents()]);
              }}
            />
          ) : null}

          <section
            aria-labelledby="enterprise-task-checklist-title"
            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="enterprise-task-checklist-title" className="font-semibold text-slate-900">
                    任务清单
                  </h3>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {completedChecklistItemCount}/{checklistItems.length} 已完成
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">把任务拆成可逐项确认的小步骤。</p>
              </div>
              <button
                type="button"
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-45 sm:min-h-0"
                disabled={checklistLoading || checklistBusy}
                onClick={() => void refreshChecklist()}
              >
                {checklistLoading ? "刷新中…" : "刷新清单"}
              </button>
            </div>

            <div
              role="progressbar"
              aria-label="任务清单完成进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={checklistProgress}
              aria-valuetext={`${completedChecklistItemCount}/${checklistItems.length} 已完成`}
              className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${checklistProgress}%` }}
              />
            </div>

            {canUpdate && !task.archivedAt ? (
              <form
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitChecklistItem();
                }}
              >
                <label className="sr-only" htmlFor="enterprise-task-checklist-new-item">
                  新清单项
                </label>
                <input
                  id="enterprise-task-checklist-new-item"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                  value={checklistDraft}
                  maxLength={MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH}
                  placeholder="例如：联系供应商确认库存"
                  disabled={
                    checklistBusy || checklistLoading || Boolean(checklistError) || checklistAtLimit
                  }
                  onChange={(event) => {
                    setChecklistDraft(event.target.value);
                    setChecklistNotice(null);
                  }}
                />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                  disabled={
                    checklistBusy ||
                    checklistLoading ||
                    Boolean(checklistError) ||
                    checklistAtLimit ||
                    !checklistDraft.trim()
                  }
                >
                  {checklistMutationId === "create" ? "新增中…" : "新增清单项"}
                </button>
              </form>
            ) : (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                {task.archivedAt
                  ? "已归档任务保留清单，恢复任务后可继续修改。"
                  : "当前账号可查看任务清单，但没有修改权限。"}
              </div>
            )}

            {canUpdate && !task.archivedAt && checklistAtLimit ? (
              <div className="mt-2 text-xs text-amber-700">
                当前任务已达到 {MAX_MERCHANT_TASK_CHECKLIST_ITEMS} 个清单项上限。
              </div>
            ) : null}

            {checklistNotice ? (
              <div
                role={checklistNotice.kind === "error" ? "alert" : "status"}
                aria-live="polite"
                className={`mt-3 text-sm ${
                  checklistNotice.kind === "error" ? "text-rose-700" : "text-emerald-700"
                }`}
              >
                {checklistNotice.text}
              </div>
            ) : null}

            {checklistError ? (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {checklistError}
              </div>
            ) : null}

            <div className="mt-4">
              {checklistError && checklistItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  任务清单暂时不可用，请点击“刷新清单”重试。
                </div>
              ) : checklistLoading && checklistItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  正在加载任务清单…
                </div>
              ) : checklistItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                  暂无清单项{canUpdate && !task.archivedAt ? "，可在上方添加第一项。" : "。"}
                </div>
              ) : (
                <ul className="space-y-2">
                  {checklistItems.map((item) => {
                    const itemBusy = checklistMutationId === item.id;
                    const editing = editingChecklistItemId === item.id;
                    return (
                      <li
                        key={item.id}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        {editing ? (
                          <form
                            className="flex flex-col gap-2 sm:flex-row sm:items-center"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const text = editingChecklistText.trim();
                              if (!text || text === item.text) {
                                setEditingChecklistItemId("");
                                setEditingChecklistText("");
                                return;
                              }
                              void updateChecklistItem(item, { text }, "清单项名称已更新。");
                            }}
                          >
                            <label className="sr-only" htmlFor={`enterprise-checklist-edit-${item.id}`}>
                              修改清单项名称
                            </label>
                            <input
                              id={`enterprise-checklist-edit-${item.id}`}
                              className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                              value={editingChecklistText}
                              maxLength={MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH}
                              autoFocus
                              disabled={checklistBusy || Boolean(checklistError)}
                              onChange={(event) => setEditingChecklistText(event.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="min-h-11 flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-45 sm:flex-none"
                                disabled={
                                  checklistBusy ||
                                  Boolean(checklistError) ||
                                  !editingChecklistText.trim()
                                }
                              >
                                {itemBusy ? "保存中…" : "保存改名"}
                              </button>
                              <button
                                type="button"
                                className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45 sm:flex-none"
                                disabled={checklistBusy}
                                onClick={() => {
                                  setEditingChecklistItemId("");
                                  setEditingChecklistText("");
                                }}
                              >
                                取消
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            {canUpdate && !task.archivedAt ? (
                              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-1 text-sm text-slate-800">
                                <input
                                  type="checkbox"
                                  className="h-5 w-5 shrink-0 accent-emerald-600"
                                  checked={item.completed}
                                  disabled={checklistBusy || Boolean(checklistError)}
                                  aria-label={`${item.completed ? "恢复" : "完成"}清单项：${item.text}`}
                                  onChange={() =>
                                    void updateChecklistItem(
                                      item,
                                      { completed: !item.completed },
                                      item.completed ? "清单项已恢复。" : "清单项已完成。",
                                    )
                                  }
                                />
                                <span className={`min-w-0 break-words ${item.completed ? "text-slate-400 line-through" : ""}`}>
                                  {item.text}
                                </span>
                              </label>
                            ) : (
                              <div className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1 text-sm text-slate-800">
                                <span
                                  aria-hidden="true"
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                                    item.completed
                                      ? "border-emerald-500 bg-emerald-500 text-white"
                                      : "border-slate-300 bg-white"
                                  }`}
                                >
                                  {item.completed ? "✓" : ""}
                                </span>
                                <span className={`min-w-0 break-words ${item.completed ? "text-slate-400 line-through" : ""}`}>
                                  {item.text}
                                </span>
                              </div>
                            )}
                            {canUpdate && !task.archivedAt ? (
                              <div className="flex gap-2 sm:shrink-0">
                                {itemBusy ? (
                                  <span
                                    role="status"
                                    className="flex min-h-11 items-center rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"
                                  >
                                    保存中…
                                  </span>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className="min-h-11 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-45 sm:flex-none"
                                      disabled={checklistBusy || Boolean(checklistError)}
                                      aria-label={`修改清单项名称：${item.text}`}
                                      onClick={() => {
                                        setEditingChecklistItemId(item.id);
                                        setEditingChecklistText(item.text);
                                        setChecklistNotice(null);
                                      }}
                                    >
                                      改名
                                    </button>
                                    <button
                                      type="button"
                                      className="min-h-11 flex-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-45 sm:flex-none"
                                      disabled={checklistBusy || Boolean(checklistError)}
                                      aria-label={`移除清单项：${item.text}`}
                                      onClick={() => {
                                        if (!window.confirm(`确认移除清单项“${item.text}”吗？`)) return;
                                        void updateChecklistItem(item, { archived: true }, "清单项已移除。");
                                      }}
                                    >
                                      移除
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

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
              onClick={() => void onSave(task, taskEditorDraft())}
            >
              保存任务
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function EmployeeCurrentWorkDrawer({
  employee,
  roleName,
  state,
  onRetry,
  onOpenTask,
  onClose,
}: {
  employee: MerchantEnterpriseEmployee;
  roleName: string;
  state: CurrentOperationsViewState;
  onRetry: () => void;
  onOpenTask: (task: MerchantEnterpriseCurrentOperationsPriorityTask) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = drawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const activeElement = document.activeElement;
      if (!drawer.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const data = state.data;
  const sharedAssignmentTaskCount = data?.summary.sharedAssignmentTaskCount ?? null;

  return (
    <div
      className="fixed inset-0 z-[150] flex justify-end bg-slate-950/55 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        id="enterprise-employee-current-work-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-employee-current-work-title"
        aria-describedby="enterprise-employee-current-work-boundary"
        className="flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl"
      >
        <header className="shrink-0 border-b border-slate-200 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:px-6 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
                员工当前工作
              </div>
              <h2
                id="enterprise-employee-current-work-title"
                className="mt-1 !text-xl !font-bold !text-slate-950"
              >
                {employee.displayName}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {roleName || "未分配角色"} · {employee.status === "active" ? "在职" : employee.status === "disabled" ? "已停用" : "待接受邀请"}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
          <p
            id="enterprise-employee-current-work-boundary"
            className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900"
          >
            这是截至当前查询时点的任务库存，用于工作协调，不是绩效考核。多人负责的同一任务会出现在每位相关员工的视图中，因此不同员工之间、员工与企业之间的数字都不可相加。
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {state.status === "loading" ? (
            <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600" role="status">
              {data ? "正在更新当前工作…" : "正在读取当前工作…"}
            </div>
          ) : null}
          {state.status === "error" ? (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3" role="alert">
              <p className="text-sm leading-6 text-rose-700">{state.error}</p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white"
                onClick={onRetry}
              >
                重新读取
              </button>
            </div>
          ) : null}

          {!data && state.status === "loading" ? (
            <div className="animate-pulse space-y-4" aria-hidden="true">
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="h-24 rounded-2xl bg-slate-100" />
                ))}
              </div>
              <div className="h-44 rounded-2xl bg-slate-100" />
            </div>
          ) : null}

          {data ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>统计时点：{formatDateTime(data.asOf)}</span>
                {data.scopeRestricted ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
                    仅含当前账号有权查看的看板
                  </span>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "当前未完成", value: data.summary.openTaskCount, tone: "text-blue-700" },
                  { label: "当前逾期", value: data.summary.overdueTaskCount, tone: "text-rose-700" },
                  { label: "未来 7 天内到期", value: data.summary.dueSoonTaskCount, tone: "text-amber-700" },
                  { label: "当前涉及看板", value: data.summary.involvedBoardCount, tone: "text-violet-700" },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <dt className="text-xs leading-5 text-slate-500">{item.label}</dt>
                    <dd className={`mt-2 text-2xl font-bold ${item.tone}`}>{item.value}</dd>
                  </div>
                ))}
              </dl>

              {sharedAssignmentTaskCount !== null ? (
                <p className="rounded-2xl bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-800">
                  当前未完成任务中有 {sharedAssignmentTaskCount} 项由多人共同负责；该数字已包含在“当前未完成”中，不能再次相加。
                </p>
              ) : null}

              <section className="rounded-2xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-950">当前优先任务</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  最多显示 6 项，优先展示逾期、即将到期和最近更新的任务。
                </p>
                <div className="mt-3 divide-y divide-slate-100">
                  {data.priorityTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label={`打开任务：${task.title}，看板：${task.boardName}，工作列：${task.columnName}`}
                      onClick={() => onOpenTask(task)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">{task.title}</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {task.boardName} · {task.columnName}
                          {task.dueAt ? ` · 截止 ${formatDate(task.dueAt)}` : ""}
                          {task.assigneeCount > 1 ? ` · ${task.assigneeCount} 人协作` : ""}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${PRIORITY_META[task.priority].className}`}>
                        {PRIORITY_META[task.priority].label}
                      </span>
                    </button>
                  ))}
                  {data.priorityTasks.length === 0 ? (
                    <p className="py-7 text-center text-sm text-slate-500">当前没有未完成任务。</p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <h3 className="font-semibold text-slate-950">按看板查看当前任务</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {data.boards.map((board) => (
                    <div key={board.boardId} className="rounded-2xl bg-slate-50 px-4 py-3">
                      <div className="truncate text-sm font-semibold text-slate-900">{board.boardName}</div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                        <div><dt className="text-[11px] text-slate-500">未完成</dt><dd className="mt-1 font-bold text-blue-700">{board.openTaskCount}</dd></div>
                        <div><dt className="text-[11px] text-slate-500">逾期</dt><dd className="mt-1 font-bold text-rose-700">{board.overdueTaskCount}</dd></div>
                        <div><dt className="text-[11px] text-slate-500">7 日内</dt><dd className="mt-1 font-bold text-amber-700">{board.dueSoonTaskCount}</dd></div>
                      </dl>
                    </div>
                  ))}
                </div>
                {data.boards.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">当前没有涉及的启用看板。</p>
                ) : null}
                {data.boardsTruncated ? (
                  <p className="mt-3 text-xs leading-5 text-amber-700" role="status">
                    共有 {data.boardSummaryTotalCount} 个看板，本抽屉仅显示当前风险和未完成任务较多的前 {data.boards.length} 个；顶部统计仍为完整授权范围。
                  </p>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function EmployeeOffboardingDialog({
  employee,
  openTaskCount,
  taskCountExact,
  replacementCandidates,
  allowReassign,
  busy,
  errorMessage,
  onConfirm,
  onClose,
}: {
  employee: MerchantEnterpriseEmployee;
  openTaskCount: number;
  taskCountExact: boolean;
  replacementCandidates: Array<Pick<MerchantEnterpriseEmployee, "id" | "displayName">>;
  allowReassign: boolean;
  busy: boolean;
  errorMessage: string;
  onConfirm: (mode: EmployeeOffboardingMode, replacementEmployeeId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<EmployeeOffboardingMode>("unassign");
  const [replacementEmployeeId, setReplacementEmployeeId] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

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
      if (event.key !== "Escape" || busyRef.current) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  const replacementCandidateAvailable = replacementCandidates.some(
    (candidate) => candidate.id === replacementEmployeeId,
  );
  const knownTaskResolutionBlocked = !allowReassign && openTaskCount > 0;
  const canSubmit =
    !knownTaskResolutionBlocked &&
    (mode === "unassign" || (allowReassign && replacementCandidateAvailable));
  const taskSummary = taskCountExact
    ? openTaskCount > 0
      ? `该员工仍负责 ${openTaskCount} 个未完成任务。`
      : "该员工当前没有未完成任务。"
    : openTaskCount > 0
      ? `当前可见范围内有 ${openTaskCount} 个未完成任务；服务器还会检查全部任务。`
      : "服务器将在停用时检查该员工负责的全部未完成任务。";

  return (
    <div
      className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-employee-offboarding-title"
        aria-describedby="enterprise-employee-offboarding-summary"
        className="max-h-[calc(100dvh-1rem)] w-full max-w-xl rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl sm:p-6"
        style={{ overflowY: "auto" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="enterprise-employee-offboarding-title" className="!text-xl !font-bold !text-slate-950">
              安全停用员工
            </h2>
            <p
              id="enterprise-employee-offboarding-summary"
              className="mt-2 text-sm leading-6 text-slate-600"
            >
              将停用“{employee.displayName}”的企业账号。{taskSummary}
            </p>
          </div>
          <button
            ref={cancelButtonRef}
            type="button"
            className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
        </div>

        <fieldset className="mt-5 space-y-3" disabled={busy}>
          <legend className="text-sm font-semibold text-slate-900">未完成任务处理方式</legend>
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${
            mode === "unassign" ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
          }`}>
            <input
              type="radio"
              name="employee-offboarding-mode"
              value="unassign"
              checked={mode === "unassign"}
              onChange={() => setMode("unassign")}
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">解除该员工的负责人</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                未完成任务保留在原工作列，之后可重新分派。
              </span>
            </span>
          </label>
          <label className={`flex items-start gap-3 rounded-2xl border p-4 ${
            mode === "reassign" ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
          } ${allowReassign && replacementCandidates.length > 0 ? "cursor-pointer" : "opacity-60"}`}>
            <input
              type="radio"
              name="employee-offboarding-mode"
              value="reassign"
              checked={mode === "reassign"}
              disabled={!allowReassign || replacementCandidates.length === 0}
              onChange={() => setMode("reassign")}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">转交给另一名员工</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                接手员工必须处于启用状态，并有权访问全部相关看板。
              </span>
              {mode === "reassign" ? (
                <select
                  className="mt-3 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={replacementEmployeeId}
                  onChange={(event) => setReplacementEmployeeId(event.target.value)}
                >
                  <option value="">请选择接手员工</option>
                  {replacementCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
                  ))}
                </select>
              ) : null}
            </span>
          </label>
        </fieldset>

        {!allowReassign ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">
            当前账号没有任务分派权限；如该员工仍有未完成任务，需要由企业负责人或具有任务分派权限的员工处理。
          </p>
        ) : allowReassign && replacementCandidates.length === 0 ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">
            暂无能够访问全部相关看板的启用员工，只能解除负责人。
          </p>
        ) : null}

        {errorMessage ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
            disabled={busy}
            onClick={onClose}
          >
            返回员工列表
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            disabled={busy || !canSubmit}
            onClick={() => void onConfirm(mode, replacementEmployeeId)}
          >
            {busy ? "正在停用…" : mode === "reassign" ? "停用并转交任务" : "停用并解除负责人"}
          </button>
        </div>
      </section>
    </div>
  );
}

function EmployeeRoleTransitionDialog({
  employee,
  currentRole,
  targetRole,
  affectedTasks,
  affectedBoardNames,
  taskCountExact,
  replacementCandidates,
  allowTaskResolution,
  busy,
  errorMessage,
  onConfirm,
  onClose,
}: {
  employee: MerchantEnterpriseEmployee;
  currentRole: MerchantEnterpriseRole | null;
  targetRole: MerchantEnterpriseRole;
  affectedTasks: Array<Pick<MerchantTask, "id" | "title">>;
  affectedBoardNames: string[];
  taskCountExact: boolean;
  replacementCandidates: Array<Pick<MerchantEnterpriseEmployee, "id" | "displayName">>;
  allowTaskResolution: boolean;
  busy: boolean;
  errorMessage: string;
  onConfirm: (mode?: EmployeeRoleTransitionMode, replacementEmployeeId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<EmployeeRoleTransitionMode>("unassign");
  const [replacementEmployeeId, setReplacementEmployeeId] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

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
      if (event.key !== "Escape" || busyRef.current) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  const hasAffectedTasks = affectedTasks.length > 0;
  const replacementCandidateAvailable = replacementCandidates.some(
    (candidate) => candidate.id === replacementEmployeeId,
  );
  const canSubmit =
    !hasAffectedTasks ||
    (allowTaskResolution &&
      (mode === "unassign" || (mode === "reassign" && replacementCandidateAvailable)));
  const taskSummary = taskCountExact
    ? hasAffectedTasks
      ? `新角色无法访问该员工当前负责的 ${affectedTasks.length} 个未完成任务。`
      : "新角色与该员工当前负责的未完成任务兼容。"
    : hasAffectedTasks
      ? `当前可见范围内有 ${affectedTasks.length} 个任务受影响；服务器保存时还会复核全部任务。`
      : "当前可见范围内没有受影响任务；服务器保存时还会复核全部任务。";
  const targetScopeLabel =
    targetRole.accessScope === "all"
      ? "全部看板"
      : `指定看板 ${targetRole.allowedBoardIds.length} 个`;

  return (
    <div
      className="fixed inset-0 z-[145] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-employee-role-transition-title"
        aria-describedby="enterprise-employee-role-transition-summary"
        className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl sm:p-6"
        style={{ overflowY: "auto" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="enterprise-employee-role-transition-title" className="!text-xl !font-bold !text-slate-950">
              确认员工角色变更
            </h2>
            <p
              id="enterprise-employee-role-transition-summary"
              className="mt-2 text-sm leading-6 text-slate-600"
            >
              将“{employee.displayName}”从“{currentRole?.name || "未分配角色"}”调整为“{targetRole.name}”。{taskSummary}
            </p>
          </div>
          <button
            ref={cancelButtonRef}
            type="button"
            className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium text-slate-500">当前角色</div>
            <div className="mt-1 font-semibold text-slate-900">{currentRole?.name || "未分配角色"}</div>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-xs font-medium text-blue-600">目标角色</div>
            <div className="mt-1 font-semibold text-slate-900">{targetRole.name}</div>
            <div className="mt-1 text-xs text-slate-500">{targetScopeLabel}</div>
          </div>
        </div>

        {hasAffectedTasks ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">受影响的未完成任务</div>
            {affectedBoardNames.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {affectedBoardNames.map((boardName) => (
                  <span key={boardName} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-800">
                    {boardName}
                  </span>
                ))}
              </div>
            ) : null}
            <ul className="mt-3 space-y-1.5 text-xs leading-5 text-amber-900">
              {affectedTasks.slice(0, 5).map((task) => (
                <li key={task.id}>• {task.title}</li>
              ))}
              {affectedTasks.length > 5 ? <li>• 另有 {affectedTasks.length - 5} 个任务</li> : null}
            </ul>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            现有任务负责人无需调整，确认后只会更新员工角色。
          </div>
        )}

        {hasAffectedTasks ? (
          <fieldset className="mt-5 space-y-3" disabled={busy || !allowTaskResolution}>
            <legend className="text-sm font-semibold text-slate-900">受影响任务处理方式</legend>
            <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${
              mode === "unassign" ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
            }`}>
              <input
                type="radio"
                name="employee-role-transition-mode"
                value="unassign"
                checked={mode === "unassign"}
                onChange={() => setMode("unassign")}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">解除该员工的负责人</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  只从新角色无法访问的任务中移除该员工，其他任务和负责人保持不变。
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-3 rounded-2xl border p-4 ${
              mode === "reassign" ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
            } ${replacementCandidates.length > 0 ? "cursor-pointer" : "opacity-60"}`}>
              <input
                type="radio"
                name="employee-role-transition-mode"
                value="reassign"
                checked={mode === "reassign"}
                disabled={replacementCandidates.length === 0}
                onChange={() => setMode("reassign")}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">转交给另一名员工</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">
                  接手员工必须处于启用状态，并能访问全部受影响看板。
                </span>
                {mode === "reassign" ? (
                  <select
                    className="mt-3 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    value={replacementEmployeeId}
                    onChange={(event) => setReplacementEmployeeId(event.target.value)}
                  >
                    <option value="">请选择接手员工</option>
                    {replacementCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
                    ))}
                  </select>
                ) : null}
              </span>
            </label>
          </fieldset>
        ) : null}

        {hasAffectedTasks && !allowTaskResolution ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">
            当前账号没有任务分派权限，不能处理此次角色变更影响。请由企业负责人或具有任务分派权限的员工操作。
          </p>
        ) : hasAffectedTasks && replacementCandidates.length === 0 ? (
          <p className="mt-3 text-xs leading-5 text-amber-700">
            暂无能够访问全部受影响看板的启用员工，可选择解除负责人。
          </p>
        ) : null}

        {errorMessage ? (
          <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
            disabled={busy}
            onClick={onClose}
          >
            返回员工列表
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            disabled={busy || !canSubmit}
            onClick={() => void onConfirm(hasAffectedTasks ? mode : undefined, replacementEmployeeId)}
          >
            {busy
              ? "正在保存…"
              : hasAffectedTasks
                ? mode === "reassign"
                  ? "更换角色并转交任务"
                  : "更换角色并解除负责人"
                : "确认更换角色"}
          </button>
        </div>
      </section>
    </div>
  );
}

type RoleBoardAccessValue = Pick<
  MerchantEnterpriseRole,
  "accessScope" | "allowedBoardIds"
>;

function RoleBoardAccessEditor({
  idPrefix,
  accessScope,
  allowedBoardIds,
  boards,
  editable,
  canGrantAllBoards,
  onChange,
}: {
  idPrefix: string;
  accessScope: RoleBoardAccessValue["accessScope"];
  allowedBoardIds: readonly string[];
  boards: readonly MerchantTaskBoard[];
  editable: boolean;
  canGrantAllBoards: boolean;
  onChange: (value: RoleBoardAccessValue) => void;
}) {
  const descriptionId = `${idPrefix}-board-access-description`;
  const boardOptionsId = `${idPrefix}-board-access-options`;
  const selectedBoardIds = new Set(allowedBoardIds);
  const sortedBoards = [...boards].sort(
    (left, right) =>
      Number(left.status === "archived") - Number(right.status === "archived") ||
      left.position - right.position ||
      left.name.localeCompare(right.name),
  );
  const scopeSummary =
    accessScope === "all"
      ? "全部看板（包括以后新增的看板）"
      : allowedBoardIds.length > 0
        ? `指定 ${allowedBoardIds.length} 个看板`
        : "不访问任何看板";

  return (
    <fieldset
      className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50/40 p-4 disabled:opacity-70"
      disabled={!editable}
      aria-describedby={descriptionId}
    >
      <legend className="px-1 text-sm font-semibold text-slate-900">看板访问范围</legend>
      <p id={descriptionId} className="text-xs leading-5 text-slate-600">
        {scopeSummary}。访问范围控制任务数据；修改看板结构仍需“管理看板”权限。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label
          className={`flex min-h-11 items-start gap-2 rounded-xl border px-3 py-2 ${
            accessScope === "all"
              ? "border-cyan-300 bg-white"
              : "border-slate-200 bg-white/70"
          } ${editable && canGrantAllBoards ? "cursor-pointer" : ""}`}
        >
          <input
            type="radio"
            className="mt-0.5"
            name={`${idPrefix}-board-access-scope`}
            value="all"
            checked={accessScope === "all"}
            disabled={!editable || !canGrantAllBoards}
            onChange={() => onChange({ accessScope: "all", allowedBoardIds: [] })}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">全部看板</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
              自动包含当前及以后新增的看板。
            </span>
          </span>
        </label>
        <label
          className={`flex min-h-11 items-start gap-2 rounded-xl border px-3 py-2 ${
            accessScope === "restricted"
              ? "border-cyan-300 bg-white"
              : "border-slate-200 bg-white/70"
          } ${editable ? "cursor-pointer" : ""}`}
        >
          <input
            type="radio"
            className="mt-0.5"
            name={`${idPrefix}-board-access-scope`}
            value="restricted"
            checked={accessScope === "restricted"}
            disabled={!editable}
            onChange={() =>
              onChange({ accessScope: "restricted", allowedBoardIds: [...allowedBoardIds] })
            }
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">指定看板</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
              只允许访问下方勾选的看板。
            </span>
          </span>
        </label>
      </div>

      {!canGrantAllBoards && editable ? (
        <p className="mt-2 text-xs leading-5 text-amber-700">
          当前账号只能把自己可访问的指定看板授予该角色，不能授予全部看板。
        </p>
      ) : null}

      {accessScope === "restricted" ? (
        <div className="mt-3">
          <div
            id={boardOptionsId}
            role="group"
            aria-label="选择角色可以访问的看板"
            className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-2"
          >
            {sortedBoards.map((board) => {
              const checked = selectedBoardIds.has(board.id);
              return (
                <label
                  key={`${idPrefix}-${board.id}`}
                  className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    checked
                      ? "border-cyan-300 bg-cyan-50 text-cyan-950"
                      : "border-slate-200 bg-white text-slate-700"
                  } ${editable ? "cursor-pointer" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!editable}
                    onChange={(event) => {
                      const nextBoardIds = new Set(allowedBoardIds);
                      if (event.target.checked) nextBoardIds.add(board.id);
                      else nextBoardIds.delete(board.id);
                      onChange({
                        accessScope: "restricted",
                        allowedBoardIds: Array.from(nextBoardIds),
                      });
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{board.name}</span>
                  {board.status === "archived" ? (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      已归档
                    </span>
                  ) : null}
                </label>
              );
            })}
            {sortedBoards.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500 sm:col-span-2">当前没有可授权的看板。</p>
            ) : null}
          </div>
          {allowedBoardIds.length === 0 ? (
            <p className="mt-2 text-xs font-medium text-amber-700" role="status" aria-live="polite">
              未选择看板，该角色将无法访问任何任务看板。
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

const ROLE_PERMISSION_GROUP_ORDER = [
  "工作台",
  "任务",
  "订单",
  "员工",
  "角色",
  "流程",
  "审计",
  "积分兑换",
  "预约管理",
  "订单管理",
  "会话",
  "会员管理",
] as const;

type RolePermissionGroup = (typeof ROLE_PERMISSION_GROUP_ORDER)[number];

const ROLE_PERMISSION_GROUP_LABELS: Record<RolePermissionGroup, string> = {
  工作台: "工作台",
  任务: "任务与看板",
  订单: "任务关联订单",
  员工: "员工账号",
  角色: "角色权限",
  流程: "工作流程",
  审计: "审计记录",
  积分兑换: "积分兑换",
  预约管理: "预约管理",
  订单管理: "订单管理",
  会话: "会话",
  会员管理: "会员管理",
};

const ROLE_PERMISSION_SECTIONS: ReadonlyArray<{
  key: "collaboration" | "business";
  label: string;
  groups: readonly RolePermissionGroup[];
}> = [
  {
    key: "collaboration",
    label: "企业协作",
    groups: ["工作台", "任务", "订单", "员工", "角色", "流程", "审计"],
  },
  {
    key: "business",
    label: "业务菜单",
    groups: ["积分兑换", "预约管理", "订单管理", "会话", "会员管理"],
  },
];

type RolePermissionSelectionState = "empty" | "partial" | "complete";

function getRolePermissionSelectionState(
  selectedCount: number,
  totalCount: number,
): RolePermissionSelectionState {
  if (selectedCount === 0) return "empty";
  if (selectedCount === totalCount) return "complete";
  return "partial";
}

const ROLE_PERMISSION_SELECTION_LABELS: Record<RolePermissionSelectionState, string> = {
  empty: "未选择",
  partial: "已选",
  complete: "已全选",
};

function RolePermissionEditor({
  idPrefix,
  permissions,
  grantablePermissions,
  editable,
  onChange,
}: {
  idPrefix: string;
  permissions: readonly MerchantEnterprisePermission[];
  grantablePermissions: readonly MerchantEnterprisePermission[];
  editable: boolean;
  onChange: (permissions: MerchantEnterprisePermission[]) => void;
}) {
  const selected = new Set(permissions);
  const grantable = new Set(grantablePermissions);
  const [activeGroup, setActiveGroup] = useState<RolePermissionGroup>(
    ROLE_PERMISSION_GROUP_ORDER[0],
  );
  const [openDescriptionKey, setOpenDescriptionKey] =
    useState<MerchantEnterprisePermission | null>(null);
  const [pinnedDescriptionKey, setPinnedDescriptionKey] =
    useState<MerchantEnterprisePermission | null>(null);
  const groups = ROLE_PERMISSION_GROUP_ORDER.map((group) => ({
    group,
    permissions: MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter(
      (permission) => permission.group === group,
    ),
  })).filter((group) => group.permissions.length > 0);
  const activeGroupEntry = groups.find((entry) => entry.group === activeGroup) ?? groups[0];
  const configuredGroupCount = groups.filter((entry) =>
    entry.permissions.some((permission) => selected.has(permission.key)),
  ).length;

  if (!activeGroupEntry) return null;

  function toggleGroup(
    groupPermissions: typeof MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
    checked: boolean,
  ) {
    let next = [...permissions];
    groupPermissions.forEach((permission) => {
      if (!grantable.has(permission.key)) return;
      next = toggleMerchantEnterprisePermissionSelection(
        next,
        permission.key,
        checked,
      );
    });
    onChange(next);
  }

  return (
    <section className="mt-4" aria-label="功能权限">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">功能权限</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            先选择主要板块；悬停、聚焦或点击信息按钮可查看权限说明。
          </p>
        </div>
        <div
          className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-slate-600"
          data-role-permission-summary
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="font-semibold text-slate-700">已选权限</span>
          <strong className="text-base font-black tabular-nums text-blue-700">
            {permissions.length}
          </strong>
          <span className="font-semibold tabular-nums">
            / {MERCHANT_ENTERPRISE_PERMISSION_CATALOG.length} 项
          </span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span>已配置</span>
          <strong className="font-bold tabular-nums text-slate-900">
            {configuredGroupCount}
          </strong>
          <span className="tabular-nums">/ {groups.length} 个功能组</span>
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.7fr)]">
        <nav
          className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
          aria-label="权限主要板块"
        >
          {ROLE_PERMISSION_SECTIONS.map((section, sectionIndex) => {
            const sectionEntries = section.groups
              .map((group) => groups.find((entry) => entry.group === group))
              .filter((entry): entry is (typeof groups)[number] => Boolean(entry));
            const sectionPermissionCount = sectionEntries.reduce(
              (count, entry) => count + entry.permissions.length,
              0,
            );
            const sectionSelectedCount = sectionEntries.reduce(
              (count, entry) =>
                count +
                entry.permissions.filter((permission) => selected.has(permission.key)).length,
              0,
            );
            const sectionConfiguredGroupCount = sectionEntries.filter((entry) =>
              entry.permissions.some((permission) => selected.has(permission.key)),
            ).length;

            return (
              <div
                key={section.key}
                className={sectionIndex > 0 ? "mt-4" : ""}
                data-role-permission-section={section.key}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
                  <span className="text-xs font-bold text-slate-800">{section.label}</span>
                  <span className="h-px min-w-4 flex-1 bg-slate-200" aria-hidden="true" />
                  <span
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600"
                    data-role-permission-section-count
                    aria-label={`${section.label}已选 ${sectionSelectedCount} 项，共 ${sectionPermissionCount} 项；已配置 ${sectionConfiguredGroupCount} 个功能组，共 ${sectionEntries.length} 个`}
                  >
                    已选 <strong className="font-extrabold text-blue-700">{sectionSelectedCount}</strong>
                    /{sectionPermissionCount}
                    <span className="mx-1 text-slate-300" aria-hidden="true">·</span>
                    <strong className="font-extrabold text-slate-900">{sectionConfiguredGroupCount}</strong>
                    /{sectionEntries.length} 组
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {sectionEntries.map((entry) => {
                    const group = entry.group;
                    const selectedCount = entry.permissions.filter((permission) =>
                      selected.has(permission.key),
                    ).length;
                    const isActive = activeGroupEntry.group === group;
                    const selectionState = getRolePermissionSelectionState(
                      selectedCount,
                      entry.permissions.length,
                    );
                    const selectionLabel = ROLE_PERMISSION_SELECTION_LABELS[selectionState];
                    const selectionIcon =
                      selectionState === "complete"
                        ? "✓"
                        : selectionState === "partial"
                          ? "◐"
                          : "○";
                    const progressPercent =
                      entry.permissions.length > 0
                        ? Math.round((selectedCount / entry.permissions.length) * 100)
                        : 0;
                    return (
                      <button
                        key={`${idPrefix}-group-${group}`}
                        type="button"
                        className={`relative min-h-12 overflow-hidden rounded-xl border px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                          selectionState === "complete"
                            ? "border-emerald-300 bg-emerald-50/90 text-slate-800 hover:border-emerald-400 hover:shadow-sm"
                            : selectionState === "partial"
                              ? "border-blue-300 bg-blue-50/90 text-slate-800 hover:border-blue-400 hover:shadow-sm"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:shadow-sm"
                        } ${isActive ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                        aria-pressed={isActive}
                        aria-label={`${ROLE_PERMISSION_GROUP_LABELS[group]}，${selectionLabel} ${selectedCount} 项，共 ${entry.permissions.length} 项${isActive ? "，当前查看" : ""}`}
                        data-role-permission-selection={selectionState}
                        onClick={() => {
                          setActiveGroup(group);
                          setOpenDescriptionKey(null);
                          setPinnedDescriptionKey(null);
                        }}
                      >
                        <span className="flex min-w-0 items-start justify-between gap-1">
                          <span className="block min-w-0 truncate text-xs font-bold">
                            {ROLE_PERMISSION_GROUP_LABELS[group]}
                          </span>
                          {isActive ? (
                            <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-bold leading-3 text-white">
                              当前
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={`mt-0.5 flex items-baseline gap-1 text-xs font-semibold tabular-nums ${
                            selectionState === "complete"
                              ? "text-emerald-700"
                              : selectionState === "partial"
                                ? "text-blue-700"
                                : "text-slate-600"
                          }`}
                          data-role-permission-selection-count
                        >
                          <span aria-hidden="true">{selectionIcon}</span>
                          <span>{selectionLabel}</span>
                          <strong className="text-xs font-black">{selectedCount}</strong>
                          <span>/ {entry.permissions.length}</span>
                        </span>
                        <span
                          className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100"
                          data-role-permission-progress
                          aria-hidden="true"
                        >
                          <span
                            className={`block h-full transition-[width] duration-200 ${
                              selectionState === "complete" ? "bg-emerald-500" : "bg-blue-500"
                            }`}
                            style={{ width: `${progressPercent}%` }}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {(() => {
          const group = activeGroupEntry.group;
          const groupPermissions = activeGroupEntry.permissions;
          const isBusinessGroup = groupPermissions.some((permission) =>
            isMerchantStaffBusinessPermission(permission.key),
          );
          const grantableGroupPermissions = groupPermissions.filter((permission) =>
            grantable.has(permission.key),
          );
          const selectedCount = groupPermissions.filter((permission) =>
            selected.has(permission.key),
          ).length;
          const selectionState = getRolePermissionSelectionState(
            selectedCount,
            groupPermissions.length,
          );
          const selectionLabel = ROLE_PERMISSION_SELECTION_LABELS[selectionState];
          const allSelected =
            grantableGroupPermissions.length > 0 &&
            grantableGroupPermissions.every((permission) => selected.has(permission.key));

          return (
            <fieldset
              className={`min-w-0 rounded-2xl border p-3 ${
                isBusinessGroup
                  ? "border-blue-100 bg-blue-50/35"
                  : "border-slate-200 bg-white"
              }`}
              data-role-permission-group={group}
            >
              <legend className="sr-only">{ROLE_PERMISSION_GROUP_LABELS[group]}</legend>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    {ROLE_PERMISSION_GROUP_LABELS[group]}
                  </h4>
                  {isBusinessGroup ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                      业务菜单
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                      selectionState === "complete"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : selectionState === "partial"
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                    data-role-permission-group-summary={selectionState}
                  >
                    {selectionLabel} <strong className="font-black">{selectedCount}</strong>
                    / {groupPermissions.length}
                  </span>
                </div>
                <button
                  type="button"
                  className="min-h-9 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 disabled:opacity-45"
                  disabled={!editable || grantableGroupPermissions.length === 0}
                  onClick={() => toggleGroup(groupPermissions, !allSelected)}
                >
                  {allSelected ? "清空板块" : "全选板块"}
                </button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {groupPermissions.map((permission) => {
                  const checked = selected.has(permission.key);
                  const canGrant = grantable.has(permission.key);
                  const inputId = `${idPrefix}-${permission.key}`;
                  const descriptionId = `${inputId}-description`;
                  const descriptionOpen = openDescriptionKey === permission.key;
                  return (
                    <div
                      key={inputId}
                      className={`relative flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 ${
                        editable && canGrant
                          ? checked
                            ? "border-blue-200 bg-white"
                            : "border-slate-200 bg-white"
                          : "border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                      onPointerEnter={(event) => {
                        if (event.pointerType === "touch" || pinnedDescriptionKey) return;
                        setOpenDescriptionKey(permission.key);
                      }}
                      onPointerLeave={() => {
                        if (pinnedDescriptionKey === permission.key) return;
                        setOpenDescriptionKey((current) =>
                          current === permission.key ? null : current,
                        );
                      }}
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="shrink-0"
                        checked={checked}
                        disabled={!editable || !canGrant}
                        aria-describedby={descriptionId}
                        onChange={(event) =>
                          onChange(
                            toggleMerchantEnterprisePermissionSelection(
                              permissions,
                              permission.key,
                              event.target.checked,
                            ),
                          )
                        }
                      />
                      <label
                        htmlFor={inputId}
                        className={`min-w-0 flex-1 text-xs font-medium leading-5 ${
                          editable && canGrant ? "cursor-pointer text-slate-800" : "text-slate-500"
                        }`}
                      >
                        {permission.label}
                      </label>
                      {permission.risk === "high" ? (
                        <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold text-rose-700">
                          高风险
                        </span>
                      ) : permission.risk === "sensitive" ? (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                          敏感
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 hover:border-slate-300 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label={`查看“${permission.label}”权限说明`}
                        aria-expanded={descriptionOpen}
                        aria-controls={descriptionId}
                        aria-describedby={descriptionId}
                        onClick={(event) => {
                          const willClose = pinnedDescriptionKey === permission.key;
                          setPinnedDescriptionKey(willClose ? null : permission.key);
                          setOpenDescriptionKey(willClose ? null : permission.key);
                          if (willClose) event.currentTarget.blur();
                        }}
                        onFocus={() => setOpenDescriptionKey(permission.key)}
                        onBlur={() => {
                          setPinnedDescriptionKey((current) =>
                            current === permission.key ? null : current,
                          );
                          setOpenDescriptionKey((current) =>
                            current === permission.key ? null : current,
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          setOpenDescriptionKey(null);
                          event.currentTarget.blur();
                        }}
                      >
                        i
                      </button>
                      <span
                        id={descriptionId}
                        role="tooltip"
                        className={`pointer-events-none absolute left-2 right-2 top-[calc(100%+0.4rem)] z-30 w-auto rounded-xl bg-slate-950 px-3 py-2 text-[11px] font-normal leading-5 text-white shadow-xl transition-opacity sm:left-auto sm:right-2 sm:w-72 sm:max-w-[calc(100vw-3rem)] ${
                          descriptionOpen ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        {permission.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          );
        })()}
      </div>
    </section>
  );
}

function RoleEditor({
  role,
  boards,
  busy,
  editable,
  unavailableReason,
  grantablePermissions,
  canGrantAllBoards,
  expanded,
  onExpandedChange,
  onSave,
  onStatusChange,
  onDirtyChange,
}: {
  role: MerchantEnterpriseRole;
  boards: readonly MerchantTaskBoard[];
  busy: boolean;
  editable: boolean;
  unavailableReason?: string;
  grantablePermissions: readonly MerchantEnterprisePermission[];
  canGrantAllBoards: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSave: (
    role: MerchantEnterpriseRole,
    input: {
      name: string;
      description: string;
      permissions: MerchantEnterprisePermission[];
      accessScope: RoleBoardAccessValue["accessScope"];
      allowedBoardIds: string[];
    },
  ) => Promise<void>;
  onStatusChange: (role: MerchantEnterpriseRole, status: "active" | "archived") => Promise<void>;
  onDirtyChange: (roleId: string, dirty: boolean) => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [permissions, setPermissions] = useState<MerchantEnterprisePermission[]>(role.permissions);
  const [accessScope, setAccessScope] = useState(role.accessScope);
  const [allowedBoardIds, setAllowedBoardIds] = useState<string[]>(role.allowedBoardIds);
  const roleEditorIsDirty =
    name !== role.name ||
    description !== role.description ||
    !haveSameStringValues(permissions, role.permissions) ||
    accessScope !== role.accessScope ||
    !haveSameStringValues(allowedBoardIds, role.allowedBoardIds);
  const configuredGroupCount = new Set(
    MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter((permission) =>
      permissions.includes(permission.key),
    ).map((permission) => permission.group),
  ).size;
  const boardAccessSummary =
    accessScope === "all" ? "全部看板" : `${allowedBoardIds.length} 个指定看板`;
  const editorBodyId = `role-editor-${role.id}-body`;

  useEffect(() => {
    setName(role.name);
    setDescription(role.description);
    setPermissions(role.permissions);
    setAccessScope(role.accessScope);
    setAllowedBoardIds(role.allowedBoardIds);
  }, [role]);

  useEffect(() => {
    onDirtyChange(role.id, roleEditorIsDirty);
  }, [onDirtyChange, role.id, roleEditorIsDirty]);

  useEffect(
    () => () => {
      onDirtyChange(role.id, false);
    },
    [onDirtyChange, role.id],
  );

  return (
    <article className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        className="flex min-h-20 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 sm:px-5"
        aria-expanded={expanded}
        aria-controls={editorBodyId}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-semibold text-slate-950">{name || "未命名角色"}</span>
            {role.isSystem ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                系统角色
              </span>
            ) : null}
            {role.status === "archived" ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                已归档
              </span>
            ) : null}
            {roleEditorIsDirty ? (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                有未保存修改
              </span>
            ) : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-slate-500">
            <span>{permissions.length} 项权限 · {configuredGroupCount} 个功能组</span>
            <span>{boardAccessSummary}</span>
            {!editable && unavailableReason ? <span>{unavailableReason}</span> : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600">
          {expanded ? "收起" : editable ? "展开编辑" : "展开查看"}
          <span
            className={`text-lg leading-none transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ⌄
          </span>
        </span>
      </button>

      <div id={editorBodyId} hidden={!expanded} className="border-t border-slate-200 px-4 pb-5 pt-4 sm:px-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-600">
            角色名称
            <input
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              value={name}
              maxLength={80}
              disabled={!editable}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            角色说明
            <input
              className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              value={description}
              maxLength={1000}
              disabled={!editable}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <RoleBoardAccessEditor
          idPrefix={`role-${role.id}`}
          accessScope={accessScope}
          allowedBoardIds={allowedBoardIds}
          boards={boards}
          editable={editable}
          canGrantAllBoards={canGrantAllBoards}
          onChange={(value) => {
            setAccessScope(value.accessScope);
            setAllowedBoardIds(value.allowedBoardIds);
          }}
        />
        <RolePermissionEditor
          idPrefix={`role-${role.id}`}
          permissions={permissions}
          grantablePermissions={grantablePermissions}
          editable={editable}
          onChange={setPermissions}
        />
        {editable ? (
          <div className="mt-4 flex flex-wrap justify-between gap-3">
            {!role.isSystem ? (
              <button
                type="button"
                className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-45 ${
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
              className="min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
              disabled={busy || !name.trim()}
              onClick={() =>
                void onSave(role, {
                  name,
                  description,
                  permissions,
                  accessScope,
                  allowedBoardIds: accessScope === "all" ? [] : allowedBoardIds,
                })
              }
            >
              保存角色
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function BoardSettings({
  boards,
  columns,
  selectedBoardId,
  busy,
  canCreateBoard,
  onSelectBoard,
  onCreateBoard,
  onSaveBoard,
  onSetBoardStatus,
  onMoveBoard,
  onCreateColumn,
  onSaveColumn,
  onSetColumnStatus,
  onMoveColumn,
  onDirtyChange,
}: {
  boards: MerchantTaskBoard[];
  columns: MerchantTaskColumn[];
  selectedBoardId: string;
  busy: boolean;
  canCreateBoard: boolean;
  onSelectBoard: (
    boardId: string,
    options?: { discardCommittedNewBoardDraft?: boolean },
  ) => boolean;
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
  onDirtyChange: (dirty: boolean) => void;
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
  const [dirtyBoardIds, setDirtyBoardIds] = useState<Set<string>>(() => new Set());
  const [dirtyColumnIds, setDirtyColumnIds] = useState<Set<string>>(() => new Set());
  const newBoardHasDraft = Boolean(newBoardName || newBoardDescription);
  const newColumnHasDraft = Boolean(
    newColumnName || newColumnColor !== "#64748b" || newColumnIsDone,
  );
  const boardSettingsHasDraft = Boolean(
    newBoardHasDraft ||
      newColumnHasDraft ||
      dirtyBoardIds.size > 0 ||
      dirtyColumnIds.size > 0,
  );

  const handleBoardDirtyChange = useCallback((boardId: string, dirty: boolean) => {
    setDirtyBoardIds((current) => {
      if (current.has(boardId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(boardId);
      else next.delete(boardId);
      return next;
    });
  }, []);
  const handleColumnDirtyChange = useCallback((columnId: string, dirty: boolean) => {
    setDirtyColumnIds((current) => {
      if (current.has(columnId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(columnId);
      else next.delete(columnId);
      return next;
    });
  }, []);

  useEffect(() => {
    onDirtyChange(boardSettingsHasDraft);
  }, [boardSettingsHasDraft, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange(false);
    },
    [onDirtyChange],
  );

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
          {canCreateBoard ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto]">
                <input
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="新看板名称"
                  aria-label="新看板名称"
                  maxLength={120}
                  value={newBoardName}
                  onChange={(event) => setNewBoardName(event.target.value)}
                />
                <input
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="看板说明（可选）"
                  aria-label="新看板说明"
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
                      const hasOtherDrafts =
                        newColumnHasDraft ||
                        dirtyBoardIds.size > 0 ||
                        dirtyColumnIds.size > 0;
                      setNewBoardName("");
                      setNewBoardDescription("");
                      onSelectBoard(created.id, {
                        discardCommittedNewBoardDraft: !hasOtherDrafts,
                      });
                    });
                  }}
                >
                  新建看板
                </button>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              当前账号只能访问指定看板，不能新建看板；仍可维护下方已有看板及其工作列。
            </p>
          )}

          <div className="space-y-2">
            {sortedBoards.map((board) => {
              const activeIndex = activeBoardOrder.findIndex((item) => item.id === board.id);
              return (
                <BoardSettingsRow
                  key={JSON.stringify([board.id, board.name, board.description])}
                  board={board}
                  selected={selectedBoard?.id === board.id}
                  busy={busy}
                  activeIndex={activeIndex}
                  activeCount={activeBoardOrder.length}
                  onSelect={onSelectBoard}
                  onSave={onSaveBoard}
                  onStatus={onSetBoardStatus}
                  onMove={onMoveBoard}
                  onDirtyChange={handleBoardDirtyChange}
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
                      key={JSON.stringify([
                        column.id,
                        column.name,
                        column.color,
                        column.isDone,
                      ])}
                      column={column}
                      busy={busy}
                      activeIndex={activeIndex}
                      activeCount={activeColumnOrder.length}
                      onSave={onSaveColumn}
                      onStatus={onSetColumnStatus}
                      onMove={onMoveColumn}
                      onDirtyChange={handleColumnDirtyChange}
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
  onDirtyChange,
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
  onDirtyChange: (boardId: string, dirty: boolean) => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const boardRowIsDirty = name !== board.name || description !== board.description;

  useEffect(() => {
    onDirtyChange(board.id, boardRowIsDirty);
  }, [board.id, boardRowIsDirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange(board.id, false);
    },
    [board.id, onDirtyChange],
  );

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
  onDirtyChange,
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
  onDirtyChange: (columnId: string, dirty: boolean) => void;
}) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color);
  const [isDone, setIsDone] = useState(column.isDone);
  const columnRowIsDirty =
    name !== column.name || color !== column.color || isDone !== column.isDone;

  useEffect(() => {
    onDirtyChange(column.id, columnRowIsDirty);
  }, [column.id, columnRowIsDirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange(column.id, false);
    },
    [column.id, onDirtyChange],
  );

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
  collaborationRefreshIntervalMs,
  navigation,
  taskDraftIntent = null,
  onTaskDraftIntentHandled,
  onOpenSourceOrder,
  onTodoCountChange,
  registerLeaveGuard,
}: MerchantEnterpriseManagerProps) {
  const resolvedCollaborationRefreshIntervalMs = normalizeCollaborationRefreshInterval(
    collaborationRefreshIntervalMs,
  );
  const collaborationStaleAfterMs =
    resolvedCollaborationRefreshIntervalMs * MERCHANT_ENTERPRISE_STALE_INTERVAL_MULTIPLIER;
  const [internalView, setInternalView] = useState<MerchantEnterpriseView>("overview");
  const [actor, setActor] = useState<MerchantEnterpriseActor | null>(null);
  const actorAuthorizationFingerprint = actor
    ? buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint(actor)
    : "";
  const actorCanViewTasks = can(actor, "tasks.view");
  const actorCanViewEmployees = can(actor, "employees.view");
  const [snapshot, setSnapshot] = useState<MerchantEnterpriseSnapshot>(EMPTY_SNAPSHOT);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [overviewRefreshing, setOverviewRefreshing] = useState(false);
  const [overviewCurrentOperations, setOverviewCurrentOperations] =
    useState<CurrentOperationsViewState>(EMPTY_CURRENT_OPERATIONS_STATE);
  const [lastSyncedAtMs, setLastSyncedAtMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState("");
  const overviewRequestSequenceRef = useRef(0);
  const overviewAbortControllerRef = useRef<AbortController | null>(null);
  const silentOverviewRequestRef = useRef<AbortController | null>(null);
  const currentOperationsSiteRef = useRef(siteId);
  currentOperationsSiteRef.current = siteId;
  const currentOperationsActorAuthorizationFingerprintRef = useRef(
    actorAuthorizationFingerprint,
  );
  currentOperationsActorAuthorizationFingerprintRef.current =
    actorAuthorizationFingerprint;
  const overviewCurrentOperationsGenerationRef = useRef(0);
  const overviewCurrentOperationsAbortRef = useRef<AbortController | null>(null);
  const employeeCurrentWorkGenerationRef = useRef(0);
  const employeeCurrentWorkAbortRef = useRef<AbortController | null>(null);
  const canAutoRefreshOnFocusRef = useRef(false);
  const lastSyncedAtRef = useRef(0);
  const defaultTaskAssigneeScopeRef = useRef("");
  const defaultRoleBoardAccessActorRef = useRef("");
  const handledTaskDraftIntentRef = useRef("");
  const taskCreateMutationRef = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const employeeInviteMutationRef = useRef<{
    fingerprint: string;
    operationId: string;
  } | null>(null);
  const employeeInvitationDeliveryMutationRef = useRef<{
    fingerprint: string;
    operationId: string;
  } | null>(null);
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
  const commitViewChange = useCallback(
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
  const [taskSource, setTaskSource] = useState<{
    sourceType: "order";
    sourceId: string;
  } | null>(null);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<MerchantTaskPriority | "all">("all");
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState("all");
  const [taskArchiveView, setTaskArchiveView] = useState<"active" | "archived">("active");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [showBoardSettings, setShowBoardSettings] = useState(false);
  const [boardSettingsHasDraft, setBoardSettingsHasDraft] = useState(false);
  const [boardSettingsResetVersion, setBoardSettingsResetVersion] = useState(0);
  const [mobileTaskComposerOpen, setMobileTaskComposerOpen] = useState(false);
  const [overviewNowMs, setOverviewNowMs] = useState(() => Date.now());

  const [employeeName, setEmployeeName] = useState("");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeRoleId, setEmployeeRoleId] = useState("");
  const [currentWorkEmployeeId, setCurrentWorkEmployeeId] = useState("");
  const [employeeCurrentWork, setEmployeeCurrentWork] =
    useState<CurrentOperationsViewState>(EMPTY_CURRENT_OPERATIONS_STATE);
  const currentWorkEmployeeIdRef = useRef(currentWorkEmployeeId);
  currentWorkEmployeeIdRef.current = currentWorkEmployeeId;
  const [managedEmployeeProfileId, setManagedEmployeeProfileId] = useState("");
  const [managedEmployeeProfileName, setManagedEmployeeProfileName] = useState("");
  const [managedEmployeeProfileVersion, setManagedEmployeeProfileVersion] = useState(0);
  const [managedInvitationEmployeeId, setManagedInvitationEmployeeId] = useState("");
  const [managedInvitationName, setManagedInvitationName] = useState("");
  const [managedInvitationRoleId, setManagedInvitationRoleId] = useState("");
  const [offboardingEmployeeId, setOffboardingEmployeeId] = useState("");
  const [roleTransitionRequest, setRoleTransitionRequest] = useState<{
    employeeId: string;
    targetRoleId: string;
  } | null>(null);
  const employeeInviteFormRef = useRef<HTMLElement | null>(null);
  const employeeEmailInputRef = useRef<HTMLInputElement | null>(null);
  const [failedInvitationEmployeeIds, setFailedInvitationEmployeeIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [roleName, setRoleName] = useState("");
  const [roleDescription, setRoleDescription] = useState("");
  const [rolePermissions, setRolePermissions] = useState<MerchantEnterprisePermission[]>([
    "enterprise.view",
  ]);
  const [roleAccessScope, setRoleAccessScope] = useState<RoleBoardAccessValue["accessScope"]>("all");
  const [roleAllowedBoardIds, setRoleAllowedBoardIds] = useState<string[]>([]);
  const [dirtyRoleIds, setDirtyRoleIds] = useState<Set<string>>(() => new Set());
  const [newRoleEditorOpen, setNewRoleEditorOpen] = useState(false);
  const [expandedRoleId, setExpandedRoleId] = useState("");
  const [workflowHasDraft, setWorkflowHasDraft] = useState(false);
  const [automationHasDraft, setAutomationHasDraft] = useState(false);
  const [workflowFocusRequest, setWorkflowFocusRequest] = useState<{
    workflowId: string;
    executionId?: string;
    requestId: number;
  } | null>(null);
  const workflowFocusSequenceRef = useRef(0);
  const workflowFocusResolverRef = useRef<{
    requestId: number;
    timeoutId: number;
    resolve: (opened: boolean) => void;
  } | null>(null);

  const handleRoleEditorDirtyChange = useCallback((roleId: string, dirty: boolean) => {
    setDirtyRoleIds((current) => {
      const hasRole = current.has(roleId);
      if (hasRole === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(roleId);
      else next.delete(roleId);
      return next;
    });
  }, []);

  const handleBoardSettingsDirtyChange = useCallback((dirty: boolean) => {
    setBoardSettingsHasDraft(dirty);
  }, []);

  const discardBoardSettingsDrafts = useCallback(() => {
    setBoardSettingsHasDraft(false);
    setBoardSettingsResetVersion((current) => current + 1);
  }, []);

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      if (accessToken) headers.set("x-merchant-access-token", accessToken);
      const requestController = new AbortController();
      const callerSignal = init.signal;
      let timedOut = false;
      const abortFromCaller = () => requestController.abort(callerSignal?.reason);
      if (callerSignal?.aborted) abortFromCaller();
      else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
      const timeoutId = setTimeout(() => {
        timedOut = true;
        requestController.abort();
      }, MERCHANT_ENTERPRISE_REQUEST_TIMEOUT_MS);
      try {
        return await fetch(path, {
          ...init,
          headers,
          credentials: accessToken ? "omit" : "include",
          cache: "no-store",
          signal: requestController.signal,
        });
      } catch (error) {
        if (timedOut) throw new Error("请求超时，请检查网络后重试。");
        throw error;
      } finally {
        clearTimeout(timeoutId);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      }
    },
    [accessToken],
  );

  const fetchCurrentOperations = useCallback(
    async (
      input: {
        employeeId: string | null;
        expectedScope: "enterprise" | "employee";
      },
      signal: AbortSignal,
    ) => {
      const params = new URLSearchParams({ siteId });
      if (input.employeeId) params.set("employeeId", input.employeeId);
      const response = await apiFetch(
        `/api/merchant-enterprise/current-operations?${params.toString()}`,
        { signal },
      );
      const rawPayload = await response.json().catch(() => null);
      const payload = normalizeMerchantEnterpriseCurrentOperations(rawPayload);
      if (!response.ok || !payload) {
        throw new CurrentOperationsRequestError(
          readApiError(rawPayload, "当前运营数据读取失败，请稍后重试。"),
          readApiErrorCode(rawPayload),
          readCurrentOperationsAuthorizationFingerprint(rawPayload),
        );
      }
      if (
        payload.scope !== input.expectedScope ||
        payload.employeeId !== input.employeeId
      ) {
        throw new Error("当前运营数据范围不一致，请重新读取。");
      }
      return payload;
    },
    [apiFetch, siteId],
  );

  const loadOverviewCurrentOperations = useCallback(
    async (requestActor: MerchantEnterpriseActor) => {
      const requestSiteId = siteId;
      const requestActorAuthorizationFingerprint =
        buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint(requestActor);
      const employeeId = requestActor.type === "employee" ? requestActor.id : null;
      const expectedScope = employeeId ? "employee" as const : "enterprise" as const;
      const requestKey = buildMerchantEnterpriseCurrentOperationsRequestKey({
        siteId: requestSiteId,
        actorAuthorizationFingerprint: requestActorAuthorizationFingerprint,
        scope: expectedScope,
        employeeId,
      });
      const generation = overviewCurrentOperationsGenerationRef.current + 1;
      overviewCurrentOperationsGenerationRef.current = generation;
      overviewCurrentOperationsAbortRef.current?.abort();
      const controller = new AbortController();
      overviewCurrentOperationsAbortRef.current = controller;
      setOverviewCurrentOperations((current) => ({
        requestKey,
        status: "loading",
        data: current.requestKey === requestKey ? current.data : null,
        error: "",
        errorCode: "",
        authorizationFingerprint: "",
      }));
      try {
        const payload = await fetchCurrentOperations(
          { employeeId, expectedScope },
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          generation !== overviewCurrentOperationsGenerationRef.current ||
          currentOperationsSiteRef.current !== requestSiteId ||
          currentOperationsActorAuthorizationFingerprintRef.current !==
            requestActorAuthorizationFingerprint
        ) {
          return false;
        }
        setOverviewCurrentOperations({
          requestKey,
          status: "ready",
          data: payload,
          error: "",
          errorCode: "",
          authorizationFingerprint: "",
        });
        return true;
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== overviewCurrentOperationsGenerationRef.current ||
          currentOperationsSiteRef.current !== requestSiteId ||
          currentOperationsActorAuthorizationFingerprintRef.current !==
            requestActorAuthorizationFingerprint
        ) {
          return false;
        }
        setOverviewCurrentOperations((current) => ({
          requestKey,
          status: "error",
          data: current.requestKey === requestKey ? current.data : null,
          error:
            error instanceof Error
              ? error.message
              : "当前运营数据读取失败，请稍后重试。",
          errorCode:
            error instanceof CurrentOperationsRequestError ? error.code : "",
          authorizationFingerprint:
            error instanceof CurrentOperationsRequestError
              ? error.authorizationFingerprint
              : "",
        }));
        return false;
      } finally {
        if (overviewCurrentOperationsAbortRef.current === controller) {
          overviewCurrentOperationsAbortRef.current = null;
        }
      }
    },
    [fetchCurrentOperations, siteId],
  );

  const loadEmployeeCurrentWork = useCallback(
    async (employeeId: string) => {
      const requestSiteId = siteId;
      const requestActorAuthorizationFingerprint = actorAuthorizationFingerprint;
      const requestKey = buildMerchantEnterpriseCurrentOperationsRequestKey({
        siteId: requestSiteId,
        actorAuthorizationFingerprint: requestActorAuthorizationFingerprint,
        scope: "employee",
        employeeId,
      });
      const generation = employeeCurrentWorkGenerationRef.current + 1;
      employeeCurrentWorkGenerationRef.current = generation;
      employeeCurrentWorkAbortRef.current?.abort();
      const controller = new AbortController();
      employeeCurrentWorkAbortRef.current = controller;
      setEmployeeCurrentWork((current) => ({
        requestKey,
        status: "loading",
        data: current.requestKey === requestKey ? current.data : null,
        error: "",
        errorCode: "",
        authorizationFingerprint: "",
      }));
      try {
        const payload = await fetchCurrentOperations(
          { employeeId, expectedScope: "employee" },
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          generation !== employeeCurrentWorkGenerationRef.current ||
          currentOperationsSiteRef.current !== requestSiteId ||
          currentOperationsActorAuthorizationFingerprintRef.current !==
            requestActorAuthorizationFingerprint ||
          currentWorkEmployeeIdRef.current !== employeeId
        ) {
          return false;
        }
        setEmployeeCurrentWork({
          requestKey,
          status: "ready",
          data: payload,
          error: "",
          errorCode: "",
          authorizationFingerprint: "",
        });
        return true;
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== employeeCurrentWorkGenerationRef.current ||
          currentOperationsSiteRef.current !== requestSiteId ||
          currentOperationsActorAuthorizationFingerprintRef.current !==
            requestActorAuthorizationFingerprint ||
          currentWorkEmployeeIdRef.current !== employeeId
        ) {
          return false;
        }
        setEmployeeCurrentWork((current) => ({
          requestKey,
          status: "error",
          data: current.requestKey === requestKey ? current.data : null,
          error:
            error instanceof Error
              ? error.message
              : "员工当前工作读取失败，请稍后重试。",
          errorCode:
            error instanceof CurrentOperationsRequestError ? error.code : "",
          authorizationFingerprint:
            error instanceof CurrentOperationsRequestError
              ? error.authorizationFingerprint
              : "",
        }));
        return false;
      } finally {
        if (employeeCurrentWorkAbortRef.current === controller) {
          employeeCurrentWorkAbortRef.current = null;
        }
      }
    },
    [actorAuthorizationFingerprint, fetchCurrentOperations, siteId],
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

  const loadTaskChecklist = useCallback(
    async (taskId: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({ siteId, taskId });
      const response = await apiFetch(
        `/api/merchant-enterprise/task-checklist?${params.toString()}`,
        { signal },
      );
      const payload = (await response.json().catch(() => null)) as TaskChecklistPayload | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.items)) {
        throw new Error(readChecklistApiError(payload, "任务清单加载失败，请稍后重试。"));
      }
      return payload.items;
    },
    [apiFetch, siteId],
  );

  const loadLinkedOrderSummary = useCallback(
    async (taskId: string, signal?: AbortSignal) => {
      const params = new URLSearchParams({ siteId, taskId });
      const response = await apiFetch(
        `/api/merchant-enterprise/linked-order-summary?${params.toString()}`,
        { signal },
      );
      const payload = (await response.json().catch(() => null)) as
        | LinkedOrderSummaryPayload
        | null;
      if (!response.ok || !payload?.ok || !payload.summary) {
        throw new Error(
          getMerchantLinkedOrderSummaryErrorMessage(payload?.error),
        );
      }
      return payload.summary;
    },
    [apiFetch, siteId],
  );

  const createTaskChecklistItem = useCallback(
    async (task: MerchantTask, text: string, operationId: string) => {
      const response = await apiFetch("/api/merchant-enterprise/task-checklist", {
        method: "POST",
        body: JSON.stringify({
          siteId,
          taskId: task.id,
          text,
          operationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TaskChecklistPayload | null;
      if (!response.ok || !payload?.ok || !payload.item) {
        throw new Error(readChecklistApiError(payload, "清单项新增失败，请稍后重试。"));
      }
      return payload.item;
    },
    [apiFetch, siteId],
  );

  const updateTaskChecklistItem = useCallback(
    async (
      task: MerchantTask,
      item: MerchantTaskChecklistItem,
      change: TaskChecklistItemChange,
      operationId: string,
    ) => {
      const response = await apiFetch("/api/merchant-enterprise/task-checklist", {
        method: "PATCH",
        body: JSON.stringify({
          siteId,
          taskId: task.id,
          itemId: item.id,
          version: item.version,
          ...change,
          operationId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TaskChecklistPayload | null;
      if (!response.ok || !payload?.ok || !payload.item) {
        throw new Error(readChecklistApiError(payload, "清单项保存失败，请稍后重试。"));
      }
      return payload.item;
    },
    [apiFetch, siteId],
  );

  const loadOverview = useCallback(async (
    options: { preserveData?: boolean; silent?: boolean } = {},
  ) => {
    const preserveData = options.preserveData === true;
    const silent = options.silent === true;
    const requestSequence = overviewRequestSequenceRef.current + 1;
    overviewRequestSequenceRef.current = requestSequence;
    const previousController = overviewAbortControllerRef.current;
    previousController?.abort();
    if (silentOverviewRequestRef.current === previousController) {
      silentOverviewRequestRef.current = null;
    }
    overviewAbortControllerRef.current = null;
    setOverviewRefreshing(preserveData);
    if (!preserveData) {
      setActor(null);
      setSnapshot(EMPTY_SNAPSHOT);
      setNeedsBootstrap(false);
      setMessage(null);
    }

    if (!/^\d{8}$/.test(siteId)) {
      if (!silent) setMessage({ kind: "error", text: "缺少有效的商户编号。" });
      setLoading(false);
      if (preserveData) setOverviewRefreshing(false);
      return false;
    }

    const controller = new AbortController();
    overviewAbortControllerRef.current = controller;
    if (silent) silentOverviewRequestRef.current = controller;
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
      if (silent && !canAutoRefreshOnFocusRef.current) return false;
      if (!response.ok || !payload?.ok || !payload.actor || !payload.snapshot) {
        throw new Error(readApiError(payload, "企业管理加载失败。"));
      }
      setActor(payload.actor);
      setSnapshot(payload.snapshot);
      setNeedsBootstrap(payload.needsBootstrap === true);
      const syncedAt = Date.now();
      lastSyncedAtRef.current = syncedAt;
      setLastSyncedAtMs(syncedAt);
      setOverviewNowMs(syncedAt);
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
      if (!silent) {
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "企业管理加载失败。",
        });
      }
      return false;
    } finally {
      if (
        !controller.signal.aborted &&
        requestSequence === overviewRequestSequenceRef.current
      ) {
        if (overviewAbortControllerRef.current === controller) {
          overviewAbortControllerRef.current = null;
        }
        if (silentOverviewRequestRef.current === controller) {
          silentOverviewRequestRef.current = null;
        }
        if (!preserveData) setLoading(false);
        if (preserveData) setOverviewRefreshing(false);
      }
    }
  }, [apiFetch, siteId]);

  const refreshOverview = useCallback(async () => {
    if (overviewAbortControllerRef.current) return;
    if (
      !canAutoRefreshOnFocusRef.current &&
      !window.confirm("当前页面可能包含未保存的编辑。刷新将放弃这些修改，是否继续？")
    ) {
      return;
    }
    const refreshed = await loadOverview({ preserveData: true });
    if (refreshed) {
      setMessage({ kind: "success", text: "已同步最新协作数据。" });
    }
  }, [loadOverview]);

  useEffect(() => {
    void loadOverview();
    return () => {
      overviewRequestSequenceRef.current += 1;
      overviewAbortControllerRef.current?.abort();
      overviewAbortControllerRef.current = null;
      silentOverviewRequestRef.current = null;
      overviewCurrentOperationsGenerationRef.current += 1;
      overviewCurrentOperationsAbortRef.current?.abort();
      overviewCurrentOperationsAbortRef.current = null;
      employeeCurrentWorkGenerationRef.current += 1;
      employeeCurrentWorkAbortRef.current?.abort();
      employeeCurrentWorkAbortRef.current = null;
    };
  }, [loadOverview]);

  useEffect(() => {
    if (
      !actor ||
      needsBootstrap ||
      lastSyncedAtMs <= 0 ||
      !actorCanViewTasks
    ) {
      overviewCurrentOperationsGenerationRef.current += 1;
      overviewCurrentOperationsAbortRef.current?.abort();
      overviewCurrentOperationsAbortRef.current = null;
      setOverviewCurrentOperations(EMPTY_CURRENT_OPERATIONS_STATE);
      return;
    }
    void loadOverviewCurrentOperations(actor);
  }, [
    actor,
    actorAuthorizationFingerprint,
    actorCanViewTasks,
    lastSyncedAtMs,
    loadOverviewCurrentOperations,
    needsBootstrap,
  ]);

  useEffect(() => {
    if (!currentWorkEmployeeId) return;
    employeeCurrentWorkGenerationRef.current += 1;
    employeeCurrentWorkAbortRef.current?.abort();
    employeeCurrentWorkAbortRef.current = null;
    setEmployeeCurrentWork(EMPTY_CURRENT_OPERATIONS_STATE);
    if (!actor || !actorCanViewTasks || !actorCanViewEmployees) {
      currentWorkEmployeeIdRef.current = "";
      setCurrentWorkEmployeeId("");
      return;
    }
    currentWorkEmployeeIdRef.current = currentWorkEmployeeId;
    void loadEmployeeCurrentWork(currentWorkEmployeeId);
  }, [
    actor,
    actorAuthorizationFingerprint,
    actorCanViewEmployees,
    actorCanViewTasks,
    currentWorkEmployeeId,
    loadEmployeeCurrentWork,
  ]);

  useEffect(() => {
    if (
      !actor ||
      needsBootstrap ||
      !onTodoCountChange ||
      lastSyncedAtMs <= 0
    ) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({
          siteId,
          category: "all",
          limit: "1",
        });
        const response = await apiFetch(
          `/api/merchant-enterprise/todos?${params.toString()}`,
          { signal: controller.signal },
        );
        const payload = await response.json().catch(() => null);
        const page = normalizeMerchantEnterpriseTodoPage(payload);
        if (
          !controller.signal.aborted &&
          response.ok &&
          page?.merchantId === siteId
        ) {
          onTodoCountChange(page.counts.openCount);
        }
      } catch {
        // The badge is supplementary; the todo page exposes its own retry state.
      }
    })();
    return () => controller.abort();
  }, [actor, apiFetch, lastSyncedAtMs, needsBootstrap, onTodoCountChange, siteId]);

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setOverviewNowMs(Date.now()),
      resolvedCollaborationRefreshIntervalMs,
    );
    return () => window.clearInterval(intervalId);
  }, [resolvedCollaborationRefreshIntervalMs]);

  useEffect(() => {
    if (!actor) return;
    const scopeKey = `${actor.type}:${actor.id}`;
    if (defaultTaskAssigneeScopeRef.current === scopeKey) return;
    defaultTaskAssigneeScopeRef.current = scopeKey;
    setTaskAssigneeFilter(getMerchantEnterpriseDefaultTaskAssigneeFilter(actor));
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    const actorKey = `${actor.type}:${actor.id}`;
    if (defaultRoleBoardAccessActorRef.current === actorKey) return;
    defaultRoleBoardAccessActorRef.current = actorKey;
    const defaultAccess = getMerchantEnterpriseDefaultRoleBoardAccess(actor);
    setRoleAccessScope(defaultAccess.accessScope);
    setRoleAllowedBoardIds([...defaultAccess.allowedBoardIds]);
  }, [actor]);

  const taskComposerHasDraft =
    Boolean(taskTitle.trim()) ||
    Boolean(taskDescription.trim()) ||
    Boolean(taskDueAt) ||
    taskPriority !== "normal" ||
    taskAssigneeIds.length > 0 ||
    Boolean(taskSource);
  const employeeInviteHasDraft =
    Boolean(employeeName.trim()) || Boolean(employeeEmail.trim()) || Boolean(employeeRoleId);
  const defaultRoleBoardAccess = actor
    ? getMerchantEnterpriseDefaultRoleBoardAccess(actor)
    : { accessScope: "all" as const, allowedBoardIds: [] as string[] };
  const roleComposerHasDraft =
    Boolean(roleName.trim()) ||
    Boolean(roleDescription.trim()) ||
    !haveSameStringValues(rolePermissions, ["enterprise.view"]) ||
    roleAccessScope !== defaultRoleBoardAccess.accessScope ||
    !haveSameStringValues(roleAllowedBoardIds, defaultRoleBoardAccess.allowedBoardIds);
  const canAutoRefreshOnFocus = Boolean(
    actor &&
      !busy &&
      !editingTaskId &&
      !offboardingEmployeeId &&
      !roleTransitionRequest &&
      !draggingTaskId &&
      (tab === "overview" ||
        tab === "todos" ||
        tab === "audit" ||
        (tab === "automations" && !automationHasDraft) ||
        (tab === "workflows" && !workflowHasDraft) ||
        (tab === "tasks" &&
          !showBoardSettings &&
          !mobileTaskComposerOpen &&
          !taskComposerHasDraft) ||
        (tab === "employees" &&
          !employeeInviteHasDraft &&
          !currentWorkEmployeeId &&
          !managedEmployeeProfileId &&
          !managedInvitationEmployeeId) ||
        (tab === "roles" && !roleComposerHasDraft && dirtyRoleIds.size === 0)),
  );
  canAutoRefreshOnFocusRef.current = canAutoRefreshOnFocus;
  useEffect(() => {
    if (canAutoRefreshOnFocus) return;
    const controller = silentOverviewRequestRef.current;
    if (!controller) return;
    controller.abort();
    silentOverviewRequestRef.current = null;
    if (overviewAbortControllerRef.current === controller) {
      overviewAbortControllerRef.current = null;
    }
    overviewRequestSequenceRef.current += 1;
    setOverviewRefreshing(false);
  }, [canAutoRefreshOnFocus]);
  useEffect(() => {
    const refreshIfStale = () => {
      if (
        !canAutoRefreshOnFocus ||
        document.visibilityState !== "visible" ||
        overviewAbortControllerRef.current ||
        Date.now() - lastSyncedAtRef.current <
          resolvedCollaborationRefreshIntervalMs
      ) {
        return;
      }
      void loadOverview({ preserveData: true, silent: true });
    };
    refreshIfStale();
    const intervalId = window.setInterval(
      refreshIfStale,
      resolvedCollaborationRefreshIntervalMs,
    );
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [canAutoRefreshOnFocus, loadOverview, resolvedCollaborationRefreshIntervalMs]);
  const enterpriseDataIsStale =
    lastSyncedAtMs > 0 && overviewNowMs - lastSyncedAtMs >= collaborationStaleAfterMs;
  const enterpriseAutoRefreshPaused = Boolean(actor && !canAutoRefreshOnFocus);

  const confirmViewChange = useCallback(
    (view: MerchantEnterpriseView | null) => {
      if (view !== null && view === tab) return true;
      if (busy) {
        setMessage({ kind: "info", text: "当前操作正在保存，请完成后再切换功能。" });
        return false;
      }
      if (
        actor &&
        !canAutoRefreshOnFocus &&
        !window.confirm("当前页面有未保存的内容。切换功能将放弃这些修改，是否继续？")
      ) {
        return false;
      }
      if (view !== "tasks") {
        setEditingTaskId("");
        setDraggingTaskId("");
        setShowBoardSettings(false);
        setMobileTaskComposerOpen(false);
      }
      if (view !== "employees") {
        currentWorkEmployeeIdRef.current = "";
        employeeCurrentWorkGenerationRef.current += 1;
        employeeCurrentWorkAbortRef.current?.abort();
        employeeCurrentWorkAbortRef.current = null;
        setCurrentWorkEmployeeId("");
        setEmployeeCurrentWork(EMPTY_CURRENT_OPERATIONS_STATE);
      }
      return true;
    },
    [actor, busy, canAutoRefreshOnFocus, tab],
  );
  const requestViewChange = useCallback(
    (view: MerchantEnterpriseView) => {
      if (!confirmViewChange(view)) return false;
      commitViewChange(view);
      return true;
    },
    [commitViewChange, confirmViewChange],
  );
  const settleWorkflowFocusRequest = useCallback(
    (requestId: number, opened: boolean) => {
      const pending = workflowFocusResolverRef.current;
      if (!pending || pending.requestId !== requestId) return;
      workflowFocusResolverRef.current = null;
      window.clearTimeout(pending.timeoutId);
      setWorkflowFocusRequest((current) =>
        current?.requestId === requestId ? null : current,
      );
      pending.resolve(opened);
    },
    [],
  );
  const openWorkflowFromNotification = useCallback(
    (workflowId: string, executionId?: string): Promise<boolean> => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workflowId)) {
        return Promise.resolve(false);
      }
      if (
        executionId &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(executionId)
      ) {
        return Promise.resolve(false);
      }
      if (
        tab === "workflows" &&
        workflowHasDraft &&
        !window.confirm("当前流程有尚未保存的修改。打开通知中的流程将放弃这些修改，是否继续？")
      ) {
        return Promise.resolve(false);
      }
      if (!requestViewChange("workflows")) return Promise.resolve(false);
      const previousRequest = workflowFocusResolverRef.current;
      if (previousRequest) {
        settleWorkflowFocusRequest(previousRequest.requestId, false);
      }
      workflowFocusSequenceRef.current += 1;
      const requestId = workflowFocusSequenceRef.current;
      return new Promise<boolean>((resolve) => {
        const timeoutId = window.setTimeout(() => {
          settleWorkflowFocusRequest(requestId, false);
        }, MERCHANT_ENTERPRISE_WORKFLOW_FOCUS_TIMEOUT_MS);
        workflowFocusResolverRef.current = { requestId, timeoutId, resolve };
        setWorkflowFocusRequest({ workflowId, ...(executionId ? { executionId } : {}), requestId });
      });
    },
    [requestViewChange, settleWorkflowFocusRequest, tab, workflowHasDraft],
  );
  const handleWorkflowFocusHandled = useCallback(
    (requestId: number, opened: boolean = false) => {
      settleWorkflowFocusRequest(requestId, opened);
    },
    [settleWorkflowFocusRequest],
  );

  useEffect(() => {
    if (tab === "workflows") return;
    const pending = workflowFocusResolverRef.current;
    if (pending) settleWorkflowFocusRequest(pending.requestId, false);
  }, [settleWorkflowFocusRequest, tab]);

  useEffect(() => {
    return () => {
      const pending = workflowFocusResolverRef.current;
      if (!pending) return;
      workflowFocusResolverRef.current = null;
      window.clearTimeout(pending.timeoutId);
      pending.resolve(false);
    };
  }, []);

  useEffect(() => {
    if (!usesExternalNavigation || !navigation?.registerViewChangeGuard) return;
    navigation.registerViewChangeGuard(confirmViewChange);
    return () => navigation.registerViewChangeGuard?.(null);
  }, [confirmViewChange, navigation, usesExternalNavigation]);

  useEffect(() => {
    if (!registerLeaveGuard) return;
    registerLeaveGuard(() => confirmViewChange(null));
    return () => registerLeaveGuard(null);
  }, [confirmViewChange, registerLeaveGuard]);

  useEffect(() => {
    if (!actor || canAutoRefreshOnFocus) return;
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedUnload);
    return () => window.removeEventListener("beforeunload", preventUnsavedUnload);
  }, [actor, canAutoRefreshOnFocus]);

  useEffect(() => {
    if (!actor) return;
    if (requestedView !== tab) commitViewChange(tab);
  }, [actor, commitViewChange, requestedView, tab]);

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
  const canGrantAllBoards = actor
    ? merchantEnterpriseBoardAccessFitsActor(actor, {
        accessScope: "all",
        allowedBoardIds: [],
      })
    : false;
  const canCreateBoards = canCreateMerchantEnterpriseBoards(actor);
  const assignableRoles = actor
    ? activeRoles.filter((role) => merchantEnterpriseRoleFitsActor(actor, role))
    : [];
  useEffect(() => {
    if (
      !actor ||
      merchantEnterpriseBoardAccessFitsActor(actor, {
        accessScope: roleAccessScope,
        allowedBoardIds: roleAccessScope === "all" ? [] : roleAllowedBoardIds,
      })
    ) {
      return;
    }
    const defaultAccess = getMerchantEnterpriseDefaultRoleBoardAccess(actor);
    setRoleAccessScope(defaultAccess.accessScope);
    setRoleAllowedBoardIds([...defaultAccess.allowedBoardIds]);
  }, [actor, roleAccessScope, roleAllowedBoardIds]);
  const activeEmployees = snapshot.employees.filter((employee) => employee.status === "active");
  const activeBoards = snapshot.boards.filter((board) => board.status === "active");
  const activeBoard =
    activeBoards.find((board) => board.id === selectedBoardId) ??
    activeBoards[0] ??
    null;

  function confirmBoardSettingsDraftDiscard(messageText: string) {
    return (
      !boardSettingsHasDraft ||
      typeof window === "undefined" ||
      window.confirm(messageText)
    );
  }

  function requestBoardSelection(
    boardId: string,
    options: { discardCommittedNewBoardDraft?: boolean } = {},
  ) {
    if (!boardId || boardId === activeBoard?.id) return true;
    if (busy) {
      setMessage({ kind: "info", text: "当前操作正在保存，请完成后再切换看板。" });
      return false;
    }
    if (
      showBoardSettings &&
      boardSettingsHasDraft &&
      !options.discardCommittedNewBoardDraft &&
      !confirmBoardSettingsDraftDiscard(
        "看板设置中有尚未保存的内容。切换看板将放弃这些修改，是否继续？",
      )
    ) {
      return false;
    }
    if (showBoardSettings && boardSettingsHasDraft) {
      discardBoardSettingsDrafts();
    }
    setSelectedBoardId(boardId);
    return true;
  }

  function toggleBoardSettingsVisibility() {
    if (!showBoardSettings) {
      setShowBoardSettings(true);
      return;
    }
    if (busy) {
      setMessage({ kind: "info", text: "当前操作正在保存，请完成后再收起看板设置。" });
      return;
    }
    if (
      !confirmBoardSettingsDraftDiscard(
        "看板设置中有尚未保存的内容。收起设置将放弃这些修改，是否继续？",
      )
    ) {
      return;
    }
    if (boardSettingsHasDraft) discardBoardSettingsDrafts();
    setShowBoardSettings(false);
  }

  async function setBoardStatusWithDraftGuard(
    board: MerchantTaskBoard,
    status: "active" | "archived",
  ) {
    if (
      status === "archived" &&
      board.id === activeBoard?.id &&
      boardSettingsHasDraft
    ) {
      if (
        !confirmBoardSettingsDraftDiscard(
          "看板设置中有尚未保存的内容。归档当前看板将放弃这些修改，是否继续？",
        )
      ) {
        return;
      }
      discardBoardSettingsDrafts();
    }
    await setBoardStatus(board, status);
  }

  useEffect(() => {
    const resolvedBoardId = activeBoard?.id ?? "";
    if (selectedBoardId !== resolvedBoardId) setSelectedBoardId(resolvedBoardId);
  }, [activeBoard?.id, selectedBoardId]);
  const activeColumns = snapshot.columns
    .filter((column) => column.status === "active" && column.boardId === activeBoard?.id)
    .sort((left, right) => left.position - right.position);
  useEffect(() => {
    if (loading || !actor || !taskDraftIntent) return;
    if (handledTaskDraftIntentRef.current === taskDraftIntent.requestId) return;

    handledTaskDraftIntentRef.current = taskDraftIntent.requestId;
    const acknowledgeIntent = () => {
      onTaskDraftIntentHandled?.(taskDraftIntent.requestId);
    };

    if (
      taskDraftIntent.siteId !== siteId ||
      taskDraftIntent.sourceType !== "order" ||
      !taskDraftIntent.sourceId.trim()
    ) {
      setMessage({ kind: "error", text: "订单任务来源无效，请返回订单详情后重试。" });
      acknowledgeIntent();
      return;
    }

    const existingTask = snapshot.tasks.find(
      (task) =>
        task.sourceType === taskDraftIntent.sourceType &&
        task.sourceId === taskDraftIntent.sourceId,
    );
    if (existingTask) {
      setSelectedBoardId(existingTask.boardId);
      setTaskQuery("");
      setTaskPriorityFilter("all");
      setTaskAssigneeFilter("all");
      setTaskArchiveView(existingTask.archivedAt ? "archived" : "active");
      setTaskSource(null);
      setMobileTaskComposerOpen(false);
      commitViewChange("tasks");
      setEditingTaskId(existingTask.id);
      setMessage({ kind: "info", text: "该订单已有企业任务，已为你打开。" });
      acknowledgeIntent();
      return;
    }

    if (actor.type !== "owner" || !can(actor, "tasks.create")) {
      setMessage({ kind: "error", text: "仅企业负责人可从订单创建企业任务。" });
      acknowledgeIntent();
      return;
    }

    const boardForDraft =
      activeBoards.find(
        (board) =>
          board.id === selectedBoardId &&
          snapshot.columns.some(
            (column) => column.boardId === board.id && column.status === "active",
          ),
      ) ??
      activeBoards.find((board) =>
        snapshot.columns.some(
          (column) => column.boardId === board.id && column.status === "active",
        ),
      );
    if (!boardForDraft) {
      setMessage({
        kind: "error",
        text: needsBootstrap
          ? "请先初始化企业工作区，再从订单创建任务。"
          : "请先准备一个启用中的看板和工作列。",
      });
      acknowledgeIntent();
      return;
    }

    setSelectedBoardId(boardForDraft.id);
    setTaskQuery("");
    setTaskPriorityFilter("all");
    setTaskAssigneeFilter("all");
    setTaskArchiveView("active");
    setEditingTaskId("");
    setTaskTitle(taskDraftIntent.title);
    setTaskDescription(taskDraftIntent.description);
    setTaskPriority(taskDraftIntent.priority);
    setTaskDueAt("");
    setTaskAssigneeIds([]);
    setTaskSource({
      sourceType: taskDraftIntent.sourceType,
      sourceId: taskDraftIntent.sourceId,
    });
    setMobileTaskComposerOpen(true);
    commitViewChange("tasks");
    setMessage({ kind: "info", text: "已从订单预填任务，请确认后创建。" });
    acknowledgeIntent();
  }, [
    activeBoards,
    actor,
    loading,
    needsBootstrap,
    onTaskDraftIntentHandled,
    commitViewChange,
    selectedBoardId,
    siteId,
    snapshot.columns,
    snapshot.tasks,
    taskDraftIntent,
  ]);
  const boardTasks = snapshot.tasks.filter((task) => task.boardId === activeBoard?.id);
  const visibleTasks = filterMerchantTasks(boardTasks, { archive: "active" });
  const overviewExpectedEmployeeId = actor?.type === "employee" ? actor.id : null;
  const overviewExpectedScope = overviewExpectedEmployeeId ? "employee" as const : "enterprise" as const;
  const overviewExpectedRequestKey = actor
    ? buildMerchantEnterpriseCurrentOperationsRequestKey({
        siteId,
        actorAuthorizationFingerprint,
        scope: overviewExpectedScope,
        employeeId: overviewExpectedEmployeeId,
      })
    : "";
  const visibleOverviewCurrentOperations =
    overviewCurrentOperations.requestKey === overviewExpectedRequestKey
      ? overviewCurrentOperations
      : {
          requestKey: overviewExpectedRequestKey,
          status: "loading" as const,
          data: null,
          error: "",
          errorCode: "",
          authorizationFingerprint: "",
        };
  const overviewOperationsFallback = useMemo(() => {
    if (
      !actor ||
      lastSyncedAtMs <= 0 ||
      visibleOverviewCurrentOperations.status !== "error" ||
      visibleOverviewCurrentOperations.errorCode !==
        "enterprise_schema_unavailable" ||
      visibleOverviewCurrentOperations.authorizationFingerprint !==
        actorAuthorizationFingerprint
    ) {
      return null;
    }
    return buildMerchantEnterpriseCurrentOperationsFallback(
      {
        actor,
        boards: snapshot.boards,
        columns: snapshot.columns,
        tasks: snapshot.tasks,
      },
      lastSyncedAtMs,
    );
  }, [
    actor,
    actorAuthorizationFingerprint,
    lastSyncedAtMs,
    snapshot.boards,
    snapshot.columns,
    snapshot.tasks,
    visibleOverviewCurrentOperations.errorCode,
    visibleOverviewCurrentOperations.authorizationFingerprint,
    visibleOverviewCurrentOperations.status,
  ]);
  const overviewUsingRolloutFallback =
    !visibleOverviewCurrentOperations.data && Boolean(overviewOperationsFallback);
  const overviewOperationsData =
    visibleOverviewCurrentOperations.data ?? overviewOperationsFallback;
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
  function openTaskBoardFromOverview() {
    setTaskQuery("");
    setTaskPriorityFilter("all");
    setTaskArchiveView("active");
    setTaskAssigneeFilter(
      actor ? getMerchantEnterpriseDefaultTaskAssigneeFilter(actor) : "all",
    );
    commitViewChange("tasks");
  }
  function openTaskFromOverview(task: MerchantTask) {
    if (busy) {
      setMessage({ kind: "info", text: "当前操作正在保存，请完成后再打开其他任务。" });
      return false;
    }
    if (
      editingTaskId !== task.id &&
      !canAutoRefreshOnFocus &&
      !window.confirm("当前页面有未保存的内容。打开其他任务将放弃这些修改，是否继续？")
    ) {
      return false;
    }
    setSelectedBoardId(task.boardId);
    setTaskQuery("");
    setTaskPriorityFilter("all");
    setTaskArchiveView("active");
    setTaskAssigneeFilter(
      actor ? getMerchantEnterpriseDefaultTaskAssigneeFilter(actor) : "all",
    );
    commitViewChange("tasks");
    setEditingTaskId(task.id);
    return true;
  }

  function openTaskById(taskId: string) {
    const task = snapshotRef.current.tasks.find((item) => item.id === taskId);
    if (task) {
      openTaskFromOverview(task);
      return;
    }
    setMessage({ kind: "info", text: "正在同步这项任务的最新数据…" });
    void loadOverview({ preserveData: true }).then((refreshed) => {
      if (!refreshed) return;
      window.requestAnimationFrame(() => {
        const refreshedTask = snapshotRef.current.tasks.find((item) => item.id === taskId);
        if (refreshedTask) {
          openTaskFromOverview(refreshedTask);
          return;
        }
        setMessage({ kind: "info", text: "该任务已完成、归档或当前账号已无权访问。" });
      });
    });
  }

  function openEmployeeCurrentWork(employee: MerchantEnterpriseEmployee) {
    currentWorkEmployeeIdRef.current = employee.id;
    setCurrentWorkEmployeeId(employee.id);
    setEmployeeCurrentWork(EMPTY_CURRENT_OPERATIONS_STATE);
  }

  function closeEmployeeCurrentWork() {
    currentWorkEmployeeIdRef.current = "";
    employeeCurrentWorkGenerationRef.current += 1;
    employeeCurrentWorkAbortRef.current?.abort();
    employeeCurrentWorkAbortRef.current = null;
    setCurrentWorkEmployeeId("");
    setEmployeeCurrentWork(EMPTY_CURRENT_OPERATIONS_STATE);
  }

  function openTaskFromEmployeeCurrentWork(
    task: MerchantEnterpriseCurrentOperationsPriorityTask,
  ) {
    closeEmployeeCurrentWork();
    window.requestAnimationFrame(() => openTaskById(task.id));
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
      : (actor?.permissions ?? []).filter(
          (permission) => !isMerchantStaffBusinessPermission(permission),
        );
  const employeeById = useMemo(
    () => new Map(snapshot.employees.map((employee) => [employee.id, employee] as const)),
    [snapshot.employees],
  );
  const roleById = useMemo(
    () => new Map(snapshot.roles.map((role) => [role.id, role] as const)),
    [snapshot.roles],
  );
  const currentWorkEmployee = currentWorkEmployeeId
    ? snapshot.employees.find((employee) => employee.id === currentWorkEmployeeId) ?? null
    : null;
  const employeeCurrentWorkExpectedRequestKey = currentWorkEmployee
    ? buildMerchantEnterpriseCurrentOperationsRequestKey({
        siteId,
        actorAuthorizationFingerprint,
        scope: "employee",
        employeeId: currentWorkEmployee.id,
      })
    : "";
  const visibleEmployeeCurrentWork =
    employeeCurrentWork.requestKey === employeeCurrentWorkExpectedRequestKey
      ? employeeCurrentWork
      : {
          requestKey: employeeCurrentWorkExpectedRequestKey,
          status: "loading" as const,
          data: null,
          error: "",
          errorCode: "",
          authorizationFingerprint: "",
        };
  const offboardingEmployee = offboardingEmployeeId
    ? snapshot.employees.find(
        (employee) => employee.id === offboardingEmployeeId && employee.status === "active",
      ) ?? null
    : null;
  useEffect(() => {
    if (offboardingEmployeeId && !offboardingEmployee) {
      setOffboardingEmployeeId("");
    }
  }, [offboardingEmployee, offboardingEmployeeId]);
  const offboardingOpenTasks = offboardingEmployee
    ? snapshot.tasks.filter(
        (task) =>
          !task.archivedAt &&
          !task.completedAt &&
          task.assigneeIds.includes(offboardingEmployee.id),
      )
    : [];
  const offboardingBoardIds = new Set(
    offboardingOpenTasks.map((task) => task.boardId),
  );
  const allowOffboardingReassign = Boolean(
    actor && (actor.type === "owner" || can(actor, "tasks.assign")),
  );
  const offboardingReplacementCandidates = offboardingEmployee
    ? activeEmployees.filter((employee) => {
        if (employee.id === offboardingEmployee.id) return false;
        const role = roleById.get(employee.roleId);
        if (!role || role.status !== "active" || !role.permissions.includes("tasks.view")) {
          return false;
        }
        return (
          role.accessScope === "all" ||
          [...offboardingBoardIds].every((boardId) => role.allowedBoardIds.includes(boardId))
        );
      })
    : [];
  const roleTransitionEmployee = roleTransitionRequest
    ? snapshot.employees.find(
        (employee) => employee.id === roleTransitionRequest.employeeId,
      ) ?? null
    : null;
  const roleTransitionTargetRole = roleTransitionRequest
    ? snapshot.roles.find(
        (role) =>
          role.id === roleTransitionRequest.targetRoleId && role.status === "active",
      ) ?? null
    : null;
  const roleTransitionCurrentRole = roleTransitionEmployee
    ? roleById.get(roleTransitionEmployee.roleId) ?? null
    : null;
  useEffect(() => {
    if (
      roleTransitionRequest &&
      (!roleTransitionEmployee ||
        !roleTransitionTargetRole ||
        roleTransitionEmployee.roleId === roleTransitionTargetRole.id)
    ) {
      setRoleTransitionRequest(null);
    }
  }, [
    roleTransitionEmployee,
    roleTransitionRequest,
    roleTransitionTargetRole,
  ]);
  const roleTransitionAffectedTasks =
    roleTransitionEmployee && roleTransitionTargetRole
      ? getMerchantEmployeeRoleTransitionAffectedTasks(
          roleTransitionEmployee,
          roleTransitionTargetRole,
          snapshot.tasks,
        )
      : [];
  const roleTransitionAffectedBoardIds = Array.from(
    new Set(roleTransitionAffectedTasks.map((task) => task.boardId)),
  );
  const roleTransitionAffectedBoardNames = snapshot.boards
    .filter((board) => roleTransitionAffectedBoardIds.includes(board.id))
    .map((board) => board.name);
  const roleTransitionReplacementCandidates = roleTransitionEmployee
    ? activeEmployees.filter((employee) => {
        if (employee.id === roleTransitionEmployee.id) return false;
        const role = roleById.get(employee.roleId);
        return Boolean(
          role &&
            canMerchantEnterpriseEmployeeCoverBoards(
              employee,
              role,
              roleTransitionAffectedBoardIds,
            ),
        );
      })
    : [];
  const allowRoleTransitionTaskResolution = Boolean(
    actor && (actor.type === "owner" || can(actor, "tasks.assign")),
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
    if (!canCreateBoards || !can(actor, "roles.manage")) {
      setMessage({ kind: "error", text: "当前账号不能初始化新的企业工作区。" });
      return;
    }
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
    if (!canCreateBoards) {
      setMessage({ kind: "error", text: "当前账号只能访问指定看板，不能新建看板。" });
      return null;
    }
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
    const source = taskSource;
    const taskInput = {
      boardId: activeBoard.id,
      columnId: activeColumns[0].id,
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      priority: taskPriority,
      dueAt: taskDueAt ? new Date(`${taskDueAt}T23:59:59`).toISOString() : null,
      assigneeIds: can(actor, "tasks.assign") ? taskAssigneeIds : [],
    };
    const fingerprint = JSON.stringify({ ...taskInput, source });
    if (taskCreateMutationRef.current?.fingerprint !== fingerprint) {
      taskCreateMutationRef.current = {
        fingerprint,
        operationId: createClientMutationOperationId(
          source ? "enterprise-order-task-create" : "enterprise-task-create",
        ),
      };
    }
    const operationId = taskCreateMutationRef.current.operationId;
    const payload = await mutate(
      source
        ? "/api/merchant-enterprise/order-tasks"
        : "/api/merchant-enterprise/tasks",
      "POST",
      {
        ...taskInput,
        ...(source ? { orderId: source.sourceId } : {}),
        operationId,
      },
      source ? "订单任务已创建。" : "任务已创建。",
    );
    if (payload) {
      taskCreateMutationRef.current = null;
      setTaskTitle("");
      setTaskDescription("");
      setTaskPriority("normal");
      setTaskDueAt("");
      setTaskAssigneeIds([]);
      setTaskSource(null);
      setMobileTaskComposerOpen(false);
      if (source && payload.task) {
        const sourceTask = payload.task as MerchantTask;
        setSnapshot((current) => ({
          ...current,
          tasks: [
            ...current.tasks.filter((task) => task.id !== sourceTask.id),
            sourceTask,
          ],
        }));
        setSelectedBoardId(sourceTask.boardId);
        setTaskArchiveView(sourceTask.archivedAt ? "archived" : "active");
        setEditingTaskId(sourceTask.id);
        setMessage({
          kind: payload.created === false ? "info" : "success",
          text:
            payload.created === false
              ? "该订单已有企业任务，已为你打开。"
              : "订单任务已创建并打开。",
        });
      }
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
    const normalizedEmail = normalizeAuthEmail(employeeEmail);
    if (!employeeName.trim() || !employeeRoleId) {
      setMessage({ kind: "error", text: "请填写员工姓名、邮箱并选择角色。" });
      return;
    }
    if (!isValidAuthEmail(normalizedEmail)) {
      setMessage({ kind: "error", text: "请输入有效的员工邮箱地址。" });
      employeeEmailInputRef.current?.focus();
      return;
    }
    const inviteInput = {
      displayName: employeeName,
      email: normalizedEmail,
      roleId: employeeRoleId,
    };
    const fingerprint = JSON.stringify(inviteInput);
    if (employeeInviteMutationRef.current?.fingerprint !== fingerprint) {
      employeeInviteMutationRef.current = {
        fingerprint,
        operationId: createClientMutationOperationId("enterprise-employee-invite"),
      };
    }
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "POST",
      {
        ...inviteInput,
        operationId: employeeInviteMutationRef.current.operationId,
      },
      "员工邀请已提交。",
    );
    if (payload) {
      employeeInviteMutationRef.current = null;
      const invitedEmployeeId =
        typeof payload.employee?.id === "string" ? payload.employee.id.trim() : "";
      const invitationStatus =
        typeof payload.invitation?.status === "string" ? payload.invitation.status : "";
      const invitationSent = invitationStatus === "sent";
      const invitationQueued =
        invitationStatus === "queued" ||
        invitationStatus === "already_queued" ||
        invitationStatus === "sending" ||
        payload.employee?.invitationDeliveryStatus === "sending";
      if (invitedEmployeeId) {
        setFailedInvitationEmployeeIds((current) => {
          const next = new Set(current);
          if (invitationSent || invitationQueued) next.delete(invitedEmployeeId);
          else next.add(invitedEmployeeId);
          return next;
        });
      }
      setEmployeeName("");
      setEmployeeEmail("");
      setEmployeeRoleId("");
      setMessage({
        kind: invitationSent ? "success" : "info",
        text: invitationSent
          ? "邀请邮件已发送，员工接受后即可进入企业工作台。"
          : invitationQueued
            ? "邀请邮件已加入发送队列，系统会自动发送并在失败时重试。"
            : "员工记录已保存，但邀请邮件暂未发出，可稍后重试。",
      });
    }
  }

  async function sendEmployeeInvitation(
    employee: MerchantEnterpriseEmployee,
    action: "resend_invite" | "renew_invite",
  ) {
    const invitationInput = {
      action,
      employeeId: employee.id,
      version: employee.version,
    };
    const fingerprint = JSON.stringify(invitationInput);
    if (employeeInvitationDeliveryMutationRef.current?.fingerprint !== fingerprint) {
      employeeInvitationDeliveryMutationRef.current = {
        fingerprint,
        operationId: createClientMutationOperationId(
          action === "renew_invite"
            ? "enterprise-employee-invitation-renew"
            : "enterprise-employee-invitation-resend",
        ),
      };
    }
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        ...invitationInput,
        operationId: employeeInvitationDeliveryMutationRef.current.operationId,
      },
      action === "renew_invite" ? "新邀请已提交。" : "重发邀请已提交。",
    );
    if (!payload) return;
    employeeInvitationDeliveryMutationRef.current = null;
    const invitationStatus =
      typeof payload.invitation?.status === "string" ? payload.invitation.status : "";
    const invitationSent = invitationStatus === "sent";
    const invitationQueued =
      invitationStatus === "queued" ||
      invitationStatus === "already_queued" ||
      invitationStatus === "sending" ||
      payload.employee?.invitationDeliveryStatus === "sending";
    setFailedInvitationEmployeeIds((current) => {
      const next = new Set(current);
      if (invitationSent || invitationQueued) next.delete(employee.id);
      else next.add(employee.id);
      return next;
    });
    setMessage({
      kind: invitationSent ? "success" : "info",
      text: invitationSent
        ? "邀请邮件已重新发送，员工接受后即可进入企业工作台。"
        : invitationQueued
          ? "邀请邮件已加入发送队列，系统会自动发送并在失败时重试。"
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

  function managedEmployeeProfileHasDraft() {
    if (!managedEmployeeProfileId) return false;
    const employee = snapshot.employees.find(
      (item) => item.id === managedEmployeeProfileId,
    );
    return Boolean(employee && managedEmployeeProfileName !== employee.displayName);
  }

  function managedInvitationEditorHasDraft() {
    if (!managedInvitationEmployeeId) return false;
    const employee = snapshot.employees.find(
      (item) => item.id === managedInvitationEmployeeId,
    );
    return Boolean(
      employee &&
        (managedInvitationName !== employee.displayName ||
          managedInvitationRoleId !== employee.roleId),
    );
  }

  function confirmDiscardManagedEmployeeEditorDrafts(messageText: string) {
    return (
      (!managedEmployeeProfileHasDraft() && !managedInvitationEditorHasDraft()) ||
      typeof window === "undefined" ||
      window.confirm(messageText)
    );
  }

  function closeManagedEmployeeProfileEditor() {
    if (
      !confirmDiscardManagedEmployeeEditorDrafts(
        "员工资料中有尚未保存的修改。关闭编辑将放弃这些内容，是否继续？",
      )
    ) {
      return false;
    }
    setManagedEmployeeProfileId("");
    return true;
  }

  function closeManagedInvitationEditor() {
    if (
      !confirmDiscardManagedEmployeeEditorDrafts(
        "邀请资料中有尚未保存的修改。关闭管理将放弃这些内容，是否继续？",
      )
    ) {
      return false;
    }
    setManagedInvitationEmployeeId("");
    return true;
  }

  function toggleEmployeeProfileEditor(employee: MerchantEnterpriseEmployee) {
    if (managedEmployeeProfileId === employee.id) {
      closeManagedEmployeeProfileEditor();
      return;
    }
    if (
      !confirmDiscardManagedEmployeeEditorDrafts(
        "当前员工资料或邀请中有尚未保存的修改。打开其他员工将放弃这些内容，是否继续？",
      )
    ) {
      return;
    }
    setManagedInvitationEmployeeId("");
    setManagedEmployeeProfileId(employee.id);
    setManagedEmployeeProfileName(employee.displayName);
    setManagedEmployeeProfileVersion(employee.version);
  }

  async function saveEmployeeProfile(employee: MerchantEnterpriseEmployee) {
    if (employee.version !== managedEmployeeProfileVersion) {
      setManagedEmployeeProfileName(employee.displayName);
      setManagedEmployeeProfileVersion(employee.version);
      setMessage({
        kind: "info",
        text: "员工资料已被更新，已重新载入最新内容，请确认后再保存。",
      });
      return;
    }
    const displayName = managedEmployeeProfileName.trim();
    if (!displayName) {
      setMessage({ kind: "error", text: "请填写员工姓名。" });
      return;
    }
    if (displayName === employee.displayName) {
      setMessage({ kind: "info", text: "员工资料没有需要保存的修改。" });
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: employee.id,
        version: managedEmployeeProfileVersion,
        displayName,
      },
      "员工姓名已更新。",
    );
    if (payload) setManagedEmployeeProfileId("");
  }

  async function updateEmployeeStatus(
    employee: MerchantEnterpriseEmployee,
    status: "active" | "disabled",
  ) {
    if (status === "disabled") {
      setMessage(null);
      setOffboardingEmployeeId(employee.id);
      return;
    }
    if (!window.confirm(`确认恢复“${employee.displayName}”的企业账号吗？`)) return;
    await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: employee.id,
        version: employee.version,
        status,
      },
      "员工账号已恢复。",
    );
  }

  async function confirmEmployeeOffboarding(
    mode: EmployeeOffboardingMode,
    replacementEmployeeId: string,
  ) {
    if (!offboardingEmployee) return;
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: offboardingEmployee.id,
        version: offboardingEmployee.version,
        status: "disabled",
        offboardingMode: mode,
        ...(mode === "reassign" ? { replacementEmployeeId } : {}),
      },
      mode === "reassign"
        ? "员工账号已停用，未完成任务已转交。"
        : "员工账号已停用，未完成任务已解除负责人。",
    );
    if (payload) setOffboardingEmployeeId("");
  }

  function updateEmployeeRole(
    employee: MerchantEnterpriseEmployee,
    roleId: string,
  ) {
    if (!roleId || roleId === employee.roleId) return;
    const targetRole = assignableRoles.find((role) => role.id === roleId);
    if (!targetRole) {
      setMessage({ kind: "error", text: "当前账号不能为该员工分配所选角色。" });
      return;
    }
    setMessage(null);
    setRoleTransitionRequest({ employeeId: employee.id, targetRoleId: targetRole.id });
  }

  async function confirmEmployeeRoleTransition(
    mode?: EmployeeRoleTransitionMode,
    replacementEmployeeId = "",
  ) {
    if (!roleTransitionEmployee || !roleTransitionTargetRole) return;
    const hasAffectedTasks = roleTransitionAffectedTasks.length > 0;
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: roleTransitionEmployee.id,
        version: roleTransitionEmployee.version,
        roleId: roleTransitionTargetRole.id,
        roleVersion: roleTransitionTargetRole.version,
        ...(hasAffectedTasks && mode ? { roleTransitionMode: mode } : {}),
        ...(hasAffectedTasks && mode === "reassign"
          ? { replacementEmployeeId }
          : {}),
      },
      hasAffectedTasks
        ? mode === "reassign"
          ? "员工角色已更新，受影响任务已转交。"
          : "员工角色已更新，受影响任务已解除负责人。"
        : "员工角色已更新。",
    );
    if (payload) setRoleTransitionRequest(null);
  }

  async function createRole() {
    if (!roleName.trim()) {
      setMessage({ kind: "error", text: "请填写角色名称。" });
      return;
    }
    const boardAccess: RoleBoardAccessValue = {
      accessScope: roleAccessScope,
      allowedBoardIds: roleAccessScope === "all" ? [] : roleAllowedBoardIds,
    };
    if (!actor || !merchantEnterpriseBoardAccessFitsActor(actor, boardAccess)) {
      setMessage({ kind: "error", text: "不能授予超出当前账号范围的看板访问权。" });
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/roles",
      "POST",
      {
        name: roleName,
        description: roleDescription,
        permissions: rolePermissions,
        accessScope: boardAccess.accessScope,
        allowedBoardIds: boardAccess.allowedBoardIds,
      },
      "角色已创建。",
    );
    if (payload) {
      setRoleName("");
      setRoleDescription("");
      setRolePermissions(["enterprise.view"]);
      const defaultAccess = getMerchantEnterpriseDefaultRoleBoardAccess(actor);
      setRoleAccessScope(defaultAccess.accessScope);
      setRoleAllowedBoardIds([...defaultAccess.allowedBoardIds]);
    }
  }

  function toggleEmployeeInvitationManager(employee: MerchantEnterpriseEmployee) {
    if (managedInvitationEmployeeId === employee.id) {
      closeManagedInvitationEditor();
      return;
    }
    if (
      !confirmDiscardManagedEmployeeEditorDrafts(
        "当前员工资料或邀请中有尚未保存的修改。打开其他员工将放弃这些内容，是否继续？",
      )
    ) {
      return;
    }
    setManagedEmployeeProfileId("");
    setManagedInvitationEmployeeId(employee.id);
    setManagedInvitationName(employee.displayName);
    setManagedInvitationRoleId(employee.roleId);
  }

  async function savePendingEmployeeInvitation(employee: MerchantEnterpriseEmployee) {
    const displayName = managedInvitationName.trim();
    const roleId = managedInvitationRoleId.trim();
    if (!displayName || !roleId) {
      setMessage({ kind: "error", text: "请填写员工姓名并选择角色。" });
      return;
    }
    const targetRole = assignableRoles.find((role) => role.id === roleId);
    if (!targetRole) {
      setMessage({ kind: "error", text: "当前账号不能为该员工分配所选角色。" });
      return;
    }
    if (displayName === employee.displayName && roleId === employee.roleId) {
      setMessage({ kind: "info", text: "邀请资料没有需要保存的修改。" });
      return;
    }
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        employeeId: employee.id,
        version: employee.version,
        displayName,
        ...(roleId !== employee.roleId
          ? { roleId, roleVersion: targetRole.version }
          : {}),
      },
      "邀请姓名和角色已更新。",
    );
    if (!payload) return;
    setManagedInvitationName(displayName);
    setManagedInvitationRoleId(roleId);
  }

  async function removePendingEmployeeInvitation(employee: MerchantEnterpriseEmployee) {
    if (
      !window.confirm(
        `确认移除“${employee.displayName}”（${employee.email || "无邮箱"}）的待接受邀请吗？该账号将从员工列表删除，旧邀请会失效。`,
      )
    ) {
      return;
    }
    const reInviteName =
      managedInvitationEmployeeId === employee.id && managedInvitationName.trim()
        ? managedInvitationName.trim()
        : employee.displayName;
    const reInviteRoleId =
      managedInvitationEmployeeId === employee.id && managedInvitationRoleId
        ? managedInvitationRoleId
        : employee.roleId;
    const payload = await mutate(
      "/api/merchant-enterprise/employees",
      "PATCH",
      {
        action: "remove_invite",
        employeeId: employee.id,
        version: employee.version,
      },
      "待接受邀请已移除，可修正邮箱后重新邀请。",
    );
    if (!payload) return;
    setFailedInvitationEmployeeIds((current) => {
      const next = new Set(current);
      next.delete(employee.id);
      return next;
    });
    setManagedInvitationEmployeeId("");
    setEmployeeName(reInviteName);
    setEmployeeEmail("");
    setEmployeeRoleId(
      assignableRoles.some((role) => role.id === reInviteRoleId) ? reInviteRoleId : "",
    );
    window.requestAnimationFrame(() => {
      employeeInviteFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      employeeEmailInputRef.current?.focus({ preventScroll: true });
    });
  }

  async function saveRole(
    role: MerchantEnterpriseRole,
    input: {
      name: string;
      description: string;
      permissions: MerchantEnterprisePermission[];
      accessScope: RoleBoardAccessValue["accessScope"];
      allowedBoardIds: string[];
    },
  ) {
    if (!actor || !merchantEnterpriseBoardAccessFitsActor(actor, input)) {
      setMessage({ kind: "error", text: "不能授予超出当前账号范围的看板访问权。" });
      return;
    }
    await mutate(
      "/api/merchant-enterprise/roles",
      "PATCH",
      {
        roleId: role.id,
        version: role.version,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        accessScope: input.accessScope,
        allowedBoardIds: input.accessScope === "all" ? [] : input.allowedBoardIds,
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
    if (!merchantEnterpriseBoardAccessFitsActor(actor, role)) {
      return { editable: false, reason: "该角色的看板访问范围高于当前账号。" };
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
                {siteName || siteId} · 工作流程、任务、员工和角色权限统一管理
              </p>
            </div>
            <div className="w-full min-w-0 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-left backdrop-blur sm:w-auto sm:text-right">
              <div className="text-xs text-slate-200">当前身份</div>
              <div className="mt-1 break-words text-sm font-semibold">
                {actor.displayName} · {actor.type === "owner" ? "企业负责人" : "员工"}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 sm:justify-end">
                <span className="text-[11px] text-slate-200" aria-live="polite">
                  {overviewRefreshing
                    ? "正在同步…"
                    : lastSyncedAtMs > 0
                      ? `最后同步 ${formatDateTime(new Date(lastSyncedAtMs).toISOString())}`
                      : "尚未同步"}
                </span>
                {enterpriseDataIsStale ? (
                  <span
                    data-enterprise-sync-stale
                    role="status"
                    className="rounded-full border border-amber-200/40 bg-amber-300/15 px-2 py-1 text-[11px] font-semibold text-amber-100"
                  >
                    {enterpriseAutoRefreshPaused
                      ? "数据可能不是最新 · 完成当前操作后自动同步"
                      : "数据可能不是最新 · 正在等待自动同步"}
                  </span>
                ) : null}
                {actor.type === "employee" &&
                (can(actor, "tasks.view") || can(actor, "workflows.view")) ? (
                  <MerchantEnterpriseNotificationCenter
                    siteId={siteId}
                    actor={actor}
                    employees={snapshot.employees}
                    tasks={snapshot.tasks}
                    apiFetch={apiFetch}
                    onOpenTask={openTaskFromOverview}
                    onOpenWorkflow={openWorkflowFromNotification}
                    refreshIntervalMs={resolvedCollaborationRefreshIntervalMs}
                  />
                ) : null}
                <button
                  type="button"
                  className="min-h-9 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-45"
                  disabled={busy || overviewRefreshing}
                  onClick={() => void refreshOverview()}
                >
                  {overviewRefreshing ? "刷新中…" : "刷新数据"}
                </button>
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
                onClick={() => requestViewChange(key)}
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
              disabled={busy || !canCreateBoards || !can(actor, "roles.manage")}
              onClick={() => void bootstrap()}
            >
              开始初始化
            </button>
            {can(actor, "boards.manage") && !canCreateBoards ? (
              <p className="mt-2 text-xs leading-5 text-amber-800">
                当前账号只能访问指定看板，不能创建或初始化新的看板。
              </p>
            ) : null}
          </section>
        ) : null}

        {!needsBootstrap && tab === "overview" ? (
          <div className="mt-5 space-y-5">
            <section className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
              <strong>企业／看板当前运营概览（非绩效考核）</strong>
              <span className="ml-1">
                这里只反映服务端在查询时点看到的当前任务库存与截止风险，不用于评价员工产出。企业总数按唯一任务计数；员工视图中的多人协作任务不可跨员工相加。
              </span>
              {overviewOperationsData ? (
                <span className="ml-1 text-blue-700">
                  统计时点：{formatDateTime(overviewOperationsData.asOf)}
                  {overviewUsingRolloutFallback
                    ? "（迁移窗口内的已授权工作区快照）"
                    : ""}
                  。
                </span>
              ) : null}
            </section>
            {!can(actor, "tasks.view") ? (
              <section className="rounded-3xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
                当前角色没有查看任务的权限，因此不读取当前运营数据。
              </section>
            ) : null}
            {can(actor, "tasks.view") &&
            visibleOverviewCurrentOperations.status === "loading" &&
            !overviewOperationsData ? (
              <section className="grid animate-pulse gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="正在读取当前运营数据">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="h-28 rounded-2xl bg-white shadow-sm" />
                ))}
              </section>
            ) : null}
            {can(actor, "tasks.view") &&
            visibleOverviewCurrentOperations.status === "error" ? (
              <section
                className={`rounded-2xl border px-4 py-3 ${
                  overviewUsingRolloutFallback
                    ? "border-amber-200 bg-amber-50"
                    : "border-rose-200 bg-rose-50"
                }`}
                role={overviewOperationsData ? "status" : "alert"}
              >
                <p
                  className={`text-sm leading-6 ${
                    overviewUsingRolloutFallback
                      ? "text-amber-800"
                      : "text-rose-700"
                  }`}
                >
                  {overviewUsingRolloutFallback
                    ? "当前版本正在等待数据库迁移，暂时显示已由企业概览接口授权并过滤的工作区快照；迁移完成后会自动切回服务端权威统计。"
                    : visibleOverviewCurrentOperations.error}
                </p>
                <button
                  type="button"
                  className={`mt-3 min-h-11 rounded-xl px-4 py-2 text-sm font-semibold text-white ${
                    overviewUsingRolloutFallback ? "bg-amber-700" : "bg-rose-700"
                  }`}
                  onClick={() => void loadOverviewCurrentOperations(actor)}
                >
                  重新读取运营数据
                </button>
              </section>
            ) : null}
            {overviewOperationsData ? (
              <>
                {visibleOverviewCurrentOperations.status === "loading" ? (
                  <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600" role="status">
                    正在更新当前运营数据；下方暂时显示上一查询时点的结果。
                  </p>
                ) : null}
                {overviewOperationsData.scopeRestricted ? (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    当前结果仅包含此账号有权查看的看板，不代表企业全部任务。
                  </p>
                ) : null}
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    {
                      label: actor.type === "employee" ? "当前分派给我的未完成" : "当前未完成",
                      value: overviewOperationsData.summary.openTaskCount,
                      tone: "text-blue-700",
                    },
                    {
                      label: actor.type === "employee" ? "当前分派给我的逾期" : "当前逾期",
                      value: overviewOperationsData.summary.overdueTaskCount,
                      tone: "text-rose-700",
                    },
                    {
                      label: "未来 7 天内到期",
                      value: overviewOperationsData.summary.dueSoonTaskCount,
                      tone: "text-amber-700",
                    },
                    {
                      label: actor.type === "employee" ? "当前涉及看板" : "当前未分派",
                      value: actor.type === "employee"
                        ? overviewOperationsData.summary.involvedBoardCount
                        : overviewOperationsData.summary.unassignedTaskCount ?? 0,
                      tone: "text-violet-700",
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="text-sm text-slate-500">{item.label}</div>
                      <div className={`mt-3 text-3xl font-bold ${item.tone}`}>{item.value}</div>
                    </div>
                  ))}
                </section>
                {overviewOperationsData.summary.sharedAssignmentTaskCount !== null ? (
                  <p className="rounded-2xl bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-800">
                    当前未完成任务中有 {overviewOperationsData.summary.sharedAssignmentTaskCount} 项由多人共同负责；该数字已包含在未完成任务中，也不能与其他员工的数字相加。
                  </p>
                ) : null}
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">
                        {actor.type === "employee" ? "我的当前优先任务" : "当前优先任务"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        服务端最多返回 6 项，优先显示已逾期、即将到期和最近更新的任务。
                      </p>
                    </div>
                    <button type="button" className="text-sm font-semibold text-blue-700" onClick={openTaskBoardFromOverview}>
                      {actor.type === "employee" ? "查看我的任务" : "查看看板"}
                    </button>
                  </div>
                  <div className="mt-4 divide-y divide-slate-100">
                    {overviewOperationsData.priorityTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        aria-label={`打开任务：${task.title}，看板：${task.boardName}，工作列：${task.columnName}${task.dueAt ? `，截止：${formatDate(task.dueAt)}` : ""}`}
                        onClick={() => openTaskById(task.id)}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-900">{task.title}</span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {task.boardName} · {task.columnName}
                            {task.dueAt ? ` · 截止 ${formatDate(task.dueAt)}` : ""}
                            {task.assigneeCount > 1 ? ` · ${task.assigneeCount} 人协作` : ""}
                          </span>
                        </span>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PRIORITY_META[task.priority].className}`}>
                          {PRIORITY_META[task.priority].label}
                        </span>
                      </button>
                    ))}
                    {overviewOperationsData.priorityTasks.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-500">
                        {actor.type === "employee"
                          ? "目前没有分派给你的未完成任务。"
                          : "还没有未完成任务，可以从任务看板创建第一项工作。"}
                      </div>
                    ) : null}
                  </div>
                </section>
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">按看板查看当前任务</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {actor.type === "employee"
                        ? "只统计当前分派给你的未完成任务；看板之间不做员工横向比较。"
                        : "按启用看板汇总当前未完成、逾期及未来 7 天内到期任务。"}
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {overviewOperationsData.boards.map((board) => (
                      <div key={board.boardId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="truncate text-sm font-semibold text-slate-900">{board.boardName}</div>
                        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <div><dt className="text-[11px] text-slate-500">未完成</dt><dd className="mt-1 text-lg font-bold text-blue-700">{board.openTaskCount}</dd></div>
                          <div><dt className="text-[11px] text-slate-500">逾期</dt><dd className="mt-1 text-lg font-bold text-rose-700">{board.overdueTaskCount}</dd></div>
                          <div><dt className="text-[11px] text-slate-500">7 日内</dt><dd className="mt-1 text-lg font-bold text-amber-700">{board.dueSoonTaskCount}</dd></div>
                        </dl>
                      </div>
                    ))}
                  </div>
                  {overviewOperationsData.boards.length === 0 ? (
                    <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      当前没有可查看的启用看板。
                    </p>
                  ) : null}
                  {overviewOperationsData.boardsTruncated ? (
                    <p className="mt-3 text-xs leading-5 text-amber-700" role="status">
                      共有 {overviewOperationsData.boardSummaryTotalCount} 个看板，本页仅显示当前风险和未完成任务较多的前 {overviewOperationsData.boards.length} 个；顶部统计仍为完整授权范围。
                    </p>
                  ) : null}
                </section>
              </>
            ) : null}
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
                  onChange={(event) => {
                    if (!requestBoardSelection(event.target.value)) {
                      event.currentTarget.value = activeBoard?.id ?? "";
                    }
                  }}
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
                    onClick={toggleBoardSettingsVisibility}
                  >
                    {showBoardSettings ? "收起看板设置" : "管理看板与工作列"}
                  </button>
                ) : null}
              </div>
            </section>

            {can(actor, "boards.manage") && showBoardSettings ? (
              <BoardSettings
                key={`board-settings:${activeBoard?.id ?? "none"}:${boardSettingsResetVersion}`}
                boards={snapshot.boards}
                columns={snapshot.columns}
                selectedBoardId={activeBoard?.id ?? ""}
                busy={busy}
                canCreateBoard={canCreateBoards}
                onSelectBoard={requestBoardSelection}
                onCreateBoard={createBoard}
                onSaveBoard={saveBoard}
                onSetBoardStatus={setBoardStatusWithDraftGuard}
                onMoveBoard={moveBoard}
                onCreateColumn={createColumn}
                onSaveColumn={saveColumn}
                onSetColumnStatus={setColumnStatus}
                onMoveColumn={moveColumn}
                onDirtyChange={handleBoardSettingsDirtyChange}
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
                {taskSource ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
                    <div className="min-w-0">
                      <span className="font-semibold">来源订单：</span>
                      <span className="break-all" data-no-translate="1">{taskSource.sourceId}</span>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-100"
                      onClick={() => setTaskSource(null)}
                    >
                      取消关联
                    </button>
                  </div>
                ) : null}
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
                {actor.type === "employee" ? (
                  <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">任务范围</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        默认聚焦分派给我的任务；需要拖动排序时，请切换到全部任务。
                      </div>
                    </div>
                    <div className="flex rounded-xl bg-white p-1 shadow-sm" aria-label="任务范围筛选">
                      <button
                        type="button"
                        className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold ${
                          taskAssigneeFilter === actor.id
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        aria-pressed={taskAssigneeFilter === actor.id}
                        onClick={() => setTaskAssigneeFilter(actor.id)}
                      >
                        我的任务
                      </button>
                      <button
                        type="button"
                        className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold ${
                          taskAssigneeFilter === "all"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                        aria-pressed={taskAssigneeFilter === "all"}
                        onClick={() => setTaskAssigneeFilter("all")}
                      >
                        全部任务
                      </button>
                    </div>
                  </div>
                ) : null}
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
                {!activeBoard && actor.type === "employee" && !canGrantAllBoards
                  ? "当前角色没有获分配可访问的任务看板，请联系企业管理员调整角色范围。"
                  : "当前没有可用的任务看板或工作列，请由管理员重新初始化工作区。"}
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
                              const taskOrderSource = getMerchantOrderTaskSource(task);
                              const reorderControlsDisabled = busy || hasTaskFilters;
                              const completionTransition = getMerchantTaskCompletionTransition(
                                task,
                                activeColumns,
                              );
                              const showCompletionAction =
                                taskArchiveView === "active" &&
                                !task.archivedAt &&
                                can(actor, "tasks.update") &&
                                Boolean(completionTransition);
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
                                  {taskOrderSource ? (
                                    <div
                                      data-enterprise-task-order-source
                                      className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-xs font-semibold text-cyan-800"
                                    >
                                      <span>来源订单 · </span>
                                      <span className="break-all" data-no-translate="1">#{taskOrderSource.sourceId}</span>
                                    </div>
                                  ) : null}
                                  {task.dueAt ? (
                                    <div className={`mt-3 text-xs font-medium ${overdue ? "text-rose-600" : "text-slate-500"}`}>
                                      {overdue ? "已逾期 · " : "截止 · "}{formatDate(task.dueAt)}
                                    </div>
                                  ) : null}
                                  <div className="mt-3 text-xs text-slate-500">负责人：{assigned || "未分派"}</div>
                                  <div className={`mt-3 grid gap-2 ${showCompletionAction ? "grid-cols-2" : "grid-cols-1"}`}>
                                    <button
                                      type="button"
                                      className="min-h-11 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 sm:min-h-0"
                                      onClick={() => setEditingTaskId(task.id)}
                                    >
                                      {can(actor, "tasks.update") || can(actor, "tasks.assign") || can(actor, "tasks.archive")
                                        ? "管理任务"
                                        : "查看详情"}
                                    </button>
                                    {showCompletionAction && completionTransition ? (
                                      <button
                                        type="button"
                                        className={`min-h-11 rounded-lg border px-2 py-1.5 text-xs font-semibold disabled:opacity-45 sm:min-h-0 ${
                                          completionTransition.action === "complete"
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                            : "border-blue-200 bg-white text-blue-700"
                                        }`}
                                        disabled={busy}
                                        aria-label={`${
                                          completionTransition.action === "complete" ? "完成任务" : "重新打开任务"
                                        }：${task.title}，移至${completionTransition.targetColumnName}`}
                                        onClick={() =>
                                          void moveTask(task, completionTransition.targetColumnId)
                                        }
                                      >
                                        {completionTransition.action === "complete" ? "完成" : "重新打开"}
                                      </button>
                                    ) : null}
                                  </div>
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

        {!needsBootstrap && tab === "todos" ? (
          <div className="mt-5">
            <MerchantEnterpriseTodoCenter
              siteId={siteId}
              actor={actor}
              apiFetch={apiFetch}
              onOpenTask={openTaskById}
              onOpenWorkflow={(workflowId, executionId) => {
                void openWorkflowFromNotification(workflowId, executionId);
              }}
              onCountChange={onTodoCountChange}
              refreshIntervalMs={resolvedCollaborationRefreshIntervalMs}
            />
          </div>
        ) : null}

        {!needsBootstrap && tab === "workflows" ? (
          <div className="mt-5">
            <EnterpriseWorkflowsPanel
              siteId={siteId}
              actor={actor}
              apiFetch={apiFetch}
              focusWorkflowId={workflowFocusRequest?.workflowId ?? null}
              focusExecutionId={workflowFocusRequest?.executionId ?? null}
              focusRequestId={workflowFocusRequest?.requestId ?? 0}
              onFocusHandled={handleWorkflowFocusHandled}
              onDirtyChange={setWorkflowHasDraft}
            />
          </div>
        ) : null}

        {!needsBootstrap && tab === "automations" ? (
          <div className="mt-5">
            <MerchantEnterpriseAutomationManager
              siteId={siteId}
              actor={actor}
              snapshot={snapshot}
              apiFetch={apiFetch}
              onOpenTask={openTaskById}
              onDirtyChange={setAutomationHasDraft}
            />
          </div>
        ) : null}

        {!needsBootstrap && tab === "employees" ? (
          <div className="mt-5 space-y-5">
            {can(actor, "employees.manage") ? (
              <section
                ref={employeeInviteFormRef}
                className="scroll-mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
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
                    ref={employeeEmailInputRef}
                    type="email"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    placeholder="员工邮箱"
                    value={employeeEmail}
                    maxLength={254}
                    autoComplete="email"
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
                  const currentEmployeeRole = roleById.get(employee.roleId);
                  const canManageEmployeeLifecycle =
                    can(actor, "employees.manage") &&
                    !(actor.type === "employee" && actor.id === employee.id) &&
                    (actor.type === "owner" ||
                      Boolean(
                        currentEmployeeRole &&
                          merchantEnterpriseRoleFitsActor(actor, currentEmployeeRole),
                      ));
                  const canManageInvitation =
                    canManageEmployeeLifecycle &&
                    invitationNeedsAction &&
                    employee.status === "invited";
                  const canManageEmployeeProfile =
                    canManageEmployeeLifecycle && employee.status !== "invited";
                  const employeeProfileOpen =
                    canManageEmployeeProfile && managedEmployeeProfileId === employee.id;
                  const employeeProfileStale =
                    employeeProfileOpen &&
                    managedEmployeeProfileVersion !== employee.version;
                  const invitationManagerOpen =
                    canManageInvitation && managedInvitationEmployeeId === employee.id;
                  const invitationRoleAssignable = assignableRoles.some(
                    (role) => role.id === employee.roleId,
                  );
                  return (
                    <div key={employee.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{employee.displayName}</div>
                          <div className="mt-1 truncate text-sm text-slate-500">{employee.email || "邮箱仅管理员可见"}</div>
                        </div>
                        <div className="flex max-w-full flex-wrap items-center justify-end gap-3">
                        {canManageEmployeeLifecycle &&
                        employee.status !== "invited" &&
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
                        {can(actor, "tasks.view") ? (
                          <button
                            type="button"
                            className="min-h-11 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 disabled:opacity-45"
                            disabled={busy}
                            aria-haspopup="dialog"
                            aria-expanded={currentWorkEmployeeId === employee.id}
                            aria-controls="enterprise-employee-current-work-drawer"
                            onClick={() => openEmployeeCurrentWork(employee)}
                          >
                            查看当前工作
                          </button>
                        ) : null}
                        {canManageInvitation ? (
                          <button
                            type="button"
                            className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-45"
                            disabled={busy}
                            aria-expanded={invitationManagerOpen}
                            aria-controls={`employee-invitation-manager-${employee.id}`}
                            onClick={() => toggleEmployeeInvitationManager(employee)}
                          >
                            {invitationManagerOpen ? "收起管理" : "管理邀请"}
                          </button>
                        ) : null}
                        {canManageEmployeeProfile ? (
                          <button
                            type="button"
                            className="min-h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-45"
                            disabled={busy}
                            aria-expanded={employeeProfileOpen}
                            aria-controls={`employee-profile-editor-${employee.id}`}
                            onClick={() => toggleEmployeeProfileEditor(employee)}
                          >
                            {employeeProfileOpen ? "收起资料" : "编辑姓名"}
                          </button>
                        ) : null}
                        {canManageEmployeeProfile ? (
                          <button
                            type="button"
                            className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                            disabled={busy}
                            onClick={() => void updateEmployeeStatus(employee, employee.status === "disabled" ? "active" : "disabled")}
                          >
                            {employee.status === "disabled" ? "恢复" : "停用"}
                          </button>
                        ) : null}
                        </div>
                      </div>
                      {employeeProfileOpen ? (
                        <div
                          id={`employee-profile-editor-${employee.id}`}
                          className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">编辑员工资料</h3>
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                姓名会显示在任务负责人和操作记录中；登录邮箱不可直接修改。
                              </p>
                            </div>
                            <button
                              type="button"
                              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
                              disabled={busy}
                              onClick={closeManagedEmployeeProfileEditor}
                            >
                              取消
                            </button>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <label className="block text-xs font-medium text-slate-600">
                              员工姓名
                              <input
                                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                value={managedEmployeeProfileName}
                                maxLength={120}
                                disabled={busy}
                                onChange={(event) => setManagedEmployeeProfileName(event.target.value)}
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-600">
                              登录邮箱（不可直接修改）
                              <input
                                type="email"
                                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                                value={employee.email || ""}
                                readOnly
                              />
                            </label>
                          </div>
                          <div className="mt-4">
                            {employeeProfileStale ? (
                              <p className="mb-3 text-xs leading-5 text-amber-700" role="status">
                                员工资料已发生变化，请先重新载入再继续编辑。
                              </p>
                            ) : null}
                            <button
                              type="button"
                              className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                              disabled={
                                busy ||
                                (!employeeProfileStale &&
                                  (!managedEmployeeProfileName.trim() ||
                                    managedEmployeeProfileName.trim() === employee.displayName))
                              }
                              onClick={() => void saveEmployeeProfile(employee)}
                            >
                              {employeeProfileStale ? "重新载入资料" : "保存姓名"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {invitationManagerOpen ? (
                        <div
                          id={`employee-invitation-manager-${employee.id}`}
                          className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">管理待接受邀请</h3>
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                可修改姓名和角色。邀请邮箱与登录身份绑定，邮箱有误时请移除后重新邀请。
                              </p>
                            </div>
                            <button
                              type="button"
                              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
                              disabled={busy}
                              onClick={closeManagedInvitationEditor}
                            >
                              关闭
                            </button>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <label className="block text-xs font-medium text-slate-600">
                              员工姓名
                              <input
                                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                value={managedInvitationName}
                                maxLength={120}
                                disabled={busy}
                                onChange={(event) => setManagedInvitationName(event.target.value)}
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-600">
                              员工角色
                              <select
                                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                value={managedInvitationRoleId}
                                disabled={busy || !invitationRoleAssignable}
                                onChange={(event) => setManagedInvitationRoleId(event.target.value)}
                              >
                                {!invitationRoleAssignable ? (
                                  <option value={employee.roleId}>
                                    {roleById.get(employee.roleId)?.name || "当前角色"}
                                  </option>
                                ) : null}
                                {assignableRoles.map((role) => (
                                  <option key={role.id} value={role.id}>{role.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-xs font-medium text-slate-600 md:col-span-2">
                              邀请邮箱（不可直接修改）
                              <input
                                type="email"
                                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                                value={employee.email || ""}
                                readOnly
                              />
                            </label>
                          </div>
                          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            <button
                              type="button"
                              className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                              disabled={
                                busy ||
                                !managedInvitationName.trim() ||
                                !managedInvitationRoleId ||
                                !invitationRoleAssignable
                              }
                              onClick={() => void savePendingEmployeeInvitation(employee)}
                            >
                              保存姓名和角色
                            </button>
                            <button
                              type="button"
                              className="min-h-11 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-45"
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
                            {!invitationNeedsRenewal ? (
                              <button
                                type="button"
                                className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-45"
                                disabled={busy}
                                onClick={() => void revokeEmployeeInvitation(employee)}
                              >
                                撤销邀请
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="min-h-11 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-45"
                              disabled={busy}
                              onClick={() => void removePendingEmployeeInvitation(employee)}
                            >
                              移除待接受账号
                            </button>
                          </div>
                        </div>
                      ) : null}
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
            {actor.type === "owner" ? (
              <WorkflowPermissionGapCard
                siteId={siteId}
                actorType={actor.type}
                apiFetch={apiFetch}
                onChanged={async () => {
                  await loadOverview({ preserveData: true, silent: true });
                }}
              />
            ) : null}
            {can(actor, "roles.manage") ? (
              <section className="overflow-visible rounded-3xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  className="flex min-h-24 w-full items-center justify-between gap-3 rounded-3xl px-5 py-4 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                  aria-expanded={newRoleEditorOpen}
                  aria-controls="new-role-editor-body"
                  onClick={() => setNewRoleEditorOpen((current) => !current)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold text-slate-950">新建角色</span>
                      {roleComposerHasDraft ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          有未保存草稿
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      已选 {rolePermissions.length} 项权限 · 可从企业协作与业务菜单中精细配置
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs font-semibold text-slate-600">
                    {newRoleEditorOpen ? "收起" : "展开创建"}
                    <span
                      className={`text-lg leading-none transition-transform ${newRoleEditorOpen ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    >
                      ⌄
                    </span>
                  </span>
                </button>

                <div
                  id="new-role-editor-body"
                  hidden={!newRoleEditorOpen}
                  className="border-t border-slate-200 px-5 pb-5 pt-4"
                >
                  <p className="text-sm text-slate-500">
                    业务菜单权限默认关闭且仅企业负责人可授予；勾选管理权限时会自动补齐所需的查看权限。
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                    <label className="block text-xs font-medium text-slate-600">
                      角色名称
                      <input
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        value={roleName}
                        maxLength={80}
                        onChange={(event) => setRoleName(event.target.value)}
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      角色说明
                      <input
                        className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        value={roleDescription}
                        maxLength={1000}
                        onChange={(event) => setRoleDescription(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="min-h-11 self-end rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                      disabled={busy || !roleName.trim()}
                      onClick={() => void createRole()}
                    >
                      创建角色
                    </button>
                  </div>
                  <RoleBoardAccessEditor
                    idPrefix="new-role"
                    accessScope={roleAccessScope}
                    allowedBoardIds={roleAllowedBoardIds}
                    boards={snapshot.boards}
                    editable={!busy}
                    canGrantAllBoards={canGrantAllBoards}
                    onChange={(value) => {
                      setRoleAccessScope(value.accessScope);
                      setRoleAllowedBoardIds(value.allowedBoardIds);
                    }}
                  />
                  <RolePermissionEditor
                    idPrefix="new-role"
                    permissions={rolePermissions}
                    grantablePermissions={grantablePermissions}
                    editable={!busy}
                    onChange={setRolePermissions}
                  />
                </div>
              </section>
            ) : null}
            <section className="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm sm:p-5" aria-labelledby="existing-roles-heading">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="existing-roles-heading" className="text-lg font-semibold text-slate-950">
                    现有角色
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    先查看角色摘要，再展开需要配置的角色；同一时间只展开一个角色。
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {snapshot.roles.length} 个角色
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {snapshot.roles.map((role) => {
                  const availability = roleEditAvailability(role);
                  return (
                    <RoleEditor
                      key={role.id}
                      role={role}
                      boards={snapshot.boards}
                      busy={busy}
                      editable={availability.editable}
                      unavailableReason={availability.reason}
                      grantablePermissions={grantablePermissions}
                      canGrantAllBoards={canGrantAllBoards}
                      expanded={expandedRoleId === role.id}
                      onExpandedChange={(expanded) => setExpandedRoleId(expanded ? role.id : "")}
                      onSave={saveRole}
                      onStatusChange={updateRoleStatus}
                      onDirtyChange={handleRoleEditorDirtyChange}
                    />
                  );
                })}
                {snapshot.roles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">
                    还没有角色，请先初始化企业工作区。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        {!needsBootstrap && tab === "audit" ? (
          <MerchantEnterpriseAuditLog
            key={siteId}
            siteId={siteId}
            employees={snapshot.employees}
            roles={snapshot.roles}
            boards={snapshot.boards}
            apiFetch={apiFetch}
          />
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
            canViewWorkflows={can(actor, "workflows.view")}
            apiFetch={apiFetch}
            onSave={saveTask}
            onArchive={setTaskArchived}
            onLoadEvents={loadTaskEvents}
            onComment={createTaskComment}
            onLoadChecklist={loadTaskChecklist}
            onCreateChecklistItem={createTaskChecklistItem}
            onUpdateChecklistItem={updateTaskChecklistItem}
            {...(actor.type === "employee" && can(actor, "orders.linked.view")
              ? { onLoadLinkedOrderSummary: loadLinkedOrderSummary }
              : {})}
            {...(actor.type === "owner" && onOpenSourceOrder
              ? {
                  onOpenSourceOrder: (orderId: string) =>
                    onOpenSourceOrder({ siteId, orderId }),
                }
              : {})}
            onClose={() => setEditingTaskId("")}
          />
        ) : null}
        {currentWorkEmployee && actorCanViewTasks && actorCanViewEmployees ? (
          <EmployeeCurrentWorkDrawer
            key={`${currentWorkEmployee.id}:${currentWorkEmployee.version}`}
            employee={currentWorkEmployee}
            roleName={roleById.get(currentWorkEmployee.roleId)?.name || "未分配角色"}
            state={visibleEmployeeCurrentWork}
            onRetry={() => void loadEmployeeCurrentWork(currentWorkEmployee.id)}
            onOpenTask={openTaskFromEmployeeCurrentWork}
            onClose={closeEmployeeCurrentWork}
          />
        ) : null}
        {offboardingEmployee && actor ? (
          <EmployeeOffboardingDialog
            key={`${offboardingEmployee.id}:${offboardingEmployee.version}`}
            employee={offboardingEmployee}
            openTaskCount={offboardingOpenTasks.length}
            taskCountExact={
              actor.type === "owner" ||
              (can(actor, "tasks.view") && actor.accessScope === "all")
            }
            replacementCandidates={offboardingReplacementCandidates}
            allowReassign={allowOffboardingReassign}
            busy={busy}
            errorMessage={message?.kind === "error" ? message.text : ""}
            onConfirm={confirmEmployeeOffboarding}
            onClose={() => setOffboardingEmployeeId("")}
          />
        ) : null}
        {roleTransitionEmployee && roleTransitionTargetRole && actor ? (
          <EmployeeRoleTransitionDialog
            key={`${roleTransitionEmployee.id}:${roleTransitionEmployee.version}:${roleTransitionTargetRole.id}:${roleTransitionTargetRole.version}`}
            employee={roleTransitionEmployee}
            currentRole={roleTransitionCurrentRole}
            targetRole={roleTransitionTargetRole}
            affectedTasks={roleTransitionAffectedTasks}
            affectedBoardNames={roleTransitionAffectedBoardNames}
            taskCountExact={
              actor.type === "owner" ||
              (can(actor, "tasks.view") && actor.accessScope === "all")
            }
            replacementCandidates={roleTransitionReplacementCandidates}
            allowTaskResolution={allowRoleTransitionTaskResolution}
            busy={busy}
            errorMessage={message?.kind === "error" ? message.text : ""}
            onConfirm={confirmEmployeeRoleTransition}
            onClose={() => setRoleTransitionRequest(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
