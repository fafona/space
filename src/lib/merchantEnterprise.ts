export const MERCHANT_ENTERPRISE_PERMISSIONS = [
  "enterprise.view",
  "tasks.view",
  "tasks.create",
  "tasks.update",
  "tasks.assign",
  "tasks.archive",
  "orders.linked.view",
  "boards.manage",
  "employees.view",
  "employees.manage",
  "roles.view",
  "roles.manage",
  "audit.view",
] as const;

export const MAX_MERCHANT_TASK_ASSIGNEES = 50;
export const MAX_MERCHANT_TASK_CHECKLIST_ITEMS = 100;
export const MAX_MERCHANT_TASK_CHECKLIST_TEXT_LENGTH = 500;
export const MAX_MERCHANT_ENTERPRISE_ROLE_BOARDS = 100;

export type MerchantEnterprisePermission = (typeof MERCHANT_ENTERPRISE_PERMISSIONS)[number];

export const MERCHANT_ENTERPRISE_PERMISSION_CATALOG: ReadonlyArray<{
  key: MerchantEnterprisePermission;
  label: string;
  group: "工作台" | "任务" | "订单" | "员工" | "角色" | "审计";
  description: string;
}> = [
  { key: "enterprise.view", label: "进入企业管理", group: "工作台", description: "查看企业管理工作台。" },
  { key: "tasks.view", label: "查看任务", group: "任务", description: "查看有权访问的任务和看板。" },
  { key: "tasks.create", label: "新建任务", group: "任务", description: "在看板中创建任务。" },
  { key: "tasks.update", label: "更新任务", group: "任务", description: "修改任务内容和流转状态。" },
  { key: "tasks.assign", label: "分派任务", group: "任务", description: "给员工分派或取消分派任务。" },
  { key: "tasks.archive", label: "归档任务", group: "任务", description: "归档不再处理的任务。" },
  { key: "orders.linked.view", label: "查看关联订单摘要", group: "订单", description: "查看本人负责的任务所关联的脱敏订单摘要。" },
  { key: "boards.manage", label: "管理看板", group: "任务", description: "创建看板和维护工作列。" },
  { key: "employees.view", label: "查看员工", group: "员工", description: "查看员工账号、角色和状态。" },
  { key: "employees.manage", label: "管理员工", group: "员工", description: "邀请、停用员工并分配角色。" },
  { key: "roles.view", label: "查看角色", group: "角色", description: "查看角色及其权限。" },
  { key: "roles.manage", label: "管理角色", group: "角色", description: "创建、修改和归档角色。" },
  { key: "audit.view", label: "查看审计记录", group: "审计", description: "查看企业设置和员工账号的不可变操作记录。" },
];

const MERCHANT_ENTERPRISE_PERMISSION_DEPENDENCIES: Readonly<
  Record<MerchantEnterprisePermission, readonly MerchantEnterprisePermission[]>
> = {
  "enterprise.view": [],
  "tasks.view": ["enterprise.view"],
  "tasks.create": ["enterprise.view", "tasks.view"],
  "tasks.update": ["enterprise.view", "tasks.view"],
  "tasks.assign": ["enterprise.view", "tasks.view"],
  "tasks.archive": ["enterprise.view", "tasks.view"],
  "orders.linked.view": ["enterprise.view", "tasks.view"],
  "boards.manage": ["enterprise.view", "tasks.view"],
  "employees.view": ["enterprise.view", "roles.view"],
  "employees.manage": ["enterprise.view", "employees.view", "roles.view"],
  "roles.view": ["enterprise.view"],
  "roles.manage": ["enterprise.view", "roles.view"],
  "audit.view": ["enterprise.view"],
};

export const MERCHANT_ENTERPRISE_ROLE_STATUSES = ["active", "archived"] as const;
export const MERCHANT_ENTERPRISE_BOARD_ACCESS_SCOPES = ["all", "restricted"] as const;
export const MERCHANT_ENTERPRISE_EMPLOYEE_STATUSES = ["invited", "active", "disabled"] as const;
export const MERCHANT_ENTERPRISE_INVITATION_DELIVERY_STATUSES = [
  "none",
  "legacy",
  "sending",
  "sent",
  "failed",
  "revoked",
] as const;
export const MERCHANT_TASK_BOARD_STATUSES = ["active", "archived"] as const;
export const MERCHANT_TASK_COLUMN_STATUSES = ["active", "archived"] as const;
export const MERCHANT_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const MERCHANT_ENTERPRISE_NOTIFICATION_TYPES = [
  "task_assigned",
  "task_unassigned",
  "task_commented",
  "task_due_changed",
] as const;
export const MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES = [
  "workspace.bootstrapped",
  "role.created",
  "role.updated",
  "role.board_scope_changed",
  "board.created",
  "board.updated",
  "column.created",
  "column.updated",
  "employee.created",
  "employee.updated",
  "employee.renamed",
  "employee.role_changed",
  "employee.disabled",
  "employee.restored",
  "employee.removed",
  "invitation.reserved",
  "invitation.revoked",
  "invitation.removed",
  "invitation.accepted",
  "invitation.delivery_finalized",
  "invitation.auth_bound",
] as const;
export const MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES = [
  "workspace",
  "role",
  "board",
  "column",
  "employee",
  "invitation",
] as const;

