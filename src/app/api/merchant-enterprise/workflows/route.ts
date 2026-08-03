import { NextResponse } from "next/server";
import {
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH,
  isMerchantEnterpriseVersion,
  parseMerchantEnterpriseWorkflowStepsStrict,
  parseMerchantEnterpriseWorkflowTagsStrict,
  type MerchantEnterpriseActor,
  type MerchantEnterprisePermission,
  type MerchantEnterpriseWorkflow,
  type MerchantEnterpriseWorkflowStep,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantEnterpriseWorkflow,
  loadMerchantEnterpriseWorkflows,
  updateMerchantEnterpriseWorkflow,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
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
const WORKFLOW_ACTIONS = ["save", "publish", "archive", "restore"] as const;

type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

type WorkflowBody = {
  siteId?: unknown;
  workflowId?: unknown;
  version?: unknown;
  action?: unknown;
  title?: unknown;
  scenario?: unknown;
  description?: unknown;
  category?: unknown;
  tags?: unknown;
  steps?: unknown;
  operationId?: unknown;
};

type WorkflowDraft = {
  title: string;
  scenario: string;
  description: string;
  category: string;
  tags: string[];
  steps: MerchantEnterpriseWorkflowStep[];
};

export type MerchantEnterpriseWorkflowRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadWorkflows: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantEnterpriseWorkflow[]>;
  createWorkflow: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    draft: WorkflowDraft;
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflow>;
  updateWorkflow: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    workflowId: string;
    version: number;
    action: WorkflowAction;
    draft?: WorkflowDraft;
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflow>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseWorkflowRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadWorkflows: (input) =>
    loadMerchantEnterpriseWorkflows(storeClient(), {
      siteId: input.siteId,
      actorType: input.actor.type,
      actorId: input.actor.id,
    }),
  createWorkflow: (input) =>
    createMerchantEnterpriseWorkflow(storeClient(), {
      siteId: input.siteId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      ...input.draft,
      operationId: input.operationId,
    }),
  updateWorkflow: (input) =>
    updateMerchantEnterpriseWorkflow(storeClient(), {
      siteId: input.siteId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      workflowId: input.workflowId,
      version: input.version,
      action: input.action,
      ...(input.draft ?? {}),
      operationId: input.operationId,
    }),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "enterprise_version_conflict" ||
    message === "enterprise_operation_in_progress" ||
    message === "workflow_limit_reached" ||
    message === "workflow_archived"
  ) {
    return response({ ok: false, error: message }, 409);
  }
  if (message === "workflow_not_found") {
    return response({ ok: false, error: message }, 404);
  }
  if (message === "permission_denied") {
    return response({ ok: false, error: message }, 403);
  }
  if (
    message === "workflow_publish_incomplete" ||
    message === "workflow_already_archived" ||
    message === "workflow_not_archived" ||
    message === "invalid_workflow_request" ||
    message === "invalid_workflow_action" ||
    message === "invalid_workflow_payload" ||
    message === "invalid_operation_id"
  ) {
    return response({ ok: false, error: message }, 400);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function parseSiteId(value: unknown) {
  const siteId = typeof value === "string" ? value.trim() : "";
  if (!isMerchantNumericId(siteId)) throw new Error("invalid_workflow_request");
  return siteId;
}

function parseWorkflowId(value: unknown) {
  const workflowId = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(workflowId)) throw new Error("invalid_workflow_request");
  return workflowId;
}

function parseRequiredText(value: unknown, maxLength: number) {
  if (typeof value !== "string") throw new Error("invalid_workflow_payload");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error("invalid_workflow_payload");
  }
  return normalized;
}

function parseOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error("invalid_workflow_payload");
  }
  return value.trim();
}

function parseDraft(body: WorkflowBody | null): WorkflowDraft {
  const tags = parseMerchantEnterpriseWorkflowTagsStrict(body?.tags);
  const steps = parseMerchantEnterpriseWorkflowStepsStrict(body?.steps);
  if (!tags || !steps) throw new Error("invalid_workflow_payload");
  return {
    title: parseRequiredText(
      body?.title,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_TITLE_LENGTH,
    ),
    scenario: parseRequiredText(
      body?.scenario,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_SCENARIO_LENGTH,
    ),
    description: parseOptionalText(
      body?.description,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_DESCRIPTION_LENGTH,
    ),
    category: parseOptionalText(
      body?.category,
      MAX_MERCHANT_ENTERPRISE_WORKFLOW_CATEGORY_LENGTH,
    ),
    tags,
    steps,
  };
}

