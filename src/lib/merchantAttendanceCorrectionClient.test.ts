import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceCorrectionClient, correctionPendingKey, parseCorrectionPending } from "./merchantAttendanceCorrectionClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { createCorrectionFixture, correctionSite as siteId, correctionEmployee as employeeId,
  correctionStart as startEventId, correctionProposal as proposal, correctionId as id } from "../../scripts/fixtures/attendance-correction-model";
import {decisionResponse,decisionAsOf} from "../../scripts/fixtures/attendance-correction-decision-model";

function setup(api?: (base: AttendanceApiFetch) => AttendanceApiFetch) {
  const model = createCorrectionFixture(), map = new Map<string, string>(); let nextId = 100;
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const apiFetch = api ? api(model.apiFetch) : model.apiFetch;
  const fresh = (timeoutMs = 1000) => new AttendanceCorrectionClient({ siteId, employeeId, storage: () => storage, apiFetch, randomId: () => id(nextId++), timeoutMs });
  return { model, map, storage, fresh, client: fresh(), key: correctionPendingKey(siteId, employeeId) };
}
async function prepare(s: ReturnType<typeof setup>) { await s.client.initialize(); await s.client.prepare(startEventId); }
const posts = (s: ReturnType<typeof setup>) => s.model.calls.filter(c => c.method === "POST");

