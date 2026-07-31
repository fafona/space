import { NextResponse } from "next/server";
import {
  isMerchantEnterpriseVersion,
  merchantEnterprisePermissionsFitActor,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseEmployee,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  bindMerchantEnterpriseEmployeeAuthUser,
  createMerchantEnterpriseEmployee,
  loadMerchantEnterpriseSnapshot,
  updateMerchantEnterpriseEmployee,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  hasImmutableMerchantStaffPrincipal,
  MERCHANT_STAFF_PRINCIPAL_TYPE,
} from "@/lib/merchantStaffPrincipal.server";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import {
  createServerSupabaseServiceClient,
  resolvePublicOrigin,
} from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EmployeeBody = {
  siteId?: unknown;
  action?: unknown;
  employeeId?: unknown;
  version?: unknown;
  email?: unknown;
  displayName?: unknown;
  roleId?: unknown;
  status?: unknown;
};

type ServiceClient = NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>;
type InvitationResult =
  | { status: "sent" }
  | {
      status: "failed";
      error:
        | "employee_email_already_registered"
        | "invite_unavailable"
        | "staff_identity_marker_failed"
        | "staff_identity_cleanup_failed"
        | "staff_identity_binding_failed";
    };

const EMPLOYEE_INVITATION_RESEND_COOLDOWN_MS = 60_000;

function text(value: unknown, max = 4096) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function getEmployeeInvitationRetryAfterSeconds(
  invitedAt: string | null,
  nowMs = Date.now(),
) {
  if (!invitedAt) return 0;
  const invitedAtMs = Date.parse(invitedAt);
  if (!Number.isFinite(invitedAtMs)) return 0;
  const elapsedMs = Math.max(0, nowMs - invitedAtMs);
  const remainingMs = EMPLOYEE_INVITATION_RESEND_COOLDOWN_MS - elapsedMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export async function reserveEmployeeInvitationResend(
  store: MerchantEnterpriseStoreClient,
  employee: MerchantEnterpriseEmployee,
  nowMs = Date.now(),
): Promise<
  | { status: "cooldown"; employee: MerchantEnterpriseEmployee; retryAfterSeconds: number }
  | { status: "reserved"; employee: MerchantEnterpriseEmployee }
> {
  const retryAfterSeconds = getEmployeeInvitationRetryAfterSeconds(
    employee.invitedAt,
    nowMs,
  );
  if (retryAfterSeconds > 0) {
    return { status: "cooldown", employee, retryAfterSeconds };
  }
  const reservedEmployee = await updateMerchantEnterpriseEmployee(store, {
    siteId: employee.siteId,
    employeeId: employee.id,
    version: employee.version,
    invitedAt: new Date(nowMs).toISOString(),
  });
  return { status: "reserved", employee: reservedEmployee };
}

export function createEmployeeInvitationCooldownResponse(
  employee: MerchantEnterpriseEmployee,
  retryAfterSeconds: number,
) {
  return NextResponse.json(
    {
      ok: false,
      error: "employee_invitation_cooldown",
      employee,
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

export function createEmployeeInvitationResendResponse(input: {
  employee: MerchantEnterpriseEmployee;
  invitation: InvitationResult;
}) {
  return NextResponse.json({
    ok: true,
    employee: input.employee,
    invitation: input.invitation,
  });
}

function serviceClient() {
  const value = createServerSupabaseServiceClient();
  if (!value) throw new Error("enterprise_store_unavailable");
  return value;
}

function fail(error: unknown) {
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

async function authorize(request: Request, siteId: string) {
  const actor = await resolveMerchantEnterpriseActor(request, {
    siteId,
    requiredPermission: "employees.manage",
  });
  await requireMerchantEnterpriseEntitlement(siteId);
  return actor;
}

function invitationRedirect(request: Request, siteId: string) {
  const requestUrl = new URL(request.url);
  const redirectOrigin = resolvePublicOrigin(request, requestUrl);
  return `${redirectOrigin}/enterprise/${encodeURIComponent(siteId)}`;
}

async function findAuthUserByEmail(service: ServiceClient, email: string) {
  for (let page = 1; page <= 100; page += 1) {
    const result = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) return { user: null, lookupFailed: true };
    const users = result.data.users ?? [];
    const user =
      users.find((item) => text(item.email, 320).toLowerCase() === email) ?? null;
    if (user) return { user, lookupFailed: false };
    if (users.length < 200) return { user: null, lookupFailed: false };
  }
  return { user: null, lookupFailed: true };
}

async function markAuthUserAsStaff(service: ServiceClient, user: {
  id: string;
  app_metadata?: Record<string, unknown> | null;
}) {
  if (hasImmutableMerchantStaffPrincipal(user)) return true;
  const currentAppMetadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await service.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...currentAppMetadata,
        principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE,
      },
    });
    if (!result.error) return true;
  }
  return false;
}

