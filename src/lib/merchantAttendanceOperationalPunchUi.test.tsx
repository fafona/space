// Pure command/transport + SSR controls. Not real Auth, SQL or hardware evidence.
import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationalPunchChoices } from "../components/enterprise/MerchantAttendanceOperationalPunchWorkspace";
import OperationalPunchHost from "../components/enterprise/MerchantAttendanceOperationalPunchHost";
import { operationalPunchUiBlockedKeys, operationalPunchUiCommand, operationalPunchUiContext, operationalPunchUiErrors, operationalPunchUiNewKeys, operationalPunchUiPendingRoutes, operationalPunchUiTransport } from "./merchantAttendanceOperationalPunchUi";
import { operationalPunchPendingKey, type OperationalPunchClientScope } from "./merchantAttendanceOperationalPunchClient";
import type { OperationalPunchResult } from "./merchantAttendanceOperationalPunch";
import { punchFixture, punchStartFixture, punchId as id, punchSite as siteId } from "./merchantAttendanceOperationalPunchTestFixtures";
const scope: OperationalPunchClientScope = { siteId, channel: "self", authUserId: id(3), terminalId: null, workerNo: null };
const noop = () => {};

test("242 choices do not default slot or paid/unpaid; explicit null is a real start choice", async () => {
  const f = await punchFixture(true), html = renderToStaticMarkup(<OperationalPunchChoices result={f.result} selection="" breakType="" disabled={false} onSelection={noop} onBreakType={noop}/>);
  assert.match(html, /value="" selected="">请明确选择/); assert.match(html, /value="none">不关联排班/);
  assert.throws(() => operationalPunchUiCommand(f.result, "clock_in", id(20), undefined, null), /explicit_selection_required/);
  const command = operationalPunchUiCommand(f.result, "clock_in", id(20), null, null); assert.deepEqual(command.choice, { kind: "start", expectedPolicyFingerprint: f.policy.policyFingerprint, selection: null });
});

test("242 slot CAS comes only from the current returned id/revision, receipt cannot confer fresh CAS", async () => {
  const f = await punchFixture(), s = await punchStartFixture();
  const entry = { id: id(90), revision: 3, locationId: id(4), locationName: "合成地点", timeZone: "UTC", workDate: "2026-10-08", startAt: "2026-10-08T11:00:00.000Z", endAt: "2026-10-08T16:00:00.000Z", cancelled: false, hasPublicationEvidence: true };
  const result = { ...f.result, choices: { timeZone: "UTC", fromDate: "2026-10-08", throughDate: "2026-10-08", revision: 3, limited: false, entries: [entry] } };
  assert.deepEqual(operationalPunchUiCommand(result, "clock_in", id(20), { slotId: id(90), revision: 3 }, null).choice, { kind: "start", expectedPolicyFingerprint: f.policy.policyFingerprint, selection: { slotId: id(90), revision: 3 } });
  assert.throws(() => operationalPunchUiCommand(result, "clock_in", id(20), { slotId: id(90), revision: 2 }, null), /selection_changed/);
  assert.throws(() => operationalPunchUiCommand(s.result, "clock_out", id(25), null, null), /fresh_read_required/);
});

test("242 managed explicit break requires allowed type; legacy break never invents a session", async () => {
  const f = await punchStartFixture(true), result = { ...f.result, operation: null, canBreak: true, canFinish: true, clock: { ...f.result.clock, receipt: null } };
  const html = renderToStaticMarkup(<OperationalPunchChoices result={result} selection="" breakType="" disabled={false} onSelection={noop} onBreakType={noop}/>);
  assert.match(html, /本次休息类型/); assert.match(html, /value="" selected="">请明确选择/);
  assert.throws(() => operationalPunchUiCommand(result, "break_start", id(25), null, null), /explicit_break_required/);
  assert.deepEqual(operationalPunchUiCommand(result, "break_start", id(25), null, "paid").choice, { kind: "break", startEventId: f.session.startEventId, expectedSessionFingerprint: f.session.sessionFingerprint, breakType: "paid" });
  assert.deepEqual(operationalPunchUiCommand({ ...result, session: null }, "break_start", id(25), null, null).choice, { kind: "legacy_break" });
  assert.throws(() => operationalPunchUiCommand({ ...result, session: null }, "break_start", id(25), null, "paid"));
});

