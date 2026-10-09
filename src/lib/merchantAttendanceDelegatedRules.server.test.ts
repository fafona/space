import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import * as p from "./merchantAttendanceDelegatedRules";
import * as s from "./merchantAttendanceDelegatedRules.server";
import * as f from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990206", actor = id(1), grantId = id(2), at = "2026-10-08T16:00:00.000001Z";
const q: Extract<p.DelegatedRulesQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const command = (): p.DelegatedRulesCommand => ({ family: "base", decision: { action: "save_draft", operationId: id(3), expectedRevision: 0, reason: "合成规则",
  expectedSettingsVersion: 10, expectedGroupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft() } });
const recovery = (): Extract<p.DelegatedRulesQuery, { mode: "recover" }> => ({ siteId, grantId, mode: "recover", operationId: id(3) });
const base = () => ({ protocol: p.DELEGATED_RULES_PROTOCOL, siteId, actorId: actor, readAt: at });
const missing = () => ({ ...base(), kind: "receipt", receipt: null });
async function saved(c = command()) { return { ...base(), kind: "receipt", receipt: { operationId: c.decision.operationId, actorId: actor, grantId, family: c.family, action: p.delegatedRulesAction(c),
  referenceId: c.decision.operationId, revision: c.decision.expectedRevision + 1, commandFingerprint: await p.delegatedRulesCommandFingerprint(q, actor, c), businessFingerprint: "a".repeat(64), recordedAt: at } }; }
type Response = Awaited<ReturnType<AttendanceSelfRpc["rpc"]>>;
function stub(fn: (args: Record<string, unknown>, count: number) => Response | Promise<Response>) {
  const calls: Record<string, unknown>[] = [], service: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, s.DELEGATED_RULES_RPC); calls.push(args); return fn(args, calls.length); } };
  return { service, calls };
}
const ok = (data: unknown): Response => ({ data, error: null });
const input = (): s.DelegatedRulesInput => ({ query: q, command: command(), authUserId: actor, allowWrite: true });
test("206 rollout is independent/default-off and exact64sites, no wildcard/trim/duplicates", () => {
  const env = { FAOLLA_ATTENDANCE_DELEGATED_RULES_ENABLED: "1", FAOLLA_ATTENDANCE_DELEGATED_RULES_SITE_IDS: siteId };
  assert.equal(s.delegatedRulesSiteEnabled(siteId, {}), false); assert.equal(s.delegatedRulesSiteEnabled(siteId, env), true);
  for (const raw of ["*", " " + siteId, siteId + " ", siteId + ",", siteId + "," + siteId]) assert.equal(s.delegatedRulesSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_RULES_SITE_IDS: raw }), false);
  const sites = Array.from({ length: 64 }, (_, n) => String(99990206 + n)); assert.equal(s.delegatedRulesSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_RULES_SITE_IDS: sites.join(",") }), true);
  assert.equal(s.delegatedRulesSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_DELEGATED_RULES_SITE_IDS: [...sites, "99990300"].join(",") }), false);
});
test("206 one service write is exactly original GET then one actualactor POST, never owner proxy", async () => {
  const value = await saved(), st = stub((_, n) => ok(n === 1 ? missing() : value));
  assert.deepEqual(await s.createDelegatedRulesService(st.service, { enabled: () => true }).execute(input()), value);
  assert.deepEqual(st.calls, [{ p_query: recovery(), p_auth_user_id: actor, p_command: null, p_allow_write: false }, { p_query: q, p_auth_user_id: actor, p_command: command(), p_allow_write: true }]);
});
test("206 immutable matching receipt precedes flags/entitlement; wrong full SHA never dispatches writer", async () => {
  const value = await saved(), st = stub(() => ok(value));
  assert.deepEqual(await s.createDelegatedRulesService(st.service, { enabled: () => assert.fail() }).execute({ ...input(), allowWrite: false }), value); assert.equal(st.calls.length, 1);
  for (const wrong of [{ commandFingerprint: "b".repeat(64) }, { actorId: id(99) }, { family: "personal" }, { grantId: id(99) }]) {
    const bad = stub(() => ok({ ...value, receipt: { ...value.receipt, ...wrong } })); await assert.rejects(s.createDelegatedRulesService(bad.service).execute(input()), { code: "attendance_delegated_rules_invalid" }); assert.equal(bad.calls.length, 1);
  }
});
test("206 missing original is unknown; disabled newwrite stops and original minimal GET remains independent", async () => {
  const st = stub(() => ok(missing())); await assert.rejects(s.createDelegatedRulesService(st.service, { enabled: () => false }).execute(input()), { code: "attendance_delegated_rules_disabled" }); assert.equal(st.calls.length, 1);
  const value = await saved(), original = stub(() => ok(value)), service = s.createDelegatedRulesService(original.service, { enabled: () => assert.fail() });
  assert.deepEqual(await service.readReceipt({ query: recovery(), authUserId: actor }), value);
  assert.deepEqual(await service.recover({ query: recovery(), expectedCommand: command(), authUserId: actor }), value);
  await assert.rejects(service.recover({ query: { ...recovery(), operationId: id(99) }, expectedCommand: command(), authUserId: actor })); assert.equal(original.calls.length, 2);
});
test("206 context/history reads are one scoped RPC and never automatic preview/write", async () => {
  const value = { ...base(), kind: "context", grantId, action: "rule_draft", scope: { kind: "rules", family: "base", subject: { kind: "enterprise" }, allowedRuleKeys: ["lateGraceMinutes"], locationIds: [] },
    context: { family: "base", revision: 0, settingsVersion: 10, timeZone: "UTC", group: null, draft: null, baselineRules: emptyAttendanceRuleDraft(), baselineKind: "default", baselineRevision: null } };
  const st = stub(() => ok(value)); assert.deepEqual(await s.createDelegatedRulesService(st.service, { enabled: () => assert.fail() }).execute({ ...input(), command: null }), value);
  assert.deepEqual(st.calls, [{ p_query: q, p_auth_user_id: actor, p_command: null, p_allow_write: false }]);
  const history: p.DelegatedRulesQuery = { siteId, grantId, mode: "history", cursor: null }, rows = { ...base(), kind: "history", grantId, action: value.action, scope: value.scope, atRevision: 0, items: [], nextCursor: null };
  const hs = stub(() => ok(rows)); assert.deepEqual(await s.createDelegatedRulesService(hs.service).execute({ ...input(), query: history, command: null }), rows); assert.equal(hs.calls.length, 1);
  await assert.rejects(s.createDelegatedRulesService(hs.service).execute({ ...input(), query: history })); assert.equal(hs.calls.length, 1);
});

