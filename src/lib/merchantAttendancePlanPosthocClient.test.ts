import test from "node:test";
import assert from "node:assert/strict";
import { AttendancePlanPosthocClient, planPosthocPendingKey, type PlanPosthocStorage } from "./merchantAttendancePlanPosthocClient";
import { posthocUiValue, posthocUiCommand, posthocUiSaved, posthocUiQuery, posthocUiId } from "../../scripts/fixtures/attendance-plan-posthoc-ui-model";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { parsePlanPosthocBody } from "./merchantAttendancePlanPosthocHttp";
const envelope = (data = posthocUiValue(), canWrite = true) => Response.json({ ok: true, canWrite, data });
const error = (status = 404, code = "attendance_plan_posthoc_adoption_not_found") => Response.json({ ok: false, error: code }, { status });
function harness(fetcher: AttendanceApiFetch, storage?: PlanPosthocStorage, enabled = true) {
  const v = posthocUiValue(), data = new Map<string, string>(), writes: string[] = [];
  const store = storage ?? { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, value: string) => { writes.push(value); data.set(k, value); }, removeItem: (k: string) => { data.delete(k); } };
  const client = new AttendancePlanPosthocClient({ siteId: v.siteId, actorId: v.actorId, workerId: v.worker.workerId, slotId: v.slot.id, apiFetch: fetcher, storage: () => store, operationId: () => posthocUiId(800), enabled, timeoutMs: 100 });
  return { client, store, data, writes };
}
const apply = (client: AttendancePlanPosthocClient) => client.apply({ sources: [], reason: posthocUiCommand().reason });

