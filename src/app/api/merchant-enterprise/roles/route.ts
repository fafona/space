import { NextResponse } from "next/server";
import {
  getMissingMerchantEnterprisePermissionDependencies,
  isMerchantEnterpriseVersion,
  merchantEnterpriseBoardAccessFitsActor,
  merchantEnterprisePermissionsFitActor,
  merchantEnterpriseRoleFitsActor,
  parseMerchantEnterpriseBoardAccessStrict,
  parseMerchantEnterprisePermissionsStrict,
  type MerchantEnterpriseBoardAccess,
  type MerchantEnterpriseEmployee,
  type MerchantEnterpriseRole,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantEnterpriseRole,
  loadMerchantEnterpriseSnapshot,
  updateMerchantEnterpriseRole,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RoleBody = {
  siteId?: unknown;
  roleId?: unknown;
  version?: unknown;
  name?: unknown;
  description?: unknown;
  permissions?: unknown;
  accessScope?: unknown;
  allowedBoardIds?: unknown;
  status?: unknown;
};

export type MerchantEnterpriseRoleArchiveConflict =
  | "system_role_protected"
  | "role_in_use";

export function getMerchantEnterpriseRoleMutationActor(
  actor: Awaited<ReturnType<typeof resolveMerchantEnterpriseActor>>,
) {
  return {
    actorType: actor.type,
    actorId: actor.id,
  } as const;
}

export function getMerchantEnterpriseRoleMutationErrorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "permission_escalation_denied" || code === "permission_denied") {
    return { status: 403, body: { ok: false, error: code } } as const;
  }
  if (code === "role_board_access_in_use") {
    return { status: 409, body: { ok: false, error: code } } as const;
  }
  if (
    code === "role_name_conflict" ||
    (code.includes("enterprise_role_") && code.includes("23505"))
  ) {
    return {
      status: 409,
      body: { ok: false, error: "role_name_conflict" },
    } as const;
  }
  return null;
}

export function getMerchantEnterpriseRoleArchiveConflict(
  role: Pick<MerchantEnterpriseRole, "id" | "isSystem">,
  employees: readonly Pick<MerchantEnterpriseEmployee, "roleId" | "status">[],
  nextStatus: unknown,
): MerchantEnterpriseRoleArchiveConflict | null {
  if (nextStatus !== "archived") return null;
  if (role.isSystem) return "system_role_protected";
  return employees.some((employee) => employee.roleId === role.id)
    ? "role_in_use"
    : null;
}

export function getMerchantEnterpriseRoleActivationConflict(
  role: Pick<MerchantEnterpriseRole, "id" | "name" | "status">,
  roles: readonly Pick<MerchantEnterpriseRole, "id" | "name" | "status">[],
  nextStatus: unknown,
) {
  if (nextStatus !== "active" || role.status !== "archived") return null;
  const normalizedName = role.name.trim().toLocaleLowerCase();
  return roles.some(
    (candidate) =>
      candidate.id !== role.id &&
      candidate.status === "active" &&
      candidate.name.trim().toLocaleLowerCase() === normalizedName,
  )
    ? ("role_name_conflict" as const)
    : null;
}

function text(value: unknown, max = 4096) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hasOwn(body: RoleBody | null, key: keyof RoleBody) {
  return Boolean(body && Object.prototype.hasOwnProperty.call(body, key));
}

function roleBoardAccess(
  body: RoleBody | null,
  options: { defaultAll: boolean },
): MerchantEnterpriseBoardAccess | undefined {
  const hasScope = hasOwn(body, "accessScope");
  const hasBoardIds = hasOwn(body, "allowedBoardIds");
  if (!hasScope && !hasBoardIds) {
    return options.defaultAll ? { accessScope: "all", allowedBoardIds: [] } : undefined;
  }
  if (!hasScope || !hasBoardIds) throw new Error("invalid_role_board_access");
  const parsed = parseMerchantEnterpriseBoardAccessStrict(
    body?.accessScope,
    body?.allowedBoardIds,
  );
  if (!parsed) throw new Error("invalid_role_board_access");
  return parsed;
}

function client() {
  const value = createServerSupabaseServiceClient();
  if (!value) throw new Error("enterprise_store_unavailable");
  return value as unknown as MerchantEnterpriseStoreClient;
}

