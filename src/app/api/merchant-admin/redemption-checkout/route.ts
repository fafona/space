import { NextResponse } from "next/server";
import {
  authorizeMerchantBusinessRequest,
  MerchantBusinessAccessError,
  reauthorizeMerchantBusinessMutation,
} from "@/lib/merchantBusinessActor.server";
import { readUniqueMerchantBusinessSiteId } from "@/lib/merchantBusinessRequest";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { redactMerchantMembershipForCashier } from "@/lib/merchantMembershipBusinessPermissions";
import { retryMerchantMembershipRedemptionCheckout } from "@/lib/merchantMemberships.server";
import { summarizeMerchantRedemptionCheckout } from "@/lib/merchantRedemptionCheckout";
import { readMerchantRedemptionCheckoutError } from "@/lib/merchantRedemptionCheckoutErrors";
import {
  ackMerchantRedemptionCheckout,
  cancelMerchantRedemptionCheckout,
  getMerchantRedemptionCheckout,
} from "@/lib/merchantRedemptionCheckout.server";
import { requireMerchantRedemptionOperationId } from "@/lib/merchantRedemptionTransaction.server";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type MerchantRedemptionCheckoutRouteDependencies = {
  authorizeActor: typeof authorizeMerchantBusinessRequest;
  reauthorizeActor: typeof reauthorizeMerchantBusinessMutation;
  getCheckout: typeof getMerchantRedemptionCheckout;
  cancelCheckout: typeof cancelMerchantRedemptionCheckout;
  ackCheckout: typeof ackMerchantRedemptionCheckout;
  retryCheckout: typeof retryMerchantMembershipRedemptionCheckout;
};

const DEFAULT_DEPENDENCIES: MerchantRedemptionCheckoutRouteDependencies = {
  authorizeActor: authorizeMerchantBusinessRequest,
  reauthorizeActor: reauthorizeMerchantBusinessMutation,
  getCheckout: getMerchantRedemptionCheckout,
  cancelCheckout: cancelMerchantRedemptionCheckout,
  ackCheckout: ackMerchantRedemptionCheckout,
  retryCheckout: retryMerchantMembershipRedemptionCheckout,
};

function applyPrivateHeaders(response: Response) {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function privateJson(body: unknown, init?: ResponseInit) {
  return applyPrivateHeaders(NextResponse.json(body, init));
}

function errorResponse(error: unknown) {
  if (error instanceof MerchantBusinessAccessError) {
    return privateJson({ error: error.code }, { status: error.status });
  }
  // Storage/RPC failures must never expose the saved request, SQL or credentials.
  const { code, status } = readMerchantRedemptionCheckoutError(error);
  return privateJson({ error: code, message: code }, { status });
}

export async function handleMerchantRedemptionCheckoutGet(
  request: Request,
  dependencyOverrides: Partial<MerchantRedemptionCheckoutRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  try {
    const url = new URL(request.url);
    const siteId = readUniqueMerchantBusinessSiteId(url);
    if (!isMerchantNumericId(siteId)) return privateJson({ error: "invalid_site_id" }, { status: 400 });
    const operationIds = url.searchParams.getAll("operationId");
    if (operationIds.length > 1) return privateJson({ error: "mutation_operation_id_invalid" }, { status: 400 });
    const operationId = operationIds.length === 1 ? requireMerchantRedemptionOperationId(operationIds[0]) : undefined;
    const actor = await dependencies.authorizeActor(request, { siteId, requiredPermission: "redemptions.checkout" });
    const checkout = await dependencies.getCheckout(siteId, actor.principalKey, operationId);
    await dependencies.reauthorizeActor(request, { actor, requiredPermissions: ["redemptions.checkout"] });
    return privateJson({ ok: true, checkout: checkout ? summarizeMerchantRedemptionCheckout(checkout) : null });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMerchantRedemptionCheckoutPost(
  request: Request,
  dependencyOverrides: Partial<MerchantRedemptionCheckoutRouteDependencies> = {},
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  if (!isTrustedSameOriginMutationRequest(request)) return applyPrivateHeaders(getTrustedMutationRequestErrorResponse());
  try {
    const body = await request.json().catch(() => null) as { siteId?: unknown; operationId?: unknown; action?: unknown } | null;
    const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) return privateJson({ error: "invalid_site_id" }, { status: 400 });
    const action = body?.action;
    if (action !== "retry" && action !== "cancel" && action !== "ack") {
      return privateJson({ error: "invalid_redemption_checkout_action" }, { status: 400 });
    }
    const operationId = requireMerchantRedemptionOperationId(body?.operationId);
    const actor = await dependencies.authorizeActor(request, { siteId, requiredPermission: "redemptions.checkout" });
    let currentActor = actor;
    const assertAuthorizationCurrent = async () => {
      currentActor = await dependencies.reauthorizeActor(request, { actor, requiredPermissions: ["redemptions.checkout"] });
    };
    await assertAuthorizationCurrent();
    if (action === "retry") {
      // The service restores the immutable original intent. No browser cart,
      // membership or claimed operator is passed through this recovery route.
      const result = await dependencies.retryCheckout({ siteId, operatorId: actor.principalKey, operationId, assertAuthorizationCurrent });
      await assertAuthorizationCurrent();
      const canViewCustomerData = currentActor.type === "owner" || currentActor.businessPermissions.includes("redemptions.customer_data.view");
      const membership = result.membership ? redactMerchantMembershipForCashier({
        ...result.membership, transactions: [], insight: undefined,
      }, canViewCustomerData) : null;
      return privateJson({ ok: true, membership, receipt: result.receipt, replayed: result.replayed });
    }
    const checkout = await (action === "cancel" ? dependencies.cancelCheckout : dependencies.ackCheckout)(siteId, actor.principalKey, operationId);
    await assertAuthorizationCurrent();
    return privateJson({ ok: true, checkout: summarizeMerchantRedemptionCheckout(checkout) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) { return handleMerchantRedemptionCheckoutGet(request); }
export async function POST(request: Request) { return handleMerchantRedemptionCheckoutPost(request); }
