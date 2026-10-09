import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceSelf, attendanceSelfDependencies } from "./route-handler";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import type { AttendanceSelfInput } from "@/lib/merchantAttendanceSelf.server";

const userId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const locationId = "00000000-0000-4000-8000-000000000003";
const body = { siteId: "99990001", expectedWorkerId: userId, operationId, locationId, action: "clock_in", expectedSequence: 0 };
const url = "https://launch.faolla.com/api/merchant-enterprise/attendance/self";
function post(value: unknown = body, origin = "https://launch.faolla.com") {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(value) });
}
// The HTTP fixture has an explicit synthetic cohort, never the publisher's cohort.
// Restore both values so other tests cannot inherit this fixture's admission.
let previousRollout: { enabled?: string; sites?: string };
beforeEach(() => {
  previousRollout = { enabled: process.env.FAOLLA_ATTENDANCE_ROLLOUT_ENABLED, sites: process.env.FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS };
  process.env.FAOLLA_ATTENDANCE_ROLLOUT_ENABLED = "1";
  process.env.FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS = body.siteId;
});
afterEach(() => {
  if (previousRollout.enabled === undefined) delete process.env.FAOLLA_ATTENDANCE_ROLLOUT_ENABLED;
  else process.env.FAOLLA_ATTENDANCE_ROLLOUT_ENABLED = previousRollout.enabled;
  if (previousRollout.sites === undefined) delete process.env.FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS;
  else process.env.FAOLLA_ATTENDANCE_ROLLOUT_SITE_IDS = previousRollout.sites;
});
function setup(overrides: Partial<typeof attendanceSelfDependencies> = {}) {
  const executed: AttendanceSelfInput[] = []; const entitlements: string[] = [];
  const deps: typeof attendanceSelfDependencies = {
    enabled: () => true,
    authenticate: async () => ({ user: { id: userId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async (siteId) => { entitlements.push(siteId); return { id: siteId, permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof attendanceSelfDependencies.entitlement>>; },
    allow: () => true,
    execute: async (input) => { executed.push(input); return { workerId: userId, locationId, state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false }; },
    ...overrides,
  };
  return { deps, executed, entitlements };
}

test("attendance route stays default off before any authentication or persistence", async () => {
  let touched = false;
  const { deps } = setup({ enabled: () => false, authenticate: async () => { touched = true; throw Error("must not authenticate"); } });
  const response = await handleAttendanceSelf(post(), deps);
  assert.equal(response.status, 404); assert.equal(touched, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("self punch identity is derived only from validated auth and current entitlement is required", async () => {
  const { deps, executed, entitlements } = setup();
  const response = await handleAttendanceSelf(post(), deps);
  assert.equal(response.status, 200); assert.deepEqual(entitlements, [body.siteId]);
  assert.deepEqual(executed, [{ siteId: body.siteId, authUserId: userId, command: { expectedWorkerId: userId, operationId, locationId, action: "clock_in", expectedSequence: 0 }, operationId: null }]);
});
test("status and receipt reads are scoped to authenticated principal", async () => {
  const { deps, executed } = setup();
  const response = await handleAttendanceSelf(new Request(`${url}?siteId=${body.siteId}&operationId=${operationId}`), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(executed, [{ siteId: body.siteId, authUserId: userId, operationId, command: null }]);
});
for (const key of ["employeeId", "workerId", "authUserId", "occurredAt", "source", "breakPaid", "position"]) {
  test(`self endpoint rejects client override ${key}`, async () => {
    const { deps, executed } = setup();
    const response = await handleAttendanceSelf(post({ ...body, [key]: "forged" }), deps);
    assert.equal(response.status, 400); assert.deepEqual(executed, []);
  });
}
for (const query of ["siteId=99990001&siteId=99990002", "siteId=99990001&workerId=another", "siteId=99990001&operationId=bad", "siteId=99990001&operationId=", "siteId=invalid"]) {
  test(`strict attendance query rejects ${query}`, async () => {
    const { deps, executed } = setup();
    assert.equal((await handleAttendanceSelf(new Request(`${url}?${query}`), deps)).status, 400);
    assert.deepEqual(executed, []);
  });
}
for (const authenticationMethods of [["magiclink"], ["recovery"], ["password", "invite"], ["password", "recovery"], []]) {
  test(`attendance rejects non-password employee session ${authenticationMethods.join(",")}`, async () => {
    const { deps, executed } = setup({ authenticate: async () => ({ user: { id: userId } as User, accessToken: "synthetic", authenticationMethods }) });
    assert.equal((await handleAttendanceSelf(post(), deps)).status, 403); assert.deepEqual(executed, []);
  });
}
test("cross-origin or missing-origin requests cannot reach attendance auth", async () => {
  let touched = false;
  const { deps } = setup({ authenticate: async () => { touched = true; throw Error("unexpected"); } });
  for (const origin of ["https://attacker.example", "null", ""]) assert.equal((await handleAttendanceSelf(post(body, origin), deps)).status, 403);
  assert.equal(touched, false);
});
test("disabled enterprise entitlement never reaches persistence", async () => {
  const { deps, executed } = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleAttendanceSelf(post(), deps)).status, 403); assert.deepEqual(executed, []);
});
test("platform pause prevents new shifts and breaks but admits authenticated closing actions and receipt reads", async () => {
  const {deps,executed}=setup({entitlement:async()=>({id:body.siteId,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceSelfDependencies.entitlement>>});
  for(const action of ["clock_in","break_start"]) {
    const r=await handleAttendanceSelf(post({...body,action}),deps);assert.equal(r.status,403);assert.equal((await r.json()).error,"attendance_platform_paused");
  }
  assert.equal(executed.length,0);
  for(const action of ["break_end","clock_out"]) {
    const r=await handleAttendanceSelf(post({...body,action}),deps);assert.equal(r.status,200);assert.equal((await r.json()).moduleEnabled,false);
  }
  const r=await handleAttendanceSelf(new Request(`${url}?siteId=${body.siteId}&operationId=${operationId}`),deps);
  assert.equal(r.status,200);assert.equal((await r.json()).moduleEnabled,false);assert.equal(executed.length,3);
});
test("pause never bypasses current DB membership, role, state or enterprise checks", async () => {
  const {deps}=setup({entitlement:async()=>({id:body.siteId,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:false}}) as Awaited<ReturnType<typeof attendanceSelfDependencies.entitlement>>});
  for(const [code,status] of [["attendance_access_denied",403],["attendance_not_clocked_in",409],["attendance_break_must_end",409]] as const) {
    deps.execute=async()=>{throw new MerchantAttendanceError(code);};
    assert.equal((await handleAttendanceSelf(post({...body,action:"clock_out"}),deps)).status,status);
  }
  deps.entitlement=async()=>{throw new MerchantEnterpriseAccessError("enterprise_management_disabled",403);};
  assert.equal((await handleAttendanceSelf(post({...body,action:"clock_out"}),deps)).status,403);
});
test("each request rechecks platform admission and cannot trust client switch claims", async () => {
  let enabled=true;
  const {deps,executed}=setup({entitlement:async()=>({id:body.siteId,permissionConfig:{allowEnterpriseManagement:true,allowEmployeeAttendance:enabled}}) as Awaited<ReturnType<typeof attendanceSelfDependencies.entitlement>>});
  assert.equal((await handleAttendanceSelf(post(),deps)).status,200);enabled=false;
  assert.equal((await handleAttendanceSelf(post(),deps)).status,403);
  assert.equal((await handleAttendanceSelf(post({...body,moduleEnabled:true}),deps)).status,400);assert.equal(executed.length,1);
  deps.entitlement=async()=>({}) as Awaited<ReturnType<typeof attendanceSelfDependencies.entitlement>>;
  assert.equal((await handleAttendanceSelf(post(),deps)).status,403);
});
test("rate limit is scoped to verified identity before body, entitlement and persistence", async () => {
  let key = "";
  const { deps, executed, entitlements } = setup({ allow: (authUserId) => { key = authUserId; return false; } });
  const response = await handleAttendanceSelf(post(), deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(key, userId); assert.deepEqual(executed, []); assert.deepEqual(entitlements, []);
});
for (const [error, status, code] of [
  [new MerchantAttendanceError("attendance_sequence_conflict"), 409, "attendance_sequence_conflict"],
  [new MerchantAttendanceError("attendance_access_denied"), 403, "attendance_access_denied"],
  [new Error("database credential and internal details"), 503, "attendance_unavailable"],
] as const) {
  test(`attendance failure ${code} is sanitized and never success`, async () => {
    const { deps } = setup({ execute: async () => { throw error; } });
    const response = await handleAttendanceSelf(post(), deps);
    assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code });
  });
}
test("malformed, oversized, and wrong-content-type bodies cannot be persisted", async () => {
  for (const [content, type, expected] of [["{", "application/json", 400], ["x".repeat(4097), "application/json", 413], [JSON.stringify(body), "text/plain", 415]] as const) {
    const { deps, executed } = setup();
    const request = new Request(url, { method: "POST", headers: { origin: "https://launch.faolla.com", "content-type": type }, body: content });
    assert.equal((await handleAttendanceSelf(request, deps)).status, expected); assert.deepEqual(executed, []);
  }
});
test("synthetic cohort still rejects missing and foreign entitlement identities before new punches", async () => {
  for (const siteId of [undefined, "99990002"]) {
    const { deps, executed } = setup({ entitlement: async () => ({ id: siteId, permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof attendanceSelfDependencies.entitlement>> });
    const response = await handleAttendanceSelf(post(), deps);
    assert.equal(response.status, 403); assert.equal((await response.json()).error, "attendance_platform_paused");
    assert.equal(executed.length, 0);
  }
});