export type MerchantEnterpriseRoleStatus = (typeof MERCHANT_ENTERPRISE_ROLE_STATUSES)[number];
export type MerchantEnterpriseBoardAccessScope =
  (typeof MERCHANT_ENTERPRISE_BOARD_ACCESS_SCOPES)[number];
export type MerchantEnterpriseEmployeeStatus = (typeof MERCHANT_ENTERPRISE_EMPLOYEE_STATUSES)[number];
export type MerchantEnterpriseInvitationDeliveryStatus =
  (typeof MERCHANT_ENTERPRISE_INVITATION_DELIVERY_STATUSES)[number];
export type MerchantTaskBoardStatus = (typeof MERCHANT_TASK_BOARD_STATUSES)[number];
export type MerchantTaskColumnStatus = (typeof MERCHANT_TASK_COLUMN_STATUSES)[number];
export type MerchantTaskPriority = (typeof MERCHANT_TASK_PRIORITIES)[number];
export type MerchantEnterpriseNotificationType =
  (typeof MERCHANT_ENTERPRISE_NOTIFICATION_TYPES)[number];
export type MerchantEnterpriseAuditEventType =
  (typeof MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES)[number];
export type MerchantEnterpriseAuditEntityType =
  (typeof MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES)[number];

export type MerchantEnterpriseRole = {
  id: string;
  siteId: string;
  name: string;
  description: string;
  permissions: MerchantEnterprisePermission[];
  accessScope: MerchantEnterpriseBoardAccessScope;
  allowedBoardIds: string[];
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
  invitationVersion: number;
  invitationExpiresAt: string | null;
  invitationRevokedAt: string | null;
  invitationSentAt: string | null;
  invitationDeliveryStatus: MerchantEnterpriseInvitationDeliveryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantTaskBoard = {
  id: string;
  siteId: string;
  name: string;
  description: string;
  position: number;
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

export type MerchantTaskChecklistItem = {
  id: string;
  siteId: string;
  taskId: string;
  text: string;
  position: number;
  completed: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantTaskEventActorType = "owner" | "employee" | "system";

export type MerchantTaskEventPayload = {
  text?: string;
  fields?: string[];
  columnId?: string;
  fromColumnId?: string;
  toColumnId?: string;
  priority?: MerchantTaskPriority;
  assigneeIds?: string[];
  requestedTargetIndex?: number;
  targetIndex?: number;
  position?: number;
  completedAt?: string | null;
  checklistItemId?: string;
  employeeId?: string;
  offboardedEmployeeId?: string;
  replacementEmployeeId?: string;
  oldRoleId?: string;
  newRoleId?: string;
  completed?: boolean;
  previousCompleted?: boolean;
  archived?: boolean;
  previousArchived?: boolean;
};

export type MerchantTaskEvent = {
  id: string;
  siteId: string;
  taskId: string;
  eventType: string;
  actorType: MerchantTaskEventActorType;
  actorId: string;
  payload: MerchantTaskEventPayload;
  createdAt: string;
};

export type MerchantEnterpriseNotificationPayload = {
  dueAt?: string | null;
};

export type MerchantEnterpriseNotification = {
  id: string;
  siteId: string;
  taskId: string;
  type: MerchantEnterpriseNotificationType;
  actorType: MerchantTaskEventActorType;
  actorId: string;
  payload: MerchantEnterpriseNotificationPayload;
  readAt: string | null;
  createdAt: string;
};

export type MerchantEnterpriseAuditDataValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export type MerchantEnterpriseAuditData = Readonly<
  Record<string, MerchantEnterpriseAuditDataValue>
>;

export type MerchantEnterpriseAuditEvent = {
  id: string;
  siteId: string;
  eventType: MerchantEnterpriseAuditEventType;
  entityType: MerchantEnterpriseAuditEntityType;
  entityId: string | null;
  actorType: MerchantTaskEventActorType;
  actorId: string | null;
  actorLabel: string;
  targetLabel: string;
  beforeData: MerchantEnterpriseAuditData;
  afterData: MerchantEnterpriseAuditData;
  operationId: string;
  createdAt: string;
};

export type MerchantEnterpriseAuditCursor = {
  beforeCreatedAt: string;
  beforeId: string;
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
      accessScope: "all";
      allowedBoardIds: string[];
    }
  | {
      type: "employee";
      id: string;
      siteId: string;
      displayName: string;
      email: string;
      roleId: string;
      permissions: MerchantEnterprisePermission[];
      accessScope: MerchantEnterpriseBoardAccessScope;
      allowedBoardIds: string[];
    };

export type MerchantEnterpriseBoardAccess = Pick<
  MerchantEnterpriseRole,
  "accessScope" | "allowedBoardIds"
>;

export const DEFAULT_MERCHANT_TASK_COLUMNS = [
  { name: "待处理", color: "#64748b" },
  { name: "进行中", color: "#2563eb" },
  { name: "受阻", color: "#dc2626" },
  { name: "已完成", color: "#16a34a" },
] as const;

const DEFAULT_MERCHANT_ENTERPRISE_ROLE_PERMISSIONS =
  MERCHANT_ENTERPRISE_PERMISSIONS.filter(
    (permission) =>
      permission !== "orders.linked.view" && permission !== "audit.view",
  );

export const DEFAULT_MERCHANT_ENTERPRISE_ROLES: ReadonlyArray<{
  name: string;
  description: string;
  permissions: MerchantEnterprisePermission[];
}> = [
  {
    name: "管理员",
    description: "管理企业协作模块内的员工、角色、看板和任务。",
    permissions: [...DEFAULT_MERCHANT_ENTERPRISE_ROLE_PERMISSIONS],
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

const MERCHANT_ENTERPRISE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeMerchantEnterpriseBoardIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => normalizeText(item, 80))
        .filter((item) => MERCHANT_ENTERPRISE_UUID_PATTERN.test(item)),
    ),
  ).slice(0, MAX_MERCHANT_ENTERPRISE_ROLE_BOARDS);
}

export function parseMerchantEnterpriseBoardIdsStrict(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_MERCHANT_ENTERPRISE_ROLE_BOARDS) return null;
  const requested = value.map((item) => normalizeText(item, 80));
  if (
    requested.some((item) => !MERCHANT_ENTERPRISE_UUID_PATTERN.test(item)) ||
    new Set(requested).size !== requested.length
  ) {
    return null;
  }
  return requested;
}

