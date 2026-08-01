import { NextResponse } from "next/server";
import type { MerchantEnterpriseActor } from "@/lib/merchantEnterprise";
import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { getMerchantOrderBySite } from "@/lib/merchantOrders.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export type MerchantOrderSourceRouteDependencies = {
  resolveActor: (
    request: Request,
    input: { siteId: string; requiredPermission?: "enterprise.view" },
  ) => Promise<MerchantEnterpriseActor>;
  requireEnterpriseEntitlement: (siteId: string) => Promise<{
    permissionConfig?: {
      allowProductBlock?: boolean;
      allowOrderManagement?: boolean;
    } | null;
  } | null>;
  getOrder: (siteId: string, orderId: string) => Promise<MerchantOrderRecord | null>;
};

const DEFAULT_DEPENDENCIES: MerchantOrderSourceRouteDependencies = {
  resolveActor: resolveMerchantEnterpriseActor,
  requireEnterpriseEntitlement: requireMerchantEnterpriseEntitlement,
  getOrder: getMerchantOrderBySite,
};

function parseSourceOrderQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const keys = Array.from(searchParams.keys());
  if (
    keys.some((key) => key !== "siteId" && key !== "orderId") ||
    searchParams.getAll("siteId").length !== 1 ||
    searchParams.getAll("orderId").length !== 1
  ) {
    throw new Error("invalid_source_order_request");
  }
  const siteId = searchParams.get("siteId") ?? "";
  const orderId = searchParams.get("orderId") ?? "";
  if (
    siteId !== siteId.trim() ||
    orderId !== orderId.trim() ||
    !isMerchantNumericId(siteId) ||
    !ORDER_ID_PATTERN.test(orderId)
  ) {
    throw new Error("invalid_source_order_request");
  }
  return { siteId, orderId };
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS });
}

function fail(error: unknown) {
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return response(resolved.body, resolved.status);
}

export async function handleMerchantOrderSourceGet(
  request: Request,
  dependencyOverrides: Partial<MerchantOrderSourceRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const { siteId, orderId } = parseSourceOrderQuery(request);
    const actor = await dependencies.resolveActor(request, {
      siteId,
      requiredPermission: "enterprise.view",
    });
    if (actor.type !== "owner") {
      throw new MerchantEnterpriseAccessError("permission_denied", 403);
    }

    const authoritativeSite = await dependencies.requireEnterpriseEntitlement(siteId);
    if (
      !authoritativeSite?.permissionConfig?.allowProductBlock ||
      !authoritativeSite.permissionConfig.allowOrderManagement
    ) {
      throw new MerchantEnterpriseAccessError("order_management_disabled", 403);
    }

    const order = await dependencies.getOrder(siteId, orderId);
    if (!order || order.siteId !== siteId || order.id !== orderId) {
      throw new MerchantEnterpriseAccessError("order_not_found", 404);
    }
    return response({ ok: true, order });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  return handleMerchantOrderSourceGet(request);
}
