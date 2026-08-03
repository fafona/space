import { randomUUID } from "node:crypto";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import {
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_SUBJECT_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_NOTE_LENGTH,
  normalizeMerchantEnterpriseWorkflowAcknowledgement,
  normalizeMerchantEnterpriseWorkflowExecution,
  normalizeMerchantEnterpriseWorkflowExecutionStats,
  normalizeMerchantEnterpriseWorkflowFeedbackResolution,
  parseMerchantEnterpriseWorkflowEvidenceStrict,
  type MerchantEnterpriseWorkflowAcknowledgement,
  type MerchantEnterpriseWorkflowEvidence,
  type MerchantEnterpriseWorkflowExecution,
  type MerchantEnterpriseWorkflowExecutionStats,
} from "@/lib/merchantEnterpriseWorkflowExecution";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MerchantEnterpriseWorkflowExecutionStoreClient = {
  rpc: (
    functionName: string,
    input: { p_input: Record<string, unknown> },
  ) => Promise<{ data: unknown; error: unknown }>;
};

export type MerchantEnterpriseWorkflowExecutionActorInput = {
  actorType: "owner" | "employee";
  actorId: string;
};

export type MerchantEnterpriseWorkflowEmployeeState = {
  currentRevisionNo: number;
  acknowledgement: MerchantEnterpriseWorkflowAcknowledgement | null;
  executions: MerchantEnterpriseWorkflowExecution[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSiteId(value: unknown) {
  const siteId = typeof value === "string" ? value.trim() : "";
  if (!/^\d{8}$/.test(siteId)) throw new Error("invalid_workflow_execution_request");
  return siteId;
}

function normalizeUuid(value: unknown, errorCode = "invalid_workflow_execution_request") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(normalized)) throw new Error(errorCode);
  return normalized;
}

function normalizeVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("invalid_workflow_execution_version");
  }
  return value;
}

function normalizeActor(input: MerchantEnterpriseWorkflowExecutionActorInput) {
  if (!(["owner", "employee"] as const).includes(input.actorType)) {
    throw new Error("invalid_workflow_execution_actor");
  }
  return {
    actor_type: input.actorType,
    actor_id: normalizeUuid(input.actorId, "invalid_workflow_execution_actor"),
  };
}

function normalizeEmployeeActor(input: MerchantEnterpriseWorkflowExecutionActorInput) {
  const actor = normalizeActor(input);
  if (actor.actor_type !== "employee") {
    throw new Error("invalid_workflow_execution_actor");
  }
  return actor;
}

function operationId(value: unknown, scope: string) {
  const normalized = normalizeMutationOperationId(value);
  return normalized || `enterprise-workflow-${scope}:${randomUUID()}`;
}

function optionalText(value: unknown, maxLength: number, errorCode: string) {
  if (typeof value !== "string" || value.length > maxLength) throw new Error(errorCode);
  return value.trim();
}

