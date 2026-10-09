import assert from "node:assert/strict";
import test from "node:test";
import { emptyAttendanceRuleDraft, RULE_KEYS } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange, MerchantAttendanceError } from "./merchantAttendanceTime";
import { PERSONAL_RULES_ERRORS, parsePersonalRulesQuery, parsePersonalRulesHttpQuery, personalRulesQueryString,
  parsePersonalRulesCommand, parsePersonalRulesBody, samePersonalRulesCommand, parsePersonalRulesItem,
  parsePersonalRulesResult, parsePersonalRulesResponse,
  type PersonalRulesQuery, type PersonalRulesCommand, type PersonalRulesItem, type PersonalRulesResult } from "./merchantAttendancePersonalRules";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(99), employeeId = id(101), employeeAuthUserId = id(102);
const query: PersonalRulesQuery = { siteId: "99990001", workerId: id(201), operationId: null, beforeRevision: null };
const endpoint = "https://www.faolla.com/api/merchant-enterprise/attendance/personal-rules";
type Approval = Extract<PersonalRulesCommand, { action: "approve" }>;
function approve(n = 1, patch: Partial<Approval> = {}): Approval {
  return { operationId: id(n), action: "approve", expectedRevision: n - 1, reason: "Owner-approved candidate",
    expectedWorkerVersion: 2, expectedSettingsVersion: 3, employeeId, employeeAuthUserId, timeZone: "UTC",
    startsOn: "2026-10-05", endsOn: "2026-10-05",
    rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 0 } }, ...patch };
}
const withdraw = (n = 2, approvedRevision = 1): PersonalRulesCommand => ({ operationId: id(n), action: "withdraw", expectedRevision: n - 1,
  reason: "Withdraw before the approved interval", approvedRevision });
function records(commands: PersonalRulesCommand[]): PersonalRulesItem[] {
  const all: PersonalRulesItem[] = [];
  for (const command of commands) {
    const envelope = { revision: command.expectedRevision + 1, operationId: command.operationId, actorId: owner, reason: command.reason,
      recordedAt: `2026-10-04T10:00:00.${String(command.expectedRevision + 1).padStart(6, "0")}Z` };
    if (command.action === "approve") {
      all.push({ ...envelope, action: "approve", approvedRevision: null, employeeId: command.employeeId,
        employeeAuthUserId: command.employeeAuthUserId, workerVersion: command.expectedWorkerVersion, settingsVersion: command.expectedSettingsVersion,
        timeZone: command.timeZone, startsOn: command.startsOn, endsOn: command.endsOn,
        fromAt: attendanceDayUtcRange(command.startsOn, command.timeZone).startAt,
        toAt: attendanceDayUtcRange(command.endsOn, command.timeZone).endAt, rules: structuredClone(command.rules) });
    } else {
      const target = all.find(item => item.revision === command.approvedRevision);
      assert(target); all.push({ ...structuredClone(target), ...envelope, action: "withdraw", approvedRevision: command.approvedRevision });
    }
  }
  return all;
}
function result(commands: PersonalRulesCommand[] = [], selected?: PersonalRulesCommand, beforeRevision: number | null = null): PersonalRulesResult {
  const all = records(commands), available = all.filter(item => beforeRevision === null || item.revision < beforeRevision).reverse();
  return { protocol: "personal-rules-v1", siteId: query.siteId, actorId: owner,
    worker: { workerId: query.workerId, workerName: "Test worker", workerNo: "W-201", employeeId, employeeAuthUserId,
      version: 5, active: true, employeeActive: true }, settingsVersion: 6, timeZone: "UTC", revision: commands.length,
    items: available.slice(0, 25).map(item => ({ ...item, withdrawnByRevision: item.action === "approve"
      ? all.find(row => row.action === "withdraw" && row.approvedRevision === item.revision)?.revision ?? null : null })),
    nextBeforeRevision: available.length > 25 ? available[24].revision : null,
    receipt: selected ? { operationId: selected.operationId, revision: selected.expectedRevision + 1,
      command: structuredClone(selected), item: structuredClone(all.find(item => item.operationId === selected.operationId)!) } : null,
    readAt: "2026-10-04T11:00:00.123456Z" };
}
function rejected(action: () => unknown) {
  assert.throws(action, error => error instanceof MerchantAttendanceError && error.code === "attendance_invalid_request");
}
function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach(freezeDeep); Object.freeze(value);
}
const adjacentApprovals = (count: number) => Array.from({ length: count }, (_, i) => {
  const day = new Date(Date.UTC(2026, 9, 5 + i)).toISOString().slice(0, 10);
  return approve(i + 1, { startsOn: day, endsOn: day });
});

