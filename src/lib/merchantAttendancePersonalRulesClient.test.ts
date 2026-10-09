import assert from "node:assert/strict";
import test from "node:test";
import { AttendancePersonalRulesClient, type PersonalRulesClientOptions } from "./merchantAttendancePersonalRulesClient";
import { emptyAttendanceRuleDraft, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { parsePersonalRulesBody, parsePersonalRulesHttpQuery, type PersonalRulesCommand, type PersonalRulesItem,
  type PersonalRulesQuery, type PersonalRulesReceipt, type PersonalRulesWorker } from "./merchantAttendancePersonalRules";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(99), workerId = id(201), employeeId = id(101), employeeAuthUserId = id(102);
const rules = (): AttendanceRuleDraft => ({ ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 0 } });
const input = (day = "2026-11-01") => ({ startsOn: day, endsOn: day, rules: rules(), reason: "Approve candidate only" });
const query: PersonalRulesQuery = { siteId, workerId, operationId: null, beforeRevision: null };
function setup() {
  const memory = new Map<string, string>(), items: Array<PersonalRulesItem & { withdrawnByRevision: number | null }> = [];
  const receipts = new Map<string, PersonalRulesReceipt>(), calls: { url: string; method: string; body: string | null }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const context = { settingsVersion: 3, timeZone: "Europe/Madrid", moduleEnabled: true, readAt: "2026-10-04T10:00:00.999999Z",
    worker: { workerId, workerName: "Synthetic worker", workerNo: "W-201", employeeId, employeeAuthUserId, version: 2,
      active: true, employeeActive: true } as PersonalRulesWorker };
  let serial = 1000, writes = 0, mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const reply = (q: PersonalRulesQuery = query, receipt: PersonalRulesReceipt | null = null) => {
    const list = items.filter(item => q.beforeRevision === null || item.revision < q.beforeRevision).slice().reverse();
    return Response.json({ ok: true, protocol: "personal-rules-v1", siteId, actorId: ownerId, ...context, revision: items.length,
      items: list.slice(0, 25), nextBeforeRevision: list.length > 25 ? list[24].revision : null,
      receipt: receipt ?? (q.operationId ? receipts.get(q.operationId) ?? null : null) });
  };
  const commit = (q: PersonalRulesQuery, command: PersonalRulesCommand) => {
    const old = receipts.get(command.operationId); if (old) return reply(q, old);
    assert.equal(command.expectedRevision, items.length);
    const envelope = { operationId: command.operationId, actorId: ownerId, revision: items.length + 1, reason: command.reason,
      recordedAt: `2026-10-04T10:00:00.${String(items.length + 1).padStart(6, "0")}Z` };
    let item: PersonalRulesItem;
    if (command.action === "approve") item = { ...envelope, action: "approve", approvedRevision: null, employeeId: command.employeeId,
      employeeAuthUserId: command.employeeAuthUserId, workerVersion: command.expectedWorkerVersion, settingsVersion: command.expectedSettingsVersion,
      timeZone: command.timeZone, startsOn: command.startsOn, endsOn: command.endsOn, rules: structuredClone(command.rules),
      fromAt: attendanceDayUtcRange(command.startsOn, command.timeZone).startAt, toAt: attendanceDayUtcRange(command.endsOn, command.timeZone).endAt };
    else {
      const target = items.find(row => row.revision === command.approvedRevision); assert(target);
      const { withdrawnByRevision: ignored, ...snapshot } = target; void ignored;
      item = { ...structuredClone(snapshot), ...envelope, action: "withdraw", approvedRevision: command.approvedRevision };
      target.withdrawnByRevision = item.revision;
    }
    items.push({ ...item, withdrawnByRevision: null }); writes++;
    const receipt = { operationId: command.operationId, revision: item.revision, command: structuredClone(command), item: structuredClone(item) };
    receipts.set(command.operationId, receipt); return reply(q, receipt);
  };
  const key = `faolla:attendance:personal-rules:v1:${siteId}:${ownerId}:${workerId}`;
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null;
    calls.push({ url, method, body }); assert.equal(init?.cache, "no-store"); assert(init?.signal);
    assert(url.startsWith("/api/merchant-enterprise/attendance/personal-rules"));
    if (transport) return transport(url, init);
    if (method === "GET") return reply(parsePersonalRulesHttpQuery(new URL(url, "https://fixture.invalid").href));
    const parsed = parsePersonalRulesBody(JSON.parse(body!)), pending = JSON.parse(memory.get(key)!);
    assert.deepEqual(pending.query, parsed.query); assert.deepEqual(pending.command, parsed.command);
    assert.equal(pending.ownerId, ownerId); assert.equal(pending.workerId, workerId);
    if (mode === "unsent") throw Error("not delivered"); const response = commit(parsed.query, parsed.command);
    if (mode === "lost") throw Error("committed but response lost"); return response;
  };
  const create = (patch: Partial<PersonalRulesClientOptions> = {}) => new AttendancePersonalRulesClient({ siteId, ownerId, workerId, apiFetch,
    storage: () => storage, randomId: () => id(++serial), timeoutMs: 200, ...patch });
  const seed = (day = "2026-11-01") => commit(query, { operationId: id(++serial), action: "approve", expectedRevision: items.length,
    expectedWorkerVersion: context.worker.version, expectedSettingsVersion: context.settingsVersion, employeeId, employeeAuthUserId,
    timeZone: context.timeZone, ...input(day) });
  return { client: create(), create, memory, storage, context, items, receipts, calls, reply, commit, seed, writes: () => writes,
    mode: (value: typeof mode) => { mode = value; }, transport: (value: typeof transport) => { transport = value; } };
}

