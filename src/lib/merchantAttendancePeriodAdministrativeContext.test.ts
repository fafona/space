import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { administrativeSourceModel as model, administrativeReportWire } from "../../scripts/fixtures/attendance-administrative-report-model";
import { timesheetId as id } from "../../scripts/fixtures/attendance-timesheet-model";
import { parsePeriodClosureArtifact, parsePeriodDelegatedArtifactDraft } from "./merchantAttendancePeriodClosure";
import { projectPeriodClosureSource, projectPeriodDelegatedSource } from "./merchantAttendancePeriodClosure.server";
import { periodAdministrativeHoursUnassessed, periodSourceWithoutAdministrativeClosures, validatePeriodAdministrativeContext } from "./merchantAttendancePeriodAdministrativeContext";
import { parsePeriodClosureSourceReport } from "./merchantAttendancePeriodClosureSourceReport";
import { parsePeriodClosureV2Result } from "./merchantAttendancePeriodClosureV2";
import { parsePeriodDelegatedClosureResult } from "./merchantAttendancePeriodDelegatedClosure";
import { buildPeriodClosureOutput } from "../components/enterprise/MerchantAttendancePeriodClosureWorkspace";

test("explicit v5 fixed source retains public proof, private identity and unknown hours without source mutation", () => {
  const m = model(), before = structuredClone(m), parsed = parsePeriodClosureArtifact(m.artifact);
  assert.deepEqual(m, before); assert.deepEqual(parsed, m.artifact);
  assert.equal(parsed.report.base.rows[0].selectedInPeriod, null); assert.equal(parsed.report.totals.selected.workedUs, 7200000000);
  assert.equal(periodAdministrativeHoursUnassessed(m.source), true);
  const projected = periodSourceWithoutAdministrativeClosures(m.source);
  assert.equal(projected.sourceVersion, "attendance-period-source-v1"); assert(!Object.hasOwn(projected.context as object, "administrativeClosures"));
  assert.throws(() => parsePeriodClosureSourceReport(m.wire, m.basis));
});
test("v5 collector checks canonical bytes and exact blocker while a later completed successor is not blocked", () => {
  for (const later of [false, true]) {
    const m = model(later), q = { siteId: m.source.siteId, access: "owner" as const, workerId: m.worker.workerId, fromDate: m.period.fromDate,
      throughDate: m.period.throughDate, mode: "preview" as const, periodId: null, operationId: null, version: null };
    assert.deepEqual(projectPeriodClosureSource(m.envelope, q), { artifact: m.artifact, blockers: m.envelope.blockers });
    assert.equal(periodAdministrativeHoursUnassessed(m.source), !later);
    const bad = structuredClone(m.envelope); bad.blockers = later ? ["administrative_hours_unassessed"] : [];
    assert.throws(() => projectPeriodClosureSource(bad, q));
  }
});
test("saved v5 archive never invokes current Intl or recalculates old timezone labels", () => {
  const m = model(); m.source.timeZone = m.period.timeZone = m.artifact.report.base.timeZone = "Saved/Former-Zone";
  m.source.report.base.timeZone = "Saved/Former-Zone";
  const original = Intl.DateTimeFormat;
  try { Intl.DateTimeFormat = function () { throw Error("no_current_timezone_lookup"); } as unknown as typeof Intl.DateTimeFormat;
    assert.deepEqual(parsePeriodClosureArtifact(m.artifact), m.artifact);
  } finally { Intl.DateTimeFormat = original; }
});
test("v5 full proofs bind identity, exact public fields, ordered raw events, rows and unknown totals", () => {
  const edits: ((m: ReturnType<typeof model>) => void)[] = [
    m => { Object.assign(m.source.context.administrativeClosures[0], { employeeAuthUserId: id(800) }); },
    m => { Object.assign(m.source.context.administrativeClosures[0], { sourceFingerprint: "b".repeat(64) }); },
    m => { m.source.context.administrativeClosures.push(structuredClone(m.source.context.administrativeClosures[0])); },
    m => { m.source.context.plans.sessions[0].item.events[1].sequence++; },
    m => { m.source.context.plans.sessions[0].item.events[1].action = "break_end"; },
    m => { m.source.context.plans.sessions[0].item.events[1].occurredAt = "2026-10-01T00:00:00.000000Z"; },
    m => { m.source.context.plans.sessions[1].item.predecessorBoundary = null; },
    m => { m.artifact.report.base.rows[0].selectedInPeriod = { elapsedUs: 0, breakUs: 0, paidBreakUs: 0, workedUs: 0 }; },
    m => { m.artifact.report.base.totalsComplete = true; },
    m => { m.artifact.report.base.administrativeUnassessedCount = 0; },
    m => { m.artifact.report.base.rows[0].original.endAt = "2026-09-05T10:00:00.000000Z"; },
    m => { m.source.context.plans.sessions.shift(); },
    m => { m.source.sourceVersion = "attendance-period-source-v4"; },
  ];
  for (const edit of edits) { const m = model(); edit(m); assert.throws(() => parsePeriodClosureArtifact(m.artifact)); }
});
test("v5 with proof only in a related-plan session preserves an unchanged v2 base", () => {
  const m = model(true), normal = administrativeReportWire(true).base.items[0];
  Object.assign(normal, { predecessorBoundary: null });
  // An unrelated ordinary row is not the immediate successor of the close.
  normal.startEventId = id(110); normal.events.forEach((e, i) => { e.id = id(110 + i); e.sequence = 10 + i; });
  const { administrativeBoundary: _a, predecessorBoundary: _p, ...old } = normal; void _a; void _p;
  const raw = { ...m.wire, base: { ...m.wire.base, sourceVersion: "raw-and-approved-v2", items: [old] } };
  Reflect.deleteProperty(raw.base, "administrativeUnassessedCount"); Reflect.deleteProperty(raw.base, "totalsComplete");
  const report = parsePeriodClosureSourceReport(raw, m.basis);
  const source: Record<string, unknown> = structuredClone(m.source);
  const base = { ...raw.base }; Reflect.deleteProperty(base, "asOf");
  source.report = { version: raw.version, complete: true, payrollReady: false, base, missing: [] };
  const c = source.context as typeof m.source.context;
  c.plans.sessions.push({ item: { ...old, administrativeBoundary: null, predecessorBoundary: null }, ruleBinding: null, relation: null, adoption: null, planRuleApproval: null });
  assert.equal(validatePeriodAdministrativeContext(source, m.worker, m.period, report).length, 1);
  assert(!periodAdministrativeHoursUnassessed(source));
});
test("v5 delegate artifact keeps real delegate access and original fixed authority frame", () => {
  const m = model(true), envelope = { ...m.envelope, validation: "delegate_checked", report: { ...m.wire, access: "delegate" } };
  const sourceText = JSON.stringify(m.source); envelope.sourceText = sourceText; envelope.sourceFingerprint = createHash("sha256").update(sourceText).digest("hex");
  const q = { siteId: m.source.siteId, workerId: m.worker.workerId, fromDate: m.period.fromDate, throughDate: m.period.throughDate };
  const result = projectPeriodDelegatedSource(envelope, q);
  assert.equal(result.artifact.protocol, "attendance-period-artifact-v2"); assert.equal(result.artifact.report.access, "delegate");
  assert.equal(result.artifact.report.base.sourceVersion, "raw-and-approved-v3"); assert.deepEqual(result.blockers, []);
  assert.deepEqual(parsePeriodDelegatedArtifactDraft(result.artifact), result.artifact);
  assert.throws(() => parsePeriodDelegatedArtifactDraft({ ...result.artifact, report: { ...result.artifact.report, access: "owner" } }));
});

