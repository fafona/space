//202 pure contract only. No configured Auth, RPC, DB, role edit, KDF or browser.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MANAGEMENT_DELEGATION_ACTIONS, MANAGEMENT_DELEGATION_ACTION_CAPABILITY, MANAGEMENT_DELEGATION_CAPABILITIES,
  MANAGEMENT_DELEGATION_PROTOCOL, parseManagementDelegationScope, parseManagementDelegationQuery,
  parseManagementDelegationCommand, parseManagementDelegationBody, parseManagementDelegationJson,
  managementDelegationTargetBinding, managementDelegationFingerprintText, managementDelegationCommandFingerprint,
  managementDelegationReceiptMatches, parseManagementDelegationResult,
  type ManagementDelegationAction, type ManagementDelegationScope, type ManagementDelegationGrantCommand,
  type ManagementDelegationQuery, type ManagementDelegationReceipt,
} from "./merchantAttendanceManagementDelegation";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", actorId = id(1), bind = { workerId: id(2), employeeId: id(3), employeeAuthUserId: id(4) };
const validFrom = "2026-10-08T01:00:00.000000Z", validUntil = "2026-10-09T01:00:00.000000Z", readAt = "2026-10-08T03:00:00.000000Z";
const writeQuery = { siteId, mode: "write" } as const;
function scope(a: ManagementDelegationAction): ManagementDelegationScope {
  if (a === "worker_save") return { kind: "worker", create: false, ...bind, locationIds: [id(10)] };
  if (a === "group_save") return { kind: "group", groupId: id(11), create: false };
  if (["group_assign", "group_end", "group_cancel"].includes(a)) return { kind: "group_worker", groupId: id(11), assignmentId: a === "group_assign" ? null : id(12), ...bind, locationIds: [id(10)] };
  if (a === "location_save") return { kind: "location", locationId: id(10), create: false };
  if (a.startsWith("operational_rule_")) return { kind: "rules", family: "operational", subject: { kind: "group", groupId: id(11) }, allowedRuleKeys: ["allowedChannels", "reviewRouting"], locationIds: [id(10)] };
  if (a.startsWith("personal_rule_")) return { kind: "rules", family: "personal", subject: { kind: "personal", ...bind }, allowedRuleKeys: ["lateGraceMinutes"], locationIds: [] };
  if (a.startsWith("rule_")) return { kind: "rules", family: "base", subject: { kind: "enterprise" }, allowedRuleKeys: ["lateGraceMinutes"], locationIds: [] };
  if (a === "terminal_prepare" || a === "terminal_revoke") return { kind: "terminal", terminalId: id(13), locationId: id(10), create: a === "terminal_prepare" };
  if (a === "pin_issue" || a === "pin_revoke") return { kind: "member_pin", ...bind, locationIds: [id(10)] };
  if (a === "revision_approve" || a === "revision_reject") return { kind: "revision", ...bind, locationIds: [id(10)], includePending: true };
  if (a === "plan_exception_decide") return { kind: "formal_exception", ...bind, locationIds: [id(10)], includePending: false };
  return { kind: "audit_worker", ...bind, locationIds: [id(10)], sources: ["config", "management", "scope"] };
}
const command = (a: ManagementDelegationAction = "worker_save"): ManagementDelegationGrantCommand => ({ action: "grant", operationId: id(20), delegateEmployeeId: id(21), delegateAuthUserId: id(22), delegatedAction: a,
  scope: scope(a), validFrom, validUntil, reason: "Synthetic202 explicit action and resource" });
const base = () => ({ protocol: MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId, readAt });
function grant() { const c = command(); return { grantId: c.operationId, revision: 1, status: "granted", ownerId: actorId,
  delegate: { employeeId: c.delegateEmployeeId, authUserId: c.delegateAuthUserId, generation: 0 }, delegatedAction: c.delegatedAction,
  capability: MANAGEMENT_DELEGATION_ACTION_CAPABILITY[c.delegatedAction], scope: c.scope, targetGeneration: 0,
  validFrom, validUntil, reason: c.reason, grantedAt: "2026-10-08T02:00:00.000000Z", revocation: null, authorityCurrent: true }; }
