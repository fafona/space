import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceCalendarClient, type CalendarClientOptions } from "./merchantAttendanceCalendarClient";
import { parseCalendarBody, parseCalendarHttpQuery, type CalendarCommand, type CalendarDetail, type CalendarQuery,
  type CalendarResult, type CalendarSummary } from "./merchantAttendanceCalendar";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(99), locationId = id(201);
const input = { kind: "holiday" as const, title: "Local holiday", reason: "Manual calendar notice", fromDate: "2026-10-05", throughDate: "2026-10-06" };
const summary = (row: CalendarSummary): CalendarSummary => ({ entryId: row.entryId, locationId: row.locationId, locationName: row.locationName,
  timeZone: row.timeZone, kind: row.kind, title: row.title, fromDate: row.fromDate, throughDate: row.throughDate,
  createdAt: row.createdAt, revision: row.revision, status: row.status });
type Receipt = NonNullable<CalendarResult["receipt"]>;
function setup() {
  const memory = new Map<string, string>(), rows = new Map<string, CalendarDetail>(), receipts = new Map<string, Receipt>();
  const calls: { url: string; method: string; body: string | null; signal: AbortSignal | null | undefined }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); } };
  const settings = { version: 1, timeZone: "Europe/Madrid" };
  const locations = new Map([[locationId, { version: 2, name: "Original location", timeZone: "Europe/Madrid", enabled: true }],
    [id(202), { version: 3, name: "Other location", timeZone: "UTC", enabled: true }]]);
  let serial = 501, writes = 0, enabled = true, mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const seed = (n = 501, target: string | null = null): CalendarDetail => {
    serial = Math.max(serial, n + 1); const location = target ? locations.get(target)! : null;
    const row: CalendarDetail = { entryId: id(n), locationId: target, locationName: location?.name ?? null,
      timeZone: location?.timeZone ?? settings.timeZone, kind: input.kind, title: input.title, fromDate: input.fromDate,
      throughDate: input.throughDate, createdAt: "2026-10-03T09:00:00.123456Z", revision: 1, status: "created",
      reason: input.reason, cancelReason: null, cancelledAt: null, canCancel: true };
    rows.set(row.entryId, row); return row;
  };
  const reply = (query: CalendarQuery, receipt: Receipt | null = null) => {
    const found = receipt ?? (query.operationId ? receipts.get(query.operationId) ?? null : null);
    const entryId = found?.item.entryId ?? query.entryId, detail = entryId ? rows.get(entryId) ?? null : null;
    const visible = query.fromDate === null ? [] : [...rows.values()].filter(row => row.locationId === query.locationId
      && row.throughDate >= query.fromDate! && row.fromDate <= query.throughDate!
      && (!query.beforeAt || row.createdAt < query.beforeAt || row.createdAt === query.beforeAt && row.entryId < query.beforeId!))
      .sort((a, b) => a.createdAt === b.createdAt ? a.entryId < b.entryId ? 1 : -1 : a.createdAt < b.createdAt ? 1 : -1);
    const items = visible.slice(0, 25).map(summary), location = query.locationId ? locations.get(query.locationId)! : null;
    return Response.json({ ok: true, moduleEnabled: enabled, protocol: "calendar-v1", siteId, actorId: ownerId,
      settingsVersion: settings.version, locationId: query.locationId, locationName: location?.name ?? null,
      locationVersion: location?.version ?? null, timeZone: location?.timeZone ?? settings.timeZone, canCreate: location?.enabled ?? true,
      items, nextCursor: visible.length > 25 ? { at: items[24].createdAt, id: items[24].entryId } : null, detail, receipt: found });
  };
  const commit = (query: CalendarQuery, command: CalendarCommand) => {
    let receipt = receipts.get(command.operationId);
    if (!receipt) {
      let row: CalendarDetail;
      if (command.action === "create") {
        row = seed(Number(command.operationId.slice(-12)), command.locationId);
        Object.assign(row, { title: command.title, reason: command.reason, kind: command.kind, fromDate: command.fromDate,
          throughDate: command.throughDate, timeZone: command.timeZone });
      } else {
        row = rows.get(command.entryId)!; assert.ok(row); assert.equal(row.locationId, query.locationId); assert.equal(row.revision, 1);
        Object.assign(row, { revision: 2, status: "cancelled", canCancel: false, cancelReason: command.reason, cancelledAt: "2026-10-03T10:00:00.000001Z" });
      }
      receipt = { command: structuredClone(command), item: summary(row) }; receipts.set(command.operationId, receipt); writes++;
    }
    return reply(query, receipt);
  };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null;
    calls.push({ url, method, body, signal: init?.signal }); assert.equal(init?.cache, "no-store");
    if (transport) return transport(url, init);
    if (method === "GET") return reply(parseCalendarHttpQuery(new URL(url, "https://fixture.invalid").href));
    const parsed = parseCalendarBody(JSON.parse(body!)), stored = JSON.parse(memory.get(`faolla:attendance:calendar:v1:${siteId}:${ownerId}`)!);
    assert.deepEqual(stored.query, parsed.query); assert.deepEqual(stored.command, parsed.command); assert.equal(stored.ownerId, ownerId);
    if (mode === "unsent") throw Error("not delivered"); const response = commit(parsed.query, parsed.command);
    if (mode === "lost") throw Error("committed response lost"); return response;
  };
  const create = (patch: Partial<CalendarClientOptions> = {}) => new AttendanceCalendarClient({ siteId, ownerId, apiFetch,
    storage: () => storage, randomId: () => id(serial++), timeoutMs: 1000, ...patch });
  return { client: create(), create, memory, storage, calls, settings, locations, rows, receipts, seed, reply, commit, writes: () => writes,
    mode: (value: typeof mode) => { mode = value; }, enabled: (value: boolean) => { enabled = value; },
    transport: (value: typeof transport) => { transport = value; } };
}

