import assert from "node:assert/strict";
import test from "node:test";
import { parsePeriodClosureCommand, parsePeriodClosureQuery, parsePeriodClosureResult } from "./merchantAttendancePeriodClosure";
import { PERIOD_CLOSURE_V2_MAX as MAX, parsePeriodClosureV2Query as parseQuery, parsePeriodClosureV2Command as parseCommand,
  parsePeriodClosureV2HttpQuery as parseUrl, periodClosureV2QueryString as stringify, parsePeriodClosureV2Body,
  parsePeriodClosureV2Result as parseResult, parsePeriodClosureV2Response as parseResponse, periodClosureV2Message,
  type PeriodClosureV2Query as Query, type PeriodClosureV2Command as Command, type PeriodClosureV2Result as Result,
  type PeriodClosureV2Cursor as Cursor, type PeriodClosureV2Entry as Entry } from "./merchantAttendancePeriodClosureV2";
import { periodClosureUiId as id, periodClosureUiOwner as owner, periodClosureUiEmployee as employee, periodClosureUiAuth as auth,
  periodClosureUiPeriod as period, periodClosureUiQuery as oldQuery, periodClosureUiCommand as oldCommand,
  periodClosureUiArtifact as artifact, periodClosureUiSummary as summary, periodClosureUiEntry as oldEntry } from "../../scripts/fixtures/attendance-period-closure-ui-model";

const q = (mode: Query["mode"] = "detail", access: Query["access"] = "owner"): Query => ({ ...oldQuery(mode === "history" || mode === "versions" ? "detail" : mode, access), mode, cursor: null });
const common = (query: Query) => ({ protocol: "period-closure-v2" as const, siteId: query.siteId, workerId: query.workerId, actorId: query.access === "owner" ? owner : auth, access: query.access, readAt: "2026-09-11T12:00:00.000001Z" });
const scope = (query: Query) => ({ kind: query.mode, siteId: query.siteId, access: query.access, workerId: query.workerId, fromDate: query.fromDate, throughDate: query.throughDate, periodId: query.periodId });
function detail(query = q(), c: Command | null = null): Result {
  const p = { ...summary(), revision: 201, currentVersion: 21 };
  const operation = c ? oldEntry(c) : null;
  return { ...common(query), kind: "detail", period: p, artifact: artifact(), artifactVersion: operation?.version ?? query.version ?? p.currentVersion,
    sourceChanged: query.mode === "detail" && query.version === null && !c ? false : null, operation, replayed: query.mode === "recover" };
}
const histEntry = (revision: number): Entry => oldEntry({ ...oldCommand(), operationId: id(1000 + revision), action: revision === 1 ? "send" : "respond", expectedRevision: revision - 1, expectedVersion: revision === 1 ? 0 : 1, expectedFingerprint: revision === 1 ? "a".repeat(64) : null });
function history(query = q("history"), revision = 101): Result {
  const at = query.cursor?.kind === "history" ? query.cursor.atRevision : revision;
  const top = query.cursor?.kind === "history" ? query.cursor.beforeRevision - 1 : at;
  const items = Array.from({ length: Math.min(50, top) }, (_, i) => histEntry(top - i));
  const nextCursor = top > 50 ? { ...scope(query), kind: "history", periodId: period, atRevision: at, beforeRevision: items.at(-1)!.revision } as Cursor : null;
  return { ...common(query), kind: "history", period: { ...summary(), revision }, items, nextCursor };
}
function versions(query = q("versions"), currentVersion = 21): Result {
  const at = query.cursor?.kind === "versions" ? query.cursor.atVersion : currentVersion;
  const top = query.cursor?.kind === "versions" ? query.cursor.beforeVersion - 1 : at;
  const items = Array.from({ length: Math.min(20, top) }, (_, i) => ({ version: top - i, operationId: id(2000 + top - i), recordedAt: "2026-09-11T10:00:00.000001Z", artifactId: id(3000), sourceFingerprint: "a".repeat(64), artifactBytes: 100, artifactSha256: "b".repeat(64) }));
  const nextCursor = top > 20 ? { ...scope(query), kind: "versions", periodId: period, atVersion: at, beforeVersion: items.at(-1)!.version } as Cursor : null;
  return { ...common(query), kind: "versions", period: { ...summary(), revision: 1000, currentVersion }, items, nextCursor };
}

