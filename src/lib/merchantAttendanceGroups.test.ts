import assert from "node:assert/strict";
import test from "node:test";
import { groupDate, groupRange, groupsQueryString, parseGroupsQuery, parseGroupsHttpQuery, parseGroupsCommand, parseGroupsBody,
  parseGroupsResult, parseGroupsResponse, parseGroupItem, parseGroupWorker, parseGroupAssignmentItem, parseGroupAssignmentDetail,
  sameGroupsCommand, type GroupsCommand, type GroupsQuery, type GroupsResult, type GroupItem, type GroupWorker,
  type GroupAssignmentItem, type GroupAssignmentDetail } from "./merchantAttendanceGroups";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-03T09:00:00.123456Z", later = "2026-10-03T10:00:00.000001Z", last = "2026-10-03T10:00:00.000002Z";
const query = (view: GroupsQuery["view"] = "context"): GroupsQuery => ({ siteId: "99990001", view, groupId: null,
  workerId: null, onDate: null, assignmentId: null, operationId: null, cursorId: null });
const save: GroupsCommand = { action: "save_group", operationId: id(501), groupId: id(501), expectedRevision: 0,
  name: "Morning team", description: "", active: true, reason: "Create group" };
const group = (n = 501): GroupItem => ({ groupId: id(n), revision: 1, name: save.name, description: save.description, active: true, createdAt: at, updatedAt: at });
const worker = (n = 201): GroupWorker => ({ workerId: id(n), workerName: "Current worker", workerNo: "CURRENT-1", employeeId: id(101), version: 3, active: true });
const assign: Exclude<GroupsCommand, { action: "save_group" }> = { action: "assign", operationId: id(601), reason: "Join group", groupId: id(501),
  workerId: id(201), expectedGroupRevision: 1, expectedWorkerVersion: 2, expectedSettingsVersion: 1, timeZone: "Europe/Madrid", startsOn: "2026-10-01", endsOn: null };
const item = (n = 601): GroupAssignmentItem => ({ assignmentId: id(n), groupId: id(501), groupName: "Original group", workerId: id(201),
  workerName: "Original worker", workerNo: "OLD-1", employeeId: id(101), timeZone: "Europe/Madrid", startsOn: "2026-10-01", endsOn: null,
  createdAt: at, updatedAt: at, revision: 1, status: "assigned" });
const end: Exclude<GroupsCommand, { action: "save_group" }> = { action: "end", operationId: id(602), assignmentId: id(601), expectedRevision: 1, endsOn: "2026-10-31", reason: "End long-term assignment" };
const cancel: Exclude<GroupsCommand, { action: "save_group" }> = { action: "cancel", operationId: id(603), assignmentId: id(601), expectedRevision: 2, reason: "Void whole interval" };
const ended = (): GroupAssignmentItem => ({ ...item(), endsOn: "2026-10-31", updatedAt: later, revision: 2, status: "ended" });
const cancelled = (): GroupAssignmentItem => ({ ...ended(), updatedAt: last, revision: 3, status: "cancelled" });
const detail = (revision: 1 | 2 | 3 = 1): GroupAssignmentDetail => ({ ...(revision === 1 ? item() : revision === 2 ? ended() : cancelled()),
  history: [{ command: assign, item: item() }, ...(revision >= 2 ? [{ command: end, item: ended() }] : []), ...(revision === 3 ? [{ command: cancel, item: cancelled() }] : [])],
  canEnd: revision === 1, canCancel: revision < 3 });
const selected = (): GroupsQuery => ({ ...query(), groupId: id(501), workerId: id(201) });
const result = (q: GroupsQuery = query()): GroupsResult => ({ protocol: "groups-v1", siteId: q.siteId, actorId: id(99), settingsVersion: 9,
  timeZone: "America/New_York", view: q.view, group: q.groupId ? group(Number(q.groupId.slice(-12))) : null,
  worker: q.workerId ? worker(Number(q.workerId.slice(-12))) : null, items: [], nextCursor: null, detail: null, receipt: null });

