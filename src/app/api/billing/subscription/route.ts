import { NextResponse } from "next/server";
import {
  getFaollaPlanEntitlements,
  isFaollaSubscriptionEntitled,
  resolveFaollaSubscriptionPermissionConfig,
} from "@/lib/faollaBilling";
import { loadStoredFaollaMerchantSubscription } from "@/lib/faollaBillingStore";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const session = await resolveMerchantSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "billing_store_unavailable" }, { status: 503 });
  }

  const subscription = await loadStoredFaollaMerchantSubscription(supabase, session.merchantId);
  const entitled = isFaollaSubscriptionEntitled(subscription);
  const planKey = entitled ? subscription?.planKey ?? "basic" : "basic";
  const entitlements = getFaollaPlanEntitlements(planKey);
  return NextResponse.json({
    ok: true,
    merchantId: session.merchantId,
    subscription,
    entitled,
    planKey,
    billingInterval: subscription?.billingInterval ?? "month",
    planPermissionConfig: resolveFaollaSubscriptionPermissionConfig(subscription),
    subscriptionRulesFinalized: entitlements.rulesFinalized,
    paymentFeatures: {
      allowPaymentModule: entitled && entitlements.allowPaymentModule,
      allowMerchantConnectPayments: entitled && entitlements.allowMerchantConnectPayments,
    },
  });
}
