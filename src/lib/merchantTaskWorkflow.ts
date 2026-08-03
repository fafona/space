export const MAX_MERCHANT_TASK_WORKFLOW_STEPS = 50;
export const MAX_MERCHANT_TASK_WORKFLOW_TAGS = 10;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantTaskWorkflowStep = {
  id: string;
  title: string;
  instruction: string;
  position: number;
};

export type MerchantTaskWorkflowBinding = {
  siteId: string;
  taskId: string;
  workflowId: string;
  revisionId: string;
  revisionNo: number;
  title: string;
  scenario: string;
  description: string;
  category: string;
  tags: string[];
  steps: MerchantTaskWorkflowStep[];
  boundAt: string;
  generatedChecklistCount: number;
};

export type MerchantTaskWorkflowChecklistItem = {
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function read(
  source: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
) {
  return source[camelCaseKey] ?? source[snakeCaseKey];
}

function boundedText(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) return null;
  return normalized;
}

function uuid(value: unknown) {
  const normalized = boundedText(value, 80);
  return normalized && UUID_PATTERN.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function positiveInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function nonnegativeInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function nullableTimestamp(value: unknown) {
  return value === null || value === undefined ? null : timestamp(value);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_MERCHANT_TASK_WORKFLOW_TAGS) {
    return null;
  }
  const tags = value.map((tag) => boundedText(tag, 40));
  if (
    tags.some((tag) => tag === null) ||
    new Set(tags).size !== tags.length
  ) {
    return null;
  }
  return tags as string[];
}

export function normalizeMerchantTaskWorkflowStep(
  value: unknown,
): MerchantTaskWorkflowStep | null {
  const source = record(value);
  if (!source) return null;
  const id = uuid(source.id);
  const title = boundedText(source.title, 160);
  const instruction = boundedText(source.instruction, 4000);
  const position = nonnegativeInteger(source.position);
  if (!id || !title || !instruction || position === null) return null;
  return { id, title, instruction, position };
}

export function normalizeMerchantTaskWorkflowBinding(
  value: unknown,
): MerchantTaskWorkflowBinding | null {
  const source = record(value);
  if (!source) return null;
  const siteId = boundedText(read(source, "siteId", "merchant_id"), 80);
  const taskId = uuid(read(source, "taskId", "task_id"));
  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const revisionId = uuid(read(source, "revisionId", "revision_id"));
  const revisionNo = positiveInteger(read(source, "revisionNo", "revision_no"));
  const title = boundedText(source.title, 160);
  const scenario = boundedText(source.scenario, 500);
  const description = boundedText(source.description, 5000, true);
  const category = boundedText(source.category, 80, true);
  const tags = normalizeTags(source.tags);
  const steps = Array.isArray(source.steps)
    ? source.steps.map(normalizeMerchantTaskWorkflowStep)
    : null;
  const boundAt = timestamp(read(source, "boundAt", "bound_at"));
  const generatedChecklistCount = nonnegativeInteger(
    read(source, "generatedChecklistCount", "generated_checklist_count"),
  );
  if (
    !siteId ||
    !/^\d{8}$/.test(siteId) ||
    !taskId ||
    !workflowId ||
    !revisionId ||
    revisionNo === null ||
    !title ||
    !scenario ||
    description === null ||
    category === null ||
    !tags ||
    !steps ||
    steps.length < 1 ||
    steps.length > MAX_MERCHANT_TASK_WORKFLOW_STEPS ||
    steps.some((step) => !step) ||
    new Set(steps.map((step) => step?.id)).size !== steps.length ||
    steps.some((step, index) => step?.position !== index) ||
    !boundAt ||
    generatedChecklistCount === null ||
    generatedChecklistCount !== steps.length
  ) {
    return null;
  }
  return {
    siteId,
    taskId,
    workflowId,
    revisionId,
    revisionNo,
    title,
    scenario,
    description,
    category,
    tags,
    steps: steps as MerchantTaskWorkflowStep[],
    boundAt,
    generatedChecklistCount,
  };
}

export function normalizeMerchantTaskWorkflowChecklistItem(
  value: unknown,
): MerchantTaskWorkflowChecklistItem | null {
  const source = record(value);
  if (!source) return null;
  const id = uuid(source.id);
  const siteId = boundedText(read(source, "siteId", "merchant_id"), 80);
  const taskId = uuid(read(source, "taskId", "task_id"));
  const itemText = boundedText(source.text, 500);
  const position = nonnegativeInteger(source.position);
  const version = positiveInteger(source.version);
  const createdAt = timestamp(read(source, "createdAt", "created_at"));
  const updatedAt = timestamp(read(source, "updatedAt", "updated_at"));
  const completedAt = nullableTimestamp(
    read(source, "completedAt", "completed_at"),
  );
  const archivedAt = nullableTimestamp(read(source, "archivedAt", "archived_at"));
  if (
    !id ||
    !siteId ||
    !/^\d{8}$/.test(siteId) ||
    !taskId ||
    !itemText ||
    position === null ||
    version === null ||
    !createdAt ||
    !updatedAt ||
    (read(source, "completedAt", "completed_at") != null && !completedAt) ||
    (read(source, "archivedAt", "archived_at") != null && !archivedAt)
  ) {
    return null;
  }
  return {
    id,
    siteId,
    taskId,
    text: itemText,
    position,
    completed: completedAt !== null,
    completedAt,
    archivedAt,
    version,
    createdAt,
    updatedAt,
  };
}
