import {
  MERCHANT_TASK_PRIORITIES,
  type MerchantTaskPriority,
} from "@/lib/merchantEnterprise";

export const MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_TYPES = [
  "order",
  "booking",
] as const;
export const MERCHANT_ENTERPRISE_AUTOMATION_EVENT_TYPES = [
  "created",
  "status_changed",
] as const;
export const MERCHANT_ENTERPRISE_AUTOMATION_RULE_STATUSES = [
  "active",
  "paused",
  "archived",
] as const;
export const MERCHANT_ENTERPRISE_AUTOMATION_EDITABLE_RULE_STATUSES = [
  "active",
  "paused",
] as const;
export const MERCHANT_ENTERPRISE_AUTOMATION_RUN_STATUSES = [
  "processing",
  "completed",
  "failed",
  "skipped",
] as const;
export const MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_AVAILABILITIES = [
  "active",
  "inactive",
] as const;

export const MAX_MERCHANT_ENTERPRISE_AUTOMATION_RULES = 100;
export const MAX_MERCHANT_ENTERPRISE_AUTOMATION_RUNS = 100;
export const MAX_MERCHANT_ENTERPRISE_AUTOMATION_ASSIGNEES = 50;
export const MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES = 525_600;
export const MERCHANT_ENTERPRISE_AUTOMATION_TEMPLATE_TOKENS = [
  "eventRef",
  "fromStatus",
  "toStatus",
] as const;

export type MerchantEnterpriseAutomationSourceType =
  (typeof MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_TYPES)[number];
export type MerchantEnterpriseAutomationEventType =
  (typeof MERCHANT_ENTERPRISE_AUTOMATION_EVENT_TYPES)[number];
export type MerchantEnterpriseAutomationRuleStatus =
  (typeof MERCHANT_ENTERPRISE_AUTOMATION_RULE_STATUSES)[number];
export type MerchantEnterpriseAutomationEditableRuleStatus =
  (typeof MERCHANT_ENTERPRISE_AUTOMATION_EDITABLE_RULE_STATUSES)[number];
export type MerchantEnterpriseAutomationRunStatus =
  (typeof MERCHANT_ENTERPRISE_AUTOMATION_RUN_STATUSES)[number];
export type MerchantEnterpriseAutomationSourceAvailability =
  (typeof MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_AVAILABILITIES)[number];

export type MerchantEnterpriseAutomationSourceAvailabilityMap = Record<
  MerchantEnterpriseAutomationSourceType,
  MerchantEnterpriseAutomationSourceAvailability
>;

