import type {
  MerchantEnterpriseActor,
  MerchantTask,
  MerchantTaskBoard,
  MerchantTaskColumn,
  MerchantTaskPriority,
} from "@/lib/merchantEnterprise";

export const MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_BOARDS = 100;
export const MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_PRIORITY_TASKS = 6;

export function buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint(
  actor: Pick<
    MerchantEnterpriseActor,
    "type" | "id" | "accessScope" | "allowedBoardIds" | "permissions"
  >,
) {
  return JSON.stringify([
    actor.type,
    actor.id,
    actor.accessScope,
    [...actor.allowedBoardIds].sort(),
    [...actor.permissions].sort(),
  ]);
}

export function buildMerchantEnterpriseCurrentOperationsRequestKey(input: {
  siteId: string;
  actorAuthorizationFingerprint: string;
  scope: "enterprise" | "employee";
  employeeId: string | null;
}) {
  return JSON.stringify([
    input.siteId,
    input.actorAuthorizationFingerprint,
    input.scope,
    input.employeeId,
  ]);
}

export type MerchantEnterpriseCurrentOperationsSummary = {
  openTaskCount: number;
  overdueTaskCount: number;
  dueSoonTaskCount: number;
  unassignedTaskCount: number | null;
  involvedBoardCount: number;
  sharedAssignmentTaskCount: number | null;
};

export type MerchantEnterpriseCurrentOperationsBoard = {
  boardId: string;
  boardName: string;
  openTaskCount: number;
  overdueTaskCount: number;
  dueSoonTaskCount: number;
};

export type MerchantEnterpriseCurrentOperationsPriorityTask = {
  id: string;
  boardId: string;
  boardName: string;
  columnId: string;
  columnName: string;
  title: string;
  priority: MerchantTaskPriority;
  dueAt: string | null;
  updatedAt: string;
  assigneeCount: number;
};

export type MerchantEnterpriseCurrentOperations = {
  ok: true;
  asOf: string;
  scope: "enterprise" | "employee";
  employeeId: string | null;
  scopeRestricted: boolean;
  boardSummaryTotalCount: number;
  boardsTruncated: boolean;
  summary: MerchantEnterpriseCurrentOperationsSummary;
  boards: MerchantEnterpriseCurrentOperationsBoard[];
  priorityTasks: MerchantEnterpriseCurrentOperationsPriorityTask[];
};

const CURRENT_OPERATIONS_FALLBACK_DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENT_OPERATIONS_PRIORITY_ORDER: Record<MerchantTaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Temporary rollout fallback for the short app-before-migration window.
 * The supplied snapshot has already been authorized and board-filtered by
 * the overview API. This fallback must never be used for arbitrary read
 * failures or as the long-term reporting source.
 */
