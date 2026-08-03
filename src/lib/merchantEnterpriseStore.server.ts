import { randomUUID } from "node:crypto";
import {
  isMerchantEnterpriseSchemaMissingError,
  MAX_MERCHANT_TASK_CHECKLIST_ITEMS,
  MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH,
  MAX_MERCHANT_TASK_ASSIGNEES,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH,
  MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES,
  MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES,
  normalizeMerchantEnterpriseBoardIds,
  normalizeMerchantEnterpriseAuditEvent,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterpriseNotification,
  normalizeMerchantEnterprisePermissions,
  normalizeMerchantEnterpriseRole,
  normalizeMerchantEnterpriseWorkflow,
  parseMerchantEnterpriseWorkflowStepsStrict,
  parseMerchantEnterpriseWorkflowTagsStrict,
  normalizeMerchantTask,
  normalizeMerchantTaskBoard,
  normalizeMerchantTaskColumn,
  normalizeMerchantTaskEvent,
  type MerchantEnterpriseEmployee,
  type MerchantEnterpriseNotification,
  type MerchantEnterpriseEmployeeStatus,
  type MerchantEnterpriseBoardAccessScope,
  type MerchantEnterpriseAuditCursor,
  type MerchantEnterpriseAuditEntityType,
  type MerchantEnterpriseAuditEvent,
  type MerchantEnterpriseAuditEventType,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRole,
  type MerchantEnterpriseSnapshot,
  type MerchantEnterpriseWorkflow,
  type MerchantEnterpriseWorkflowStep,
  type MerchantTask,
  type MerchantTaskBoard,
  type MerchantTaskColumn,
  type MerchantTaskChecklistItem,
  type MerchantTaskEvent,
  type MerchantTaskEventActorType,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import {
  isValidAuthEmail,
  normalizeAuthEmail,
} from "@/lib/authCredentialValidation";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";

export type MerchantEnterpriseStoreClient = {
  // Supabase builders are intentionally treated as runtime clients in this isolated store.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (functionName: string, args: Record<string, unknown>) => any;
};

export {
  MAX_MERCHANT_TASK_CHECKLIST_ITEMS,
  MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH,
};
export type { MerchantTaskChecklistItem };

const DEFAULT_ROLE_SYSTEM_KEYS = ["administrator", "supervisor", "employee"] as const;
const DEFAULT_COLUMN_SYSTEM_KEYS = ["todo", "in_progress", "blocked", "done"] as const;

const ROLE_COLUMNS =
  "id,merchant_id,name,description,permissions,access_scope,status,is_system,version,created_at,updated_at";
const EMPLOYEE_COLUMNS =
  "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at";
const BOARD_COLUMNS =
  "id,merchant_id,name,description,position,status,version,created_at,updated_at";
const COLUMN_COLUMNS =
  "id,merchant_id,board_id,name,color,position,is_done,status,version,created_at,updated_at";
const TASK_COLUMNS =
  "id,merchant_id,board_id,column_id,title,description,priority,due_at,completed_at,archived_at,position,source_type,source_id,created_by_employee_id,version,created_at,updated_at";
const TASK_EVENT_COLUMNS =
  "id,merchant_id,task_id,event_type,actor_type,actor_id,payload,created_at";
const TASK_CHECKLIST_ITEM_COLUMNS =
  "id,merchant_id,task_id,text,position,completed_at,archived_at,version,created_at,updated_at";

export const MAX_MERCHANT_ENTERPRISE_NOTIFICATION_PAGE_SIZE = 50;

export type MerchantEnterpriseNotificationCursor = {
  createdAt: string;
  id: string;
};

export type MerchantEnterpriseNotificationPage = {
  notifications: MerchantEnterpriseNotification[];
  unreadCount: number;
  nextCursor: MerchantEnterpriseNotificationCursor | null;
};

export const MAX_MERCHANT_ENTERPRISE_AUDIT_PAGE_SIZE = 100;

export type MerchantEnterpriseAuditPage = {
  events: MerchantEnterpriseAuditEvent[];
  nextCursor: MerchantEnterpriseAuditCursor | null;
};

export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_ARCHIVE_PAGE_SIZE = 50;

export type MerchantEnterpriseWorkflowArchiveCursor = {
  beforeUpdatedAt: string;
  beforeId: string;
};

export type MerchantEnterpriseWorkflowArchivePage = {
  workflows: MerchantEnterpriseWorkflow[];
  nextCursor: MerchantEnterpriseWorkflowArchiveCursor | null;
};

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function toErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "unknown_error";
  const record = error as { code?: unknown; message?: unknown };
  const code = normalizeText(record.code, 40);
  const message = normalizeText(record.message, 1000) || "unknown_error";
  return code ? `${code}:${message}` : message;
}

function throwStoreError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  if (message.includes("workflow_version_conflict")) {
    throw new Error("enterprise_version_conflict");
  }
  if (message.includes("workflow_requires_steps")) {
    throw new Error("workflow_publish_incomplete");
  }
  if (
    message.includes("invalid_workflow_steps") ||
    message.includes("invalid_workflow_tags")
  ) {
    throw new Error("invalid_workflow_payload");
  }
  for (const code of [
    "employee_board_access_in_use",
    "role_board_access_in_use",
    "task_assignee_board_access_denied",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  throw new Error(`${operation}:${message}`);
}

function throwTaskRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  if (message.includes("enterprise_version_conflict") || message.includes("enterprise_operation_in_progress")) {
    throw new Error("enterprise_version_conflict");
  }
  if (message.includes("enterprise_idempotency_conflict")) {
    throw new Error("invalid_operation_id");
  }
  if (message.includes("task_assignee_board_access_denied")) {
    throw new Error("task_assignee_board_access_denied");
  }
  if (message.includes("merchant_order_task_exists")) {
    throw new Error("merchant_order_task_exists");
  }
  for (const code of ["permission_denied", "task_not_found", "board_not_found"]) {
    if (message.includes(code)) throw new Error(code);
  }
  const invalidCode = message.match(/\b(invalid_task(?:_[a-z_]+)?)\b/i)?.[1];
  if (invalidCode) throw new Error(invalidCode.toLowerCase());
  throw new Error(`${operation}:${message}`);
}

function throwTaskCommentRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  if (message.includes("enterprise_operation_in_progress")) {
    throw new Error("enterprise_operation_in_progress");
  }
  if (message.includes("enterprise_idempotency_conflict")) {
    throw new Error("invalid_operation_id");
  }
  if (message.includes("permission_denied")) throw new Error("permission_denied");
  if (message.includes("task_not_found")) throw new Error("task_not_found");
  const invalidCode = message.match(/\b(invalid_task(?:_[a-z_]+)?)\b/i)?.[1];
  if (invalidCode) throw new Error(invalidCode.toLowerCase());
  throw new Error(`${operation}:${message}`);
}

function throwTaskChecklistRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  const knownCode = [
    "enterprise_version_conflict",
    "enterprise_operation_in_progress",
    "permission_denied",
    "task_not_found",
    "task_checklist_item_not_found",
    "task_checklist_limit_reached",
    "invalid_task_archived",
    "invalid_task_board",
    "invalid_task_actor",
    "invalid_task_checklist_payload",
    "invalid_task_checklist_create",
    "invalid_task_checklist_item",
    "invalid_task_checklist_update",
    "invalid_task_checklist_completed",
    "invalid_task_checklist_archived",
  ].find((code) => message.includes(code));
  if (knownCode) throw new Error(knownCode);
  if (message.includes("enterprise_idempotency_conflict")) {
    throw new Error("invalid_operation_id");
  }
  throw new Error(`${operation}:${message}`);
}