test("constructor is inert and only explicit approved context builds approve/withdraw commands", async () => {
  const f = setup(), client = f.client; assert.equal(f.calls.length, 0); assert.equal(f.memory.size, 0);
  await client.approve(input()); await client.withdraw(1, "Before read"); assert.equal(f.calls.length, 0);
  await client.initialize(); assert.equal(client.getSnapshot().phase, "ready"); assert.equal(f.writes(), 0);
  await client.approve(input()); const post = JSON.parse(f.calls.at(-1)!.body!).command;
  assert.deepEqual(post, { operationId: id(1001), action: "approve", expectedRevision: 0, reason: input().reason,
    expectedWorkerVersion: 2, expectedSettingsVersion: 3, employeeId, employeeAuthUserId, timeZone: "Europe/Madrid",
    startsOn: input().startsOn, endsOn: input().endsOn, rules: rules() });
  await client.withdraw(1, "Withdraw before start"); assert.equal(f.writes(), 2);
  assert.equal(client.getSnapshot().result?.items[1].withdrawnByRevision, 2); assert.equal(client.getSnapshot().pending, null);
  assert.equal(f.memory.size, 0); assert.equal(client.storageKey, `faolla:attendance:personal-rules:v1:${siteId}:${ownerId}:${workerId}`);
});

test("new approval requires module, active worker/employee, and both bound IDs; invalid input clears stale context without a write", async () => {
  for (const patch of [{ active: false }, { employeeActive: false }, { employeeAuthUserId: null }, { employeeId: null, employeeAuthUserId: null, employeeActive: false }]) {
    const f = setup(); Object.assign(f.context.worker, patch); await f.client.initialize(); await f.client.approve(input());
    assert.equal(f.calls.length, 1); assert.equal(f.memory.size, 0); assert.equal(f.client.getSnapshot().result, null);
  }
  for (const patch of [{ rules: emptyAttendanceRuleDraft() }, { startsOn: "2026-10-04" }, { endsOn: "2026-12-02" },
    { reason: "\n" }, { reason: " padded " }, { rules: { ...rules(), lateGraceMinutes: { mode: "value", minutes: "" } } as unknown as AttendanceRuleDraft }]) {
    const f = setup(); await f.client.initialize(); await f.client.approve({ ...input(), ...patch });
    assert.equal(f.calls.length, 1); assert.equal(f.memory.size, 0); assert.equal(f.client.getSnapshot().result, null);
  }
  const f = setup(); f.context.moduleEnabled = false; await f.client.initialize(); await f.client.approve(input());
  assert.equal(f.calls.length, 1); assert.equal(f.client.getSnapshot().result?.moduleEnabled, false);
});

