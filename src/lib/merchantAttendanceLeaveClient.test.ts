import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceLeaveClient } from "./merchantAttendanceLeaveClient";
import { parseLeaveBody, parseLeaveHttpQuery, type LeaveDetail, type LeaveQuery, type LeaveResult, type LeaveSummary } from "./merchantAttendanceLeave";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(101), workerId = id(201), authId = id(99), ownerId = id(98);
const input = { reason: "Personal leave", startAt: "2026-10-05T07:00:00.000Z", endAt: "2026-10-05T15:00:00.000Z" };
const summary = (n = 501): LeaveSummary => ({ requestId: id(n), workerName: "Synthetic worker", ...input,
  timeZone: "Europe/Madrid", submittedAt: "2026-10-03T09:00:00.123456Z", revision: 1, status: "submitted" });
// List summaries deliberately exclude the private application reason.
const cleanSummary = (row: LeaveSummary): LeaveSummary => ({ requestId: row.requestId, workerName: row.workerName, startAt: row.startAt,
  endAt: row.endAt, timeZone: row.timeZone, submittedAt: row.submittedAt, revision: row.revision, status: row.status });
type Receipt = NonNullable<LeaveResult["receipt"]>;

function setup() {
  const memory = new Map<string, string>(), rows = new Map<string, LeaveDetail>(), receipts = new Map<string, Receipt>();
  const calls: { url: string; method: string; body: string | null; signal: AbortSignal | null | undefined }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); } };
  let serial = 501, writes = 0, enabled = true, mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const seed = (n = 501) => {
    serial = Math.max(serial, n + 1);
    const row: LeaveDetail = { ...cleanSummary(summary(n)), workerId, employeeId, reason: input.reason,
      history: [{ revision: 1, action: "submit", reason: input.reason, recordedAt: summary(n).submittedAt }],
      canWithdraw: false, canApprove: false, canReject: false, canCancel: false };
    rows.set(row.requestId, row); return row;
  };
  const view = (row: LeaveDetail, access: LeaveQuery["access"]): LeaveDetail => ({ ...structuredClone(row),
    canWithdraw: access === "self" && row.status === "submitted", canApprove: access === "owner" && row.status === "submitted",
    canReject: access === "owner" && row.status === "submitted", canCancel: access === "owner" && row.status === "approved" });
  const reply = (query: LeaveQuery, receipt: Receipt | null = null, isPost = false) => {
    const found = receipt ?? (query.operationId ? receipts.get(query.operationId) ?? null : null);
    const target = found?.requestId ?? query.requestId, row = target ? rows.get(target) : undefined;
    const listed = target || query.operationId || isPost ? [] : [...rows.values()].filter(r => !query.beforeAt
      || r.submittedAt < query.beforeAt || r.submittedAt === query.beforeAt && r.requestId < query.beforeId!).sort((a, b) => a.requestId < b.requestId ? 1 : -1);
    const items = listed.slice(0, 25).map(cleanSummary);
    return Response.json({ ok: true, moduleEnabled: enabled, protocol: "leave-v1", siteId, access: query.access,
      actorId: query.access === "self" ? authId : ownerId, employeeId: query.access === "self" ? employeeId : null,
      workerId: query.access === "self" ? workerId : null, settingsVersion: 1, timeZone: "Europe/Madrid", canSubmit: query.access === "self",
      items, nextCursor: listed.length > 25 ? { at: items[24].submittedAt, id: items[24].requestId } : null,
      detail: row ? view(row, query.access) : null, receipt: found });
  };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null;
    calls.push({ url, method, body, signal: init?.signal }); assert.equal(init?.cache, "no-store");
    if (transport) return transport(url, init);
    if (method === "GET") return reply(parseLeaveHttpQuery(new URL(url, "https://fixture.invalid").href));
    const { query, command } = parseLeaveBody(JSON.parse(body!));
    const key = `faolla:attendance:leave:v1:${siteId}:${query.access}:${query.access === "self" ? employeeId : ownerId}`;
    assert.deepEqual(JSON.parse(memory.get(key)!).command, command, "intent must be persisted before POST");
    if (mode === "unsent") throw Error("request not delivered");
    let receipt = receipts.get(command.operationId);
    if (!receipt) {
      let row: LeaveDetail;
      if (command.action === "submit") {
        row = seed(Number(command.operationId.slice(-12)));
        Object.assign(row, { reason: command.reason, startAt: command.startAt, endAt: command.endAt, timeZone: command.timeZone });
        row.history[0].reason = command.reason;
      } else {
        row = rows.get(command.requestId)!; assert.ok(row);
        assert.equal(row.revision, command.expectedRevision);
        row.revision++; row.status = ({ withdraw: "withdrawn", approve: "approved", reject: "rejected", cancel: "cancelled" } as const)[command.action];
        row.history.push({ revision: row.revision, action: command.action, reason: command.reason,
          recordedAt: `2026-10-03T10:00:00.00000${row.revision}Z` });
      }
      receipt = { command: structuredClone(command), item: cleanSummary(row), requestId: row.requestId, revision: row.revision };
      receipts.set(command.operationId, receipt); writes++;
    }
    if (mode === "lost") throw Error("committed 200 response lost");
    return reply(query, receipt, true);
  };
  const create = (access: "self" | "owner" = "self", patch: Partial<{ timeoutMs: number; storage: () => typeof storage }> = {}) => new AttendanceLeaveClient({ siteId,
    ...(access === "self" ? { access, employeeId } : { access, actorId: ownerId }), apiFetch, storage: () => storage,
    randomId: () => id(serial++), timeoutMs: 1000, ...patch });
  return { create, client: create(), memory, storage, rows, receipts, calls, seed, reply, writes: () => writes,
    enabled: (value: boolean) => { enabled = value; }, mode: (value: typeof mode) => { mode = value; },
    transport: (value: typeof transport) => { transport = value; } };
}

