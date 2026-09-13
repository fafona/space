import { NextResponse } from "next/server";
import type {
  MerchantEnterpriseActor,
  MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  acknowledgeMerchantEnterpriseWorkflow,
  loadMerchantEnterpriseWorkflowEmployeeState,
  loadMerchantEnterpriseWorkflowExecution,
  loadMerchantEnterpriseWorkflowExecutionStats,
  resolveMerchantEnterpriseWorkflowExecutionFeedback,
  startMerchantEnterpriseWorkflowExecution,
  submitMerchantEnterpriseWorkflowExecutionFeedback,
  updateMerchantEnterpriseWorkflowExecutionStep,
  type MerchantEnterpriseWorkflowExecutionStoreClient,
} from "@/lib/merchantEnterpriseWorkflowExecution.server";
import {
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_SUBJECT_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_NOTE_LENGTH,
  parseMerchantEnterpriseWorkflowEvidenceStrict,
  type MerchantEnterpriseWorkflowAcknowledgement,
  type MerchantEnterpriseWorkflowEvidence,
  type MerchantEnterpriseWorkflowExecution,
  type MerchantEnterpriseWorkflowExecutionStats,
  type MerchantEnterpriseWorkflowFeedbackResolution,
} from "@/lib/merchantEnterpriseWorkflowExecution";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;

type EmployeeActor = Extract<MerchantEnterpriseActor, { type: "employee" }>;

type WorkflowExecutionBody = {
  siteId?: unknown;
  action?: unknown;
  workflowId?: unknown;
  publishedVersion?: unknown;
  executionId?: unknown;
  stepId?: unknown;
  version?: unknown;
  subject?: unknown;
  taskId?: unknown;
  generateChecklist?: unknown;
  completed?: unknown;
  note?: unknown;
  evidence?: unknown;
  rating?: unknown;
  text?: unknown;
  operationId?: unknown;
  resolutionNote?: unknown;
};