test("withdrawal eligibility uses canonical server readAt, never the browser clock, and supports inactive historical context", async () => {
  const original = Date.now;
  try {
    for (const [readAt, allowed] of [["2026-10-31T22:59:59.999999Z", true], ["2026-10-31T23:00:00.000000Z", false], ["2026-10-31T23:00:00.000001Z", false]] as const) {
      const f = setup(); f.seed(); f.context.readAt = readAt; f.context.worker.active = false; f.context.worker.employeeActive = false;
      Date.now = () => Date.parse(allowed ? "2200-01-01T00:00:00Z" : "2000-01-01T00:00:00Z");
      await f.client.initialize(); await f.client.withdraw(1, "Withdraw candidate");
      assert.equal(f.calls.filter(call => call.method === "POST").length, allowed ? 1 : 0);
    }
  } finally { Date.now = original; }
  for (const revision of [0, 99]) { const f = setup(); f.seed(); await f.client.initialize(); await f.client.withdraw(revision, "Wrong target"); assert.equal(f.calls.length, 1); }
  const f = setup(); f.seed(); await f.client.initialize(); await f.client.withdraw(1, "Withdraw"); await f.client.withdraw(1, "Again"); assert.equal(f.writes(), 2);
});

test("lost committed response survives reload as original GET only and recovers the immutable receipt", async () => {
  const f = setup(); await f.client.initialize(); f.mode("lost"); await f.client.approve(input());
  const pending = f.client.getSnapshot().pending; assert(pending); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  const reload = f.create(); await reload.initialize();
  assert.equal(f.writes(), 1); assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert(f.calls.at(-1)!.url.includes(pending.command.operationId)); assert.equal(reload.getSnapshot().pending, null);
  assert.equal(reload.getSnapshot().result?.receipt?.operationId, pending.command.operationId);
});

test("unknown unsent operation blocks replacement; reload/refresh never POST and explicit retry GETs first with exact old body", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.approve(input());
  const body = f.calls.at(-1)!.body, raw = f.memory.get(f.client.storageKey); assert(body); assert(raw);
  await f.client.approve(input("2026-12-01")); await f.client.withdraw(1, "Cannot replace"); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  const reload = f.create(); await reload.initialize(); await reload.refresh(); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal(reload.getSnapshot().phase, "unconfirmed"); f.mode("normal"); await reload.retry();
  assert.deepEqual(f.calls.slice(-2).map(c => c.method), ["GET", "POST"]); assert.equal(f.calls.at(-1)!.body, body);
  assert.equal(f.writes(), 1); assert.equal(reload.getSnapshot().pending, null);
});

test("paused module permits GET recovery but not retry POST; denied/rebound identity keeps original bytes and hides data", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.approve(input());
  const raw = f.memory.get(f.client.storageKey); f.context.moduleEnabled = false; await f.client.retry();
  assert.equal(f.calls.at(-1)!.method, "GET"); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  for (const [error, status] of [["attendance_access_denied", 403], ["attendance_personal_rule_identity_changed", 409]]) {
    f.transport(async () => Response.json({ ok: false, error }, { status: Number(status) })); await f.client.refresh();
    assert.equal(f.client.getSnapshot().result, null); assert(f.client.getSnapshot().pending); assert.equal(f.memory.get(f.client.storageKey), raw);
  }
});

test("storage must persist and read back original intent before POST, including write-then-throw and silent-write failures", async () => {
  for (const mode of ["throw", "noop", "write-throw"] as const) {
    const f = setup(); const client = f.create({ storage: () => ({ ...f.storage, setItem: (key, value) => {
      if (mode === "write-throw") f.storage.setItem(key, value); if (mode !== "noop") throw Error("storage failed");
    } }) });
    await client.initialize(); await client.approve(input());
    assert.equal(f.calls.length, 1); assert.equal(client.getSnapshot().phase, "blocked"); assert(client.getSnapshot().pending);
    assert.equal(client.getSnapshot().result, null); await client.approve(input()); assert.equal(f.calls.length, 1);
  }
});