function locationResult(base: Awaited<ReturnType<typeof punchFixture>>["result"]): OperationalPunchResult<"location"> {
  return { ...base, channel: "location", clock: { ...base.clock, siteId, employeeId: id(2), channelEnabled: true, policy: { settingsVersion: 4, workerVersion: 2, locationVersion: 5, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 }, locationResult: null,
    noticeGate: { ready: true, reason: "ready", revision: 2 }, finish: null, receiptGate: null } };
}
test("242 location start uses exact current notice/versions; original-location finish needs no coordinates or new notice", async () => {
  const f = await punchFixture(), result = locationResult(f.result), command = operationalPunchUiCommand(result, "clock_in", id(20), null, null);
  assert.deepEqual(Object.keys(command.clock).sort(), ["action", "expectedSequence", "expectedWorkerId", "locationId", "locationVersion", "noticeRevision", "operationId", "safeFinish", "settingsVersion", "workerVersion"].sort());
  assert.ok("noticeRevision" in command.clock); assert.equal(command.clock.noticeRevision, 2);
  const closedNotice = { ...result, canStart: false, canFinish: true, clock: { ...result.clock, state: { ...result.clock.state, status: "working" as const }, noticeGate: { ready: false, reason: "withdrawn" as const, revision: null }, finish: { settingsVersion: 8, workerVersion: 9, locationVersion: 10, locationId: id(77) } } };
  assert.throws(() => operationalPunchUiCommand(closedNotice, "clock_out", id(30), null, null), /location_notice_required/);
  const finish = operationalPunchUiCommand(closedNotice, "clock_out", id(30), null, null, true); assert.ok("safeFinish" in finish.clock); assert.equal(finish.clock.safeFinish, true); assert.equal(finish.clock.noticeRevision, null); assert.equal(finish.clock.locationId, id(77)); assert.equal(finish.clock.settingsVersion, 8);
});

test("242 old-slot interlocks include five web originals and both terminal originals without upgrading them", () => {
  const keys = operationalPunchUiBlockedKeys(scope, id(2)); assert.equal(keys.length, 9); assert.equal(new Set(keys).size, 9);
  assert.ok(keys.includes(`faolla:attendance:self:v1:${siteId}:${id(2)}`)); assert.ok(keys.includes(`faolla:attendance:location-clock:v1:${siteId}:${id(2)}`));
  assert.equal(keys.includes(operationalPunchPendingKey(scope)), false); assert.equal(operationalPunchUiNewKeys(scope).length, 3);
  const pinScope: OperationalPunchClientScope = { siteId, channel: "pin", authUserId: null, terminalId: id(50), workerNo: "A-01" };
  assert.equal(operationalPunchUiBlockedKeys(pinScope, null).length, 2); assert.equal(operationalPunchUiNewKeys(pinScope).length, 1);
  assert.deepEqual(operationalPunchUiContext(pinScope, null, null), { siteId, channel: "pin", authUserId: null, terminalId: id(50), workerNo: "A-01", expectedWorkerId: null, expectedEmployeeId: null });
  assert.throws(() => operationalPunchUiContext({ ...scope, channel: "location" }, null, id(2)), /identity_required/);
});

test("242 web prepare/recover are GET and never acquire QR/GPS/PIN", async () => {
  for (const channel of ["self", "location", "onsite"] as const) {
    let credentials = 0; const calls: { url: string; init?: RequestInit }[] = [];
    const t = operationalPunchUiTransport({ ...scope, channel }, async (url, init) => { calls.push({ url, init }); return new Response("{}"); }, id(1), async () => { credentials++; return {}; });
    const signal = new AbortController().signal; await t({ mode: "prepare" }, null, signal); await t({ mode: "recover", operationId: id(20) }, null, signal);
    assert.equal(credentials, 0); assert.equal(calls.length, 2); assert.ok(calls.every(c => c.init?.method === "GET" && c.init.body === undefined)); assert.match(calls[1].url, /operationId=/);
    assert.equal(new URL(calls[0].url, "https://test.invalid").searchParams.get("expectedWorkerId"), channel === "location" ? id(1) : null);
  }
});

