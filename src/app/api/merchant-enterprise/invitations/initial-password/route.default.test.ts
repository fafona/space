// Default exported handler and installed SDK; SQL/Auth replies below are closed
// protocol fixtures, not evidence of a real database or Auth password mutation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { POST } from "./route-handler";
import { withAttendanceApplicationAuth } from "../../../../../../scripts/fixtures/attendance-application-auth";

const origin = "https://attendance-auth.invalid";
const serviceKey = "attendance-synthetic-service";
const siteId = "99990001";
const actor = { id: "00000000-0000-4000-8000-000000000002", email: "invite-retry-2@example.test" };
const employeeId = "00000000-0000-4000-8000-000000000102";
const roleId = "00000000-0000-4000-8000-000000000030";
const lookupName = "faolla_lookup_merchant_enterprise_staff_identity_v1";
const claimName = "faolla_claim_merchant_employee_initial_password_setup_v1";
const completeName = "faolla_complete_merchant_employee_initial_password_setup_v1";
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const emailHash = sha256(actor.email);
const command = {
  siteId, invitationToken: "A".repeat(43), invitationVersion: 7,
  operationId: "00000000-0000-4000-8000-000000000700", newPassword: "Synthetic-default-staff-only!2026",
};
const invitationColumns = "id,merchant_id,auth_user_id,email,role_id,status,accepted_at,invitation_version,invitation_token_hash,invitation_expires_at,invitation_revoked_at";
const registry = () => ({ found: true, source: "registry", auth_user_id: actor.id });
type Options = { lookup?: unknown; rpcError?: boolean; rpcNetworkError?: boolean; completed?: boolean };

