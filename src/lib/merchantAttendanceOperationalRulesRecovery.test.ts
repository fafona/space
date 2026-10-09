import assert from "node:assert/strict";
import test from "node:test";
import { listKnownOperationalRulesRecoveries, recoverKnownOperationalRules } from "./merchantAttendanceOperationalRulesRecovery";
import { listKnownAttendanceRecoveries, recoverKnownAttendance, type AttendanceRecoveryStorage } from "./merchantAttendanceRecovery";
import { operationalRuleLedgerPendingKey } from "./merchantAttendanceOperationalRuleLedgerClient";
import { operationalRuleLedgerCommandFingerprint, parseOperationalRuleLedgerHttpQuery } from "./merchantAttendanceOperationalRuleLedger";
import { operationalRuleLedgerActor as actor, operationalRuleLedgerSite as site, operationalRuleLedgerId as id, operationalRuleLedgerScope as scope,
  operationalRuleLedgerSaveCommand as command, operationalRuleLedgerReceiptResult as receipt, operationalRuleLedgerResult as result } from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const current = () => true;
async function fixture() {
  const values = new Map<string, string>(), storage: AttendanceRecoveryStorage = { get length() { return values.size; }, key: n => [...values.keys()][n] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const c = command(scope("personal")), q = { siteId: site, mode: "detail", scope: c.scope }, fingerprint = await operationalRuleLedgerCommandFingerprint(c, actor), key = operationalRuleLedgerPendingKey(site, actor);
  const raw = JSON.stringify({ version: 1, actorId: actor, query: q, command: c, commandFingerprint: fingerprint }, null, 2); values.set(key, raw);
  return { values, storage, c, q, fingerprint, key, raw, response: { ok: true, data: await receipt(c) } };
}
test("aggregate local discovery requires exact original Auth, no owner/current-directory or HTTP", async () => {
  const f = await fixture(), before = [...f.values], list = await listKnownAttendanceRecoveries(f.storage, actor, current);
  assert.equal(list.invalid, false); assert.equal(list.entries.length, 1); assert.equal(list.entries[0].kind, "operational-rules");
  assert.doesNotMatch(JSON.stringify(list), /"rules"|reason|employeeId|employeeAuthUserId|workerId/);
  assert.deepEqual([...f.values], before); assert.deepEqual((await listKnownOperationalRulesRecoveries(f.storage, id(99), current)).entries, []);
});
test("original actor after owner loss recovers one exact GET with flag off and CAS-clears only matching bytes", async () => {
  const f = await fixture(), entry = (await listKnownAttendanceRecoveries(f.storage, actor, current)).entries[0]; let calls = 0;
  const r = await recoverKnownAttendance(entry, { authenticatedUserId: actor, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal, apiFetch: async (path, init) => {
    calls++; assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.deepEqual(parseOperationalRuleLedgerHttpQuery("https://synthetic.invalid" + path), { siteId: site, mode: "recover", operationId: f.c.operationId }); return Response.json(f.response);
  } });
  assert.equal(calls, 1); assert.equal(r?.kind, "operational-rules"); assert.equal(r?.actorId, actor); assert.equal(f.storage.getItem(f.key), null); assert.doesNotMatch(JSON.stringify(r), /reason|"rules"|expectedRevision/);
});
test("null, hash mismatch, foreign receipt, extra body or broken JSON preserves original intent", async () => {
  for (const variant of ["null", "hash", "actor", "body", "broken"]) {
    const f = await fixture(), entry = (await listKnownOperationalRulesRecoveries(f.storage, actor, current)).entries[0];
    const response = variant === "null" ? { ok: true, data: result({ kind: "receipt" }, false) } : variant === "hash" ? { ok: true, data: { ...f.response.data, receipt: { ...f.response.data.receipt, commandFingerprint: "f".repeat(64) } } }
      : variant === "actor" ? { ok: true, data: { ...f.response.data, actorId: id(99) } } : variant === "body" ? { ...f.response, rules: {} } : f.response;
    const r = await recoverKnownOperationalRules(entry, { authenticatedUserId: actor, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal,
      apiFetch: async () => variant === "broken" ? new Response('{"ok":', { headers: { "content-type": "application/json" } }) : Response.json(response) });
    assert.equal(r, null); assert.equal(f.storage.getItem(f.key), f.raw);
  }
});
test("invalid local hash and malformed records remain untouched and never become visible", async () => {
  for (const variant of ["hash", "broken", "key"]) { const f = await fixture(); if (variant === "key") { f.values.delete(f.key); f.values.set(f.key.replace(actor, id(99)), f.raw); }
    else f.values.set(f.key, variant === "broken" ? "{" : JSON.stringify({ ...JSON.parse(f.raw), commandFingerprint: "f".repeat(64) }));
    const before = [...f.values], list = await listKnownOperationalRulesRecoveries(f.storage, actor, current); assert.equal(list.invalid, true); assert.equal(list.entries.length, 0); assert.deepEqual([...f.values], before); }
});
test("storage replacement or changed Auth while GET runs cannot clear any intent", async () => {
  for (const variant of ["storage", "auth"]) { const f = await fixture(), entry = (await listKnownOperationalRulesRecoveries(f.storage, actor, current)).entries[0]; let live = true;
    const work = recoverKnownOperationalRules(entry, { authenticatedUserId: actor, storage: f.storage, isCurrentAuth: () => live, signal: new AbortController().signal, apiFetch: async () => { if (variant === "storage") f.values.set(f.key, "replacement"); else live = false; return Response.json(f.response); } });
    if (variant === "auth") await assert.rejects(work, /recovery_scope_changed/); else assert.equal(await work, null); assert(f.storage.getItem(f.key)); }
});
test("abort interrupts hung digest and prevents late digest from displaying or deleting", async () => {
  const f = await fixture(), abort = new AbortController(), original = crypto.subtle.digest; let release!: (v: ArrayBuffer) => void;
  crypto.subtle.digest = (() => new Promise<ArrayBuffer>(resolve => { release = resolve; })) as typeof original;
  try { const scan = listKnownOperationalRulesRecoveries(f.storage, actor, current, abort.signal); await new Promise(resolve => setTimeout(resolve, 5)); abort.abort(); await assert.rejects(scan, /recovery_scope_changed/); release(new ArrayBuffer(32)); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.storage.getItem(f.key), f.raw); }
  finally { crypto.subtle.digest = original; }
});
test("forged descriptor and global65 bound refuse before any HTTP", async () => {
  const f = await fixture(), entry = (await listKnownOperationalRulesRecoveries(f.storage, actor, current)).entries[0]; let calls = 0;
  await assert.rejects(recoverKnownOperationalRules({ ...entry, operationId: id(99) }, { authenticatedUserId: actor, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal, apiFetch: async () => { calls++; throw Error("no"); } })); assert.equal(calls, 0);
  for (let n = 0; n < 65; n++) f.values.set(operationalRuleLedgerPendingKey(String(99990100 + n), actor), f.raw);
  await assert.rejects(listKnownAttendanceRecoveries(f.storage, actor, current), /recovery_storage_limit/);
});
