import { NextResponse } from "next/server";
import type {
  MerchantEnterpriseActor,
  MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  authorizeMerchantLinkedOrderSummarySource,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";
import {
  buildMerchantLinkedOrderSummary,
  type MerchantLinkedOrderSummary,
} from "@/lib/merchantOrderEnterprise";
import { getMerchantOrderBySite } from "@/lib/merchantOrders.server";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINKED_ORDER_SUMMARY_PERMISSION: MerchantEnterprisePermission =
  "orders.linked.view";
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export { buildMerchantLinkedOrderSummary };
export type { MerchantLinkedOrderSummary };

export type MerchantLinkedOrderSummaryRouteDependencies = {
  resolveActor: (
    request: Request,
    input: {
      siteId: string;
      requiredPermission?: MerchantEnterprisePermission;
    },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<{
    permissionConfig?: {
      allowProductBlock?: boolean;
      allowOrderManagement?: boolean;
    } | null;
  } | null>;
  authorizeSource: typeof authorizeMerchantLinkedOrderSummarySource;
  getOrder: (siteId: string, orderId: string) => Promise<MerchantOrderRecord | null>;
  createStoreClient: () => MerchantEnterpriseStoreClient;
};

const DEFAULT_DEPENDENCIES: MerchantLinkedOrderSummaryRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  authorizeSource: authorizeMerchantLinkedOrderSummarySource,
  getOrder: getMerchantOrderBySite,
  createStoreClient: () => {
    const client = createServerSupabaseServiceClient();
    if (!client) throw new Error("enterprise_store_unavailable");
    return client as unknown as MerchantEnterpriseStoreClient;
  },
};

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const keys = Array.from(searchParams.keys());
  if (
    keys.some((key) => key !== "siteId" && key !== "taskId") ||
    searchParams.getAll("siteId").length !== 1 ||
    searchParams.getAll("taskId").length !== 1
  ) {
    throw new Error("invalid_linked_order_summary_request");
  }

  const siteId = searchParams.get("siteId") ?? "";
  const taskId = searchParams.get("taskId") ?? "";
  if (
    siteId !== siteId.trim() ||
    taskId !== taskId.trim() ||
    !isMerchantNumericId(siteId) ||
    !UUID_PATTERN.test(taskId)
  ) {
    throw new Error("invalid_linked_order_summary_request");
  }
  return { siteId, taskId };
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "task_not_found" || message === "order_not_found") {
    return response({ ok: false, error: message }, 404);
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

export async function handleMerchantLinkedOrderSummaryGet(
  request: Request,
  dependencyOverrides: Partial<MerchantLinkedOrderSummaryRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const { siteId, taskId } = parseQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId,
      requiredPermission: LINKED_ORDER_SUMMARY_PERMISSION,
    });
    if (actor.type !== "employee") {
      throw new MerchantEnterpriseAccessError("permission_denied", 403);
    }

    const authoritativeSite = await dependencies.requireEnterpriseEntitlement(siteId);
    if (
      !authoritativeSite?.permissionConfig?.allowProductBlock ||
      !authoritativeSite.permissionConfig.allowOrderManagement
    ) {
      throw new MerchantEnterpriseAccessError("order_management_disabled", 403);
    }

    const sourceId = await dependencies.authorizeSource(
      dependencies.createStoreClient(),
      {
        siteId,
        taskId,
        employeeId: actor.id,
      },
    );
    const order = await dependencies.getOrder(siteId, sourceId);
    if (!order || order.siteId !== siteId || order.id !== sourceId) {
      throw new MerchantEnterpriseAccessError("order_not_found", 404);
    }

    return response({
      ok: true,
      summary: buildMerchantLinkedOrderSummary(order),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantLinkedOrderSummaryGet(request);
}