test("correction entry reads context and list only; preparation does not create an application", async () => {
  const s = setup(); await prepare(s);
  assert.equal(s.client.getSnapshot().result?.mode, "prepare"); assert.equal(s.model.writes(), 0);
  assert.deepEqual(s.model.calls.map(c => c.method), ["GET", "GET", "GET"]); assert.equal(s.map.size, 0);
});
test("explicit submit is durable before POST, confirms exact receipt and leaves raw times untouched", async () => {
  let saved = false;
  const s = setup(base => async (path, init) => { if (init?.method === "POST") saved = s.map.has(s.key); return base(path, init); });
  await prepare(s); await s.client.submit(proposal, " 实际离店时间 ");
  assert.equal(saved, true); assert.equal(s.model.writes(), 1); assert.equal(s.map.size, 0);
  const r = s.client.getSnapshot().result; assert.equal(r?.mode, "detail");
  if (r?.mode === "detail") { assert.equal(r.reason, "实际离店时间"); assert.notEqual(r.basis.events.at(-1)?.occurredAt, r.proposal.endAt); }
});
test("double click sends only one immutable submission", async () => {
  const s = setup(); await prepare(s); await Promise.all([s.client.submit(proposal, "补记"), s.client.submit(proposal, "重复")]);
  assert.equal(posts(s).length, 1); assert.equal(s.model.writes(), 1);
});
test("committed lost response survives remount; only GET recovers and clears matching intent", async () => {
  const s = setup(); await prepare(s); s.model.mode("lost"); await s.client.submit(proposal, "补记");
  assert.equal(s.client.getSnapshot().phase, "unconfirmed"); assert.ok(s.map.has(s.key)); s.client.pause();
  const fresh = s.fresh(); s.model.mode("normal"); await fresh.initialize();
  assert.equal(posts(s).length, 1); assert.equal(s.model.writes(), 1); assert.equal(fresh.getSnapshot().phase, "ready"); assert.equal(s.map.size, 0);
});
test("unreceived request 404 remains uncertain on reload, explicit retry GETs then POSTs original bytes", async () => {
  const s = setup(); await prepare(s); s.model.mode("unsent"); await s.client.submit(proposal, "补记");
  const raw = s.map.get(s.key), fresh = s.fresh(); s.client.pause(); s.model.mode("normal"); await fresh.initialize();
  assert.equal(fresh.getSnapshot().phase, "unconfirmed"); assert.equal(s.map.get(s.key), raw); assert.equal(posts(s).length, 1);
  await fresh.retry(); assert.equal(posts(s).length, 2); assert.equal(posts(s)[0].body, posts(s)[1].body); assert.equal(s.model.writes(), 1); assert.equal(s.map.size, 0);
});
test("manual retry discovers a receipt before POST and does not resubmit", async () => {
  const s = setup(); await prepare(s); s.model.mode("lost"); await s.client.submit(proposal, "补记"); s.model.mode("normal");
  await s.client.retry(); assert.equal(posts(s).length, 1); assert.equal(s.map.size, 0);
});
test("pending blocks other targets, new submissions, pagination and withdrawal", async () => {
  const s = setup(); await prepare(s); s.model.mode("unsent"); await s.client.submit(proposal, "补记"); const n = s.model.calls.length;
  await s.client.list(); await s.client.next(); await s.client.detail(id(999)); await s.client.prepare(id(999));
  await s.client.submit(proposal, "新笔"); await s.client.withdraw("撤回"); assert.equal(s.model.calls.length, n);
});
test("platform pause allows authorized withdrawal; removal of request permission does not", async () => {
  const s = setup(); await prepare(s); await s.client.submit(proposal, "补记");
  s.model.enabled(false); await s.client.initialize(); await s.client.withdraw("内容有误");
  const r = s.client.getSnapshot().result; assert.equal(r?.mode === "detail" && r.item.status, "withdrawn"); assert.equal(s.model.writes(), 2);
  await s.client.prepare(startEventId); await s.client.submit(proposal, "暂停不能提交"); assert.equal(s.model.writes(), 2);
  s.model.enabled(true); await s.client.initialize(); await s.client.submit(proposal, "重新申请");
  s.model.canRequest(false); await s.client.initialize(); await s.client.withdraw("不允许"); assert.equal(s.model.writes(), 3);
});
test("withdrawal lost response also recovers from exact receipt without duplication", async () => {
  const s = setup(); await prepare(s); await s.client.submit(proposal, "补记"); s.model.mode("lost"); await s.client.withdraw("内容错误");
  assert.equal(s.client.getSnapshot().pending?.command.action, "withdraw"); s.model.mode("normal"); await s.fresh().initialize();
  assert.equal(s.map.size, 0); assert.equal(s.model.writes(), 2); assert.equal(posts(s).length, 2);
});
test("read-only permission may recover prior committed receipt but cannot submit", async () => {
  const s = setup(); await prepare(s); s.model.mode("lost"); await s.client.submit(proposal, "补记");
  s.model.mode("normal"); s.model.canRequest(false); const fresh = s.fresh(); await fresh.initialize();
  assert.equal(s.map.size, 0); await fresh.withdraw("无权限"); assert.equal(s.model.writes(), 1);
});
test("denied lookup does not retry POST, and worker rebinding blocks recovery without erasing intent", async () => {
  const s = setup(); await prepare(s); s.model.mode("unsent"); await s.client.submit(proposal, "补记"); const raw = s.map.get(s.key);
  s.model.mode("denied"); await s.client.retry(); assert.equal(posts(s).length, 1); assert.equal(s.map.get(s.key), raw);
  s.model.mode("rebound"); const fresh = s.fresh(); await fresh.initialize(); await fresh.retry();
  assert.equal(fresh.getSnapshot().phase, "blocked"); assert.equal(fresh.getSnapshot().workerId, null); assert.equal(s.map.get(s.key), raw); assert.equal(posts(s).length, 1);
});
test("original POST definitive denial clears unsent intent, but replay denial preserves uncertainty", async () => {
  const s = setup(); await prepare(s); s.model.mode("denied"); await s.client.submit(proposal, "补记"); assert.equal(s.map.size, 0);
  s.model.mode("normal"); await s.client.prepare(startEventId); s.model.mode("unsent"); await s.client.submit(proposal, "补记");
  s.model.mode("normal"); s.model.canRequest(false); await s.client.retry(); assert.equal(s.client.getSnapshot().phase, "unconfirmed"); assert.ok(s.map.has(s.key));
});
for (const mode of ["stale", "basis_changed"]) test(`replay ${mode} is a permanent server fence and releases old intent for re-preparation`, async () => {
  const s = setup(); await prepare(s); s.model.mode("unsent"); await s.client.submit(proposal, "补记"); s.model.mode(mode); await s.client.retry();
  assert.equal(s.map.size, 0); assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(s.model.writes(), 0);
});
test("invalid storage never requests identity or overwrites bytes", async () => {
  const s = setup(); s.map.set(s.key, "broken"); await s.client.initialize();
  assert.equal(s.model.calls.length, 0); assert.equal(s.map.get(s.key), "broken"); assert.equal(s.client.getSnapshot().phase, "blocked");
});
test("pending parser rejects injected fields, swapped identities, targets and oversized documents", async () => {
  const s = setup(); await prepare(s); s.model.mode("unsent"); await s.client.submit(proposal, "补记"); const raw = s.map.get(s.key)!, p = JSON.parse(raw);
  assert.deepEqual(parseCorrectionPending(raw, siteId, employeeId).command, p.command);
  for (const bad of [{ ...p, employeeId: id(99) }, { ...p, extra: 1 }, { ...p, query: { ...p.query, requestId: id(99) } },
    { ...p, command: { ...p.command, siteId: "99990002" } }, { ...p, query: { ...p.query, operationId: id(99) } }])
    assert.throws(() => parseCorrectionPending(JSON.stringify(bad), siteId, employeeId));
  assert.throws(() => parseCorrectionPending(" ".repeat(16385), siteId, employeeId));
});
test("storage write failure sends no POST", async () => {
  const s = setup(); await prepare(s); s.storage.setItem = () => { throw Error("quota"); }; await s.client.submit(proposal, "补记");
  assert.equal(posts(s).length, 0); assert.equal(s.client.getSnapshot().phase, "blocked");
});
test("a storage change while fetching cannot erase or accept another intent", async () => {
  const s = setup(base => async (path, init) => { const response = await base(path, init);
    if (init?.method === "POST") s.map.set(s.key, "different-intent"); return response; });
  await prepare(s); await s.client.submit(proposal, "补记"); assert.equal(s.map.get(s.key), "different-intent");
  assert.equal(s.client.getSnapshot().result, null); assert.equal(s.client.getSnapshot().phase, "unconfirmed");
});
test("wrong receipt content preserves pending, even after a successful status", async () => {
  const s = setup(base => async (path, init) => { const response = await base(path, init); if (init?.method !== "POST") return response;
    const body = await response.json(); body.reason = "别人的内容"; return Response.json(body); });
  await prepare(s); await s.client.submit(proposal, "补记"); assert.ok(s.map.has(s.key)); assert.equal(s.client.getSnapshot().result, null);
});
test("wrong employee result and wrong worker are never rendered", async () => {
  for (const field of ["employeeId", "workerId"]) {
    const s = setup(base => async (path, init) => { const r = await base(path, init); const b = await r.json(); b[field] = id(99); return Response.json(b); });
    await s.client.initialize(); assert.equal(s.client.getSnapshot().result, null);
    assert.equal(s.client.getSnapshot().phase, "blocked");
  }
});
test("pause aborts rendering an old response and preserves possibly committed intent", async () => {
  let release: (() => void) | undefined;
  const s = setup(base => async (path, init) => { const r = await base(path, init); if (init?.method === "POST") await new Promise<void>(resolve => { release = resolve; }); return r; });
  await prepare(s); const write = s.client.submit(proposal, "补记"); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(release); s.client.pause(); release!(); await write;
  assert.equal(s.client.getSnapshot().result, null); assert.ok(s.map.has(s.key));
  await s.fresh().initialize(); assert.equal(s.map.size, 0); assert.equal(s.model.writes(), 1);
});
test("timeout includes stalled response body and keeps original pending", async () => {
  let cancelled = false;
  const s = setup(base => async (path, init) => init?.method === "POST" ? new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { "Content-Type": "application/json" } }) : base(path, init));
  const client = s.fresh(25); await client.initialize(); await client.prepare(startEventId); await client.submit(proposal, "补记");
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.equal(cancelled, true); assert.ok(s.map.has(s.key));
});
test("large response / HTML login redirect cannot be mistaken for confirmation", async () => {
  for (const kind of ["large", "html"]) {
    const s = setup(base => async (path, init) => init?.method !== "POST" ? base(path, init) : kind === "html" ? new Response("login", { headers: { "Content-Type": "text/html" } }) : Response.json({ pad: "x".repeat(131073) }));
    await prepare(s); await s.client.submit(proposal, "补记"); assert.equal(s.client.getSnapshot().phase, "unconfirmed"); assert.ok(s.map.has(s.key));
  }
});
test("success cannot clear a record when storage removal fails", async () => {
  const s = setup(); await prepare(s); s.storage.removeItem = () => { throw Error("denied"); }; await s.client.submit(proposal, "补记");
  assert.ok(s.map.has(s.key)); assert.equal(s.client.getSnapshot().phase, "unconfirmed"); assert.equal(s.client.getSnapshot().result, null);
});
test("27 applications paginate 25 and 2 without duplicate or cross-employee entries", async () => {
  const s = setup(); await s.client.initialize();
  for (let n = 0; n < 27; n++) { await s.client.prepare(startEventId); await s.client.submit(proposal, `申请 ${n}`); await s.client.withdraw(`撤回 ${n}`); }
  await s.client.list(); const first = s.client.getSnapshot().result; assert.equal(first?.mode === "list" && first.items.length, 25);
  await s.client.next(); const second = s.client.getSnapshot().result; assert.equal(second?.mode === "list" && second.items.length, 2);
  if (first?.mode === "list" && second?.mode === "list") assert.equal(new Set([...first.items, ...second.items].map(i => i.requestId)).size, 27);
});
test("storage read fails closed before a different target is requested", async () => {
  const s = setup(); await prepare(s); const n = s.model.calls.length; s.storage.getItem = () => { throw Error("unavailable"); }; await s.client.list();
  assert.equal(s.model.calls.length, n); assert.equal(s.client.getSnapshot().phase, "blocked"); assert.equal(s.client.hasLeaveRisk(), true);
});