export function buildMerchantEnterpriseCurrentOperationsFallback(
  input: {
    actor: Pick<MerchantEnterpriseActor, "type" | "id" | "accessScope">;
    boards: readonly Pick<MerchantTaskBoard, "id" | "name" | "position" | "status">[];
    columns: readonly Pick<MerchantTaskColumn, "id" | "boardId" | "name">[];
    tasks: readonly Pick<
      MerchantTask,
      | "id"
      | "boardId"
      | "columnId"
      | "title"
      | "priority"
      | "dueAt"
      | "updatedAt"
      | "archivedAt"
      | "completedAt"
      | "assigneeIds"
    >[];
  },
  nowMs = Date.now(),
): MerchantEnterpriseCurrentOperations {
  const asOfMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const dueSoonBoundaryMs = asOfMs + CURRENT_OPERATIONS_FALLBACK_DUE_SOON_MS;
  const employeeId = input.actor.type === "employee" ? input.actor.id : null;
  const activeBoards = input.boards
    .filter((board) => board.status === "active")
    .sort((left, right) => {
      if (left.position !== right.position) return left.position - right.position;
      const nameDifference = left.name.localeCompare(right.name);
      return nameDifference !== 0 ? nameDifference : left.id.localeCompare(right.id);
    });
  const activeBoardIds = new Set(activeBoards.map((board) => board.id));
  const matchingTasks = input.tasks.filter(
    (task) =>
      !task.archivedAt &&
      !task.completedAt &&
      activeBoardIds.has(task.boardId) &&
      (!employeeId || task.assigneeIds.includes(employeeId)),
  );
  const boardRows = activeBoards
    .map((board) => {
      const tasks = matchingTasks.filter((task) => task.boardId === board.id);
      let overdueTaskCount = 0;
      let dueSoonTaskCount = 0;
      for (const task of tasks) {
        const dueAtMs = timestamp(task.dueAt);
        if (dueAtMs === null) continue;
        if (dueAtMs < asOfMs) overdueTaskCount += 1;
        else if (dueAtMs < dueSoonBoundaryMs) dueSoonTaskCount += 1;
      }
      return {
        boardId: board.id,
        boardName: board.name,
        openTaskCount: tasks.length,
        overdueTaskCount,
        dueSoonTaskCount,
      };
    })
    .sort((left, right) => {
      if (left.overdueTaskCount !== right.overdueTaskCount) {
        return right.overdueTaskCount - left.overdueTaskCount;
      }
      if (left.openTaskCount !== right.openTaskCount) {
        return right.openTaskCount - left.openTaskCount;
      }
      const nameDifference = left.boardName.localeCompare(right.boardName);
      return nameDifference !== 0
        ? nameDifference
        : left.boardId.localeCompare(right.boardId);
    });
  const boardNameById = new Map(activeBoards.map((board) => [board.id, board.name]));
  const columnById = new Map(input.columns.map((column) => [column.id, column]));
  const priorityTasks = [...matchingTasks]
    .sort((left, right) => {
      const leftDueAt = timestamp(left.dueAt);
      const rightDueAt = timestamp(right.dueAt);
      if (leftDueAt === null && rightDueAt !== null) return 1;
      if (leftDueAt !== null && rightDueAt === null) return -1;
      if (leftDueAt !== null && rightDueAt !== null && leftDueAt !== rightDueAt) {
        return leftDueAt - rightDueAt;
      }
      const priorityDifference =
        CURRENT_OPERATIONS_PRIORITY_ORDER[left.priority] -
        CURRENT_OPERATIONS_PRIORITY_ORDER[right.priority];
      if (priorityDifference !== 0) return priorityDifference;
      const updatedDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return updatedDifference !== 0 ? updatedDifference : left.id.localeCompare(right.id);
    })
    .slice(0, MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_PRIORITY_TASKS)
    .map((task) => {
      const column = columnById.get(task.columnId);
      return {
        id: task.id,
        boardId: task.boardId,
        boardName: boardNameById.get(task.boardId) ?? "未知看板",
        columnId: task.columnId,
        columnName: column?.boardId === task.boardId ? column.name : "未知工作列",
        title: task.title,
        priority: task.priority,
        dueAt: task.dueAt,
        updatedAt: task.updatedAt,
        assigneeCount: task.assigneeIds.length,
      };
    });

  return {
    ok: true,
    asOf: new Date(asOfMs).toISOString(),
    scope: employeeId ? "employee" : "enterprise",
    employeeId,
    scopeRestricted: input.actor.accessScope === "restricted",
    boardSummaryTotalCount: boardRows.length,
    boardsTruncated:
      boardRows.length > MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_BOARDS,
    summary: {
      openTaskCount: matchingTasks.length,
      overdueTaskCount: boardRows.reduce(
        (total, board) => total + board.overdueTaskCount,
        0,
      ),
      dueSoonTaskCount: boardRows.reduce(
        (total, board) => total + board.dueSoonTaskCount,
        0,
      ),
      unassignedTaskCount: employeeId
        ? null
        : matchingTasks.filter((task) => task.assigneeIds.length === 0).length,
      involvedBoardCount: boardRows.filter((board) => board.openTaskCount > 0)
        .length,
      sharedAssignmentTaskCount: employeeId
        ? matchingTasks.filter((task) => task.assigneeIds.length > 1).length
        : null,
    },
    boards: boardRows.slice(
      0,
      MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_BOARDS,
    ),
    priorityTasks,
  };
}

