// SYNTHETIC ONLY: independently assembled source tuples are not DB/Auth proof.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { attendanceDayUtcRange } from "./merchantAttendanceTime";
import { OPERATIONAL_RULE_KEYS, parseOperationalRules } from "./merchantAttendanceOperationalRules";
import { operationalRuleLedgerEncode, parseOperationalRuleLedgerSourceFields, operationalRuleLedgerRulesFingerprint, operationalRuleLedgerReferenceFingerprint,
  type OperationalRuleLedgerScope, type OperationalRuleLedgerContext, type OperationalRuleLedgerReferences } from "./merchantAttendanceOperationalRuleLedger";
import { OPERATIONAL_RULE_SOURCE_PROTOCOL, parseOperationalRuleSource, parseOperationalRuleSourceJson, resolveOperationalRuleSource, operationalRuleSourceTuple,
  type OperationalRuleSource, type OperationalRuleSourceExpected, type OperationalRuleSourceLayer } from "./merchantAttendanceOperationalRuleSource";

const id = (n: number) => `24100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const expected: OperationalRuleSourceExpected = { siteId: "99990001", workerId: id(1), employeeId: id(2), employeeAuthUserId: id(3), at: "2026-10-08T12:00:00.123456Z" };
type Writable<T> = T extends readonly (infer U)[] ? Writable<U>[] : T extends object ? { -readonly [K in keyof T]: Writable<T[K]> } : T;
const copy = <T>(v: T) => structuredClone(v) as Writable<T>;
const utc6 = (s: string) => s.slice(0, -1) + "000Z";
const inherit = () => parseOperationalRules(Object.fromEntries(OPERATIONAL_RULE_KEYS.map(k => [k, { mode: "inherit" }])));
function layerTuple(v: OperationalRuleSourceLayer | null) {
  if (!v) return null; const fields = parseOperationalRuleLedgerSourceFields({ scope: v.scope, context: v.context, rules: v.rules, references: v.references });
  return [fields.tuples[0], v.operationId, v.revision, fields.tuples[1], v.effectiveAt, v.endsAt, v.rulesFingerprint, v.referenceFingerprint, fields.tuples[2], fields.tuples[3]];
}
function resign(source: OperationalRuleSource): OperationalRuleSource {
  const w = source.workerIdentity, s = source.settingsRef, g = source.groupAssignmentRef, b = source.baselineCorrectionPolicyRef;
  const tuple = [source.protocol, source.siteId, [w.workerId, w.employeeId, w.employeeAuthUserId, w.workerVersion, w.employeeVersion], source.at,
    [s.version, s.timeZone], g ? [g.assignmentId, g.revision, g.operationId, g.groupId, g.currentGroupRevision, g.workerId, g.employeeId, g.savedWorkerVersion, g.savedSettingsVersion, g.timeZone, g.startsOn, g.endsOn, g.fromAt, g.toAt] : null,
    [layerTuple(source.layers.enterprise), layerTuple(source.layers.group), layerTuple(source.layers.personal)], b ? [b.operationId, b.revision, b.recordedAt, b.submissionWindowDays, b.timeZone] : null];
  return { ...source, sourceFingerprint: createHash("sha256").update(operationalRuleLedgerEncode(tuple)).digest("hex") };
}
async function makeLayer(scope: OperationalRuleLedgerScope, operation: number, rules = inherit()): Promise<OperationalRuleSourceLayer> {
  const context: OperationalRuleLedgerContext = { settingsVersion: 3, timeZone: "UTC", subject: scope.kind === "enterprise" ? null : scope.kind === "group" ? { groupRevision: 2 } : { workerVersion: 5, employeeVersion: 4 } };
  const references: OperationalRuleLedgerReferences = { subject: scope.kind === "enterprise" ? null : scope.kind === "group" ? { groupActive: true } : { workerActive: true, employeeActive: true },
    locations: rules.locationScope.mode === "value" ? rules.locationScope.value.map(locationId => ({ locationId, version: 2, active: true })) : [],
    routes: rules.reviewRouting.mode === "value" ? (["correction", "missing", "leave", "work_arrangement"] as const).flatMap(category => { const target = rules.reviewRouting.mode === "value" ? rules.reviewRouting.value[category] : "owner";
      return target === "owner" ? [] : [{ category, employeeId: target.delegateEmployeeId, employeeAuthUserId: target.delegateAuthUserId, employeeVersion: 3, active: true }]; }) : [] };
  return { scope, operationId: id(operation), revision: 2, context, effectiveAt: "2026-10-01T00:00:00.000000Z", endsAt: scope.kind === "personal" ? "2026-10-10T00:00:00.000000Z" : null,
    rules, references, rulesFingerprint: await operationalRuleLedgerRulesFingerprint(rules), referenceFingerprint: await operationalRuleLedgerReferenceFingerprint(expected.siteId, scope, context, references) };
}
async function fixture(full = true): Promise<OperationalRuleSource> {
  const enterpriseRules = parseOperationalRules({ ...inherit(), allowedChannels: { mode: "value", value: ["self", "location"] }, locationScope: { mode: "value", value: [id(100), id(101)] },
    shiftSource: { mode: "value", value: "published_selection" }, breakTypes: { mode: "value", value: { allowed: ["paid", "unpaid"], selection: "explicit" } }, correctionWindow: { mode: "value", value: { days: 20 } },
    reviewRouting: { mode: "value", value: { correction: { delegateEmployeeId: id(200), delegateAuthUserId: id(201) }, missing: "owner", leave: "owner", work_arrangement: "owner" } },
    timesheetCycle: { mode: "value", value: { kind: "fortnightly", anchorDate: "0001-01-01" } }, reminders: { mode: "value", value: { open_session: { mode: "enabled", afterMinutes: 60, repeatMinutes: 60, maxOccurrences: 2 }, pending_review: { mode: "disabled" }, period_due: { mode: "disabled" } } } });
  const groupRules = parseOperationalRules({ ...inherit(), locationScope: { mode: "value", value: [id(101), id(102)] }, correctionWindow: { mode: "value", value: { days: 10 } } });
  const personalRules = parseOperationalRules({ ...inherit(), correctionWindow: { mode: "value", value: { days: 7 } } });
  const source: OperationalRuleSource = { protocol: OPERATIONAL_RULE_SOURCE_PROTOCOL, siteId: expected.siteId, at: expected.at,
    workerIdentity: { workerId: expected.workerId, employeeId: expected.employeeId, employeeAuthUserId: expected.employeeAuthUserId, workerVersion: 7, employeeVersion: 6 }, settingsRef: { version: 9, timeZone: "Europe/Madrid" },
    groupAssignmentRef: full ? { assignmentId: id(10), revision: 2, operationId: id(11), groupId: id(12), currentGroupRevision: 3, workerId: expected.workerId, employeeId: expected.employeeId,
      savedWorkerVersion: 4, savedSettingsVersion: 2, timeZone: "Europe/Paris", startsOn: "2026-10-01", endsOn: "2026-10-31", fromAt: utc6(attendanceDayUtcRange("2026-10-01", "Europe/Paris").startAt), toAt: utc6(attendanceDayUtcRange("2026-10-31", "Europe/Paris").endAt) } : null,
    layers: { enterprise: full ? await makeLayer({ kind: "enterprise" }, 20, enterpriseRules) : null, group: full ? await makeLayer({ kind: "group", groupId: id(12) }, 21, groupRules) : null,
      personal: full ? await makeLayer({ kind: "personal", workerId: expected.workerId, employeeId: expected.employeeId, employeeAuthUserId: expected.employeeAuthUserId }, 22, personalRules) : null },
    baselineCorrectionPolicyRef: full ? { operationId: id(30), revision: 3, recordedAt: "2026-10-01T12:00:00.000000Z", submissionWindowDays: 5, timeZone: "America/New_York" } : null, sourceFingerprint: "0".repeat(64) };
  return resign(source);
}
test("241 strict source parses three saved layers with old context versions, original zones and immutable data", async () => {
  const raw = await fixture(), parsed = await parseOperationalRuleSource(raw, expected); assert.deepEqual(parsed, raw); assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.layers) && Object.isFrozen(parsed.layers.enterprise?.rules));
  assert.equal(parsed.layers.enterprise!.context.timeZone, "UTC"); assert.equal(parsed.settingsRef.timeZone, "Europe/Madrid"); assert.equal(parsed.groupAssignmentRef!.timeZone, "Europe/Paris"); assert.equal(parsed.baselineCorrectionPolicyRef!.timeZone, "America/New_York");
  assert.deepEqual(await parseOperationalRuleSourceJson(JSON.stringify(raw), expected), raw);
});
test("241 source owns its input before async hashing without freezing the caller", async t => {
  const raw = copy(await fixture()), initial = copy(raw), mixed = copy(raw);
  mixed.layers.enterprise!.operationId = id(99);
  const mixedFingerprint = resign(mixed).sourceFingerprint, digest = crypto.subtle.digest.bind(crypto.subtle);
  let first = true;
  const mock = t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => {
    if (first) {
      first = false; await Promise.resolve();
      // No instant of the caller's input contains the hybrid old rules/new op.
      raw.layers.enterprise!.rules.timesheetCycle = { mode: "disabled" };
      raw.layers.enterprise!.operationId = mixed.layers.enterprise!.operationId;
      raw.sourceFingerprint = mixedFingerprint;
    }
    return digest(...args);
  });
  const parsed = await parseOperationalRuleSource(raw, expected);
  assert.equal(first, false); assert.deepEqual(parsed, initial); assert.notDeepEqual(parsed, raw);
  assert.ok(Object.isFrozen(parsed.layers.enterprise!.rules));
  assert.equal(Object.isFrozen(raw), false); assert.equal(Object.isFrozen(raw.layers.enterprise!.rules), false);
  assert.deepEqual(raw.layers.enterprise!.rules.timesheetCycle, { mode: "disabled" });
  mock.mock.restore();
  await assert.rejects(parseOperationalRuleSource(raw, expected), /attendance_operational_source_invalid/);
});
test("241 pure projection preserves false authority flags, location intersection and independent deadline baseline", async () => {
  const projection = await resolveOperationalRuleSource(await fixture(), expected); assert.equal(projection.candidate.applied, false); assert.equal(projection.candidate.candidateOnly, true); assert.equal(projection.candidate.authorityChecked, false);
  assert.deepEqual(projection.candidate.fields.locationScope.value, [id(101)]); assert.deepEqual(projection.candidate.fields.correctionWindow.value, { days: 7 }); assert.equal(projection.candidate.fields.correctionWindow.constrainedDays, 5);
  assert.equal(projection.source.baselineCorrectionPolicyRef!.timeZone, "America/New_York"); assert.ok(Object.isFrozen(projection));
});
test("241 null enterprise is only an all-inherit calculation adapter, not an invented publication", async () => {
  const raw = await fixture(false), result = await resolveOperationalRuleSource(raw, expected); assert.deepEqual(result.source, raw); assert.deepEqual(result.source.layers, { enterprise: null, group: null, personal: null });
  assert.equal(raw.sourceFingerprint, "e5c73e4ca27493af5685225f80d72b639604a71c4a9e9f4280ef2060a53f4dc0");
  assert.equal(result.candidate.fields.timesheetCycle.state, "unconfigured"); assert.equal(result.candidate.fields.correctionWindow.baselineMissing, true); assert.equal(result.candidate.fields.correctionWindow.constrainedDays, null);
  const personalOnly = copy(raw); personalOnly.layers.personal = copy(await makeLayer({ kind: "personal", workerId: expected.workerId, employeeId: expected.employeeId, employeeAuthUserId: expected.employeeAuthUserId }, 22));
  assert.equal((await resolveOperationalRuleSource(resign(personalOnly), expected)).source.layers.enterprise, null);
});

test("194 exported source tuple retains the frozen empty/full vectors and deletes only observation time for T0", async () => {
  for (const full of [false, true]) {
    const source = await parseOperationalRuleSource(await fixture(full), expected), tuple = operationalRuleSourceTuple(source);
    assert.equal(tuple.length, 8); assert.equal(tuple[3], expected.at); assert(Object.isFrozen(tuple));
    assert.equal(createHash("sha256").update(operationalRuleLedgerEncode(tuple)).digest("hex"), source.sourceFingerprint);
    const t0 = [...tuple.slice(0, 3), ...tuple.slice(4)]; assert.equal(t0.length, 7); assert.deepEqual(t0[3], [9, "Europe/Madrid"]);
  }
  const raw = copy(await fixture(false)); let read = 0;
  Object.defineProperty(raw, "at", { enumerable: true, get() { read++; return expected.at; } });
  assert.throws(() => operationalRuleSourceTuple(raw)); assert.equal(read, 0);
});
test("241 at and expected caller identity bind exact UTC6, not rounded milliseconds", async () => {
  const raw = await fixture(); for (const change of [{ at: "2026-10-08T12:00:00.123457Z" }, { siteId: "99990002" }, { workerId: id(91) }, { employeeId: id(92) }, { employeeAuthUserId: id(93) }, { at: "2026-10-08T12:00:00.123Z" }, { at: "2101-01-01T00:00:00.000000Z" }])
    await assert.rejects(parseOperationalRuleSource(raw, { ...expected, ...change }), /attendance_operational_source_invalid/);
  await assert.rejects(parseOperationalRuleSource(raw, { ...expected, actorId: id(1) } as OperationalRuleSourceExpected));
});
test("241 source hash covers identity/settings/group/baseline and every layer body fingerprint", async () => {
  const raw = await fixture(); const changes = [copy(raw), copy(raw), copy(raw), copy(raw), copy(raw)]; changes[0].workerIdentity.workerVersion++; changes[1].settingsRef.version++; changes[2].groupAssignmentRef!.operationId = id(99); changes[3].baselineCorrectionPolicyRef!.submissionWindowDays = 0; changes[4].layers.enterprise!.rulesFingerprint = "a".repeat(64);
  for (const changed of changes) await assert.rejects(parseOperationalRuleSource(changed, expected));
  const changedBody = copy(raw); changedBody.layers.personal!.rules = copy(parseOperationalRules({ ...changedBody.layers.personal!.rules, correctionWindow: { mode: "value", value: { days: 6 } } }));
  await assert.rejects(parseOperationalRuleSource(resign(changedBody), expected));
  const changedRefs = copy(raw); changedRefs.layers.enterprise!.references.locations[0].version++; await assert.rejects(parseOperationalRuleSource(resign(changedRefs), expected));
});
test("241 correct outer hashes do not excuse scope relabeling or impossible monotonic versions", async () => {
  const raw = await fixture(); const variants = [copy(raw), copy(raw), copy(raw), copy(raw)];
  variants[0].groupAssignmentRef!.employeeId = id(99); variants[1].groupAssignmentRef!.savedWorkerVersion = 8; variants[2].groupAssignmentRef!.savedSettingsVersion = 10; variants[3].groupAssignmentRef = null;
  for (const changed of variants) await assert.rejects(parseOperationalRuleSource(resign(changed), expected));
  for (const [key, field, value] of [["enterprise", "settingsVersion", 10], ["group", "groupRevision", 4], ["personal", "workerVersion", 8], ["personal", "employeeVersion", 7]] as const) {
    const changed = copy(raw), l = changed.layers[key]!; if (field === "settingsVersion") l.context.settingsVersion = value;
    else if (field === "groupRevision" && l.context.subject && "groupRevision" in l.context.subject) l.context.subject.groupRevision = value;
    else if (l.context.subject && "workerVersion" in l.context.subject) l.context.subject[field as "workerVersion" | "employeeVersion"] = value;
    l.referenceFingerprint = await operationalRuleLedgerReferenceFingerprint(expected.siteId, l.scope, l.context, l.references); await assert.rejects(parseOperationalRuleSource(resign(changed), expected));
  }
  for (const key of ["group", "personal"] as const) { const changed = copy(raw), l = changed.layers[key]!;
    if (l.scope.kind === "group") l.scope.groupId = id(99); else if (l.scope.kind === "personal") l.scope.employeeAuthUserId = id(99);
    l.referenceFingerprint = await operationalRuleLedgerReferenceFingerprint(expected.siteId, l.scope, l.context, l.references); await assert.rejects(parseOperationalRuleSource(resign(changed), expected)); }
});
test("241 group assignment current-operation semantics and saved-zone boundaries are exact", async () => {
  const raw = await fixture(), bounded = copy(raw); bounded.groupAssignmentRef!.revision = 1; bounded.groupAssignmentRef!.operationId = bounded.groupAssignmentRef!.assignmentId;
  await parseOperationalRuleSource(resign(bounded), expected); const open = copy(bounded); open.groupAssignmentRef!.endsOn = null; open.groupAssignmentRef!.toAt = null; await parseOperationalRuleSource(resign(open), expected);
  for (const change of [{ revision: 1, operationId: id(11) }, { revision: 2, operationId: id(10) }, { endsOn: null, toAt: null }, { fromAt: "2026-10-01T00:00:00.000000Z" }, { toAt: "2026-11-01T00:00:00.000000Z" }, { timeZone: "UTC" }]) {
    const broken = copy(raw); Object.assign(broken.groupAssignmentRef!, change); await assert.rejects(parseOperationalRuleSource(resign(broken), expected)); }
});
test("241 source rejects future/expired layers and future baseline using exact microseconds", async () => {
  const raw = await fixture(); for (const change of [{ effectiveAt: "2026-10-08T12:00:00.123457Z" }, { endsAt: expected.at }, { endsAt: null }]) {
    const broken = copy(raw); Object.assign(broken.layers.personal!, change); await assert.rejects(parseOperationalRuleSource(resign(broken), expected)); }
  const enterprise = copy(raw); enterprise.layers.enterprise!.endsAt = "2026-10-10T00:00:00.000000Z"; await assert.rejects(parseOperationalRuleSource(resign(enterprise), expected));
  const baseline = copy(raw); baseline.baselineCorrectionPolicyRef!.recordedAt = "2026-10-08T12:00:00.123457Z"; await assert.rejects(parseOperationalRuleSource(resign(baseline), expected));
});
test("241 publication refs retain saved active facts and cannot be replaced by current directory data", async () => {
  const broken = copy(await fixture()); broken.layers.enterprise!.references.locations[0].active = false; const l = broken.layers.enterprise!;
  l.referenceFingerprint = await operationalRuleLedgerReferenceFingerprint(expected.siteId, l.scope, l.context, l.references); await assert.rejects(parseOperationalRuleSource(resign(broken), expected));
  const extras = copy(await fixture()); Object.assign(extras.layers.group!, { actorId: id(5), reason: "invented item" }); await assert.rejects(parseOperationalRuleSource(resign(extras), expected));
});
test("241 assignment UTC edges may use 1999 or 2101 while source at remains in supported horizon", async () => {
  for (const [at, startsOn, endsOn, timeZone] of [["2000-01-01T00:00:00.000000Z", "2000-01-01", null, "Pacific/Kiritimati"], ["2100-12-31T12:00:00.000000Z", "2100-12-31", "2100-12-31", "UTC"]] as const) {
    const raw = copy(await fixture(false)); raw.at = at; raw.groupAssignmentRef = { assignmentId: id(10), operationId: id(10), revision: 1, groupId: id(12), currentGroupRevision: 1, workerId: expected.workerId, employeeId: expected.employeeId, savedWorkerVersion: 1, savedSettingsVersion: 1,
      timeZone, startsOn, endsOn, fromAt: utc6(attendanceDayUtcRange(startsOn, timeZone).startAt), toAt: endsOn === null ? null : utc6(attendanceDayUtcRange(endsOn, timeZone).endAt) };
    await parseOperationalRuleSource(resign(raw), { ...expected, at }); assert.ok(raw.groupAssignmentRef.fromAt.startsWith("1999") || raw.groupAssignmentRef.toAt?.startsWith("2101")); }
});
test("241 strict JSON/tree reject duplicate keys, invalid Unicode, extra source data and oversize without getters", async () => {
  const raw = await fixture(false), text = JSON.stringify(raw); await assert.rejects(parseOperationalRuleSourceJson(text.replace('"siteId":', '"siteId":"99990001","siteId":'), expected));
  await assert.rejects(parseOperationalRuleSourceJson(text.replace('"siteId":', '"\\u0073iteId":"99990001","siteId":'), expected));
  for (const value of ['{"x":"\\ud800"}', '{"x":"\\u0000"}', JSON.stringify("中".repeat(90000))]) await assert.rejects(parseOperationalRuleSourceJson(value, expected));
  let reads = 0; await assert.rejects(parseOperationalRuleSource({ ...raw, get details() { reads++; return "private"; } }, expected)); assert.equal(reads, 0);
  await assert.rejects(parseOperationalRuleSource({ ...raw, siteId: raw.siteId + "\n" }, expected)); await assert.rejects(parseOperationalRuleSource({ ...raw, canApprove: true }, expected));
  const cyclic = copy(raw) as Writable<OperationalRuleSource> & { cycle?: unknown }; cyclic.cycle = cyclic; await assert.rejects(parseOperationalRuleSource(cyclic, expected));
});
test("241 one narrow 240 source bridge validates exact fields before reading and returns canonical frozen tuples", async () => {
  const l = (await fixture()).layers.enterprise!, fields = { scope: l.scope, context: l.context, rules: l.rules, references: l.references }, parsed = parseOperationalRuleLedgerSourceFields(fields);
  assert.equal(parsed.tuples.length, 4); assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.tuples)); assert.deepEqual(parsed.tuples[0], ["enterprise"]);
  let reads = 0; assert.throws(() => parseOperationalRuleLedgerSourceFields({ ...fields, get extra() { reads++; return true; } })); assert.equal(reads, 0);
  assert.throws(() => parseOperationalRuleLedgerSourceFields({ ...fields, references: { ...l.references, locations: [] } }));
  assert.throws(() => parseOperationalRuleLedgerSourceFields({ ...fields, context: { ...l.context, subject: { groupRevision: 1 } } }));
});