function rpcMessage(error: unknown) {
  const source = record(error);
  return [source?.message, source?.details, source?.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

const KNOWN_ERRORS = [
  "permission_denied",
  "employee_actor_required",
  "workflow_not_found",
  "workflow_execution_not_found",
  "workflow_execution_step_not_found",
  "workflow_revision_changed",
  "workflow_acknowledgement_required",
  "workflow_execution_incomplete",
  "workflow_feedback_not_open",
  "workflow_execution_limit_reached",
  "workflow_task_execution_exists",
  "task_workflow_checklist_source_exists",
  "workflow_execution_snapshot_invalid",
  "task_not_found",
  "task_assignment_required",
  "invalid_task_archived",
  "invalid_task_board",
  "task_checklist_limit_reached",
  "enterprise_version_conflict",
  "enterprise_idempotency_conflict",
  "enterprise_operation_in_progress",
  "invalid_workflow_execution_request",
  "invalid_workflow_execution_action",
  "invalid_workflow_execution_version",
  "invalid_workflow_execution_step_update",
  "invalid_workflow_execution_feedback",
  "invalid_workflow_evidence",
] as const;

function throwRpcError(operation: string, error: unknown): never {
  const message = rpcMessage(error);
  const known = KNOWN_ERRORS.find((code) => message.includes(code));
  if (known) throw new Error(known);
  throw new Error(`${operation}:${message || "unknown_error"}`);
}

async function rpc(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  functionName: string,
  input: Record<string, unknown>,
  operation: string,
) {
  const result = await client.rpc(functionName, { p_input: input });
  if (result.error) throwRpcError(operation, result.error);
  const response = record(result.data);
  if (!response) throw new Error(`${operation}:invalid_response`);
  return response;
}

function normalizeExecutionResponse(
  response: Record<string, unknown>,
  siteId: string,
  operation: string,
) {
  const execution = normalizeMerchantEnterpriseWorkflowExecution(response.execution);
  if (!execution || execution.siteId !== siteId) {
    throw new Error(`${operation}:invalid_response`);
  }
  return execution;
}

export async function acknowledgeMerchantEnterpriseWorkflow(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    workflowId: string;
    publishedVersion: number;
    operationId?: string;
  },
) {
  const siteId = normalizeSiteId(input.siteId);
  const workflowId = normalizeUuid(input.workflowId);
  const publishedVersion = normalizeVersion(input.publishedVersion);
  const actor = normalizeEmployeeActor(input);
  const response = await rpc(
    client,
    "faolla_acknowledge_merchant_enterprise_workflow_v1",
    {
      merchant_id: siteId,
      workflow_id: workflowId,
      expected_revision_no: publishedVersion,
      operation_id: operationId(input.operationId, "acknowledge"),
      ...actor,
    },
    "enterprise_workflow_acknowledge_failed",
  );
  const acknowledgement = normalizeMerchantEnterpriseWorkflowAcknowledgement(
    response.acknowledgement,
  );
  if (
    !acknowledgement ||
    acknowledgement.siteId !== siteId ||
    acknowledgement.workflowId !== workflowId ||
    acknowledgement.revisionNo !== publishedVersion ||
    acknowledgement.employeeId !== actor.actor_id
  ) {
    throw new Error("enterprise_workflow_acknowledge_failed:invalid_response");
  }
  return acknowledgement;
}

export async function startMerchantEnterpriseWorkflowExecution(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    workflowId: string;
    publishedVersion: number;
    subject?: string;
    taskId?: string;
    generateChecklist?: boolean;
    operationId?: string;
  },
) {
  const siteId = normalizeSiteId(input.siteId);
  const workflowId = normalizeUuid(input.workflowId);
  const publishedVersion = normalizeVersion(input.publishedVersion);
  const actor = normalizeEmployeeActor(input);
  const subject = optionalText(
    input.subject ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_SUBJECT_LENGTH,
    "invalid_workflow_execution_request",
  );
  const taskId = input.taskId ? normalizeUuid(input.taskId) : "";
  if (
    (input.generateChecklist !== undefined && typeof input.generateChecklist !== "boolean") ||
    (input.generateChecklist === true && !taskId)
  ) {
    throw new Error("invalid_workflow_execution_request");
  }
  const response = await rpc(
    client,
    "faolla_start_merchant_enterprise_workflow_execution_v1",
    {
      merchant_id: siteId,
      workflow_id: workflowId,
      expected_revision_no: publishedVersion,
      subject,
      ...(taskId ? { task_id: taskId } : {}),
      generate_checklist: input.generateChecklist === true,
      operation_id: operationId(input.operationId, "execution-start"),
      ...actor,
    },
    "enterprise_workflow_execution_start_failed",
  );
  const execution = normalizeExecutionResponse(
    response,
    siteId,
    "enterprise_workflow_execution_start_failed",
  );
  const generatedChecklistCount = response.generatedChecklistCount ?? response.generated_checklist_count;
  if (
    execution.workflowId !== workflowId ||
    execution.revisionNo !== publishedVersion ||
    execution.employeeId !== actor.actor_id ||
    execution.taskId !== (taskId || null) ||
    generatedChecklistCount !== execution.generatedChecklistCount
  ) {
    throw new Error("enterprise_workflow_execution_start_failed:invalid_response");
  }
  return { execution, generatedChecklistCount: execution.generatedChecklistCount };
}

