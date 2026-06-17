import { NextResponse } from "next/server";
import {
  normalizeFaollaMerchantSubscription,
  normalizeFaollaSubscriptionInterval,
  normalizeFaollaSubscriptionPlanKey,
} from "@/lib/faollaBilling";
import {
  createFaollaStripeClient,
  readFaollaStripePriceId,
} from "@/lib/faollaStripe.server";
import {
  loadStoredFaollaMerchantSubscription,
  saveStoredFaollaMerchantSubscription,
} from "@/lib/faollaBillingStore";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { resolveTrustedPublicOrigin } from "@/lib/requestOrigin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildReturnUrl(origin: string, path: string, params: Record<string, string>) {
  const url = new URL(path || "/admin", origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const stripe = createFaollaStripeClient();
  if (!stripe) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "billing_store_unavailable" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    planKey?: unknown;
    billingInterval?: unknown;
    successPath?: unknown;
    cancelPath?: unknown;
  } | null;
  const planKey = normalizeFaollaSubscriptionPlanKey(body?.planKey);
  const billingInterval = normalizeFaollaSubscriptionInterval(body?.billingInterval);
  const priceId = readFaollaStripePriceId(planKey, billingInterval);
  if (!priceId) {
    return NextResponse.json({ ok: false, error: "stripe_price_not_configured" }, { status: 503 });
  }

  const session = await resolveMerchantSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const existingSubscription = await loadStoredFaollaMerchantSubscription(supabase, session.merchantId);
  const customerId =
    existingSubscription?.stripeCustomerId ||
    (
      await stripe.customers.create({
        email: session.merchantEmail || undefined,
        name: session.merchantName || undefined,
        metadata: {
          merchantId: session.merchantId,
        },
      })
    ).id;

  const origin = resolveTrustedPublicOrigin(new URL(request.url));
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: session.merchantId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: buildReturnUrl(origin, normalizeText(body?.successPath, 300) || "/admin", {
      billing: "success",
      session_id: "{CHECKOUT_SESSION_ID}",
    }),
    cancel_url: buildReturnUrl(origin, normalizeText(body?.cancelPath, 300) || "/admin", {
      billing: "cancelled",
    }),
    metadata: {
      merchantId: session.merchantId,
      planKey,
      billingInterval,
    },
    subscription_data: {
      metadata: {
        merchantId: session.merchantId,
        planKey,
        billingInterval,
      },
    },
  });

  const now = new Date().toISOString();
  const nextSubscription = normalizeFaollaMerchantSubscription({
    merchantId: session.merchantId,
    planKey,
    billingInterval,
    status: existingSubscription?.status ?? "incomplete",
    stripeCustomerId: customerId,
    stripeSubscriptionId: existingSubscription?.stripeSubscriptionId ?? "",
    stripeCheckoutSessionId: checkoutSession.id,
    stripePriceId: priceId,
    currentPeriodStart: existingSubscription?.currentPeriodStart ?? null,
    currentPeriodEnd: existingSubscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: existingSubscription?.cancelAtPeriodEnd ?? false,
    createdAt: existingSubscription?.createdAt ?? now,
    updatedAt: now,
  });
  if (nextSubscription) {
    const saved = await saveStoredFaollaMerchantSubscription(supabase, nextSubscription);
    if (saved.error) {
      return NextResponse.json({ ok: false, error: "subscription_save_failed", message: saved.error }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    checkoutSessionId: checkoutSession.id,
    url: checkoutSession.url,
  });
}