test("groups query strictly separates lists, selected member scopes and context/operation lookup", () => {
  for (const q of [query(), query("groups"), { ...query("members"), groupId: id(501) }, { ...query("members"), workerId: id(201), onDate: "2026-10-03" },
    { ...selected(), assignmentId: id(601), operationId: id(602) }])
    assert.deepEqual(parseGroupsHttpQuery(`https://fixture.invalid/?${groupsQueryString(q)}`), q);
  for (const q of [{ ...query(), view: ["groups"] }, { ...query(), view: 1 }, { ...query(), extra: true }, { ...query(), cursorId: id(501) },
    { ...query(), onDate: "2026-10-03" }, { ...query(), assignmentId: id(601) }, { ...query("groups"), groupId: id(501) },
    { ...query("groups"), operationId: id(501) }, query("members"), { ...query("members"), groupId: id(501), assignmentId: id(601) },
    { ...query("members"), groupId: id(501), operationId: id(501) }]) assert.throws(() => parseGroupsQuery(q));
  for (const suffix of ["&view=context", "&siteId=99990001", "&ownerId=" + id(99), "&groupIds=" + id(501)])
    assert.throws(() => parseGroupsHttpQuery(`https://fixture.invalid/?${groupsQueryString(query())}${suffix}`));
});

test("group command schemas bind scope and numeric versions without granting rule, payroll or role authority", () => {
  assert.deepEqual(parseGroupsBody({ query: query(), command: save }), { query: query(), command: save });
  assert.deepEqual(parseGroupsBody({ query: selected(), command: assign }).command, assign);
  for (const command of [end, cancel]) assert.deepEqual(parseGroupsBody({ query: { ...selected(), assignmentId: id(601) }, command }).command, command);
  for (const patch of [{ groupId: id(502) }, { expectedRevision: -1 }, { expectedRevision: 9007199254740990 }, { active: 1 },
    { name: " padded" }, { name: "x".repeat(81) }, { description: "x".repeat(201) }, { description: "bad\ntext" }, { reason: "" }, { allowedClockMethods: ["web"] }])
    assert.throws(() => parseGroupsCommand({ ...save, ...patch }));
  assert.equal(parseGroupsCommand({ ...save, name: "🙂".repeat(80), reason: "🙂".repeat(200) }).action, "save_group");
  assert.equal(parseGroupsCommand({ ...save, expectedRevision: 9007199254740989 }).action, "save_group");
  for (const patch of [{ expectedGroupRevision: 0 }, { expectedWorkerVersion: 0.1 }, { expectedSettingsVersion: Number.MAX_SAFE_INTEGER },
    { endsOn: "2026-09-30" }, { timeZone: "Bad/Zone" }, { roleId: id(9) }, { payroll: true }]) assert.throws(() => parseGroupsCommand({ ...assign, ...patch }));
  assert.throws(() => parseGroupsCommand({ ...end, expectedRevision: 2 })); assert.throws(() => parseGroupsCommand({ ...cancel, expectedRevision: 3 }));
  for (const body of [{ query: query("groups"), command: save }, { query: { ...query(), groupId: id(501) }, command: save },
    { query: { ...selected(), groupId: id(502) }, command: assign }, { query: { ...selected(), assignmentId: id(602) }, command: end },
    { query: { ...query(), operationId: id(501) }, command: save }, { query: query(), command: save, allowWrite: true }]) assert.throws(() => parseGroupsBody(body));
  assert.equal(sameGroupsCommand(save, structuredClone(save)), true); assert.equal(sameGroupsCommand(save, { ...save, reason: "Another intent" }), false);
});

test("date labels are inclusive 2000–2100 ranges, not an elapsed-time calculation, and finite endpoints must exist in the saved zone", () => {
  assert.deepEqual(groupRange("2000-01-01", "2100-12-31", "Europe/Madrid"), { startsOn: "2000-01-01", endsOn: "2100-12-31" });
  assert.deepEqual(groupRange("2026-10-25", null, "Europe/Madrid"), { startsOn: "2026-10-25", endsOn: null });
  assert.deepEqual(groupRange("2026-10-25", "2026-10-25"), { startsOn: "2026-10-25", endsOn: "2026-10-25" });
  for (const value of ["1999-12-31", "2101-01-01", "2026-02-30", "2026-1-01", "2026-10-03T00:00:00.000Z", null])
    assert.throws(() => groupDate(value), /attendance_invalid_request/);
  assert.throws(() => groupRange("2026-10-02", "2026-10-01"), /attendance_invalid_request/);
  assert.throws(() => groupRange("2011-12-30", null, "Pacific/Apia"), /attendance_invalid_request/);
  assert.throws(() => groupRange("2011-12-29", "2011-12-30", "Pacific/Apia"), /attendance_invalid_request/);
});

