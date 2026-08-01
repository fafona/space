import { randomUUID } from "node:crypto";
import {
  isMerchantEnterpriseSchemaMissingError,
  MAX_MERCHANT_TASK_CHECKLIST_ITEMS,
  MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH,
  MAX_MERCHANT_TASK_ASSIGNEES,
  normalizeMerchantEnterpriseBoardIds,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterprisePermissions,
  normalizeMerchantEnterpriseRole,
  normalizeMerchantTask,
  normalizeMerchantTaskBoard,
  normalizeMerchantTaskColumn,
  normalizeMerchantTaskEvent,
  type MerchantEnterpriseEmployee,
  type MerchantEnterpriseEmployeeStatus,
  type MerchantEnterpriseBoardAccessScope,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRole,
  type MerchantEnterpriseSnapshot,
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

const MERCHANT_ENTERPRISE_TASK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function throwRoleRpcError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = toErrorMessage(error);
  for (const code of [
    "enterprise_version_conflict",
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

async function insertOne<T>(
  client: MerchantEnterpriseStoreClient,
  table: string,
  payload: Record<string, unknown>,
  columns: string,
  normalizer: (value: unknown) => T | null,
  operation: string,
) {
  const result = await client.from(table).insert(payload).select(columns).single();
  if (result.error) throwStoreError(operation, result.error);
  const normalized = normalizer(result.data);
  if (!normalized) throw new Error(`${operation}:invalid_response`);
  return normalized;
}

export async function bootstrapMerchantEnterpriseWorkspace(
  client: MerchantEnterpriseStoreClient,
  siteIdValue: string,
  operationIdValue?: string,
) {
  const siteId = normalizeText(siteIdValue, 80);
  if (!siteId) throw new Error("invalid_site_id");
  const result = await client.rpc("faolla_bootstrap_merchant_enterprise_v2", {
    p_input: {
      merchant_id: siteId,
      operation_id: resolveWorkspaceOperationId(
        operationIdValue,
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
    name: string;
    description?: string;
    position?: number;
    operationId?: string;
  },
): Promise<{ board: MerchantTaskBoard; columns: MerchantTaskColumn[] }> {
  const siteId = normalizeText(input.siteId, 80);
  const name = normalizeText(input.name, 120);
  const position = normalizeOptionalPosition(input.position, "invalid_board_position");
  if (!siteId || !name) throw new Error("invalid_board");
  const result = await client.rpc("faolla_create_merchant_task_board_v1", {
    p_input: {
      merchant_id: siteId,
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
    boardId: string;
    name: string;
    color?: string;
    isDone?: boolean;
    position?: number;
    operationId?: string;
  },
): Promise<MerchantTaskColumn> {
  const siteId = normalizeText(input.siteId, 80);
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
  },
): Promise<MerchantEnterpriseRole> {
  const siteId = normalizeText(input.siteId, 80);
  const name = normalizeText(input.name, 80);
  if (!siteId || !name) throw new Error("invalid_role");
  const result = await client.rpc("faolla_create_merchant_enterprise_role_v1", {
    p_input: {
      merchant_id: siteId,
      name,
      description: normalizeText(input.description, 1000),
      permissions: normalizeMerchantEnterprisePermissions(input.permissions),
      access_scope: input.accessScope,
      allowed_board_ids: input.accessScope === "all" ? [] : input.allowedBoardIds,
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
  },
): Promise<MerchantEnterpriseRole> {
  const siteId = normalizeText(input.siteId, 80);
  const roleId = normalizeText(input.roleId, 80);
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
  const result = await client.rpc("faolla_update_merchant_enterprise_role_v1", {
    p_input: {
      merchant_id: siteId,
      role_id: roleId,
      expected_version: Math.max(1, Math.round(Number(input.version) || 1)),
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
    roleId?: string;
    authUserId?: string;
    invitedAt?: string | null;
  },
): Promise<MerchantEnterpriseEmployee> {
  const siteId = normalizeText(input.siteId, 80);
  const email = normalizeAuthEmail(input.email);
  const displayName = normalizeText(input.displayName, 120);
  if (!siteId || !displayName) throw new Error("invalid_employee");
  if (!isValidAuthEmail(email)) throw new Error("invalid_employee_email");
  try {
    return await insertOne(
      client,
      "merchant_enterprise_employees",
      {
        merchant_id: siteId,
        email,
        display_name: displayName,
        role_id: normalizeText(input.roleId, 80) || null,
        auth_user_id: normalizeText(input.authUserId, 80) || null,
        status: "invited",
        invited_at: input.invitedAt ?? new Date().toISOString(),
      },
      EMPLOYEE_COLUMNS,
      normalizeMerchantEnterpriseEmployee,
      "enterprise_employee_create_failed",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("merchant_enterprise_employees_email_unique_idx") ||
      (message.includes("23505") && message.includes("email"))
    ) {
      throw new Error("employee_email_in_use");
    }
    throw error;
  }
}

export async function updateMerchantEnterpriseEmployee(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
    displayName?: string;
    roleId?: string | null;
    status?: MerchantEnterpriseEmployeeStatus;
    invitedAt?: string | null;
  },
): Promise<MerchantEnterpriseEmployee> {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = normalizeText(input.displayName, 120);
  if (input.roleId !== undefined) patch.role_id = normalizeText(input.roleId, 80) || null;
  if (input.status && ["invited", "active", "disabled"].includes(input.status)) patch.status = input.status;
  if (input.invitedAt !== undefined) {
    patch.invited_at = normalizeText(input.invitedAt, 80) || null;
  }
  if (!siteId || !employeeId || Object.keys(patch).length === 0) {
    throw new Error("invalid_employee_update");
  }
  const result = await client
    .from("merchant_enterprise_employees")
    .update(patch)
    .eq("merchant_id", siteId)
    .eq("id", employeeId)
    .eq("version", Math.max(1, Math.round(Number(input.version) || 1)))
    .select(EMPLOYEE_COLUMNS)
    .maybeSingle();
  if (result.error) throwStoreError("enterprise_employee_update_failed", result.error);
  if (!result.data) throw new Error("enterprise_version_conflict");
  const employee = normalizeMerchantEnterpriseEmployee(result.data);
  if (!employee) throw new Error("enterprise_employee_update_failed:invalid_response");
  return employee;
}

export async function bindMerchantEnterpriseEmployeeAuthUser(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    authUserId: string;
  },
): Promise<MerchantEnterpriseEmployee> {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const authUserId = normalizeText(input.authUserId, 80);
  if (!siteId || !employeeId || !authUserId) throw new Error("invalid_employee_auth_binding");
  const result = await client
    .from("merchant_enterprise_employees")
    .update({
      auth_user_id: authUserId,
      invited_at: new Date().toISOString(),
    })
    .eq("merchant_id", siteId)
    .eq("id", employeeId)
    .select(EMPLOYEE_COLUMNS)
    .maybeSingle();
  if (result.error) throwStoreError("enterprise_employee_auth_binding_failed", result.error);
  const employee = normalizeMerchantEnterpriseEmployee(result.data);
  if (!employee) throw new Error("enterprise_employee_auth_binding_failed:invalid_response");
  return employee;
}

export async function createMerchantTask(
  client: MerchantEnterpriseStoreClient,
  input: {
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
    actorType?: "owner" | "employee";
    actorId?: string;
    operationId?: string;
  },
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
  const actorType = input.actorType === "employee" ? "employee" : "owner";
  const actorId = normalizeText(input.actorId, 120);
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
      actor_type: actorType,
      actor_id: actorId,
      operation_id: operationId,
      event_payload: { columnId, priority, assigneeIds },
    },
  });
  if (result.error) throwTaskRpcError("enterprise_task_create_failed", result.error);
  return normalizeTaskMutationResponse(result.data, "enterprise_task_create_failed");
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
  const actorId = normalizeText(input.actorId, 120);
  if (
    !siteId ||
    !taskId ||
    !commentText ||
    input.text.trim().length > 2000 ||
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    !actorId
  ) {
    throw new Error("invalid_task_comment");
  }
  const result = await client.rpc("faolla_add_merchant_task_comment_v1", {
    p_input: {
      merchant_id: siteId,
      task_id: taskId,
      text: commentText,
      actor_type: input.actorType,
      actor_id: actorId,
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
  const actorId = normalizeText(input.actorId, 120);
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(taskId) ||
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(actorId)
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
        actor_type: input.actorType,
        actor_id: actorId,
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
  const actorId = normalizeText(input.actorId, 120);
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
    !MERCHANT_ENTERPRISE_TASK_ID_PATTERN.test(actorId) ||
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
        actor_type: input.actorType,
        actor_id: actorId,
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
    actorId?: string;
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
  const operationId = resolveTaskOperationId(input.operationId, "move");
  const result = await client.rpc("faolla_move_merchant_task_v1", {
    p_input: {
      merchant_id: siteId,
      task_id: taskId,
      expected_version: version,
      target_column_id: columnId,
      target_index: targetIndex,
      actor_type: input.actorType,
      actor_id: normalizeText(input.actorId, 120),
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
    actorId?: string;
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
      actor_type: input.actorType,
      actor_id: normalizeText(input.actorId, 120),
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

export type {
  MerchantEnterpriseEmployee,
  MerchantEnterprisePermission,
  MerchantEnterpriseRole,
  MerchantTaskBoard,
  MerchantTaskColumn,
};
