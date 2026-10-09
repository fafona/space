import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceShiftTemplatesClient } from "./merchantAttendanceShiftTemplatesClient";
import { parseShiftTemplatesBody, parseShiftTemplatesHttpQuery, type ShiftTemplate, type ShiftTemplateItem,
  type ShiftTemplatesResult } from "./merchantAttendanceShiftTemplates";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(900);
const template: ShiftTemplate = { name: "Morning", segments: [{ start: "09:00", end: "13:00", nextDay: false }] };
const item = (n = 1): ShiftTemplateItem => ({ templateId: id(n), revision: 1, template, archived: false, updatedAt: "2026-10-03T09:00:00.123456Z" });
type Receipt = NonNullable<ShiftTemplatesResult["receipt"]>;
type ClientOptions = ConstructorParameters<typeof AttendanceShiftTemplatesClient>[0];

function setup() {
  const memory = new Map<string, string>(), rows = new Map<string, ShiftTemplateItem>(), receipts = new Map<string, Receipt>();
  const calls: { url: string; method: string; body: string | null }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  let sequence = 100, writes = 0, enabled = true;
  let mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const reply = (query: ReturnType<typeof parseShiftTemplatesHttpQuery>, receipt: Receipt | null = null) => {
    const visible = [...rows.values()].filter(row => row.archived === (query.view === "archived")
      && (query.cursorId === null || row.templateId < query.cursorId)).sort((a, b) => a.templateId < b.templateId ? 1 : -1);
    const items = visible.slice(0, 20);
    return Response.json({ ok: true, moduleEnabled: enabled, siteId, view: query.view, items,
      nextCursor: visible.length > 20 ? items.at(-1)!.templateId : null,
      receipt: receipt ?? (query.operationId ? receipts.get(query.operationId) ?? null : null) });
  };
  const apiFetch: AttendanceApiFetch = async (url, init) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null;
    calls.push({ url, method, body });
    assert.equal(init?.cache, "no-store");
    if (transport) return transport(url, init);
    if (method === "GET") return reply(parseShiftTemplatesHttpQuery(new URL(url, "https://www.faolla.com").href));
    assert.equal(method, "POST");
    const { query, command } = parseShiftTemplatesBody(JSON.parse(body!));
    const stored = JSON.parse(memory.get(`faolla:attendance:shift-templates:v1:${siteId}:${ownerId}`)!);
    assert.deepEqual(stored.command, command, "exact intent must be persisted before network submission");
    if (mode === "unsent") throw Error("network failed before delivery");
    let receipt = receipts.get(command.operationId);
    if (!receipt) {
      const existing = rows.get(command.templateId);
      if ((existing?.revision ?? 0) !== command.expectedRevision)
        return Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 });
      const saved: ShiftTemplateItem = { templateId: command.templateId, revision: command.expectedRevision + 1,
        template: command.template ?? existing!.template, archived: command.action === "archive", updatedAt: "2026-10-03T10:00:00.654321Z" };
      receipt = { command, item: structuredClone(saved) }; receipts.set(command.operationId, receipt);
      rows.set(saved.templateId, saved); writes++;
    }
    if (mode === "lost") throw Error("committed response lost");
    return reply(query, receipt);
  };
  const create = (patch: Partial<ClientOptions> = {}) => new AttendanceShiftTemplatesClient({ siteId, ownerId,
    storage: () => storage, apiFetch, randomId: () => id(sequence++), timeoutMs: 1000, ...patch });
  const client = create();
  return { client, create, memory, storage, rows, receipts, calls, apiFetch, reply, writes: () => writes,
    mode: (value: typeof mode) => { mode = value; }, enabled: (value: boolean) => { enabled = value; },
    transport: (value: typeof transport) => { transport = value; } };
}

test("construction and subscription are inert; explicit reads never write, poll or touch pending schedule state", async () => {
  const f = setup(), scheduleKey = `faolla:attendance:schedule:v1:${siteId}:${ownerId}`;
  f.memory.set(scheduleKey, "original schedule intent");
  let notifications = 0; const unsubscribe = f.client.subscribe(() => { notifications++; });
  assert.equal(f.calls.length, 0); assert.equal(f.client.getSnapshot().phase, "idle");
  assert.notEqual(f.client.storageKey, scheduleKey);
  await f.client.save(template); assert.equal(f.calls.length, 0);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready");
  assert.deepEqual(f.calls.map(call => call.method), ["GET"]); assert.ok(notifications > 0);
  unsubscribe(); const count = notifications; await f.client.load("archived"); assert.equal(notifications, count);
  assert.equal(f.memory.get(scheduleKey), "original schedule intent"); assert.equal(f.writes(), 0);
});

