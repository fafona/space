import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceWorkArrangementClient, workArrangementPendingKey, type WorkArrangementClientOptions } from "./merchantAttendanceWorkArrangementClient";
import { WORK_ARRANGEMENT_API } from "./merchantAttendanceWorkArrangement";
import { workArrangementHttp as http, workArrangementPreviewHttp as preview, workArrangementReceiptHttp as receipt,
  workArrangementSpan as span, workArrangementEmployee as employee, workArrangementAuth as auth, workArrangementId as id,
  workArrangementDetail as detail, workArrangementOwner as owner } from "../../scripts/fixtures/attendance-work-arrangement-model";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function storage() { const entries = new Map<string, string>(); return { entries, getItem: (k: string) => entries.get(k) ?? null,
  setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); } }; }
function fixture(overrides: Partial<WorkArrangementClientOptions> = {}) {
  const s = storage(), calls: Array<{ url: string; init: RequestInit }> = [];
  let reply: (url: string, init: RequestInit) => Promise<Response> = async () => json(http());
  const client = new AttendanceWorkArrangementClient({ siteId: "99990001", access: "self", actorId: employee, enabled: true, storage: () => s,
    randomId: () => id(10), apiFetch: async (url, init) => { calls.push({ url, init: init ?? {} }); return reply(url, init ?? {}); }, ...overrides });
  return { client, s, calls, setReply: (fn: typeof reply) => { reply = fn; } };
}
async function readyPreview(f: ReturnType<typeof fixture>) { await f.client.initialize(); f.setReply(async () => json(preview())); await f.client.preview(span()); }

test("local initialize and default-off have no fetch; explicit preview is bounded GET with detached scope", async () => {
  const f = fixture({ enabled: false }); await f.client.initialize(); await f.client.load(); await f.client.preview(span()); assert.equal(f.calls.length, 0);
  const live = fixture(); await readyPreview(live); assert.equal(live.calls.length, 1); const call = live.calls[0];
  assert.equal(call.init.method, "GET"); assert.ok(call.url.startsWith(WORK_ARRANGEMENT_API + "?"));
  const params = new URL(call.url, "https://fixture.invalid").searchParams; assert.deepEqual(JSON.parse(params.get("preview")!), span());
  assert.equal(live.client.getSnapshot().result?.preview?.canSubmit, true); assert.ok(Object.isFrozen(live.client.getSnapshot().result));
});

test("submit persists exact command before one POST and confirmed receipt clears only matching storage", async () => {
  const f = fixture(); await readyPreview(f); f.setReply(async (_url, init) => {
    assert.equal(init.method, "POST"); const body = JSON.parse(String(init.body)); const stored = JSON.parse(f.s.getItem(f.client.storageKey)!);
    assert.deepEqual(stored.command, body.command); assert.equal(body.command.expectedPolicyRevision, 0);
    assert.equal(body.command.kind, "trip"); return json(receipt(body.command)); });
  await f.client.submit({ reason: "Synthetic trip" }); assert.equal(f.calls.filter(c => c.init.method === "POST").length, 1);
  assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.s.getItem(f.client.storageKey), null);
});

test("unknown POST survives remount and flag rollback, only original-ID GET can settle exact receipt", async () => {
  const f = fixture(); await readyPreview(f); f.setReply(async () => { throw Error("response_lost"); }); await f.client.submit({ reason: "Synthetic trip" });
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); const stored = f.s.getItem(f.client.storageKey)!;
  let reads = 0; const next = new AttendanceWorkArrangementClient({ siteId: "99990001", access: "self", actorId: employee, enabled: false, storage: () => f.s,
    apiFetch: async (url, init) => { reads++; assert.equal(init?.method, "GET"); assert.equal(new URL(url, "https://fixture.invalid").searchParams.get("operationId"), id(10)); return json(receipt(JSON.parse(stored).command, false)); } });
  await next.initialize(); assert.equal(reads, 0); await next.recover(); assert.equal(reads, 1); assert.equal(next.getSnapshot().pending, null); assert.equal(next.getSnapshot().result?.detail, null);
});

