import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createMerchantEnterpriseInitialPasswordHandler,
  type MerchantEnterpriseInitialPasswordDependencies,
} from "@/app/api/merchant-enterprise/invitations/initial-password/route";
import { hashMerchantEnterpriseInvitationToken } from "@/lib/merchantEnterpriseInvitationSecret.server";
import {
  MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY,
  MERCHANT_STAFF_PRINCIPAL_TYPE,
} from "@/lib/merchantStaffPrincipal.server";

const siteId = "10000000";
const employeeId = "923e4567-e89b-42d3-a456-426614174000";
const authUserId = "823e4567-e89b-42d3-a456-426614174000";
const roleId = "723e4567-e89b-42d3-a456-426614174000";
const invitationVersion = 7;
const invitationToken = "A".repeat(43);
const invitationTokenHash = hashMerchantEnterpriseInvitationToken(invitationToken);
const operationId = "523e4567-e89b-42d3-a456-426614174000";
const email = "staff@example.com";
const emailHash = createHash("sha256").update(email, "utf8").digest("hex");
const now = new Date("2026-08-31T10:00:00.000Z");
const OMIT_PASSWORD_STATE = Symbol("omit-password-state");

function authUser(passwordInitialized: unknown = false) {
  return {
    id: authUserId,
    email,
    app_metadata: {
      principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE,
      merchant_staff_email_hash: emailHash,
      retained_server_field: "keep-me",
      ...(passwordInitialized === OMIT_PASSWORD_STATE
        ? {}
        : {
            [MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY]:
              passwordInitialized,
          }),
    },
  };
}

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: employeeId,
    merchant_id: siteId,
    auth_user_id: authUserId,
    email,
    role_id: roleId,
    status: "invited",
    accepted_at: null,
    invitation_version: invitationVersion,
    invitation_token_hash: invitationTokenHash,
    invitation_expires_at: "2026-09-01T10:00:00.000Z",
    invitation_revoked_at: null,
    ...overrides,
  };
}

function role(overrides: Record<string, unknown> = {}) {
  return {
    id: roleId,
    merchant_id: siteId,
    status: "active",
    ...overrides,
  };
}

function staffIdentity(overrides: Record<string, unknown> = {}) {
  return {
    auth_user_id: authUserId,
    email_hash: emailHash,
    principal_type: MERCHANT_STAFF_PRINCIPAL_TYPE,
    ...overrides,
  };
}

