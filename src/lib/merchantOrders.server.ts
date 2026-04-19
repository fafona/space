import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  buildMerchantOrderId,
  createMerchantOrder,
  normalizeMerchantOrderRecords,
  type MerchantOrderCreateInput,
  type MerchantOrderRecord,
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
  action: "confirm" | "cancel" | "print" | "touch";
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
  const next: MerchantOrderRecord =
    input.action === "confirm"
      ? {
          ...current,
          status: "confirmed",
          updatedAt: now,
          merchantTouchedAt: now,
          confirmedAt: current.confirmedAt ?? now,
          cancelledAt: null,
        }
      : input.action === "cancel"
        ? {
            ...current,
            status: "cancelled",
            updatedAt: now,
            merchantTouchedAt: now,
            cancelledAt: now,
          }
        : input.action === "print"
          ? {
              ...current,
              updatedAt: now,
              merchantTouchedAt: now,
              printedAt: now,
              printCount: current.printCount + 1,
            }
          : {
              ...current,
              merchantTouchedAt: now,
            };
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
