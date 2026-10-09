import test from "node:test";
import assert from "node:assert/strict";
import { listKnownRetentionDisposalRecoveries, recoverKnownRetentionDisposal } from "./merchantAttendanceRetentionDisposalRecovery";
import { listKnownAttendanceRecoveries, recoverKnownAttendance } from "./merchantAttendanceRecovery";
import { disposalExecutionPendingKey } from "./merchantAttendanceRetentionDisposalExecutionClient";
import { disposalActor, disposalSite, disposalId as id, disposalQuery, disposalApprove, disposalReceipt, disposalResult } from "../../scripts/fixtures/attendance-retention-disposal-execution-model";
async function setup() {
  const values = new Map<string, string>(), key = disposalExecutionPendingKey(disposalSite, disposalActor), query = disposalQuery(), command = await disposalApprove();
  const receipt = await disposalReceipt(command), raw = JSON.stringify({ protocol: "attendance-retention-disposal-pending-v1", version: 1, actorId: disposalActor, query, command, commandFingerprint: receipt.commandFingerprint }); values.set(key, raw);
  const storage = { get length() { return values.size; }, key: (n: number) => [...values.keys()][n] ?? null, getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  return { values, key, raw, query, command, receipt, storage };
}
const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
test("local inventory is actor-specific, aggregate-aware and leaves saved bytes unchanged", async () => {
  const s = await setup(), own = await listKnownRetentionDisposalRecoveries(s.storage, disposalActor, () => true); assert.equal(own.entries.length, 1); assert.equal(own.invalid, false);
  assert.equal((await listKnownRetentionDisposalRecoveries(s.storage, id(99), () => true)).entries.length, 0);
  const all = await listKnownAttendanceRecoveries(s.storage, disposalActor, () => true); assert.equal(all.entries.length, 1); assert.equal(all.entries[0].kind, "retention-disposal"); assert.equal(s.values.get(s.key), s.raw);
});
test("lost-owner recovery issues only one original-actor GET and clears only matching receipt", async () => {
  const s = await setup(), entry = (await listKnownAttendanceRecoveries(s.storage, disposalActor, () => true)).entries[0]; let calls = 0;
  const receipt = await recoverKnownAttendance(entry, { authenticatedUserId: disposalActor, storage: s.storage, isCurrentAuth: () => true, signal: new AbortController().signal,
    apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.match(path, /mode=recover/); assert.doesNotMatch(path, /mode=preview/);
      return json({ ok: true, data: disposalResult({ kind: "receipt", receipt: s.receipt }) }); } });
  assert.equal(receipt?.kind, "retention-disposal"); assert.equal(calls, 1); assert.equal(s.values.size, 0);
});
test("unknown, foreign, changed-command and replacement receipts preserve the original or newer intent", async () => {
  for (const kind of ["null", "actor", "command", "replacement"] as const) {
    const s = await setup(), entry = (await listKnownRetentionDisposalRecoveries(s.storage, disposalActor, () => true)).entries[0];
    const receipt = await recoverKnownRetentionDisposal(entry, { authenticatedUserId: disposalActor, storage: s.storage, isCurrentAuth: () => true, signal: new AbortController().signal, apiFetch: async () => {
      if (kind === "replacement") s.values.set(s.key, "replacement");
      return json({ ok: true, data: disposalResult({ kind: "receipt", receipt: kind === "null" ? null : { ...s.receipt, ...(kind === "actor" ? { actorId: id(99) } : kind === "command" ? { commandFingerprint: "f".repeat(64) } : {}) } }) }); } });
    assert.equal(receipt, null); assert.equal(s.values.get(s.key), kind === "replacement" ? "replacement" : s.raw);
  }
});
test("malformed storage remains untouched and the shared 64-slot cap is not expanded", async () => {
  const s = await setup(); s.values.set(s.key, "invalid"); assert.equal((await listKnownAttendanceRecoveries(s.storage, disposalActor, () => true)).invalid, true); assert.equal(s.values.get(s.key), "invalid");
  for (let n = 0; n < 65; n++) s.values.set(`faolla:attendance:retention-disposal:v1:${90000000 + n}:${disposalActor}`, s.raw);
  await assert.rejects(listKnownAttendanceRecoveries(s.storage, disposalActor, () => true), /recovery_storage_limit/);
});
