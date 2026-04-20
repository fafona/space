import { MERCHANT_ORDER_STATUSES, type MerchantOrderStatus } from "@/lib/merchantOrders";

export type MerchantOrderSortMode = "created_desc" | "created_asc";
export type MerchantOrderHistoryVisibility = "none" | "today" | "3d" | "7d";

export type MerchantOrderManagerPreferences = {
  selectedStatuses: MerchantOrderStatus[];
  sortMode: MerchantOrderSortMode;
  historyVisibility: MerchantOrderHistoryVisibility;
};

const STORAGE_KEY_PREFIX = "merchant-space:order-manager-preferences:v1:";

export const MERCHANT_ORDER_SORT_OPTIONS: MerchantOrderSortMode[] = ["created_desc", "created_asc"];
export const MERCHANT_ORDER_HISTORY_OPTIONS: MerchantOrderHistoryVisibility[] = ["none", "today", "3d", "7d"];

export function getDefaultMerchantOrderManagerPreferences(): MerchantOrderManagerPreferences {
  return {
    selectedStatuses: [...MERCHANT_ORDER_STATUSES],
    sortMode: "created_desc",
    historyVisibility: "none",
  };
}

function normalizeSelectedStatuses(value: unknown) {
  if (!Array.isArray(value)) {
    return [...MERCHANT_ORDER_STATUSES];
  }
  return MERCHANT_ORDER_STATUSES.filter((status) => value.includes(status));
}

function normalizeSortMode(value: unknown): MerchantOrderSortMode {
  return value === "created_asc" ? "created_asc" : "created_desc";
}

function normalizeHistoryVisibility(value: unknown): MerchantOrderHistoryVisibility {
  return value === "today" || value === "3d" || value === "7d" || value === "none" ? value : "none";
}

export function normalizeMerchantOrderManagerPreferences(value: unknown): MerchantOrderManagerPreferences {
  const input = value && typeof value === "object" ? (value as Partial<MerchantOrderManagerPreferences>) : {};
  return {
    selectedStatuses: normalizeSelectedStatuses(input.selectedStatuses),
    sortMode: normalizeSortMode(input.sortMode),
    historyVisibility: normalizeHistoryVisibility(input.historyVisibility),
  };
}

function getStorageKey(siteId: string) {
  return `${STORAGE_KEY_PREFIX}${siteId || "global"}`;
}

export function loadMerchantOrderManagerPreferences(siteId: string): MerchantOrderManagerPreferences {
  if (typeof window === "undefined") {
    return getDefaultMerchantOrderManagerPreferences();
  }
  try {
    const raw = window.localStorage.getItem(getStorageKey(siteId));
    if (!raw) return getDefaultMerchantOrderManagerPreferences();
    return normalizeMerchantOrderManagerPreferences(JSON.parse(raw));
  } catch {
    return getDefaultMerchantOrderManagerPreferences();
  }
}

export function saveMerchantOrderManagerPreferences(siteId: string, value: MerchantOrderManagerPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getStorageKey(siteId),
      JSON.stringify(normalizeMerchantOrderManagerPreferences(value)),
    );
  } catch {
    // Ignore storage write failures.
  }
}
