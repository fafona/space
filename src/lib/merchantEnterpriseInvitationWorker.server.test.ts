import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { User } from "@supabase/supabase-js";
import {
  createMerchantEnterpriseInvitationOutboxHandler,
  createMerchantEnterpriseInvitationOutboxRpcSettlement,
  createMerchantEnterpriseInvitationRpcDependencies,
  ensureMerchantEnterpriseInvitationStaffUser,
  normalizeMerchantEnterpriseInvitationDeliveryEvent,
  type MerchantEnterpriseInvitationWorkerDependencies,
} from "@/lib/merchantEnterpriseInvitationWorker.server";
import { MerchantOutboxTaskError } from "@/lib/merchantOutboxWorker.server";

const eventId = "123e4567-e89b-42d3-a456-426614174000";
const employeeId = "923e4567-e89b-42d3-a456-426614174000";
const authUserId = "823e4567-e89b-42d3-a456-426614174000";
const hmacKey = Buffer.alloc(32, 37);
const emailHash = createHash("sha256")
  .update("staff@example.com", "utf8")
  .digest("hex");

function claimed(
  payload: Record<string, unknown> = {},
  options: { replayCount?: number } = {},
) {
  return {
    id: eventId,
    merchantId: "10000000",
    eventKey: `enterprise-invitation/${employeeId}/7`,
    eventType: "enterprise.employee_invitation.deliver",
    aggregateType: "merchant_enterprise_employee",
    aggregateId: employeeId,
    payload: {
      schema_version: 1,
      invitation_version: 7,
      hmac_key_id: "k1",
      ...payload,
    },
    attempts: 1,
    totalAttempts: 1,
    replayCount: options.replayCount ?? 0,
    maxAttempts: 8,
    correlationId: "request-1",
    leaseExpiresAt: "2026-08-19T10:01:00.000Z",
    createdAt: "2026-08-19T10:00:00.000Z",
  };
}

function staffUser(overrides: Partial<User> = {}): User {
  return {
    id: authUserId,
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.com",
    email_confirmed_at: undefined,
    phone: "",
    confirmed_at: undefined,
    last_sign_in_at: undefined,
    app_metadata: {
      principal_type: "merchant_staff",
      merchant_staff_email_hash: emailHash,
    },
    user_metadata: {},
    identities: [],
    created_at: "2026-08-19T10:00:00.000Z",
    updated_at: "2026-08-19T10:00:00.000Z",
    is_anonymous: false,
    ...overrides,
  };
}

test("invitation worker accepts only the frozen exact outbox payload", () => {
  assert.deepEqual(normalizeMerchantEnterpriseInvitationDeliveryEvent(claimed()), {
    eventId,
    merchantId: "10000000",
    employeeId,
    invitationVersion: 7,
    hmacKeyId: "k1",
    replayCount: 0,
  });
  assert.throws(
    () =>
      normalizeMerchantEnterpriseInvitationDeliveryEvent(
        claimed({ unexpected: "must-fail-closed" }),
      ),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError && error.retryable === false,
  );
});

test("existing immutable staff identity is resolved by exact user id and email", async () => {
  let creates = 0;
  const user = await ensureMerchantEnterpriseInvitationStaffUser(
    { email: "Staff@Example.com", authUserId },
    {
      authAdmin: {
        getUserById: async () => ({ data: { user: staffUser() }, error: null }),
        createUser: async () => {
          creates += 1;
          return { data: { user: null }, error: null };
        },
      },
      lookupStaffIdentity: async () => ({ status: "not_found" }),
    },
  );
  assert.equal(user.id, authUserId);
  assert.equal(creates, 0);
});

test("a registry-proven legacy staff identity receives the missing immutable email hash", async () => {
  let currentUser = staffUser({
    app_metadata: { principal_type: "merchant_staff" },
  });
  let updates = 0;
  const user = await ensureMerchantEnterpriseInvitationStaffUser(
    { email: "staff@example.com", authUserId },
    {
      authAdmin: {
        getUserById: async () => ({ data: { user: currentUser }, error: null }),
        updateUserById: async (id, attributes) => {
          updates += 1;
          assert.equal(id, authUserId);
          currentUser = staffUser({ app_metadata: attributes.app_metadata });
          return { data: { user: currentUser }, error: null };
        },
        createUser: async () => ({ data: { user: null }, error: null }),
      },
      lookupStaffIdentity: async () => ({ status: "staff", authUserId }),
    },
  );
  assert.equal(updates, 1);
  assert.equal(user.app_metadata.merchant_staff_email_hash, emailHash);
});

