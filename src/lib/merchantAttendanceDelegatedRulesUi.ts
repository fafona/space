//206 UI intent only. A parsed context is not authority; the real RPC rechecks
//the grant, changed keys, reference identities and original business gates.
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { attendanceRecordInstant } from "./merchantAttendanceManagement";
import { delegatedAuditStamp } from "./merchantAttendanceDelegatedAudit";
import { captureBrowserExact } from "./merchantAttendanceRuleCapturesBrowser";
import { assertDelegatedAuditTree } from "./merchantAttendanceDelegatedAudit";
import { managementConfigurationUtcInput } from "./merchantAttendanceDelegatedConfigurationUi";
import { parseManagementDelegationCommand, type ManagementDelegationGrantCommand, type ManagementDelegationRuleSubject } from "./merchantAttendanceManagementDelegation";
import { RULE_KEYS, emptyAttendanceRuleDraft, parseAttendanceRuleDraft, type AttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import { OPERATIONAL_RULE_KEYS, OPERATIONAL_RULE_REVIEW_CATEGORIES, parseOperationalRules, type OperationalRules } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerEqual as equal } from "./merchantAttendanceOperationalRuleLedger";
import * as r from "./merchantAttendanceDelegatedRules";

export type ManagementRulesContext = Extract<r.DelegatedRulesResult, { kind: "context" }>;
export type ManagementRulesQuery = Extract<r.DelegatedRulesQuery, { mode: "context" }>;
export type ManagementRulesGrantDraft = Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string;
  delegatedAction: r.DelegatedRulesAction; subject: ManagementDelegationRuleSubject; allowedRuleKeys: readonly string[];
  locationIds: readonly string[]; validFrom: string; validUntil: string; reason: string; acknowledged: boolean }>;
export type ManagementRulesCommandDraft = Readonly<{ rules: AttendanceRuleDraft | OperationalRules; effectiveOn: string; endsOn: string;
  targetRevision: number | null; reason: string; acknowledged: boolean }>;