async function runDefault(options: Options = {}) {
  const calls: string[] = [], unexpected: string[] = [];
  const previousFetch = globalThis.fetch;
  const environment = Object.fromEntries(Object.entries(process.env));
  let adminReads = 0, passwordUpdates = 0;
  let metadata = {
    provider: "email", principal_type: "merchant_staff", merchant_staff_email_hash: emailHash,
    merchant_staff_password_initialized: options.completed === true, retained_server_field: "unchanged",
  };
  const initialMetadata = structuredClone(metadata);
  const invitation = {
    id: employeeId, merchant_id: siteId, auth_user_id: actor.id, email: actor.email, role_id: roleId,
    status: "invited", accepted_at: null, invitation_version: 7, invitation_token_hash: sha256(command.invitationToken),
    invitation_expires_at: "2099-01-01T00:00:00.000Z", invitation_revoked_at: null,
  };
  const originalInvitation = structuredClone(invitation);
  const expectedSetup = {
    merchant_id: siteId, auth_user_id: actor.id, invitation_version: 7, token_hash: sha256(command.invitationToken),
    operation_id: command.operationId,
    password_fingerprint: sha256("faolla:merchant-employee-initial-password:v1\0" + command.invitationToken + "\0" + command.newPassword),
  };
  const guarded = <T>(action: () => T): T => {
    try { return action(); } catch (error) { unexpected.push("closed_protocol_violation"); throw error; }
  };
  const read = (request: Request) => guarded(() => {
    const url = new URL(request.url), query = Object.fromEntries(url.searchParams);
    assert.equal(url.origin, origin); assert.equal(request.method, "GET");
    assert.equal(request.headers.get("apikey"), serviceKey);
    assert.equal(request.headers.get("authorization"), "Bearer " + serviceKey);
    assert.equal(request.headers.get("accept"), "application/json");
    assert.equal([...url.searchParams.keys()].length, Object.keys(query).length);
    if (url.pathname === "/rest/v1/merchant_enterprise_employees") {
      calls.push("read:invitation");
      assert.match(query.invitation_expires_at, /^gt\.\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.deepEqual(query, {
        select: invitationColumns, merchant_id: "eq." + siteId, auth_user_id: "eq." + actor.id,
        invitation_version: "eq.7", invitation_token_hash: "eq." + sha256(command.invitationToken),
        status: "eq.invited", accepted_at: "is.null", invitation_revoked_at: "is.null",
        invitation_expires_at: query.invitation_expires_at, limit: "1",
      });
      return Response.json([invitation]);
    }
    assert.equal(url.pathname, "/rest/v1/merchant_enterprise_roles", "unexpected_default_table_read");
    calls.push("read:role");
    assert.deepEqual(query, { select: "id,merchant_id,status", merchant_id: "eq." + siteId, id: "eq." + roleId, status: "eq.active", limit: "1" });
    return Response.json([{ id: roleId, merchant_id: siteId, status: "active" }]);
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push("rpc:" + name);
    if (name === lookupName) {
      guarded(() => assert.deepEqual(args, { p_email_hash: emailHash }));
      if (options.rpcNetworkError) throw Error("synthetic_lookup_network_failure");
      if (options.rpcError) return { data: null, error: { message: "synthetic_lookup_private_database_detail" } };
      return { data: Object.hasOwn(options, "lookup") ? options.lookup : registry(), error: null };
    }
    return guarded(() => {
      assert([claimName, completeName].includes(name), "unexpected_default_rpc");
      assert.deepEqual(args, { p_input: expectedSetup });
      return { data: { ...expectedSetup, employee_id: employeeId,
        state: options.completed || name === completeName ? "completed" : "claimed", resumed: options.completed === true }, error: null };
    });
  };
  const result = await withAttendanceApplicationAuth([actor], rpc, async protocol => {
    const protocolFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      guarded(() => {
        assert.equal(url.origin, origin); assert(!url.username && !url.password && !url.hash);
      });
      if (url.pathname.startsWith("/auth/v1/admin/")) {
        guarded(() => {
          assert.equal(url.pathname, "/auth/v1/admin/users/" + actor.id); assert.equal(url.search, "");
          assert.equal(request.headers.get("apikey"), serviceKey);
          assert.equal(request.headers.get("authorization"), "Bearer " + serviceKey);
          assert(["GET", "PUT"].includes(request.method));
        });
        calls.push("admin:" + request.method);
        if (request.method === "GET") adminReads++;
        else {
          const update = await request.json();
          guarded(() => assert.deepEqual(update, { password: command.newPassword,
            app_metadata: { ...metadata, merchant_staff_password_initialized: true } }));
          metadata = update.app_metadata;
          passwordUpdates++;
        }
        return Response.json({ user: { ...actor, app_metadata: metadata } });
      }
      const response = await protocolFetch(request);
      if (url.pathname === "/auth/v1/user" && response.ok) {
        const user = await response.json();
        guarded(() => { assert.equal(request.method, "GET"); assert.equal(user.id, actor.id); });
        return Response.json({ ...user, app_metadata: metadata });
      }
      return response;
    };
    try {
      const token = protocol.issue(actor, ["invite"]);
      const response = await POST(new Request("https://www.faolla.com/api/merchant-enterprise/invitations/initial-password", {
        method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json", "x-merchant-access-token": token },
        body: JSON.stringify(command),
      }));
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(protocol.calls.filter(call => call.path === "/auth/v1/user").length, 2);
      assert(!protocol.calls.some(call => call.path === "/rest/v1/merchant_enterprise_staff_identities"));
      return { status: response.status, body: await response.json() };
    } finally { globalThis.fetch = protocolFetch; }
  }, undefined, read);
  assert.equal(globalThis.fetch, previousFetch);
  assert.deepEqual(Object.fromEntries(Object.entries(process.env)), environment);
  assert.deepEqual(unexpected, [], "closed_default_protocol_must_not_mask_unexpected_requests");
  assert.deepEqual(invitation, originalInvitation);
  return { ...result, calls, adminReads, passwordUpdates, metadata, initialMetadata };
}

function assertDenied(result: Awaited<ReturnType<typeof runDefault>>, status = 410) {
  assert.equal(result.status, status);
  assert.deepEqual(result.body, { ok: false, error: status === 410
    ? "employee_invitation_invalid_or_expired" : "employee_initial_password_store_unavailable" });
  assert.deepEqual(result.calls, ["read:invitation", "read:role", "rpc:" + lookupName]);
  assert.equal(result.adminReads, 0); assert.equal(result.passwordUpdates, 0);
  assert.deepEqual(result.metadata, result.initialMetadata);
}

test("default POST uses registry-only lookup through SDK, then preserves the original claim/Auth/complete sequence", async () => {
  const result = await runDefault();
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
  assert.deepEqual(result.calls, ["read:invitation", "read:role", "rpc:" + lookupName,
    "read:invitation", "read:role", "rpc:" + claimName, "admin:GET", "admin:PUT", "rpc:" + completeName]);
  assert.equal(result.adminReads, 1); assert.equal(result.passwordUpdates, 1);
  assert.deepEqual(result.metadata, { ...result.initialMetadata, merchant_staff_password_initialized: true });
});

test("default completed replay still validates the registry and current Auth state, without a password rewrite or complete RPC", async () => {
  const result = await runDefault({ completed: true });
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
  assert.deepEqual(result.calls, ["read:invitation", "read:role", "rpc:" + lookupName,
    "read:invitation", "read:role", "rpc:" + claimName, "admin:GET"]);
  assert.equal(result.adminReads, 1); assert.equal(result.passwordUpdates, 0);
  assert.deepEqual(result.metadata, result.initialMetadata);
});

test("default lookup refuses missing identities and Auth-recovery identities without claiming or mutating Auth", async () => {
  for (const lookup of [{ found: false, source: "none", auth_user_id: null },
    { found: true, source: "auth_recovery", auth_user_id: actor.id },
    { found: false, source: "registry", auth_user_id: actor.id }]) assertDenied(await runDefault({ lookup }));
});

test("default lookup rejects malformed or coerced proof fields before any claim/Auth operation", async () => {
  for (const lookup of [null, [], [registry()], "registry", {},
    { ...registry(), found: "true" }, { ...registry(), found: 1 },
    { ...registry(), source: "Registry" }, { ...registry(), source: " registry " },
    { found: true, auth_user_id: actor.id }, { found: true, source: "registry" }]) assertDenied(await runDefault({ lookup }));
});

test("default lookup requires the exact validated current Auth ID, not another user or a normalized approximation", async () => {
  for (const auth_user_id of ["00000000-0000-4000-8000-000000000001", " " + actor.id, actor.id + " ", null, 2])
    assertDenied(await runDefault({ lookup: { ...registry(), auth_user_id } }));
});

test("default lookup RPC and network failures remain503, disclose no private error and never continue with a table-read fallback", async () => {
  assertDenied(await runDefault({ rpcError: true }), 503);
  assertDenied(await runDefault({ rpcNetworkError: true }), 503);
});
