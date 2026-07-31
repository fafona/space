import { createHash, randomBytes } from "node:crypto";
import {
  isMerchantEnterpriseSchemaMissingError,
  normalizeMerchantEnterpriseEmployee,
  type MerchantEnterpriseEmployee,
} from "@/lib/merchantEnterprise";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";

export const MERCHANT_ENTERPRISE_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function errorText(error: unknown) {
  if (!error || typeof error !== "object") return "unknown_error";
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  return [value.code, value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(":")
    .toLowerCase();
}

function throwInvitationStoreError(operation: string, error: unknown): never {
  if (isMerchantEnterpriseSchemaMissingError(error)) {
    throw new Error("enterprise_schema_unavailable");
  }
  const message = errorText(error);
  const knownCode = [
    "enterprise_version_conflict",
    "employee_invitation_not_pending",
    "employee_invitation_revoked",
    "employee_invitation_expired",
    "employee_invitation_superseded",
    "employee_invitation_credentials_required",
    "employee_invitation_in_use",
    "employee_auth_user_conflict",
    "employee_not_found",
    "invalid_employee_invitation",
  ].find((code) => message.includes(code));
  if (knownCode) throw new Error(knownCode);
  throw new Error(`${operation}:${message}`);
}

function normalizeInvitationRemoval(
  value: unknown,
  operation: string,
): {
  removed: true;
  employeeId: string;
} {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const employeeId = normalizeText(record.employee_id ?? record.employeeId, 80);
  if (record.removed !== true || !employeeId) {
    throw new Error(`${operation}:invalid_response`);
  }
  return { removed: true, employeeId };
}

function normalizeInvitationMutation(
  value: unknown,
  operation: string,
): {
  employee: MerchantEnterpriseEmployee;
  invitationVersion: number;
  applied?: boolean;
  alreadyBound?: boolean;
} {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawEmployee =
    record.employee && typeof record.employee === "object" && !Array.isArray(record.employee)
      ? (record.employee as Record<string, unknown>)
      : {};
  const employee = normalizeMerchantEnterpriseEmployee(rawEmployee);
  const invitationVersion = Number(
    record.invitation_version ??
      rawEmployee.invitation_version ??
      rawEmployee.invitationVersion,
  );
  if (!employee || !Number.isSafeInteger(invitationVersion) || invitationVersion < 0) {
    throw new Error(`${operation}:invalid_response`);
  }
  return {
    employee,
    invitationVersion,
    ...(record.applied !== undefined ? { applied: record.applied === true } : {}),
    ...(record.already_bound !== undefined
      ? { alreadyBound: record.already_bound === true }
      : {}),
  };
}

export function createMerchantEnterpriseInvitationSecret() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
  };
}

export async function reserveMerchantEnterpriseEmployeeInvitation(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
    tokenHash: string;
    expiresAt?: string;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const version = Number(input.version);
  const tokenHash = normalizeText(input.tokenHash, 64).toLowerCase();
  const expiresAt =
    normalizeText(input.expiresAt, 80) ||
    new Date(Date.now() + MERCHANT_ENTERPRISE_INVITATION_TTL_MS).toISOString();
  if (
    !siteId ||
    !employeeId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !/^[a-f0-9]{64}$/.test(tokenHash) ||
    !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new Error("invalid_employee_invitation");
  }
  const result = await client.rpc("faolla_reserve_merchant_employee_invitation_v1", {
    p_input: {
      merchant_id: siteId,
      employee_id: employeeId,
      expected_version: version,
      token_hash: tokenHash,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
  if (result.error) {
    throwInvitationStoreError("enterprise_employee_invitation_reserve_failed", result.error);
  }
  return normalizeInvitationMutation(
    result.data,
    "enterprise_employee_invitation_reserve_failed",
  );
}

export async function revokeMerchantEnterpriseEmployeeInvitation(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const version = Number(input.version);
  if (!siteId || !employeeId || !Number.isSafeInteger(version) || version <= 0) {
    throw new Error("invalid_employee_invitation");
  }
  const result = await client.rpc("faolla_revoke_merchant_employee_invitation_v1", {
    p_input: {
      merchant_id: siteId,
      employee_id: employeeId,
      expected_version: version,
    },
  });
  if (result.error) {
    throwInvitationStoreError("enterprise_employee_invitation_revoke_failed", result.error);
  }
  return normalizeInvitationMutation(
    result.data,
    "enterprise_employee_invitation_revoke_failed",
  );
}

export async function removeMerchantEnterpriseEmployeeInvitation(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const version = Number(input.version);
  if (!siteId || !employeeId || !Number.isSafeInteger(version) || version <= 0) {
    throw new Error("invalid_employee_invitation");
  }
  const result = await client.rpc("faolla_remove_merchant_employee_invitation_v1", {
    p_input: {
      merchant_id: siteId,
      employee_id: employeeId,
      expected_version: version,
    },
  });
  if (result.error) {
    throwInvitationStoreError("enterprise_employee_invitation_remove_failed", result.error);
  }
  return normalizeInvitationRemoval(
    result.data,
    "enterprise_employee_invitation_remove_failed",
  );
}

export async function finalizeMerchantEnterpriseEmployeeInvitation(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    invitationVersion: number;
    deliveryStatus: "sent" | "failed";
    sentAt?: string | null;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const invitationVersion = Number(input.invitationVersion);
  if (
    !siteId ||
    !employeeId ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0
  ) {
    throw new Error("invalid_employee_invitation");
  }
  const result = await client.rpc("faolla_finalize_merchant_employee_invitation_v1", {
    p_input: {
      merchant_id: siteId,
      employee_id: employeeId,
      invitation_version: invitationVersion,
      delivery_status: input.deliveryStatus,
      ...(input.sentAt ? { sent_at: new Date(input.sentAt).toISOString() } : {}),
    },
  });
  if (result.error) {
    throwInvitationStoreError("enterprise_employee_invitation_finalize_failed", result.error);
  }
  return normalizeInvitationMutation(
    result.data,
    "enterprise_employee_invitation_finalize_failed",
  );
}

export async function bindMerchantEnterpriseEmployeeInvitationAuthUser(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    authUserId: string;
    version: number;
    invitationVersion: number;
  },
) {
  const siteId = normalizeText(input.siteId, 80);
  const employeeId = normalizeText(input.employeeId, 80);
  const authUserId = normalizeText(input.authUserId, 80);
  const version = Number(input.version);
  const invitationVersion = Number(input.invitationVersion);
  if (
    !siteId ||
    !employeeId ||
    !authUserId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0
  ) {
    throw new Error("invalid_employee_invitation");
  }
  const result = await client.rpc("faolla_bind_merchant_employee_auth_user_v1", {
    p_input: {
      merchant_id: siteId,
      employee_id: employeeId,
      auth_user_id: authUserId,
      expected_version: version,
      invitation_version: invitationVersion,
    },
  });
  if (result.error) {
    throwInvitationStoreError("enterprise_employee_auth_binding_failed", result.error);
  }
  return normalizeInvitationMutation(result.data, "enterprise_employee_auth_binding_failed");
}
