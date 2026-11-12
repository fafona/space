import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verifySuperAdminAccountEmail} from "./superAdminAccountEmailVerification.server";

const authUserId = "10000000-0000-4000-8000-000000000001";
const input = {action: "verify_email", authUserId, accountId: "10909096", accountType: "merchant", email: "pending@example.invalid", confirmed: true};
const request = () => new Request("https://launch.faolla.com/api/super-admin/merchant-accounts", {method: "POST", headers: {origin: "https://launch.faolla.com"}});
function harness(overrides: Record<string, unknown> = {}, options: {authorized?: boolean; trusted?: boolean; readError?: boolean; writeError?: boolean; unconfirmedResult?: boolean} = {}) {
  let reads = 0, sessionReads = 0;
  const updates: Record<string, unknown>[] = [];
  const user = {id: authUserId, email: input.email, email_confirmed_at: null as string | null,
    user_metadata: {account_type: "merchant", account_id: input.accountId, email_verified: true},
    app_metadata: {provider: "email", private_service: {expiresAt: "2099-01-01", plan: 3}}, ...overrides};
  const admin = {
    getUserById: async (id: string) => {reads++; assert.equal(id, authUserId); return {data: {user}, error: options.readError ? Error("private error") : null};},
    updateUserById: async (id: string, attrs: Record<string, unknown>) => {
      assert.equal(id, authUserId); updates.push(attrs);
      if (options.writeError) return {data: {user: null}, error: Error("private update failure")};
      user.app_metadata = {...user.app_metadata, ...(attrs.app_metadata as Record<string, unknown>)};
      if (!options.unconfirmedResult) user.email_confirmed_at = "2026-11-12T15:00:00Z";
      return {data: {user}, error: null};
    },
  } as unknown as Parameters<typeof verifySuperAdminAccountEmail>[2];
  const deps = {trusted: () => options.trusted !== false, session: async () => {
    sessionReads++;
    return options.authorized === false ? null : {version: 2 as const, kind: "session" as const, deviceId: "actual-admin-device", deviceLabel: "Admin", issuedAt: 1, expiresAt: Date.now() + 100000};
  }};
  return {user, updates, count: () => ({reads, sessionReads}), run: (p: unknown = input) => verifySuperAdminAccountEmail(request(), p, admin, deps)};
}

test("manual verification rejects untrusted or non-super-admin requests before touching auth storage", async () => {
  const untrusted = harness({}, {trusted: false}); assert.equal((await untrusted.run()).status, 403);
  assert.deepEqual(untrusted.count(), {reads: 0, sessionReads: 0});
  const unauthorized = harness({}, {authorized: false}); assert.equal((await unauthorized.run()).status, 401);
  assert.equal(unauthorized.count().reads, 0); assert.deepEqual(unauthorized.updates, []);
});
test("manual verification requires an exact selected identity and explicit human confirmation", async () => {
  for (const patch of [{authUserId: "bad"}, {accountId: "x"}, {accountType: "admin"}, {email: "bad"}, {confirmed: false}]) {
    const h = harness(); assert.equal((await h.run({...input, ...patch})).status, 400); assert.equal(h.count().reads, 0); assert.deepEqual(h.updates, []);
  }
  for (const patch of [{email: "changed@example.invalid"}, {id: "20000000-0000-4000-8000-000000000002"},
    {user_metadata: {account_type: "personal", account_id: input.accountId}}, {user_metadata: {account_type: "merchant", account_id: "10909097"}},
    {deleted_at: "2026-11-11"}, {banned_until: "2099-01-01"}]) {
    const h = harness(patch); assert.equal((await h.run()).status, 409); assert.deepEqual(h.updates, []);
  }
});
test("confirming merchant or personal registration does not reset passwords, roles, services, permissions or identity", async () => {
  for (const [accountType, accountId] of [["merchant", input.accountId], ["personal", "50010105"], ["personal", "legacy-personal-id"]]) {
    const h = harness({user_metadata: {account_type: accountType, account_id: accountId, email_verified: true}});
    const before = structuredClone(h.user), response = await h.run({...input, accountType, accountId});
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json(); assert.equal(body.verification.emailConfirmed, true); assert.equal(body.alreadyVerified, false);
    assert.deepEqual(Object.keys(h.updates[0]).sort(), ["app_metadata", "email_confirm"]);
    assert.equal(h.updates[0].email_confirm, true);
    const metadata = h.updates[0].app_metadata as Record<string, {method: string; deviceId: string; eventId: string; at: string}>;
    assert.deepEqual(Object.keys(metadata), ["faolla_email_verification"]);
    assert.equal(metadata.faolla_email_verification.method, "super_admin"); assert.equal(metadata.faolla_email_verification.deviceId, "actual-admin-device");
    assert(Number.isFinite(Date.parse(metadata.faolla_email_verification.at))); assert.match(metadata.faolla_email_verification.eventId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(h.user.user_metadata, before.user_metadata); assert.deepEqual(h.user.app_metadata.private_service, before.app_metadata.private_service);
    assert(!JSON.stringify(body).includes("private_service")); assert(!JSON.stringify(body).includes("token"));
    const again = await h.run({...input, accountType, accountId}); assert.equal((await again.json()).alreadyVerified, true); assert.equal(h.updates.length, 1);
  }
});
test("unknown results never masquerade as completed verification or leak backend error details", async () => {
  for (const options of [{readError: true}, {writeError: true}, {unconfirmedResult: true}]) {
    const h = harness({}, options), response = await h.run(), body = await response.json();
    assert.equal(response.status, 503); assert.equal(body.verification, undefined); assert(!JSON.stringify(body).includes("private"));
  }
});
test("actual super-admin action retains origin/session guards, clears stale account cache and cannot fall into account creation", async () => {
  const source = await readFile(new URL("../app/api/super-admin/merchant-accounts/route-handler.ts", import.meta.url), "utf8");
  const post = source.slice(source.indexOf("export async function POST("), source.indexOf("export async function PATCH("));
  const action = post.indexOf('payload?.action === "verify_email"');
  assert(post.indexOf("isTrustedSameOriginMutationRequest(request)") < action); assert(post.indexOf("ensureAuthorized(request)") < action);
  assert(action < post.indexOf("createUser("));
  const branch = post.slice(action, post.indexOf("const accountType:", action));
  assert(branch.includes("return await verifySuperAdminAccountEmail")); assert(branch.includes("finally { merchantAccountsCache.clear(); }"));
  assert(!branch.includes("createUser")); assert(!branch.includes("insert("));
});
