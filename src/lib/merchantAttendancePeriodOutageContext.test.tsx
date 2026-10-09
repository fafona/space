import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { periodSourceWithoutOutages, validatePeriodOutageContext, type PeriodOutageContextEntry } from "./merchantAttendancePeriodOutageContext";
import { parsePeriodClosureArtifact } from "./merchantAttendancePeriodClosure";
import { projectPeriodClosureSource } from "./merchantAttendancePeriodClosure.server";
import { periodClosureCanSendPreview } from "./merchantAttendancePeriodClosureClient";
import { buildPeriodClosureOutput, periodClosureSavedContext, PeriodClosureSavedReport } from "../components/enterprise/MerchantAttendancePeriodClosureWorkspace";
import { periodClosureUiArtifact, periodClosureUiQuery, periodClosureUiId as id, periodClosureUiOwner as owner } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { scheduleEvidenceWire } from "../../scripts/fixtures/attendance-schedule-evidence-model";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const a = periodClosureUiArtifact(), q = periodClosureUiQuery(), worker = a.worker, period = a.period;
const interval = { startAt: "2026-09-02T08:00:00.000000Z", endAt: "2026-09-02T09:00:00.000000Z", timeZone: "UTC", startOffsetMinutes: 0, endOffsetMinutes: 0 };
function row(resolved = false): PeriodOutageContextEntry {
  const blank: PeriodOutageContextEntry = { declarationId: id(215010), workerId: worker.workerId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId,
    interval: { ...interval }, revision: 0, resultVersion: 0, current: null, proposal: null, response: null,
    status: { basisFingerprint: null, linkOperationId: null, linkRevision: 0, linkFingerprint: null, blockers: ["link_missing", "result_missing", "unconfirmed"], resolved: false } };
  if (!resolved) return blank;
  const span = { startAt: interval.startAt, endAt: interval.endAt };
  const linkEvidence = { protocol: "outage-link-evidence-v1" as const, siteId: q.siteId, declarationId: blank.declarationId, workerId: worker.workerId,
    employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId, workerVersion: 1, employeeVersion: 1, generation: 0, declaredInterval: { ...interval },
    items: [{ reference: { kind: "session" as const, startEventId: id(215020), lastEventId: id(215021), lastSequence: 2, effectOperationId: null, effectRevision: null },
      locationId: id(215022), timeZone: "UTC", original: { ...span }, selected: { ...span }, evidenceFingerprint: "b".repeat(64), open: false, pending: false }] };
  const evidence = { protocol: "outage-review-evidence-v1" as const, siteId: q.siteId, declarationId: blank.declarationId, linkOperationId: id(215023), linkRevision: 1,
    linkFingerprint: sha(JSON.stringify(linkEvidence)), linkEvidence, original: { status: "not_required" as const, operationId: null, channel: null, eventId: null } };
  const first = { operationId: id(215030), revision: 1, action: "propose" as const, actorId: owner, resultVersion: 1,
    resultFingerprint: sha(JSON.stringify(evidence)), reason: "Synthetic exact recovery result <img>", recordedAt: "2026-09-11T10:00:00.000000Z" };
  const proposal = { ...first, evidence }, response = { ...first, operationId: id(215031), revision: 2, action: "confirm" as const, actorId: worker.employeeAuthUserId };
  return { ...blank, revision: 3, resultVersion: 1, current: { ...first, operationId: id(215032), revision: 3, action: "resolve" }, proposal, response,
    status: { basisFingerprint: first.resultFingerprint, linkOperationId: evidence.linkOperationId, linkRevision: 1, linkFingerprint: evidence.linkFingerprint, blockers: [], resolved: true } };
}
function source(rows: PeriodOutageContextEntry[] = [row()]) {
  return { sourceVersion: "attendance-period-source-v4", siteId: q.siteId, workerId: worker.workerId, employeeId: worker.employeeId, employeeAuthUserId: worker.employeeAuthUserId,
    fromDate: period.fromDate, throughDate: period.throughDate, timeZone: period.timeZone, fromAt: period.startAt, toAt: period.endAt,
    context: { pendingCorrections: [], missing: [], leave: [], calendar: [], plans: { items: [], sessions: [] }, reviews: [], outages: rows } };
}
function rawSource(rows: PeriodOutageContextEntry[] = [row()]) {
  const report = scheduleEvidenceWire().attendance, base = structuredClone(report.base) as unknown as Record<string, unknown>; delete base.asOf;
  const s = source(rows), canonical = { ...s, dayBoundaries: a.dayBoundaries, report: { version: report.version, base, missing: [], complete: true, payrollReady: false } };
  const sourceText = JSON.stringify(canonical);
  return { ...canonical, report, sourceCanonical: canonical, sourceText, sourceFingerprint: sha(sourceText), readAt: report.base.asOf,
    blockers: rows.some(r => !r.status.resolved) ? ["unresolved_outage"] : [], complete: true, validation: "owner_checked" };
}
const bad = (value: unknown) => assert.throws(() => validatePeriodOutageContext(value, worker, period), /attendance_period_closure_invalid/);

