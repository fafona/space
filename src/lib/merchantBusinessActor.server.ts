import type { MerchantServicePermissionConfig } from "@/data/platformControlStore";
import { isCanonicalPortalRequest } from "@/lib/canonicalPortalRequest";
import {
  getMissingMerchantEnterprisePermissionDependencies,
  isMerchantEnterpriseCollaborationPermission,
  MERCHANT_ENTERPRISE_COLLABORATION_PERMISSIONS,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterpriseRole,
  type MerchantEnterpriseCollaborationPermission,
  type MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import { readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  isMerchantStaffBusinessPermission,
  MERCHANT_STAFF_BUSINESS_PERMISSIONS,
  type MerchantStaffBusinessPermission,
} from "@/lib/merchantStaffBusiness";
import {
  isMerchantStaffBusinessRolloutEnabled,
  resolveMerchantStaffBusinessRolloutConfig,
  type MerchantStaffBusinessRolloutConfig,
} from "@/lib/merchantStaffBusinessRollout.server";
import { isMerchantStaffPrincipal } from "@/lib/merchantStaffPrincipal.server";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
} from "@/lib/superAdminServer";

type MerchantBusinessAuthUser = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

type MerchantBusinessEmployeeAuthorization = {
  employeeId: string;
  employeeVersion: number;
  roleId: string;
  roleVersion: number;
  displayName: string;
  email: string;
  permissions: MerchantEnterprisePermission[];
};

type MerchantBusinessOwnerAuthorization = {
  displayName: string;
  email: string;
  source: "database";
};

type MerchantBusinessSite = {
  id: string;
  permissionConfig?: Partial<MerchantServicePermissionConfig> | null;
};

export type MerchantBusinessActor =
  | {
      type: "owner";
      siteId: string;
      authUserId: string;
      principalKey: `owner:${string}`;
      authorizationVersion: "owner";
      displayName: string;
      email: string;
      authorizationSource: MerchantBusinessOwnerAuthorization["source"];
      collaborationPermissions: readonly MerchantEnterpriseCollaborationPermission[];
      businessPermissions: readonly MerchantStaffBusinessPermission[];
    }
  | {
      type: "employee";
      siteId: string;
      authUserId: string;
      employeeId: string;
      roleId: string;
      employeeVersion: number;
      roleVersion: number;
      principalKey: `employee:${string}`;
      authorizationVersion: string;
      displayName: string;
      email: string;
      collaborationPermissions: MerchantEnterpriseCollaborationPermission[];
      businessPermissions: MerchantStaffBusinessPermission[];
    };

export class MerchantBusinessAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "MerchantBusinessAccessError";
    this.code = code;
    this.status = status;
  }
}

export type MerchantBusinessActorDependencies = {
  resolveAuthUser: (
    request: Request,
  ) => Promise<{ user: MerchantBusinessAuthUser; explicitToken: boolean }>;
  isStaffPrincipal: (user: MerchantBusinessAuthUser) => Promise<boolean>;
  loadEmployeeAuthorization: (
    siteId: string,
    authUserId: string,
  ) => Promise<MerchantBusinessEmployeeAuthorization | null>;
  loadOwnerAuthorization: (
    siteId: string,
    user: MerchantBusinessAuthUser,
  ) => Promise<MerchantBusinessOwnerAuthorization | null>;
  loadSite: (siteId: string) => Promise<MerchantBusinessSite | null>;
  rolloutConfig: MerchantStaffBusinessRolloutConfig;
};

