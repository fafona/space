// SYNTHETIC ONLY: pure wire builders; not SQL, real Auth or runtime adoption evidence.
import { parseOperationalRules, OPERATIONAL_RULE_KEYS } from "./merchantAttendanceOperationalRules";
import { OPERATIONAL_RULE_LEDGER_PROTOCOL, operationalRuleLedgerCommandFingerprint, operationalRuleLedgerRulesFingerprint,
  operationalRuleLedgerReferenceFingerprint, operationalRuleLedgerPreviewFingerprint, type OperationalRuleLedgerScope, type OperationalRuleLedgerContext,
  type OperationalRuleLedgerReferences, type OperationalRuleLedgerCommand, type OperationalRuleLedgerSaveDraftItem,
  type OperationalRuleLedgerPublishItem, type OperationalRuleLedgerResult, type OperationalRuleLedgerData, type OperationalRuleLedgerQuery } from "./merchantAttendanceOperationalRuleLedger";
export const operationalRuleLedgerId = (n: number) => `24000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const operationalRuleLedgerActor = operationalRuleLedgerId(1);
export const operationalRuleLedgerSite = "99990001";
export const operationalRuleLedgerReadAt = "2026-10-08T12:00:00.000000Z";
export const operationalRuleLedgerRules = () => parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, { mode: "inherit" }])));
export const operationalRuleLedgerScope = (kind: OperationalRuleLedgerScope["kind"] = "enterprise"): OperationalRuleLedgerScope => kind === "enterprise" ? { kind } : kind === "group" ? { kind, groupId: operationalRuleLedgerId(2) } : { kind, workerId: operationalRuleLedgerId(3), employeeId: operationalRuleLedgerId(4), employeeAuthUserId: operationalRuleLedgerId(5) };
export const operationalRuleLedgerContext = (scope = operationalRuleLedgerScope()): OperationalRuleLedgerContext => ({ settingsVersion: 1, timeZone: "UTC", subject: scope.kind === "enterprise" ? null : scope.kind === "group" ? { groupRevision: 1 } : { workerVersion: 1, employeeVersion: 1 } });
export const operationalRuleLedgerReferences = (scope = operationalRuleLedgerScope()): OperationalRuleLedgerReferences => ({ subject: scope.kind === "enterprise" ? null : scope.kind === "group" ? { groupActive: true } : { workerActive: true, employeeActive: true }, locations: [], routes: [] });
export const operationalRuleLedgerQuery = (scope = operationalRuleLedgerScope()): Extract<OperationalRuleLedgerQuery, { mode: "detail" }> => ({ siteId: operationalRuleLedgerSite, mode: "detail", scope });
export const operationalRuleLedgerSaveCommand = (scope = operationalRuleLedgerScope(), expectedRevision = 0, op = 20): Extract<OperationalRuleLedgerCommand, { action: "save_draft" }> => ({ siteId: operationalRuleLedgerSite, scope, action: "save_draft", operationId: operationalRuleLedgerId(op), expectedRevision, reason: "合成配置 核对😀", expectedContext: operationalRuleLedgerContext(scope), rules: operationalRuleLedgerRules() });
export async function operationalRuleLedgerDraft(scope = operationalRuleLedgerScope(), revision = 1): Promise<OperationalRuleLedgerSaveDraftItem> {
  const c = operationalRuleLedgerSaveCommand(scope, revision - 1, 20 + revision), references = operationalRuleLedgerReferences(scope);
  return { scope, action: "save_draft", operationId: c.operationId, actorId: operationalRuleLedgerActor, revision, reason: c.reason, recordedAt: "2026-10-08T10:00:00.000000Z",
    commandFingerprint: await operationalRuleLedgerCommandFingerprint(c, operationalRuleLedgerActor), context: c.expectedContext, rules: c.rules,
    rulesFingerprint: await operationalRuleLedgerRulesFingerprint(c.rules), references, referenceFingerprint: await operationalRuleLedgerReferenceFingerprint(c.siteId, scope, c.expectedContext, references) };
}
export async function operationalRuleLedgerPreview(scope = operationalRuleLedgerScope()): Promise<Extract<OperationalRuleLedgerData, { kind: "preview" }>> {
  const d = await operationalRuleLedgerDraft(scope), p = { scope, revision: 1, sourceDraftRevision: 1, context: d.context, rulesFingerprint: d.rulesFingerprint, references: d.references, referenceFingerprint: d.referenceFingerprint,
    effectiveOn: "2026-10-09", endsOn: scope.kind === "personal" ? "2026-10-10" : null, effectiveAt: "2026-10-09T00:00:00.000000Z", endsAt: scope.kind === "personal" ? "2026-10-11T00:00:00.000000Z" : null };
  return { kind: "preview", ...p, previewFingerprint: await operationalRuleLedgerPreviewFingerprint(operationalRuleLedgerSite, p), applied: false };
}
export async function operationalRuleLedgerPublication(scope = operationalRuleLedgerScope()): Promise<OperationalRuleLedgerPublishItem> {
  const d = await operationalRuleLedgerDraft(scope), p = await operationalRuleLedgerPreview(scope), c: OperationalRuleLedgerCommand = { siteId: operationalRuleLedgerSite, scope, action: "publish", operationId: operationalRuleLedgerId(30), expectedRevision: 1, reason: "合成未来发布", sourceDraftRevision: 1, effectiveOn: p.effectiveOn, endsOn: p.endsOn, previewFingerprint: p.previewFingerprint };
  return { ...d, action: "publish", operationId: c.operationId, revision: 2, reason: c.reason, sourceDraftRevision: 1, effectiveOn: p.effectiveOn, endsOn: p.endsOn, effectiveAt: p.effectiveAt, endsAt: p.endsAt, previewFingerprint: p.previewFingerprint,
    commandFingerprint: await operationalRuleLedgerCommandFingerprint(c, operationalRuleLedgerActor) };
}
export const operationalRuleLedgerResult = (data: OperationalRuleLedgerData, canWrite = data.kind === "detail" || data.kind === "preview"): OperationalRuleLedgerResult => ({ protocol: OPERATIONAL_RULE_LEDGER_PROTOCOL, siteId: operationalRuleLedgerSite, actorId: operationalRuleLedgerActor, readAt: operationalRuleLedgerReadAt, canWrite, data, receipt: null });
export async function operationalRuleLedgerDetail(scope = operationalRuleLedgerScope(), withDraft = false, next = false) { return operationalRuleLedgerResult({ kind: "detail", scope, revision: next ? 2 : withDraft ? 1 : 0, context: operationalRuleLedgerContext(scope), draft: withDraft ? await operationalRuleLedgerDraft(scope) : null, currentPublication: null, nextPublication: next ? await operationalRuleLedgerPublication(scope) : null, canWithdraw: next }); }
export async function operationalRuleLedgerReceiptResult(command: OperationalRuleLedgerCommand, actorId = operationalRuleLedgerActor): Promise<OperationalRuleLedgerResult> { return { ...operationalRuleLedgerResult({ kind: "receipt" }, false), actorId,
  receipt: { operationId: command.operationId, actorId, scope: command.scope, action: command.action, revision: command.expectedRevision + 1, recordedAt: operationalRuleLedgerReadAt, commandFingerprint: await operationalRuleLedgerCommandFingerprint(command, actorId) } }; }
