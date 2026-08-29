import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  isMerchantEnterpriseVersion,
  merchantEnterpriseRoleFitsActor,
  type MerchantEnterpriseActor,
  type MerchantEnterpriseEmployee,
} from "@/lib/merchantEnterprise";
import {
  requireMerchantEnterpriseEntitlement,
  resolveMerchantEnterpriseActor,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import {
  createMerchantEnterpriseEmployee,
  loadMerchantEnterpriseSnapshot,
  updateMerchantEnterpriseEmployee,
  type MerchantEnterpriseStoreClient,
} from "@/lib/merchantEnterpriseStore.server";
import {
  bindMerchantEnterpriseEmployeeInvitationAuthUser,
  createMerchantEnterpriseEmployeeInvitationV2,
  createMerchantEnterpriseInvitationSecret,
  finalizeMerchantEnterpriseEmployeeInvitation,
  MERCHANT_ENTERPRISE_INVITATION_TTL_MS,
  removeMerchantEnterpriseEmployeeInvitation,
  reserveMerchantEnterpriseEmployeeInvitation,
  resolveMerchantEnterpriseInvitationActiveHmacKeyId,
  resolveMerchantEnterpriseInvitationDeliveryMode,
  revokeMerchantEnterpriseEmployeeInvitation,
  scheduleMerchantEnterpriseEmployeeInvitationDeliveryV2,
} from "@/lib/merchantEnterpriseInvitationStore.server";
import {
  isValidAuthEmail,
  normalizeAuthEmail,
} from "@/lib/authCredentialValidation";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";
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
  roleVersion?: unknown;
  roleTransitionMode?: unknown;
  status?: unknown;
  offboardingMode?: unknown;
  replacementEmployeeId?: unknown;
  operationId?: unknown;
};

type ServiceClient = NonNullable<ReturnType<typeof createServerSupabaseServiceClient>>;
type InvitationAwareEmployee = MerchantEnterpriseEmployee & {
  invitationVersion: number;
  invitationExpiresAt: string | null;
  invitationRevokedAt: string | null;
  invitationSentAt: string | null;
  invitationDeliveryStatus: "none" | "legacy" | "sending" | "sent" | "failed" | "revoked";
};
type InvitationDeliveryError =
  | "employee_email_already_registered"
  | "invitation_email_recipient_not_authorized"
  | "invitation_email_rate_limited"
  | "invitation_email_provider_unconfigured"
  | "invitation_email_recipient_rejected"
  | "invitation_email_delivery_failed"
  | "invite_unavailable"
  | "staff_identity_marker_failed"
  | "staff_identity_cleanup_failed"
  | "staff_identity_binding_failed";
type InvitationResult =
  | { status: "sent" }
  | { status: "queued" }
  | {
      status: "failed";
      error: InvitationDeliveryError;
    };

const EMPLOYEE_INVITATION_RESEND_COOLDOWN_MS = 60_000;

export function classifyMerchantEnterpriseInvitationAuthError(
  error: unknown,
): InvitationDeliveryError {
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; status?: unknown })
      : null;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const status =
    typeof candidate?.status === "number" && Number.isInteger(candidate.status)
      ? candidate.status
      : null;

  if (code === "email_address_not_authorized") {
    return "invitation_email_recipient_not_authorized";
  }
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    status === 429
  ) {
    return "invitation_email_rate_limited";
  }
  if (code === "email_provider_disabled") {
    return "invitation_email_provider_unconfigured";
  }
  if (code === "email_address_invalid") {
    return "invitation_email_recipient_rejected";
  }
  if (code === "unexpected_failure" || (status !== null && status >= 500)) {
    return "invitation_email_delivery_failed";
  }
  return "invite_unavailable";
}

function text(value: unknown, max = 4096) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function reliableInvitationOperationId(value: unknown) {
  const raw = text(value, 120);
  const normalized = normalizeMutationOperationId(raw);
  return raw && normalized === raw ? normalized : "";
}

export function getMerchantEnterpriseEmployeeMutationActor(
  actor: MerchantEnterpriseActor,
) {
  return {
    actorType: actor.type,
    actorId: actor.id,
  } as const;
}

