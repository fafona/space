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
import { awardMerchantMembershipPointsForOrder } from "@/lib/merchantMemberships.server";
import {
  listStoredMerchantOrdersByCustomer,
  loadStoredMerchantOrders,
  loadStoredMerchantOrdersWindow,
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

export async function listMerchantOrdersWindow(
  siteId: string,
  input: {
    offset?: number;
    limit?: number;
  },
) {
  const supabase = requireOrdersStoreClient();
  return loadStoredMerchantOrdersWindow(supabase, siteId, input);
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

export async function attachPersonalMerchantOrdersByGuestHash(input: {
  guestHash: string;
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
  records: Array<{ siteId?: string | null; orderId?: string | null }>;
}) {
  const supabase = requireOrdersStoreClient();
  const guestHash = trimText(input.guestHash);
  const accountId = trimText(input.accountId);
  const userId = trimText(input.userId);
  const email = trimText(input.email).toLowerCase();
  if (!guestHash || (!accountId && !userId && !email)) return [];

  const siteMap = new Map<string, Set<string>>();
  for (const record of Array.isArray(input.records) ? input.records : []) {
    const siteId = trimText(record?.siteId);
    const orderId = trimText(record?.orderId);
    if (!siteId || !orderId) continue;
    const orderIds = siteMap.get(siteId) ?? new Set<string>();
    orderIds.add(orderId);
    siteMap.set(siteId, orderIds);
    if (siteMap.size >= 100) break;
  }
  const attached: MerchantOrderRecord[] = [];
  for (const [siteId, orderIds] of siteMap.entries()) {
    const stored = await loadStoredMerchantOrders(supabase, siteId);
    const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
    let changed = false;
    const nextOrders = orders.map((order) => {
      if (!orderIds.has(order.id)) return order;
      if (trimText(order.customerGuestHash) !== guestHash) return order;
      const existingOwner =
        trimText(order.customerAccountId) || trimText(order.customerUserId) || trimText(order.customerLoginEmail).toLowerCase();
      const ownedByCurrent =
        (accountId && trimText(order.customerAccountId) === accountId) ||
        (userId && trimText(order.customerUserId) === userId) ||
        (email && trimText(order.customerLoginEmail).toLowerCase() === email);
      if (existingOwner && !ownedByCurrent) return order;
      const next: MerchantOrderRecord = {
        ...order,
        customerAccountId: accountId || order.customerAccountId,
        customerUserId: userId || order.customerUserId,
        customerLoginEmail: email || order.customerLoginEmail,
      };
      changed = true;
      attached.push(next);
      return next;
    });
    if (changed) {
      const saved = await saveStoredMerchantOrders(supabase, {
        siteId,
        orders: nextOrders,
        updatedAt: new Date().toISOString(),
      });
      if (saved.error) throw new Error(saved.error);
    }
  }
  return attached;
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
  if (next.status === "completed" && current.status !== "completed") {
    await awardMerchantMembershipPointsForOrder(next).catch(() => null);
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
  await Promise.all(
    updatedOrders
      .filter((order) => order.status === "completed")
      .map((order) => awardMerchantMembershipPointsForOrder(order).catch(() => null)),
  );
  return updatedOrders;
}
