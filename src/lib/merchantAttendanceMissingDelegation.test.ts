import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseMissingDelegationQuery, parseMissingDelegationHttpQuery, missingDelegationQueryString, parseMissingDelegationBody,
  parseMissingDelegationResponse, parseMissingDelegationJson, missingDelegationFingerprintText, missingDelegationCommandFingerprint,
  missingDelegationReceiptMatches } from "./merchantAttendanceMissingDelegation";
import { missingDelegationQuery as query, missingDelegationHttp as http, missingDelegationCommand as command, missingDelegationGrantCommand as grantCommand,
  missingDelegationReceiptHttp as receipt, missingDelegationId as id, missingDelegationEmployee as employee, missingDelegationAuth as auth } from "../../scripts/fixtures/attendance-missing-delegation-model";

test("exact query modes, scopes and HTTP fields refuse trimming, foreign keys, cursors and GET decide", () => {
  for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "list", "detail", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.deepEqual(parseMissingDelegationHttpQuery(`https://x.invalid/?${missingDelegationQueryString(q)}`), q); }
  for (const change of [{ siteId: "99990001\n" }, { actorId: id(1) }, { grantId: id(10) }, { beforeId: id(5) }]) assert.throws(() => parseMissingDelegationQuery({ ...query(), ...change }));
  assert.throws(() => parseMissingDelegationHttpQuery(`https://x.invalid/?${missingDelegationQueryString(query())}&siteId=99990001`));
  assert.throws(() => parseMissingDelegationHttpQuery(`https://x.invalid/?${missingDelegationQueryString(query("delegate", "decide"))}`));
  assert.throws(() => parseMissingDelegationQuery({ ...query("owner", "detail"), afterId: id(2) }));
});
test("grant/revoke/decision boundaries never promote delegate to legacy owner or contaminate exact6 command", () => {
  const q = query("delegate", "decide"), c = command(); assert.deepEqual(parseMissingDelegationBody({ query: q, command: c }).command, c);
  assert.equal(Object.keys(c.decision).length, 6);
  for (const bad of [{ ...c, expectedGrantRevision: 2 }, { ...c, grantId: id(77) }, { ...c, decision: { ...c.decision, grantId: id(10) } }, { ...c, decision: { ...c.decision, evidenceToken: "a".repeat(64) } }])
    assert.throws(() => parseMissingDelegationBody({ query: q, command: bad }));
  assert.throws(() => parseMissingDelegationBody({ query: query("owner", "detail"), command: c }));
  const g = grantCommand(); assert.deepEqual(parseMissingDelegationBody({ query: query("owner"), command: g }).command, g);
  assert.throws(() => parseMissingDelegationBody({ query: query("owner"), command: { ...g, employeeAuthUserId: g.delegateAuthUserId } }));
});
test("fixed scalar tuple WebCrypto matches SHA256 including Unicode, escaping and exact spaces", async () => {
  const c = command(); c.decision.reason = 'Quoted "\\ 日本😀';
  const text = missingDelegationFingerprintText("99990001", "delegate", c);
  assert(text.startsWith('["attendance-missing-delegation-v1", "99990001", "delegate", "approve", '));
  assert.equal(await missingDelegationCommandFingerprint("99990001", "delegate", c), createHash("sha256").update(text, "utf8").digest("hex"));
  assert.notEqual(await missingDelegationCommandFingerprint("99990001", "delegate", c), await missingDelegationCommandFingerprint("99990002", "delegate", c));
});
test("each valid owner and delegate view strictly matches its discriminant and identity", () => {
  for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "list", "detail", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.equal(parseMissingDelegationResponse(http(q), q).mode, mode); }
  const q = query(); assert.throws(() => parseMissingDelegationResponse(http(q), q, { employeeId: id(88) }));
  assert.throws(() => parseMissingDelegationResponse(http(q), q, { authUserId: id(88) }));
  assert.throws(() => parseMissingDelegationResponse({ ...http(q), originalMissingResult: {} }, q));
});
test("minimal recovered receipts match original hash/op/action/target and never permit leaked body", async () => {
  const q = query("delegate", "recover"), c = command(), wire = await receipt(q, c), r = parseMissingDelegationResponse(wire, q, { employeeId: employee, authUserId: auth });
  assert(r.receipt); const hash = await missingDelegationCommandFingerprint(q.siteId, q.access, c); assert(missingDelegationReceiptMatches(r.receipt, c, hash));
  assert(!missingDelegationReceiptMatches(r.receipt, { ...c, grantId: id(99) }, hash));
  for (const patch of [{ command: c.decision }, { workerName: "private" }, { reason: "private" }, { actorId: id(99) }, { operationId: id(99) }])
    assert.throws(() => parseMissingDelegationResponse({ ...wire, receipt: { ...wire.receipt, ...patch } }, q));
  assert.throws(() => parseMissingDelegationResponse({ ...wire, detail: http(query("delegate", "detail")).detail }, q));
});
test("saved UTC proposals avoid Intl, enforce half-open breaks and generalized blocker authority", () => {
  const q = query("delegate", "detail"), wire = http(q); if (wire.protocol !== "delegated-missing-v1" || !wire.detail) throw Error("fixture");
  const selected = wire.detail;
  selected.timeZone = "Historical/Zone"; const descriptor = Object.getOwnPropertyDescriptor(Intl, "DateTimeFormat")!;
  Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: () => { throw Error("no current timezone interpretation"); } });
  try { assert.equal(parseMissingDelegationResponse(wire, q).mode, "detail"); } finally { Object.defineProperty(Intl, "DateTimeFormat", descriptor); }
  for (const patch of [{ blocked: true }, { canReject: false }, { lineage: {} }, { issues: ["raw_overlap"] }])
    assert.throws(() => parseMissingDelegationResponse({ ...wire, detail: { ...selected, ...patch } }, q));
  assert.throws(() => parseMissingDelegationResponse({ ...wire, detail: { ...selected, proposal: { ...selected.proposal, breaks: [{ startAt: selected.proposal.startAt, endAt: selected.proposal.startAt, paid: false }] } } }, q));
});
test("duplicate JSON, unsafe graph, sparse arrays, lone surrogates and body cap are rejected", () => {
  assert.throws(() => parseMissingDelegationJson('{"a":1,"a":2}'));
  assert.throws(() => parseMissingDelegationJson('"' + "x".repeat(8192) + '"', "request"));
  const q = query(), w = http(q); assert.throws(() => parseMissingDelegationResponse({ ...w, grants: new Array(1) }, q));
  assert.throws(() => parseMissingDelegationQuery({ ...q, siteId: "\ud800" }));
  assert.throws(() => parseMissingDelegationResponse(Object.defineProperty({ ...w }, "actorId", { get: () => { throw Error("getter"); } }), q));
});
test("grant usability is the SQL observation, not expiry recomputed from later readAt or cross-command wall clocks", () => {
  const q = query(), w = http(q); if (w.protocol !== "delegated-missing-v1") throw Error("fixture");
  w.grants[0].validUntil = "2026-10-06T11:59:59.999999Z";
  assert.equal(parseMissingDelegationResponse(w, q).mode, "grants");
  const oq = query("owner", "detail"), owner = http(oq); if (owner.protocol !== "missing-delegations-v1" || !owner.detail) throw Error("fixture");
  owner.detail.revision = 2; owner.detail.status = "revoked"; owner.detail.usable = false;
  owner.detail.revocation = { operationId: id(31), actorId: id(1), reason: "Explicit revoke after clock adjustment", recordedAt: "2026-09-29T12:00:00.000000Z" };
  assert.equal(parseMissingDelegationResponse(owner, oq).mode, "detail");
  owner.detail.usable = true; assert.throws(() => parseMissingDelegationResponse(owner, oq));
});