export function parseMerchantEnterpriseBoardAccessStrict(
  accessScopeValue: unknown,
  allowedBoardIdsValue: unknown,
): MerchantEnterpriseBoardAccess | null {
  if (accessScopeValue !== "all" && accessScopeValue !== "restricted") return null;
  const allowedBoardIds = parseMerchantEnterpriseBoardIdsStrict(allowedBoardIdsValue);
  if (!allowedBoardIds || (accessScopeValue === "all" && allowedBoardIds.length > 0)) {
    return null;
  }
  return {
    accessScope: accessScopeValue,
    allowedBoardIds: accessScopeValue === "all" ? [] : allowedBoardIds,
  };
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

function normalizeInvitationVersion(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(0, parsed) : 0;
}

export function getMissingMerchantEnterprisePermissionDependencies(
  permissions: readonly MerchantEnterprisePermission[],
) {
  const selected = new Set(permissions);
  return Array.from(
    new Set(
      permissions.flatMap((permission) =>
        MERCHANT_ENTERPRISE_PERMISSION_DEPENDENCIES[permission].filter(
          (dependency) => !selected.has(dependency),
        ),
      ),
    ),
  );
}

export function toggleMerchantEnterprisePermissionSelection(
  permissions: readonly MerchantEnterprisePermission[],
  permission: MerchantEnterprisePermission,
  checked: boolean,
) {
  const selected = new Set(permissions);
  if (checked) {
    selected.add(permission);
    for (const dependency of MERCHANT_ENTERPRISE_PERMISSION_DEPENDENCIES[permission]) {
      selected.add(dependency);
    }
  } else {
    selected.delete(permission);
    let removedDependent = true;
    while (removedDependent) {
      removedDependent = false;
      for (const candidate of MERCHANT_ENTERPRISE_PERMISSIONS) {
        if (
          selected.has(candidate) &&
          MERCHANT_ENTERPRISE_PERMISSION_DEPENDENCIES[candidate].some(
            (dependency) => !selected.has(dependency),
          )
        ) {
          selected.delete(candidate);
          removedDependent = true;
        }
      }
    }
  }
  return MERCHANT_ENTERPRISE_PERMISSIONS.filter((candidate) => selected.has(candidate));
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

export function hasMerchantEnterpriseBoardAccess(
  actor: MerchantEnterpriseActor,
  boardId: string,
) {
  return (
    actor.type === "owner" ||
    actor.accessScope === "all" ||
    actor.allowedBoardIds.includes(boardId)
  );
}

export function merchantEnterpriseBoardAccessFitsActor(
  actor: MerchantEnterpriseActor,
  access: MerchantEnterpriseBoardAccess,
) {
  if (actor.type === "owner" || actor.accessScope === "all") return true;
  if (access.accessScope === "all") return false;
  const actorBoardIds = new Set(actor.allowedBoardIds);
  return access.allowedBoardIds.every((boardId) => actorBoardIds.has(boardId));
}

export function merchantEnterpriseRoleFitsActor(
  actor: MerchantEnterpriseActor,
  role: Pick<
    MerchantEnterpriseRole,
    "permissions" | "accessScope" | "allowedBoardIds"
  >,
) {
  return (
    merchantEnterprisePermissionsFitActor(actor, role.permissions) &&
    merchantEnterpriseBoardAccessFitsActor(actor, role)
  );
}

export function getMerchantEmployeeRoleTransitionAffectedTasks(
  employee: Pick<MerchantEnterpriseEmployee, "id">,
  targetRole: {
    permissions: readonly MerchantEnterprisePermission[];
    accessScope: MerchantEnterpriseBoardAccessScope;
    allowedBoardIds: readonly string[];
  },
  tasks: readonly MerchantTask[],
) {
  const canViewTasks = targetRole.permissions.includes("tasks.view");
  const allowedBoardIds =
    targetRole.accessScope === "restricted"
      ? new Set(targetRole.allowedBoardIds)
      : null;

  return tasks.filter(
    (task) =>
      task.assigneeIds.includes(employee.id) &&
      !task.archivedAt &&
      !task.completedAt &&
      (!canViewTasks || Boolean(allowedBoardIds && !allowedBoardIds.has(task.boardId))),
  );
}

export function canMerchantEnterpriseEmployeeCoverBoards(
  employee:
    | Pick<MerchantEnterpriseEmployee, "roleId" | "status">
    | null
    | undefined,
  role:
    | {
        id: string;
        permissions: readonly MerchantEnterprisePermission[];
        accessScope: MerchantEnterpriseBoardAccessScope;
        allowedBoardIds: readonly string[];
        status: MerchantEnterpriseRoleStatus;
      }
    | null
    | undefined,
  boardIds: readonly string[],
) {
  if (
    !employee ||
    employee.status !== "active" ||
    !role ||
    role.status !== "active" ||
    employee.roleId !== role.id ||
    !role.permissions.includes("tasks.view")
  ) {
    return false;
  }
  if (role.accessScope === "all") return true;
  const allowedBoardIds = new Set(role.allowedBoardIds);
  return boardIds.every((boardId) => allowedBoardIds.has(boardId));
}

export function getMerchantEnterpriseDefaultRoleBoardAccess(
  actor: MerchantEnterpriseActor,
): MerchantEnterpriseBoardAccess {
  return actor.type === "employee" && actor.accessScope === "restricted"
    ? { accessScope: "restricted", allowedBoardIds: [...actor.allowedBoardIds] }
    : { accessScope: "all", allowedBoardIds: [] };
}

export function canCreateMerchantEnterpriseBoards(
  actor: MerchantEnterpriseActor | null | undefined,
) {
  return Boolean(
    actor &&
      hasMerchantEnterprisePermission(actor, "boards.manage") &&
      (actor.type === "owner" || actor.accessScope === "all"),
  );
}

export function filterMerchantEnterpriseSnapshotByBoardAccess(
  actor: MerchantEnterpriseActor,
  snapshot: MerchantEnterpriseSnapshot,
): MerchantEnterpriseSnapshot {
  if (actor.type === "owner" || actor.accessScope === "all") return snapshot;
  const allowedBoardIds = new Set(actor.allowedBoardIds);
  return {
    ...snapshot,
    boards: snapshot.boards.filter((board) => allowedBoardIds.has(board.id)),
    columns: snapshot.columns.filter((column) => allowedBoardIds.has(column.boardId)),
    tasks: snapshot.tasks.filter((task) => allowedBoardIds.has(task.boardId)),
  };
}

export function normalizeMerchantEnterpriseRole(value: unknown): MerchantEnterpriseRole | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const name = normalizeText(record.name, 80);
  if (!id || !siteId || !name) return null;
  const statusValue = normalizeText(record.status, 20);
  const hasExplicitAccessScope =
    Object.prototype.hasOwnProperty.call(record, "accessScope") ||
    Object.prototype.hasOwnProperty.call(record, "access_scope");
  const accessScopeValue = readValue(record, "accessScope", "access_scope");
  if (
    hasExplicitAccessScope &&
    accessScopeValue !== "all" &&
    accessScopeValue !== "restricted"
  ) {
    return null;
  }
  const accessScope = accessScopeValue === "restricted" ? "restricted" : "all";
  const allowedBoardIds =
    accessScope === "restricted"
      ? normalizeMerchantEnterpriseBoardIds(
          readValue(record, "allowedBoardIds", "allowed_board_ids") ?? record.board_ids,
        )
      : [];
  return {
    id,
    siteId,
    name,
    description: normalizeText(record.description, 1000),
    permissions: normalizeMerchantEnterprisePermissions(record.permissions),
    accessScope,
    allowedBoardIds,
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
  const deliveryStatusValue = normalizeText(
    readValue(record, "invitationDeliveryStatus", "invitation_delivery_status"),
    20,
  ) as MerchantEnterpriseInvitationDeliveryStatus;
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
    invitationVersion: normalizeInvitationVersion(
      readValue(record, "invitationVersion", "invitation_version"),
    ),
    invitationExpiresAt: normalizeNullableTimestamp(
      readValue(record, "invitationExpiresAt", "invitation_expires_at"),
    ),
    invitationRevokedAt: normalizeNullableTimestamp(
      readValue(record, "invitationRevokedAt", "invitation_revoked_at"),
    ),
    invitationSentAt: normalizeNullableTimestamp(
      readValue(record, "invitationSentAt", "invitation_sent_at"),
    ),
    invitationDeliveryStatus: MERCHANT_ENTERPRISE_INVITATION_DELIVERY_STATUSES.includes(
      deliveryStatusValue,
    )
      ? deliveryStatusValue
      : "none",
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
    position: normalizePosition(record.position),
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

function normalizeEventInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeEventTextArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return undefined;
  return Array.from(
    new Set(
      value
        .slice(0, maxItems)
        .map((item) => normalizeText(item, maxLength))
        .filter(Boolean),
    ),
  );
}

export function normalizeMerchantTaskEvent(value: unknown): MerchantTaskEvent | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const taskId = normalizeText(readValue(record, "taskId", "task_id"), 80);
  const eventType = normalizeText(readValue(record, "eventType", "event_type"), 80);
  if (!id || !siteId || !taskId || !eventType) return null;

  const actorTypeValue = normalizeText(
    readValue(record, "actorType", "actor_type"),
    20,
  );
  const actorType: MerchantTaskEventActorType =
    actorTypeValue === "owner" || actorTypeValue === "employee"
      ? actorTypeValue
      : "system";
  const rawPayload = readRecord(record.payload);
  const payload: MerchantTaskEventPayload = {};

  const commentText = normalizeText(rawPayload.text, 2000);
  if (commentText) payload.text = commentText;
  const fields = normalizeEventTextArray(rawPayload.fields, 32, 80);
  if (fields?.length) payload.fields = fields;

  for (const key of [
    "columnId",
    "fromColumnId",
    "toColumnId",
    "employeeId",
    "offboardedEmployeeId",
    "replacementEmployeeId",
    "oldRoleId",
    "newRoleId",
  ] as const) {
    const normalized = normalizeText(rawPayload[key], 80);
    if (normalized) payload[key] = normalized;
  }

  const priorityValue = normalizeText(rawPayload.priority, 20) as MerchantTaskPriority;
  if (MERCHANT_TASK_PRIORITIES.includes(priorityValue)) payload.priority = priorityValue;
  const assigneeIds = normalizeEventTextArray(
    rawPayload.assigneeIds,
    MAX_MERCHANT_TASK_ASSIGNEES,
    80,
  );
  if (assigneeIds?.length) payload.assigneeIds = assigneeIds;

  for (const key of ["requestedTargetIndex", "targetIndex", "position"] as const) {
    const normalized = normalizeEventInteger(rawPayload[key]);
    if (normalized !== undefined) payload[key] = normalized;
  }

  if (rawPayload.completedAt === null) {
    payload.completedAt = null;
  } else {
    const completedAt = normalizeNullableTimestamp(rawPayload.completedAt);
    if (completedAt) payload.completedAt = completedAt;
  }

  const checklistItemId = normalizeText(rawPayload.checklistItemId, 80);
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      checklistItemId,
    )
  ) {
    payload.checklistItemId = checklistItemId;
  }
  for (const key of [
    "completed",
    "previousCompleted",
    "archived",
    "previousArchived",
  ] as const) {
    if (typeof rawPayload[key] === "boolean") payload[key] = rawPayload[key];
  }

  return {
    id,
    siteId,
    taskId,
    eventType,
    actorType,
    actorId: normalizeText(readValue(record, "actorId", "actor_id"), 120),
    payload,
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
  };
}

