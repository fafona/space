//Finite synthetic pure builder evidence; no actual grants, Auth, SQL or browser.
import assert from "node:assert/strict";
import test from "node:test";
import * as u from "./merchantAttendanceDelegatedRulesUi";
import * as r from "./merchantAttendanceDelegatedRules";
import * as f from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
const id = f.operationalRuleLedgerId, siteId = f.operationalRuleLedgerSite, actor = f.operationalRuleLedgerActor, grantId = id(100);
const query = u.managementRulesContextQuery(siteId, grantId), base = { protocol: r.DELEGATED_RULES_PROTOCOL, siteId, actorId: actor, readAt: f.operationalRuleLedgerReadAt, kind: "context" as const, grantId };
function context(action: r.DelegatedRulesAction = "rule_draft"): u.ManagementRulesContext {
  const personal = action.startsWith("personal_");
  const scope: r.DelegatedRulesScope = { kind: "rules", family: personal ? "personal" : "base", subject: personal ? f.operationalRuleLedgerScope("personal") : { kind: "enterprise" }, allowedRuleKeys: ["lateGraceMinutes"], locationIds: [] };
  return personal ? { ...base, action, scope, context: { family: "personal", revision: 0, settingsVersion: 9, timeZone: "UTC", worker: { workerId: id(3), workerName: "合成员工", workerNo: "E3", employeeId: id(4), employeeAuthUserId: id(5), version: 7, active: true, employeeActive: true } } }
    : { ...base, action, scope, context: { family: "base", revision: 0, settingsVersion: 9, timeZone: "UTC", group: null, draft: null, baselineKind: "default", baselineRevision: null, baselineRules: emptyAttendanceRuleDraft() } };
}
async function opContext(action: r.DelegatedRulesAction, next = false): Promise<u.ManagementRulesContext> {
  const old = await f.operationalRuleLedgerDetail(undefined, true, next); if (old.data.kind !== "detail" || !old.data.draft) assert.fail();
  return { ...base, action, scope: { kind: "rules", family: "operational", subject: old.data.scope, allowedRuleKeys: ["timesheetCycle"], locationIds: [] },
    context: { family: "operational", detail: old.data, baselineKind: "draft", baselineRevision: old.data.draft.revision, baselineRules: old.data.draft.rules } };
}
const draft = (c: u.ManagementRulesContext): u.ManagementRulesCommandDraft => ({ ...u.managementRulesDraftFromContext(c), reason: "明确合成操作", acknowledged: true, effectiveOn: "2026-10-09", endsOn: "2026-10-10" });
const grant = (action: r.DelegatedRulesAction): u.ManagementRulesGrantDraft => ({ delegateEmployeeId: id(80), delegateAuthUserId: id(81), delegatedAction: action,
  subject: u.managementRulesFamily(action) === "personal" ? f.operationalRuleLedgerScope("personal") : { kind: "enterprise" }, allowedRuleKeys: u.managementRulesFamily(action) === "operational" ? ["timesheetCycle", "allowedChannels"] : ["earlyGraceMinutes", "lateGraceMinutes"],
  locationIds: [id(90), id(89)], validFrom: "2026-10-08T10:00", validUntil: "2026-10-09T10:00", reason: "明确真实范围待 RPC 重验", acknowledged: true });