export async function loadMerchantEnterpriseWorkflowEmployeeState(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    workflowId: string;
  },
): Promise<MerchantEnterpriseWorkflowEmployeeState> {
  const siteId = normalizeSiteId(input.siteId);
  const workflowId = normalizeUuid(input.workflowId);
  const actor = normalizeEmployeeActor(input);
  const response = await rpc(
    client,
    "faolla_get_merchant_enterprise_workflow_employee_state_v1",
    {
      merchant_id: siteId,
      workflow_id: workflowId,
      ...actor,
    },
    "enterprise_workflow_employee_state_failed",
  );
  const revisionValue = response.currentRevisionNo ?? response.current_revision_no;
  const currentRevisionNo = normalizeVersion(revisionValue);
  const acknowledgement = response.acknowledgement === null
    ? null
    : normalizeMerchantEnterpriseWorkflowAcknowledgement(response.acknowledgement);
  const rows = response.executions;
  const executions = Array.isArray(rows)
    ? rows.map(normalizeMerchantEnterpriseWorkflowExecution)
    : [];
  if (
    !Array.isArray(rows) ||
    rows.length > 50 ||
    executions.some(
      (execution) =>
        !execution ||
        execution.siteId !== siteId ||
        execution.workflowId !== workflowId ||
        execution.employeeId !== actor.actor_id,
    ) ||
    (acknowledgement &&
      (acknowledgement.siteId !== siteId ||
        acknowledgement.workflowId !== workflowId ||
        acknowledgement.revisionNo !== currentRevisionNo ||
        acknowledgement.employeeId !== actor.actor_id))
  ) {
    throw new Error("enterprise_workflow_employee_state_failed:invalid_response");
  }
  return {
    currentRevisionNo,
    acknowledgement,
    executions: executions as MerchantEnterpriseWorkflowExecution[],
  };
}

export async function loadMerchantEnterpriseWorkflowExecution(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    executionId: string;
  },
) {
  const siteId = normalizeSiteId(input.siteId);
  const executionId = normalizeUuid(input.executionId);
  const actor = normalizeEmployeeActor(input);
  const response = await rpc(
    client,
    "faolla_get_merchant_enterprise_workflow_execution_v1",
    {
      merchant_id: siteId,
      execution_id: executionId,
      ...actor,
    },
    "enterprise_workflow_execution_read_failed",
  );
  const execution = normalizeExecutionResponse(
    response,
    siteId,
    "enterprise_workflow_execution_read_failed",
  );
  if (execution.id !== executionId || execution.employeeId !== actor.actor_id) {
    throw new Error("enterprise_workflow_execution_read_failed:invalid_response");
  }
  return execution;
}

export async function updateMerchantEnterpriseWorkflowExecutionStep(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    executionId: string;
    stepId: string;
    version: number;
    completed?: boolean;
    note?: string;
    evidence?: MerchantEnterpriseWorkflowEvidence[];
    operationId?: string;
  },
) {
  const siteId = normalizeSiteId(input.siteId);
  const executionId = normalizeUuid(input.executionId);
  const stepId = normalizeUuid(input.stepId);
  const version = normalizeVersion(input.version);
  const actor = normalizeEmployeeActor(input);
  const hasCompleted = typeof input.completed === "boolean";
  const hasNote = input.note !== undefined;
  const hasEvidence = input.evidence !== undefined;
  if (
    (!hasCompleted && !hasNote && !hasEvidence) ||
    (input.completed !== undefined && !hasCompleted)
  ) {
    throw new Error("invalid_workflow_execution_step_update");
  }
  const note = hasNote
    ? optionalText(
        input.note,
        MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_NOTE_LENGTH,
        "invalid_workflow_execution_step_update",
      )
    : undefined;
  const evidence = hasEvidence
    ? parseMerchantEnterpriseWorkflowEvidenceStrict(input.evidence)
    : undefined;
  if (hasEvidence && !evidence) throw new Error("invalid_workflow_evidence");
  const response = await rpc(
    client,
    "faolla_update_merchant_enterprise_workflow_execution_step_v1",
    {
      merchant_id: siteId,
      execution_id: executionId,
      step_id: stepId,
      expected_version: version,
      ...(hasCompleted ? { completed: input.completed } : {}),
      ...(hasNote ? { note } : {}),
      ...(hasEvidence ? { evidence } : {}),
      operation_id: operationId(input.operationId, "execution-step"),
      ...actor,
    },
    "enterprise_workflow_execution_step_update_failed",
  );
  const execution = normalizeExecutionResponse(
    response,
    siteId,
    "enterprise_workflow_execution_step_update_failed",
  );
  if (
    execution.id !== executionId ||
    execution.employeeId !== actor.actor_id ||
    execution.version <= version
  ) {
    throw new Error("enterprise_workflow_execution_step_update_failed:invalid_response");
  }
  return execution;
}

