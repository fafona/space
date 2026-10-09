import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceGroupsClient, type GroupsClientOptions } from "./merchantAttendanceGroupsClient";
import { parseGroupsBody, parseGroupsHttpQuery, sameGroupsCommand, type GroupsQuery, type GroupsCommand, type GroupsResult,
  type GroupItem, type GroupWorker, type GroupAssignmentItem, type GroupAssignmentDetail } from "./merchantAttendanceGroups";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", ownerId = id(99), groupId = id(501), workerId = id(201), at = "2026-10-03T09:00:00.123456Z";
const input = { name: "Morning team", description: "", active: true, reason: "Create group" };
const assignment = { startsOn: "2026-10-01", endsOn: null, reason: "Join group" };
const summary = (r: GroupAssignmentItem): GroupAssignmentItem => ({ assignmentId: r.assignmentId, groupId: r.groupId, groupName: r.groupName,
  workerId: r.workerId, workerName: r.workerName, workerNo: r.workerNo, employeeId: r.employeeId, timeZone: r.timeZone,
  startsOn: r.startsOn, endsOn: r.endsOn, createdAt: r.createdAt, updatedAt: r.updatedAt, revision: r.revision, status: r.status });
type Receipt = NonNullable<GroupsResult["receipt"]>;
function setup() {
  const memory = new Map<string, string>(), groups = new Map<string, GroupItem>(), assignments = new Map<string, GroupAssignmentDetail>(), receipts = new Map<string, Receipt>();
  const workers = new Map<string, GroupWorker>([201, 202].map(n => [id(n), { workerId: id(n), workerName: `Worker ${n}`, workerNo: `W-${n}`, employeeId: id(n - 100), version: 3, active: true }]));
  const settings = { version: 1, timeZone: "Europe/Madrid" }, calls: { url: string; method: string; body: string | null; signal: AbortSignal | null | undefined }[] = [];
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  let serial = 1001, writes = 0, enabled = true, mode: "normal" | "lost" | "unsent" = "normal";
  let transport: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  const seedGroup = (n = 501): GroupItem => { const row = { groupId: id(n), revision: 1, name: `Group ${n}`, description: "", active: true, createdAt: at, updatedAt: at }; groups.set(row.groupId, row); return row; };
  const seedAssignment = (n = 601, g = groupId, w = workerId, endsOn: string | null = null): GroupAssignmentDetail => {
    const group = groups.get(g)!, worker = workers.get(w)!;
    const command: GroupsCommand = { operationId: id(n), action: "assign", reason: assignment.reason, groupId: g, workerId: w,
      expectedGroupRevision: group.revision, expectedWorkerVersion: worker.version, expectedSettingsVersion: settings.version,
      timeZone: settings.timeZone, startsOn: assignment.startsOn, endsOn };
    const item: GroupAssignmentItem = { assignmentId: id(n), groupId: g, groupName: group.name, workerId: w,
      workerName: worker.workerName, workerNo: worker.workerNo, employeeId: worker.employeeId, timeZone: settings.timeZone,
      startsOn: assignment.startsOn, endsOn, createdAt: at, updatedAt: at, revision: 1, status: "assigned" };
    const row: GroupAssignmentDetail = { ...item, history: [{ command, item: structuredClone(item) }], canEnd: endsOn === null, canCancel: true };
    assignments.set(row.assignmentId, row); return row;
  };
  const reply = (q: GroupsQuery, receipt: Receipt | null = null) => {
    const found = receipt ?? (q.operationId ? receipts.get(q.operationId) ?? null : null);
    const selectedGroup = q.groupId ?? (found?.command.action === "save_group" && found.command.expectedRevision === 0 ? found.command.groupId : null);
    const assignmentId = q.assignmentId ?? (found && "assignmentId" in found.item ? found.item.assignmentId : null);
    const visible: (GroupItem | GroupAssignmentItem)[] = q.view === "groups" ? [...groups.values()] : q.view === "members" ? [...assignments.values()]
      .filter(r => (!q.groupId || r.groupId === q.groupId) && (!q.workerId || r.workerId === q.workerId)
        && (!q.onDate || r.startsOn <= q.onDate && (r.endsOn === null || r.endsOn >= q.onDate))).map(summary) : [];
    const key = (r: GroupItem | GroupAssignmentItem) => "assignmentId" in r ? r.assignmentId : r.groupId;
    const sorted = visible.filter(r => !q.cursorId || key(r) < q.cursorId).sort((a, b) => key(a) < key(b) ? 1 : -1), items = sorted.slice(0, 25);
    return Response.json({ ok: true, moduleEnabled: enabled, protocol: "groups-v1", siteId, actorId: ownerId, settingsVersion: settings.version,
      timeZone: settings.timeZone, view: q.view, group: selectedGroup ? groups.get(selectedGroup) ?? null : null,
      worker: q.workerId ? workers.get(q.workerId) ?? null : null, items, nextCursor: sorted.length > 25 ? key(items[24]) : null,
      detail: assignmentId ? assignments.get(assignmentId) ?? null : null, receipt: found });
  };
  const commit = (q: GroupsQuery, c: GroupsCommand): Response => {
    const old = receipts.get(c.operationId);
    if (old) return sameGroupsCommand(old.command, c) ? reply(q, old) : Response.json({ ok: false, error: "attendance_operation_conflict" }, { status: 409 });
    const now = `2026-10-03T10:00:00.${String(writes + 1).padStart(6, "0")}Z`; let item: GroupItem | GroupAssignmentItem;
    if (c.action === "save_group") {
      const current = groups.get(c.groupId); assert.equal(current?.revision ?? 0, c.expectedRevision);
      item = { groupId: c.groupId, revision: c.expectedRevision + 1, name: c.name, description: c.description, active: c.active, createdAt: current?.createdAt ?? now, updatedAt: now };
      groups.set(item.groupId, item);
    } else if (c.action === "assign") {
      const g = groups.get(c.groupId)!, w = workers.get(c.workerId)!;
      item = { assignmentId: c.operationId, groupId: c.groupId, groupName: g.name, workerId: c.workerId, workerName: w.workerName, workerNo: w.workerNo,
        employeeId: w.employeeId, timeZone: c.timeZone, startsOn: c.startsOn, endsOn: c.endsOn, createdAt: now, updatedAt: now, revision: 1, status: "assigned" };
      assignments.set(item.assignmentId, { ...item, history: [{ command: c, item: structuredClone(item) }], canEnd: c.endsOn === null, canCancel: true });
    } else {
      const current = assignments.get(c.assignmentId)!; assert.ok(current); assert.equal(current.revision, c.expectedRevision);
      item = { ...summary(current), revision: (current.revision + 1) as 2 | 3, status: c.action === "end" ? "ended" : "cancelled",
        updatedAt: now, endsOn: c.action === "end" ? c.endsOn : current.endsOn };
      assignments.set(item.assignmentId, { ...item, history: [...current.history, { command: c, item: structuredClone(item) }], canEnd: false, canCancel: c.action === "end" });
    }
    const receipt = { command: structuredClone(c), item: structuredClone(item) }; receipts.set(c.operationId, receipt); writes++; return reply(q, receipt);
  };
  const apiFetch = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET", body = init?.body ? String(init.body) : null; calls.push({ url, method, body, signal: init?.signal }); assert.equal(init?.cache, "no-store");
    if (transport) return transport(url, init); if (method === "GET") return reply(parseGroupsHttpQuery(new URL(url, "https://fixture.invalid").href));
    const { query, command } = parseGroupsBody(JSON.parse(body!)), pending = JSON.parse(memory.get(`faolla:attendance:groups:v1:${siteId}:${ownerId}`)!);
    assert.deepEqual(pending.query, query); assert.deepEqual(pending.command, command); assert.equal(pending.ownerId, ownerId);
    if (mode === "unsent") throw Error("not delivered"); const response = commit(query, command);
    if (mode === "lost") throw Error("committed response lost"); return response;
  };
  const create = (patch: Partial<GroupsClientOptions> = {}) => new AttendanceGroupsClient({ siteId, ownerId, apiFetch, storage: () => storage,
    randomId: () => id(serial++), timeoutMs: 1000, ...patch });
  return { client: create(), create, calls, memory, storage, groups, workers, settings, assignments, receipts, seedGroup, seedAssignment, reply, commit,
    writes: () => writes, mode: (value: typeof mode) => { mode = value; }, enabled: (value: boolean) => { enabled = value; }, transport: (value: typeof transport) => { transport = value; } };
}

