import type {
  MerchantBusinessApiClient,
  MerchantBusinessCachePolicy,
} from "@/lib/merchantBusinessApiClient";
import type { MerchantMemberSettingsView } from "@/lib/merchantMembershipSettings";
import type { MerchantStaffBusinessPermission } from "@/lib/merchantStaffBusiness";

export type MerchantMembershipFrontendPermissions =
  | readonly MerchantStaffBusinessPermission[]
  | undefined;

export const MERCHANT_MEMBERSHIP_NO_PERMISSIONS: readonly MerchantStaffBusinessPermission[] =
  Object.freeze([]);

export const MERCHANT_MEMBERSHIP_OWNER_CACHE_POLICY: MerchantBusinessCachePolicy =
  Object.freeze({
    mode: "default",
    allowPersistentRead: true,
    allowPersistentWrite: true,
    allowStaleOnError: true,
  });

export function hasMerchantMembershipFrontendPermission(
  permissions: MerchantMembershipFrontendPermissions,
  permission: MerchantStaffBusinessPermission,
) {
  return permissions === undefined || permissions.includes(permission);
}

export function isMerchantMembershipEmployeeFrontend(input: {
  apiClient?: MerchantBusinessApiClient;
  cachePolicy?: MerchantBusinessCachePolicy;
  permissions?: MerchantMembershipFrontendPermissions;
}) {
  return (
    input.apiClient !== undefined ||
    input.permissions !== undefined ||
    input.cachePolicy?.mode === "disabled"
  );
}

export function canUseMerchantMembershipPersistentCache(
  cachePolicy: MerchantBusinessCachePolicy | undefined,
) {
  return (cachePolicy ?? MERCHANT_MEMBERSHIP_OWNER_CACHE_POLICY)
    .allowPersistentRead;
}

export function canUseMerchantMembershipStaleOnError(
  cachePolicy: MerchantBusinessCachePolicy | undefined,
) {
  return (cachePolicy ?? MERCHANT_MEMBERSHIP_OWNER_CACHE_POLICY)
    .allowStaleOnError;
}

export function getMerchantMembershipSettingsFrontendScope(
  view: Exclude<MerchantMemberSettingsView, "list">,
) {
  return view === "levels" || view === "pointsRules"
    ? ("members" as const)
    : ("redemptions" as const);
}

export function getMerchantMembershipSettingsFrontendPermission(
  view: Exclude<MerchantMemberSettingsView, "list">,
): MerchantStaffBusinessPermission {
  return getMerchantMembershipSettingsFrontendScope(view) === "members"
    ? "members.settings.manage"
    : "redemptions.catalog.manage";
}

export function canOpenMerchantMembershipSettingsView(
  permissions: MerchantMembershipFrontendPermissions,
  view: Exclude<MerchantMemberSettingsView, "list">,
) {
  return hasMerchantMembershipFrontendPermission(
    permissions,
    getMerchantMembershipSettingsFrontendPermission(view),
  );
}

export function createMerchantMembershipApiRequest(input: {
  apiClient?: MerchantBusinessApiClient;
  employeeMode: boolean;
  ownerFetch: MerchantBusinessApiClient;
}): MerchantBusinessApiClient {
  return (path, init) => {
    if (input.apiClient) return input.apiClient(path, init);
    if (input.employeeMode) {
      return Promise.reject(
        new Error("employee_membership_api_client_required"),
      );
    }
    return input.ownerFetch(path, init);
  };
}
