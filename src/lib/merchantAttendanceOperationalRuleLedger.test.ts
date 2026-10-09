import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as p from "./merchantAttendanceOperationalRuleLedger";
import * as f from "./merchantAttendanceOperationalRuleLedgerTestFixtures";
const id = f.operationalRuleLedgerId, actor = f.operationalRuleLedgerActor, siteId = f.operationalRuleLedgerSite;
test("240 exact scopes and seven query variants round-trip HTTP including explicit null", () => {
  for (const kind of ["enterprise", "group", "personal"] as const) { const scope = f.operationalRuleLedgerScope(kind), q = f.operationalRuleLedgerQuery(scope);
    for (const query of [q, { ...q, mode: "history", cursor: null }, { ...q, mode: "preview", sourceDraftRevision: 1, effectiveOn: "2026-10-09", endsOn: kind === "personal" ? "2026-10-10" : null }, { siteId, mode: "recover", operationId: id(20) },
      { siteId, mode: "catalog", catalog: "workers", afterId: null }, { siteId, mode: "catalog", catalog: "routes", afterId: id(2) }, { siteId, mode: "catalog", catalog: "saved_personal", afterScope: null }]) {
      const valid = p.parseOperationalRuleLedgerQuery(query); assert.deepEqual(p.parseOperationalRuleLedgerHttpQuery("https://synthetic.invalid/?" + p.operationalRuleLedgerQueryString(valid)), valid); }
  }
  const q = f.operationalRuleLedgerQuery(); for (const bad of [{ ...q, actorId: actor }, { ...q, siteId: siteId + "\n" }, { ...q, scope: { kind: "group", groupId: id(2) + "\n" } }]) assert.throws(() => p.parseOperationalRuleLedgerQuery(bad));
  assert.throws(() => p.parseOperationalRuleLedgerHttpQuery("https://x.invalid/?" + p.operationalRuleLedgerQueryString(q) + "&siteId=" + siteId));
  assert.throws(() => p.parseOperationalRuleLedgerHttpQuery("https://x.invalid/?scope=%ff"));
});
test("240 all command shapes, complete body scope and reason retain exact intent", () => {
  const c = f.operationalRuleLedgerSaveCommand(), q = f.operationalRuleLedgerQuery(); assert.deepEqual(p.parseOperationalRuleLedgerBody({ query: q, command: c }).command, c);
  for (const change of [{ reason: " changed " }, { reason: "\u0000" }, { reason: "x\ud800" }, { reason: "a".repeat(201) }, { expectedRevision: p.OPERATIONAL_RULE_LEDGER_MAX_REVISION }, { actorId: actor }, { scope: f.operationalRuleLedgerScope("group") }]) assert.throws(() => p.parseOperationalRuleLedgerBody({ query: q, command: { ...c, ...change } }));
  assert.throws(() => p.parseOperationalRuleLedgerCommand({ ...c, action: "publish" })); assert.throws(() => p.parseOperationalRuleLedgerCommand({ ...c, rules: { ...c.rules, protocol: "fake" } }));
});
test("240 strict JSON rejects duplicate/escaped keys, unsafe trees, getters and UTF8 size", () => {
  for (const raw of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"x":"\\ud800"}', '{"x":"\\u0000"}']) assert.throws(() => p.parseOperationalRuleLedgerJson(raw));
  let accessed = false; const q = { ...f.operationalRuleLedgerQuery(), get extra() { accessed = true; return 1; } }; assert.throws(() => p.parseOperationalRuleLedgerQuery(q)); assert.equal(accessed, false);
  assert.throws(() => p.parseOperationalRuleLedgerJson(JSON.stringify("中".repeat(14000)), "request"));
  assert.throws(() => p.parseOperationalRuleLedgerQuery({ ...f.operationalRuleLedgerQuery(), extra: new Date() }));
});
test("240 recursive scalar tuples agree with Node UTF8 SHA and exclude object encoding", async () => {
  const c = f.operationalRuleLedgerSaveCommand(), text = p.operationalRuleLedgerCommandFingerprintText(c, actor);
  assert.ok(text.startsWith('["attendance-operational-rule-command-v1", "')); assert.ok(text.includes('"合成配置 核对😀"'));
  assert.equal(await p.operationalRuleLedgerCommandFingerprint(c, actor), createHash("sha256").update(text, "utf8").digest("hex"));
  assert.equal(await p.operationalRuleLedgerCommandFingerprint(c, actor), "c6de021f01618b9fd99b640c48c636bdad819dd923c21c3a376acc34f9f62095");
  assert.equal(p.operationalRuleLedgerEncode([null, true, 9007199254740990, "中文\"\\", [false, 0]]), '[null, true, 9007199254740990, "中文\\\"\\\\", [false, 0]]');
  assert.throws(() => p.operationalRuleLedgerEncode({ x: 1 } as never)); assert.notEqual(await p.operationalRuleLedgerCommandFingerprint(c, actor), await p.operationalRuleLedgerCommandFingerprint(c, id(99)));
});
test("240 detail hashes every saved item and refuses context/identity/rule mutations", async () => {
  for (const kind of ["enterprise", "group", "personal"] as const) { const q = f.operationalRuleLedgerQuery(f.operationalRuleLedgerScope(kind)), r = await f.operationalRuleLedgerDetail(q.scope, true, true);
    assert.deepEqual(await p.parseOperationalRuleLedgerResult(r, q, actor), r); const wrong = structuredClone(r); if (wrong.data.kind === "detail" && wrong.data.draft) (wrong.data.draft as { reason: string }).reason = "changed";
    await assert.rejects(p.parseOperationalRuleLedgerResult(wrong, q, actor)); await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, actorId: id(99) }, q, actor)); }
});
test("240 preview verifies UTC6 civil day boundaries and fingerprint, personal must end", async () => {
  for (const kind of ["enterprise", "personal"] as const) { const scope = f.operationalRuleLedgerScope(kind), d = await f.operationalRuleLedgerPreview(scope), q: p.OperationalRuleLedgerQuery = { siteId, mode: "preview", scope, sourceDraftRevision: 1, effectiveOn: d.effectiveOn, endsOn: d.endsOn }, r = f.operationalRuleLedgerResult(d);
    assert.deepEqual(await p.parseOperationalRuleLedgerResult(r, q, actor), r); await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, data: { ...d, effectiveAt: "2026-10-09T01:00:00.000000Z" } }, q, actor)); }
  assert.throws(() => p.parseOperationalRuleLedgerQuery({ siteId, mode: "preview", scope: f.operationalRuleLedgerScope("personal"), sourceDraftRevision: 1, effectiveOn: "2026-02-30", endsOn: null }));
});
test("240 history pages are continuous, bounded and snapshot scoped, not false-complete", async () => {
  const scope = f.operationalRuleLedgerScope(), q: p.OperationalRuleLedgerQuery = { siteId, mode: "history", scope, cursor: null }, items = await Promise.all(Array.from({ length: 25 }, async (_, i) => ({ item: await f.operationalRuleLedgerDraft(scope, 26 - i), withdrawnByRevision: null })));
  assert.throws(() => p.parseOperationalRuleLedgerQuery({ ...q, cursor: { siteId, scope, atRevision: 26, beforeRevision: 1 } }));
  const r = f.operationalRuleLedgerResult({ kind: "history", scope, atRevision: 26, items, nextCursor: { siteId, scope, atRevision: 26, beforeRevision: 2 } }, false);
  assert.deepEqual(await p.parseOperationalRuleLedgerResult(r, q, actor), r); if (r.data.kind !== "history") throw Error();
  for (const d of [{ ...r.data, nextCursor: null }, { ...r.data, items: items.slice(1) }, { ...r.data, items: [] }]) await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, data: d }, q, actor));
  const next = { ...q, cursor: r.data.nextCursor }, last = f.operationalRuleLedgerResult({ kind: "history", scope, atRevision: 26, items: [{ item: await f.operationalRuleLedgerDraft(scope, 1), withdrawnByRevision: null }], nextCursor: null }, false);
  assert.deepEqual(await p.parseOperationalRuleLedgerResult(last, next, actor), last);
});
test("240 catalog identity/cursor does not confer write authority or invent names", async () => {
  const q: p.OperationalRuleLedgerQuery = { siteId, mode: "catalog", catalog: "workers", afterId: null }, data: p.OperationalRuleLedgerData = { kind: "catalog", catalog: "workers", items: [{ workerId: id(3), workerName: " 合成员工 ", employeeId: id(4), employeeAuthUserId: id(5) }], nextId: null }, r = f.operationalRuleLedgerResult(data, false);
  assert.deepEqual(await p.parseOperationalRuleLedgerResult(r, q, actor), r); await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, canWrite: true }, q, actor));
  await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, data: { ...data, nextId: id(3) } }, q, actor));
});
test("240 receipt-only responses bind actor, scope, full command fingerprint and original revision", async () => {
  const c = f.operationalRuleLedgerSaveCommand(), q = f.operationalRuleLedgerQuery(), r = await f.operationalRuleLedgerReceiptResult(c);
  assert.deepEqual(await p.parseOperationalRuleLedgerResult(r, q, actor, c), r); await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, canWrite: true }, q, actor, c));
  await assert.rejects(p.parseOperationalRuleLedgerResult(r, q, actor, { ...c, reason: "other" }));
  const recover: p.OperationalRuleLedgerQuery = { siteId, mode: "recover", operationId: c.operationId }; assert.deepEqual(await p.parseOperationalRuleLedgerResult(r, recover, actor), r);
  assert.equal((await p.parseOperationalRuleLedgerResult({ ...r, receipt: null }, recover, actor)).receipt, null);
  await assert.rejects(p.parseOperationalRuleLedgerResult({ ...r, receipt: { ...r.receipt!, rules: c.rules } }, recover, actor));
});
test("240 exact error allowlist never passes SQL text through", async () => {
  for (const code of Object.keys(p.OPERATIONAL_RULE_LEDGER_ERRORS) as p.OperationalRuleLedgerErrorCode[]) assert.deepEqual(await p.parseOperationalRuleLedgerResponse({ ok: false, error: { code, message: p.OPERATIONAL_RULE_LEDGER_MESSAGES[code] } }, f.operationalRuleLedgerQuery(), actor), { ok: false, error: { code, message: p.OPERATIONAL_RULE_LEDGER_MESSAGES[code] } });
  await assert.rejects(p.parseOperationalRuleLedgerResponse({ ok: false, error: { code: "attendance_access_denied", message: "private SQL" } }, f.operationalRuleLedgerQuery(), actor));
});
test("240 direct scope entry never invokes getters", () => {
  let read = 0; const scope = { get kind() { read++; return "enterprise"; } }; assert.throws(() => p.parseOperationalRuleLedgerScope(scope)); assert.equal(read, 0);
});
test("240 correctly hashed preview still rejects nonfuture day and inactive references", async () => {
  const scope = f.operationalRuleLedgerScope("group"), original = await f.operationalRuleLedgerPreview(scope);
  for (const variant of ["expired", "inactive"] as const) { const d = structuredClone(original) as { -readonly [K in keyof typeof original]: typeof original[K] };
    if (variant === "inactive") d.references = { ...d.references, subject: { groupActive: false } };
    else { d.effectiveOn = "2026-10-08"; d.effectiveAt = "2026-10-08T00:00:00.000000Z"; }
    d.referenceFingerprint = await p.operationalRuleLedgerReferenceFingerprint(siteId, scope, d.context, d.references); d.previewFingerprint = await p.operationalRuleLedgerPreviewFingerprint(siteId, d);
    const q: p.OperationalRuleLedgerQuery = { siteId, mode: "preview", scope, sourceDraftRevision: 1, effectiveOn: d.effectiveOn, endsOn: null };
    await assert.rejects(p.parseOperationalRuleLedgerResult(f.operationalRuleLedgerResult(d), q, actor)); }
});
test("240 publication rejects inactive subject even with self-consistent hashes; draft may record it", async () => {
  const scope = f.operationalRuleLedgerScope("group"), pub = structuredClone(await f.operationalRuleLedgerPublication(scope)) as { -readonly [K in keyof p.OperationalRuleLedgerPublishItem]: p.OperationalRuleLedgerPublishItem[K] };
  pub.references = { ...pub.references, subject: { groupActive: false } }; pub.referenceFingerprint = await p.operationalRuleLedgerReferenceFingerprint(siteId, scope, pub.context, pub.references);
  pub.previewFingerprint = await p.operationalRuleLedgerPreviewFingerprint(siteId, { ...pub, revision: pub.revision - 1 }); pub.commandFingerprint = await p.operationalRuleLedgerCommandFingerprint({ siteId, scope, action: "publish", operationId: pub.operationId, expectedRevision: pub.revision - 1, reason: pub.reason, sourceDraftRevision: pub.sourceDraftRevision, effectiveOn: pub.effectiveOn, endsOn: pub.endsOn, previewFingerprint: pub.previewFingerprint }, actor);
  const detail = await f.operationalRuleLedgerDetail(scope, false, true); if (detail.data.kind !== "detail") throw Error(); await assert.rejects(p.parseOperationalRuleLedgerResult({ ...detail, data: { ...detail.data, nextPublication: pub } }, f.operationalRuleLedgerQuery(scope), actor));
  const draft = structuredClone(await f.operationalRuleLedgerDraft(scope)) as { -readonly [K in keyof p.OperationalRuleLedgerSaveDraftItem]: p.OperationalRuleLedgerSaveDraftItem[K] }; draft.references = pub.references; draft.referenceFingerprint = pub.referenceFingerprint;
  const draftResult = { ...detail, data: { ...detail.data, revision: 1, draft, nextPublication: null, canWithdraw: false } }; await p.parseOperationalRuleLedgerResult(draftResult, f.operationalRuleLedgerQuery(scope), actor);
});
