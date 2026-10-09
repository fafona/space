//Synthetic HTTP/Auth + mocked SQL transport; no real login/database/browser.
import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceReminders, remindersDependencies } from "./route-handler";
import * as p from "@/lib/merchantAttendanceReminders";
import { ATTENDANCE_REMINDERS_API, attendanceReminderHttpQueryString, type AttendanceReminderHttpRead } from "@/lib/merchantAttendanceRemindersHttp";
import { createAttendanceRemindersService } from "@/lib/merchantAttendanceReminders.server";
import type { AttendanceSelfRpc } from "@/lib/merchantAttendanceSelf.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const origin = "https://www.faolla.com", url = origin + ATTENDANCE_REMINDERS_API, siteId = "99990201", actor = id(1), at = "2026-10-08T13:00:00.000001Z";
const list: Extract<p.AttendanceReminderQuery, { mode: "list" }> = { siteId, mode: "list", batchId: null, operationId: null, cursor: null };
const detail: Extract<p.AttendanceReminderQuery, { mode: "detail" }> = { siteId, mode: "detail", batchId: id(2), operationId: null, cursor: null };
const recover: Extract<p.AttendanceReminderQuery, { mode: "recover" }> = { siteId, mode: "recover", batchId: null, operationId: id(3), cursor: null };
const command: p.AttendanceReminderCommand = { action: "mark_read", operationId: id(3), batchId: id(2) };
const post = (body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (input: AttendanceReminderHttpRead) => new Request(url + "?" + attendanceReminderHttpQueryString(input), { headers: { origin } });
const result = (data: p.AttendanceReminderData = { kind: "receipt" }, receipt: p.AttendanceReminderReceipt | null = null): p.AttendanceReminderResult => ({ protocol: p.ATTENDANCE_REMINDERS_PROTOCOL, siteId,
  actor: { kind: "auth", authUserId: actor }, readAt: "2026-10-08T14:00:00.000000Z", data, receipt });
async function setup() {
  const saved = result({ kind: "receipt" }, { operationId: command.operationId, action: "mark_read", actorKind: "auth", actorId: actor,
    commandFingerprint: await p.attendanceReminderCommandFingerprint(detail, actor, command), recordedAt: at, result: { kind: "mark_read", batchId: id(2), readAt: at } });
  const executions: Parameters<typeof remindersDependencies.execute>[0][] = [], recoveries: Parameters<typeof remindersDependencies.recover>[0][] = [], entitlements: string[] = [];
  const deps: typeof remindersDependencies = {
    authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async site => { entitlements.push(site); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof remindersDependencies.entitlement>>; },
    enabled: () => true, allow: () => true, timeoutMs: 12000, bodyTimeoutMs: 5000,
    execute: async input => { executions.push(input); return input.command ? saved : result({ kind: "list", items: [], nextCursor: null }); },
    recover: async input => { recoveries.push(input); return result(); },
  };
  return { deps, saved, executions, recoveries, entitlements, body: { query: detail, command } };
}
test("201 route requires canonical same-origin password actual Auth and rejects injected actor/system without service calls", async () => {
  const st = await setup(), badHeaders: Record<string, string>[] = [{ origin: "https://foreign.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }];
  for (const headers of badHeaders) assert.equal((await handleAttendanceReminders(post(st.body, headers), st.deps)).status, 403);
  assert.equal((await handleAttendanceReminders(new Request("https://merchant.invalid" + ATTENDANCE_REMINDERS_API, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(st.body) }), st.deps)).status, 403);
  for (const authenticationMethods of [["recovery"], []]) assert.equal((await handleAttendanceReminders(post(st.body), { ...st.deps, authenticate: async () => ({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods }) })).status, 403);
  for (const body of [{ ...st.body, authUserId: id(99) }, { ...st.body, actor: { kind: "system" } }, { ...st.body, command: { ...command, actorKind: "system" } },
    { query: { siteId, mode: "run", operationId: id(3), cursor: null }, command: { action: "run_due", operationId: id(3), cursor: null } }]) assert.equal((await handleAttendanceReminders(post(body), st.deps)).status, 400);
  assert.equal(st.executions.length, 0); assert.equal(st.recoveries.length, 0);
});
test("201 normal GET/POST use actual actor, explicit fresh permission and minimum no-store success envelope", async () => {
  const st = await setup(), read = await handleAttendanceReminders(get({ query: list, expectedCommand: null }), st.deps);
  assert.equal(read.status, 200); assert.deepEqual(Object.keys(await read.clone().json()), ["ok", "data"]); assert.equal(st.entitlements.length, 0);
  assert.equal(st.executions[0].command, null); assert.equal(st.executions[0].allowWrite, false); assert.equal(st.executions[0].authUserId, actor);
  const written = await handleAttendanceReminders(post(st.body), st.deps); assert.equal(written.status, 200); assert.deepEqual((await written.clone().json()).data, st.saved);
  assert.equal(st.executions[1].allowWrite, true); assert.equal(st.executions[1].authUserId, actor); assert.deepEqual(st.entitlements, [siteId]);
  assert.equal(written.headers.get("cache-control"), "private, no-store"); assert.equal(written.headers.get("x-content-type-options"), "nosniff"); assert.match(written.headers.get("vary")!, /Cookie.*Authorization.*x-merchant-access-token/);
  const batch: p.AttendanceReminderData = { kind: "batch", batch: { batchId: id(2), category: "open_session", windowStart: "2026-10-08T13:00:00.000000Z", windowEnd: "2026-10-08T14:00:00.000000Z", recordedAt: at, itemCount: 1, readAt: null,
    items: [{ planId: id(4), ordinal: 1, target: { kind: "open_session", workerId: id(5), startEventId: id(6) }, observedAt: at }] } };
  const detailed = await handleAttendanceReminders(get({ query: detail, expectedCommand: null }), { ...st.deps, execute: async input => { assert.equal(input.command, null); assert.equal(input.allowWrite, false); return result(batch); } });
  assert.equal(detailed.status, 200); assert.equal((await detailed.json()).data.data.kind, "batch");
});
test("201 explicit original recovery skips enabled/entitlement and flag-off POST still permits original service lookup", async () => {
  const st = await setup(), response = await handleAttendanceReminders(get({ query: recover, expectedCommand: command }), { ...st.deps,
    enabled: () => { assert.fail("original GET does not read rollout"); }, entitlement: async () => { assert.fail("original GET does not read entitlement"); } });
  assert.equal(response.status, 200); assert.equal((await response.json()).data.receipt, null); assert.equal(st.recoveries.length, 1); assert.equal(st.executions.length, 0);
  const postResponse = await handleAttendanceReminders(post(st.body), { ...st.deps, enabled: () => false, entitlement: async () => { assert.fail("off does not read entitlement"); },
    execute: async input => { assert.equal(input.allowWrite, false); return st.saved; } }); assert.equal(postResponse.status, 200);
});
test("201 streamed strict JSON/UTF8/bounds/query/content-type and limiter reject without service calls", async () => {
  const st = await setup(), text = JSON.stringify(st.body), req = (body: BodyInit, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body });
  for (const request of [req(text.replace('"command":', '"command":{},"command":')), req(text.replace('"command":', '"\\u0063ommand":{},"command":')),
    req(new Uint8Array([0xff, 0xfe])), req(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])), req("中".repeat(3000)), req(text, { "content-length": "8193" }),
    req(text, { "content-type": "text/plain" }), new Request(url + "?unexpected=1", { method: "POST", headers: { origin, "content-type": "application/json" }, body: text }),
    new Request(get({ query: list, expectedCommand: null }).url + "&request={}", { headers: { origin } }), new Request(url + "?request=%ff", { headers: { origin } })]) assert.equal((await handleAttendanceReminders(request, st.deps)).status, 400);
  assert.equal((await handleAttendanceReminders(post(st.body), { ...st.deps, allow: () => false })).status, 429); assert.equal(st.executions.length, 0); assert.equal(st.recoveries.length, 0);
});
test("201 final route projection rejects wrong actor/operation/SHA/private result and redacts unknown errors", async () => {
  const st = await setup();
  for (const wrong of [{ ...st.saved, actor: { kind: "auth", authUserId: id(99) } }, { ...st.saved, receipt: { ...st.saved.receipt!, commandFingerprint: "a".repeat(64) } },
    { ...st.saved, receipt: { ...st.saved.receipt!, operationId: id(99) } }, { ...st.saved, source: { private: "hidden" } }]) {
    const response = await handleAttendanceReminders(post(st.body), { ...st.deps, execute: async () => wrong as p.AttendanceReminderResult }); assert.equal(response.status, 503); assert(!(await response.text()).includes("hidden"));
  }
  const unknown = await handleAttendanceReminders(post(st.body), { ...st.deps, execute: async () => { throw Error("postgres://password@private.invalid"); } }); assert.equal(unknown.status, 503); assert(!(await unknown.text()).includes("password"));
  const conflict = await handleAttendanceReminders(post(st.body), { ...st.deps, execute: async () => { throw new MerchantAttendanceError("attendance_operation_conflict"); } }); assert.equal(conflict.status, 409);
  const badRecovery = await handleAttendanceReminders(get({ query: recover, expectedCommand: command }), { ...st.deps, recover: async () => ({ ...st.saved, receipt: { ...st.saved.receipt!, commandFingerprint: "b".repeat(64) } }) }); assert.equal(badRecovery.status, 503);
});
test("201 total/body deadlines settle failclosed and pending-reader cleanup cannot mask the primary error", async () => {
  const st = await setup(); let release!: (value: p.AttendanceReminderResult) => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const pending = handleAttendanceReminders(post(st.body), { ...st.deps, timeoutMs: 25, execute: async () => { enter(); return new Promise<p.AttendanceReminderResult>(resolve => { release = resolve; }); } });
  await entered; const response = await pending; assert.equal(response.status, 503); release(st.saved); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal((await response.json()).ok, false);
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"query":')); }, cancel() { cancelled++; return new Promise<void>(() => {}); } });
  const request = new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  const timedBody = await handleAttendanceReminders(request, { ...st.deps, bodyTimeoutMs: 10 }); assert.equal(timedBody.status, 400); assert.equal(cancelled, 1);
  assert.equal(st.executions.length, 0); assert.equal(st.recoveries.length, 0);
});
test("201 real Node coordinator cannot advance a late original read after total HTTP deadline or caller cancellation", async () => {
  for (const mode of ["deadline", "abort"] as const) {
    const st = await setup(), names: string[] = [], controller = new AbortController(); let enter!: () => void, release!: (value: unknown) => void, workSignal: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const service: AttendanceSelfRpc = { rpc: async name => { names.push(name); const data = await new Promise<unknown>(resolve => { release = resolve; enter(); }); return { data, error: null }; } };
    const request = new Request(post(st.body), { signal: controller.signal });
    const running = handleAttendanceReminders(request, { ...st.deps, timeoutMs: mode === "deadline" ? 25 : 12000,
      execute: (input, _service, signal) => { workSignal = signal; return createAttendanceRemindersService(service, { signal, environment: () => ({ FAOLLA_ATTENDANCE_REMINDERS_ENABLED: "1", FAOLLA_ATTENDANCE_REMINDERS_SITE_IDS: siteId }) }).execute(input); } });
    await entered; if (mode === "abort") controller.abort(); const response = await running; assert.equal(response.status, 503); assert.equal(workSignal?.aborted, true);
    release(result()); await new Promise<void>(resolve => setImmediate(resolve)); assert.deepEqual(names, ["faolla_attendance_reminders_v1"]); assert.equal((await response.json()).ok, false);
    assert.equal(getEventListeners(request.signal, "abort").length, 0);
  }
});
test("201 already-aborted and authentication timeout make no business call; error status and listeners remain bounded", async () => {
  const st = await setup(), controller = new AbortController(); controller.abort(); const request = new Request(post(st.body), { signal: controller.signal });
  const aborted = await handleAttendanceReminders(request, st.deps); assert.equal(aborted.status, 503); assert.equal(st.executions.length, 0); assert.equal(getEventListeners(request.signal, "abort").length, 0);
  let release!: (value: Awaited<ReturnType<typeof remindersDependencies.authenticate>>) => void;
  const slow = handleAttendanceReminders(post(st.body), { ...st.deps, timeoutMs: 10, authenticate: () => new Promise(resolve => { release = resolve; }) });
  const response = await slow; assert.equal(response.status, 503); release({ user: { id: actor } as User, accessToken: "synthetic", authenticationMethods: ["password"] });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(st.executions.length, 0); assert.equal(st.recoveries.length, 0);
});