export type MerchantEnterpriseAutomationRule = {
  id: string;
  siteId: string;
  name: string;
  sourceType: MerchantEnterpriseAutomationSourceType;
  eventType: MerchantEnterpriseAutomationEventType;
  fromStatus: string | null;
  toStatus: string | null;
  boardId: string;
  columnId: string;
  workflowId: string;
  workflowRevisionId: string;
  workflowRevisionNo: number;
  taskTitle: string;
  taskDescription: string;
  priority: MerchantTaskPriority;
  dueOffsetMinutes: number | null;
  status: MerchantEnterpriseAutomationRuleStatus;
  assigneeIds: string[];
  version: number;
  enabledAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MerchantEnterpriseAutomationRun = {
  id: string;
  siteId: string;
  ruleId: string;
  ruleVersion: number;
  sourceType: MerchantEnterpriseAutomationSourceType;
  eventRef: string;
  eventType: MerchantEnterpriseAutomationEventType;
  fromStatus: string | null;
  toStatus: string | null;
  status: MerchantEnterpriseAutomationRunStatus;
  taskId: string | null;
  workflowId: string;
  workflowRevisionId: string;
  errorCode: string;
  attemptCount: number;
  sourceEventAt: string;
  completedAt: string | null;
  createdAt: string;
};

/**
 * Automation templates intentionally support a tiny, non-PII vocabulary.
 * Removing known tokens first makes every other balanced `{...}` expression
 * fail closed, including nested or empty token-like expressions.
 */
export function hasOnlyMerchantEnterpriseAutomationTemplateTokens(
  value: string,
) {
  const withoutKnownTokens = value.replace(
    /\{(?:eventRef|fromStatus|toStatus)\}/g,
    "",
  );
  return !/\{[^{}]*\}/.test(withoutKnownTokens);
}

export type MerchantEnterpriseAutomationRuleDraft = {
  siteId: string;
  name: string;
  sourceType: MerchantEnterpriseAutomationSourceType;
  eventType: MerchantEnterpriseAutomationEventType;
  fromStatus: string | null;
  toStatus: string | null;
  boardId: string;
  columnId: string;
  workflowId: string;
  workflowRevisionId: string;
  taskTitle: string;
  taskDescription: string;
  priority: MerchantTaskPriority;
  dueOffsetMinutes: number | null;
  status: MerchantEnterpriseAutomationEditableRuleStatus;
  assigneeIds: string[];
  operationId: string;
};

export type MerchantEnterpriseAutomationRuleUpdate =
  MerchantEnterpriseAutomationRuleDraft & {
    ruleId: string;
    expectedVersion: number;
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_STATUSES: Record<
  MerchantEnterpriseAutomationSourceType,
  readonly string[]
> = {
  order: ["pending", "confirmed", "completed", "cancelled"],
  booking: ["active", "confirmed", "completed", "no_show", "cancelled"],
};

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

function text(value: unknown, maximum: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum) return null;
  const normalized = value.trim();
  return normalized || allowEmpty ? normalized : null;
}

function nullableText(value: unknown, maximum: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function timestamp(value: unknown) {
  return typeof value === "string" &&
    value.length <= 80 &&
    Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function positiveInteger(value: unknown) {
  const normalized = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null;
}

function nullableDueOffset(value: unknown) {
  if (value === null) return null;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_MERCHANT_ENTERPRISE_AUTOMATION_DUE_OFFSET_MINUTES
    ? value
    : undefined;
}

function normalizeSource(value: unknown) {
  return MERCHANT_ENTERPRISE_AUTOMATION_SOURCE_TYPES.includes(
    value as MerchantEnterpriseAutomationSourceType,
  )
    ? (value as MerchantEnterpriseAutomationSourceType)
    : null;
}

function normalizeEvent(value: unknown) {
  return MERCHANT_ENTERPRISE_AUTOMATION_EVENT_TYPES.includes(
    value as MerchantEnterpriseAutomationEventType,
  )
    ? (value as MerchantEnterpriseAutomationEventType)
    : null;
}

function normalizeStatusPair(
  sourceType: MerchantEnterpriseAutomationSourceType,
  eventType: MerchantEnterpriseAutomationEventType,
  fromValue: unknown,
  toValue: unknown,
  context: "rule" | "run",
) {
  const fromStatus = nullableText(fromValue, 40);
  const toStatus = nullableText(toValue, 40);
  if (fromStatus === undefined || toStatus === undefined) return null;
  if (
    (fromStatus !== null && !SOURCE_STATUSES[sourceType].includes(fromStatus)) ||
    (toStatus !== null && !SOURCE_STATUSES[sourceType].includes(toStatus)) ||
    (eventType === "created" &&
      (fromStatus !== null || (context === "rule" && toStatus !== null))) ||
    (eventType === "status_changed" && toStatus === null)
  ) {
    return null;
  }
  return { fromStatus, toStatus };
}

function normalizeAssigneeIds(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_MERCHANT_ENTERPRISE_AUTOMATION_ASSIGNEES
  ) {
    return null;
  }
  const ids = value.map(uuid);
  if (
    ids.some((id) => id === null) ||
    new Set(ids as string[]).size !== ids.length
  ) {
    return null;
  }
  return (ids as string[]).sort();
}

export function normalizeMerchantEnterpriseAutomationRule(
  value: unknown,
): MerchantEnterpriseAutomationRule | null {
  const source = record(value);
  if (!source) return null;
  const id = uuid(source.id);
  const siteId = text(read(source, "siteId", "merchant_id"), 8);
  const name = text(source.name, 160);
  const sourceType = normalizeSource(read(source, "sourceType", "source_type"));
  const eventType = normalizeEvent(read(source, "eventType", "event_type"));
  const boardId = uuid(read(source, "boardId", "board_id"));
  const columnId = uuid(read(source, "columnId", "column_id"));
  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const workflowRevisionId = uuid(
    read(source, "workflowRevisionId", "workflow_revision_id"),
  );
  const workflowRevisionNo = positiveInteger(
    read(source, "workflowRevisionNo", "workflow_revision_no"),
  );
  const taskTitle = text(read(source, "taskTitle", "task_title"), 240);
  const taskDescription = text(
    read(source, "taskDescription", "task_description"),
    10_000,
    true,
  );
  const priority = source.priority as MerchantTaskPriority;
  const dueOffsetMinutes = nullableDueOffset(
    read(source, "dueOffsetMinutes", "due_offset_minutes"),
  );
  const status = source.status as MerchantEnterpriseAutomationRuleStatus;
  const assigneeIds = normalizeAssigneeIds(
    read(source, "assigneeIds", "assignee_ids"),
  );
  const version = positiveInteger(source.version);
  const enabledAt = timestamp(read(source, "enabledAt", "enabled_at"));
  const rawArchivedAt = read(source, "archivedAt", "archived_at");
  const archivedAt =
    rawArchivedAt === null
      ? null
      : (timestamp(rawArchivedAt) ?? undefined);
  const createdAt = timestamp(read(source, "createdAt", "created_at"));
  const updatedAt = timestamp(read(source, "updatedAt", "updated_at"));
  if (
    !id ||
    !siteId ||
    !/^\d{8}$/.test(siteId) ||
    !name ||
    !sourceType ||
    !eventType ||
    !boardId ||
    !columnId ||
    !workflowId ||
    !workflowRevisionId ||
    !workflowRevisionNo ||
    !taskTitle ||
    taskDescription === null ||
    !MERCHANT_TASK_PRIORITIES.includes(priority) ||
    dueOffsetMinutes === undefined ||
    !MERCHANT_ENTERPRISE_AUTOMATION_RULE_STATUSES.includes(status) ||
    !assigneeIds ||
    !version ||
    !enabledAt ||
    archivedAt === undefined ||
    !createdAt ||
    !updatedAt ||
    (status === "archived") !== (archivedAt !== null)
  ) {
    return null;
  }
  const statusPair = normalizeStatusPair(
    sourceType,
    eventType,
    read(source, "fromStatus", "from_status"),
    read(source, "toStatus", "to_status"),
    "rule",
  );
  if (!statusPair) return null;
  return {
    id,
    siteId,
    name,
    sourceType,
    eventType,
    ...statusPair,
    boardId,
    columnId,
    workflowId,
    workflowRevisionId,
    workflowRevisionNo,
    taskTitle,
    taskDescription,
    priority,
    dueOffsetMinutes,
    status,
    assigneeIds,
    version,
    enabledAt,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

export function normalizeMerchantEnterpriseAutomationRun(
  value: unknown,
): MerchantEnterpriseAutomationRun | null {
  const source = record(value);
  if (!source) return null;
  const id = uuid(source.id);
  const siteId = text(read(source, "siteId", "merchant_id"), 8);
  const ruleId = uuid(read(source, "ruleId", "rule_id"));
  const ruleVersion = positiveInteger(
    read(source, "ruleVersion", "rule_version"),
  );
  const sourceType = normalizeSource(read(source, "sourceType", "source_type"));
  const eventRef = text(read(source, "eventRef", "event_ref"), 48);
  const eventType = normalizeEvent(read(source, "eventType", "event_type"));
  const status = source.status as MerchantEnterpriseAutomationRunStatus;
  const rawTaskId = read(source, "taskId", "task_id");
  const taskId = rawTaskId === null ? null : (uuid(rawTaskId) ?? undefined);
  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const workflowRevisionId = uuid(
    read(source, "workflowRevisionId", "workflow_revision_id"),
  );
  const errorCode = text(
    read(source, "errorCode", "error_code"),
    80,
    true,
  );
  const attemptCount = positiveInteger(
    read(source, "attemptCount", "attempt_count"),
  );
  const sourceEventAt = timestamp(
    read(source, "sourceEventAt", "source_event_at"),
  );
  const rawCompletedAt = read(source, "completedAt", "completed_at");
  const completedAt =
    rawCompletedAt === null
      ? null
      : (timestamp(rawCompletedAt) ?? undefined);
  const createdAt = timestamp(read(source, "createdAt", "created_at"));
  if (
    !id ||
    !siteId ||
    !/^\d{8}$/.test(siteId) ||
    !ruleId ||
    !ruleVersion ||
    !sourceType ||
    !eventRef ||
    !/^(order|booking)-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      eventRef,
    ) ||
    !eventRef.startsWith(`${sourceType}-`) ||
    !eventType ||
    !MERCHANT_ENTERPRISE_AUTOMATION_RUN_STATUSES.includes(status) ||
    taskId === undefined ||
    !workflowId ||
    !workflowRevisionId ||
    errorCode === null ||
    !attemptCount ||
    attemptCount > 50 ||
    !sourceEventAt ||
    completedAt === undefined ||
    !createdAt ||
    (status === "processing" &&
      (taskId !== null || errorCode !== "" || completedAt !== null)) ||
    (status === "completed" &&
      (!taskId || errorCode !== "" || completedAt === null)) ||
    ((status === "failed" || status === "skipped") &&
      (taskId !== null || errorCode === "" || completedAt === null))
  ) {
    return null;
  }
  const statusPair = normalizeStatusPair(
    sourceType,
    eventType,
    read(source, "fromStatus", "from_status"),
    read(source, "toStatus", "to_status"),
    "run",
  );
  if (!statusPair) return null;
  return {
    id,
    siteId,
    ruleId,
    ruleVersion,
    sourceType,
    eventRef,
    eventType,
    ...statusPair,
    status,
    taskId,
    workflowId,
    workflowRevisionId,
    errorCode,
    attemptCount,
    sourceEventAt,
    completedAt,
    createdAt,
  };
}