test("explicit worker query round-trips and rejects ambiguity, duplicate HTTP keys and prototype names", () => {
  for (const q of [query, { ...query, operationId: id(1) }, { ...query, beforeRevision: 26 }]) {
    assert.deepEqual(parsePersonalRulesHttpQuery(`${endpoint}?${personalRulesQueryString(q)}`), q);
  }
  for (const q of [{ ...query, operationId: id(1), beforeRevision: 2 }, { ...query, beforeRevision: 0 }, { ...query, beforeRevision: -0 },
    { ...query, workerId: "" }, { ...query, siteId: "9999001" }, { ...query, actorId: owner }, { ...query, beforeRevision: 9007199254740991 }]) {
    rejected(() => parsePersonalRulesQuery(q));
  }
  const base = `${endpoint}?siteId=99990001&workerId=${query.workerId}`;
  for (const suffix of ["&siteId=99990001", "&beforeRevision=01", "&beforeRevision=1e2", "&beforeRevision=", "&beforeRevision=1.0",
    "&__proto__=x", "&constructor=x", "&ownerId=" + owner, "&operationId="]) rejected(() => parsePersonalRulesHttpQuery(base + suffix));
  rejected(() => parsePersonalRulesHttpQuery(endpoint));
});

test("two exact command variants have no draft, employee-supplied approval authority, or implicit settings", () => {
  for (const command of [approve(), withdraw()]) {
    assert.deepEqual(parsePersonalRulesBody({ query, command }), { query, command });
    assert(samePersonalRulesCommand(command, structuredClone(command)));
  }
  for (const command of [{ ...approve(), action: "save_draft" }, { ...approve(), actorId: owner }, { ...approve(), authorized: true },
    { ...approve(), expectedWorkerVersion: 0 }, { ...approve(), expectedSettingsVersion: "3" }, { ...approve(), employeeAuthUserId: null },
    { ...approve(), expectedRevision: -0 }, { ...approve(), expectedRevision: 9007199254740990 }, { ...withdraw(), approvedRevision: 2 },
    { ...withdraw(), rules: approve().rules }]) rejected(() => parsePersonalRulesCommand(command));
  for (const q of [{ ...query, operationId: id(1) }, { ...query, beforeRevision: 2 }]) rejected(() => parsePersonalRulesBody({ query: q, command: approve() }));
  rejected(() => parsePersonalRulesBody({ query, command: approve(), allowWrite: true }));
  assert.equal(samePersonalRulesCommand(approve(), approve(1, { reason: "Changed purpose" })), false);
});

test("rule choices preserve explicit zero and disabled while rejecting all-inherit, coercion, fractions and extra keys", () => {
  const command = approve(); command.rules.earlyGraceMinutes = { mode: "disabled" };
  command.rules.openSpanWarningMinutes = { mode: "value", minutes: 44640 };
  command.rules.completedBreakMinimumMinutes = { mode: "value", minutes: 1 };
  assert.deepEqual(parsePersonalRulesCommand(command), command);
  rejected(() => parsePersonalRulesCommand({ ...approve(), rules: emptyAttendanceRuleDraft() }));
  for (const key of RULE_KEYS) for (const choice of [{ mode: "value", minutes: "0" }, { mode: "value", minutes: NaN },
    { mode: "value", minutes: Infinity }, { mode: "value", minutes: -0 }, { mode: "value", minutes: 1.5 },
    { mode: "inherit", minutes: 0 }, { mode: "disabled", minutes: 0 }, { mode: "default" }]) {
    rejected(() => parsePersonalRulesCommand({ ...approve(), rules: { ...approve().rules, [key]: choice } }));
  }
  for (const [key, value] of [["lateGraceMinutes", 1441], ["earlyGraceMinutes", -1], ["openSpanWarningMinutes", 0],
    ["openSpanWarningMinutes", 44641], ["completedBreakMinimumMinutes", 0], ["completedBreakMinimumMinutes", 1441]]) {
    rejected(() => parsePersonalRulesCommand({ ...approve(), rules: { ...approve().rules, [key]: { mode: "value", minutes: value } } }));
  }
});