test("a transient legacy metadata update failure remains retryable", async () => {
  const legacyUser = staffUser({
    app_metadata: { principal_type: "merchant_staff" },
  });
  let reads = 0;
  await assert.rejects(
    ensureMerchantEnterpriseInvitationStaffUser(
      { email: "staff@example.com", authUserId },
      {
        authAdmin: {
          getUserById: async () => {
            reads += 1;
            return { data: { user: legacyUser }, error: null };
          },
          updateUserById: async () => ({
            data: { user: null },
            error: new Error("temporary auth failure"),
          }),
          createUser: async () => ({ data: { user: null }, error: null }),
        },
        lookupStaffIdentity: async () => ({ status: "staff", authUserId }),
      },
    ),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "invitation_identity_unavailable" &&
      error.retryable === true,
  );
  assert.equal(reads, 2);
});

test("a lost legacy metadata update response recovers the committed marker", async () => {
  let currentUser = staffUser({
    app_metadata: { principal_type: "merchant_staff" },
  });
  let reads = 0;
  const user = await ensureMerchantEnterpriseInvitationStaffUser(
    { email: "staff@example.com", authUserId },
    {
      authAdmin: {
        getUserById: async () => {
          reads += 1;
          return { data: { user: currentUser }, error: null };
        },
        updateUserById: async (_id, attributes) => {
          currentUser = staffUser({ app_metadata: attributes.app_metadata });
          throw new Error("response lost after commit");
        },
        createUser: async () => ({ data: { user: null }, error: null }),
      },
      lookupStaffIdentity: async () => ({ status: "staff", authUserId }),
    },
  );
  assert.equal(reads, 2);
  assert.equal(user.app_metadata.merchant_staff_email_hash, emailHash);
});

test("legacy staff metadata is never upgraded without an exact registry match", async () => {
  let updates = 0;
  await assert.rejects(
    ensureMerchantEnterpriseInvitationStaffUser(
      { email: "staff@example.com", authUserId },
      {
        authAdmin: {
          getUserById: async () => ({
            data: {
              user: staffUser({
                app_metadata: { principal_type: "merchant_staff" },
              }),
            },
            error: null,
          }),
          updateUserById: async () => {
            updates += 1;
            return { data: { user: null }, error: null };
          },
          createUser: async () => ({ data: { user: null }, error: null }),
        },
        lookupStaffIdentity: async () => ({ status: "not_found" }),
      },
    ),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "staff_identity_conflict" &&
      error.retryable === false,
  );
  assert.equal(updates, 0);
});

test("a conflicting immutable staff email hash is never overwritten", async () => {
  let updates = 0;
  await assert.rejects(
    ensureMerchantEnterpriseInvitationStaffUser(
      { email: "staff@example.com", authUserId },
      {
        authAdmin: {
          getUserById: async () => ({
            data: {
              user: staffUser({
                app_metadata: {
                  principal_type: "merchant_staff",
                  merchant_staff_email_hash: "f".repeat(64),
                },
              }),
            },
            error: null,
          }),
          updateUserById: async () => {
            updates += 1;
            return { data: { user: null }, error: null };
          },
          createUser: async () => ({ data: { user: null }, error: null }),
        },
        lookupStaffIdentity: async () => ({ status: "staff", authUserId }),
      },
    ),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "staff_identity_conflict" &&
      error.retryable === false,
  );
  assert.equal(updates, 0);
});

test("ordinary Faolla identity is never promoted from mutable metadata", async () => {
  await assert.rejects(
    ensureMerchantEnterpriseInvitationStaffUser(
      { email: "staff@example.com", authUserId },
      {
        authAdmin: {
          getUserById: async () => ({
            data: {
              user: staffUser({
                app_metadata: {},
                user_metadata: { principal_type: "merchant_staff" },
              }),
            },
            error: null,
          }),
          createUser: async () => ({ data: { user: null }, error: null }),
        },
        lookupStaffIdentity: async () => ({ status: "not_found" }),
      },
    ),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "staff_identity_conflict" &&
      error.retryable === false,
  );
});

