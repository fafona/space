import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeMerchantEnterpriseEmployee,
  type MerchantEnterpriseEmployee,
} from "@/lib/merchantEnterprise";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";

const RECOVERY_EMPLOYEE_COLUMNS =
  "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at";

/** Only the waiver's exact typed rejection can enter read-only recovery. */
export function isAcceptedInvitationRecoveryCandidate(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && !Array.isArray(error) &&
    (error as { message?: unknown }).message === "employee_invitation_invalid_or_expired");
}

/**
 * Recover an already-accepted membership, not the old invitation bearer proof.
 * The caller must first validate password authentication, current Auth metadata
 * and enterprise entitlement. This never activates an invitation or authorizes
 * business access; those paths retain their existing role/permission checks.
 */
export async function recoverAcceptedMerchantEmployeeInvitation(
  service: SupabaseClient,
  input: { siteId: string; authUserId: string; invitationVersion: number },
): Promise<MerchantEnterpriseEmployee | null> {
  try {
    const { data, error } = await service
      .from("merchant_enterprise_employees")
      .select(RECOVERY_EMPLOYEE_COLUMNS)
      .eq("merchant_id", input.siteId)
      .eq("auth_user_id", input.authUserId)
      .eq("status", "active")
      .eq("invitation_version", input.invitationVersion)
      .not("accepted_at", "is", null)
      .is("invitation_revoked_at", null)
      .is("invitation_token_hash", null)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const employee = normalizeMerchantEnterpriseEmployee(data);
    if (!employee || employee.siteId !== input.siteId || employee.authUserId !== input.authUserId ||
      employee.invitationVersion !== input.invitationVersion || employee.status !== "active" ||
      !employee.acceptedAt || employee.invitationRevokedAt !== null || data.invitation_revoked_at !== null ||
      !employee.id || !employee.roleId) return null;
    return employee;
  } catch {
    // Never expose SQL, invitation hashes or service details through this path.
    throw new MerchantEnterpriseAccessError("merchant_employee_accept_failed", 503);
  }
}