type MerchantBusinessActorContext = {
  actor: MerchantBusinessActor;
  site: MerchantBusinessSite;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function strictOwnerFilter(authUserId: string) {
  const escaped = authUserId.replace(/[^a-fA-F0-9-]/g, "");
  if (!escaped || escaped !== authUserId) return "";
  return [
    `user_id.eq.${escaped}`,
    `auth_user_id.eq.${escaped}`,
    `owner_user_id.eq.${escaped}`,
    `owner_id.eq.${escaped}`,
    `auth_id.eq.${escaped}`,
    `created_by.eq.${escaped}`,
    `created_by_user_id.eq.${escaped}`,
  ].join(",");
}

async function resolveAuthUser(
  request: Request,
): Promise<{ user: MerchantBusinessAuthUser; explicitToken: boolean }> {
  const { candidates, explicitToken } = readMerchantBusinessRequestAccessTokens(request);
  if (candidates.length === 0) {
    throw new MerchantBusinessAccessError("unauthorized", 401);
  }
  const authClient = createServerSupabaseAuthClient();
  if (!authClient) {
    throw new MerchantBusinessAccessError("business_auth_unavailable", 503);
  }
  for (const accessToken of candidates) {
    const result = await authClient.auth.getUser(accessToken).catch(() => null);
    if (result?.data?.user && !result.error) {
      return {
        user: result.data.user as MerchantBusinessAuthUser,
        explicitToken,
      };
    }
  }
  throw new MerchantBusinessAccessError("unauthorized", 401);
}

export function readMerchantBusinessRequestAccessTokens(request: Request) {
  const explicitToken = request.headers.has("x-merchant-access-token");
  const explicitValue = trimText(
    request.headers.get("x-merchant-access-token"),
    16_384,
  );
  const candidates = explicitToken
    ? explicitValue
      ? [explicitValue]
      : []
    : readMerchantRequestAccessTokens(request);
  return { candidates, explicitToken };
}

async function loadEmployeeAuthorization(
  siteId: string,
  authUserId: string,
): Promise<MerchantBusinessEmployeeAuthorization | null> {
  const service = createServerSupabaseServiceClient();
  if (!service) {
    throw new MerchantBusinessAccessError("business_store_unavailable", 503);
  }
  const employeeResult = await service
    .from("merchant_enterprise_employees")
    .select(
      "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at",
    )
    .eq("merchant_id", siteId)
    .eq("auth_user_id", authUserId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (employeeResult.error) {
    throw new MerchantBusinessAccessError("business_membership_check_failed", 503);
  }
  const employee = normalizeMerchantEnterpriseEmployee(employeeResult.data);
  if (!employee || employee.siteId !== siteId || !employee.roleId) return null;

  const roleResult = await service
    .from("merchant_enterprise_roles")
    .select(
      "id,merchant_id,name,description,permissions,access_scope,status,is_system,version,created_at,updated_at",
    )
    .eq("merchant_id", siteId)
    .eq("id", employee.roleId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (roleResult.error) {
    throw new MerchantBusinessAccessError("business_role_check_failed", 503);
  }
  const role = normalizeMerchantEnterpriseRole(roleResult.data);
  if (
    !role ||
    role.siteId !== siteId ||
    getMissingMerchantEnterprisePermissionDependencies(role.permissions).length > 0
  ) {
    return null;
  }
  return {
    employeeId: employee.id,
    employeeVersion: employee.version,
    roleId: role.id,
    roleVersion: role.version,
    displayName: employee.displayName,
    email: employee.email,
    permissions: role.permissions,
  };
}

async function loadOwnerAuthorization(
  siteId: string,
  user: MerchantBusinessAuthUser,
): Promise<MerchantBusinessOwnerAuthorization | null> {
  const authUserId = trimText(user.id, 80);
  const service = createServerSupabaseServiceClient();
  if (!service) {
    throw new MerchantBusinessAccessError("business_store_unavailable", 503);
  }
  const ownerFilter = strictOwnerFilter(authUserId);
  if (ownerFilter) {
    const result = await service
      .from("merchants")
      .select("id,name,email")
      .eq("id", siteId)
      .or(ownerFilter)
      .limit(1)
      .maybeSingle();
    if (result.error) {
      throw new MerchantBusinessAccessError("business_owner_check_failed", 503);
    }
    if (result.data) {
      return {
        displayName:
          trimText(result.data.name, 120) ||
          trimText(user.email, 320).toLowerCase() ||
          "商户负责人",
        email:
          trimText(result.data.email, 320).toLowerCase() ||
          trimText(user.email, 320).toLowerCase(),
        source: "database",
      };
    }
  }

  return null;
}

async function loadSite(siteId: string): Promise<MerchantBusinessSite | null> {
  let sites: Awaited<ReturnType<typeof loadAuthoritativeCurrentMerchantSnapshotSites>>;
  try {
    sites = await loadAuthoritativeCurrentMerchantSnapshotSites();
  } catch {
    throw new MerchantBusinessAccessError("business_entitlement_unavailable", 503);
  }
  return sites.find((site) => site.id === siteId) ?? null;
}

function businessEntitlementEnabled(
  permission: MerchantStaffBusinessPermission,
  config: Partial<MerchantServicePermissionConfig> | null | undefined,
) {
  const moduleName = permission.split(".")[0];
  if (moduleName === "redemptions") {
    return Boolean(
      config?.allowMembershipManagement && config.allowPointsRedemption,
    );
  }
  if (moduleName === "bookings") return config?.allowBookingBlock === true;
  if (moduleName === "orders") {
    return Boolean(config?.allowProductBlock && config.allowOrderManagement);
  }
  if (moduleName === "members") {
    return config?.allowMembershipManagement === true;
  }
  return moduleName === "conversations";
}

function defaultDependencies(): MerchantBusinessActorDependencies {
  const service = createServerSupabaseServiceClient();
  return {
    resolveAuthUser,
    isStaffPrincipal: (user) => isMerchantStaffPrincipal(service, user),
    loadEmployeeAuthorization,
    loadOwnerAuthorization,
    loadSite,
    rolloutConfig: resolveMerchantStaffBusinessRolloutConfig(),
  };
}

async function resolveMerchantBusinessActorContext(
  request: Request,
  input: {
    siteId: string;
  },
  dependencyOverrides: Partial<MerchantBusinessActorDependencies> = {},
): Promise<MerchantBusinessActorContext> {
  if (!isCanonicalPortalRequest(request)) {
    throw new MerchantBusinessAccessError("portal_origin_required", 421);
  }
  const siteId = trimText(input.siteId, 80);
  if (!/^\d{8}$/.test(siteId)) {
    throw new MerchantBusinessAccessError("invalid_site_id", 400);
  }
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const { user, explicitToken } = await dependencies.resolveAuthUser(request);
  const authUserId = trimText(user.id, 80);
  if (!authUserId) throw new MerchantBusinessAccessError("unauthorized", 401);

  let staffPrincipal: boolean;
  try {
    staffPrincipal = await dependencies.isStaffPrincipal(user);
  } catch {
    throw new MerchantBusinessAccessError("business_principal_check_failed", 503);
  }

  if (staffPrincipal && !explicitToken) {
    throw new MerchantBusinessAccessError("unauthorized", 401);
  }

  const site = await dependencies.loadSite(siteId);
  if (!site || site.id !== siteId) {
    throw new MerchantBusinessAccessError("business_access_denied", 403);
  }
  const entitledPermissions = MERCHANT_STAFF_BUSINESS_PERMISSIONS.filter(
    (permission) =>
      businessEntitlementEnabled(permission, site.permissionConfig),
  );

  if (staffPrincipal) {
    if (
      !isMerchantStaffBusinessRolloutEnabled(
        siteId,
        dependencies.rolloutConfig,
      )
    ) {
      throw new MerchantBusinessAccessError("staff_business_access_disabled", 403);
    }
    if (site.permissionConfig?.allowEnterpriseManagement !== true) {
      throw new MerchantBusinessAccessError("staff_business_access_disabled", 403);
    }
    const authorization = await dependencies.loadEmployeeAuthorization(
      siteId,
      authUserId,
    );
    if (!authorization) {
      throw new MerchantBusinessAccessError("business_access_denied", 403);
    }
    const businessPermissions = authorization.permissions.filter(
      (permission): permission is MerchantStaffBusinessPermission =>
        isMerchantStaffBusinessPermission(permission) &&
        entitledPermissions.includes(permission),
    );
    const collaborationPermissions = authorization.permissions.filter(
      isMerchantEnterpriseCollaborationPermission,
    );
    return {
      site,
      actor: {
        type: "employee",
        siteId,
        authUserId,
        employeeId: authorization.employeeId,
        roleId: authorization.roleId,
        employeeVersion: authorization.employeeVersion,
        roleVersion: authorization.roleVersion,
        principalKey: `employee:${authorization.employeeId}`,
        authorizationVersion: `${authorization.employeeVersion}:${authorization.roleVersion}`,
        displayName: authorization.displayName,
        email: authorization.email,
        collaborationPermissions,
        businessPermissions,
      },
    };
  }

  const owner = await dependencies.loadOwnerAuthorization(
    siteId,
    user,
  );
  if (!owner) {
    throw new MerchantBusinessAccessError("business_access_denied", 403);
  }
  return {
    site,
    actor: {
      type: "owner",
      siteId,
      authUserId,
      principalKey: `owner:${authUserId}`,
      authorizationVersion: "owner",
      displayName: owner.displayName,
      email: owner.email,
      authorizationSource: owner.source,
      collaborationPermissions: MERCHANT_ENTERPRISE_COLLABORATION_PERMISSIONS,
      businessPermissions: entitledPermissions,
    },
  };
}

export async function resolveMerchantBusinessActor(
  request: Request,
  input: { siteId: string },
  dependencyOverrides: Partial<MerchantBusinessActorDependencies> = {},
) {
  const context = await resolveMerchantBusinessActorContext(
    request,
    input,
    dependencyOverrides,
  );
  return context.actor;
}

export async function authorizeMerchantBusinessRequest(
  request: Request,
  input: {
    siteId: string;
    requiredPermission: MerchantStaffBusinessPermission;
  },
  dependencyOverrides: Partial<MerchantBusinessActorDependencies> = {},
): Promise<MerchantBusinessActor> {
  if (!isMerchantStaffBusinessPermission(input.requiredPermission)) {
    throw new MerchantBusinessAccessError("invalid_business_permission", 500);
  }
  const context = await resolveMerchantBusinessActorContext(
    request,
    { siteId: input.siteId },
    dependencyOverrides,
  );
  if (
    !businessEntitlementEnabled(
      input.requiredPermission,
      context.site.permissionConfig,
    )
  ) {
    throw new MerchantBusinessAccessError("business_module_disabled", 403);
  }
  if (!context.actor.businessPermissions.includes(input.requiredPermission)) {
    throw new MerchantBusinessAccessError("permission_denied", 403);
  }
  return context.actor;
}

export async function reauthorizeMerchantBusinessMutation(
  request: Request,
  input: {
    actor: MerchantBusinessActor;
    requiredPermissions: readonly MerchantStaffBusinessPermission[];
  },
  dependencyOverrides: Partial<MerchantBusinessActorDependencies> = {},
) {
  const firstPermission = input.requiredPermissions[0];
  if (!firstPermission) {
    throw new MerchantBusinessAccessError("invalid_business_permission", 500);
  }
  const currentActor = await authorizeMerchantBusinessRequest(
    request,
    {
      siteId: input.actor.siteId,
      requiredPermission: firstPermission,
    },
    dependencyOverrides,
  );
  if (
    currentActor.type !== input.actor.type ||
    currentActor.principalKey !== input.actor.principalKey ||
    currentActor.authorizationVersion !== input.actor.authorizationVersion ||
    input.requiredPermissions.some(
      (permission) => !currentActor.businessPermissions.includes(permission),
    )
  ) {
    throw new MerchantBusinessAccessError("permission_denied", 403);
  }
  return currentActor;
}

export function toMerchantBusinessAccessResponse(error: unknown) {
  if (error instanceof MerchantBusinessAccessError) {
    return { status: error.status, body: { ok: false, error: error.code } };
  }
  return {
    status: 503,
    body: { ok: false, error: "business_authorization_failed" },
  };
}
