import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  applyMerchantOrderAction,
  applyMerchantOrderStatus,
  applyMerchantOrderUpdate,
  assertMerchantOrderExpectedUpdatedAt,
  buildMerchantOrderId,
  createMerchantOrder,
  normalizeMerchantOrderRecords,
  type MerchantOrderAction,
  type MerchantOrderCreateInput,
  type MerchantOrderLineItemInput,
  type MerchantOrderRecord,
  type MerchantOrderStatus,
} from "@/lib/merchantOrders";
import { syncMerchantMembershipPointsForOrderTransitions } from "@/lib/merchantMemberships.server";
import {
  listStoredMerchantOrdersByCustomer,
  loadStoredMerchantOrder,
  loadStoredMerchantOrders,
  loadStoredMerchantOrdersWindow,
  saveStoredMerchantOrders,
} from "@/lib/merchantOrdersStore";
import { mirrorMerchantOrderTransitions } from "@/lib/merchantOrderDualWrite.server";
import { matchesExactPersonalIdentity } from "@/lib/personalAccountId";
import {
  loadMerchantOrderV1,
  loadMerchantOrdersV1,
  loadMerchantOrdersV1Window,
  readMerchantOrdersWithV1Fallback,
} from "@/lib/merchantOrdersV1Read.server";

const merchantOrderMutationTails = new Map<string, Promise<void>>();

async function withMerchantOrderMutationLock<T>(siteId: string, task: () => Promise<T>) {
  const normalizedSiteId = String(siteId ?? "").trim();
  const previous = merchantOrderMutationTails.get(normalizedSiteId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  merchantOrderMutationTails.set(normalizedSiteId, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (merchantOrderMutationTails.get(normalizedSiteId) === tail) {
      merchantOrderMutationTails.delete(normalizedSiteId);
    }
  }
}

function requireOrdersStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("orders_store_unavailable");
  }
  return supabase;
}

export async function listMerchantOrders(siteId: string) {
  const supabase = requireOrdersStoreClient();
  const stored = await readMerchantOrdersWithV1Fallback({
    siteId,
    loadLegacy: () => loadStoredMerchantOrders(supabase, siteId),
    loadV1: () => loadMerchantOrdersV1(supabase, siteId),
  });
  return stored?.orders ?? [];
}

export async function getMerchantOrderBySite(
  siteId: string,
  orderId: string,
): Promise<MerchantOrderRecord | null> {
  const normalizedSiteId = trimText(siteId);
  const normalizedOrderId = trimText(orderId);
  if (!normalizedSiteId || !normalizedOrderId) return null;
  const supabase = requireOrdersStoreClient();
  const stored = await readMerchantOrdersWithV1Fallback({
    siteId: normalizedSiteId,
    loadLegacy: () =>
      loadStoredMerchantOrder(supabase, normalizedSiteId, normalizedOrderId),
    loadV1: () =>
      loadMerchantOrderV1(supabase, normalizedSiteId, normalizedOrderId),
  });
  return stored?.orders[0] ?? null;
}

export async function listMerchantOrdersWindow(
  siteId: string,
  input: {
    offset?: number;
    limit?: number;
  },
) {
  const supabase = requireOrdersStoreClient();
  return readMerchantOrdersWithV1Fallback({
    siteId,
    loadLegacy: () => loadStoredMerchantOrdersWindow(supabase, siteId, input),
    loadV1: () => loadMerchantOrdersV1Window(supabase, siteId, input),
  });
}

export async function listPersonalMerchantOrders(input: {
  accountId?: string | null;
  userId?: string | null;
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
  return withMerchantOrderMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantOrders(supabase, siteId);
    const existingOrders = normalizeMerchantOrderRecords(stored?.orders ?? []);
    const clientRequestId = trimText(input.clientRequestId);
    if (clientRequestId) {
      const existingRequest = existingOrders.find((order) => order.clientRequestId === clientRequestId);
      if (existingRequest) {
        const hasCanonicalOwner = Boolean(
          trimText(existingRequest.customerAccountId) ||
            trimText(existingRequest.customerUserId),
        );
        const sameOwner = hasCanonicalOwner
          ? matchesExactPersonalIdentity(
              {
                accountId: existingRequest.customerAccountId,
                userId: existingRequest.customerUserId,
              },
              {
                accountId: input.customerAccountId,
                userId: input.customerUserId,
              },
            )
          : Boolean(
              input.customerGuestHash &&
                existingRequest.customerGuestHash ===
                  trimText(input.customerGuestHash),
            );
        if (!sameOwner) throw new Error("order_request_conflict");
        await mirrorMerchantOrderTransitions(supabase, [{ next: existingRequest }]);
        return existingRequest;
      }
    }
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
    const orders = [next, ...existingOrders];
    const saved = await saveStoredMerchantOrders(supabase, {
      siteId: next.siteId,
      orders,
      previousOrders: existingOrders,
      updatedAt: next.updatedAt,
    });
    if (saved.error) {
      throw new Error(saved.error);
    }
    await mirrorMerchantOrderTransitions(supabase, [{ next }]);
    return next;
  });
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesPersonalOrderCustomer(
  order: MerchantOrderRecord,
  input: { accountId: string; userId: string },
) {
  return matchesExactPersonalIdentity(
    {
      accountId: order.customerAccountId,
      userId: order.customerUserId,
    },
    input,
  );
}

