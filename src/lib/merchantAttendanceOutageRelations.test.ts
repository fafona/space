import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { OUTAGE_RELATIONS_ERRORS, assertOutageRelationsWriteQuery, outageRelationsCommandFingerprintText, parseOutageRelationsCommand,
  parseOutageRelationsQuery, parseOutageRelationsResult } from "./merchantAttendanceOutageRelations";
import { executeOutageRelations, outageRelationsCommandFingerprint, outageRelationsSiteEnabled, projectOutageRelationsResult } from "./merchantAttendanceOutageRelations.server";
import type { OutageRelationsResult } from "./merchantAttendanceOutageRelationsContract";
import { OUTAGE_RELATIONS_MODEL as m, outageRelationsModelId as id, outageRelationsModelQuery as query, outageRelationsModelEvidence as evidence,
  outageRelationsModelCommand as command, outageRelationsModelEntry as entry, outageRelationsModelSummary as summary,
  outageRelationsModelResult as result, outageRelationsModelSaved as saved } from "../../scripts/fixtures/attendance-outage-relations-model";

const invalid = { code: "attendance_outage_relations_invalid" }, requestInvalid = { code: "attendance_invalid_request" };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const sourceText = JSON.stringify(evidence()), fingerprint = hash(sourceText), c = command({ expectedFingerprint: fingerprint });
function raw(value: OutageRelationsResult) {
  const source = <T extends { evidence: unknown; fingerprint: string | null }>(v: T | null) => v === null ? null :
    { ...v, fingerprint: v.evidence === null ? v.fingerprint : hash(JSON.stringify(v.evidence)), sourceText: v.evidence === null ? null : JSON.stringify(v.evidence) };
  return { ...value, current: source(value.current), preview: source(value.preview),
    receipt: value.receipt === null ? null : { ...value.receipt, entry: source(value.receipt.entry) } };
}
function bad(value: OutageRelationsResult, mutate: (v: Record<string, unknown>) => void) {
  const clone = structuredClone(value) as unknown as Record<string, unknown>; mutate(clone);
  assert.throws(() => parseOutageRelationsResult(clone, query(), m.owner), invalid);
}

