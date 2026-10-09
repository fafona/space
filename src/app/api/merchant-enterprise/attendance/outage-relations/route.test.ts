import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleOutageRelations } from "./route-handler";
import { executeOutageRelations, outageRelationsCommandFingerprint } from "@/lib/merchantAttendanceOutageRelations.server";
import { OUTAGE_RELATIONS_ERRORS } from "@/lib/merchantAttendanceOutageRelations";
import { OUTAGE_APIS, outageHttpQueryString } from "@/lib/merchantAttendanceOutageHttp";
import type { OutageRouteDependencies } from "@/lib/merchantAttendanceOutageRoute.server";
import type { OutageRelationsResult } from "@/lib/merchantAttendanceOutageRelationsContract";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { OUTAGE_RELATIONS_MODEL as m, outageRelationsModelQuery as query, outageRelationsModelEvidence as evidence,
  outageRelationsModelCommand as command, outageRelationsModelResult as result, outageRelationsModelSaved as saved } from "../../../../../../scripts/fixtures/attendance-outage-relations-model";

const origin = "https://www.faolla.com", headers = { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const fp = createHash("sha256").update(JSON.stringify(evidence())).digest("hex"), c = command({ expectedFingerprint: fp });
type Deps = OutageRouteDependencies<"relations">;
function common(patch: Partial<Deps> = {}): Deps {
  return { authenticate: async () => ({ user: { id: m.owner } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<Deps["entitlement"]>>,
    allow: () => true, siteEnabled: () => true, bodyTimeoutMs: 5000, execute: async () => { throw Error("missing test service"); }, ...patch };
}
const get = (q = query()) => new Request(origin + OUTAGE_APIS.relations + "?" + outageHttpQueryString("relations", q), { headers });
const post = (body: unknown = { query: query(), command: c }) => new Request(origin + OUTAGE_APIS.relations, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
function raw(r: OutageRelationsResult) {
  const project = <T extends { evidence: unknown; fingerprint: string | null }>(v: T | null) => v === null ? null : {
    ...v, fingerprint: v.evidence === null ? v.fingerprint : fp, sourceText: v.evidence === null ? null : JSON.stringify(v.evidence),
  };
  return { ...r, current: project(r.current), preview: project(r.preview), receipt: r.receipt === null ? null : { ...r.receipt, entry: project(r.receipt.entry) } };
}
function enable(t: TestContext) {
  const keys = ["FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED", "FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS"] as const;
  const old = keys.map(k => process.env[k]); t.after(() => keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }));
  process.env[keys[0]] = "1"; process.env[keys[1]] = m.siteId;
}

test("new actual handler/service binds validated Auth and four SQL args; public response strips sourceText", async t => {
  enable(t); const seen: Record<string, unknown>[] = [];
  const execute: Deps["execute"] = input => executeOutageRelations(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_outage_relations_v1"); seen.push(args);
    return { data: raw(input.command ? saved(input.query, c, outageRelationsCommandFingerprint(query(), c)) : result()), error: null };
  } });
  for (const request of [get(), post()]) {
    const r = await handleOutageRelations(request, common({ execute })); assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "private, no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const body = await r.json(); assert.equal(body.ok, true); assert.equal(JSON.stringify(body).includes("sourceText"), false);
  }
  assert.deepEqual(seen, [null, c].map(p_command => ({ p_query: query(), p_auth_user_id: m.owner, p_command, p_allow_write: true })));
});
test("closed write flag still forwards explicit reads, exact POST replay and GET recovery", async t => {
  enable(t); process.env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED = "0";
  const recover = { ...query(), mode: "recover" as const, operationId: c.operationId };
  const requests = [get(), post(), new Request(origin + OUTAGE_APIS.relations + "?" + outageHttpQueryString("relations", recover), { headers })];
  let calls = 0;
  for (const request of requests) {
    const response = await handleOutageRelations(request, common({ siteEnabled: () => false, execute: input => executeOutageRelations(input, { rpc: async (_name, args) => {
      calls++; assert.equal(input.moduleEnabled, false); assert.equal(args.p_allow_write, false);
      const r = input.command || input.query.mode === "recover" ? saved(input.query, c, outageRelationsCommandFingerprint(query(), c)) : { ...result(), canWrite: false };
      return { data: raw(r), error: null };
    } }) }));
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.canWrite, false); assert.equal(body.data.canWrite, false);
  }
  assert.equal(calls, 3);
});
test("self reads use actual Auth but self write/recover and authority extras stop before SQL", async () => {
  let calls = 0;
  const deps = common({ authenticate: async () => ({ user: { id: m.auth } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    execute: async input => { calls++; assert.equal(input.authUserId, m.auth); return result(query("self")); } });
  assert.equal((await handleOutageRelations(get(query("self")), deps)).status, 200); assert.equal(calls, 1);
  for (const body of [{ query: query("self"), command: c }, { query: query(), command: c, actorId: m.owner },
    { query: { ...query(), allow: true }, command: c }]) assert.equal((await handleOutageRelations(post(body), deps)).status, 400);
  const selfRecover = new Request(origin + OUTAGE_APIS.relations + "?" + new URLSearchParams({ ...query("self"), mode: "recover", operationId: c.operationId }), { headers });
  assert.equal((await handleOutageRelations(selfRecover, deps)).status, 400); assert.equal(calls, 1);
});
test("origin/password-auth/rate guards remain ahead of new service", async () => {
  let calls = 0; const execute: Deps["execute"] = async () => { calls++; return result(); };
  const requests: { request: Request; deps?: Partial<Deps>; status: number }[] = [
    { request: new Request(get(), { headers: { ...headers, origin: "https://elsewhere.test" } }), status: 403 },
    { request: new Request(get(), { headers: { ...headers, "sec-fetch-site": "cross-site" } }), status: 403 },
    { request: new Request(origin + OUTAGE_APIS.relations, { method: "DELETE", headers }), status: 405 },
    { request: get(), deps: { allow: () => false }, status: 429 },
    { request: get(), deps: { authenticate: async () => { throw new MerchantEnterpriseAccessError("unauthorized", 401); } }, status: 401 },
    { request: get(), deps: { authenticate: async () => ({ user: { id: m.owner } as User, accessToken: "synthetic", authenticationMethods: ["invite"] }) }, status: 403 },
  ];
  for (const x of requests) assert.equal((await handleOutageRelations(x.request, common({ execute, ...x.deps }))).status, x.status);
  assert.equal(calls, 0);
});
test("duplicate JSON, malformed body and mixed query mode never reach service", async () => {
  let calls = 0; const deps = common({ execute: async () => { calls++; return result(); } });
  const duplicate = JSON.stringify({ query: query(), command: c }).replace('"kind":"possible_duplicate"', '"kind":"possible_duplicate","kind":"possible_duplicate"');
  for (const request of [post(duplicate), post({ query: query(), command: { ...c, kind: ["possible_duplicate"] } }),
    new Request(get().url + "&relatedDeclarationId=" + m.related, { headers }), new Request(get().url + "&sources=[]", { headers })])
    assert.equal((await handleOutageRelations(request, deps)).status, 400);
  assert.equal(calls, 0);
});
test("known SQL errors keep exact statuses while unknown and corrupt success stay private", async () => {
  for (const [code, status] of Object.entries(OUTAGE_RELATIONS_ERRORS).filter(([code]) => code.startsWith("attendance_outage_relations_"))) {
    const r = await handleOutageRelations(get(), common({ execute: input => executeOutageRelations(input, { rpc: async () => ({ data: null, error: { message: code } }) }) }));
    assert.equal(r.status, status); assert.deepEqual(await r.json(), { ok: false, error: code });
  }
  const unknown = await handleOutageRelations(get(), common({ execute: input => executeOutageRelations(input, { rpc: async () => ({ data: null, error: { message: "private table detail" } }) }) }));
  assert.equal(unknown.status, 503); assert.deepEqual(await unknown.json(), { ok: false, error: "attendance_unavailable" });
  const corrupt = await handleOutageRelations(get(), common({ execute: async () => ({ ...result(), actorId: m.auth }) }));
  assert.equal(corrupt.status, 503); assert.deepEqual(await corrupt.json(), { ok: false, error: "attendance_outage_relations_invalid" });
});