test("posthoc initializes locally; exact scoped storage and explicit GET have no POST", async () => {
  const calls: string[] = [], h = harness(async (_p, init) => { calls.push(init!.method!); return envelope(); });
  await h.client.initialize(); assert.deepEqual(calls, []); await h.client.load(); assert.deepEqual(calls, ["GET"]);
  const r = posthocUiValue(); assert.equal(h.client.storageKey, planPosthocPendingKey(r.siteId, r.actorId, r.worker.workerId, r.slot.id));
  assert.notEqual(h.client.storageKey, planPosthocPendingKey(r.siteId, r.actorId, r.worker.workerId, posthocUiId(19)));
});
test("durable exact body precedes one POST and receipt is checked before clearing", async () => {
  let posts = 0;
  const h = harness(async (_p, init) => {
    if (init!.method === "GET") return envelope();
    posts++; const { query, command } = parsePlanPosthocBody(JSON.parse(init!.body as string));
    const saved = JSON.parse(h.store.getItem(h.client.storageKey)!);
    assert.deepEqual(saved.command, command); assert.deepEqual(saved.query, query);
    return envelope(posthocUiSaved(command));
  });
  await h.client.initialize(); await h.client.load(); await apply(h.client);
  assert.equal(posts, 1); assert.equal(h.client.getSnapshot().phase, "ready"); assert.equal(h.client.getSnapshot().result!.preview, null);
  assert.equal(h.store.getItem(h.client.storageKey), null); assert.equal(h.writes.length, 1);
});
test("paused write gate keeps history GET and saved original receipt recovery", async () => {
  let posts = 0;
  const h = harness(async (_p, init) => { if (init!.method === "POST") posts++; return envelope(posthocUiSaved(), false); }, undefined, false);
  h.store.setItem(h.client.storageKey, JSON.stringify({ version: 1, actorId: posthocUiValue().actorId, query: posthocUiQuery(), command: posthocUiCommand() }));
  await h.client.initialize(); await h.client.recover(); assert.equal(posts, 0); assert.equal(h.client.getSnapshot().result!.current!.revision, 1); assert.equal(h.client.getSnapshot().pending, null);
});
test("lost response retains original ID, retry does GET then exact-body POST only after authorized detail", async () => {
  const calls: string[] = []; let retry = false, firstBody = "";
  const h = harness(async (url, init) => {
    calls.push(init!.method!);
    if (init!.method === "POST") { if (!retry) { firstBody = init!.body as string; throw Error("lost"); } assert.equal(init!.body, firstBody); return envelope(posthocUiSaved()); }
    if (url.includes("mode=recover")) return error();
    return envelope();
  });
  await h.client.initialize(); await h.client.load(); await apply(h.client);
  const raw = h.store.getItem(h.client.storageKey); assert(raw); assert.equal(h.client.getSnapshot().phase, "unconfirmed");
  retry = true; await h.client.retry(); assert.deepEqual(calls, ["GET", "POST", "GET", "GET", "POST"]); assert.equal(h.client.getSnapshot().pending, null);
});
test("GET 404 alone preserves bytes, errors and changed identity cannot authorize retry or local retirement", async () => {
  for (const mode of ["recover", "retry", "endAttempt"] as const) {
    let stage = false, posts = 0;
    const h = harness(async (url, init) => {
      if (init!.method === "POST") { posts++; throw Error("lost"); }
      if (!stage) return envelope(); if (url.includes("mode=recover")) return error();
      const wrong = posthocUiValue(); wrong.worker.employeeAuthUserId = posthocUiId(987); wrong.preview!.source.basis.worker.employeeAuthUserId = posthocUiId(987); return envelope(wrong);
    });
    await h.client.initialize(); await h.client.load(); await apply(h.client); const raw = h.store.getItem(h.client.storageKey); stage = true;
    await h.client[mode](); assert.equal(posts, 1); assert.equal(h.store.getItem(h.client.storageKey), raw); assert.equal(h.client.getSnapshot().phase, "unconfirmed");
  }
});
test("wrong receipt/body and malformed bounded transport never clear a pending ID", async () => {
  for (const reply of [() => envelope({ ...posthocUiSaved(), actorId: posthocUiId(99) }), () => Response.json({ ok: true, canWrite: true, data: posthocUiSaved(), extra: true }), () => new Response('{"ok":true,"ok":true}', { headers: { "content-type": "application/json" } })]) {
    let post = false;
    const h = harness(async () => post ? reply() : envelope());
    await h.client.initialize(); await h.client.load(); post = true; await apply(h.client);
    assert(h.store.getItem(h.client.storageKey)); assert.equal(h.client.getSnapshot().result, null);
  }
});
test("storage write-before/after throwing never POST; reinitialize reflects disk, not a phantom intent", async () => {
  for (const after of [false, true]) {
    const data = new Map<string, string>(); let posts = 0, throws = true;
    const h = harness(async (_u, i) => { if (i!.method === "POST") posts++; return envelope(); }, {
      getItem: k => data.get(k) ?? null, setItem: (k, v) => { if (after) data.set(k, v); if (throws) throw Error("disk"); data.set(k, v); }, removeItem: k => { data.delete(k); },
    });
    await h.client.initialize(); await h.client.load(); await apply(h.client); assert.equal(posts, 0); assert.equal(h.client.getSnapshot().pending, null);
    throws = false; await h.client.initialize(); assert.equal(h.client.getSnapshot().pending !== null, after);
  }
});
test("synchronous pause during storage persistence preserves disk for recovery and never POSTs", async () => {
  let value: string | null = null, posts = 0;
  const h = harness(async (_u, i) => { if (i!.method === "POST") posts++; return envelope(); }, { getItem: () => value, setItem: (_k, v) => { value = v; client.pause(); }, removeItem: () => { value = null; } }); const client = h.client;
  await client.initialize(); await client.load(); await apply(client); assert.equal(posts, 0); assert(value); await client.initialize(); assert(client.getSnapshot().pending);
});
test("late response after pause cannot re-expose evidence or clear persisted intent", async () => {
  let resolve!: (r: Response) => void;
  const h = harness(async (_u, i) => i!.method === "GET" ? envelope() : new Promise<Response>(r => { resolve = r; }));
  await h.client.initialize(); await h.client.load(); const saving = apply(h.client);
  await new Promise(r => setTimeout(r, 0)); const raw = h.store.getItem(h.client.storageKey); h.client.pause(); resolve(envelope(posthocUiSaved())); await saving;
  assert.equal(h.client.getSnapshot().result, null); assert.equal(h.store.getItem(h.client.storageKey), raw);
});
test("external exact-key replacement cannot be overwritten or cleared", async () => {
  const h = harness(async () => envelope()); await h.client.initialize(); await h.client.load();
  h.store.setItem(h.client.storageKey, "foreign"); await apply(h.client);
  assert.equal(h.store.getItem(h.client.storageKey), "foreign"); assert.equal(h.client.getSnapshot().phase, "blocked");
});
test("stop local tracking requires explicit 404 plus dual identity; cannot imply cancellation", async () => {
  let lost = false;
  const h = harness(async (u, i) => { if (i!.method === "POST") { lost = true; throw Error("lost"); } return lost && u.includes("mode=recover") ? error() : envelope(); });
  await h.client.initialize(); await h.client.load(); await apply(h.client); await h.client.endAttempt();
  assert.equal(h.store.getItem(h.client.storageKey), null); assert.match(h.client.getSnapshot().message, /旧请求仍可能稍后成功/);
});

