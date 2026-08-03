import {
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_INSTRUCTION_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_TITLE_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH,
  parseMerchantEnterpriseWorkflowStepsStrict,
  parseMerchantEnterpriseWorkflowTagsStrict,
  type MerchantEnterpriseWorkflowStep,
} from "@/lib/merchantEnterprise";

export const MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_STATUSES = [
  "in_progress",
  "completed",
] as const;

export const MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_KINDS = [
  "file",
  "link",
  "reference",
] as const;

export const MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_STATUSES = [
  "none",
  "open",
  "resolved",
] as const;

export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_SUBJECT_LENGTH = 240;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_NOTE_LENGTH = 2_000;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH = 2_000;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_EVIDENCE = 10;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_LABEL_LENGTH = 160;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_REFERENCE_LENGTH = 1_000;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_MEDIA_TYPE_LENGTH = 120;
export const MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_SIZE_BYTES = 1_099_511_627_776;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterpriseWorkflowExecutionStatus =
  (typeof MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_STATUSES)[number];

export type MerchantEnterpriseWorkflowEvidenceKind =
  (typeof MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_KINDS)[number];

export type MerchantEnterpriseWorkflowFeedbackStatus =
  (typeof MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_STATUSES)[number];

export type MerchantEnterpriseWorkflowEvidence = {
  kind: MerchantEnterpriseWorkflowEvidenceKind;
  label: string;
  reference: string;
  mediaType: string;
  sizeBytes: number | null;
};

export type MerchantEnterpriseWorkflowExecutionSnapshot = {
  title: string;
  scenario: string;
  description: string;
  category: string;
  tags: string[];
  steps: MerchantEnterpriseWorkflowStep[];
};

export type MerchantEnterpriseWorkflowAcknowledgement = {
  id: string;
  siteId: string;
  workflowId: string;
  revisionId: string;
  revisionNo: number;
  employeeId: string;
  acknowledgedAt: string;
};

export type MerchantEnterpriseWorkflowExecutionStep = {
  stepId: string;
  title: string;
  instruction: string;
  position: number;
  completedAt: string | null;
  note: string;
  evidence: MerchantEnterpriseWorkflowEvidence[];
};