test("save and archive persist independent exact operations before POST, carry revisions, and do not publish a schedule", async () => {
  const f = setup(); await f.client.initialize(); await f.client.save(template);
  const created = f.client.getSnapshot().result!.items[0];
  assert.equal(created.revision, 1); assert.equal(created.templateId, id(100)); assert.equal(f.memory.size, 0);
  await f.client.save({ ...template, name: "Changed" }, created);
  const updated = f.client.getSnapshot().result!.items[0]; assert.equal(updated.revision, 2);
  await f.client.archive(updated);
  assert.deepEqual(f.client.getSnapshot().result!.items, []); assert.equal(f.client.getSnapshot().result!.receipt?.item.archived, true);
  assert.equal(f.client.getSnapshot().result!.receipt?.item.revision, 3); assert.equal(f.memory.size, 0);
  const commands = f.calls.filter(call => call.method === "POST").map(call => JSON.parse(call.body!).command);
  assert.deepEqual(commands.map(c => c.expectedRevision), [0, 1, 2]);
  assert.deepEqual(commands.map(c => c.operationId), [id(100), id(101), id(102)]);
  assert.equal(commands[2].template, null); assert.equal(commands[2].templateId, created.templateId);
  assert.ok(f.calls.every(call => call.url.startsWith("/api/merchant-enterprise/attendance/shift-templates")));
  assert.equal(f.writes(), 3);
});

test("a lost 200 save is recovered by GET-only on remount; receipt remains old while the list reflects newer content", async () => {
  const f = setup(); await f.client.initialize(); f.mode("lost"); await f.client.save(template);
  const pending = f.client.getSnapshot().pending!, raw = f.memory.get(f.client.storageKey);
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.ok(raw); assert.equal(f.writes(), 1);
  f.rows.set(pending.command.templateId, { ...f.rows.get(pending.command.templateId)!, revision: 2, template: { ...template, name: "Newer current" } });
  const n = f.calls.length, restored = f.create(); await restored.initialize();
  assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET"]);
  assert.equal(new URL(f.calls[n].url, "https://fixture.invalid").searchParams.get("operationId"), pending.command.operationId);
  assert.equal(restored.getSnapshot().result!.receipt!.item.revision, 1);
  assert.equal(restored.getSnapshot().result!.items[0].revision, 2);
  assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.has(f.client.storageKey), false);
  assert.equal(f.writes(), 1);
});

test("lost archive remains pending and is recovered without recreating, modifying, or re-archiving the template", async () => {
  const f = setup(); f.rows.set(id(1), item()); await f.client.initialize(); f.mode("lost"); await f.client.archive(item());
  assert.equal(f.client.getSnapshot().pending?.command.action, "archive"); assert.equal(f.writes(), 1);
  const n = f.calls.length; await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET"]);
  assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.client.getSnapshot().result!.receipt!.item.archived, true);
  assert.equal(f.writes(), 1);
});

test("explicit retry checks GET receipt first and resends only the identical original POST after an authoritative absence", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.save(template);
  const originalBody = f.calls.at(-1)!.body, raw = f.memory.get(f.client.storageKey), n = f.calls.length;
  assert.ok(raw); assert.equal(f.writes(), 0);
  await f.client.save({ ...template, name: "Must not replace pending" }); await f.client.load("archived"); await f.client.next();
  assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  f.mode("normal"); await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET", "POST"]);
  assert.equal(f.calls.at(-1)!.body, originalBody); assert.equal(f.writes(), 1); assert.equal(f.client.getSnapshot().pending, null);
});

test("failed, malformed or foreign-site receipt lookup never clears intent or follows with POST", async () => {
  for (const variant of ["network", "html", "foreign", "wrong-command", "wrong-item", "oversized"] as const) {
    const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.save(template);
    const pending = f.client.getSnapshot().pending!, raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async () => {
      if (variant === "network") throw Error("network");
      if (variant === "html") return new Response("login page", { headers: { "content-type": "text/html" } });
      const body = { ok: true, moduleEnabled: true, siteId: variant === "foreign" ? "99990002" : siteId,
        view: "active", items: variant === "oversized" ? Array.from({ length: 21 }, (_, i) => item(50 - i)) : [], nextCursor: null,
        receipt: variant === "wrong-command" || variant === "wrong-item" ? {
          command: { ...pending.command, ...(variant === "wrong-command" ? { operationId: id(555) } : {}) },
          item: { ...item(), templateId: pending.command.templateId, revision: variant === "wrong-item" ? 2 : 1 },
        } : null };
      return Response.json(body);
    });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET"], variant);
    assert.ok(f.client.getSnapshot().pending, variant); assert.equal(f.client.getSnapshot().result, null, variant);
    assert.equal(f.memory.get(f.client.storageKey), raw, variant);
  }
});