const TASK_PRIORITIES = new Set<MerchantTaskPriority>([
  "low",
  "normal",
  "high",
  "urgent",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentifier(value: unknown) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeLabel(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const codePointLength = Array.from(value).length;
  return codePointLength >= 1 && codePointLength <= maxLength ? value : null;
}

function normalizeNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function normalizeNullableNonNegativeInteger(value: unknown) {
  if (value === null) return null;
  const normalized = normalizeNonNegativeInteger(value);
  return normalized === null ? undefined : normalized;
}

function normalizeIsoTimestamp(value: unknown, nullable: true): string | null | undefined;
function normalizeIsoTimestamp(value: unknown, nullable?: false): string | undefined;
function normalizeIsoTimestamp(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value !== value.trim()) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = new Date(parsed).toISOString();
  return value === normalized || value === normalized.replace(".000Z", "Z")
    ? normalized
    : undefined;
}

function normalizeSummary(
  value: unknown,
): MerchantEnterpriseCurrentOperationsSummary | null {
  if (!isRecord(value)) return null;
  const openTaskCount = normalizeNonNegativeInteger(value.openTaskCount);
  const overdueTaskCount = normalizeNonNegativeInteger(value.overdueTaskCount);
  const dueSoonTaskCount = normalizeNonNegativeInteger(value.dueSoonTaskCount);
  const unassignedTaskCount = normalizeNullableNonNegativeInteger(
    value.unassignedTaskCount,
  );
  const involvedBoardCount = normalizeNonNegativeInteger(value.involvedBoardCount);
  const sharedAssignmentTaskCount = normalizeNullableNonNegativeInteger(
    value.sharedAssignmentTaskCount,
  );
  if (
    openTaskCount === null ||
    overdueTaskCount === null ||
    dueSoonTaskCount === null ||
    unassignedTaskCount === undefined ||
    involvedBoardCount === null ||
    sharedAssignmentTaskCount === undefined ||
    overdueTaskCount + dueSoonTaskCount > openTaskCount ||
    (unassignedTaskCount !== null && unassignedTaskCount > openTaskCount) ||
    (sharedAssignmentTaskCount !== null && sharedAssignmentTaskCount > openTaskCount)
  ) {
    return null;
  }
  return {
    openTaskCount,
    overdueTaskCount,
    dueSoonTaskCount,
    unassignedTaskCount,
    involvedBoardCount,
    sharedAssignmentTaskCount,
  };
}

function normalizeBoard(
  value: unknown,
): MerchantEnterpriseCurrentOperationsBoard | null {
  if (!isRecord(value)) return null;
  const boardId = normalizeIdentifier(value.boardId);
  const boardName = normalizeLabel(value.boardName, 120);
  const openTaskCount = normalizeNonNegativeInteger(value.openTaskCount);
  const overdueTaskCount = normalizeNonNegativeInteger(value.overdueTaskCount);
  const dueSoonTaskCount = normalizeNonNegativeInteger(value.dueSoonTaskCount);
  if (
    !boardId ||
    !boardName ||
    openTaskCount === null ||
    overdueTaskCount === null ||
    dueSoonTaskCount === null ||
    overdueTaskCount + dueSoonTaskCount > openTaskCount
  ) {
    return null;
  }
  return {
    boardId,
    boardName,
    openTaskCount,
    overdueTaskCount,
    dueSoonTaskCount,
  };
}

function normalizePriorityTask(
  value: unknown,
): MerchantEnterpriseCurrentOperationsPriorityTask | null {
  if (!isRecord(value)) return null;
  const id = normalizeIdentifier(value.id);
  const boardId = normalizeIdentifier(value.boardId);
  const boardName = normalizeLabel(value.boardName, 120);
  const columnId = normalizeIdentifier(value.columnId);
  const columnName = normalizeLabel(value.columnName, 80);
  const title = normalizeLabel(value.title, 240);
  const priority = TASK_PRIORITIES.has(value.priority as MerchantTaskPriority)
    ? (value.priority as MerchantTaskPriority)
    : null;
  const dueAt = normalizeIsoTimestamp(value.dueAt, true);
  const updatedAt = normalizeIsoTimestamp(value.updatedAt);
  const assigneeCount = normalizeNonNegativeInteger(value.assigneeCount);
  if (
    !id ||
    !boardId ||
    !boardName ||
    !columnId ||
    !columnName ||
    !title ||
    !priority ||
    dueAt === undefined ||
    updatedAt === undefined ||
    assigneeCount === null
  ) {
    return null;
  }
  return {
    id,
    boardId,
    boardName,
    columnId,
    columnName,
    title,
    priority,
    dueAt,
    updatedAt,
    assigneeCount,
  };
}

export function normalizeMerchantEnterpriseCurrentOperations(
  value: unknown,
): MerchantEnterpriseCurrentOperations | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const asOf = normalizeIsoTimestamp(value.asOf);
  const scope = value.scope === "enterprise" || value.scope === "employee"
    ? value.scope
    : null;
  const employeeId = value.employeeId === null
    ? null
    : typeof value.employeeId === "string"
      ? normalizeIdentifier(value.employeeId) ?? undefined
      : undefined;
  const boardSummaryTotalCount = normalizeNonNegativeInteger(
    value.boardSummaryTotalCount,
  );
  const summary = normalizeSummary(value.summary);
  if (
    asOf === undefined ||
    !scope ||
    employeeId === undefined ||
    typeof value.scopeRestricted !== "boolean" ||
    boardSummaryTotalCount === null ||
    typeof value.boardsTruncated !== "boolean" ||
    !summary ||
    !Array.isArray(value.boards) ||
    value.boards.length > MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_BOARDS ||
    !Array.isArray(value.priorityTasks) ||
    value.priorityTasks.length >
      MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_PRIORITY_TASKS ||
    (scope === "enterprise" &&
      (employeeId !== null ||
        summary.unassignedTaskCount === null ||
        summary.sharedAssignmentTaskCount !== null)) ||
    (scope === "employee" &&
      (!employeeId ||
        summary.unassignedTaskCount !== null ||
        summary.sharedAssignmentTaskCount === null))
  ) {
    return null;
  }
  const boards = value.boards.map(normalizeBoard);
  const priorityTasks = value.priorityTasks.map(normalizePriorityTask);
  if (
    boards.some((board) => !board) ||
    priorityTasks.some((task) => !task)
  ) {
    return null;
  }
  const normalizedBoards = boards as MerchantEnterpriseCurrentOperationsBoard[];
  const normalizedPriorityTasks =
    priorityTasks as MerchantEnterpriseCurrentOperationsPriorityTask[];
  const visibleOpenTaskCount = normalizedBoards.reduce(
    (total, board) => total + board.openTaskCount,
    0,
  );
  const visibleOverdueTaskCount = normalizedBoards.reduce(
    (total, board) => total + board.overdueTaskCount,
    0,
  );
  const visibleDueSoonTaskCount = normalizedBoards.reduce(
    (total, board) => total + board.dueSoonTaskCount,
    0,
  );
  const visibleInvolvedBoardCount = normalizedBoards.filter(
    (board) => board.openTaskCount > 0,
  ).length;
  if (
    new Set(normalizedBoards.map((board) => board.boardId)).size !==
      normalizedBoards.length ||
    new Set(normalizedPriorityTasks.map((task) => task.id)).size !==
      normalizedPriorityTasks.length ||
    normalizedBoards.length !==
      Math.min(
        boardSummaryTotalCount,
        MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_BOARDS,
      ) ||
    value.boardsTruncated !== (boardSummaryTotalCount > boards.length) ||
    summary.involvedBoardCount > boardSummaryTotalCount ||
    visibleOpenTaskCount > summary.openTaskCount ||
    visibleOverdueTaskCount > summary.overdueTaskCount ||
    visibleDueSoonTaskCount > summary.dueSoonTaskCount ||
    visibleInvolvedBoardCount > summary.involvedBoardCount ||
    normalizedPriorityTasks.length !==
      Math.min(
        summary.openTaskCount,
        MAX_MERCHANT_ENTERPRISE_CURRENT_OPERATION_PRIORITY_TASKS,
      ) ||
    (scope === "employee" &&
      normalizedPriorityTasks.some((task) => task.assigneeCount < 1)) ||
    (!value.boardsTruncated &&
      (visibleOpenTaskCount !== summary.openTaskCount ||
        visibleOverdueTaskCount !== summary.overdueTaskCount ||
        visibleDueSoonTaskCount !== summary.dueSoonTaskCount ||
        visibleInvolvedBoardCount !== summary.involvedBoardCount))
  ) {
    return null;
  }
  return {
    ok: true,
    asOf,
    scope,
    employeeId,
    scopeRestricted: value.scopeRestricted,
    boardSummaryTotalCount,
    boardsTruncated: value.boardsTruncated,
    summary,
    boards: normalizedBoards,
    priorityTasks: normalizedPriorityTasks,
  };
}
