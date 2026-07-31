import { randomUUID } from "node:crypto";
import {
  DEFAULT_MERCHANT_ENTERPRISE_ROLES,
  DEFAULT_MERCHANT_TASK_COLUMNS,
  isMerchantEnterpriseSchemaMissingError,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterprisePermissions,
  normalizeMerchantEnterpriseRole,
  normalizeMerchantTask,
  normalizeMerchantTaskBoard,
  normalizeMerchantTaskColumn,
  type MerchantEnterpriseEmployee,
  type MerchantEnterpriseEmployeeStatus,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseRole,
  type MerchantEnterpriseSnapshot,
  type MerchantTask,
  type MerchantTaskBoard,
  type MerchantTaskColumn,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";

export type MerchantEnterpriseStoreClient = {
  // Supabase builders are intentionally treated as runtime clients in this isolated store.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (functionName: string, args: Record<string, unknown>) => any;
};

const DEFAULT_ROLE_SYSTEM_KEYS = ["administrator", "supervisor", "employee"] as const;
const DEFAULT_COLUMN_SYSTEM_KEYS = ["todo", "in_progress", "blocked", "done"] as const;

const ROLE_COLUMNS =
  "id,merchant_id,name,description,permissions,status,is_system,version,created_at,updated_at";
const EMPLOYEE_COLUMNS =
  "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at";
const BOARD_COLUMNS =
  "id,merchant_id,name,description,status,version,created_at,updated_at";
const COLUMN_COLUMNS =
  "id,merchant_id,board_id,name,color,position,is_done,status,version,created_at,updated_at";
const TASK_COLUMNS =
  "id,merchant_id,board_id,column_id,title,description,priority,due_at,completed_at,archived_at,position,source_type,source_id,created_by_employee_id,version,created_at,updated_at";

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
  throw new Error(`${operation}:${toErrorMessage(error)}`);
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
  const invalidCode = message.match(/\b(invalid_task(?:_[a-z_]+)?)\b/i)?.[1];
  if (invalidCode) throw new Error(invalidCode.toLowerCase());
  throw new Error(`${operation}:${message}`);
}

function resolveTaskOperationId(value: unknown, scope: "create" | "update") {
  const normalized = normalizeMutationOperationId(value);
  return normalized || `enterprise-task-${scope}:${randomUUID()}`;
}

