import { createHash } from "node:crypto";

import type { MerchantOrderRecord } from "@/lib/merchantOrders";

export const MERCHANT_ORDER_DUAL_WRITE_MODES = ["off", "shadow"] as const;

export type MerchantOrderDualWriteMode = (typeof MERCHANT_ORDER_DUAL_WRITE_MODES)[number];

export type MerchantOrderDualWriteConfig = {
  mode: MerchantOrderDualWriteMode;
  timeoutMs: number;
};

export type MerchantOrderShadowTransition = {
  previous?: MerchantOrderRecord | null;
  next: MerchantOrderRecord;
};

export type MerchantOrderShadowMutationOptions = {
  eventType?: string;
  actorId?: string;
  idempotencyNamespace?: string;
};

export type MerchantOrderShadowClient = {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type MerchantOrderDualWriteResult = {
  status: "disabled" | "skipped" | "written" | "failed" | "timeout";
  count: number;
  error?: string;
};

type MerchantOrderShadowLogger = (event: {
  event: "merchant_order_shadow_write_failed";
  status: "failed" | "timeout";
  siteIds: string[];
  orderIds: string[];
  count: number;
  error: string;
}) => void;

const DEFAULT_SHADOW_WRITE_TIMEOUT_MS = 2500;
const MIN_SHADOW_WRITE_TIMEOUT_MS = 250;
const MAX_SHADOW_WRITE_TIMEOUT_MS = 10000;

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toMinorUnits(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

function resolveCurrency(pricePrefix: string) {
  const normalized = trimText(pricePrefix).toUpperCase();
  if (normalized.includes("£") || normalized.includes("GBP")) return "GBP";
  if (normalized.includes("$") || normalized.includes("USD")) return "USD";
  if (normalized.includes("CNY") || normalized.includes("RMB") || normalized.includes("¥")) return "CNY";
  return "EUR";
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const text = String(error ?? "").trim();
  return text || "unknown_error";
}

function normalizeTimeoutMs(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SHADOW_WRITE_TIMEOUT_MS;
  return Math.min(MAX_SHADOW_WRITE_TIMEOUT_MS, Math.max(MIN_SHADOW_WRITE_TIMEOUT_MS, parsed));
}

export function resolveMerchantOrderDualWriteConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantOrderDualWriteConfig {
  const requestedMode = trimText(environment.MERCHANT_ORDER_V1_DUAL_WRITE_MODE).toLowerCase();
  return {
    mode: requestedMode === "shadow" ? "shadow" : "off",
    timeoutMs: normalizeTimeoutMs(environment.MERCHANT_ORDER_V1_DUAL_WRITE_TIMEOUT_MS),
  };
}

function getShadowEventType(previous: MerchantOrderRecord | null | undefined, next: MerchantOrderRecord) {
  if (!previous) return "created";
  if (previous.status !== next.status) return "status_changed";
  if (previous.printCount !== next.printCount || previous.printedAt !== next.printedAt) return "printed";
  if (
    previous.customerAccountId !== next.customerAccountId ||
    previous.customerUserId !== next.customerUserId ||
    previous.customerLoginEmail !== next.customerLoginEmail
  ) {
    return "customer_attached";
  }
  if (JSON.stringify(previous.items) !== JSON.stringify(next.items)) return "items_updated";
  return "updated";
}

function buildMutationFingerprint(order: MerchantOrderRecord) {
  return createHash("sha256").update(JSON.stringify(order)).digest("hex").slice(0, 24);
}

export function buildMerchantOrderShadowMutation(
  transition: MerchantOrderShadowTransition,
  options: MerchantOrderShadowMutationOptions = {},
) {
  const { previous, next } = transition;
  const fingerprint = buildMutationFingerprint(next);
  const eventType = trimText(options.eventType) || getShadowEventType(previous, next);
  const actorId = trimText(options.actorId) || "legacy-order-bridge";
  const idempotencyNamespace = trimText(options.idempotencyNamespace) || "legacy-order";
  return {
    order: {
      merchant_id: next.siteId,
      id: next.id,
      site_name: next.siteName,
      block_id: next.blockId,
      client_request_id: trimText(next.clientRequestId) || null,
      status: next.status,
      currency: resolveCurrency(next.pricePrefix),
      price_prefix: next.pricePrefix,
      total_quantity: next.totalQuantity,
      total_amount_minor: toMinorUnits(next.totalAmount),
      customer_snapshot: {
        ...next.customer,
        accountId: trimText(next.customerAccountId),
        userId: trimText(next.customerUserId),
        loginEmail: trimText(next.customerLoginEmail).toLowerCase(),
        guestHash: trimText(next.customerGuestHash),
      },
      source_snapshot: next,
      confirmed_at: next.confirmedAt,
      completed_at: next.completedAt,
      cancelled_at: next.cancelledAt,
      printed_at: next.printedAt,
      print_count: next.printCount,
      merchant_touched_at: trimText(next.merchantTouchedAt) || null,
      created_at: next.createdAt,
      updated_at: next.updatedAt,
    },
    items: next.items.map((item) => ({
      product_id: item.productId,
      code: item.code,
      name: item.name,
      description: item.description,
      image_url: item.imageUrl,
      tag: item.tag,
      quantity: item.quantity,
      unit_amount_minor: toMinorUnits(item.unitPrice),
      subtotal_amount_minor: toMinorUnits(item.subtotal),
      unit_price_text: item.unitPriceText,
      source_snapshot: item,
    })),
    event: {
      event_type: eventType,
      from_status: previous?.status ?? null,
      to_status: next.status,
      actor_id: actorId,
      idempotency_key: `${idempotencyNamespace}:${next.siteId}:${next.id}:${fingerprint}`,
      payload: {
        legacyUpdatedAt: next.updatedAt,
        fingerprint,
      },
      created_at: next.updatedAt,
    },
  };
}

function defaultShadowLogger(event: Parameters<MerchantOrderShadowLogger>[0]) {
  console.error("[merchant-order-dual-write]", JSON.stringify(event));
}

export async function mirrorMerchantOrderTransitions(
  client: MerchantOrderShadowClient,
  transitions: MerchantOrderShadowTransition[],
  options?: {
    config?: MerchantOrderDualWriteConfig;
    logger?: MerchantOrderShadowLogger;
  },
): Promise<MerchantOrderDualWriteResult> {
  const config = options?.config ?? resolveMerchantOrderDualWriteConfig();
  if (config.mode === "off") return { status: "disabled", count: 0 };

  const normalizedTransitions = transitions.filter(
    (transition) => trimText(transition?.next?.siteId) && trimText(transition?.next?.id),
  );
  if (normalizedTransitions.length === 0) return { status: "skipped", count: 0 };

  const mutations = normalizedTransitions.map((transition) =>
    buildMerchantOrderShadowMutation(transition),
  );
  const timeoutToken = Symbol("merchant_order_shadow_timeout");
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const query = Promise.resolve(
      client.rpc("faolla_upsert_merchant_orders_v1", {
        p_mutations: mutations,
      }),
    );
    const result = await Promise.race([
      query,
      new Promise<typeof timeoutToken>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(timeoutToken), config.timeoutMs);
      }),
    ]);

    if (result === timeoutToken) {
      const error = `shadow_write_timeout:${config.timeoutMs}`;
      (options?.logger ?? defaultShadowLogger)({
        event: "merchant_order_shadow_write_failed",
        status: "timeout",
        siteIds: [...new Set(normalizedTransitions.map(({ next }) => next.siteId))],
        orderIds: normalizedTransitions.map(({ next }) => next.id),
        count: normalizedTransitions.length,
        error,
      });
      return { status: "timeout", count: normalizedTransitions.length, error };
    }

    if (result.error) {
      throw result.error;
    }
    return { status: "written", count: normalizedTransitions.length };
  } catch (error) {
    const message = toErrorMessage(error);
    (options?.logger ?? defaultShadowLogger)({
      event: "merchant_order_shadow_write_failed",
      status: "failed",
      siteIds: [...new Set(normalizedTransitions.map(({ next }) => next.siteId))],
      orderIds: normalizedTransitions.map(({ next }) => next.id),
      count: normalizedTransitions.length,
      error: message,
    });
    return { status: "failed", count: normalizedTransitions.length, error: message };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
