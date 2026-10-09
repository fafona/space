import test from "node:test";
import assert from "node:assert/strict";
import { listKnownAdministrativeClosureRecoveries, recoverKnownAdministrativeClosure } from "./merchantAttendanceAdministrativeClosureRecovery";
import { listKnownAttendanceRecoveries, recoverKnownAttendance, type AttendanceRecoveryStorage } from "./merchantAttendanceRecovery";
import { administrativeClosurePendingKey } from "./merchantAttendanceAdministrativeClosureClient";
import { administrativeClosureCommandFingerprint, parseAdministrativeClosureHttpQuery } from "./merchantAttendanceAdministrativeClosure";
import { closureOwner, closureSelf, closureSite, closureId, closureCommand, closureQuery, closureReceiptResult, closureResult } from "./merchantAttendanceAdministrativeClosureTestFixtures";
async function fixture() {
  const values = new Map<string, string>(), storage: AttendanceRecoveryStorage = { get length() { return values.size; }, key: n => [...values.keys()][n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const query = closureQuery(), command = closureCommand(), commandFingerprint = await administrativeClosureCommandFingerprint(closureSite, closureOwner, "owner", command), key = administrativeClosurePendingKey(closureSite, closureOwner);
  const raw = JSON.stringify({ protocol: "attendance-administrative-closure-pending-v1", version: 1, actorId: closureOwner, query, command, commandFingerprint }, null, 2); values.set(key, raw);
  const recovery = { siteId: closureSite, access: "owner" as const, mode: "recover" as const, operationId: command.operationId };
  return { values, storage, query, command, commandFingerprint, key, raw, recovery, response: { ok: true, data: await closureReceiptResult(command, recovery) } };
}
test("195 aggregate discovery sees only bounded current-Auth descriptors, never reasons or employee source", async () => {
  const f = await fixture(), found = await listKnownAttendanceRecoveries(f.storage, closureOwner, () => true);
  assert.equal(found.invalid, false); assert.equal(found.entries.length, 1); assert.equal(found.entries[0].kind, "administrative-closure");
  assert.doesNotMatch(JSON.stringify(found), /reason|workerId|employeeId|startEventId/); assert.equal(f.storage.getItem(f.key), f.raw);
  assert.deepEqual((await listKnownAdministrativeClosureRecoveries(f.storage, closureSelf, () => true)).entries, []);
});
test("195 aggregate recovery dispatches exactly original GET without current owner or close flag and CAS-clears", async () => {
  const f = await fixture(), entry = (await listKnownAttendanceRecoveries(f.storage, closureOwner, () => true)).entries[0]; let calls = 0;
  const receipt = await recoverKnownAttendance(entry, { authenticatedUserId: closureOwner, storage: f.storage, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); assert.deepEqual(parseAdministrativeClosureHttpQuery("https://synthetic.invalid" + path), f.recovery); return Response.json(f.response); } });
  assert.equal(calls, 1); assert.equal(receipt?.kind, "administrative-closure"); assert.equal(receipt?.operationId, f.command.operationId); assert.equal(f.storage.getItem(f.key), null); assert.doesNotMatch(JSON.stringify(receipt), /reason|frame|context|employeeId/);
});
test("195 unknown/null, response mismatch and corrupted local fingerprints all preserve raw original bytes", async () => {
  for (const mode of ["null", "foreign", "hash", "broken"] as const) {
    const f = await fixture(), entry = (await listKnownAdministrativeClosureRecoveries(f.storage, closureOwner, () => true)).entries[0];
    const saved = f.response.data;
    const r = mode === "null" ? closureResult({ kind: "receipt", receipt: null }, f.recovery) : mode === "foreign" ? { ...saved, actorId: closureSelf }
      : mode === "hash" && saved.data.kind === "receipt" && saved.data.receipt ? { ...saved, data: { kind: "receipt", receipt: { ...saved.data.receipt, commandFingerprint: "b".repeat(64) } } } : saved;
    const receipt = await recoverKnownAdministrativeClosure(entry, { authenticatedUserId: closureOwner, storage: f.storage, isCurrentAuth: () => true, signal: new AbortController().signal,
      apiFetch: async () => mode === "broken" ? new Response("{", { headers: { "content-type": "application/json" } }) : Response.json({ ok: true, data: r }) });
    assert.equal(receipt, null); assert.equal(f.storage.getItem(f.key), f.raw);
  }
  const f = await fixture(); f.values.set(f.key, JSON.stringify({ ...JSON.parse(f.raw), commandFingerprint: "b".repeat(64) })); const before = f.storage.getItem(f.key);
  const found = await listKnownAttendanceRecoveries(f.storage, closureOwner, () => true); assert.equal(found.invalid, true); assert.equal(found.entries.length, 0); assert.equal(f.storage.getItem(f.key), before);
});
test("195 exact recovery descriptor and global64 limit reject without network or deletion", async () => {
  const f = await fixture(), entry = (await listKnownAdministrativeClosureRecoveries(f.storage, closureOwner, () => true)).entries[0]; let calls = 0;
  await assert.rejects(recoverKnownAdministrativeClosure({ ...entry, operationId: closureId(999) }, { authenticatedUserId: closureOwner, storage: f.storage, isCurrentAuth: () => true, signal: new AbortController().signal, apiFetch: async () => { calls++; throw Error("no"); } })); assert.equal(calls, 0);
  for (let n = 0; n < 65; n++) f.values.set(administrativeClosurePendingKey(String(99990100 + n), closureOwner), f.raw);
  await assert.rejects(listKnownAttendanceRecoveries(f.storage, closureOwner, () => true), /recovery_storage_limit/); assert.equal(f.storage.getItem(f.key), f.raw);
});
test("195 auth loss or concurrent storage replacement while recovering never clears either original slot", async () => {
  for (const mode of ["auth", "storage"] as const) { const f = await fixture(), entry = (await listKnownAdministrativeClosureRecoveries(f.storage, closureOwner, () => true)).entries[0]; let current = true;
    const work = recoverKnownAdministrativeClosure(entry, { authenticatedUserId: closureOwner, storage: f.storage, isCurrentAuth: () => current, signal: new AbortController().signal,
      apiFetch: async () => { if (mode === "auth") current = false; else f.values.set(f.key, "replacement"); return Response.json(f.response); } });
    if (mode === "auth") await assert.rejects(work, /recovery_scope_changed/); else assert.equal(await work, null); assert.equal(f.storage.getItem(f.key), mode === "auth" ? f.raw : "replacement");
  }
});
test("195 recovery lease covers digest and abort, with no late descriptions or cleanup", async t => {
  const f = await fixture(), controller = new AbortController(); let release!: (value: ArrayBuffer) => void;
  t.mock.method(crypto.subtle, "digest", () => new Promise<ArrayBuffer>(resolve => { release = resolve; }));
  const work = listKnownAdministrativeClosureRecoveries(f.storage, closureOwner, () => true, controller.signal); await new Promise<void>(r => setImmediate(r)); controller.abort();
  await assert.rejects(work, /recovery_scope_changed/); release(new ArrayBuffer(32)); await new Promise<void>(r => setImmediate(r)); assert.equal(f.storage.getItem(f.key), f.raw);
});