test("only a properly typed POST version-conflict response clears the matching intent; malformed/status-mismatched errors do not", async () => {
  for (const [body, status, cleared] of [
    [{ ok: false, error: "attendance_version_conflict" }, 409, true],
    [{ ok: false, error: "attendance_version_conflict" }, 500, false],
    [{ ok: true, error: "attendance_version_conflict" }, 409, false],
    [{ error: "attendance_version_conflict" }, 409, false],
    [{ ok: false, error: "attendance_version_conflict", unexpected: true }, 409, false],
    [{ ok: false, error: "unknown_private_error" }, 409, false],
    [{ ok: false, error: { code: "attendance_version_conflict" } }, 409, false],
    [null, 409, false],
  ] as [unknown, number, boolean][]) {
    const f = setup(); await f.client.initialize();
    f.transport(async () => Response.json(body, { status })); await f.client.save(template);
    assert.equal(f.client.getSnapshot().pending === null, cleared);
    assert.equal(f.memory.has(f.client.storageKey), !cleared); assert.equal(f.client.getSnapshot().result, null);
  }
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.save(template);
  const raw = f.memory.get(f.client.storageKey);
  f.transport(async () => Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 }));
  const n = f.calls.length; await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET"]);
  assert.equal(f.memory.get(f.client.storageKey), raw, "even a typed GET error does not settle a write");
});

test("malformed/foreign stored intent and cross-tab substitution are never overwritten or cleared", async () => {
  for (const raw of ["{broken", JSON.stringify({ ownerId: id(901), siteId, view: "active", command: {} }),
    JSON.stringify({ ownerId, siteId: "99990002", view: "active", command: {} }), "x".repeat(8193)]) {
    const f = setup(); f.memory.set(f.client.storageKey, raw); await f.client.initialize();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0);
    assert.equal(f.memory.get(f.client.storageKey), raw);
  }
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.save(template);
  const foreign = JSON.parse(f.memory.get(f.client.storageKey)!);
  foreign.command.operationId = id(777); foreign.command.templateId = id(777);
  const raw = JSON.stringify(foreign); f.memory.set(f.client.storageKey, raw);
  const n = f.calls.length; await f.client.retry();
  assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
});

