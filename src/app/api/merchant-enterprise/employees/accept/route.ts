import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeMerchantEnterpriseEmployee } from "@/lib/merchantEnterprise";
import {
  MerchantEnterpriseAccessError,
  requireMerchantEnterpriseEntitlement,
  resolveValidatedMerchantEnterpriseAuthUser,
  toMerchantEnterpriseAccessResponse,
} from "@/lib/merchantEnterpriseAuth.server";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getTrustedMutationRequestErrorResponse,
  isTrustedSameOriginMutationRequest,
} from "@/lib/requestMutationGuard";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(value: unknown, max = 4096) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(error: unknown) {
  const resolved = toMerchantEnterpriseAccessResponse(error);
  return NextResponse.json(resolved.body, { status: resolved.status });
}

function invitationTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function rpcErrorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  return [value.code, value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(":")
    .toLowerCase();
}

export function merchantEmployeeInvitationAcceptError(error: unknown) {
  const message = rpcErrorText(error);
  if (message.includes("employee_invitation_expired")) {
    return new MerchantEnterpriseAccessError("employee_invitation_expired", 410);
  }
  if (message.includes("employee_invitation_revoked")) {
    return new MerchantEnterpriseAccessError("employee_invitation_revoked", 410);
  }
  if (
    message.includes("employee_invitation_superseded") ||
    message.includes("employee_invitation_token_invalid")
  ) {
    return new MerchantEnterpriseAccessError("employee_invitation_superseded", 410);
  }
  if (message.includes("employee_invitation_credentials_required")) {
    return new MerchantEnterpriseAccessError("employee_invitation_credentials_required", 403);
  }
  if (message.includes("employee_account_disabled")) {
    return new MerchantEnterpriseAccessError("employee_account_disabled", 403);
  }
  if (message.includes("merchant_role_invalid") || message.includes("merchant_access_denied")) {
    return new MerchantEnterpriseAccessError("merchant_access_denied", 403);
  }
  if (
    message.includes("merchant_employee_not_invited") ||
    message.includes("employee_not_found")
  ) {
    return new MerchantEnterpriseAccessError("merchant_employee_not_invited", 403);
  }
  if (
    message.includes("enterprise_version_conflict") ||
    message.includes("enterprise_invitation_accept_conflict")
  ) {
    return new MerchantEnterpriseAccessError("merchant_employee_accept_conflict", 409);
  }
  return new MerchantEnterpriseAccessError("merchant_employee_accept_failed", 503);
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      siteId?: unknown;
      invitationVersion?: unknown;
      invitationToken?: unknown;
    } | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }

    const invitationToken = text(body?.invitationToken, 256);
    const invitationVersion = Number(body?.invitationVersion);
    const hasInvitationVersion = body?.invitationVersion !== undefined;
    const hasInvitationToken = Boolean(invitationToken);
    if (
      hasInvitationVersion !== hasInvitationToken ||
      (hasInvitationVersion &&
        (!Number.isSafeInteger(invitationVersion) ||
          invitationVersion <= 0 ||
          !/^[A-Za-z0-9_-]{32,256}$/.test(invitationToken)))
    ) {
      return NextResponse.json(
        { ok: false, error: "invalid_employee_invitation_credentials" },
        { status: 400 },
      );
    }

    const user = await resolveValidatedMerchantEnterpriseAuthUser(request);
    await requireMerchantEnterpriseEntitlement(siteId);
    const service = createServerSupabaseServiceClient();
    if (!service) {
      throw new MerchantEnterpriseAccessError("enterprise_store_unavailable", 503);
    }

    const result = await service.rpc("faolla_accept_merchant_employee_invitation_v1", {
      p_input: {
        merchant_id: siteId,
        auth_user_id: text(user.id, 80),
        ...(hasInvitationVersion
          ? {
              invitation_version: invitationVersion,
              token_hash: invitationTokenHash(invitationToken),
            }
          : {}),
      },
    });
    if (result.error) throw merchantEmployeeInvitationAcceptError(result.error);
    const record =
      result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : {};
    const employee = normalizeMerchantEnterpriseEmployee(record.employee);
    if (!employee || employee.status !== "active") {
      throw new MerchantEnterpriseAccessError("merchant_employee_accept_failed", 503);
    }
    return NextResponse.json({
      ok: true,
      employee,
      alreadyActive: record.already_active === true,
    });
  } catch (error) {
    return fail(error);
  }
}