test("242 four POST envelopes carry secrets only outside full non-secret command; PIN read is authenticated POST", async () => {
  const f = await punchFixture();
  for (const channel of ["self", "location", "onsite", "pin"] as const) {
    const s: OperationalPunchClientScope = channel === "pin" ? { siteId, channel, authUserId: null, terminalId: id(50), workerNo: "A-01" } : { ...scope, channel };
    const r: OperationalPunchResult = channel === "location" ? locationResult(f.result) : channel === "self" ? f.result : channel === "onsite" ? { ...f.result, channel, clock: { ...f.result.clock, employeeId: id(2) } }
      : { ...f.result, channel, clock: { ...f.result.clock, siteId, terminalId: id(50), workerNo: "A-01", workerName: "合成员工", employeeId: id(2), canStart: true, canFinish: false, blockReason: null } };
    const command = operationalPunchUiCommand(r, "clock_in", id(20), null, null), calls: RequestInit[] = [];
    const transient = { pin: "12345678", token: "synthetic-token", position: { latitude: 1, longitude: 2, accuracyMeters: 3, capturedAt: "2026-10-08T12:00:00.000Z" }, positionFailure: null };
    const t = operationalPunchUiTransport(s, async (_url, init) => { calls.push(init!); return new Response("{}"); }, id(1), async () => transient);
    await t({ mode: "recover", operationId: id(20) }, command, new AbortController().signal);
    const body = JSON.parse(String(calls[0].body)); assert.deepEqual(body.command, command); assert.doesNotMatch(JSON.stringify(body.command), /12345678|synthetic-token|latitude/);
    assert.equal(body.pin, channel === "pin" ? transient.pin : undefined); assert.equal(body.token, channel === "onsite" ? transient.token : undefined); assert.equal(body.position?.latitude, channel === "location" ? 1 : undefined);
    if (channel === "pin") { await t({ mode: "prepare" }, null, new AbortController().signal); const read = JSON.parse(String(calls[1].body)); assert.equal(read.command, null); assert.equal(read.pin, "12345678"); assert.equal(read.terminalId, undefined); assert.equal(read.siteId, undefined); }
    assert.equal(operationalPunchUiErrors(channel).attendance_operational_punch_changed, 409);
  }
});

test("242 transient acquisition abort prevents any late POST", async () => {
  const f = await punchFixture(), command = operationalPunchUiCommand(f.result, "clock_in", id(20), null, null), controller = new AbortController(); let requests = 0;
  const t = operationalPunchUiTransport(scope, async () => { requests++; return new Response("{}"); }, null, async () => { controller.abort(); return {}; });
  await assert.rejects(t({ mode: "recover", operationId: id(20) }, command, controller.signal), /aborted/); assert.equal(requests, 0);
});

test("242 actual four hosts isolate legacy writers, current Auth and short-lived credentials", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const name of ["SelfPanel", "LocationClockPanel", "OnsitePhone"]) assert.match(read(`../components/enterprise/MerchantAttendance${name}.tsx`), /<OperationalPunchHost/);
  const pin = read("../components/enterprise/MerchantAttendancePinClock.tsx"); assert.match(pin, /<OperationalPunchWorkspace/); assert.match(pin, /sessionStorage\.getItem\(operationalPunchPendingKey/);
  assert.match(read("../components/enterprise/MerchantAttendanceEmployeeLocationWorkspace.tsx"), /authUserId=\{authUserId\}/);
  const ui = read("../components/enterprise/MerchantAttendanceOperationalPunchWorkspace.tsx"); assert.match(ui, /Date\.now\(\) \+ 30000/); assert.match(ui, /decodeOnsiteToken\(value\)\.expiresAtMs/); assert.match(ui, /client\.getSnapshot\(\) !== snapshot/); assert.match(ui, /flushSync/); assert.match(ui, /registerLeaveGuard\?\.\(leave\)/); assert.match(ui, /secret\.current = null/); assert.doesNotMatch(ui, /localStorage/);
});

