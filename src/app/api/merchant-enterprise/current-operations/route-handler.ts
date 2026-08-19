import { NextResponse } from "next/server";
import {
  hasMerchantEnterprisePermission,
  type MerchantEnterpriseActor,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint,
  type MerchantEnterpriseCurrentOperations,
} from "@/lib/merchantEnterpriseCurrentOperations";
import {
  loadMerchantEnterpriseCurrentOperations,
  type MerchantEnterpriseCurrentOperationsStoreClient,
} from "@/lib/merchantEnterpriseCurrentOperations.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export type MerchantEnterpriseCurrentOperationsRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: "tasks.view" },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadCurrentOperations: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
    employeeId: string | null;
  }) => Promise<MerchantEnterpriseCurrentOperations>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseCurrentOperationsStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterpriseCurrentOperationsRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadCurrentOperations: (input) =>
    loadMerchantEnterpriseCurrentOperations(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(
  error: unknown,
  actor: MerchantEnterpriseActor | null = null,
) {
  const code = error instanceof Error ? error.message : "";
  if (code === "enterprise_schema_unavailable" && actor) {
    return response(
      {
        ok: false,
        error: code,
        authorizationFingerprint:
          buildMerchantEnterpriseCurrentOperationsAuthorizationFingerprint(
            actor,
          ),
      },
      503,
    );
  }
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

export function parseMerchantEnterpriseCurrentOperationsQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowedKeys = new Set(["siteId", "employeeId"]);
  if (
    Array.from(params.keys()).some((key) => !allowedKeys.has(key)) ||
    params.getAll("siteId").length !== 1 ||
    params.getAll("employeeId").length > 1
  ) {
    throw new Error("invalid_current_operations_query");
  }
  const siteId = params.get("siteId") ?? "";
  const employeeId = params.get("employeeId");
  if (
    siteId !== siteId.trim() ||
    !isMerchantNumericId(siteId) ||
    (employeeId !== null &&
      (employeeId !== employeeId.trim() || !UUID_PATTERN.test(employeeId)))
  ) {
    throw new Error("invalid_current_operations_query");
  }
  return {
    siteId,
    employeeId: employeeId?.toLowerCase() ?? null,
  };
}

export async function handleMerchantEnterpriseCurrentOperationsGet(
  request: Request,
  overrides: Partial<MerchantEnterpriseCurrentOperationsRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  let resolvedActor: MerchantEnterpriseActor | null = null;
  try {
    const query = parseMerchantEnterpriseCurrentOperationsQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId: query.siteId,
      requiredPermission: "tasks.view",
    });
    resolvedActor = actor;
    if (
      query.employeeId &&
      actor.type === "employee" &&
      query.employeeId !== actor.id.toLowerCase() &&
      !hasMerchantEnterprisePermission(actor, "employees.view")
    ) {
      throw new Error("permission_denied");
    }
    await dependencies.requireEnterpriseEntitlement(query.siteId);
    const currentOperations = await dependencies.loadCurrentOperations({
      ...query,
      actor,
    });
    return response(currentOperations);
  } catch (error) {
    return errorResponse(error, resolvedActor);
  }
}
