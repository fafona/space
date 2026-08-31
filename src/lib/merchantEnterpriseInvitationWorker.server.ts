import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";
import { isValidAuthEmail, normalizeAuthEmail } from "@/lib/authCredentialValidation";
import {
  MerchantEnterpriseInvitationEmailError,
  sendMerchantEnterpriseInvitationEmail,
  type MerchantEnterpriseInvitationEmailConfig,
} from "@/lib/merchantEnterpriseInvitationEmail.server";
import {
  deriveMerchantEnterpriseInvitationToken,
  type MerchantEnterpriseInvitationSecretKeyring,
} from "@/lib/merchantEnterpriseInvitationSecret.server";
import {
  hasImmutableMerchantStaffPrincipal,
  MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY,
  MERCHANT_STAFF_PRINCIPAL_TYPE,
} from "@/lib/merchantStaffPrincipal.server";
import type { MerchantOutboxRpcClient } from "@/lib/merchantOutboxEnqueue.server";
import type { MerchantOutboxClaimedEvent } from "@/lib/merchantOutbox.server";
import {
  MerchantOutboxTaskError,
  type MerchantOutboxEventSettlement,
  type MerchantOutboxTaskHandler,
} from "@/lib/merchantOutboxWorker.server";

export const MERCHANT_ENTERPRISE_INVITATION_OUTBOX_EVENT_TYPE =
  "enterprise.employee_invitation.deliver" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HMAC_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const STAFF_EMAIL_HASH_METADATA_KEY = "merchant_staff_email_hash";
const SAFE_FAILURE_CODES = new Set([
  "invitation_email_unavailable",
  "invitation_identity_unavailable",
  "staff_identity_conflict",
  "resend_rate_limited",
  "task_timeout",
  "task_aborted",
  "lease_expired",
  "worker_unavailable",
  "provider_unavailable",
]);

export type MerchantEnterpriseInvitationDeliveryEvent = {
  eventId: string;
  merchantId: string;
  employeeId: string;
  invitationVersion: number;
  hmacKeyId: string;
  replayCount: number;
};

export type MerchantEnterpriseInvitationPreparedDelivery =
  | {
      outcome: "deliver";
      email: string;
      employeeDisplayName: string;
      merchantDisplayName: string;
      authUserId: string | null;
      emailHash: string;
    }
  | {
      outcome: "accepted" | "revoked" | "removed" | "superseded";
    };

export type MerchantEnterpriseStaffIdentityLookup =
  | { status: "not_found" }
  | { status: "conflict" }
  | { status: "staff"; authUserId: string };

type AuthAdminResult<T> = Promise<{
  data: T;
  error: unknown;
}>;

export type MerchantEnterpriseInvitationAuthAdmin = {
  getUserById(userId: string): AuthAdminResult<{ user: User | null }>;
  updateUserById?: (
    userId: string,
    attributes: { app_metadata: Record<string, unknown> },
  ) => AuthAdminResult<{ user: User | null }>;
  createUser(attributes: {
    email: string;
    email_confirm: false;
    app_metadata: {
      principal_type: typeof MERCHANT_STAFF_PRINCIPAL_TYPE;
      merchant_staff_email_hash: string;
      merchant_staff_password_initialized: false;
    };
  }): AuthAdminResult<{ user: User | null }>;
};

