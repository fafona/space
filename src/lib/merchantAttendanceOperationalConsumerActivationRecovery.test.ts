import assert from "node:assert/strict";
import test from "node:test";
import { listKnownAttendanceRecoveries, recoverKnownAttendance } from "./merchantAttendanceRecovery";
import { operationalConsumerActivationPendingKey } from "./merchantAttendanceOperationalConsumerActivationClient";
import * as f from "./merchantAttendanceOperationalConsumerActivationTestFixtures";
const key = operationalConsumerActivationPendingKey(f.activationSite, f.activationActor, "application_window");

test("201 reminder activation is discovered and full-SHA recovered by the actual aggregate without owner lookup or POST", async () => {
  const storage = new f.ActivationMemoryStorage(), query = { ...f.activationQuery, consumer: "reminders" as const }, command = { ...f.activationCommand(), consumer: "reminders" as const },
    reminderKey = operationalConsumerActivationPendingKey(f.activationSite, f.activationActor, "reminders"), item = await f.activationItem(command),
    bytes = JSON.stringify({ version: 1, actorId: f.activationActor, query, command, commandFingerprint: item.commandFingerprint }); storage.setItem(reminderKey, bytes);
  const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true); assert.equal(found.invalid, false); assert.equal(found.entries.length, 1);
  const entry = found.entries[0]; assert.equal(entry.kind, "operational-consumer-activation"); if (entry.kind !== "operational-consumer-activation") assert.fail(); assert.equal(entry.consumer, "reminders");
  let calls = 0; const options = { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (path: string, init?: RequestInit) => { calls++; assert.match(path, /consumer=reminders/); assert.match(path, /mode=recover/); assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
      return f.activationResponse({ ...f.activationResult(null, calls === 1 ? null : item, false), consumer: "reminders" }); } };
  assert.equal(await recoverKnownAttendance(entry, options), null); assert.equal(storage.getItem(reminderKey), bytes);
  const result = await recoverKnownAttendance(entry, options); assert.equal(result?.kind, "operational-consumer-activation"); assert.equal(storage.getItem(reminderKey), null); assert.equal(calls, 2);
});
test("194 independent aggregate discovers actual Auth original number without owner lookup", async () => {
  const storage = new f.ActivationMemoryStorage(); storage.setItem(key, await f.activationPendingBytes()); storage.setItem(operationalConsumerActivationPendingKey(f.activationSite, f.activationId(2), "application_window"), await f.activationPendingBytes(f.activationCommand(), f.activationId(2)));
  const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true); assert.equal(found.entries.length, 1); assert.equal(found.entries[0].kind, "operational-consumer-activation"); assert.equal(found.invalid, false);
  let calls = 0; const receipt = await recoverKnownAttendance(found.entries[0], { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (path, init) => { calls++; assert.match(path, /operational-consumer-activation\?/); assert.match(path, /mode=recover/); assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); return f.activationResponse(f.activationResult(null, await f.activationItem(), false)); } });
  assert.equal(calls, 1); assert.equal(receipt?.kind, "operational-consumer-activation"); assert.equal(storage.getItem(key), null); assert.equal(storage.length, 1);
});
test("194 independent null receipt and changed bytes retain pending", async () => {
  const storage = new f.ActivationMemoryStorage(), bytes = await f.activationPendingBytes(); storage.setItem(key, bytes); const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true);
  const options = { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => true, signal: new AbortController().signal, apiFetch: async () => f.activationResponse(f.activationResult(null, null, false)) };
  assert.equal(await recoverKnownAttendance(found.entries[0], options), null); assert.equal(storage.getItem(key), bytes);
  storage.setItem(key, bytes.replace(f.activationId(10), f.activationId(99))); await assert.rejects(recoverKnownAttendance(found.entries[0], options)); assert.ok(storage.getItem(key));
});
test("194 independent recovery identity loss cannot clear late response", async () => {
  const storage = new f.ActivationMemoryStorage(), bytes = await f.activationPendingBytes(); storage.setItem(key, bytes); const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true); let active = true;
  await assert.rejects(recoverKnownAttendance(found.entries[0], { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => active, signal: new AbortController().signal, apiFetch: async () => { active = false; return f.activationResponse(f.activationResult(null, await f.activationItem(), false)); } })); assert.equal(storage.getItem(key), bytes);
});
test("194 activation participates in aggregate global64 cap, corrupt original is not deleted", async () => {
  const storage = new f.ActivationMemoryStorage(); storage.setItem(key, "{"); assert.equal((await listKnownAttendanceRecoveries(storage, f.activationActor, () => true)).invalid, true); assert.equal(storage.getItem(key), "{");
  for (let i = 0; i < 64; i++) storage.setItem(operationalConsumerActivationPendingKey(String(99980000 + i), f.activationActor, "application_window"), "{}"); await assert.rejects(listKnownAttendanceRecoveries(storage, f.activationActor, () => true), /recovery_storage_limit/);
});