test("groups construction is inert, explicit reads do not write, and initialize resets to groups unless recovering pending", async () => {
  const f = setup(), unrelated = `faolla:attendance:schedule:v1:${siteId}:${ownerId}`; f.memory.set(unrelated, "schedule pending"); f.seedGroup();
  let changes = 0; const off = f.client.subscribe(() => { changes++; }); await f.client.saveGroup(input); await f.client.assign(assignment); await f.client.next(); assert.equal(f.calls.length, 0);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result?.view, "groups"); await f.client.context(groupId, workerId);
  assert.equal(f.client.getSnapshot().result?.worker?.workerId, workerId); await f.client.initialize(); assert.equal(f.client.getSnapshot().result?.view, "groups");
  assert.equal(f.client.getSnapshot().result?.worker, null); assert.deepEqual(f.calls.map(c => c.method), ["GET", "GET", "GET"]);
  assert.equal(f.memory.get(unrelated), "schedule pending"); assert.notEqual(f.client.storageKey, unrelated); assert.ok(changes > 0); off(); const n = changes; f.client.pause(); assert.equal(changes, n);
});

test("save/update/assign/end/cancel persist exact independent operations and keep ending distinct from whole-interval cancellation", async () => {
  const f = setup(); await f.client.initialize(); await f.client.saveGroup(input); const createdId = id(1001);
  await f.client.saveGroup({ ...input, name: "Renamed", reason: "Rename group" }); await f.client.context(createdId, workerId); await f.client.assign(assignment);
  assert.equal(f.client.getSnapshot().result?.detail?.endsOn, null); await f.client.end("2026-10-31", "End long-term assignment");
  assert.equal(f.client.getSnapshot().result?.detail?.status, "ended"); await f.client.cancel("Void whole interval");
  const detail = f.client.getSnapshot().result?.detail; assert.equal(detail?.status, "cancelled"); assert.equal(detail?.endsOn, "2026-10-31"); assert.equal(detail?.history.length, 3);
  const commands = f.calls.filter(c => c.method === "POST").map(c => JSON.parse(c.body!).command);
  assert.deepEqual(commands.map(c => c.action), ["save_group", "save_group", "assign", "end", "cancel"]);
  assert.deepEqual(commands.map(c => c.operationId), [1001, 1002, 1003, 1004, 1005].map(id));
  assert.equal(commands[1].expectedRevision, 1); assert.equal(commands[2].expectedGroupRevision, 2); assert.equal(commands[2].expectedWorkerVersion, 3);
  assert.equal(commands[2].expectedSettingsVersion, 1); assert.equal(commands[3].expectedRevision, 1); assert.equal(commands[4].expectedRevision, 2);
  assert.ok(f.calls.every(c => c.url.startsWith("/api/merchant-enterprise/attendance/groups"))); assert.equal(f.writes(), 5); assert.equal(f.memory.size, 0);
});

