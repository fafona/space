import {
  getMissingMerchantEnterprisePermissionDependencies,
  hasMerchantEnterpriseBoardAccess,
  hasMerchantEnterprisePermission,
  normalizeMerchantEnterpriseBoardIds,
  normalizeMerchantEnterpriseEmployee,
  normalizeMerchantEnterpriseRole,
  type MerchantEnterpriseActor,
  type MerchantEnterprisePermission,
} from "@/lib/merchantEnterprise";
import { readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  loadOrdinaryAccountAuthorization,
  type OrdinaryAccountAuthorizationStoreClient,
} from "@/lib/ordinaryAccountAuthorization.server";
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

export function readMerchantEnterpriseRequestAccessTokens(request: Request) {
  const headerName = "x-merchant-access-token";
  if (request.headers.has(headerName)) {
    const explicitAccessToken = request.headers.get(headerName)?.trim() ?? "";
    return explicitAccessToken ? [explicitAccessToken] : [];
  }
  return readMerchantRequestAccessTokens(request);
}

export async function hasAuthoritativeMerchantEnterpriseOwnership(
  service: OrdinaryAccountAuthorizationStoreClient,
  authUserId: string,
  siteId: string,
) {
  let authorization: Awaited<
    ReturnType<typeof loadOrdinaryAccountAuthorization>
  >;
  try {
    authorization = await loadOrdinaryAccountAuthorization(service, authUserId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    // Staff identities are never ordinary owners. They may continue through
    // the explicit employee membership and role checks below.
    if (code === "ordinary_account_staff_identity_forbidden") return false;
    if (code === "ordinary_account_auth_user_not_found") {
      throw new MerchantEnterpriseAccessError("unauthorized", 401);
    }
    if (
      code === "ordinary_account_merchant_binding_conflict" ||
      code === "ordinary_account_personal_binding_conflict" ||
      code === "ordinary_account_principal_type_conflict" ||
      code === "ordinary_account_system_site_forbidden" ||
      code === "invalid_ordinary_personal_id"
    ) {
      throw new MerchantEnterpriseAccessError("merchant_access_denied", 403);
    }
    throw new MerchantEnterpriseAccessError("enterprise_auth_unavailable", 503);
  }

  if (
    authorization.status === "resolved" &&
    authorization.accountType === "merchant"
  ) {
    return authorization.merchantIds.includes(siteId);
  }
  // Only an authoritative staff result can enter the employee path. Personal,
  // disabled, and unbound ordinary principals fail closed here.
  throw new MerchantEnterpriseAccessError("merchant_access_denied", 403);
}

export async function resolveValidatedMerchantEnterpriseAuthUser(request: Request) {
  const tokens = readMerchantEnterpriseRequestAccessTokens(request);
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

  const entitledSite = await requireMerchantEnterpriseEntitlement(siteId);

  const service = createServerSupabaseServiceClient();
  if (!service) throw new MerchantEnterpriseAccessError("enterprise_store_unavailable", 503);

  if (
    await hasAuthoritativeMerchantEnterpriseOwnership(service, authUserId, siteId)
  ) {
    return {
      type: "owner",
      id: authUserId,
      siteId,
      displayName:
        normalizeText(entitledSite.merchantName, 120) || email || "商户负责人",
      email,
      permissions: [],
      accessScope: "all",
      allowedBoardIds: [],
    };
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
    .select("id,merchant_id,name,description,permissions,access_scope,status,is_system,version,created_at,updated_at")
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
  if (getMissingMerchantEnterprisePermissionDependencies(role.permissions).length > 0) {
    throw new MerchantEnterpriseAccessError("merchant_role_invalid", 403);
  }
  let allowedBoardIds: string[] = [];
  if (role.accessScope === "restricted") {
    const accessResult = await service
      .from("merchant_enterprise_role_boards")
      .select("board_id")
      .eq("merchant_id", siteId)
      .eq("role_id", role.id)
      .order("board_id", { ascending: true });
    if (accessResult.error) {
      const code = normalizeText(accessResult.error.code, 40);
      if (code === "42P01" || code === "PGRST205") {
        throw new MerchantEnterpriseAccessError("enterprise_schema_unavailable", 503);
      }
      throw new MerchantEnterpriseAccessError("merchant_role_check_failed", 503);
    }
    allowedBoardIds = normalizeMerchantEnterpriseBoardIds(
      (Array.isArray(accessResult.data) ? accessResult.data : []).map(
        (row: { board_id?: unknown }) => row.board_id,
      ),
    );
  }

  const actor: MerchantEnterpriseActor = {
    type: "employee",
    id: employee.id,
    siteId,
    displayName: employee.displayName,
    email: employee.email,
    roleId: role.id,
    permissions: role.permissions,
    accessScope: role.accessScope,
    allowedBoardIds,
  };
  if (
    input.requiredPermission &&
    !hasMerchantEnterprisePermission(actor, input.requiredPermission)
  ) {
    throw new MerchantEnterpriseAccessError("permission_denied", 403);
  }
  return actor;
}

export function requireMerchantEnterpriseBoardAccess(
  actor: MerchantEnterpriseActor,
  boardId: string,
  notFoundCode = "resource_not_found",
) {
  if (!hasMerchantEnterpriseBoardAccess(actor, boardId)) {
    throw new MerchantEnterpriseAccessError(notFoundCode, 404);
  }
}

export function requireMerchantEnterpriseAllBoardAccess(
  actor: MerchantEnterpriseActor,
) {
  if (actor.type === "employee" && actor.accessScope !== "all") {
    throw new MerchantEnterpriseAccessError("permission_denied", 403);
  }
}

const MERCHANT_ENTERPRISE_CONFLICT_ERRORS = new Set([
  "enterprise_version_conflict",
  "enterprise_invitation_remove_conflict",
  "employee_invitation_in_use",
  "employee_invitation_not_pending",
  "employee_email_in_use",
  "employee_board_access_in_use",
  "role_board_access_in_use",
  "task_assignee_board_access_denied",
  "system_role_protected",
  "role_in_use",
]);

const MERCHANT_ENTERPRISE_NOT_FOUND_ERRORS = new Set([
  "employee_not_found",
  "role_not_found",
]);

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
      : MERCHANT_ENTERPRISE_NOT_FOUND_ERRORS.has(message)
        ? 404
      : MERCHANT_ENTERPRISE_CONFLICT_ERRORS.has(message)
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
          : status === 400 || status === 404 || status === 409
            ? message
            : "enterprise_request_failed",
    },
  };
}
