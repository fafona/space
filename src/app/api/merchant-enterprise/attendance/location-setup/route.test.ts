import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleLocationSetup, locationSetupDependencies } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { createLocationSetupModel, setupOwner, setupQuery } from "../../../../../../scripts/fixtures/attendance-location-setup-model";
const base = "https://www.faolla.com/api/merchant-enterprise/attendance/location-setup";
const command = createLocationSetupModel().command("00000000-0000-4000-8000-000000000010");
const body = { siteId: setupQuery.siteId, locationId: setupQuery.locationId, ...command };
const get = () => new Request(`${base}?siteId=${setupQuery.siteId}&locationId=${setupQuery.locationId}`);
const post = (value: unknown = body) => new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json" }, body: JSON.stringify(value) });
function setup(extra: Partial<typeof locationSetupDependencies> = {}) {
  const calls: Parameters<typeof locationSetupDependencies.execute>[0][] = [];
  const deps: typeof locationSetupDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: setupOwner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof locationSetupDependencies.entitlement>>,
    execute: async input => { calls.push(input); return createLocationSetupModel().current(); }, ...extra };
  return { deps, calls };
}
test("owner setup is default gated and rejects foreign origin/method before authentication", async () => {
  let auth = 0; const { deps } = setup({ enabled: () => false, authenticate: async () => { auth++; throw Error("unused"); } });
  assert.equal((await handleLocationSetup(get(), deps)).status, 404); deps.enabled = () => true;
  assert.equal((await handleLocationSetup(new Request(get().url.replace("www.", "merchant.")), deps)).status, 403);
  assert.equal((await handleLocationSetup(new Request(base, { method: "POST", headers: { Origin: "https://foreign.invalid" } }), deps)).status, 403);
  assert.equal((await handleLocationSetup(new Request(base, { method: "DELETE" }), deps)).status, 405); assert.equal(auth, 0);
});
test("normal owner password/OAuth sessions can proceed but recovery/invite/magiclink cannot", async () => {
  for (const methods of [[], ["invite"], ["magiclink"], ["password", "recovery"], ["password"], ["oauth"]]) {
    const { deps, calls } = setup({ authenticate: async () => ({ user: { id: setupOwner } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    assert.equal((await handleLocationSetup(get(), deps)).status, allowed ? 200 : 403); assert.equal(calls.length, allowed ? 1 : 0);
  }
});
test("server entitlement and actor are derived on every request; paused operations reach atomic replay/pause guards", async () => {
  let auth = 0, entitlement = 0; const { deps, calls } = setup(); const authenticate = deps.authenticate;
  deps.authenticate = async r => { auth++; return authenticate(r); };
  deps.entitlement = async () => { entitlement++; return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof deps.entitlement>>; };
  for (const request of [get(), post(), post({ ...body, action: "pause", draftRevision: null })]) {
    const response = await handleLocationSetup(request, deps); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(auth, 3); assert.equal(entitlement, 3); assert.ok(calls.every(c => !c.allowPrepare && c.authUserId === setupOwner));
});
test("strict body/query size and identity prevent control flags or coordinates from entering RPC", async () => {
  const { deps, calls } = setup();
  for (const request of [post({ ...body, allowPrepare: true }), post({ ...body, ownerId: setupOwner }), post({ ...body, latitude: 0 }), new Request(get().url + "&siteId=99990002"), new Request(base + "?x=1", post())])
    assert.equal((await handleLocationSetup(request, deps)).status, 400);
  assert.equal((await handleLocationSetup(post({ padding: "x".repeat(5000) }), deps)).status, 413);
  assert.equal((await handleLocationSetup(new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com" }, body: "{}" }), deps)).status, 415); assert.equal(calls.length, 0);
});
test("known denials are mapped but internal diagnostics never leave the route", async () => {
  for (const [code, status] of [["attendance_setup_not_ready", 409], ["attendance_setup_unchanged", 409], ["attendance_access_denied", 403], ["private SQL diagnostic", 503], ["constructor", 503]] as const) {
    const { deps } = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }); const response = await handleLocationSetup(post(), deps);
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private SQL|constructor/);
  }
});
test("rate limit is applied before execution and reports bounded retry", async () => {
  const { deps, calls } = setup({ allow: () => false }); const response = await handleLocationSetup(get(), deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("Retry-After"), "60"); assert.equal(calls.length, 0);
});