function throwEnterpriseNotificationRpcError(
  operation: string,
  error: unknown,
): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  for (const code of [
    "permission_denied",
    "invalid_notification_actor",
    "invalid_notification_request",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  throw new Error(`${operation}:${message}`);
}

function throwEnterpriseAuditRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  for (const code of [
    "permission_denied",
    "invalid_enterprise_audit_query",
    "invalid_enterprise_audit_cursor",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  throw new Error(`${operation}:${message}`);
}

function throwEnterpriseWorkflowRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  if (message.includes("invalid_workflow_step")) {
    throw new Error("invalid_workflow_payload");
  }
  for (const code of [
    "permission_denied",
    "workflow_not_found",
    "enterprise_version_conflict",
    "enterprise_operation_in_progress",
    "workflow_limit_reached",
    "workflow_publish_incomplete",
    "workflow_archived",
    "workflow_already_archived",
    "workflow_not_archived",
    "invalid_workflow_query",
    "invalid_workflow_cursor",
    "invalid_workflow_request",
    "invalid_workflow_action",
    "invalid_workflow_payload",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  if (message.includes("enterprise_idempotency_conflict")) {
    throw new Error("invalid_operation_id");
  }
  throw new Error(`${operation}:${message}`);
}

const MERCHANT_ENTERPRISE_TASK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MERCHANT_LINKED_ORDER_SOURCE_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

type MerchantEnterpriseMutationActorInput = {
  actorType: "owner" | "employee";
  actorId: string;
};

function normalizeMerchantEnterpriseMutationActor(
  input: { actorType: unknown; actorId: unknown },
) {
  const actorId = normalizeText(input.actorId, 80);
  if (
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    !MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_enterprise_actor");
  }
  return { actorType: input.actorType, actorId } as const;
}

function normalizeMerchantTaskMutationActor(
  input: { actorType: unknown; actorId: unknown },
  errorCode = "invalid_task_actor",
) {
  const actorId = normalizeText(input.actorId, 120);
  if (
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(actorId)
  ) {
    throw new Error(errorCode);
  }
  return { actorType: input.actorType, actorId } as const;
}

function normalizeTaskChecklistText(value: unknown, errorCode: string) {
  if (typeof value !== "string") throw new Error(errorCode);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH
  ) {
    throw new Error(errorCode);
  }
  return normalized;
}

const ENTERPRISE_WORKSPACE_CONFLICT_CODES = [
  "enterprise_version_conflict",
  "enterprise_operation_in_progress",
  "board_limit_reached",
  "column_limit_reached",
  "board_in_use",
  "column_in_use",
  "last_active_board",
  "last_active_column",
  "inactive_board",
  "inactive_column",
  "board_has_no_active_columns",
] as const;

function throwEnterpriseWorkspaceRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  if (message.includes("enterprise_idempotency_conflict")) {
    throw new Error("invalid_operation_id");
  }
  if (
    message.includes("invalid_enterprise_actor") ||
    message.includes("invalid_workspace_actor")
  ) {
    throw new Error("invalid_enterprise_actor");
  }
  if (
    [
      "permission_denied",
      "merchant_access_denied",
      "employee_not_found",
      "employee_account_disabled",
      "role_not_found",
      "role_inactive",
      "merchant_role_invalid",
    ].some((code) => message.includes(code))
  ) {
    throw new Error("permission_denied");
  }
  if (message.includes("column_not_found")) throw new Error("column_not_found");
  if (message.includes("board_not_found")) throw new Error("board_not_found");
  const conflictCode = ENTERPRISE_WORKSPACE_CONFLICT_CODES.find((code) =>
    message.includes(code),
  );
  if (conflictCode) throw new Error(conflictCode);
  const invalidCode = message.match(
    /\b(invalid_(?:site_id|enterprise_bootstrap(?:_[a-z_]+)?|board(?:_[a-z_]+)?|column(?:_[a-z_]+)?))\b/i,
  )?.[1];
  if (invalidCode) {
    throw new Error(
      invalidCode.toLowerCase() === "invalid_column_done_state"
        ? "invalid_column_is_done"
        : invalidCode.toLowerCase(),
    );
  }
  throw new Error(`${operation}:${message}`);
}

function resolveTaskOperationId(
  value: unknown,
  scope:
    | "create"
    | "update"
    | "move"
    | "comment"
    | "checklist-create"
    | "checklist-update",
) {
  const normalized = normalizeMutationOperationId(value);
  return normalized || `enterprise-task-${scope}:${randomUUID()}`;
}

function resolveWorkspaceOperationId(value: unknown, scope: string) {
  const normalized = normalizeMutationOperationId(value);
  return normalized || `enterprise-${scope}:${randomUUID()}`;
}

function normalizeOptionalPosition(value: unknown, errorCode: string) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_000_000
  ) {
    throw new Error(errorCode);
  }
  return value;
}

function normalizeTaskMutationResponse(value: unknown, operation: string) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const task = normalizeMerchantTask(record.task, record.assignee_ids);
  if (!task) throw new Error(`${operation}:invalid_response`);
  return task;
}

function normalizeBoardMutationResponse(value: unknown, operation: string) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const board = normalizeMerchantTaskBoard(record.board);
  if (!board) throw new Error(`${operation}:invalid_response`);
  return board;
}

function normalizeColumnMutationResponse(value: unknown, operation: string) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const column = normalizeMerchantTaskColumn(record.column);
  if (!column) throw new Error(`${operation}:invalid_response`);
  return column;
}

function normalizeRoleMutationResponse(value: unknown, operation: string) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const roleRecord =
    record.role && typeof record.role === "object" && !Array.isArray(record.role)
      ? (record.role as Record<string, unknown>)
      : {};
  const role = normalizeMerchantEnterpriseRole({
    ...roleRecord,
    allowed_board_ids: normalizeMerchantEnterpriseBoardIds(record.allowed_board_ids),
  });
  if (!role) throw new Error(`${operation}:invalid_response`);
  return role;
}

function normalizeEmployeeMutationResponse(value: unknown, operation: string) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const employee = normalizeMerchantEnterpriseEmployee(record.employee);
  if (!employee) throw new Error(`${operation}:invalid_response`);
  return employee;
}

function throwRoleRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  for (const code of [
    "enterprise_version_conflict",
    "permission_escalation_denied",
    "permission_denied",
    "role_board_access_in_use",
    "role_name_conflict",
    "role_not_found",
    "system_role_protected",
    "role_in_use",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  const invalidCode = message.match(/\b(invalid_role(?:_[a-z_]+)?)\b/i)?.[1];
  if (invalidCode) throw new Error(invalidCode.toLowerCase());
  if (message.includes("23505")) throw new Error("role_name_conflict");
  throw new Error(`${operation}:${message}`);
}

function throwEmployeeRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  for (const code of [
    "enterprise_version_conflict",
    "employee_not_found",
    "employee_open_tasks_require_resolution",
    "employee_offboarding_replacement_invalid",
    "employee_offboarding_scope_denied",
    "employee_role_transition_required",
    "employee_role_transition_replacement_invalid",
    "employee_role_transition_scope_denied",
    "permission_escalation_denied",
    "permission_denied",
    "employee_board_access_in_use",
    "employee_email_in_use",
  ]) {
    if (message.includes(code)) throw new Error(code);
  }
  const invalidCode = message.match(/\b(invalid_employee(?:_[a-z_]+)?)\b/i)?.[1];
  if (invalidCode) throw new Error(invalidCode.toLowerCase());
  if (
    message.includes("merchant_enterprise_employees_email_unique_idx") ||
    (message.includes("23505") && message.includes("email"))
  ) {
    throw new Error("employee_email_in_use");
  }
  throw new Error(`${operation}:${message}`);
}

function normalizeTaskEventMutationResponse(value: unknown, operation: string) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const event = normalizeMerchantTaskEvent(record.event);
  if (!event) throw new Error(`${operation}:invalid_response`);
  return event;
}

function normalizeChecklistTimestamp(value: unknown) {
  const normalized = normalizeText(value, 80);
  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : null;
}

function normalizeMerchantTaskChecklistItem(
  value: unknown,
): MerchantTaskChecklistItem | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(record.siteId ?? record.merchant_id, 80);
  const taskId = normalizeText(record.taskId ?? record.task_id, 80);
  const rawText = typeof record.text === "string" ? record.text.trim() : "";
  const text =
    rawText.length <= MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH ? rawText : "";
  const position = Number(record.position);
  const version = Number(record.version);
  const createdAt = normalizeChecklistTimestamp(record.createdAt ?? record.created_at);
  const updatedAt = normalizeChecklistTimestamp(record.updatedAt ?? record.updated_at);
  const completedAt = normalizeChecklistTimestamp(
    record.completedAt ?? record.completed_at,
  );
  const archivedAt = normalizeChecklistTimestamp(record.archivedAt ?? record.archived_at);
  if (
    !id ||
    !siteId ||
    !taskId ||
    !text ||
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    siteId,
    taskId,
    text,
    position,
    completed: completedAt !== null,
    completedAt,
    archivedAt,
    version,
    createdAt,
    updatedAt,
  };
}

function normalizeTaskChecklistMutationResponse(
  value: unknown,
  operation: string,
) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const item = normalizeMerchantTaskChecklistItem(record.item);
  if (!item) throw new Error(`${operation}:invalid_response`);
  return item;
}

function normalizeRows<T>(
  data: unknown,
  normalizer: (value: unknown) => T | null,
) {
  return (Array.isArray(data) ? data : [])
    .map(normalizer)
    .filter((item): item is T => Boolean(item));
}

async function selectMerchantRows(
  client: MerchantEnterpriseStoreClient,
  table: string,
  columns: string,
  siteId: string,
  orderBy = "created_at",
  stableOrderBy: string[] = ["id"],
) {
  const pageSize = 500;
  const maxPages = 20;
  const rows: unknown[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    let query = client
      .from(table)
      .select(columns)
      .eq("merchant_id", siteId)
      .order(orderBy, { ascending: true });
    stableOrderBy.forEach((column) => {
      if (column !== orderBy) query = query.order(column, { ascending: true });
    });
    const result = await query.range(page * pageSize, (page + 1) * pageSize - 1);
    if (result.error) throwStoreError(`${table}_read_failed`, result.error);
    const chunk = Array.isArray(result.data) ? result.data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) return rows;
  }
  throw new Error("enterprise_snapshot_limit_exceeded");
}

