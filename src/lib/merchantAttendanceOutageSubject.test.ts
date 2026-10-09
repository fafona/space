import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { OUTAGE_SUBJECT_API, outageSubjectQueryString, parseOutageSubjectHttpQuery, parseOutageSubjectQuery,
  parseOutageSubjectResponse, parseOutageSubjectResult, type OutageSubjectQuery, type OutageSubjectResult } from "./merchantAttendanceOutageSubject";
import { executeOutageSubject } from "./merchantAttendanceOutageSubject.server";
import { handleOutageSubject, outageSubjectDependencies as defaults } from "../app/api/merchant-enterprise/attendance/outage-subject/route-handler";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99999001", owner = id(1), employee = id(2), origin = "https://www.faolla.com", url = origin + OUTAGE_SUBJECT_API;
const query = (access: "owner" | "self" = "owner"): OutageSubjectQuery => ({ siteId, access, workerId: access === "owner" ? id(3) : null, incidentId: id(5) });
const result = (access: "owner" | "self" = "owner"): OutageSubjectResult => ({ protocol: "attendance-outage-subject-v1", siteId, access, actorId: access === "owner" ? owner : employee,
  readAt: "2026-10-07T12:00:00.000000Z", canWrite: false,
  subject: { workerId: id(3), employeeId: id(4), employeeAuthUserId: employee, workerVersion: 7, employeeVersion: 9, generation: 0, displayName: "当前考勤人员", active: true, paused: false },
  incident: { id: id(5), type: "network", channel: "web", locationId: null,
    interval: { startAt: "2026-10-07T08:00:00.000001Z", endAt: "2026-10-07T10:00:00.000001Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 } } });
const headers = { origin, "sec-fetch-site": "same-origin" };
const request = (q = query()) => new Request(url + "?" + outageSubjectQueryString(q), { headers });
function setup(access: "owner" | "self" = "owner", patch: Partial<typeof defaults> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const deps: typeof defaults = { authenticate: async () => ({ user: { id: access === "owner" ? owner : employee } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
    allow: () => true, siteEnabled: () => false,
    execute: input => executeOutageSubject(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: result(access), error: null }; } }), ...patch };
  return { deps, calls };
}
test("owner must select a worker while self only supplies known incident and never caller-chosen identity", () => {
  for (const access of ["owner", "self"] as const) assert.deepEqual(parseOutageSubjectQuery(query(access)), query(access));
  for (const bad of [{ ...query(), workerId: null }, { ...query("self"), workerId: id(3) }, { ...query(), incidentId: null },
    { ...query(), siteId: siteId + "\n" }, { ...query(), actorId: owner }, { ...query(), employeeId: id(4) }, { ...query(), mode: "list" }]) {
    assert.throws(() => parseOutageSubjectQuery(bad), { code: "attendance_invalid_request" });
  }
});
test("HTTP query is exact, duplicate-aware and accepts omitted null only for self", () => {
  for (const access of ["owner", "self"] as const) assert.deepEqual(parseOutageSubjectHttpQuery(request(query(access)).url), query(access));
  for (const bad of [request().url + "&workerId=" + id(3), request().url + "&worker%49d=" + id(3), request().url + "&command=x", request().url + "#",
    request().url + "&x=%ff", request().url + "&x=%", request().url.replace("www.faolla.com", "user:pw@www.faolla.com"),
    request(query("self")).url + "&workerId=null", request().url.replace("&workerId=" + id(3), ""), request().url + "&x=" + "x".repeat(4096)]) {
    assert.throws(() => parseOutageSubjectHttpQuery(bad), { code: "attendance_invalid_request" });
  }
});
test("fresh subject contains exact current identity/version/epoch without historical declaration details", () => {
  for (const access of ["owner", "self"] as const) {
    const raw = result(access), parsed = parseOutageSubjectResult(raw, query(access), raw.actorId);
    assert.deepEqual(parsed, raw); assert(Object.isFrozen(parsed.subject)); assert(!Object.isFrozen(raw.subject));
    assert.equal(parsed.subject.generation, 0); assert.equal(Object.keys(parsed.subject).length, 9); assert.equal(Object.keys(parsed.incident).length, 5);
    raw.subject.displayName = "changed input"; assert.equal(parsed.subject.displayName, "当前考勤人员");
  }
});
test("current owner can prepare inactive or paused transcription but self cannot inherit that permission", () => {
  for (const patch of [{ active: false }, { paused: true, generation: 3 }, { active: false, paused: true, generation: 3 }]) {
    const ownerData = result(); ownerData.subject = { ...ownerData.subject, ...patch }; ownerData.canWrite = true;
    assert.doesNotThrow(() => parseOutageSubjectResult(ownerData, query(), owner));
    const selfData = result("self"); selfData.subject = { ...selfData.subject, ...patch };
    assert.throws(() => parseOutageSubjectResult(selfData, query("self"), employee));
  }
});
test("subject cannot move across site/role/actor/known incident or selected owner worker", () => {
  for (const patch of [{ siteId: "99999002" }, { access: "self" }, { actorId: employee }, { protocol: "attendance-outage-v1" }, { canWrite: "true" }]) {
    assert.throws(() => parseOutageSubjectResult({ ...result(), ...patch }, query(), owner));
  }
  for (const patch of [{ workerId: id(99) }, { workerVersion: 0 }, { employeeVersion: -1 }, { generation: -0 }, { generation: null }, { employeeAuthUserId: null }]) {
    assert.throws(() => parseOutageSubjectResult({ ...result(), subject: { ...result().subject, ...patch } }, query(), owner));
  }
  assert.throws(() => parseOutageSubjectResult({ ...result("self"), subject: { ...result("self").subject, employeeAuthUserId: owner } }, query("self"), employee));
  assert.throws(() => parseOutageSubjectResult({ ...result(), incident: { ...result().incident, id: id(99) } }, query(), owner));
});
test("minimal known-incident response rejects owner reason, actor, peer counts and private command leakage", () => {
  for (const patch of [{ reason: "private owner reason" }, { actorId: owner }, { declarationCount: 2 }, { operationId: id(8) }]) {
    assert.throws(() => parseOutageSubjectResult({ ...result("self"), incident: { ...result("self").incident, ...patch } }, query("self"), employee));
  }
  assert.throws(() => parseOutageSubjectResult({ ...result(), declarations: [] }, query(), owner));
  assert.throws(() => parseOutageSubjectResult({ ...result(), subject: { ...result().subject, permissions: [] } }, query(), owner));
});
test("saved incident interval is not reinterpreted against current ICU but cannot be future or malformed", () => {
  const v = result(); v.incident.interval.timeZone = "Historical/Zone"; v.incident.interval.startOffsetMinutes = 15;
  assert.doesNotThrow(() => parseOutageSubjectResult(v, query(), owner));
  v.incident.interval.endAt = "2026-10-07T12:00:00.000001Z";
  assert.throws(() => parseOutageSubjectResult(v, query(), owner));
  v.incident.interval.endAt = v.incident.interval.startAt;
  assert.throws(() => parseOutageSubjectResult(v, query(), owner));
});
test("response envelope cannot grant write ability beyond the effective gate or carry unsafe trees", () => {
  assert.deepEqual(parseOutageSubjectResponse({ ok: true, canWrite: false, data: result() }, query(), owner), { canWrite: false, result: result() });
  assert.doesNotThrow(() => parseOutageSubjectResponse({ ok: true, canWrite: true, data: result() }, query(), owner));
  assert.throws(() => parseOutageSubjectResponse({ ok: true, canWrite: false, data: { ...result(), canWrite: true } }, query(), owner));
  const text = JSON.stringify({ ok: true, canWrite: false, data: result() });
  assert.deepEqual(parseOutageSubjectResponse(text, query(), owner).result, result());
  assert.throws(() => parseOutageSubjectResponse(text.replace('"ok":true', '"ok":false,"ok":true'), query(), owner));
  let called = false; assert.throws(() => parseOutageSubjectResult({ ...result(), get subject() { called = true; return result().subject; } }, query(), owner)); assert.equal(called, false);
  assert.throws(() => parseOutageSubjectResponse(" ".repeat(16385), query(), owner));
});
test("service invokes exactly one read RPC and keeps explicit false gate; never sends a command", async () => {
  const f = setup(); const response = await handleOutageSubject(request(), f.deps); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, canWrite: false, data: result() });
  assert.deepEqual(f.calls, [{ name: "faolla_attendance_outage_subject_v1", args: { p_query: query(), p_auth_user_id: owner, p_allow_write: false } }]);
  for (const [name, value] of [["cache-control", "private, no-store"], ["x-content-type-options", "nosniff"], ["vary", "Cookie, Authorization, x-merchant-access-token"]]) assert.equal(response.headers.get(name), value);
});
test("self first-declaration preparation uses server Auth and null worker, not old incident read API", async () => {
  const f = setup("self"), response = await handleOutageSubject(request(query("self")), f.deps);
  assert.equal(response.status, 200); assert.equal(f.calls[0].args.p_auth_user_id, employee); assert.deepEqual(f.calls[0].args.p_query, query("self"));
  assert.equal(f.calls[0].name, "faolla_attendance_outage_subject_v1"); assert.equal(f.calls.length, 1);
});
test("same server outage site switch and attendance entitlement both gate canWrite without hiding authorized reads", async t => {
  const keys = ["FAOLLA_ATTENDANCE_OUTAGE_ENABLED", "FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS"], saved = keys.map(k => [k, process.env[k]] as const);
  process.env.FAOLLA_ATTENDANCE_OUTAGE_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS = siteId;
  t.after(() => { for (const [k, value] of saved) { if (value === undefined) delete process.env[k]; else process.env[k] = value; } });
  for (const enabled of [true, false]) {
    const calls: unknown[] = [], f = setup("owner", { siteEnabled: () => true,
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: enabled } }) as Awaited<ReturnType<typeof defaults.entitlement>>,
      execute: input => executeOutageSubject(input, { rpc: async (_name, args) => { calls.push(args); return { data: { ...result(), canWrite: enabled }, error: null }; } }) });
    const response = await handleOutageSubject(request(), f.deps); assert.equal(response.status, 200); assert.equal((await response.json()).canWrite, enabled);
    assert.deepEqual(calls, [{ p_query: query(), p_auth_user_id: owner, p_allow_write: enabled }]);
  }
});
test("GET-only canonical origin, strong auth and rate limit all precede SQL", async () => {
  const f = setup();
  const denied = await handleOutageSubject(new Request(url, { method: "POST", headers, body: "{}" }), f.deps); assert.equal(denied.status, 405); assert.equal(denied.headers.get("allow"), "GET");
  for (const req of [new Request(request().url.replace("www.faolla.com", "other.invalid")), new Request(request(), { headers: { ...headers, origin: "https://other.invalid" } }),
    new Request(request(), { headers: { ...headers, "sec-fetch-site": "same-site" } })]) assert.equal((await handleOutageSubject(req, f.deps)).status, 403);
  for (const authenticationMethods of [[], ["invite"], ["recovery"], ["password", "magiclink"]]) assert.equal((await handleOutageSubject(request(), { ...f.deps,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic", authenticationMethods }) })).status, 403);
  const rate = await handleOutageSubject(request(), { ...f.deps, allow: () => false }); assert.equal(rate.status, 429); assert.equal(rate.headers.get("retry-after"), "60");
  assert.equal(f.calls.length, 0);
});
test("route rejects mixed/self-selected target and revalidates malformed service success", async () => {
  const f = setup();
  for (const req of [new Request(request().url + "&command=x", { headers }), new Request(request().url + "&siteId=" + siteId, { headers }),
    new Request(request(query("self")).url + "&workerId=" + id(3), { headers })]) assert.equal((await handleOutageSubject(req, f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await handleOutageSubject(request(), { ...f.deps, execute: async () => ({ ...result(), actorId: employee }) })).status, 503);
  assert.equal((await handleOutageSubject(request(), { ...f.deps, execute: async () => ({ ...result(), canWrite: true }) })).status, 503);
});
test("read service preserves current authorization/not-found errors and sanitizes private failures", async () => {
  for (const [message, status] of [["attendance_access_denied", 403], ["attendance_account_suspended", 403], ["attendance_outage_subject_not_found", 404],
    ["attendance_settings_required", 409], ["private SQL detail", 503], ["constructor", 503]] as const) {
    const f = setup("owner", { execute: input => executeOutageSubject(input, { rpc: async () => ({ data: null, error: { message } }) }) });
    const r = await handleOutageSubject(request(), f.deps); assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: status === 503 ? "attendance_unavailable" : message });
  }
  await assert.rejects(executeOutageSubject({ query: query(), authUserId: owner }, null), { code: "attendance_unavailable" });
  await assert.rejects(executeOutageSubject({ query: query(), authUserId: owner }, { rpc: async () => { throw Error("private"); } }), { code: "attendance_unavailable" });
  const f = setup("owner", { entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  const r = await handleOutageSubject(request(), f.deps); assert.equal(r.status, 403); assert.equal(f.calls.length, 0);
});
