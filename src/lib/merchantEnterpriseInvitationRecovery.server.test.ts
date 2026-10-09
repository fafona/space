import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import {
  isAcceptedInvitationRecoveryCandidate,
  recoverAcceptedMerchantEmployeeInvitation,
} from "./merchantEnterpriseInvitationRecovery.server";

const input = {
  siteId: "99990001",
  authUserId: "00000000-0000-4000-8000-000000000001",
  invitationVersion: 7,
};
const employeeId = "00000000-0000-4000-8000-000000000101";
const roleId = "00000000-0000-4000-8000-000000000030";
const timestamp = "2026-10-03T12:00:00.000Z";
const row = (patch: Record<string, unknown> = {}) => ({
  id: employeeId,
  merchant_id: input.siteId,
  auth_user_id: input.authUserId,
  email: "employee@example.test",
  display_name: "Synthetic accepted employee",
  role_id: roleId,
  status: "active",
  invited_at: timestamp,
  accepted_at: timestamp,
  last_active_at: timestamp,
  invitation_version: input.invitationVersion,
  invitation_expires_at: "2026-10-02T12:00:00.000Z",
  invitation_revoked_at: null,
  invitation_sent_at: timestamp,
  invitation_delivery_status: "sent",
  version: 4,
  created_at: timestamp,
  updated_at: timestamp,
  ...patch,
});

function spy(data: unknown = row(), error: unknown = null, throwAt = "") {
  const calls: unknown[][] = [];
  const record = (name: string, ...args: unknown[]) => {
    calls.push([name, ...args]);
    if (throwAt === name) throw new Error("synthetic SQL secret and token_hash must not escape");
  };
  const query = {
    select(columns: string) { record("select", columns); return query; },
    eq(column: string, value: unknown) { record("eq", column, value); return query; },
    not(column: string, operator: string, value: unknown) { record("not", column, operator, value); return query; },
    is(column: string, value: unknown) { record("is", column, value); return query; },
    limit(count: number) { record("limit", count); return query; },
    async maybeSingle() { record("maybeSingle"); return { data, error }; },
  };
  const service = {
    from(table: string) { record("from", table); return query; },
    rpc() { assert.fail("read-only invitation recovery must never call a mutating RPC"); },
  } as unknown as SupabaseClient;
  return { service, calls };
}

test("recovery candidate accepts only the exact waiver error message, never a code/details/substr match", () => {
  const exact = "employee_invitation_invalid_or_expired";
  for (const error of [{ message: exact }, { code: "P0001", message: exact }, new Error(exact)]) {
    assert.equal(isAcceptedInvitationRecoveryCandidate(error), true);
  }
  for (const error of [null, undefined, false, exact, [], {}, { code: exact }, { details: exact },
    { message: "failure", details: exact }, { message: `${exact}: detail` }, { message: ` ${exact}` },
    { message: `${exact}\n` }, { message: exact.toUpperCase() }, { message: [exact] },
    { message: "employee_initial_password_setup_incomplete" }, { message: "employee_account_disabled" },
    { message: "merchant_employee_not_invited" }, { message: "employee_invitation_expired" }]) {
    assert.equal(isAcceptedInvitationRecoveryCandidate(error), false);
  }
});

test("same-generation accepted membership uses the exact bounded read-only scope and safe column list", async () => {
  const h = spy();
  const employee = await recoverAcceptedMerchantEmployeeInvitation(h.service, input);
  assert(employee);
  assert.equal(employee.id, employeeId);
  assert.equal(employee.roleId, roleId);
  assert.equal(employee.authUserId, input.authUserId);
  assert.equal(employee.siteId, input.siteId);
  assert.equal(employee.status, "active");
  assert.equal(employee.acceptedAt, timestamp);
  assert.equal(employee.invitationVersion, input.invitationVersion);
  assert.equal(employee.version, 4);
  assert.deepEqual(h.calls, [
    ["from", "merchant_enterprise_employees"],
    ["select", "id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,invitation_version,invitation_expires_at,invitation_revoked_at,invitation_sent_at,invitation_delivery_status,version,created_at,updated_at"],
    ["eq", "merchant_id", input.siteId],
    ["eq", "auth_user_id", input.authUserId],
    ["eq", "status", "active"],
    ["eq", "invitation_version", input.invitationVersion],
    ["not", "accepted_at", "is", null],
    ["is", "invitation_revoked_at", null],
    ["is", "invitation_token_hash", null],
    ["limit", 1],
    ["maybeSingle"],
  ]);
  assert.equal(employee.invitationExpiresAt, "2026-10-02T12:00:00.000Z", "expired bearer proof does not undo an already-accepted own membership");
});