export function normalizeMerchantEnterpriseNotification(
  value: unknown,
): MerchantEnterpriseNotification | null {
  const record = readRecord(value);
  const id = normalizeText(record.id, 80);
  const siteId = normalizeText(readValue(record, "siteId", "merchant_id"), 80);
  const taskId = normalizeText(readValue(record, "taskId", "task_id"), 80);
  const typeValue = normalizeText(
    readValue(record, "type", "notification_type"),
    80,
  ) as MerchantEnterpriseNotificationType;
  if (
    !MERCHANT_ENTERPRISE_UUID_PATTERN.test(id) ||
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_UUID_PATTERN.test(taskId) ||
    !MERCHANT_ENTERPRISE_NOTIFICATION_TYPES.includes(typeValue)
  ) {
    return null;
  }

  const actorTypeValue = normalizeText(
    readValue(record, "actorType", "actor_type"),
    20,
  );
  const actorType: MerchantTaskEventActorType =
    actorTypeValue === "owner" || actorTypeValue === "employee"
      ? actorTypeValue
      : "system";
  const rawPayload = readRecord(record.payload);
  const payload: MerchantEnterpriseNotificationPayload = {};
  if (rawPayload.dueAt === null || rawPayload.due_at === null) {
    payload.dueAt = null;
  } else {
    const dueAt = normalizeNullableTimestamp(
      readValue(rawPayload, "dueAt", "due_at"),
    );
    if (dueAt) payload.dueAt = dueAt;
  }

  return {
    id,
    siteId,
    taskId,
    type: typeValue,
    actorType,
    actorId: normalizeText(readValue(record, "actorId", "actor_id"), 120),
    payload,
    readAt: normalizeNullableTimestamp(readValue(record, "readAt", "read_at")),
    createdAt: normalizeTimestamp(readValue(record, "createdAt", "created_at")),
  };
}

