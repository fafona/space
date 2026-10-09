//Pure synthetic protocol evidence only. No actual Auth, grants or SQL.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as p from "./merchantAttendanceDelegatedRules";
import { emptyAttendanceRuleDraft, RULE_KEYS } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import * as old from "./merchantAttendanceOperationalRuleLedger";
import * as f from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const id = f.operationalRuleLedgerId, siteId = f.operationalRuleLedgerSite, actor = f.operationalRuleLedgerActor, grantId = id(100);
const q: Extract<p.DelegatedRulesQuery, { mode: "context" }> = { siteId, grantId, mode: "context", operationId: null };
const base = () => ({ protocol: p.DELEGATED_RULES_PROTOCOL, siteId, actorId: actor, readAt: f.operationalRuleLedgerReadAt });
const scope = (family: p.DelegatedRulesFamily = "base"): p.DelegatedRulesScope => ({ kind: "rules", family,
  subject: family === "personal" ? f.operationalRuleLedgerScope("personal") : { kind: "enterprise" }, allowedRuleKeys: family === "operational" ? ["timesheetCycle"] : ["lateGraceMinutes"], locationIds: [] });
const command = (): p.DelegatedRulesCommand => ({ family: "base", decision: { action: "save_draft", operationId: id(101), expectedRevision: 0, reason: "合成规则 😀",
  expectedSettingsVersion: 1, expectedGroupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft() } });
const context = () => ({ ...base(), kind: "context", grantId, action: "rule_draft", scope: scope(), context: { family: "base", revision: 0, settingsVersion: 1,
  timeZone: "UTC", group: null, draft: null, baselineRules: emptyAttendanceRuleDraft(), baselineRevision: null, baselineKind: "default" } });
async function saved(c = command()) { return { ...base(), kind: "receipt", receipt: { operationId: c.decision.operationId, actorId: actor, grantId, family: c.family,
  action: p.delegatedRulesAction(c), referenceId: c.decision.operationId, revision: c.decision.expectedRevision + 1,
  commandFingerprint: await p.delegatedRulesCommandFingerprint(q, actor, c), businessFingerprint: "a".repeat(64), recordedAt: f.operationalRuleLedgerReadAt } }; }

