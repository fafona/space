// Bounded protocol/client mocks plus real React SSR, not browser/Auth/SQL/KDF.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { AttendanceIndependentTerminalClient, INDEPENDENT_TERMINAL_API, independentTerminalPendingKey, type IndependentTerminalStorage } from "./merchantAttendanceIndependentTerminalClient";
import { INDEPENDENT_TERMINAL_PROTOCOL, INDEPENDENT_RAW_PROTOCOL, independentClockCommandText, type IndependentClockCommand,
  type IndependentClockReceipt, type IndependentTerminalSubject, type IndependentTerminalData } from "./merchantAttendanceIndependent";
import { TERMINAL_DEVICE_API } from "./merchantAttendanceTerminal";
import { independentUiId as id, independentUiSite as siteId, independentUiReadAt as readAt } from "../../scripts/fixtures/attendance-independent-ui-model";
import Panel from "../components/enterprise/MerchantAttendanceIndependentTerminalPanel";
const terminalId = id(50), workerNo = "LOCAL-01", pin = "12345678", scope = { siteId, terminalId }, key = independentTerminalPendingKey(scope, workerNo);
const clients: AttendanceIndependentTerminalClient[] = []; afterEach(() => { clients.splice(0).forEach(c => c.dispose()); });
function memory() { const values = new Map<string, string>(); const storage: IndependentTerminalStorage & { values: Map<string, string> } = { values,
  get length() { return values.size; }, key: n => [...values.keys()][n] ?? null, getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } }; return storage; }
function device() { return { ok: true, paired: true, moduleEnabled: true, siteId, attendanceEnabled: true, clockEnabled: false,
  terminal: { id: terminalId, label: "本地已配对终端", locationId: id(4), locationName: "本地地点", timeZone: "UTC", state: "active",
    createdAt: "2026-10-08T08:00:00.000Z", pairExpiresAt: "2026-10-08T08:05:00.000Z", pairedAt: "2026-10-08T08:01:00.000Z", deviceExpiresAt: "2026-11-07T08:01:00.000Z", revokedAt: null } }; }
function subject(): IndependentTerminalSubject { return { subjectId: id(2), workerId: id(3), workerNo, displayName: "本地合成员工", generation: 0,
  workerVersion: 3, credentialId: id(60), credentialRevision: 1, settingsVersion: 1, locationId: id(4), locationVersion: 1, timeZone: "UTC" }; }
const off = () => ({ sequence: 0, status: "off" as const, lastEventId: null, lastAction: null, lastAt: null });
const envelope = (data: IndependentTerminalData) => ({ protocol: INDEPENDENT_TERMINAL_PROTOCOL, siteId, terminalId, readAt, data });
const state = () => envelope({ kind: "state", subject: subject(), head: off() });
function receipt(command: IndependentClockCommand): IndependentClockReceipt { const commandFingerprint = createHash("sha256").update(independentClockCommandText(siteId, terminalId, command)).digest("hex");
  return { operationId: command.operationId, command, commandFingerprint, event: { id: id(70), operationId: command.operationId, sequence: command.expectedSequence + 1,
    action: command.action, locationId: command.locationId, occurredAt: "2026-10-08T09:00:00.000001Z", receivedAt: "2026-10-08T09:00:00.000001Z", timeZone: "UTC", breakPaid: command.breakPaid, source: "kiosk", actorEmployeeId: null },
    source: { subjectId: command.subjectId, generation: command.generation, credentialId: command.credentialId, credentialRevision: command.credentialRevision,
      credentialIssueOperationId: id(61), terminalId, workerVersion: command.expectedWorkerVersion, settingsVersion: command.expectedSettingsVersion,
      locationVersion: command.expectedLocationVersion, commandFingerprint } }; }
function clock(command: IndependentClockCommand) { const r = receipt(command); return envelope({ kind: "clock", subject: subject(), receipt: r,
  head: { sequence: r.event.sequence, status: command.action === "clock_out" ? "off" : command.action === "break_start" ? "break" : "working", lastEventId: r.event.id, lastAction: r.event.action, lastAt: r.event.occurredAt } }); }
