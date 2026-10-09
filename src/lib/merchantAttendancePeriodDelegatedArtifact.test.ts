import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parsePeriodClosureArtifact, parsePeriodClosureResult, parsePeriodDelegatedArtifactDraft,
  type PeriodDelegatedArtifact } from "./merchantAttendancePeriodClosure";
import { executePeriodClosures, projectPeriodClosureSource, projectPeriodDelegatedSource } from "./merchantAttendancePeriodClosure.server";
import { parsePeriodClosureSourceReport, parsePeriodDelegatedSourceReport } from "./merchantAttendancePeriodClosureSourceReport";
import { periodClosureUiArtifact, periodClosureUiQuery, periodClosureUiHttp, periodClosureUiId as id,
  periodClosureUiOwner as owner, periodClosureUiAuth as auth, periodClosureUiPeriod as periodId } from "../../scripts/fixtures/attendance-period-closure-ui-model";
import { scheduleEvidenceWire, scheduleEvidenceMissing, scheduleEvidenceCorrection } from "../../scripts/fixtures/attendance-schedule-evidence-model";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
// Actual184 wire shape, with synthetic facts only. No test casts an owner
// projection to delegate, and no test claims SQL sidecar/authorization proof.
function rawSource(mixed = false) {
  const old = scheduleEvidenceWire().attendance, a = periodClosureUiArtifact(), q = periodClosureUiQuery();
  if (mixed) {
    old.base.items[0].effect = scheduleEvidenceCorrection(old.base.items[0], { startAt: "2026-09-02T09:00:00.000000Z", endAt: "2026-09-02T16:00:00.000000Z", breaks: [] });
    old.missing = [scheduleEvidenceMissing()];
  }
  const report = { ...old, access: "delegate" }, base = { ...old.base } as Record<string, unknown>; delete base.asOf;
  const context = { pendingCorrections: [], missing: [], leave: [], calendar: [], plans: { items: [], sessions: [] }, reviews: [] };
  const canonical = { sourceVersion: "attendance-period-source-v1", siteId: q.siteId, workerId: q.workerId,
    employeeId: a.worker.employeeId, employeeAuthUserId: a.worker.employeeAuthUserId, timeZone: "UTC", fromDate: q.fromDate, throughDate: q.throughDate,
    fromAt: report.base.fromAt, toAt: report.base.toAt, dayBoundaries: a.dayBoundaries, context,
    report: { version: report.version, base, missing: report.missing.map(m => ({ ...m, employeeId: a.worker.employeeId })), complete: true, payrollReady: false } };
  const sourceText = JSON.stringify(canonical);
  return { ...canonical, report, sourceCanonical: canonical, sourceText, sourceFingerprint: sha(sourceText),
    readAt: report.base.asOf, blockers: [] as string[], complete: true, validation: "delegate_checked" };
}
function basis(raw = rawSource()) {
  return { siteId: raw.siteId, access: "delegate", workerId: raw.workerId, employeeId: raw.employeeId, employeeAuthUserId: raw.employeeAuthUserId,
    fromDate: raw.fromDate, throughDate: raw.throughDate, timeZone: raw.timeZone, fromAt: raw.fromAt, toAt: raw.toAt, dayBoundaries: raw.dayBoundaries };
}
function draft(mixed = false) { return projectPeriodDelegatedSource(rawSource(mixed), periodClosureUiQuery()).artifact; }
function saved(mixed = false): PeriodDelegatedArtifact {
  const a = draft(mixed);
  return { ...a, authority: { protocol: "period-delegation-authority-v1", siteId: a.source.siteId as string, grantId: id(901), grantRevision: 1,
    actorEmployeeId: id(902), actorAuthUserId: id(903), workerId: a.worker.workerId, employeeId: a.worker.employeeId, employeeAuthUserId: a.worker.employeeAuthUserId,
    delegateGeneration: 0, employeeGeneration: 1, fromDate: a.period.fromDate, throughDate: a.period.throughDate, action: "send", includeExisting: true,
    grantedAt: "2026-09-10T12:00:00.000001Z", authorizedAt: "2026-09-11T10:00:00.000001Z", periodId } };
}
function detail(access: "owner" | "self" = "owner") {
  const q = periodClosureUiQuery("export", access), wire = periodClosureUiHttp(q).data;
  assert.equal(wire.kind, "detail"); if (wire.kind !== "detail") throw Error("fixture");
  return { q, wire: { ...wire, artifact: saved() } };
}

test("old v1 archive values remain unchanged and cannot be relabeled delegate", () => {
  const old = periodClosureUiArtifact(); assert.deepEqual(parsePeriodClosureArtifact(old), old);
  assert.throws(() => parsePeriodClosureArtifact({ ...old, report: { ...old.report, access: "delegate" } }));
  assert.throws(() => parsePeriodClosureArtifact({ ...old, authority: saved().authority }));
});