function normalizeTaskMutationResponse(value: unknown, operation: string) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const task = normalizeMerchantTask(record.task, record.assignee_ids);
  if (!task) throw new Error(`${operation}:invalid_response`);
  return task;
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

  const [roleRows, employeeRows, boardRows, columnRows, taskRows, assigneeRows] =
    await Promise.all([
      selectMerchantRows(client, "merchant_enterprise_roles", ROLE_COLUMNS, siteId),
      selectMerchantRows(client, "merchant_enterprise_employees", EMPLOYEE_COLUMNS, siteId),
      selectMerchantRows(client, "merchant_task_boards", BOARD_COLUMNS, siteId),
      selectMerchantRows(client, "merchant_task_columns", COLUMN_COLUMNS, siteId, "position"),
      selectMerchantRows(client, "merchant_tasks", TASK_COLUMNS, siteId, "position"),
      selectMerchantRows(
        client,
        "merchant_task_assignees",
        "merchant_id,task_id,employee_id,assigned_at",
        siteId,
        "assigned_at",
        ["task_id", "employee_id"],
      ),
    ]);

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
    roles: normalizeRows(roleRows, normalizeMerchantEnterpriseRole),
    employees: normalizeRows(employeeRows, normalizeMerchantEnterpriseEmployee),
    boards: normalizeRows(boardRows, normalizeMerchantTaskBoard),
    columns: normalizeRows(columnRows, normalizeMerchantTaskColumn),
    tasks: (Array.isArray(taskRows) ? taskRows : [])
      .map((row) => {
        const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return normalizeMerchantTask(row, assigneesByTask.get(normalizeText(record.id, 80)) ?? []);
      })
      .filter((item): item is MerchantTask => Boolean(item)),
  };
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
) {
  const siteId = normalizeText(siteIdValue, 80);
  if (!siteId) throw new Error("invalid_site_id");
  const roleBootstrap = await client
    .from("merchant_enterprise_roles")
    .upsert(
      DEFAULT_MERCHANT_ENTERPRISE_ROLES.map((role, index) => ({
        merchant_id: siteId,
        name: role.name,
        system_key: DEFAULT_ROLE_SYSTEM_KEYS[index],
        description: role.description,
        permissions: role.permissions,
        status: "active",
        is_system: true,
      })),
      {
        onConflict: "merchant_id,system_key",
        ignoreDuplicates: true,
      },
    );
  if (roleBootstrap.error) {
    throwStoreError("enterprise_roles_bootstrap_failed", roleBootstrap.error);
  }

  const boardBootstrap = await client
    .from("merchant_task_boards")
    .upsert(
      {
        merchant_id: siteId,
        name: "团队任务",
        system_key: "default",
        description: "集中安排和推进团队工作。",
        status: "active",
      },
      {
        onConflict: "merchant_id,system_key",
        ignoreDuplicates: true,
      },
    );
  if (boardBootstrap.error) {
    throwStoreError("enterprise_board_bootstrap_failed", boardBootstrap.error);
  }

  const boardResult = await client
    .from("merchant_task_boards")
    .select(BOARD_COLUMNS)
    .eq("merchant_id", siteId)
    .eq("system_key", "default")
    .limit(1)
    .maybeSingle();
  if (boardResult.error) {
    throwStoreError("enterprise_board_bootstrap_read_failed", boardResult.error);
  }
  const board = normalizeMerchantTaskBoard(boardResult.data);
  if (!board) throw new Error("enterprise_board_bootstrap_failed:invalid_response");

  const columnBootstrap = await client
    .from("merchant_task_columns")
    .upsert(
      DEFAULT_MERCHANT_TASK_COLUMNS.map((column, index) => ({
        merchant_id: siteId,
        board_id: board.id,
        name: column.name,
        system_key: DEFAULT_COLUMN_SYSTEM_KEYS[index],
        color: column.color,
        position: index,
        is_done: DEFAULT_COLUMN_SYSTEM_KEYS[index] === "done",
        status: "active",
      })),
      {
        onConflict: "merchant_id,board_id,system_key",
        ignoreDuplicates: true,
      },
    );
  if (columnBootstrap.error) {
    throwStoreError("enterprise_columns_bootstrap_failed", columnBootstrap.error);
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

export async function createMerchantEnterpriseRole(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    name: string;
    description?: string;
    permissions?: unknown;
  },
): Promise<MerchantEnterpriseRole> {
  const siteId = normalizeText(input.siteId, 80);
  const name = normalizeText(input.name, 80);
  if (!siteId || !name) throw new Error("invalid_role");
  return insertOne(
    client,
    "merchant_enterprise_roles",
    {
      merchant_id: siteId,
      name,
      description: normalizeText(input.description, 1000),
      permissions: normalizeMerchantEnterprisePermissions(input.permissions),
      status: "active",
      is_system: false,
    },
    ROLE_COLUMNS,
    normalizeMerchantEnterpriseRole,
    "enterprise_role_create_failed",
  );
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
  if (input.status === "active" || input.status === "archived") patch.status = input.status;
  if (!siteId || !roleId || Object.keys(patch).length === 0) throw new Error("invalid_role_update");
  const result = await client
    .from("merchant_enterprise_roles")
    .update(patch)
    .eq("merchant_id", siteId)
    .eq("id", roleId)
    .eq("version", Math.max(1, Math.round(Number(input.version) || 1)))
    .select(ROLE_COLUMNS)
    .maybeSingle();
  if (result.error) throwStoreError("enterprise_role_update_failed", result.error);
  if (!result.data) throw new Error("enterprise_version_conflict");
  const role = normalizeMerchantEnterpriseRole(result.data);
  if (!role) throw new Error("enterprise_role_update_failed:invalid_response");
  return role;
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
  const email = normalizeText(input.email, 320).toLowerCase();
  const displayName = normalizeText(input.displayName, 120);
  if (!siteId || !email || !displayName || !email.includes("@")) throw new Error("invalid_employee");
  return insertOne(
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
  const assigneeIds = Array.from(
    new Set((input.assigneeIds ?? []).map((item) => normalizeText(item, 80)).filter(Boolean)),
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