test("lost group creation GET-recovers its original snapshot although current group was renamed and deactivated", async () => {
  const f = setup(); await f.client.initialize(); f.mode("lost"); await f.client.saveGroup(input); const original = f.memory.get(f.client.storageKey)!;
  const current = f.groups.get(id(1001))!; Object.assign(current, { revision: 2, name: "Later name", active: false, updatedAt: "2026-10-03T11:00:00.000001Z" });
  const n = f.calls.length, restored = f.create(); await restored.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
  const value = restored.getSnapshot().result!; assert.equal(value.group?.name, "Later name"); assert.equal(value.receipt?.item.revision, 1);
  assert.equal(JSON.parse(original).query.groupId, null); assert.equal(new URL(f.calls[n].url, "https://fixture.invalid").searchParams.get("operationId"), id(1001));
  assert.equal(restored.getSnapshot().pending, null); assert.equal(f.memory.size, 0); assert.equal(f.writes(), 1);
});

test("lost assign/end/cancel responses recover by GET and historical identity/timezone snapshots survive changed current context", async () => {
  for (const action of ["assign", "end", "cancel"] as const) {
    const f = setup(); f.seedGroup(); await f.client.context(groupId, workerId);
    if (action !== "assign") { f.seedAssignment(); await f.client.detail(id(601)); }
    f.mode("lost"); if (action === "assign") await f.client.assign(assignment); else if (action === "end") await f.client.end("2026-10-31", "End"); else await f.client.cancel("Cancel");
    Object.assign(f.groups.get(groupId)!, { name: "New group name", revision: 2 }); Object.assign(f.workers.get(workerId)!, { workerName: "New worker", workerNo: "NEW", version: 4 });
    f.settings.timeZone = "UTC"; f.settings.version = 2; f.enabled(false); const raw = f.memory.get(f.client.storageKey)!, n = f.calls.length;
    const restored = f.create(); await restored.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    const value = restored.getSnapshot().result!; assert.equal(value.detail?.groupName, "Group 501"); assert.equal(value.detail?.workerName, "Worker 201");
    assert.equal(value.detail?.timeZone, "Europe/Madrid"); assert.equal(value.timeZone, "UTC"); assert.equal(value.receipt?.command.action, action);
    assert.equal(new URL(f.calls[n].url, "https://fixture.invalid").searchParams.get("operationId"), JSON.parse(raw).command.operationId);
    assert.equal(restored.getSnapshot().pending, null); assert.equal(f.writes(), 1);
  }
});