test("candidate8 and saved9 are different exact protocols, never interchangeable", () => {
  const d = draft(), s = saved(); assert.equal(Object.keys(d).length, 8); assert.equal(Object.keys(s).length, 9);
  assert.deepEqual(parsePeriodDelegatedArtifactDraft(d), d); assert.deepEqual(parsePeriodClosureArtifact(s), s);
  assert.throws(() => parsePeriodClosureArtifact(d)); assert.throws(() => parsePeriodDelegatedArtifactDraft(s));
  assert.throws(() => parsePeriodDelegatedArtifactDraft(periodClosureUiArtifact()));
  assert.throws(() => parsePeriodClosureArtifact({ ...s, authority: null }));
});

test("authority is exactly eighteen required keys, with no private or missing fields", () => {
  const s = saved(); assert.equal(Object.keys(s.authority).length, 18);
  for (const key of Object.keys(s.authority)) {
    const a = { ...s.authority } as Record<string, unknown>; delete a[key]; assert.throws(() => parsePeriodClosureArtifact({ ...s, authority: a }), key);
  }
  assert.throws(() => parsePeriodClosureArtifact({ ...s, authority: { ...s.authority, currentOwnerId: owner } }));
});

test("authority binds saved employee double identity, worker, site and complete date scope", () => {
  const s = saved();
  for (const patch of [{ siteId: "99999999" }, { workerId: id(900) }, { employeeId: id(900) }, { employeeAuthUserId: id(900) },
    { fromDate: "2026-09-02" }, { throughDate: "2026-09-02" }, { actorEmployeeId: s.worker.employeeId }, { actorAuthUserId: s.worker.employeeAuthUserId },
    { grantRevision: 2 }, { action: "confirm" }, { action: "reopen" }, { periodId: null }, { includeExisting: null }, { grantId: "bad" }]) {
    assert.throws(() => parsePeriodClosureArtifact({ ...s, authority: { ...s.authority, ...patch } }), JSON.stringify(patch));
  }
});

test("saved authority times retain microseconds and generation cap matches185", () => {
  const s = saved();
  assert.doesNotThrow(() => parsePeriodClosureArtifact({ ...s, authority: { ...s.authority, delegateGeneration: 9007199254740990 } }));
  for (const patch of [{ grantedAt: "2026-09-11T10:00:00.000002Z" }, { authorizedAt: "2026-09-11T10:00:00.000Z" },
    { authorizedAt: "2026-09-11T12:00:00.000001+02:00" }, { authorizedAt: "2026-02-30T10:00:00.000001Z" },
    { delegateGeneration: -0 }, { employeeGeneration: -1 }, { employeeGeneration: 0.5 }, { delegateGeneration: 9007199254740991 }]) {
    assert.throws(() => parsePeriodClosureArtifact({ ...s, authority: { ...s.authority, ...patch } }));
  }
});

test("both v2 forms bind source frame/triple and cannot carry a relabeled scoped base", () => {
  const d = draft();
  for (const patch of [{ siteId: "99999999" }, { employeeId: id(404) }, { employeeAuthUserId: id(404) }, { workerId: id(404) },
    { fromAt: "2026-09-01T00:00:00.000001Z" }, { fromDate: "2026-09-02" }, { dayBoundaries: [] }, { sourceVersion: "invented" }]) {
    assert.throws(() => parsePeriodDelegatedArtifactDraft({ ...d, source: { ...d.source, ...patch } }));
  }
  for (const patch of [{ access: "self" }, { viewerEmployeeId: d.worker.employeeId }, { scopeRevision: null }]) {
    assert.throws(() => parsePeriodDelegatedArtifactDraft({ ...d, report: { ...d.report, base: { ...d.report.base, ...patch } } }));
  }
});

test("v2 remains a fixed saved archive without consulting current Intl or authorization", () => {
  const s = saved(), before = structuredClone(s), original = Intl.DateTimeFormat;
  Intl.DateTimeFormat = (() => { throw Error("must not reinterpret old archive"); }) as unknown as typeof Intl.DateTimeFormat;
  try { assert.deepEqual(parsePeriodClosureArtifact(s), before); } finally { Intl.DateTimeFormat = original; }
  assert.deepEqual(s, before);
});

test("old owner and genuine self detail can read saved delegate archives, not delegate-as-self actions", () => {
  for (const access of ["owner", "self"] as const) {
    const { q, wire } = detail(access), actor = access === "owner" ? owner : auth;
    assert.deepEqual(parsePeriodClosureResult(wire, q, { authUserId: actor }).kind, "detail");
    assert.throws(() => parsePeriodClosureResult({ ...wire, artifact: draft() }, q, { authUserId: actor }));
    assert.throws(() => parsePeriodClosureResult({ ...wire, artifact: { ...wire.artifact, authority: { ...wire.artifact.authority, periodId: id(888) } } }, q, { authUserId: actor }));
  }
});