export async function loadMerchantEnterpriseSnapshot(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
): Promise<MerchantEnterpriseSnapshot> {
  const siteId = normalizeText(siteIdValue, 80);
  if (!siteId) throw new Error("invalid_site_id");

  const [roleRows, roleBoardRows, employeeRows, boardRows, columnRows, taskRows, assigneeRows] =
    await Promise.all([
      selectMerchantRows(client, "merchant_enterprise_roles", ROLE_COLUMNS, siteId),
      selectMerchantRows(
        client,
        "merchant_enterprise_role_boards",
        "merchant_id,role_id,board_id,created_at",
        siteId,
        "created_at",
        ["role_id", "board_id"],
      ),
      selectMerchantRows(client, "merchant_enterprise_employees", EMPLOYEE_COLUMNS, siteId),
      selectMerchantRows(client, "merchant_task_boards", BOARD_COLUMNS, siteId, "position"),
      selectMerchantRows(client, "merchant_task_columns", COLUMN_COLUMNS, siteId, "position"),
      selectMerchantRows(
        client,
        "merchant_tasks",
        TASK_COLUMNS,
        siteId,
        "position",
        ["created_at", "id"],
      ),
      selectMerchantRows(
        client,
        "merchant_task_assignees",
        "merchant_id,task_id,employee_id,assigned_at",
        siteId,
        "assigned_at",
        ["task_id", "employee_id"],
      ),
    ]);

  const boardIdsByRole = new Map<string, string[]>();
  roleBoardRows.forEach((row: unknown) => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const roleId = normalizeText(record.role_id, 80);
    const boardId = normalizeText(record.board_id, 80);
    if (!roleId || !boardId) return;
    const current = boardIdsByRole.get(roleId) ?? [];
    if (!current.includes(boardId)) current.push(boardId);
    boardIdsByRole.set(roleId, current);
  });

  const assigneesByTask = new Map<string, string[]>();
  assigneeRows.forEach((row: unknown) => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const taskId = normalizeText(record.task_id, 80);
    const employeeId = normalizeText(record.employee_id, 80);
    if (!taskId || !employeeId) return;
    const current = assigneesByTask.get(taskId) ?? [];
    if (!current.includes(employeeId)) current.push(employeeId);
    assigneesByTask.set(taskId, current);
  });

  return {
    roles: (Array.isArray(roleRows) ? roleRows : [])
      .map((row) => {
        const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return normalizeMerchantEnterpriseRole({
          ...record,
          allowed_board_ids: boardIdsByRole.get(normalizeText(record.id, 80)) ?? [],
        });
      })
      .filter((role): role is MerchantEnterpriseRole => Boolean(role)),
    employees: normalizeRows(employeeRows, normalizeMerchantEnterpriseEmployee),
    boards: normalizeRows(boardRows, normalizeMerchantTaskBoard).sort(
      (left, right) => left.position - right.position || left.id.localeCompare(right.id),
    ),
    columns: normalizeRows(columnRows, normalizeMerchantTaskColumn).sort(
      (left, right) =>
        left.boardId.localeCompare(right.boardId) ||
        left.position - right.position ||
        left.id.localeCompare(right.id),
    ),
    tasks: (Array.isArray(taskRows) ? taskRows : [])
      .map((row) => {
        const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return normalizeMerchantTask(row, assigneesByTask.get(normalizeText(record.id, 80)) ?? []);
      })
      .filter((item): item is MerchantTask => Boolean(item)),
  };
}

export async function loadMerchantTaskEvents(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
  taskIdValue: string,
): Promise<MerchantTaskEvent[]> {
  const siteId = normalizeText(siteIdValue, 80);
  const taskId = normalizeText(taskIdValue, 80);
  if (!siteId || !taskId) throw new Error("invalid_task_event_query");

  const result = await client
    .from("merchant_task_events")
    .select(TASK_EVENT_COLUMNS)
    .eq("merchant_id", siteId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (result.error) throwStoreError("enterprise_task_events_read_failed", result.error);
  return normalizeRows(result.data, normalizeMerchantTaskEvent);
}

function normalizeNotificationActor(input: {
  actorType: unknown;
  actorId: unknown;
}) {
  const actorId = normalizeText(input.actorId, 80);
  if (
    input.actorType !== "employee" ||
    !MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_notification_actor");
  }
  return { actorType: "employee" as const, actorId };
}

function normalizeNotificationCursor(
  value: MerchantEnterpriseNotificationCursor | null | undefined,
) {
  if (!value) return null;
  const id = normalizeText(value.id, 80);
  const createdAtText = normalizeText(value.createdAt, 80);
  if (
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(id) ||
    !createdAtText ||
    !Number.isFinite(Date.parse(createdAtText))
  ) {
    throw new Error("invalid_notification_cursor");
  }
  return {
    id,
    createdAt: new Date(createdAtText).toISOString(),
  };
}

export async function loadMerchantEnterpriseNotifications(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "employee";
    actorId: string;
    limit?: number;
    cursor?: MerchantEnterpriseNotificationCursor | null;
  },
): Promise<MerchantEnterpriseNotificationPage> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeNotificationActor(input);
  const requestedLimit = input.limit ?? 20;
  if (
    !/^\d{8}$/.test(siteId) ||
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > MAX_MERCHANT_ENTERPRISE_NOTIFICATION_PAGE_SIZE
  ) {
    throw new Error("invalid_notification_request");
  }
  const cursor = normalizeNotificationCursor(input.cursor);
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_notifications_v1",
    {
      p_input: {
        merchant_id: siteId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        limit: requestedLimit,
        cursor_created_at: cursor?.createdAt ?? null,
        cursor_id: cursor?.id ?? null,
      },
    },
  );
  if (result.error) {
    throwEnterpriseNotificationRpcError(
      "enterprise_notifications_read_failed",
      result.error,
    );
  }

  const response =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : null;
  const rows = response && Array.isArray(response.notifications)
    ? response.notifications
    : null;
  if (!response || !rows || rows.length > requestedLimit + 1) {
    throw new Error("enterprise_notifications_read_failed:invalid_response");
  }
  const normalizedRows = rows.map(normalizeMerchantEnterpriseNotification);
  if (normalizedRows.some((notification) => !notification)) {
    throw new Error("enterprise_notifications_read_failed:invalid_response");
  }
  const allNotifications = normalizedRows as MerchantEnterpriseNotification[];
  const hasMore = allNotifications.length > requestedLimit;
  const notifications = allNotifications.slice(0, requestedLimit);
  const lastNotification = notifications.at(-1) ?? null;
  const unreadCountValue = Number(response.unread_count);
  const unreadCount =
    Number.isSafeInteger(unreadCountValue) && unreadCountValue >= 0
      ? unreadCountValue
      : 0;
  return {
    notifications,
    unreadCount,
    nextCursor:
      hasMore && lastNotification
        ? { createdAt: lastNotification.createdAt, id: lastNotification.id }
        : null,
  };
}

function normalizeAuditActor(input: {
  actorType: unknown;
  actorId: unknown;
}) {
  const actorId = normalizeText(input.actorId, 80);
  if (
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    !MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_enterprise_audit_query");
  }
  return { actorType: input.actorType, actorId } as const;
}

function normalizeAuditCursor(
  value: MerchantEnterpriseAuditCursor | null | undefined,
) {
  if (!value) return null;
  const beforeId = normalizeText(value.beforeId, 80);
  const beforeCreatedAtText = normalizeText(value.beforeCreatedAt, 80);
  if (
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(beforeId) ||
    !beforeCreatedAtText ||
    !Number.isFinite(Date.parse(beforeCreatedAtText))
  ) {
    throw new Error("invalid_enterprise_audit_cursor");
  }
  return {
    beforeId,
    beforeCreatedAt: new Date(beforeCreatedAtText).toISOString(),
  };
}

function normalizeAuditResponseCursor(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("enterprise_audit_read_failed:invalid_response");
  }
  const record = value as Record<string, unknown>;
  try {
    return normalizeAuditCursor({
      beforeCreatedAt: normalizeText(
        record.beforeCreatedAt ?? record.before_created_at,
        80,
      ),
      beforeId: normalizeText(record.beforeId ?? record.before_id, 80),
    });
  } catch {
    throw new Error("enterprise_audit_read_failed:invalid_response");
  }
}

export async function loadMerchantEnterpriseAuditEvents(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "owner" | "employee";
    actorId: string;
    limit?: number;
    cursor?: MerchantEnterpriseAuditCursor | null;
    entityType?: MerchantEnterpriseAuditEntityType;
    eventType?: MerchantEnterpriseAuditEventType;
  },
): Promise<MerchantEnterpriseAuditPage> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeAuditActor(input);
  const requestedLimit = input.limit ?? 50;
  const entityType = input.entityType;
  const eventType = input.eventType;
  if (
    !/^\d{8}$/.test(siteId) ||
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > MAX_MERCHANT_ENTERPRISE_AUDIT_PAGE_SIZE ||
    (entityType !== undefined &&
      !MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES.includes(entityType)) ||
    (eventType !== undefined &&
      !MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES.includes(eventType))
  ) {
    throw new Error("invalid_enterprise_audit_query");
  }
  const cursor = normalizeAuditCursor(input.cursor);
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_audit_events_v1",
    {
      p_input: {
        merchant_id: siteId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        limit: requestedLimit,
        ...(entityType ? { entity_type: entityType } : {}),
        ...(eventType ? { event_type: eventType } : {}),
        ...(cursor
          ? {
              before_created_at: cursor.beforeCreatedAt,
              before_id: cursor.beforeId,
            }
          : {}),
      },
    },
  );
  if (result.error) {
    throwEnterpriseAuditRpcError("enterprise_audit_read_failed", result.error);
  }

  const response =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : null;
  const rows = response && Array.isArray(response.events) ? response.events : null;
  if (!response || !rows || rows.length > requestedLimit) {
    throw new Error("enterprise_audit_read_failed:invalid_response");
  }
  const normalized = rows.map(normalizeMerchantEnterpriseAuditEvent);
  if (normalized.some((event) => !event)) {
    throw new Error("enterprise_audit_read_failed:invalid_response");
  }
  const events = normalized as MerchantEnterpriseAuditEvent[];
  if (
    events.some((event) => event.siteId !== siteId) ||
    new Set(events.map((event) => event.id)).size !== events.length
  ) {
    throw new Error("enterprise_audit_read_failed:invalid_response");
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (
      previous.createdAt < current.createdAt ||
      (previous.createdAt === current.createdAt && previous.id < current.id)
    ) {
      throw new Error("enterprise_audit_read_failed:invalid_response");
    }
  }

  const nextCursor = normalizeAuditResponseCursor(
    response.nextCursor ?? response.next_cursor,
  );
  const lastEvent = events.at(-1) ?? null;
  if (
    nextCursor &&
    (events.length !== requestedLimit ||
      !lastEvent ||
      nextCursor.beforeCreatedAt !== lastEvent.createdAt ||
      nextCursor.beforeId !== lastEvent.id)
  ) {
    throw new Error("enterprise_audit_read_failed:invalid_response");
  }
  return { events, nextCursor };
}