test("explicit retry uses original group/worker query and identical POST only after a receipt GET, never a replacement action", async () => {
  const f = setup(); f.seedGroup(); await f.client.context(groupId, workerId); f.mode("unsent"); await f.client.assign(assignment);
  const raw = f.memory.get(f.client.storageKey), body = f.calls.at(-1)!.body, n = f.calls.length;
  await f.client.groups(); await f.client.context(id(502), id(202)); await f.client.members({ groupId, workerId: null, onDate: null }); await f.client.detail(id(601));
  await f.client.saveGroup(input); await f.client.assign({ ...assignment, reason: "Replacement" }); await f.client.next(); assert.equal(f.calls.length, n); assert.equal(f.memory.get(f.client.storageKey), raw);
  f.mode("normal"); await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET", "POST"]); assert.equal(f.calls.at(-1)!.body, body);
  assert.equal(f.writes(), 1); assert.equal(f.client.getSnapshot().pending, null);
});

test("operation conflict across action kinds stays pending and cannot be mistaken for an acknowledged new assignment", async () => {
  const f = setup(); await f.client.initialize(); await f.client.saveGroup(input);
  const other = f.create({ randomId: () => id(1001) }); await other.context(id(1001), workerId); await other.assign(assignment);
  assert.equal(other.getSnapshot().phase, "unconfirmed"); assert.equal(other.getSnapshot().pending?.command.action, "assign");
  assert.ok(f.memory.get(other.storageKey)); assert.equal(other.getSnapshot().result, null); assert.equal(f.assignments.size, 0); assert.equal(f.writes(), 1);
});

test("foreign actor/site/scope and malformed assignment receipts/history cannot confirm an unresolved operation", async () => {
  for (const variant of ["actor", "site", "scope", "history", "receipt", "html", "oversized"] as const) {
    const f = setup(); f.seedGroup(); await f.client.context(groupId, workerId); f.mode("lost"); await f.client.assign(assignment);
    const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
    f.transport(async url => {
      if (variant === "html") return new Response("login", { headers: { "content-type": "text/html" } });
      const value = await (await f.reply(parseGroupsHttpQuery(new URL(url, "https://fixture.invalid").href))).json();
      if (variant === "actor") value.actorId = id(98); if (variant === "site") value.siteId = "99990002";
      if (variant === "scope") value.worker.workerId = id(202); if (variant === "history") value.detail.history[0].item.workerName = "Substituted";
      if (variant === "receipt") value.receipt.command.reason = "Different original intent"; if (variant === "oversized") value.extra = "x".repeat(131073);
      return Response.json(value);
    });
    await f.client.retry(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
    assert.ok(f.client.getSnapshot().pending); assert.equal(f.client.getSnapshot().result, null);
  }
});

test("only exact definite correctly-statused POST refusals clear the same pending, unlike unknown/malformed responses and GET errors", async () => {
  for (const [body, status, clears] of [[{ ok: false, error: "attendance_version_conflict" }, 409, true], [{ ok: false, error: "attendance_group_overlap" }, 409, true],
    [{ ok: false, error: "attendance_group_closed" }, 409, true], [{ ok: true, error: "attendance_version_conflict" }, 409, false],
    [{ error: "attendance_version_conflict" }, 409, false], [{ ok: false, error: "attendance_version_conflict", extra: true }, 409, false],
    [{ ok: false, error: "attendance_version_conflict" }, 503, false], [{ ok: false, error: 409 }, 409, false],
    [{ ok: false, error: "attendance_operation_conflict" }, 409, false], [{ ok: false, error: "attendance_access_denied" }, 403, false]] as [unknown, number, boolean][]) {
    const f = setup(); await f.client.initialize(); f.transport(async () => Response.json(body, { status })); await f.client.saveGroup(input);
    assert.equal(f.client.getSnapshot().pending === null, clears); assert.equal(f.memory.has(f.client.storageKey), !clears); assert.equal(f.client.getSnapshot().result, null);
  }
  for (const body of ["{invalid", JSON.stringify({ ok: false, error: "x".repeat(4096) })]) {
    const f = setup(); await f.client.initialize(); f.transport(async () => new Response(body, { status: 409, headers: { "content-type": "application/json" } }));
    await f.client.saveGroup(input); assert.ok(f.client.getSnapshot().pending); assert.ok(f.memory.get(f.client.storageKey));
  }
  const f = setup(); await f.client.initialize(); f.mode("unsent"); await f.client.saveGroup(input); const raw = f.memory.get(f.client.storageKey), n = f.calls.length;
  f.transport(async () => Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 })); await f.client.retry();
  assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(f.memory.get(f.client.storageKey), raw);
});

