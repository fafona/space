import type { MerchantTaskPriority } from "@/lib/merchantEnterprise";

export const MERCHANT_ENTERPRISE_TODO_KINDS = [
  "task",
  "workflow_acknowledgement",
  "workflow_execution",
  "workflow_feedback",
] as const;

export const MERCHANT_ENTERPRISE_TODO_CATEGORIES = [
  "all",
  "tasks",
  "workflows",
] as const;

export const MERCHANT_ENTERPRISE_TODO_URGENCIES = [
  "overdue",
  "due_soon",
  "normal",
] as const;

export const MERCHANT_ENTERPRISE_TODO_REASONS = [
  "assigned_to_me",
  "overdue",
  "due_soon",
  "unassigned",
  "acknowledgement_required",
  "execution_in_progress",
  "feedback_open",
] as const;

export const MAX_MERCHANT_ENTERPRISE_TODO_PAGE_SIZE = 50;

export type MerchantEnterpriseTodoKind =
  (typeof MERCHANT_ENTERPRISE_TODO_KINDS)[number];
export type MerchantEnterpriseTodoCategory =
  (typeof MERCHANT_ENTERPRISE_TODO_CATEGORIES)[number];
export type MerchantEnterpriseTodoUrgency =
  (typeof MERCHANT_ENTERPRISE_TODO_URGENCIES)[number];
export type MerchantEnterpriseTodoReason =
  (typeof MERCHANT_ENTERPRISE_TODO_REASONS)[number];

type MerchantEnterpriseTodoBase = {
  id: string;
  entityId: string;
  siteId: string;
  kind: MerchantEnterpriseTodoKind;
  title: string;
  subtitle: string;
  urgency: MerchantEnterpriseTodoUrgency;
  reasons: MerchantEnterpriseTodoReason[];
  attentionAt: string;
  dueAt: string | null;
};

export type MerchantEnterpriseTaskTodo = MerchantEnterpriseTodoBase & {
  kind: "task";
  taskId: string;
  boardId: string;
  boardName: string;
  priority: MerchantTaskPriority;
  version: number;
};

export type MerchantEnterpriseWorkflowAcknowledgementTodo =
  MerchantEnterpriseTodoBase & {
    kind: "workflow_acknowledgement";
    workflowId: string;
    revisionNo: number;
  };

export type MerchantEnterpriseWorkflowExecutionTodo =
  MerchantEnterpriseTodoBase & {
    kind: "workflow_execution";
    workflowId: string;
    executionId: string;
    taskId: string | null;
    revisionNo: number;
    completedSteps: number;
    totalSteps: number;
    version: number;
  };

export type MerchantEnterpriseWorkflowFeedbackTodo =
  MerchantEnterpriseTodoBase & {
    kind: "workflow_feedback";
    workflowId: string;
    executionId: string;
    revisionNo: number;
    employeeName: string;
    version: number;
  };

export type MerchantEnterpriseTodo =
  | MerchantEnterpriseTaskTodo
  | MerchantEnterpriseWorkflowAcknowledgementTodo
  | MerchantEnterpriseWorkflowExecutionTodo
  | MerchantEnterpriseWorkflowFeedbackTodo;

export type MerchantEnterpriseTodoCounts = {
  openCount: number;
  taskCount: number;
  overdueCount: number;
  dueSoonCount: number;
  acknowledgementCount: number;
  executionCount: number;
  feedbackCount: number;
};

export type MerchantEnterpriseTodoCursor = {
  category: MerchantEnterpriseTodoCategory;
  bucket: number;
  sortAt: string;
  kind: MerchantEnterpriseTodoKind;
  entityId: string;
};

export type MerchantEnterpriseTodoPage = {
  merchantId: string;
  items: MerchantEnterpriseTodo[];
  counts: MerchantEnterpriseTodoCounts;
  nextCursor: string | null;
};