function evaluationEnvelope() {
  const r = posthocUiValue();
  return { ok: true, data: { protocol: "plan-posthoc-evaluation-v1", siteId: r.siteId, actorId: r.actorId, worker: r.worker, slot: r.slot, readAt: r.readAt, fingerprint: "b".repeat(64),
    source: { protocol: "posthoc-evaluation-evidence-v1", basis: r.preview!.source.basis, posthoc: { revision: 0, current: null, selected: [], approval: null }, observations: [], approval: null,
      leave: { limited: false, resolved: true, items: [] }, resolutionBlockers: ["posthoc_inactive"] } } };
}
test("evaluation is an explicit GET with writes off, clears old adoption permission and exposes independently parsed facts", async () => {
  const calls: string[] = [];
  const h = harness(async (url, init) => { assert.equal(init!.method, "GET"); assert(url.startsWith("/api/merchant-enterprise/attendance/plan-posthoc-evaluation?")); assert(!url.includes("mode=")); calls.push(url); return Response.json(evaluationEnvelope()); }, undefined, false);
  await h.client.initialize(); assert.deepEqual(calls, []); await h.client.evaluate();
  assert.equal(calls.length, 1); assert.equal(h.client.getSnapshot().evaluation!.state, "not_active"); assert.equal(h.client.getSnapshot().result, null); assert.equal(h.client.getSnapshot().canWrite, false);
  h.client.pause(); assert.equal(h.client.getSnapshot().evaluation, null);
});
test("pending original command prevents evaluating another read as confirmation", async () => {
  let calls = 0;
  const h = harness(async (_u, init) => { calls++; if (init!.method === "POST") throw Error("lost"); return envelope(); });
  await h.client.initialize(); await h.client.load(); await apply(h.client); const before = calls, raw = h.store.getItem(h.client.storageKey); await h.client.evaluate();
  assert.equal(calls, before); assert.equal(h.client.getSnapshot().evaluation, null); assert.equal(h.store.getItem(h.client.storageKey), raw);
});
test("forged derived evaluation and late response after pause never become visible", async () => {
  const forged = evaluationEnvelope();
  const h = harness(async () => Response.json({ ...forged, data: { ...forged.data, eligible: true } }));
  await h.client.initialize(); await h.client.evaluate(); assert.equal(h.client.getSnapshot().phase, "blocked"); assert.equal(h.client.getSnapshot().evaluation, null);
  let resolve!: (r: Response) => void;
  const delayed = harness(async () => new Promise<Response>(r => { resolve = r; }));
  await delayed.client.initialize(); const pending = delayed.client.evaluate(); await new Promise(r => setTimeout(r, 0));
  delayed.client.pause(); resolve(Response.json(evaluationEnvelope())); await pending;
  assert.equal(delayed.client.getSnapshot().evaluation, null); assert.equal(delayed.client.getSnapshot().result, null);
});
