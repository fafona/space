import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { merchantEmployeeInvitationAcceptError } from "@/app/api/merchant-enterprise/employees/accept/route";
import {
  getMerchantEnterpriseEmployeeStatusTransitionError,
  getMerchantEnterpriseInvitationActionError,
} from "@/app/api/merchant-enterprise/employees/route";
import { normalizeMerchantEnterpriseEmployee } from "@/lib/merchantEnterprise";
import {
  bindMerchantEnterpriseEmployeeInvitationAuthUser,
  createMerchantEnterpriseEmployeeInvitationV2,
  createMerchantEnterpriseInvitationSecret,
  finalizeMerchantEnterpriseEmployeeInvitation,
  removeMerchantEnterpriseEmployeeInvitation,
  reserveMerchantEnterpriseEmployeeInvitation,
  resolveMerchantEnterpriseInvitationActiveHmacKeyId,
  resolveMerchantEnterpriseInvitationDeliveryMode,
  revokeMerchantEnterpriseEmployeeInvitation,
  scheduleMerchantEnterpriseEmployeeInvitationDeliveryV2,
} from "@/lib/merchantEnterpriseInvitationStore.server";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";

const employeeId = "77777777-7777-4777-8777-777777777777";
const authUserId = "88888888-8888-4888-8888-888888888888";
const roleId = "99999999-9999-4999-8999-999999999999";
const ownerActor = {
  actorType: "owner",
  actorId: authUserId,
} as const;

function employeeRow(input: {
  version?: number;
  invitationVersion?: number;
  authUserId?: string | null;
  status?: "invited" | "active" | "disabled";
}) {
  return {
    id: employeeId,
    merchant_id: "10000000",
    auth_user_id:
      input.authUserId === undefined ? authUserId : input.authUserId,
    email: "staff@example.com",
    display_name: "Staff",
    role_id: roleId,
    status: input.status ?? "invited",
    invited_at: "2026-07-31T10:00:00.000Z",
    accepted_at: input.status === "active" ? "2026-07-31T10:01:00.000Z" : null,
    last_active_at: input.status === "active" ? "2026-07-31T10:01:00.000Z" : null,
    invitation_version: input.invitationVersion ?? 3,
    invitation_expires_at: "2026-08-07T10:00:00.000Z",
    invitation_revoked_at: null,
    invitation_sent_at: "2026-07-31T10:00:01.000Z",
    invitation_delivery_status: "sent",
    version: input.version ?? 8,
    created_at: "2026-07-31T09:59:00.000Z",
    updated_at: "2026-07-31T10:00:01.000Z",
  };
}

function rpcClient(
  handler: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
) {
  return {
    from() {
      throw new Error("invitation lifecycle mutations must use RPCs");
    },
    rpc: handler,
  } as unknown as MerchantEnterpriseStoreClient;
}