test("202 fixed catalog contains exactly23 actions and14 independent explicit capabilities, not a universal manager", () => {
  assert.equal(MANAGEMENT_DELEGATION_ACTIONS.length, 23); assert.equal(MANAGEMENT_DELEGATION_CAPABILITIES.length, 14);
  assert.equal(new Set(MANAGEMENT_DELEGATION_ACTIONS).size, 23); assert.equal(new Set(MANAGEMENT_DELEGATION_CAPABILITIES).size, 14);
  assert(!MANAGEMENT_DELEGATION_CAPABILITIES.some(k => /all|roles\.manage|employees\.manage/.test(k)));
  for (const a of MANAGEMENT_DELEGATION_ACTIONS) assert(MANAGEMENT_DELEGATION_CAPABILITIES.includes(MANAGEMENT_DELEGATION_ACTION_CAPABILITY[a]));
});
test("202 each action accepts its one exact typed resource; this does not claim actual authorization", () => {
  for (const a of MANAGEMENT_DELEGATION_ACTIONS) { assert.deepEqual(parseManagementDelegationScope(scope(a), a), scope(a));
    const c = parseManagementDelegationCommand(command(a)); assert.equal(c.action, "grant"); assert(Object.isFrozen(c)); }
  for (const a of MANAGEMENT_DELEGATION_ACTIONS.filter(a => a !== "group_save")) assert.throws(() => parseManagementDelegationScope(scope("group_save"), a));
  for (const a of ["worker_save", "group_save", "location_save"] as const) assert.equal((parseManagementDelegationScope({ ...scope(a), create: true }, a) as { create: boolean }).create, true);
  assert.throws(() => parseManagementDelegationScope({ ...scope("terminal_prepare"), create: false }, "terminal_prepare"));
  assert.throws(() => parseManagementDelegationScope({ ...scope("group_end"), assignmentId: null }, "group_end"));
});
test("202 rule grants have exact family and nonempty sorted allowedRuleKeys, including explicitly opted reviewRouting", () => {
  const s = scope("operational_rule_publish"); assert.equal(s.kind, "rules");
  for (const allowedRuleKeys of [[], ["*"], ["allowedChannels", "allowedChannels"], ["reviewRouting", "allowedChannels"], ["lateGraceMinutes"]])
    assert.throws(() => parseManagementDelegationScope({ ...s, allowedRuleKeys }, "operational_rule_publish"));
  const noRouting = parseManagementDelegationScope({ ...s, allowedRuleKeys: ["allowedChannels"] }, "operational_rule_publish");
  assert.equal(noRouting.kind, "rules"); assert(!noRouting.allowedRuleKeys.includes("reviewRouting"));
  assert.throws(() => parseManagementDelegationScope({ ...s, family: "personal" }, "personal_rule_approve"));
  assert.throws(() => parseManagementDelegationScope({ ...scope("rule_publish"), subject: { kind: "personal", ...bind } }, "rule_publish"));
});
test("202 worker/location scopes reject wildcard, duplicate, unsorted, empty, excessive or untyped identity", () => {
  for (const locationIds of [[], ["*"], [id(10), id(10)], [id(11), id(10)], Array.from({ length: 26 }, (_, i) => id(100 + i))])
    assert.throws(() => parseManagementDelegationScope({ ...scope("worker_save"), locationIds }, "worker_save"));
  assert.throws(() => parseManagementDelegationScope({ ...scope("pin_issue"), employeeId: null }, "pin_issue"));
  assert.throws(() => parseManagementDelegationScope({ ...scope("worker_save"), scopeAll: true }, "worker_save"));
});
test("202 self-target management/approval is rejected; explicitly scoped audit does not silently grant approval", () => {
  for (const a of ["worker_save", "pin_issue", "revision_approve", "plan_exception_decide", "personal_rule_approve"] as const)
    assert.throws(() => parseManagementDelegationCommand({ ...command(a), delegateEmployeeId: bind.employeeId }));
  assert.equal(parseManagementDelegationCommand({ ...command("audit_view"), delegateEmployeeId: bind.employeeId }).action, "grant");
  assert.throws(() => parseManagementDelegationCommand({ ...command("audit_view"), delegatedAction: "revision_approve" }));
});
test("202 independent PIN scope uses its actual subject/generation rather than nullable fake employee/Auth", () => {
  const s = { kind: "independent_pin", workerId: id(2), subjectId: id(30), generation: 1, locationIds: [id(10)] };
  assert.deepEqual(parseManagementDelegationScope(s, "pin_issue"), s);
  assert.equal(managementDelegationTargetBinding(parseManagementDelegationScope(s, "pin_issue")), null);
  for (const generation of [0, -1, NaN, "1", 1.1]) assert.throws(() => parseManagementDelegationScope({ ...s, generation }, "pin_issue"));
  assert.throws(() => parseManagementDelegationScope({ ...s, employeeId: null, employeeAuthUserId: null }, "pin_issue"));
});
test("202 owner foundation exposes only list/detail/recover/write and exact grant/revoke bodies, never executor/secret material", () => {
  const queries: ManagementDelegationQuery[] = [{ siteId, mode: "list", afterId: null, state: "all", delegatedAction: null }, { siteId, mode: "detail", grantId: id(20) }, { siteId, mode: "recover", operationId: id(20) }, writeQuery];
  for (const q of queries) assert.deepEqual(parseManagementDelegationQuery(q), q);
  for (const q of queries.slice(0, 3)) assert.throws(() => parseManagementDelegationBody({ query: q, command: command() }));
  assert.deepEqual(parseManagementDelegationBody({ query: writeQuery, command: command() }).command, command());
  for (const extra of [{ actorId }, { pin: "12345678" }, { salt: "00".repeat(16) }, { pairSecret: "secret" }, { execute: {} }])
    assert.throws(() => parseManagementDelegationCommand({ ...command(), ...extra }));
  assert.throws(() => parseManagementDelegationQuery({ siteId, mode: "execute" }));
  assert.throws(() => parseManagementDelegationCommand({ action: "revoke", operationId: id(40), grantId: id(20), expectedRevision: 2, reason: "No" }));
});
test("202 descriptors, duplicate JSON keys, cycles, prototypes, unpaired unicode and invalid dates fail before interpretation", () => {
  let reads = 0; assert.throws(() => parseManagementDelegationCommand({ ...command(), get reason() { reads++; return "must not run"; } })); assert.equal(reads, 0);
  const cyclic: Record<string, unknown> = { ...command() }; cyclic.scope = cyclic; assert.throws(() => parseManagementDelegationCommand(cyclic));
  for (const reason of [" a", "a\u0000", "\ud800", "x".repeat(201)]) assert.throws(() => parseManagementDelegationCommand({ ...command(), reason }));
  assert.throws(() => parseManagementDelegationCommand(Object.assign(Object.create({ hidden: true }), command())));
  assert.throws(() => parseManagementDelegationJson('{"siteId":"99990001","siteId":"99990002"}'));
  for (const validUntil of [validFrom, "2026-02-30T00:00:00.000000Z", "2026-10-09T01:00:00.000Z"]) assert.throws(() => parseManagementDelegationCommand({ ...command(), validUntil }));
});
test("202 PG ledger tuple SHA binds actual actor/site/action/scope/rule subset and never readAt/current state", async () => {
  const c = command("operational_rule_publish"), t = managementDelegationFingerprintText(siteId, actorId, c);
  assert(t.includes('", "')); assert(!t.includes('"readAt"')); assert(!t.includes('"pin"'));
  assert.equal(await managementDelegationCommandFingerprint(siteId, actorId, c), createHash("sha256").update(t, "utf8").digest("hex"));
  assert.notEqual(t, managementDelegationFingerprintText(siteId, id(99), c)); assert.notEqual(t, managementDelegationFingerprintText("99990002", actorId, c));
  assert.notEqual(t, managementDelegationFingerprintText(siteId, actorId, { ...c, scope: { ...scope("operational_rule_publish"), allowedRuleKeys: ["allowedChannels"] } as ManagementDelegationScope }));
});
test("202 exact saved receipt permits only matching actor and complete SHA; recover cannot smuggle current正文", async () => {
  const c = command(), fp = await managementDelegationCommandFingerprint(siteId, actorId, c);
  const r: ManagementDelegationReceipt = { operationId: c.operationId, actorId, action: "grant", grantId: c.operationId, revision: 1, commandFingerprint: fp, recordedAt: "2026-10-08T02:00:00.000000Z" };
  assert(managementDelegationReceiptMatches(r, c, actorId, fp)); assert(!managementDelegationReceiptMatches(r, c, id(99), fp));
  assert.equal((await parseManagementDelegationResult({ ...base(), kind: "receipt", receipt: r }, writeQuery, actorId, c)).kind, "receipt");
  await assert.rejects(() => parseManagementDelegationResult({ ...base(), kind: "receipt", receipt: { ...r, commandFingerprint: "f".repeat(64) } }, writeQuery, actorId, c));
  const q = { siteId, mode: "recover", operationId: c.operationId } as const;
  await assert.rejects(() => parseManagementDelegationResult({ ...base(), kind: "receipt", receipt: r, item: grant() }, q, actorId));
  await assert.rejects(() => parseManagementDelegationResult({ ...base(), kind: "receipt", receipt: { ...r, actorId: id(99) } }, q, actorId));
  assert.equal((await parseManagementDelegationResult({ ...base(), kind: "receipt", receipt: null }, q, actorId)).kind, "receipt");
});
test("202 owner list/detail binds exact grant/action/scope and current observation, not future business availability", async () => {
  const q = { siteId, mode: "list", afterId: null, state: "all", delegatedAction: null } as const;
  const raw = { ...base(), kind: "list", canGrant: false, items: [grant()], nextId: null };
  const r = await parseManagementDelegationResult(raw, q, actorId); assert.equal(r.kind, "list"); assert(Object.isFrozen(r));
  for (const item of [{ ...grant(), capability: "attendance.audit.view" }, { ...grant(), targetGeneration: null }, { ...grant(), status: "revoked" }, { ...grant(), validUntil: readAt }])
    await assert.rejects(() => parseManagementDelegationResult({ ...raw, items: [item] }, q, actorId));
  await assert.rejects(() => parseManagementDelegationResult({ ...raw, nextId: id(20) }, q, actorId));
  await assert.rejects(() => parseManagementDelegationResult({ ...base(), kind: "detail", canGrant: false, item: grant() }, { siteId, mode: "detail", grantId: id(99) }, actorId));
});