test("v4 includes unreviewed declarations, not just already-linked successful results", () => {
  assert.deepEqual(validatePeriodOutageContext(source(), worker, period), [row()]);
  const result = projectPeriodClosureSource(rawSource(), q); assert.deepEqual(result.blockers, ["unresolved_outage"]);
  const done = projectPeriodClosureSource(rawSource([row(true)]), q); assert.deepEqual(done.blockers, []);
  assert.deepEqual(done.artifact.report, result.artifact.report); assert.notEqual(done.artifact.sourceFingerprint, result.artifact.sourceFingerprint);
});
test("saved resolved results require exact proposal, employee confirmation and latest resolve", () => {
  assert.equal(validatePeriodOutageContext(source([row(true)]), worker, period)[0].status.resolved, true);
  for (const change of [(r: PeriodOutageContextEntry) => r.response = null, (r: PeriodOutageContextEntry) => r.response!.actorId = owner,
    (r: PeriodOutageContextEntry) => r.response!.resultVersion++, (r: PeriodOutageContextEntry) => r.current!.resultFingerprint = "c".repeat(64),
    (r: PeriodOutageContextEntry) => r.proposal!.revision = 4]) { const r = row(true); change(r); bad(source([r])); }
});
test("source change preserves historical resolve while current saved status is unresolved", () => {
  const r = row(true), p = structuredClone(r.proposal); r.status.basisFingerprint = "c".repeat(64); r.status.blockers = ["source_changed", "result_changed"]; r.status.resolved = false;
  assert.deepEqual(validatePeriodOutageContext(source([r]), worker, period)[0].proposal, p);
  r.status.resolved = true; bad(source([r]));
});
test("half-open declared intervals must overlap the fixed period, not merely touch", () => {
  for (const span of [{ startAt: period.endAt, endAt: "2026-09-05T00:00:00.000000Z" },
    { startAt: "2026-08-31T00:00:00.000000Z", endAt: period.startAt }]) bad(source([{ ...row(), interval: { ...interval, ...span } }]));
  assert.doesNotThrow(() => validatePeriodOutageContext(source([{ ...row(), interval: { ...interval, endAt: "2026-09-04T00:00:00.000001Z" } }]), worker, period));
});
test("both declaration and saved proposal bind current artifact worker and dual identity", () => {
  for (const key of ["workerId", "employeeId", "employeeAuthUserId"] as const) {
    const r = row(); r[key] = id(215099); bad(source([r]));
    const p = row(true); p.proposal!.evidence.linkEvidence[key] = id(215099); bad(source([p]));
  }
  const r = row(true); r.proposal!.evidence.linkEvidence.declaredInterval.startOffsetMinutes = 60; bad(source([r]));
});
test("no empty, downgraded, out-of-order or oversized outage section is accepted", () => {
  bad(source([])); bad({ ...source(), sourceVersion: "attendance-period-source-v3" });
  const missing = source() as Record<string, unknown>; missing.context = { ...source().context, outages: undefined }; bad(missing);
  const rows = Array.from({ length: 100 }, (_, n) => ({ ...row(), declarationId: id(215100 + n) }));
  assert.equal(validatePeriodOutageContext(source(rows), worker, period).length, 100);
  bad(source([...rows, { ...row(), declarationId: id(215200) }])); bad(source([rows[1], rows[0]])); bad(source([rows[0], rows[0]]));
});
test("snapshots reject new authority fields, raw evidence text and mixed empty revisions", () => {
  const extra = source(); Object.assign(extra.context.outages[0].status, { canWrite: true }); bad(extra);
  const raw = source([row(true)]); Object.assign(raw.context.outages[0].proposal!, { sourceText: "{}" }); bad(raw);
  for (const patch of [{ revision: 1 }, { resultVersion: 1 }, { revision: 1001 }, { current: row(true).current }]) bad(source([{ ...row(), ...patch }]));
});
test("legacy adaptation retains posthoc and work-arrangement checks without mutating v4 bytes", () => {
  const value = source([row(true)]), before = JSON.stringify(value), legacy = periodSourceWithoutOutages(value);
  assert.equal(legacy.sourceVersion, "attendance-period-source-v1"); assert(!Object.hasOwn(legacy.context as object, "outages")); assert.equal(JSON.stringify(value), before);
  const artifact = projectPeriodClosureSource(rawSource([row(true)]), q).artifact;
  for (const key of ["posthoc", "workArrangements"]) {
    const broken = structuredClone(artifact); (broken.source.context as Record<string, unknown>)[key] = [];
    assert.throws(() => parsePeriodClosureArtifact(broken), /attendance_period_closure_invalid/);
  }
  const old = periodClosureUiArtifact(), text = JSON.stringify(old); assert.doesNotThrow(() => parsePeriodClosureArtifact(old)); assert.equal(JSON.stringify(old), text);
});
test("archive validation uses saved UTC and offsets even if timezone data is unavailable", () => {
  const value = source([row(true)]); value.context.outages[0].interval.timeZone = "Saved/Unavailable";
  value.context.outages[0].proposal!.evidence.linkEvidence.declaredInterval.timeZone = "Saved/Unavailable";
  const original = Intl.DateTimeFormat;
  try { Intl.DateTimeFormat = (() => { throw Error("no timezone recalculation"); }) as unknown as typeof Intl.DateTimeFormat;
    assert.doesNotThrow(() => validatePeriodOutageContext(value, worker, period));
  } finally { Intl.DateTimeFormat = original; }
});
test("raw/canonical hashes and unresolved top blocker must agree with saved context", () => {
  const raw = rawSource(); assert.throws(() => projectPeriodClosureSource({ ...raw, blockers: [] }, q));
  assert.throws(() => projectPeriodClosureSource({ ...rawSource([row(true)]), blockers: ["unresolved_outage"] }, q));
  const forged = rawSource(); forged.sourceCanonical.context.outages[0].employeeAuthUserId = owner;
  forged.sourceText = JSON.stringify(forged.sourceCanonical); forged.sourceFingerprint = sha(forged.sourceText);
  assert.throws(() => projectPeriodClosureSource(forged, q));
});
test("only unfinished periods and unresolved outages gain send restrictions", () => {
  assert.equal(periodClosureCanSendPreview(["unresolved_outage"]), false);
  assert.equal(periodClosureCanSendPreview(["pending_leave", "unresolved_outage"]), false);
  assert.equal(periodClosureCanSendPreview(["open_session", "pending_leave", "unresolved_review", "pending_work_arrangement"]), true);
  assert.equal(periodClosureCanSendPreview([]), true);
});
test("v4 fixed CSV, print and saved report retain outage snapshots without executing text", () => {
  const artifact = projectPeriodClosureSource(rawSource([row(true)]), q).artifact;
  const entry = periodClosureSavedContext(artifact).find(e => e.key === "outages"); assert(entry); assert.match(entry.title, /故障恢复/);
  const output = buildPeriodClosureOutput(artifact, id(215800), 1), html = renderToStaticMarkup(<PeriodClosureSavedReport artifact={artifact}/>);
  assert.match(output.csv, /Synthetic exact recovery result <img>/); assert.match(output.html, /&lt;img&gt;/); assert.doesNotMatch(output.html, /<img>/);
  assert.match(html, /故障恢复核对与双方确认/); assert.match(output.html, new RegExp(row().declarationId));
});
test("malformed sparse arrays and executable getters fail without evaluation", () => {
  let ran = false; const getter = { get sourceVersion() { ran = true; return "attendance-period-source-v4"; } }; bad(getter); assert.equal(ran, false);
  const s = source(); s.context.outages = new Array(1); bad(s);
});
