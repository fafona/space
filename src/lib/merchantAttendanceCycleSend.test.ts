import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { operationalRuleLedgerEncode } from "./merchantAttendanceOperationalRuleLedger";
import { cycleSendCommandFingerprint, cycleSendIntent, cycleSendPeriodQuery, cycleSendQueryString, parseCycleSendBody,
  parseCycleSendBodyJson, parseCycleSendCommand, parseCycleSendFrame, parseCycleSendHttpQuery, parseCycleSendQuery,
  type CycleSendFrame, type CycleSendCommand, type CycleSendQuery } from "./merchantAttendanceCycleSend";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const frame: CycleSendFrame = { siteId: "99990200", access: "owner", workerId: id(1), grantId: null,
  fromDate: "2026-10-05", throughDate: "2026-10-11", periodId: id(2), intentId: id(3), expectedIntentFingerprint: "a".repeat(64) };
const command: CycleSendCommand = { action: "send", operationId: id(4), periodId: frame.periodId, expectedRevision: 0,
  expectedVersion: 0, expectedFingerprint: "b".repeat(64), reason: "明确首次送审" };
const preview: CycleSendQuery = { ...frame, mode: "preview", operationId: null, commandFingerprint: null };

test("200 cycle first-send frame uses exact existing owner/delegate contracts, never self", () => {
  assert.deepEqual(parseCycleSendFrame(frame), frame); assert(Object.isFrozen(parseCycleSendFrame(frame)));
  const owner = cycleSendPeriodQuery(frame); assert.equal(owner.access, "owner"); assert.equal(owner.mode, "detail"); assert(!Object.hasOwn(owner, "grantId"));
  const delegate = { ...frame, access: "delegate" as const, grantId: id(5) }, q = cycleSendPeriodQuery(delegate);
  assert.equal(q.access, "delegate"); assert("grantId" in q && q.grantId === id(5));
  assert.deepEqual(cycleSendIntent(frame), { intentId: frame.intentId, expectedIntentFingerprint: frame.expectedIntentFingerprint });
  for (const f of [{ ...frame, access: "self" }, { ...frame, grantId: id(5) }, { ...frame, access: "delegate" },
    { ...frame, throughDate: "2026-11-05" }, { ...frame, fromDate: "2026-02-30" }, { ...frame, periodId: null },
    { ...frame, actorId: id(9) }, { ...frame, expectedIntentFingerprint: "A".repeat(64) }]) assert.throws(() => parseCycleSendFrame(f));
});
test("200 only a first send can adopt an intent; no resend, employee confirmation or mixed operation", () => {
  assert.deepEqual(parseCycleSendBody({ frame, command }), { frame, command }); assert(Object.isFrozen(parseCycleSendCommand(command, frame)));
  assert.equal(parseCycleSendCommand({ ...command, reason: "" }, frame).reason, "");
  for (const c of [{ ...command, action: "confirm" }, { ...command, expectedRevision: 1 }, { ...command, expectedVersion: 1 },
    { ...command, operationId: frame.intentId }, { ...command, expectedFingerprint: null }, { ...command, periodId: id(7) },
    { ...command, expectedRevision: -0 }, { ...command, reason: "\ud800" }, { ...command, reason: "a\u0085b" }, { ...command, reason: "x".repeat(501) }]) assert.throws(() => parseCycleSendCommand(c, frame));
});
test("200 explicit recovery carries only original identity/frame/intent and send digest, never the reason", () => {
  for (const q of [preview, { ...frame, mode: "recover", operationId: id(4), commandFingerprint: "c".repeat(64) },
    { ...preview, access: "delegate", grantId: id(5) }] as CycleSendQuery[]) {
    const url = "https://www.faolla.com/?" + cycleSendQueryString(q); assert.deepEqual(parseCycleSendHttpQuery(url), q);
    assert(!url.includes("reason")); assert(Object.isFrozen(parseCycleSendQuery(q)));
  }
  for (const q of [{ ...preview, mode: "send" }, { ...preview, operationId: id(4) }, { ...preview, commandFingerprint: "c".repeat(64) },
    { ...preview, mode: "recover", operationId: id(4) }, { ...preview, mode: "recover", operationId: frame.intentId, commandFingerprint: "c".repeat(64) }]) assert.throws(() => parseCycleSendQuery(q));
});
test("200 strict transport rejects duplicated/escaped keys, unknown fields, URL fragments and byte overflow", () => {
  const json = JSON.stringify({ frame, command }); assert.deepEqual(parseCycleSendBodyJson(json), { frame, command });
  for (const s of [json.replace('"frame":', '"frame":{},"frame":'), json.replace('"action":', '"\\u0061ction":"seal","action":'),
    json.replace('明确首次送审', '\\ud800'), "中".repeat(3000)]) assert.throws(() => parseCycleSendBodyJson(s));
  const url = "https://www.faolla.com/?" + cycleSendQueryString(preview);
  for (const s of [url + "#", url + "#x", url + "&siteId=99990200", url + "&reason=secret", url + "&workerId=" + "x".repeat(2100)]) assert.throws(() => parseCycleSendHttpQuery(s));
});
test("200 canonical send SHA equals SQL tuple shape and binds actor, grant, frame, source, reason and intent", async () => {
  const expected = createHash("sha256").update(operationalRuleLedgerEncode(["attendance-cycle-send-v1", id(9),
    [frame.siteId, "owner", frame.workerId, null, frame.fromDate, frame.throughDate, "detail", frame.periodId, null, null, null],
    ["send", command.operationId, frame.periodId, 0, 0, command.expectedFingerprint, command.reason], [frame.intentId, frame.expectedIntentFingerprint]])).digest("hex");
  assert.equal(await cycleSendCommandFingerprint(frame, command, id(9)), expected);
  assert.notEqual(await cycleSendCommandFingerprint(frame, command, id(10)), expected);
  for (const f of [{ ...frame, access: "delegate" as const, grantId: id(5) }, { ...frame, throughDate: "2026-10-12" },
    { ...frame, intentId: id(6) }, { ...frame, expectedIntentFingerprint: "d".repeat(64) }]) assert.notEqual(await cycleSendCommandFingerprint(f, command, id(9)), expected);
  for (const c of [{ ...command, reason: "另一个原因" }, { ...command, expectedFingerprint: "e".repeat(64) },
    { ...command, operationId: id(7) }]) assert.notEqual(await cycleSendCommandFingerprint(frame, c, id(9)), expected);
});
test("200 getters never run and complete inputs are owned before digest yields", async t => {
  let reads = 0; assert.throws(() => parseCycleSendBody({ frame, get command() { reads++; return command; } }));
  assert.throws(() => parseCycleSendFrame({ ...frame, get fromDate() { reads++; return "2026-10-05"; } })); assert.equal(reads, 0);
  const f = { ...frame }, c = { ...command }, expected = await cycleSendCommandFingerprint(f, c, id(9)), digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { f.workerId = id(8); c.reason = "later mutation"; return digest(...args); });
  assert.equal(await cycleSendCommandFingerprint(f, c, id(9)), expected);
});
