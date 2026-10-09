import assert from "node:assert/strict";
import test from "node:test";
import { parseKnownAccountStatusRecovery, listKnownAccountStatusRecoveries, recoverKnownAccountStatus } from "./merchantAttendanceAccountStatusRecovery";
import { accountStatusPendingKey } from "./merchantAttendanceAccountSuspensionClient";
import { accountStatusCommandFingerprint, ACCOUNT_SUSPENSION_API, parseAccountSuspensionHttpQuery } from "./merchantAttendanceAccountSuspension";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import { accountSuspensionId as id, accountSuspensionOwner as auth, accountSuspensionSite as siteId, accountStatusCommand as command,
  accountStatusReceiptHttp as receipt, accountSuspensionHttp as wire } from "../../scripts/fixtures/attendance-account-suspension-model";
const current = () => true;
async function fixture() { const values = new Map<string, string>(), storage: DelegationRecoveryStorage = { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const key = accountStatusPendingKey(siteId, auth), raw = JSON.stringify({ version: 1, siteId, actorId: auth, command: command(), commandFingerprint: await accountStatusCommandFingerprint(siteId, command()) });
  storage.setItem(key, raw); const entry = await parseKnownAccountStatusRecovery(key, raw, auth); assert(entry); return { values, storage, key, raw, entry }; }
test("local account-status descriptions expose only exact Auth/key/fingerprint-bound minimal metadata", async () => {
  const f = await fixture(), result = await listKnownAccountStatusRecoveries(f.storage, auth, current); assert.deepEqual(result.entries, [f.entry]); assert.equal(result.invalid, false);
  assert.deepEqual(Object.keys(f.entry), ["kind", "storageKey", "siteId", "authUserId", "operationId", "commandFingerprint"]);
  assert.doesNotMatch(JSON.stringify(result), /employeeId|disabled|offboardingMode|replacement|reason/);
  assert.equal(await parseKnownAccountStatusRecovery(f.key, f.raw, id(999)), null); assert.equal(f.storage.getItem(f.key), f.raw);
});
test("strict exact5/UTF8/duplicate JSON/command/key validation rejects fabricated local recovery without deleting it", async () => {
  const f = await fixture();
  for (const raw of [f.raw.replace('"version":1', '"version":1,"version":1'), JSON.stringify({ ...JSON.parse(f.raw), reason: "private" }),
    JSON.stringify({ ...JSON.parse(f.raw), command: { ...command(), action: "restore" } }), JSON.stringify({ ...JSON.parse(f.raw), commandFingerprint: "0".repeat(64) }),
    JSON.stringify({ ...JSON.parse(f.raw), command: { ...command(), replacementEmployeeId: id(88) } }), " ".repeat(8193), f.raw + " ".repeat(8193)]) await assert.rejects(parseKnownAccountStatusRecovery(f.key, raw, auth));
  await assert.rejects(parseKnownAccountStatusRecovery(f.key.replace(siteId, "99990002"), f.raw, auth));
  await assert.rejects(parseKnownAccountStatusRecovery(f.key.replace("account-status", "account-suspension"), f.raw, auth));
  f.storage.setItem(f.key, "{bad"); const result = await listKnownAccountStatusRecoveries(f.storage, auth, current); assert(result.invalid); assert.equal(result.entries.length, 0); assert.equal(f.storage.getItem(f.key), "{bad");
});
test("actual193 client recovery performs one exact GET, never PATCH/POST, and exposes only minimal verified receipt", async () => {
  const f = await fixture(); let calls = 0, writes = 0;
  const result = await recoverKnownAccountStatus(f.entry, { authenticatedUserId: auth, storage: { ...f.storage, setItem: () => { writes++; throw Error("no writes"); } }, signal: new AbortController().signal, isCurrentAuth: current,
    apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert(path.startsWith(ACCOUNT_SUSPENSION_API + "?"));
      assert.deepEqual(parseAccountSuspensionHttpQuery("https://www.faolla.com" + path), { siteId, mode: "recover-status", afterId: null, suspensionId: null, operationId: command().operationId }); return Response.json(await receipt()); } });
  assert.equal(calls, 1); assert.equal(writes, 0); assert(result); assert.equal(result.status, "disabled"); assert.equal(f.storage.getItem(f.key), null);
  assert.deepEqual(Object.keys(result), ["operationId", "actorId", "employeeId", "status", "expectedVersion", "version", "suspensionId", "recordedAt"]); assert(Object.isFrozen(result));
  assert.doesNotMatch(JSON.stringify(result), /command|reason|offboarding|employeeName|workerName/);
});
test("null, denial, malformed, wrong kind/Auth/op/hash/version replies preserve exact original pending", async () => {
  for (const kind of ["null", "denied", "malformed", "kind", "actor", "op", "hash", "version"] as const) {
    const f = await fixture(); const result = await recoverKnownAccountStatus(f.entry, { authenticatedUserId: auth, storage: f.storage, signal: new AbortController().signal, isCurrentAuth: current,
      apiFetch: async () => { if (kind === "null") return Response.json(wire("recover-status")); if (kind === "denied") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
        if (kind === "malformed") return Response.json({ ok: true, private: "must not appear" }); const r = await receipt();
        if (kind === "kind") r.mode = "recover"; else Object.assign(r.statusReceipt!, kind === "actor" ? { actorId: id(999) } : kind === "op" ? { operationId: id(99) } : kind === "hash" ? { commandFingerprint: "0".repeat(64) } : { version: 99 }); return Response.json(r); } });
    assert.equal(result, null); assert.equal(f.storage.getItem(f.key), f.raw);
  }
});
test("different Auth, pre-abort and synchronous local scan invalidation expose no IDs and send no requests", async () => {
  const f = await fixture(); let calls = 0;
  await assert.rejects(recoverKnownAccountStatus(f.entry, { authenticatedUserId: id(999), storage: f.storage, signal: new AbortController().signal, isCurrentAuth: current, apiFetch: async () => { calls++; throw Error(); } }));
  const abort = new AbortController(); abort.abort(); await assert.rejects(listKnownAccountStatusRecoveries(f.storage, auth, current, abort.signal));
  for (const phase of ["before", "storage", "hash"] as const) { let live = phase !== "before";
    const scan = listKnownAccountStatusRecoveries({ ...f.storage, getItem: key => { if (phase === "storage") live = false; return f.storage.getItem(key); } }, auth, () => live);
    if (phase === "hash") live = false; await assert.rejects(scan, /recovery_scope_changed/); }
  assert.equal(calls, 0); assert.equal(f.storage.getItem(f.key), f.raw);
});
test("Auth invalidation before headers/body or inside final storage CAS cannot clear original pending", async () => {
  for (const phase of ["headers", "body", "cas"] as const) { const f = await fixture(); let live = true, removals = 0, armed = false, readCount = 0, release!: () => void, start!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { start = resolve; });
    const storage = { ...f.storage, getItem: (key: string) => { if (armed && phase === "cas" && ++readCount === 3) live = false; return f.storage.getItem(key); }, removeItem: (key: string) => { removals++; f.storage.removeItem(key); } };
    const run = recoverKnownAccountStatus(f.entry, { authenticatedUserId: auth, storage, signal: new AbortController().signal, isCurrentAuth: () => live,
      apiFetch: async () => { const r = await receipt(); if (phase === "cas") { armed = true; return Response.json(r); }
        if (phase === "headers") { start(); await held; return Response.json(r); }
        return new Response(new ReadableStream<Uint8Array>({ async start(body) { start(); await held; body.enqueue(new TextEncoder().encode(JSON.stringify(r))); body.close(); } }), { headers: { "content-type": "application/json" } }); } });
    if (phase !== "cas") { await started; live = false; release(); } await assert.rejects(run, /recovery_scope_changed/); assert.equal(removals, 0); assert.equal(f.storage.getItem(f.key), f.raw);
  }
});
test("replacement and abort during actual GET preserve bytes, while malformed UTF8 and byte caps do not settle", async () => {
  for (const mode of ["replace", "abort", "utf8", "cap"] as const) { const f = await fixture(), signal = new AbortController();
    const run = recoverKnownAccountStatus(f.entry, { authenticatedUserId: auth, storage: f.storage, signal: signal.signal, isCurrentAuth: current,
      apiFetch: async () => { const r = await receipt(); if (mode === "replace") f.storage.setItem(f.key, f.raw + " "); if (mode === "abort") signal.abort();
        return mode === "utf8" ? new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })
          : mode === "cap" ? new Response("x".repeat(131073), { headers: { "content-type": "application/json" } }) : Response.json(r); } });
    if (mode === "abort") await assert.rejects(run, /recovery_scope_changed/); else assert.equal(await run, null); assert.equal(f.storage.getItem(f.key), f.raw + (mode === "replace" ? " " : ""));
  }
});