test("constructor is inert and self business employee ID is not confused with the authenticated user ID", async () => {
  const f = setup(), unrelated = `faolla:attendance:schedule:v1:${siteId}:${authId}`;
  f.memory.set(unrelated, "other pending operation");
  let changes = 0; const off = f.client.subscribe(() => { changes++; });
  await f.client.next(); await f.client.submit(input); assert.equal(f.calls.length, 0);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready");
  assert.equal(f.client.getSnapshot().result?.employeeId, employeeId); assert.equal(f.client.getSnapshot().result?.actorId, authId);
  assert.notEqual(employeeId, authId); assert.match(f.client.storageKey, new RegExp(`${employeeId}$`));
  assert.deepEqual(f.calls.map(c => c.method), ["GET"]); assert.ok(changes > 0);
  off(); const n = changes; f.client.pause(); assert.equal(changes, n); assert.equal(f.memory.get(unrelated), "other pending operation");
});

test("submit persists actor, employee and site binding; owner approval then cancellation are distinct original operations", async () => {
  const f = setup(); await f.client.initialize(); await f.client.submit(input);
  assert.equal(f.client.getSnapshot().result?.detail?.status, "submitted"); assert.equal(f.memory.size, 0);
  const owner = f.create("owner"); await owner.initialize(); await owner.detail(id(501)); await owner.decide("approve", "Approved");
  assert.equal(owner.getSnapshot().result?.detail?.status, "approved"); await owner.decide("cancel", "Cancelled");
  assert.equal(owner.getSnapshot().result?.detail?.revision, 3); assert.equal(owner.getSnapshot().result?.detail?.status, "cancelled");
  const commands = f.calls.filter(c => c.method === "POST").map(c => JSON.parse(c.body!).command);
  assert.deepEqual(commands.map(c => c.action), ["submit", "approve", "cancel"]);
  assert.deepEqual(commands.map(c => c.operationId), [id(501), id(502), id(503)]);
  assert.equal(commands[0].expectedWorkerId, workerId); assert.equal(commands[1].expectedRevision, 1); assert.equal(commands[2].expectedRevision, 2);
  assert.ok(f.calls.every(c => c.url.startsWith("/api/merchant-enterprise/attendance/leave"))); assert.equal(f.writes(), 3);
});

test("lost submit response restores by GET only, retaining immutable receipt even after owner later approves", async () => {
  const f = setup(); await f.client.initialize(); f.mode("lost"); await f.client.submit(input);
  const raw = f.memory.get(f.client.storageKey)!; assert.ok(raw);
  const pending = JSON.parse(raw); assert.equal(pending.actorId, authId); assert.equal(pending.employeeId, employeeId); assert.equal(pending.siteId, siteId);
  const row = f.rows.get(id(501))!; row.revision = 2; row.status = "approved";
  row.history.push({ revision: 2, action: "approve", reason: "Approved", recordedAt: "2026-10-03T10:00:00.000002Z" });
  const n = f.calls.length, restored = f.create(); await restored.initialize();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  assert.equal(new URL(f.calls[n].url, "https://fixture.invalid").searchParams.get("operationId"), id(501));
  assert.equal(restored.getSnapshot().result?.receipt?.item.revision, 1); assert.equal(restored.getSnapshot().result?.detail?.revision, 2);
  assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
});

