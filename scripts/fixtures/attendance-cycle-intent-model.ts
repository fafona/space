// Synthetic protocol consistency only. Never a SQL/Auth/rights fixture.
import { createHash } from "node:crypto";
import { operationalRuleLedgerEncode, operationalRuleLedgerRulesFingerprint, operationalRuleLedgerReferenceFingerprint } from "../../src/lib/merchantAttendanceOperationalRuleLedger";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules } from "../../src/lib/merchantAttendanceOperationalRules";
import { OPERATIONAL_RULE_SOURCE_PROTOCOL, operationalRuleSourceTuple, type OperationalRuleSource } from "../../src/lib/merchantAttendanceOperationalRuleSource";
import { prepareOperationalCycle } from "../../src/lib/merchantAttendanceCyclePreparation";
import { CYCLE_INTENT_PROTOCOL, cycleIntentCommandFingerprint, type CycleIntentAccept, type CycleIntentQuery } from "../../src/lib/merchantAttendanceCycleIntent";
export const cycleId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const cycleSite = "99990200", cycleOwner = cycleId(90), cycleRecordedAt = "2026-10-08T12:00:00.123456Z", cycleReadAt = "2026-10-08T12:00:01.000000Z";
export const cycleHash = (tuple: Parameters<typeof operationalRuleLedgerEncode>[0]) => createHash("sha256").update(operationalRuleLedgerEncode(tuple)).digest("hex");
export async function cycleModel() {
  const scope = { siteId: cycleSite, access: "owner" as const, grantId: null, workerId: cycleId(1) };
  const query: Extract<CycleIntentQuery, { mode: "detail" }> = { ...scope, mode: "detail", intentId: cycleId(10) };
  const rules = parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, k === "timesheetCycle" ? { mode: "value", value: { kind: "weekly", weekStartsOn: 1 } } : { mode: "inherit" }])));
  const context = { settingsVersion: 1, timeZone: "UTC", subject: null }, layerScope = { kind: "enterprise" } as const, references = { subject: null, locations: [], routes: [] };
  const unsigned: OperationalRuleSource = { protocol: OPERATIONAL_RULE_SOURCE_PROTOCOL, siteId: cycleSite, at: cycleRecordedAt,
    workerIdentity: { workerId: scope.workerId, employeeId: cycleId(2), employeeAuthUserId: cycleId(3), workerVersion: 2, employeeVersion: 3 },
    settingsRef: { version: 4, timeZone: "Europe/Madrid" }, groupAssignmentRef: null, baselineCorrectionPolicyRef: null, sourceFingerprint: "0".repeat(64),
    layers: { group: null, personal: null, enterprise: { scope: layerScope, operationId: cycleId(4), revision: 1, context, rules, references, effectiveAt: "2026-10-01T00:00:00.000000Z", endsAt: null,
      rulesFingerprint: await operationalRuleLedgerRulesFingerprint(rules), referenceFingerprint: await operationalRuleLedgerReferenceFingerprint(cycleSite, layerScope, context, references) } } };
  const source = { ...unsigned, sourceFingerprint: cycleHash(operationalRuleSourceTuple(unsigned)) };
  const preparation = await prepareOperationalCycle({ source, expected: { siteId: cycleSite, workerId: scope.workerId, employeeId: cycleId(2), employeeAuthUserId: cycleId(3), at: cycleRecordedAt }, anchorDate: "2026-10-08", activation: { revision: 1, active: true } });
  const command: CycleIntentAccept = { action: "accept", operationId: query.intentId, intentId: query.intentId, anchorDate: "2026-10-08", fromDate: "2026-10-05", throughDate: "2026-10-11",
    employeeId: cycleId(2), employeeAuthUserId: cycleId(3), expectedWorkerVersion: 2, expectedEmployeeVersion: 3, expectedSettingsVersion: 4, expectedActivationRevision: 1,
    expectedPreparationFingerprint: preparation.preparationFingerprint, expectedFrameRevision: 0, expectedFrameHeadOperationId: null, reason: "Synthetic200 explicit adoption" };
  const commandFingerprint = await cycleIntentCommandFingerprint(query, command, cycleOwner);
  const receipt = { operationId: query.intentId, intentId: query.intentId, action: "accept" as const, actorId: cycleOwner, revision: 1 as const,
    recordedAt: cycleRecordedAt, commandFingerprint, periodId: null, sendOperationId: null };
  const intent = { intentId: query.intentId, workerId: scope.workerId, employeeId: cycleId(2), employeeAuthUserId: cycleId(3), actorId: cycleOwner, access: scope.access, grantId: scope.grantId,
    anchorDate: command.anchorDate, fromDate: command.fromDate, throughDate: command.throughDate, timeZone: "Europe/Madrid", fromAt: "2026-10-04T22:00:00.000000Z", toAt: "2026-10-11T22:00:00.000000Z", dueAt: "2026-10-11T22:00:00.000000Z",
    source, preparation, acceptCommand: command, intentFingerprint: "0".repeat(64), recordedAt: cycleRecordedAt };
  intent.intentFingerprint = cycleHash(["attendance-cycle-intent-v1", cycleSite, intent.intentId, cycleOwner, scope.access, scope.grantId, scope.workerId, intent.employeeId, intent.employeeAuthUserId,
    intent.anchorDate, intent.fromDate, intent.throughDate, intent.timeZone, intent.fromAt, intent.toAt, intent.dueAt, preparation.preparationFingerprint, source.sourceFingerprint, commandFingerprint, cycleRecordedAt]);
  const result = <T>(data: T, saved: unknown = null, actorId = cycleOwner) => ({ protocol: CYCLE_INTENT_PROTOCOL, siteId: cycleSite, actorId, readAt: cycleReadAt, data, receipt: saved });
  return { scope, query, command, receipt, source, preparation, intent, result };
}