test("206 exact four queries reject directory, caller authority, wrong anchor and malformed dates", () => {
  const history: p.DelegatedRulesQuery = { siteId, grantId, mode: "history", cursor: { siteId, grantId, atRevision: 26, beforeRevision: 2 } };
  for (const v of [q, history, { siteId, grantId, mode: "recover", operationId: id(101) }, { siteId, grantId, mode: "preview", sourceDraftRevision: 1, effectiveOn: "2026-10-09", endsOn: null }]) assert.deepEqual(p.parseDelegatedRulesQuery(v), v);
  for (const v of [{ ...q, ownerId: actor }, { ...q, scope: scope() }, { ...q, mode: "catalog" }, { ...history, cursor: { ...history.cursor!, grantId: id(99) } },
    { ...history, cursor: { siteId, grantId, atRevision: 2, beforeRevision: 3 } }, { siteId, grantId, mode: "preview", sourceDraftRevision: 1, effectiveOn: "2026-02-30", endsOn: null }]) assert.throws(() => p.parseDelegatedRulesQuery(v));
});
test("206 reuses all eight original commands and tuple SHA binds all submitted values", async () => {
  const b = command(); if (b.family !== "base" || b.decision.action !== "save_draft") assert.fail(); const d = b.decision;
  const personal = { action: "approve" as const, operationId: id(103), expectedRevision: 0, reason: "合成人工例外", expectedWorkerVersion: 1, expectedSettingsVersion: 1,
    employeeId: id(4), employeeAuthUserId: id(5), timeZone: "UTC", startsOn: "2026-10-09", endsOn: "2026-10-10", rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value" as const, minutes: 5 } } };
  const operational = f.operationalRuleLedgerSaveCommand();
  const all: p.DelegatedRulesCommand[] = [b, { family: "base", decision: { action: "publish", operationId: id(102), expectedRevision: 1, reason: d.reason, expectedSettingsVersion: 1, expectedGroupRevision: null, timeZone: "UTC", effectiveOn: "2026-10-09" } }];
  all.push({ family: "base", decision: { action: "withdraw", operationId: id(104), expectedRevision: 2, reason: d.reason, publishedRevision: 2 } },
    { family: "personal", decision: personal }, { family: "personal", decision: { action: "withdraw", operationId: id(105), expectedRevision: 1, reason: d.reason, approvedRevision: 1 } },
    { family: "operational", decision: operational }, { family: "operational", decision: { siteId, scope: operational.scope, action: "publish", operationId: id(106), expectedRevision: 1, reason: d.reason, sourceDraftRevision: 1, effectiveOn: "2026-10-09", endsOn: null, previewFingerprint: "b".repeat(64) } },
    { family: "operational", decision: { siteId, scope: operational.scope, action: "withdraw", operationId: id(107), expectedRevision: 2, reason: d.reason, publishedRevision: 2 } });
  assert.equal(new Set(all.map(p.delegatedRulesAction)).size, 8);
  for (const c of all) {
    assert.deepEqual(p.parseDelegatedRulesBody({ query: q, command: c }).command, c);
    const text = p.delegatedRulesFingerprintText(q, actor, c);
    assert.equal(await p.delegatedRulesCommandFingerprint(q, actor, c), createHash("sha256").update(text, "utf8").digest("hex"));
    assert.notEqual(text, p.delegatedRulesFingerprintText({ ...q, grantId: id(999) }, actor, c));
    assert.notEqual(text, p.delegatedRulesFingerprintText(q, id(999), c));
    assert.notEqual(text, p.delegatedRulesFingerprintText(q, actor, p.parseDelegatedRulesCommand({ ...c, decision: { ...c.decision, reason: "另一个明确理由" } })));
  }
  const tuple = JSON.parse(p.delegatedRulesFingerprintText(q, actor, all[5]));
  assert.deepEqual(tuple[4][1], JSON.parse(old.operationalRuleLedgerCommandFingerprintText(operational, actor))[2]);
  const expected = '["attendance-delegated-rules-command-v1", "' + siteId + '", "' + actor + '", "' + grantId + '", ["base", ["save_draft", "' + d.operationId + '", 0, "合成规则 😀", 1, null, "UTC", [["inherit"], ["inherit"], ["inherit"], ["inherit"]]]]]';
  assert.equal(p.delegatedRulesFingerprintText(q, actor, b), expected);
});
test("206 exact wrapper and strict Unicode JSON reject accessors, duplicate keys and extra baseline declarations", () => {
  let accessed = false;
  assert.throws(() => p.parseDelegatedRulesCommand({ family: "base", get decision() { accessed = true; return command().decision; } })); assert.equal(accessed, false);
  for (const text of ['{"family":"base","\\u0066amily":"personal"}', '{"x":"\\ud800"}', JSON.stringify("中".repeat(17000))]) assert.throws(() => p.parseDelegatedRulesJson(text));
  assert.throws(() => p.parseDelegatedRulesCommand({ ...command(), baselineRules: emptyAttendanceRuleDraft() }));
  assert.throws(() => p.parseDelegatedRulesBody({ query: { siteId, grantId, mode: "recover", operationId: id(101) }, command: command() }));
});
test("206 base context validates original fields and immutable draft/default baseline, without broad directory", async () => {
  const value = context(); assert.deepEqual(await p.parseDelegatedRulesResult(value, q, actor), value);
  const parsed = await p.parseDelegatedRulesResult(value, q, actor); assert(Object.isFrozen(parsed)); assert(!Object.isFrozen(value));
  const draft = { revision: 1, settingsVersion: 1, groupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft() };
  const withDraft = { ...value, context: { ...value.context, revision: 1, draft, baselineRules: draft.rules, baselineRevision: 1, baselineKind: "draft" } };
  assert.deepEqual(await p.parseDelegatedRulesResult(withDraft, q, actor), withDraft);
  for (const c of [{ ...value.context, baselineRevision: 1 }, { ...value.context, baselineRules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "disabled" } } },
    { ...withDraft.context, baselineRevision: 2 }, { ...withDraft.context, baselineKind: "default", baselineRevision: null }, { ...value.context, directory: [] }]) await assert.rejects(p.parseDelegatedRulesResult({ ...value, context: c }, q, actor));
});
test("206 personal context binds full worker triple and independently rejects fresh self scope", async () => {
  const s = scope("personal"); if (s.subject.kind !== "personal") assert.fail();
  const value = { ...base(), kind: "context", grantId, action: "personal_rule_approve", scope: s, context: { family: "personal", revision: 0, settingsVersion: 1, timeZone: "UTC",
    worker: { workerId: s.subject.workerId, workerName: "合成员工", workerNo: "A1", employeeId: s.subject.employeeId, employeeAuthUserId: s.subject.employeeAuthUserId, version: 1, active: true, employeeActive: true } } };
  assert.deepEqual(await p.parseDelegatedRulesResult(value, q, actor), value);
  await assert.rejects(p.parseDelegatedRulesResult({ ...value, scope: { ...s, subject: { ...s.subject, employeeAuthUserId: actor } }, context: { ...value.context, worker: { ...value.context.worker, employeeAuthUserId: actor } } }, q, actor));
  await assert.rejects(p.parseDelegatedRulesResult({ ...value, context: { ...value.context, worker: { ...value.context.worker, employeeId: id(99) } } }, q, actor));
});
test("206 operational detail and preview use existing strict hashes/identities, not a relaxed alternate model", async () => {
  const detail = await f.operationalRuleLedgerDetail(undefined, true), s = scope("operational"); if (detail.data.kind !== "detail" || !detail.data.draft) assert.fail();
  const value = { ...base(), kind: "context", grantId, action: "operational_rule_draft", scope: s, context: { family: "operational", detail: detail.data,
    baselineRules: detail.data.draft.rules, baselineRevision: detail.data.draft.revision, baselineKind: "draft" } };
  assert.deepEqual(await p.parseDelegatedRulesResult(value, q, actor), value);
  const altered = structuredClone(value); Reflect.set(altered.context.detail.draft!, "reason", "篡改原来源"); await assert.rejects(p.parseDelegatedRulesResult(altered, q, actor));
  const preview = await f.operationalRuleLedgerPreview(), query: p.DelegatedRulesQuery = { siteId, grantId, mode: "preview", sourceDraftRevision: 1, effectiveOn: preview.effectiveOn, endsOn: preview.endsOn };
  const result = { ...base(), kind: "preview", grantId, action: "operational_rule_publish", scope: s, preview };
  assert.deepEqual(await p.parseDelegatedRulesResult(result, query, actor), result);
  await assert.rejects(p.parseDelegatedRulesResult({ ...result, preview: { ...preview, previewFingerprint: "c".repeat(64) } }, query, actor));
});
test("206 original receipt is exact/minimal, full SHA and actual actor match; unknown null is not success", async () => {
  const c = command(), value = await saved(c), recover: p.DelegatedRulesQuery = { siteId, grantId, mode: "recover", operationId: c.decision.operationId };
  assert.deepEqual(await p.parseDelegatedRulesResult(value, q, actor, c), value);
  assert.deepEqual(await p.parseDelegatedRulesResult(value, recover, actor), value);
  assert.equal((await p.parseDelegatedRulesResult({ ...base(), kind: "receipt", receipt: null }, recover, actor, c)).kind, "receipt");
  for (const change of [{ actorId: id(99) }, { grantId: id(99) }, { referenceId: id(99) }, { family: "personal" }, { revision: 2 }, { commandFingerprint: "f".repeat(64) }, { command: c }]) await assert.rejects(p.parseDelegatedRulesResult({ ...value, receipt: { ...value.receipt, ...change } }, q, actor, c));
  await assert.rejects(p.parseDelegatedRulesResult({ ...base(), kind: "receipt", receipt: null }, q, actor, c));
});
test("206 base history is 25+1 fixed-anchor; false-complete, crossgrant, gaps and invented withdrawal fail", async () => {
  const query: p.DelegatedRulesQuery = { siteId, grantId, mode: "history", cursor: null };
  const item = (revision: number) => ({ revision, operationId: id(200 + revision), actorId: actor, action: "save_draft", reason: "合成历史", recordedAt: "2026-10-08T10:00:00.000000Z",
    settingsVersion: 1, groupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft(), effectiveOn: null, effectiveAt: null, publishedRevision: null });
  const value = { ...base(), kind: "history", grantId, action: "rule_draft", scope: scope(), atRevision: 26,
    items: Array.from({ length: 25 }, (_, n) => ({ item: item(26 - n), withdrawnByRevision: null })), nextCursor: { siteId, grantId, atRevision: 26, beforeRevision: 2 } };
  assert.deepEqual(await p.parseDelegatedRulesResult(value, query, actor), value);
  const next: p.DelegatedRulesQuery = { ...query, cursor: value.nextCursor }, last = { ...value, items: [{ item: item(1), withdrawnByRevision: null }], nextCursor: null };
  assert.deepEqual(await p.parseDelegatedRulesResult(last, next, actor), last);
  for (const wrong of [{ ...value, nextCursor: null }, { ...value, items: value.items.slice(1) }, { ...value, nextCursor: { ...value.nextCursor, grantId: id(99) } },
    { ...value, items: [{ ...value.items[0], withdrawnByRevision: 27 }, ...value.items.slice(1)] }]) await assert.rejects(p.parseDelegatedRulesResult(wrong, query, actor));
  await assert.rejects(p.parseDelegatedRulesResult({ ...last, atRevision: 27 }, next, actor));
  assert.equal(RULE_KEYS.length, 4);
});
test("206 personal history preserves original approval/withdrawal snapshot and reciprocal links", async () => {
  const s = scope("personal"); if (s.subject.kind !== "personal") assert.fail();
  const snapshot = { employeeId: s.subject.employeeId, employeeAuthUserId: s.subject.employeeAuthUserId, workerVersion: 1, settingsVersion: 1, timeZone: "UTC",
    startsOn: "2026-10-09", endsOn: "2026-10-10", fromAt: attendanceDayUtcRange("2026-10-09", "UTC").startAt, toAt: attendanceDayUtcRange("2026-10-10", "UTC").endAt,
    rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value", minutes: 5 } } };
  const approval = { ...snapshot, revision: 1, operationId: id(301), actorId: actor, action: "approve", approvedRevision: null, reason: "合成例外", recordedAt: "2026-10-08T10:00:00.000000Z" };
  const withdrawal = { ...snapshot, revision: 2, operationId: id(302), actorId: actor, action: "withdraw", approvedRevision: 1, reason: "明确撤回", recordedAt: "2026-10-08T11:00:00.000000Z" };
  const query: p.DelegatedRulesQuery = { siteId, grantId, mode: "history", cursor: null };
  const value = { ...base(), kind: "history", grantId, action: "personal_rule_withdraw", scope: s, atRevision: 2,
    items: [{ item: withdrawal, withdrawnByRevision: null }, { item: approval, withdrawnByRevision: 2 }], nextCursor: null };
  assert.deepEqual(await p.parseDelegatedRulesResult(value, query, actor), value);
  const changed = { ...withdrawal, rules: { ...snapshot.rules, lateGraceMinutes: { mode: "value", minutes: 6 } } };
  await assert.rejects(p.parseDelegatedRulesResult({ ...value, items: [{ item: changed, withdrawnByRevision: null }, value.items[1]] }, query, actor));
  await assert.rejects(p.parseDelegatedRulesResult({ ...value, items: [value.items[0], { ...value.items[1], withdrawnByRevision: null }] }, query, actor));
});