test("withdrawal is self-only; a lost withdrawal recovers the original receipt without issuing a second write", async () => {
  const f = setup(); f.seed(); await f.client.initialize(); await f.client.detail(id(501));
  await f.client.decide("approve", "No self approval"); assert.equal(f.writes(), 0);
  f.mode("lost"); await f.client.decide("withdraw", "Withdrawn"); assert.equal(f.client.getSnapshot().pending?.command.action, "withdraw");
  const n = f.calls.length; await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  assert.equal(f.client.getSnapshot().result?.detail?.status, "withdrawn"); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.writes(), 1);
});

test("explicit retry first checks original receipt and then reuses the byte-identical POST without accepting a new intent", async () => {
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.submit(input);
  const body = f.calls.at(-1)!.body, raw = f.memory.get(f.client.storageKey), n = f.calls.length;
  await f.client.submit({ ...input, reason: "New replacement" }); await f.client.load(); await f.client.detail(id(900)); await f.client.next();
  assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  f.mode("normal"); await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET", "POST"]);
  assert.equal(f.calls.at(-1)!.body, body); assert.equal(f.writes(), 1); assert.equal(f.client.getSnapshot().pending, null);
});

test("foreign actor or employee responses cannot confirm pending self writes; owner responses bind the configured auth ID", async () => {
  for (const field of ["actorId", "employeeId"] as const) {
    const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.submit(input);
    const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async url => { const response = await f.reply(parseLeaveHttpQuery(new URL(url, "https://fixture.invalid").href));
      return Response.json({ ...await response.json(), [field]: id(777) }); });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    assert.equal(f.memory.get(f.client.storageKey), raw); assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  }
  const f = setup(), owner = f.create("owner");
  f.transport(async url => { const response = await f.reply(parseLeaveHttpQuery(new URL(url, "https://fixture.invalid").href));
    return Response.json({ ...await response.json(), actorId: authId }); });
  await owner.initialize(); assert.equal(owner.getSnapshot().phase, "blocked"); assert.equal(owner.getSnapshot().result, null);
});

