import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { handleShiftTemplates, shiftTemplatesDependencies } from "./route-handler";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/shift-templates";
const id = "00000000-0000-4000-8000-000000000001";
const query = { siteId: "99990001", view: "active" as const, cursorId: null, operationId: null };
const command = { operationId: id, templateId: id, expectedRevision: 0, action: "save", template: {
  name: "Morning", segments: [{ start: "09:00", end: "13:00", nextDay: false }],
} };
const get = () => new Request(`${url}?siteId=99990001&view=active`);
const post = (body: unknown = { query, command }) => new Request(url, { method: "POST", headers: {
  origin: "https://www.faolla.com", "content-type": "application/json",
}, body: JSON.stringify(body) });
function fixture(patch: Partial<typeof shiftTemplatesDependencies> = {}) {
  const calls: Parameters<typeof shiftTemplatesDependencies.execute>[0][] = [];
  const deps: typeof shiftTemplatesDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof shiftTemplatesDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { siteId: input.query.siteId, view: input.query.view, items: [], nextCursor: null, receipt: null }; }, ...patch };
  return { deps, calls };
}

test("templates default off and reject noncanonical origins/methods before authenticating", async t => {
  const old = process.env.FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED;
  t.after(() => { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED; else process.env.FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED = old; });
  delete process.env.FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED;
  assert.equal(shiftTemplatesDependencies.enabled(), false);
  let authCalls = 0;
  const { deps } = fixture({ enabled: shiftTemplatesDependencies.enabled, authenticate: async () => { authCalls++; throw Error("must not authenticate"); } });
  assert.equal((await handleShiftTemplates(get(), deps)).status, 404);
  process.env.FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED = "true"; assert.equal(shiftTemplatesDependencies.enabled(), false);
  process.env.FAOLLA_ATTENDANCE_SHIFT_TEMPLATES_ENABLED = "1"; assert.equal(shiftTemplatesDependencies.enabled(), true);
  assert.equal((await handleShiftTemplates(new Request(url, { method: "DELETE" }), deps)).status, 405);
  assert.equal((await handleShiftTemplates(new Request(get().url.replace("www.", "merchant.")), deps)).status, 403);
  const crossOrigin = post(); crossOrigin.headers.set("origin", "https://evil.invalid");
  assert.equal((await handleShiftTemplates(crossOrigin, deps)).status, 403);
  assert.equal(authCalls, 0);
});

test("ordinary password/OAuth authentication is accepted while invite/recovery/magic-link sessions cannot read or write", async () => {
  for (const methods of [["password"], ["oauth"], ["password", "oauth"]]) {
    const { deps, calls } = fixture({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleShiftTemplates(get(), deps)).status, 200);
    assert.equal((await handleShiftTemplates(post(), deps)).status, 200);
    assert.equal(calls[1].authUserId, id); assert.equal(calls[1].allowWrite, true);
  }
  for (const methods of [[], ["invite"], ["recovery"], ["magiclink"], ["password", "recovery"], ["oauth", "invite"]]) {
    const { deps, calls } = fixture({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    for (const request of [get(), post()]) assert.equal((await handleShiftTemplates(request, deps)).status, 403);
    assert.equal(calls.length, 0);
  }
});

test("fresh entitlement supplies write authority and a paused module still allows an authenticated receipt read", async () => {
  const sites: string[] = [];
  const { deps, calls } = fixture({ entitlement: async siteId => {
    sites.push(siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof shiftTemplatesDependencies.entitlement>>;
  } });
  const response = await handleShiftTemplates(new Request(get().url + `&operationId=${id}`), deps);
  assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  assert.equal(calls[0].allowWrite, false); assert.equal(calls[0].command, null); assert.equal(calls[0].query.operationId, id);
  assert.deepEqual(sites, [query.siteId]);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("vary")!, /Authorization/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const denied = fixture({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleShiftTemplates(post(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});

test("exact bodies, duplicate queries, POST query parameters, content type and bounded size reject before the executor", async () => {
  const { deps, calls } = fixture();
  for (const body of [{ query, command, authUserId: id }, { query, command, allowWrite: true },
    { query: { ...query, ownerId: id }, command }, { query, command: { ...command, timeZone: "UTC" } }])
    assert.equal((await handleShiftTemplates(post(body), deps)).status, 400);
  assert.equal((await handleShiftTemplates(new Request(get().url + "&view=archived"), deps)).status, 400);
  const withQuery = new Request(url + "?ignored=1", post());
  assert.equal((await handleShiftTemplates(withQuery, deps)).status, 400);
  const wrongType = post(); wrongType.headers.set("content-type", "text/plain");
  assert.equal((await handleShiftTemplates(wrongType, deps)).status, 415);
  assert.equal((await handleShiftTemplates(post({ query, command, padding: "x".repeat(5000) }), deps)).status, 413);
  assert.equal(calls.length, 0);
});

test("limiter binds authenticated user; typed conflicts survive but unexpected database details remain private", async () => {
  const actors: string[] = []; const limited = fixture({ allow: actor => { actors.push(actor); return false; } });
  const response = await handleShiftTemplates(post(), limited.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(actors, [id]); assert.equal(limited.calls.length, 0);
  for (const [code, status] of [["attendance_version_conflict", 409], ["attendance_platform_paused", 403]] as const) {
    const rejected = fixture({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const r = await handleShiftTemplates(post(), rejected.deps); assert.equal(r.status, status);
    assert.deepEqual(await r.json(), { ok: false, error: code });
  }
  const broken = fixture({ execute: async () => { throw Error("private SQL credentials"); } });
  const r = await handleShiftTemplates(get(), broken.deps); assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, error: "attendance_unavailable" });
});
