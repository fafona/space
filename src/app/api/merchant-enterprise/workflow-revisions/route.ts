import { NextResponse } from "next/server";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  loadMerchantEnterpriseWorkflowRevisionDetail,
  loadMerchantEnterpriseWorkflowRevisionHistory,
  MAX_MERCHANT_ENTERPRISE_WORKFLOW_REVISION_PAGE_SIZE,
  restoreMerchantEnterpriseWorkflowRevisionToDraft,
  type MerchantEnterpriseWorkflowRevisionStoreClient,
} from "@/lib/merchantEnterpriseWorkflowRevisions.server";
import type {
  MerchantEnterpriseActor,
  MerchantEnterprisePermission,
  MerchantEnterpriseWorkflow,
} from "@/lib/merchantEnterprise";
import type {
  MerchantEnterpriseWorkflowRevisionDetail,
  MerchantEnterpriseWorkflowRevisionHistoryPage,
} from "@/lib/merchantEnterpriseWorkflowRevisions";
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

type RestoreBody = {
  siteId?: unknown;
  workflowId?: unknown;
  revision?: unknown;
  version?: unknown;
  action?: unknown;
  operationId?: unknown;
};

export type MerchantEnterpriseWorkflowRevisionRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadHistory: (input: {
    siteId: string;
    workflowId: string;
    actor: MerchantEnterpriseActor;
    limit: number;
    beforeRevision: number | null;
  }) => Promise<MerchantEnterpriseWorkflowRevisionHistoryPage>;
  loadDetail: (input: {
    siteId: string;
    workflowId: string;
    revision: number;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantEnterpriseWorkflowRevisionDetail>;
  restoreToDraft: (input: {
    siteId: string;
    workflowId: string;
    revision: number;
    version: number;
    actor: MerchantEnterpriseActor;
    operationId: string;
  }) => Promise<{ workflow: MerchantEnterpriseWorkflow; restoredFromRevision: number }>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseWorkflowRevisionStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseWorkflowRevisionRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadHistory: (input) =>
    loadMerchantEnterpriseWorkflowRevisionHistory(storeClient(), input),
  loadDetail: (input) =>
    loadMerchantEnterpriseWorkflowRevisionDetail(storeClient(), input),
  restoreToDraft: (input) =>
    restoreMerchantEnterpriseWorkflowRevisionToDraft(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "enterprise_version_conflict" ||
    code === "enterprise_operation_in_progress" ||
    code === "workflow_archived"
  ) {
    return response({ ok: false, error: code }, 409);
  }
  if (code === "workflow_not_found" || code === "workflow_revision_not_found") {
    return response({ ok: false, error: code }, 404);
  }
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  if (
    code === "invalid_workflow_revision_request" ||
    code === "invalid_workflow_revision_query" ||
    code === "invalid_workflow_revision_restore" ||
    code === "invalid_operation_id"
  ) {
    return response({ ok: false, error: code }, 400);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function positiveInteger(value: string | null, errorCode: string) {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(errorCode);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(errorCode);
  return parsed;
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set([
    "siteId",
    "workflowId",
    "revision",
    "limit",
    "beforeRevision",
  ]);
  if (
    Array.from(params.keys()).some((key) => !allowed.has(key)) ||
    params.getAll("siteId").length !== 1 ||
    params.getAll("workflowId").length !== 1 ||
    ["revision", "limit", "beforeRevision"].some(
      (key) => params.getAll(key).length > 1,
    )
  ) {
    throw new Error("invalid_workflow_revision_query");
  }
  const siteId = params.get("siteId") ?? "";
  const workflowId = params.get("workflowId") ?? "";
  if (
    siteId !== siteId.trim() ||
    !isMerchantNumericId(siteId) ||
    workflowId !== workflowId.trim() ||
    !UUID_PATTERN.test(workflowId)
  ) {
    throw new Error("invalid_workflow_revision_query");
  }
  if (params.has("revision")) {
    if (params.has("limit") || params.has("beforeRevision")) {
      throw new Error("invalid_workflow_revision_query");
    }
    return {
      mode: "detail",
      siteId,
      workflowId: workflowId.toLowerCase(),
      revision: positiveInteger(
        params.get("revision"),
        "invalid_workflow_revision_query",
      ),
    } as const;
  }
  const limit = params.has("limit")
    ? positiveInteger(params.get("limit"), "invalid_workflow_revision_query")
    : 50;
  if (limit > MAX_MERCHANT_ENTERPRISE_WORKFLOW_REVISION_PAGE_SIZE) {
    throw new Error("invalid_workflow_revision_query");
  }
  return {
    mode: "history",
    siteId,
    workflowId: workflowId.toLowerCase(),
    limit,
    beforeRevision: params.has("beforeRevision")
      ? positiveInteger(
          params.get("beforeRevision"),
          "invalid_workflow_revision_query",
        )
      : null,
  } as const;
}

function parseBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_workflow_revision_restore");
  }
  const body = value as RestoreBody;
  const allowed = new Set([
    "siteId",
    "workflowId",
    "revision",
    "version",
    "action",
    "operationId",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new Error("invalid_workflow_revision_restore");
  }
  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  const workflowId = typeof body.workflowId === "string" ? body.workflowId : "";
  if (
    !isMerchantNumericId(siteId) ||
    siteId !== siteId.trim() ||
    !UUID_PATTERN.test(workflowId) ||
    workflowId !== workflowId.trim() ||
    body.action !== "restore_to_draft" ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 1 ||
    !Number.isSafeInteger(body.version) ||
    Number(body.version) < 1 ||
    typeof body.operationId !== "string" ||
    !body.operationId.trim()
  ) {
    throw new Error("invalid_workflow_revision_restore");
  }
  const operationId = normalizeMutationOperationId(body.operationId);
  if (!operationId || operationId !== body.operationId.trim()) {
    throw new Error("invalid_operation_id");
  }
  return {
    siteId,
    workflowId: workflowId.toLowerCase(),
    revision: Number(body.revision),
    version: Number(body.version),
    operationId,
  };
}

async function authorize(
  request: Request,
  siteId: string,
  requiredPermission: MerchantEnterprisePermission,
  dependencies: MerchantEnterpriseWorkflowRevisionRouteDependencies,
) {
  const actor = await dependencies.resolveActor(request, {
    siteId,
    requiredPermission,
  });
  await dependencies.requireEnterpriseEntitlement(siteId);
  return actor;
}

export async function handleMerchantEnterpriseWorkflowRevisionsGet(
  request: Request,
  overrides: Partial<MerchantEnterpriseWorkflowRevisionRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const query = parseQuery(request);
    const actor = await authorize(
      request,
      query.siteId,
      "workflows.view",
      dependencies,
    );
    if (query.mode === "detail") {
      const detail = await dependencies.loadDetail({
        siteId: query.siteId,
        workflowId: query.workflowId,
        revision: query.revision,
        actor,
      });
      return response({ ok: true, ...detail });
    }
    const page = await dependencies.loadHistory({
      siteId: query.siteId,
      workflowId: query.workflowId,
      actor,
      limit: query.limit,
      beforeRevision: query.beforeRevision,
    });
    return response({ ok: true, ...page });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowRevisionsPost(
  request: Request,
  overrides: Partial<MerchantEnterpriseWorkflowRevisionRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const input = parseBody(await request.json().catch(() => null));
    const actor = await authorize(
      request,
      input.siteId,
      "workflows.manage",
      dependencies,
    );
    const restored = await dependencies.restoreToDraft({ ...input, actor });
    return response({ ok: true, ...restored });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseWorkflowRevisionsGet(request);
}

export async function POST(request: Request) {
  return handleMerchantEnterpriseWorkflowRevisionsPost(request);
}