const MERCHANT_ENTERPRISE_AUDIT_DATA_KEYS: Readonly<
  Record<MerchantEnterpriseAuditEntityType, ReadonlySet<string>>
> = {
  workspace: new Set(["initialized"]),
  role: new Set([
    "name",
    "description",
    "permissions",
    "status",
    "is_system",
    "access_scope",
    "system_key",
    "board_id",
  ]),
  board: new Set(["name", "description", "status", "position", "system_key"]),
  column: new Set([
    "board_id",
    "name",
    "color",
    "position",
    "is_done",
    "status",
    "system_key",
  ]),
  employee: new Set([
    "display_name",
    "role_id",
    "status",
    "auth_bound",
    "invitation_version",
    "invitation_delivery_status",
    "invitation_sent_at",
    "invitation_expires_at",
    "invitation_revoked_at",
    "accepted_at",
  ]),
  invitation: new Set([
    "display_name",
    "role_id",
    "status",
    "auth_bound",
    "invitation_version",
    "invitation_delivery_status",
    "invitation_sent_at",
    "invitation_expires_at",
    "invitation_revoked_at",
    "accepted_at",
  ]),
};

function auditEventMatchesEntity(
  eventType: MerchantEnterpriseAuditEventType,
  entityType: MerchantEnterpriseAuditEntityType,
) {
  if (eventType.startsWith("workspace.")) return entityType === "workspace";
  if (eventType.startsWith("role.")) return entityType === "role";
  if (eventType.startsWith("board.")) return entityType === "board";
  if (eventType.startsWith("column.")) return entityType === "column";
  if (eventType.startsWith("employee.")) return entityType === "employee";
  return eventType.startsWith("invitation.") && entityType === "invitation";
}

