import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePlanRuleApprovalsClient, type PlanRuleApprovalsClientOptions, type PlanRuleApprovalsStorage } from "./merchantAttendancePlanRuleApprovalsClient";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { planRuleApprovalsActor as actor, planRuleApprovalsId as id, planRuleApprovalsHttp as http, planRuleApprovalsQuery as query, planRuleApprovalsCommand as command } from "../../scripts/fixtures/attendance-plan-rule-approvals-model";
import { scheduleEvidenceWire, scheduleEvidenceSlot, parseScheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";

function source() {
  const slot = http().data.slot, wire = scheduleEvidenceWire({ empty: true, query: { siteId: query().siteId, workerId: query().workerId, fromDate: slot.workDate, throughDate: slot.workDate }, asOf: http().data.readAt });
  wire.schedule.items = [scheduleEvidenceSlot(2, slot.startAt, slot.endAt, { id: slot.id, locationName: slot.locationName })];
  return { ...parseScheduleEvidenceWire(wire), moduleEnabled: true };
}
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function memory() {
  const values = new Map<string, string>([["unrelated", "keep"]]), writes: string[] = [];
  const storage: PlanRuleApprovalsStorage = { getItem: key => values.get(key) ?? null, setItem: (key, raw) => { values.set(key, raw); writes.push(raw); }, removeItem: key => { values.delete(key); } };
  return { values, storage, writes };
}
const saved = () => ({ version: 1, ownerId: actor, query: query("approve"), command: command() });
function setup(fetch?: AttendanceApiFetch, overrides: Partial<PlanRuleApprovalsClientOptions> = {}) {
  const store = memory(), calls: Array<{ url: string; init: RequestInit }> = [];
  const apiFetch: AttendanceApiFetch = async (url, init = {}) => { calls.push({ url: String(url), init });
    return fetch ? fetch(url, init) : reply(http(init.method === "POST" ? "approve" : new URL(String(url), "https://example.test").searchParams.get("mode") as "preview")); };
  const options: PlanRuleApprovalsClientOptions = { source: source(), ownerId: actor, apiFetch, enabled: true, storage: () => store.storage, operationId: () => id(900), ...overrides };
  return { client: new AttendancePlanRuleApprovalsClient(options), store, options, calls };
}
const preview = async (client: AttendancePlanRuleApprovalsClient) => { await client.initialize(); await client.preview(query().slotId); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("constructor and initialization are local-only; detached bounded anchors and owner-scoped pending", async () => {
  const x = setup(); x.options.source.schedule.items[0].id = id(777); x.options.ownerId = id(88);
  await x.client.initialize(); assert.equal(x.calls.length, 0); assert.equal(x.store.writes.length, 0);
  assert.equal(x.client.anchors[0].id, query().slotId); assert(Object.isFrozen(x.client.anchors[0]));
  assert.equal(x.client.storageKey, `faolla:attendance:plan-rule-approvals:v1:${query().siteId}:${actor}:${query().workerId}`);
  assert.equal(x.store.values.get("unrelated"), "keep");
  for (const patch of [{ timeoutMs: 0 }, { timeoutMs: 12001 }, { enabled: "1" }, { storage: null }, { operationId: 42 }])
    assert.throws(() => new AttendancePlanRuleApprovalsClient({ ...setup().options, ...patch } as PlanRuleApprovalsClientOptions));
});
test("unknown/blank anchors, uninitialized and incomplete lists never request", async () => {
  const x = setup(); await x.client.preview(query().slotId); assert.equal(x.calls.length, 0); await x.client.initialize();
  await x.client.preview(""); await x.client.preview(id(999)); await x.client.read(id(999)); assert.equal(x.calls.length, 0);
  const s = source(); s.schedule = { limited: true, items: [] }; const y = setup(undefined, { source: s }); await preview(y.client); assert.equal(y.calls.length, 0);
});
test("preview is GET-only; one explicit approve stores exact command before POST and never stores source", async () => {
  const x = setup(async (_url, init) => {
    if (init?.method === "POST") { assert.deepEqual(JSON.parse(x.store.values.get(x.client.storageKey)!), saved());
      assert.deepEqual(JSON.parse(String(init.body)), { query: query("approve"), command: command() }); return reply(http("approve")); }
    return reply(http());
  });
  await preview(x.client); assert.equal(x.client.getSnapshot().result!.preview!.source!.fields.lateGraceMinutes.minutes, 0);
  await x.client.approve(command().reason); assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST"]);
  assert.equal(x.client.getSnapshot().pending, null); assert.equal(x.store.values.get(x.client.storageKey), undefined);
  assert.equal(x.client.getSnapshot().result!.approval!.operationId, id(900)); assert(Object.isFrozen(x.client.getSnapshot().result!.approval!.source));
  assert(x.store.writes.every(raw => !/sourceText|lateGraceMinutes|Synthetic group/.test(raw))); assert.equal(x.store.values.get("unrelated"), "keep");
  await x.client.approve(command().reason); assert.equal(x.calls.length, 2);
});
test("reason is never coerced or trimmed; invalid submission clears stale preview without reserving an ID", async () => {
  for (const reason of ["", " leading", "trailing ", "a\nb", "x".repeat(201), "\ud800"]) {
    const x = setup(); await preview(x.client); await x.client.approve(reason);
    assert.equal(x.calls.length, 1); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.store.writes.length, 0);
  }
});
test("paused and every ineligible preview never POST or fabricate a default", async () => {
  for (const blocker of ["module_paused", "worker_inactive", "publication_missing", "cancelled", "started", "associated", "source_incomplete", "assignment_overlap", "group_inactive", "source_switch", "source_too_large"] as const) {
    const body = http(); body.moduleEnabled = blocker !== "module_paused";
    body.data.preview = { fingerprint: null, source: null, observedAt: body.data.readAt, eligible: false, blockers: [blocker] };
    const x = setup(async () => reply(body)); await preview(x.client); await x.client.approve(command().reason);
    assert.equal(x.calls.length, 1, blocker); assert.equal(x.store.writes.length, 0, blocker); assert.equal(x.client.getSnapshot().result!.preview!.eligible, false);
  }
});
test("lost response survives reload; initialize has zero HTTP and explicit original recovery only GETs", async () => {
  const x = setup(async (_url, init) => init?.method === "POST" ? Promise.reject(Error("lost")) : reply(http()));
  await preview(x.client); await x.client.approve(command().reason); const raw = x.store.values.get(x.client.storageKey);
  assert(raw); assert.equal(x.client.getSnapshot().phase, "unconfirmed"); assert.equal(x.client.getSnapshot().result, null);
  const calls: RequestInit[] = [], reloaded = new AttendancePlanRuleApprovalsClient({ ...x.options, enabled: false, apiFetch: async (_, init = {}) => { calls.push(init); return reply(http("recover", false)); } });
  await reloaded.initialize(); assert.equal(calls.length, 0); await reloaded.recover();
  assert.deepEqual(calls.map(c => c.method), ["GET"]); assert.equal(reloaded.getSnapshot().pending, null); assert.equal(reloaded.getSnapshot().result!.moduleEnabled, false);
  assert.equal(x.store.values.get(x.client.storageKey), undefined); assert.equal("retry" in reloaded, false);
});
test("unknown original ID remains pending after GET-null; no new preview or POST can consume it", async () => {
  const body = http("recover"); body.data.approval = null; body.data.revision = 0;
  const x = setup(async () => reply(body)); const raw = JSON.stringify(saved()); x.store.values.set(x.client.storageKey, raw);
  await x.client.initialize(); await x.client.recover(); await x.client.preview(query().slotId); await x.client.approve(command().reason);
  assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert.equal(x.store.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending);
  await x.client.recover(id(901)); assert.equal(x.calls.length, 1); assert.equal(x.store.values.get(x.client.storageKey), raw);
});
test("only enumerated complete business rejections release new pending and permit a new preview", async () => {
  for (const [code, status] of [["attendance_version_conflict", 409], ["attendance_plan_rule_source_conflict", 409], ["attendance_plan_rule_blocked", 409], ["attendance_plan_rule_limit", 409], ["attendance_platform_paused", 403]] as const) {
    const x = setup(async (_, init) => init?.method === "POST" ? reply({ ok: false, error: code }, status) : reply(http()));
    await preview(x.client); await x.client.approve(command().reason); assert.equal(x.client.getSnapshot().pending, null, code); assert.equal(x.store.values.get(x.client.storageKey), undefined);
    assert.match(x.client.getSnapshot().message, /明确拒绝/); await x.client.preview(query().slotId); assert.equal(x.client.getSnapshot().phase, "ready");
    assert.deepEqual(x.calls.map(c => c.init.method), ["GET", "POST", "GET"]);
  }
});
test("auth, identity, operation conflicts, unknown/status-mismatched errors and extra error keys preserve original", async () => {
  for (const [body, status] of [[{ ok: false, error: "attendance_access_denied" }, 403], [{ ok: false, error: "attendance_plan_rule_identity_changed" }, 409],
    [{ ok: false, error: "attendance_operation_conflict" }, 409], [{ ok: false, error: "attendance_plan_rule_not_found" }, 404],
    [{ ok: false, error: "attendance_invalid_request" }, 400], [{ ok: false, error: "attendance_plan_rule_blocked" }, 503],
    [{ ok: false, error: "attendance_plan_rule_limit", extra: true }, 409], [{ ok: false, error: "unknown" }, 409]] as const) {
    const x = setup(async (_, init) => init?.method === "POST" ? reply(body, status) : reply(http())); await preview(x.client); await x.client.approve(command().reason);
    assert(x.client.getSnapshot().pending, JSON.stringify(body)); assert(x.store.values.get(x.client.storageKey)); assert.equal(x.client.getSnapshot().result, null);
  }
});
test("even a definite business error during GET recovery cannot discard an existing unknown pending", async () => {
  const x = setup(async () => reply({ ok: false, error: "attendance_plan_rule_blocked" }, 409)); const raw = JSON.stringify(saved()); x.store.values.set(x.client.storageKey, raw);
  await x.client.initialize(); await x.client.recover(); assert.equal(x.store.values.get(x.client.storageKey), raw); assert(x.client.getSnapshot().pending);
});
test("disabled frontend only discovers pending locally and never enables new reads or writes", async () => {
  const x = setup(undefined, { enabled: false }); await preview(x.client); await x.client.read(query().slotId); await x.client.approve(command().reason);
  await x.client.recover(id(900), query().slotId); assert.equal(x.calls.length, 0); assert.equal(x.store.writes.length, 0);
  x.store.values.set(x.client.storageKey, JSON.stringify(saved())); await x.client.initialize(); await x.client.recover(); assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]);
});
test("malformed/replaced pending and failed persistence never overwrite or POST", async () => {
  const bad = setup(); bad.store.values.set(bad.client.storageKey, '{"ownerId":"other"}'); await bad.client.initialize(); await bad.client.preview(query().slotId);
  assert.equal(bad.calls.length, 0); assert.equal(bad.store.writes.length, 0);
  const x = setup(); await preview(x.client); x.store.values.set(x.client.storageKey, "replacement"); await x.client.approve(command().reason);
  assert.equal(x.calls.length, 1); assert.equal(x.store.values.get(x.client.storageKey), "replacement");
  const y = setup(); await preview(y.client); y.store.storage.setItem = () => { throw Error("quota"); }; await y.client.approve(command().reason);
  assert.equal(y.calls.length, 1); assert(y.client.getSnapshot().pending); await y.client.approve(command().reason); assert.equal(y.calls.length, 1);
});
test("success cannot consume a replaced or unremovable storage slot", async () => {
  for (const kind of ["replace", "remove-throw", "remove-noop"] as const) {
    const x = setup(async (_, init) => { if (init?.method === "POST" && kind === "replace") x.store.values.set(x.client.storageKey, "foreign"); return reply(http(init?.method === "POST" ? "approve" : "preview")); });
    await preview(x.client); if (kind === "remove-throw") x.store.storage.removeItem = () => { throw Error("no"); }; if (kind === "remove-noop") x.store.storage.removeItem = () => {};
    await x.client.approve(command().reason); assert(x.client.getSnapshot().pending); assert.equal(x.client.getSnapshot().result, null);
    assert(x.store.values.get(x.client.storageKey)); if (kind === "replace") assert.equal(x.store.values.get(x.client.storageKey), "foreign");
  }
});
test("synchronous loading/saving subscribers can pause before GET or before persistence/POST", async () => {
  const x = setup(); await x.client.initialize(); x.client.subscribe(() => { if (x.client.getSnapshot().phase === "loading") x.client.pause(); });
  await x.client.preview(query().slotId); assert.equal(x.calls.length, 0);
  const y = setup(); await preview(y.client); y.client.subscribe(() => { if (y.client.getSnapshot().phase === "saving") y.client.pause(); });
  await y.client.approve(command().reason); assert.equal(y.calls.length, 1); assert.equal(y.store.writes.length, 0);
});
test("storage hooks or pending-published subscribers cannot continue POST after context invalidation", async () => {
  for (const kind of ["storage", "pending-observer"] as const) {
    const x = setup(); await preview(x.client); const set = x.store.storage.setItem;
    if (kind === "storage") x.store.storage.setItem = (key, raw) => { set(key, raw); x.client.pause(); };
    else x.client.subscribe(() => { if (x.client.getSnapshot().phase === "saving" && x.client.getSnapshot().pending) x.client.pause(); });
    await x.client.approve(command().reason); assert.equal(x.calls.length, 1); assert(x.store.values.get(x.client.storageKey)); assert(x.client.getSnapshot().pending);
  }
});
test("late success after pause does not consume pending or resurrect the result", async () => {
  const held = deferred<Response>(), x = setup(async (_, init) => init?.method === "POST" ? held.promise : reply(http()));
  await preview(x.client); const action = x.client.approve(command().reason); await tick(); assert.equal(x.calls.length, 2); const raw = x.store.values.get(x.client.storageKey);
  x.client.pause(); held.resolve(reply(http("approve"))); await action; assert.equal(x.client.getSnapshot().result, null); assert.equal(x.store.values.get(x.client.storageKey), raw);
});
test("replaced generation wins against late headers/body and result aliases remain frozen", async () => {
  const held = deferred<Response>(); let count = 0; const x = setup(async () => ++count === 1 ? held.promise : reply(http("read")));
  await x.client.initialize(); const old = x.client.preview(query().slotId); x.client.invalidate(); await x.client.read(query().slotId);
  held.resolve(reply(http())); await old; assert(x.client.getSnapshot().result!.approval); assert.equal(x.client.getSnapshot().result!.preview, null);
  const bodyHeld = deferred<Uint8Array>(), y = setup(async () => new Response(new ReadableStream({ async pull(c) { c.enqueue(await bodyHeld.promise); c.close(); } }), { headers: { "content-type": "application/json" } }));
  await y.client.initialize(); const bodyRead = y.client.preview(query().slotId); await tick(); y.client.pause(); bodyHeld.resolve(new TextEncoder().encode(JSON.stringify(http()))); await bodyRead;
  assert.equal(y.client.getSnapshot().result, null);
});
test("whole-request timeout includes stalled body and leaves submitted original pending", async () => {
  const x = setup(async (_, init) => init?.method === "POST" ? new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }) : reply(http()), { timeoutMs: 20 });
  await preview(x.client); await x.client.approve(command().reason); assert.equal(x.client.getSnapshot().phase, "unconfirmed"); assert(x.client.getSnapshot().pending);
});
test("UTF8/caps/content-type and non-200 success bodies cannot create authoritative state", async () => {
  const responses = [new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }),
    new Response(" ".repeat(65537), { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify(http()), { headers: { "content-type": "text/plain" } }), reply(http(), 201),
    new Response(" ".repeat(4097), { status: 409, headers: { "content-type": "application/json" } })];
  for (const response of responses) { const x = setup(async () => response); await preview(x.client); assert.equal(x.client.getSnapshot().result, null); assert.equal(x.client.getSnapshot().phase, "blocked"); }
});
test("parent employee/immutable plan and exact pending command mismatches reject while historical actor reads are allowed", async () => {
  const mismatched = http(); mismatched.data.slot.locationName = "changed"; const x = setup(async () => reply(mismatched)); await preview(x.client); assert.equal(x.client.getSnapshot().result, null);
  const receipt = http("recover"); receipt.data.approval!.command.reason = "different exact request"; const y = setup(async () => reply(receipt)); y.store.values.set(y.client.storageKey, JSON.stringify(saved()));
  await y.client.initialize(); await y.client.recover(); assert(y.client.getSnapshot().pending); assert.equal(y.client.getSnapshot().result, null);
  const historical = http("read"); historical.data.approval!.actorId = id(88); const z = setup(async () => reply(historical)); await z.client.initialize(); await z.client.read(query().slotId);
  assert.equal(z.client.getSnapshot().result!.approval!.actorId, id(88));
});
test("a different current employee cannot consume saved dual-identity pending; owner keys never borrow another owner slot", async () => {
  const x = setup(), s = source(); s.worker.employeeId = id(99); assert("employeeId" in s.attendance.base); s.attendance.base.employeeId = id(99);
  x.store.values.set(x.client.storageKey, JSON.stringify(saved())); const other = new AttendancePlanRuleApprovalsClient({ ...x.options, source: s });
  await other.initialize(); assert(other.getSnapshot().pending); assert.equal(other.getSnapshot().result, null); assert.equal(x.calls.length, 0);
  const ownerSource = source(); ownerSource.actorId = id(77); const newOwner = new AttendancePlanRuleApprovalsClient({ ...x.options, source: ownerSource, ownerId: id(77) });
  await newOwner.initialize(); assert.equal(newOwner.getSnapshot().pending, null); assert(x.store.values.get(x.client.storageKey));
});
test("manual recovery is known-slot GET only; no auto lookup or original actor substitution", async () => {
  const x = setup(); await x.client.initialize(); await x.client.recover(id(900)); assert.equal(x.calls.length, 0);
  await x.client.recover(id(900), query().slotId); assert.deepEqual(x.calls.map(c => c.init.method), ["GET"]); assert.equal(x.client.getSnapshot().result!.approval!.operationId, id(900));
  assert.equal(x.store.writes.length, 0); assert.equal(x.calls[0].init.redirect, "error");
});