function request(
  body: Record<string, unknown> = {
    siteId,
    invitationToken,
    invitationVersion,
    newPassword: "safe-password-123",
    operationId,
  },
  headers: HeadersInit = {},
) {
  return new Request(
    "https://faolla.com/api/merchant-enterprise/invitations/initial-password",
    {
      method: "POST",
      headers: {
        origin: "https://faolla.com",
        "content-type": "application/json",
        "x-merchant-access-token": "invite-session-token",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

function dependencies(
  options: {
    calls?: string[];
    invitationRows?: unknown[];
    identityRow?: unknown;
    roleRows?: unknown[];
    currentPasswordInitialized?: unknown;
    getAuthError?: unknown;
    updateError?: unknown;
    updatedPasswordInitialized?: unknown;
    claimError?: unknown;
    claimState?: "claimed" | "completed";
    claimResumed?: boolean;
    completeError?: unknown;
    releaseError?: unknown;
  } = {},
): MerchantEnterpriseInitialPasswordDependencies {
  const calls = options.calls ?? [];
  const invitationRows = options.invitationRows ?? [invitation(), invitation()];
  const roleRows = options.roleRows ?? [role(), role()];
  const currentPasswordInitialized = Object.prototype.hasOwnProperty.call(
    options,
    "currentPasswordInitialized",
  )
    ? options.currentPasswordInitialized
    : false;
  let invitationRead = 0;
  let roleRead = 0;
  let passwordFingerprint = "";
  return {
    resolveAuthUser: async () => {
      calls.push("resolveAuthUser");
      return authUser(false);
    },
    loadInvitation: async (input) => {
      calls.push("loadInvitation");
      assert.equal(input.siteId, siteId);
      assert.equal(input.authUserId, authUserId);
      assert.equal(input.invitationVersion, invitationVersion);
      assert.equal(input.tokenHash, invitationTokenHash);
      assert.equal(input.nowIso, now.toISOString());
      const data = invitationRows[invitationRead] ?? invitationRows.at(-1) ?? null;
      invitationRead += 1;
      return { data, error: null };
    },
    loadRole: async (input) => {
      calls.push("loadRole");
      assert.deepEqual(input, { siteId, roleId });
      const data = roleRows[roleRead] ?? roleRows.at(-1) ?? null;
      roleRead += 1;
      return { data, error: null };
    },
    loadStaffIdentity: async (input) => {
      calls.push("loadStaffIdentity");
      assert.deepEqual(input, { authUserId, emailHash });
      return {
        data: options.identityRow ?? staffIdentity(),
        error: null,
      };
    },
    getAuthUserById: async (resolvedAuthUserId) => {
      calls.push("getAuthUserById");
      assert.equal(resolvedAuthUserId, authUserId);
      return {
        user: authUser(currentPasswordInitialized),
        error: options.getAuthError ?? null,
      };
    },
    updateAuthUserById: async (resolvedAuthUserId, attributes) => {
      calls.push("updateAuthUserById");
      assert.equal(resolvedAuthUserId, authUserId);
      assert.equal(attributes.password, "safe-password-123");
      assert.equal(
        attributes.app_metadata[
          MERCHANT_STAFF_PASSWORD_INITIALIZED_METADATA_KEY
        ],
        true,
      );
      assert.equal(attributes.app_metadata.retained_server_field, "keep-me");
      return {
        user: authUser(options.updatedPasswordInitialized ?? true),
        error: options.updateError ?? null,
      };
    },
    claimInitialPasswordSetup: async (input) => {
      calls.push("claimInitialPasswordSetup");
      assert.equal(input.siteId, siteId);
      assert.equal(input.authUserId, authUserId);
      assert.equal(input.invitationVersion, invitationVersion);
      assert.equal(input.tokenHash, invitationTokenHash);
      assert.equal(input.operationId, operationId);
      assert.match(input.passwordFingerprint, /^[0-9a-f]{64}$/);
      passwordFingerprint = input.passwordFingerprint;
      return {
        data: {
          state: options.claimState ?? "claimed",
          resumed: options.claimResumed ?? false,
          employee_id: employeeId,
          merchant_id: siteId,
          auth_user_id: authUserId,
          invitation_version: invitationVersion,
          operation_id: operationId,
          password_fingerprint: passwordFingerprint,
        },
        error: options.claimError ?? null,
      };
    },
    completeInitialPasswordSetup: async (input) => {
      calls.push("completeInitialPasswordSetup");
      assert.equal(input.passwordFingerprint, passwordFingerprint);
      return {
        data: {
          state: "completed",
          resumed: true,
          employee_id: employeeId,
          merchant_id: siteId,
          auth_user_id: authUserId,
          invitation_version: invitationVersion,
          operation_id: operationId,
          password_fingerprint: passwordFingerprint,
        },
        error: options.completeError ?? null,
      };
    },
    releaseInitialPasswordSetup: async (input) => {
      calls.push("releaseInitialPasswordSetup");
      assert.equal(input.passwordFingerprint, passwordFingerprint);
      return {
        data: { released: true },
        error: options.releaseError ?? null,
      };
    },
    now: () => now,
  };
}

test("initial password setup revalidates the exact invitation immediately before Auth mutation", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({ calls }),
  )(request());

  const responseBody = await response.clone().json();
  const serializedResponse = await response.clone().text();
  assert.equal(response.status, 200, JSON.stringify(responseBody));
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls, [
    "resolveAuthUser",
    "loadInvitation",
    "loadRole",
    "loadStaffIdentity",
    "loadInvitation",
    "loadRole",
    "claimInitialPasswordSetup",
    "getAuthUserById",
    "updateAuthUserById",
    "completeInitialPasswordSetup",
  ]);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(serializedResponse.includes("safe-password-123"), false);
  assert.equal(serializedResponse.includes(invitationToken), false);
});

test("initial password setup rejects origin, session and payload failures before backend mutation", async () => {
  for (const [candidate, expectedStatus] of [
    [request(undefined, { origin: "https://evil.example" }), 403],
    [request(undefined, { "x-merchant-access-token": "" }), 401],
    [
      request({
        siteId,
        invitationToken,
        invitationVersion,
        newPassword: "short",
      }),
      400,
    ],
    [
      request({
        siteId,
        invitationToken,
        invitationVersion,
        newPassword: "safe-password-123",
        unexpected: true,
      }),
      400,
    ],
    [
      request({
        siteId,
        invitationToken,
        invitationVersion: "7",
        newPassword: "safe-password-123",
      }),
      400,
    ],
  ] as const) {
    const calls: string[] = [];
    const response = await createMerchantEnterpriseInitialPasswordHandler(
      dependencies({ calls }),
    )(candidate);
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(calls, []);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }
});

test("expired, revoked, identity-mismatched, or inactive-role invitations never update the Auth user", async () => {
  for (const options of [
    {
      invitationRows: [
        invitation({ invitation_expires_at: "2026-08-31T09:59:59.000Z" }),
      ],
    },
    {
      invitationRows: [
        invitation({ invitation_revoked_at: "2026-08-31T09:00:00.000Z" }),
      ],
    },
    {
      identityRow: staffIdentity({ email_hash: "f".repeat(64) }),
    },
    {
      roleRows: [null],
    },
    {
      roleRows: [role({ status: "disabled" })],
    },
  ]) {
    const calls: string[] = [];
    const response = await createMerchantEnterpriseInitialPasswordHandler(
      dependencies({ ...options, calls }),
    )(request());
    assert.equal(response.status, 410);
    assert.equal(calls.includes("updateAuthUserById"), false);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "employee_invitation_invalid_or_expired",
    });
  }
});

