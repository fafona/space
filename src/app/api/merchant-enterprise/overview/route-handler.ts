import { NextResponse } from "next/server";
import {
  filterMerchantEnterpriseSnapshotByBoardAccess,
  hasMerchantEnterprisePermission,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseSnapshot,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  requireMerchantEnterpriseAllBoardAccess,
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
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
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

function getMerchantEnterpriseOverviewReadErrorResponse(error: unknown) {
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

export function getMerchantEnterpriseOverviewMutationErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "enterprise_operation_in_progress" ||
    message === "board_limit_reached" ||
    message === "column_limit_reached"
  ) {
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
  if (
    message === "permission_denied" ||
    message === "merchant_access_denied" ||
    message === "employee_not_found" ||
    message === "employee_account_disabled" ||
    message === "role_not_found" ||
    message === "role_inactive" ||
    message === "merchant_role_invalid"
  ) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  if (message === "board_not_found" || message === "column_not_found") {
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
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
  const scopedSnapshot = filterMerchantEnterpriseSnapshotByBoardAccess(actor, snapshot);
  const canViewTasks = hasMerchantEnterprisePermission(actor, "tasks.view");
  const canAssignTasks = hasMerchantEnterprisePermission(actor, "tasks.assign");
  const canViewEmployees = hasMerchantEnterprisePermission(actor, "employees.view");
  const canViewRoles = hasMerchantEnterprisePermission(actor, "roles.view");
  const canManageRoles = hasMerchantEnterprisePermission(actor, "roles.manage");
  const tasks = canViewTasks ? scopedSnapshot.tasks : [];
  const visibleAssigneeIds = new Set(tasks.flatMap((task) => task.assigneeIds));
  const sanitizeEmployee = (employee: MerchantEnterpriseSnapshot["employees"][number]) => ({
    ...employee,
    authUserId: "",
    email: "",
    roleId: "",
    invitedAt: null,
    acceptedAt: null,
    lastActiveAt: null,
    invitationVersion: 0,
    invitationExpiresAt: null,
    invitationRevokedAt: null,
    invitationSentAt: null,
    invitationDeliveryStatus: "none" as const,
    version: 1,
    createdAt: "",
    updatedAt: "",
  });
  return {
    roles: canViewRoles ? snapshot.roles : [],
    employees: canViewEmployees
      ? snapshot.employees.map((employee) => ({ ...employee, authUserId: "" }))
      : snapshot.employees
          .filter((employee) =>
            canAssignTasks
              ? employee.status === "active" || visibleAssigneeIds.has(employee.id)
              : visibleAssigneeIds.has(employee.id),
          )
          .map(sanitizeEmployee),
    boards: canViewTasks || canManageRoles ? scopedSnapshot.boards : [],
    columns: canViewTasks ? scopedSnapshot.columns : [],
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
    return getMerchantEnterpriseOverviewReadErrorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  try {
    const body = (await request.json().catch(() => null)) as {
      siteId?: unknown;
      operationId?: unknown;
    } | null;
    const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const rawOperationId =
      body?.operationId ?? request.headers.get("idempotency-key") ?? undefined;
    if (
      rawOperationId !== undefined &&
      (typeof rawOperationId !== "string" || !rawOperationId.trim())
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_operation_id" },
        { status: 400 },
      );
    }
    const operationId =
      typeof rawOperationId === "string"
        ? normalizeMutationOperationId(rawOperationId)
        : "";
    if (rawOperationId !== undefined && !operationId) {
      return NextResponse.json(
        { ok: false, error: "invalid_operation_id" },
        { status: 400 },
      );
    }
    const actor = await resolveMerchantEnterpriseActor(request, {
      siteId,
      requiredPermission: "boards.manage",
    });
    if (!hasMerchantEnterprisePermission(actor, "roles.manage")) {
      return NextResponse.json({ ok: false, error: "permission_denied" }, { status: 403 });
    }
    requireMerchantEnterpriseAllBoardAccess(actor);
    await requireMerchantEnterpriseEntitlement(siteId);
    const enterpriseStore = storeClient();
    await bootstrapMerchantEnterpriseWorkspace(enterpriseStore, {
      siteId,
      actorType: actor.type,
      actorId: actor.id,
      operationId,
    });
    const snapshot = await loadMerchantEnterpriseSnapshot(enterpriseStore, siteId);
    return NextResponse.json({
      ok: true,
      actor,
      snapshot: buildVisibleMerchantEnterpriseSnapshot(actor, snapshot),
      needsBootstrap: false,
    });
  } catch (error) {
    return getMerchantEnterpriseOverviewMutationErrorResponse(error);
  }
}