function normalizeAuditTimestampValue(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 80) return undefined;
  return normalizeNullableTimestamp(value) ?? undefined;
}

function normalizeMerchantEnterpriseAuditData(
  value: unknown,
  entityType: MerchantEnterpriseAuditEntityType,
): MerchantEnterpriseAuditData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowedKeys = MERCHANT_ENTERPRISE_AUDIT_DATA_KEYS[entityType];
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;

  const normalized: Record<string, MerchantEnterpriseAuditDataValue> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (key === "permissions") {
      const permissions = parseMerchantEnterprisePermissionsStrict(rawValue);
      if (!permissions) return null;
      normalized[key] = permissions;
      continue;
    }
    if (key === "position" || key === "invitation_version") {
      if (!Number.isSafeInteger(rawValue) || Number(rawValue) < 0) return null;
      normalized[key] = Number(rawValue);
      continue;
    }
    if (key === "initialized" || key === "is_system" || key === "is_done" || key === "auth_bound") {
      if (typeof rawValue !== "boolean") return null;
      normalized[key] = rawValue;
      continue;
    }
    if ([
      "invitation_sent_at",
      "invitation_expires_at",
      "invitation_revoked_at",
      "accepted_at",
    ].includes(key)) {
      const timestamp = normalizeAuditTimestampValue(rawValue);
      if (timestamp === undefined) return null;
      normalized[key] = timestamp;
      continue;
    }
    if (key === "role_id" || key === "board_id") {
      if (rawValue === null) {
        normalized[key] = null;
      } else if (
        typeof rawValue === "string" &&
        MERCHANT_ENTERPRISE_UUID_PATTERN.test(rawValue)
      ) {
        normalized[key] = rawValue;
      } else {
        return null;
      }
      continue;
    }
    if (rawValue === null && key === "system_key") {
      normalized[key] = null;
      continue;
    }
    if (typeof rawValue !== "string") return null;
    const maxLength = key === "description" ? 2000 : key === "display_name" ? 120 : 160;
    if (rawValue.length > maxLength) return null;
    if (key === "color" && !/^#[0-9a-f]{6}$/i.test(rawValue)) return null;
    if (key === "access_scope" && rawValue !== "all" && rawValue !== "restricted") {
      return null;
    }
    if (
      key === "invitation_delivery_status" &&
      !MERCHANT_ENTERPRISE_INVITATION_DELIVERY_STATUSES.includes(
        rawValue as MerchantEnterpriseInvitationDeliveryStatus,
      )
    ) {
      return null;
    }
    normalized[key] = rawValue;
  }
  return normalized;
}

