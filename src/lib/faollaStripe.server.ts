import Stripe from "stripe";
import {
  FAOLLA_SUBSCRIPTION_INTERVALS,
  FAOLLA_SUBSCRIPTION_PLAN_KEYS,
  normalizeFaollaSubscriptionInterval,
  normalizeFaollaSubscriptionPlanKey,
  type FaollaSubscriptionInterval,
  type FaollaSubscriptionPlanKey,
} from "@/lib/faollaBilling";

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function normalizeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function getFaollaStripeSecretKey() {
  return readEnv("STRIPE_SECRET_KEY") || readEnv("FAOLLA_STRIPE_SECRET_KEY");
}

export function getFaollaStripeWebhookSecret() {
  return readEnv("STRIPE_WEBHOOK_SECRET") || readEnv("FAOLLA_STRIPE_WEBHOOK_SECRET");
}

export function createFaollaStripeClient() {
  const secretKey = getFaollaStripeSecretKey();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

function buildPriceEnvCandidates(planKey: FaollaSubscriptionPlanKey, interval: FaollaSubscriptionInterval) {
  const upperPlan = planKey.toUpperCase();
  const upperInterval = interval === "year" ? "YEARLY" : "MONTHLY";
  return [
    `STRIPE_FAOLLA_${upperPlan}_${upperInterval}_PRICE_ID`,
    `FAOLLA_STRIPE_${upperPlan}_${upperInterval}_PRICE_ID`,
  ];
}

export function readFaollaStripePriceId(planKeyInput: unknown, intervalInput: unknown) {
  const planKey = normalizeFaollaSubscriptionPlanKey(planKeyInput);
  const interval = normalizeFaollaSubscriptionInterval(intervalInput);
  for (const envName of buildPriceEnvCandidates(planKey, interval)) {
    const value = readEnv(envName);
    if (value) return value;
  }
  return "";
}

export function listMissingFaollaStripePriceEnv() {
  const missing: string[] = [];
  for (const planKey of FAOLLA_SUBSCRIPTION_PLAN_KEYS) {
    for (const interval of FAOLLA_SUBSCRIPTION_INTERVALS) {
      if (!readFaollaStripePriceId(planKey, interval)) {
        missing.push(buildPriceEnvCandidates(planKey, interval)[0]);
      }
    }
  }
  return missing;
}

export function readStripeObjectId(value: unknown) {
  if (typeof value === "string") return normalizeText(value, 220);
  if (value && typeof value === "object" && "id" in value) {
    return normalizeText((value as { id?: unknown }).id, 220);
  }
  return "";
}

export function stripeTimestampToIso(value: unknown) {
  const timestamp = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null;
}
