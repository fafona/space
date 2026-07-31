import { NextResponse } from "next/server";
import {
  isMerchantEnterpriseVersion,
  merchantEnterprisePermissionsFitActor,
  parseMerchantEnterprisePermissionsStrict,
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
  status?: unknown;
};

function text(value: unknown, max = 4096) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function client() {
  const value = createServerSupabaseServiceClient();
  if (!value) throw new Error("enterprise_store_unavailable");
  return value as unknown as MerchantEnterpriseStoreClient;
}

function fail(error: unknown) {
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
    if (!name || !permissions) {
      return NextResponse.json({ ok: false, error: "invalid_role" }, { status: 400 });
    }
    const actor = await authorize(request, siteId);
    if (!merchantEnterprisePermissionsFitActor(actor, permissions)) {
      return NextResponse.json({ ok: false, error: "permission_escalation_denied" }, { status: 403 });
    }
    const role = await createMerchantEnterpriseRole(client(), {
      siteId,
      name,
      description: text(body?.description, 1000),
      permissions,
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
    if (body?.permissions !== undefined && !permissions) {
      return NextResponse.json({ ok: false, error: "invalid_permissions" }, { status: 400 });
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
        (permissions && !merchantEnterprisePermissionsFitActor(actor, permissions))
      ) {
        return NextResponse.json(
          { ok: false, error: "permission_escalation_denied" },
          { status: 403 },
        );
      }
    }

    const role = await updateMerchantEnterpriseRole(store, {
      siteId,
      roleId,
      version: body.version,
      ...(body?.name !== undefined ? { name: text(body.name, 80) } : {}),
      ...(body?.description !== undefined ? { description: text(body.description, 1000) } : {}),
      ...(permissions ? { permissions } : {}),
      ...(body?.status === "active" || body?.status === "archived" ? { status: body.status } : {}),
    });
    return NextResponse.json({ ok: true, role });
  } catch (error) {
    return fail(error);
  }
}