export async function markMerchantEnterpriseNotificationsRead(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "employee";
    actorId: string;
    notificationId?: string;
    all?: boolean;
  },
): Promise<{ markedCount: number; unreadCount: number }> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeNotificationActor(input);
  const notificationId = normalizeText(input.notificationId, 80);
  const markAll = input.all === true;
  if (
    !/^\d{8}$/.test(siteId) ||
    (markAll === Boolean(notificationId)) ||
    (notificationId && !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(notificationId))
  ) {
    throw new Error("invalid_notification_request");
  }
  const result = await client.rpc(
    "faolla_mark_merchant_enterprise_notifications_read_v1",
    {
      p_input: {
        merchant_id: siteId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        mark_all: markAll,
        notification_id: notificationId || null,
      },
    },
  );
  if (result.error) {
    throwEnterpriseNotificationRpcError(
      "enterprise_notifications_mark_read_failed",
      result.error,
    );
  }
  const response =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const markedCountValue = Number(response.marked_count);
  const unreadCountValue = Number(response.unread_count);
  return {
    markedCount:
      Number.isSafeInteger(markedCountValue) && markedCountValue >= 0
        ? markedCountValue
        : 0,
    unreadCount:
      Number.isSafeInteger(unreadCountValue) && unreadCountValue >= 0
        ? unreadCountValue
        : 0,
  };
}

export async function loadMerchantTaskBoardIdForAccess(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
  taskIdValue: string,
) {
  const siteId = normalizeText(siteIdValue, 80);
  const taskId = normalizeText(taskIdValue, 80);
  if (!siteId || !taskId) throw new Error("invalid_task_query");
  const result = await client
    .from("merchant_tasks")
    .select("board_id")
    .eq("merchant_id", siteId)
    .eq("id", taskId)
    .limit(1)
    .maybeSingle();
  if (result.error) throwStoreError("enterprise_task_access_check_failed", result.error);
  const boardId = normalizeText(result.data?.board_id, 80);
  if (!boardId) throw new Error("task_not_found");
  return boardId;
}

export async function authorizeMerchantLinkedOrderSummarySource(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    taskId: string;
    employeeId: string;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(taskId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(employeeId)
  ) {
    throw new Error("invalid_linked_order_summary_query");
  }

  const result = await client.rpc(
    "faolla_authorize_merchant_linked_order_summary_v1",
    {
      p_input: {
        merchant_id: siteId,
        task_id: taskId,
        employee_id: employeeId,
      },
    },
  );
  if (result.error) {
    if (isMerchantEnterpriseSchemaMissingError(result.error)) {
      throw new Error("enterprise_schema_unavailable");
    }
    const message = toErrorMessage(result.error);
    if (message.includes("task_not_found")) throw new Error("task_not_found");
    throw new Error(`enterprise_linked_order_summary_authorization_failed:${message}`);
  }

  const record =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const sourceId = normalizeText(record.source_id, 200);
  if (!MERCHANT_LINKED_ORDER_SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error(
      "enterprise_linked_order_summary_authorization_failed:invalid_response",
    );
  }
  return sourceId;
}

export async function loadMerchantTaskBySource(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
  sourceTypeValue: string,
  sourceIdValue: string,
): Promise<MerchantTask | null> {
  const siteId = normalizeText(siteIdValue, 80);
  const sourceType = normalizeText(sourceTypeValue, 80);
  const sourceId = normalizeText(sourceIdValue, 200);
  if (!siteId || !sourceType || !sourceId) {
    throw new Error("invalid_task_source_query");
  }

  const taskResult = await client
    .from("merchant_tasks")
    .select(TASK_COLUMNS)
    .eq("merchant_id", siteId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (taskResult.error) {
    throwStoreError("enterprise_task_source_read_failed", taskResult.error);
  }
  if (!taskResult.data) return null;

  const taskId = normalizeText(taskResult.data.id, 80);
  if (!taskId) {
    throw new Error("enterprise_task_source_read_failed:invalid_response");
  }
  const assigneeResult = await client
    .from("merchant_task_assignees")
    .select("employee_id")
    .eq("merchant_id", siteId)
    .eq("task_id", taskId)
    .order("employee_id", { ascending: true })
    .limit(MAX_MERCHANT_TASK_ASSIGNEES);
  if (assigneeResult.error) {
    throwStoreError("enterprise_task_source_assignees_read_failed", assigneeResult.error);
  }
  const assigneeIds = (Array.isArray(assigneeResult.data) ? assigneeResult.data : [])
    .map((row: unknown) => {
      const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return normalizeText(record.employee_id, 80);
    })
    .filter(Boolean);
  const task = normalizeMerchantTask(taskResult.data, assigneeIds);
  if (!task || task.siteId !== siteId || task.sourceType !== sourceType || task.sourceId !== sourceId) {
    throw new Error("enterprise_task_source_read_failed:invalid_response");
  }
  return task;
}

export async function loadMerchantTaskChecklistItems(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
  taskIdValue: string,
): Promise<MerchantTaskChecklistItem[]> {
  const siteId = normalizeText(siteIdValue, 80);
  const taskId = normalizeText(taskIdValue, 80);
  if (!/^\d{8}$/.test(siteId) || !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(taskId)) {
    throw new Error("invalid_task_checklist_query");
  }

  const result = await client
    .from("merchant_task_checklist_items")
    .select(TASK_CHECKLIST_ITEM_COLUMNS)
    .eq("merchant_id", siteId)
    .eq("task_id", taskId)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_MERCHANT_TASK_CHECKLIST_ITEMS);
  if (result.error) {
    throwStoreError("enterprise_task_checklist_read_failed", result.error);
  }
  return normalizeRows(result.data, normalizeMerchantTaskChecklistItem).filter(
    (item) =>
      item.siteId === siteId &&
      item.taskId === taskId &&
      item.archivedAt === null,
  );
}

export async function bootstrapMerchantEnterpriseWorkspace(
  client: MerchantEnterpriseStoreClient,
  input: MerchantEnterpriseMutationActorInput & {
    siteId: string;
    operationId?: string;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  if (!siteId) throw new Error("invalid_site_id");
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const result = await client.rpc("faolla_bootstrap_merchant_enterprise_v2", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: resolveWorkspaceOperationId(
        input.operationId,
        "workspace-bootstrap",
      ),
    },
  });
  if (result.error) {
    throwEnterpriseWorkspaceRpcError("enterprise_bootstrap_failed", result.error);
  }
  return loadMerchantEnterpriseSnapshot(client, siteId);
}

export async function merchantEnterpriseWorkspaceNeedsBootstrap(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
) {
  const siteId = normalizeText(siteIdValue, 80);
  if (!siteId) throw new Error("invalid_site_id");
  const [roleResult, boardResult] = await Promise.all([
    client
      .from("merchant_enterprise_roles")
      .select("system_key")
      .eq("merchant_id", siteId)
      .in("system_key", [...DEFAULT_ROLE_SYSTEM_KEYS]),
    client
      .from("merchant_task_boards")
      .select("id,system_key")
      .eq("merchant_id", siteId)
      .eq("system_key", "default")
      .limit(1)
      .maybeSingle(),
  ]);
  if (roleResult.error) throwStoreError("enterprise_roles_bootstrap_check_failed", roleResult.error);
  if (boardResult.error) throwStoreError("enterprise_board_bootstrap_check_failed", boardResult.error);

  const roleKeys = new Set(
    (Array.isArray(roleResult.data) ? roleResult.data : [])
      .map((row: { system_key?: unknown }) => normalizeText(row.system_key, 80))
      .filter(Boolean),
  );
  const boardId = normalizeText(boardResult.data?.id, 80);
  if (DEFAULT_ROLE_SYSTEM_KEYS.some((key) => !roleKeys.has(key)) || !boardId) {
    return true;
  }

  const columnResult = await client
    .from("merchant_task_columns")
    .select("system_key")
    .eq("merchant_id", siteId)
    .eq("board_id", boardId)
    .in("system_key", [...DEFAULT_COLUMN_SYSTEM_KEYS]);
  if (columnResult.error) {
    throwStoreError("enterprise_columns_bootstrap_check_failed", columnResult.error);
  }
  const columnKeys = new Set(
    (Array.isArray(columnResult.data) ? columnResult.data : [])
      .map((row: { system_key?: unknown }) => normalizeText(row.system_key, 80))
      .filter(Boolean),
  );
  return DEFAULT_COLUMN_SYSTEM_KEYS.some((key) => !columnKeys.has(key));
}