export async function submitMerchantEnterpriseWorkflowExecutionFeedback(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    executionId: string;
    version: number;
    rating?: number;
    text?: string;
    operationId?: string;
  },
) {
  const siteId = normalizeSiteId(input.siteId);
  const executionId = normalizeUuid(input.executionId);
  const version = normalizeVersion(input.version);
  const actor = normalizeEmployeeActor(input);
  const hasRating = input.rating !== undefined;
  const hasText = input.text !== undefined;
  if (
    (!hasRating && !hasText) ||
    (hasRating &&
      (typeof input.rating !== "number" ||
        !Number.isSafeInteger(input.rating) ||
        input.rating < 1 ||
        input.rating > 5))
  ) {
    throw new Error("invalid_workflow_execution_feedback");
  }
  const feedbackText = hasText
    ? optionalText(
        input.text,
        MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
        "invalid_workflow_execution_feedback",
      )
    : undefined;
  if (!hasRating && !feedbackText) throw new Error("invalid_workflow_execution_feedback");
  const response = await rpc(
    client,
    "faolla_submit_merchant_enterprise_workflow_feedback_v1",
    {
      merchant_id: siteId,
      execution_id: executionId,
      expected_version: version,
      ...(hasRating ? { rating: input.rating } : {}),
      ...(hasText ? { text: feedbackText } : {}),
      operation_id: operationId(input.operationId, "execution-feedback"),
      ...actor,
    },
    "enterprise_workflow_execution_feedback_failed",
  );
  const execution = normalizeExecutionResponse(
    response,
    siteId,
    "enterprise_workflow_execution_feedback_failed",
  );
  if (
    execution.id !== executionId ||
    execution.employeeId !== actor.actor_id ||
    execution.version <= version
  ) {
    throw new Error("enterprise_workflow_execution_feedback_failed:invalid_response");
  }
  return execution;
}

export async function resolveMerchantEnterpriseWorkflowExecutionFeedback(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    executionId: string;
    version: number;
    resolutionNote?: string;
    operationId?: string;
  },
) {
  const siteId = normalizeSiteId(input.siteId);
  const executionId = normalizeUuid(input.executionId);
  const version = normalizeVersion(input.version);
  const actor = normalizeActor(input);
  const resolutionNote = optionalText(
    input.resolutionNote ?? "",
    MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
    "invalid_workflow_execution_feedback",
  );
  const response = await rpc(
    client,
    "faolla_resolve_merchant_enterprise_workflow_feedback_v1",
    {
      merchant_id: siteId,
      execution_id: executionId,
      expected_version: version,
      resolution_note: resolutionNote,
      operation_id: operationId(input.operationId, "feedback-resolve"),
      ...actor,
    },
    "enterprise_workflow_feedback_resolve_failed",
  );
  const resolution = normalizeMerchantEnterpriseWorkflowFeedbackResolution(
    response.resolution,
  );
  if (
    !resolution ||
    resolution.executionId !== executionId ||
    resolution.version <= version ||
    resolution.resolverType !== actor.actor_type
  ) {
    throw new Error("enterprise_workflow_feedback_resolve_failed:invalid_response");
  }
  return resolution;
}

export async function loadMerchantEnterpriseWorkflowExecutionStats(
  client: MerchantEnterpriseWorkflowExecutionStoreClient,
  input: MerchantEnterpriseWorkflowExecutionActorInput & {
    siteId: string;
    workflowId: string;
  },
): Promise<MerchantEnterpriseWorkflowExecutionStats> {
  const siteId = normalizeSiteId(input.siteId);
  const workflowId = normalizeUuid(input.workflowId);
  const response = await rpc(
    client,
    "faolla_get_merchant_enterprise_workflow_execution_stats_v1",
    {
      merchant_id: siteId,
      workflow_id: workflowId,
      ...normalizeActor(input),
    },
    "enterprise_workflow_execution_stats_failed",
  );
  const stats = normalizeMerchantEnterpriseWorkflowExecutionStats(response.stats);
  if (!stats || stats.merchantId !== siteId || stats.workflowId !== workflowId) {
    throw new Error("enterprise_workflow_execution_stats_failed:invalid_response");
  }
  return stats;
}
