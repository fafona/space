import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
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
  const next = createMerchantOrder(input);
  if (!next.siteId) {
    throw new Error("invalid_site_id");
  }
  if (next.items.length === 0) {
    throw new Error("order_items_required");
  }
  const stored = await loadStoredMerchantOrders(supabase, next.siteId);
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
  action: "confirm" | "cancel" | "print";
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
          confirmedAt: current.confirmedAt ?? now,
          cancelledAt: null,
        }
      : input.action === "cancel"
        ? {
            ...current,
            status: "cancelled",
            updatedAt: now,
            cancelledAt: now,
          }
        : {
            ...current,
            updatedAt: now,
            printedAt: now,
            printCount: current.printCount + 1,
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
