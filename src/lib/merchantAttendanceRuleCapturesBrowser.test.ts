import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCompactRuleCaptureResponse, parseCaptureBrowserCommand, parseCaptureBrowserJson } from "./merchantAttendanceRuleCapturesBrowser";
import { ruleCapturesResult, ruleCapturesQuery as query, ruleCapturesCommand as command } from "../../scripts/fixtures/attendance-rule-captures-model";
import { ruleSourcesId, ruleSourcesOwner as actor } from "../../scripts/fixtures/attendance-rule-sources-model";

const wire = () => ({ ok: true, moduleEnabled: true, data: ruleCapturesResult() });
const decode = (raw: unknown) => parseCompactRuleCaptureResponse(raw, query, actor);
const editSource = (edit: (s: ReturnType<typeof JSON.parse>) => void) => {
  const raw = wire(), receipt = raw.data.receipt!, source = JSON.parse(receipt.sourceText); edit(source);
  receipt.sourceText = JSON.stringify(source); receipt.sourceBytes = Buffer.byteLength(receipt.sourceText);
  receipt.sourceSha256 = createHash("sha256").update(receipt.sourceText).digest("hex"); return raw;
};

test("WebCrypto verifies original UTF8 bytes and returns only a detached compact summary", async () => {
  const raw = wire(), result = await decode(raw), receipt = result.receipt!;
  assert.deepEqual(receipt.summary, { workerName: "Synthetic worker", workerNo: "QA-201", timeZone: "UTC", fromDate: command.fromDate,
    throughDate: command.throughDate, fromAt: "2026-09-29T00:00:00.000Z", toAt: "2026-10-02T00:00:00.000Z",
    assignmentCount: 1, ruleStreamCount: 2, publicationCount: 2, personalApprovalCount: 2, personalWithdrawalCount: 1 });
  assert(!Object.hasOwn(receipt, "sourceText")); assert(!JSON.stringify(result).includes("lateGraceMinutes"));
  assert.equal(receipt.sourceSha256, raw.data.receipt!.sourceSha256); assert.notEqual(receipt.command, raw.data.receipt!.command);
  raw.data.receipt!.command.reason = "mutated"; assert.equal(receipt.command.reason, command.reason);
  const unicode = editSource(s => { s.worker.workerName = "员工🙂"; }); assert.equal((await decode(unicode)).receipt!.summary.workerName, "员工🙂");
});

test("receipt metadata binds every identity, command, date and microsecond order", async () => {
  for (const change of [
    (r: ReturnType<typeof wire>) => { r.data.actorId = ruleSourcesId(1); },
    (r: ReturnType<typeof wire>) => { r.data.workerId = ruleSourcesId(1); },
    (r: ReturnType<typeof wire>) => { r.data.operationId = ruleSourcesId(1); },
    (r: ReturnType<typeof wire>) => { r.data.receipt!.command.employeeAuthUserId = ruleSourcesId(1); },
    (r: ReturnType<typeof wire>) => { r.data.receipt!.observedAt = "2026-10-04T12:00:00.000000Z"; },
    (r: ReturnType<typeof wire>) => { r.data.receipt!.recordedAt = "2026-10-04T12:00:00.000001Z"; },
    (r: ReturnType<typeof wire>) => { r.data.readAt = "2026-10-04T12:00:00.000002Z"; },
    (r: ReturnType<typeof wire>) => { r.data.receipt!.sourceReadAt = "2026-10-04T12:00:00.000000Z"; },
    (r: ReturnType<typeof wire>) => { Object.assign(r.data.receipt!, { applied: true }); },
  ]) { const r = wire(); change(r); await assert.rejects(decode(r)); }
  await assert.rejects(parseCompactRuleCaptureResponse(wire(), query, actor, { ...command, reason: "other" }));
  const missing = wire(); missing.data.receipt = null; assert.equal((await decode(missing)).receipt, null);
  await assert.rejects(parseCompactRuleCaptureResponse(missing, query, actor, command));
});

test("stored zones and UTC boundaries are not replayed with current Intl", async () => {
  const raw = editSource(s => { s.timeZone = "Retired/Archive"; s.fromAt = "2026-09-28T22:17:00.000Z"; });
  const original = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = function () { throw Error("must not run Intl"); } as unknown as typeof Intl.DateTimeFormat;
    assert.equal((await decode(raw)).receipt!.summary.fromAt, "2026-09-28T22:17:00.000Z");
  } finally { Intl.DateTimeFormat = original; }
});

test("altered hash/bytes, extra envelope fields and truncated source sections fail closed", async () => {
  const hash = wire(); hash.data.receipt!.sourceSha256 = "0".repeat(64); await assert.rejects(decode(hash));
  const bytes = wire(); bytes.data.receipt!.sourceBytes++; await assert.rejects(decode(bytes));
  await assert.rejects(decode({ ...wire(), raw: true }));
  for (const key of ["assignments", "rules", "personal"]) await assert.rejects(decode(editSource(s => { s[key].limited = true; s[key].items = []; })));
  await assert.rejects(decode(editSource(s => { s.worker.employeeId = ruleSourcesId(8); })));
  await assert.rejects(decode(editSource(s => { s.worker.extra = true; })));
});

test("safe JSON rejects duplicate decoded keys, accessors, dangerous keys and bad surrogate data", async () => {
  assert.throws(() => parseCaptureBrowserJson('{"a":1,"\\u0061":2}'));
  assert.throws(() => parseCaptureBrowserJson('{"__proto__":{}}'));
  assert.throws(() => parseCaptureBrowserJson('{"value":"\\ud800"}'));
  let invoked = 0; const raw = wire(); Object.defineProperty(raw, "data", { enumerable: true, get() { invoked++; return {}; } });
  await assert.rejects(decode(raw)); assert.equal(invoked, 0);
  assert.throws(() => parseCaptureBrowserCommand({ ...command, source: {} }));
});

test("one MiB source limit is inclusive and no source buffer is exposed", async () => {
  const raw = wire(), r = raw.data.receipt!, text = r.sourceText + " ".repeat(1048576 - r.sourceBytes);
  r.sourceText = text; r.sourceBytes = 1048576; r.sourceSha256 = createHash("sha256").update(text).digest("hex");
  assert.equal((await decode(raw)).receipt!.sourceBytes, 1048576);
  r.sourceText += " "; r.sourceBytes++; r.sourceSha256 = createHash("sha256").update(r.sourceText).digest("hex"); await assert.rejects(decode(raw));
});

test("browser modules have only type imports from Node archival protocol and never import its server", () => {
  for (const name of ["merchantAttendanceRuleCapturesBrowser.ts", "merchantAttendanceRuleCapturesClient.ts"]) {
    const text = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(text, /^import (?!type)[^\n]*from ["']\.\/merchantAttendanceRuleCaptures(?:\.server)?["']/m);
    assert.doesNotMatch(text, /from ["']node:|from ["'][^"']*ThreeLayerRules|localStorage/);
  }
});
