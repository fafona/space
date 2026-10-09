// SYNTHETIC ONLY: strict wire construction, not SQL/Auth/activation evidence.
import { createHash } from "node:crypto";
import { correctionId as id, correctionSite as siteId, correctionWorker as workerId, correctionEmployee as employeeId, correctionBasis, correctionRules, correctionProposal } from "../../scripts/fixtures/attendance-correction-model";
import { wire } from "../../scripts/fixtures/attendance-revision-cycle-model";
import { revisionCommand } from "../../scripts/fixtures/attendance-revision-model";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerEncode, operationalRuleLedgerRulesFingerprint, operationalRuleLedgerReferenceFingerprint } from "./merchantAttendanceOperationalRuleLedger";
import { operationalRuleSourceTuple, type OperationalRuleSource } from "./merchantAttendanceOperationalRuleSource";
import { APPLICATION_WINDOW_PROTOCOL, applicationWindowDeadline, applicationWindowFingerprint, applicationWindowCommandFingerprint, parseApplicationWindowCommand,
  type ApplicationWindowFamily, type ApplicationWindowQuery, type ApplicationWindowApplication, type ApplicationWindow, type ApplicationWindowResult } from "./merchantAttendanceApplicationWindow";
export { id as windowId };
export const windowActor = id(1), windowSite = siteId, windowWorker = workerId, windowAt = "2026-09-30T14:00:00.000000Z";
export function signWindowSource(value: OperationalRuleSource): OperationalRuleSource { return { ...value, sourceFingerprint: createHash("sha256").update(operationalRuleLedgerEncode(operationalRuleSourceTuple(value))).digest("hex") }; }
export async function applicationWindowFixture(family: ApplicationWindowFamily = "correction", selectedDays: number | null = 2) {
  const rules = parseOperationalRules({ ...Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, { mode: "inherit" }])), correctionWindow: selectedDays === null ? { mode: "disabled" } : { mode: "value", value: { days: selectedDays } } });
  const scope = { kind: "enterprise" } as const, context = { settingsVersion: 1, timeZone: "UTC", subject: null }, references = { subject: null, locations: [], routes: [] };
  const baselinePolicy = { operationId: id(700), revision: 1, recordedAt: "2026-09-27T12:00:00.000000Z", submissionWindowDays: 7, timeZone: "Europe/Madrid" };
  const source = signWindowSource({ protocol: "attendance-operational-rule-source-v1", siteId, at: windowAt,
    workerIdentity: { workerId, employeeId, employeeAuthUserId: windowActor, workerVersion: 1, employeeVersion: 1 }, settingsRef: { version: 1, timeZone: "UTC" }, groupAssignmentRef: null,
    layers: { enterprise: { scope, context, rules, references, operationId: id(701), revision: 2, effectiveAt: "2026-09-27T00:00:00.000000Z", endsAt: null,
      rulesFingerprint: await operationalRuleLedgerRulesFingerprint(rules), referenceFingerprint: await operationalRuleLedgerReferenceFingerprint(siteId, scope, context, references) }, group: null, personal: null }, baselineCorrectionPolicyRef: baselinePolicy, sourceFingerprint: "0".repeat(64) });
  const query: ApplicationWindowQuery = family === "correction" ? { siteId, family, mode: "prepare", workerId, startEventId: id(10) }
    : family === "correction_revision" ? { siteId, family, mode: "prepare", workerId, baseRequestId: id(100) }
    : { siteId, family, mode: "prepare", workerId, fromDate: "2026-09-30", throughDate: "2026-09-30", proposedStartAt: correctionProposal.startAt, supersedesRequestId: family === "missing_revision" ? id(400) : null };
  let application: ApplicationWindowApplication;
  if (family === "correction") application = { siteId, workerId, employeeId, canRequest: true, asOf: windowAt, mode: "prepare", basis: correctionBasis(), revision: 0, pendingRequestId: null,
    rulesEnforced: true, decisionsAvailable: true, rules: { ...correctionRules(), checkedAt: windowAt } };
  else if (family === "correction_revision") application = wire();
  else { const summary = { requestId: id(400), employeeId, workerName: "Synthetic employee", startAt: correctionProposal.startAt, endAt: correctionProposal.endAt, submittedAt: "2026-09-30T13:00:00.000000Z", revision: 2, status: "approved" as const };
    application = { siteId, access: "self", workerId, employeeId, locationId: id(4), timeZone: "Europe/Madrid", canRequest: true, settingsVersion: 1, policyRevision: 1, asOf: windowAt,
      fromDate: "2026-09-30", throughDate: "2026-09-30", items: family === "missing_revision" ? [summary] : [], nextCursor: null, receipt: null, includedInTimesheet: false, moduleEnabled: false,
      detail: family === "missing_revision" ? { ...summary, proposal: structuredClone(correctionProposal), reason: "Synthetic approved missing", locationName: "Synthetic site", timeZone: "Europe/Madrid", policyRevision: 1,
        deadlineAt: "2026-10-05T22:00:00.000000Z", terminal: { reason: "Synthetic approved", recordedAt: "2026-09-30T13:30:00.000000Z" }, issues: ["terminal"], evidenceToken: "a".repeat(32), canApprove: false, canReject: false,
        lineage: { rootRequestId: id(400), supersedesRequestId: null, currentRequestId: id(400), currentApprovalOperationId: id(401), canRevise: true } } : null };
  }
  const baselineDeadlineAt = applicationWindowDeadline(correctionProposal.startAt, 7, "Europe/Madrid")!, operationalDeadlineAt = selectedDays === null ? null : applicationWindowDeadline(correctionProposal.startAt, selectedDays, "Europe/Madrid");
  const rootRequestId = family === "correction_revision" ? id(100) : family === "missing_revision" ? id(400) : null, rootDeadlineAt = rootRequestId ? "2026-10-02T22:00:00.000000Z" : null;
  let window: ApplicationWindow = { workerId, employeeId, employeeAuthUserId: windowActor, observedAt: windowAt, activationRevision: 1, sourceFingerprint: source.sourceFingerprint,
    windowFingerprint: "0".repeat(64), baselinePolicy, selectedDays, anchorAt: correctionProposal.startAt, rootRequestId, rootDeadlineAt, baselineDeadlineAt, operationalDeadlineAt,
    effectiveDeadlineAt: [baselineDeadlineAt, operationalDeadlineAt, rootDeadlineAt].filter((x): x is string => x !== null).sort()[0] };
  window = { ...window, windowFingerprint: await applicationWindowFingerprint(family, window, source) };
  const old = family === "correction" ? { action: "submit", operationId: id(300), expectedRevision: 0, reason: "Synthetic correction", startEventId: id(10), expectedLastEventId: id(11), expectedPolicyRevision: 1, proposal: structuredClone(correctionProposal) }
    : family === "correction_revision" ? { ...structuredClone(revisionCommand), expectedRevision: 1, expectedEffectiveOperationId: id(291) }
    : { action: family === "missing" ? "submit" : "revise", operationId: id(300), reason: "Synthetic missing", expectedWorkerId: workerId, expectedSettingsVersion: 1, expectedPolicyRevision: 1,
      locationId: id(4), timeZone: "Europe/Madrid", proposal: structuredClone(correctionProposal), ...(family === "missing_revision" ? { supersedesRequestId: id(400), expectedApprovalOperationId: id(401) } : {}) };
  const command = parseApplicationWindowCommand({ command: old, expectedWindowFingerprint: window.windowFingerprint }, query);
  const result: ApplicationWindowResult = { protocol: APPLICATION_WINDOW_PROTOCOL, siteId, actorId: windowActor, family, mode: "prepare", readAt: windowAt,
    canSubmit: windowAt < window.effectiveDeadlineAt, application, window, receipt: null };
  const receipt = { operationId: command.command.operationId, requestId: command.command.operationId, family, workerId, employeeId, employeeAuthUserId: windowActor, actorId: windowActor,
    recordedAt: windowAt, commandFingerprint: await applicationWindowCommandFingerprint(query, command, windowActor), windowFingerprint: window.windowFingerprint, effectiveDeadlineAt: window.effectiveDeadlineAt };
  const post: ApplicationWindowResult = { ...result, mode: "receipt", canSubmit: false, application: null, window: null, receipt };
  const input = { query, command: null, authUserId: windowActor, allowWrite: true };
  return { source, query, command, result, input, raw: { result, source }, post, postInput: { ...input, command } };
}