async function sendExistingStaffAccessEmail(
  service: ServiceClient,
  input: {
    email: string;
    redirectTo: string;
    emailConfirmed: boolean;
  },
) {
  if (input.emailConfirmed) {
    const result = await service.auth.resetPasswordForEmail(input.email, {
      redirectTo: input.redirectTo,
    });
    return !result.error;
  }
  const result = await service.auth.resend({
    type: "signup",
    email: input.email,
    options: { emailRedirectTo: input.redirectTo },
  });
  return !result.error;
}

async function bindEmployeeToStaffUser(
  service: ServiceClient,
  employee: MerchantEnterpriseEmployee,
  authUserId: string,
) {
  try {
    return await bindMerchantEnterpriseEmployeeAuthUser(
      service as unknown as MerchantEnterpriseStoreClient,
      {
        siteId: employee.siteId,
        employeeId: employee.id,
        authUserId,
      },
    );
  } catch {
    return null;
  }
}

async function ensureEmployeeInvitation(
  service: ServiceClient,
  input: {
    employee: MerchantEnterpriseEmployee;
    redirectTo: string;
  },
): Promise<{ employee: MerchantEnterpriseEmployee; invitation: InvitationResult }> {
  let employee = input.employee;

  if (employee.authUserId) {
    const existing = await service.auth.admin.getUserById(employee.authUserId);
    const user = existing.data.user;
    if (existing.error || !user || !(await markAuthUserAsStaff(service, user))) {
      return {
        employee,
        invitation: { status: "failed", error: "staff_identity_marker_failed" },
      };
    }
    const sent = await sendExistingStaffAccessEmail(service, {
      email: employee.email,
      redirectTo: input.redirectTo,
      emailConfirmed: Boolean(user.email_confirmed_at),
    });
    return {
      employee,
      invitation: sent
        ? { status: "sent" }
        : { status: "failed", error: "invite_unavailable" },
    };
  }

  const invite = await service.auth.admin.inviteUserByEmail(employee.email, {
    redirectTo: input.redirectTo,
    data: { principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE },
  });
  let authUser = invite.data.user;
  let invitationAlreadySent = !invite.error && Boolean(authUser?.id);
  if (invite.error || !authUser?.id) {
    const existing = await findAuthUserByEmail(service, employee.email);
    if (existing.lookupFailed || !existing.user) {
      return {
        employee,
        invitation: { status: "failed", error: "invite_unavailable" },
      };
    }
    if (!hasImmutableMerchantStaffPrincipal(existing.user)) {
      return {
        employee,
        invitation: {
          status: "failed",
          error: "employee_email_already_registered",
        },
      };
    }
    authUser = existing.user;
    invitationAlreadySent = false;
  }

  if (!(await markAuthUserAsStaff(service, authUser))) {
    if (invitationAlreadySent) {
      const cleanup = await service.auth.admin.deleteUser(authUser.id);
      if (cleanup.error) {
        const quarantinedEmployee = await bindEmployeeToStaffUser(
          service,
          employee,
          authUser.id,
        );
        if (quarantinedEmployee) employee = quarantinedEmployee;
      }
      return {
        employee,
        invitation: {
          status: "failed",
          error: cleanup.error
            ? "staff_identity_cleanup_failed"
            : "staff_identity_marker_failed",
        },
      };
    }
    return {
      employee,
      invitation: { status: "failed", error: "staff_identity_marker_failed" },
    };
  }

  const boundEmployee = await bindEmployeeToStaffUser(service, employee, authUser.id);
  if (!boundEmployee) {
    return {
      employee,
      invitation: { status: "failed", error: "staff_identity_binding_failed" },
    };
  }
  employee = boundEmployee;

  if (!invitationAlreadySent) {
    const sent = await sendExistingStaffAccessEmail(service, {
      email: employee.email,
      redirectTo: input.redirectTo,
      emailConfirmed: Boolean(authUser.email_confirmed_at),
    });
    if (!sent) {
      return {
        employee,
        invitation: { status: "failed", error: "invite_unavailable" },
      };
    }
  }
  return { employee, invitation: { status: "sent" } };
}

