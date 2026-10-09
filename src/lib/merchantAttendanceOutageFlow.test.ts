// In-process client -> Request -> actual handler -> actual service -> synthetic
// RPC receiver. This proves wiring/recovery, not real Auth or database authority.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { User } from "@supabase/supabase-js";
import { AttendanceOutageClient, type OutageClientStorage } from "./merchantAttendanceOutageClient";
import { handleOutage, outageDependencies } from "../app/api/merchant-enterprise/attendance/outages/route-handler";
import { executeOutage, outageCommandFingerprint } from "./merchantAttendanceOutage.server";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { parseOutageCommand, parseOutageQuery } from "./merchantAttendanceOutage";
import { handleOutageSubject } from "../app/api/merchant-enterprise/attendance/outage-subject/route-handler";
import { executeOutageSubject } from "./merchantAttendanceOutageSubject.server";
import type { OutageCommand, OutageQuery, OutageResult } from "./merchantAttendanceOutageContract";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", owner = id(1), employee = id(2), incidentId = id(3), declarationId = id(4);
const interval = { startAt: "2026-10-07T08:00:00.000000Z", endAt: "2026-10-07T10:00:00.000000Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 };
const at = "2026-10-07T12:00:00.000000Z";
const ownerRead: OutageQuery = { siteId, access: "owner", mode: "incidents", afterId: null };
const ownerWrite: OutageQuery = { siteId, access: "owner", mode: "incident", incidentId };
const selfRead: OutageQuery = { siteId, access: "self", mode: "incident", incidentId };
const selfPrepare = { siteId, access: "self" as const, workerId: null, incidentId };
const selfWrite: OutageQuery = { siteId, access: "self", mode: "declaration", declarationId };
const incidentDraft = { action: "create_incident", incidentId, type: "network", channel: "web", locationId: null, interval, reason: "明确登记，不生成出勤" };
const declarationDraft = { action: "declare", incidentId, declarationId, workerId: id(5), employeeId: id(6), employeeAuthUserId: employee,
  expectedWorkerVersion: 3, expectedEmployeeVersion: 2, expectedGeneration: 0, interval, statement: "本人故障说明", originalOperationId: null, originalChannel: null, paperReference: null };
class Memory implements OutageClientStorage {
  data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => { this.data.set(key, value); };
  removeItem = (key: string) => { this.data.delete(key); };
}
function fixture(t: TestContext, access: "owner" | "self" = "owner") {
  const names = ["FAOLLA_ATTENDANCE_OUTAGE_ENABLED", "FAOLLA_ATTENDANCE_OUTAGE_SITE_IDS"];
  const old = names.map(name => process.env[name]);
  process.env[names[0]] = "1"; process.env[names[1]] = siteId;
  t.after(() => names.forEach((name, index) => { if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index]; }));
  const actor = access === "owner" ? owner : employee, storage = new Memory();
  const saved = new Map<string, { query: OutageQuery; command: OutageCommand }>();
  const calls: { name: string; args: Record<string, unknown> }[] = [], requests: { method: string; url: string }[] = [];
  let dropPost = false, denyAuth = false, enabled = true, n = 100;
  const body = (query: OutageQuery, canWrite: boolean): OutageResult => ({ protocol: "attendance-outage-v1", siteId, access: query.access, mode: query.mode,
    actorId: actor, readAt: at, canWrite, items: [], detail: null, nextId: null, receipt: null });
  const apiFetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET" });
    const request = new Request("https://www.faolla.com" + url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)),
      origin: "https://www.faolla.com", "sec-fetch-site": "same-origin" } });
    if (url.startsWith("/api/merchant-enterprise/attendance/outage-subject?")) return handleOutageSubject(request, {
      authenticate: async () => { if (denyAuth) throw new MerchantEnterpriseAccessError("unauthorized", 401);
        return { user: { id: actor } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }; },
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof outageDependencies.entitlement>>,
      allow: () => true, siteEnabled: () => enabled,
      execute: input => executeOutageSubject(input, { rpc: async (name, args) => { calls.push({ name, args });
        assert.equal(name, "faolla_attendance_outage_subject_v1"); assert.equal(args.p_auth_user_id, actor);
        return { data: { protocol: "attendance-outage-subject-v1", siteId, access, actorId: actor, readAt: at, canWrite: args.p_allow_write,
          subject: { workerId: id(5), employeeId: id(6), employeeAuthUserId: employee, workerVersion: 3, employeeVersion: 2, generation: 0, displayName: "合成员工", active: true, paused: false },
          incident: { id: incidentId, type: "network", channel: "web", locationId: null, interval } }, error: null };
      } }),
    });
    const response = await handleOutage(request, {
      authenticate: async () => { if (denyAuth) throw new MerchantEnterpriseAccessError("unauthorized", 401);
        return { user: { id: actor } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }; },
      entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof outageDependencies.entitlement>>,
      allow: () => true, siteEnabled: () => enabled,
      execute: input => executeOutage(input, { rpc: async (name, args) => {
        calls.push({ name, args }); assert.equal(name, "faolla_attendance_outage_v1"); assert.equal(args.p_auth_user_id, actor);
        const query = parseOutageQuery(args.p_query), command = args.p_command === null ? null : parseOutageCommand(args.p_command);
        if (command) {
          assert.equal(args.p_allow_write, true); saved.set(command.operationId, { query, command });
        }
        const original = command ? { query, command } : query.mode === "recover" ? saved.get(query.operationId) : null;
        if (query.mode === "recover" && !original) return { data: null, error: { message: "attendance_outage_not_found" } };
        if (original) {
          const c = original.command;
          return { data: { ...body(query, false), receipt: { operationId: c.operationId, action: c.action, recordId: c.action === "declare" ? c.declarationId : c.incidentId,
            incidentId: c.incidentId, actorId: actor, commandFingerprint: outageCommandFingerprint(original.query, c), recordedAt: at } }, error: null };
        }
        const result = body(query, args.p_allow_write === true);
        if (query.mode === "incident") result.detail = { kind: "incident", id: incidentId, operationId: id(7), type: "network", channel: "web", locationId: null,
          interval, reason: "已登记的合成故障", actorId: owner, recordedAt: at };
        return { data: result, error: null };
      } }),
    });
    if (init?.method === "POST" && dropPost) { await response.body?.cancel(); throw Error("synthetic-response-lost-after-handler"); }
    return response;
  };
  const client = (on = true) => new AttendanceOutageClient({ kind: "outages", siteId, actorId: actor, access, enabled: on, apiFetch,
    storage: () => storage, operationId: () => id(n++) });
  return { client, storage, calls, requests, saved, setDrop: (v: boolean) => { dropPost = v; }, setDeny: (v: boolean) => { denyAuth = v; }, setEnabled: (v: boolean) => { enabled = v; } };
}