test("invitation secrets are high-entropy URL-safe values and only their SHA-256 digest is persisted", async () => {
  const secret = createMerchantEnterpriseInvitationSecret();
  assert.match(secret.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(secret.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(
    secret.tokenHash,
    createHash("sha256").update(secret.token, "utf8").digest("hex"),
  );

  let captured:
    | { functionName: string; args: Record<string, unknown> }
    | undefined;
  const client = rpcClient(async (functionName, args) => {
    captured = { functionName, args };
    return {
      data: {
        employee: employeeRow({ invitationVersion: 1, version: 2 }),
        invitation_version: 1,
      },
      error: null,
    };
  });
  const result = await reserveMerchantEnterpriseEmployeeInvitation(client, {
    siteId: "10000000",
    employeeId,
    version: 1,
    tokenHash: secret.tokenHash,
    expiresAt: "2026-08-07T10:00:00.000Z",
    ...ownerActor,
  });

  assert.equal(
    captured?.functionName,
    "faolla_reserve_merchant_employee_invitation_v1",
  );
  assert.deepEqual(captured?.args, {
    p_input: {
      merchant_id: "10000000",
      employee_id: employeeId,
      expected_version: 1,
      token_hash: secret.tokenHash,
      expires_at: "2026-08-07T10:00:00.000Z",
      actor_type: "owner",
      actor_id: authUserId,
    },
  });
  assert.doesNotMatch(JSON.stringify(captured?.args), new RegExp(secret.token));
  assert.equal(result.invitationVersion, 1);
  assert.equal(result.employee.id, employeeId);
});

test("reliable invitation delivery mode and active HMAC key fail closed", () => {
  assert.equal(resolveMerchantEnterpriseInvitationDeliveryMode({}), "legacy");
  assert.equal(
    resolveMerchantEnterpriseInvitationDeliveryMode({
      MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE: "outbox",
    }),
    "outbox",
  );
  assert.throws(
    () =>
      resolveMerchantEnterpriseInvitationDeliveryMode({
        MERCHANT_ENTERPRISE_INVITATION_DELIVERY_MODE: "enabled",
      }),
    /enterprise_invitation_delivery_mode_invalid/,
  );
  assert.equal(
    resolveMerchantEnterpriseInvitationActiveHmacKeyId({
      MERCHANT_ENTERPRISE_INVITATION_HMAC_ACTIVE_KEY_ID: "v1",
    }),
    "v1",
  );
  assert.throws(
    () => resolveMerchantEnterpriseInvitationActiveHmacKeyId({}),
    /enterprise_invitation_hmac_active_key_invalid/,
  );
});

test("reliable employee creation atomically requests a queued invitation without a token", async () => {
  let captured:
    | { functionName: string; args: Record<string, unknown> }
    | undefined;
  const eventId = "123e4567-e89b-42d3-a456-426614174000";
  const client = rpcClient(async (functionName, args) => {
    captured = { functionName, args };
    return {
      data: {
        employee: employeeRow({ invitationVersion: 1, version: 2, authUserId: null }),
        invitation_version: 1,
        event_id: eventId,
        delivery_status: "queued",
        replayed: false,
      },
      error: null,
    };
  });
  const result = await createMerchantEnterpriseEmployeeInvitationV2(client, {
    siteId: "10000000",
    email: "staff@example.com",
    displayName: "Staff",
    roleId,
    operationId: "enterprise-employee-invite:one",
    hmacKeyId: "v1",
    ...ownerActor,
  });

  assert.equal(
    captured?.functionName,
    "faolla_create_merchant_enterprise_employee_invitation_v2",
  );
  assert.deepEqual(captured?.args, {
    p_input: {
      merchant_id: "10000000",
      email: "staff@example.com",
      display_name: "Staff",
      role_id: roleId,
      operation_id: "enterprise-employee-invite:one",
      hmac_key_id: "v1",
      actor_type: "owner",
      actor_id: authUserId,
    },
  });
  assert.equal(result.deliveryStatus, "queued");
  assert.equal(result.eventId, eventId);
  assert.doesNotMatch(JSON.stringify(captured?.args), /token/i);
});

test("reliable resend and renew schedule a generation using exact CAS and operation ids", async () => {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const client = rpcClient(async (functionName, args) => {
    calls.push({ functionName, args });
    return {
      data: {
        employee: employeeRow({ invitationVersion: 4, version: 12 }),
        invitation_version: 4,
        event_id: "223e4567-e89b-42d3-a456-426614174000",
        delivery_status: "already_queued",
        replayed: false,
        retry_after_seconds: 31,
      },
      error: null,
    };
  });
  const result = await scheduleMerchantEnterpriseEmployeeInvitationDeliveryV2(
    client,
    {
      siteId: "10000000",
      employeeId,
      version: 11,
      action: "resend",
      operationId: "enterprise-employee-resend:one",
      hmacKeyId: "v1",
      ...ownerActor,
    },
  );
  assert.equal(
    calls[0]?.functionName,
    "faolla_schedule_merchant_employee_invitation_delivery_v2",
  );
  assert.deepEqual(calls[0]?.args, {
    p_input: {
      merchant_id: "10000000",
      employee_id: employeeId,
      expected_version: 11,
      action: "resend",
      operation_id: "enterprise-employee-resend:one",
      hmac_key_id: "v1",
      actor_type: "owner",
      actor_id: authUserId,
    },
  });
  assert.equal(result.deliveryStatus, "already_queued");
  assert.equal(result.retryAfterSeconds, 31);
});

test("reserve rejects a raw invitation token before any database call", async () => {
  let called = false;
  const client = rpcClient(async () => {
    called = true;
    return { data: null, error: null };
  });
  await assert.rejects(
    reserveMerchantEnterpriseEmployeeInvitation(client, {
      siteId: "10000000",
      employeeId,
      version: 1,
      tokenHash: "raw-invitation-token",
      expiresAt: "2026-08-07T10:00:00.000Z",
      ...ownerActor,
    }),
    /invalid_employee_invitation/,
  );
  assert.equal(called, false);
});

test("invitation reserve, revoke and remove reject malformed actors before any database call", async () => {
  let calls = 0;
  const client = rpcClient(async () => {
    calls += 1;
    return { data: null, error: null };
  });
  const invalidActor = {
    actorType: "owner" as const,
    actorId: "not-an-actor-id",
  };

  await assert.rejects(
    reserveMerchantEnterpriseEmployeeInvitation(client, {
      siteId: "10000000",
      employeeId,
      version: 1,
      tokenHash: "a".repeat(64),
      expiresAt: "2026-08-07T10:00:00.000Z",
      ...invalidActor,
    }),
    /^Error: invalid_enterprise_actor$/,
  );
  await assert.rejects(
    revokeMerchantEnterpriseEmployeeInvitation(client, {
      siteId: "10000000",
      employeeId,
      version: 1,
      ...invalidActor,
    }),
    /^Error: invalid_enterprise_actor$/,
  );
  await assert.rejects(
    removeMerchantEnterpriseEmployeeInvitation(client, {
      siteId: "10000000",
      employeeId,
      version: 1,
      ...invalidActor,
    }),
    /^Error: invalid_enterprise_actor$/,
  );
  assert.equal(calls, 0);
});

test("finalize accepts the RPC contract's row-level invitation generation and sends exact CAS parameters", async () => {
  let captured:
    | { functionName: string; args: Record<string, unknown> }
    | undefined;
  const client = rpcClient(async (functionName, args) => {
    captured = { functionName, args };
    return {
      data: {
        employee: employeeRow({ invitationVersion: 4, version: 11 }),
        applied: true,
      },
      error: null,
    };
  });
  const result = await finalizeMerchantEnterpriseEmployeeInvitation(client, {
    siteId: "10000000",
    employeeId,
    invitationVersion: 4,
    deliveryStatus: "sent",
    sentAt: "2026-07-31T10:00:01.000Z",
  });

  assert.equal(
    captured?.functionName,
    "faolla_finalize_merchant_employee_invitation_v1",
  );
  assert.deepEqual(captured?.args, {
    p_input: {
      merchant_id: "10000000",
      employee_id: employeeId,
      invitation_version: 4,
      delivery_status: "sent",
      sent_at: "2026-07-31T10:00:01.000Z",
    },
  });
  assert.equal(result.invitationVersion, 4);
  assert.equal(result.applied, true);
  assert.equal(result.employee.version, 11);
});

test("auth binding accepts the RPC contract's row-level invitation generation and sends both CAS versions", async () => {
  let captured:
    | { functionName: string; args: Record<string, unknown> }
    | undefined;
  const client = rpcClient(async (functionName, args) => {
    captured = { functionName, args };
    return {
      data: {
        employee: employeeRow({
          invitationVersion: 4,
          version: 10,
          authUserId,
        }),
        already_bound: false,
      },
      error: null,
    };
  });
  const result = await bindMerchantEnterpriseEmployeeInvitationAuthUser(client, {
    siteId: "10000000",
    employeeId,
    authUserId,
    version: 9,
    invitationVersion: 4,
  });

  assert.equal(
    captured?.functionName,
    "faolla_bind_merchant_employee_auth_user_v1",
  );
  assert.deepEqual(captured?.args, {
    p_input: {
      merchant_id: "10000000",
      employee_id: employeeId,
      auth_user_id: authUserId,
      expected_version: 9,
      invitation_version: 4,
    },
  });
  assert.equal(result.invitationVersion, 4);
  assert.equal(result.alreadyBound, false);
  assert.equal(result.employee.authUserId, authUserId);
});

test("revocation sends the employee row version and actor context and normalizes its rotated generation", async () => {
  let captured:
    | { functionName: string; args: Record<string, unknown> }
    | undefined;
  const client = rpcClient(async (functionName, args) => {
    captured = { functionName, args };
    return {
      data: {
        employee: {
          ...employeeRow({ invitationVersion: 5, version: 12 }),
          invitation_revoked_at: "2026-07-31T10:02:00.000Z",
          invitation_delivery_status: "revoked",
        },
        invitation_version: 5,
      },
      error: null,
    };
  });
  const result = await revokeMerchantEnterpriseEmployeeInvitation(client, {
    siteId: "10000000",
    employeeId,
    version: 11,
    ...ownerActor,
  });

  assert.equal(
    captured?.functionName,
    "faolla_revoke_merchant_employee_invitation_v1",
  );
  assert.deepEqual(captured?.args, {
    p_input: {
      merchant_id: "10000000",
      employee_id: employeeId,
      expected_version: 11,
      actor_type: "owner",
      actor_id: authUserId,
    },
  });
  assert.equal(result.invitationVersion, 5);
  assert.equal(result.employee.version, 12);
});

test("removal sends the pending invitation row version and actor context and normalizes the deleted employee id", async () => {
  let captured:
    | { functionName: string; args: Record<string, unknown> }
    | undefined;
  const client = rpcClient(async (functionName, args) => {
    captured = { functionName, args };
    return {
      data: {
        removed: true,
        employee_id: employeeId,
      },
      error: null,
    };
  });
  const result = await removeMerchantEnterpriseEmployeeInvitation(client, {
    siteId: "10000000",
    employeeId,
    version: 12,
    ...ownerActor,
  });

  assert.equal(
    captured?.functionName,
    "faolla_remove_merchant_employee_invitation_v1",
  );
  assert.deepEqual(captured?.args, {
    p_input: {
      merchant_id: "10000000",
      employee_id: employeeId,
      expected_version: 12,
      actor_type: "owner",
      actor_id: authUserId,
    },
  });
  assert.deepEqual(result, { removed: true, employeeId });
});

test("removal rejects invalid CAS input before any database call", async () => {
  let called = false;
  const client = rpcClient(async () => {
    called = true;
    return { data: null, error: null };
  });

  await assert.rejects(
    removeMerchantEnterpriseEmployeeInvitation(client, {
      siteId: "10000000",
      employeeId,
      version: 0,
      ...ownerActor,
    }),
    /invalid_employee_invitation/,
  );
  assert.equal(called, false);
});

test("removal preserves the actionable in-use conflict from the database", async () => {
  const client = rpcClient(async () => ({
    data: null,
    error: { code: "P0001", message: "employee_invitation_in_use" },
  }));

  await assert.rejects(
    removeMerchantEnterpriseEmployeeInvitation(client, {
      siteId: "10000000",
      employeeId,
      version: 12,
      ...ownerActor,
    }),
    /^Error: employee_invitation_in_use$/,
  );
});

test("invitation authorization and version errors retain stable public codes", async () => {
  for (const code of [
    "invalid_enterprise_actor",
    "permission_escalation_denied",
    "permission_denied",
    "enterprise_version_conflict",
    "employee_not_found",
  ]) {
    const client = rpcClient(async () => ({
      data: null,
      error: { code: "P0001", message: code },
    }));
    await assert.rejects(
      revokeMerchantEnterpriseEmployeeInvitation(client, {
        siteId: "10000000",
        employeeId,
        version: 12,
        ...ownerActor,
      }),
      new RegExp(`^Error: ${code}$`),
    );
  }
});

test("accept RPC lifecycle failures retain their actionable HTTP status", () => {
  const cases = [
    ["employee_invitation_expired", "employee_invitation_expired", 410],
    ["employee_invitation_revoked", "employee_invitation_revoked", 410],
    ["employee_invitation_superseded", "employee_invitation_superseded", 410],
    ["employee_account_disabled", "employee_account_disabled", 403],
    ["merchant_access_denied", "merchant_access_denied", 403],
    ["merchant_employee_not_invited", "merchant_employee_not_invited", 403],
    [
      "enterprise_invitation_accept_conflict",
      "merchant_employee_accept_conflict",
      409,
    ],
  ] as const;

  for (const [databaseMessage, expectedCode, expectedStatus] of cases) {
    const error = merchantEmployeeInvitationAcceptError({
      code: "P0001",
      message: databaseMessage,
    });
    assert.equal(error.code, expectedCode, databaseMessage);
    assert.equal(error.status, expectedStatus, databaseMessage);
  }
});

test("a pending invitation must use the revocation RPC instead of generic disable", () => {
  assert.equal(
    getMerchantEnterpriseEmployeeStatusTransitionError(
      { status: "invited", acceptedAt: null },
      "disabled",
    ),
    "employee_invitation_revoke_required",
  );
  assert.equal(
    getMerchantEnterpriseEmployeeStatusTransitionError(
      { status: "active", acceptedAt: "2026-07-31T10:01:00.000Z" },
      "disabled",
    ),
    null,
  );
});

test("valid pending invitations can only resend while expired invitations can only renew", () => {
  const nowMs = Date.parse("2026-07-31T10:00:00.000Z");
  const employee = normalizeMerchantEnterpriseEmployee(
    employeeRow({ invitationVersion: 4, version: 10 }),
  );
  assert.ok(employee);

  const valid = {
    ...employee,
    invitationExpiresAt: "2026-07-31T10:01:00.000Z",
    invitationRevokedAt: null,
  };
  assert.equal(
    getMerchantEnterpriseInvitationActionError(valid, "resend_invite", nowMs),
    null,
  );
  assert.equal(
    getMerchantEnterpriseInvitationActionError(valid, "renew_invite", nowMs),
    "employee_invitation_renew_not_required",
  );

  const expired = {
    ...employee,
    invitationExpiresAt: "2026-07-31T10:00:00.000Z",
    invitationRevokedAt: null,
  };
  assert.equal(
    getMerchantEnterpriseInvitationActionError(expired, "resend_invite", nowMs),
    "employee_invitation_renew_required",
  );
  assert.equal(
    getMerchantEnterpriseInvitationActionError(expired, "renew_invite", nowMs),
    null,
  );
});

test("revoked invitations reject resend and allow an explicit credential rotation", () => {
  const nowMs = Date.parse("2026-07-31T10:00:00.000Z");
  const employee = normalizeMerchantEnterpriseEmployee({
    ...employeeRow({ invitationVersion: 5, version: 12 }),
    invitation_expires_at: "2026-08-07T10:00:00.000Z",
    invitation_revoked_at: "2026-07-31T09:59:00.000Z",
    invitation_delivery_status: "revoked",
  });
  assert.ok(employee);
  assert.equal(
    getMerchantEnterpriseInvitationActionError(
      employee,
      "resend_invite",
      nowMs,
    ),
    "employee_invitation_renew_required",
  );
  assert.equal(
    getMerchantEnterpriseInvitationActionError(
      employee,
      "renew_invite",
      nowMs,
    ),
    null,
  );
});
