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

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  try {
    const body = (await request.json().catch(() => null)) as { siteId?: unknown } | null;
    const siteId = text(body?.siteId, 80);
    if (!isMerchantNumericId(siteId)) {
      return NextResponse.json({ ok: false, error: "invalid_site_id" }, { status: 400 });
    }

    const user = await resolveValidatedMerchantEnterpriseAuthUser(request);
    await requireMerchantEnterpriseEntitlement(siteId);
    const service = createServerSupabaseServiceClient();
    if (!service) {
      throw new MerchantEnterpriseAccessError("enterprise_store_unavailable", 503);
    }

    const employeeResult = await service
      .from("merchant_enterprise_employees")
      .select(
        "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at",
      )
      .eq("merchant_id", siteId)
      .eq("auth_user_id", text(user.id, 80))
      .in("status", ["invited", "active"])
      .limit(1)
      .maybeSingle();
    if (employeeResult.error) {
      throw new MerchantEnterpriseAccessError("merchant_employee_accept_failed", 503);
    }
    const employee = normalizeMerchantEnterpriseEmployee(employeeResult.data);
    if (!employee || !employee.roleId) {
      throw new MerchantEnterpriseAccessError("merchant_employee_not_invited", 403);
    }

    const roleResult = await service
      .from("merchant_enterprise_roles")
      .select("id")
      .eq("merchant_id", siteId)
      .eq("id", employee.roleId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (roleResult.error) {
      throw new MerchantEnterpriseAccessError("merchant_role_check_failed", 503);
    }
    if (!roleResult.data) {
      throw new MerchantEnterpriseAccessError("merchant_access_denied", 403);
    }

    if (employee.status === "active") {
      return NextResponse.json({ ok: true, employee });
    }

    const acceptedAt = new Date().toISOString();
    const activated = await service
      .from("merchant_enterprise_employees")
      .update({
        status: "active",
        accepted_at: acceptedAt,
        last_active_at: acceptedAt,
      })
      .eq("merchant_id", siteId)
      .eq("id", employee.id)
      .eq("auth_user_id", text(user.id, 80))
      .eq("status", "invited")
      .eq("version", employee.version)
      .select(
        "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at",
      )
      .maybeSingle();
    if (activated.error) {
      throw new MerchantEnterpriseAccessError("merchant_employee_accept_failed", 503);
    }
    const activeEmployee = normalizeMerchantEnterpriseEmployee(activated.data);
    if (activeEmployee?.status === "active") {
      return NextResponse.json({ ok: true, employee: activeEmployee });
    }

    // A simultaneous portal/session callback may have accepted the same invite.
    // Re-read the exact membership so acceptance stays idempotent.
    const current = await service
      .from("merchant_enterprise_employees")
      .select(
        "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at",
      )
      .eq("merchant_id", siteId)
      .eq("id", employee.id)
      .eq("auth_user_id", text(user.id, 80))
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (current.error) {
      throw new MerchantEnterpriseAccessError("merchant_employee_accept_failed", 503);
    }
    const concurrentlyAcceptedEmployee = normalizeMerchantEnterpriseEmployee(current.data);
    if (!concurrentlyAcceptedEmployee) {
      throw new MerchantEnterpriseAccessError("merchant_employee_accept_conflict", 409);
    }
    return NextResponse.json({ ok: true, employee: concurrentlyAcceptedEmployee });
  } catch (error) {
    return fail(error);
  }
}