export function normalizeMerchantEnterpriseAuditEvent(
  value: unknown,
): MerchantEnterpriseAuditEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = readValue(record, "id", "id");
  const siteId = readValue(record, "siteId", "merchant_id");
  const eventType = readValue(record, "eventType", "event_type");
  const entityType = readValue(record, "entityType", "entity_type");
  const entityId = readValue(record, "entityId", "entity_id");
  const actorType = readValue(record, "actorType", "actor_type");
  const actorId = readValue(record, "actorId", "actor_id");
  const actorLabel = readValue(record, "actorLabel", "actor_label");
  const targetLabel = readValue(record, "targetLabel", "target_label");
  const operationId = readValue(record, "operationId", "operation_id");
  const createdAt = normalizeAuditTimestampValue(
    readValue(record, "createdAt", "created_at"),
  );
  if (
    typeof id !== "string" ||
    !MERCHANT_ENTERPRISE_UUID_PATTERN.test(id) ||
    typeof siteId !== "string" ||
    !/^\d{8}$/.test(siteId) ||
    typeof eventType !== "string" ||
    !MERCHANT_ENTERPRISE_AUDIT_EVENT_TYPES.includes(
      eventType as MerchantEnterpriseAuditEventType,
    ) ||
    typeof entityType !== "string" ||
    !MERCHANT_ENTERPRISE_AUDIT_ENTITY_TYPES.includes(
      entityType as MerchantEnterpriseAuditEntityType,
    ) ||
    (actorType !== "owner" && actorType !== "employee" && actorType !== "system") ||
    typeof actorLabel !== "string" ||
    actorLabel.trim() !== actorLabel ||
    actorLabel.length < 1 ||
    actorLabel.length > 160 ||
    typeof targetLabel !== "string" ||
    targetLabel.trim() !== targetLabel ||
    targetLabel.length < 1 ||
    targetLabel.length > 160 ||
    typeof operationId !== "string" ||
    operationId.length > 160 ||
    createdAt === null ||
    createdAt === undefined
  ) {
    return null;
  }
  const resolvedEventType = eventType as MerchantEnterpriseAuditEventType;
  const resolvedEntityType = entityType as MerchantEnterpriseAuditEntityType;
  if (!auditEventMatchesEntity(resolvedEventType, resolvedEntityType)) return null;
  const normalizedEntityId =
    entityId === null
      ? null
      : typeof entityId === "string" && MERCHANT_ENTERPRISE_UUID_PATTERN.test(entityId)
        ? entityId
        : undefined;
  if (
    normalizedEntityId === undefined ||
    (resolvedEntityType === "workspace" && normalizedEntityId !== null) ||
    (resolvedEntityType !== "workspace" && normalizedEntityId === null)
  ) {
    return null;
  }
  const normalizedActorId =
    actorId === null
      ? null
      : typeof actorId === "string" && MERCHANT_ENTERPRISE_UUID_PATTERN.test(actorId)
        ? actorId
        : undefined;
  if (
    normalizedActorId === undefined ||
    (actorType === "employee" && normalizedActorId === null) ||
    (actorType !== "employee" && normalizedActorId !== null)
  ) {
    return null;
  }
  const beforeData = normalizeMerchantEnterpriseAuditData(
    readValue(record, "beforeData", "before_data"),
    resolvedEntityType,
  );
  const afterData = normalizeMerchantEnterpriseAuditData(
    readValue(record, "afterData", "after_data"),
    resolvedEntityType,
  );
  if (!beforeData || !afterData) return null;

  return {
    id,
    siteId,
    eventType: resolvedEventType,
    entityType: resolvedEntityType,
    entityId: normalizedEntityId,
    actorType,
    actorId: normalizedActorId,
    actorLabel,
    targetLabel,
    beforeData,
    afterData,
    operationId,
    createdAt,
  };
}

export type MerchantTaskFilter = {
  query?: string;
  priority?: MerchantTaskPriority | "all";
  assigneeId?: string;
  archive?: "active" | "archived" | "all";
};

export type MerchantTaskEditValues = {
  title: string;
  description: string;
  priority: MerchantTaskPriority;
  dueAt: string | null;
  columnId: string;
  assigneeIds: string[];
};

export type MerchantTaskEditBuildResult =
  | {
      ok: true;
      changes: Partial<MerchantTaskEditValues>;
    }
  | {
      ok: false;
      error: "inactive_assignee" | "too_many_assignees";
      employeeId?: string;
    };