export function parseMerchantEnterpriseEmployeeOffboarding(input: {
  employeeId?: unknown;
  status?: unknown;
  offboardingMode?: unknown;
  roleTransitionMode?: unknown;
  replacementEmployeeId?: unknown;
}):
  | {
      ok: true;
      payload: {
        offboardingMode?: "unassign" | "reassign";
        replacementEmployeeId?: string;
      };
    }
  | {
      ok: false;
      error:
        | "invalid_employee_offboarding"
        | "employee_offboarding_replacement_invalid";
      status: 400 | 409;
    } {
  const hasMode = input.offboardingMode !== undefined;
  const hasReplacement =
    input.replacementEmployeeId !== undefined &&
    input.roleTransitionMode === undefined;
  if (!hasMode && !hasReplacement) return { ok: true, payload: {} };
  if (input.status !== "disabled") {
    return { ok: false, error: "invalid_employee_offboarding", status: 400 };
  }
  const mode = text(input.offboardingMode, 20);
  const replacementEmployeeId = text(input.replacementEmployeeId, 80);
  if (
    (mode !== "unassign" && mode !== "reassign") ||
    (mode === "unassign" && hasReplacement) ||
    (mode === "reassign" && !replacementEmployeeId) ||
    (!hasMode && hasReplacement)
  ) {
    return { ok: false, error: "invalid_employee_offboarding", status: 400 };
  }
  if (replacementEmployeeId === text(input.employeeId, 80)) {
    return {
      ok: false,
      error: "employee_offboarding_replacement_invalid",
      status: 409,
    };
  }
  return {
    ok: true,
    payload:
      mode === "reassign"
        ? { offboardingMode: mode, replacementEmployeeId }
        : { offboardingMode: "unassign" },
  };
}

export function parseMerchantEnterpriseEmployeeRoleTransition(input: {
  employeeId?: unknown;
  roleId?: unknown;
  roleVersion?: unknown;
  roleTransitionMode?: unknown;
  offboardingMode?: unknown;
  replacementEmployeeId?: unknown;
}):
  | {
      ok: true;
      payload: {
        roleVersion?: number;
        roleTransitionMode?: "unassign" | "reassign";
        replacementEmployeeId?: string;
      };
    }
  | {
      ok: false;
      error:
        | "invalid_employee_role_transition"
        | "employee_role_transition_replacement_invalid";
      status: 400 | 409;
    } {
  const hasRoleVersion = input.roleVersion !== undefined;
  const hasMode = input.roleTransitionMode !== undefined;
  const hasRoleId = input.roleId !== undefined;
  const hasOffboardingMode = input.offboardingMode !== undefined;
  if (hasOffboardingMode && hasMode) {
    return { ok: false, error: "invalid_employee_role_transition", status: 400 };
  }
  if (!hasRoleVersion && !hasMode) {
    return hasRoleId
      ? { ok: false, error: "invalid_employee_role_transition", status: 400 }
      : { ok: true, payload: {} };
  }
  const roleId = text(input.roleId, 80);
  const mode = text(input.roleTransitionMode, 20);
  const replacementEmployeeId = text(input.replacementEmployeeId, 80);
  if (
    !roleId ||
    !isMerchantEnterpriseVersion(input.roleVersion) ||
    (hasMode && mode !== "unassign" && mode !== "reassign") ||
    (mode === "unassign" && input.replacementEmployeeId !== undefined) ||
    (mode === "reassign" && !replacementEmployeeId) ||
    (!hasMode && !hasOffboardingMode && input.replacementEmployeeId !== undefined)
  ) {
    return { ok: false, error: "invalid_employee_role_transition", status: 400 };
  }
  if (replacementEmployeeId === text(input.employeeId, 80)) {
    return {
      ok: false,
      error: "employee_role_transition_replacement_invalid",
      status: 409,
    };
  }
  return {
    ok: true,
    payload: {
      roleVersion: Number(input.roleVersion),
      ...(hasMode
        ? {
            roleTransitionMode: mode as "unassign" | "reassign",
            ...(mode === "reassign" ? { replacementEmployeeId } : {}),
          }
        : {}),
    },
  };
}