test("reason and worker text use bounded Unicode code points without silent trim or control characters", () => {
  assert.equal(parsePersonalRulesCommand(approve(1, { reason: "😀".repeat(200) })).reason, "😀".repeat(200));
  for (const reason of ["", " ", " padded", "padded ", "line\nbreak", "\u007f", "\u0085", "😀".repeat(201)]) rejected(() => parsePersonalRulesCommand(approve(1, { reason })));
  for (const patch of [{ workerName: "" }, { workerNo: " W-201" }, { workerName: "x".repeat(121) }, { workerNo: "x".repeat(41) }]) {
    const raw = result(); Object.assign(raw.worker, patch); rejected(() => parsePersonalRulesResult(raw, query));
  }
});

test("inclusive date range is one to 31 civil dates, not a rounded UTC-duration limit", () => {
  for (const patch of [{ startsOn: "2026-10-01", endsOn: "2026-10-31", timeZone: "Europe/Madrid" },
    { startsOn: "2026-03-01", endsOn: "2026-03-31", timeZone: "Europe/Madrid" }, { startsOn: "2000-01-01", endsOn: "2000-01-01" },
    { startsOn: "2100-12-31", endsOn: "2100-12-31" }]) assert.doesNotThrow(() => parsePersonalRulesCommand(approve(1, patch)));
  for (const patch of [{ endsOn: "2026-11-05" }, { endsOn: "2026-10-04" }, { startsOn: "2026-02-30" },
    { startsOn: "1999-12-31", endsOn: "2000-01-01" }, { startsOn: "2100-12-31", endsOn: "2101-01-01" },
    { startsOn: "2026-1-05" }, { timeZone: "+02:00" }, { timeZone: "Mars/Olympus" }]) rejected(() => parsePersonalRulesCommand(approve(1, patch)));
});

