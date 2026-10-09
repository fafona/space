// Deterministic Node coordination + SOURCE guards, not PostgreSQL acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { executeAttendanceLocationClock, type AttendanceLocationClockInput } from "./merchantAttendanceLocationClock.server";

const id = (n: number) => `24680000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990198", at = "2026-10-08T10:00:00.000Z";
const input: AttendanceLocationClockInput = { siteId, expectedWorkerId: id(2), authUserId: id(6), operationId: null, moduleEnabled: true,
  command: { expectedWorkerId: id(2), operationId: id(7), locationId: id(3), action: "clock_in", expectedSequence: 2,
    settingsVersion: 1, workerVersion: 5, locationVersion: 1, noticeRevision: 1, safeFinish: false,
    position: { latitude: 37.3, longitude: -5.9, accuracyMeters: 10, capturedAt: at }, positionFailure: null } };
const tail = { id: id(4), siteId, workerId: id(2), locationId: id(3), operationId: id(5), action: "clock_out", sequence: 2, occurredAt: at, timeZone: "UTC", breakPaid: null };
const policy = { settingsVersion: 1, workerVersion: 5, locationVersion: 1, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 };
const prepared = { siteId, employeeId: id(1), workerId: id(2), locationId: id(3), state: { sequence: 2, status: "off", lastEvent: tail }, receipt: null, replayed: false,
  noticeGate: { ready: true, reason: "ready", revision: 1 }, finish: null, receiptGate: null, channelEnabled: true, policy, locationResult: null,
  internalPolicyFingerprint: "a".repeat(32), internalFence: { latitude: 37.3, longitude: -5.9, radiusMeters: 100, maxAgeMs: 60000 } };
const event = { ...tail, id: id(8), operationId: id(7), action: "clock_in", sequence: 3 };
const command = { operationId: id(7), locationId: id(3), action: "clock_in", expectedSequence: 2,
  settingsVersion: 1, workerVersion: 5, locationVersion: 1, noticeRevision: 1, safeFinish: false };
const saved = { ...prepared, receipt: event, state: { sequence: 3, status: "working", lastEvent: event },
  locationResult: { eventId: event.id, settingsVersion: 1, workerVersion: 5, locationVersion: 1, algorithmVersion: 1,
    reason: "inside", needsReview: false, capturedAt: at, accuracyMeters: 10, distanceMeters: 0 },
  receiptGate: { noticeRevision: 1, safeFinish: false, command } };

test("196 reproduces actual location fresh-operation pre-read; a denied pre-read makes zero writer calls", async () => {
  const calls: Record<string, unknown>[] = [];
  await assert.rejects(executeAttendanceLocationClock(input, { rpc: async (_, args) => {
    calls.push(args); return { data: null, error: { message: "attendance_access_denied" } };
  } }), /attendance_access_denied/);
  assert.equal(calls.length, 1); assert.equal(calls[0].p_command, null); assert.equal(calls[0].p_operation_id, id(7));
  assert.equal(calls[0].p_assertion, null); assert.equal(calls[0].p_require_clock, true);
  // This is precisely the previously rejected helper input, not a parallel writer.
  assert.equal(calls.filter(call => call.p_command !== null).length, 0);
});

test("196 actual Node first location clock_in keeps original read/write protocol and advances the closed tail", async () => {
  const calls: Record<string, unknown>[] = [];
  const result = await executeAttendanceLocationClock(input, { rpc: async (_, args) => {
    calls.push(args); return { data: calls.length === 1 ? prepared : saved, error: null };
  } });
  assert.equal(calls.length, 2); assert.equal(calls[0].p_command, null); assert.equal(calls[0].p_operation_id, id(7));
  assert.deepEqual(calls[1].p_command, command); assert.equal(calls[1].p_operation_id, null);
  assert.equal(result.receipt?.sequence, 3); assert.equal(result.state.status, "working");
});

test("196 negative DB guards remain authoritative to Node: original receipt, wrong worker, unbound/open and flag-off", async () => {
  // These injected denials verify Node's no-fallback behavior, not SQL execution.
  for (const scenario of ["existing original operation", "wrong worker", "unbound subject", "open independent tail"]) {
    let calls = 0;
    await assert.rejects(executeAttendanceLocationClock(input, { rpc: async () => {
      calls++; return { data: null, error: { message: "attendance_access_denied" } };
    } }), /attendance_access_denied/, scenario);
    assert.equal(calls, 1, scenario);
  }
  let calls = 0;
  await assert.rejects(executeAttendanceLocationClock({ ...input, moduleEnabled: false }, { rpc: async (_, args) => {
    calls++; assert.equal(args.p_allow_new_sessions, false);
    return calls === 1 ? { data: { ...prepared, channelEnabled: false }, error: null }
      : { data: null, error: { message: "attendance_location_clock_disabled" } };
  } }), /attendance_location_clock_disabled/);
  assert.equal(calls, 2); // State can be read; the fresh write is still authoritatively refused.
});

test("196 SQL SOURCE narrows pre-read to same-worker operation absence and preserves every closed binding proof plus113 receipt gate", () => {
  const sql = readFileSync(new URL("../../scripts/supabase-migrations/202610080196_merchant_attendance_independent_workers.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const body = (name: string) => {
    const value = sql.match(new RegExp(`create or replace function public\\.faolla_attendance_independent_${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1];
    assert(value, name); return value;
  };
  assert.match(body("bootstrap_intent_v1"), /if p_command is null then[\s\S]*?if p_operation is not null and exists\(select 1 from public\.merchant_attendance_events\n   where merchant_id=p_site and worker_id=p_worker and operation_id=p_operation\) then return false;end if;\n else/);
  assert.match(body("bootstrap_intent_v1"), /return public\.faolla_attendance_independent_bootstrap_v1\(p_site,p_worker,p_employee,p_auth,p_last,p_sequence\);/);
  for (const token of ["s.state<>'bound'", "s.enabled", "w.employee_id is distinct from p_employee", "auth_user_id=p_auth and status='active'",
    "row(p_last,p_sequence)", "e.actor_employee_id is not null", "e.action<>'clock_out'", "x.subject_id is distinct from b.subject_id",
    "i.command_fingerprint is distinct from b.command_fingerprint", "faolla_attendance_independent_clock_receipt_v1(x)"])
    assert(body("bootstrap_v1").includes(token), token);
  const original = readFileSync(new URL("../../scripts/supabase-migrations/202610020113_merchant_attendance_location_receipt_identity.sql", import.meta.url));
  assert.equal(createHash("sha256").update(original).digest("hex"), "02e2492bf940fe855a1a3794787883d83adce12388d98e1b6db6711410c84bff");
  assert(original.toString().includes("and actor_employee_id is distinct from e.id) then"));
});
