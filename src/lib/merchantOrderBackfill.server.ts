import {
  buildMerchantOrderShadowMutation,
  type MerchantOrderShadowTransition,
} from "@/lib/merchantOrderDualWrite.server";
import type { MerchantOrderRecord } from "@/lib/merchantOrders";

export const MERCHANT_ORDER_BACKFILL_DEFAULT_BATCH_SIZE = 10;
export const MERCHANT_ORDER_BACKFILL_MAX_BATCH_SIZE = 50;

export type MerchantOrderBackfillBlocker = {
  code:
    | "merchant_mismatch"
    | "duplicate_order_id"
    | "duplicate_client_request_id"
    | "invalid_created_at"
    | "invalid_updated_at"
    | "invalid_confirmed_at"
    | "invalid_completed_at"
    | "invalid_cancelled_at"
    | "invalid_printed_at"
    | "invalid_merchant_touched_at";
  orderId: string;
};

export type MerchantOrderBackfillMutation = ReturnType<typeof buildMerchantOrderShadowMutation>;

export type MerchantOrderBackfillPlan = {
  merchantId: string;
  batchSize: number;
  orderCount: number;
  batches: MerchantOrderBackfillMutation[][];
  blockers: MerchantOrderBackfillBlocker[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTimestamp(value: unknown, optional = false) {
  const text = trimText(value);
  if (!text) return optional;
  return Number.isFinite(Date.parse(text));
}

export function normalizeMerchantOrderBackfillBatchSize(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return MERCHANT_ORDER_BACKFILL_DEFAULT_BATCH_SIZE;
  return Math.min(MERCHANT_ORDER_BACKFILL_MAX_BATCH_SIZE, Math.max(1, parsed));
}

function buildBackfillMutation(order: MerchantOrderRecord) {
  const transition: MerchantOrderShadowTransition = { next: order };
  return buildMerchantOrderShadowMutation(transition, {
    eventType: "legacy_backfill",
    actorId: "legacy-order-backfill",
    idempotencyNamespace: "legacy-order-backfill",
  });
}

function compareOrders(left: MerchantOrderRecord, right: MerchantOrderRecord) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

export function buildMerchantOrderBackfillPlan(input: {
  merchantId: string;
  orders: MerchantOrderRecord[];
  batchSize?: unknown;
}): MerchantOrderBackfillPlan {
  const merchantId = trimText(input.merchantId);
  const batchSize = normalizeMerchantOrderBackfillBatchSize(input.batchSize);
  const orders = [...(Array.isArray(input.orders) ? input.orders : [])].sort(compareOrders);
  const blockers: MerchantOrderBackfillBlocker[] = [];
  const orderIds = new Set<string>();
  const clientRequestIds = new Map<string, string>();

  for (const order of orders) {
    const orderId = trimText(order.id);
    if (trimText(order.siteId) !== merchantId) {
      blockers.push({ code: "merchant_mismatch", orderId });
    }
    if (orderIds.has(orderId)) {
      blockers.push({ code: "duplicate_order_id", orderId });
    } else {
      orderIds.add(orderId);
    }

    const clientRequestId = trimText(order.clientRequestId);
    const existingOrderId = clientRequestId ? clientRequestIds.get(clientRequestId) : "";
    if (clientRequestId && existingOrderId && existingOrderId !== orderId) {
      blockers.push({ code: "duplicate_client_request_id", orderId });
    } else if (clientRequestId) {
      clientRequestIds.set(clientRequestId, orderId);
    }

    if (!isValidTimestamp(order.createdAt)) blockers.push({ code: "invalid_created_at", orderId });
    if (!isValidTimestamp(order.updatedAt)) blockers.push({ code: "invalid_updated_at", orderId });
    if (!isValidTimestamp(order.confirmedAt, true)) blockers.push({ code: "invalid_confirmed_at", orderId });
    if (!isValidTimestamp(order.completedAt, true)) blockers.push({ code: "invalid_completed_at", orderId });
    if (!isValidTimestamp(order.cancelledAt, true)) blockers.push({ code: "invalid_cancelled_at", orderId });
    if (!isValidTimestamp(order.printedAt, true)) blockers.push({ code: "invalid_printed_at", orderId });
    if (!isValidTimestamp(order.merchantTouchedAt, true)) {
      blockers.push({ code: "invalid_merchant_touched_at", orderId });
    }
  }

  const mutations = orders.map(buildBackfillMutation);
  const batches: MerchantOrderBackfillMutation[][] = [];
  for (let index = 0; index < mutations.length; index += batchSize) {
    batches.push(mutations.slice(index, index + batchSize));
  }

  return {
    merchantId,
    batchSize,
    orderCount: orders.length,
    batches,
    blockers,
  };
}