test("foreign/corrupt stored intent and substitution/removal never get overwritten or silently adopted by an active pending client", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.approve(input()); const raw = f.memory.get(f.client.storageKey)!;
  for (const replacement of [JSON.stringify({ ...JSON.parse(raw), ownerId: id(98) }), JSON.stringify({ ...JSON.parse(raw), workerId: id(202) }),
    "broken", "x".repeat(8193), JSON.stringify({ ...JSON.parse(raw), secret: true })]) {
    f.memory.set(f.client.storageKey, replacement); const before = f.calls.length, fresh = f.create(); await fresh.initialize();
    assert.equal(f.calls.length, before); assert.equal(fresh.getSnapshot().phase, "blocked"); assert.equal(f.memory.get(f.client.storageKey), replacement);
  }
  f.memory.set(f.client.storageKey, JSON.stringify({ ...JSON.parse(raw), command: { ...JSON.parse(raw).command, reason: "Substituted" } }));
  const before = f.calls.length; await f.client.retry(); assert.equal(f.calls.length, before); assert.equal(f.client.getSnapshot().phase, "blocked");
  assert.equal(f.client.getSnapshot().pending?.command.reason, input().reason);
  f.memory.delete(f.client.storageKey); await f.client.refresh(); assert.equal(f.calls.length, before); assert(f.client.getSnapshot().pending);
});

test("failed receipt cleanup keeps original ID blocked, including removal that throws after deleting or substitutes another slot", async () => {
  for (const mode of ["noop", "throw", "delete-throw", "substitute"] as const) {
    const f = setup(); const client = f.create({ storage: () => ({ ...f.storage, removeItem: key => {
      if (mode === "delete-throw") f.storage.removeItem(key);
      if (mode === "substitute") f.storage.setItem(key, "replacement");
      if (mode === "throw" || mode === "delete-throw") throw Error("remove failed");
    } }) });
    await client.initialize(); await client.approve(input());
    assert.equal(f.writes(), 1); assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "blocked");
    const op = client.getSnapshot().pending?.command.operationId; assert(op); await client.approve(input("2026-12-01")); assert.equal(f.writes(), 1);
    if (mode === "delete-throw" || mode === "substitute") { const before = f.calls.length; await client.refresh(); assert.equal(f.calls.length, before); assert.equal(client.getSnapshot().pending?.command.operationId, op); }
  }
});

test("only strict full known error/status pairs resolve definitive rejection; identity/op-conflict/malformed errors stay pending", async () => {
  for (const [error, status, extra, keep] of [
    ["attendance_version_conflict", 409, false, false], ["attendance_personal_rule_future_required", 409, false, false],
    ["attendance_personal_rule_overlap", 409, false, false], ["attendance_personal_rule_already_withdrawn", 409, false, false],
    ["attendance_personal_rule_worker_inactive", 409, false, false], ["attendance_platform_paused", 403, false, false],
    ["attendance_version_conflict", 500, false, true], ["attendance_operation_conflict", 409, false, true],
    ["attendance_personal_rule_identity_changed", 409, false, true], ["attendance_access_denied", 403, false, true],
    ["attendance_invalid_request", 400, true, true], ["unknown_error", 400, false, true],
  ] as const) {
    const f = setup(); await f.client.initialize(); f.transport(async () => Response.json({ ok: false, error, ...(extra ? { private: true } : {}) }, { status }));
    await f.client.approve(input()); assert.equal(!!f.client.getSnapshot().pending, keep, error); assert.equal(f.client.getSnapshot().result, null);
    assert.equal(f.memory.has(f.client.storageKey), keep, error);
  }
});