test("206 explicit preview alone passes191 eligibility; disabled/site-off previews dispatch zero RPC", async () => {
  const preview = await f.operationalRuleLedgerPreview(), previewSite = f.operationalRuleLedgerSite, previewActor = f.operationalRuleLedgerActor;
  const query: p.DelegatedRulesQuery = { siteId: previewSite, grantId, mode: "preview", sourceDraftRevision: 1, effectiveOn: preview.effectiveOn, endsOn: preview.endsOn };
  const value = { protocol: p.DELEGATED_RULES_PROTOCOL, siteId: previewSite, actorId: previewActor, readAt: f.operationalRuleLedgerReadAt,
    kind: "preview", grantId, action: "operational_rule_publish", scope: { kind: "rules", family: "operational", subject: { kind: "enterprise" }, allowedRuleKeys: ["timesheetCycle"], locationIds: [] }, preview };
  const args: s.DelegatedRulesInput = { query, command: null, authUserId: previewActor, allowWrite: true };
  const st = stub(() => ok(value));
  assert.deepEqual(await s.createDelegatedRulesService(st.service, { enabled: requested => requested === previewSite }).execute(args), value);
  assert.deepEqual(st.calls, [{ p_query: query, p_auth_user_id: previewActor, p_command: null, p_allow_write: true }]);
  for (const [allowWrite, enabled] of [[false, true], [true, false]] as const) {
    const denied = stub(() => assert.fail("disabled preview must not dispatch"));
    await assert.rejects(s.createDelegatedRulesService(denied.service, { enabled: () => enabled }).execute({ ...args, allowWrite }), { code: "attendance_delegated_rules_disabled" });
    assert.equal(denied.calls.length, 0);
  }
});
test("206 legacy and explicit scope errors are exact allowlisted, unknown private SQL sanitized", async () => {
  for (const code of ["attendance_rule_order_conflict", "attendance_personal_rule_identity_changed", "attendance_operational_rule_overlap", "attendance_delegated_rules_key_denied", "attendance_delegated_rules_reference_denied", "attendance_delegated_rules_too_large", "private SQL with credential"]) {
    const st = stub(() => ({ data: null, error: { message: code } })); await assert.rejects(s.createDelegatedRulesService(st.service).execute(input()), { code: code.startsWith("private") ? "attendance_delegated_rules_invalid" : code }); assert.equal(st.calls.length, 1);
  }
});
test("206 deadline/abort fences late preread and late digest, no continuation write or listener leak", async () => {
  let release!: (r: Response) => void; const wait = new Promise<Response>(r => { release = r; }), st = stub(() => wait), controller = new AbortController();
  const service = s.createDelegatedRulesService(st.service, { enabled: () => true, timeoutMs: 15 });
  await assert.rejects(service.execute(input(), controller.signal), { code: "attendance_delegated_rules_invalid" }); release(ok(missing())); await new Promise<void>(r => setImmediate(r)); assert.equal(st.calls.length, 1); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(service.execute(input(), aborted.signal), { code: "attendance_delegated_rules_invalid" }); assert.equal(st.calls.length, 1);
  let resolve!: (r: Response) => void; const late = new Promise<Response>(r => { resolve = r; }), current = new AbortController(), again = stub(() => late);
  const pending = s.createDelegatedRulesService(again.service, { enabled: () => true }).execute(input(), current.signal); current.abort(); await assert.rejects(pending); resolve(ok(missing())); await new Promise<void>(r => setImmediate(r)); assert.equal(again.calls.length, 1);
});
test("206 caller intent is snapshotted before asynchronous recovery and unexpected identity inputs fail closed", async () => {
  const original = command(), value = await saved(original); let release!: (r: Response) => void;
  const pending = new Promise<Response>(r => { release = r; }), st = stub((_, n) => n === 1 ? pending : ok(value));
  const service = s.createDelegatedRulesService(st.service, { enabled: () => true }), result = service.execute({ ...input(), command: original });
  Reflect.set(original.decision, "reason", "后来改变"); release(ok(missing())); assert.deepEqual(await result, value); assert.equal((st.calls[1].p_command as p.DelegatedRulesCommand).decision.reason, "合成规则");
  await assert.rejects(service.execute({ ...input(), authUserId: "owner" })); assert.equal(st.calls.length, 2);
});
