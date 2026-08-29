import {
  getMissingMerchantEnterprisePermissionDependencies,
  isMerchantEnterpriseCollaborationPermission,
  type MerchantEnterpriseCollaborationPermission,
  type MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import {
  isMerchantStaffBusinessPermission,
  type MerchantStaffBusinessPermission,
} from "@/lib/merchantStaffBusiness";
import {
  normalizeMerchantBookingRuleOptions,
  normalizeMerchantBookingRulesSnapshot,
  type MerchantBookingRulesSnapshot,
} from "@/lib/merchantBookingRules";

export const MERCHANT_EMPLOYEE_BUSINESS_MENUS = [
  { id: "redemptions", label: "积分兑换", rootPermission: "redemptions.view" },
  { id: "bookings", label: "预约管理", rootPermission: "bookings.view" },
  { id: "orders", label: "订单管理", rootPermission: "orders.view" },
  { id: "conversations", label: "会话", rootPermission: "conversations.view" },
  { id: "members", label: "会员管理", rootPermission: "members.view" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  rootPermission: MerchantStaffBusinessPermission;
}>;

export type MerchantEmployeeBusinessMenuId =
  (typeof MERCHANT_EMPLOYEE_BUSINESS_MENUS)[number]["id"];

export type MerchantEmployeeWorkspaceRoot =
  | "collaboration"
  | MerchantEmployeeBusinessMenuId;

export type MerchantBusinessCapabilities = Readonly<{
  schemaVersion: 1;
  actor: Readonly<{
    type: "employee";
    displayName: string;
    principalKey: `employee:${string}`;
    authorizationVersion: string;
  }>;
  cacheNamespace: string;
  collaborationPermissions: readonly MerchantEnterpriseCollaborationPermission[];
  permissions: readonly MerchantStaffBusinessPermission[];
  workspace: Readonly<{
    siteId: string;
    siteName: string;
    siteCountryCode: string;
    booking?: Readonly<{
      storeOptions: readonly string[];
      itemOptions: readonly string[];
      titleOptions: readonly string[];
      bookingRulesSnapshot: MerchantBookingRulesSnapshot | null;
      allowBookingEmailPrefill: boolean;
      allowCustomerAutoEmail: boolean;
    }>;
  }>;
}>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown, maxLength: number) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  return value.length <= maxLength ? value : "";
}

function parseUniquePermissions<T extends string>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T,
) {
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!predicate(candidate) || seen.has(candidate)) return null;
    seen.add(candidate);
    parsed.push(candidate);
  }
  return parsed;
}

function parseExactBookingOptions(value: unknown) {
  if (!Array.isArray(value)) return null;
  const normalized = normalizeMerchantBookingRuleOptions(value);
  if (
    normalized.length !== value.length ||
    normalized.some((item, index) => item !== value[index])
  ) {
    return null;
  }
  return normalized;
}