test("lost createUser response converges through the exact staff registry", async () => {
  let lookups = 0;
  const user = await ensureMerchantEnterpriseInvitationStaffUser(
    { email: "staff@example.com", authUserId: null },
    {
      authAdmin: {
        getUserById: async (id) => ({
          data: { user: staffUser({ id }) },
          error: null,
        }),
        createUser: async () => ({
          data: { user: null },
          error: new Error("response_lost"),
        }),
      },
      lookupStaffIdentity: async () => {
        lookups += 1;
        return lookups === 1
          ? { status: "not_found" as const }
          : { status: "staff" as const, authUserId };
      },
    },
  );
  assert.equal(user.id, authUserId);
  assert.equal(lookups, 2);
});

test("new Auth staff identity carries both immutable recovery markers", async () => {
  let attributes: Record<string, unknown> | undefined;
  const created = await ensureMerchantEnterpriseInvitationStaffUser(
    { email: "Staff@Example.com", authUserId: null },
    {
      authAdmin: {
        getUserById: async () => ({ data: { user: staffUser() }, error: null }),
        createUser: async (input) => {
          attributes = input;
          return { data: { user: staffUser() }, error: null };
        },
      },
      lookupStaffIdentity: async () => ({ status: "not_found" }),
    },
  );
  assert.equal(created.id, authUserId);
  assert.deepEqual(attributes, {
    email: "staff@example.com",
    email_confirm: false,
    app_metadata: {
      principal_type: "merchant_staff",
      merchant_staff_email_hash: emailHash,
    },
  });
});

test("worker derives one stable token, binds identity, and returns only safe result fields", async () => {
  const calls: string[] = [];
  let sentToken = "";
  let sentReplayCount = -1;
  const dependencies: MerchantEnterpriseInvitationWorkerDependencies = {
    keyring: { activeKeyId: "k1", keys: new Map([["k1", hmacKey]]) },
    emailConfig: {
      apiKey: "re_test",
      from: "invite@faolla.example",
      publicOrigin: "https://faolla.example",
    },
    authAdmin: {
      getUserById: async () => ({ data: { user: staffUser() }, error: null }),
      createUser: async () => ({ data: { user: staffUser() }, error: null }),
    },
    prepareDelivery: async ({ tokenHash }) => {
      calls.push(`prepare:${tokenHash}`);
      return {
        outcome: "deliver",
        email: "staff@example.com",
        employeeDisplayName: "员工",
        merchantDisplayName: "商户",
        authUserId,
        emailHash,
      };
    },
    lookupStaffIdentity: async () => ({ status: "staff", authUserId }),
    bindStaffIdentity: async () => {
      calls.push("bind");
    },
    sendEmail: async (input) => {
      calls.push("send");
      sentToken = input.invitationToken;
      sentReplayCount = input.replayCount;
      return { provider: "resend", messageId: "message_1" };
    },
  };
  const handler = createMerchantEnterpriseInvitationOutboxHandler(dependencies);
  const result = await handler(claimed({}, { replayCount: 2 }), {
    signal: new AbortController().signal,
    renewLease: async () => true,
    workerId: "invitation:test",
  });
  assert.match(sentToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sentReplayCount, 2);
  assert.equal(calls[0]?.startsWith("prepare:"), true);
  assert.deepEqual(calls.slice(1), ["bind", "send"]);
  assert.deepEqual(result, { status: "sent", invitation_version: 7 });
  assert.equal(JSON.stringify(result).includes(sentToken), false);
});

test("superseded preparation is domain-failed instead of calling sent completion", async () => {
  const dependencies: MerchantEnterpriseInvitationWorkerDependencies = {
    keyring: { activeKeyId: "k1", keys: new Map([["k1", hmacKey]]) },
    emailConfig: {
      apiKey: "re_test",
      from: "invite@faolla.example",
      publicOrigin: "https://faolla.example",
    },
    authAdmin: {
      getUserById: async () => ({ data: { user: staffUser() }, error: null }),
      createUser: async () => ({ data: { user: staffUser() }, error: null }),
    },
    prepareDelivery: async () => ({ outcome: "superseded" }),
    lookupStaffIdentity: async () => ({ status: "not_found" }),
    bindStaffIdentity: async () => undefined,
  };
  await assert.rejects(
    createMerchantEnterpriseInvitationOutboxHandler(dependencies)(claimed(), {
      signal: new AbortController().signal,
      renewLease: async () => true,
      workerId: "enterprise-invitation:test",
    }),
    (error: unknown) =>
      error instanceof MerchantOutboxTaskError &&
      error.code === "worker_unavailable" &&
      error.retryable === false,
  );
});

