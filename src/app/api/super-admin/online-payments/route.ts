import { NextResponse } from "next/server";
import {
  getFaollaPlanEntitlements,
  isFaollaSubscriptionEntitled,
} from "@/lib/faollaBilling";
import {
  listStoredFaollaMerchantSubscriptions,
  loadStoredFaollaBillingEvents,
} from "@/lib/faollaBillingStore";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "@/lib/platformMerchantSnapshotStore";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function GET(request: Request) {
  if (!(await isSuperAdminRequestAuthorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "online_payments_store_unavailable" }, { status: 503 });
  }

  const [subscriptions, billingEvents, snapshotPayload] = await Promise.all([
    listStoredFaollaMerchantSubscriptions(supabase),
    loadStoredFaollaBillingEvents(supabase),
    loadStoredPlatformMerchantSnapshot(supabase as unknown as PlatformMerchantSnapshotStoreClient, {
      bypassCache: true,
      includeHistory: false,
    }),
  ]);

  const siteById = new Map((snapshotPayload?.snapshot ?? []).map((site) => [site.id, site] as const));
  const subscriptionRows = subscriptions.map((subscription) => {
    const site = siteById.get(subscription.merchantId) ?? null;
    const entitled = isFaollaSubscriptionEntitled(subscription);
    const entitlements = getFaollaPlanEntitlements(subscription.planKey);
    return {
      merchantId: subscription.merchantId,
      merchantName: normalizeText(site?.merchantName) || normalizeText(site?.name) || "-",
      merchantEmail: normalizeText(site?.contactEmail),
      domainPrefix: normalizeText(site?.domainPrefix),
      planKey: subscription.planKey,
      planLabel: entitlements.label,
      billingInterval: subscription.billingInterval,
      status: subscription.status,
      entitled,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      stripeCheckoutSessionId: subscription.stripeCheckoutSessionId,
      stripePriceId: subscription.stripePriceId,
      updatedAt: subscription.updatedAt,
      rulesFinalized: entitlements.rulesFinalized,
      paymentFeatures: {
        allowPaymentModule: entitled && entitlements.allowPaymentModule,
        allowMerchantConnectPayments: entitled && entitlements.allowMerchantConnectPayments,
      },
    };
  });

  return NextResponse.json({
    ok: true,
    payload: {
      loadedAt: new Date().toISOString(),
      subscriptionRulesFinalized: subscriptionRows.some((row) => row.rulesFinalized),
      subscriptions: subscriptionRows,
      billingEvents: billingEvents.slice(0, 200),
      merchantCollections: subscriptionRows.map((row) => ({
        merchantId: row.merchantId,
        merchantName: row.merchantName,
        merchantEmail: row.merchantEmail,
        domainPrefix: row.domainPrefix,
        connectStatus: row.paymentFeatures.allowMerchantConnectPayments ? "pending_setup" : "not_available",
        splitStatus: "not_configured",
        collectionItems: {
          booking: false,
          order: false,
          membershipRecharge: false,
        },
        updatedAt: row.updatedAt,
      })),
    },
  });
}