test("wrong response actor/site/worker or copied command cannot expose records or consume original intent", async () => {
  for (const patch of [{ actorId: id(98) }, { siteId: "99990002" }, { worker: { ...setup().context.worker, workerId: id(202) } }]) {
    const f = setup(); f.transport(async () => Response.json({ ...await f.reply().json(), ...patch })); await f.client.initialize();
    assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  }
  const f = setup(); await f.client.initialize(); f.transport(async (_, init) => {
    const body = parsePersonalRulesBody(JSON.parse(String(init!.body))), response = await f.commit(body.query, body.command).json();
    response.receipt.command.reason = "Other command"; return Response.json(response);
  });
  await f.client.approve(input()); assert.equal(f.client.getSnapshot().result, null); assert(f.client.getSnapshot().pending); assert(f.memory.has(f.client.storageKey));
});

test("bounded history replaces one page and only an approval visible in that current page can be withdrawn", async () => {
  const f = setup(); for (let n = 1; n <= 28; n++) f.seed(`2026-11-${String(n).padStart(2, "0")}`);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result?.items.length, 25); assert.equal(f.client.getSnapshot().result?.nextBeforeRevision, 4);
  await f.client.next(); assert(f.calls.at(-1)!.url.includes("beforeRevision=4"));
  assert.deepEqual(f.client.getSnapshot().result?.items.map(row => row.revision), [3, 2, 1]);
  await f.client.withdraw(28, "Not visible"); assert.equal(f.calls.length, 2); assert.equal(f.client.getSnapshot().result, null);
  await f.client.refresh(); assert.equal(f.client.getSnapshot().result?.items[0].revision, 28);
});

test("synchronous loading observer pause stops GET; saving observer pause stops POST before or after persistence", async () => {
  for (const phase of ["loading", "saving-before-pending", "saving-with-pending"] as const) {
    const f = setup(); if (phase !== "loading") await f.client.initialize(); let triggered = false;
    f.client.subscribe(() => {
      const state = f.client.getSnapshot();
      if (!triggered && (phase === "loading" ? state.phase === "loading" : state.phase === "saving" && !!state.pending === (phase === "saving-with-pending"))) {
        triggered = true; f.client.pause();
      }
    });
    if (phase === "loading") await f.client.initialize(); else await f.client.approve(input());
    assert(triggered); assert.equal(f.calls.length, phase === "loading" ? 0 : 1); assert.equal(f.client.getSnapshot().result, null);
    assert.equal(f.memory.size, phase === "saving-with-pending" ? 1 : 0);
    if (phase === "saving-with-pending") { assert(f.client.getSnapshot().pending); await f.client.initialize(); assert.equal(f.calls.at(-1)!.method, "GET"); }
  }
});

test("retry cannot POST after a synchronous unknown-receipt observer pauses or hides the client", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.approve(input()); let triggered = false;
  f.client.subscribe(() => {
    const state = f.client.getSnapshot(); if (!triggered && state.phase === "unconfirmed" && state.result) { triggered = true; f.client.pause(); }
  });
  f.mode("normal"); await f.client.retry(); assert(triggered);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1); assert.equal(f.client.getSnapshot().result, null); assert(f.client.getSnapshot().pending);
});

test("receipt settlement is atomic; a ready observer pause cannot resurrect old results after pending clears", async () => {
  const f = setup(); await f.client.initialize(); let paused = false, partial = false;
  f.client.subscribe(() => {
    const state = f.client.getSnapshot();
    if (state.phase === "saving" && !state.pending && f.writes() > 0) partial = true;
    if (!paused && state.result?.receipt) { paused = true; f.client.pause(); }
  });
  await f.client.approve(input()); assert(paused); assert.equal(partial, false);
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.memory.size, 0);
});

test("late committed POST after pause cannot display records or consume pending; explicit return only GETs receipt", async () => {
  const f = setup(); await f.client.initialize(); let release!: (response: Response) => void;
  f.transport(() => new Promise(resolve => { release = resolve; })); const job = f.client.approve(input());
  const pending = f.client.getSnapshot().pending; assert(pending); f.client.pause();
  release(f.commit(pending.query, pending.command)); await job;
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().pending?.command.operationId, pending.command.operationId);
  assert(f.memory.has(f.client.storageKey)); f.transport(null); await f.client.initialize(); assert.equal(f.client.getSnapshot().pending, null);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
});