test("unsent withdrawal rejected after decision releases only that terminal intent on explicit retry",async()=>{
  let failWithdraw=true,withdrawPosts=0;
  const s=setup(base=>async(path,init)=>{
    if(init?.method==="POST"&&JSON.parse(String(init.body)).action==="withdraw"){
      withdrawPosts++;if(failWithdraw)throw Error("connection_lost");
      return Response.json({ok:false,error:"attendance_correction_decided"},{status:409});
    }
    return base(path,init);
  });
  await prepare(s);await s.client.submit(proposal,"补记");await s.client.withdraw("计划撤回");
  assert.equal(s.client.getSnapshot().phase,"unconfirmed");assert.ok(s.map.has(s.key));
  const saved=s.map.get(s.key);failWithdraw=false;const fresh=s.fresh();await fresh.initialize();
  assert.equal(withdrawPosts,1);assert.equal(s.map.get(s.key),saved);
  await fresh.retry();assert.equal(withdrawPosts,2);assert.equal(s.map.size,0);
  assert.equal(fresh.getSnapshot().phase,"blocked");assert.match(fresh.getSnapshot().message,/审批决定/);assert.equal(s.model.writes(),1);
});

test("lost submission receipt recovers after approval via GET and never offers terminal withdrawal",async()=>{
  let decorate=false;
  const s=setup(base=>async(path,init)=>{
    const response=await base(path,init);if(!decorate||init?.method==="POST")return response;
    const value=await response.json();if(value.mode==="detail"){
      value.asOf=decisionAsOf;value.rules.checkedAt=decisionAsOf;value.canRequest=false;
      value.item.decision=decisionResponse("approve").decision;
    }
    return Response.json(value,{status:response.status});
  });
  await prepare(s);s.model.mode("lost");await s.client.submit(proposal,"审批前申请");assert.ok(s.map.has(s.key));
  s.model.mode("normal");decorate=true;const fresh=s.fresh();await fresh.initialize();
  assert.equal(s.map.size,0);assert.equal(s.model.writes(),1);assert.match(fresh.getSnapshot().message,/已有审批决定/);
  const r=fresh.getSnapshot().result;assert.equal(r?.mode==="detail"&&r.item.decision?.action,"approve");
  await fresh.withdraw("不能撤回");assert.equal(s.model.writes(),1);
});
test("hidden client cannot issue a new write, navigation or retry", async () => {
  const s = setup(); await prepare(s); s.client.pause(); const n = s.model.calls.length;
  await s.client.submit(proposal, "补记"); await s.client.list(); await s.client.retry(); assert.equal(s.model.calls.length, n);
});
test("unavailable secure UUID generator fails before persistence or network", async () => {
  const s = setup(), client = new AttendanceCorrectionClient({ siteId, employeeId, storage: () => s.storage, apiFetch: s.model.apiFetch,
    randomId: () => { throw Error("unsupported_crypto"); } });
  await client.initialize(); await client.prepare(startEventId); await client.submit(proposal, "补记");
  assert.equal(posts(s).length, 0); assert.equal(s.map.size, 0); assert.equal(client.getSnapshot().phase, "blocked");
});
test("old submit receipt recovers after another tab withdraws and submits a later application", async () => {
  const s = setup(); await prepare(s); s.model.mode("lost"); await s.client.submit(proposal, "原申请");
  const p = s.client.getSnapshot().pending!; s.model.mode("normal");
  const send = (command: unknown) => s.model.apiFetch("/api/merchant-enterprise/attendance/corrections", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId, expectedWorkerId: p.query.expectedWorkerId, ...(command as object) }) });
  assert.equal((await send({ action: "withdraw", requestId: p.query.requestId, operationId: id(998), expectedRevision: 1, reason: "其他标签页撤回" })).status, 200);
  assert.equal((await send({ ...p.command, operationId: id(999), expectedRevision: 2, reason: "后续新申请" })).status, 200);
  const fresh = s.fresh(); await fresh.initialize();
  assert.equal(s.map.size, 0); assert.equal(s.model.writes(), 3); const r = fresh.getSnapshot().result;
  assert.equal(r?.mode === "detail" && r.item.status, "withdrawn"); assert.equal(r?.mode === "detail" && r.receipt?.revision, 1);
});
