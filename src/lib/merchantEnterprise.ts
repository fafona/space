export const MERCHANT_ENTERPRISE_PERMISSIONS = [
  "enterprise.view",
  "tasks.view",
  "tasks.create",
  "tasks.update",
  "tasks.assign",
  "tasks.archive",
  "boards.manage",
  "employees.view",
  "employees.manage",
  "roles.view",
  "roles.manage",
] as const;

export type MerchantEnterprisePermission = (typeof MERCHANT_ENTERPRISE_PERMISSIONS)[number];

export const MERCHANT_ENTERPRISE_PERMISSION_CATALOG: ReadonlyArray<{
  key: MerchantEnterprisePermission;
  label: string;
  group: "工作台" | "任务" | "员工" | "角色";
  description: string;
}> = [
  { key: "enterprise.view", label: "进入企业管理", group: "工作台", description: "查看企业管理工作台。" },
  { key: "tasks.view", label: "查看任务", group: "任务", description: "查看有权访问的任务和看板。" },
  { key: "tasks.create", label: "新建任务", group: "任务", description: "在看板中创建任务。" },
  { key: "tasks.update", label: "更新任务", group: "任务", description: "修改任务内容和流转状态。" },
  { key: "tasks.assign", label: "分派任务", group: "任务", description: "给员工分派或取消分派任务。" },
  { key: "tasks.archive", label: "归档任务", group: "任务", description: "归档不再处理的任务。" },
  { key: "boards.manage", label: "管理看板", group: "任务", description: "创建看板和维护工作列。" },
  { key: "employees.view", label: "查看员工", group: "员工", description: "查看员工账号、角色和状态。" },
  { key: "employees.manage", label: "管理员工", group: "员工", description: "邀请、停用员工并分配角色。" },
  { key: "roles.view", label: "查看角色", group: "角色", description: "查看角色及其权限。" },
  { key: "roles.manage", label: "管理角色", group: "角色", description: "创建、修改和归档角色。" },
];

export const MERCHANT_ENTERPRISE_ROLE_STATUSES = ["active", "archived"] as const;
export const MERCHANT_ENTERPRISE_EMPLOYEE_STATUSES = ["invited", "active", "disabled"] as const;
export const MERCHANT_TASK_BOARD_STATUSES = ["active", "archived"] as const;
export const MERCHANT_TASK_COLUMN_STATUSES = ["active", "archived"] as const;
export const MERCHANT_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type MerchantEnterpriseRoleStatus = (typeof MERCHANT_ENTERPRISE_ROLE_STATUSES)[number];
export type MerchantEnterpriseEmployeeStatus = (typeof MERCHANT_ENTERPRISE_EMPLOYEE_STATUSES)[number];
export type MerchantTaskBoardStatus = (typeof MERCHANT_TASK_BOARD_STATUSES)[number];
export type MerchantTaskColumnStatus = (typeof MERCHANT_TASK_COLUMN_STATUSES)[number];
export type MerchantTaskPriority = (typeof MERCHANT_TASK_PRIORITIES)[number];