const reply = (data: unknown) => Response.json(data);
function setup(fn: AttendanceApiFetch, storage = memory(), opts: { allowNew?: boolean; current?: () => boolean; timeoutMs?: number; resultMs?: number } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []; const c = new AttendanceIndependentTerminalClient({ apiFetch: async (url, init) => { calls.push({ url, init });
    return url === TERMINAL_DEVICE_API ? reply(device()) : fn(url, init); }, storage: () => storage, randomId: () => id(80), allowNew: opts.allowNew ?? true,
    isCurrent: opts.current, timeoutMs: opts.timeoutMs, resultMs: opts.resultMs }); clients.push(c); return { c, storage, calls };
}
const normal: AttendanceApiFetch = async (_url, init) => { const b = JSON.parse(String(init?.body)); return reply({ ok: true, data: b.request.kind === "state" ? state()
  : b.request.kind === "clock" ? clock(b.request.command) : envelope({ kind: "receipt", receipt: null }) }); };
async function ready(s: ReturnType<typeof setup>) { await s.c.initialize(); await s.c.read(workerNo, pin); }

test("196 terminal starts as empty local shell; only explicit existing paired GET supplies real device scope", async () => {
  const s = setup(normal); assert.equal(s.calls.length, 0); assert.equal(s.c.getSnapshot().device, null); await s.c.initialize();
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].url, TERMINAL_DEVICE_API); assert.equal(s.calls[0].init?.method, "GET");
  assert.equal(s.calls[0].init?.credentials, "same-origin"); assert.equal(s.calls[0].init?.redirect, "error"); assert.deepEqual(s.c.getSnapshot().device, { ...scope, label: device().terminal.label, moduleEnabled: true });
  assert.equal(await s.c.load(workerNo), null); assert.equal(s.calls.length, 1);
});
test("196 unpaired, malformed and wrong device responses stop at original pairing entrance, never POST", async () => {
  for (const raw of [{ ok: true, paired: false, moduleEnabled: false }, { ...device(), terminal: { ...device().terminal, state: "revoked" } }, { ...device(), secret: "forged" }]) {
    let calls = 0; const c = new AttendanceIndependentTerminalClient({ apiFetch: async () => { calls++; return reply(raw); }, storage: memory }); clients.push(c);
    await c.initialize(); assert.equal(c.getSnapshot().device, null); assert.equal(c.getSnapshot().phase, "blocked"); await assert.rejects(c.read(workerNo, pin)); assert.equal(calls, 1); }
});
test("196 explicit state validates fresh PIN, dispatches one noncached POST and keeps all PIN out of durable state", async () => {
  const s = setup(normal); await ready(s); assert.equal(s.calls.length, 2); const call = s.calls[1]; assert.equal(call.url, INDEPENDENT_TERMINAL_API);
  assert.equal(call.init?.method, "POST"); assert.equal(call.init?.cache, "no-store"); assert.deepEqual(JSON.parse(String(call.init?.body)), { ...scope, workerNo, pin, request: { kind: "state" } });
  assert.equal(s.storage.values.size, 0); assert.doesNotMatch(JSON.stringify(s.c.getSnapshot()), /12345678|verifier|cookie|pepper/); assert.equal(s.c.getSnapshot().phase, "ready");
});
test("196 invalid PIN, transition and default-off new-start never dispatch; flagoff safe end still does", async () => {
  const s = setup(normal, memory(), { allowNew: false }); await ready(s); await assert.rejects(s.c.punch("clock_in", pin)); await assert.rejects(s.c.read(workerNo, "1234")); assert.equal(s.calls.length, 2);
  const working = state(); working.data = { kind: "state", subject: subject(), head: { sequence: 1, status: "working", lastEventId: id(70), lastAction: "clock_in", lastAt: "2026-10-08T09:00:00.000001Z" } };
  const t = setup(async (_url, init) => { const b = JSON.parse(String(init?.body)); return reply({ ok: true, data: b.request.kind === "state" ? working : clock(b.request.command) }); }, memory(), { allowNew: false });
  await ready(t); await assert.rejects(t.c.punch("break_start", pin, false)); await t.c.punch("clock_out", pin); assert.equal(t.calls.length, 3);
});
test("196 exact full intent is persisted before single clock POST; even valid receipt retains original pending", async () => {
  const s = setup(async (_url, init) => { const b = JSON.parse(String(init?.body)); if (b.request.kind === "clock") assert(s.storage.values.has(key)); return normal(_url, init); });
  await ready(s); await s.c.punch("clock_in", pin); assert.equal(s.calls.length, 3); const saved = s.storage.values.get(key)!;
  assert.doesNotMatch(saved, /"pin"|12345678|verifier|cookie|secret/); const p = await s.c.load(workerNo); assert.equal(p?.command.operationId, id(80)); assert.equal(p?.fingerprint.length, 64);
  await s.c.read(workerNo, pin); assert.equal(s.calls.length, 3); await assert.rejects(s.c.punch("clock_out", pin)); assert.equal(s.storage.values.get(key), saved);
});
test("196 only explicit fresh-PIN read-only original recover POST clears full-command and SHA matched pending", async () => {
  let original: IndependentClockCommand | undefined; const s = setup(async (_url, init) => { const b = JSON.parse(String(init?.body)); if (b.request.kind === "clock") original = b.request.command;
    return b.request.kind === "recover" ? reply({ ok: true, data: envelope({ kind: "receipt", receipt: receipt(original!) }) }) : normal(_url, init); });
  await ready(s); await s.c.punch("clock_in", pin); await s.c.recover(workerNo, pin); assert.equal(s.calls.length, 4); const b = JSON.parse(String(s.calls[3].init?.body));
  assert.equal(b.request.kind, "recover"); assert.equal(b.pin, pin); assert.equal(b.request.operationId, original?.operationId); assert(!Object.hasOwn(b.request, "command"));
  assert.equal(s.storage.values.size, 0); assert.equal(s.c.getSnapshot().phase, "confirmed");
});
test("196 null/foreign/damaged/HTML/oversized/UTF8 recover results preserve original bytes with zero auto-repeat", async () => {
  for (const response of [reply({ ok: true, data: envelope({ kind: "receipt", receipt: null }) }), reply({ ok: true, data: { ...state(), siteId: "99990001" } }),
    new Response("no", { status: 404 }), new Response("bad", { headers: { "content-type": "text/html" } }), new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response("a".repeat(1048577), { headers: { "content-type": "application/json" } })]) {
    const s = setup(async (url, init) => JSON.parse(String(init?.body)).request.kind === "recover" ? response : normal(url, init)); await ready(s); await s.c.punch("clock_in", pin);
    const raw = s.storage.values.get(key); await assert.rejects(s.c.recover(workerNo, pin)); assert.equal(s.storage.values.get(key), raw); assert.equal(s.calls.length, 4); }
});
test("196 damaged/foreign storage and failed persistence reject without dispatch or deleting bytes", async () => {
  const s = setup(normal); await s.c.initialize(); s.storage.values.set(key, "damaged original bytes"); await assert.rejects(s.c.load(workerNo)); await assert.rejects(s.c.read(workerNo, pin)); await assert.rejects(s.c.recover(workerNo, pin));
  assert.equal(s.calls.length, 1); assert.equal(s.storage.values.get(key), "damaged original bytes");
  const t = setup(normal); await ready(t); t.storage.setItem = () => { throw Error("disk full"); }; await assert.rejects(t.c.punch("clock_in", pin)); assert.equal(t.calls.length, 2); assert.equal(t.c.getSnapshot().phase, "blocked");
});
test("19664 durable terminal intents is a hard bound and corrupt rows are never opportunistically removed", async () => {
  const s = setup(normal); await ready(s); for (let i = 0; i < 64; i++) s.storage.values.set(independentTerminalPendingKey(scope, "OTHER-" + i), "preserve");
  await assert.rejects(s.c.punch("clock_in", pin)); assert.equal(s.calls.length, 2); assert.equal(s.storage.values.size, 64);
});
test("196 pause/current-device fence and storage CAS reject late clock/recovery without consuming pending", async () => {
  function deferredRequest() {
    let enter!: () => void, release!: (response: Response) => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const response = new Promise<Response>(resolve => { release = resolve; });
    return { entered, response, enter, release };
  }
  async function enteredBeforeCompletion(entered: Promise<void>, operation: Promise<unknown>, label: string) {
    await Promise.race([entered, operation.then(
      () => { assert.fail(`${label} resolved before entering apiFetch`); },
      () => { assert.fail(`${label} rejected before entering apiFetch`); },
    )]);
  }
  const clockRequest = deferredRequest(), replacedRequest = deferredRequest(), pausedRequest = deferredRequest();
  const requests = [clockRequest, replacedRequest, pausedRequest]; let requestIndex = 0, original: IndependentClockCommand | undefined; let current = true;
  const s = setup(async (_url, init) => { const b = JSON.parse(String(init?.body)); if (b.request.kind === "state") return reply({ ok: true, data: state() });
    assert.equal(init?.method, "POST"); assert.equal(b.request.kind, requestIndex === 0 ? "clock" : "recover");
    if (b.request.kind === "clock") original = b.request.command;
    const request = requests[requestIndex++]; assert(request); request.enter(); return request.response; }, memory(), { current: () => current });
  // Real command hashing may finish after any small sleep. Invalidate only
  // after this exact request enters transport, without mocking crypto or time.
  await ready(s); const posting = s.c.punch("clock_in", pin); await enteredBeforeCompletion(clockRequest.entered, posting, "terminal clock POST");
  const raw = s.storage.values.get(key); assert(raw); assert(original); current = false; clockRequest.release(reply({ ok: true, data: clock(original) }));
  await assert.rejects(posting); assert.equal(s.storage.values.get(key), raw); assert.equal(s.calls.length, 3); current = true; s.c.clear();
  const recovering = s.c.recover(workerNo, pin); await enteredBeforeCompletion(replacedRequest.entered, recovering, "replacement recover POST");
  s.storage.values.set(key, "replacement original"); replacedRequest.release(reply({ ok: true, data: envelope({ kind: "receipt", receipt: receipt(original) }) }));
  await assert.rejects(recovering); assert.equal(s.storage.values.get(key), "replacement original"); assert.equal(s.calls.length, 4); s.storage.values.set(key, raw);
  const paused = s.c.recover(workerNo, pin); await enteredBeforeCompletion(pausedRequest.entered, paused, "paused recover POST");
  s.c.pause(); pausedRequest.release(reply({ ok: true, data: envelope({ kind: "receipt", receipt: receipt(original) }) }));
  await assert.rejects(paused); assert.equal(s.storage.values.get(key), raw); assert.equal(s.calls.length, 5); assert.equal(requestIndex, 3);
  assert.equal(s.c.getSnapshot().device, null); assert.equal(s.c.getSnapshot().result, null);
});
test("196 one total deadline, busy guard and15-second body expiry do not retry or lose pending", async () => {
  const s = setup(async (url, init) => JSON.parse(String(init?.body)).request.kind === "clock" ? new Promise<Response>(() => {}) : normal(url, init), memory(), { timeoutMs: 30 });
  await ready(s); const p = s.c.punch("clock_in", pin); await assert.rejects(s.c.punch("clock_in", pin)); await assert.rejects(p); assert.equal(s.calls.length, 3); assert(s.storage.values.has(key));
  const t = setup(normal, memory(), { resultMs: 5 }); await ready(t); await new Promise(r => setTimeout(r, 15)); assert.equal(t.c.getSnapshot().result, null); assert.equal(t.c.getSnapshot().phase, "entry");
});
test("196 personal raw range and current-page cursor are explicit fresh-PIN reads, not formal assessment", async () => {
  const s = setup(async (url, init) => { const b = JSON.parse(String(init?.body)); if (b.request.kind !== "personal") return normal(url, init);
    return reply({ ok: true, data: envelope({ kind: "personal", report: { protocol: INDEPENDENT_RAW_PROTOCOL, siteId, subjectId: id(2), workerId: id(3), workerNo,
      displayName: subject().displayName, timeZone: "UTC", fromDate: b.request.fromDate, throughDate: b.request.throughDate,
      fromAt: "2026-10-08T00:00:00.000000Z", toAt: "2026-10-09T00:00:00.000000Z", readAt, items: [], nextCursor: null, pageComplete: true, rangeComplete: true, rulesAssessment: "unassessed", fixedPeriodEligible: false } }) }); });
  await ready(s); await assert.rejects(s.c.personal(workerNo, pin, "2026-10-08", "2026-11-08")); assert.equal(s.calls.length, 2);
  const r = await s.c.personal(workerNo, pin, "2026-10-08", "2026-10-08"); assert.equal(r.data.kind, "personal"); await assert.rejects(s.c.personal(workerNo, pin, "2026-10-08", "2026-10-08", id(99))); assert.equal(s.calls.length, 3);
});