export async function createMerchantTaskBoard(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "owner" | "employee";
    actorId: string;
    name: string;
    description?: string;
    position?: number;
    operationId?: string;
  },
): Promise<{ board: MerchantTaskBoard; columns: MerchantTaskColumn[] }> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const name = normalizeText(input.name, 120);
  const position = normalizeOptionalPosition(input.position, "invalid_board_position");
  if (!siteId || !name) throw new Error("invalid_board");
  const result = await client.rpc("faolla_create_merchant_task_board_v1", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      name,
      description: normalizeText(input.description, 2000),
      ...(position !== undefined ? { position } : {}),
      operation_id: resolveWorkspaceOperationId(
        input.operationId,
        "board-create",
      ),
    },
  });
  if (result.error) {
    throwEnterpriseWorkspaceRpcError("enterprise_board_create_failed", result.error);
  }
  const board = normalizeBoardMutationResponse(
    result.data,
    "enterprise_board_create_failed",
  );
  const record =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : {};
  const columnRows = Array.isArray(record.columns) ? record.columns : [];
  const columns = normalizeRows(columnRows, normalizeMerchantTaskColumn).sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
  if (columns.length !== columnRows.length || columns.length === 0) {
    throw new Error("enterprise_board_create_failed:invalid_response");
  }
  return { board, columns };
}

export async function updateMerchantTaskBoard(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "owner" | "employee";
    actorId: string;
    boardId: string;
    version: number;
    name?: string;
    description?: string;
    status?: "active" | "archived";
    position?: number;
    operationId?: string;
  },
): Promise<MerchantTaskBoard> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const boardId = normalizeText(input.boardId, 80);
  const version = Number(input.version);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeText(input.name, 120);
  if (input.description !== undefined) {
    patch.description = normalizeText(input.description, 2000);
  }
  if (input.status === "active" || input.status === "archived") {
    patch.status = input.status;
  }
  const position = normalizeOptionalPosition(input.position, "invalid_board_position");
  if (position !== undefined) patch.position = position;
  if (
    !siteId ||
    !boardId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    Object.keys(patch).length === 0
  ) {
    throw new Error("invalid_board_update");
  }
  const result = await client.rpc("faolla_update_merchant_task_board_v1", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      board_id: boardId,
      expected_version: version,
      operation_id: resolveWorkspaceOperationId(
        input.operationId,
        "board-update",
      ),
      ...patch,
    },
  });
  if (result.error) {
    throwEnterpriseWorkspaceRpcError("enterprise_board_update_failed", result.error);
  }
  return normalizeBoardMutationResponse(
    result.data,
    "enterprise_board_update_failed",
  );
}

export async function createMerchantTaskColumn(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "owner" | "employee";
    actorId: string;
    boardId: string;
    name: string;
    color?: string;
    isDone?: boolean;
    position?: number;
    operationId?: string;
  },
): Promise<MerchantTaskColumn> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const boardId = normalizeText(input.boardId, 80);
  const name = normalizeText(input.name, 80);
  const color = normalizeText(input.color, 40) || "#64748b";
  const position = normalizeOptionalPosition(input.position, "invalid_column_position");
  if (
    !siteId ||
    !boardId ||
    !name ||
    !/^#[0-9a-f]{6}$/i.test(color) ||
    (input.isDone !== undefined && typeof input.isDone !== "boolean")
  ) {
    throw new Error("invalid_column");
  }
  const result = await client.rpc("faolla_create_merchant_task_column_v1", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      board_id: boardId,
      name,
      color,
      is_done: input.isDone === true,
      ...(position !== undefined ? { position } : {}),
      operation_id: resolveWorkspaceOperationId(
        input.operationId,
        "column-create",
      ),
    },
  });
  if (result.error) {
    throwEnterpriseWorkspaceRpcError("enterprise_column_create_failed", result.error);
  }
  return normalizeColumnMutationResponse(
    result.data,
    "enterprise_column_create_failed",
  );
}

export async function updateMerchantTaskColumn(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    actorType: "owner" | "employee";
    actorId: string;
    boardId: string;
    columnId: string;
    version: number;
    name?: string;
    color?: string;
    isDone?: boolean;
    status?: "active" | "archived";
    position?: number;
    operationId?: string;
  },
): Promise<MerchantTaskColumn> {
  const siteId = normalizeText(input.siteId, 80);
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const boardId = normalizeText(input.boardId, 80);
  const columnId = normalizeText(input.columnId, 80);
  const version = Number(input.version);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeText(input.name, 80);
  if (input.color !== undefined) {
    const color = normalizeText(input.color, 40);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("invalid_column_color");
    patch.color = color;
  }
  if (input.isDone !== undefined) {
    if (typeof input.isDone !== "boolean") throw new Error("invalid_column_is_done");
    patch.is_done = input.isDone;
  }
  if (input.status === "active" || input.status === "archived") {
    patch.status = input.status;
  }
  const position = normalizeOptionalPosition(input.position, "invalid_column_position");
  if (position !== undefined) patch.position = position;
  if (
    !siteId ||
    !boardId ||
    !columnId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    Object.keys(patch).length === 0
  ) {
    throw new Error("invalid_column_update");
  }
  const result = await client.rpc("faolla_update_merchant_task_column_v1", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      board_id: boardId,
      column_id: columnId,
      expected_version: version,
      operation_id: resolveWorkspaceOperationId(
        input.operationId,
        "column-update",
      ),
      ...patch,
    },
  });
  if (result.error) {
    throwEnterpriseWorkspaceRpcError("enterprise_column_update_failed", result.error);
  }
  return normalizeColumnMutationResponse(
    result.data,
    "enterprise_column_update_failed",
  );
}

export async function createMerchantEnterpriseRole(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    name: string;
    description?: string;
    permissions?: unknown;
    accessScope: MerchantEnterpriseBoardAccessScope;
    allowedBoardIds: string[];
    actorType: "owner" | "employee";
    actorId: string;
  },
): Promise<MerchantEnterpriseRole> {
  const siteId = normalizeText(input.siteId, 80);
  const name = normalizeText(input.name, 80);
  const actorId = normalizeText(input.actorId, 120);
  if (!siteId || !name) throw new Error("invalid_role");
  if ((input.actorType !== "owner" && input.actorType !== "employee") || !actorId) {
    throw new Error("invalid_role_actor");
  }
  const result = await client.rpc("faolla_create_merchant_enterprise_role_v2", {
    p_input: {
      merchant_id: siteId,
      name,
      description: normalizeText(input.description, 1000),
      permissions: normalizeMerchantEnterprisePermissions(input.permissions),
      access_scope: input.accessScope,
      allowed_board_ids: input.accessScope === "all" ? [] : input.allowedBoardIds,
      actor_type: input.actorType,
      actor_id: actorId,
    },
  });
  if (result.error) throwRoleRpcError("enterprise_role_create_failed", result.error);
  return normalizeRoleMutationResponse(result.data, "enterprise_role_create_failed");
}

export async function updateMerchantEnterpriseRole(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    roleId: string;
    version: number;
    name?: string;
    description?: string;
    permissions?: unknown;
    accessScope?: MerchantEnterpriseBoardAccessScope;
    allowedBoardIds?: string[];
    status?: "active" | "archived";
    actorType: "owner" | "employee";
    actorId: string;
  },
): Promise<MerchantEnterpriseRole> {
  const siteId = normalizeText(input.siteId, 80);
  const roleId = normalizeText(input.roleId, 80);
  const actorId = normalizeText(input.actorId, 120);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = normalizeText(input.name, 80);
  if (input.description !== undefined) patch.description = normalizeText(input.description, 1000);
  if (input.permissions !== undefined) {
    patch.permissions = normalizeMerchantEnterprisePermissions(input.permissions);
  }
  if (input.accessScope !== undefined) {
    patch.access_scope = input.accessScope;
    patch.allowed_board_ids =
      input.accessScope === "all" ? [] : (input.allowedBoardIds ?? []);
  }
  if (input.status === "active" || input.status === "archived") patch.status = input.status;
  if (!siteId || !roleId || Object.keys(patch).length === 0) throw new Error("invalid_role_update");
  if ((input.actorType !== "owner" && input.actorType !== "employee") || !actorId) {
    throw new Error("invalid_role_actor");
  }
  const result = await client.rpc("faolla_update_merchant_enterprise_role_v2", {
    p_input: {
      merchant_id: siteId,
      role_id: roleId,
      expected_version: Math.max(1, Math.round(Number(input.version) || 1)),
      actor_type: input.actorType,
      actor_id: actorId,
      ...patch,
    },
  });
  if (result.error) throwRoleRpcError("enterprise_role_update_failed", result.error);
  return normalizeRoleMutationResponse(result.data, "enterprise_role_update_failed");
}

export async function createMerchantEnterpriseEmployee(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    email: string;
    displayName: string;
    roleId: string;
    actorType: "owner" | "employee";
    actorId: string;
  },
): Promise<MerchantEnterpriseEmployee> {
  const siteId = normalizeText(input.siteId, 80);
  const email = normalizeAuthEmail(input.email);
  const displayName = normalizeText(input.displayName, 120);
  const roleId = normalizeText(input.roleId, 80);
  const actorId = normalizeText(input.actorId, 80);
  if (!siteId || !displayName) throw new Error("invalid_employee");
  if (!isValidAuthEmail(email)) throw new Error("invalid_employee_email");
  if (!roleId) throw new Error("invalid_employee_role");
  if ((input.actorType !== "owner" && input.actorType !== "employee") || !actorId) {
    throw new Error("invalid_employee_actor");
  }
  const result = await client.rpc("faolla_create_merchant_enterprise_employee_v1", {
    p_input: {
      merchant_id: siteId,
      email,
      display_name: displayName,
      role_id: roleId,
      actor_type: input.actorType,
      actor_id: actorId,
    },
  });
  if (result.error) throwEmployeeRpcError("enterprise_employee_create_failed", result.error);
  return normalizeEmployeeMutationResponse(result.data, "enterprise_employee_create_failed");
}

