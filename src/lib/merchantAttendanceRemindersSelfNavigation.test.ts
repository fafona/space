// Synthetic 193 HTTP evidence only, not actual SQL/Auth or a clock write.
import test from "node:test";
import assert from "node:assert/strict";
import { AttendanceReminderSelfNavigation, reminderSelfNavigationPendingKeys, type ReminderSelfSessionTarget } from "./merchantAttendanceRemindersSelfNavigation";
import { operationalPunchPolicyFingerprint, operationalPunchSessionFingerprint, type OperationalPunchResult } from "./merchantAttendanceOperationalPunch";
import { operationalPunchPendingKey } from "./merchantAttendanceOperationalPunchClient";
import { punchFixture, punchStartFixture, punchId as id, punchSite as siteId } from "./merchantAttendanceOperationalPunchTestFixtures";
const target: ReminderSelfSessionTarget = { kind: "open_session", workerId: id(1), startEventId: id(21) };
const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { "content-type": "application/json" } });
async function currentSession(pinStart = false): Promise<OperationalPunchResult<"self">> {
  const f = await punchStartFixture(true);
  let session = f.session;
  if (pinStart) {
    session = { ...session, channel: "pin", actorAuthUserId: null, policyFingerprint: await operationalPunchPolicyFingerprint(siteId, "pin", f.policy, f.source) };
    session = { ...session, sessionFingerprint: await operationalPunchSessionFingerprint(siteId, session) };
  }
  return { ...f.result, session, operation: null, clock: { ...f.result.clock, receipt: null }, canBreak: true, canFinish: true };
}
function fixture(result: unknown, extra: { response?: () => Response | Promise<Response>; current?: () => boolean; timeoutMs?: number } = {}) {
  const values = new Map<string, string>(), calls: { url: string; init?: RequestInit }[] = [];
  const options = { siteId, actorId: id(3), employeeId: id(2), storage: () => ({ getItem: (key: string) => values.get(key) ?? null }),
    isCurrentAuth: extra.current ?? (() => true), timeoutMs: extra.timeoutMs,
    apiFetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return extra.response ? extra.response() : reply(result); } };
  return { options, values, calls, client: new AttendanceReminderSelfNavigation(options) };
}

test("201 self navigation is inert then one actual self prepare GET; current saved PIN-origin session also belongs to its real employee", async () => {
  for (const pinStart of [false, true]) {
    const x = fixture(await currentSession(pinStart)); assert.equal(x.calls.length, 0);
    const selected = await x.client.freshSession(target);
    assert.deepEqual(selected, { siteId, authUserId: id(3), employeeId: id(2), workerId: id(1), startEventId: id(21) }); assert(Object.isFrozen(selected));
    assert.equal(x.calls.length, 1); const call = x.calls[0], url = new URL(call.url, "https://synthetic.invalid");
    assert.equal(url.pathname, "/api/merchant-enterprise/attendance/operational-punch-self"); assert.deepEqual([...url.searchParams], [["siteId", siteId], ["mode", "prepare"]]);
    assert.equal(call.init?.method, "GET"); assert.equal(call.init?.body, undefined); assert.equal(call.init?.cache, "no-store"); assert.equal(call.init?.redirect, "error");
    assert.equal(x.values.size, 0); assert.equal(x.client.hasLeaveRisk(), false);
  }
});

test("201 self navigation rejects closed or another session, another membership/Auth, damaged full193 evidence and malformed pointer", async () => {
  const result = await currentSession();
  for (const wrongTarget of [{ ...target, workerId: id(99) }, { ...target, startEventId: id(99) }]) {
    const x = fixture(result); await assert.rejects(x.client.freshSession(wrongTarget)); assert.equal(x.calls.length, 1);
  }
  if (!result.session) throw Error("fixture_session_missing");
  for (const changed of [{ employeeId: id(99) }, { employeeAuthUserId: id(99), actorAuthUserId: id(99) }]) {
    const session = { ...result.session, ...changed }, data = { ...result, session: { ...session, sessionFingerprint: await operationalPunchSessionFingerprint(siteId, session) } };
    await assert.rejects(fixture(data).client.freshSession(target));
  }
  for (const bad of [(await punchFixture()).result, (await punchStartFixture()).result,
    { ...result, session: { ...result.session, sessionFingerprint: "f".repeat(64) } }, { ...result, privateSource: {} }]) {
    await assert.rejects(fixture(bad).client.freshSession(target));
  }
  const x = fixture(result), extraKey = { ...target, authority: true }; await assert.rejects(x.client.freshSession(extraKey));
  await assert.rejects(x.client.freshSession({ ...target, startEventId: id(21) + "\n" })); assert.equal(x.calls.length, 0);
  for (const changed of [{ siteId: siteId + "\n" }, { actorId: id(3) + "\n" }, { employeeId: id(2) + "\n" }]) assert.throws(() => new AttendanceReminderSelfNavigation({ ...x.options, ...changed }));
});

test("201 self navigation preserves all raw original slots and blocks before HTTP or after a concurrent local change", async () => {
  const data = await currentSession(), keys = reminderSelfNavigationPendingKeys(siteId, id(3), id(2));
  assert.equal(keys.length, 11); assert.equal(new Set(keys).size, 11);
  for (const key of keys) {
    const x = fixture(data); x.values.set(key, "{"); await assert.rejects(x.client.freshSession(target)); assert.equal(x.calls.length, 0); assert.equal(x.values.get(key), "{");
  }
  let resolve!: (response: Response) => void;
  const x = fixture(data, { response: () => new Promise<Response>(yes => { resolve = yes; }) }), work = x.client.freshSession(target);
  const rejected = assert.rejects(work); await new Promise(yes => setTimeout(yes, 0));
  const key = operationalPunchPendingKey({ siteId, channel: "location", authUserId: id(3), terminalId: null, workerNo: null });
  x.values.set(key, "other original"); resolve(reply(data)); await rejected; assert.equal(x.calls.length, 1); assert.equal(x.values.get(key), "other original");
  const broken = new AttendanceReminderSelfNavigation({ ...x.options, storage: () => ({ getItem() { throw Error("unavailable"); } }) });
  await assert.rejects(broken.freshSession(target)); assert.equal(x.calls.length, 1);
});

test("201 self navigation fences hidden/Auth/pause late responses and bounds a stalled stream without any follow-up", async t => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document"), visibility = { hidden: false };
  Object.defineProperty(globalThis, "document", { configurable: true, value: visibility });
  t.after(() => { if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document"); });
  const data = await currentSession();
  for (const kind of ["pause", "auth", "hidden"] as const) {
    visibility.hidden = false; let current = true, resolve!: (response: Response) => void;
    const x = fixture(data, { current: () => current, response: () => new Promise<Response>(yes => { resolve = yes; }) });
    const work = x.client.freshSession(target), rejected = assert.rejects(work); await new Promise(yes => setTimeout(yes, 0));
    if (kind === "pause") x.client.pause(); else if (kind === "auth") current = false; else visibility.hidden = true;
    resolve(reply(data)); await rejected; assert.equal(x.calls.length, 1); assert.notEqual(x.client.getSnapshot().phase, "ready"); assert.equal(x.client.hasLeaveRisk(), false);
  }
  visibility.hidden = false; let cancelled = false;
  const x = fixture(data, { timeoutMs: 8, response: () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(x.client.freshSession(target)); assert.equal(cancelled, true); assert.equal(x.calls.length, 1); assert.equal(x.client.hasLeaveRisk(), false);
});