export function getMerchantEnterpriseEmployeeMutationErrorResponse(
  error: unknown,
) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "employee_offboarding_scope_denied" ||
    code === "employee_role_transition_scope_denied" ||
    code === "permission_escalation_denied" ||
    code === "permission_denied"
  ) {
    return { status: 403, body: { ok: false, error: code } } as const;
  }
  if (
    code === "employee_open_tasks_require_resolution" ||
    code === "employee_offboarding_replacement_invalid" ||
    code === "employee_role_transition_required" ||
    code === "employee_role_transition_replacement_invalid" ||
    code === "enterprise_version_conflict" ||
    code === "employee_board_access_in_use" ||
    code === "employee_email_in_use" ||
    code === "employee_invitation_not_pending" ||
    code === "employee_invitation_renew_required" ||
    code === "employee_invitation_renew_not_required" ||
    code === "enterprise_idempotency_conflict" ||
    code === "invitation_delivery_cooldown"
  ) {
    return { status: 409, body: { ok: false, error: code } } as const;
  }
  return null;
}

export function toPublicMerchantEnterpriseEmployee(
  employee: MerchantEnterpriseEmployee,
) {
  return {
    id: employee.id,
    siteId: employee.siteId,
    email: employee.email,
    displayName: employee.displayName,
    roleId: employee.roleId,
    status: employee.status,
    invitedAt: employee.invitedAt,
    acceptedAt: employee.acceptedAt,
    lastActiveAt: employee.lastActiveAt,
    invitationVersion: employee.invitationVersion,
    invitationExpiresAt: employee.invitationExpiresAt,
    invitationRevokedAt: employee.invitationRevokedAt,
    invitationSentAt: employee.invitationSentAt,
    invitationDeliveryStatus: employee.invitationDeliveryStatus,
    version: employee.version,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
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

export function getMerchantEnterpriseEmployeeStatusTransitionError(
  employee: Pick<MerchantEnterpriseEmployee, "status" | "acceptedAt">,
  nextStatus: unknown,
) {
  if (nextStatus === undefined || nextStatus === employee.status) return null;
  if (nextStatus === "active" && !employee.acceptedAt) {
    return "employee_invitation_not_accepted" as const;
  }
  if (employee.status === "invited" && nextStatus === "disabled") {
    return "employee_invitation_revoke_required" as const;
  }
  if (nextStatus === "invited" && employee.status !== "invited") {
    return "invalid_employee_status_transition" as const;
  }
  return null;
}

export function getMerchantEnterpriseInvitationActionError(
  employee: MerchantEnterpriseEmployee,
  action: "resend_invite" | "renew_invite",
  nowMs = Date.now(),
) {
  const invitation = employee as InvitationAwareEmployee;
  const expired =
    Boolean(invitation.invitationExpiresAt) &&
    Date.parse(invitation.invitationExpiresAt ?? "") <= nowMs;
  const revoked = Boolean(invitation.invitationRevokedAt);
  if (action === "renew_invite" && !expired && !revoked) {
    return "employee_invitation_renew_not_required" as const;
  }
  if (action === "resend_invite" && (expired || revoked)) {
    return "employee_invitation_renew_required" as const;
  }
  return null;
}

export async function reserveEmployeeInvitationResend(
  store: MerchantEnterpriseStoreClient,
  employee: MerchantEnterpriseEmployee,
  mutationActor: ReturnType<typeof getMerchantEnterpriseEmployeeMutationActor>,
  nowMs = Date.now(),
  bypassCooldown = false,
): Promise<
  | { status: "cooldown"; employee: MerchantEnterpriseEmployee; retryAfterSeconds: number }
  | {
      status: "reserved";
      employee: MerchantEnterpriseEmployee;
      invitationVersion: number;
      invitationToken: string;
    }
> {
  const invitationAwareEmployee = employee as InvitationAwareEmployee;
  const retryAfterSeconds = getEmployeeInvitationRetryAfterSeconds(
    invitationAwareEmployee.invitationSentAt ?? employee.invitedAt,
    nowMs,
  );
  if (!bypassCooldown && retryAfterSeconds > 0) {
    return { status: "cooldown", employee, retryAfterSeconds };
  }
  const secret = createMerchantEnterpriseInvitationSecret();
  const reserved = await reserveMerchantEnterpriseEmployeeInvitation(store, {
    siteId: employee.siteId,
    employeeId: employee.id,
    version: employee.version,
    tokenHash: secret.tokenHash,
    expiresAt: new Date(nowMs + MERCHANT_ENTERPRISE_INVITATION_TTL_MS).toISOString(),
    ...mutationActor,
  });
  return {
    status: "reserved",
    employee: reserved.employee,
    invitationVersion: reserved.invitationVersion,
    invitationToken: secret.token,
  };
}

export function createEmployeeInvitationCooldownResponse(
  employee: MerchantEnterpriseEmployee,
  retryAfterSeconds: number,
) {
  return NextResponse.json(
    {
      ok: false,
      error: "employee_invitation_cooldown",
      employee: toPublicMerchantEnterpriseEmployee(employee),
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
    employee: toPublicMerchantEnterpriseEmployee(input.employee),
    invitation: input.invitation,
  });
}

function serviceClient() {
  const value = createServerSupabaseServiceClient();
  if (!value) throw new Error("enterprise_store_unavailable");
  return value;
}

function fail(error: unknown) {
  const mutationError = getMerchantEnterpriseEmployeeMutationErrorResponse(error);
  if (mutationError) {
    return NextResponse.json(mutationError.body, { status: mutationError.status });
  }
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

function invitationRedirect(
  request: Request,
  siteId: string,
  invitationVersion: number,
  invitationToken: string,
) {
  const requestUrl = new URL(request.url);
  const redirectOrigin = resolvePublicOrigin(request, requestUrl);
  const redirect = new URL(
    `/enterprise/${encodeURIComponent(siteId)}`,
    redirectOrigin,
  );
  // The legacy Supabase email flow returns an auth session in the URL hash,
  // so its invitation credential must remain in the query until the portal
  // copies and immediately scrubs it. Durable outbox emails use a fragment
  // before starting the Auth exchange and never call this helper.
  redirect.searchParams.set("iv", String(invitationVersion));
  redirect.searchParams.set("it", invitationToken);
  return redirect.toString();
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
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}, expectedEmail: string) {
  const normalizedEmail = normalizeAuthEmail(expectedEmail);
  if (
    !isValidAuthEmail(normalizedEmail) ||
    normalizeAuthEmail(user.email) !== normalizedEmail
  ) {
    return false;
  }
  const expectedEmailHash = createHash("sha256")
    .update(normalizedEmail, "utf8")
    .digest("hex");
  const currentAppMetadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {};
  const currentEmailHash =
    typeof currentAppMetadata.merchant_staff_email_hash === "string"
      ? currentAppMetadata.merchant_staff_email_hash.trim().toLowerCase()
      : "";
  if (currentEmailHash && currentEmailHash !== expectedEmailHash) return false;
  if (
    hasImmutableMerchantStaffPrincipal(user) &&
    currentEmailHash === expectedEmailHash
  ) {
    return true;
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await service.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...currentAppMetadata,
        principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE,
        merchant_staff_email_hash: expectedEmailHash,
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
    return result.error
      ? ({
          status: "failed",
          error: classifyMerchantEnterpriseInvitationAuthError(result.error),
        } as const)
      : ({ status: "sent" } as const);
  }
  const result = await service.auth.resend({
    type: "signup",
    email: input.email,
    options: { emailRedirectTo: input.redirectTo },
  });
  return result.error
    ? ({
        status: "failed",
        error: classifyMerchantEnterpriseInvitationAuthError(result.error),
      } as const)
    : ({ status: "sent" } as const);
}

async function bindEmployeeToStaffUser(
  service: ServiceClient,
  employee: MerchantEnterpriseEmployee,
  authUserId: string,
  invitationVersion: number,
) {
  try {
    const result = await bindMerchantEnterpriseEmployeeInvitationAuthUser(
      service as unknown as MerchantEnterpriseStoreClient,
      {
        siteId: employee.siteId,
        employeeId: employee.id,
        authUserId,
        version: employee.version,
        invitationVersion,
      },
    );
    return result.employee;
  } catch {
    return null;
  }
}

async function ensureEmployeeInvitation(
  service: ServiceClient,
  input: {
    employee: MerchantEnterpriseEmployee;
    redirectTo: string;
    invitationVersion: number;
  },
): Promise<{ employee: MerchantEnterpriseEmployee; invitation: InvitationResult }> {
  let employee = input.employee;

  if (employee.authUserId) {
    const existing = await service.auth.admin.getUserById(employee.authUserId);
    const user = existing.data.user;
    if (
      existing.error ||
      !user ||
      !(await markAuthUserAsStaff(service, user, employee.email))
    ) {
      return {
        employee,
        invitation: { status: "failed", error: "staff_identity_marker_failed" },
      };
    }
    const invitation = await sendExistingStaffAccessEmail(service, {
      email: employee.email,
      redirectTo: input.redirectTo,
      emailConfirmed: Boolean(user.email_confirmed_at),
    });
    return {
      employee,
      invitation,
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
        invitation: {
          status: "failed",
          error: classifyMerchantEnterpriseInvitationAuthError(invite.error),
        },
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

  if (!(await markAuthUserAsStaff(service, authUser, employee.email))) {
    if (invitationAlreadySent) {
      const cleanup = await service.auth.admin.deleteUser(authUser.id);
      if (cleanup.error) {
        const quarantinedEmployee = await bindEmployeeToStaffUser(
          service,
          employee,
          authUser.id,
          input.invitationVersion,
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

  const boundEmployee = await bindEmployeeToStaffUser(
    service,
    employee,
    authUser.id,
    input.invitationVersion,
  );
  if (!boundEmployee) {
    return {
      employee,
      invitation: { status: "failed", error: "staff_identity_binding_failed" },
    };
  }
  employee = boundEmployee;

  if (!invitationAlreadySent) {
    const invitation = await sendExistingStaffAccessEmail(service, {
      email: employee.email,
      redirectTo: input.redirectTo,
      emailConfirmed: Boolean(authUser.email_confirmed_at),
    });
    if (invitation.status === "failed") {
      return {
        employee,
        invitation,
      };
    }
  }
  return { employee, invitation: { status: "sent" } };
}

async function deliverReservedEmployeeInvitation(
  service: ServiceClient,
  request: Request,
  siteId: string,
  reservation: {
    employee: MerchantEnterpriseEmployee;
    invitationVersion: number;
    invitationToken: string;
  },
) {
  const delivered = await ensureEmployeeInvitation(service, {
    employee: reservation.employee,
    invitationVersion: reservation.invitationVersion,
    redirectTo: invitationRedirect(
      request,
      siteId,
      reservation.invitationVersion,
      reservation.invitationToken,
    ),
  });
  const sent = delivered.invitation.status === "sent";
  const finalized = await finalizeMerchantEnterpriseEmployeeInvitation(
    service as unknown as MerchantEnterpriseStoreClient,
    {
      siteId,
      employeeId: reservation.employee.id,
      invitationVersion: reservation.invitationVersion,
      deliveryStatus: sent ? "sent" : "failed",
      sentAt: sent ? new Date().toISOString() : null,
    },
  );
  return {
    employee: finalized.employee,
    invitation:
      finalized.applied === false
        ? ({ status: "failed", error: "invite_unavailable" } as const)
        : delivered.invitation,
  };
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
  if (!merchantEnterpriseRoleFitsActor(actor, role)) {
    return "permission_escalation_denied";
  }
  return "";
}

export function getMerchantEnterpriseEmployeeRoleTransitionValidation(input: {
  actor: MerchantEnterpriseActor;
  snapshot: Awaited<ReturnType<typeof loadMerchantEnterpriseSnapshot>>;
  currentEmployee: MerchantEnterpriseEmployee;
  requestedRoleId?: string;
  roleVersion?: unknown;
  roleTransitionMode?: "unassign" | "reassign";
  offboardingMode?: "unassign" | "reassign";
  replacementEmployeeId?: string;
}):
  | { ok: true; roleChanged: boolean }
  | { ok: false; error: string; status: 400 | 403 | 409 } {
  const roleChanged = Boolean(
    input.requestedRoleId && input.requestedRoleId !== input.currentEmployee.roleId,
  );
  const hasTransitionPayload =
    input.roleVersion !== undefined || input.roleTransitionMode !== undefined;
  if (!roleChanged) {
    return hasTransitionPayload
      ? { ok: false, error: "invalid_employee_role_transition", status: 400 }
      : { ok: true, roleChanged: false };
  }
  if (!isMerchantEnterpriseVersion(input.roleVersion)) {
    return { ok: false, error: "invalid_employee_role_transition", status: 400 };
  }
  const requestedRole = input.snapshot.roles.find(
    (role) => role.id === input.requestedRoleId && role.status === "active",
  );
  if (!requestedRole) {
    return { ok: false, error: "invalid_employee_role", status: 400 };
  }
  if (!merchantEnterpriseRoleFitsActor(input.actor, requestedRole)) {
    return { ok: false, error: "permission_escalation_denied", status: 403 };
  }
  if (requestedRole.version !== input.roleVersion) {
    return { ok: false, error: "enterprise_version_conflict", status: 409 };
  }
  if (input.roleTransitionMode === "reassign") {
    const replacement = input.snapshot.employees.find(
      (employee) => employee.id === input.replacementEmployeeId,
    );
    if (!replacement || replacement.status !== "active") {
      return {
        ok: false,
        error: "employee_role_transition_replacement_invalid",
        status: 409,
      };
    }
  }
  return { ok: true, roleChanged: true };
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
    const email = normalizeAuthEmail(body?.email);
    const roleId = text(body?.roleId, 80);
    if (!displayName || !roleId) {
      return NextResponse.json({ ok: false, error: "invalid_employee" }, { status: 400 });
    }
    if (!isValidAuthEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "invalid_employee_email" },
        { status: 400 },
      );
    }
    const actor = await authorize(request, siteId);
    const service = serviceClient();
    const store = service as unknown as MerchantEnterpriseStoreClient;
    const mutationActor = getMerchantEnterpriseEmployeeMutationActor(actor);
    if (resolveMerchantEnterpriseInvitationDeliveryMode() === "outbox") {
      const operationId = reliableInvitationOperationId(body?.operationId);
      if (!operationId) {
        return NextResponse.json(
          { ok: false, error: "invalid_operation_id" },
          { status: 400 },
        );
      }
      const queued = await createMerchantEnterpriseEmployeeInvitationV2(store, {
        siteId,
        email,
        displayName,
        roleId,
        operationId,
        hmacKeyId: resolveMerchantEnterpriseInvitationActiveHmacKeyId(),
        ...mutationActor,
      });
      return NextResponse.json({
        ok: true,
        employee: toPublicMerchantEnterpriseEmployee(queued.employee),
        invitation: { status: "queued" },
      });
    }
    const snapshot = await loadMerchantEnterpriseSnapshot(
      store,
      siteId,
    );
    const assignmentError = roleAssignmentError(actor, snapshot, roleId);
    if (assignmentError) {
      return NextResponse.json(
        { ok: false, error: assignmentError },
        { status: assignmentError === "permission_escalation_denied" ? 403 : 400 },
      );
    }
    if (snapshot.employees.some((employee) => employee.email === email)) {
      return NextResponse.json(
        { ok: false, error: "employee_email_in_use" },
        { status: 409 },
      );
    }
    let employee = await createMerchantEnterpriseEmployee(
      store,
      {
        siteId,
        email,
        displayName,
        roleId,
        ...mutationActor,
      },
    );
    const reservation = await reserveEmployeeInvitationResend(
      store,
      employee,
      mutationActor,
      Date.now(),
      true,
    );
    if (reservation.status !== "reserved") {
      throw new Error("enterprise_employee_invitation_reserve_failed");
    }
    const invitationResult = await deliverReservedEmployeeInvitation(
      service,
      request,
      siteId,
      reservation,
    );
    employee = invitationResult.employee;
    const invitation = invitationResult.invitation;
    if (
      invitation.status === "failed" &&
      invitation.error === "employee_email_already_registered" &&
      !employee.authUserId
    ) {
      await removeMerchantEnterpriseEmployeeInvitation(store, {
        siteId,
        employeeId: employee.id,
        version: employee.version,
        ...mutationActor,
      });
      return NextResponse.json(
        { ok: false, error: invitation.error },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      employee: toPublicMerchantEnterpriseEmployee(employee),
      invitation,
    });
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
    if (
      action &&
      action !== "resend_invite" &&
      action !== "renew_invite" &&
      action !== "revoke_invite" &&
      action !== "remove_invite"
    ) {
      return NextResponse.json({ ok: false, error: "invalid_employee_action" }, { status: 400 });
    }
    if (
      action &&
      (body?.email !== undefined ||
        body?.displayName !== undefined ||
        body?.roleId !== undefined ||
        body?.roleVersion !== undefined ||
        body?.roleTransitionMode !== undefined ||
        body?.status !== undefined ||
        body?.offboardingMode !== undefined ||
        body?.replacementEmployeeId !== undefined)
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_employee_action" },
        { status: 400 },
      );
    }
    if (!action && body?.email !== undefined) {
      return NextResponse.json(
        { ok: false, error: "employee_email_change_requires_reinvite" },
        { status: 400 },
      );
    }
    const roleTransition = parseMerchantEnterpriseEmployeeRoleTransition({
      employeeId,
      roleId: body?.roleId,
      roleVersion: body?.roleVersion,
      roleTransitionMode: body?.roleTransitionMode,
      offboardingMode: body?.offboardingMode,
      replacementEmployeeId: body?.replacementEmployeeId,
    });
    if (!roleTransition.ok) {
      return NextResponse.json(
        { ok: false, error: roleTransition.error },
        { status: roleTransition.status },
      );
    }
    const offboarding = parseMerchantEnterpriseEmployeeOffboarding({
      employeeId,
      status: body?.status,
      offboardingMode: body?.offboardingMode,
      roleTransitionMode: body?.roleTransitionMode,
      replacementEmployeeId: body?.replacementEmployeeId,
    });
    if (!offboarding.ok) {
      return NextResponse.json(
        { ok: false, error: offboarding.error },
        { status: offboarding.status },
      );
    }

    const actor = await authorize(request, siteId);
    const service = serviceClient();
    const store = service as unknown as MerchantEnterpriseStoreClient;
    const mutationActor = getMerchantEnterpriseEmployeeMutationActor(actor);
    const snapshot = await loadMerchantEnterpriseSnapshot(store, siteId);
    const currentEmployee = snapshot.employees.find((item) => item.id === employeeId);
    if (!currentEmployee) {
      return NextResponse.json({ ok: false, error: "employee_not_found" }, { status: 404 });
    }
    if (actor.type === "employee" && actor.id === currentEmployee.id) {
      return NextResponse.json(
        { ok: false, error: "permission_escalation_denied" },
        { status: 403 },
      );
    }

    // Durable invitation retries must reach the database idempotency record
    // before local state/version/cooldown checks. The RPC reauthorizes the
    // current actor and only bypasses those checks for the exact same request.
    if (
      (action === "resend_invite" || action === "renew_invite") &&
      resolveMerchantEnterpriseInvitationDeliveryMode() === "outbox"
    ) {
      const operationId = reliableInvitationOperationId(body?.operationId);
      if (!operationId) {
        return NextResponse.json(
          { ok: false, error: "invalid_operation_id" },
          { status: 400 },
        );
      }
      const queued =
        await scheduleMerchantEnterpriseEmployeeInvitationDeliveryV2(store, {
          siteId,
          employeeId: currentEmployee.id,
          version: body.version,
          action: action === "renew_invite" ? "renew" : "resend",
          operationId,
          hmacKeyId: resolveMerchantEnterpriseInvitationActiveHmacKeyId(),
          ...mutationActor,
        });
      return createEmployeeInvitationResendResponse({
        employee: queued.employee,
        invitation: { status: "queued" },
      });
    }

    if (currentEmployee.version !== body.version) {
      return NextResponse.json(
        { ok: false, error: "enterprise_version_conflict" },
        { status: 409 },
      );
    }
    const currentRole = snapshot.roles.find((item) => item.id === currentEmployee.roleId);
    if (
      actor.type === "employee" &&
      (!currentRole ||
        !merchantEnterpriseRoleFitsActor(actor, currentRole))
    ) {
      return NextResponse.json(
        { ok: false, error: "permission_escalation_denied" },
        { status: 403 },
      );
    }

    if (action === "revoke_invite") {
      if (currentEmployee.status !== "invited" || currentEmployee.acceptedAt) {
        return NextResponse.json(
          { ok: false, error: "employee_invitation_not_pending" },
          { status: 409 },
        );
      }
      const revoked = await revokeMerchantEnterpriseEmployeeInvitation(store, {
        siteId,
        employeeId: currentEmployee.id,
        version: currentEmployee.version,
        ...mutationActor,
      });
      return NextResponse.json({
        ok: true,
        employee: toPublicMerchantEnterpriseEmployee(revoked.employee),
      });
    }

    if (action === "remove_invite") {
      if (currentEmployee.status !== "invited" || currentEmployee.acceptedAt) {
        return NextResponse.json(
          { ok: false, error: "employee_invitation_not_pending" },
          { status: 409 },
        );
      }
      const removed = await removeMerchantEnterpriseEmployeeInvitation(store, {
        siteId,
        employeeId: currentEmployee.id,
        version: currentEmployee.version,
        ...mutationActor,
      });
      return NextResponse.json({
        ok: true,
        employeeId: removed.employeeId,
        removed: true,
      });
    }

    if (action === "resend_invite" || action === "renew_invite") {
      if (currentEmployee.status !== "invited" || currentEmployee.acceptedAt) {
        return NextResponse.json(
          { ok: false, error: "employee_invitation_not_pending" },
          { status: 409 },
        );
      }
      const actionError = getMerchantEnterpriseInvitationActionError(
        currentEmployee,
        action,
      );
      if (actionError) {
        return NextResponse.json(
          { ok: false, error: actionError },
          { status: 409 },
        );
      }
      const reservation = await reserveEmployeeInvitationResend(
        store,
        currentEmployee,
        mutationActor,
        Date.now(),
        action === "renew_invite",
      );
      if (reservation.status === "cooldown") {
        return createEmployeeInvitationCooldownResponse(
          reservation.employee,
          reservation.retryAfterSeconds,
        );
      }
      const result = await deliverReservedEmployeeInvitation(
        service,
        request,
        siteId,
        reservation,
      );
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
    const statusTransitionError =
      getMerchantEnterpriseEmployeeStatusTransitionError(
        currentEmployee,
        body?.status,
      );
    if (statusTransitionError) {
      return NextResponse.json(
        { ok: false, error: statusTransitionError },
        { status: statusTransitionError.startsWith("invalid_") ? 400 : 409 },
      );
    }
    const requestedRoleId =
      body?.roleId === undefined ? undefined : text(body.roleId, 80);
    if (body?.roleId !== undefined && !requestedRoleId) {
      return NextResponse.json({ ok: false, error: "invalid_employee_role" }, { status: 400 });
    }
    const roleTransitionValidation =
      getMerchantEnterpriseEmployeeRoleTransitionValidation({
        actor,
        snapshot,
        currentEmployee,
        requestedRoleId,
        roleVersion: body?.roleVersion,
        roleTransitionMode: roleTransition.payload.roleTransitionMode,
        offboardingMode: offboarding.payload.offboardingMode,
        replacementEmployeeId: roleTransition.payload.replacementEmployeeId,
      });
    if (!roleTransitionValidation.ok) {
      return NextResponse.json(
        { ok: false, error: roleTransitionValidation.error },
        { status: roleTransitionValidation.status },
      );
    }
    if (offboarding.payload.offboardingMode === "reassign") {
      const replacement = snapshot.employees.find(
        (item) => item.id === offboarding.payload.replacementEmployeeId,
      );
      if (!replacement || replacement.status !== "active") {
        return NextResponse.json(
          { ok: false, error: "employee_offboarding_replacement_invalid" },
          { status: 409 },
        );
      }
    }
    if (
      body?.displayName === undefined &&
      !roleTransitionValidation.roleChanged &&
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
      ...(roleTransitionValidation.roleChanged && requestedRoleId
        ? { roleId: requestedRoleId, ...roleTransition.payload }
        : {}),
      ...(body?.status === "invited" || body?.status === "active" || body?.status === "disabled"
        ? { status: body.status }
        : {}),
      ...offboarding.payload,
      ...mutationActor,
    });
    return NextResponse.json({
      ok: true,
      employee: toPublicMerchantEnterpriseEmployee(employee),
    });
  } catch (error) {
    return fail(error);
  }
}