const panelSource = readFileSync(new URL("../components/enterprise/MerchantAttendanceIndependentTerminalPanel.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/enterprise/attendance-terminal/independent/page.tsx", import.meta.url), "utf8");
test("196 terminal real React SSR has no worker data, PIN, fabricated identity or automatic device request", () => {
  const html = renderToStaticMarkup(createElement(Panel)); assert(html.includes("独立员工终端打卡")); assert(html.includes("检查已配对设备"));
  assert.doesNotMatch(html, /12345678|LOCAL-01|00000000-0000-4000/); assert(!/void client\.initialize\(\).*useEffect/.test(panelSource));
});
test("196 terminal UI source separates one explicit write from original read-only PIN POST and never retries automatically", () => {
  for (const token of ["只读核对原编号（不重新打卡）", "携 PIN 的只读 POST", "window.confirm", "client.punch", "client.recover"]) assert(panelSource.includes(token));
  assert(!/setInterval|location\.search|searchParams|document\.cookie|localStorage|按原编号重试/.test(panelSource));
});
test("196 terminal UI source hides body and PIN on visibility/pagehide/15s and wraps responsive31-day raw pages", () => {
  for (const token of ['"visibilitychange"', '"pagehide"', "useLayoutEffect", "flushSync(() => { client.pause()", 'setPin("")', "15000", "15秒后", "sm:grid-cols-2", "min-w-0", "最多31", "未规则评估", "重新验证 PIN 并读取下一页"]) assert(panelSource.includes(token));
  assert(!panelSource.includes("15秒未操作"));
  for (const body of [panelSource.match(/const clear = \(\) => \{([\s\S]+?)document\.addEventListener/)?.[1],
    panelSource.match(/检查已配对设备[\s\S]*?onClick=\{\(\) => \{([\s\S]+?)\}\}>清除资料／下一位/)?.[1],
    panelSource.match(/onChange=\{e => \{ client\.clear\(\);([\s\S]+?)setNo\(e\.target\.value\)/)?.[1]]) {
    assert(body); for (const reset of ['setFrom("")', 'setThrough("")', 'setPaid(false)']) assert(body.includes(reset), reset);
  }
});
test("196 terminal server page defaults new writes off without404 blocking original recovery; no secret URL inputs", () => {
  for (const token of ['dynamic = "force-dynamic"', "revalidate = 0", 'referrer: "no-referrer"', 'index: false', 'FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED === "1"']) assert(pageSource.includes(token));
  assert(!/notFound|searchParams|cookies|terminalId|secret|pin=/.test(pageSource));
});