test("current groups/workers and historical assignment items are exact and retain microsecond timestamps and identity snapshots", () => {
  assert.deepEqual(parseGroupItem(group()), group()); assert.deepEqual(parseGroupWorker(worker()), worker());
  assert.deepEqual(parseGroupAssignmentItem(item()), item()); assert.deepEqual(parseGroupAssignmentItem(ended()), ended());
  assert.deepEqual(parseGroupAssignmentItem(cancelled()), cancelled());
  for (const patch of [{ revision: 0 }, { updatedAt: "2026-10-03T09:00:00.123455Z" }, { createdAt: "2026-10-03T09:00:00.123Z" },
    { privateData: "x" }, { name: "bad\u0085name" }]) assert.throws(() => parseGroupItem({ ...group(), ...patch }));
  for (const patch of [{ workerName: "x".repeat(121) }, { workerNo: "x".repeat(41) }, { employeeId: "bad" }, { version: 0 }, { permissions: [] }])
    assert.throws(() => parseGroupWorker({ ...worker(), ...patch }));
  for (const patch of [{ revision: 2 }, { updatedAt: later }, { reason: "private" }, { groupName: "x".repeat(81) }, { employeeId: "bad" },
    { status: "active" }, { timeZone: "Bad/Zone" }]) assert.throws(() => parseGroupAssignmentItem({ ...item(), ...patch }));
  assert.throws(() => parseGroupAssignmentItem({ ...ended(), endsOn: null }));
  assert.deepEqual(parseGroupAssignmentItem({ ...item(), employeeId: null }).employeeId, null);
});

test("assignment history must exactly preserve snapshots through assign→end→cancel, with only end allowed to add an end date", () => {
  for (const revision of [1, 2, 3] as const) assert.deepEqual(parseGroupAssignmentDetail(detail(revision)), detail(revision));
  const directCancel: GroupAssignmentDetail = { ...item(), revision: 2, status: "cancelled", updatedAt: later, canEnd: false, canCancel: false,
    history: [{ command: assign, item: item() }, { command: { ...cancel, expectedRevision: 1 }, item: { ...item(), revision: 2, status: "cancelled", updatedAt: later } }] };
  assert.deepEqual(parseGroupAssignmentDetail(directCancel), directCancel);
  for (const patch of [{ history: [] }, { history: detail(3).history.slice(0, 2) }, { canEnd: true }, { canCancel: true },
    { workerName: "Changed final snapshot" }, { history: detail(3).history.map((h, i) => i === 1 ? { ...h, item: { ...h.item, workerName: "Changed" } } : h) },
    { history: detail(3).history.map((h, i) => i === 2 ? { ...h, command: { ...h.command, operationId: id(602) } } : h) },
    { history: detail(3).history.map((h, i) => i === 1 ? { ...h, item: { ...h.item, updatedAt: "2026-10-03T09:00:00.123455Z" } } : h) }])
    assert.throws(() => parseGroupAssignmentDetail({ ...detail(3), ...patch }));
  const changedCancel = { ...directCancel, endsOn: "2026-10-31", history: directCancel.history.map((h, i) => i ? { ...h, item: { ...h.item, endsOn: "2026-10-31" } } : h) };
  assert.throws(() => parseGroupAssignmentDetail(changedCancel));
  const finite = { ...item(), endsOn: "2026-10-20" }, badEnd = { ...detail(2), history: [{ command: { ...assign, endsOn: finite.endsOn }, item: finite }, detail(2).history[1]] };
  assert.throws(() => parseGroupAssignmentDetail(badEnd));
  assert.throws(() => parseGroupAssignmentDetail({ ...detail(), endsOn: "2026-10-20", history: [{ command: { ...assign, endsOn: "2026-10-20" }, item: finite }] }));
});

