import { NextResponse } from "next/server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { isMobileViewportRequest } from "@/lib/deviceViewport";
import { buildMerchantOrderPushNotification } from "@/lib/merchantPushEvents";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { fetchPublishedSiteBlocksFromSupabase } from "@/lib/publishedSiteData";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  createMerchantOrderRecord,
  cancelPersonalMerchantOrder,
  getMerchantOrderBySite,
  listMerchantOrders,
  listMerchantOrdersWindow,
  listPersonalMerchantOrders,
  updateMerchantOrdersBatchBySite,
  updateMerchantOrderBySite,
} from "@/lib/merchantOrders.server";
import { resolvePersonalAccountSessionFromRequest } from "@/lib/personalAccountSession.server";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  reauthorizeMerchantBusinessMutation,
  type MerchantBusinessActor,
} from "@/lib/merchantBusinessActor.server";
import {
  getMerchantOrderMutationRequiredPermissions,
  redactMerchantOrderForBusinessActor,
  redactMerchantOrdersForBusinessActor,
} from "@/lib/merchantBusinessOrderPermissions";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";
import { verifyFrontendAuthProof } from "@/lib/frontendAuthProof.server";
import { buildPersonalMerchantContactMap } from "@/lib/personalMerchantContacts.server";
import { hashPersonalGuestMergeToken } from "@/lib/personalGuestMerge.server";
import type { MerchantPushSubscriptionStoreClient } from "@/lib/merchantPushSubscriptionStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { notifyMerchantPushSubscribers } from "@/lib/webPush";
import {
  getMerchantOrderErrorMessage,
  type MerchantOrderAction,
  type MerchantOrderCreateInput,
  type MerchantOrderLineItemInput,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";
import {
  findMerchantCatalogCollection,
  hasPublishedProductBlockForViewport,
  hasMerchantCatalogCollectionForBlock,
  quoteMerchantCatalogOrder,
  quotePublishedProductOrder,
} from "@/lib/merchantOrderCatalog";
import { loadMerchantCatalog } from "@/lib/merchantCatalogStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_ORDER_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
} as const;

export type MerchantOrdersGetRouteDependencies = {
  resolveAdminSession: (
    request: Request,
    siteId: string,
    requiredPermissions: readonly MerchantStaffBusinessPermission[],
  ) => Promise<{
    merchantId: string;
    actor?: MerchantBusinessActor;
    assertAuthorizationCurrent?: () => Promise<void>;
  } | null>;
  isManagementEnabled: (siteId: string) => Promise<boolean>;
  getOrder: typeof getMerchantOrderBySite;
  listOrders: typeof listMerchantOrders;
  listOrdersWindow: typeof listMerchantOrdersWindow;
  resolvePersonalSession: typeof resolvePersonalAccountSessionFromRequest;
  listPersonalOrders: typeof listPersonalMerchantOrders;
  buildPersonalContacts: typeof buildPersonalMerchantContactMap;
};

export type MerchantOrderPostRouteDependencies = {
  loadSnapshotSite: typeof loadCurrentMerchantSnapshotSiteBySiteId;
  loadOperatingCatalog: typeof loadMerchantCatalog;
  loadPublishedSite: typeof fetchPublishedSiteBlocksFromSupabase;
  resolvePersonalSession: typeof resolvePersonalAccountSessionFromRequest;
  createOrder: typeof createMerchantOrderRecord;
  notifyOrderCreated: (siteId: string, order: MerchantOrderRecord) => Promise<void>;
};

export type MerchantOrderPatchRouteDependencies = {
  resolveAdminSession: MerchantOrdersGetRouteDependencies["resolveAdminSession"];
  isManagementEnabled: (siteId: string) => Promise<boolean>;
  resolvePersonalSession: typeof resolvePersonalAccountSessionFromRequest;
  cancelPersonalOrder: typeof cancelPersonalMerchantOrder;
  updateOrder: typeof updateMerchantOrderBySite;
  updateOrdersBatch: typeof updateMerchantOrdersBatchBySite;
};