export type MerchantEnterpriseEmployeeOffboardingMode = "unassign" | "reassign";
export type MerchantEnterpriseEmployeeRoleTransitionMode = "unassign" | "reassign";

export async function updateMerchantEnterpriseEmployee(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
    displayName?: string;
    roleId?: string;
    status?: MerchantEnterpriseEmployeeStatus;
    offboardingMode?: MerchantEnterpriseEmployeeOffboardingMode;
    roleVersion?: number;
    roleTransitionMode?: MerchantEnterpriseEmployeeRoleTransitionMode;
    replacementEmployeeId?: string;
    actorType: "owner" | "employee";
    actorId: string;
  },
): Promise<MerchantEnterpriseEmployee> {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const actorId = normalizeText(input.actorId, 80);
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) {
    const displayName = normalizeText(input.displayName, 120);
    if (!displayName) throw new Error("invalid_employee");
    patch.display_name = displayName;
  }
  if (input.roleId !== undefined) {
    const roleId = normalizeText(input.roleId, 80);
    if (!roleId) throw new Error("invalid_employee_role");
    patch.role_id = roleId;
  }
  if (input.status !== undefined) {
    if (!["invited", "active", "disabled"].includes(input.status)) {
      throw new Error("invalid_employee_status");
    }
    patch.status = input.status;
  }

  const offboardingMode = input.offboardingMode;
  const roleTransitionMode = input.roleTransitionMode;
  const replacementEmployeeId = normalizeText(input.replacementEmployeeId, 80);
  const hasRoleTransition =
    input.roleVersion !== undefined || roleTransitionMode !== undefined;
  if (offboardingMode !== undefined && roleTransitionMode !== undefined) {
    throw new Error("invalid_employee_role_transition");
  }
  if (
    (offboardingMode !== undefined &&
      offboardingMode !== "unassign" &&
      offboardingMode !== "reassign") ||
    (offboardingMode !== undefined && input.status !== "disabled") ||
    (offboardingMode === "unassign" && Boolean(replacementEmployeeId)) ||
    (offboardingMode === "reassign" && !replacementEmployeeId)
  ) {
    throw new Error("invalid_employee_offboarding");
  }
  if (
    offboardingMode === "reassign" &&
    replacementEmployeeId === employeeId
  ) {
    throw new Error("employee_offboarding_replacement_invalid");
  }
  if (
    input.replacementEmployeeId !== undefined &&
    offboardingMode === undefined &&
    roleTransitionMode === undefined &&
    input.status === "disabled"
  ) {
    throw new Error("invalid_employee_offboarding");
  }
  if (offboardingMode !== undefined) patch.offboarding_mode = offboardingMode;

  if (
    (hasRoleTransition && input.roleId === undefined) ||
    (input.roleId !== undefined &&
      (!Number.isSafeInteger(input.roleVersion) || Number(input.roleVersion) < 1)) ||
    (roleTransitionMode !== undefined &&
      roleTransitionMode !== "unassign" &&
      roleTransitionMode !== "reassign") ||
    (roleTransitionMode === "unassign" && Boolean(replacementEmployeeId)) ||
    (roleTransitionMode === "reassign" && !replacementEmployeeId) ||
    (input.replacementEmployeeId !== undefined &&
      offboardingMode === undefined &&
      roleTransitionMode !== "reassign")
  ) {
    throw new Error("invalid_employee_role_transition");
  }
  if (
    roleTransitionMode === "reassign" &&
    replacementEmployeeId === employeeId
  ) {
    throw new Error("employee_role_transition_replacement_invalid");
  }
  if (input.roleId !== undefined) {
    patch.expected_role_version = input.roleVersion;
  }
  if (roleTransitionMode !== undefined) {
    patch.role_transition_mode = roleTransitionMode;
  }
  if (replacementEmployeeId) patch.replacement_employee_id = replacementEmployeeId;

  if (!siteId || !employeeId || Object.keys(patch).length === 0) {
    throw new Error("invalid_employee_update");
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error("invalid_version");
  }
  if ((input.actorType !== "owner" && input.actorType !== "employee") || !actorId) {
    throw new Error("invalid_employee_actor");
  }
  const result = await client.rpc("faolla_update_merchant_enterprise_employee_v1", {
    p_input: {
      merchant_id: siteId,
      employee_id: employeeId,
      expected_version: input.version,
      actor_type: input.actorType,
      actor_id: actorId,
      ...patch,
    },
  });
  if (result.error) throwEmployeeRpcError("enterprise_employee_update_failed", result.error);
  return normalizeEmployeeMutationResponse(result.data, "enterprise_employee_update_failed");
}

export type CreateMerchantTaskInput = {
  siteId: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  priority?: MerchantTaskPriority;
  dueAt?: string | null;
  position?: number;
  sourceType?: string;
  sourceId?: string;
  createdByEmployeeId?: string;
  assigneeIds?: string[];
  actorType: "owner" | "employee";
  actorId: string;
  operationId?: string;
};

export async function createMerchantTask(
  client: MerchantEnterpriseStoreClient,
  input: CreateMerchantTaskInput,
): Promise<MerchantTask> {
  const siteId = normalizeText(input.siteId, 80);
  const boardId = normalizeText(input.boardId, 80);
  const columnId = normalizeText(input.columnId, 80);
  const title = normalizeText(input.title, 240);
  if (!siteId || !boardId || !columnId || !title) throw new Error("invalid_task");
  const priority: MerchantTaskPriority =
    input.priority === "low" || input.priority === "high" || input.priority === "urgent"
      ? input.priority
      : "normal";
  const requestedAssigneeIds = input.assigneeIds ?? [];
  if (requestedAssigneeIds.length > MAX_MERCHANT_TASK_ASSIGNEES) {
    throw new Error("invalid_task_assignees");
  }
  const assigneeIds = Array.from(
    new Set(requestedAssigneeIds.map((item) => normalizeText(item, 80)).filter(Boolean)),
  ).sort();
  const actor = normalizeMerchantTaskMutationActor(input);
  const operationId = resolveTaskOperationId(input.operationId, "create");
  const result = await client.rpc("faolla_create_merchant_task_v1", {
    p_input: {
      merchant_id: siteId,
      board_id: boardId,
      column_id: columnId,
      title,
      description: normalizeText(input.description, 10000),
      priority,
      due_at: normalizeText(input.dueAt, 80) || null,
      ...(input.position !== undefined
        ? { position: Math.max(0, Math.round(Number(input.position) || 0)) }
        : {}),
      source_type: normalizeText(input.sourceType, 80),
      source_id: normalizeText(input.sourceId, 200),
      created_by_employee_id: normalizeText(input.createdByEmployeeId, 80) || null,
      assignee_ids: assigneeIds,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: operationId,
      event_payload: { columnId, priority, assigneeIds },
    },
  });
  if (result.error) throwTaskRpcError("enterprise_task_create_failed", result.error);
  return normalizeTaskMutationResponse(result.data, "enterprise_task_create_failed");
}

export async function createOrGetMerchantOrderTask(
  client: MerchantEnterpriseStoreClient,
  input: Omit<CreateMerchantTaskInput, "sourceType" | "sourceId"> & {
    orderId: string;
  },
): Promise<{ task: MerchantTask; created: boolean }> {
  const siteId = normalizeText(input.siteId, 80);
  const orderId = normalizeText(input.orderId, 200);
  if (!siteId || !orderId) throw new Error("invalid_task_source");
  normalizeMerchantTaskMutationActor(input);

  const existing = await loadMerchantTaskBySource(client, siteId, "order", orderId);
  if (existing) return { task: existing, created: false };

  try {
    const task = await createMerchantTask(client, {
      ...input,
      siteId,
      sourceType: "order",
      sourceId: orderId,
    });
    return { task, created: true };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "merchant_order_task_exists") {
      throw error;
    }
    const concurrent = await loadMerchantTaskBySource(client, siteId, "order", orderId);
    if (concurrent) return { task: concurrent, created: false };
    throw error;
  }
}

export async function addMerchantTaskComment(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    taskId: string;
    text: string;
    actorType: Exclude<MerchantTaskEventActorType, "system">;
    actorId: string;
    operationId?: string;
  },
): Promise<MerchantTaskEvent> {
  const siteId = normalizeText(input.siteId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const commentText = normalizeText(input.text, 2000);
  const actor = normalizeMerchantTaskMutationActor(input, "invalid_task_comment");
  if (
    !siteId ||
    !taskId ||
    !commentText ||
    input.text.trim().length > 2000 ||
    (input.actorType !== "owner" && input.actorType !== "employee")
  ) {
    throw new Error("invalid_task_comment");
  }
  const result = await client.rpc("faolla_add_merchant_task_comment_v1", {
    p_input: {
      merchant_id: siteId,
      task_id: taskId,
      text: commentText,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: resolveTaskOperationId(input.operationId, "comment"),
    },
  });
  if (result.error) {
    throwTaskCommentRpcError("enterprise_task_comment_failed", result.error);
  }
  return normalizeTaskEventMutationResponse(
    result.data,
    "enterprise_task_comment_failed",
  );
}

export async function createMerchantTaskChecklistItem(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    taskId: string;
    text: string;
    actorType: Exclude<MerchantTaskEventActorType, "system">;
    actorId: string;
    operationId?: string;
  },
): Promise<MerchantTaskChecklistItem> {
  const siteId = normalizeText(input.siteId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const actor = normalizeMerchantTaskMutationActor(
    input,
    "invalid_task_checklist_create",
  );
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(taskId) ||
    (input.actorType !== "owner" && input.actorType !== "employee")
  ) {
    throw new Error("invalid_task_checklist_create");
  }
  const itemText = normalizeTaskChecklistText(
    input.text,
    "invalid_task_checklist_create",
  );
  const result = await client.rpc(
    "faolla_create_merchant_task_checklist_item_v1",
    {
      p_input: {
        merchant_id: siteId,
        task_id: taskId,
        text: itemText,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        operation_id: resolveTaskOperationId(
          input.operationId,
          "checklist-create",
        ),
      },
    },
  );
  if (result.error) {
    throwTaskChecklistRpcError(
      "enterprise_task_checklist_create_failed",
      result.error,
    );
  }
  return normalizeTaskChecklistMutationResponse(
    result.data,
    "enterprise_task_checklist_create_failed",
  );
}