for (const access of ["owner", "self"] as const) test(`actual ${access} handler and service receive exactly one explicit client submission`, async t => {
  const f = fixture(t, access), c = f.client(), read = access === "owner" ? ownerRead : selfRead, write = access === "owner" ? ownerWrite : selfWrite;
  await c.initialize(); assert.equal(f.requests.length, 0);
  if (access === "self") await c.prepare(selfPrepare); else await c.load(read); assert.equal(c.getSnapshot().phase, "ready");
  await c.submit(write, access === "owner" ? incidentDraft : declarationDraft);
  assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().pending, null); assert.equal(f.storage.data.size, 0);
  assert.equal(f.requests.filter(x => x.method === "POST").length, 1); assert.equal(f.saved.size, 1);
  assert.equal(c.getSnapshot().result?.receipt?.operationId, id(100));
});

for (const access of ["owner", "self"] as const) test(`lost ${access} POST response reloads through actual flag-off GET recovery only`, async t => {
  const f = fixture(t, access), c = f.client(), read = access === "owner" ? ownerRead : selfRead, write = access === "owner" ? ownerWrite : selfWrite;
  await c.initialize(); if (access === "self") await c.prepare(selfPrepare); else await c.load(read); f.setDrop(true);
  await c.submit(write, access === "owner" ? incidentDraft : declarationDraft);
  assert.equal(c.getSnapshot().phase, "unconfirmed"); const stored = f.storage.getItem(c.storageKey); assert(stored);
  assert.equal(f.saved.size, 1); f.setEnabled(false);
  const reload = f.client(false); await reload.initialize(); assert.equal(f.requests.length, 2);
  await reload.recover(); assert.equal(reload.getSnapshot().pending, null);
  assert.equal(reload.getSnapshot().result?.receipt?.operationId, id(100)); assert.equal(f.requests.filter(x => x.method === "POST").length, 1);
  assert.equal(f.calls.at(-1)?.args.p_allow_write, false); assert.equal(f.calls.at(-1)?.args.p_command, null);
});

test("current authentication loss never clears a prior successful but unconfirmed operation", async t => {
  const f = fixture(t), c = f.client(); await c.initialize(); await c.load(ownerRead); f.setDrop(true); await c.submit(ownerWrite, incidentDraft);
  const raw = f.storage.getItem(c.storageKey), before = f.calls.length; f.setDeny(true); await c.recover();
  assert.equal(f.calls.length, before); assert.equal(f.storage.getItem(c.storageKey), raw); assert(c.getSnapshot().pending);
  assert.equal(c.getSnapshot().canEndRejectedAttempt, false); await c.endRejectedAttempt(); assert.equal(f.storage.getItem(c.storageKey), raw);
});

test("closed rollout remains an explicit authorized read and cannot start a new client operation", async t => {
  const f = fixture(t); f.setEnabled(false); const c = f.client(false); await c.initialize(); await c.load(ownerRead);
  assert.equal(c.getSnapshot().phase, "ready"); assert.equal(c.getSnapshot().canWrite, false); await c.submit(ownerWrite, incidentDraft);
  assert.equal(f.requests.length, 1); assert.equal(f.calls[0].args.p_allow_write, false); assert.equal(f.storage.data.size, 0);
});