test("a changed invitation generation between validation reads fails closed", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls,
      invitationRows: [
        invitation(),
        invitation({ invitation_version: 8 }),
      ],
    }),
  )(request());

  assert.equal(response.status, 410);
  assert.equal(calls.filter((call) => call === "loadInvitation").length, 2);
  assert.equal(calls.includes("updateAuthUserById"), false);
});

test("a role disabled between validation reads fails closed", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls,
      roleRows: [role(), role({ status: "disabled" })],
    }),
  )(request());

  assert.equal(response.status, 410);
  assert.equal(calls.filter((call) => call === "loadRole").length, 2);
  assert.equal(calls.includes("updateAuthUserById"), false);
});

test("only literal false password state may be changed", async () => {
  for (const [currentPasswordInitialized, expectedError] of [
    [true, "employee_password_already_initialized"],
    [OMIT_PASSWORD_STATE, "employee_password_state_unknown"],
    [null, "employee_password_state_unknown"],
    ["false", "employee_password_state_unknown"],
  ] as const) {
    const calls: string[] = [];
    const response = await createMerchantEnterpriseInitialPasswordHandler(
      dependencies({ calls, currentPasswordInitialized }),
    )(request());

    assert.equal(response.status, 409);
    assert.equal(calls.includes("updateAuthUserById"), false);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: expectedError,
    });
  }
});

test("Auth update failures and missing committed markers do not report success", async () => {
  for (const options of [
    { updateError: new Error("provider detail") },
    { updatedPasswordInitialized: false },
  ]) {
    const response = await createMerchantEnterpriseInitialPasswordHandler(
      dependencies(options),
    )(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "employee_initial_password_setup_failed",
    });
  }
});

test("a concurrent different setup claim cannot reach the Auth mutation", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls,
      claimError: new Error("employee_initial_password_setup_in_progress"),
    }),
  )(request());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "employee_initial_password_setup_in_progress",
  });
  assert.equal(calls.includes("getAuthUserById"), false);
  assert.equal(calls.includes("updateAuthUserById"), false);
});

test("the same claimed operation recovers a committed Auth update and completes once", async () => {
  const calls: string[] = [];
  const response = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls,
      claimResumed: true,
      currentPasswordInitialized: true,
    }),
  )(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.includes("updateAuthUserById"), false);
  assert.equal(
    calls.filter((call) => call === "completeInitialPasswordSetup").length,
    1,
  );
});

test("a completed claim is an idempotent success only while Auth remains committed", async () => {
  const successfulCalls: string[] = [];
  const success = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls: successfulCalls,
      claimState: "completed",
      claimResumed: true,
      currentPasswordInitialized: true,
    }),
  )(request());
  assert.equal(success.status, 200);
  assert.equal(successfulCalls.includes("updateAuthUserById"), false);
  assert.equal(successfulCalls.includes("completeInitialPasswordSetup"), false);

  const drifted = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      claimState: "completed",
      claimResumed: true,
      currentPasswordInitialized: false,
    }),
  )(request());
  assert.equal(drifted.status, 503);
});

test("definitive Auth rejection releases setup while ambiguous failure keeps the claim", async () => {
  const definitiveCalls: string[] = [];
  const definitive = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls: definitiveCalls,
      updateError: { status: 422, message: "weak password" },
    }),
  )(request());
  assert.equal(definitive.status, 400);
  assert.equal(definitiveCalls.includes("releaseInitialPasswordSetup"), true);

  const retryableCalls: string[] = [];
  const retryable = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls: retryableCalls,
      updateError: {
        status: 503,
        name: "AuthRetryableFetchError",
        __isAuthError: true,
      },
    }),
  )(request());
  assert.equal(retryable.status, 503);
  assert.equal(retryableCalls.includes("releaseInitialPasswordSetup"), false);
});

test("a fresh pre-mutation Auth read failure releases, while a resumed claim stays fenced", async () => {
  const freshCalls: string[] = [];
  const fresh = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({ calls: freshCalls, getAuthError: new Error("unavailable") }),
  )(request());
  assert.equal(fresh.status, 503);
  assert.equal(freshCalls.includes("releaseInitialPasswordSetup"), true);

  const resumedCalls: string[] = [];
  const resumed = await createMerchantEnterpriseInitialPasswordHandler(
    dependencies({
      calls: resumedCalls,
      claimResumed: true,
      getAuthError: new Error("unavailable"),
    }),
  )(request());
  assert.equal(resumed.status, 503);
  assert.equal(resumedCalls.includes("releaseInitialPasswordSetup"), false);
});
