import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseKnownScheduleDelegationRecovery, listKnownScheduleDelegationRecoveries, recoverKnownScheduleDelegation } from "./merchantAttendanceScheduleDelegationRecovery";
import { listKnownAttendanceRecoveries, recoverKnownAttendance } from "./merchantAttendanceRecovery";
import { scheduleDelegationPendingKey } from "./merchantAttendanceScheduleDelegationClient";
import { scheduleDelegationFingerprint, parseScheduleDelegationHttpQuery } from "./merchantAttendanceScheduleDelegation";
import { scheduleDelegationId as id, scheduleDelegationQuery as query, scheduleDelegationCommand as command,
  scheduleDelegationGrantCommand as grant, scheduleDelegationReceiptHttp as receipt, scheduleDelegationWire as wire } from "../../scripts/fixtures/attendance-schedule-delegation-model";
import { KnownAttendanceRecoveryEntry, AttendanceRecoveryReceiptView } from "../components/enterprise/MerchantAttendanceDelegationRecoveryPanel";
import type { DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
const memory = () => { const values = new Map<string, string>(), removed: string[] = [];
  const storage: DelegationRecoveryStorage = { get length() { return values.size; }, key: n => [...values.keys()][n] ?? null, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }, removeItem: key => { removed.push(key); values.delete(key); } }; return { storage, values, removed }; };
async function setup(owner = false) {
  const q = query(owner ? "owner" : "delegate", owner ? "list" : "schedule"), c = owner ? grant() : command(), auth = id(owner ? 1 : 3), anchor = id(owner ? 1 : 2);
  const key = scheduleDelegationPendingKey(q.siteId, q.access, anchor), raw = JSON.stringify({ version: 1, anchorId: anchor, actorId: auth, employeeId: owner ? null : anchor,
    query: q, command: c, commandFingerprint: await scheduleDelegationFingerprint(q, c) });
  const m = memory(); m.values.set(key, raw); const entry = await parseKnownScheduleDelegationRecovery(key, raw, auth); assert(entry); return { ...m, q, c, auth, anchor, key, raw, entry };
}
for (const owner of [true, false]) test(`schedule ${owner ? "owner" : "delegate"} recovery exposes one original GET and clears only matching receipt`, async () => {
  const p = await setup(owner), calls: string[] = [], controller = new AbortController();
  p.values.set("unrelated", "keep"); const before = [...p.values];
  const found = await listKnownAttendanceRecoveries(p.storage, p.auth, () => true); assert.equal(found.invalid, false); assert.deepEqual(found.entries, [p.entry]); assert.deepEqual([...p.values], before);
  const result = await recoverKnownAttendance(p.entry, { storage: p.storage, authenticatedUserId: p.auth, signal: controller.signal, isCurrentAuth: () => true,
    apiFetch: async (path, init) => { assert.equal(init?.method, "GET"); assert.equal(init.body, undefined); assert(path.startsWith("/api/merchant-enterprise/attendance/schedule-delegation?"));
      const q = parseScheduleDelegationHttpQuery("https://recovery.invalid" + path); assert.equal(q.mode, "recover"); assert.equal(q.operationId, p.entry.operationId); calls.push(path); return Response.json(await receipt(p.q, p.c, q)); } });
  assert(result?.kind === "schedule"); assert.equal(result.actorId, p.auth); assert.equal(result.operationId, p.entry.operationId); assert.equal(calls.length, 1);
  assert.deepEqual(p.removed, [p.key]); assert.deepEqual([...p.values], [["unrelated", "keep"]]);
  const html = renderToStaticMarkup(<><KnownAttendanceRecoveryEntry entry={p.entry}/><AttendanceRecoveryReceiptView receipt={result}/></>);
  assert(html.includes("授权员工排班原操作")); assert(html.includes("不证明当前授权仍有效")); assert(!html.includes("明确  排班"));
});
test("foreign Auth, altered intent, duplicate JSON and mismatched namespace never reach the network", async () => {
  const p = await setup(); assert.equal(await parseKnownScheduleDelegationRecovery(p.key, p.raw, id(99)), null);
  for (const raw of [p.raw.replace('"version":1', '"version":1,"version":1'), p.raw.replace("明确  排班", "另一意图"), p.raw.replace('"anchorId":"' + p.anchor, '"anchorId":"' + id(77))])
    await assert.rejects(parseKnownScheduleDelegationRecovery(p.key, raw, p.auth));
  await assert.rejects(parseKnownScheduleDelegationRecovery(p.key.replace("schedule-delegation", "application-delegation"), p.raw, p.auth));
  const listed = await listKnownScheduleDelegationRecoveries(p.storage, id(99), () => true); assert.equal(listed.entries.length, 0); assert.equal(listed.invalid, false); assert.deepEqual(p.removed, []);
});
test("missing or malformed receipt preserves exact raw; no automatic POST", async () => {
  for (const bad of [false, true]) { const p = await setup(); let calls = 0;
    const result = await recoverKnownScheduleDelegation(p.entry, { storage: p.storage, authenticatedUserId: p.auth, signal: new AbortController().signal, isCurrentAuth: () => true,
      apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); const q = parseScheduleDelegationHttpQuery("https://recovery.invalid" + path);
        if (!bad) return Response.json({ ok: true, ...wire(q) }); const value = await receipt(p.q, p.c, q); value.receipt.commandFingerprint = "f".repeat(64); return Response.json(value); } });
    assert.equal(result, null); assert.equal(calls, 1); assert.equal(p.values.get(p.key), p.raw); assert.deepEqual(p.removed, []);
  }
});
test("storage replacement during GET cannot delete another pending intent", async () => {
  const p = await setup(); const replacement = p.raw + " "; let calls = 0;
  const result = await recoverKnownScheduleDelegation(p.entry, { storage: p.storage, authenticatedUserId: p.auth, signal: new AbortController().signal, isCurrentAuth: () => true,
    apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); p.values.set(p.key, replacement); return Response.json(await receipt(p.q, p.c, parseScheduleDelegationHttpQuery("https://recovery.invalid" + path))); } });
  assert.equal(result, null); assert.equal(calls, 1); assert.equal(p.values.get(p.key), replacement); assert.deepEqual(p.removed, []);
});
test("scope loss/abort prohibits requests and late results cannot remove raw", async () => {
  const p = await setup(), controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(recoverKnownScheduleDelegation(p.entry, { storage: p.storage, authenticatedUserId: p.auth, signal: controller.signal, isCurrentAuth: () => true, apiFetch: async () => { calls++; throw Error("unexpected"); } }));
  let current = true;
  await assert.rejects(recoverKnownScheduleDelegation(p.entry, { storage: p.storage, authenticatedUserId: p.auth, signal: new AbortController().signal, isCurrentAuth: () => current,
    apiFetch: async (path, init) => { calls++; assert.equal(init?.method, "GET"); current = false; return Response.json(await receipt(p.q, p.c, parseScheduleDelegationHttpQuery("https://recovery.invalid" + path))); } }));
  assert.equal(calls, 1); assert.equal(p.values.get(p.key), p.raw); assert.deepEqual(p.removed, []);
});
test("aggregate bounded inventory applies across all five recovery channels", async () => {
  const p = await setup(); for (let n = 0; n < 65; n++) p.values.set(`faolla:attendance:schedule-delegation:v1:98400198:delegate:${id(100 + n)}`, p.raw);
  await assert.rejects(listKnownAttendanceRecoveries(p.storage, p.auth, () => true), /recovery_storage_limit/); assert.deepEqual(p.removed, []);
});