export type MerchantEnterpriseInvitationWorkerDependencies = {
  keyring: MerchantEnterpriseInvitationSecretKeyring;
  emailConfig: MerchantEnterpriseInvitationEmailConfig;
  authAdmin: MerchantEnterpriseInvitationAuthAdmin;
  prepareDelivery: (input: {
    event: MerchantEnterpriseInvitationDeliveryEvent;
    workerId: string;
    tokenHash: string;
  }) => Promise<MerchantEnterpriseInvitationPreparedDelivery>;
  lookupStaffIdentity: (
    normalizedEmail: string,
  ) => Promise<MerchantEnterpriseStaffIdentityLookup>;
  bindStaffIdentity: (input: {
    event: MerchantEnterpriseInvitationDeliveryEvent;
    workerId: string;
    authUserId: string;
    emailHash: string;
    initialPasswordPolicy: "required" | "waived";
  }) => Promise<void>;
  sendEmail?: typeof sendMerchantEnterpriseInvitationEmail;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedEmailHash(value: unknown) {
  const email = normalizeAuthEmail(value);
  return createHash("sha256").update(email, "utf8").digest("hex");
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.toLowerCase();
  const record = recordValue(error);
  return trimText(record?.message).toLowerCase();
}

function throwMappedInvitationRpcError(error: unknown): never {
  const message = errorMessage(error);
  if (message.includes("merchant_enterprise_staff_identity_conflict")) {
    throw safeTaskError("staff_identity_conflict", { retryable: false });
  }
  if (message.includes("invitation_delivery_lease_lost")) {
    throw safeTaskError("lease_expired", { retryable: true });
  }
  if (
    message.includes("invitation_delivery_token_conflict") ||
    message.includes("invalid_invitation_delivery")
  ) {
    throw safeTaskError("worker_unavailable", { retryable: false });
  }
  throw safeTaskError("worker_unavailable", { retryable: true });
}

async function callInvitationRpc(
  client: MerchantOutboxRpcClient,
  functionName: string,
  args: Record<string, unknown>,
) {
  const result = await Promise.resolve(client.rpc(functionName, args));
  if (result.error) throw result.error;
  return result.data;
}

function safeTaskError(
  code: string,
  options: { retryable: boolean; retryAfterSeconds?: number },
) {
  return new MerchantOutboxTaskError(code, options);
}

export function normalizeMerchantEnterpriseInvitationDeliveryEvent(
  event: MerchantOutboxClaimedEvent,
): MerchantEnterpriseInvitationDeliveryEvent {
  const employeeId = trimText(event.aggregateId).toLowerCase();
  const payload = event.payload;
  const keys = Object.keys(payload).sort();
  const invitationVersion = Number(payload.invitation_version);
  const hmacKeyId = trimText(payload.hmac_key_id);
  if (
    event.eventType !== MERCHANT_ENTERPRISE_INVITATION_OUTBOX_EVENT_TYPE ||
    event.aggregateType !== "merchant_enterprise_employee" ||
    !UUID_PATTERN.test(employeeId) ||
    !/^\d{8}$/.test(event.merchantId) ||
    keys.length !== 3 ||
    keys[0] !== "hmac_key_id" ||
    keys[1] !== "invitation_version" ||
    keys[2] !== "schema_version" ||
    payload.schema_version !== 1 ||
    !Number.isSafeInteger(event.replayCount) ||
    event.replayCount < 0 ||
    !Number.isSafeInteger(invitationVersion) ||
    invitationVersion <= 0 ||
    !HMAC_KEY_ID_PATTERN.test(hmacKeyId) ||
    event.eventKey !==
      `enterprise-invitation/${employeeId}/${invitationVersion}`
  ) {
    throw safeTaskError("worker_unavailable", { retryable: false });
  }
  return {
    eventId: event.id.toLowerCase(),
    merchantId: event.merchantId,
    employeeId,
    invitationVersion,
    hmacKeyId,
    replayCount: event.replayCount,
  };
}

function normalizeUser(
  user: User | null | undefined,
  expected: {
    authUserId?: string;
    email: string;
  },
  options: { allowMissingEmailHash?: boolean } = {},
) {
  const authUserId = trimText(user?.id).toLowerCase();
  const email = normalizeAuthEmail(user?.email);
  const expectedEmailHash = normalizedEmailHash(expected.email);
  const actualEmailHash = trimText(
    user?.app_metadata?.[STAFF_EMAIL_HASH_METADATA_KEY],
  ).toLowerCase();
  if (
    !user ||
    !UUID_PATTERN.test(authUserId) ||
    (expected.authUserId && authUserId !== expected.authUserId.toLowerCase()) ||
    email !== expected.email ||
    !hasImmutableMerchantStaffPrincipal(user) ||
    (actualEmailHash !== expectedEmailHash &&
      !(options.allowMissingEmailHash && !actualEmailHash))
  ) {
    throw safeTaskError("staff_identity_conflict", { retryable: false });
  }
  return user;
}

async function getExactStaffUser(
  authAdmin: MerchantEnterpriseInvitationAuthAdmin,
  authUserId: string,
  email: string,
  options: { allowMissingEmailHash?: boolean } = {},
) {
  let result: Awaited<ReturnType<MerchantEnterpriseInvitationAuthAdmin["getUserById"]>>;
  try {
    result = await authAdmin.getUserById(authUserId);
  } catch {
    throw safeTaskError("invitation_identity_unavailable", { retryable: true });
  }
  if (result.error) {
    throw safeTaskError("invitation_identity_unavailable", { retryable: true });
  }
  return normalizeUser(result.data.user, { authUserId, email }, options);
}

async function upgradeBoundLegacyStaffEmailHash(
  dependencies: Pick<
    MerchantEnterpriseInvitationWorkerDependencies,
    "authAdmin" | "lookupStaffIdentity"
  >,
  user: User,
  email: string,
) {
  const currentEmailHash = trimText(
    user.app_metadata?.[STAFF_EMAIL_HASH_METADATA_KEY],
  ).toLowerCase();
  if (currentEmailHash) return normalizeUser(user, { authUserId: user.id, email });

  const lookup = await lookupIdentity(
    dependencies as MerchantEnterpriseInvitationWorkerDependencies,
    email,
  );
  if (
    lookup.status !== "staff" ||
    lookup.authUserId.toLowerCase() !== user.id.toLowerCase()
  ) {
    throw safeTaskError("staff_identity_conflict", { retryable: false });
  }
  if (!dependencies.authAdmin.updateUserById) {
    throw safeTaskError("invitation_identity_unavailable", { retryable: true });
  }
  const appMetadata = recordValue(user.app_metadata) ?? {};
  try {
    const updated = await dependencies.authAdmin.updateUserById(user.id, {
      app_metadata: {
        ...appMetadata,
        principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE,
        [STAFF_EMAIL_HASH_METADATA_KEY]: normalizedEmailHash(email),
      },
    });
    if (!updated.error && updated.data.user) {
      return normalizeUser(updated.data.user, { authUserId: user.id, email });
    }
  } catch {
    // The metadata update may have committed before its response was lost.
  }
  const recovered = await getExactStaffUser(
    dependencies.authAdmin,
    user.id,
    email,
    { allowMissingEmailHash: true },
  );
  const recoveredEmailHash = trimText(
    recovered.app_metadata?.[STAFF_EMAIL_HASH_METADATA_KEY],
  ).toLowerCase();
  if (!recoveredEmailHash) {
    throw safeTaskError("invitation_identity_unavailable", { retryable: true });
  }
  return normalizeUser(recovered, { authUserId: user.id, email });
}

async function lookupIdentity(
  dependencies: MerchantEnterpriseInvitationWorkerDependencies,
  email: string,
) {
  try {
    return await dependencies.lookupStaffIdentity(email);
  } catch (error) {
    if (error instanceof MerchantOutboxTaskError) throw error;
    throw safeTaskError("invitation_identity_unavailable", { retryable: true });
  }
}

export async function ensureMerchantEnterpriseInvitationStaffUser(
  input: {
    email: string;
    authUserId: string | null;
  },
  dependencies: Pick<
    MerchantEnterpriseInvitationWorkerDependencies,
    "authAdmin" | "lookupStaffIdentity"
  >,
) {
  const email = normalizeAuthEmail(input.email);
  if (!isValidAuthEmail(email)) {
    throw safeTaskError("staff_identity_conflict", { retryable: false });
  }
  if (input.authUserId) {
    if (!UUID_PATTERN.test(input.authUserId)) {
      throw safeTaskError("staff_identity_conflict", { retryable: false });
    }
    const user = await getExactStaffUser(
      dependencies.authAdmin,
      input.authUserId,
      email,
      { allowMissingEmailHash: true },
    );
    return upgradeBoundLegacyStaffEmailHash(dependencies, user, email);
  }

  let lookup = await lookupIdentity(
    dependencies as MerchantEnterpriseInvitationWorkerDependencies,
    email,
  );
  if (lookup.status === "conflict") {
    throw safeTaskError("staff_identity_conflict", { retryable: false });
  }
  if (lookup.status === "staff") {
    return getExactStaffUser(dependencies.authAdmin, lookup.authUserId, email);
  }

  let created: Awaited<ReturnType<MerchantEnterpriseInvitationAuthAdmin["createUser"]>>;
  try {
    created = await dependencies.authAdmin.createUser({
      email,
      email_confirm: false,
      app_metadata: {
        principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE,
        merchant_staff_email_hash: normalizedEmailHash(email),
        [MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY]: false,
      },
    });
  } catch {
    created = { data: { user: null }, error: new Error("auth_create_failed") };
  }
  if (!created.error && created.data.user) {
    return normalizeUser(created.data.user, { email });
  }

  // createUser can commit and still lose its response. The exact registry is
  // the only accepted recovery path; never scan or promote mutable metadata.
  lookup = await lookupIdentity(
    dependencies as MerchantEnterpriseInvitationWorkerDependencies,
    email,
  );
  if (lookup.status === "conflict") {
    throw safeTaskError("staff_identity_conflict", { retryable: false });
  }
  if (lookup.status === "staff") {
    return getExactStaffUser(dependencies.authAdmin, lookup.authUserId, email);
  }
  throw safeTaskError("invitation_identity_unavailable", { retryable: true });
}

function throwMappedEmailError(error: unknown): never {
  if (!(error instanceof MerchantEnterpriseInvitationEmailError)) {
    throw safeTaskError("provider_unavailable", { retryable: true });
  }
  if (error.code === "invitation_email_provider_temporarily_unavailable") {
    throw safeTaskError(
      error.retryAfterSeconds ? "resend_rate_limited" : "provider_unavailable",
      {
        retryable: true,
        retryAfterSeconds: error.retryAfterSeconds,
      },
    );
  }
  if (error.code === "invitation_email_aborted") {
    throw safeTaskError("task_aborted", { retryable: true });
  }
  throw safeTaskError("invitation_email_unavailable", { retryable: false });
}

export function createMerchantEnterpriseInvitationOutboxHandler(
  dependencies: MerchantEnterpriseInvitationWorkerDependencies,
): MerchantOutboxTaskHandler {
  return async (claimedEvent, context) => {
    const event = normalizeMerchantEnterpriseInvitationDeliveryEvent(claimedEvent);
    const workerId = trimText(context.workerId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(workerId)) {
      throw safeTaskError("worker_unavailable", { retryable: false });
    }
    const derived = deriveMerchantEnterpriseInvitationToken(
      {
        eventId: event.eventId,
        siteId: event.merchantId,
        employeeId: event.employeeId,
        invitationVersion: event.invitationVersion,
        keyId: event.hmacKeyId,
      },
      dependencies.keyring,
    );
    if (context.signal.aborted) {
      throw safeTaskError("task_aborted", { retryable: true });
    }
    const prepared = await dependencies.prepareDelivery({
      event,
      workerId,
      tokenHash: derived.tokenHash,
    });
    if (prepared.outcome !== "deliver") {
      throw safeTaskError("worker_unavailable", { retryable: false });
    }
    if (!(await context.renewLease())) {
      throw safeTaskError("lease_expired", { retryable: true });
    }
    const user = await ensureMerchantEnterpriseInvitationStaffUser(
      { email: prepared.email, authUserId: prepared.authUserId },
      dependencies,
    );
    await dependencies.bindStaffIdentity({
      event,
      workerId,
      authUserId: user.id,
      emailHash: prepared.emailHash,
      initialPasswordPolicy:
        user.app_metadata?.[
          MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY
        ] === false
          ? "required"
          : "waived",
    });
    if (!(await context.renewLease())) {
      throw safeTaskError("lease_expired", { retryable: true });
    }
    try {
      await (dependencies.sendEmail ?? sendMerchantEnterpriseInvitationEmail)(
        {
          eventId: event.eventId,
          replayCount: event.replayCount,
          siteId: event.merchantId,
          employeeId: event.employeeId,
          invitationVersion: event.invitationVersion,
          invitationToken: derived.token,
          recipientEmail: prepared.email,
          employeeDisplayName: prepared.employeeDisplayName,
          merchantDisplayName: prepared.merchantDisplayName,
          signal: context.signal,
        },
        { config: dependencies.emailConfig },
      );
    } catch (error) {
      throwMappedEmailError(error);
    }
    return {
      status: "sent",
      invitation_version: event.invitationVersion,
    };
  };
}

function normalizeSettlementFailureCode(code: string) {
  return SAFE_FAILURE_CODES.has(code) ? code : "worker_unavailable";
}

export function createMerchantEnterpriseInvitationOutboxSettlement(input: {
  complete: (payload: Record<string, unknown>) => Promise<unknown>;
  fail: (payload: Record<string, unknown>) => Promise<unknown>;
}): MerchantOutboxEventSettlement {
  return {
    async complete({ event, workerId }) {
      const value = await input.complete({
        event_id: event.id,
        worker_id: workerId,
      });
      const record = recordValue(value);
      return (
        trimText(record?.event_id).toLowerCase() === event.id.toLowerCase() &&
        trimText(record?.delivery_status) === "sent" &&
        Number(record?.invitation_version) ===
          Number(event.payload.invitation_version)
      );
    },
    async fail({ event, workerId, error }) {
      const code = normalizeSettlementFailureCode(error.code);
      const payload: Record<string, unknown> = {
        event_id: event.id,
        worker_id: workerId,
        error_code: code,
        retryable: error.retryable,
      };
      if (error.retryAfterSeconds !== undefined) {
        payload.retry_after_seconds = error.retryAfterSeconds;
      }
      const value = await input.fail(payload);
      const status =
        value && typeof value === "object"
          ? trimText((value as { status?: unknown }).status)
          : "";
      return status === "retry_scheduled" || status === "dead_lettered"
        ? status
        : "lease_lost";
    },
  };
}

export function createMerchantEnterpriseInvitationOutboxRpcSettlement(
  client: MerchantOutboxRpcClient,
) {
  return createMerchantEnterpriseInvitationOutboxSettlement({
    complete: (payload) =>
      callInvitationRpc(
        client,
        "faolla_complete_merchant_employee_invitation_delivery_v1",
        { p_input: payload },
      ),
    fail: (payload) =>
      callInvitationRpc(
        client,
        "faolla_fail_merchant_employee_invitation_delivery_v1",
        { p_input: payload },
      ),
  });
}

export function createMerchantEnterpriseInvitationRpcDependencies(
  client: MerchantOutboxRpcClient & {
    auth: { admin: MerchantEnterpriseInvitationAuthAdmin };
  },
  input: {
    keyring: MerchantEnterpriseInvitationSecretKeyring;
    emailConfig: MerchantEnterpriseInvitationEmailConfig;
  },
): MerchantEnterpriseInvitationWorkerDependencies {
  return {
    ...input,
    authAdmin: client.auth.admin,
    async prepareDelivery({ event, workerId, tokenHash }) {
      let data: unknown;
      try {
        data = await callInvitationRpc(
          client,
          "faolla_prepare_merchant_employee_invitation_delivery_v1",
          {
            p_input: {
              event_id: event.eventId,
              worker_id: workerId,
              token_hash: tokenHash,
            },
          },
        );
      } catch (error) {
        if (errorMessage(error).includes("employee_invitation_superseded")) {
          return { outcome: "superseded" };
        }
        throwMappedInvitationRpcError(error);
      }
      const row = recordValue(data);
      const email = normalizeAuthEmail(row?.email);
      const emailHash = trimText(row?.email_hash).toLowerCase();
      const authUserId = trimText(row?.auth_user_id).toLowerCase();
      const invitationExpiresAt = trimText(row?.invitation_expires_at);
      if (
        trimText(row?.event_id).toLowerCase() !== event.eventId ||
        trimText(row?.merchant_id) !== event.merchantId ||
        trimText(row?.employee_id).toLowerCase() !== event.employeeId ||
        Number(row?.invitation_version) !== event.invitationVersion ||
        trimText(row?.hmac_key_id) !== event.hmacKeyId ||
        !isValidAuthEmail(email) ||
        emailHash !== normalizedEmailHash(email) ||
        (authUserId && !UUID_PATTERN.test(authUserId)) ||
        !Number.isFinite(Date.parse(invitationExpiresAt))
      ) {
        throw safeTaskError("worker_unavailable", { retryable: false });
      }
      return {
        outcome: "deliver",
        email,
        emailHash,
        employeeDisplayName: "",
        merchantDisplayName: "",
        authUserId: authUserId || null,
      };
    },
    async lookupStaffIdentity(normalizedEmail) {
      let data: unknown;
      try {
        data = await callInvitationRpc(
          client,
          "faolla_lookup_merchant_enterprise_staff_identity_v1",
          { p_email_hash: normalizedEmailHash(normalizedEmail) },
        );
      } catch (error) {
        if (errorMessage(error).includes("merchant_enterprise_staff_identity_conflict")) {
          throw safeTaskError("staff_identity_conflict", { retryable: false });
        }
        throw safeTaskError("invitation_identity_unavailable", {
          retryable: true,
        });
      }
      const row = recordValue(data);
      const found = row?.found;
      const authUserId = trimText(row?.auth_user_id).toLowerCase();
      if (found === false && !authUserId) return { status: "not_found" };
      if (found === true && UUID_PATTERN.test(authUserId)) {
        return { status: "staff", authUserId };
      }
      throw safeTaskError("invitation_identity_unavailable", {
        retryable: true,
      });
    },
    async bindStaffIdentity({
      event,
      workerId,
      authUserId,
      emailHash,
      initialPasswordPolicy,
    }) {
      try {
        await callInvitationRpc(
          client,
          "faolla_bind_merchant_employee_invitation_identity_v2",
          {
            p_input: {
              event_id: event.eventId,
              worker_id: workerId,
              auth_user_id: authUserId,
              email_hash: emailHash,
              initial_password_policy: initialPasswordPolicy,
            },
          },
        );
      } catch (error) {
        throwMappedInvitationRpcError(error);
      }
    },
  };
}