async function resolveOrderAdminSession(
  request: Request,
  siteId: string,
  requiredPermissions: readonly MerchantStaffBusinessPermission[],
) {
  const firstPermission = requiredPermissions[0];
  if (!firstPermission) {
    throw new MerchantBusinessAccessError("invalid_business_permission", 500);
  }
  const actor = await authorizeMerchantBusinessRequest(request, {
    siteId,
    requiredPermission: firstPermission,
  });
  if (
    requiredPermissions.some(
      (permission) => !actor.businessPermissions.includes(permission),
    )
  ) {
    throw new MerchantBusinessAccessError("permission_denied", 403);
  }
  return {
    merchantId: actor.siteId,
    actor,
    assertAuthorizationCurrent: async () => {
      await reauthorizeMerchantBusinessMutation(request, {
        actor,
        requiredPermissions,
      });
    },
  };
}

async function isOrderManagementEnabled(siteId: string) {
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(siteId);
  return Boolean(site?.permissionConfig?.allowProductBlock && site?.permissionConfig?.allowOrderManagement);
}

async function notifyOrderCreated(siteId: string, order: MerchantOrderRecord) {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) return;
  const notification = buildMerchantOrderPushNotification({
    siteId,
    order,
  });
  await notifyMerchantPushSubscribers(supabase as unknown as MerchantPushSubscriptionStoreClient, {
    merchantId: siteId,
    ...notification,
  }).catch(() => {
    // Ignore notification delivery failures; the order itself should still succeed.
  });
}

const DEFAULT_GET_DEPENDENCIES: MerchantOrdersGetRouteDependencies = {
  resolveAdminSession: resolveOrderAdminSession,
  isManagementEnabled: isOrderManagementEnabled,
  getOrder: getMerchantOrderBySite,
  listOrders: listMerchantOrders,
  listOrdersWindow: listMerchantOrdersWindow,
  resolvePersonalSession: resolvePersonalAccountSessionFromRequest,
  listPersonalOrders: listPersonalMerchantOrders,
  buildPersonalContacts: buildPersonalMerchantContactMap,
};

const DEFAULT_POST_DEPENDENCIES: MerchantOrderPostRouteDependencies = {
  loadSnapshotSite: loadCurrentMerchantSnapshotSiteBySiteId,
  loadOperatingCatalog: loadMerchantCatalog,
  loadPublishedSite: fetchPublishedSiteBlocksFromSupabase,
  resolvePersonalSession: resolvePersonalAccountSessionFromRequest,
  createOrder: createMerchantOrderRecord,
  notifyOrderCreated,
};