export type MerchantEnterpriseTodoStorePage = {
  merchantId: string;
  items: MerchantEnterpriseTodo[];
  counts: MerchantEnterpriseTodoCounts;
  nextCursor: MerchantEnterpriseTodoCursor | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function read(source: Record<string, unknown>, camel: string, snake: string) {
  return Object.prototype.hasOwnProperty.call(source, camel)
    ? source[camel]
    : source[snake];
}

function text(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maxLength) return null;
  const normalized = value.trim();
  return normalized || allowEmpty ? normalized : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function timestamp(value: unknown, nullable = false) {
  if (value === null && nullable) return null;
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeReasons(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  const reasons = value.filter(
    (item): item is MerchantEnterpriseTodoReason =>
      typeof item === "string" &&
      MERCHANT_ENTERPRISE_TODO_REASONS.includes(
        item as MerchantEnterpriseTodoReason,
      ),
  );
  if (reasons.length !== value.length || new Set(reasons).size !== reasons.length) {
    return null;
  }
  return reasons;
}

export function normalizeMerchantEnterpriseTodo(
  value: unknown,
): MerchantEnterpriseTodo | null {
  const source = record(value);
  if (!source) return null;
  const kind = read(source, "kind", "kind") as MerchantEnterpriseTodoKind;
  const entityId = uuid(read(source, "entityId", "entity_id"));
  const id = text(source.id, 120);
  const siteId = text(read(source, "siteId", "merchant_id"), 8);
  const title = text(source.title, 240);
  const subtitle = text(source.subtitle ?? "", 500, true);
  const urgency = read(
    source,
    "urgency",
    "urgency",
  ) as MerchantEnterpriseTodoUrgency;
  const reasons = normalizeReasons(source.reasons);
  const attentionAt = timestamp(read(source, "attentionAt", "attention_at"));
  const dueAt = timestamp(read(source, "dueAt", "due_at"), true);
  if (
    !MERCHANT_ENTERPRISE_TODO_KINDS.includes(kind) ||
    !entityId ||
    id !== `${kind}:${entityId}` ||
    !/^\d{8}$/.test(siteId ?? "") ||
    !title ||
    subtitle === null ||
    !MERCHANT_ENTERPRISE_TODO_URGENCIES.includes(urgency) ||
    !reasons ||
    !attentionAt ||
    dueAt === undefined
  ) {
    return null;
  }
  const base = {
    id,
    entityId,
    siteId: siteId!,
    kind,
    title,
    subtitle,
    urgency,
    reasons,
    attentionAt,
    dueAt,
  } satisfies MerchantEnterpriseTodoBase;

  if (kind === "task") {
    const taskId = uuid(read(source, "taskId", "task_id"));
    const boardId = uuid(read(source, "boardId", "board_id"));
    const boardName = text(read(source, "boardName", "board_name"), 120);
    const priority = source.priority as MerchantTaskPriority;
    const version = positiveInteger(source.version);
    if (
      entityId !== taskId ||
      !taskId ||
      !boardId ||
      !boardName ||
      !TASK_PRIORITIES.includes(priority) ||
      !version ||
      !reasons.some((reason) =>
        ["assigned_to_me", "overdue", "unassigned"].includes(reason),
      )
    ) {
      return null;
    }
    return { ...base, kind, taskId, boardId, boardName, priority, version };
  }

  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const revisionNo = positiveInteger(read(source, "revisionNo", "revision_no"));
  if (!workflowId || !revisionNo) return null;
  if (kind === "workflow_acknowledgement") {
    if (
      entityId !== workflowId ||
      dueAt !== null ||
      urgency !== "normal" ||
      reasons.length !== 1 ||
      reasons[0] !== "acknowledgement_required"
    ) {
      return null;
    }
    return { ...base, kind, workflowId, revisionNo };
  }

  const executionId = uuid(read(source, "executionId", "execution_id"));
  const version = positiveInteger(source.version);
  if (entityId !== executionId || !executionId || !version || dueAt !== null) {
    return null;
  }
  if (kind === "workflow_execution") {
    const taskValue = read(source, "taskId", "task_id");
    const taskId = taskValue === null ? null : uuid(taskValue);
    const completedSteps = nonNegativeInteger(
      read(source, "completedSteps", "completed_steps"),
    );
    const totalSteps = positiveInteger(read(source, "totalSteps", "total_steps"));
    if (
      (taskValue !== null && !taskId) ||
      completedSteps === null ||
      !totalSteps ||
      completedSteps >= totalSteps ||
      urgency !== "normal" ||
      reasons.length !== 1 ||
      reasons[0] !== "execution_in_progress"
    ) {
      return null;
    }
    return {
      ...base,
      kind,
      workflowId,
      executionId,
      taskId,
      revisionNo,
      completedSteps,
      totalSteps,
      version,
    };
  }

  const employeeName = text(read(source, "employeeName", "employee_name"), 120);
  if (
    !employeeName ||
    urgency !== "normal" ||
    reasons.length !== 1 ||
    reasons[0] !== "feedback_open"
  ) {
    return null;
  }
  return {
    ...base,
    kind,
    workflowId,
    executionId,
    revisionNo,
    employeeName,
    version,
  };
}

export function normalizeMerchantEnterpriseTodoCounts(
  value: unknown,
): MerchantEnterpriseTodoCounts | null {
  const source = record(value);
  if (!source) return null;
  const counts = {
    openCount: nonNegativeInteger(read(source, "openCount", "open_count")),
    taskCount: nonNegativeInteger(read(source, "taskCount", "task_count")),
    overdueCount: nonNegativeInteger(
      read(source, "overdueCount", "overdue_count"),
    ),
    dueSoonCount: nonNegativeInteger(
      read(source, "dueSoonCount", "due_soon_count"),
    ),
    acknowledgementCount: nonNegativeInteger(
      read(source, "acknowledgementCount", "acknowledgement_count"),
    ),
    executionCount: nonNegativeInteger(
      read(source, "executionCount", "execution_count"),
    ),
    feedbackCount: nonNegativeInteger(
      read(source, "feedbackCount", "feedback_count"),
    ),
  };
  if (Object.values(counts).some((count) => count === null)) return null;
  const normalized = counts as MerchantEnterpriseTodoCounts;
  if (
    normalized.openCount !==
      normalized.taskCount +
        normalized.acknowledgementCount +
        normalized.executionCount +
        normalized.feedbackCount ||
    normalized.overdueCount > normalized.taskCount ||
    normalized.dueSoonCount > normalized.taskCount ||
    normalized.overdueCount + normalized.dueSoonCount > normalized.taskCount
  ) {
    return null;
  }
  return normalized;
}

export function normalizeMerchantEnterpriseTodoCursor(
  value: unknown,
): MerchantEnterpriseTodoCursor | null {
  const source = record(value);
  if (!source) return null;
  const category = source.category as MerchantEnterpriseTodoCategory;
  const bucket = nonNegativeInteger(source.bucket);
  const sortAt = timestamp(read(source, "sortAt", "sort_at"));
  const kind = source.kind as MerchantEnterpriseTodoKind;
  const entityId = uuid(read(source, "entityId", "entity_id"));
  if (
    !MERCHANT_ENTERPRISE_TODO_CATEGORIES.includes(category) ||
    bucket === null ||
    bucket > 5 ||
    !sortAt ||
    !MERCHANT_ENTERPRISE_TODO_KINDS.includes(kind) ||
    !entityId
  ) {
    return null;
  }
  return { category, bucket, sortAt, kind, entityId };
}

export function normalizeMerchantEnterpriseTodoStorePage(
  value: unknown,
): MerchantEnterpriseTodoStorePage | null {
  const source = record(value);
  if (!source) return null;
  const merchantId = text(read(source, "merchantId", "merchant_id"), 8);
  const rows = source.items;
  const counts = normalizeMerchantEnterpriseTodoCounts(source.counts);
  const nextCursorValue = read(source, "nextCursor", "next_cursor");
  const nextCursor =
    nextCursorValue === null
      ? null
      : normalizeMerchantEnterpriseTodoCursor(nextCursorValue);
  if (
    !/^\d{8}$/.test(merchantId ?? "") ||
    !Array.isArray(rows) ||
    rows.length > MAX_MERCHANT_ENTERPRISE_TODO_PAGE_SIZE ||
    !counts ||
    nextCursor === null && nextCursorValue !== null
  ) {
    return null;
  }
  const items = rows.map(normalizeMerchantEnterpriseTodo);
  if (
    items.some((item) => !item || item.siteId !== merchantId) ||
    new Set(items.map((item) => item?.id)).size !== items.length ||
    items.length > counts.openCount ||
    (nextCursor && items.length === 0)
  ) {
    return null;
  }
  return {
    merchantId: merchantId!,
    items: items as MerchantEnterpriseTodo[],
    counts,
    nextCursor,
  };
}

export function normalizeMerchantEnterpriseTodoPage(
  value: unknown,
): MerchantEnterpriseTodoPage | null {
  const source = record(value);
  if (!source) return null;
  const storeShape = normalizeMerchantEnterpriseTodoStorePage({
    ...source,
    nextCursor: null,
    next_cursor: null,
  });
  const rawCursor = read(source, "nextCursor", "next_cursor");
  if (
    !storeShape ||
    (rawCursor !== null &&
      (typeof rawCursor !== "string" ||
        rawCursor.length < 1 ||
        rawCursor.length > 320 ||
        !/^[A-Za-z0-9_-]+$/.test(rawCursor)))
  ) {
    return null;
  }
  return { ...storeShape, nextCursor: rawCursor };
}
