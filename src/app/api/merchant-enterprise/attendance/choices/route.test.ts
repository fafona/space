import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceChoices, attendanceChoicesDependencies } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const id = "00000000-0000-4000-8000-000000000001";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/choices?siteId=99990001&kind=managers";
function setup(extra: Partial<typeof attendanceChoicesDependencies> = {}) {
  let calls = 0;
  const deps: typeof attendanceChoicesDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["oauth"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceChoicesDependencies.entitlement>>,
    execute: async input => { calls++; assert.equal(input.authUserId, id); return { ...input, items: [], nextCursor: null }; }, ...extra };
  return { deps, calls: () => calls };
}
test("selectors are GET only, default closed and canonical", async () => {
  const s = setup({ enabled: () => false }); assert.equal((await handleAttendanceChoices(new Request(url), s.deps)).status, 404);
  s.deps.enabled = () => true;
  assert.equal((await handleAttendanceChoices(new Request(url, { method: "POST" }), s.deps)).status, 405);
  assert.equal((await handleAttendanceChoices(new Request(url.replace("www.", "tenant.")), s.deps)).status, 403); assert.equal(s.calls(), 0);
});
test("owner selection remains available during platform pause but current owner still checked in DB", async () => {
  const s = setup(); const r = await handleAttendanceChoices(new Request(url), s.deps);
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal((await r.json()).moduleEnabled, false);
  s.deps.execute = async () => { throw new MerchantAttendanceError("attendance_access_denied"); };
  assert.equal((await handleAttendanceChoices(new Request(url), s.deps)).status, 403);
});
for (const methods of [[], ["recovery"], ["invite"], ["password", "magiclink"]]) test(`selector refuses unsafe auth ${methods}`, async () => {
  const s = setup({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
  assert.equal((await handleAttendanceChoices(new Request(url), s.deps)).status, 403); assert.equal(s.calls(), 0);
});
test("selector rejects malformed query and hides internal errors", async () => {
  const s = setup(); assert.equal((await handleAttendanceChoices(new Request(url + "&kind=workers"), s.deps)).status, 400);
  assert.equal(s.calls(), 0); s.deps.execute = async () => { throw Error("private internals"); };
  const r = await handleAttendanceChoices(new Request(url), s.deps); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" });
});
test("exact lookup preserves current identity checks, pause reads, limits and private cache policy", async () => {
  const s = setup({ execute: async input => {
    assert.deepEqual(input.ids,[id]); assert.equal(input.authUserId,id);
    return {siteId:input.siteId,kind:input.kind,items:[],nextCursor:null};
  }});
  const response=await handleAttendanceChoices(new Request(url+`&ids=${id}`),s.deps);
  assert.equal(response.status,200); assert.equal((await response.json()).moduleEnabled,false);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.equal((await handleAttendanceChoices(new Request(url+`&ids=${id}&search=`),s.deps)).status,400);
  s.deps.allow=()=>false;
  const limited=await handleAttendanceChoices(new Request(url+`&ids=${id}`),s.deps);
  assert.equal(limited.status,429); assert.equal(limited.headers.get("retry-after"),"60");
});