test("owner and delegate previews require the administrative blocker exactly while later completed work remains usable", () => {
  for (const later of [false, true]) {
    const m = model(later), actorId = id(880), grantId = id(881), employeeId = id(882);
    const query = { siteId: m.source.siteId, workerId: m.worker.workerId, fromDate: m.period.fromDate, throughDate: m.period.throughDate,
      access: "owner" as const, mode: "preview" as const, periodId: null, operationId: null, version: null, cursor: null };
    const common = { siteId: query.siteId, workerId: query.workerId, actorId, access: query.access, readAt: m.wire.base.asOf };
    const owner = { ...common, protocol: "period-closure-v2", kind: "preview", preview: { artifact: m.artifact, blockers: m.envelope.blockers, period: null } };
    assert.equal(parsePeriodClosureV2Result(owner, query, { authUserId: actorId }).kind, "preview");
    assert.throws(() => parsePeriodClosureV2Result({ ...owner, preview: { ...owner.preview, blockers: later ? ["administrative_hours_unassessed"] : [] } }, query));
    const delegated = projectPeriodDelegatedSource({ ...m.envelope, validation: "delegate_checked", report: { ...m.wire, access: "delegate" } }, query);
    const dq = { ...query, access: "delegate" as const, grantId };
    const result = { ...common, protocol: "period-delegated-closure-v1", access: "delegate", grantId, employeeId, usableActions: ["view"], kind: "preview",
      preview: { artifact: delegated.artifact, blockers: delegated.blockers, period: null } };
    assert.equal(parsePeriodDelegatedClosureResult(result, dq, { authUserId: actorId, employeeId }).kind, "preview");
    assert.throws(() => parsePeriodDelegatedClosureResult({ ...result, preview: { ...result.preview, blockers: later ? ["administrative_hours_unassessed"] : [] } }, dq));
  }
});

test("saved CSV and print show unknown administrative hours and known subtotals without consulting the current timezone", () => {
  const m = model(), parsed = parsePeriodClosureArtifact(m.artifact), before = structuredClone(parsed), original = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = function () { throw Error("no_current_timezone_lookup"); } as unknown as typeof Intl.DateTimeFormat;
    const output = buildPeriodClosureOutput(parsed, id(883), 1);
    for (const text of [output.csv, output.html]) {
      assert.match(text, /工时完整性/); assert.match(text, /周期已知部分小计/); assert.match(text, /按日已知部分小计/);
      assert.match(text, /待核定/); assert.match(text, /行政关闭，工时待核定/); assert.match(text, /administrativeClosures/);
    }
    assert.deepEqual(parsed, before);
    const later = buildPeriodClosureOutput(parsePeriodClosureArtifact(model(true).artifact), id(884), 1);
    assert.doesNotMatch(later.csv, /工时完整性|周期已知部分小计|按日已知部分小计/);
  } finally { Intl.DateTimeFormat = original; }
});