export async function updateMerchantTaskChecklistItem(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    taskId: string;
    itemId: string;
    version: number;
    actorType: Exclude<MerchantTaskEventActorType, "system">;
    actorId: string;
    operationId?: string;
    text?: string;
    completed?: boolean;
    archived?: boolean;
  },
): Promise<MerchantTaskChecklistItem> {
  const siteId = normalizeText(input.siteId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const itemId = normalizeText(input.itemId, 80);
  const actor = normalizeMerchantTaskMutationActor(
    input,
    "invalid_task_checklist_update",
  );
  const version = Number(input.version);
  const hasText = input.text !== undefined;
  const hasCompleted = input.completed !== undefined;
  const hasArchived = input.archived !== undefined;
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(taskId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(itemId) ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    (!hasText && !hasCompleted && !hasArchived) ||
    (hasCompleted && typeof input.completed !== "boolean") ||
    (hasArchived && typeof input.archived !== "boolean")
  ) {
    throw new Error("invalid_task_checklist_update");
  }

  const patch: Record<string, unknown> = {};
  if (hasText) {
    patch.text = normalizeTaskChecklistText(
      input.text,
      "invalid_task_checklist_item",
    );
  }
  if (hasCompleted) patch.completed = input.completed;
  if (hasArchived) patch.archived = input.archived;

  const result = await client.rpc(
    "faolla_update_merchant_task_checklist_item_v1",
    {
      p_input: {
        merchant_id: siteId,
        task_id: taskId,
        item_id: itemId,
        expected_version: version,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        operation_id: resolveTaskOperationId(
          input.operationId,
          "checklist-update",
        ),
        ...patch,
      },
    },
  );
  if (result.error) {
    throwTaskChecklistRpcError(
      "enterprise_task_checklist_update_failed",
      result.error,
    );
  }
  return normalizeTaskChecklistMutationResponse(
    result.data,
    "enterprise_task_checklist_update_failed",
  );
}

export async function moveMerchantTask(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    taskId: string;
    version: number;
    columnId: string;
    targetIndex: number;
    actorType: "owner" | "employee";
    actorId: string;
    operationId?: string;
  },
): Promise<MerchantTask> {
  const siteId = normalizeText(input.siteId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const columnId = normalizeText(input.columnId, 80);
  const version = Number(input.version);
  const targetIndex = Number(input.targetIndex);
  if (
    !siteId ||
    !taskId ||
    !columnId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex > 10_000
  ) {
    throw new Error("invalid_task_move");
  }
  const actor = normalizeMerchantTaskMutationActor(input);
  const operationId = resolveTaskOperationId(input.operationId, "move");
  const result = await client.rpc("faolla_move_merchant_task_v1", {
    p_input: {
      merchant_id: siteId,
      task_id: taskId,
      expected_version: version,
      target_column_id: columnId,
      target_index: targetIndex,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: operationId,
    },
  });
  if (result.error) throwTaskRpcError("enterprise_task_move_failed", result.error);
  return normalizeTaskMutationResponse(result.data, "enterprise_task_move_failed");
}

export async function updateMerchantTask(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    taskId: string;
    version: number;
    actorType: "owner" | "employee";
    actorId: string;
    columnId?: string;
    title?: string;
    description?: string;
    priority?: MerchantTaskPriority;
    dueAt?: string | null;
    position?: number;
    archived?: boolean;
    assigneeIds?: string[];
    operationId?: string;
  },
): Promise<MerchantTask> {
  const siteId = normalizeText(input.siteId, 80);
  const taskId = normalizeText(input.taskId, 80);
  const version = Number(input.version);
  const patch: Record<string, unknown> = {};
  if (input.columnId !== undefined) patch.column_id = normalizeText(input.columnId, 80);
  if (input.title !== undefined) patch.title = normalizeText(input.title, 240);
  if (input.description !== undefined) patch.description = normalizeText(input.description, 10000);
  if (input.priority && ["low", "normal", "high", "urgent"].includes(input.priority)) {
    patch.priority = input.priority;
  }
  if (input.dueAt !== undefined) patch.due_at = normalizeText(input.dueAt, 80) || null;
  if (input.position !== undefined) patch.position = Math.max(0, Math.round(Number(input.position) || 0));
  if (input.archived !== undefined) patch.archived = input.archived;
  if (
    !siteId ||
    !taskId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    (Object.keys(patch).length === 0 && input.assigneeIds === undefined)
  ) {
    throw new Error("invalid_task_update");
  }
  const actor = normalizeMerchantTaskMutationActor(input);
  let assigneeIds: string[] | undefined;
  if (input.assigneeIds !== undefined) {
    if (input.assigneeIds.length > MAX_MERCHANT_TASK_ASSIGNEES) {
      throw new Error("invalid_task_assignees");
    }
    assigneeIds = Array.from(
      new Set(input.assigneeIds.map((item) => normalizeText(item, 80)).filter(Boolean)),
    ).sort();
  }
  const operationId = resolveTaskOperationId(input.operationId, "update");
  const eventType =
    input.archived === true
      ? "archived"
      : input.archived === false
        ? "restored"
        : input.columnId !== undefined
          ? "moved"
          : "updated";
  const result = await client.rpc("faolla_update_merchant_task_v1", {
    p_input: {
      merchant_id: siteId,
      task_id: taskId,
      expected_version: version,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: operationId,
      replace_assignees: assigneeIds !== undefined,
      ...(assigneeIds !== undefined ? { assignee_ids: assigneeIds } : {}),
      ...patch,
      event_type: eventType,
      event_payload: {
        fields: Object.keys(patch),
        ...(assigneeIds !== undefined ? { assigneeIds } : {}),
      },
    },
  });
  if (result.error) throwTaskRpcError("enterprise_task_update_failed", result.error);
  return normalizeTaskMutationResponse(result.data, "enterprise_task_update_failed");
}

function normalizeWorkflowRequiredText(
  value: unknown,
  maxLength: number,
  errorCode: string,
) {
  if (typeof value !== "string") throw new Error(errorCode);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(errorCode);
  return normalized;
}

function normalizeWorkflowOptionalText(
  value: unknown,
  maxLength: number,
  errorCode: string,
) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(errorCode);
  }
  return value.trim();
}

function normalizeWorkflowDraft(input: {
  title: unknown;
  scenario: unknown;
  description: unknown;
  category: unknown;
  tags: unknown;
  steps: unknown;
}) {
  const tags = parseMerchantEnterpriseWorkflowTagsStrict(input.tags);
  const steps = parseMerchantEnterpriseWorkflowStepsStrict(input.steps);
  if (!tags || !steps) throw new Error("invalid_workflow_payload");
  return {
    title: normalizeWorkflowRequiredText(
      input.title,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH,
      "invalid_workflow_payload",
    ),
    scenario: normalizeWorkflowRequiredText(
      input.scenario,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
      "invalid_workflow_payload",
    ),
    description: normalizeWorkflowOptionalText(
      input.description,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
      "invalid_workflow_payload",
    ),
    category: normalizeWorkflowOptionalText(
      input.category,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
      "invalid_workflow_payload",
    ),
    tags,
    steps,
  };
}

function normalizeWorkflowMutationResponse(value: unknown, operation: string) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const workflow = normalizeMerchantEnterpriseWorkflow(record.workflow);
  if (!workflow) throw new Error(`${operation}:invalid_response`);
  return workflow;
}

export async function loadMerchantEnterpriseWorkflows(
  client: MerchantEnterpriseStoreClient,
  input: MerchantEnterpriseMutationActorInput & {
    siteId: string;
    includeArchived?: boolean;
  },
): Promise<MerchantEnterpriseWorkflow[]> {
  const siteId = normalizeText(input.siteId, 80);
  if (!/^\d{8}$/.test(siteId)) throw new Error("invalid_workflow_request");
  if (
    input.includeArchived !== undefined &&
    typeof input.includeArchived !== "boolean"
  ) {
    throw new Error("invalid_workflow_query");
  }
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const includeArchived = input.includeArchived === true;
  const result = await client.rpc("faolla_list_merchant_enterprise_workflows_v1", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      // Modern clients request active rows here and use keyset pagination for
      // archives. The mixed mode remains temporarily available to older
      // clients during a rolling deployment.
      include_archived: includeArchived,
    },
  });
  if (result.error) {
    throwEnterpriseWorkflowRpcError("enterprise_workflows_read_failed", result.error);
  }
  const response =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : null;
  const rows = response && Array.isArray(response.workflows) ? response.workflows : null;
  if (!rows || rows.length > (includeArchived ? 400 : 200)) {
    throw new Error("enterprise_workflows_read_failed:invalid_response");
  }
  const workflows = rows.map(normalizeMerchantEnterpriseWorkflow);
  if (
    workflows.some((workflow) => !workflow || workflow.siteId !== siteId) ||
    new Set(workflows.map((workflow) => workflow?.id)).size !== workflows.length
  ) {
    throw new Error("enterprise_workflows_read_failed:invalid_response");
  }
  return workflows as MerchantEnterpriseWorkflow[];
}

