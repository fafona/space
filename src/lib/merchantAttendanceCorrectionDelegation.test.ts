import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseCorrectionDelegationQuery, parseCorrectionDelegationCommand, parseCorrectionDelegationHttpQuery, correctionDelegationQueryString, parseCorrectionDelegationBody,
  parseCorrectionDelegationResponse, parseCorrectionDelegationJson, correctionDelegationFingerprintText, correctionDelegationCommandFingerprint,
  correctionDelegationReceiptMatches } from "./merchantAttendanceCorrectionDelegation";
import { correctionDelegationQuery as query, correctionDelegationHttp as http, correctionDelegationCommand as command, correctionDelegationGrantCommand as grantCommand,
  correctionDelegationReceiptHttp as receipt, correctionDelegationId as id, correctionDelegationEmployee as employee, correctionDelegationAuth as auth } from "./merchantAttendanceCorrectionDelegationTestFixtures";

test("exact query modes, scopes and HTTP fields refuse trimming, foreign keys, cursors and GET decide", () => {
  for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "list", "detail", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.deepEqual(parseCorrectionDelegationHttpQuery(`https://x.invalid/?${correctionDelegationQueryString(q)}`), q); }
  for (const change of [{ siteId: "99990001\n" }, { actorId: id(1) }, { grantId: id(10) }, { beforeId: id(5) }]) assert.throws(() => parseCorrectionDelegationQuery({ ...query(), ...change }));
  assert.throws(() => parseCorrectionDelegationHttpQuery(`https://x.invalid/?${correctionDelegationQueryString(query())}&siteId=99990001`));
  assert.throws(() => parseCorrectionDelegationHttpQuery(`https://x.invalid/?${correctionDelegationQueryString(query("delegate", "decide"))}`));
  assert.throws(() => parseCorrectionDelegationQuery({ ...query("owner", "detail"), afterId: id(2) }));
});
test("grant/revoke/decision boundaries never promote delegate to legacy owner or contaminate exact6 command", () => {
  const q = query("delegate", "decide"), c = command(); assert.deepEqual(parseCorrectionDelegationBody({ query: q, command: c }).command, c);
  assert.equal(Object.keys(c.decision).length, 6);
  for (const bad of [{ ...c, expectedGrantRevision: 2 }, { ...c, grantId: id(77) }, { ...c, decision: { ...c.decision, grantId: id(10) } }, { ...c, decision: { ...c.decision, expectedEvidence: "a".repeat(64) } }])
    assert.throws(() => parseCorrectionDelegationBody({ query: q, command: bad }));
  assert.throws(() => parseCorrectionDelegationBody({ query: query("owner", "detail"), command: c }));
  const g = grantCommand(); assert.deepEqual(parseCorrectionDelegationBody({ query: query("owner"), command: g }).command, g);
  assert.throws(() => parseCorrectionDelegationBody({ query: query("owner"), command: { ...g, employeeAuthUserId: g.delegateAuthUserId } }));
});
test("fixed scalar tuple WebCrypto matches SHA256 including Unicode, escaping and exact spaces", async () => {
  const c = command(); c.decision.reason = 'Quoted "\\ 日本😀';
  const text = correctionDelegationFingerprintText("99990001", "delegate", c);
  assert(text.startsWith('["attendance-correction-delegation-v1", "99990001", "delegate", "approve", '));
  assert.equal(await correctionDelegationCommandFingerprint("99990001", "delegate", c), createHash("sha256").update(text, "utf8").digest("hex"));
  assert.notEqual(await correctionDelegationCommandFingerprint("99990001", "delegate", c), await correctionDelegationCommandFingerprint("99990002", "delegate", c));
});
test("each valid owner and delegate view strictly matches its discriminant and identity", () => {
  for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "list", "detail", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.equal(parseCorrectionDelegationResponse(http(q), q).mode, mode); }
  const q = query(); assert.throws(() => parseCorrectionDelegationResponse(http(q), q, { employeeId: id(88) }));
  assert.throws(() => parseCorrectionDelegationResponse(http(q), q, { authUserId: id(88) }));
  assert.throws(() => parseCorrectionDelegationResponse({ ...http(q), originalMissingResult: {} }, q));
});
test("minimal recovered receipts match original hash/op/action/target and never permit leaked body", async () => {
  const q = query("delegate", "recover"), c = command(), wire = await receipt(q, c), r = parseCorrectionDelegationResponse(wire, q, { employeeId: employee, authUserId: auth });
  assert(r.receipt); const hash = await correctionDelegationCommandFingerprint(q.siteId, q.access, c); assert(correctionDelegationReceiptMatches(r.receipt, c, hash));
  assert(!correctionDelegationReceiptMatches(r.receipt, { ...c, grantId: id(99) }, hash));
  for (const patch of [{ command: c.decision }, { workerName: "private" }, { reason: "private" }, { actorId: id(99) }, { operationId: id(99) }])
    assert.throws(() => parseCorrectionDelegationResponse({ ...wire, receipt: { ...wire.receipt, ...patch } }, q));
  assert.throws(() => parseCorrectionDelegationResponse({ ...wire, detail: http(query("delegate", "detail")).detail }, q));
});
test("saved UTC proposals avoid Intl, enforce half-open breaks and generalized blocker authority", () => {
  const q = query("delegate", "detail"), wire = http(q); if (wire.protocol !== "delegated-corrections-v1" || !wire.detail) throw Error("fixture");
  const selected = wire.detail;
  selected.timeZone = "Historical/Zone"; const descriptor = Object.getOwnPropertyDescriptor(Intl, "DateTimeFormat")!;
  Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: () => { throw Error("no current timezone interpretation"); } });
  try { assert.equal(parseCorrectionDelegationResponse(wire, q).mode, "detail"); } finally { Object.defineProperty(Intl, "DateTimeFormat", descriptor); }
  for (const patch of [{ blocked: true }, { canReject: false }, { lineage: {} }, { issues: ["raw_overlap"] }])
    assert.throws(() => parseCorrectionDelegationResponse({ ...wire, detail: { ...selected, ...patch } }, q));
  assert.throws(() => parseCorrectionDelegationResponse({ ...wire, detail: { ...selected, proposal: { ...selected.proposal, breaks: [{ startAt: selected.proposal.startAt, endAt: selected.proposal.startAt, paid: false }] } } }, q));
});
test("duplicate JSON, unsafe graph, sparse arrays, lone surrogates and body cap are rejected", () => {
  assert.throws(() => parseCorrectionDelegationJson('{"a":1,"a":2}'));
  assert.throws(() => parseCorrectionDelegationJson('"' + "x".repeat(8192) + '"', "request"));
  const q = query(), w = http(q); assert.throws(() => parseCorrectionDelegationResponse({ ...w, grants: new Array(1) }, q));
  assert.throws(() => parseCorrectionDelegationQuery({ ...q, siteId: "\ud800" }));
  assert.throws(() => parseCorrectionDelegationResponse(Object.defineProperty({ ...w }, "actorId", { get: () => { throw Error("getter"); } }), q));
});
test("grant usability is the SQL observation, not expiry recomputed from later readAt or cross-command wall clocks", () => {
  const q = query(), w = http(q); if (w.protocol !== "delegated-corrections-v1") throw Error("fixture");
  w.grants[0].validUntil = "2026-10-06T11:59:59.999999Z";
  assert.equal(parseCorrectionDelegationResponse(w, q).mode, "grants");
  const oq = query("owner", "detail"), owner = http(oq); if (owner.protocol !== "correction-delegations-v1" || !owner.detail) throw Error("fixture");
  owner.detail.revision = 2; owner.detail.status = "revoked"; owner.detail.usable = false;
  owner.detail.revocation = { operationId: id(31), actorId: id(1), reason: "Explicit revoke after clock adjustment", recordedAt: "2026-09-29T12:00:00.000000Z" };
  assert.equal(parseCorrectionDelegationResponse(owner, oq).mode, "detail");
  owner.detail.usable = true; assert.throws(() => parseCorrectionDelegationResponse(owner, oq));
});