test("old service verifies exact delegated stored body/bytes/SHA without collecting current source", async () => {
  const { q, wire } = detail("self"), artifactText = JSON.stringify(wire.artifact), calls: string[] = [];
  const raw = { ...wire, artifactText, artifactBytes: Buffer.byteLength(artifactText), artifactSha256: sha(artifactText) };
  const result = await executePeriodClosures({ query: q, authUserId: auth, moduleEnabled: false }, { rpc: async (name, args) => {
    calls.push(name); assert.equal(args.p_auth_user_id, auth); assert.equal(args.p_allow_write, false); return { data: raw, error: null };
  } });
  assert.deepEqual(calls, ["faolla_attendance_period_closure_v1"]); assert.equal(result.kind, "detail");
  for (const patch of [{ artifactText: artifactText + " " }, { artifactSha256: "a".repeat(64) }, { artifactBytes: raw.artifactBytes + 1 }]) {
    await assert.rejects(executePeriodClosures({ query: q, authUserId: auth }, { rpc: async () => ({ data: { ...raw, ...patch }, error: null }) }));
  }
});

test("dedicated source keeps delegate_checked/access and original/correction/missing totals", () => {
  const raw = rawSource(true), before = structuredClone(raw), q = periodClosureUiQuery(), d = projectPeriodDelegatedSource(raw, q).artifact;
  const ownerSource = { ...raw, validation: "owner_checked", report: { ...raw.report, access: "owner" } };
  const old = projectPeriodClosureSource(ownerSource, q).artifact;
  assert.equal(d.protocol, "attendance-period-artifact-v2"); assert.equal(d.report.access, "delegate"); assert.equal(Object.hasOwn(d, "authority"), false);
  assert.deepEqual(d.report.base, old.report.base); assert.deepEqual(d.report.totals, old.report.totals); assert.deepEqual(d.report.missing, old.report.missing);
  assert.equal(d.report.base.rows[0].source, "approved"); assert.equal(d.report.missing.length, 1); assert.deepEqual(raw, before);
  assert.throws(() => projectPeriodClosureSource(raw, q));
  assert.throws(() => parsePeriodClosureSourceReport(raw.report, basis(raw)));
});

test("delegate source rejects owner/self markers, altered canonical/hash and supplied scope mismatch", () => {
  const q = periodClosureUiQuery(), raw = rawSource();
  for (const patch of [{ validation: "owner_checked" }, { validation: "self_not_checked" }, { validation: null },
    { report: { ...raw.report, access: "owner" } }, { report: { ...raw.report, access: "self" } },
    { sourceFingerprint: "0".repeat(64) }, { sourceText: raw.sourceText + " " }, { siteId: "99999999" },
    { employeeAuthUserId: id(808) }, { blockers: ["open_session", "open_session"] }]) assert.throws(() => projectPeriodDelegatedSource({ ...raw, ...patch }, q));
  assert.throws(() => projectPeriodDelegatedSource(raw, { ...q, workerId: id(808) }));
  assert.throws(() => projectPeriodDelegatedSource(raw, { ...q, periodId: "bad" }));
  const detached = rawSource(); detached.sourceCanonical.employeeAuthUserId = id(808);
  detached.sourceText = JSON.stringify(detached.sourceCanonical); detached.sourceFingerprint = sha(detached.sourceText);
  assert.throws(() => projectPeriodDelegatedSource(detached, q));
});

test("delegated source computation rejects scoped base and broken raw facts rather than relabeling them", () => {
  const raw = rawSource(), f = basis(raw);
  assert.equal(parsePeriodDelegatedSourceReport(raw.report, f).access, "delegate");
  for (const access of ["owner", "self", "manager"]) assert.throws(() => parsePeriodDelegatedSourceReport(raw.report, { ...f, access }));
  assert.throws(() => parsePeriodDelegatedSourceReport({ ...raw.report, base: { ...raw.report.base, access: "owner" } }, f));
  const broken = rawSource(); broken.report.base.items[0].events[1].sequence = 999;
  assert.throws(() => parsePeriodDelegatedSourceReport(broken.report, f));
});

test("saved authority accessors and unknown protocol cannot bypass the bounded plain-JSON parser", () => {
  const s = saved(); let invoked = false;
  const a = { ...s.authority }; Object.defineProperty(a, "periodId", { get: () => { invoked = true; return periodId; }, enumerable: true });
  assert.throws(() => parsePeriodClosureArtifact({ ...s, authority: a })); assert.equal(invoked, false);
  assert.throws(() => parsePeriodClosureArtifact({ ...s, protocol: "attendance-period-artifact-v3" }));
  assert.throws(() => parsePeriodDelegatedArtifactDraft({ ...draft(), extra: true }));
});

test("v2 fixed frame rejects millisecond-only boundaries even if all copies agree", () => {
  const a = draft(), old = JSON.stringify(a), shortened = JSON.parse(old.replaceAll(".000000Z", ".000Z"));
  assert.throws(() => parsePeriodDelegatedArtifactDraft(shortened));
  assert.deepEqual(JSON.stringify(a), old);
});