test("late GET cannot replace a newer generation and synchronous storage/random-ID callbacks cannot continue a POST", async () => {
  const f = setup(); let release!: (response: Response) => void; f.transport(() => new Promise(resolve => { release = resolve; }));
  const late = f.client.initialize(); f.client.pause(); f.transport(null); await f.client.initialize(); const current = f.client.getSnapshot();
  release(Response.json({ wrong: true })); await late; assert.strictEqual(f.client.getSnapshot(), current);
  const g = setup();
  const client: AttendancePersonalRulesClient = g.create({ randomId: () => { client.pause(); return id(999); } }); await client.initialize(); await client.approve(input());
  assert.equal(g.calls.length, 1); assert.equal(g.memory.size, 0); assert.equal(client.getSnapshot().result, null);
  const h = setup(); let paused = false;
  const other: AttendancePersonalRulesClient = h.create({ storage: () => ({ ...h.storage, getItem: key => { if (!paused && h.writes() > 0) { paused = true; other.pause(); } return h.storage.getItem(key); } }) });
  await other.initialize(); await other.approve(input()); assert(paused); assert(other.getSnapshot().pending); assert(h.memory.has(other.storageKey)); assert.equal(other.getSnapshot().result, null);
});

test("hidden-at-notification checks work without a caller invoking pause, and reentrant writes cannot escape busy reservation", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); let isHidden = false;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return isHidden; } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); });
  const f = setup(); await f.client.initialize(); f.client.subscribe(() => { if (f.client.getSnapshot().phase === "saving" && f.client.getSnapshot().pending) isHidden = true; });
  await f.client.approve(input()); assert.equal(f.calls.length, 1); assert(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  isHidden = false; const g = setup(); let attempted = false;
  g.client.subscribe(() => { if (!attempted && g.client.getSnapshot().phase === "ready") { attempted = true; void g.client.approve(input()); } });
  await g.client.initialize(); assert(attempted); assert.equal(g.calls.length, 1); assert.equal(g.memory.size, 0);
});

test("UTF-8 success/error byte caps, fatal decoding, redirects and body deadlines fail closed and retain original operation", async () => {
  const redirected = Object.defineProperty(Response.json({ ok: true }), "redirected", { value: true });
  for (const response of [new Response('"' + "界".repeat(44000) + '"', { headers: { "Content-Type": "application/json" } }),
    new Response(Uint8Array.of(255), { headers: { "Content-Type": "application/json" } }),
    new Response("login", { headers: { "Content-Type": "text/html" } }), redirected]) {
    const f = setup(); f.transport(async () => response); await f.client.initialize(); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  }
  const f = setup(); await f.client.initialize(); f.transport(async () => new Response('"' + "界".repeat(1400) + '"', { status: 409, headers: { "Content-Type": "application/json" } }));
  await f.client.approve(input()); assert(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  const g = setup(); const client = g.create({ timeoutMs: 10 }); await client.initialize(); let cancelled = false;
  g.transport(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":')); }, cancel() { cancelled = true; } }),
    { status: 409, headers: { "Content-Type": "application/json" } }));
  await client.approve(input()); assert(cancelled); assert(client.getSnapshot().pending); assert.equal(client.getSnapshot().result, null);
  const h = setup(); const slow = h.create({ timeoutMs: 10 }); h.transport(() => new Promise(() => {})); await slow.initialize(); assert.equal(slow.getSnapshot().phase, "blocked");
});

test("pending and result snapshots cannot be mutated by subscribers or callers into a different identity/command", async () => {
  const f = setup(); await f.client.initialize(); assert.throws(() => { f.client.getSnapshot().result!.worker.employeeId = id(444); });
  f.mode("unsent"); await f.client.approve(input()); const pending = f.client.getSnapshot().pending; assert(pending);
  assert.throws(() => { pending.command.reason = "Injected"; }); assert.throws(() => { pending.query.workerId = id(333); });
  const command = pending.command;
  if (command.action === "approve") assert.throws(() => { command.rules.lateGraceMinutes = { mode: "disabled" }; });
  assert.equal(f.memory.get(f.client.storageKey), JSON.stringify(pending));
});
