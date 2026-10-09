//Bounded pure/Node transport tests. Synthetic responses are not real Auth/SQL
//acceptance, historical ownership proof, or a successful delegated export.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DELEGATED_AUDIT_PROTOCOL, delegatedAuditQueryString, parseDelegatedAuditHttpQuery, parseDelegatedAuditQuery, parseDelegatedAuditBody,
  parseDelegatedAuditJson, parseDelegatedAuditResult, delegatedAuditFingerprintText, buildDelegatedAuditCsv,
  type DelegatedAuditQuery, type DelegatedAuditExportQuery, type DelegatedAuditCommand, type DelegatedAuditExport } from "./merchantAttendanceDelegatedAudit";
import { projectDelegatedAuditSource } from "./merchantAttendanceDelegatedAuditSource.server";
import { executeDelegatedAudit, delegatedAuditSiteEnabled, DELEGATED_AUDIT_RPC } from "./merchantAttendanceDelegatedAudit.server";
import { attendanceAuditCsvCell } from "./merchantAttendanceAuditExport";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
const id = (n: number) => `20300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990203", actor = id(1), grantId = id(2), at = "2026-10-08T12:00:00.000001Z", beforeAt = "2026-10-08T11:00:00.000001Z";
const command: DelegatedAuditCommand = { action: "export", operationId: id(3) };
const exported: DelegatedAuditExportQuery = { siteId, grantId, mode: "export", source: "config", fromAt: "2026-10-08T00:00:00.000000Z", toAt: "2026-10-09T00:00:00.000000Z" };
const list: Extract<DelegatedAuditQuery, { mode: "list" }> = { ...exported, mode: "list", asOf: null, cursorAt: null, cursorId: null };
const base = { protocol: DELEGATED_AUDIT_PROTOCOL, siteId, actorId: actor, readAt: at };
const authority = { grantId, source: "config", scopeKind: "audit_company", target: null };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function item(n = 10) { return { operationId: id(n), recordedAt: beforeAt, kind: "worker", version: 1, targetId: id(4), actorRef: "a".repeat(32), byCurrentOwner: false, holderRef: null }; }
function worker() { return { id: id(4), employeeId: id(5), workerNo: "A203", displayName: "Synthetic Worker", locationId: id(6), active: true, startsOn: "2026-10-01" }; }
function row(n = 10) { return { item: item(n), before: null, after: worker() }; }
function payload(rows = [row()]) { return { schemaVersion: 1, fromAt: exported.fromAt, toAt: exported.toAt, asOf: at, count: rows.length, rows }; }
function receipt(resultFingerprint = "a".repeat(64), count = 1) { return { operationId: command.operationId, actorId: actor, grantId, action: "export",
  commandFingerprint: hash(delegatedAuditFingerprintText(exported, actor, command)), asOf: at, count, resultFingerprint, recordedAt: at }; }
function wire(rows = [row()]) {
  const snapshotText = JSON.stringify(["attendance-delegated-audit-snapshot-v1", siteId, actor, grantId, exported, payload(rows)]), snapshotFingerprint = hash(snapshotText);
  return { ...base, ...authority, kind: "export", receipt: receipt(snapshotFingerprint, rows.length), snapshotText, snapshotBytes: Buffer.byteLength(snapshotText), snapshotFingerprint };
}
const minimal = () => ({ ...base, kind: "receipt", receipt: receipt() });
const publicExport = async (rows = [row()]) => {
  const value = await projectDelegatedAuditSource(wire(rows), exported, actor, command); assert.equal(value.kind, "export"); return value as DelegatedAuditExport;
};

test("203 exact query/body/HTTP permits only finite read modes and export POST", () => {
  const queries: DelegatedAuditQuery[] = [list, { siteId, grantId, mode: "detail", source: "management", sourceOperationId: id(10) }, { siteId, mode: "recover", operationId: command.operationId }];
  for (const q of queries) assert.deepEqual(parseDelegatedAuditHttpQuery("https://www.faolla.com/x?" + delegatedAuditQueryString(q)), q);
  assert.deepEqual(parseDelegatedAuditBody({ query: exported, command }), { query: exported, command });
  for (const value of [{ ...list, allowAccess: true }, { ...exported, actorId: actor }, { ...list, cursorId: id(4) }, { ...list, cursorAt: beforeAt },
    { ...list, fromAt: "2026-08-01T00:00:00.000000Z" }, { ...list, toAt: list.fromAt }, { ...list, fromAt: "2026-10-08T00:00:00.000Z" }]) assert.throws(() => parseDelegatedAuditQuery(value));
  for (const value of [{ query: list, command }, { query: exported, command: { ...command, source: "config" } }, { query: exported, command, currentOwner: actor }]) assert.throws(() => parseDelegatedAuditBody(value));
  for (const suffix of [delegatedAuditQueryString(exported), delegatedAuditQueryString(list) + "&siteId=" + siteId, delegatedAuditQueryString(list) + "#private"])
    assert.throws(() => parseDelegatedAuditHttpQuery("https://www.faolla.com/x?" + suffix));
});
test("203 rejects duplicate JSON keys, accessors, prototypes, cycles, lone surrogates, sparse and decorated arrays", () => {
  assert.throws(() => parseDelegatedAuditJson('{"siteId":"99990203","siteId":"99990203"}'));
  const accessor = { ...list }; Object.defineProperty(accessor, "siteId", { get() { throw Error("must not invoke"); }, enumerable: true });
  const cycle: Record<string, unknown> = { ...list }; cycle.extra = cycle;
  for (const value of [accessor, Object.assign(Object.create({}), list), cycle, { ...list, siteId: "\ud800" }, { ...list, [Symbol("hidden")]: 1 }]) assert.throws(() => parseDelegatedAuditQuery(value));
  assert.throws(() => parseDelegatedAuditJson('[' + '0,'.repeat(250) + '0]'));
});
test("203 command SHA binds actual actor, grant/source/window and original number, no browser authority fields", () => {
  const text = delegatedAuditFingerprintText(exported, actor, command);
  assert.equal(text, `[${["attendance-delegated-audit-command-v1", siteId, actor, grantId, "config", exported.fromAt, exported.toAt, "export", command.operationId].map(v => JSON.stringify(v)).join(", ")}]`);
  for (const other of [delegatedAuditFingerprintText(exported, id(99), command), delegatedAuditFingerprintText({ ...exported, grantId: id(99) }, actor, command),
    delegatedAuditFingerprintText({ ...exported, source: "management" }, actor, command), delegatedAuditFingerprintText(exported, actor, { ...command, operationId: id(99) })]) assert.notEqual(hash(other), hash(text));
});
test("203 list stable asOf/order/keyset and 25-item cursor are strict; no synthetic partial page", async () => {
  const items = Array.from({ length: 25 }, (_, i) => item(99 - i)), raw = { ...base, ...authority, kind: "list", asOf: at, items, nextCursor: { recordedAt: beforeAt, operationId: items.at(-1)!.operationId } };
  const safe = await parseDelegatedAuditResult(raw, list, actor); assert.equal(safe.kind, "list"); assert(Object.isFrozen(safe));
  for (const value of [{ ...raw, items: [...items, item(1)] }, { ...raw, items: [item(10), item(10)], nextCursor: null }, { ...raw, items: items.toReversed() },
    { ...raw, nextCursor: { recordedAt: beforeAt, operationId: id(1) } }, { ...raw, asOf: "2026-10-08T13:00:00.000001Z" }, { ...raw, extra: true }])
    await assert.rejects(parseDelegatedAuditResult(value, list, actor), { code: "attendance_delegated_audit_invalid" });
  await assert.rejects(parseDelegatedAuditResult(raw, { ...list, asOf: beforeAt }, actor));
});
test("203 worker resource details require whole exact worker/employee snapshots; historical Auth is not invented", async () => {
  const target = { workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), generation: 0 }, query: DelegatedAuditQuery = { siteId, grantId, mode: "detail", source: "config", sourceOperationId: id(10) };
  const raw = { ...base, ...authority, scopeKind: "audit_worker", target, kind: "detail", row: row() };
  const safe = await parseDelegatedAuditResult(raw, query, actor); assert.equal(safe.kind, "detail");
  for (const value of [{ ...raw, row: { ...row(), after: { ...worker(), employeeId: id(88) } } }, { ...raw, row: { ...row(), item: { ...item(), employeeAuthUserId: target.employeeAuthUserId } } },
    { ...raw, row: { ...row(), before: { ...worker(), startsOn: null, employeeId: null } } }, { ...raw, scopeKind: "audit_company", target }]) await assert.rejects(parseDelegatedAuditResult(value, query, actor));
});
test("203 old scope receipt holder remains opaque supervisorRef, not worker binding; mixed worker array refuses whole row", async () => {
  const q: DelegatedAuditQuery = { siteId, grantId, mode: "detail", source: "scope", sourceOperationId: id(10) }, target = { workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), generation: 0 };
  const value = { id: id(8), workerIds: [id(4)], locationIds: [id(6)], validFrom: beforeAt, validUntil: null };
  const raw = { ...base, grantId, source: "scope", scopeKind: "audit_worker", target, kind: "detail", row: { item: { ...item(), kind: "grant_put", targetId: id(8), holderRef: "b".repeat(32) }, before: null, after: value } };
  await parseDelegatedAuditResult(raw, q, actor);
  await assert.rejects(parseDelegatedAuditResult({ ...raw, row: { ...raw.row, after: { ...value, workerIds: [id(4), id(90)] } } }, q, actor));
  await assert.rejects(parseDelegatedAuditResult({ ...raw, scopeKind: "audit_company", target: null }, q, actor));
});
test("203 Node scope details normalize actual old066 UTC3 snapshots before the complete strict parser", async () => {
  const q: DelegatedAuditQuery = { siteId, grantId, mode: "detail", source: "scope", sourceOperationId: id(10) };
  const target = { workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), generation: 0 };
  const value = { id: id(8), workerIds: [id(4)], locationIds: [id(6)], validFrom: "2026-10-08T10:00:00.123Z", validUntil: "2026-10-09T10:00:00.456Z" };
  const raw = { ...base, grantId, source: "scope", scopeKind: "audit_worker", target, kind: "detail",
    row: { item: { ...item(), kind: "grant_put", targetId: id(8), holderRef: "b".repeat(32) }, before: null, after: value } };
  const original = JSON.stringify(raw);
  await assert.rejects(parseDelegatedAuditResult(raw, q, actor));
  const result = await projectDelegatedAuditSource(raw, q, actor); assert.equal(result.kind, "detail");
  if (result.kind !== "detail") return assert.fail();
  assert.equal(result.row.after?.validFrom, "2026-10-08T10:00:00.123000Z");
  assert.equal(result.row.after?.validUntil, "2026-10-09T10:00:00.456000Z");
  const removed = await projectDelegatedAuditSource({ ...raw, row: { ...raw.row,
    item: { ...raw.row.item, kind: "grant_remove" }, before: value, after: null } }, q, actor);
  assert.equal(removed.kind, "detail"); if (removed.kind !== "detail") return assert.fail();
  assert.equal(removed.row.before?.validFrom, result.row.after?.validFrom); assert.equal(removed.row.after, null);
  assert.equal(JSON.stringify(raw), original);
  for (const after of [{ ...value, validFrom: "2026-10-08T10:00:00.12Z" }, { ...value, validUntil: "2026-10-08T10:00:00.122Z" },
    { ...value, workerIds: [id(99)] }, { ...value, private: "must not be dropped" }])
    await assert.rejects(projectDelegatedAuditSource({ ...raw, row: { ...raw.row, after } }, q, actor), { code: "attendance_delegated_audit_invalid" });
});
test("203 scope export verifies original UTC3 bytes and SHA before public normalization without changing the receipt", async () => {
  const q: DelegatedAuditExportQuery = { ...exported, source: "scope" };
  const target = { workerId: id(4), employeeId: id(5), employeeAuthUserId: id(7), generation: 0 };
  const scopeRow = { item: { ...item(), kind: "grant_put", targetId: id(8), holderRef: "b".repeat(32) }, before: null,
    after: { id: id(8), workerIds: [id(4)], locationIds: [id(6)], validFrom: "2026-10-08T10:00:00.123Z", validUntil: null } };
  const value = { schemaVersion: 1, fromAt: q.fromAt, toAt: q.toAt, asOf: at, count: 1, rows: [scopeRow] };
  const snapshotText = JSON.stringify(["attendance-delegated-audit-snapshot-v1", siteId, actor, grantId, q, value]), snapshotFingerprint = hash(snapshotText);
  const saved = { ...receipt(snapshotFingerprint), commandFingerprint: hash(delegatedAuditFingerprintText(q, actor, command)) };
  const raw = { ...base, ...authority, source: "scope", scopeKind: "audit_worker", target, kind: "export", receipt: saved,
    snapshotText, snapshotBytes: Buffer.byteLength(snapshotText), snapshotFingerprint };
  const result = await projectDelegatedAuditSource(raw, q, actor, command); assert.equal(result.kind, "export");
  if (result.kind !== "export") return assert.fail();
  assert.equal(result.payload.rows[0].after?.validFrom, "2026-10-08T10:00:00.123000Z");
  assert.equal(result.payload.rows[0].after?.validUntil, null); assert.deepEqual(result.receipt, saved);
  assert.equal(result.receipt.resultFingerprint, hash(snapshotText)); assert.equal(raw.snapshotText, snapshotText);
  await parseDelegatedAuditResult(result, q, actor, command);
  assert.doesNotMatch(JSON.stringify(result), /snapshot(?:Text|Bytes|Fingerprint)/);
  for (const changed of [{ ...raw, snapshotBytes: raw.snapshotBytes + 1 }, { ...raw, snapshotFingerprint: "0".repeat(64) },
    { ...raw, snapshotText: snapshotText.replace(".123Z", ".124Z") }])
    await assert.rejects(projectDelegatedAuditSource(changed, q, actor, command), { code: "attendance_delegated_audit_invalid" });
});
test("203 management revoke distinguishes immutable grant reason from actual revocation reason", async () => {
  const q: DelegatedAuditQuery = { siteId, grantId, mode: "detail", source: "management", sourceOperationId: id(10) };
  const value = { grantId: id(8), delegateRef: "b".repeat(32), delegatedAction: "audit_view", scopeKind: "audit_company", workerId: null, employeeId: null,
    locationIds: [], allowedRuleKeys: [], validFrom: beforeAt, validUntil: exported.toAt, reason: "grant reason", status: "granted" };
  const raw = { ...base, ...authority, source: "management", kind: "detail", row: { item: { ...item(), kind: "management_revoke", version: 2, targetId: id(8) }, before: value, after: { ...value, status: "revoked", revocationReason: "actual revoke reason" } } };
  const parsed = await parseDelegatedAuditResult(raw, q, actor); assert.equal(parsed.kind, "detail");
  const { revocationReason, ...missing } = raw.row.after; void revocationReason;
  await assert.rejects(parseDelegatedAuditResult({ ...raw, row: { ...raw.row, after: missing } }, q, actor));
});
test("203 private single-text projection validates complete tuple/SHA/bytes and strips private wire", async () => {
  const safe = await publicExport(); assert.equal(safe.payload.count, 1); assert(Object.isFrozen(safe.payload.rows));
  assert.doesNotMatch(JSON.stringify(safe), /snapshot(?:Text|Bytes|Fingerprint)|canonical|private|salt|verifier/);
  for (const value of [{ ...wire(), snapshotBytes: wire().snapshotBytes + 1 }, { ...wire(), snapshotFingerprint: "0".repeat(64) },
    { ...wire(), payload: payload() }, { ...wire(), receipt: { ...wire().receipt, resultFingerprint: "0".repeat(64) } }, { ...wire(), receipt: { ...wire().receipt, count: 0 } }])
    await assert.rejects(projectDelegatedAuditSource(value, exported, actor, command), { code: "attendance_delegated_audit_invalid" });
  const wrong = JSON.parse(wire().snapshotText) as unknown[]; wrong[4] = { ...exported, grantId: id(99) }; const text = JSON.stringify(wrong), fp = hash(text);
  await assert.rejects(projectDelegatedAuditSource({ ...wire(), snapshotText: text, snapshotBytes: Buffer.byteLength(text), snapshotFingerprint: fp, receipt: { ...wire().receipt, resultFingerprint: fp } }, exported, actor, command));
});
test("203 exported payload/receipt independently reject wrong counts/order/unknown body, not just self-consistent SHA", async () => {
  const original = JSON.parse(wire().snapshotText) as unknown[], payloadObject = original[5] as Record<string, unknown>;
  for (const changed of [{ ...payloadObject, count: 2 }, { ...payloadObject, rows: [row(10), row(11)], count: 2 }, { ...payloadObject, hidden: true }, { ...payloadObject, asOf: beforeAt }]) {
    const text = JSON.stringify([...original.slice(0, 5), changed]), fp = hash(text);
    await assert.rejects(projectDelegatedAuditSource({ ...wire(), snapshotText: text, snapshotBytes: Buffer.byteLength(text), snapshotFingerprint: fp, receipt: { ...wire().receipt, resultFingerprint: fp } }, exported, actor, command));
  }
});
test("203 original actor receipt validates exact command SHA, but GET recovery cannot contain body or current authority", async () => {
  const q: DelegatedAuditQuery = { siteId, mode: "recover", operationId: command.operationId };
  await parseDelegatedAuditResult(minimal(), q, actor); await parseDelegatedAuditResult({ ...minimal(), receipt: null }, q, actor);
  await parseDelegatedAuditResult(minimal(), exported, actor, command);
  for (const value of [{ ...minimal(), payload: payload() }, { ...minimal(), target: null }, { ...minimal(), receipt: { ...receipt(), actorId: id(9) } },
    { ...minimal(), receipt: { ...receipt(), operationId: id(9) } }]) await assert.rejects(parseDelegatedAuditResult(value, q, actor));
  await assert.rejects(parseDelegatedAuditResult({ ...minimal(), receipt: { ...receipt(), commandFingerprint: "0".repeat(64) } }, exported, actor, command));
});
test("203 CSV quotes every cell, neutralizes formula controls, includes empty-snapshot metadata and remains2MiB bounded", async () => {
  for (const value of ["=1+1", " +command", "\t@x", "\u200b-2", "\ufeff=3"]) assert.match(attendanceAuditCsvCell(value), /^"'/);
  assert.equal(attendanceAuditCsvCell('a"b'), '"a""b"');
  const out = await buildDelegatedAuditCsv(await publicExport(), exported, actor, command);
  assert(out.csv.startsWith('\ufeff"schema","merchant"')); assert(out.csv.includes('"Synthetic Worker""')); assert(Buffer.byteLength(out.csv) <= 2097152);
  assert(out.filename.endsWith(command.operationId + ".csv")); assert.equal(out.receipt.count, 1);
  const empty = await buildDelegatedAuditCsv(await publicExport([]), exported, actor, command);
  assert.equal(empty.receipt.count, 0); assert.equal(empty.csv.split("\r\n").length, 3); assert(empty.csv.includes('"0"'));
});
test("203 admission gate is default-off, exact64sites and no wildcard or normalization expansion", () => {
  const env = { FAOLLA_ATTENDANCE_DELEGATED_AUDIT_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_AUDIT_SITE_IDS: siteId };
  assert(delegatedAuditSiteEnabled(siteId, env)); assert(!delegatedAuditSiteEnabled(siteId, {}));
  for (const value of ["*", siteId + ",", " " + siteId, siteId + "," + siteId, Array.from({ length: 65 }, (_, i) => String(99990000 + i)).join(",")])
    assert(!delegatedAuditSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_AUDIT_SITE_IDS: value }));
});
test("203 service makes one actual-actor RPC, defaultoff exactPOST and GETrecover require no current role pre-read", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [], service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: minimal(), error: null }; } };
  await executeDelegatedAudit({ query: exported, command, authUserId: actor }, service);
  await executeDelegatedAudit({ query: { siteId, mode: "recover", operationId: command.operationId }, authUserId: actor }, service);
  assert.deepEqual(calls, [{ name: DELEGATED_AUDIT_RPC, args: { p_query: exported, p_auth_user_id: actor, p_command: command, p_allow_access: false } },
    { name: DELEGATED_AUDIT_RPC, args: { p_query: { siteId, mode: "recover", operationId: command.operationId }, p_auth_user_id: actor, p_command: null, p_allow_access: false } }]);
  const fresh = await executeDelegatedAudit({ query: exported, command, authUserId: actor, allowAccess: true }, { rpc: async () => ({ data: wire(), error: null }) }); assert.equal(fresh.kind, "export");
  await assert.rejects(executeDelegatedAudit({ query: exported, command, authUserId: actor }, { rpc: async () => ({ data: wire(), error: null }) }));
});
test("203 service never retries uncertain/denied calls, sanitizes SQL internals and rejects abort/late success", async () => {
  for (const message of ["attendance_operation_conflict", "attendance_access_denied", "private SQL details"]) {
    let calls = 0; await assert.rejects(executeDelegatedAudit({ query: exported, command, authUserId: actor }, { rpc: async () => { calls++; return { data: null, error: { message } }; } }),
      { code: message.startsWith("private") ? "attendance_unavailable" : message }); assert.equal(calls, 1);
  }
  let calls = 0; const controller = new AbortController(); await assert.rejects(executeDelegatedAudit({ query: exported, command, authUserId: actor, signal: controller.signal },
    { rpc: async () => { calls++; controller.abort(); return { data: minimal(), error: null }; } }), { code: "attendance_unavailable" });
  await assert.rejects(executeDelegatedAudit({ query: exported, command, authUserId: actor, signal: controller.signal }, { rpc: async () => { calls++; throw Error("must not dispatch"); } })); assert.equal(calls, 1);
});
