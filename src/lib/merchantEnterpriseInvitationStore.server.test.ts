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
  createMerchantEnterpriseInvitationSecret,
  finalizeMerchantEnterpriseEmployeeInvitation,
  reserveMerchantEnterpriseEmployeeInvitation,
  revokeMerchantEnterpriseEmployeeInvitation,
} from "@/lib/merchantEnterpriseInvitationStore.server";
import type { MerchantEnterpriseStoreClient } from "@/lib/merchantEnterpriseStore.server";

const employeeId = "77777777-7777-4777-8777-777777777777";
const authUserId = "88888888-8888-4888-8888-888888888888";
const roleId = "99999999-9999-4999-8999-999999999999";

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
    },
  });
  assert.doesNotMatch(JSON.stringify(captured?.args), new RegExp(secret.token));
  assert.equal(result.invitationVersion, 1);
  assert.equal(result.employee.id, employeeId);
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
    }),
    /invalid_employee_invitation/,
  );
  assert.equal(called, false);
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

test("revocation sends only the employee row version and normalizes its rotated generation", async () => {
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
    },
  });
  assert.equal(result.invitationVersion, 5);
  assert.equal(result.employee.version, 12);
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
