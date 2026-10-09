// Synthetic source consistency tests, NOT database, Auth, grant or adoption.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { prepareOperationalCycle, type CyclePreparationInput } from "./merchantAttendanceCyclePreparation";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules, type OperationalRuleChoice, type OperationalTimesheetCycle } from "./merchantAttendanceOperationalRules";
import { OPERATIONAL_RULE_SOURCE_PROTOCOL, operationalRuleSourceTuple, type OperationalRuleSource } from "./merchantAttendanceOperationalRuleSource";
import { operationalRuleLedgerEncode, operationalRuleLedgerRulesFingerprint, operationalRuleLedgerReferenceFingerprint } from "./merchantAttendanceOperationalRuleLedger";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-10-08T12:00:00.123456Z";
type Mutable<T> = T extends readonly (infer I)[] ? Mutable<I>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const copy = <T>(value: T) => structuredClone(value) as Mutable<T>;
function resign(source: OperationalRuleSource): OperationalRuleSource {
  return { ...source, sourceFingerprint: createHash("sha256").update(operationalRuleLedgerEncode(operationalRuleSourceTuple(source))).digest("hex") };
}
async function input(choice: OperationalRuleChoice<OperationalTimesheetCycle> | null = { mode: "value", value: { kind: "weekly", weekStartsOn: 1 } }): Promise<CyclePreparationInput> {
  const expected = { siteId: "99990200", workerId: id(1), employeeId: id(2), employeeAuthUserId: id(3), at };
  const source: Mutable<OperationalRuleSource> = { protocol: OPERATIONAL_RULE_SOURCE_PROTOCOL, siteId: expected.siteId, at,
    workerIdentity: { workerId: expected.workerId, employeeId: expected.employeeId, employeeAuthUserId: expected.employeeAuthUserId, workerVersion: 2, employeeVersion: 3 },
    settingsRef: { version: 4, timeZone: "Europe/Madrid" }, groupAssignmentRef: null,
    layers: { enterprise: null, group: null, personal: null }, baselineCorrectionPolicyRef: null, sourceFingerprint: "0".repeat(64) };
  if (choice !== null) {
    const rules = parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(key => [key, key === "timesheetCycle" ? choice : { mode: "inherit" }])));
    const scope = { kind: "enterprise" } as const, context = { settingsVersion: 1, timeZone: "UTC", subject: null };
    const references = { subject: null, locations: [], routes: [] };
    source.layers.enterprise = copy({ scope, operationId: id(4), revision: 1, context, rules, references,
      effectiveAt: "2026-10-01T00:00:00.000000Z", endsAt: null,
      rulesFingerprint: await operationalRuleLedgerRulesFingerprint(rules), referenceFingerprint: await operationalRuleLedgerReferenceFingerprint(expected.siteId, scope, context, references) });
  }
  return { source: resign(source), expected, anchorDate: "2026-10-08", activation: { revision: 1, active: true } };
}
test("200 preparation validates real-shaped source but never asserts authority or adoption", async () => {
  const raw = await input(), result = await prepareOperationalCycle(raw);
  assert.deepEqual(result.range, { fromDate: "2026-10-05", throughDate: "2026-10-11", civilDays: 7 });
  assert.equal(result.state, "ready"); assert.equal(result.settingsRef.timeZone, "Europe/Madrid");
  assert.equal((raw.source as OperationalRuleSource).layers.enterprise!.context.timeZone, "UTC");
  assert.equal(result.applied, false); assert.equal(result.authorityChecked, false); assert.equal(result.candidateOnly, true);
  assert(Object.isFrozen(result) && Object.isFrozen(result.range) && Object.isFrozen(result.workerIdentity));
  assert.equal(Object.isFrozen(raw.source), false);
});
test("200 unconfigured, inherit, disabled, manual and activation-off remain different", async () => {
  for (const [choice, state] of [[null, "unconfigured"], [{ mode: "inherit" }, "unconfigured"], [{ mode: "disabled" }, "disabled"], [{ mode: "value", value: { kind: "manual" } }, "manual"]] as const) {
    const result = await prepareOperationalCycle(await input(choice)); assert.equal(result.state, state); assert.equal(result.range, null);
  }
  for (const revision of [0, 2]) { const raw = await input(); const result = await prepareOperationalCycle({ ...raw, activation: { revision, active: false } });
    assert.equal(result.state, "consumer_disabled"); assert.equal(result.range, null); assert.deepEqual(result.choice, { mode: "value", value: { kind: "weekly", weekStartsOn: 1 } }); }
});
test("200 monthly and fortnightly use the existing civil helper rather than elapsed hours", async () => {
  const monthly = await input({ mode: "value", value: { kind: "monthly" } });
  assert.deepEqual((await prepareOperationalCycle(monthly)).range, { fromDate: "2026-10-01", throughDate: "2026-10-31", civilDays: 31 });
  const fortnight = await input({ mode: "value", value: { kind: "fortnightly", anchorDate: "2026-10-12" } });
  assert.deepEqual((await prepareOperationalCycle(fortnight)).range, { fromDate: "2026-09-28", throughDate: "2026-10-11", civilDays: 14 });
});
test("200 stable CAS excludes only source read time, keeping full sourceFingerprint separately", async () => {
  const raw = await input(), first = await prepareOperationalCycle(raw), later = copy(raw);
  later.expected.at = "2026-10-08T12:00:00.123457Z";
  later.source = resign({ ...(later.source as OperationalRuleSource), at: later.expected.at });
  const second = await prepareOperationalCycle(later);
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint); assert.notEqual(first.observedAt, second.observedAt);
  assert.equal(first.preparationFingerprint, second.preparationFingerprint);
});
test("200 identity, settings, publication, baseline, activation and chosen range all bind CAS", async () => {
  const raw = await input(), first = await prepareOperationalCycle(raw);
  const variants = [copy(raw), copy(raw), copy(raw), copy(raw), copy(raw), copy(raw)];
  (variants[0].source as Mutable<OperationalRuleSource>).workerIdentity.workerVersion++;
  (variants[1].source as Mutable<OperationalRuleSource>).settingsRef.version++;
  (variants[2].source as Mutable<OperationalRuleSource>).layers.enterprise!.operationId = id(9);
  (variants[3].source as Mutable<OperationalRuleSource>).baselineCorrectionPolicyRef = { operationId: id(8), revision: 1, recordedAt: at, submissionWindowDays: 0, timeZone: "UTC" };
  variants[4].activation.revision++; variants[5].anchorDate = "2026-10-15";
  for (const variant of variants) { variant.source = resign(variant.source as OperationalRuleSource); assert.notEqual((await prepareOperationalCycle(variant)).preparationFingerprint, first.preparationFingerprint); }
});
test("200 no identity mismatch, stale hash, fake authority flag or getters are accepted", async () => {
  const raw = await input();
  await assert.rejects(prepareOperationalCycle({ ...raw, expected: { ...raw.expected, employeeAuthUserId: id(99) } }));
  await assert.rejects(prepareOperationalCycle({ ...raw, source: { ...(raw.source as OperationalRuleSource), sourceFingerprint: "a".repeat(64) } }));
  await assert.rejects(prepareOperationalCycle({ ...raw, canSend: true }));
  let reads = 0;
  for (const value of [{ ...raw, get extra() { reads++; return true; } }, { ...raw, activation: { revision: 1, get active() { reads++; return true; } } },
    { ...raw, expected: { ...raw.expected, get employeeId() { reads++; return id(2); } } }]) await assert.rejects(prepareOperationalCycle(value));
  assert.equal(reads, 0);
});
test("200 explicit activation shape and complete supported civil date are enforced", async () => {
  const raw = await input();
  for (const activation of [{ revision: 0, active: true }, { revision: -0, active: false }, { revision: 1.5, active: true }, { revision: 1, active: 1 }, { revision: 1, active: true, role: "owner" }])
    await assert.rejects(prepareOperationalCycle({ ...raw, activation }));
  for (const anchorDate of ["2026-02-30", "2026-10-08\n", "1999-12-31", "2101-01-01"])
    await assert.rejects(prepareOperationalCycle({ ...raw, anchorDate }));
});
test("200 caller mutation during a digest cannot mix source, date, activation or identity", async t => {
  const raw = copy(await input()), original = copy(raw), digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
  const mock = t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => {
    if (first) { first = false; raw.anchorDate = "2026-10-15"; raw.activation.active = false; raw.activation.revision = 2;
      raw.expected.employeeId = id(99); (raw.source as Mutable<OperationalRuleSource>).settingsRef.version++; }
    return digest(...args);
  });
  const result = await prepareOperationalCycle(raw); mock.mock.restore();
  const expectedResult = await prepareOperationalCycle(original); assert.deepEqual(result, expectedResult); assert.notDeepEqual(raw, original);
});
