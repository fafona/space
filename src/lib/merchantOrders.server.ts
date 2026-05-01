import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  applyMerchantOrderAction,
  applyMerchantOrderStatus,
  buildMerchantOrderId,
  createMerchantOrder,
  normalizeMerchantOrderRecords,
  updateMerchantOrderItems,
  type MerchantOrderAction,
  type MerchantOrderCreateInput,
  type MerchantOrderLineItemInput,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";
import {
  listStoredMerchantOrdersByCustomer,
  loadStoredMerchantOrders,
  saveStoredMerchantOrders,
} from "@/lib/merchantOrdersStore";

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

export async function listPersonalMerchantOrders(input: {
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  const supabase = requireOrdersStoreClient();
  return listStoredMerchantOrdersByCustomer(supabase, input);
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

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesPersonalOrderCustomer(
  order: MerchantOrderRecord,
  input: { accountId: string; userId: string; email: string },
) {
  if (input.accountId && trimText(order.customerAccountId) === input.accountId) return true;
  if (input.userId && trimText(order.customerUserId) === input.userId) return true;
  if (!input.email) return false;
  return (
    trimText(order.customerLoginEmail).toLowerCase() === input.email ||
    trimText(order.customer.email).toLowerCase() === input.email
  );
}

export async function cancelPersonalMerchantOrder(input: {
  siteId: string;
  orderId: string;
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  const supabase = requireOrdersStoreClient();
  const siteId = trimText(input.siteId);
  const orderId = trimText(input.orderId);
  const lookup = {
    accountId: trimText(input.accountId),
    userId: trimText(input.userId),
    email: trimText(input.email).toLowerCase(),
  };
  if (!siteId || !orderId || (!lookup.accountId && !lookup.userId && !lookup.email)) {
    throw new Error("order_not_found");
  }
  const stored = await loadStoredMerchantOrders(supabase, siteId);
  const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
  const orderIndex = orders.findIndex((order) => order.id === orderId);
  if (orderIndex < 0) throw new Error("order_not_found");
  const current = orders[orderIndex];
  if (!matchesPersonalOrderCustomer(current, lookup)) throw new Error("order_not_found");
  if (current.status !== "pending" || trimText(current.merchantTouchedAt)) {
    throw new Error("order_customer_action_locked");
  }
  const now = new Date().toISOString();
  const next = {
    ...current,
    status: "cancelled" as const,
    updatedAt: now,
    cancelledAt: now,
  };
  const updatedOrders = [...orders];
  updatedOrders[orderIndex] = next;
  const saved = await saveStoredMerchantOrders(supabase, {
    siteId,
    orders: updatedOrders,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return next;
}

export async function updateMerchantOrderBySite(input: {
  siteId: string;
  orderId: string;
  action?: MerchantOrderAction;
  status?: MerchantOrderStatus;
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
    : input.status
      ? applyMerchantOrderStatus(current, input.status, now)
    : input.action
      ? applyMerchantOrderAction(current, input.action, now)
      : null;
  if (!next) {
    throw new Error("invalid_order_update");
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

export async function updateMerchantOrdersBatchBySite(input: {
  siteId: string;
  orderIds: string[];
  action?: MerchantOrderAction;
  status?: MerchantOrderStatus;
}) {
  const supabase = requireOrdersStoreClient();
  const siteId = trimText(input.siteId);
  const orderIds = [...new Set((Array.isArray(input.orderIds) ? input.orderIds : []).map((item) => trimText(item)).filter(Boolean))];
  if (!siteId || orderIds.length === 0) {
    throw new Error("order_not_found");
  }
  if (!input.action && !input.status) {
    throw new Error("invalid_order_update");
  }
  const stored = await loadStoredMerchantOrders(supabase, siteId);
  const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
  const orderIdSet = new Set(orderIds);
  const now = new Date().toISOString();
  const updatedOrders: MerchantOrderRecord[] = [];
  const nextOrders = orders.map((order) => {
    if (!orderIdSet.has(order.id)) return order;
    const next = input.status
      ? applyMerchantOrderStatus(order, input.status, now)
      : input.action
        ? applyMerchantOrderAction(order, input.action, now)
        : null;
    if (!next) return order;
    updatedOrders.push(next);
    return next;
  });
  if (updatedOrders.length === 0) {
    throw new Error("order_not_found");
  }
  const saved = await saveStoredMerchantOrders(supabase, {
    siteId,
    orders: nextOrders,
    updatedAt: now,
  });
  if (saved.error) {
    throw new Error(saved.error);
  }
  return updatedOrders;
}