test("RPC dependencies validate prepare data and bind the exact email hash", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: staffUser() }, error: null }),
        createUser: async () => ({ data: { user: staffUser() }, error: null }),
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name.includes("prepare")) {
        return {
          data: {
            event_id: eventId,
            merchant_id: "10000000",
            employee_id: employeeId,
            employee_version: 3,
            invitation_version: 7,
            hmac_key_id: "k1",
            email: "Staff@Example.com",
            email_hash: emailHash,
            auth_user_id: authUserId,
            invitation_expires_at: "2026-08-20T10:00:00.000Z",
          },
          error: null,
        };
      }
      if (name.includes("lookup")) {
        return { data: { found: true, auth_user_id: authUserId }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };
  const dependencies = createMerchantEnterpriseInvitationRpcDependencies(client, {
    keyring: { activeKeyId: "k1", keys: new Map([["k1", hmacKey]]) },
    emailConfig: {
      apiKey: "re_test",
      from: "invite@faolla.example",
      publicOrigin: "https://faolla.example",
    },
  });
  const event = normalizeMerchantEnterpriseInvitationDeliveryEvent(claimed());
  const prepared = await dependencies.prepareDelivery({
    event,
    workerId: "enterprise-invitation:test",
    tokenHash: "a".repeat(64),
  });
  assert.equal(prepared.outcome, "deliver");
  assert.equal(prepared.outcome === "deliver" && prepared.emailHash, emailHash);
  assert.deepEqual(await dependencies.lookupStaffIdentity("staff@example.com"), {
    status: "staff",
    authUserId,
  });
  await dependencies.bindStaffIdentity({
    event,
    workerId: "enterprise-invitation:test",
    authUserId,
    emailHash,
  });
  assert.deepEqual(calls[2], {
    name: "faolla_bind_merchant_employee_invitation_identity_v2",
    args: {
      p_input: {
        event_id: eventId,
        worker_id: "enterprise-invitation:test",
        auth_user_id: authUserId,
        email_hash: emailHash,
      },
    },
  });
});

test("domain settlement omits an absent retry delay", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const settlement = createMerchantEnterpriseInvitationOutboxRpcSettlement({
    rpc: async (name, args) => {
      const input = args.p_input as Record<string, unknown>;
      calls.push({ name, input });
      return name.includes("complete")
        ? {
            data: {
              event_id: eventId,
              invitation_version: 7,
              delivery_status: "sent",
            },
            error: null,
          }
        : { data: { status: "retry_scheduled" }, error: null };
    },
  });
  assert.equal(
    await settlement.complete({
      client: { rpc: async () => ({ data: null, error: null }) },
      event: claimed(),
      workerId: "enterprise-invitation:test",
      result: { status: "sent", invitation_version: 7 },
    }),
    true,
  );
  assert.equal(
    await settlement.fail({
      client: { rpc: async () => ({ data: null, error: null }) },
      event: claimed(),
      workerId: "enterprise-invitation:test",
      error: { code: "provider_unavailable", retryable: true },
    }),
    "retry_scheduled",
  );
  assert.equal("retry_after_seconds" in calls[1]!.input, false);
});

test("domain settlement fails closed on malformed complete and fail RPC objects", async () => {
  const settlement = createMerchantEnterpriseInvitationOutboxRpcSettlement({
    rpc: async (name) =>
      name.includes("complete")
        ? {
            data: {
              event_id: "223e4567-e89b-42d3-a456-426614174000",
              invitation_version: 7,
              delivery_status: "sent",
            },
            error: null,
          }
        : { data: { status: "unexpected" }, error: null },
  });
  assert.equal(
    await settlement.complete({
      client: { rpc: async () => ({ data: null, error: null }) },
      event: claimed(),
      workerId: "enterprise-invitation:test",
      result: {},
    }),
    false,
  );
  assert.equal(
    await settlement.fail({
      client: { rpc: async () => ({ data: null, error: null }) },
      event: claimed(),
      workerId: "enterprise-invitation:test",
      error: { code: "provider_unavailable", retryable: true },
    }),
    "lease_lost",
  );
});
