import { NextResponse } from "next/server";
import {
  hasMerchantEnterprisePermission,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseSnapshot,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  bootstrapMerchantEnterpriseWorkspace,
  loadMerchantEnterpriseSnapshot,
  merchantEnterpriseWorkspaceNeedsBootstrap,
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

function storeClient() {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("enterprise_store_unavailable");
  return client as unknown as MerchantEnterpriseStoreClient;
}

function errorResponse(error: unknown) {
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

function siteIdFromRequest(request: Request) {
  return new URL(request.url).searchParams.get("siteId")?.trim() ?? "";
}

export function buildVisibleMerchantEnterpriseSnapshot(
  actor: MerchantEnterpriseActor,
  snapshot: MerchantEnterpriseSnapshot,
) {
  const canViewTasks = hasMerchantEnterprisePermission(actor, "tasks.view");
  const canViewEmployees = hasMerchantEnterprisePermission(actor, "employees.view");
  const canViewRoles = hasMerchantEnterprisePermission(actor, "roles.view");
  const tasks = canViewTasks ? snapshot.tasks : [];
  const visibleAssigneeIds = new Set(tasks.flatMap((task) => task.assigneeIds));
  return {
    roles: canViewRoles ? snapshot.roles : [],
    employees: canViewEmployees
      ? snapshot.employees
      : snapshot.employees
          .filter((employee) => visibleAssigneeIds.has(employee.id))
          .map((employee) => ({
            ...employee,
            authUserId: "",
            email: "",
            roleId: "",
            invitedAt: null,
            acceptedAt: null,
            lastActiveAt: null,
            version: 1,
            createdAt: "",
            updatedAt: "",
          })),
    boards: canViewTasks ? snapshot.boards : [],
    columns: canViewTasks ? snapshot.columns : [],
    tasks,
  } satisfies MerchantEnterpriseSnapshot;
}

export async function GET(request: Request) {
  try {
    const siteId = siteIdFromRequest(request);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "enterprise.view",
    });
    await requireMerchantEnterpriseEntitlement(siteId);
    const enterpriseStore = storeClient();
    const [snapshot, needsBootstrap] = await Promise.all([
      loadMerchantEnterpriseSnapshot(enterpriseStore, siteId),
      merchantEnterpriseWorkspaceNeedsBootstrap(enterpriseStore, siteId),
    ]);
    const visibleSnapshot = buildVisibleMerchantEnterpriseSnapshot(actor, snapshot);
    return NextResponse.json({
      ok: true,
      actor,
      snapshot: visibleSnapshot,
      needsBootstrap,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as { siteId?: unknown } | null;
    const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "boards.manage",
    });
    if (!hasMerchantEnterprisePermission(actor, "roles.manage")) {
      return NextResponse.json({ ok: false, error: "permission_denied" }, { status: 403 });
    }
    await requireMerchantEnterpriseEntitlement(siteId);
    await bootstrapMerchantEnterpriseWorkspace(storeClient(), siteId);
    return NextResponse.json({ ok: true, actor });
  } catch (error) {
    return errorResponse(error);
  }
}