export type MerchantEnterpriseWorkflowExecution = {
  id: string;
  siteId: string;
  workflowId: string;
  revisionId: string;
  revisionNo: number;
  employeeId: string;
  taskId: string | null;
  subject: string;
  status: MerchantEnterpriseWorkflowExecutionStatus;
  workflowSnapshot: MerchantEnterpriseWorkflowExecutionSnapshot;
  steps: MerchantEnterpriseWorkflowExecutionStep[];
  completedSteps: number;
  totalSteps: number;
  feedbackRating: number | null;
  feedbackText: string;
  feedbackStatus: MerchantEnterpriseWorkflowFeedbackStatus;
  feedbackSubmittedAt: string | null;
  feedbackResolutionNote: string;
  feedbackResolvedAt: string | null;
  feedbackResolverType: "owner" | "employee" | null;
  feedbackResolverId: string | null;
  generatedChecklistCount: number;
  startedAt: string;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantEnterpriseWorkflowExecutionParticipantStat = {
  employeeId: string;
  employeeName: string;
  acknowledgedAt: string | null;
  executionCount: number;
  completedCount: number;
  lastActivityAt: string | null;
};

export type MerchantEnterpriseWorkflowExecutionFeedback = {
  executionId: string;
  executionVersion: number;
  employeeId: string;
  employeeName: string;
  revisionNo: number;
  rating: number | null;
  text: string;
  status: Exclude<MerchantEnterpriseWorkflowFeedbackStatus, "none">;
  submittedAt: string;
  resolutionNote: string;
  resolvedAt: string | null;
  resolverType: "owner" | "employee" | null;
  resolverId: string | null;
};

export type MerchantEnterpriseWorkflowFeedbackResolution = {
  executionId: string;
  version: number;
  feedbackStatus: "resolved";
  resolvedAt: string;
  resolverType: "owner" | "employee";
};

export type MerchantEnterpriseWorkflowExecutionStats = {
  merchantId: string;
  workflowId: string;
  currentRevisionNo: number;
  eligibleEmployeeCount: number;
  acknowledgedEmployeeCount: number;
  executionCount: number;
  inProgressCount: number;
  completedCount: number;
  taskLinkedExecutionCount: number;
  generatedChecklistCount: number;
  /** Feedback submitted against the workflow's current published revision. */
  feedbackCount: number;
  /** Unresolved feedback across every published revision of this workflow. */
  openFeedbackCount: number;
  averageRating: number | null;
  participants: MerchantEnterpriseWorkflowExecutionParticipantStat[];
  /** Workflow-wide queue: unresolved first, then newest submission first. */
  recentFeedback: MerchantEnterpriseWorkflowExecutionFeedback[];
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

function timestamp(value: unknown, nullable = false) {
  if (value === null && nullable) return null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

export function parseMerchantEnterpriseWorkflowEvidenceStrict(
  value: unknown,
): MerchantEnterpriseWorkflowEvidence[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_EVIDENCE
  ) {
    return null;
  }
  const evidence: MerchantEnterpriseWorkflowEvidence[] = [];
  for (const item of value) {
    const source = record(item);
    if (
      !source ||
      Object.keys(source).some(
        (key) => !["kind", "label", "reference", "mediaType", "sizeBytes"].includes(key),
      )
    ) {
      return null;
    }
    const kind = source.kind;
    const label = text(
      source.label,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_LABEL_LENGTH,
    );
    const reference = text(
      source.reference,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_REFERENCE_LENGTH,
    );
    const mediaType = text(
      source.mediaType ?? "",
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_MEDIA_TYPE_LENGTH,
      true,
    );
    const sizeBytes = source.sizeBytes ?? null;
    if (
      !MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_KINDS.includes(
        kind as MerchantEnterpriseWorkflowEvidenceKind,
      ) ||
      !label ||
      !reference ||
      mediaType === null ||
      (sizeBytes !== null &&
        (typeof sizeBytes !== "number" ||
          !Number.isSafeInteger(sizeBytes) ||
          sizeBytes < 0 ||
          sizeBytes > MAX_MERCHANT_ENTERPRISE_WORKFLOW_EVIDENCE_SIZE_BYTES))
    ) {
      return null;
    }
    evidence.push({
      kind: kind as MerchantEnterpriseWorkflowEvidenceKind,
      label,
      reference,
      mediaType,
      sizeBytes,
    });
  }
  return evidence;
}

function normalizeSnapshot(value: unknown): MerchantEnterpriseWorkflowExecutionSnapshot | null {
  const source = record(value);
  if (!source) return null;
  const title = text(source.title, MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH);
  const scenario = text(source.scenario, MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH);
  const description = text(
    source.description ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
    true,
  );
  const category = text(
    source.category ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
    true,
  );
  const tags = parseMerchantEnterpriseWorkflowTagsStrict(source.tags);
  const steps = parseMerchantEnterpriseWorkflowStepsStrict(source.steps);
  if (!title || !scenario || description === null || category === null || !tags || !steps) {
    return null;
  }
  return { title, scenario, description, category, tags, steps };
}

export function normalizeMerchantEnterpriseWorkflowAcknowledgement(
  value: unknown,
): MerchantEnterpriseWorkflowAcknowledgement | null {
  const source = record(value);
  if (!source) return null;
  const id = uuid(source.id);
  const siteId = text(read(source, "siteId", "merchant_id"), 8);
  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const revisionId = uuid(read(source, "revisionId", "revision_id"));
  const revisionNo = positiveInteger(read(source, "revisionNo", "revision_no"));
  const employeeId = uuid(read(source, "employeeId", "employee_id"));
  const acknowledgedAt = timestamp(
    read(source, "acknowledgedAt", "acknowledged_at"),
  );
  if (!id || !/^\d{8}$/.test(siteId ?? "") || !workflowId || !revisionId || !revisionNo || !employeeId || !acknowledgedAt) {
    return null;
  }
  return { id, siteId: siteId!, workflowId, revisionId, revisionNo, employeeId, acknowledgedAt };
}

function normalizeExecutionStep(value: unknown): MerchantEnterpriseWorkflowExecutionStep | null {
  const source = record(value);
  if (!source) return null;
  const stepId = uuid(read(source, "stepId", "step_id"));
  const title = text(source.title, MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_TITLE_LENGTH);
  const instruction = text(
    source.instruction,
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_INSTRUCTION_LENGTH,
  );
  const position = nonNegativeInteger(source.position);
  const completedAt = timestamp(read(source, "completedAt", "completed_at"), true);
  const note = text(
    source.note ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_NOTE_LENGTH,
    true,
  );
  const evidence = parseMerchantEnterpriseWorkflowEvidenceStrict(source.evidence);
  if (!stepId || !title || !instruction || position === null || completedAt === undefined || note === null || !evidence) {
    return null;
  }
  return { stepId, title, instruction, position, completedAt, note, evidence };
}

export function normalizeMerchantEnterpriseWorkflowExecution(
  value: unknown,
): MerchantEnterpriseWorkflowExecution | null {
  const source = record(value);
  if (!source) return null;
  const id = uuid(source.id);
  const siteId = text(read(source, "siteId", "merchant_id"), 8);
  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const revisionId = uuid(read(source, "revisionId", "revision_id"));
  const revisionNo = positiveInteger(read(source, "revisionNo", "revision_no"));
  const employeeId = uuid(read(source, "employeeId", "employee_id"));
  const taskValue = read(source, "taskId", "task_id");
  const taskId = taskValue === null ? null : uuid(taskValue);
  const subject = text(
    source.subject ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_SUBJECT_LENGTH,
    true,
  );
  const status = read(source, "status", "status");
  const workflowSnapshot = normalizeSnapshot(
    read(source, "workflowSnapshot", "workflow_snapshot"),
  );
  const stepRows = source.steps;
  const steps = Array.isArray(stepRows) ? stepRows.map(normalizeExecutionStep) : [];
  const completedSteps = nonNegativeInteger(
    read(source, "completedSteps", "completed_steps"),
  );
  const totalSteps = positiveInteger(read(source, "totalSteps", "total_steps"));
  const feedbackRatingValue = read(source, "feedbackRating", "feedback_rating");
  const feedbackRating = feedbackRatingValue === null ? null : positiveInteger(feedbackRatingValue);
  const feedbackText = text(
    read(source, "feedbackText", "feedback_text") ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
    true,
  );
  const feedbackStatus = read(source, "feedbackStatus", "feedback_status");
  const feedbackSubmittedAt = timestamp(
    read(source, "feedbackSubmittedAt", "feedback_submitted_at"),
    true,
  );
  const feedbackResolutionNote = text(
    read(source, "feedbackResolutionNote", "feedback_resolution_note") ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
    true,
  );
  const feedbackResolvedAt = timestamp(
    read(source, "feedbackResolvedAt", "feedback_resolved_at"),
    true,
  );
  const feedbackResolverTypeValue = read(
    source,
    "feedbackResolverType",
    "feedback_resolver_type",
  );
  const feedbackResolverType = feedbackResolverTypeValue === null
    ? null
    : feedbackResolverTypeValue === "owner" || feedbackResolverTypeValue === "employee"
      ? feedbackResolverTypeValue
      : undefined;
  const feedbackResolverIdValue = read(
    source,
    "feedbackResolverId",
    "feedback_resolver_id",
  );
  const feedbackResolverId = feedbackResolverIdValue === null
    ? null
    : uuid(feedbackResolverIdValue);
  const validFeedbackResolver = feedbackStatus === "resolved"
    ? feedbackResolverType === "owner"
      ? feedbackResolverId === null
      : feedbackResolverType === "employee" && feedbackResolverId !== null
    : feedbackResolverType === null && feedbackResolverId === null;
  const generatedChecklistCount = nonNegativeInteger(
    read(source, "generatedChecklistCount", "generated_checklist_count"),
  );
  const startedAt = timestamp(read(source, "startedAt", "started_at"));
  const completedAt = timestamp(read(source, "completedAt", "completed_at"), true);
  const version = positiveInteger(source.version);
  const createdAt = timestamp(read(source, "createdAt", "created_at"));
  const updatedAt = timestamp(read(source, "updatedAt", "updated_at"));
  if (
    !id ||
    !/^\d{8}$/.test(siteId ?? "") ||
    !workflowId ||
    !revisionId ||
    !revisionNo ||
    !employeeId ||
    (taskValue !== null && !taskId) ||
    subject === null ||
    !MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_STATUSES.includes(
      status as MerchantEnterpriseWorkflowExecutionStatus,
    ) ||
    !workflowSnapshot ||
    !Array.isArray(stepRows) ||
    steps.some((step) => !step) ||
    !totalSteps ||
    completedSteps === null ||
    completedSteps > totalSteps ||
    steps.length !== totalSteps ||
    (feedbackRating !== null && feedbackRating > 5) ||
    feedbackText === null ||
    !MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_STATUSES.includes(
      feedbackStatus as MerchantEnterpriseWorkflowFeedbackStatus,
    ) ||
    feedbackSubmittedAt === undefined ||
    feedbackResolutionNote === null ||
    feedbackResolvedAt === undefined ||
    feedbackResolverType === undefined ||
    (feedbackResolverIdValue !== null && !feedbackResolverId) ||
    !validFeedbackResolver ||
    generatedChecklistCount === null ||
    !startedAt ||
    completedAt === undefined ||
    !version ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  return {
    id,
    siteId: siteId!,
    workflowId,
    revisionId,
    revisionNo,
    employeeId,
    taskId,
    subject,
    status: status as MerchantEnterpriseWorkflowExecutionStatus,
    workflowSnapshot,
    steps: steps as MerchantEnterpriseWorkflowExecutionStep[],
    completedSteps,
    totalSteps,
    feedbackRating,
    feedbackText,
    feedbackStatus: feedbackStatus as MerchantEnterpriseWorkflowFeedbackStatus,
    feedbackSubmittedAt,
    feedbackResolutionNote,
    feedbackResolvedAt,
    feedbackResolverType,
    feedbackResolverId,
    generatedChecklistCount,
    startedAt,
    completedAt,
    version,
    createdAt,
    updatedAt,
  };
}

export function normalizeMerchantEnterpriseWorkflowFeedbackResolution(
  value: unknown,
): MerchantEnterpriseWorkflowFeedbackResolution | null {
  const source = record(value);
  if (!source) return null;
  const executionId = uuid(read(source, "executionId", "execution_id"));
  const version = positiveInteger(source.version);
  const feedbackStatus = read(source, "feedbackStatus", "feedback_status");
  const resolvedAt = timestamp(read(source, "resolvedAt", "resolved_at"));
  const resolverType = read(source, "resolverType", "resolver_type");
  if (
    !executionId ||
    !version ||
    feedbackStatus !== "resolved" ||
    !resolvedAt ||
    (resolverType !== "owner" && resolverType !== "employee")
  ) {
    return null;
  }
  return { executionId, version, feedbackStatus, resolvedAt, resolverType };
}

export function normalizeMerchantEnterpriseWorkflowExecutionStats(
  value: unknown,
): MerchantEnterpriseWorkflowExecutionStats | null {
  const source = record(value);
  if (!source) return null;
  const merchantId = text(read(source, "merchantId", "merchant_id"), 8);
  const workflowId = uuid(read(source, "workflowId", "workflow_id"));
  const currentRevisionNo = positiveInteger(
    read(source, "currentRevisionNo", "current_revision_no"),
  );
  const integerField = (camel: string, snake: string) =>
    nonNegativeInteger(read(source, camel, snake));
  const eligibleEmployeeCount = integerField("eligibleEmployeeCount", "eligible_employee_count");
  const acknowledgedEmployeeCount = integerField("acknowledgedEmployeeCount", "acknowledged_employee_count");
  const executionCount = integerField("executionCount", "execution_count");
  const inProgressCount = integerField("inProgressCount", "in_progress_count");
  const completedCount = integerField("completedCount", "completed_count");
  const taskLinkedExecutionCount = integerField("taskLinkedExecutionCount", "task_linked_execution_count");
  const generatedChecklistCount = integerField("generatedChecklistCount", "generated_checklist_count");
  const feedbackCount = integerField("feedbackCount", "feedback_count");
  const openFeedbackCount = integerField("openFeedbackCount", "open_feedback_count");
  const averageRatingValue = read(source, "averageRating", "average_rating");
  const averageRating = averageRatingValue === null
    ? null
    : typeof averageRatingValue === "number" && Number.isFinite(averageRatingValue) && averageRatingValue >= 1 && averageRatingValue <= 5
      ? averageRatingValue
      : undefined;
  const participantRows = read(source, "participants", "participants");
  const feedbackRows = read(source, "recentFeedback", "recent_feedback");
  if (
    !/^\d{8}$/.test(merchantId ?? "") ||
    !workflowId ||
    !currentRevisionNo ||
    eligibleEmployeeCount === null ||
    acknowledgedEmployeeCount === null ||
    executionCount === null ||
    inProgressCount === null ||
    completedCount === null ||
    taskLinkedExecutionCount === null ||
    generatedChecklistCount === null ||
    feedbackCount === null ||
    openFeedbackCount === null ||
    averageRating === undefined ||
    !Array.isArray(participantRows) ||
    !Array.isArray(feedbackRows)
  ) {
    return null;
  }
  const participants: MerchantEnterpriseWorkflowExecutionParticipantStat[] = [];
  for (const item of participantRows) {
    const row = record(item);
    if (!row) return null;
    const employeeId = uuid(read(row, "employeeId", "employee_id"));
    const employeeName = text(read(row, "employeeName", "employee_name"), 160);
    const acknowledgedAt = timestamp(read(row, "acknowledgedAt", "acknowledged_at"), true);
    const executionCountValue = nonNegativeInteger(read(row, "executionCount", "execution_count"));
    const completedCountValue = nonNegativeInteger(read(row, "completedCount", "completed_count"));
    const lastActivityAt = timestamp(read(row, "lastActivityAt", "last_activity_at"), true);
    if (!employeeId || !employeeName || acknowledgedAt === undefined || executionCountValue === null || completedCountValue === null || lastActivityAt === undefined) return null;
    participants.push({ employeeId, employeeName, acknowledgedAt, executionCount: executionCountValue, completedCount: completedCountValue, lastActivityAt });
  }
  const recentFeedback: MerchantEnterpriseWorkflowExecutionFeedback[] = [];
  for (const item of feedbackRows) {
    const row = record(item);
    if (!row) return null;
    const executionId = uuid(read(row, "executionId", "execution_id"));
    const executionVersion = positiveInteger(
      read(row, "executionVersion", "execution_version"),
    );
    const employeeId = uuid(read(row, "employeeId", "employee_id"));
    const employeeName = text(read(row, "employeeName", "employee_name"), 160);
    const revisionNo = positiveInteger(read(row, "revisionNo", "revision_no"));
    const ratingValue = row.rating;
    const rating = ratingValue === null ? null : positiveInteger(ratingValue);
    const feedbackText = text(row.text ?? "", MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH, true);
    const status = row.status;
    const submittedAt = timestamp(read(row, "submittedAt", "submitted_at"));
    const resolutionNote = text(
      read(row, "resolutionNote", "resolution_note") ?? "",
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
      true,
    );
    const resolvedAt = timestamp(read(row, "resolvedAt", "resolved_at"), true);
    const resolverTypeValue = read(row, "resolverType", "resolver_type");
    const resolverType = resolverTypeValue === null
      ? null
      : resolverTypeValue === "owner" || resolverTypeValue === "employee"
        ? resolverTypeValue
        : undefined;
    const resolverIdValue = read(row, "resolverId", "resolver_id");
    const resolverId = resolverIdValue === null ? null : uuid(resolverIdValue);
    const validResolver = status === "resolved"
      ? resolverType === "owner"
        ? resolverId === null
        : resolverType === "employee" && resolverId !== null
      : resolverType === null && resolverId === null;
    if (!executionId || !executionVersion || !employeeId || !employeeName || !revisionNo || (rating !== null && rating > 5) || feedbackText === null || (status !== "open" && status !== "resolved") || !submittedAt || resolutionNote === null || resolvedAt === undefined || resolverType === undefined || (resolverIdValue !== null && !resolverId) || !validResolver) return null;
    recentFeedback.push({ executionId, executionVersion, employeeId, employeeName, revisionNo, rating, text: feedbackText, status, submittedAt, resolutionNote, resolvedAt, resolverType, resolverId });
  }
  return {
    merchantId: merchantId!,
    workflowId,
    currentRevisionNo,
    eligibleEmployeeCount,
    acknowledgedEmployeeCount,
    executionCount,
    inProgressCount,
    completedCount,
    taskLinkedExecutionCount,
    generatedChecklistCount,
    feedbackCount,
    openFeedbackCount,
    averageRating,
    participants,
    recentFeedback,
  };
}
