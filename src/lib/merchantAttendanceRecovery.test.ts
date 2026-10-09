import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { listKnownAttendanceRecoveries, recoverKnownAttendance, type AttendanceRecoveryStorage } from "./merchantAttendanceRecovery";
import { accountStatusPendingKey } from "./merchantAttendanceAccountSuspensionClient";
import { missingDelegationPendingKey } from "./merchantAttendanceMissingDelegationClient";
import { applicationDelegationPendingKey } from "./merchantAttendanceApplicationDelegationClient";
import { accountStatusCommandFingerprint } from "./merchantAttendanceAccountSuspension";
import { missingDelegationCommandFingerprint, parseMissingDelegationHttpQuery } from "./merchantAttendanceMissingDelegation";
import { applicationDelegationCommandFingerprint, parseApplicationDelegationHttpQuery } from "./merchantAttendanceApplicationDelegation";
import { missingDelegationId as id, missingDelegationCommand as missingCommand, missingDelegationQuery as missingQuery, missingDelegationReceiptHttp as missingReceipt } from "../../scripts/fixtures/attendance-missing-delegation-model";
import { applicationDelegationCommand as applicationCommand, applicationDelegationQuery as applicationQuery, applicationDelegationReceiptHttp as applicationReceipt } from "../../scripts/fixtures/attendance-application-delegation-model";
import { accountStatusCommand, accountStatusReceiptHttp } from "../../scripts/fixtures/attendance-account-suspension-model";
const auth = id(3), siteId = "99990001", current = () => true;
async function fixture() { const values = new Map<string, string>(), storage: AttendanceRecoveryStorage = { get length() { return values.size; }, key: n => [...values.keys()][n] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  for (const kind of ["missing", "application"] as const) { const query = kind === "missing" ? missingQuery("delegate", "decide") : applicationQuery("delegate", "decide"), command = kind === "missing" ? missingCommand() : applicationCommand();
    const commandFingerprint = kind === "missing" ? await missingDelegationCommandFingerprint(siteId, "delegate", missingCommand()) : await applicationDelegationCommandFingerprint(siteId, "delegate", applicationCommand());
    storage.setItem((kind === "missing" ? missingDelegationPendingKey : applicationDelegationPendingKey)(siteId, "delegate", id(2)), JSON.stringify({ version: 1, anchorId: id(2), actorId: auth, employeeId: id(2), query, command, commandFingerprint })); }
  storage.setItem(accountStatusPendingKey(siteId, auth), JSON.stringify({ version: 1, siteId, actorId: auth, command: accountStatusCommand(), commandFingerprint: await accountStatusCommandFingerprint(siteId, accountStatusCommand()) })); return { values, storage }; }
test("one local aggregate lists three valid kinds and excludes foreign Auth, unrelated and restore-operation keys", async () => {
  const f = await fixture(); f.storage.setItem("unrelated", "do not parse"); f.storage.setItem("faolla:attendance:account-suspension:v1:" + siteId + ":" + auth, "{not supported}");
  const result = await listKnownAttendanceRecoveries(f.storage, auth, current); assert.deepEqual(result.entries.map(x => x.kind).sort(), ["account-status", "application", "missing"]); assert.equal(result.invalid, false); assert(Object.isFrozen(result.entries));
  assert.doesNotMatch(JSON.stringify(result), /reason|offboarding|proposal|"status":|employeeName/);
});
test("combined prefix limit is64 across all three families, not64 per kind, and total storage metadata is bounded", async () => {
  const f = await fixture(); f.values.clear(); for (let n = 0; n < 65; n++) { const kind = ["missing-delegation", "application-delegation", "account-status"][n % 3]; f.storage.setItem(`faolla:attendance:${kind}:v1:${n}`, "{}"); }
  await assert.rejects(listKnownAttendanceRecoveries(f.storage, auth, current), /recovery_storage_limit/);
  f.values.clear(); for (let n = 0; n < 2049; n++) f.storage.setItem(`unrelated${n}`, ""); await assert.rejects(listKnownAttendanceRecoveries(f.storage, auth, current), /recovery_storage_limit/);
});
test("aggregate malformed records are untouched and current Auth invalidation cannot publish a partial list", async () => {
  const f = await fixture(), key = accountStatusPendingKey(siteId, auth); f.storage.setItem(key, "{broken"); const r = await listKnownAttendanceRecoveries(f.storage, auth, current); assert.equal(r.invalid, true); assert.equal(r.entries.length, 2); assert.equal(f.storage.getItem(key), "{broken");
  let live = true; const scan = listKnownAttendanceRecoveries(f.storage, auth, () => live); live = false; await assert.rejects(scan, /recovery_scope_changed/);
  const values = await listKnownAttendanceRecoveries(f.storage, id(999), current); assert.equal(values.entries.length, 0);
});
test("aggregate preserves both old helpers' exact GET recovery and returns discriminated minimal receipts", async () => {
  const f = await fixture(), entries = (await listKnownAttendanceRecoveries(f.storage, auth, current)).entries; let gets = 0;
  for (const entry of entries) { const receipt = await recoverKnownAttendance(entry, { authenticatedUserId: auth, storage: f.storage, isCurrentAuth: current, signal: new AbortController().signal,
    apiFetch: async (path, init) => { gets++; assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
      if (entry.kind === "account-status") { const r = await accountStatusReceiptHttp(); r.statusReceipt!.actorId = auth; return Response.json(r); }
      return Response.json(entry.kind === "missing" ? await missingReceipt(parseMissingDelegationHttpQuery("https://example.test" + path), missingCommand()) : await applicationReceipt(parseApplicationDelegationHttpQuery("https://example.test" + path), applicationCommand())); } });
    assert(receipt); assert.equal(receipt.kind, entry.kind); assert.equal(receipt.actorId, auth); assert.equal(f.storage.getItem(entry.storageKey), null); assert.doesNotMatch(JSON.stringify(receipt), /command|reason|workerName|proposal/); }
  assert.equal(gets, 3); assert.equal(f.values.size, 0);
});
test("aggregate reuses old helpers without changing their protocols or adding account-suspension restore support", () => {
  const source = readFileSync(new URL("./merchantAttendanceRecovery.ts", import.meta.url), "utf8"); assert.match(source, /await listKnownDelegationRecoveries\(/); assert.match(source, /await recoverKnownDelegation\(entry, options\)/);
  assert.doesNotMatch(source, /AttendanceMissingDelegationClient|AttendanceApplicationDelegationClient|parseMissingDelegationBody|parseApplicationDelegationBody|account-suspension:/);
});