test("no matching employee does not invent an acceptance or issue another request", async () => {
  const h = spy(null);
  assert.equal(await recoverAcceptedMerchantEmployeeInvitation(h.service, input), null);
  assert.equal(h.calls.filter(call => call[0] === "from").length, 1);
  assert.equal(h.calls.at(-1)?.[0], "maybeSingle");
});

test("returned data is rechecked for tenant, authenticated account, generation and active accepted identity", async () => {
  for (const patch of [
    { merchant_id: "99990002" }, { auth_user_id: "00000000-0000-4000-8000-000000000002" },
    { invitation_version: 6 }, { invitation_version: 8 }, { invitation_version: null },
    { status: "invited" }, { status: "disabled" }, { status: null },
    { accepted_at: null }, { accepted_at: "" }, { accepted_at: "not-a-date" },
    { invitation_revoked_at: timestamp }, { invitation_revoked_at: "not-a-date" },
    { invitation_revoked_at: undefined }, { id: "" }, { role_id: " " },
    { email: "" }, { display_name: "" },
  ]) {
    const h = spy(row(patch));
    assert.equal(await recoverAcceptedMerchantEmployeeInvitation(h.service, input), null, JSON.stringify(patch));
  }
  for (const value of [[], {}, "unexpected row"]) {
    assert.equal(await recoverAcceptedMerchantEmployeeInvitation(spy(value).service, input), null);
  }
});

test("normalization projects known employee fields and never exposes authentication/setup secrets", async () => {
  const h = spy(row({
    invitation_token_hash: null,
    initial_password_policy: "completed",
    password_fingerprint: "synthetic-fingerprint-secret",
    invitationToken: "synthetic-bearer-secret",
    access_token: "synthetic-access-secret",
    unrelated: { private: true },
  }));
  const employee = await recoverAcceptedMerchantEmployeeInvitation(h.service, input);
  assert(employee);
  assert.deepEqual(Object.keys(employee).sort(), [
    "id", "siteId", "authUserId", "email", "displayName", "roleId", "status", "invitedAt", "acceptedAt",
    "lastActiveAt", "invitationVersion", "invitationExpiresAt", "invitationRevokedAt", "invitationSentAt",
    "invitationDeliveryStatus", "version", "createdAt", "updatedAt",
  ].sort());
  assert.doesNotMatch(JSON.stringify(employee), /secret|fingerprint|token|initial_password|unrelated/i);
  const columns = h.calls.find(call => call[0] === "select")?.[1];
  assert.equal(typeof columns, "string");
  assert.doesNotMatch(columns as string, /\*|token|password|policy/i);
});

test("database errors are fixed 503 failures, not no-match recovery or leaked SQL errors", async () => {
  for (const error of [new Error("synthetic SQL secret"), { code: "42501", message: "token_hash secret" },
    { code: "PGRST116", message: "multiple rows" }]) {
    await assert.rejects(recoverAcceptedMerchantEmployeeInvitation(spy(row(), error).service, input), reason => {
      assert(reason instanceof MerchantEnterpriseAccessError);
      assert.equal(reason.code, "merchant_employee_accept_failed");
      assert.equal(reason.status, 503);
      assert.equal(reason.message, "merchant_employee_accept_failed");
      return true;
    });
  }
});

test("synchronous builder errors and rejected reads also fail closed without another attempt", async () => {
  for (const stage of ["from", "select", "eq", "not", "is", "limit", "maybeSingle"]) {
    const h = spy(row(), null, stage);
    await assert.rejects(recoverAcceptedMerchantEmployeeInvitation(h.service, input), reason => {
      assert(reason instanceof MerchantEnterpriseAccessError);
      assert.equal(reason.code, "merchant_employee_accept_failed");
      assert.equal(reason.status, 503);
      assert.equal(reason.message.includes("secret"), false);
      return true;
    });
    assert.equal(h.calls.filter(call => call[0] === "from").length, 1);
  }
});
