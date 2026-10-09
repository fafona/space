import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import Launcher from "../components/enterprise/MerchantAttendanceMissingLauncher";
import Panel from "../components/enterprise/MerchantAttendanceMissingPanel";
import { confirmMissingPanelLeave, missingInitialQuery, type MissingInitialSelection } from "./merchantAttendanceMissingSelection";
import { AttendanceMissingClient } from "./merchantAttendanceMissingClient";
import { parseMissingBody, parseMissingQuery, parseMissingResult, type MissingCommand, type MissingQuery, type MissingResult } from "./merchantAttendanceMissing";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(1), selection = { requestId: id(100), submittedAt: "2026-10-01T00:00:00.000001Z" };
const target = () => missingInitialQuery(siteId, "owner", selection);
const oldQuery = (): MissingQuery => ({ ...target(), fromDate: "2026-09-30", throughDate: "2026-09-30", requestId: id(101) });
const command = (): MissingCommand => ({ operationId: id(102), reason: "明确核对原申请", action: "approve", requestId: id(101), expectedRevision: 1, evidenceToken: "a".repeat(32) });
const component = (name: string) => readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8");
function wire(q: MissingQuery, saved = false): MissingResult {
  const summary = { requestId: q.requestId!, employeeId: id(2), workerName: "受审员工", startAt: "2026-09-28T08:00:00.000000Z", endAt: "2026-09-28T09:00:00.000000Z",
    submittedAt: `${q.fromDate}T00:00:00.000001Z`, revision: saved ? 2 : 1, status: saved ? "approved" as const : "submitted" as const };
  return { siteId, access: "owner", employeeId: null, workerId: null, locationId: null, timeZone: "Europe/Madrid", canRequest: false,
    settingsVersion: 1, policyRevision: 1, fromDate: q.fromDate, throughDate: q.throughDate, asOf: "2026-10-02T12:00:00.000000Z", items: [summary], nextCursor: null,
    detail: { ...summary, lineage: null, reason: "先前提交的整段漏卡申请", proposal: { startAt: summary.startAt, endAt: summary.endAt, breaks: [] }, locationName: "原门店", timeZone: "Europe/Madrid",
      policyRevision: 1, deadlineAt: "2026-10-31T00:00:00.000000Z", terminal: saved ? { reason: command().reason, recordedAt: "2026-10-02T11:00:00.000000Z" } : null,
      issues: saved ? ["terminal"] : [], evidenceToken: "b".repeat(32), canApprove: !saved, canReject: !saved },
    receipt: saved ? { operationId: command().operationId, requestId: id(101), revision: 2, command: command() } : null, includedInTimesheet: false, moduleEnabled: true };
}
function storageFixture() {
  const values = new Map<string, string>();
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } };
}
function clientFixture(saved = false) {
  const { values, storage } = storageFixture(), calls: { method: string; query: MissingQuery }[] = [];
  const client = new AttendanceMissingClient({ query: target(), actorId, storage: () => storage, apiFetch: async (url, init) => {
    assert.notEqual(init?.method, "POST"); const query = parseMissingQuery(new URL(url, "https://local.invalid").href); calls.push({ method: init?.method ?? "GET", query });
    const data = wire(query, saved); parseMissingResult(data, query); return Response.json({ ok: true, ...data });
  } });
  const body = parseMissingBody({ query: oldQuery(), command: command() });
  return { client, calls, values, raw: JSON.stringify({ actorId, ...body }) };
}