test("calendar construction is inert, explicit contexts and lists only read, and unrelated schedule pending state is untouched", async () => {
  const f = setup(), scheduleKey = `faolla:attendance:schedule:v1:${siteId}:${ownerId}`;
  f.memory.set(scheduleKey, "original schedule intent"); let changes = 0; const off = f.client.subscribe(() => { changes++; });
  await f.client.create(input); await f.client.next(); await f.client.cancel("No selected entry"); assert.equal(f.calls.length, 0);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().result?.locationId, null);
  await f.client.context(locationId); await f.client.load({ fromDate: "2026-10-01", throughDate: "2026-10-31" });
  assert.deepEqual(f.calls.map(c => c.method), ["GET", "GET", "GET"]); assert.equal(f.writes(), 0);
  assert.equal(f.client.getSnapshot().result?.locationId, locationId);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result?.locationId, null);
  const reinitialized = new URL(f.calls.at(-1)!.url, "https://fixture.invalid");
  assert.equal(reinitialized.searchParams.has("locationId"), false); assert.equal(reinitialized.searchParams.has("fromDate"), false);
  assert.equal(f.memory.get(scheduleKey), "original schedule intent"); assert.notEqual(f.client.storageKey, scheduleKey); assert.ok(changes > 0);
  off(); const n = changes; f.client.pause(); assert.equal(changes, n);
});

test("enterprise and one-location creation bind fresh settings/location versions; cancellation is a separate original operation", async () => {
  const f = setup(); await f.client.initialize(); await f.client.create(input);
  assert.equal(f.client.getSnapshot().result?.detail?.locationId, null);
  await f.client.context(locationId); await f.client.create({ ...input, kind: "closure" });
  assert.equal(f.client.getSnapshot().result?.detail?.locationId, locationId); await f.client.cancel("No longer needed");
  assert.equal(f.client.getSnapshot().result?.detail?.status, "cancelled"); assert.equal(f.client.getSnapshot().result?.detail?.revision, 2);
  const commands = f.calls.filter(c => c.method === "POST").map(c => JSON.parse(c.body!).command);
  assert.deepEqual(commands.map(c => c.action), ["create", "create", "cancel"]);
  assert.deepEqual(commands.map(c => c.operationId), [id(501), id(502), id(503)]);
  assert.equal(commands[0].locationId, null); assert.equal(commands[0].expectedLocationVersion, null);
  assert.equal(commands[1].locationId, locationId); assert.equal(commands[1].expectedLocationVersion, 2); assert.equal(commands[1].expectedSettingsVersion, 1);
  assert.equal(commands[2].entryId, id(502)); assert.equal(commands[2].expectedRevision, 1);
  assert.ok(f.calls.every(c => c.url.startsWith("/api/merchant-enterprise/attendance/calendar"))); assert.equal(f.writes(), 3); assert.equal(f.memory.size, 0);
});

