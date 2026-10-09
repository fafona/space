import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parsePeriodDelegatedClosureQuery as query, parsePeriodDelegatedClosureCommand as command,
  parsePeriodDelegatedClosureHttpQuery as http, periodDelegatedClosureQueryString as stringify,
  parsePeriodDelegatedClosureBody as body, parsePeriodDelegatedClosureResult as result,
  periodDelegatedClosureFingerprintText as fingerprint, type PeriodDelegatedClosureQuery as Query } from "./merchantAttendancePeriodDelegatedClosure";
import { periodClosureUiId as id, periodClosureUiQuery, periodClosureUiArtifact, periodClosureUiSummary,
  periodClosureUiCommand } from "../../scripts/fixtures/attendance-period-closure-ui-model";
const actor = id(41001), employee = id(41002), grant = id(41003);
const q = (mode: Query["mode"] = "detail"): Query => query({ ...periodClosureUiQuery(mode === "history" || mode === "versions" ? "detail" : mode), mode, access: "delegate", grantId: grant, cursor: null });
const c = () => command(q(), periodClosureUiCommand());
const common = () => ({ protocol: "period-delegated-closure-v1", siteId: q().siteId, workerId: q().workerId, actorId: actor, employeeId: employee,
  access: "delegate", grantId: grant, readAt: "2026-09-12T12:00:00.000001Z", usableActions: ["view"] });
const receipt = () => ({ operationId: c().operationId, action: c().action, grantId: grant, grantRevision: 1, periodId: c().periodId, periodRevision: 1,
  actorId: actor, recordedAt: "2026-09-11T12:00:00.000001Z", commandFingerprint: createHash("sha256").update(fingerprint(q(), c())).digest("hex") });
test("delegate query is separate and cannot request owner, self or export", () => {
  for (const mode of ["list", "preview", "detail", "recover", "history", "versions"] as const) assert.deepEqual(http("https://example.test/?" + stringify(q(mode))), q(mode));
  for (const patch of [{ access: "owner" }, { access: "self" }, { mode: "export", version: 1 }, { grantId: null }, { authority: {} }, { fromDate: "2026-02-30" }, { version: -0 }]) assert.throws(() => query({ ...q(), ...patch }));
});
test("HTTP rejects duplicate keys, malformed URI, fragment and forged cursor", () => {
  const url = "https://example.test/?" + stringify(q());
  for (const suffix of ["#", "&grantId=" + grant, "&access=owner", "&version=01", "%zz", "\n"]) assert.throws(() => http(url + suffix));
  const h = q("history"), cursor = { kind: "history", siteId: h.siteId, workerId: h.workerId, access: "delegate", grantId: grant,
    fromDate: h.fromDate, throughDate: h.throughDate, periodId: h.periodId, atRevision: 100, beforeRevision: 51 };
  assert.deepEqual(query({ ...h, cursor }).cursor, cursor);
  assert.throws(() => query({ ...h, cursor: { ...cursor, grantId: id(49999) } }));
});
test("only four write actions and no employee confirmation, archive or authority input", () => {
  for (const action of ["send", "respond", "seal", "reopen"]) assert.equal(command(q(), { ...c(), action, expectedRevision: 10, expectedVersion: 2, reason: "Explicit test" }).action, action);
  for (const action of ["confirm", "dispute", "export", "grant"]) assert.throws(() => command(q(), { ...c(), action }));
  assert.throws(() => body({ query: q(), command: c(), artifact: {} }));
  assert.throws(() => command(q(), { ...c(), authority: {} }));
  assert.throws(() => command(q("history"), c()));
});
test("19 scalar fingerprint fields retain exact scope, number, null and unicode reason", () => {
  const a = c(), f = fingerprint(q(), a), tuple = JSON.parse(f);
  assert.equal(tuple.length, 19); assert.equal(tuple[3], grant); assert.equal(tuple[15], 0); assert.equal(tuple[9], null);
  assert.notEqual(fingerprint(q(), { ...a, reason: "明确 核对" }), f);
  assert.notEqual(fingerprint({ ...q(), grantId: id(49999) }, a), f);
});
test("minimal receipt binds actual supervisor, grant, period, command and UTC microseconds", () => {
  const value = { ...common(), usableActions: [], kind: "receipt", receipt: receipt() };
  assert.deepEqual(result(value, q(), { authUserId: actor, employeeId: employee }, c()), value);
  assert.deepEqual(result(value, q("recover"), { authUserId: actor }), value);
  for (const patch of [{ grantId: id(40000) }, { employeeId: id(40000) }, { usableActions: ["view"] }, { artifact: {} }]) assert.throws(() => result({ ...value, ...patch }, q(), { authUserId: actor, employeeId: employee }, c()));
  for (const patch of [{ actorId: id(40000) }, { operationId: id(40000) }, { action: "confirm" }, { periodRevision: 2 }, { grantRevision: 2 }, { periodId: null }]) assert.throws(() => result({ ...value, receipt: { ...receipt(), ...patch } }, q(), { authUserId: actor }, c()));
});
test("not-found GET retains a null receipt, never an implied write success", () => {
  const value = { ...common(), usableActions: [], kind: "receipt", receipt: null };
  assert.equal(result(value, q("recover")).kind, "receipt");
  assert.throws(() => result(value, q(), {}, c())); assert.throws(() => result(value, q()));
});
test("existing immutable v1 artifact can be read without relabelling its historical owner", () => {
  const value = { ...common(), kind: "detail", period: periodClosureUiSummary(), artifact: periodClosureUiArtifact(), artifactVersion: 1,
    sourceChanged: false, operation: null, replayed: false };
  assert.deepEqual(result(value, q(), { authUserId: actor, employeeId: employee }), value);
  assert.equal(value.artifact.report.access, "owner");
  assert.throws(() => result(value, q(), { targetAuthUserId: actor }));
  for (const patch of [{ usableActions: [] }, { usableActions: ["send"] }, { usableActions: ["view", "view"] }, { usableActions: ["seal", "view"] }]) assert.throws(() => result({ ...value, ...patch }, q()));
  assert.throws(() => result(value, q("recover")));
});