export async function loadMerchantEnterpriseWorkflowById(
  client: MerchantEnterpriseStoreClient,
  input: MerchantEnterpriseMutationActorInput & {
    siteId: string;
    workflowId: string;
  },
): Promise<MerchantEnterpriseWorkflow> {
  const siteId = normalizeText(input.siteId, 80);
  const workflowIdText = normalizeText(input.workflowId, 80);
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN.test(workflowIdText)
  ) {
    throw new Error("invalid_workflow_request");
  }
  const workflowId = workflowIdText.toLowerCase();
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const result = await client.rpc("faolla_get_merchant_enterprise_workflow_v1", {
    p_input: {
      merchant_id: siteId,
      workflow_id: workflowId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
    },
  });
  if (result.error) {
    throwEnterpriseWorkflowRpcError("enterprise_workflow_read_failed", result.error);
  }
  const workflow = normalizeWorkflowMutationResponse(
    result.data,
    "enterprise_workflow_read_failed",
  );
  if (workflow.siteId !== siteId || workflow.id !== workflowId) {
    throw new Error("enterprise_workflow_read_failed:invalid_response");
  }
  return workflow;
}

function normalizeWorkflowArchiveCursor(
  value: unknown,
): MerchantEnterpriseWorkflowArchiveCursor | null {
  if (value === null || value === undefined) return null;
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (
    !source ||
    Object.keys(source).length !== 2 ||
    Object.keys(source).some((key) => !["updated_at", "id"].includes(key))
  ) {
    throw new Error("enterprise_workflows_read_failed:invalid_response");
  }
  const beforeUpdatedAt = source.updated_at;
  const beforeId = source.id;
  if (
    typeof beforeUpdatedAt !== "string" ||
    beforeUpdatedAt.length > 80 ||
    !Number.isFinite(Date.parse(beforeUpdatedAt)) ||
    typeof beforeId !== "string" ||
    !MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN.test(beforeId)
  ) {
    throw new Error("enterprise_workflows_read_failed:invalid_response");
  }
  // Keep the database timestamp byte-for-byte. PostgreSQL can return
  // microseconds that JavaScript Date would truncate.
  return { beforeUpdatedAt, beforeId };
}

export async function loadMerchantEnterpriseArchivedWorkflowPage(
  client: MerchantEnterpriseStoreClient,
  input: MerchantEnterpriseMutationActorInput & {
    siteId: string;
    limit?: number;
    cursor?: MerchantEnterpriseWorkflowArchiveCursor | null;
    query?: string;
    scenario?: string;
    tag?: string;
  },
): Promise<MerchantEnterpriseWorkflowArchivePage> {
  const siteId = normalizeText(input.siteId, 80);
  if (!/^\d{8}$/.test(siteId)) throw new Error("invalid_workflow_request");
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const limit = input.limit ?? 20;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_MERCHANT_ENTERPRISE_WORKFLOW_ARCHIVE_PAGE_SIZE
  ) {
    throw new Error("invalid_workflow_query");
  }
  const query = normalizeText(input.query, 160);
  const scenario = normalizeText(
    input.scenario,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  );
  const tag = normalizeText(input.tag, 40);
  if (
    (input.query !== undefined && (typeof input.query !== "string" || input.query.trim().length > 160)) ||
    (input.scenario !== undefined &&
      (typeof input.scenario !== "string" ||
        input.scenario.trim().length > MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH)) ||
    (input.tag !== undefined && (typeof input.tag !== "string" || input.tag.trim().length > 40))
  ) {
    throw new Error("invalid_workflow_query");
  }
  const cursor = input.cursor ?? null;
  if (
    cursor &&
    (typeof cursor.beforeUpdatedAt !== "string" ||
      cursor.beforeUpdatedAt.length > 80 ||
      !Number.isFinite(Date.parse(cursor.beforeUpdatedAt)) ||
      !MERCHANT_ENTERPRISE_ACTOR_ID_PATTERN.test(cursor.beforeId))
  ) {
    throw new Error("invalid_workflow_cursor");
  }
  const result = await client.rpc(
    "faolla_list_merchant_enterprise_archived_workflows_v1",
    {
      p_input: {
        merchant_id: siteId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        limit,
        ...(cursor
          ? {
              cursor: {
                updated_at: cursor.beforeUpdatedAt,
                id: cursor.beforeId,
              },
            }
          : {}),
        ...(query ? { query } : {}),
        ...(scenario ? { scenario } : {}),
        ...(tag ? { tag } : {}),
      },
    },
  );
  if (result.error) {
    throwEnterpriseWorkflowRpcError("enterprise_workflows_read_failed", result.error);
  }
  const response =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : null;
  if (!response || !Array.isArray(response.workflows)) {
    throw new Error("enterprise_workflows_read_failed:invalid_response");
  }
  const workflows = response.workflows.map(normalizeMerchantEnterpriseWorkflow);
  if (
    workflows.length > limit ||
    workflows.some(
      (workflow) =>
        !workflow || workflow.siteId !== siteId || workflow.status !== "archived",
    ) ||
    new Set(workflows.map((workflow) => workflow?.id)).size !== workflows.length
  ) {
    throw new Error("enterprise_workflows_read_failed:invalid_response");
  }
  return {
    workflows: workflows as MerchantEnterpriseWorkflow[],
    nextCursor: normalizeWorkflowArchiveCursor(response.next_cursor),
  };
}

export async function createMerchantEnterpriseWorkflow(
  client: MerchantEnterpriseStoreClient,
  input: MerchantEnterpriseMutationActorInput & {
    siteId: string;
    title: string;
    scenario: string;
    description: string;
    category: string;
    tags: string[];
    steps: MerchantEnterpriseWorkflowStep[];
    operationId?: string;
  },
): Promise<MerchantEnterpriseWorkflow> {
  const siteId = normalizeText(input.siteId, 80);
  if (!/^\d{8}$/.test(siteId)) throw new Error("invalid_workflow_request");
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const draft = normalizeWorkflowDraft(input);
  const result = await client.rpc("faolla_create_merchant_enterprise_workflow_v1", {
    p_input: {
      merchant_id: siteId,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: resolveWorkspaceOperationId(input.operationId, "workflow-create"),
      ...draft,
    },
  });
  if (result.error) {
    throwEnterpriseWorkflowRpcError("enterprise_workflow_create_failed", result.error);
  }
  const workflow = normalizeWorkflowMutationResponse(
    result.data,
    "enterprise_workflow_create_failed",
  );
  if (workflow.siteId !== siteId) {
    throw new Error("enterprise_workflow_create_failed:invalid_response");
  }
  return workflow;
}

export async function updateMerchantEnterpriseWorkflow(
  client: MerchantEnterpriseStoreClient,
  input: MerchantEnterpriseMutationActorInput & {
    siteId: string;
    workflowId: string;
    version: number;
    action: "save" | "publish" | "archive" | "restore";
    title?: string;
    scenario?: string;
    description?: string;
    category?: string;
    tags?: string[];
    steps?: MerchantEnterpriseWorkflowStep[];
    operationId?: string;
  },
): Promise<MerchantEnterpriseWorkflow> {
  const siteId = normalizeText(input.siteId, 80);
  const workflowId = normalizeText(input.workflowId, 80);
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(workflowId) ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    !["save", "publish", "archive", "restore"].includes(input.action)
  ) {
    throw new Error("invalid_workflow_request");
  }
  const actor = normalizeMerchantEnterpriseMutationActor(input);
  const draft =
    input.action === "save"
      ? normalizeWorkflowDraft({
          title: input.title,
          scenario: input.scenario,
          description: input.description,
          category: input.category,
          tags: input.tags,
          steps: input.steps,
        })
      : null;
  const result = await client.rpc("faolla_update_merchant_enterprise_workflow_v1", {
    p_input: {
      merchant_id: siteId,
      workflow_id: workflowId,
      expected_version: input.version,
      actor_type: actor.actorType,
      actor_id: actor.actorId,
      operation_id: resolveWorkspaceOperationId(
        input.operationId,
        `workflow-${input.action}`,
      ),
      action: input.action,
      ...(draft ?? {}),
    },
  });
  if (result.error) {
    throwEnterpriseWorkflowRpcError("enterprise_workflow_update_failed", result.error);
  }
  const workflow = normalizeWorkflowMutationResponse(
    result.data,
    "enterprise_workflow_update_failed",
  );
  if (workflow.siteId !== siteId || workflow.id !== workflowId) {
    throw new Error("enterprise_workflow_update_failed:invalid_response");
  }
  return workflow;
}

export type {
  MerchantEnterpriseEmployee,
  MerchantEnterprisePermission,
  MerchantEnterpriseRole,
  MerchantEnterpriseWorkflow,
  MerchantTaskBoard,
  MerchantTaskColumn,
};