function roleAssignmentError(
  actor: MerchantEnterpriseActor,
  snapshot: Awaited<ReturnType<typeof loadMerchantEnterpriseSnapshot>>,
  roleId: string,
) {
  const role = snapshot.roles.find(
    (item) => item.id === roleId && item.status === "active",
  );
  if (!role) return "invalid_employee_role";
  if (!merchantEnterprisePermissionsFitActor(actor, role.permissions)) {
    return "permission_escalation_denied";
  }
  return "";
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as EmployeeBody | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    const displayName = text(body?.displayName, 120);
    const email = text(body?.email, 320).toLowerCase();
    const roleId = text(body?.roleId, 80);
    if (!displayName || !email.includes("@") || !roleId) {
      return NextResponse.json({ ok: false, error: "invalid_employee" }, { status: 400 });
    }
    const actor = await authorize(request, siteId);
    const service = serviceClient();
    const snapshot = await loadMerchantEnterpriseSnapshot(
      service as unknown as MerchantEnterpriseStoreClient,
      siteId,
    );
    const assignmentError = roleAssignmentError(actor, snapshot, roleId);
    if (assignmentError) {
      return NextResponse.json(
        { ok: false, error: assignmentError },
        { status: assignmentError === "permission_escalation_denied" ? 403 : 400 },
      );
    }
    let employee = await createMerchantEnterpriseEmployee(
      service as unknown as MerchantEnterpriseStoreClient,
      {
        siteId,
        email,
        displayName,
        roleId,
      },
    );
    const invitationResult = await ensureEmployeeInvitation(service, {
      employee,
      redirectTo: invitationRedirect(request, siteId),
    });
    employee = invitationResult.employee;
    const invitation = invitationResult.invitation;
    if (
      invitation.status === "failed" &&
      invitation.error === "employee_email_already_registered" &&
      !employee.authUserId
    ) {
      const rolledBack = await service
        .from("merchant_enterprise_employees")
        .delete()
        .eq("merchant_id", siteId)
        .eq("id", employee.id)
        .eq("status", "invited")
        .is("auth_user_id", null);
      if (rolledBack.error) throw new Error("enterprise_employee_invite_rollback_failed");
      return NextResponse.json(
        { ok: false, error: invitation.error },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, employee, invitation });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) return getTrustedMutationRequestErrorResponse();
  try {
    const body = (await request.json().catch(() => null)) as EmployeeBody | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }
    if (!isMerchantEnterpriseVersion(body?.version)) {
      return NextResponse.json({ ok: false, error: "invalid_version" }, { status: 400 });
    }
    const employeeId = text(body?.employeeId, 80);
    if (!employeeId) {
      return NextResponse.json({ ok: false, error: "invalid_employee" }, { status: 400 });
    }
    const action = text(body?.action, 40);
    if (action && action !== "resend_invite") {
      return NextResponse.json({ ok: false, error: "invalid_employee_action" }, { status: 400 });
    }

    const actor = await authorize(request, siteId);
    const service = serviceClient();
    const store = service as unknown as MerchantEnterpriseStoreClient;
    const snapshot = await loadMerchantEnterpriseSnapshot(store, siteId);
    const currentEmployee = snapshot.employees.find((item) => item.id === employeeId);
    if (!currentEmployee) {
      return NextResponse.json({ ok: false, error: "employee_not_found" }, { status: 404 });
    }
    if (currentEmployee.version !== body.version) {
      return NextResponse.json(
        { ok: false, error: "enterprise_version_conflict" },
        { status: 409 },
      );
    }
    if (actor.type === "employee" && actor.id === currentEmployee.id) {
      return NextResponse.json(
        { ok: false, error: "permission_escalation_denied" },
        { status: 403 },
      );
    }
    const currentRole = snapshot.roles.find((item) => item.id === currentEmployee.roleId);
    if (
      actor.type === "employee" &&
      currentRole &&
      !merchantEnterprisePermissionsFitActor(actor, currentRole.permissions)
    ) {
      return NextResponse.json(
        { ok: false, error: "permission_escalation_denied" },
        { status: 403 },
      );
    }

    if (action === "resend_invite") {
      if (currentEmployee.status !== "invited") {
        return NextResponse.json(
          { ok: false, error: "employee_invitation_not_pending" },
          { status: 409 },
        );
      }
      const reservation = await reserveEmployeeInvitationResend(
        store,
        currentEmployee,
      );
      if (reservation.status === "cooldown") {
        return createEmployeeInvitationCooldownResponse(
          reservation.employee,
          reservation.retryAfterSeconds,
        );
      }
      const result = await ensureEmployeeInvitation(service, {
        employee: reservation.employee,
        redirectTo: invitationRedirect(request, siteId),
      });
      return createEmployeeInvitationResendResponse(result);
    }

    if (
      body?.status !== undefined &&
      body.status !== "invited" &&
      body.status !== "active" &&
      body.status !== "disabled"
    ) {
      return NextResponse.json({ ok: false, error: "invalid_employee_status" }, { status: 400 });
    }
    if (body?.displayName !== undefined && !text(body.displayName, 120)) {
      return NextResponse.json({ ok: false, error: "invalid_employee" }, { status: 400 });
    }
    const requestedRoleId =
      body?.roleId === undefined ? undefined : text(body.roleId, 80);
    if (body?.roleId !== undefined && !requestedRoleId) {
      return NextResponse.json({ ok: false, error: "invalid_employee_role" }, { status: 400 });
    }
    if (requestedRoleId) {
      const assignmentError = roleAssignmentError(actor, snapshot, requestedRoleId);
      if (assignmentError) {
        return NextResponse.json(
          { ok: false, error: assignmentError },
          { status: assignmentError === "permission_escalation_denied" ? 403 : 400 },
        );
      }
    }
    if (
      body?.displayName === undefined &&
      body?.roleId === undefined &&
      body?.status === undefined
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_employee_update" },
        { status: 400 },
      );
    }

    const employee = await updateMerchantEnterpriseEmployee(store, {
      siteId,
      employeeId,
      version: body.version,
      ...(body?.displayName !== undefined ? { displayName: text(body.displayName, 120) } : {}),
      ...(requestedRoleId ? { roleId: requestedRoleId } : {}),
      ...(body?.status === "invited" || body?.status === "active" || body?.status === "disabled"
        ? { status: body.status }
        : {}),
    });
    return NextResponse.json({ ok: true, employee });
  } catch (error) {
    return fail(error);
  }
}