test("lost creation recovers by GET in its original scope with the old receipt despite newer timezone/name/version and cancellation", async () => {
  const f = setup(); await f.client.context(locationId); f.mode("lost"); await f.client.create(input);
  const raw = f.memory.get(f.client.storageKey)!; assert.equal(JSON.parse(raw).query.locationId, locationId);
  Object.assign(f.locations.get(locationId)!, { timeZone: "America/New_York", version: 3, name: "Renamed location" }); f.settings.version = 2;
  Object.assign(f.rows.get(id(501))!, { revision: 2, status: "cancelled", canCancel: false, cancelReason: "Later decision", cancelledAt: "2026-10-03T10:00:00.000001Z" });
  const n = f.calls.length, restored = f.create(); await restored.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  const url = new URL(f.calls[n].url, "https://fixture.invalid"); assert.equal(url.searchParams.get("operationId"), id(501)); assert.equal(url.searchParams.get("locationId"), locationId);
  const value = restored.getSnapshot().result!; assert.equal(value.receipt?.item.revision, 1); assert.equal(value.detail?.revision, 2);
  assert.equal(value.detail?.timeZone, "Europe/Madrid"); assert.equal(value.detail?.locationName, "Original location"); assert.equal(value.timeZone, "America/New_York");
  assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
});

test("lost cancellation recovers by GET while platform-paused without a second cancellation or changed entry", async () => {
  const f = setup(); f.seed(); await f.client.initialize(); await f.client.detail(id(501)); f.mode("lost"); await f.client.cancel("Correction");
  assert.equal(f.client.getSnapshot().pending?.command.action, "cancel"); f.enabled(false); const n = f.calls.length; await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.client.getSnapshot().result?.detail?.cancelReason, "Correction");
  assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.writes(), 1);
});

test("explicit retry checks the original scope receipt before the byte-identical POST and forbids a replacement scope or intent", async () => {
  const f = setup(); await f.client.context(locationId); f.mode("unsent"); await f.client.create(input);
  const raw = f.memory.get(f.client.storageKey), body = f.calls.at(-1)!.body, n = f.calls.length;
  await f.client.context(null); await f.client.context(id(202)); await f.client.load(input); await f.client.detail(id(900));
  await f.client.next(); await f.client.create({ ...input, title: "Replacement" }); await f.client.cancel("Replacement");
  assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  f.mode("normal"); await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET", "POST"]);
  assert.equal(f.calls.at(-1)!.body, body); assert.equal(f.writes(), 1); assert.equal(f.client.getSnapshot().pending, null);
});

