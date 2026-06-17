import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  normalizeFaollaMerchantSubscription,
  normalizeFaollaSubscriptionInterval,
  normalizeFaollaSubscriptionPlanKey,
  normalizeFaollaSubscriptionStatus,
} from "@/lib/faollaBilling";
import {
  createFaollaStripeClient,
  getFaollaStripeWebhookSecret,
  readFaollaStripePriceId,
  readStripeObjectId,
  stripeTimestampToIso,
} from "@/lib/faollaStripe.server";
import {
  appendStoredFaollaBillingEvent,
  findStoredFaollaMerchantSubscriptionByStripeIds,
  hasProcessedFaollaBillingEvent,
  saveStoredFaollaMerchantSubscription,
} from "@/lib/faollaBillingStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readMetadataValue(metadata: Stripe.Metadata | null | undefined, key: string) {
  return normalizeText(metadata?.[key], 200);
}

function resolvePlanFromPriceId(priceId: string) {
  for (const planKey of ["basic", "advanced", "pro"] as const) {
    for (const billingInterval of ["month", "year"] as const) {
      if (readFaollaStripePriceId(planKey, billingInterval) === priceId) {
        return { planKey, billingInterval };
      }
    }
  }
  return null;
}

function readSubscriptionPriceId(subscription: Stripe.Subscription) {
  const firstItem = subscription.items?.data?.[0] ?? null;
  return normalizeText(firstItem?.price?.id, 220);
}

function readSubscriptionPeriod(subscription: Stripe.Subscription) {
  const record = subscription as unknown as {
    current_period_start?: unknown;
    current_period_end?: unknown;
  };
  return {
    currentPeriodStart: stripeTimestampToIso(record.current_period_start),
    currentPeriodEnd: stripeTimestampToIso(record.current_period_end),
  };
}

async function saveSubscriptionFromStripe(input: {
  stripe: Stripe;
  supabase: NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>;
  merchantId: string;
  checkoutSessionId?: string;
  customerId?: string;
  subscriptionId?: string;
  metadata?: Stripe.Metadata | null;
}) {
  const subscriptionId = normalizeText(input.subscriptionId, 220);
  const checkoutSessionId = normalizeText(input.checkoutSessionId, 220);
  const customerId = normalizeText(input.customerId, 220);
  const existing = await findStoredFaollaMerchantSubscriptionByStripeIds(input.supabase, {
    customerId,
    subscriptionId,
    checkoutSessionId,
  });
  const subscription = subscriptionId
    ? await input.stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] })
    : null;
  const priceId = subscription ? readSubscriptionPriceId(subscription) : existing?.stripePriceId ?? "";
  const pricePlan = resolvePlanFromPriceId(priceId);
  const planKey = normalizeFaollaSubscriptionPlanKey(
    readMetadataValue(subscription?.metadata, "planKey") ||
      readMetadataValue(input.metadata, "planKey") ||
      existing?.planKey ||
      pricePlan?.planKey,
  );
  const billingInterval = normalizeFaollaSubscriptionInterval(
    readMetadataValue(subscription?.metadata, "billingInterval") ||
      readMetadataValue(input.metadata, "billingInterval") ||
      existing?.billingInterval ||
      pricePlan?.billingInterval,
  );
  const period = subscription
    ? readSubscriptionPeriod(subscription)
    : {
        currentPeriodStart: existing?.currentPeriodStart ?? null,
        currentPeriodEnd: existing?.currentPeriodEnd ?? null,
      };
  const now = new Date().toISOString();
  const next = normalizeFaollaMerchantSubscription({
    merchantId: input.merchantId,
    planKey,
    billingInterval,
    status: normalizeFaollaSubscriptionStatus(subscription?.status ?? existing?.status ?? "incomplete"),
    stripeCustomerId: readStripeObjectId(subscription?.customer) || customerId || existing?.stripeCustomerId || "",
    stripeSubscriptionId: (subscription?.id ?? subscriptionId) || existing?.stripeSubscriptionId || "",
    stripeCheckoutSessionId: checkoutSessionId || existing?.stripeCheckoutSessionId || "",
    stripePriceId: priceId,
    currentPeriodStart: period.currentPeriodStart,
    currentPeriodEnd: period.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end ?? existing?.cancelAtPeriodEnd),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (!next) throw new Error("invalid_subscription_payload");
  const saved = await saveStoredFaollaMerchantSubscription(input.supabase, next);
  if (saved.error) throw new Error(saved.error);
  return next;
}

async function handleCheckoutSessionCompleted(
  stripe: Stripe,
  supabase: NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>,
  session: Stripe.Checkout.Session,
) {
  if (session.mode !== "subscription") return "";
  const merchantId = normalizeText(session.metadata?.merchantId, 40) || normalizeText(session.client_reference_id, 40);
  if (!/^\d{8}$/.test(merchantId)) throw new Error("missing_merchant_id");
  const subscription = await saveSubscriptionFromStripe({
    stripe,
    supabase,
    merchantId,
    checkoutSessionId: session.id,
    customerId: readStripeObjectId(session.customer),
    subscriptionId: readStripeObjectId(session.subscription),
    metadata: session.metadata,
  });
  return subscription.merchantId;
}

async function handleSubscriptionChanged(
  stripe: Stripe,
  supabase: NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>,
  subscription: Stripe.Subscription,
) {
  const customerId = readStripeObjectId(subscription.customer);
  const existing = await findStoredFaollaMerchantSubscriptionByStripeIds(supabase, {
    customerId,
    subscriptionId: subscription.id,
  });
  const merchantId = normalizeText(subscription.metadata?.merchantId, 40) || existing?.merchantId || "";
  if (!/^\d{8}$/.test(merchantId)) throw new Error("missing_merchant_id");
  const saved = await saveSubscriptionFromStripe({
    stripe,
    supabase,
    merchantId,
    customerId,
    subscriptionId: subscription.id,
    metadata: subscription.metadata,
  });
  return saved.merchantId;
}

export async function POST(request: Request) {
  const stripe = createFaollaStripeClient();
  const webhookSecret = getFaollaStripeWebhookSecret();
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ ok: false, error: "stripe_not_configured" }, { status: 503 });
  }
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "billing_store_unavailable" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 400 });
  }

  if (await hasProcessedFaollaBillingEvent(supabase, event.id)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let merchantId = "";
  if (event.type === "checkout.session.completed") {
    merchantId = await handleCheckoutSessionCompleted(stripe, supabase, event.data.object as Stripe.Checkout.Session);
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    merchantId = await handleSubscriptionChanged(stripe, supabase, event.data.object as Stripe.Subscription);
  }

  const savedEvent = await appendStoredFaollaBillingEvent(supabase, {
    id: event.id,
    type: event.type,
    merchantId,
    processedAt: new Date().toISOString(),
  });
  if (savedEvent.error) {
    return NextResponse.json({ ok: false, error: "billing_event_save_failed", message: savedEvent.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
