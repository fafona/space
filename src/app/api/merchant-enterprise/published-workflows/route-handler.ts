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
import type { MerchantEnterprisePublishedWorkflowChoice } from "@/lib/merchantEnterprisePublishedWorkflows";
import {
  loadMerchantEnterprisePublishedWorkflowChoices,
  type MerchantEnterprisePublishedWorkflowStoreClient,
} from "@/lib/merchantEnterprisePublishedWorkflows.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export type MerchantEnterprisePublishedWorkflowsRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission: MerchantEnterprisePermission },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<unknown>;
  loadChoices: (input: {
    siteId: string;
    actor: MerchantEnterpriseActor;
  }) => Promise<MerchantEnterprisePublishedWorkflowChoice[]>;
};

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterprisePublishedWorkflowStoreClient;
}

const DEFAULT_DEPENDENCIES: MerchantEnterprisePublishedWorkflowsRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  loadChoices: (input) =>
    loadMerchantEnterprisePublishedWorkflowChoices(storeClient(), input),
};

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "permission_denied") {
    return response({ ok: false, error: code }, 403);
  }
  if (code === "invalid_published_workflow_choice_query") {
    return response({ ok: false, error: code }, 400);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  if (
    Array.from(params.keys()).some((key) => key !== "siteId") ||
    params.getAll("siteId").length !== 1
  ) {
    throw new Error("invalid_published_workflow_choice_query");
  }
  const siteId = params.get("siteId") ?? "";
  if (siteId !== siteId.trim() || !isMerchantNumericId(siteId)) {
    throw new Error("invalid_published_workflow_choice_query");
  }
  return { siteId };
}

export async function handleMerchantEnterprisePublishedWorkflowsGet(
  request: Request,
  overrides: Partial<MerchantEnterprisePublishedWorkflowsRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides };
  try {
    const { siteId } = parseQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId,
      requiredPermission: "workflows.view",
    });
    await dependencies.requireEnterpriseEntitlement(siteId);
    const choices = await dependencies.loadChoices({ siteId, actor });
    return response({ ok: true, choices });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantEnterprisePublishedWorkflowsGet(request);
}