export type ManagementRulesEvidence = Readonly<{ query: r.DelegatedRulesQuery; result: r.DelegatedRulesResult }>;
export const delegatedRuleActionLabels: Readonly<Record<r.DelegatedRulesAction, string>> = {
  rule_draft: "基础规则：保存草稿", rule_publish: "基础规则：登记未来发布", rule_withdraw: "基础规则：撤回未来发布",
  personal_rule_approve: "个人例外：核准未来候选", personal_rule_withdraw: "个人例外：撤回未开始候选",
  operational_rule_draft: "运营规则：保存草稿", operational_rule_publish: "运营规则：核准未来发布", operational_rule_withdraw: "运营规则：撤销未来发布",
};
function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
export function managementRulesFamily(action: r.DelegatedRulesAction): r.DelegatedRulesFamily {
  if (!r.DELEGATED_RULES_ACTIONS.includes(action)) return invalid();
  return action.startsWith("operational_") ? "operational" : action.startsWith("personal_") ? "personal" : "base";
}
export function managementRulesContextQuery(siteId: string, grantId: string): ManagementRulesQuery {
  const q = r.parseDelegatedRulesQuery({ siteId, grantId, mode: "context", operationId: null }); return q.mode === "context" ? q : invalid();
}
export function buildManagementRulesGrant(raw: unknown, operationId: string): ManagementDelegationGrantCommand {
  assertDelegatedAuditTree(raw, 8192);
  const d = captureBrowserExact(raw, ["delegateEmployeeId", "delegateAuthUserId", "delegatedAction", "subject", "allowedRuleKeys", "locationIds", "validFrom", "validUntil", "reason", "acknowledged"]);
  if (d.acknowledged !== true || typeof d.reason !== "string" || !Array.isArray(d.allowedRuleKeys) || !Array.isArray(d.locationIds)) return invalid();
  const allowedKeys: unknown[] = d.allowedRuleKeys, locationIds: unknown[] = d.locationIds;
  const family = managementRulesFamily(d.delegatedAction as r.DelegatedRulesAction), order: readonly string[] = family === "operational" ? OPERATIONAL_RULE_KEYS : RULE_KEYS;
  //Duplicates and unknown keys are rejected, not silently dropped by ordering.
  if (new Set(allowedKeys).size !== allowedKeys.length || allowedKeys.some(k => !order.includes(k as string))) return invalid();
  const c = parseManagementDelegationCommand({ action: "grant", operationId, delegateEmployeeId: d.delegateEmployeeId,
    delegateAuthUserId: d.delegateAuthUserId, delegatedAction: d.delegatedAction,
    scope: { kind: "rules", family, subject: d.subject, allowedRuleKeys: order.filter(k => allowedKeys.includes(k)).sort(), locationIds: [...locationIds].sort() },
    validFrom: managementConfigurationUtcInput(d.validFrom), validUntil: managementConfigurationUtcInput(d.validUntil), reason: d.reason.trim() });
  return c.action === "grant" ? c : invalid();
}
export function managementRulesBaseline(result: ManagementRulesContext): AttendanceRuleDraft | OperationalRules {
  return result.context.family === "personal" ? emptyAttendanceRuleDraft() : result.context.baselineRules;
}
export function managementRulesDraftFromContext(result: ManagementRulesContext): ManagementRulesCommandDraft {
  return { rules: managementRulesBaseline(result), effectiveOn: "", endsOn: "", targetRevision: null, reason: "", acknowledged: false };
}
export function managementRulesRevision(result: ManagementRulesContext): number {
  return result.context.family === "operational" ? result.context.detail.revision : result.context.revision;
}
export function managementRulesFutureStart(startAt: string, readAt: string): boolean {
  const normalized = attendanceRecordInstant(startAt).replace(/\.(\d{3})Z$/, (_, digits: string) => `.${digits}000Z`);
  return normalized > delegatedAuditStamp(readAt);
}
export function managementRulesKnownRoutes(result: ManagementRulesContext): readonly Readonly<{ delegateEmployeeId: string; delegateAuthUserId: string }>[] {
  const choices: { delegateEmployeeId: string; delegateAuthUserId: string }[] = [];
  if (result.context.family !== "operational" || result.context.baselineRules.reviewRouting.mode !== "value") return choices;
  const routes = result.context.baselineRules.reviewRouting.value;
  for (const category of OPERATIONAL_RULE_REVIEW_CATEGORIES) {
    const target = routes[category];
    if (target !== "owner" && !choices.some(item => equal(item, target))) choices.push({ ...target });
  }
  return choices;
}
export function managementRulesChoicesForContext(result: ManagementRulesContext, rawRules: unknown): AttendanceRuleDraft | OperationalRules {
  const baseline = managementRulesBaseline(result), rules = result.scope.family === "operational" ? parseOperationalRules(rawRules) : parseAttendanceRuleDraft(rawRules);
  for (const key of Object.keys(baseline)) if (!result.scope.allowedRuleKeys.includes(key)
    && !equal(Reflect.get(baseline, key), Reflect.get(rules, key))) return invalid();
  if (result.scope.family === "operational") {
    const operational = rules as OperationalRules;
    if (operational.locationScope.mode === "value" && operational.locationScope.value.some(id => !result.scope.locationIds.includes(id))) return invalid();
    if (operational.reviewRouting.mode === "value") {
      const known = managementRulesKnownRoutes(result);
      for (const category of OPERATIONAL_RULE_REVIEW_CATEGORIES) {
        const target = operational.reviewRouting.value[category];
        if (target !== "owner" && !known.some(item => equal(item, target))) return invalid();
      }
    }
  }
  return rules;
}
export function managementRulesPreviewQuery(result: ManagementRulesContext, effectiveOn: string, endsOn: string): Extract<r.DelegatedRulesQuery, { mode: "preview" }> {
  if (result.context.family !== "operational" || result.action !== "operational_rule_publish" || !result.context.detail.draft) return invalid();
  const q = r.parseDelegatedRulesQuery({ siteId: result.siteId, grantId: result.grantId, mode: "preview",
    sourceDraftRevision: result.context.detail.draft.revision, effectiveOn, endsOn: result.scope.subject.kind === "personal" ? endsOn : null });
  return q.mode === "preview" ? q : invalid();
}
function evidenceMatches(context: ManagementRulesContext, evidence: Exclude<r.DelegatedRulesResult, { kind: "receipt" }>) {
  if (evidence.siteId !== context.siteId || evidence.actorId !== context.actorId || evidence.grantId !== context.grantId
    || evidence.action !== context.action || !equal(evidence.scope, context.scope)) return invalid();
}
export async function buildManagementRulesCommand(rawContext: unknown, rawQuery: ManagementRulesQuery, actualActor: string, rawDraft: unknown,
  operationId: string, rawEvidence: ManagementRulesEvidence | null = null): Promise<r.DelegatedRulesCommand> {
  assertDelegatedAuditTree(rawDraft, r.DELEGATED_RULES_REQUEST_BYTES);
  const values = captureBrowserExact(rawDraft, ["rules", "effectiveOn", "endsOn", "targetRevision", "reason", "acknowledged"]);
  //Snapshot before the first async strict parse, including optional page/preview.
  const draft = JSON.parse(JSON.stringify(values)) as ManagementRulesCommandDraft;
  const evidence = rawEvidence === null ? null : (() => {
    assertDelegatedAuditTree(rawEvidence, r.DELEGATED_RULES_RESULT_BYTES);
    return JSON.parse(JSON.stringify(captureBrowserExact(rawEvidence, ["query", "result"]))) as ManagementRulesEvidence;
  })();
  if (draft.acknowledged !== true || typeof draft.reason !== "string") return invalid();
  const query = r.parseDelegatedRulesQuery(rawQuery); if (query.mode !== "context") return invalid();
  const parsedResult = await r.parseDelegatedRulesResult(rawContext, query, actualActor); if (parsedResult.kind !== "context") return invalid();
  //Retain the checked discriminant across the nested withdrawal async helper.
  const result: ManagementRulesContext = parsedResult;
  const ctx = result.context, common = { operationId, expectedRevision: managementRulesRevision(result), reason: draft.reason.trim() };
  let command: r.DelegatedRulesCommand;
  if (ctx.family === "base" && result.scope.family === "base") {
    if (result.action === "rule_draft") command = { family: "base", decision: { ...common, action: "save_draft", expectedSettingsVersion: ctx.settingsVersion,
      expectedGroupRevision: ctx.group?.revision ?? null, timeZone: ctx.timeZone, rules: managementRulesChoicesForContext(result, draft.rules) as AttendanceRuleDraft } };
    else if (result.action === "rule_publish") {
      if (!ctx.draft || ctx.draft.settingsVersion !== ctx.settingsVersion || ctx.draft.groupRevision !== (ctx.group?.revision ?? null) || ctx.draft.timeZone !== ctx.timeZone) return invalid();
      command = { family: "base", decision: { ...common, action: "publish", expectedSettingsVersion: ctx.settingsVersion,
        expectedGroupRevision: ctx.group?.revision ?? null, timeZone: ctx.timeZone, effectiveOn: draft.effectiveOn } };
    } else if (result.action === "rule_withdraw") command = { family: "base", decision: { ...common, action: "withdraw", publishedRevision: await withdrawalRevision() } };
    else return invalid();
  } else if (ctx.family === "personal" && result.scope.family === "personal" && result.scope.subject.kind === "personal") {
    const subject = result.scope.subject;
    if (result.action === "personal_rule_approve") {
      if (!ctx.worker.active || !ctx.worker.employeeActive) return invalid();
      command = { family: "personal", decision: { ...common, action: "approve", expectedWorkerVersion: ctx.worker.version,
        expectedSettingsVersion: ctx.settingsVersion, employeeId: subject.employeeId, employeeAuthUserId: subject.employeeAuthUserId,
        timeZone: ctx.timeZone, startsOn: draft.effectiveOn, endsOn: draft.endsOn, rules: managementRulesChoicesForContext(result, draft.rules) as AttendanceRuleDraft } };
    } else if (result.action === "personal_rule_withdraw") command = { family: "personal", decision: { ...common, action: "withdraw", approvedRevision: await withdrawalRevision() } };
    else return invalid();
  } else if (ctx.family === "operational" && result.scope.family === "operational") {
    const detail = ctx.detail, base = { ...common, siteId: result.siteId, scope: result.scope.subject };
    if (result.action === "operational_rule_draft") {
      if (!detail.context) return invalid();
      command = { family: "operational", decision: { ...base, action: "save_draft", expectedContext: detail.context,
        rules: managementRulesChoicesForContext(result, draft.rules) as OperationalRules } };
    } else if (result.action === "operational_rule_publish") {
      if (!evidence || !detail.context || !detail.draft) return invalid();
      const preview = await r.parseDelegatedRulesResult(evidence.result, evidence.query, actualActor);
      if (preview.kind !== "preview") return invalid(); evidenceMatches(result, preview);
      const p = preview.preview;
      if (p.revision !== detail.revision || p.sourceDraftRevision !== detail.draft.revision || !equal(p.context, detail.context)
        || p.effectiveOn !== draft.effectiveOn || p.endsOn !== (result.scope.subject.kind === "personal" ? draft.endsOn : null)) return invalid();
      command = { family: "operational", decision: { ...base, action: "publish", sourceDraftRevision: p.sourceDraftRevision,
        effectiveOn: p.effectiveOn, endsOn: p.endsOn, previewFingerprint: p.previewFingerprint } };
    } else if (result.action === "operational_rule_withdraw") {
      if (!detail.canWithdraw || !detail.nextPublication || draft.targetRevision !== detail.nextPublication.revision) return invalid();
      command = { family: "operational", decision: { ...base, action: "withdraw", publishedRevision: detail.nextPublication.revision } };
    } else return invalid();
  } else return invalid();
  const parsed = r.parseDelegatedRulesBody({ query, command }).command;
  if (r.delegatedRulesAction(parsed) !== result.action) return invalid(); return parsed;

  async function withdrawalRevision(): Promise<number> {
    if (!evidence || evidence.query.mode !== "history") return invalid();
    const history = await r.parseDelegatedRulesResult(evidence.result, evidence.query, actualActor);
    if (history.kind !== "history" || history.atRevision !== common.expectedRevision) return invalid(); evidenceMatches(result, history);
    const row = history.items.find(row => row.item.revision === draft.targetRevision);
    if (!row || row.withdrawnByRevision !== null) return invalid();
    const item = row.item, startAt = "fromAt" in item ? item.fromAt : "effectiveAt" in item ? item.effectiveAt : null;
    if (item.action !== (ctx.family === "base" ? "publish" : "approve") || startAt === null || !managementRulesFutureStart(startAt, history.readAt)) return invalid();
    return item.revision;
  }
}