export type MerchantEnterpriseWorkflowExecutionRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadEmployeeState: (input: {
    siteId: string;
    actor: EmployeeActor;
    workflowId: string;
  }) => Promise<{
    currentRevisionNo: number;
    acknowledgement: MerchantEnterpriseWorkflowAcknowledgement | null;
    executions: MerchantEnterpriseWorkflowExecution[];
  }>;
  loadExecution: (input: {
    siteId: string;
    actor: EmployeeActor;
    executionId: string;
  }) => Promise<MerchantEnterpriseWorkflowExecution>;
  loadStats: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    workflowId: string;
  }) => Promise<MerchantEnterpriseWorkflowExecutionStats>;
  acknowledge: (input: {
    siteId: string;
    actor: EmployeeActor;
    workflowId: string;
    publishedVersion: number;
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflowAcknowledgement>;
  startExecution: (input: {
    siteId: string;
    actor: EmployeeActor;
    workflowId: string;
    publishedVersion: number;
    subject: string;
    taskId?: string;
    generateChecklist: boolean;
    operationId: string;
  }) => Promise<{
    execution: MerchantEnterpriseWorkflowExecution;
    generatedChecklistCount: number;
  }>;
  updateStep: (input: {
    siteId: string;
    actor: EmployeeActor;
    executionId: string;
    stepId: string;
    version: number;
    completed?: boolean;
    note?: string;
    evidence?: MerchantEnterpriseWorkflowEvidence[];
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflowExecution>;
  submitFeedback: (input: {
    siteId: string;
    actor: EmployeeActor;
    executionId: string;
    version: number;
    rating?: number;
    text?: string;
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflowExecution>;
  resolveFeedback: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    executionId: string;
    version: number;
    resolutionNote: string;
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflowFeedbackResolution>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseWorkflowExecutionStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseWorkflowExecutionRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadEmployeeState: (input) =>
    loadMerchantEnterpriseWorkflowEmployeeState(storeClient(), {
      siteId: input.siteId,
      workflowId: input.workflowId,
      actorType: "employee",
      actorId: input.actor.id,
    }),
  loadExecution: (input) =>
    loadMerchantEnterpriseWorkflowExecution(storeClient(), {
      siteId: input.siteId,
      executionId: input.executionId,
      actorType: "employee",
      actorId: input.actor.id,
    }),
  loadStats: (input) =>
    loadMerchantEnterpriseWorkflowExecutionStats(storeClient(), {
      siteId: input.siteId,
      workflowId: input.workflowId,
      actorType: input.actor.type,
      actorId: input.actor.id,
    }),
  acknowledge: (input) =>
    acknowledgeMerchantEnterpriseWorkflow(storeClient(), {
      siteId: input.siteId,
      workflowId: input.workflowId,
      publishedVersion: input.publishedVersion,
      operationId: input.operationId,
      actorType: "employee",
      actorId: input.actor.id,
    }),
  startExecution: (input) =>
    startMerchantEnterpriseWorkflowExecution(storeClient(), {
      siteId: input.siteId,
      workflowId: input.workflowId,
      publishedVersion: input.publishedVersion,
      subject: input.subject,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      generateChecklist: input.generateChecklist,
      operationId: input.operationId,
      actorType: "employee",
      actorId: input.actor.id,
    }),
  updateStep: (input) =>
    updateMerchantEnterpriseWorkflowExecutionStep(storeClient(), {
      siteId: input.siteId,
      executionId: input.executionId,
      stepId: input.stepId,
      version: input.version,
      ...(input.completed !== undefined ? { completed: input.completed } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      operationId: input.operationId,
      actorType: "employee",
      actorId: input.actor.id,
    }),
  submitFeedback: (input) =>
    submitMerchantEnterpriseWorkflowExecutionFeedback(storeClient(), {
      siteId: input.siteId,
      executionId: input.executionId,
      version: input.version,
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      operationId: input.operationId,
      actorType: "employee",
      actorId: input.actor.id,
    }),
  resolveFeedback: (input) =>
    resolveMerchantEnterpriseWorkflowExecutionFeedback(storeClient(), {
      siteId: input.siteId,
      executionId: input.executionId,
      version: input.version,
      resolutionNote: input.resolutionNote,
      operationId: input.operationId,
      actorType: input.actor.type,
      actorId: input.actor.id,
    }),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    [
      "workflow_execution_not_found",
      "workflow_execution_step_not_found",
      "workflow_not_found",
      "task_not_found",
    ].includes(message)
  ) {
    return response({ ok: false, error: message }, 404);
  }
  if (
    ["permission_denied", "employee_actor_required", "task_assignment_required"].includes(
      message,
    )
  ) {
    return response({ ok: false, error: message }, 403);
  }
  if (
    [
      "enterprise_version_conflict",
      "enterprise_idempotency_conflict",
      "enterprise_operation_in_progress",
      "workflow_revision_changed",
      "workflow_acknowledgement_required",
      "workflow_execution_incomplete",
      "workflow_feedback_not_open",
      "workflow_execution_limit_reached",
      "workflow_task_execution_exists",
      "task_workflow_checklist_source_exists",
      "task_checklist_limit_reached",
      "invalid_task_archived",
      "invalid_task_board",
    ].includes(message)
  ) {
    return response({ ok: false, error: message }, 409);
  }
  if (message.startsWith("invalid_workflow_") || message === "invalid_operation_id") {
    return response({ ok: false, error: message }, 400);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function siteId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!isMerchantNumericId(normalized)) throw new Error("invalid_workflow_execution_request");
  return normalized;
}

function uuid(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(normalized)) throw new Error("invalid_workflow_execution_request");
  return normalized;
}

function version(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("invalid_workflow_execution_version");
  }
  return value;
}

function optionalText(value: unknown, maxLength: number, error: string) {
  if (typeof value !== "string" || value.length > maxLength) throw new Error(error);
  return value.trim();
}

function operationId(request: Request, body: WorkflowExecutionBody) {
  const value = Object.prototype.hasOwnProperty.call(body, "operationId")
    ? body.operationId
    : request.headers.get("idempotency-key") ?? undefined;
  if (value === undefined) return "";
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid_operation_id");
  const normalized = normalizeMutationOperationId(value);
  if (normalized !== value.trim()) throw new Error("invalid_operation_id");
  return normalized;
}

function hasOnlyKeys(body: unknown, keys: readonly string[]) {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).every((key) => keys.includes(key)),
  );
}

function employee(actor: MerchantEnterpriseActor): EmployeeActor {
  if (actor.type !== "employee") throw new Error("employee_actor_required");
  return actor;
}

async function authorize(
  request: Request,
  requestedSiteId: string,
  dependencies: MerchantEnterpriseWorkflowExecutionRouteDependencies,
) {
  const actor = await dependencies.resolveActor(request, {
    siteId: requestedSiteId,
    requiredPermission: "workflows.view",
  });
  await dependencies.requireEnterpriseEntitlement(requestedSiteId);
  return actor;
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["siteId", "scope", "workflowId", "executionId"]);
  if (
    Array.from(params.keys()).some((key) => !allowed.has(key)) ||
    ["siteId", "scope", "workflowId", "executionId"].some(
      (key) => params.getAll(key).length > 1,
    )
  ) {
    throw new Error("invalid_workflow_execution_request");
  }
  const requestedSiteId = siteId(params.get("siteId"));
  const scope = params.get("scope");
  if (scope === "mine" || scope === "stats") {
    if (params.has("executionId")) throw new Error("invalid_workflow_execution_request");
    return {
      siteId: requestedSiteId,
      scope,
      workflowId: uuid(params.get("workflowId")),
    } as const;
  }
  if (scope === "execution") {
    if (params.has("workflowId")) throw new Error("invalid_workflow_execution_request");
    return {
      siteId: requestedSiteId,
      scope,
      executionId: uuid(params.get("executionId")),
    } as const;
  }
  throw new Error("invalid_workflow_execution_request");
}