test("v2 exact modes, bounded civil range and independent query roundtrip", () => {
  for (const mode of ["list", "preview", "detail", "recover", "export", "history", "versions"] as const) {
    const query = q(mode); assert.deepEqual(parseQuery(query), query); assert.deepEqual(parseUrl("https://example.test/?" + stringify(query)), query);
  }
  for (const patch of [{ actorId: owner }, { access: "manager" }, { mode: "all" }, { cursor: {} }, { fromDate: "2026-02-30" }, { throughDate: "2026-10-03" }, { version: MAX + 1 }, { version: -0 }]) assert.throws(() => parseQuery({ ...q(), ...patch }));
  assert.throws(() => parseQuery({ ...q("history"), version: 1 }));
  assert.throws(() => parseQuery({ ...q("recover"), version: 1 }));
});
test("HTTP rejects duplicate keys, duplicate cursor JSON, controls, fragments and noncanonical decimals", () => {
  const url = "https://example.test/?" + stringify(q());
  for (const suffix of ["&siteId=12345678", "&version=01", "&version=1e2", "&version=2147483648", "&unknown=x", "#", "#data", "%Q0", "\n"]) assert.throws(() => parseUrl(url + suffix));
  assert.throws(() => parseUrl(url + "&cursor=" + encodeURIComponent('{"kind":"history","kind":"versions"}')));
  assert.throws(() => parseUrl("https://user:pass@example.test/?" + stringify(q())));
});
test("cursor binds exact list/period scope and excludes its last position", () => {
  const query = q("history"); query.cursor = { ...scope(query), kind: "history", periodId: period, atRevision: 100, beforeRevision: 51 } as Cursor;
  assert.deepEqual(parseUrl("https://example.test/?" + stringify(query)), query);
  for (const patch of [{ siteId: "12345678" }, { access: "self" }, { workerId: id(400) }, { periodId: id(401) }, { fromDate: "2026-09-02" }, { kind: "versions" }, { beforeRevision: 101 }, { atRevision: MAX + 1 }, { beforeRevision: -0 }]) assert.throws(() => parseQuery({ ...query, cursor: { ...query.cursor, ...patch } }));
});
test("new integer range does not relax the old v1 wire or old command", () => {
  const command = { ...oldCommand(), expectedRevision: 100, expectedVersion: 20 };
  assert.equal(parseCommand(q(), command).expectedRevision, 100);
  assert.equal(parseCommand(q(), { ...command, expectedRevision: MAX - 1, expectedVersion: MAX - 1 }).expectedRevision, MAX - 1);
  assert.throws(() => parseCommand(q(), { ...command, expectedRevision: MAX }));
  assert.throws(() => parseCommand(q(), { ...command, expectedRevision: 20, expectedVersion: 21 }));
  assert.throws(() => parsePeriodClosureCommand(oldQuery("detail"), { ...command, expectedRevision: 101 }));
  assert.throws(() => parsePeriodClosureQuery({ ...oldQuery("export"), version: 21 }));
  assert.throws(() => parsePeriodClosureResult(detail(), oldQuery("detail")));
});
test("write queries remain owner/self bounded and cannot accept cursor, archive or authority extras", () => {
  assert.deepEqual(parsePeriodClosureV2Body({ query: q(), command: oldCommand() }).command, oldCommand());
  assert.throws(() => parsePeriodClosureV2Body({ query: q(), command: oldCommand(), artifact: artifact() }));
  assert.throws(() => parseCommand(q("history"), oldCommand()));
  for (const access of ["owner", "self"] as const) for (const action of access === "owner" ? ["confirm", "dispute"] : ["send", "seal", "reopen", "respond"]) assert.throws(() => parseCommand(q("detail", access), { ...oldCommand(), action, expectedRevision: 1, expectedVersion: 1 }));
});
test("v2 detail accepts high head and just one artifact, rejects even an empty fake history", () => {
  const value = detail(); assert.deepEqual(parseResult(value, q(), { authUserId: owner }), value);
  assert.throws(() => parseResult({ ...value, history: [] }, q()));
  assert.throws(() => parseResult({ ...value, protocol: "period-closure-v1" }, q()));
  assert.throws(() => parseResult({ ...value, artifactVersion: 20 }, q()));
  assert.throws(() => parseResult({ ...value, period: { ...summary(), revision: MAX + 1 } }, q()));
});
test("terminal integer head is readable but cannot falsely claim a terminal seal or overflowing saved entry", () => {
  const value = detail(); assert.equal(value.kind, "detail"); if (value.kind !== "detail") return;
  value.period.revision = MAX; value.period.state = "open";
  assert.equal(parseResult(value, q()).kind, "detail");
  assert.throws(() => parseResult({ ...value, period: { ...value.period, state: "sealed", sealed: true, confirmedVersion: 21 } }, q()));
  const command = { ...oldCommand(), action: "reopen" as const, expectedRevision: MAX - 1, expectedVersion: 21, expectedFingerprint: null };
  const recoveredQuery = q("recover"), receipt = { ...value, sourceChanged: null, operation: oldEntry(command), replayed: true };
  assert.equal(parseResult(receipt, recoveredQuery, { authUserId: owner }, command).kind, "detail");
  assert.throws(() => parseResult({ ...receipt, operation: { ...receipt.operation, revision: MAX + 1 } }, recoveredQuery));
});
test("original receipt remains version1 beside high current head and binds complete old intent", () => {
  const query = q("recover"), command = oldCommand(), value = detail(query, command);
  assert.deepEqual(parseResult(value, query, { authUserId: owner }, command), value);
  for (const patch of [{ replayed: false }, { sourceChanged: false }, { artifactVersion: 21 }, { operation: { ...oldEntry(command), actorId: auth } }]) assert.throws(() => parseResult({ ...value, ...patch }, query, { authUserId: owner }, command));
  assert.throws(() => parseResult(value, query, { authUserId: owner }, { ...command, reason: "changed" }));
});
test("self local employee and actual authenticated actor remain different identities", () => {
  const query = q("detail", "self"), value = detail(query);
  assert.deepEqual(parseResponse({ ok: true, moduleEnabled: false, data: value }, query, { employeeId: employee, authUserId: auth }).data, value);
  assert.throws(() => parseResult(value, query, { employeeId: auth }));
  assert.throws(() => parseResult(value, query, { authUserId: employee }));
  assert.throws(() => parseResponse({ ok: true, moduleEnabled: true, data: value, canWrite: true }, query));
});
test("history traverses 101 entries as 50+50+1 with fixed snapshot despite a newer head", () => {
  let query = q("history"); const seen: number[] = [];
  for (let page = 0; page < 3; page++) {
    const value = parseResult(history(query, page === 0 ? 101 : 150), query); assert.equal(value.kind, "history"); if (value.kind !== "history") return;
    seen.push(...value.items.map(x => x.revision)); if (page < 2) { assert(value.nextCursor); query = { ...query, cursor: value.nextCursor }; } else assert.equal(value.nextCursor, null);
  }
  assert.deepEqual(seen, Array.from({ length: 101 }, (_, i) => 101 - i));
});
test("history rejects holes, duplicate operations, short pages and false exhaustion", () => {
  const query = q("history"), original = history(query); assert.equal(original.kind, "history"); if (original.kind !== "history") return;
  const bad = structuredClone(original); bad.items.pop(); assert.throws(() => parseResult(bad, query));
  assert.throws(() => parseResult({ ...original, nextCursor: null }, query));
  const gap = structuredClone(original); gap.items[1] = gap.items[0]; assert.throws(() => parseResult(gap, query));
  const wrong = { ...original, nextCursor: { ...original.nextCursor, beforeRevision: 53 } }; assert.throws(() => parseResult(wrong, query));
  assert.throws(() => parseResult({ ...original, period: { ...original.period, revision: 49 } }, query));
});
test("version metadata pages are 20+1, body-free and allow immutable artifact reuse", () => {
  const query = q("versions"), first = parseResult(versions(query), query); assert.equal(first.kind, "versions"); if (first.kind !== "versions") return;
  assert.equal(first.items.length, 20); assert.equal(new Set(first.items.map(x => x.artifactId)).size, 1);
  const secondQuery = { ...query, cursor: first.nextCursor }, second = parseResult(versions(secondQuery, 30), secondQuery);
  assert.equal(second.kind, "versions"); if (second.kind !== "versions") return; assert.equal(second.items.length, 1); assert.equal(second.items[0].version, 1); assert.equal(second.nextCursor, null);
  for (const patch of [{ artifactBytes: 2097153 }, { sourceFingerprint: "BAD" }, { artifact: artifact() }]) assert.throws(() => parseResult({ ...first, items: [{ ...first.items[0], ...patch }, ...first.items.slice(1)] }, query));
});
test("list uses intersecting saved dates, not the browser window as a fake fixed period", () => {
  const query = { ...q("list"), fromDate: "2026-08-31", throughDate: "2026-09-02" };
  const item = { ...summary(), openedAt: "2026-09-11T10:00:00.000001Z" };
  const value = { ...common(query), kind: "list", items: [item], nextCursor: null };
  assert.deepEqual(parseResult(value, query), value);
  for (const patch of [{ fromDate: "2026-09-03" }, { throughDate: "2026-08-30" }, { fromDate: "2026-07-01" }, { openedAt: "2026-09-11T10:00:00.000Z" }]) assert.throws(() => parseResult({ ...value, items: [{ ...item, ...patch }] }, query));
});
test("list cursor is deterministic timestamp+ID descending, scoped and at the exact last item", () => {
  const query = q("list"), items = Array.from({ length: 25 }, (_, n) => ({ ...summary(), periodId: id(5000 - n), openedAt: "2026-09-11T10:00:00.000001Z" }));
  const nextCursor = { ...scope(query), kind: "list", periodId: null, atOpenedAt: items[0].openedAt, atPeriodId: items[0].periodId, beforeOpenedAt: items[24].openedAt, beforePeriodId: items[24].periodId } as Cursor;
  const value = { ...common(query), kind: "list", items, nextCursor }; assert.deepEqual(parseResult(value, query), value);
  assert.throws(() => parseResult({ ...value, items: [...items].reverse() }, query));
  assert.throws(() => parseResult({ ...value, nextCursor: { ...nextCursor, beforePeriodId: items[23].periodId } }, query));
  assert.throws(() => parseResult(value, { ...query, cursor: nextCursor }));
});
test("archived artifact shares the unchanged parser and never needs current tzdata", () => {
  const query = { ...q("detail"), version: 1 }, value = detail(query); assert.equal(value.kind, "detail"); if (value.kind !== "detail" || !value.artifact) return;
  value.artifact.period.timeZone = "Saved/NotCurrent"; value.artifact.report.base.timeZone = "Saved/NotCurrent"; value.period.timeZone = "Saved/NotCurrent";
  assert.deepEqual(parseResult(value, query), value);
  assert.throws(() => parseResult({ ...value, sourceChanged: false }, query));
});
test("upgrade and unchanged64MiB storage errors are explicit, not automatic deletion suggestions", () => {
  assert.match(periodClosureV2Message("attendance_period_protocol_required"), /不表示操作失败/);
  assert.match(periodClosureV2Message("attendance_period_storage_limit"), /64 MiB/);
  assert.match(periodClosureV2Message("attendance_period_storage_limit"), /未删除/);
});