test("owner, tenant, top scope and historical entry substitutions cannot confirm an unresolved original write", async () => {
  for (const variant of ["owner", "site", "scope", "entry-scope", "receipt", "html", "oversized"] as const) {
    const f = setup(); await f.client.context(locationId); f.mode("lost"); await f.client.create(input); const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async url => {
      if (variant === "html") return new Response("login", { headers: { "content-type": "text/html" } });
      const value = await (await f.reply(parseCalendarHttpQuery(new URL(url, "https://fixture.invalid").href))).json();
      if (variant === "owner") value.actorId = id(98); if (variant === "site") value.siteId = "99990002";
      if (variant === "scope") value.locationId = id(202); if (variant === "entry-scope") value.detail.locationId = id(202);
      if (variant === "receipt") value.receipt.command.reason = "Different original intent"; if (variant === "oversized") value.extra = "x".repeat(131073);
      return Response.json(value);
    });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    assert.equal(f.memory.get(f.client.storageKey), raw); assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("only exact correctly-statused definite POST refusals clear the same pending; malformed errors and GET refusals do not", async () => {
  for (const [body, status, clears] of [[{ ok: false, error: "attendance_version_conflict" }, 409, true],
    [{ ok: false, error: "attendance_calendar_location_inactive" }, 409, true], [{ ok: true, error: "attendance_version_conflict" }, 409, false],
    [{ error: "attendance_version_conflict" }, 409, false], [{ ok: false, error: "attendance_version_conflict", extra: true }, 409, false],
    [{ ok: false, error: "attendance_version_conflict" }, 503, false], [{ ok: false, error: 409 }, 409, false],
    [{ ok: false, error: "attendance_operation_conflict" }, 409, false], [{ ok: false, error: "attendance_access_denied" }, 403, false]] as [unknown, number, boolean][]) {
    const f = setup(); await f.client.initialize(); f.transport(async () => Response.json(body, { status })); await f.client.create(input);
    assert.equal(f.client.getSnapshot().pending === null, clears); assert.equal(f.memory.has(f.client.storageKey), !clears); assert.equal(f.client.getSnapshot().result, null);
  }
  for (const body of ["{invalid", JSON.stringify({ ok: false, error: "x".repeat(4096) })]) {
    const f = setup(); await f.client.initialize(); f.transport(async () => new Response(body, { status: 409, headers: { "content-type": "application/json" } }));
    await f.client.create(input); assert.ok(f.client.getSnapshot().pending); assert.ok(f.memory.get(f.client.storageKey));
  }
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.create(input); const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
  f.transport(async () => Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 })); await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("damaged or foreign storage and cross-tab replacements remain untouched and cannot send a POST", async () => {
  const original = setup(); await original.client.context(locationId); original.mode("unsent"); await original.client.create(input);
  const valid = JSON.parse(original.memory.get(original.client.storageKey)!);
  for (const raw of ["{invalid", "x".repeat(8193), JSON.stringify({ ...valid, ownerId: id(98) }),
    JSON.stringify({ ...valid, query: { ...valid.query, locationId: id(202) } }), JSON.stringify({ ...valid, siteId: "99990002" })]) {
    const f = setup(); f.memory.set(f.client.storageKey, raw); await f.client.initialize();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0); assert.equal(f.memory.get(f.client.storageKey), raw);
  }
  const changed = JSON.stringify({ ...valid, command: { ...valid.command, operationId: id(888) } });
  original.memory.set(original.client.storageKey, changed); const n = original.calls.length; await original.client.retry();
  assert.equal(original.calls.length, n); assert.equal(original.memory.get(original.client.storageKey), changed);
  const f = setup(), client = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("storage disabled"); } }) });
  await client.initialize(); await client.create(input); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});

test("platform pause blocks creation, cancellation and uncommitted retries while inactive locations preserve readable historical entries", async () => {
  const f = setup(); f.seed(501, locationId); f.locations.get(locationId)!.enabled = false; await f.client.context(locationId); await f.client.create(input);
  await f.client.detail(id(501)); assert.equal(f.client.getSnapshot().result?.detail?.entryId, id(501)); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  f.enabled(false); await f.client.initialize(); await f.client.cancel("Paused"); await f.client.context(null); await f.client.create(input);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
  f.enabled(true); await f.client.initialize(); f.mode("unsent"); await f.client.create(input); const raw = f.memory.get(f.client.storageKey);
  f.enabled(false); const n = f.calls.length; await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  assert.equal(f.memory.get(f.client.storageKey), raw); assert.ok(f.client.getSnapshot().pending);
});