export function parseMerchantBusinessCapabilitiesPayload(
  value: unknown,
): MerchantBusinessCapabilities | null {
  const payload = object(value);
  const actor = object(payload?.actor);
  const workspace = object(payload?.workspace);
  if (
    payload?.ok !== true ||
    payload.schemaVersion !== 1 ||
    !actor ||
    !workspace
  ) {
    return null;
  }
  const displayName = string(actor.displayName, 120);
  const principalKey = string(actor.principalKey, 200);
  const authorizationVersion = string(actor.authorizationVersion, 80);
  const cacheNamespace = string(payload.cacheNamespace, 16_384);
  if (
    actor.type !== "employee" ||
    !displayName ||
    !principalKey.startsWith("employee:") ||
    principalKey.length <= "employee:".length ||
    !/^\d+:\d+$/.test(authorizationVersion) ||
    !cacheNamespace
  ) {
    return null;
  }
  const collaborationPermissions = parseUniquePermissions(
    payload.collaborationPermissions,
    isMerchantEnterpriseCollaborationPermission,
  );
  const permissions = parseUniquePermissions(
    payload.permissions,
    isMerchantStaffBusinessPermission,
  );
  if (!collaborationPermissions || !permissions) return null;
  const combined = [
    ...collaborationPermissions,
    ...permissions,
  ] satisfies MerchantEnterprisePermission[];
  if (getMissingMerchantEnterprisePermissionDependencies(combined).length > 0) {
    return null;
  }
  const siteId = string(workspace.siteId, 8);
  const siteName = string(workspace.siteName, 120);
  const siteCountryCode = string(workspace.siteCountryCode, 8);
  if (!/^\d{8}$/.test(siteId) || !siteName) return null;
  const canViewBookings = permissions.includes("bookings.view");
  const rawBooking = object(workspace.booking);
  let booking: MerchantBusinessCapabilities["workspace"]["booking"];
  if (canViewBookings) {
    if (!rawBooking) return null;
    const storeOptions = parseExactBookingOptions(rawBooking.storeOptions);
    const itemOptions = parseExactBookingOptions(rawBooking.itemOptions);
    const titleOptions = parseExactBookingOptions(rawBooking.titleOptions);
    const bookingRulesSnapshot =
      rawBooking.bookingRulesSnapshot === null
        ? null
        : normalizeMerchantBookingRulesSnapshot(
            rawBooking.bookingRulesSnapshot,
          );
    if (
      !storeOptions ||
      !itemOptions ||
      !titleOptions ||
      (rawBooking.bookingRulesSnapshot !== null && !bookingRulesSnapshot) ||
      (bookingRulesSnapshot && bookingRulesSnapshot.siteId !== siteId) ||
      typeof rawBooking.allowBookingEmailPrefill !== "boolean" ||
      typeof rawBooking.allowCustomerAutoEmail !== "boolean"
    ) {
      return null;
    }
    booking = {
      storeOptions,
      itemOptions,
      titleOptions,
      bookingRulesSnapshot,
      allowBookingEmailPrefill: rawBooking.allowBookingEmailPrefill,
      allowCustomerAutoEmail: rawBooking.allowCustomerAutoEmail,
    };
  } else if (rawBooking) {
    return null;
  }
  return {
    schemaVersion: 1,
    actor: {
      type: "employee",
      displayName,
      principalKey: principalKey as `employee:${string}`,
      authorizationVersion,
    },
    cacheNamespace,
    collaborationPermissions,
    permissions,
    workspace: {
      siteId,
      siteName,
      siteCountryCode,
      ...(booking ? { booking } : {}),
    },
  };
}

export function getMerchantEmployeeBusinessMenuIds(
  permissions: readonly MerchantStaffBusinessPermission[],
) {
  const selected = new Set(permissions);
  return MERCHANT_EMPLOYEE_BUSINESS_MENUS.filter((menu) =>
    selected.has(menu.rootPermission),
  ).map((menu) => menu.id);
}

export function getMerchantEmployeeWorkspaceRoots(
  collaborationPermissions: readonly MerchantEnterpriseCollaborationPermission[],
  permissions: readonly MerchantStaffBusinessPermission[],
): MerchantEmployeeWorkspaceRoot[] {
  return [
    ...(collaborationPermissions.includes("enterprise.view")
      ? (["collaboration"] as const)
      : []),
    ...getMerchantEmployeeBusinessMenuIds(permissions),
  ];
}

export function resolveMerchantEmployeeWorkspaceRoot(
  currentRoot: MerchantEmployeeWorkspaceRoot | null,
  collaborationPermissions: readonly MerchantEnterpriseCollaborationPermission[],
  permissions: readonly MerchantStaffBusinessPermission[],
) {
  const availableRoots = getMerchantEmployeeWorkspaceRoots(
    collaborationPermissions,
    permissions,
  );
  return currentRoot && availableRoots.includes(currentRoot)
    ? currentRoot
    : availableRoots[0] ?? null;
}

export function buildMerchantBusinessCapabilitiesMountKey(
  capabilities: MerchantBusinessCapabilities,
) {
  return JSON.stringify([
    capabilities.workspace.siteId,
    capabilities.actor.principalKey,
    capabilities.actor.authorizationVersion,
    [...capabilities.collaborationPermissions].sort(),
    [...capabilities.permissions].sort(),
  ]);
}