test("null receipt and identity/error uncertainty do not discard or reissue original pending", async () => {
  const f = fixture(); await readyPreview(f); f.setReply(async () => { throw Error("lost"); }); await f.client.submit({ reason: "Synthetic trip" });
  const stored = f.s.getItem(f.client.storageKey); const postCount = f.calls.filter(c => c.init.method === "POST").length;
  f.setReply(async () => json(http())); await f.client.recover(); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  f.setReply(async () => json({ ...receipt(undefined, false), actorId: id(88) })); await f.client.recover();
  f.setReply(async () => json({ ok: false, error: "attendance_access_denied" }, 403)); await f.client.recover();
  await f.client.load(); await f.client.submit({ reason: "Another" });
  assert.equal(f.s.getItem(f.client.storageKey), stored); assert.equal(f.calls.filter(c => c.init.method === "POST").length, postCount); assert.equal(f.client.getSnapshot().result, null);
});

test("storage write failure/CAS substitution fail closed without new POST or deleting other intent", async () => {
  const f = fixture(); await readyPreview(f); f.s.setItem(f.client.storageKey, "foreign"); await f.client.submit({ reason: "Synthetic trip" });
  assert.equal(f.calls.length, 1); assert.equal(f.s.getItem(f.client.storageKey), "foreign"); assert.equal(f.client.getSnapshot().result, null);
  const bad = fixture({ storage: () => ({ getItem: () => null, setItem: () => { throw Error("quota"); }, removeItem: () => {} }) });
  await readyPreview(bad); await bad.client.submit({ reason: "Synthetic trip" }); assert.equal(bad.calls.length, 1); assert.equal(bad.client.hasLeaveRisk(), true);
});

test("subscriber pause and randomId/storage callback invalidation cannot send a late POST", async () => {
  const f = fixture(); await readyPreview(f); f.client.subscribe(() => { if (f.client.getSnapshot().phase === "saving") f.client.pause(); });
  await f.client.submit({ reason: "Synthetic trip" }); assert.equal(f.calls.length, 1);
  const g = fixture({ randomId: () => { g.client.pause(); return id(10); } });
  await readyPreview(g); await g.client.submit({ reason: "Synthetic trip" }); assert.equal(g.calls.length, 1); assert.equal(g.s.entries.size, 0);
});

test("late responses after pause cannot reveal old scope or settle pending", async () => {
  const f = fixture(); await f.client.initialize(); let resolve!: (value: Response) => void;
  f.setReply(() => new Promise(r => { resolve = r; })); const loading = f.client.load(); f.client.pause(); resolve(json(http())); await loading;
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "idle");
});

test("total timeout covers headers and stalled body, response limits and malformed UTF8 are fail closed", async () => {
  for (const reply of [() => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "application/json" } })]) {
    const f = fixture({ timeoutMs: 8 }); await f.client.initialize(); f.setReply(reply); await f.client.load(); assert.equal(f.client.getSnapshot().phase, "blocked"); }
  for (const response of [new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } }),
    new Response('{"ok":true,"ok":true}', { headers: { "Content-Type": "application/json" } }),
    json({ ok: false, error: "attendance_access_denied", extra: true }, 403), json({ ok: false, error: "attendance_access_denied" }, 409),
    new Response("x".repeat(4097), { status: 503, headers: { "Content-Type": "application/json" } }), new Response("<html>", { headers: { "Content-Type": "text/html" } })]) {
    const f = fixture(); await f.client.initialize(); f.setReply(async () => response); await f.client.load(); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked"); }
});