const DEFAULT_PATCH_DEPENDENCIES: MerchantOrderPatchRouteDependencies = {
  resolveAdminSession: resolveOrderAdminSession,
  isManagementEnabled: isOrderManagementEnabled,
  resolvePersonalSession: resolvePersonalAccountSessionFromRequest,
  cancelPersonalOrder: cancelPersonalMerchantOrder,
  updateOrder: updateMerchantOrderBySite,
  updateOrdersBatch: updateMerchantOrdersBatchBySite,
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getOrderApiErrorStatus(error: unknown) {
  const code = error instanceof Error ? error.message : trimText(error);
  if (code === "order_not_found") return 404;
  if (code === "order_management_disabled") return 403;
  if (
    code === "order_request_conflict" ||
    code === "order_update_conflict" ||
    code === "order_customer_action_locked" ||
    code === "order_items_locked" ||
    code === "order_product_catalog_conflict" ||
    code === "order_product_catalog_changed" ||
    code === "order_product_catalog_scope_unavailable" ||
    code === "order_product_unavailable" ||
    code === "order_product_price_invalid" ||
    code === "order_points_reversal_balance_insufficient" ||
    code === "membership_recharge_cancel_balance_insufficient" ||
    code === "merchant_memberships_conflict"
  ) {
    return 409;
  }
  if (
    code === "invalid_site_id" ||
    code === "invalid_order_update" ||
    code === "order_items_required" ||
    code === "order_too_many_items" ||
    code === "order_items_not_editable" ||
    code === "order_item_invalid" ||
    code === "order_quantity_invalid" ||
    code === "order_product_block_not_found" ||
    code === "order_product_not_found"
  ) {
    return 400;
  }
  return 503;
}

function normalizeOrderListOffset(value: unknown) {
  const parsed = Number.parseInt(trimText(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizeOrderListLimit(value: unknown) {
  const parsed = Number.parseInt(trimText(value), 10);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(1000, Math.max(1, parsed));
}

function normalizeOrderAction(value: unknown): MerchantOrderAction | null {
  return value === "confirm" ||
    value === "cancel" ||
    value === "restore" ||
    value === "complete" ||
    value === "uncomplete" ||
    value === "print" ||
    value === "touch"
    ? value
    : null;
}

function normalizeOrderStatus(value: unknown): MerchantOrderStatus | null {
  return value === "pending" || value === "confirmed" || value === "completed" || value === "cancelled"
    ? value
    : null;
}

function getOrderQuoteFingerprint(quote: ReturnType<typeof quoteMerchantCatalogOrder>) {
  return JSON.stringify(quote);
}

function isFreshQuoteCatalogChange(error: unknown) {
  const code = error instanceof Error ? error.message : trimText(error);
  return (
    code === "order_product_block_not_found" ||
    code === "order_product_not_found" ||
    code === "order_product_unavailable" ||
    code === "order_product_price_invalid" ||
    code === "order_product_catalog_conflict"
  );
}

function privateOrderJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_ORDER_RESPONSE_HEADERS,
  });
}

function applyPrivateOrderHeaders(response: Response) {
  Object.entries(PRIVATE_ORDER_RESPONSE_HEADERS).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  return response;
}

export async function handleMerchantOrdersGet(
  request: Request,
  dependencyOverrides: Partial<MerchantOrdersGetRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_GET_DEPENDENCIES, ...dependencyOverrides };
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("scope")?.trim() === "personal") {
      if (request.headers.has("x-merchant-access-token")) {
        return privateOrderJson({ error: "business_scope_required" }, 403);
      }
      const session = await dependencies.resolvePersonalSession(request);
      if (!session) {
        return privateOrderJson({ error: "unauthorized" }, 401);
      }
      const orders = await dependencies.listPersonalOrders({
        accountId: session.accountId,
        userId: session.userId,
        email: session.email,
      });
      const merchantContacts = await dependencies.buildPersonalContacts(orders.map((order) => order.siteId));
      return privateOrderJson({ ok: true, orders, merchantContacts });
    }

    const siteId = readUniqueMerchantBusinessSiteId(request.url);
    if (!siteId) {
      return privateOrderJson({ error: "invalid_site_id" }, 400);
    }
    const session = await dependencies.resolveAdminSession(request, siteId, [
      "orders.view",
    ]);
    if (!session) {
      return privateOrderJson({ error: "unauthorized" }, 401);
    }
    if (!(await dependencies.isManagementEnabled(siteId))) {
      return privateOrderJson({ error: "order_management_disabled" }, 403);
    }
    const orderId = searchParams.get("orderId")?.trim() ?? "";
    if (orderId) {
      const order = await dependencies.getOrder(siteId, orderId);
      if (!order) {
        return privateOrderJson({ error: "order_not_found" }, 404);
      }
      return privateOrderJson({
        ok: true,
        order: session.actor
          ? redactMerchantOrderForBusinessActor(order, session.actor)
          : order,
      });
    }
    if (searchParams.has("offset") || searchParams.has("limit")) {
      const windowedOrders = await dependencies.listOrdersWindow(siteId, {
        offset: normalizeOrderListOffset(searchParams.get("offset")),
        limit: normalizeOrderListLimit(searchParams.get("limit")),
      });
      return privateOrderJson({
        ok: true,
        orders: session.actor
          ? redactMerchantOrdersForBusinessActor(
              windowedOrders?.orders ?? [],
              session.actor,
            )
          : windowedOrders?.orders ?? [],
        offset: windowedOrders?.offset ?? 0,
        limit: windowedOrders?.limit ?? normalizeOrderListLimit(searchParams.get("limit")),
        hasMore: Boolean(windowedOrders?.hasMore),
      });
    }
    const orders = await dependencies.listOrders(siteId);
    return privateOrderJson({
      ok: true,
      orders: session.actor
        ? redactMerchantOrdersForBusinessActor(orders, session.actor)
        : orders,
    });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return privateOrderJson({ error: error.code }, error.status);
    }
    return privateOrderJson(
      {
        error: "order_list_failed",
        message: getMerchantOrderErrorMessage(error),
      },
      503,
    );
  }
}

export async function GET(request: Request) {
  return handleMerchantOrdersGet(request);
}