test("invalid JSON and over-budget error bodies cannot turn a possibly committed POST into a definite refusal", async () => {
  for (const body of ["{invalid", "", " ".repeat(4096) + JSON.stringify({ ok: false, error: "attendance_version_conflict" })]) {
    const f = setup(); await f.client.initialize();
    f.transport(async () => new Response(body, { status: 409, headers: { "content-type": "application/json" } }));
    await f.client.save(template);
    assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.ok(f.client.getSnapshot().pending);
    assert.ok(f.memory.get(f.client.storageKey)); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("a slow error-body stream is deadline-cancelled, unlocks its reader and retains the exact pending POST", async () => {
  const f = setup(), client = f.create({ timeoutMs: 25 }); await client.initialize();
  let cancelled = 0, requestSignal: AbortSignal | null | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":"attendance_version_conflict"')); },
    cancel() { cancelled++; },
  });
  f.transport(async (_url, init) => {
    requestSignal = init?.signal;
    return new Response(stream, { status: 409, headers: { "content-type": "application/json; charset=utf-8" } });
  });
  await client.save(template);
  // Cancellation settles the pending reader asynchronously; no real timer wait
  // is needed beyond this request's deliberately short 25 ms deadline.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(requestSignal?.aborted, true); assert.equal(stream.locked, false);
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.equal(client.getSnapshot().result, null);
  const raw = f.memory.get(client.storageKey); assert.ok(raw);
  assert.deepEqual(JSON.parse(raw).command, JSON.parse(f.calls.at(-1)!.body!).command);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("bounded UTF-8 error streams handle split encoding safely and only an allowlisted refusal can clear pending", async () => {
  for (const [error, clear] of [["attendance_version_conflict", true], ["暂时失败🙂", false]] as const) {
    const f = setup(); await f.client.initialize();
    const bytes = new TextEncoder().encode(JSON.stringify({ ok: false, error }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      // Single-byte chunks split every multibyte code point across reads.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    f.transport(async () => new Response(stream, { status: 409, headers: { "content-type": "application/json; charset=utf-8" } }));
    await f.client.save(template);
    assert.equal(f.client.getSnapshot().pending === null, clear); assert.equal(f.memory.has(f.client.storageKey), !clear);
    assert.equal(stream.locked, false); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("storage must round-trip before writing; a foreign replacement during POST is preserved even after a success receipt", async () => {
  const f = setup(), blocked = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("blocked storage"); } }) });
  await blocked.initialize(); await blocked.save(template); assert.equal(f.writes(), 0); assert.equal(f.calls.length, 1);
  await f.client.initialize(); let foreignRaw = "";
  f.transport(async (_url, init) => {
    const { query, command } = parseShiftTemplatesBody(JSON.parse(String(init!.body)));
    foreignRaw = JSON.stringify({ ownerId, siteId, view: "active", command: { ...command, operationId: id(777), templateId: id(777) } });
    f.memory.set(f.client.storageKey, foreignRaw);
    return f.reply(query, { command, item: { ...item(), templateId: command.templateId } });
  });
  await f.client.save(template); assert.equal(f.memory.get(f.client.storageKey), foreignRaw);
  assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
});

test("platform pause allows explicit reads and receipt checks but blocks fresh saves, archives and pending resubmission", async () => {
  const f = setup(); f.rows.set(id(1), item()); f.enabled(false); await f.client.initialize();
  await f.client.save(template); await f.client.archive(item()); assert.equal(f.calls.length, 1);
  f.enabled(true); await f.client.initialize(); f.mode("unsent"); await f.client.save(template);
  const raw = f.memory.get(f.client.storageKey); f.enabled(false); f.mode("normal"); const n = f.calls.length;
  await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(call => call.method), ["GET"]);
  assert.equal(f.client.getSnapshot().result?.moduleEnabled, false); assert.equal(f.memory.get(f.client.storageKey), raw);
  assert.equal(f.writes(), 0);
});

test("hidden views send nothing and explicit pause fences stale reads without exposing their returned data", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); });
  const visibility = { hidden: true }; Object.defineProperty(globalThis, "document", { configurable: true, value: visibility });
  const f = setup(); await f.client.initialize(); await f.client.load(); await f.client.save(template); assert.equal(f.calls.length, 0);
  visibility.hidden = false;
  let release!: (response: Response) => void;
  f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
  const reading = f.client.initialize(); f.client.pause();
  f.transport(null); await f.client.initialize(); const latest = f.client.getSnapshot();
  release(Response.json({ ok: true, moduleEnabled: true, siteId, view: "active", items: [item(20)], nextCursor: null, receipt: null }));
  await reading; assert.equal(f.client.getSnapshot(), latest); assert.equal(f.client.getSnapshot().result!.items.length, 0);
});

test("double save and pause during a POST retain one original pending operation and ignore the late receipt", async () => {
  const f = setup(); await f.client.initialize();
  let release!: (response: Response) => void, abortedSignal: AbortSignal | undefined;
  f.transport((_url, init) => { abortedSignal = init?.signal ?? undefined; return new Promise<Response>(resolve => { release = resolve; }); });
  const saving = f.client.save(template); await f.client.save({ ...template, name: "Double click" });
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  const pending = f.client.getSnapshot().pending!, raw = f.memory.get(f.client.storageKey);
  f.client.pause(); assert.equal(abortedSignal?.aborted, true);
  release(Response.json({ ok: true, moduleEnabled: true, siteId, view: "active", items: [], nextCursor: null,
    receipt: { command: pending.command, item: { ...item(), templateId: pending.command.templateId } } }));
  await saving; assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "unconfirmed");
  assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("20-row pages are explicit, next is inert at the end, and changing view resets the cursor", async () => {
  const f = setup(); for (let n = 1; n <= 25; n++) f.rows.set(id(n), item(n));
  f.rows.set(id(30), { ...item(30), archived: true });
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result!.items.length, 20);
  assert.equal(f.client.getSnapshot().result!.nextCursor, id(6)); assert.equal(f.calls.length, 1);
  await f.client.next(); assert.equal(f.client.getSnapshot().result!.items.length, 5);
  assert.equal(new URL(f.calls.at(-1)!.url, "https://fixture.invalid").searchParams.get("cursorId"), id(6));
  const n = f.calls.length; await f.client.next(); assert.equal(f.calls.length, n);
  await f.client.load("archived"); assert.deepEqual(f.client.getSnapshot().result!.items.map(row => row.templateId), [id(30)]);
  const request = new URL(f.calls.at(-1)!.url, "https://fixture.invalid");
  assert.equal(request.searchParams.get("view"), "archived"); assert.equal(request.searchParams.has("cursorId"), false);
  assert.equal(f.writes(), 0);
});