test("owner approve requires explicit conflict confirmation and uses reread detail fingerprint", async () => {
  const f = fixture({ access: "owner", actorId: owner }); await f.client.initialize(); const r = http("owner"); r.detail = detail("owner");
  r.detail.conflicts = [{ source: "leave", id: id(99), status: "approved", revision: 2, kind: null, timeZone: "UTC", startAt: span().startAt, endAt: span().endAt }]; r.detail.issues = ["conflicts"];
  f.setReply(async () => json(r)); await f.client.detail(id(10)); await f.client.decide("approve", "Conflict reviewed", false); assert.equal(f.calls.length, 1);
  f.setReply(async (_url, init) => { const c = JSON.parse(String(init.body)).command; assert.equal(c.expectedConflictsFingerprint, "a".repeat(64)); assert.equal(c.confirmConflicts, true); return json(receipt(c, false)); });
  await f.client.decide("approve", "Conflict reviewed", true); assert.equal(f.calls.length, 2); assert.equal(f.client.getSnapshot().pending, null);
});

test("pending namespaces separate self employee from owner auth and do not store credentials", async () => {
  assert.notEqual(workArrangementPendingKey("99990001", "self", employee), workArrangementPendingKey("99990001", "owner", employee));
  const f = fixture(); await readyPreview(f); f.setReply(async () => { throw Error("lost"); }); await f.client.submit({ reason: "Synthetic trip" });
  const pending = JSON.parse(f.s.getItem(f.client.storageKey)!); assert.equal(pending.anchorId, employee); assert.equal(pending.actorId, auth);
  assert.deepEqual(Object.keys(pending).sort(), ["actorId", "anchorId", "command", "employeeId", "query", "version"]);
});

test("only exact known POST rollback failures retire matching pending; unknown/GET failures keep it", async () => {
  for (const code of ["attendance_version_conflict", "attendance_work_arrangement_outside_window", "attendance_period_sealed", "attendance_work_arrangement_conflicts_changed"]) {
    const f = fixture(); await readyPreview(f); f.setReply(async () => json({ ok: false, error: code }, 409)); await f.client.submit({ reason: "Synthetic trip" });
    assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.s.entries.size, 0); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.client.getSnapshot().result, null);
  }
  for (const code of ["attendance_access_denied", "attendance_work_arrangement_binding_changed", "attendance_operation_conflict"]) {
    const f = fixture(); await readyPreview(f); f.setReply(async () => json({ ok: false, error: code }, code === "attendance_access_denied" ? 403 : 409));
    await f.client.submit({ reason: "Synthetic trip" }); assert.ok(f.client.getSnapshot().pending); const saved = f.s.getItem(f.client.storageKey);
    f.setReply(async () => json({ ok: false, error: "attendance_version_conflict" }, 409)); await f.client.recover(); assert.equal(f.s.getItem(f.client.storageKey), saved);
  }
});

test("late known rejection and storage replacement cannot clear a newer or other-scope pending", async () => {
  const f = fixture(); await readyPreview(f); let rejectReply!: (r: Response) => void;
  f.setReply(() => new Promise(resolve => { rejectReply = resolve; })); const writing = f.client.submit({ reason: "Synthetic trip" });
  f.client.pause(); const otherKey = workArrangementPendingKey("99990001", "self", id(999)); f.s.setItem(otherKey, "new-identity");
  const saved = f.s.getItem(f.client.storageKey); rejectReply(json({ ok: false, error: "attendance_version_conflict" }, 409)); await writing;
  assert.equal(f.s.getItem(f.client.storageKey), saved); assert.equal(f.s.getItem(otherKey), "new-identity"); assert.equal(f.client.getSnapshot().result, null);
  const g = fixture(); await readyPreview(g); g.setReply(async () => { g.s.setItem(g.client.storageKey, "other-tab-intent"); return json({ ok: false, error: "attendance_version_conflict" }, 409); });
  await g.client.submit({ reason: "Synthetic trip" }); assert.equal(g.s.getItem(g.client.storageKey), "other-tab-intent"); assert.ok(g.client.getSnapshot().pending);
});