test("malformed or mismatched errors retain pending, while only exact definite POST refusals may settle the same stored command", async () => {
  for (const [body, status, clears] of [[{ ok: false, error: "attendance_version_conflict" }, 409, true],
    [{ ok: true, error: "attendance_version_conflict" }, 409, false], [{ error: "attendance_version_conflict" }, 409, false],
    [{ ok: false, error: "attendance_version_conflict", extra: true }, 409, false], [{ ok: false, error: "attendance_version_conflict" }, 500, false],
    [{ ok: false, error: "attendance_operation_conflict" }, 409, false], [{ ok: false, error: "attendance_access_denied" }, 403, false]] as [unknown, number, boolean][]) {
    const f = setup(); await f.client.initialize(); f.transport(async () => Response.json(body, { status })); await f.client.submit(input);
    assert.equal(f.client.getSnapshot().pending === null, clears); assert.equal(f.memory.has(f.client.storageKey), !clears); assert.equal(f.client.getSnapshot().result, null);
  }
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.submit(input); const raw = f.memory.get(f.client.storageKey);
  f.transport(async () => Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 }));
  const n = f.calls.length; await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("malformed success/receipt responses cannot settle a possibly committed request or trigger an automatic retry", async () => {
  for (const variant of ["html", "wrong-receipt", "bad-revision", "foreign-site", "oversized"] as const) {
    const f = setup(); await f.client.initialize(); f.mode("lost"); await f.client.submit(input);
    const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async url => {
      if (variant === "html") return new Response("login", { headers: { "content-type": "text/html" } });
      const body = await (await f.reply(parseLeaveHttpQuery(new URL(url, "https://fixture.invalid").href))).json();
      if (variant === "wrong-receipt") body.receipt.command.reason = "Different original command";
      if (variant === "bad-revision") body.receipt.revision = 3;
      if (variant === "foreign-site") body.siteId = "99990002";
      if (variant === "oversized") body.privateData = "x".repeat(131073);
      return Response.json(body);
    });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    assert.equal(f.memory.get(f.client.storageKey), raw); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("malformed storage, foreign identity and cross-tab replacements are preserved without any POST", async () => {
  for (const raw of ["{invalid", "x".repeat(8193), JSON.stringify({ siteId, access: "self", actorId: authId, employeeId: id(777), command: {} })]) {
    const f = setup(); f.memory.set(f.client.storageKey, raw); await f.client.initialize();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0); assert.equal(f.memory.get(f.client.storageKey), raw);
  }
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.submit(input);
  const changed = JSON.parse(f.memory.get(f.client.storageKey)!); changed.command.operationId = id(888);
  const raw = JSON.stringify(changed); f.memory.set(f.client.storageKey, raw); const n = f.calls.length; await f.client.retry();
  assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  const broken = setup(), client = broken.create("self", { storage: () => ({ ...broken.storage, setItem: () => { throw Error("storage disabled"); } }) });
  await client.initialize(); await client.submit(input); assert.equal(broken.calls.filter(c => c.method === "POST").length, 0);
});

test("platform pause blocks all fresh actions including withdrawal and original resubmission, but GET receipts remain readable", async () => {
  const f = setup(); f.seed(); f.enabled(false); await f.client.initialize(); await f.client.submit(input); await f.client.detail(id(501)); await f.client.decide("withdraw", "Paused");
  const owner = f.create("owner"); await owner.initialize(); await owner.detail(id(501)); await owner.decide("approve", "Paused");
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  f.enabled(true); await f.client.load(); f.mode("unsent"); await f.client.submit(input); const raw = f.memory.get(f.client.storageKey);
  f.enabled(false); const n = f.calls.length; await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("25-item list pages advance explicitly while detail uses its own empty-list envelope", async () => {
  const f = setup(); for (let n = 501; n <= 530; n++) f.seed(n); await f.client.initialize();
  assert.equal(f.client.getSnapshot().result?.items.length, 25); assert.equal(f.calls.length, 1); await f.client.next();
  assert.equal(f.client.getSnapshot().result?.items.length, 5); const n = f.calls.length; await f.client.next(); assert.equal(f.calls.length, n);
  const next = new URL(f.calls[1].url, "https://fixture.invalid"); assert.equal(next.searchParams.get("beforeId"), id(506));
  await f.client.detail(id(510)); assert.equal(f.client.getSnapshot().result?.detail?.requestId, id(510));
  assert.deepEqual(f.client.getSnapshot().result?.items, []); assert.equal(f.client.getSnapshot().result?.nextCursor, null);
});

test("hidden requests are inert and paused late GET success or denial cannot overwrite a new explicit result", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const hidden = setup(); await hidden.client.initialize(); await hidden.client.load(); assert.equal(hidden.calls.length, 0);
  doc.hidden = false;
  for (const denial of [false, true]) {
    const f = setup(); let release!: (r: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const reading = f.client.initialize(); await f.client.initialize(); assert.equal(f.calls.length, 1); f.client.pause();
    assert.equal(f.calls[0].signal?.aborted, true); f.transport(null); f.seed(600); await f.client.initialize();
    const fresh = f.client.getSnapshot();
    release(denial ? Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }) : f.reply({ siteId, access: "self", requestId: null, operationId: null, beforeAt: null, beforeId: null }));
    await reading; assert.equal(f.client.getSnapshot(), fresh); assert.equal(f.client.getSnapshot().result?.items[0].requestId, id(600));
  }
});

test("slow error streams time out and cancel their reader while preserving the exact pending operation", async () => {
  const f = setup(), client = f.create("self", { timeoutMs: 25 }); await client.initialize(); let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":')); }, cancel() { cancelled++; } });
  f.transport(async () => new Response(stream, { status: 409, headers: { "content-type": "application/json" } }));
  await client.submit(input); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(f.calls.at(-1)?.signal?.aborted, true);
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(client.getSnapshot().pending); assert.ok(f.memory.get(client.storageKey));
});

test("fresh leave clients preserve paused submit or owner-decision intent across denied reopen and late POST settlement", async t => {
  for (const access of ["self", "owner"] as const) for (const committed of [true, false]) {
    await t.test(`${access}: late ${committed ? "success" : "definitive conflict"}`, async () => {
      const f = setup(), original = f.create(access), unrelated = `faolla:attendance:schedule:v1:${siteId}:${authId}`;
      f.memory.set(unrelated, "unrelated pending bytes");
      if (access === "owner") f.seed();
      await original.initialize();
      if (access === "owner") await original.detail(id(501));
      let release!: (response: Response) => void;
      f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
      const writing = access === "self" ? original.submit(input) : original.decide("approve", "Original owner decision");
      const post = f.calls.at(-1)!, raw = f.memory.get(original.storageKey);
      assert.equal(post.method, "POST"); assert.ok(raw);
      const { query, command } = parseLeaveBody(JSON.parse(post.body!));
      let late: Response;
      if (committed) {
        const row = command.action === "submit" ? f.seed(Number(command.operationId.slice(-12))) : f.rows.get(command.requestId)!;
        if (command.action !== "submit") {
          row.revision++; row.status = "approved";
          row.history.push({ revision: row.revision, action: "approve", reason: command.reason, recordedAt: "2026-10-03T10:00:00.000002Z" });
        }
        const receipt: Receipt = { command, item: cleanSummary(row), requestId: row.requestId, revision: row.revision };
        f.receipts.set(command.operationId, receipt); late = f.reply(query, receipt, true);
      } else late = Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 });
      original.pause(); const paused = original.getSnapshot();
      assert.equal(post.signal?.aborted, true); assert.equal(paused.result, null);
      assert.equal(f.memory.get(original.storageKey), raw);

      f.transport(async () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }));
      const reopened = f.create(access), beforeReopen = f.calls.length;
      assert.notEqual(reopened, original); assert.equal(reopened.storageKey, original.storageKey);
      await reopened.initialize(); const denied = reopened.getSnapshot();
      assert.deepEqual(f.calls.slice(beforeReopen).map(call => call.method), ["GET"]);
      const recoveryQuery = parseLeaveHttpQuery(new URL(f.calls[beforeReopen].url, "https://fixture.invalid").href);
      assert.equal(recoveryQuery.operationId, command.operationId);
      assert.equal(recoveryQuery.requestId, command.action === "submit" ? null : command.requestId);
      assert.equal(denied.phase, "unconfirmed"); assert.equal(denied.result, null);
      assert.deepEqual(denied.pending?.command, command); assert.equal(f.memory.get(original.storageKey), raw);

      release(late); await writing;
      assert.equal(original.getSnapshot(), paused); assert.equal(reopened.getSnapshot(), denied);
      assert.equal(f.memory.get(original.storageKey), raw); assert.equal(f.memory.get(unrelated), "unrelated pending bytes");
      f.transport(null); f.enabled(false); const beforeRecovery = f.calls.length;
      await reopened.initialize();
      assert.deepEqual(f.calls.slice(beforeRecovery).map(call => call.method), ["GET"]);
      assert.deepEqual(parseLeaveHttpQuery(new URL(f.calls[beforeRecovery].url, "https://fixture.invalid").href), recoveryQuery);
      assert.equal(reopened.getSnapshot().result?.moduleEnabled, false);
      if (committed) {
        assert.equal(reopened.getSnapshot().pending, null); assert.equal(f.memory.has(original.storageKey), false);
        assert.deepEqual(reopened.getSnapshot().result?.receipt?.command, command);
      } else {
        assert.equal(reopened.getSnapshot().phase, "unconfirmed"); assert.equal(reopened.getSnapshot().result?.receipt, null);
        assert.deepEqual(reopened.getSnapshot().pending?.command, command); assert.equal(f.memory.get(original.storageKey), raw);
      }
      assert.equal(f.memory.get(unrelated), "unrelated pending bytes");
      assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
    });
  }
});

