import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { withAttendanceApplicationAuth } from "./attendance-application-auth";

const origin = "https://attendance-auth.invalid", anon = "attendance-synthetic-anon", service = "attendance-synthetic-service";
const actor = { id: "00000000-0000-4000-8000-000000000099", email: "owner@example.test" };
const serviceHeaders = { apikey: service, authorization: "Bearer " + service };
const flags = ["SELF", "ADMIN", "CORRECTIONS", "CORRECTION_REVIEW", "CORRECTION_DECISIONS", "CURRENT_CORRECTION_DECISIONS", "REVISION_REQUESTS", "REVISION_CYCLES", "REVISION_REVIEW", "REVISION_DECISIONS", "REVISION_HISTORY"];
const environmentKeys = ["SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_SUPABASE_SERVICE_ROLE_KEY", "FAOLLA_CANONICAL_PORTAL_ORIGIN",
  ...flags.map(flag => "FAOLLA_ATTENDANCE_" + flag + "_ENABLED")];
const environment = (): Array<[string, string | undefined]> => environmentKeys.map(key => [key, process.env[key]]);

test("without additionalRead, an unknown REST GET remains forbidden and normal finally restores globals", async () => {
  const previousFetch = globalThis.fetch, previousEnvironment = environment();
  await withAttendanceApplicationAuth([actor], null, async () => {
    await assert.rejects(fetch(origin + "/rest/v1/merchant_enterprise_roles?select=id", { headers: serviceHeaders }), /fixture_unexpected_endpoint/);
  });
  assert.equal(globalThis.fetch, previousFetch); assert.deepEqual(environment(), previousEnvironment);
});

test("additionalRead admits only same-origin REST GET with both exact service headers", async () => {
  const entered: Request[] = [], result = Response.json({ syntheticRead: true });
  await withAttendanceApplicationAuth([actor], null, async () => {
    const url = origin + "/rest/v1/merchant_enterprise_roles?select=id&merchant_id=eq.99990001";
    assert.equal(await fetch(url, { headers: serviceHeaders }), result);
    assert.equal(entered.length, 1); assert.equal(entered[0].method, "GET"); assert.equal(entered[0].url, url);
    const forbidden: Array<[string, RequestInit]> = [
      ...["POST", "PATCH", "DELETE", "PUT", "HEAD"].map(method => [url, { method, headers: serviceHeaders }] as [string, RequestInit]),
      [url, {}],
      [url, { headers: { apikey: anon, authorization: "Bearer " + anon } }],
      [url, { headers: { apikey: service } }],
      [url, { headers: { authorization: "Bearer " + service } }],
      [url, { headers: { apikey: anon, authorization: "Bearer " + service } }],
      [url, { headers: { apikey: service, authorization: "Bearer " + anon } }],
      [url.replace(origin, "https://not-fixture.example.test"), { headers: serviceHeaders }],
      [origin + "/not-rest/merchant_enterprise_roles", { headers: serviceHeaders }],
    ];
    for (const [path, init] of forbidden) {
      await assert.rejects(fetch(path, init));
      assert.equal(entered.length, 1, "a rejected request must not reach the read extension");
    }
  }, undefined, request => { entered.push(request); return result; });
});

test("installed SDK password login, authenticated user read and service RPC keep their original dispatch", async () => {
  let adapterCalls = 0;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  await withAttendanceApplicationAuth([actor], async (name, args) => {
    rpcCalls.push({ name, args }); return { data: { accepted: true }, error: null };
  }, async auth => {
    const token = await auth.login(actor);
    assert(typeof token === "string" && token.length > 0, "synthetic SDK login must establish a session");
    const user = await fetch(origin + "/auth/v1/user", { headers: { apikey: anon, authorization: "Bearer " + token } });
    assert.equal(user.status, 200); assert.equal((await user.json()).id, actor.id);
    const sdk = createClient(origin, service, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const result = await sdk.rpc("synthetic_fixture_rpc", { p_site_id: "99990001" });
    assert.equal(result.error, null); assert.deepEqual(result.data, { accepted: true });
    assert.deepEqual(rpcCalls, [{ name: "synthetic_fixture_rpc", args: { p_site_id: "99990001" } }]);
    assert.equal(adapterCalls, 0);
    assert(auth.calls.some(call => call.path === "/auth/v1/token" && call.method === "POST"));
    assert(auth.calls.some(call => call.path === "/rest/v1/rpc/synthetic_fixture_rpc" && call.method === "POST"));
    await assert.rejects(fetch(origin + "/rest/v1/rpc/synthetic_fixture_rpc", { method: "POST", headers: { apikey: anon, authorization: "Bearer " + anon }, body: "{}" }));
    assert.equal(rpcCalls.length, 1); assert.equal(adapterCalls, 0);
  }, undefined, () => { adapterCalls++; throw Error("read_extension_must_not_capture_auth_or_rpc"); });
});

test("legacy merchant identity reads retain precedence over the optional extension", async () => {
  let identityCalls = 0, additionalCalls = 0;
  await withAttendanceApplicationAuth([actor], null, async () => {
    for (const table of ["merchants", "merchant_enterprise_employees"]) {
      const result = await fetch(origin + "/rest/v1/" + table + "?select=id", { headers: serviceHeaders });
      assert.deepEqual(await result.json(), { legacyIdentity: true });
    }
    assert.equal(identityCalls, 2); assert.equal(additionalCalls, 0);
    await assert.rejects(fetch(origin + "/rest/v1/merchants?select=id", { method: "PATCH", headers: serviceHeaders, body: "{}" }));
    assert.equal(identityCalls, 2); assert.equal(additionalCalls, 0);
  }, { ownerId: actor.id, read: () => { identityCalls++; return Response.json({ legacyIdentity: true }); } },
  () => { additionalCalls++; throw Error("legacy_identity_must_not_fall_through"); });
});

test("adapter failure or callback failure restores prior fetch and both present and absent environment entries", async () => {
  const savedFetch = globalThis.fetch, savedEnvironment = environment();
  // A sentinel verifies that rejected requests never escape to an outer fetch.
  let escaped = 0;
  const sentinel: typeof fetch = async () => { escaped++; throw Error("outer_fetch_must_not_run"); };
  globalThis.fetch = sentinel;
  process.env.FAOLLA_ATTENDANCE_SELF_ENABLED = "prior-synthetic-value";
  delete process.env.FAOLLA_ATTENDANCE_REVISION_HISTORY_ENABLED;
  const expectedEnvironment = environment();
  try {
    for (const failure of ["adapter", "callback"] as const) {
      const expectedError = Error("synthetic_" + failure + "_failure");
      await assert.rejects(withAttendanceApplicationAuth([actor], null, async () => {
        if (failure === "callback") throw expectedError;
        await fetch(origin + "/rest/v1/merchant_enterprise_roles?select=id", { headers: serviceHeaders });
      }, undefined, () => { throw expectedError; }), error => error === expectedError);
      assert.equal(globalThis.fetch, sentinel); assert.deepEqual(environment(), expectedEnvironment); assert.equal(escaped, 0);
    }
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.equal(globalThis.fetch, savedFetch); assert.deepEqual(environment(), savedEnvironment);
});