export async function cancelPersonalMerchantOrder(input: {
  siteId: string;
  orderId: string;
  accountId?: string | null;
  userId?: string | null;
}) {
  const supabase = requireOrdersStoreClient();
  const siteId = trimText(input.siteId);
  const orderId = trimText(input.orderId);
  const lookup = {
    accountId: trimText(input.accountId),
    userId: trimText(input.userId),
  };
  if (!siteId || !orderId || (!lookup.accountId && !lookup.userId)) {
    throw new Error("order_not_found");
  }
  return withMerchantOrderMutationLock(siteId, async () => {
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
      previousOrders: orders,
      updatedAt: now,
    });
    if (saved.error) throw new Error(saved.error);
    await mirrorMerchantOrderTransitions(supabase, [{ previous: current, next }]);
    return next;
  });
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
  if (!guestHash || (!accountId && !userId)) return [];

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
    await withMerchantOrderMutationLock(siteId, async () => {
      const stored = await loadStoredMerchantOrders(supabase, siteId);
      const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
      let changed = false;
      const nextOrders = orders.map((order) => {
        if (!orderIds.has(order.id)) return order;
        if (trimText(order.customerGuestHash) !== guestHash) return order;
        const hasCanonicalOwner = Boolean(
          trimText(order.customerAccountId) || trimText(order.customerUserId),
        );
        if (
          hasCanonicalOwner &&
          !matchesExactPersonalIdentity(
            {
              accountId: order.customerAccountId,
              userId: order.customerUserId,
            },
            { accountId, userId },
          )
        ) {
          return order;
        }
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
          previousOrders: orders,
          updatedAt: new Date().toISOString(),
        });
        if (saved.error) throw new Error(saved.error);
        await mirrorMerchantOrderTransitions(
          supabase,
          nextOrders
            .filter((order) => orderIds.has(order.id) && trimText(order.customerGuestHash) === guestHash)
            .map((next) => ({
              previous: orders.find((order) => order.id === next.id) ?? null,
              next,
            })),
        );
      }
    });
  }
  return attached;
}

export async function updateMerchantOrderBySite(input: {
  siteId: string;
  orderId: string;
  action?: MerchantOrderAction;
  status?: MerchantOrderStatus;
  items?: MerchantOrderLineItemInput[];
  expectedUpdatedAt?: unknown;
}) {
  const supabase = requireOrdersStoreClient();
  const siteId = trimText(input.siteId);
  return withMerchantOrderMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantOrders(supabase, siteId);
    const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
    const orderIndex = orders.findIndex((order) => order.id === input.orderId);
    if (orderIndex < 0) {
      throw new Error("order_not_found");
    }
    const current = orders[orderIndex];
    if (Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt")) {
      assertMerchantOrderExpectedUpdatedAt(current, input.expectedUpdatedAt);
    }
    if (Array.isArray(input.items) && (current.status === "completed" || current.status === "cancelled")) {
      throw new Error("order_items_locked");
    }
    const now = new Date().toISOString();
    const next = applyMerchantOrderUpdate(current, input, now);
    await syncMerchantMembershipPointsForOrderTransitions([{ previous: current, next }]);
    const updatedOrders = [...orders];
    updatedOrders[orderIndex] = next;
    const saved = await saveStoredMerchantOrders(supabase, {
      siteId,
      orders: updatedOrders,
      previousOrders: orders,
      updatedAt: now,
    });
    if (saved.error) {
      await syncMerchantMembershipPointsForOrderTransitions([{ previous: next, next: current }]).catch(() => null);
      throw new Error(saved.error);
    }
    await mirrorMerchantOrderTransitions(supabase, [{ previous: current, next }]);
    return next;
  });
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
  return withMerchantOrderMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantOrders(supabase, siteId);
    const orders = normalizeMerchantOrderRecords(stored?.orders ?? []);
    const orderIdSet = new Set(orderIds);
    const now = new Date().toISOString();
    const updatedOrders: MerchantOrderRecord[] = [];
    const transitions: Array<{ previous: MerchantOrderRecord; next: MerchantOrderRecord }> = [];
    const nextOrders = orders.map((order) => {
      if (!orderIdSet.has(order.id)) return order;
      const next = input.status
        ? applyMerchantOrderStatus(order, input.status, now)
        : input.action
          ? applyMerchantOrderAction(order, input.action, now)
          : null;
      if (!next) return order;
      updatedOrders.push(next);
      transitions.push({ previous: order, next });
      return next;
    });
    if (updatedOrders.length === 0) {
      throw new Error("order_not_found");
    }
    await syncMerchantMembershipPointsForOrderTransitions(transitions);
    const saved = await saveStoredMerchantOrders(supabase, {
      siteId,
      orders: nextOrders,
      previousOrders: orders,
      updatedAt: now,
    });
    if (saved.error) {
      await syncMerchantMembershipPointsForOrderTransitions(
        transitions.map(({ previous, next }) => ({ previous: next, next: previous })),
      ).catch(() => null);
      throw new Error(saved.error);
    }
    await mirrorMerchantOrderTransitions(supabase, transitions);
    return updatedOrders;
  });
}