test("correction is a distinct exact contract: explicit pending flag and real revision/evidence command", async () => {
  const g = grantCommand(), q = query("owner"); assert.equal(Object.keys(g).length, 12);
  for (const includePending of [null, 0, "false", undefined]) assert.throws(() => parseCorrectionDelegationBody({ query: q, command: { ...g, includePending } }));
  const { includePending, ...withoutFlag } = g; void includePending; assert.throws(() => parseCorrectionDelegationCommand(withoutFlag));
  assert.notEqual(await correctionDelegationCommandFingerprint(q.siteId, q.access, g), await correctionDelegationCommandFingerprint(q.siteId, q.access, { ...g, includePending: true }));
  const longGrant = { ...g, validUntil: "2099-12-31T23:59:59.999999Z" }; assert.deepEqual(parseCorrectionDelegationCommand(longGrant), longGrant);
  const c = command(), d = c.decision; assert.equal(d.expectedRevision, 3);
  const parsed = parseCorrectionDelegationCommand({ ...c, decision: { ...d, expectedRevision: 7, reason: "审".repeat(500) } });
  assert.ok("decision" in parsed); assert.equal(parsed.decision.expectedRevision, 7);
  for (const expectedRevision of [0, -1, 1.1, "3", Number.MAX_SAFE_INTEGER, null]) assert.throws(() => parseCorrectionDelegationCommand({ ...c, decision: { ...d, expectedRevision } }));
  const { expectedEvidence, ...oldDecision } = d; assert.throws(() => parseCorrectionDelegationCommand({ ...c, decision: { ...oldDecision, evidenceToken: expectedEvidence } }));
  assert.throws(() => parseCorrectionDelegationCommand({ ...c, decision: { ...d, reason: "x".repeat(501) } }));
  const dq = query("delegate", "detail"), w = http(dq); assert.throws(() => parseCorrectionDelegationResponse({ ...w, protocol: "delegated-missing-v1" }, dq));
});