test("backlog target uses its exact UTC submission day, not work dates or local timezone", () => {
  assert.deepEqual(target(), { siteId, access: "owner", fromDate: "2026-10-01", throughDate: "2026-10-01", requestId: id(100), operationId: null, beforeAt: null, beforeId: null });
  for (const submittedAt of ["2026-03-29T00:59:59.999999Z", "2026-10-25T23:59:59.999999Z"]) {
    const q = missingInitialQuery(siteId, "owner", { ...selection, submittedAt }); assert.equal(q.fromDate, submittedAt.slice(0, 10)); assert.equal(q.throughDate, q.fromDate);
  }
});
test("untargeted old owner and self entry retain inclusive 31 UTC submission days", () => {
  for (const access of ["owner", "self"] as const) {
    const q = missingInitialQuery(siteId, access, null, Date.parse("2026-10-01T23:59:59Z"));
    assert.equal(q.fromDate, "2026-09-01"); assert.equal(q.throughDate, "2026-10-01"); assert.equal(q.requestId, null); assert.equal(q.access, access);
  }
});
test("target rejects wrong access, noncanonical timestamp, impossible dates, malformed UUID and injected evidence", () => {
  assert.throws(() => missingInitialQuery(siteId, "self", selection));
  for (const value of [
    { ...selection, requestId: null }, { ...selection, requestId: "not-a-uuid" }, { ...selection, submittedAt: "2026-02-30T00:00:00.000000Z" },
    { ...selection, submittedAt: "2026-10-01T00:00:00.000Z" }, { ...selection, submittedAt: "2026-10-01T00:00:00.000000+02:00" },
    { ...selection, submittedAt: "2026-10-01" }, { ...selection, evidenceToken: "a".repeat(32) }, { ...selection, operationId: id(102) }, [],
  ]) assert.throws(() => missingInitialQuery(siteId, "owner", value as MissingInitialSelection));
});
test("fresh selected owner entry initializes exactly one GET for the request and no POST", async () => {
  const f = clientFixture(); await f.client.initialize();
  assert.deepEqual(f.calls, [{ method: "GET", query: target() }]); assert.equal(f.client.getSnapshot().phase, "ready");
  assert.equal(f.client.getSnapshot().result?.detail?.requestId, selection.requestId); assert.equal(f.values.size, 0);
});
test("different stored original query and operation take priority over backlog target", async () => {
  const f = clientFixture(); f.values.set(f.client.storageKey, f.raw); await f.client.initialize();
  assert.deepEqual(f.calls, [{ method: "GET", query: { ...oldQuery(), operationId: command().operationId } }]);
  assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.client.getSnapshot().pending?.command.operationId, command().operationId);
  assert.equal(f.values.get(f.client.storageKey), f.raw); assert.deepEqual(f.client.getSnapshot().query, oldQuery());
});
test("successful original receipt recovery stays on the original request without a second target GET", async () => {
  const f = clientFixture(true); f.values.set(f.client.storageKey, f.raw); await f.client.initialize();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].query.requestId, id(101)); assert.equal(f.calls[0].query.operationId, command().operationId);
  assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.client.getSnapshot().pending, null); assert.equal(f.values.size, 0);
  assert.equal(f.client.getSnapshot().result?.receipt?.operationId, command().operationId); assert.deepEqual(f.client.getSnapshot().query, oldQuery());
});
test("malformed or foreign pending blocks new target reads without changing storage", async () => {
  for (const raw of ["{bad", JSON.stringify({ actorId: id(9), query: oldQuery(), command: command() }), JSON.stringify({ actorId, query: { ...oldQuery(), siteId: "99990002" }, command: command() })]) {
    const f = clientFixture(); f.values.set(f.client.storageKey, raw); await f.client.initialize();
    assert.equal(f.calls.length, 0); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.values.get(f.client.storageKey), raw);
  }
});
test("fresh GET denial never creates a pending operation or falls through to approval", async () => {
  const { values, storage } = storageFixture(); let calls = 0;
  const client = new AttendanceMissingClient({ query: target(), actorId, storage: () => storage, apiFetch: async (_url, init) => {
    calls++; assert.notEqual(init?.method, "POST"); return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
  } });
  await client.initialize(); assert.equal(calls, 1); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null); assert.equal(values.size, 0);
});
test("pause hides a late target GET result while preserving the exact original operation", async () => {
  const { values, storage } = storageFixture(); let release!: (r: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; }); let requested: MissingQuery | null = null;
  const client = new AttendanceMissingClient({ query: target(), actorId, storage: () => storage, apiFetch: async (url, init) => { assert.notEqual(init?.method, "POST"); requested = parseMissingQuery(new URL(url, "https://local.invalid").href); return response; } });
  const raw = JSON.stringify({ actorId, ...parseMissingBody({ query: oldQuery(), command: command() }) }); values.set(client.storageKey, raw);
  const reading = client.initialize(); client.pause(); release(Response.json({ ok: true, ...wire({ ...oldQuery(), operationId: command().operationId }, true) })); await reading;
  assert.deepEqual(requested, { ...oldQuery(), operationId: command().operationId }); assert.equal(client.getSnapshot().result, null);
  assert.equal(client.getSnapshot().phase, "unconfirmed"); assert.equal(values.get(client.storageKey), raw);
});
test("actual launcher keeps old labels and controlled hidden-trigger/disabled contracts without render-time HTTP", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected HTTP"); };
  for (const access of ["owner", "self"] as const) {
    const props = { siteId, actorId, access, apiFetch };
    assert.match(render(<Launcher {...props} enabled/>), access === "owner" ? /整段漏卡审核/ : /整段漏卡申请/);
    assert.equal(render(<Launcher {...props} enabled={false}/>), "");
    assert.equal(render(<Launcher {...props} enabled open={false} showTrigger={false}/>), "");
    assert.match(render(<Launcher {...props} enabled open={false} disabled/>), /disabled=""/);
  }
  assert.equal(calls, 0);
});
test("actual target panel initially displays the UTC query but cannot display cached backlog approval evidence", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected HTTP"); };
  const html = render(<Panel siteId={siteId} actorId={actorId} access="owner" apiFetch={apiFetch} initialSelection={selection} onClose={() => {}}/>);
  assert.match(html, /整段漏卡审核工作区/); assert.equal((html.match(/value="2026-10-01"/g) ?? []).length, 2);
  assert(!html.includes("批准整段申请")); assert(!html.includes("驳回整段申请")); assert.equal(calls, 0);
});
test("invalid owner target and any self target fail closed without reading", () => {
  let calls = 0; const apiFetch = async () => { calls++; throw Error("unexpected HTTP"); };
  for (const [access, initialSelection] of [["self", selection], ["owner", { ...selection, requestId: "bad" }]] as const) {
    const html = render(<Panel siteId={siteId} actorId={actorId} access={access} apiFetch={apiFetch} initialSelection={initialSelection} onClose={() => {}}/>);
    assert.match(html, /漏卡目标无效/); assert(!html.includes("查询申请")); assert(!html.includes("批准整段申请"));
  }
  assert.equal(calls, 0);
});
test("panel injects only the constructor query; no target reset/load effect or automatic POST is added", () => {
  const panel = component("MerchantAttendanceMissingPanel"), launcher = component("MerchantAttendanceMissingLauncher");
  assert.match(panel, /const \[query\] = useState\(initialQuery\)/);
  assert.match(panel, /query, actorId, \.\.\.applicationWindowLegacyPorts\(apiFetch, \(\) => window\.sessionStorage,isCurrentAuth\)/);
  assert.match(panel, /if \(document.visibilityState !== "hidden"\) void client.initialize\(\)/);
  assert.match(panel, /return \(\) => \{ document.removeEventListener\("visibilitychange", visibility\); client.pause\(\); \}/);
  assert(!panel.includes("client.load(initialQuery")); assert(!panel.includes("client.initialize().then"));
  assert.match(panel, /if \(leave\(\)\) onClose\(\)/);
  assert.match(panel, /registerLeaveGuard\?\.\(leave\); return \(\) => registerLeaveGuard\?\.\(null\)/);
  assert.match(panel, /current: \(\) => client.getSnapshot\(\) === snapshot/);
  assert.match(launcher, /open = controlledOpen \?\? localOpen/);
  assert.match(launcher, /if \(controlledOpen === undefined\) setLocalOpen\(next\); onOpenChange\?\.\(next\)/);
  assert.match(launcher, /return open \?/); assert.match(launcher, /: showTrigger \?/);
  assert.equal((launcher.match(/<Panel /g) ?? []).length, 1); assert(!launcher.includes("client."));
});
test("registered leave guard follows the old two confirmations and pauses only after acceptance", () => {
  for (const [dirty, pending, responses, expected] of [
    [false, false, [], true], [true, false, [false], false], [false, true, [false], false],
    [true, true, [true, false], false], [true, true, [true, true], true],
  ] as const) {
    const prompts: string[] = []; let paused = 0;
    assert.equal(confirmMissingPanelLeave({ dirty, pending, confirm: message => { prompts.push(message); return responses[prompts.length - 1] ?? false; }, current: () => true, pause: () => { paused++; } }), expected);
    assert.equal(paused, expected ? 1 : 0); assert.equal(prompts.length, responses.length);
    if (dirty && prompts.length) assert.match(prompts[0], /尚未提交/);
    if (pending && prompts.at(-1) && (!dirty || responses.length > 1)) assert.match(prompts.at(-1)!, /查询原编号/);
  }
});
test("changed state during a leave confirmation does not pause or authorize navigation", () => {
  let current = true, paused = 0;
  assert.equal(confirmMissingPanelLeave({ dirty: true, pending: true, confirm: () => { current = false; return true; }, current: () => current, pause: () => { paused++; } }), false);
  assert.equal(paused, 0);
  assert.equal(confirmMissingPanelLeave({ dirty: false, pending: false, confirm: () => assert.fail("no confirmation"), current: () => false, pause: () => { paused++; } }), false);
  assert.equal(paused, 0);
});