test("saved UTC boundaries follow spring/fall DST, skipped-next date and 2101 end sentinel exactly", () => {
  for (const [day, zone, recordedAt, fromAt, toAt] of [
    ["2026-03-29", "Europe/Madrid", "2026-03-27T10:00:00.000001Z", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25", "Europe/Madrid", "2026-10-04T10:00:00.000001Z", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
    ["2011-12-29", "Pacific/Apia", "2011-12-27T10:00:00.000001Z", "2011-12-29T10:00:00.000Z", "2011-12-30T10:00:00.000Z"],
    ["2100-12-31", "UTC", "2100-12-30T10:00:00.000001Z", "2100-12-31T00:00:00.000Z", "2101-01-01T00:00:00.000Z"],
  ]) {
    const item = { ...records([approve(1, { startsOn: day, endsOn: day, timeZone: zone })])[0], recordedAt };
    assert.equal(parsePersonalRulesItem(item).fromAt, fromAt); assert.equal(parsePersonalRulesItem(item).toAt, toAt);
    rejected(() => parsePersonalRulesItem({ ...item, toAt: fromAt }));
  }
  for (const patch of [{ startsOn: "2011-12-30", endsOn: "2011-12-31" }, { startsOn: "2011-12-29", endsOn: "2011-12-30" }]) {
    rejected(() => parsePersonalRulesCommand(approve(1, { ...patch, timeZone: "Pacific/Apia" })));
  }
  assert.doesNotThrow(() => parsePersonalRulesCommand(approve(1, { startsOn: "2011-12-29", endsOn: "2011-12-31", timeZone: "Pacific/Apia" })));
});

test("approval is future in its saved zone, and withdrawal must be strictly before the original UTC start", () => {
  const commands = [approve(), withdraw()], [approved, withdrawn] = records(commands);
  assert.doesNotThrow(() => parsePersonalRulesItem({ ...approved, recordedAt: "2026-10-04T23:59:59.999999Z" }));
  assert.doesNotThrow(() => parsePersonalRulesItem({ ...withdrawn, recordedAt: "2026-10-04T23:59:59.999999Z" }));
  for (const item of [approved, withdrawn]) for (const recordedAt of ["2026-10-05T00:00:00.000000Z", "2026-10-05T00:00:00.000001Z"]) {
    rejected(() => parsePersonalRulesItem({ ...item, recordedAt }));
  }
  const madrid = records([approve(1, { timeZone: "Europe/Madrid" })])[0];
  rejected(() => parsePersonalRulesItem({ ...madrid, recordedAt: "2026-10-04T22:00:00.000000Z" }));
  rejected(() => parsePersonalRulesItem({ ...withdrawn, approvedRevision: withdrawn.revision }));
  rejected(() => parsePersonalRulesItem({ ...approved, approvedRevision: 1 }));
});

test("canonical six-digit record/read instants and three-digit derived boundaries retain microseconds", () => {
  const raw = result([approve()], approve());
  assert.equal(parsePersonalRulesResult(raw, query, approve(), owner).receipt?.item.recordedAt, "2026-10-04T10:00:00.000001Z");
  for (const recordedAt of ["2026-10-04T10:00:00.000Z", "2026-10-04T10:00:00Z", "2026-10-04T12:00:00.000001+02:00", "2026-02-30T10:00:00.000001Z"]) {
    const item = records([approve()])[0]; rejected(() => parsePersonalRulesItem({ ...item, recordedAt }));
  }
  for (const readAt of ["2026-10-04T11:00:00.123Z", "2026-10-04T10:00:00.000000Z"]) rejected(() => parsePersonalRulesResult({ ...raw, readAt }, query, approve()));
  const item = records([approve()])[0]; rejected(() => parsePersonalRulesItem({ ...item, fromAt: "2026-10-05T00:00:00.000000Z" }));
});

test("empty stream can expose an inactive or unbound current worker but cannot invent historical identity", () => {
  for (const patch of [{ active: false, employeeActive: false }, { employeeId: null, employeeAuthUserId: null, employeeActive: false },
    { employeeAuthUserId: null, employeeActive: false }]) {
    const raw = result(); Object.assign(raw.worker, patch); assert.deepEqual(parsePersonalRulesResult(raw, query, null, owner), raw);
  }
  const raw = result([approve()]); raw.worker.employeeAuthUserId = null; rejected(() => parsePersonalRulesResult(raw, query));
  const invalid = result(); invalid.worker.employeeId = null; rejected(() => parsePersonalRulesResult(invalid, query));
  rejected(() => parsePersonalRulesResult({ ...result(), revision: 1 }, query));
});

test("approval and withdrawal results preserve full immutable snapshots and mutable current projection", () => {
  for (const commands of [[approve()], [approve(), withdraw()]]) {
    const selected = commands.at(-1)!, raw = result(commands, selected);
    assert.deepEqual(parsePersonalRulesResult(raw, query, selected, owner), raw);
    assert.deepEqual(parsePersonalRulesResult(raw, { ...query, operationId: selected.operationId }, null, owner), raw);
    assert.deepEqual(parsePersonalRulesResponse({ ...raw, ok: true, moduleEnabled: false }, query, selected, owner), { ...raw, ok: true, moduleEnabled: false });
  }
  const replay = result([approve(), withdraw()], approve());
  assert.equal(parsePersonalRulesResult(replay, query, approve(), owner).items[1].withdrawnByRevision, 2);
  assert.deepEqual(replay.receipt?.item, records([approve()])[0]);
  assert.equal(replay.items[0].rules.lateGraceMinutes.mode, "value");
});

test("current context may have advanced or changed zone while historical versions and withdrawal snapshots remain unchanged", () => {
  const raw = result([approve(1, { timeZone: "Europe/Madrid" }), withdraw()], withdraw());
  raw.timeZone = "America/New_York"; raw.worker.active = false; raw.worker.employeeActive = false;
  const parsed = parsePersonalRulesResult(raw, query, withdraw(), owner);
  assert.equal(parsed.timeZone, "America/New_York"); assert.equal(parsed.receipt?.item.timeZone, "Europe/Madrid");
  assert.equal(parsed.receipt?.item.workerVersion, 2); assert.equal(parsed.receipt?.item.settingsVersion, 3);
  for (const patch of [{ version: 1 }]) rejected(() => parsePersonalRulesResult({ ...raw, worker: { ...raw.worker, ...patch } }, query, withdraw()));
  rejected(() => parsePersonalRulesResult({ ...raw, settingsVersion: 2 }, query, withdraw()));
});

test("both current employee IDs bind history and receipts without name joins or stream-revision confusion", () => {
  const commands = adjacentApprovals(8), raw = result(commands, commands[0]);
  assert.equal(parsePersonalRulesResult(raw, { ...query, operationId: id(1) }).revision, 8);
  const renamed = structuredClone(raw); renamed.worker.workerName = "Renamed worker"; renamed.worker.workerNo = "RENAMED";
  assert.doesNotThrow(() => parsePersonalRulesResult(renamed, { ...query, operationId: id(1) }));
  for (const key of ["employeeId", "employeeAuthUserId"] as const) {
    const current = structuredClone(raw); current.worker[key] = id(500); rejected(() => parsePersonalRulesResult(current, { ...query, operationId: id(1) }));
    const history = structuredClone(raw); history.items[0][key] = id(500); rejected(() => parsePersonalRulesResult(history, { ...query, operationId: id(1) }));
    const receipt = structuredClone(raw); receipt.receipt!.item[key] = id(500); rejected(() => parsePersonalRulesResult(receipt, { ...query, operationId: id(1) }));
  }
});

test("historical owners remain visible and a new owner's withdrawal may target their approval, not recover their receipt", () => {
  const raw = result([approve(), withdraw()], withdraw()); raw.items[1].actorId = id(98);
  assert.doesNotThrow(() => parsePersonalRulesResult(raw, query, withdraw(), owner));
  const old = result([approve()], approve()); old.items[0].actorId = id(98); old.receipt!.item.actorId = id(98);
  rejected(() => parsePersonalRulesResult(old, { ...query, operationId: id(1) }, null, owner));
  old.receipt = null; rejected(() => parsePersonalRulesResult(old, { ...query, operationId: id(1) }, null, owner));
  assert.doesNotThrow(() => parsePersonalRulesResult(old, query, null, owner));
});

test("unknown recovery may return null, but visible original operation or posted command requires its exact receipt", () => {
  assert.doesNotThrow(() => parsePersonalRulesResult(result(), { ...query, operationId: id(333) }, null, owner));
  assert.doesNotThrow(() => parsePersonalRulesResult(result([approve()]), { ...query, operationId: id(333) }, null, owner));
  rejected(() => parsePersonalRulesResult(result([approve()]), { ...query, operationId: id(1) }, null, owner));
  rejected(() => parsePersonalRulesResult(result([approve()]), query, approve(), owner));
  rejected(() => parsePersonalRulesResult(result([approve()], approve()), query, null, owner));
});

test("receipt envelopes cannot borrow a different command, revision, actor, identity, or immutable item", () => {
  for (const mutate of [
    (raw: PersonalRulesResult) => { raw.receipt!.command.reason = "Changed"; },
    (raw: PersonalRulesResult) => { raw.receipt!.operationId = id(400); },
    (raw: PersonalRulesResult) => { raw.receipt!.revision = 2; },
    (raw: PersonalRulesResult) => { raw.receipt!.item.actorId = id(98); },
    (raw: PersonalRulesResult) => { raw.receipt!.item.rules.earlyGraceMinutes = { mode: "disabled" }; },
    (raw: PersonalRulesResult) => { raw.items[0].reason = "Other visible item"; },
    (raw: PersonalRulesResult) => { raw.actorId = id(98); },
    (raw: PersonalRulesResult) => { raw.siteId = "99990002"; },
    (raw: PersonalRulesResult) => { raw.worker.workerId = id(202); },
  ]) { const raw = result([approve()], approve()); mutate(raw); rejected(() => parsePersonalRulesResult(raw, query, approve(), owner)); }
  rejected(() => parsePersonalRulesResult(result([approve()], approve()), query, approve(1, { reason: "Other submitted command" }), owner));
});

test("complete 25-row descending pages and exclusive cursor cannot masquerade as partial history", () => {
  const commands = adjacentApprovals(28), raw = result(commands);
  assert.equal(parsePersonalRulesResult(raw, query).nextBeforeRevision, 4);
  assert.equal(parsePersonalRulesResult(result(commands, undefined, 4), { ...query, beforeRevision: 4 }).items.length, 3);
  assert.equal(parsePersonalRulesResult(result(commands, undefined, 1), { ...query, beforeRevision: 1 }).items.length, 0);
  assert.equal(parsePersonalRulesResult(result(commands, undefined, 99), { ...query, beforeRevision: 99 }).items[0].revision, 28);
  for (const patch of [{ items: raw.items.slice(0, 24) }, { items: raw.items.slice().reverse() }, { nextBeforeRevision: null },
    { nextBeforeRevision: 3 }, { items: [...raw.items, raw.items[24]] }]) rejected(() => parsePersonalRulesResult({ ...raw, ...patch }, query));
  const duplicate = structuredClone(raw); duplicate.items[1].operationId = duplicate.items[0].operationId;
  rejected(() => parsePersonalRulesResult(duplicate, query));
});

test("an immutable original receipt outside the current page remains recoverable at a later stream head", () => {
  const commands = adjacentApprovals(28), raw = result(commands, commands[0]);
  const parsed = parsePersonalRulesResult(raw, { ...query, operationId: id(1) }, null, owner);
  assert.equal(parsed.items.at(-1)?.revision, 4); assert.equal(parsed.receipt?.revision, 1);
  assert.equal(parsePersonalRulesResult(raw, query, commands[0], owner).revision, 28);
});

test("visible withdrawal must exactly copy approved context, rules and target while owning its new envelope", () => {
  for (const patch of [{ workerVersion: 3 }, { settingsVersion: 4 }, { employeeId: id(500) }, { employeeAuthUserId: id(501) },
    { rules: { ...emptyAttendanceRuleDraft(), earlyGraceMinutes: { mode: "disabled" } } }, { rules: emptyAttendanceRuleDraft() },
    { approvedRevision: 2 }, { workerVersion: null }, { timeZone: null }]) {
    const raw = result([approve(), withdraw()]); Object.assign(raw.items[0], patch); rejected(() => parsePersonalRulesResult(raw, query));
  }
  const changedPeriod = result([approve(), withdraw()]); Object.assign(changedPeriod.items[0], {
    startsOn: "2026-10-06", endsOn: "2026-10-06", fromAt: "2026-10-06T00:00:00.000Z", toAt: "2026-10-07T00:00:00.000Z" });
  rejected(() => parsePersonalRulesResult(changedPeriod, query));
  const alteredZone = result([approve(), withdraw()]); alteredZone.items[0].timeZone = "Etc/UTC";
  rejected(() => parsePersonalRulesResult(alteredZone, query));
});

test("visible withdrawal relations reject missing, wrong, duplicate or self-referential projection pointers", () => {
  for (const pointer of [null, 1, 3]) {
    const raw = result([approve(), withdraw()]); raw.items[1].withdrawnByRevision = pointer;
    rejected(() => parsePersonalRulesResult(raw, query));
  }
  const duplicate = result([approve(), withdraw(), withdraw(3)]); rejected(() => parsePersonalRulesResult(duplicate, query));
  const wrong = result([approve(), withdraw(), approve(3)]); wrong.items[2].withdrawnByRevision = 3;
  rejected(() => parsePersonalRulesResult(wrong, query));
  const withdrawalPointer = result([approve(), withdraw()]); withdrawalPointer.items[0].withdrawnByRevision = 2;
  rejected(() => parsePersonalRulesResult(withdrawalPointer, query));
});

test("half-open adjacent approvals may coexist, overlap cannot, and withdrawn approval does not reserve its old interval", () => {
  assert.doesNotThrow(() => parsePersonalRulesResult(result(adjacentApprovals(2)), query));
  rejected(() => parsePersonalRulesResult(result([approve(), approve(2)]), query));
  assert.doesNotThrow(() => parsePersonalRulesResult(result([approve(), withdraw(), approve(3)]), query));
  const reverseClock = result([approve(), withdraw()]); reverseClock.items[0].recordedAt = "2026-10-04T10:00:00.000000Z";
  rejected(() => parsePersonalRulesResult(reverseClock, query));
});

test("strict records and arrays reject hidden keys, getters, holes and inherited input without executing accessors", () => {
  let reads = 0;
  const getter = () => { reads++; throw Error("must not execute"); };
  for (const raw of [Object.assign(Object.create({ inherited: true }), query), { ...query, [Symbol("hidden")]: true },
    Object.defineProperty({ ...query }, "siteId", { get: getter, enumerable: true }),
    Object.defineProperty({ ...query }, "siteId", { value: query.siteId, enumerable: false })]) rejected(() => parsePersonalRulesQuery(raw));
  const command = Object.defineProperty({ ...approve() }, "action", { get: getter, enumerable: true }); rejected(() => parsePersonalRulesCommand(command));
  const rule = Object.defineProperty({ mode: "value", minutes: 0 }, "mode", { get: getter, enumerable: true });
  rejected(() => parsePersonalRulesCommand({ ...approve(), rules: { ...approve().rules, lateGraceMinutes: rule } }));
  const hidden = Object.defineProperty({ mode: "disabled" }, "mode", { value: "disabled", enumerable: false });
  rejected(() => parsePersonalRulesCommand({ ...approve(), rules: { ...approve().rules, lateGraceMinutes: hidden } }));
  for (const items of [new Array(1), Object.assign([result([approve()]).items[0]], { extra: true }),
    Object.defineProperty([result([approve()]).items[0]], "0", { get: getter, enumerable: true })]) rejected(() => parsePersonalRulesResult({ ...result([approve()]), items }, query));
  const raw = result([approve()], approve());
  Object.defineProperty(raw.receipt!, "command", { get: getter, enumerable: true }); rejected(() => parsePersonalRulesResult(raw, query, approve()));
  assert.equal(reads, 0);
});

test("deep strictness and envelope flags reject extras instead of dropping unknown sensitive content", () => {
  const raw = result([approve()], approve());
  for (const patched of [{ ...raw, payroll: true }, { ...raw, worker: { ...raw.worker, phone: "private" } },
    { ...raw, items: [{ ...raw.items[0], credential: "private" }] },
    { ...raw, receipt: { ...raw.receipt, signature: "not a signature" } }]) rejected(() => parsePersonalRulesResult(patched, query, approve()));
  for (const patch of [{ ok: false }, { moduleEnabled: "false" }, { extra: true }]) rejected(() => parsePersonalRulesResponse({ ...raw, ok: true, moduleEnabled: true, ...patch }, query, approve()));
  const nullPrototype = Object.assign(Object.create(null), query); assert.deepEqual(parsePersonalRulesQuery(nullPrototype), query);
});

test("parsing does not mutate or retain caller-owned aliases across worker, history, command and immutable receipt", () => {
  const raw = result([approve(), withdraw()], approve()), before = structuredClone(raw), q = { ...query, operationId: id(1) };
  freezeDeep(raw); freezeDeep(q);
  const parsed = parsePersonalRulesResult(raw, q, null, owner);
  parsed.worker.workerName = "Output only"; parsed.items[1].rules.lateGraceMinutes = { mode: "disabled" };
  parsed.receipt!.command.reason = "Output only"; parsed.receipt!.item.rules.earlyGraceMinutes = { mode: "disabled" };
  assert.deepEqual(raw, before); assert.equal(parsed.receipt!.item.rules.lateGraceMinutes.mode, "value");
  assert.equal(parsed.items[1].rules.earlyGraceMinutes.mode, "inherit");
});

test("error map distinguishes identity, future, overlap, withdrawn and inactive failures without exposing raw details", () => {
  for (const code of ["attendance_personal_rule_future_required", "attendance_personal_rule_overlap", "attendance_personal_rule_already_withdrawn",
    "attendance_personal_rule_worker_inactive", "attendance_personal_rule_identity_changed", "attendance_version_conflict", "attendance_operation_conflict"]) assert.equal(PERSONAL_RULES_ERRORS[code], 409);
  assert.equal(PERSONAL_RULES_ERRORS.attendance_personal_rule_invalid, 503);
  assert.equal(PERSONAL_RULES_ERRORS.attendance_access_denied, 403);
  assert.equal(PERSONAL_RULES_ERRORS.attendance_worker_not_found, 404);
  assert(Object.isFrozen(PERSONAL_RULES_ERRORS));
});