export async function handleMerchantOrderPost(
  request: Request,
  dependencyOverrides: Partial<MerchantOrderPostRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_POST_DEPENDENCIES, ...dependencyOverrides };
  if (request.headers.has("x-merchant-access-token")) {
    return privateOrderJson({ error: "business_scope_required" }, 403);
  }
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateOrderHeaders(getTrustedMutationRequestErrorResponse());
  }
  try {
    const body = (await request.json()) as Partial<MerchantOrderCreateInput> & {
      frontendAuthProof?: unknown;
      customerGuestToken?: unknown;
      catalogViewport?: unknown;
      catalogRevision?: unknown;
    };
    const siteId = String(body.siteId ?? "").trim();
    if (!isMerchantNumericId(siteId)) {
      return privateOrderJson({ error: "invalid_site_id" }, 400);
    }
    const catalogViewport =
      body.catalogViewport === "mobile" || body.catalogViewport === "desktop"
        ? body.catalogViewport
        : isMobileViewportRequest(request.headers)
          ? "mobile"
          : "desktop";
    const [snapshotSite, operatingCatalog, publishedSite] = await Promise.all([
      dependencies.loadSnapshotSite(siteId),
      dependencies.loadOperatingCatalog(siteId),
      dependencies.loadPublishedSite(siteId, { fresh: true }),
    ]);
    if (!snapshotSite?.permissionConfig?.allowProductBlock || !snapshotSite.permissionConfig.allowOrderManagement) {
      return privateOrderJson({ error: "order_management_disabled" }, 403);
    }
    const blockId = String(body.blockId ?? "").trim();
    if (!publishedSite?.blocks?.length) {
      return privateOrderJson(
        { error: "order_catalog_unavailable", message: getMerchantOrderErrorMessage("order_catalog_unavailable") },
        503,
      );
    }
    const operatingCollection = operatingCatalog
      ? findMerchantCatalogCollection({
          catalog: operatingCatalog,
          blockId,
          viewport: catalogViewport,
        })
      : null;
    const clientQuotedOperatingCatalog =
      body.catalogRevision !== undefined &&
      body.catalogRevision !== null &&
      String(body.catalogRevision).trim() !== "";
    const requestedItems = Array.isArray(body.items) ? body.items : [];
    if (clientQuotedOperatingCatalog && !operatingCollection) {
      // A page that previously rendered from the operating catalog must never
      // fall back to stale published block data after its last binding is
      // removed. Force the client to reload the current catalog state.
      throw new Error("order_product_catalog_changed");
    }
    if (
      operatingCatalog &&
      hasMerchantCatalogCollectionForBlock(operatingCatalog, blockId) &&
      !operatingCollection
    ) {
      throw new Error("order_product_catalog_scope_unavailable");
    }
    let quote;
    if (operatingCatalog && operatingCollection) {
      if (!hasPublishedProductBlockForViewport(publishedSite.blocks, blockId, catalogViewport)) {
        throw new Error("order_product_block_not_found");
      }
      const expectedCatalogRevision = Number(body.catalogRevision);
      if (!Number.isSafeInteger(expectedCatalogRevision) || expectedCatalogRevision !== operatingCatalog.revision) {
        throw new Error("order_product_catalog_changed");
      }
      quote = quoteMerchantCatalogOrder({
        catalog: operatingCatalog,
        blockId,
        items: requestedItems,
        viewport: catalogViewport,
      });
    } else {
      quote = quotePublishedProductOrder({
        blocks: publishedSite.blocks,
        blockId,
        items: requestedItems,
        viewport: catalogViewport,
      });
    }
    const initiallyUsedOperatingCatalog = Boolean(operatingCatalog && operatingCollection);
    const initialQuoteFingerprint = getOrderQuoteFingerprint(quote);
    const personalSession = await dependencies.resolvePersonalSession(request).catch(() => null);
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
    const fallbackCustomerEmail = personalProfile?.email || personalProof?.email || "";
    const fallbackCustomerName =
      personalProfile?.name ||
      (fallbackCustomerEmail.includes("@") ? fallbackCustomerEmail.split("@")[0] ?? "" : "");
    const customer = {
      ...(body.customer ?? {}),
      name: trimText(body.customer?.name) || fallbackCustomerName,
      phone: trimText(body.customer?.phone) || personalProfile?.phone || "",
      email: trimText(body.customer?.email) || fallbackCustomerEmail,
      note: trimText(body.customer?.note),
    };

    // Refresh the catalog immediately before persisting so a price,
    // availability, binding, or published-block change made while customer
    // identity was being resolved cannot silently create an order from the
    // earlier quote. The catalog revision remains the client's concurrency
    // token; legacy quotes are compared field-for-field with the fresh quote.
    const [latestSnapshotSite, latestOperatingCatalog, latestPublishedSite] = await Promise.all([
      dependencies.loadSnapshotSite(siteId),
      dependencies.loadOperatingCatalog(siteId),
      dependencies.loadPublishedSite(siteId, { fresh: true }),
    ]);
    if (
      !latestSnapshotSite?.permissionConfig?.allowProductBlock ||
      !latestSnapshotSite.permissionConfig.allowOrderManagement
    ) {
      throw new Error("order_management_disabled");
    }
    if (!latestPublishedSite?.blocks?.length) {
      throw new Error("order_product_catalog_changed");
    }
    const latestOperatingCollection = latestOperatingCatalog
      ? findMerchantCatalogCollection({
          catalog: latestOperatingCatalog,
          blockId,
          viewport: catalogViewport,
        })
      : null;
    let revalidatedQuote: ReturnType<typeof quoteMerchantCatalogOrder>;
    try {
      if (initiallyUsedOperatingCatalog) {
        if (!latestOperatingCatalog || !latestOperatingCollection) {
          throw new Error("order_product_catalog_changed");
        }
        if (!hasPublishedProductBlockForViewport(latestPublishedSite.blocks, blockId, catalogViewport)) {
          throw new Error("order_product_catalog_changed");
        }
        const expectedCatalogRevision = Number(body.catalogRevision);
        if (
          !Number.isSafeInteger(expectedCatalogRevision) ||
          expectedCatalogRevision !== latestOperatingCatalog.revision
        ) {
          throw new Error("order_product_catalog_changed");
        }
        revalidatedQuote = quoteMerchantCatalogOrder({
          catalog: latestOperatingCatalog,
          blockId,
          items: requestedItems,
          viewport: catalogViewport,
        });
      } else {
        if (
          latestOperatingCatalog &&
          hasMerchantCatalogCollectionForBlock(latestOperatingCatalog, blockId)
        ) {
          throw new Error("order_product_catalog_changed");
        }
        revalidatedQuote = quotePublishedProductOrder({
          blocks: latestPublishedSite.blocks,
          blockId,
          items: requestedItems,
          viewport: catalogViewport,
        });
      }
    } catch (error) {
      if (isFreshQuoteCatalogChange(error)) {
        throw new Error("order_product_catalog_changed");
      }
      throw error;
    }
    if (getOrderQuoteFingerprint(revalidatedQuote) !== initialQuoteFingerprint) {
      throw new Error("order_product_catalog_changed");
    }
    quote = revalidatedQuote;

    const order = await dependencies.createOrder({
      siteId,
      siteName: String(snapshotSite.merchantName ?? snapshotSite.name ?? "").trim(),
      blockId: quote.blockId,
      clientRequestId: String(body.clientRequestId ?? "").trim(),
      pricePrefix: quote.pricePrefix,
      customer,
      customerAccountId: personalSession?.accountId ?? personalProof?.accountId ?? "",
      customerUserId: personalSession?.userId ?? personalProof?.userId ?? "",
      customerLoginEmail: personalSession?.email ?? personalProof?.email ?? "",
      customerGuestHash: personalSession || personalProof ? "" : hashPersonalGuestMergeToken(body.customerGuestToken),
      items: quote.items,
    });

    await dependencies.notifyOrderCreated(siteId, order);

    return privateOrderJson({ ok: true, order });
  } catch (error) {
    return privateOrderJson(
      {
        error: "order_create_failed",
        message: getMerchantOrderErrorMessage(error),
      },
      getOrderApiErrorStatus(error),
    );
  }
}