test("242 enclosing self host discovers only same-Auth saved web routes, including location recovery worker, without writing", async () => {
  const f = await punchFixture(), locScope: OperationalPunchClientScope = { ...scope, channel: "location" }, loc = operationalPunchUiCommand(locationResult(f.result), "clock_in", id(20), null, null);
  const entries = new Map([[operationalPunchPendingKey(locScope), JSON.stringify({ version: 1, scope: locScope, command: loc })], [operationalPunchPendingKey({ ...scope, authUserId: id(88) }), "foreign should not be read"]]);
  const reads: string[] = [], storage = { getItem: (key: string) => { reads.push(key); return entries.get(key) ?? null; } };
  assert.deepEqual(operationalPunchUiPendingRoutes(scope, storage), [{ scope: locScope, valid: true, workerId: id(1) }]); assert.equal(reads.length, 3); assert.ok(reads.every(k => !k.includes(id(88))));
  entries.set(operationalPunchPendingKey(scope), "broken"); assert.deepEqual(operationalPunchUiPendingRoutes(scope, storage)[0], { scope, valid: false, workerId: null });
  const host = readFileSync(new URL("../components/enterprise/MerchantAttendanceOperationalPunchHost.tsx", import.meta.url), "utf8");
  assert.match(host, /选择原号通路/); assert.match(host, /recoveryOnly=\{mode\.target\.scope\.channel !== channel\}/); assert.doesNotMatch(host, /removeItem|setItem/);
});

test("242 new scope masks draft/PIN before effect; a consumed unchanged onsite prop is not re-armed", () => {
  const ui = readFileSync(new URL("../components/enterprise/MerchantAttendanceOperationalPunchWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /pin = draft\.marker === marker \? draft\.pin : ""/);
  assert.match(ui, /secret\.current\.marker !== marker/);
  assert.match(ui, /tokenRef\.current\.marker !== marker \|\| tokenRef\.current\.token !== token/);
  assert.match(ui, /held\.consumed \|\| !value/); assert.match(ui, /held\.consumed = true; consumeToken/);
  assert.match(ui, /recoveryOnly && scope\.channel === "location"/); assert.match(ui, /recoveryOnly && !recoveryRetryAllowed/);
  assert.match(ui, /recoveryOnly && !pending/); assert.match(ui, /在定位通路重试此原号/);
});

test("201 self reminder mount hint is local-only, one initial scope, StrictMode-safe and leaves default legacy/pending behavior intact", () => {
  let calls = 0;
  for (const requested of [undefined, true]) {
    const html = renderToStaticMarkup(<OperationalPunchHost scope={scope} employeeId={id(2)} openOperationalOnMount={requested}
      apiFetch={async () => { calls++; throw Error("unexpected_HTTP"); }}><p>synthetic legacy child</p></OperationalPunchHost>);
    assert.match(html, /正在检查本标签页待确认编号/); assert.doesNotMatch(html, /synthetic legacy child|确认规则上班/);
  }
  assert.equal(calls, 0);
  const host = readFileSync(new URL("../components/enterprise/MerchantAttendanceOperationalPunchHost.tsx", import.meta.url), "utf8");
  const self = readFileSync(new URL("../components/enterprise/MerchantAttendanceSelfPanel.tsx", import.meta.url), "utf8");
  assert.match(host, /openOperationalOnMount = false/); assert.match(self, /openOperationalOnMount = false/); assert.match(self, /openOperationalOnMount=\{openOperationalOnMount\}/);
  assert.match(host, /if \(initialOpen\.current\.key !== key\) initialOpen\.current = \{ key, requested: false \}/);
  assert.match(host, /if \(!initialOpen\.current\.requested\) setMode\(inspect\(false\)\)/);
  assert.match(host, /previous\?\.key === key \? previous : inspect\(true\)/);
  assert.match(host, /target = routes\.find/); assert.match(host, /routes\[0\] \?\? fallback/); assert.match(host, /onClose=\{\(\) => setMode\(inspect\(false\)\)\}/);
  assert.doesNotMatch(host, /\.prepare\(|\.submit\(|setItem|removeItem|fetch\(|initialResult/);
});
