import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  createMerchantOrderRecord,
  cancelPersonalMerchantOrder,
  listMerchantOrders,
  listPersonalMerchantOrders,
  updateMerchantOrderBySite,
} from "@/lib/merchantOrders.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import { buildPersonalMerchantContactMap } from "@/lib/personalMerchantContacts.server";
import type { MerchantOrderAction, MerchantOrderCreateInput, MerchantOrderLineItemInput } from "@/lib/merchantOrders";

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

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("scope")?.trim() === "personal") {
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const orders = await listPersonalMerchantOrders({
        accountId: session.accountId,
        userId: session.userId,
        email: session.email,
      });
      const merchantContacts = await buildPersonalMerchantContactMap(orders.map((order) => order.siteId));
      return NextResponse.json({ ok: true, orders, merchantContacts });
    }

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
    const body = (await request.json()) as Partial<MerchantOrderCreateInput> & { frontendAuthProof?: unknown };
    const siteId = String(body.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
    }
    if (!(await isOrderManagementEnabled(siteId))) {
      return NextResponse.json({ error: "order_management_disabled" }, { status: 403 });
    }
    const personalSession = await resolvePersonalAccountSessionFromRequest(request).catch(() => null);
    const frontendProof = personalSession ? null : verifyFrontendAuthProof(body.frontendAuthProof);
    const personalProof = frontendProof?.accountType === "personal" ? frontendProof : null;
    const personalProfile = personalSession
      ? readPersonalCustomerProfileFromSession({
          authenticated: true,
          accountType: "personal",
          accountId: personalSession.accountId,
          user: personalSession.user,
        })
      : null;
    const merchantCustomerSession = personalSession
      ? null
      : await resolveMerchantSessionFromRequest(request).catch(() => null);
    const fallbackCustomerEmail = personalProfile?.email || personalProof?.email || merchantCustomerSession?.merchantEmail || "";
    const fallbackCustomerName =
      personalProfile?.name ||
      merchantCustomerSession?.merchantName ||
      (fallbackCustomerEmail.includes("@") ? fallbackCustomerEmail.split("@")[0] ?? "" : "");
    const customer = {
      ...(body.customer ?? {}),
      name: trimText(body.customer?.name) || fallbackCustomerName,
      phone: trimText(body.customer?.phone) || personalProfile?.phone || "",
      email: trimText(body.customer?.email) || fallbackCustomerEmail,
      note: trimText(body.customer?.note),
    };
    const order = await createMerchantOrderRecord({
      siteId,
      siteName: String(body.siteName ?? "").trim(),
      blockId: String(body.blockId ?? "").trim(),
      pricePrefix: String(body.pricePrefix ?? "").trim(),
      customer,
      customerAccountId: personalSession?.accountId ?? personalProof?.accountId ?? merchantCustomerSession?.merchantId ?? "",
      customerUserId: personalSession?.userId ?? personalProof?.userId ?? "",
      customerLoginEmail: personalSession?.email ?? personalProof?.email ?? merchantCustomerSession?.merchantEmail ?? "",
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
      scope?: string;
      siteId?: string;
      orderId?: string;
      action?: MerchantOrderAction;
      items?: MerchantOrderLineItemInput[];
    } | null;
    const siteId = String(body?.siteId ?? "").trim();

    if (String(body?.scope ?? "").trim() === "personal" && body?.action === "cancel") {
      if (!isMerchantNumericId(siteId)) {
        return NextResponse.json({ error: "invalid_site_id" }, { status: 400 });
      }
      const session = await resolvePersonalAccountSessionFromRequest(request);
      if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      const order = await cancelPersonalMerchantOrder({
        siteId,
        orderId: String(body?.orderId ?? "").trim(),
        accountId: session.accountId,
        userId: session.userId,
        email: session.email,
      });
      return NextResponse.json({ ok: true, order });
    }

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
    const items = Array.isArray(body?.items) ? body.items : null;
    const action =
      body?.action === "confirm" ||
      body?.action === "cancel" ||
      body?.action === "restore" ||
      body?.action === "complete" ||
      body?.action === "uncomplete" ||
      body?.action === "print" ||
      body?.action === "touch"
        ? body.action
        : null;
    if (!items && !action) {
      return NextResponse.json({ error: "invalid_order_action" }, { status: 400 });
    }
    const order = await updateMerchantOrderBySite({
      siteId,
      orderId: String(body?.orderId ?? "").trim(),
      action: action ?? undefined,
      items: items ?? undefined,
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
