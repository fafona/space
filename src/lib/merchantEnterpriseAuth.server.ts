import {
  hasMerchantEnterprisePermission,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterpriseRole,
  type MerchantEnterpriseActor,
  type MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import { readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "@/lib/publishedMerchantService";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient,
} from "@/lib/superAdminServer";

export class MerchantEnterpriseAccessError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "MerchantEnterpriseAccessError";
    this.code = code;
    this.status = status;
  }
}

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function strictOwnerFilter(authUserId: string) {
  const escaped = authUserId.replace(/[^a-fA-F0-9-]/g, "");
  if (!escaped) return "";
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

export async function resolveValidatedMerchantEnterpriseAuthUser(request: Request) {
  const tokens = readMerchantRequestAccessTokens(request);
  if (tokens.length === 0) throw new MerchantEnterpriseAccessError("unauthorized", 401);
  const authClient = createServerSupabaseAuthClient();
  if (!authClient) throw new MerchantEnterpriseAccessError("enterprise_auth_unavailable", 503);
  for (const accessToken of tokens) {
    const result = await authClient.auth.getUser(accessToken).catch(() => null);
    if (result?.data?.user && !result.error) {
      return result.data.user;
    }
  }
  throw new MerchantEnterpriseAccessError("unauthorized", 401);
}

export async function requireMerchantEnterpriseEntitlement(
  siteId: string,
  loadCurrentSnapshot: typeof loadAuthoritativeCurrentMerchantSnapshotSites =
    loadAuthoritativeCurrentMerchantSnapshotSites,
) {
  const normalizedSiteId = normalizeText(siteId, 80);
  let currentSnapshot: Awaited<ReturnType<typeof loadCurrentSnapshot>>;
  try {
    currentSnapshot = await loadCurrentSnapshot();
  } catch {
    throw new MerchantEnterpriseAccessError(
      "enterprise_entitlement_unavailable",
      503,
    );
  }
  const site = currentSnapshot.find((item) => item.id === normalizedSiteId) ?? null;
  if (!site?.permissionConfig?.allowEnterpriseManagement) {
    throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403);
  }
  return site;
}

export async function resolveMerchantEnterpriseActor(
  request: Request,
  input: {
    siteId: string;
    requiredPermission?: MerchantEnterprisePermission;
  },
): Promise<MerchantEnterpriseActor> {
  const siteId = normalizeText(input.siteId, 80);
  if (!/^\d{8}$/.test(siteId)) {
    throw new MerchantEnterpriseAccessError("invalid_site_id", 400);
  }

  const user = await resolveValidatedMerchantEnterpriseAuthUser(request);
  const authUserId = normalizeText(user.id, 80);
  const email = normalizeText(user.email, 320).toLowerCase();
  if (!authUserId) throw new MerchantEnterpriseAccessError("unauthorized", 401);

  await requireMerchantEnterpriseEntitlement(siteId);

  const service = createServerSupabaseServiceClient();
  if (!service) throw new MerchantEnterpriseAccessError("enterprise_store_unavailable", 503);

  const ownerFilter = strictOwnerFilter(authUserId);
  if (ownerFilter) {
    const ownerResult = await service
      .from("merchants")
      .select("id,name,email")
      .eq("id", siteId)
      .or(ownerFilter)
      .limit(1)
      .maybeSingle();
    if (ownerResult.error) {
      throw new MerchantEnterpriseAccessError("merchant_access_check_failed", 503);
    }
    if (ownerResult.data) {
      return {
        type: "owner",
        id: authUserId,
        siteId,
        displayName: normalizeText(ownerResult.data.name, 120) || email || "商户负责人",
        email,
        permissions: [],
      };
    }
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
    const code = normalizeText(employeeResult.error.code, 40);
    if (code === "42P01" || code === "PGRST205") {
      throw new MerchantEnterpriseAccessError("enterprise_schema_unavailable", 503);
    }
    throw new MerchantEnterpriseAccessError("merchant_access_check_failed", 503);
  }
  const employee = normalizeMerchantEnterpriseEmployee(employeeResult.data);
  if (!employee || employee.siteId !== siteId || !employee.roleId) {
    throw new MerchantEnterpriseAccessError("merchant_access_denied", 403);
  }
  const roleResult = await service
    .from("merchant_enterprise_roles")
    .select("id,merchant_id,name,description,permissions,status,is_system,version,created_at,updated_at")
    .eq("merchant_id", siteId)
    .eq("id", employee.roleId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (roleResult.error) {
    throw new MerchantEnterpriseAccessError("merchant_role_check_failed", 503);
  }
  const role = normalizeMerchantEnterpriseRole(roleResult.data);
  if (!role || role.siteId !== siteId) {
    throw new MerchantEnterpriseAccessError("merchant_access_denied", 403);
  }

  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: employee.id,
    siteId,
    displayName: employee.displayName,
    email: employee.email,
    roleId: role.id,
    permissions: role.permissions,
  };
  if (
    input.requiredPermission &&
    !hasMerchantEnterprisePermission(actor, input.requiredPermission)
  ) {
    throw new MerchantEnterpriseAccessError("permission_denied", 403);
  }
  return actor;
}

export function toMerchantEnterpriseAccessResponse(error: unknown) {
  if (error instanceof MerchantEnterpriseAccessError) {
    return {
      status: error.status,
      body: { ok: false, error: error.code },
    };
  }
  const message = error instanceof Error ? error.message : "unknown_error";
  const status =
    message === "enterprise_schema_unavailable"
      ? 503
      : message === "enterprise_version_conflict"
        ? 409
        : message.startsWith("invalid_")
          ? 400
          : 503;
  return {
    status,
    body: {
      ok: false,
      error:
        message === "enterprise_schema_unavailable"
          ? message
          : status === 409
            ? message
            : status === 400
              ? message
              : "enterprise_request_failed",
    },
  };
}