export type MerchantEnterpriseRole = {
  id: string;
  siteId: string;
  name: string;
  description: string;
  permissions: MerchantEnterprisePermission[];
  status: MerchantEnterpriseRoleStatus;
  isSystem: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantEnterpriseEmployee = {
  id: string;
  siteId: string;
  authUserId: string;
  email: string;
  displayName: string;
  roleId: string;
  status: MerchantEnterpriseEmployeeStatus;
  invitedAt: string | null;
  acceptedAt: string | null;
  lastActiveAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantTaskBoard = {
  id: string;
  siteId: string;
  name: string;
  description: string;
  status: MerchantTaskBoardStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantTaskColumn = {
  id: string;
  siteId: string;
  boardId: string;
  name: string;
  color: string;
  position: number;
  isDone: boolean;
  status: MerchantTaskColumnStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantTask = {
  id: string;
  siteId: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string;
  priority: MerchantTaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  position: number;
  sourceType: string;
  sourceId: string;
  createdByEmployeeId: string;
  assigneeIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantEnterpriseSnapshot = {
  roles: MerchantEnterpriseRole[];
  employees: MerchantEnterpriseEmployee[];
  boards: MerchantTaskBoard[];
  columns: MerchantTaskColumn[];
  tasks: MerchantTask[];
};

export type MerchantEnterpriseActor =
  | {
      type: "owner";
      id: string;
      siteId: string;
      displayName: string;
      email: string;
      permissions: MerchantEnterprisePermission[];
    }
  | {
      type: "employee";
      id: string;
      siteId: string;
      displayName: string;
      email: string;
      roleId: string;
      permissions: MerchantEnterprisePermission[];
    };

export const DEFAULT_MERCHANT_TASK_COLUMNS = [
  { name: "待处理", color: "#64748b" },
  { name: "进行中", color: "#2563eb" },
  { name: "受阻", color: "#dc2626" },
  { name: "已完成", color: "#16a34a" },
] as const;

export const DEFAULT_MERCHANT_ENTERPRISE_ROLES: ReadonlyArray<{
  name: string;
  description: string;
  permissions: MerchantEnterprisePermission[];
}> = [
  {
    name: "管理员",
    description: "管理企业协作模块内的员工、角色、看板和任务。",
    permissions: [...MERCHANT_ENTERPRISE_PERMISSIONS],
  },
  {
    name: "主管",
    description: "查看团队并负责创建、分派和推进任务。",
    permissions: [
      "enterprise.view",
      "tasks.view",
      "tasks.create",
      "tasks.update",
      "tasks.assign",
      "employees.view",
      "roles.view",
    ],
  },
  {
    name: "员工",
    description: "查看协作看板，并创建和推进团队任务。",
    permissions: ["enterprise.view", "tasks.view", "tasks.create", "tasks.update"],
  },
];

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readValue(record: Record<string, unknown>, camel: string, snake: string) {
  return record[camel] ?? record[snake];
}

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeNullableTimestamp(value: unknown) {
  const text = normalizeText(value, 80);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function normalizeTimestamp(value: unknown) {
  return normalizeNullableTimestamp(value) ?? new Date(0).toISOString();
}

function normalizeVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : 1;
}

function normalizePosition(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function normalizeMerchantEnterprisePermissions(value: unknown): MerchantEnterprisePermission[] {
  const source = Array.isArray(value) ? value : [];
  const allowed = new Set<MerchantEnterprisePermission>(MERCHANT_ENTERPRISE_PERMISSIONS);
  return Array.from(
    new Set(
      source
        .map((item) => normalizeText(item, 80) as MerchantEnterprisePermission)
        .filter((item) => allowed.has(item)),
    ),
  );
}

export function hasMerchantEnterprisePermission(
  actor: MerchantEnterpriseActor | null | undefined,
  permission: MerchantEnterprisePermission,
) {
  return actor?.type === "owner" || Boolean(actor?.permissions.includes(permission));
}

export function isMerchantEnterpriseVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseMerchantEnterprisePermissionsStrict(
  value: unknown,
): MerchantEnterprisePermission[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = normalizeMerchantEnterprisePermissions(value);
  const requested = value.map((item) => normalizeText(item, 80)).filter(Boolean);
  if (normalized.length !== new Set(requested).size || requested.length !== value.length) {
    return null;
  }
  return normalized;
}

export function merchantEnterprisePermissionsFitActor(
  actor: MerchantEnterpriseActor,
  permissions: readonly MerchantEnterprisePermission[],
) {
  return (
    actor.type === "owner" ||
    permissions.every((permission) => actor.permissions.includes(permission))
  );
}

export function normalizeMerchantEnterpriseRole(value: unknown): MerchantEnterpriseRole | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const name = normalizeText(record.name, 80);
  if (!id || !siteId || !name) return null;
  const statusValue = normalizeText(record.status, 20);
  return {
    id,
    siteId,
    name,
    description: normalizeText(record.description, 1000),
    permissions: normalizeMerchantEnterprisePermissions(record.permissions),
    status: statusValue === "archived" ? "archived" : "active",
    isSystem: readValue(record, "isSystem", "is_system") === true,
    version: normalizeVersion(record.version),
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
    updatedAt: normalizeTimestamp(readValue(record, "updatedAt", "updated_at")),
  };
}

export function normalizeMerchantEnterpriseEmployee(value: unknown): MerchantEnterpriseEmployee | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const email = normalizeText(record.email, 320).toLowerCase();
  const displayName = normalizeText(readValue(record, "displayName", "display_name"), 120);
  if (!id || !siteId || !email || !displayName) return null;
  const statusValue = normalizeText(record.status, 20);
  return {
    id,
    siteId,
    authUserId: normalizeText(readValue(record, "authUserId", "auth_user_id"), 80),
    email,
    displayName,
    roleId: normalizeText(readValue(record, "roleId", "role_id"), 80),
    status: statusValue === "active" || statusValue === "disabled" ? statusValue : "invited",
    invitedAt: normalizeNullableTimestamp(readValue(record, "invitedAt", "invited_at")),
    acceptedAt: normalizeNullableTimestamp(readValue(record, "acceptedAt", "accepted_at")),
    lastActiveAt: normalizeNullableTimestamp(readValue(record, "lastActiveAt", "last_active_at")),
    version: normalizeVersion(record.version),
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
    updatedAt: normalizeTimestamp(readValue(record, "updatedAt", "updated_at")),
  };
}

export function normalizeMerchantTaskBoard(value: unknown): MerchantTaskBoard | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const name = normalizeText(record.name, 120);
  if (!id || !siteId || !name) return null;
  return {
    id,
    siteId,
    name,
    description: normalizeText(record.description, 2000),
    status: normalizeText(record.status, 20) === "archived" ? "archived" : "active",
    version: normalizeVersion(record.version),
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
    updatedAt: normalizeTimestamp(readValue(record, "updatedAt", "updated_at")),
  };
}

export function normalizeMerchantTaskColumn(value: unknown): MerchantTaskColumn | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const boardId = normalizeText(readValue(record, "boardId", "board_id"), 80);
  const name = normalizeText(record.name, 80);
  if (!id || !siteId || !boardId || !name) return null;
  return {
    id,
    siteId,
    boardId,
    name,
    color: normalizeText(record.color, 40) || "#64748b",
    position: normalizePosition(record.position),
    isDone: readValue(record, "isDone", "is_done") === true,
    status: normalizeText(record.status, 20) === "archived" ? "archived" : "active",
    version: normalizeVersion(record.version),
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
    updatedAt: normalizeTimestamp(readValue(record, "updatedAt", "updated_at")),
  };
}

export function normalizeMerchantTask(
  value: unknown,
  assigneeIds: unknown = [],
): MerchantTask | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const boardId = normalizeText(readValue(record, "boardId", "board_id"), 80);
  const columnId = normalizeText(readValue(record, "columnId", "column_id"), 80);
  const title = normalizeText(record.title, 240);
  if (!id || !siteId || !boardId || !columnId || !title) return null;
  const priorityValue = normalizeText(record.priority, 20) as MerchantTaskPriority;
  return {
    id,
    siteId,
    boardId,
    columnId,
    title,
    description: normalizeText(record.description, 10000),
    priority: MERCHANT_TASK_PRIORITIES.includes(priorityValue) ? priorityValue : "normal",
    dueAt: normalizeNullableTimestamp(readValue(record, "dueAt", "due_at")),
    completedAt: normalizeNullableTimestamp(readValue(record, "completedAt", "completed_at")),
    archivedAt: normalizeNullableTimestamp(readValue(record, "archivedAt", "archived_at")),
    position: normalizePosition(record.position),
    sourceType: normalizeText(readValue(record, "sourceType", "source_type"), 80),
    sourceId: normalizeText(readValue(record, "sourceId", "source_id"), 200),
    createdByEmployeeId: normalizeText(
      readValue(record, "createdByEmployeeId", "created_by_employee_id"),
      80,
    ),
    assigneeIds: Array.from(
      new Set((Array.isArray(assigneeIds) ? assigneeIds : []).map((item) => normalizeText(item, 80)).filter(Boolean)),
    ),
    version: normalizeVersion(record.version),
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
    updatedAt: normalizeTimestamp(readValue(record, "updatedAt", "updated_at")),
  };
}

export function isMerchantEnterpriseSchemaMissingError(error: unknown) {
  const record = readRecord(error);
  const code = normalizeText(record.code, 40);
  const message = normalizeText(record.message, 1000);
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /does not exist|schema cache|could not find the table/i.test(message)
  );
}