test("malformed or foreign pending and cross-tab replacements survive unchanged; storage failure prevents the initial POST", async () => {
  const original = setup(); original.seedGroup(); await original.client.context(groupId, workerId); original.mode("unsent"); await original.client.assign(assignment);
  const valid = JSON.parse(original.memory.get(original.client.storageKey)!);
  for (const raw of ["{invalid", "x".repeat(8193), JSON.stringify({ ...valid, ownerId: id(98) }), JSON.stringify({ ...valid, siteId: "99990002" }),
    JSON.stringify({ ...valid, query: { ...valid.query, groupId: id(502) } })]) {
    const f = setup(); f.memory.set(f.client.storageKey, raw); await f.client.initialize();
    assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0); assert.equal(f.memory.get(f.client.storageKey), raw);
  }
  const changed = JSON.stringify({ ...valid, command: { ...valid.command, operationId: id(999) } }); original.memory.set(original.client.storageKey, changed);
  const n = original.calls.length; await original.client.retry(); assert.equal(original.calls.length, n); assert.equal(original.memory.get(original.client.storageKey), changed);
  const f = setup(), client = f.create({ storage: () => ({ ...f.storage, setItem: () => { throw Error("storage disabled"); } }) });
  await client.initialize(); await client.saveGroup(input); assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});

test("inactive group/worker blocks new assignments but not historical end/cancel; platform pause blocks every fresh write and retry POST", async () => {
  const f = setup(); f.seedGroup(); f.seedAssignment(); f.groups.get(groupId)!.active = false; f.workers.get(workerId)!.active = false;
  await f.client.context(groupId, workerId); await f.client.assign(assignment); assert.equal(f.writes(), 0); await f.client.detail(id(601));
  await f.client.end("2026-10-31", "Historical end"); await f.client.cancel("Historical correction"); assert.equal(f.writes(), 2);
  const paused = setup(); paused.seedGroup(); paused.seedAssignment(); paused.enabled(false); await paused.client.context(groupId, workerId);
  await paused.client.assign(assignment); await paused.client.saveGroup(input); await paused.client.detail(id(601)); await paused.client.end("2026-10-31", "Paused"); await paused.client.cancel("Paused");
  assert.equal(paused.calls.filter(c => c.method === "POST").length, 0);
  paused.enabled(true); await paused.client.initialize(); paused.mode("unsent"); await paused.client.saveGroup(input); const raw = paused.memory.get(paused.client.storageKey), n = paused.calls.length;
  paused.enabled(false); await paused.client.retry(); assert.deepEqual(paused.calls.slice(n).map(c => c.method), ["GET"]); assert.equal(paused.memory.get(paused.client.storageKey), raw);
});

