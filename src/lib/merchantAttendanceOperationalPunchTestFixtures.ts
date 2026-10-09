// Synthetic wire fixtures only, not real Auth, RPC, geography or source proof.
import { createHash } from "node:crypto";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerEncode, operationalRuleLedgerRulesFingerprint, operationalRuleLedgerReferenceFingerprint, parseOperationalRuleLedgerSourceFields } from "./merchantAttendanceOperationalRuleLedger";
import { resolveOperationalRuleSource, type OperationalRuleSource } from "./merchantAttendanceOperationalRuleSource";
import { OPERATIONAL_PUNCH_PROTOCOL, operationalPunchPolicyFingerprint, operationalPunchSessionFingerprint, operationalPunchCommandFingerprint,
  type OperationalPunchPolicy, type OperationalPunchSession, type OperationalPunchCommand, type OperationalPunchParseInput, type OperationalPunchResult } from "./merchantAttendanceOperationalPunch";
export const punchId = (n: number) => `24200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const punchSite = "99990001";
export const punchAt = "2026-10-08T12:00:00.123000Z";
export function signPunchSource(s: OperationalRuleSource): OperationalRuleSource {
  const w = s.workerIdentity, t = s.settingsRef, b = s.baselineCorrectionPolicyRef;
  const layers = [s.layers.enterprise, s.layers.group, s.layers.personal].map(l => { if (!l) return null; const f = parseOperationalRuleLedgerSourceFields({ scope: l.scope, context: l.context, rules: l.rules, references: l.references });
    return [f.tuples[0], l.operationId, l.revision, f.tuples[1], l.effectiveAt, l.endsAt, l.rulesFingerprint, l.referenceFingerprint, f.tuples[2], f.tuples[3]]; });
  if (s.groupAssignmentRef) throw Error("fixture_has_no_group");
  return { ...s, sourceFingerprint: createHash("sha256").update(operationalRuleLedgerEncode([s.protocol, s.siteId, [w.workerId, w.employeeId, w.employeeAuthUserId, w.workerVersion, w.employeeVersion], s.at,
    [t.version, t.timeZone], null, layers, b ? [b.operationId, b.revision, b.recordedAt, b.submissionWindowDays, b.timeZone] : null])).digest("hex") };
}
export async function punchFixture(configured = false) {
  let source: OperationalRuleSource = { protocol: "attendance-operational-rule-source-v1", siteId: punchSite, at: punchAt,
    workerIdentity: { workerId: punchId(1), employeeId: punchId(2), employeeAuthUserId: punchId(3), workerVersion: 2, employeeVersion: 3 },
    settingsRef: { version: 4, timeZone: "UTC" }, groupAssignmentRef: null, layers: { enterprise: null, group: null, personal: null }, baselineCorrectionPolicyRef: null, sourceFingerprint: "0".repeat(64) };
  if (configured) {
    const rules = parseOperationalRules({ ...Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, { mode: "inherit" }])),
      allowedChannels: { mode: "value", value: ["self", "location", "pin", "onsite"] },
      locationScope: { mode: "value", value: [punchId(4)] }, breakTypes: { mode: "value", value: { allowed: ["paid", "unpaid"], selection: "explicit" } } });
    const scope = { kind: "enterprise" } as const, context = { settingsVersion: 4, timeZone: "UTC", subject: null };
    const references = { subject: null, locations: [{ locationId: punchId(4), version: 5, active: true }], routes: [] };
    source = { ...source, layers: { ...source.layers, enterprise: { scope, context, rules, references, operationId: punchId(10), revision: 2,
      effectiveAt: "2026-10-01T00:00:00.000000Z", endsAt: null, rulesFingerprint: await operationalRuleLedgerRulesFingerprint(rules),
      referenceFingerprint: await operationalRuleLedgerReferenceFingerprint(punchSite, scope, context, references) } } };
  }
  source = signPunchSource(source);
  const { candidate } = await resolveOperationalRuleSource(source, { siteId: punchSite, workerId: punchId(1), employeeId: punchId(2), employeeAuthUserId: punchId(3), at: punchAt });
  let policy: OperationalPunchPolicy = { checkedAt: punchAt, policyFingerprint: "0".repeat(64), sourceFingerprint: source.sourceFingerprint, workerIdentity: source.workerIdentity,
    locationId: punchId(4), locationVersion: 5, activationRevision: 1, fields: { allowedChannels: candidate.fields.allowedChannels, locationScope: candidate.fields.locationScope, shiftSource: candidate.fields.shiftSource, breakTypes: candidate.fields.breakTypes },
    origins: source.layers.enterprise ? [{ layer: "enterprise", operationId: source.layers.enterprise.operationId, revision: 2, effectiveAt: source.layers.enterprise.effectiveAt, endsAt: null,
      rulesFingerprint: source.layers.enterprise.rulesFingerprint, referenceFingerprint: source.layers.enterprise.referenceFingerprint }] : [], legacy: { settingsVersion: 4, webBreakPaid: false, scheduleEnabled: false } };
  policy = { ...policy, policyFingerprint: await operationalPunchPolicyFingerprint(punchSite, "self", policy, source) };
  const input: OperationalPunchParseInput = { siteId: punchSite, channel: "self", query: { mode: "prepare" }, command: null, write: false, authUserId: punchId(3) };
  const result: OperationalPunchResult<"self"> = { protocol: OPERATIONAL_PUNCH_PROTOCOL, channel: "self", siteId: punchSite, readAt: punchAt,
    clock: { workerId: punchId(1), locationId: punchId(4), state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false },
    policy, session: null, choices: null, association: null, adoption: null, operation: null, replayed: false, canStart: true, canBreak: false, canFinish: false };
  return { source, policy, input, result };
}
export async function punchStartFixture(configured = false) {
  const base = await punchFixture(configured), { policy, source } = base;
  const command: OperationalPunchCommand<"self"> = { clock: { expectedWorkerId: punchId(1), operationId: punchId(20), locationId: punchId(4), action: "clock_in", expectedSequence: 0 },
    choice: { kind: "start", expectedPolicyFingerprint: policy.policyFingerprint, selection: null } };
  let session: OperationalPunchSession = { startEventId: punchId(21), operationId: punchId(20), startSequence: 1, occurredAt: punchAt,
    workerId: punchId(1), employeeId: punchId(2), employeeAuthUserId: punchId(3), actorAuthUserId: punchId(3), channel: "self", locationId: punchId(4), locationVersion: 5, activationRevision: 1,
    sourceFingerprint: source.sourceFingerprint, policyFingerprint: policy.policyFingerprint, sessionFingerprint: "0".repeat(64), fields: policy.fields, origins: policy.origins, legacy: policy.legacy, selection: null };
  session = { ...session, sessionFingerprint: await operationalPunchSessionFingerprint(punchSite, session) };
  const event = { id: punchId(21), siteId: punchSite, workerId: punchId(1), locationId: punchId(4), operationId: punchId(20), action: "clock_in" as const, breakPaid: null, sequence: 1, occurredAt: punchAt.slice(0, 23) + "Z", timeZone: "UTC" };
  const input: OperationalPunchParseInput = { ...base.input, query: { mode: "recover", operationId: punchId(20) }, command, write: true };
  const result: OperationalPunchResult<"self"> = { ...base.result, policy: null, session, clock: { ...base.result.clock, state: { sequence: 1, status: "working", lastEvent: event }, receipt: event },
    operation: { operationId: punchId(20), eventId: punchId(21), action: "clock_in", channel: "self", workerId: punchId(1), employeeId: punchId(2), employeeAuthUserId: punchId(3), actorAuthUserId: punchId(3), startEventId: punchId(21), sequence: 1,
      recordedAt: punchAt, commandFingerprint: await operationalPunchCommandFingerprint(punchSite, "self", punchId(3), { workerId: punchId(1), employeeId: punchId(2), employeeAuthUserId: punchId(3) }, command),
      sessionFingerprint: session.sessionFingerprint, sourceFingerprint: session.sourceFingerprint, breakPaid: null }, canStart: false, canBreak: false, canFinish: false };
  return { ...base, command, input, result, session };
}