test("all fixed tuple fields alter the digest, including pending history inclusion", async () => {
  const c = command(), expected = ['attendance-correction-delegation-v1', '99990001', 'delegate', c.decision.action, c.decision.operationId,
    c.grantId, 1, c.decision.requestId, c.decision.expectedRevision, c.decision.expectedEvidence, c.decision.reason];
  assert.equal(correctionDelegationFingerprintText("99990001", "delegate", c), `[${expected.map(v => JSON.stringify(v)).join(", ")}]`);
  const fingerprint = await correctionDelegationCommandFingerprint("99990001", "delegate", c);
  for (const decision of [{ ...c.decision, action: "reject" as const }, { ...c.decision, expectedRevision: 4 }, { ...c.decision, expectedEvidence: "b".repeat(32) },
    { ...c.decision, reason: "Different" }, { ...c.decision, requestId: id(90) }, { ...c.decision, operationId: id(91) }])
    assert.notEqual(await correctionDelegationCommandFingerprint("99990001", "delegate", { ...c, decision }), fingerprint);
});

test("complete original and proposal are independently validated; blocked rejection remains explicit", () => {
  const q = query("delegate", "detail"), w = http(q); if (w.protocol !== "delegated-corrections-v1" || !w.detail) throw Error("fixture");
  assert.equal(Object.keys(w.detail).length, 20); assert.equal(Object.keys(w.detail.original).length, 3);
  const blocked = { ...w, detail: { ...w.detail, blockers: ["scope_unavailable"], blocked: true, canApprove: false, canReject: true } };
  const parsed = parseCorrectionDelegationResponse(blocked, q); assert.equal(parsed.protocol, "delegated-corrections-v1");
  if (parsed.protocol !== "delegated-corrections-v1") throw Error("fixture"); assert.equal(parsed.detail?.canReject, true);
  for (const patch of [{ blockers: ["unknown"] }, { blockers: ["scope_unavailable", "scope_unavailable"] }, { blocked: false }, { canApprove: true },
    { blockers: ["self_review"], canReject: true }, { previous: { reason: "private" } }]) assert.throws(() => parseCorrectionDelegationResponse({ ...blocked, detail: { ...blocked.detail, ...patch } }, q));
  for (const original of [null, { ...w.detail.original, endAt: w.detail.original.startAt }, { ...w.detail.original, events: [] },
    { ...w.detail.original, startAt: "2026-02-30T01:00:00.000000Z" }]) assert.throws(() => parseCorrectionDelegationResponse({ ...w, detail: { ...w.detail, original } }, q));
  const { original, ...missingShape } = w.detail; void original; assert.throws(() => parseCorrectionDelegationResponse({ ...w, detail: missingShape }, q));
  const longProposal = { startAt: "2026-10-01T08:00:00.000000Z", endAt: "2026-10-03T10:00:00.000000Z", breaks: [] };
  assert.equal(parseCorrectionDelegationResponse({ ...w, detail: { ...w.detail, proposal: longProposal } }, q).mode, "detail");
});

test("owner catalogs and delegated request pages enforce 25-row ordering and exact continuation", () => {
  const oq = query("owner"), ow = http(oq); if (ow.protocol !== "correction-delegations-v1") throw Error("fixture");
  ow.items = Array.from({ length: 25 }, (_, i) => ({ ...ow.items[0], grantId: id(100 + i) })); ow.nextId = id(124);
  assert.equal(parseCorrectionDelegationResponse(ow, oq).mode, "list");
  assert.throws(() => parseCorrectionDelegationResponse({ ...ow, nextId: id(125) }, oq));
  assert.throws(() => parseCorrectionDelegationResponse({ ...ow, items: [...ow.items].reverse() }, oq));
  const dq = query("delegate", "list"), dw = http(dq); if (dw.protocol !== "delegated-corrections-v1") throw Error("fixture");
  dw.items = Array.from({ length: 25 }, (_, i) => ({ ...dw.items[0], requestId: id(200 - i) })); dw.nextCursor = { at: dw.items[24].submittedAt, id: id(176) };
  assert.equal(parseCorrectionDelegationResponse(dw, dq).mode, "list");
  assert.throws(() => parseCorrectionDelegationResponse({ ...dw, items: [...dw.items, dw.items[0]] }, dq));
  assert.throws(() => parseCorrectionDelegationResponse({ ...dw, nextCursor: { ...dw.nextCursor, id: id(177) } }, dq));
  assert.throws(() => parseCorrectionDelegationResponse({ ...http(query("delegate", "recover")), canWrite: true }, query("delegate", "recover")));
});