test("206 grant builder offers exactly eight actions, canonical keys, precise three-family subjects and UTC", () => {
  for (const action of r.DELEGATED_RULES_ACTIONS) {
    const c = u.buildManagementRulesGrant(grant(action), id(99)); assert.equal(c.delegatedAction, action); assert.equal(c.scope.kind, "rules");
    if (c.scope.kind !== "rules") assert.fail(); assert.equal(c.scope.family, u.managementRulesFamily(action));
    assert.deepEqual(c.scope.locationIds, [id(89), id(90)]); assert.equal(c.validFrom, "2026-10-08T10:00:00.000000Z");
    assert.deepEqual(c.scope.allowedRuleKeys, c.scope.family === "operational" ? ["allowedChannels", "timesheetCycle"] : ["earlyGraceMinutes", "lateGraceMinutes"]);
  }
  const group = u.buildManagementRulesGrant({ ...grant("rule_draft"), subject: { kind: "group", groupId: id(2) } }, id(99)); assert.equal(group.scope.kind, "rules");
});
test("206 grants reject unknown/duplicate/empty keys, wrong subjects, unverified confirmation and caller fields", () => {
  for (const patch of [{ acknowledged: false }, { allowedRuleKeys: [] }, { allowedRuleKeys: ["lateGraceMinutes", "lateGraceMinutes"] }, { allowedRuleKeys: ["timesheetCycle"] },
    { delegatedAction: "pin_issue" }, { subject: f.operationalRuleLedgerScope("personal") }, { locationIds: [id(90), id(90)] }, { ownerId: actor }])
    assert.throws(() => u.buildManagementRulesGrant({ ...grant("rule_draft"), ...patch }, id(99)));
  assert.throws(() => u.buildManagementRulesGrant({ ...grant("personal_rule_approve"), subject: { kind: "enterprise" } }, id(99)));
  let accessed = false; assert.throws(() => u.buildManagementRulesGrant({ ...grant("rule_draft"), get reason() { accessed = true; return "bad"; } }, id(99))); assert.equal(accessed, false);
});
test("206 context queries are exact and do not request owner/worker catalogs", () => {
  assert.deepEqual(query, { siteId, grantId, mode: "context", operationId: null });
  for (const bad of ["", "all", grantId + "\n"]) assert.throws(() => u.managementRulesContextQuery(siteId, bad));
});
test("206 base draft preserves every unauthorized baseline value and uses fresh versions, not form CAS", async () => {
  const c = context(); if (c.context.family !== "base") assert.fail();
  const baseline = { ...emptyAttendanceRuleDraft(), earlyGraceMinutes: { mode: "value" as const, minutes: 23 } };
  const fresh: u.ManagementRulesContext = { ...c, context: { ...c.context, revision: 2, baselineKind: "draft", baselineRevision: 2, baselineRules: baseline,
    draft: { revision: 2, settingsVersion: 9, groupRevision: null, timeZone: "UTC", rules: baseline } } };
  const d = { ...draft(fresh), rules: { ...baseline, lateGraceMinutes: { mode: "value" as const, minutes: 0 } } };
  const result = await u.buildManagementRulesCommand(fresh, query, actor, d, id(101));
  assert.equal(result.family, "base"); if (result.family !== "base" || result.decision.action !== "save_draft") assert.fail();
  assert.equal(result.decision.expectedRevision, 2); assert.equal(result.decision.expectedSettingsVersion, 9); assert.deepEqual(result.decision.rules, d.rules);
  await assert.rejects(u.buildManagementRulesCommand(fresh, query, actor, { ...d, rules: emptyAttendanceRuleDraft() }, id(101)));
  await assert.rejects(u.buildManagementRulesCommand(fresh, query, actor, { ...d, expectedRevision: 0 }, id(101)));
});
test("206 base publish uses saved current draft and rejects absent/stale settings rather than saving local input", async () => {
  const c = context("rule_publish"); if (c.context.family !== "base") assert.fail();
  const fresh = { ...c, context: { ...c.context, revision: 1, baselineKind: "draft" as const, baselineRevision: 1, draft: { revision: 1, settingsVersion: 9, groupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft() } } };
  const command = await u.buildManagementRulesCommand(fresh, query, actor, draft(fresh), id(101)); assert.equal(command.decision.action, "publish"); assert(!("rules" in command.decision));
  await assert.rejects(u.buildManagementRulesCommand(c, query, actor, draft(c), id(101)));
  await assert.rejects(u.buildManagementRulesCommand({ ...fresh, context: { ...fresh.context, settingsVersion: 10 } }, query, actor, draft(fresh), id(101)));
});
test("206 personal approve derives exact worker double identity and starts from inherit, not another approval", async () => {
  const c = context("personal_rule_approve"), d = { ...draft(c), rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value" as const, minutes: 5 } } };
  const command = await u.buildManagementRulesCommand(c, query, actor, d, id(101));
  if (command.family !== "personal" || command.decision.action !== "approve") assert.fail();
  assert.equal(command.decision.employeeId, id(4)); assert.equal(command.decision.employeeAuthUserId, id(5)); assert.equal(command.decision.expectedWorkerVersion, 7);
  assert.equal(command.decision.expectedSettingsVersion, 9); assert.equal(command.decision.endsOn, "2026-10-10");
  await assert.rejects(u.buildManagementRulesCommand(c, query, actor, { ...d, rules: { ...d.rules, earlyGraceMinutes: { mode: "disabled" } } }, id(101)));
  await assert.rejects(u.buildManagementRulesCommand(c, query, id(5), d, id(101)));
});
test("206 operational draft preserves baseline and context while restricting every location to the immutable whitelist", async () => {
  const c = await opContext("operational_rule_draft"), d = { ...draft(c), rules: { ...f.operationalRuleLedgerRules(), timesheetCycle: { mode: "value" as const, value: { kind: "monthly" as const } } } };
  const command = await u.buildManagementRulesCommand(c, query, actor, d, id(101));
  if (command.family !== "operational" || command.decision.action !== "save_draft") assert.fail(); assert.equal(command.decision.expectedContext.settingsVersion, 1);
  await assert.rejects(u.buildManagementRulesCommand(c, query, actor, { ...d, rules: { ...d.rules, allowedChannels: { mode: "disabled" } } }, id(101)));
  const locationContext = { ...c, scope: { ...c.scope, allowedRuleKeys: ["locationScope"], locationIds: [id(90)] } };
  assert.deepEqual(Reflect.get(u.managementRulesChoicesForContext(locationContext, { ...f.operationalRuleLedgerRules(), locationScope: { mode: "value", value: [id(90)] } }), "locationScope"), { mode: "value", value: [id(90)] });
  assert.throws(() => u.managementRulesChoicesForContext(locationContext, { ...f.operationalRuleLedgerRules(), locationScope: { mode: "value", value: [id(91)] } }));
});
test("206 operational publication requires real strict preview fingerprint matching grant, current CAS and dates", async () => {
  const c = await opContext("operational_rule_publish"), d = { ...draft(c), endsOn: "" }, q = u.managementRulesPreviewQuery(c, d.effectiveOn, d.endsOn), p = await f.operationalRuleLedgerPreview();
  const result: r.DelegatedRulesResult = { ...base, kind: "preview", action: c.action, scope: c.scope, preview: p }, evidence = { query: q, result };
  const command = await u.buildManagementRulesCommand(c, query, actor, d, id(101), evidence);
  if (command.family !== "operational" || command.decision.action !== "publish") assert.fail(); assert.equal(command.decision.previewFingerprint, p.previewFingerprint); assert.equal(command.decision.sourceDraftRevision, 1);
  await assert.rejects(u.buildManagementRulesCommand(c, query, actor, d, id(101)));
  await assert.rejects(u.buildManagementRulesCommand(c, query, actor, { ...d, effectiveOn: "2026-10-10" }, id(101), evidence));
  await assert.rejects(u.buildManagementRulesCommand(c, query, actor, d, id(101), { ...evidence, result: { ...result, grantId: id(999) } }));
});
test("206 operational review routes reuse only immutable same-layer baseline pairs or owner, never arbitrary active-looking IDs", async () => {
  const c = await opContext("operational_rule_draft"); if (c.context.family !== "operational") assert.fail();
  const oldPair = { delegateEmployeeId: id(40), delegateAuthUserId: id(41) }, unknown = { delegateEmployeeId: id(42), delegateAuthUserId: id(43) }, owners = { correction: "owner" as const, missing: "owner" as const, leave: "owner" as const, work_arrangement: "owner" as const };
  const baseline = { ...f.operationalRuleLedgerRules(), reviewRouting: { mode: "value" as const, value: { ...owners, correction: oldPair } } };
  const fresh = { ...c, scope: { ...c.scope, allowedRuleKeys: ["reviewRouting"] }, context: { ...c.context, baselineRules: baseline } };
  assert.deepEqual(u.managementRulesKnownRoutes(fresh), [oldPair]);
  assert.doesNotThrow(() => u.managementRulesChoicesForContext(fresh, { ...baseline, reviewRouting: { mode: "value", value: { ...owners, leave: oldPair } } }));
  assert.doesNotThrow(() => u.managementRulesChoicesForContext(fresh, { ...baseline, reviewRouting: { mode: "value", value: owners } }));
  assert.throws(() => u.managementRulesChoicesForContext(fresh, { ...baseline, reviewRouting: { mode: "value", value: { ...owners, missing: unknown } } }));
  assert.throws(() => u.managementRulesChoicesForContext(fresh, { ...baseline, reviewRouting: { mode: "value", value: { ...owners, missing: { ...oldPair, delegateAuthUserId: id(99) } } } }));
  const noBaseline = { ...c, scope: { ...c.scope, allowedRuleKeys: ["reviewRouting"] } };
  assert.deepEqual(u.managementRulesKnownRoutes(noBaseline), []);
  assert.throws(() => u.managementRulesChoicesForContext(noBaseline, { ...f.operationalRuleLedgerRules(), reviewRouting: { mode: "value", value: { ...owners, correction: oldPair } } }));
  assert.doesNotThrow(() => u.managementRulesChoicesForContext(noBaseline, { ...f.operationalRuleLedgerRules(), reviewRouting: { mode: "value", value: owners } }));
  for (const mode of ["inherit", "disabled"]) assert.doesNotThrow(() => u.managementRulesChoicesForContext(fresh, { ...baseline, reviewRouting: { mode } }));
});
test("206 operational withdrawal selects only current next publication with canWithdraw, not a typed revision", async () => {
  const c = await opContext("operational_rule_withdraw", true);
  const command = await u.buildManagementRulesCommand(c, query, actor, { ...draft(c), targetRevision: 2 }, id(101));
  assert.equal(command.decision.action, "withdraw"); if (command.decision.action !== "withdraw" || !('publishedRevision' in command.decision)) assert.fail(); assert.equal(command.decision.publishedRevision, 2);
  for (const targetRevision of [null, 1, 3]) await assert.rejects(u.buildManagementRulesCommand(c, query, actor, { ...draft(c), targetRevision }, id(101)));
});
test("206 base/personal withdrawals bind explicit strict 25-row history and original future row, never invented target", async () => {
  for (const action of ["rule_withdraw", "personal_rule_withdraw"] as const) {
    const initial = context(action); if (initial.context.family === "operational") assert.fail(); const c = { ...initial, context: { ...initial.context, revision: 1 } };
    const personal = action === "personal_rule_withdraw";
    const snapshot = { employeeId: id(4), employeeAuthUserId: id(5), workerVersion: 7, settingsVersion: 9, timeZone: "UTC", startsOn: "2026-10-09", endsOn: "2026-10-10",
      fromAt: attendanceDayUtcRange("2026-10-09", "UTC").startAt, toAt: attendanceDayUtcRange("2026-10-10", "UTC").endAt, rules: { ...emptyAttendanceRuleDraft(), lateGraceMinutes: { mode: "value" as const, minutes: 5 } } };
    const item = personal ? { ...snapshot, action: "approve" as const, approvedRevision: null, revision: 1, operationId: id(102), actorId: actor, reason: "合成原候选", recordedAt: "2026-10-08T10:00:00.000000Z" }
      : { revision: 1, operationId: id(102), actorId: actor, action: "publish" as const, reason: "合成原发布", recordedAt: "2026-10-08T10:00:00.000000Z", settingsVersion: 9, groupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft(), effectiveOn: "2026-10-09", effectiveAt: attendanceDayUtcRange("2026-10-09", "UTC").startAt, publishedRevision: null };
    const hq: r.DelegatedRulesQuery = { siteId, grantId, mode: "history", cursor: null }, history: r.DelegatedRulesResult = { ...base, kind: "history", action, scope: c.scope, atRevision: 1, items: [{ item, withdrawnByRevision: null }], nextCursor: null };
    const command = await u.buildManagementRulesCommand(c, query, actor, { ...draft(c), targetRevision: 1 }, id(101), { query: hq, result: history }); assert.equal(command.decision.action, "withdraw");
    await assert.rejects(u.buildManagementRulesCommand(c, query, actor, { ...draft(c), targetRevision: 2 }, id(101), { query: hq, result: history }));
    await assert.rejects(u.buildManagementRulesCommand(c, query, actor, { ...draft(c), targetRevision: 1 }, id(101)));
  }
});
test("206 future withdrawal compares legacy millisecond and six-digit wire boundaries without granting equality", () => {
  assert.equal(u.managementRulesFutureStart("2026-10-09T00:00:00.000Z", "2026-10-09T00:00:00.000000Z"), false);
  assert.equal(u.managementRulesFutureStart("2026-10-09T00:00:00.000Z", "2026-10-08T23:59:59.999999Z"), true);
  assert.equal(u.managementRulesFutureStart("2026-10-09T00:00:00.000001Z", "2026-10-09T00:00:00.000000Z"), true);
});
