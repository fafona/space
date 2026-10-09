import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseKnownEmploymentLifecycleRecovery, listKnownEmploymentLifecycleRecoveries, recoverKnownEmploymentLifecycle } from "./merchantAttendanceEmploymentLifecycleRecovery";
import { employmentLifecyclePendingKey } from "./merchantAttendanceEmploymentLifecycleClient";
import { employmentLifecycleCommandFingerprint, parseEmploymentLifecycleHttpQuery } from "./merchantAttendanceEmploymentLifecycle";
import { listKnownAttendanceRecoveries, recoverKnownAttendance } from "./merchantAttendanceRecovery";
import { KnownAttendanceRecoveryEntry, AttendanceRecoveryReceiptView } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import { employmentLifecycleId as id, employmentLifecycleOwner as auth, employmentLifecycleSite as siteId, employmentLifecycleCommand as command,
  employmentLifecycleReceiptHttp as receiptHttp, employmentLifecycleHttp as wire } from "../../scripts/fixtures/attendance-employment-lifecycle-model";
const current = () => true;
async function fixture() { const values = new Map<string, string>(), storage: DelegationRecoveryStorage = { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  const key = employmentLifecyclePendingKey(siteId, auth), raw = JSON.stringify({ version: 1, siteId, actorId: auth, command: command(), commandFingerprint: await employmentLifecycleCommandFingerprint(siteId, command()) });
  storage.setItem(key, raw); const entry = await parseKnownEmploymentLifecycleRecovery(key, raw, auth); assert(entry); return { values, storage, key, raw, entry }; }
test("employment recovery inventories exact current Auth local keys without exposing subjects or intent", async () => {
  const f = await fixture(), found = await listKnownEmploymentLifecycleRecoveries(f.storage, auth, current); assert.deepEqual(found.entries, [f.entry]); assert.equal(found.invalid, false);
  assert.deepEqual(Object.keys(f.entry), ["kind", "storageKey", "siteId", "authUserId", "operationId", "commandFingerprint"]);
  assert.doesNotMatch(JSON.stringify(found), /employeeId|employeeAuthUserId|expectedDate|reason/);
  assert.equal(await parseKnownEmploymentLifecycleRecovery(f.key, f.raw, id(999)), null); assert.equal(f.storage.getItem(f.key), f.raw);
  assert.deepEqual((await listKnownAttendanceRecoveries(f.storage, auth, current)).entries, [f.entry]);
});
test("employment recovery rejects corrupted local commands/identities/fingerprints without deleting them", async () => {
  const f = await fixture(); for (const raw of [f.raw.replace('"version":1', '"version":1,"version":1'), JSON.stringify({ ...JSON.parse(f.raw), private: true }),
    JSON.stringify({ ...JSON.parse(f.raw), commandFingerprint: "0".repeat(64) }), JSON.stringify({ ...JSON.parse(f.raw), command: { ...command(), employeeAuthUserId: id(80) } }), " ".repeat(8193)]) await assert.rejects(parseKnownEmploymentLifecycleRecovery(f.key, raw, auth));
  await assert.rejects(parseKnownEmploymentLifecycleRecovery(f.key.replace(siteId, "99990002"), f.raw, auth));
  f.storage.setItem(f.key, "{broken"); const r = await listKnownAttendanceRecoveries(f.storage, auth, current); assert.equal(r.invalid, true); assert.equal(r.entries.length, 0); assert.equal(f.storage.getItem(f.key), "{broken");
});
test("employment recovery sends one exact GET, no writes, and returns a minimum historical receipt", async () => {
  const f = await fixture(); let gets = 0;
  const r = await recoverKnownAttendance(f.entry, { authenticatedUserId: auth, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal,
    apiFetch: async (path, init) => { gets++; assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); const q = parseEmploymentLifecycleHttpQuery("https://recovery.invalid" + path);
      assert.equal(q.mode, "recover"); assert.equal(q.operationId, f.entry.operationId); assert.equal(q.workerId, null); return Response.json(await receiptHttp()); } });
  assert.equal(gets, 1); assert.equal(r?.kind, "employment"); assert.equal(f.storage.getItem(f.key), null);
  assert.doesNotMatch(JSON.stringify(r), /employeeId|employeeAuthUserId|commandFingerprint|reason/);
  assert(r); const html = renderToStaticMarkup(<AttendanceRecoveryReceiptView receipt={r}/>); assert.match(html, /任职已结束/); assert.match(html, /不代表当前任职或打卡权限/);
  assert.match(renderToStaticMarkup(<KnownAttendanceRecoveryEntry entry={f.entry}/>), /任职结束／再入职原操作/);
});
test("employment unknown/503/mismatched receipt remains stored and never repeats original POST", async () => {
  for (const outcome of ["none", "503", "actor", "fingerprint"] as const) { const f = await fixture(); let gets = 0;
    const r = await recoverKnownEmploymentLifecycle(f.entry, { authenticatedUserId: auth, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal,
      apiFetch: async (_path, init) => { gets++; assert.equal(init?.method, "GET"); if (outcome === "503") return Response.json({ ok: false, error: "attendance_unavailable" }, { status: 503 });
        if (outcome === "none") return Response.json(wire("recover")); const p = await receiptHttp(); assert(p.receipt);
        if (outcome === "actor") p.receipt.actorId = id(999); else p.receipt.commandFingerprint = "0".repeat(64); return Response.json(p); } });
    assert.equal(r, null); assert.equal(gets, 1); assert.equal(f.storage.getItem(f.key), f.raw);
  }
});
test("employment recovery fails closed on swapped local record or lost current Auth", async () => {
  const f = await fixture(); let calls = 0; const options = { authenticatedUserId: auth, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal,
    apiFetch: async () => { calls++; return Response.json(await receiptHttp()); } };
  await assert.rejects(recoverKnownEmploymentLifecycle(f.entry, { ...options, authenticatedUserId: id(999) }));
  await assert.rejects(recoverKnownEmploymentLifecycle(f.entry, { ...options, isCurrentAuth: () => false }));
  const abort = new AbortController(); abort.abort(); await assert.rejects(recoverKnownEmploymentLifecycle(f.entry, { ...options, signal: abort.signal }));
  f.storage.setItem(f.key, "{changed"); await assert.rejects(recoverKnownEmploymentLifecycle(f.entry, options)); assert.equal(calls, 0);
});
test("employment closed blocker is accepted by original suspension parser but never permits restore", async () => {
  const { parseAccountSuspensionResult } = await import("./merchantAttendanceAccountSuspension");
  const { accountSuspensionQuery, accountSuspensionResult, accountSuspensionOwner } = await import("../../scripts/fixtures/attendance-account-suspension-model");
  const r = accountSuspensionResult("detail"); assert(r.detail); r.detail.canRestore = false; r.detail.blockers = ["employment_closed"];
  assert.equal(parseAccountSuspensionResult(r, accountSuspensionQuery("detail"), accountSuspensionOwner).detail?.canRestore, false);
  r.detail.canRestore = true; assert.throws(() => parseAccountSuspensionResult(r, accountSuspensionQuery("detail"), accountSuspensionOwner), { code: "attendance_account_suspension_invalid" });
});