function parseOperationId(request: Request, body: WorkflowBody | null) {
  const value =
    body && Object.prototype.hasOwnProperty.call(body, "operationId")
      ? body.operationId
      : request.headers.get("idempotency-key") ?? undefined;
  if (value === undefined) return "";
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("invalid_operation_id");
  }
  const operationId = normalizeMutationOperationId(value);
  if (!operationId) throw new Error("invalid_operation_id");
  return operationId;
}

function parseAction(value: unknown): WorkflowAction {
  if (!WORKFLOW_ACTIONS.includes(value as WorkflowAction)) {
    throw new Error("invalid_workflow_action");
  }
  return value as WorkflowAction;
}

function assertAllowedBodyKeys(
  body: WorkflowBody | null,
  allowedKeys: readonly (keyof WorkflowBody)[],
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_workflow_request");
  }
  const allowed = new Set<string>(allowedKeys);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new Error("invalid_workflow_request");
  }
}

async function authorize(
  request: Request,
  siteId: string,
  requiredPermission: MerchantEnterprisePermission,
  dependencies: MerchantEnterpriseWorkflowRouteDependencies,
) {
  const actor = await dependencies.resolveActor(request, {
    siteId,
    requiredPermission,
  });
  await dependencies.requireEnterpriseEntitlement(siteId);
  return actor;
}

export async function handleMerchantEnterpriseWorkflowsGet(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseWorkflowRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const searchParams = new URL(request.url).searchParams;
    if (
      searchParams.size !== 1 ||
      searchParams.getAll("siteId").length !== 1
    ) {
      throw new Error("invalid_workflow_request");
    }
    const siteId = parseSiteId(searchParams.get("siteId"));
    const actor = await authorize(request, siteId, "workflows.view", dependencies);
    const workflows = await dependencies.loadWorkflows({ siteId, actor });
    return response({ ok: true, workflows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowsPost(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseWorkflowRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = (await request.json().catch(() => null)) as WorkflowBody | null;
    assertAllowedBodyKeys(body, [
      "siteId",
      "title",
      "scenario",
      "description",
      "category",
      "tags",
      "steps",
      "operationId",
    ]);
    const siteId = parseSiteId(body?.siteId);
    const draft = parseDraft(body);
    const operationId = parseOperationId(request, body);
    const actor = await authorize(request, siteId, "workflows.manage", dependencies);
    const workflow = await dependencies.createWorkflow({
      siteId,
      actor,
      draft,
      operationId,
    });
    return response({ ok: true, workflow });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowsPatch(
  request: Request,
  dependencyOverrides: Partial<MerchantEnterpriseWorkflowRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = (await request.json().catch(() => null)) as WorkflowBody | null;
    const siteId = parseSiteId(body?.siteId);
    const workflowId = parseWorkflowId(body?.workflowId);
    const action = parseAction(body?.action);
    assertAllowedBodyKeys(
      body,
      action === "save"
        ? [
            "siteId",
            "workflowId",
            "version",
            "action",
            "title",
            "scenario",
            "description",
            "category",
            "tags",
            "steps",
            "operationId",
          ]
        : ["siteId", "workflowId", "version", "action", "operationId"],
    );
    if (!isMerchantEnterpriseVersion(body?.version)) {
      throw new Error("invalid_workflow_request");
    }
    const draft = action === "save" ? parseDraft(body) : undefined;
    const operationId = parseOperationId(request, body);
    const actor = await authorize(
      request,
      siteId,
      action === "save" ? "workflows.manage" : "workflows.publish",
      dependencies,
    );
    const workflow = await dependencies.updateWorkflow({
      siteId,
      actor,
      workflowId,
      version: body.version,
      action,
      ...(draft ? { draft } : {}),
      operationId,
    });
    return response({ ok: true, workflow });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseWorkflowsGet(request);
}

export async function POST(request: Request) {
  return handleMerchantEnterpriseWorkflowsPost(request);
}

export async function PATCH(request: Request) {
  return handleMerchantEnterpriseWorkflowsPatch(request);
}
