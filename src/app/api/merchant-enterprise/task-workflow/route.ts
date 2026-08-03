import { NextResponse } from "next/server";
import {
  hasMerchantEnterprisePermission,
  type MerchantEnterpriseActor,
  type MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
import type {
  MerchantTaskWorkflowBinding,
  MerchantTaskWorkflowChecklistItem,
} from "@/lib/merchantTaskWorkflow";
import {
  bindMerchantTaskToPublishedWorkflow,
  loadMerchantTaskWorkflowBinding,
  type MerchantTaskWorkflowStoreClient,
} from "@/lib/merchantTaskWorkflow.server";
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

type BindBody = {
  siteId?: unknown;
  taskId?: unknown;
  workflowId?: unknown;
  expectedTaskVersion?: unknown;
  expectedRevisionId?: unknown;
  operationId?: unknown;
};

export type MerchantTaskWorkflowRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadBinding: (input: {
    siteId: string;
    taskId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantTaskWorkflowBinding | null>;
  bindWorkflow: (input: {
    siteId: string;
    taskId: string;
    workflowId: string;
    expectedTaskVersion: number;
    expectedRevisionId: string;
    operationId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<{
    binding: MerchantTaskWorkflowBinding;
    createdChecklistItems: MerchantTaskWorkflowChecklistItem[];
  }>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantTaskWorkflowStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantTaskWorkflowRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadBinding: (input) => loadMerchantTaskWorkflowBinding(storeClient(), input),
  bindWorkflow: (input) =>
    bindMerchantTaskToPublishedWorkflow(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "task_not_found" || code === "workflow_not_found") {
    return response({ ok: false, error: code }, 404);
  }
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  if (
    code === "workflow_not_published" ||
    code === "workflow_revision_changed" ||
    code === "enterprise_version_conflict" ||
    code === "enterprise_operation_in_progress" ||
    code === "enterprise_idempotency_conflict" ||
    code === "task_workflow_already_bound" ||
    code === "task_workflow_checklist_source_exists" ||
    code === "task_checklist_limit_reached" ||
    code === "invalid_task_archived"
  ) {
    return response({ ok: false, error: code }, 409);
  }
  if (
    code === "invalid_task_workflow_request" ||
    code === "invalid_operation_id"
  ) {
    return response({ ok: false, error: code }, 400);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function siteId(value: unknown) {
  const normalized = typeof value === "string" ? value : "";
  if (
    normalized !== normalized.trim() ||
    !isMerchantNumericId(normalized)
  ) {
    throw new Error("invalid_task_workflow_request");
  }
  return normalized;
}

function uuid(value: unknown) {
  const normalized = typeof value === "string" ? value : "";
  if (normalized !== normalized.trim() || !UUID_PATTERN.test(normalized)) {
    throw new Error("invalid_task_workflow_request");
  }
  return normalized.toLowerCase();
}

function requireWorkflowView(actor: MerchantEnterpriseActor) {
  if (!hasMerchantEnterprisePermission(actor, "workflows.view")) {
    throw new MerchantEnterpriseAccessError("permission_denied", 403);
  }
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(["siteId", "taskId"]);
  if (
    Array.from(params.keys()).some((key) => !allowed.has(key)) ||
    params.getAll("siteId").length !== 1 ||
    params.getAll("taskId").length !== 1
  ) {
    throw new Error("invalid_task_workflow_request");
  }
  return {
    siteId: siteId(params.get("siteId")),
    taskId: uuid(params.get("taskId")),
  };
}

function parseBody(value: unknown, request: Request) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_task_workflow_request");
  }
  const body = value as BindBody;
  const allowed = new Set([
    "siteId",
    "taskId",
    "workflowId",
    "expectedTaskVersion",
    "expectedRevisionId",
    "operationId",
  ]);
  if (
    Object.keys(body).some((key) => !allowed.has(key)) ||
    !Number.isSafeInteger(body.expectedTaskVersion) ||
    Number(body.expectedTaskVersion) < 1
  ) {
    throw new Error("invalid_task_workflow_request");
  }
  const rawOperationId = Object.prototype.hasOwnProperty.call(body, "operationId")
    ? body.operationId
    : request.headers.get("idempotency-key") ?? undefined;
  if (typeof rawOperationId !== "string" || !rawOperationId.trim()) {
    throw new Error("invalid_operation_id");
  }
  const operationId = normalizeMutationOperationId(rawOperationId);
  if (!operationId || operationId !== rawOperationId.trim()) {
    throw new Error("invalid_operation_id");
  }
  return {
    siteId: siteId(body.siteId),
    taskId: uuid(body.taskId),
    workflowId: uuid(body.workflowId),
    expectedTaskVersion: Number(body.expectedTaskVersion),
    expectedRevisionId: uuid(body.expectedRevisionId),
    operationId,
  };
}

export async function handleMerchantTaskWorkflowGet(
  request: Request,
  overrides: Partial<MerchantTaskWorkflowRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const query = parseQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId: query.siteId,
      requiredPermission: "tasks.view",
    });
    requireWorkflowView(actor);
    await dependencies.requireEnterpriseEntitlement(query.siteId);
    const binding = await dependencies.loadBinding({ ...query, actor });
    return response({ ok: true, binding });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantTaskWorkflowPost(
  request: Request,
  overrides: Partial<MerchantTaskWorkflowRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const body = await request.json().catch(() => null);
    const input = parseBody(body, request);
    const actor = await dependencies.resolveActor(request, {
      siteId: input.siteId,
      requiredPermission: "tasks.update",
    });
    requireWorkflowView(actor);
    await dependencies.requireEnterpriseEntitlement(input.siteId);
    const result = await dependencies.bindWorkflow({ ...input, actor });
    return response({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantTaskWorkflowGet(request);
}

export async function POST(request: Request) {
  return handleMerchantTaskWorkflowPost(request);
}
