import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createMerchantOrderRecord, listMerchantOrders, updateMerchantOrderBySite } from "@/lib/merchantOrders.server";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import type { MerchantOrderAction, MerchantOrderCreateInput } from "@/lib/merchantOrders";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function resolveOrderAdminSession(request: Request, siteId: string) {
  const session = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: siteId,
  });
  if (!session || session.merchantId !== siteId) return null;
  return session;
}

async function isOrderManagementEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId).catch(() => null);
  return Boolean(site?.permissionConfig?.allowProductBlock && site?.permissionConfig?.allowOrderManagement);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId")?.trim() ?? "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const session = await resolveOrderAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await isOrderManagementEnabled(siteId))) {
      return NextResponse.json({ error: "order_management_disabled" }, { status: 403 });
    }
    const orders = await listMerchantOrders(siteId);
    return NextResponse.json({ ok: true, orders });
  } catch (error) {
    return NextResponse.json(
      {
        error: "order_list_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json()) as Partial<MerchantOrderCreateInput>;
    const siteId = String(body.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    if (!(await isOrderManagementEnabled(siteId))) {
      return NextResponse.json({ error: "order_management_disabled" }, { status: 403 });
    }
    const order = await createMerchantOrderRecord({
      siteId,
      siteName: String(body.siteName ?? "").trim(),
      blockId: String(body.blockId ?? "").trim(),
      pricePrefix: String(body.pricePrefix ?? "").trim(),
      customer: body.customer,
      items: Array.isArray(body.items) ? body.items : [],
    });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json(
      {
        error: "order_create_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json()) as {
      siteId?: string;
      orderId?: string;
      action?: MerchantOrderAction;
    } | null;
    const siteId = String(body?.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    const session = await resolveOrderAdminSession(request, siteId);
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!(await isOrderManagementEnabled(siteId))) {
      return NextResponse.json({ error: "order_management_disabled" }, { status: 403 });
    }
    const action =
      body?.action === "confirm" ||
      body?.action === "cancel" ||
      body?.action === "restore" ||
      body?.action === "print" ||
      body?.action === "touch"
        ? body.action
        : null;
    if (!action) {
      return NextResponse.json({ error: "invalid_order_action" }, { status: 400 });
    }
    const order = await updateMerchantOrderBySite({
      siteId,
      orderId: String(body?.orderId ?? "").trim(),
      action,
    });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json(
      {
        error: "order_update_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 400 },
    );
  }
}