export function buildMerchantTaskEditChanges(
  actor: MerchantEnterpriseActor,
  task: MerchantTask,
  values: MerchantTaskEditValues,
  employees: readonly Pick<MerchantEnterpriseEmployee, "id" | "status">[],
): MerchantTaskEditBuildResult {
  const changes: Partial<MerchantTaskEditValues> = {};
  if (hasMerchantEnterprisePermission(actor, "tasks.update")) {
    const title = normalizeText(values.title, 240);
    const description = normalizeText(values.description, 10000);
    const columnId = normalizeText(values.columnId, 80);
    const dueAt =
      values.dueAt && Number.isFinite(Date.parse(values.dueAt))
        ? new Date(values.dueAt).toISOString()
        : null;
    if (title !== task.title) changes.title = title;
    if (description !== task.description) changes.description = description;
    if (values.priority !== task.priority) changes.priority = values.priority;
    if (dueAt !== task.dueAt) changes.dueAt = dueAt;
    if (columnId !== task.columnId) changes.columnId = columnId;
  }

  if (hasMerchantEnterprisePermission(actor, "tasks.assign")) {
    if (values.assigneeIds.length > MAX_MERCHANT_TASK_ASSIGNEES) {
      return { ok: false, error: "too_many_assignees" };
    }
    const currentAssigneeIds = [...task.assigneeIds].sort();
    const nextAssigneeIds = Array.from(
      new Set(values.assigneeIds.map((id) => normalizeText(id, 80)).filter(Boolean)),
    ).sort();
    if (currentAssigneeIds.join("\n") !== nextAssigneeIds.join("\n")) {
      const employeeStatusById = new Map(
        employees.map((employee) => [employee.id, employee.status] as const),
      );
      const inactiveAssigneeId = nextAssigneeIds.find(
        (id) => employeeStatusById.get(id) !== "active",
      );
      if (inactiveAssigneeId) {
        return {
          ok: false,
          error: "inactive_assignee",
          employeeId: inactiveAssigneeId,
        };
      }
      changes.assigneeIds = nextAssigneeIds;
    }
  }

  return { ok: true, changes };
}

export type MerchantTaskCompletionTransition = {
  action: "complete" | "reopen";
  targetColumnId: string;
  targetColumnName: string;
};

export function getMerchantTaskCompletionTransition(
  task: Pick<MerchantTask, "boardId" | "columnId" | "archivedAt">,
  columns: readonly Pick<
    MerchantTaskColumn,
    "id" | "boardId" | "name" | "position" | "status" | "isDone"
  >[],
): MerchantTaskCompletionTransition | null {
  if (task.archivedAt) return null;
  const currentColumn = columns.find(
    (column) =>
      column.id === task.columnId &&
      column.boardId === task.boardId &&
      column.status === "active",
  );
  if (!currentColumn) return null;

  const targetColumn = columns
    .filter(
      (column) =>
        column.boardId === task.boardId &&
        column.status === "active" &&
        column.isDone !== currentColumn.isDone,
    )
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0];
  if (!targetColumn) return null;

  return {
    action: currentColumn.isDone ? "reopen" : "complete",
    targetColumnId: targetColumn.id,
    targetColumnName: targetColumn.name,
  };
}

export function filterMerchantTasks(
  tasks: readonly MerchantTask[],
  filter: MerchantTaskFilter,
) {
  const query = normalizeText(filter.query, 240).toLocaleLowerCase();
  const priority = filter.priority ?? "all";
  const assigneeId = normalizeText(filter.assigneeId, 80);
  const archive = filter.archive ?? "active";
  return tasks.filter((task) => {
    if (archive === "active" && task.archivedAt) return false;
    if (archive === "archived" && !task.archivedAt) return false;
    if (priority !== "all" && task.priority !== priority) return false;
    if (assigneeId === "unassigned" && task.assigneeIds.length > 0) return false;
    if (
      assigneeId &&
      assigneeId !== "all" &&
      assigneeId !== "unassigned" &&
      !task.assigneeIds.includes(assigneeId)
    ) {
      return false;
    }
    if (
      query &&
      !`${task.title}\n${task.description}`.toLocaleLowerCase().includes(query)
    ) {
      return false;
    }
    return true;
  });
}

export function getMerchantEnterpriseDefaultTaskAssigneeFilter(
  actor: Pick<MerchantEnterpriseActor, "type" | "id">,
) {
  return actor.type === "employee" ? actor.id : "all";
}

export function buildMerchantEnterpriseTaskOverview(
  input: {
    boards: readonly Pick<MerchantTaskBoard, "id" | "status">[];
    tasks: readonly MerchantTask[];
    assigneeId?: string;
  },
  nowMs = Date.now(),
) {
  const activeBoardIds = new Set(
    input.boards.filter((board) => board.status === "active").map((board) => board.id),
  );
  const tasks = filterMerchantTasks(
    input.tasks.filter((task) => activeBoardIds.has(task.boardId)),
    { archive: "active", assigneeId: input.assigneeId },
  );
  const recentTasks = [...tasks].sort((left, right) => {
    const leftDue = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    const updatedDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updatedDifference !== 0) return updatedDifference;
    return left.id.localeCompare(right.id);
  });

  return {
    tasks,
    recentTasks,
    incompleteTaskCount: tasks.filter((task) => !task.completedAt).length,
    completedTaskCount: tasks.filter((task) => Boolean(task.completedAt)).length,
    overdueTaskCount: tasks.filter((task) => {
      if (!task.dueAt || task.completedAt) return false;
      const dueAtMs = Date.parse(task.dueAt);
      return Number.isFinite(dueAtMs) && dueAtMs < nowMs;
    }).length,
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
