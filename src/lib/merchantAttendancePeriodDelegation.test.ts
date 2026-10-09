import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  PERIOD_DELEGATION_ACTIONS, parsePeriodDelegationQuery, parsePeriodDelegationHttpQuery, periodDelegationQueryString,
  parsePeriodDelegationCommand, parsePeriodDelegationBody, parsePeriodDelegationJson, periodDelegationFingerprintText,
  periodDelegationCommandFingerprint, periodDelegationReceiptMatches, parsePeriodDelegationResult, parsePeriodDelegationResponse,
  type PeriodDelegationQuery, type PeriodDelegationGrantCommand, type PeriodDelegationRevokeCommand,
  type PeriodDelegationGrant, type PeriodDelegationResult, type PeriodDelegationReceipt,
} from "./merchantAttendancePeriodDelegation";

const id = (n: number) => `24000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const owner = id(1), delegate = id(3), readAt = "2026-10-08T10:05:00.000000Z";
const query = (access: PeriodDelegationQuery["access"] = "owner", mode: PeriodDelegationQuery["mode"] = "list"): PeriodDelegationQuery => ({
  siteId: "99990232", access, mode, catalog: mode === "catalog" ? "delegates" : null,
  grantId: mode === "detail" ? id(10) : null, afterId: null, operationId: mode === "recover" ? id(10) : null,
});
const command = (): PeriodDelegationGrantCommand => ({ action: "grant", operationId: id(10), delegateEmployeeId: id(2), delegateAuthUserId: delegate,
  workerId: id(4), employeeId: id(5), employeeAuthUserId: id(6), fromDate: "2026-10-01", throughDate: "2026-10-31",
  actions: [...PERIOD_DELEGATION_ACTIONS], includeExisting: false, validFrom: "2026-10-08T09:00:00.000000Z",
  validUntil: "2026-10-09T09:00:00.000000Z", reason: "Synthetic  explicit delegation" });
const grant = (): PeriodDelegationGrant => ({ grantId: id(10), revision: 1, status: "granted",
  delegate: { employeeId: id(2), authUserId: delegate, name: "Synthetic delegate" },
  worker: { workerId: id(4), employeeId: id(5), authUserId: id(6), name: "Synthetic worker", workerNo: "T-1" },
  fromDate: command().fromDate, throughDate: command().throughDate, actions: [...PERIOD_DELEGATION_ACTIONS], includeExisting: false,
  validFrom: command().validFrom, validUntil: command().validUntil, grantedBy: owner, grantedAt: "2026-10-08T10:00:00.000000Z",
  reason: command().reason, revocation: null, usableActions: [...PERIOD_DELEGATION_ACTIONS] });
const result = (q: PeriodDelegationQuery): PeriodDelegationResult => ({ protocol: "period-delegation-v1", siteId: q.siteId, access: q.access,
  actorId: q.access === "owner" ? owner : delegate, employeeId: q.access === "owner" ? null : id(2), mode: q.mode, canWrite: q.mode !== "recover",
  grants: q.mode === "list" ? [grant()] : [], catalogItems: q.mode === "catalog" ? [{ id: id(2), name: "Synthetic delegate", employeeId: id(2), employeeAuthUserId: delegate, workerNo: null, actions: ["view"] }] : [],
  detail: q.mode === "detail" ? grant() : null, receipt: null, nextAfterId: null, readAt });
const saved = (): PeriodDelegationReceipt => ({ operationId: id(10), action: "grant", grantId: id(10), grantRevision: 1,
  periodId: null, periodRevision: null, actorId: owner, recordedAt: "2026-10-08T10:00:00.000000Z",
  commandFingerprint: createHash("sha256").update(periodDelegationFingerprintText(query(), command())).digest("hex") });

test("all query modes round trip with exact nullable selectors and owner-only catalogs", () => {
  for (const access of ["owner", "delegate"] as const) for (const mode of ["list", "detail", "recover", ...(access === "owner" ? ["catalog" as const] : [])] as const) {
    const q = query(access, mode); assert.deepEqual(parsePeriodDelegationQuery(q), q);
    assert.deepEqual(parsePeriodDelegationHttpQuery("https://www.faolla.com/any?" + periodDelegationQueryString(q)), q);
  }
  for (const bad of [{ ...query(), catalog: "workers" }, query("delegate", "catalog"), { ...query(), grantId: id(10) },
    { ...query("owner", "detail"), afterId: id(9) }, { ...query("owner", "recover"), grantId: id(10) }, { ...query(), actorId: owner }]) assert.throws(() => parsePeriodDelegationQuery(bad));
});
test("HTTP parser rejects duplicate, unknown, empty, malformed and fragment selectors", () => {
  const url = "https://www.faolla.com/any?" + periodDelegationQueryString(query());
  for (const bad of [url + "&siteId=99990232", url + "&actorId=" + owner, url + "&afterId=", url + "&afterId=%QQ", url + "#x", url + "#",
    url.replace("https://", "https://user:pass@"), url + "\n", url.replace("mode=list", "mode=unknown")]) assert.throws(() => parsePeriodDelegationHttpQuery(bad));
});
test("exact commands prohibit self-delegation, implicit actions and malformed civil intervals", () => {
  const c = command(); assert.deepEqual(parsePeriodDelegationBody({ query: query(), command: c }), { query: query(), command: c });
  for (const change of [{ actions: ["send"] }, { actions: ["view", "seal", "send"] }, { actions: ["view", "view"] }, { actions: [] }, { actions: ["view", "confirm"] },
    { delegateEmployeeId: c.employeeId }, { delegateAuthUserId: c.employeeAuthUserId }, { fromDate: "2026-02-30" }, { throughDate: "2027-10-02" },
    { includeExisting: "false" }, { reason: " leading" }, { reason: "x".repeat(201) }, { actorId: owner }]) assert.throws(() => parsePeriodDelegationCommand({ ...c, ...change }));
  assert.throws(() => parsePeriodDelegationBody({ query: query("delegate"), command: c }));
  assert.throws(() => parsePeriodDelegationBody({ query: { ...query(), afterId: id(9) }, command: c }));
});
test("validity is UTC6, positive and bounded to366 exact days rather than rounded milliseconds", () => {
  const c = { ...command(), validFrom: "2026-10-08T09:00:00.000001Z", validUntil: "2027-10-09T09:00:00.000001Z" };
  assert.doesNotThrow(() => parsePeriodDelegationCommand(c));
  for (const bad of [{ ...c, validUntil: "2027-10-09T09:00:00.000002Z" }, { ...c, validUntil: c.validFrom },
    { ...c, validFrom: "2026-10-08T09:00:00.001Z" }, { ...c, validFrom: "2026-10-08T11:00:00.000001+02:00" }]) assert.throws(() => parsePeriodDelegationCommand(bad));
});
test("revoke CAS is exactly revision1 and belongs to the selected grant", () => {
  const c: PeriodDelegationRevokeCommand = { action: "revoke", operationId: id(11), grantId: id(10), expectedRevision: 1, reason: "Revoke" };
  assert.deepEqual(parsePeriodDelegationBody({ query: query("owner", "detail"), command: c }).command, c);
  for (const bad of [{ ...c, expectedRevision: 2 }, { ...c, grantId: id(12) }, { ...c, expectedFingerprint: "a".repeat(64) }]) {
    assert.throws(() => parsePeriodDelegationBody({ query: query("owner", "detail"), command: bad }));
  }
});
test("immutable receipt hash uses fixed scalar tuple spacing and preserves reason spaces", async () => {
  const q = query(), c = command(), text = periodDelegationFingerprintText(q, c), tuple = JSON.parse(text);
  assert.equal(tuple[0], "attendance-period-delegation-v1"); assert.equal(tuple[1], q.siteId); assert.equal(tuple.at(-1), c.reason);
  assert.equal(tuple[12], c.actions.join(",")); assert.equal(tuple[13], false);
  assert(text.startsWith('["attendance-period-delegation-v1", "99990232", "owner", '));
  const fingerprint = createHash("sha256").update(text, "utf8").digest("hex");
  assert.equal(await periodDelegationCommandFingerprint(q, c), fingerprint); assert.equal(periodDelegationReceiptMatches(saved(), c, fingerprint), true);
  for (const receipt of [{ ...saved(), commandFingerprint: "0".repeat(64) }, { ...saved(), operationId: id(11) }, { ...saved(), grantRevision: 2 as const }, { ...saved(), periodId: id(99) }]) {
    assert.equal(periodDelegationReceiptMatches(receipt, c, fingerprint), false);
  }
  assert.notEqual(periodDelegationFingerprintText(q, { ...c, reason: "Synthetic explicit delegation" }), text);
});
test("all result modes bind actual actor and delegate dual identity; snapshots are frozen", () => {
  for (const access of ["owner", "delegate"] as const) for (const mode of ["list", "detail", "recover", ...(access === "owner" ? ["catalog" as const] : [])] as const) {
    const q = query(access, mode), r = result(q), parsed = parsePeriodDelegationResult(r, q, { authUserId: r.actorId });
    assert.deepEqual(parsed, r); assert(Object.isFrozen(parsed)); assert(Object.isFrozen(parsed.grants));
  }
  const q = query("delegate"), original = result(q);
  for (const mutate of [(r: PeriodDelegationResult) => { r.actorId = owner; }, (r: PeriodDelegationResult) => { r.employeeId = id(99); },
    (r: PeriodDelegationResult) => { r.grants[0].delegate.authUserId = id(99); }, (r: PeriodDelegationResult) => { r.grants[0].usableActions = ["view", "send"]; r.grants[0].actions = ["view"]; },
    (r: PeriodDelegationResult) => { r.readAt = r.grants[0].validUntil; }]) {
    const r = structuredClone(original); mutate(r); assert.throws(() => parsePeriodDelegationResult(r, q, { authUserId: delegate }));
  }
});
test("list pages are bounded25, strictly increasing and next cursor equals last row", () => {
  const q = query(), r = result(q); r.grants = Array.from({ length: 25 }, (_, i) => ({ ...grant(), grantId: id(20 + i) })); r.nextAfterId = id(44);
  assert.doesNotThrow(() => parsePeriodDelegationResult(r, q, { authUserId: owner }));
  for (const bad of [{ ...r, grants: [...r.grants, { ...grant(), grantId: id(45) }] }, { ...r, nextAfterId: id(45) },
    { ...r, grants: [...r.grants].reverse() }, { ...r, grants: [r.grants[0]], nextAfterId: r.grants[0].grantId }]) assert.throws(() => parsePeriodDelegationResult(bad, q, { authUserId: owner }));
  assert.throws(() => parsePeriodDelegationResult(r, { ...q, afterId: id(20) }, { authUserId: owner }));
});
test("recovery returns only the original actor's minimal receipt and never current grant/source detail", () => {
  const q = query("owner", "recover"), r = { ...result(q), receipt: saved() };
  assert.deepEqual(parsePeriodDelegationResponse({ ok: true, ...r }, q, { authUserId: owner }), r);
  for (const bad of [{ ...r, canWrite: true }, { ...r, detail: grant() }, { ...r, grants: [grant()] },
    { ...r, receipt: { ...saved(), actorId: delegate } }, { ...r, receipt: { ...saved(), operationId: id(11) } }, { ...r, source: {} }]) {
    assert.throws(() => parsePeriodDelegationResult(bad, q, { authUserId: owner }));
  }
});
test("revoked and expired grants cannot advertise usable actions", () => {
  const q = query("owner", "detail"), r = result(q), g = r.detail!;
  g.revision = 2; g.status = "revoked"; g.revocation = { operationId: id(11), actorId: owner, reason: "Revoke", recordedAt: "2026-10-08T10:01:00.000000Z" };
  assert.throws(() => parsePeriodDelegationResult(r, q, { authUserId: owner })); g.usableActions = [];
  assert.doesNotThrow(() => parsePeriodDelegationResult(r, q, { authUserId: owner }));
  const expired = result(q); expired.detail!.usableActions = []; expired.readAt = "2026-10-10T10:00:00.000000Z";
  assert.doesNotThrow(() => parsePeriodDelegationResult(expired, q, { authUserId: owner }));
});
test("bounded pure parser rejects duplicate JSON, getters, sparse arrays, cycles and invalid Unicode", () => {
  assert.throws(() => parsePeriodDelegationJson('{"a":1,"a":2}', "request"), { code: "attendance_invalid_request" });
  assert.throws(() => parsePeriodDelegationJson('"' + "x".repeat(131073) + '"'));
  const q = query(), original = result(q), cyclic: Record<string, unknown> = { ...original }; cyclic.extra = cyclic;
  for (const bad of [{ ...original, grants: new Array(1) }, { ...original, [Symbol("private")]: true }, { ...original, extra: "\ud800" }, cyclic,
    Object.defineProperty({ ...original }, "actorId", { get() { throw Error("must not execute"); }, enumerable: true })]) assert.throws(() => parsePeriodDelegationResult(bad, q, { authUserId: owner }));
});
