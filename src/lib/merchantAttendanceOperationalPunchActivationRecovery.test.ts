import assert from "node:assert/strict";
import test from "node:test";
import { listKnownAttendanceRecoveries, recoverKnownAttendance } from "./merchantAttendanceRecovery";
import { operationalPunchActivationPendingKey } from "./merchantAttendanceOperationalPunchActivationClient";
import * as f from "./merchantAttendanceOperationalPunchActivationTestFixtures";
const key = operationalPunchActivationPendingKey(f.activationSite, f.activationActor);
test("242 independent aggregate discovers actual Auth original number without owner lookup", async () => {
  const storage = new f.ActivationMemoryStorage(); storage.setItem(key, await f.activationPendingBytes()); storage.setItem(operationalPunchActivationPendingKey(f.activationSite, f.activationId(2)), await f.activationPendingBytes(f.activationCommand(), f.activationId(2)));
  const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true); assert.equal(found.entries.length, 1); assert.equal(found.entries[0].kind, "operational-punch-activation"); assert.equal(found.invalid, false);
  let calls = 0; const receipt = await recoverKnownAttendance(found.entries[0], { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (path, init) => { calls++; assert.match(path, /operational-punch-activation\?/); assert.match(path, /mode=recover/); assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); return f.activationResponse(f.activationResult(null, await f.activationItem(), false)); } });
  assert.equal(calls, 1); assert.equal(receipt?.kind, "operational-punch-activation"); assert.equal(storage.getItem(key), null); assert.equal(storage.length, 1);
});
test("242 independent null receipt and changed bytes retain pending", async () => {
  const storage = new f.ActivationMemoryStorage(), bytes = await f.activationPendingBytes(); storage.setItem(key, bytes); const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true);
  const options = { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => true, signal: new AbortController().signal, apiFetch: async () => f.activationResponse(f.activationResult(null, null, false)) };
  assert.equal(await recoverKnownAttendance(found.entries[0], options), null); assert.equal(storage.getItem(key), bytes);
  storage.setItem(key, bytes.replace(f.activationId(10), f.activationId(99))); await assert.rejects(recoverKnownAttendance(found.entries[0], options)); assert.ok(storage.getItem(key));
});
test("242 independent recovery identity loss cannot clear late response", async () => {
  const storage = new f.ActivationMemoryStorage(), bytes = await f.activationPendingBytes(); storage.setItem(key, bytes); const found = await listKnownAttendanceRecoveries(storage, f.activationActor, () => true); let active = true;
  await assert.rejects(recoverKnownAttendance(found.entries[0], { storage, authenticatedUserId: f.activationActor, isCurrentAuth: () => active, signal: new AbortController().signal, apiFetch: async () => { active = false; return f.activationResponse(f.activationResult(null, await f.activationItem(), false)); } })); assert.equal(storage.getItem(key), bytes);
});
test("242 activation participates in aggregate global64 cap, corrupt original is not deleted", async () => {
  const storage = new f.ActivationMemoryStorage(); storage.setItem(key, "{"); assert.equal((await listKnownAttendanceRecoveries(storage, f.activationActor, () => true)).invalid, true); assert.equal(storage.getItem(key), "{");
  for (let i = 0; i < 64; i++) storage.setItem(operationalPunchActivationPendingKey(String(99980000 + i), f.activationActor), "{}"); await assert.rejects(listKnownAttendanceRecoveries(storage, f.activationActor, () => true), /recovery_storage_limit/);
});