test("25-row pagination never merges enterprise and location records and each detail uses an empty-list envelope", async () => {
  const f = setup(); for (let n = 501; n <= 530; n++) f.seed(n, locationId); f.seed(600, null); f.seed(601, id(202));
  await f.client.context(locationId); await f.client.load({ fromDate: "2026-10-01", throughDate: "2026-10-31" });
  assert.equal(f.client.getSnapshot().result?.items.length, 25); assert.ok(f.client.getSnapshot().result?.items.every(row => row.locationId === locationId));
  await f.client.next(); assert.equal(f.client.getSnapshot().result?.items.length, 5); const n = f.calls.length; await f.client.next(); assert.equal(f.calls.length, n);
  assert.equal(new URL(f.calls[2].url, "https://fixture.invalid").searchParams.get("beforeId"), id(506));
  await f.client.detail(id(510)); assert.deepEqual(f.client.getSnapshot().result?.items, []); assert.equal(f.client.getSnapshot().result?.nextCursor, null);
  await f.client.context(null); await f.client.load(input); assert.deepEqual(f.client.getSnapshot().result?.items.map(row => row.entryId), [id(600)]);
});

test("fresh access revocation clears previously visible details and cannot leave owner controls active", async () => {
  const f = setup(); f.seed(); await f.client.initialize(); await f.client.detail(id(501)); assert.ok(f.client.getSnapshot().result?.detail);
  f.transport(async () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }));
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
  const n = f.calls.length; await f.client.create(input); await f.client.cancel("Denied"); assert.equal(f.calls.length, n);
});

test("hidden reads are inert and paused late GET successes or denials cannot overwrite a fresh explicitly selected scope", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const hidden = setup(); await hidden.client.initialize(); await hidden.client.context(locationId); await hidden.client.load(input); assert.equal(hidden.calls.length, 0); doc.hidden = false;
  for (const denial of [false, true]) {
    const f = setup(); let release!: (response: Response) => void; f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const reading = f.client.initialize(); await f.client.initialize(); assert.equal(f.calls.length, 1); f.client.pause(); assert.equal(f.calls[0].signal?.aborted, true);
    f.transport(null); await f.client.context(locationId); const fresh = f.client.getSnapshot();
    release(denial ? Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 })
      : f.reply(parseCalendarHttpQuery(new URL(f.calls[0].url, "https://fixture.invalid").href)));
    await reading; assert.equal(f.client.getSnapshot(), fresh); assert.equal(f.client.getSnapshot().result?.locationId, locationId);
  }
});

test("paused held POST success and definite conflict leave pending untouched, then initialize only looks up the original receipt", async () => {
  for (const committed of [true, false]) {
    const f = setup(); await f.client.context(locationId); let release!: (response: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const writing = f.client.create(input), raw = f.memory.get(f.client.storageKey); assert.ok(raw);
    const { query, command } = parseCalendarBody(JSON.parse(f.calls.at(-1)!.body!));
    const response = committed ? f.commit(query, command) : Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 });
    f.client.pause(); const paused = f.client.getSnapshot(); release(response); await writing;
    assert.equal(f.client.getSnapshot(), paused); assert.equal(paused.result, null); assert.ok(paused.pending); assert.equal(f.memory.get(f.client.storageKey), raw);
    f.transport(null); const n = f.calls.length; await f.client.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    const url = new URL(f.calls[n].url, "https://fixture.invalid"); assert.equal(url.searchParams.get("operationId"), command.operationId); assert.equal(url.searchParams.get("locationId"), locationId);
    assert.equal(f.client.getSnapshot().pending === null, committed); assert.equal(f.memory.has(f.client.storageKey), !committed);
    assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  }
});

test("slow error body cancellation observes the deadline and preserves the exact stored command", async () => {
  const f = setup(), client = f.create({ timeoutMs: 25 }); await client.initialize(); let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":')); }, cancel() { cancelled++; } });
  f.transport(async () => new Response(stream, { status: 409, headers: { "content-type": "application/json" } }));
  await client.create(input); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(f.calls.at(-1)?.signal?.aborted, true);
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.ok(client.getSnapshot().pending); assert.ok(f.memory.get(client.storageKey));
});
