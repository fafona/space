import { createHash, randomBytes } from "node:crypto";
import {
  isMerchantEnterpriseSchemaMissingError,
  normalizeMerchantEnterpriseEmployee,
  type MerchantEnterpriseEmployee,
} from "@/lib/merchantEnterprise";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";
import { normalizeMutationOperationId } from "@/lib/mutationOperationId";

export const MERCHANT_ENTERPRISE_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MERCHANT_ENTERPRISE_INVITATION_ACTOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MERCHANT_ENTERPRISE_INVITATION_HMAC_KEY_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export const MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE_ENV =
  "MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE";
export const MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_ENV =
  "MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID";

export type MerchantEnterpriseInvitationDeliveryMode = "legacy" | "outbox";

export type MerchantEnterpriseQueuedInvitation = {
  employee: MerchantEnterpriseEmployee;
  invitationVersion: number;
  eventId: string;
  deliveryStatus: "queued" | "already_queued";
  replayed: boolean;
  retryAfterSeconds?: number;
};

type MerchantEnterpriseInvitationMutationActor = {
  actorType: "owner" | "employee";
  actorId: string;
};

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

function normalizeInvitationMutationActor(
  input: { actorType: unknown; actorId: unknown },
): MerchantEnterpriseInvitationMutationActor {
  const actorId = normalizeText(input.actorId, 80);
  if (
    (input.actorType !== "owner" && input.actorType !== "employee") ||
    !MERCHANT_ENTERPRISE_INVITATION_ACTOR_ID_PATTERN.test(actorId)
  ) {
    throw new Error("invalid_enterprise_actor");
  }
  return { actorType: input.actorType, actorId };
}

export function resolveMerchantEnterpriseInvitationDeliveryMode(
  environment: Record<string, string | undefined> = process.env,
): MerchantEnterpriseInvitationDeliveryMode {
  const mode = normalizeText(
    environment[MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE_ENV],
    20,
  ).toLowerCase();
  if (!mode || mode === "legacy") return "legacy";
  if (mode === "outbox") return "outbox";
  throw new Error("enterprise_invitation_delivery_mode_invalid");
}