export async function POST(request: Request) {
  return handleMerchantOrderPost(request);
}

export async function handleMerchantOrderPatch(
  request: Request,
  dependencyOverrides: Partial<MerchantOrderPatchRouteDependencies> = {},
) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return applyPrivateOrderHeaders(getTrustedMutationRequestErrorResponse());
  }
  const dependencies = { ...DEFAULT_PATCH_DEPENDENCIES, ...dependencyOverrides };
  try {
    const body = (await request.json()) as {
      scope?: string;
      siteId?: string;
      orderId?: string;
      orderIds?: string[];
      action?: MerchantOrderAction;
      status?: MerchantOrderStatus;
      items?: MerchantOrderLineItemInput[];
      expectedUpdatedAt?: unknown;
    } | null;
    const siteId = String(body?.siteId ?? "").trim();
    const hasExpectedUpdatedAt = Boolean(
      body && Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt"),
    );

    if (String(body?.scope ?? "").trim() === "personal" && body?.action === "cancel") {
      if (request.headers.has("x-merchant-access-token")) {
        return privateOrderJson({ error: "business_scope_required" }, 403);
      }
      if (!isMerchantNumericId(siteId)) {
        return privateOrderJson({ error: "invalid_site_id" }, 400);
      }
      const session = await dependencies.resolvePersonalSession(request);
      if (!session) return privateOrderJson({ error: "unauthorized" }, 401);
      const order = await dependencies.cancelPersonalOrder({
        siteId,
        orderId: String(body?.orderId ?? "").trim(),
        accountId: session.accountId,
        userId: session.userId,
        email: session.email,
      });
      return privateOrderJson({ ok: true, order });
    }

    if (!isMerchantNumericId(siteId)) {
      return privateOrderJson({ error: "invalid_site_id" }, 400);
    }
    const requiredPermissions = getMerchantOrderMutationRequiredPermissions({
      action: body?.action,
      status: body?.status,
      items: body?.items,
    });
    if (!requiredPermissions) {
      return privateOrderJson(
        { error: "invalid_order_action" },
        400,
      );
    }
    const session = await dependencies.resolveAdminSession(
      request,
      siteId,
      requiredPermissions,
    );
    if (!session) {
      return privateOrderJson({ error: "unauthorized" }, 401);
    }
    if (!(await dependencies.isManagementEnabled(siteId))) {
      return privateOrderJson({ error: "order_management_disabled" }, 403);
    }
    const allowCompletedTransition =
      !session.actor ||
      session.actor.type === "owner" ||
      session.actor.businessPermissions.includes("orders.complete");
    const items = Array.isArray(body?.items) ? body.items : null;
    const action = normalizeOrderAction(body?.action);
    const status = normalizeOrderStatus(body?.status);
    const orderIds = Array.isArray(body?.orderIds) ? body.orderIds.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
    if (orderIds.length > 0) {
      if (items || hasExpectedUpdatedAt || (!status && !action) || action === "print" || action === "touch") {
        return privateOrderJson({ error: "invalid_order_action" }, 400);
      }
      const orders = await dependencies.updateOrdersBatch({
        siteId,
        orderIds,
        action: status ? undefined : action ?? undefined,
        status: status ?? undefined,
        allowCompletedTransition,
        assertAuthorizationCurrent: session.assertAuthorizationCurrent,
      });
      return privateOrderJson({
        ok: true,
        orders: session.actor
          ? redactMerchantOrdersForBusinessActor(orders, session.actor)
          : orders,
      });
    }
    if (!items && !action && !status) {
      return privateOrderJson({ error: "invalid_order_action" }, 400);
    }
    const order = await dependencies.updateOrder({
      siteId,
      orderId: String(body?.orderId ?? "").trim(),
      action: action ?? undefined,
      status: status ?? undefined,
      items: items ?? undefined,
      ...(hasExpectedUpdatedAt ? { expectedUpdatedAt: body?.expectedUpdatedAt } : {}),
      allowCompletedTransition,
      assertAuthorizationCurrent: session.assertAuthorizationCurrent,
    });
    return privateOrderJson({
      ok: true,
      order: session.actor
        ? redactMerchantOrderForBusinessActor(order, session.actor)
        : order,
    });
  } catch (error) {
    if (error instanceof MerchantBusinessAccessError) {
      return privateOrderJson({ error: error.code }, error.status);
    }
    const code = error instanceof Error ? error.message : trimText(error);
    if (code === "permission_denied") {
      return privateOrderJson({ error: code }, 403);
    }
    return privateOrderJson(
      {
        error: code === "order_update_conflict" ? code : "order_update_failed",
        message: getMerchantOrderErrorMessage(error),
      },
      getOrderApiErrorStatus(error),
    );
  }
}

export async function PATCH(request: Request) {
  return handleMerchantOrderPatch(request);
}
