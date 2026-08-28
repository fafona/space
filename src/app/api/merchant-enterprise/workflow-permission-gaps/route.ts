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
  grantMerchantEnterpriseRoleWorkflowPermissions,
  loadMerchantEnterpriseWorkflowPermissionGaps,
  type MerchantEnterpriseWorkflowRevisionStoreClient,
} from "@/lib/merchantEnterpriseWorkflowRevisions.server";
import {
  parseMerchantEnterpriseWorkflowPermissionsStrict,
  type MerchantEnterpriseWorkflowPermissionGap,
  type MerchantEnterpriseWorkflowPermissionGrantResult,
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

type GrantBody = {
  siteId?: unknown;
  roleId?: unknown;
  version?: unknown;
  workflowPermissions?: unknown;
  operationId?: unknown;
};

export type MerchantEnterpriseWorkflowPermissionGapRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadGaps: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantEnterpriseWorkflowPermissionGap[]>;
  grantPermissions: (input: {
    siteId: string;
    roleId: string;
    version: number;
    workflowPermissions: NonNullable<
      ReturnType<typeof parseMerchantEnterpriseWorkflowPermissionsStrict>
    >;
    actor: MerchantEnterpriseActor;
    operationId: string;
  }) => Promise<MerchantEnterpriseWorkflowPermissionGrantResult>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseWorkflowRevisionStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseWorkflowPermissionGapRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadGaps: (input) =>
    loadMerchantEnterpriseWorkflowPermissionGaps(storeClient(), input),
  grantPermissions: (input) =>
    grantMerchantEnterpriseRoleWorkflowPermissions(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "enterprise_version_conflict" ||
    code === "enterprise_operation_in_progress" ||
    code === "business_role_workflow_grant_requires_role_editor"
  ) {
    return response({ ok: false, error: code }, 409);
  }
  if (code === "role_not_found") {
    return response({ ok: false, error: code }, 404);
  }
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  if (
    code === "invalid_permission_dependencies" ||
    code === "invalid_workflow_permission_gap_query" ||
    code === "invalid_workflow_permission_grant" ||
    code === "invalid_operation_id"
  ) {
    return response({ ok: false, error: code }, 400);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function parseSiteQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    Array.from(params.keys()).some((key) => key !== "siteId") ||
    params.getAll("siteId").length !== 1
  ) {
    throw new Error("invalid_workflow_permission_gap_query");
  }
  const siteId = params.get("siteId") ?? "";
  if (siteId !== siteId.trim() || !isMerchantNumericId(siteId)) {
    throw new Error("invalid_workflow_permission_gap_query");
  }
  return siteId;
}

function parseGrantBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_workflow_permission_grant");
  }
  const body = value as GrantBody;
  const allowed = new Set([
    "siteId",
    "roleId",
    "version",
    "workflowPermissions",
    "operationId",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new Error("invalid_workflow_permission_grant");
  }
  const siteId = typeof body.siteId === "string" ? body.siteId : "";
  const roleId = typeof body.roleId === "string" ? body.roleId : "";
  const workflowPermissions = parseMerchantEnterpriseWorkflowPermissionsStrict(
    body.workflowPermissions,
  );
  if (
    siteId !== siteId.trim() ||
    !isMerchantNumericId(siteId) ||
    roleId !== roleId.trim() ||
    !UUID_PATTERN.test(roleId) ||
    !Number.isSafeInteger(body.version) ||
    Number(body.version) < 1 ||
    !workflowPermissions ||
    typeof body.operationId !== "string" ||
    !body.operationId.trim()
  ) {
    throw new Error("invalid_workflow_permission_grant");
  }
  const operationId = normalizeMutationOperationId(body.operationId);
  if (!operationId || operationId !== body.operationId.trim()) {
    throw new Error("invalid_operation_id");
  }
  return {
    siteId,
    roleId: roleId.toLowerCase(),
    version: Number(body.version),
    workflowPermissions,
    operationId,
  };
}

async function authorizeOwner(
  request: Request,
  siteId: string,
  dependencies: MerchantEnterpriseWorkflowPermissionGapRouteDependencies,
) {
  const actor = await dependencies.resolveActor(request, {
    siteId,
    requiredPermission: "enterprise.view",
  });
  await dependencies.requireEnterpriseEntitlement(siteId);
  if (actor.type !== "owner") throw new Error("permission_denied");
  return actor;
}

export async function handleMerchantEnterpriseWorkflowPermissionGapsGet(
  request: Request,
  overrides: Partial<MerchantEnterpriseWorkflowPermissionGapRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const siteId = parseSiteQuery(request);
    const actor = await authorizeOwner(request, siteId, dependencies);
    const gaps = await dependencies.loadGaps({ siteId, actor });
    return response({ ok: true, gaps });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantEnterpriseWorkflowPermissionGapsPost(
  request: Request,
  overrides: Partial<MerchantEnterpriseWorkflowPermissionGapRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const input = parseGrantBody(await request.json().catch(() => null));
    const actor = await authorizeOwner(request, input.siteId, dependencies);
    const result = await dependencies.grantPermissions({ ...input, actor });
    return response({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterpriseWorkflowPermissionGapsGet(request);
}

export async function POST(request: Request) {
  return handleMerchantEnterpriseWorkflowPermissionGapsPost(request);
}