test("queries are exact, direction-preserving and owner-only recovery/writes", () => {
  for (const access of ["owner", "self"] as const) {
    const q = query(access);
    assert.deepEqual(parseOutageRelationsQuery(q), q);
    assert.deepEqual(parseOutageRelationsQuery({ ...q, mode: "history", beforeRevision: 101 }), { ...q, mode: "history", beforeRevision: 101 });
    const list = { siteId: m.siteId, access, declarationId: m.declaration, mode: "list" };
    assert.deepEqual(parseOutageRelationsQuery(list), list);
  }
  for (const q of [{ ...query(), relatedDeclarationId: m.declaration }, { ...query(), actorId: m.owner },
    { ...query(), mode: ["detail"] }, { ...query(), mode: "history", beforeRevision: "1" },
    { ...query("self"), mode: "recover", operationId: m.operation }, { ...query(), mode: "history", beforeRevision: 102 }]) {
    assert.throws(() => parseOutageRelationsQuery(q), requestInvalid);
  }
  assert.throws(() => assertOutageRelationsWriteQuery(query("self")), requestInvalid);
  assert.throws(() => assertOutageRelationsWriteQuery({ ...query(), mode: "history", beforeRevision: null }), requestInvalid);
});
test("commands enforce exact enum/scalars and reserved final revoke revision", () => {
  assert.equal(parseOutageRelationsCommand(command({ expectedRevision: 98 })).expectedRevision, 98);
  const revoke = { action: "revoke", operationId: id(31), expectedRevision: 99, expectedFingerprint: m.fingerprint, reason: "撤销说明" };
  assert.deepEqual(parseOutageRelationsCommand(revoke), revoke);
  for (const value of [command({ expectedRevision: 99 }), { ...command(), kind: ["possible_duplicate"] },
    { ...command(), action: ["apply"] }, { ...command(), expectedRevision: -0 }, { ...command(), reason: "😀".repeat(1001) },
    { ...revoke, expectedRevision: 0 }, { ...revoke, kind: "complementary" }, { ...command(), resolved: true }]) {
    assert.throws(() => parseOutageRelationsCommand(value), requestInvalid);
  }
});
test("fingerprint is fixed ten-scalar tuple; reversing pair or kind changes intent", () => {
  const q = query(), text = outageRelationsCommandFingerprintText(q, c);
  assert.deepEqual(JSON.parse(text), [m.siteId, "owner", m.declaration, m.related, "apply", m.operation, 0, fingerprint, "possible_duplicate", c.reason]);
  assert.equal(outageRelationsCommandFingerprint(q, c), hash(text));
  assert.notEqual(outageRelationsCommandFingerprint({ ...q, declarationId: m.related, relatedDeclarationId: m.declaration }, c), hash(text));
  assert.notEqual(outageRelationsCommandFingerprint(q, { ...c, kind: "complementary" }), hash(text));
});
test("detail preserves current saved evidence and separately changed current versions", () => {
  const r = result(query(), entry()); r.preview!.evidence!.workerVersion++;
  const parsed = parseOutageRelationsResult(r, query(), m.owner);
  assert.equal(parsed.current!.evidence!.workerVersion, 2); assert.equal(parsed.preview!.evidence!.workerVersion, 3);
  assert.ok(Object.isFrozen(parsed.current!.evidence!.declarations));
  r.preview!.evidence!.declarations[0].fingerprint = "d".repeat(64);
  assert.throws(() => parseOutageRelationsResult(r, query(), m.owner), invalid);
});
test("owner safe revoke survives identity/settings blockers, self cannot claim write or other Auth", () => {
  const r = result(query(), entry()); r.preview = { evidence: null, fingerprint: null, eligible: false, blockers: ["identity_changed", "settings_disabled"] };
  assert.equal(parseOutageRelationsResult(r, query(), m.owner).canWrite, true);
  const self = result(query("self"), entry());
  assert.equal(parseOutageRelationsResult(self, query("self"), m.auth).current!.actorId, m.owner);
  assert.throws(() => parseOutageRelationsResult({ ...self, canWrite: true }, query("self"), m.auth), invalid);
  assert.throws(() => parseOutageRelationsResult({ ...self, actorId: id(999) }, query("self"), id(999)), invalid);
});
test("malformed, cross-scope, contradictory preview or source trees fail closed", () => {
  const base = result(query(), entry());
  for (const mutate of [(v: Record<string, unknown>) => { v.actorId = id(999); }, (v: Record<string, unknown>) => { v.siteId = "99990000"; },
    (v: Record<string, unknown>) => { v.relatedDeclarationId = id(999); }, (v: Record<string, unknown>) => { v.current = { ...entry(), pair: [m.related, m.declaration] }; },
    (v: Record<string, unknown>) => { v.current = { ...entry(), kind: ["possible_duplicate"] }; },
    (v: Record<string, unknown>) => { v.current = { ...entry(), recordedAt: "2026-10-07T12:00:00.000001Z" }; },
    (v: Record<string, unknown>) => { v.preview = { ...base.preview, eligible: true, blockers: ["account_suspended"] }; },
    (v: Record<string, unknown>) => { v.preview = { ...base.preview, eligible: false, blockers: ["settings_disabled", "settings_disabled"] }; },
    (v: Record<string, unknown>) => { v.preview = { evidence: null, fingerprint: null, eligible: false, blockers: [] }; },
    (v: Record<string, unknown>) => { v.merged = true; }]) bad(base, mutate);
  let accessed = false;
  assert.throws(() => parseOutageRelationsResult(Object.defineProperty({}, "mode", { get() { accessed = true; return "detail"; }, enumerable: true }), query(), m.owner), invalid);
  assert.equal(accessed, false);
});
test("list returns all <=25 distinct sorted pairs including revoked heads, no fake pagination", () => {
  const q = { siteId: m.siteId, access: "owner" as const, declarationId: m.declaration, mode: "list" as const }, r = result(q);
  r.items = Array.from({ length: 25 }, (_, n) => ({ ...summary(entry()), pair: [m.declaration, id(100 + n)], operationId: id(200 + n) }));
  r.items[2] = { ...r.items[2], action: "revoke", revision: 2 };
  assert.equal(parseOutageRelationsResult(r, q, m.owner).items.length, 25);
  assert.throws(() => parseOutageRelationsResult({ ...r, items: [...r.items, r.items[0]] }, q, m.owner), invalid);
  assert.throws(() => parseOutageRelationsResult({ ...r, items: r.items.toReversed() }, q, m.owner), invalid);
});
test("history is contiguous <=25, exact cursor/truncation and retains revoked kind", () => {
  const q = { ...query(), mode: "history" as const, beforeRevision: null }, r = result(q); r.revision = 26;
  r.history = Array.from({ length: 25 }, (_, n) => ({ ...summary(entry()), revision: 26 - n, operationId: id(100 + n) })); r.historyTruncated = true;
  assert.equal(parseOutageRelationsResult(r, q, m.owner).history.length, 25);
  const last = { ...r, history: [{ ...summary(entry()), revision: 1 }], historyTruncated: false };
  assert.equal(parseOutageRelationsResult(last, { ...q, beforeRevision: 2 }, m.owner).history[0].revision, 1);
  for (const wrong of [{ ...r, historyTruncated: false }, { ...r, history: r.history.slice(1) },
    { ...r, history: [{ ...r.history[0], action: "revoke", kind: "complementary" }, ...r.history.slice(1)] }]) {
    assert.throws(() => parseOutageRelationsResult(wrong, q, m.owner), invalid);
  }
});
test("receipt-only replies bind actual actor, original operation and complete command fields", () => {
  const q = query(), s = saved(q, c, outageRelationsCommandFingerprint(q, c));
  assert.equal(parseOutageRelationsResult(s, q, m.owner, c).receipt!.entry.kind, "possible_duplicate");
  const recover = { ...q, mode: "recover" as const, operationId: c.operationId };
  assert.equal(parseOutageRelationsResult({ ...s, mode: "recover" }, recover, m.owner).receipt!.operationId, c.operationId);
  for (const badCommand of [{ ...c, reason: "另一个目的" }, { ...c, kind: "complementary" as const }, { ...c, expectedRevision: 1 }]) {
    assert.throws(() => parseOutageRelationsResult(s, q, m.owner, badCommand), invalid);
  }
  assert.throws(() => parseOutageRelationsResult({ ...s, canWrite: true }, q, m.owner, c), invalid);
  assert.throws(() => parseOutageRelationsResult({ ...s, actorId: id(9) }, q, id(9), c), invalid);
});
test("projector verifies exact canonical source SHA/tree and strips private sourceText", () => {
  const q = query(), r = raw(result(q, entry(c))), p = projectOutageRelationsResult(r, q, m.owner);
  assert.equal(p.current!.fingerprint, fingerprint); assert.equal(Object.hasOwn(p.current!, "sourceText"), false);
  assert.equal(Object.hasOwn(p.preview!, "sourceText"), false);
  for (const source of [sourceText + " ", sourceText.replace('"workerVersion":2', '"workerVersion":4'),
    sourceText.replace('"workerVersion":2', '"workerVersion":2,"workerVersion":2')]) {
    assert.throws(() => projectOutageRelationsResult({ ...r, preview: { ...r.preview, sourceText: source } }, q, m.owner), invalid);
  }
  assert.throws(() => projectOutageRelationsResult({ ...r, preview: { ...r.preview, sourceText: null } }, q, m.owner), invalid);
  const s = raw(saved(q, c, outageRelationsCommandFingerprint(q, c)));
  assert.equal(projectOutageRelationsResult(s, q, m.owner, c).receipt!.commandFingerprint, outageRelationsCommandFingerprint(q, c));
  assert.throws(() => projectOutageRelationsResult({ ...s, receipt: { ...s.receipt, commandFingerprint: "f".repeat(64) } }, q, m.owner, c), invalid);
});
test("default-off rollout is exact-site, not prefix or wildcard", () => {
  const good = { FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED: "1", FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS: `99990000, ${m.siteId}` };
  assert.equal(outageRelationsSiteEnabled(m.siteId, good), true);
  for (const env of [{}, { ...good, FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED: "true" },
    { ...good, FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS: "*" }, { ...good, FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS: `${m.siteId},` },
    { ...good, FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS: m.siteId + "0" }]) assert.equal(outageRelationsSiteEnabled(m.siteId, env), false);
});
test("service always forwards four exact args; closed flag preserves read and exact replay", async t => {
  const oldEnabled = process.env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED, oldSites = process.env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS;
  t.after(() => { for (const [key, value] of [["FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED", oldEnabled], ["FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS", oldSites]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  } });
  process.env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_SITE_IDS = m.siteId;
  for (const allow of [false, true]) for (const cmd of [null, c]) {
    const read = result(); read.canWrite = allow;
    await executeOutageRelations({ query: query(), authUserId: m.owner, command: cmd, moduleEnabled: allow }, { rpc: async (name, args) => {
      assert.equal(name, "faolla_attendance_outage_relations_v1");
      assert.deepEqual(args, { p_query: query(), p_auth_user_id: m.owner, p_command: cmd, p_allow_write: allow });
      return { data: raw(cmd ? saved(query(), cmd, outageRelationsCommandFingerprint(query(), cmd)) : read), error: null };
    } });
  }
  process.env.FAOLLA_ATTENDANCE_OUTAGE_RELATIONS_ENABLED = "0";
  await executeOutageRelations({ query: query(), authUserId: m.owner, command: c, moduleEnabled: true }, { rpc: async (_name, args) => {
    assert.equal(args.p_allow_write, false); return { data: raw(saved(query(), c, outageRelationsCommandFingerprint(query(), c))), error: null };
  } });
});
test("service fails closed on missing backend, unexpected errors and self mutation before RPC", async () => {
  await assert.rejects(() => executeOutageRelations({ query: query(), authUserId: m.owner }, null), { code: "attendance_unavailable" });
  for (const [code, status] of Object.entries(OUTAGE_RELATIONS_ERRORS).filter(([code]) => code.startsWith("attendance_outage_relations_"))) {
    assert.ok([403, 404, 409, 422, 503].includes(status));
    await assert.rejects(() => executeOutageRelations({ query: query(), authUserId: m.owner }, { rpc: async () => ({ data: null, error: { message: code } }) }), { code });
  }
  await assert.rejects(() => executeOutageRelations({ query: query(), authUserId: m.owner }, { rpc: async () => ({ data: null, error: { message: "private schema detail" } }) }), { code: "attendance_unavailable" });
  let calls = 0;
  await assert.rejects(() => executeOutageRelations({ query: query("self"), command: c, authUserId: m.auth }, { rpc: async () => { calls++; throw Error(); } }), requestInvalid);
  assert.equal(calls, 0);
});