test("response identity/context stays exact while historical labels and time zones need not equal the current group or worker", () => {
  const q = { ...selected(), assignmentId: id(601) }, value = { ...result(q), detail: detail(3) };
  assert.deepEqual(parseGroupsResult(value, q, null, id(99)), value);
  assert.notEqual(value.group?.name, value.detail.groupName); assert.notEqual(value.worker?.workerName, value.detail.workerName);
  assert.notEqual(value.timeZone, value.detail.timeZone);
  for (const patch of [{ siteId: "99990002" }, { actorId: id(98) }, { group: null }, { worker: null }, { worker: worker(202) },
    { group: group(502) }, { detail: null }, { detail: { ...detail(), assignmentId: id(602) } }, { items: [item()] }, { extra: true }])
    assert.throws(() => parseGroupsResult({ ...value, ...patch }, q, null, id(99)));
  assert.throws(() => parseGroupsResult({ ...result(selected()), detail: detail() }, selected()));
  assert.throws(() => parseGroupsResult({ ...result(), worker: worker() }, query()));
  for (const patch of [{ ok: false }, { moduleEnabled: "false" }, { extra: true }])
    assert.throws(() => parseGroupsResponse({ ok: true, moduleEnabled: false, ...result(), ...patch }, query()));
  assert.equal(parseGroupsResponse({ ok: true, moduleEnabled: false, ...result() }, query()).moduleEnabled, false);
});

test("25-row group/member pages have exact descending cursors and date/scope filters without hiding cancelled intervals", () => {
  const q = query("groups"), items = Array.from({ length: 25 }, (_, i) => group(550 - i));
  const page = { ...result(q), items, nextCursor: id(526) }; assert.deepEqual(parseGroupsResult(page, q), page);
  for (const patch of [{ items: [...items, group(525)] }, { items: [...items].reverse() }, { items: items.slice(1) },
    { nextCursor: id(527) }, { items: [group(), group()], nextCursor: null }, { group: group() }])
    assert.throws(() => parseGroupsResult({ ...page, ...patch }, q));
  assert.throws(() => parseGroupsResult({ ...result(q), items: [group()] }, { ...q, cursorId: id(501) }));
  const mq: GroupsQuery = { ...query("members"), groupId: id(501), workerId: id(201), onDate: "2026-10-31" };
  assert.equal(parseGroupsResult({ ...result(mq), items: [cancelled()] }, mq).items.length, 1);
  for (const patch of [{ groupId: id(502) }, { workerId: id(202) }, { endsOn: "2026-10-30" }, { startsOn: "2026-11-01", endsOn: "2026-11-30" }])
    assert.throws(() => parseGroupsResult({ ...result(mq), items: [{ ...cancelled(), ...patch }] }, mq));
  assert.throws(() => parseGroupsResult({ ...result(mq), detail: detail() }, mq));
});

test("group receipts allow later rename/inactivation, while assignment receipts must match the exact historical command and snapshot", () => {
  const current = { ...group(), revision: 3, name: "Renamed", active: false, updatedAt: last };
  const saved = { ...result(), group: current, receipt: { command: save, item: group() } };
  assert.deepEqual(parseGroupsResult(saved, query(), save), saved);
  assert.equal(parseGroupsResult(saved, { ...query(), operationId: save.operationId }).group?.name, "Renamed");
  for (const patch of [{ group: { ...current, createdAt: later } }, { group: { ...current, revision: 1 } }, { group: null },
    { receipt: { command: { ...save, reason: "Different" }, item: group() } }, { receipt: { command: save, item: { ...group(), active: false } } }])
    assert.throws(() => parseGroupsResult({ ...saved, ...patch }, query(), save));
  assert.throws(() => parseGroupsResult({ ...result(), group: group() }, query()));
  for (const operation of [assign, end, cancel]) {
    const q = operation.action === "assign" ? selected() : { ...selected(), assignmentId: id(601) };
    const snapshot = detail(3).history.find(h => h.command.action === operation.action)!.item;
    const value = { ...result(q), detail: detail(3), receipt: { command: operation, item: snapshot } };
    assert.deepEqual(parseGroupsResult(value, q, operation), value);
    for (const replacement of [null, { command: { ...operation, reason: "Changed history" }, item: snapshot },
      { command: operation, item: { ...snapshot, workerName: "Other original person" } }])
      assert.throws(() => parseGroupsResult({ ...value, receipt: replacement }, q, operation));
    if (operation.action !== "cancel") assert.throws(() => parseGroupsResult({ ...value, receipt: { command: operation, item: cancelled() } }, q, operation));
  }
});
