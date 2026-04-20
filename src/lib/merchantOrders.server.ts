import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  applyMerchantOrderAction,
  buildMerchantOrderId,
  createMerchantOrder,
  normalizeMerchantOrderRecords,
  updateMerchantOrderItems,
  type MerchantOrderAction,
  type MerchantOrderCreateInput,
  type MerchantOrderLineItemInput,
} from "@/lib/merchantOrders";
import { loadStoredMerchantOrders, saveStoredMerchantOrders } from "@/lib/merchantOrdersStore";

function requireOrdersStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("orders_store_unavailable");
  }
  return supabase;
}

export async function listMerchantOrders(siteId: string) {
  const supabase = requireOrdersStoreClient();
  const stored = await loadStoredMerchantOrders(supabase, siteId);
  return stored?.orders ?? [];
}

export async function createMerchantOrderRecord(input: MerchantOrderCreateInput) {
  const supabase = requireOrdersStoreClient();
  const siteId = String(input.siteId ?? "").trim();
  if (!siteId) {
    throw new Error("invalid_site_id");
  }
  const stored = await loadStoredMerchantOrders(supabase, siteId);
  const existingOrders = normalizeMerchantOrderRecords(stored?.orders ?? []);
  const nowDate = new Date();
  const nextId = buildMerchantOrderId(
    siteId,
    nowDate,
    existingOrders.map((item) => item.id),
  );
  if (!nextId) {
    throw new Error("order_id_generation_failed");
  }
  const next = createMerchantOrder(input, {
    id: nextId,
    createdAt: nowDate,
    updatedAt: nowDate,
    merchantTouchedAt: "",
  });
  if (next.items.length === 0) {
    throw new Error("order_items_required");
  }
  const orders = [next, ...(stored?.orders ?? [])];
  const saved = await saveStoredMerchantOrders(supabase, {
    siteId: next.siteId,
    orders,
    updatedAt: next.updatedAt,
  });
  if (saved.error) {
    throw new Error(saved.error);
  }
  return next;
}

export async function updateMerchantOrderBySite(input: {
  siteId: string;
  orderId: string;
  action?: MerchantOrderAction;
  items?: MerchantOrderLineItemInput[];
}) {
  const supabase = requireOrdersStoreClient();
  const stored = await loadStoredMerchantOrders(supabase, input.siteId);
  const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
  const orderIndex = orders.findIndex((order) => order.id === input.orderId);
  if (orderIndex < 0) {
    throw new Error("order_not_found");
  }
  const current = orders[orderIndex];
  const now = new Date().toISOString();
  const next = Array.isArray(input.items)
    ? updateMerchantOrderItems(current, input.items, now)
    : input.action
      ? applyMerchantOrderAction(current, input.action, now)
      : null;
  if (!next) {
    throw new Error("invalid_order_update");
  }
  if (next.items.length === 0) {
    throw new Error("order_items_required");
  }
  const updatedOrders = [...orders];
  updatedOrders[orderIndex] = next;
  const saved = await saveStoredMerchantOrders(supabase, {
    siteId: input.siteId,
    orders: updatedOrders,
    updatedAt: now,
  });
  if (saved.error) {
    throw new Error(saved.error);
  }
  return next;
}