test("25-row groups and members paginate independently, and details extract the unselected worker or group from the chosen item", async () => {
  const f = setup(); for (let n = 501; n <= 530; n++) f.seedGroup(n); for (let n = 601; n <= 630; n++) f.seedAssignment(n, groupId, n % 2 ? workerId : id(202));
  await f.client.initialize(); assert.equal(f.client.getSnapshot().result?.items.length, 25); await f.client.next(); assert.equal(f.client.getSnapshot().result?.items.length, 5);
  const n = f.calls.length; await f.client.next(); assert.equal(f.calls.length, n);
  await f.client.members({ groupId, workerId: null, onDate: "2026-10-03" }); assert.equal(f.client.getSnapshot().result?.items.length, 25);
  await f.client.detail(id(630)); assert.equal(f.client.getSnapshot().result?.worker?.workerId, id(202)); assert.equal(f.client.getSnapshot().result?.detail?.assignmentId, id(630));
  assert.deepEqual(f.client.getSnapshot().result?.items, []);
  await f.client.members({ groupId: null, workerId, onDate: null }); await f.client.detail(id(629)); assert.equal(f.client.getSnapshot().result?.group?.groupId, groupId);
});

test("revoked owner access clears displayed history and disables subsequent writes instead of retaining stale controls", async () => {
  const f = setup(); f.seedGroup(); f.seedAssignment(); await f.client.context(groupId, workerId); await f.client.detail(id(601)); assert.ok(f.client.getSnapshot().result?.detail);
  f.transport(async () => Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 })); await f.client.initialize();
  assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked"); const n = f.calls.length;
  await f.client.saveGroup(input); await f.client.assign(assignment); await f.client.end("2026-10-31", "Denied"); await f.client.cancel("Denied"); assert.equal(f.calls.length, n);
});

test("hidden reads are inert, and paused late GET successes or failures cannot overwrite a newly selected context", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), doc = { hidden: true };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); });
  const hidden = setup(); await hidden.client.initialize(); await hidden.client.context(null); assert.equal(hidden.calls.length, 0); doc.hidden = false;
  for (const denial of [false, true]) {
    const f = setup(); f.seedGroup(); let release!: (response: Response) => void; f.transport(() => new Promise<Response>(resolve => { release = resolve; }));
    const reading = f.client.initialize(); await f.client.initialize(); assert.equal(f.calls.length, 1); f.client.pause(); assert.equal(f.calls[0].signal?.aborted, true);
    f.transport(null); await f.client.context(groupId, workerId); const fresh = f.client.getSnapshot();
    release(denial ? Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 }) : f.reply(parseGroupsHttpQuery(new URL(f.calls[0].url, "https://fixture.invalid").href)));
    await reading; assert.equal(f.client.getSnapshot(), fresh); assert.equal(f.client.getSnapshot().result?.group?.groupId, groupId);
  }
});

test("paused held POST success or definitive conflict preserves pending until explicit original-operation GET recovery", async () => {
  for (const committed of [true, false]) {
    const f = setup(); f.seedGroup(); await f.client.context(groupId, workerId); let release!: (response: Response) => void;
    f.transport(() => new Promise<Response>(resolve => { release = resolve; })); const writing = f.client.assign(assignment), raw = f.memory.get(f.client.storageKey); assert.ok(raw);
    const { query, command } = parseGroupsBody(JSON.parse(f.calls.at(-1)!.body!));
    const response = committed ? f.commit(query, command) : Response.json({ ok: false, error: "attendance_version_conflict" }, { status: 409 });
    f.client.pause(); const paused = f.client.getSnapshot(); release(response); await writing;
    assert.equal(f.client.getSnapshot(), paused); assert.equal(paused.result, null); assert.equal(f.memory.get(f.client.storageKey), raw);
    f.transport(null); const n = f.calls.length; await f.client.initialize(); assert.deepEqual(f.calls.slice(n).map(c => c.method), ["GET"]);
    const url = new URL(f.calls[n].url, "https://fixture.invalid"); assert.equal(url.searchParams.get("operationId"), command.operationId); assert.equal(url.searchParams.get("groupId"), groupId);
    assert.equal(f.client.getSnapshot().pending === null, committed); assert.equal(f.memory.has(f.client.storageKey), !committed); assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  }
});

test("slow strict error streams cancel at the deadline without clearing the original pending intent", async () => {
  const f = setup(), client = f.create({ timeoutMs: 25 }); await client.initialize(); let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":false,"error":')); }, cancel() { cancelled++; } });
  f.transport(async () => new Response(stream, { status: 409, headers: { "content-type": "application/json" } })); await client.saveGroup(input); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1); assert.equal(stream.locked, false); assert.equal(f.calls.at(-1)?.signal?.aborted, true); assert.ok(client.getSnapshot().pending); assert.ok(f.memory.get(client.storageKey));
});
