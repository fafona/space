import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseAccountSuspensionQuery, parseAccountSuspensionHttpQuery, accountSuspensionQueryString, parseAccountSuspensionBody, parseAccountStatusCommand,
  parseAccountSuspensionJson, parseAccountSuspensionResponse, accountSuspensionCommandFingerprint, accountStatusCommandFingerprint } from "./merchantAttendanceAccountSuspension";
import { accountSuspensionQuery as query, accountSuspensionHttp as wire, accountSuspensionOwner as owner, accountSuspensionCommand as command,
  accountStatusCommand as status, accountSuspensionReceiptHttp as receipt, accountStatusReceiptHttp as statusReceipt, accountSuspensionId as id } from "../../scripts/fixtures/attendance-account-suspension-model";

test("strict queries keep absent versus explicit null HTTP fields and no identity injection", () => {
  for (const mode of ["list", "detail", "recover", "recover-status"] as const) { const q = query(mode); assert.deepEqual(parseAccountSuspensionHttpQuery("https://www.faolla.com/?" + accountSuspensionQueryString(q)), q); }
  for (const suffix of ["&siteId=99990001", "&actorId=" + owner, "&afterId=null", "&afterId=", "&mode=list", "&suspensionId=%20" + id(10)]) assert.throws(() => parseAccountSuspensionHttpQuery("https://www.faolla.com/?" + accountSuspensionQueryString(query()) + suffix));
  assert.throws(() => parseAccountSuspensionQuery({ ...query(), siteId: "99990001 " }));
  assert.throws(() => parseAccountSuspensionQuery({ ...query("recover"), suspensionId: id(10) }));
  assert.throws(() => parseAccountSuspensionQuery({ ...query(), afterId: "A4000000-0000-4000-8000-000000000010" }));
});
test("restore exact ten fields and pure employee status commands cannot mix authority or profile changes", () => {
  assert.deepEqual(parseAccountSuspensionBody({ query: query("detail"), command: command() }).command, command());
  for (const patch of [{ workerId: null }, { expectedGeneration: 0 }, { reason: " " }, { employeeAuthUserId: null }, { reason: "x\n" }, { allowRestore: true }]) assert.throws(() => parseAccountSuspensionBody({ query: query("detail"), command: { ...command(), ...patch } }));
  assert.throws(() => parseAccountSuspensionBody({ query: query(), command: command() }));
  assert.deepEqual(parseAccountStatusCommand(status()), status());
  for (const patch of [{ status: "invited" }, { roleId: id(7) }, { attendance_suspension_enabled: true }, { operationId: "old-text-op" }, { offboardingMode: "reassign" }, { replacementEmployeeId: id(9) }]) assert.throws(() => parseAccountStatusCommand({ ...status(), ...patch }));
});
test("strict graph, UTF8 byte bounds, descriptors and duplicate JSON are rejected without executing getters", () => {
  let hits = 0; const getter = { ...wire(), get secret() { hits++; return "private"; } }; assert.throws(() => parseAccountSuspensionResponse(getter, query(), owner)); assert.equal(hits, 0);
  for (const raw of ['{"x":1,"x":2}', '{"x":"\\ud800"}', '{"__proto__":{}}', " ".repeat(131073), '{"x":0.1}']) assert.throws(() => parseAccountSuspensionJson(raw));
  const cycle: Record<string, unknown> = wire(); cycle.self = cycle; assert.throws(() => parseAccountSuspensionResponse(cycle, query(), owner));
});
test("list/detail is deeply immutable, cross-bound to suspension and never claims pending review is complete", () => {
  const parsed = parseAccountSuspensionResponse(wire("detail"), query("detail"), owner); assert.equal(Object.isFrozen(parsed.detail?.pendingReview), true);
  for (const patch of [{ canRestore: false }, { blockers: ["employee_inactive"] }, { employeeStatus: "disabled" }, { pendingReview: { leave: 0, workArrangement: 0, missing: 0, unknownOperations: 0 } }]) {
    const raw = wire("detail"); raw.detail = { ...raw.detail!, ...patch } as typeof raw.detail; assert.throws(() => parseAccountSuspensionResponse(raw, query("detail"), owner)); }
  const raw = wire(); raw.items.push(raw.items[0]); assert.throws(() => parseAccountSuspensionResponse(raw, query(), owner));
  assert.throws(() => parseAccountSuspensionResponse({ ...wire(), nextAfterId: id(10) }, query(), owner));
  const noWorker = wire("detail"); Object.assign(noWorker.detail!.suspension, { workerId: null, workerName: null, wasActive: null }); Object.assign(noWorker.detail!, { workerVersion: null, workerActive: null, originalAction: null, currentAction: null });
  assert.equal(parseAccountSuspensionResponse(noWorker, query("detail"), owner).detail?.suspension.workerId, null);
  Object.assign(noWorker.detail!, { workerVersion: 1, workerActive: true, blockers: ["binding_changed"], canRestore: false });
  assert.equal(parseAccountSuspensionResponse(noWorker, query("detail"), owner).detail?.canRestore, false);
});
test("separate original receipt kinds bind actor, operation, version and immutable identity", async () => {
  const a = await receipt(), b = await statusReceipt(); assert.ok(parseAccountSuspensionResponse(a, query("recover"), owner).receipt); assert.ok(parseAccountSuspensionResponse(b, query("recover-status"), owner).statusReceipt);
  assert.throws(() => parseAccountSuspensionResponse(a, query("recover"), id(999)));
  assert.throws(() => parseAccountSuspensionResponse({ ...a, mode: "recover-status" }, query("recover-status"), owner));
  for (const patch of [{ actorId: id(99) }, { operationId: id(99) }, { version: 3 }, { command: status() }]) assert.throws(() => parseAccountSuspensionResponse({ ...b, statusReceipt: { ...b.statusReceipt!, ...patch } }, query("recover-status"), owner));
  const result = { ...a, mode: "detail", detail: wire("detail").detail }; assert.ok(parseAccountSuspensionResponse(result, query("detail"), owner, command()).receipt);
  assert.throws(() => parseAccountSuspensionResponse(result, query("detail"), owner, { ...command(), employeeId: id(99) }));
});
test("scalar tuple fingerprints are compact JS JSON, preserve Unicode and do not hash PG array whitespace", async () => {
  const c = { ...command(), reason: '核验 "😀"' }, tuple = ["attendance-account-restore-v1", query().siteId, c.action, c.operationId, c.suspensionId, c.expectedGeneration, c.workerId, c.expectedWorkerVersion, c.expectedEmployeeVersion, c.employeeId, c.employeeAuthUserId, c.reason];
  assert.equal(await accountSuspensionCommandFingerprint(query().siteId, c), createHash("sha256").update(JSON.stringify(tuple)).digest("hex"));
  const s = status(), hash = await accountStatusCommandFingerprint(query().siteId, s); assert.equal(hash, createHash("sha256").update(JSON.stringify(["attendance-account-status-v1", query().siteId, s.operationId, s.employeeId, s.version, s.status, s.offboardingMode, null])).digest("hex"));
  assert.notEqual(hash, await accountStatusCommandFingerprint(query().siteId, { ...s, status: "active", offboardingMode: undefined } as unknown as typeof s).catch(() => "invalid"));
});
