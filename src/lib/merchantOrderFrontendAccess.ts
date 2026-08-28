import type {
  MerchantBusinessApiClient,
  MerchantBusinessCachePolicy,
} from "@/lib/merchantBusinessApiClient";
import type { MerchantOrderAction, MerchantOrderStatus } from "@/lib/merchantOrders";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export type MerchantOrderFrontendPermissions =
  | readonly MerchantStaffBusinessPermission[]
  | undefined;

export const MERCHANT_ORDER_NO_PERMISSIONS: readonly MerchantStaffBusinessPermission[] =
  Object.freeze([]);

export const MERCHANT_ORDER_OWNER_CACHE_POLICY: MerchantBusinessCachePolicy =
  Object.freeze({
    mode: "default",
    allowPersistentRead: true,
    allowPersistentWrite: true,
    allowStaleOnError: true,
  });

export function hasMerchantOrderFrontendPermission(
  permissions: MerchantOrderFrontendPermissions,
  permission: MerchantStaffBusinessPermission,
) {
  return permissions === undefined || permissions.includes(permission);
}

export function isMerchantOrderEmployeeFrontend(input: {
  apiClient?: MerchantBusinessApiClient;
  cachePolicy?: MerchantBusinessCachePolicy;
  permissions?: MerchantOrderFrontendPermissions;
}) {
  return (
    input.apiClient !== undefined ||
    input.permissions !== undefined ||
    input.cachePolicy?.mode === "disabled"
  );
}

export function canUseMerchantOrderPersistentCache(
  cachePolicy: MerchantBusinessCachePolicy | undefined,
) {
  return (cachePolicy ?? MERCHANT_ORDER_OWNER_CACHE_POLICY).allowPersistentRead;
}

export function canUseMerchantOrderStaleOnError(
  cachePolicy: MerchantBusinessCachePolicy | undefined,
) {
  return (cachePolicy ?? MERCHANT_ORDER_OWNER_CACHE_POLICY).allowStaleOnError;
}

export function getMerchantOrderActionPermission(
  action: MerchantOrderAction,
): MerchantStaffBusinessPermission {
  if (action === "complete" || action === "uncomplete") return "orders.complete";
  if (action === "print") return "orders.print";
  if (action === "touch") return "orders.view";
  return "orders.status.manage";
}

export function canRunMerchantOrderAction(
  permissions: MerchantOrderFrontendPermissions,
  action: MerchantOrderAction,
) {
  return hasMerchantOrderFrontendPermission(
    permissions,
    getMerchantOrderActionPermission(action),
  );
}

export function getMerchantOrderStatusPermission(
  currentStatus: MerchantOrderStatus,
  nextStatus: MerchantOrderStatus,
): MerchantStaffBusinessPermission {
  return currentStatus === "completed" || nextStatus === "completed"
    ? "orders.complete"
    : "orders.status.manage";
}

export function canRunMerchantOrderStatusTransition(
  permissions: MerchantOrderFrontendPermissions,
  currentStatus: MerchantOrderStatus,
  nextStatus: MerchantOrderStatus,
) {
  return hasMerchantOrderFrontendPermission(
    permissions,
    getMerchantOrderStatusPermission(currentStatus, nextStatus),
  );
}

export type MerchantOrderWorkbenchView =
  | "overview"
  | "orders"
  | "analysis"
  | "catalog"
  | "export";

export function canOpenMerchantOrderWorkbenchView(
  permissions: MerchantOrderFrontendPermissions,
  view: MerchantOrderWorkbenchView,
) {
  if (view === "orders") {
    return hasMerchantOrderFrontendPermission(permissions, "orders.view");
  }
  if (view === "overview" || view === "analysis") {
    return hasMerchantOrderFrontendPermission(permissions, "orders.analytics.view");
  }
  if (view === "export") {
    return hasMerchantOrderFrontendPermission(permissions, "orders.export");
  }
  return hasMerchantOrderFrontendPermission(permissions, "orders.catalog.view");
}

export function resolveMerchantOrderWorkbenchView(
  requested: MerchantOrderWorkbenchView,
  permissions: MerchantOrderFrontendPermissions,
): MerchantOrderWorkbenchView | null {
  if (canOpenMerchantOrderWorkbenchView(permissions, requested)) return requested;
  const fallbackOrder: MerchantOrderWorkbenchView[] = [
    "orders",
    "overview",
    "analysis",
    "export",
    "catalog",
  ];
  return (
    fallbackOrder.find((view) =>
      canOpenMerchantOrderWorkbenchView(permissions, view),
    ) ?? null
  );
}

export function createMerchantOrderApiRequest(
  input: {
    apiClient?: MerchantBusinessApiClient;
    employeeMode: boolean;
    ownerFetch: MerchantBusinessApiClient;
  },
): MerchantBusinessApiClient {
  return (path, init) => {
    if (input.apiClient) return input.apiClient(path, init);
    if (input.employeeMode) {
      return Promise.reject(new Error("employee_order_api_client_required"));
    }
    return input.ownerFetch(path, init);
  };
}