function fail(error: unknown) {
  const mutationError = getMerchantEnterpriseRoleMutationErrorResponse(error);
  if (mutationError) {
    return NextResponse.json(mutationError.body, { status: mutationError.status });
  }
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

async function authorize(request: Request, siteId: string) {
  const actor = await resolveMerchantEnterpriseActor(request, {
    siteId,
    requiredPermission: "roles.manage",
  });
  await requireMerchantEnterpriseEntitlement(siteId);
  return actor;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as RoleBody | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const name = text(body?.name, 80);
    const permissions = parseMerchantEnterprisePermissionsStrict(body?.permissions);
    const access = roleBoardAccess(body, { defaultAll: true });
    if (!name || !permissions) {
      return NextResponse.json({ ok: false, error: "invalid_role" }, { status: 400 });
    }
    const missingPermissions =
      getMissingMerchantEnterprisePermissionDependencies(permissions);
    if (missingPermissions.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_permission_dependencies",
          missingPermissions,
        },
        { status: 400 },
      );
    }
    const actor = await authorize(request, siteId);
    if (!merchantEnterprisePermissionsFitActor(actor, permissions)) {
      return NextResponse.json({ ok: false, error: "permission_escalation_denied" }, { status: 403 });
    }
    if (!access || !merchantEnterpriseBoardAccessFitsActor(actor, access)) {
      return NextResponse.json({ ok: false, error: "permission_escalation_denied" }, { status: 403 });
    }
    const role = await createMerchantEnterpriseRole(client(), {
      siteId,
      name,
      description: text(body?.description, 1000),
      permissions,
      accessScope: access.accessScope,
      allowedBoardIds: access.allowedBoardIds,
      ...getMerchantEnterpriseRoleMutationActor(actor),
    });
    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as RoleBody | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    if (!isMerchantEnterpriseVersion(body?.version)) {
      return NextResponse.json({ ok: false, error: "invalid_version" }, { status: 400 });
    }
    if (body?.name !== undefined && !text(body.name, 80)) {
      return NextResponse.json({ ok: false, error: "invalid_role" }, { status: 400 });
    }
    if (
      body?.status !== undefined &&
      body.status !== "active" &&
      body.status !== "archived"
    ) {
      return NextResponse.json({ ok: false, error: "invalid_role_status" }, { status: 400 });
    }
    const permissions =
      body?.permissions === undefined
        ? undefined
        : parseMerchantEnterprisePermissionsStrict(body.permissions);
    const access = roleBoardAccess(body, { defaultAll: false });
    if (body?.permissions !== undefined && !permissions) {
      return NextResponse.json({ ok: false, error: "invalid_permissions" }, { status: 400 });
    }
    if (permissions) {
      const missingPermissions =
        getMissingMerchantEnterprisePermissionDependencies(permissions);
      if (missingPermissions.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "invalid_permission_dependencies",
            missingPermissions,
          },
          { status: 400 },
        );
      }
    }

    const actor = await authorize(request, siteId);
    const store = client();
    const snapshot = await loadMerchantEnterpriseSnapshot(store, siteId);
    const roleId = text(body?.roleId, 80);
    const targetRole = snapshot.roles.find((item) => item.id === roleId);
    if (!targetRole) {
      return NextResponse.json({ ok: false, error: "role_not_found" }, { status: 404 });
    }
    if (actor.type === "employee") {
      const changesOwnRole = snapshot.employees.some(
        (employee) => employee.id === actor.id && employee.roleId === targetRole.id,
      );
      if (
        targetRole.isSystem ||
        changesOwnRole ||
        !merchantEnterprisePermissionsFitActor(actor, targetRole.permissions) ||
        !merchantEnterpriseRoleFitsActor(actor, targetRole) ||
        (permissions && !merchantEnterprisePermissionsFitActor(actor, permissions)) ||
        (access && !merchantEnterpriseBoardAccessFitsActor(actor, access))
      ) {
        return NextResponse.json(
          { ok: false, error: "permission_escalation_denied" },
          { status: 403 },
        );
      }
    }
    const archiveConflict = getMerchantEnterpriseRoleArchiveConflict(
      targetRole,
      snapshot.employees,
      body?.status,
    );
    if (archiveConflict) {
      return NextResponse.json(
        { ok: false, error: archiveConflict },
        { status: 409 },
      );
    }
    const activationConflict = getMerchantEnterpriseRoleActivationConflict(
      targetRole,
      snapshot.roles,
      body?.status,
    );
    if (activationConflict) {
      return NextResponse.json(
        { ok: false, error: activationConflict },
        { status: 409 },
      );
    }

    const role = await updateMerchantEnterpriseRole(store, {
      siteId,
      roleId,
      version: body.version,
      ...(body?.name !== undefined ? { name: text(body.name, 80) } : {}),
      ...(body?.description !== undefined ? { description: text(body.description, 1000) } : {}),
      ...(permissions ? { permissions } : {}),
      ...(access
        ? {
            accessScope: access.accessScope,
            allowedBoardIds: access.allowedBoardIds,
          }
        : {}),
      ...(body?.status === "active" || body?.status === "archived" ? { status: body.status } : {}),
      ...getMerchantEnterpriseRoleMutationActor(actor),
    });
    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return fail(error);
  }
}