export async function handleMerchantEnterpriseWorkflowExecutionsGet(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseWorkflowExecutionRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const query = parseQuery(request);
    const actor = await authorize(request, query.siteId, dependencies);
    if (query.scope === "mine") {
      const state = await dependencies.loadEmployeeState({
        siteId: query.siteId,
        actor: employee(actor),
        workflowId: query.workflowId,
      });
      return response({ ok: true, ...state });
    }
    if (query.scope === "execution") {
      const execution = await dependencies.loadExecution({
        siteId: query.siteId,
        actor: employee(actor),
        executionId: query.executionId,
      });
      return response({ ok: true, execution });
    }
    const stats = await dependencies.loadStats({
      siteId: query.siteId,
      actor,
      workflowId: query.workflowId,
    });
    return response({ ok: true, stats });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowExecutionsPost(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseWorkflowExecutionRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = (await request.json().catch(() => null)) as WorkflowExecutionBody | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid_workflow_execution_request");
    }
    const requestedSiteId = siteId(body.siteId);
    const workflowId = uuid(body.workflowId);
    const publishedVersion = version(body.publishedVersion);
    const requestedOperationId = operationId(request, body);
    const actor = employee(await authorize(request, requestedSiteId, dependencies));
    if (body.action === "acknowledge") {
      if (
        !hasOnlyKeys(body, [
          "siteId",
          "action",
          "workflowId",
          "publishedVersion",
          "operationId",
        ])
      ) {
        throw new Error("invalid_workflow_execution_request");
      }
      const acknowledgement = await dependencies.acknowledge({
        siteId: requestedSiteId,
        actor,
        workflowId,
        publishedVersion,
        operationId: requestedOperationId,
      });
      return response({ ok: true, acknowledgement });
    }
    if (body.action !== "start") throw new Error("invalid_workflow_execution_action");
    if (
      !hasOnlyKeys(body, [
        "siteId",
        "action",
        "workflowId",
        "publishedVersion",
        "subject",
        "taskId",
        "generateChecklist",
        "operationId",
      ]) ||
      (body.generateChecklist !== undefined && typeof body.generateChecklist !== "boolean")
    ) {
      throw new Error("invalid_workflow_execution_request");
    }
    const subject = optionalText(
      body.subject ?? "",
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_EXECUTION_SUBJECT_LENGTH,
      "invalid_workflow_execution_request",
    );
    const taskId = body.taskId === undefined ? undefined : uuid(body.taskId);
    if (body.generateChecklist === true && !taskId) {
      throw new Error("invalid_workflow_execution_request");
    }
    const result = await dependencies.startExecution({
      siteId: requestedSiteId,
      actor,
      workflowId,
      publishedVersion,
      subject,
      ...(taskId ? { taskId } : {}),
      generateChecklist: body.generateChecklist === true,
      operationId: requestedOperationId,
    });
    return response({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowExecutionsPatch(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseWorkflowExecutionRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = (await request.json().catch(() => null)) as WorkflowExecutionBody | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid_workflow_execution_request");
    }
    const requestedSiteId = siteId(body.siteId);
    const executionId = uuid(body.executionId);
    const expectedVersion = version(body.version);
    const requestedOperationId = operationId(request, body);
    const authorizedActor = await authorize(request, requestedSiteId, dependencies);
    if (body.action === "resolve_feedback") {
      if (
        !hasOnlyKeys(body, [
          "siteId",
          "action",
          "executionId",
          "version",
          "resolutionNote",
          "operationId",
        ])
      ) {
        throw new Error("invalid_workflow_execution_feedback");
      }
      const resolutionNote = optionalText(
        body.resolutionNote ?? "",
        MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
        "invalid_workflow_execution_feedback",
      );
      const resolution = await dependencies.resolveFeedback({
        siteId: requestedSiteId,
        actor: authorizedActor,
        executionId,
        version: expectedVersion,
        resolutionNote,
        operationId: requestedOperationId,
      });
      return response({ ok: true, resolution });
    }
    const actor = employee(authorizedActor);
    if (body.action === "step") {
      if (
        !hasOnlyKeys(body, [
          "siteId",
          "action",
          "executionId",
          "stepId",
          "version",
          "completed",
          "note",
          "evidence",
          "operationId",
        ])
      ) {
        throw new Error("invalid_workflow_execution_step_update");
      }
      const changed = ["completed", "note", "evidence"].filter((key) =>
        Object.prototype.hasOwnProperty.call(body, key),
      );
      if (
        changed.length === 0 ||
        (body.completed !== undefined && typeof body.completed !== "boolean")
      ) {
        throw new Error("invalid_workflow_execution_step_update");
      }
      const note = body.note === undefined
        ? undefined
        : optionalText(
            body.note,
            MAX_MERCHANT_ENTERPRISE_WORKFLOW_STEP_NOTE_LENGTH,
            "invalid_workflow_execution_step_update",
          );
      const evidence = body.evidence === undefined
        ? undefined
        : parseMerchantEnterpriseWorkflowEvidenceStrict(body.evidence);
      if (body.evidence !== undefined && !evidence) {
        throw new Error("invalid_workflow_evidence");
      }
      const execution = await dependencies.updateStep({
        siteId: requestedSiteId,
        actor,
        executionId,
        stepId: uuid(body.stepId),
        version: expectedVersion,
        ...(typeof body.completed === "boolean" ? { completed: body.completed } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(evidence !== undefined && evidence !== null ? { evidence } : {}),
        operationId: requestedOperationId,
      });
      return response({ ok: true, execution });
    }
    if (body.action !== "feedback") throw new Error("invalid_workflow_execution_action");
    if (
      !hasOnlyKeys(body, [
        "siteId",
        "action",
        "executionId",
        "version",
        "rating",
        "text",
        "operationId",
      ])
    ) {
      throw new Error("invalid_workflow_execution_feedback");
    }
    const hasRating = Object.prototype.hasOwnProperty.call(body, "rating");
    const hasText = Object.prototype.hasOwnProperty.call(body, "text");
    if (
      (!hasRating && !hasText) ||
      (hasRating &&
        (typeof body.rating !== "number" ||
          !Number.isSafeInteger(body.rating) ||
          body.rating < 1 ||
          body.rating > 5))
    ) {
      throw new Error("invalid_workflow_execution_feedback");
    }
    const feedbackText = hasText
      ? optionalText(
          body.text,
          MAX_MERCHANT_ENTERPRISE_WORKFLOW_FEEDBACK_LENGTH,
          "invalid_workflow_execution_feedback",
        )
      : undefined;
    if (!hasRating && !feedbackText) {
      throw new Error("invalid_workflow_execution_feedback");
    }
    const execution = await dependencies.submitFeedback({
      siteId: requestedSiteId,
      actor,
      executionId,
      version: expectedVersion,
      ...(hasRating ? { rating: body.rating as number } : {}),
      ...(feedbackText !== undefined ? { text: feedbackText } : {}),
      operationId: requestedOperationId,
    });
    return response({ ok: true, execution });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseWorkflowExecutionsGet(request);
}

export async function POST(request: Request) {
  return handleMerchantEnterpriseWorkflowExecutionsPost(request);
}

export async function PATCH(request: Request) {
  return handleMerchantEnterpriseWorkflowExecutionsPatch(request);
}