export function resolveMerchantEnterpriseInvitationActiveHmacKeyId(
  environment: Record<string, string | undefined> = process.env,
) {
  const keyId = normalizeText(
    environment[MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID_ENV],
    32,
  );
  if (!MERCHANT_ENTERPRISE_INVITATION_HMAC_KEY_ID_PATTERN.test(keyId)) {
    throw new Error("enterprise_invitation_hmac_active_key_invalid");
  }
  return keyId;
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
    "employee_invitation_renew_required",
    "employee_invitation_renew_not_required",
    "employee_invitation_credentials_required",
    "employee_invitation_in_use",
    "employee_invitation_cooldown",
    "invitation_delivery_cooldown",
    "employee_invitation_delivery_unavailable",
    "enterprise_idempotency_conflict",
    "employee_auth_user_conflict",
    "employee_email_in_use",
    "employee_not_found",
    "invalid_employee_invitation",
    "invalid_employee_invitation_delivery",
    "invalid_employee_role",
    "invalid_enterprise_actor",
    "permission_escalation_denied",
    "permission_denied",
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

function normalizeQueuedInvitation(
  value: unknown,
  operation: string,
): MerchantEnterpriseQueuedInvitation {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const employee = normalizeMerchantEnterpriseEmployee(record.employee);
  const invitationVersion = Number(record.invitation_version);
  const eventId = normalizeText(record.event_id, 80).toLowerCase();
  const deliveryStatus = normalizeText(record.delivery_status, 40);
  const retryAfterSeconds = Number(record.retry_after_seconds);
  if (
    !employee ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0 ||
    !MERCHANT_ENTERPRISE_INVITATION_ACTOR_ID_PATTERN.test(eventId) ||
    (deliveryStatus !== "queued" && deliveryStatus !== "already_queued") ||
    (record.retry_after_seconds !== undefined &&
      (!Number.isSafeInteger(retryAfterSeconds) ||
        retryAfterSeconds < 1 ||
        retryAfterSeconds > 86_400))
  ) {
    throw new Error(`${operation}:invalid_response`);
  }
  return {
    employee,
    invitationVersion,
    eventId,
    deliveryStatus,
    replayed: record.replayed === true,
    ...(record.retry_after_seconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

function normalizeReliableInvitationInput(input: {
  operationId: unknown;
  hmacKeyId: unknown;
}) {
  const rawOperationId = normalizeText(input.operationId, 120);
  const operationId = normalizeMutationOperationId(rawOperationId);
  const hmacKeyId = normalizeText(input.hmacKeyId, 32);
  if (
    !rawOperationId ||
    operationId !== rawOperationId ||
    !MERCHANT_ENTERPRISE_INVITATION_HMAC_KEY_ID_PATTERN.test(hmacKeyId)
  ) {
    throw new Error("invalid_employee_invitation_delivery");
  }
  return { operationId, hmacKeyId };
}

export function createMerchantEnterpriseInvitationSecret() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
  };
}

export async function createMerchantEnterpriseEmployeeInvitationV2(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    email: string;
    displayName: string;
    roleId: string;
    operationId: string;
    hmacKeyId: string;
  } & MerchantEnterpriseInvitationMutationActor,
) {
  const actor = normalizeInvitationMutationActor(input);
  const reliable = normalizeReliableInvitationInput(input);
  const siteId = normalizeText(input.siteId, 8);
  const email = normalizeText(input.email, 254).toLowerCase();
  const displayName = normalizeText(input.displayName, 120);
  const roleId = normalizeText(input.roleId, 80).toLowerCase();
  if (
    !/^\d{8}$/.test(siteId) ||
    !email ||
    !displayName ||
    !MERCHANT_ENTERPRISE_INVITATION_ACTOR_ID_PATTERN.test(roleId)
  ) {
    throw new Error("invalid_employee_invitation_delivery");
  }
  const result = await client.rpc(
    "faolla_create_merchant_enterprise_employee_invitation_v2",
    {
      p_input: {
        merchant_id: siteId,
        email,
        display_name: displayName,
        role_id: roleId,
        operation_id: reliable.operationId,
        hmac_key_id: reliable.hmacKeyId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
      },
    },
  );
  if (result.error) {
    throwInvitationStoreError(
      "enterprise_employee_invitation_create_failed",
      result.error,
    );
  }
  return normalizeQueuedInvitation(
    result.data,
    "enterprise_employee_invitation_create_failed",
  );
}

export async function scheduleMerchantEnterpriseEmployeeInvitationDeliveryV2(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
    action: "resend" | "renew";
    operationId: string;
    hmacKeyId: string;
  } & MerchantEnterpriseInvitationMutationActor,
) {
  const actor = normalizeInvitationMutationActor(input);
  const reliable = normalizeReliableInvitationInput(input);
  const siteId = normalizeText(input.siteId, 8);
  const employeeId = normalizeText(input.employeeId, 80).toLowerCase();
  const version = Number(input.version);
  if (
    !/^\d{8}$/.test(siteId) ||
    !MERCHANT_ENTERPRISE_INVITATION_ACTOR_ID_PATTERN.test(employeeId) ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    (input.action !== "resend" && input.action !== "renew")
  ) {
    throw new Error("invalid_employee_invitation_delivery");
  }
  const result = await client.rpc(
    "faolla_schedule_merchant_employee_invitation_delivery_v2",
    {
      p_input: {
        merchant_id: siteId,
        employee_id: employeeId,
        expected_version: version,
        action: input.action,
        operation_id: reliable.operationId,
        hmac_key_id: reliable.hmacKeyId,
        actor_type: actor.actorType,
        actor_id: actor.actorId,
      },
    },
  );
  if (result.error) {
    throwInvitationStoreError(
      "enterprise_employee_invitation_schedule_failed",
      result.error,
    );
  }
  return normalizeQueuedInvitation(
    result.data,
    "enterprise_employee_invitation_schedule_failed",
  );
}

export async function reserveMerchantEnterpriseEmployeeInvitation(
  client: MerchantEnterpriseStoreClient,
  input: {
    siteId: string;
    employeeId: string;
    version: number;
    tokenHash: string;
    expiresAt?: string;
  } & MerchantEnterpriseInvitationMutationActor,
) {
  const actor = normalizeInvitationMutationActor(input);
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
      actor_type: actor.actorType,
      actor_id: actor.actorId,
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
  } & MerchantEnterpriseInvitationMutationActor,
) {
  const actor = normalizeInvitationMutationActor(input);
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
      actor_type: actor.actorType,
      actor_id: actor.actorId,
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
  } & MerchantEnterpriseInvitationMutationActor,
) {
  const actor = normalizeInvitationMutationActor(input);
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
      actor_type: actor.actorType,
      actor_id: actor.actorId,
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