test("paused in-flight POST success or definitive conflict cannot reveal data or clear pending; returning resolves only through the original GET receipt", async () => {
  for (const committed of [true, false]) {
    const f = setup(); await f.client.initialize(); let release!: (response: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const writing = f.client.submit(input), pendingRaw = f.memory.get(f.client.storageKey);
    assert.ok(pendingRaw); assert.equal(f.calls.at(-1)?.method, "POST");
    const { query, command } = parseLeaveBody(JSON.parse(f.calls.at(-1)!.body!));
    let late: Response;
    if (committed) {
      const row = f.seed(Number(command.operationId.slice(-12)));
      const receipt: Receipt = { command, item: cleanSummary(row), requestId: row.requestId, revision: row.revision };
      f.receipts.set(command.operationId, receipt); late = f.reply(query, receipt, true);
    } else late = Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 });
    f.client.pause(); const paused = f.client.getSnapshot(); assert.equal(f.calls.at(-1)?.signal?.aborted, true);
    release(late); await writing;
    assert.equal(f.client.getSnapshot(), paused); assert.equal(paused.result, null); assert.ok(paused.pending);
    assert.equal(f.memory.get(f.client.storageKey), pendingRaw);
    f.transport(null); const n = f.calls.length; await f.client.initialize();
    assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    assert.equal(new URL(f.calls[n].url, "https://fixture.invalid").searchParams.get("operationId"), command.operationId);
    if (committed) {
      assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.memory.has(f.client.storageKey), false);
      assert.equal(f.client.getSnapshot().result?.receipt?.command.operationId, command.operationId);
    } else {
      assert.equal(f.memory.get(f.client.storageKey), pendingRaw); assert.ok(f.client.getSnapshot().pending);
      assert.equal(f.client.getSnapshot().result?.receipt, null);
    }
    assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  }
});
