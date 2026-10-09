import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { RETENTION_API, RETENTION_CATEGORIES, parseRetentionBody, parseRetentionCommand, parseRetentionHttpQuery, parseRetentionQuery,
  parseRetentionResponse, parseRetentionResult, retentionCommandFingerprintText, retentionQueryString, retentionReceiptMatches, retentionWriteQuery } from "./merchantAttendanceRetention";
import { executeRetention, projectRetentionResult, retentionCommandFingerprint, retentionSiteEnabled } from "./merchantAttendanceRetention.server";
import type { RetentionCommand, RetentionEventSource, RetentionPolicy, RetentionQuery, RetentionReceipt, RetentionRecord, RetentionResult } from "./merchantAttendanceRetentionContract";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990227", owner = id(1), at = "2026-10-07T12:00:00.000001Z", before = "2026-10-06T12:00:00.000001Z";
const q: RetentionQuery = { siteId, mode: "record", category: "events", recordId: id(2) };
const p = (): RetentionPolicy => ({ category: "events", revision: 0, retentionDays: null, operationId: null, recordedAt: null });
const event = (): RetentionEventSource => ({ kind: "event", eventId: id(2), workerId: id(3), locationId: id(4), operationId: id(5), sequence: 2,
  action: "clock_out", rawSource: "web", breakPaid: null, occurredAt: before, receivedAt: before, timeZone: "Europe/Madrid", actorEmployeeId: null });
function record(): RetentionRecord { return { category: "events", recordId: id(2), source: event(), sourceFingerprint: "a".repeat(64), policy: p(),
  anchorAt: before, asOf: at, dueAt: null, ageState: "unconfigured", preservation: { revision: 0, held: false, operationId: null, actorId: null, reason: null, recordedAt: null } }; }
function result(): RetentionResult { return { protocol: "attendance-retention-v1", siteId, actorId: owner, readAt: at, canWrite: true,
  data: { kind: "record", item: record() }, receipt: null, disposition: "preview_only" }; }
const command = (patch: Partial<RetentionCommand> = {}): RetentionCommand => ({ siteId, action: "hold", operationId: id(10), category: "events", recordId: id(2),
  expectedRevision: 0, expectedSourceFingerprint: "a".repeat(64), reason: "明确保全；不删除", ...patch } as RetentionCommand);
const saved = (c = command()): RetentionReceipt => ({ operationId: c.operationId, actorId: owner, revision: c.expectedRevision + 1, command: c, commandFingerprint: retentionCommandFingerprint(c), recordedAt: at });
const savedResult = (c = command()): RetentionResult => ({ ...result(), canWrite: false, data: { kind: "receipt" }, receipt: saved(c) });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function rawRecord(r = record()) { const sourceText = JSON.stringify({ siteId, category: r.category, recordId: r.recordId, source: r.source }); return { ...r, sourceText, sourceFingerprint: sha(sourceText) }; }

test("strict query union roundtrips omitted nullable history fields without global ten-key shape", () => {
  const queries: RetentionQuery[] = [{ siteId, mode: "policies" }, q, { siteId, mode: "recover", operationId: id(10) },
    { siteId, mode: "history", category: "events", recordId: null, beforeRevision: null },
    { siteId, mode: "history", category: "events", recordId: id(2), beforeRevision: 3 },
    { siteId, mode: "preview", category: "events", workerId: id(3), fromAt: before, toAt: at },
    { siteId, mode: "preview", category: "period_artifact", workerId: id(3), periodId: id(6) }];
  for (const value of queries) assert.deepEqual(parseRetentionHttpQuery("https://www.faolla.com" + RETENTION_API + "?" + retentionQueryString(value)), value);
});
test("query rejects mixed scopes, extra authority, duplicate URL keys, noncanonical cursor and invalid range", () => {
  for (const value of [{ ...q, actorId: owner }, { siteId, mode: "recover", operationId: id(10), recordId: id(2) },
    { siteId, mode: "preview", category: "events", workerId: id(3), fromAt: at, toAt: before },
    { siteId, mode: "preview", category: "events", workerId: id(3), fromAt: "2026-01-01T00:00:00.000000Z", toAt: at }]) assert.throws(() => parseRetentionQuery(value));
  for (const suffix of ["&siteId=" + siteId, "&access=owner", "&recordId=null", "#private"]) assert.throws(() => parseRetentionHttpQuery("https://www.faolla.com" + RETENTION_API + "?" + retentionQueryString(q) + suffix));
  assert.throws(() => parseRetentionHttpQuery("https://www.faolla.com" + RETENTION_API + "?siteId=" + siteId + "&mode=history&category=events&beforeRevision=01"));
});
test("policy days are null or bounded positive integer, never default0 or old draft inherited", () => {
  const c = { siteId, action: "set_policy", operationId: id(10), category: "events", expectedRevision: 0, reason: "明确设置", retentionDays: null };
  for (const days of [null, 1, 36500]) assert.equal((parseRetentionCommand({ ...c, retentionDays: days }) as typeof c).retentionDays, days);
  for (const days of [0, -0, -1, 36501, 1.5, "30", undefined]) assert.throws(() => parseRetentionCommand({ ...c, retentionDays: days }));
  assert.deepEqual(retentionWriteQuery(parseRetentionCommand(c)), { siteId, mode: "policies" });
});
test("command exact structure, safe revisions and reason encoding fail closed", () => {
  assert.deepEqual(parseRetentionBody({ query: q, command: command() }), { query: q, command: command() });
  for (const c of [{ ...command(), action: "release" }, { ...command(), expectedRevision: 9007199254740990 }, { ...command(), reason: " x" },
    { ...command(), reason: "x\u0000" }, { ...command(), reason: "\ud800" }, { ...command(), canDelete: true }]) assert.throws(() => parseRetentionCommand(c));
  assert.throws(() => parseRetentionBody({ query: { siteId, mode: "recover", operationId: id(10) }, command: command() }));
});
test("command scalar SHA and receipt matching bind complete original intent", () => {
  const c = command(); assert.deepEqual(JSON.parse(retentionCommandFingerprintText(c)), ["attendance-retention-command-v1", siteId, "hold", "events", id(2), id(10), 0, null, "a".repeat(64), c.reason]);
  assert.equal(retentionReceiptMatches(saved(), c, retentionCommandFingerprint(c)), true);
  assert.equal(retentionReceiptMatches(saved(), { ...c, reason: "别的理由" }, retentionCommandFingerprint(c)), false);
  assert.equal(retentionReceiptMatches({ ...saved(), commandFingerprint: "b".repeat(64) }, c, retentionCommandFingerprint(c)), false);
});
test("all three unset policies are exact ordered and explicitly unconfigured", () => {
  const value = { ...result(), data: { kind: "policies", items: RETENTION_CATEGORIES.map(category => ({ ...p(), category })) } };
  assert.equal(parseRetentionResult(value, { siteId, mode: "policies" }, owner).data.kind, "policies");
  assert.throws(() => parseRetentionResult({ ...value, data: { ...value.data, items: value.data.items.slice().reverse() } }, { siteId, mode: "policies" }, owner));
});
test("due equality is microsecond exact UTC elapsed days and remains independent of hold", () => {
  const item = record(); item.policy = { ...p(), revision: 1, retentionDays: 1, operationId: id(7), recordedAt: before }; item.dueAt = at; item.ageState = "due";
  item.preservation = { revision: 1, held: true, operationId: id(8), actorId: owner, reason: "保全", recordedAt: before };
  const value = { ...result(), data: { kind: "record" as const, item } }; assert.equal(parseRetentionResult(value, q, owner).data.kind, "record");
  assert.throws(() => parseRetentionResult({ ...value, data: { ...value.data, item: { ...item, dueAt: "2026-10-07T12:00:00.000000Z" } } }, q, owner));
  assert.throws(() => parseRetentionResult({ ...value, data: { ...value.data, item: { ...item, ageState: "not_due" } } }, q, owner));
});
test("unset is not due, source anchor cannot be client captured time or current zone", () => {
  const value = result(); assert.deepEqual(parseRetentionResult(value, q, owner), value);
  for (const patch of [{ ageState: "due" }, { anchorAt: at }, { dueAt: at }, { source: { ...event(), actorEmployeeId: id(9), employeeAuthUserId: owner } }])
    assert.throws(() => parseRetentionResult({ ...value, data: { kind: "record", item: { ...record(), ...patch } } }, q, owner));
});
test("location sidecar exact fields and nullable capture rules are checked against same original event", () => {
  const item = { ...record(), category: "location_results" as const, policy: { ...p(), category: "location_results" as const }, source: { kind: "location_summary" as const,
    event: event(), settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1 as const, reason: "denied" as const,
    needsReview: true, capturedAt: null, accuracyMeters: null, distanceMeters: null } };
  const query = { ...q, category: "location_results" as const }; const value = { ...result(), data: { kind: "record" as const, item } };
  assert.equal(parseRetentionResult(value, query, owner).data.kind, "record");
  for (const patch of [{ needsReview: false }, { capturedAt: at }, { event: { ...event(), eventId: id(99) } }])
    assert.throws(() => parseRetentionResult({ ...value, data: { kind: "record", item: { ...item, source: { ...item.source, ...patch } } } }, query, owner));
});
test("artifact uses exact artifact identity and recordedAt, saved zone does not use Intl/current settings", () => {
  const item: RetentionRecord = { ...record(), category: "period_artifact", policy: { ...p(), category: "period_artifact" }, source: { kind: "period_artifact", artifactId: id(2), periodId: id(6),
    workerId: id(3), employeeId: id(9), fromDate: "2026-10-01", throughDate: "2026-10-01", timeZone: "Historical/Preserved", startAt: "2026-10-01T00:00:00.000000Z",
    endAt: "2026-10-02T00:00:00.000000Z", recordedAt: before, artifactSha256: "a".repeat(64), artifactBytes: 100, sourceFingerprint: "b".repeat(64) } };
  const value = { ...result(), data: { kind: "record" as const, item } }; assert.equal(parseRetentionResult(value, { ...q, category: "period_artifact" }, owner).data.kind, "record");
  assert.throws(() => parseRetentionResult(value, q, owner));
});
test("preview is bounded, unique, ordered, scoped and readonly", () => {
  const query: RetentionQuery = { siteId, mode: "preview", category: "events", workerId: id(3), fromAt: before, toAt: at };
  const value = { ...result(), canWrite: false, data: { kind: "preview", asOf: at, items: [record()] } };
  assert.equal(parseRetentionResult(value, query, owner).data.kind, "preview");
  for (const items of [[record(), record()], Array.from({ length: 101 }, record), [{ ...record(), source: { ...event(), workerId: id(99) } }]])
    assert.throws(() => parseRetentionResult({ ...value, data: { ...value.data, items } }, query, owner));
  assert.throws(() => parseRetentionResult({ ...value, canWrite: true }, query, owner));
});
test("history accepts previous owner audit but requires exact scope, contiguous revision and cursor", () => {
  const c = (n: number): RetentionCommand => ({ siteId, action: "set_policy", operationId: id(n + 100), category: "events", expectedRevision: n - 1, retentionDays: n, reason: "明确政策" });
  const items = Array.from({ length: 25 }, (_, i) => ({ ...saved(c(30 - i)), actorId: id(99) }));
  const value = { ...result(), canWrite: false, data: { kind: "history", items, nextBeforeRevision: 6 } };
  const query: RetentionQuery = { siteId, mode: "history", category: "events", recordId: null, beforeRevision: 31 };
  assert.equal(parseRetentionResult(value, query, owner).data.kind, "history");
  assert.throws(() => parseRetentionResult({ ...value, data: { ...value.data, nextBeforeRevision: 5 } }, query, owner));
  assert.throws(() => parseRetentionResult(value, { ...query, recordId: id(2) }, owner));
});
test("POST and recover bind original actor and command; unknown GET stays null", () => {
  assert.equal(parseRetentionResult(savedResult(), q, owner, command()).receipt?.operationId, id(10));
  const recover: RetentionQuery = { siteId, mode: "recover", operationId: id(10) };
  assert.equal(parseRetentionResult(savedResult(), recover, owner).receipt?.operationId, id(10));
  assert.equal(parseRetentionResult({ ...savedResult(), receipt: null }, recover, owner).receipt, null);
  for (const value of [{ ...savedResult(), actorId: id(99) }, { ...savedResult(), receipt: { ...saved(), actorId: id(99) } }, { ...savedResult(), canWrite: true }])
    assert.throws(() => parseRetentionResult(value, recover, owner));
  assert.throws(() => parseRetentionResult({ ...savedResult(), receipt: null }, q, owner, command()));
});
test("HTTP success envelope is exact and cannot disagree on canWrite or accept duplicate JSON", () => {
  const body = { ok: true, canWrite: true, data: result() }; assert.equal(parseRetentionResponse(body, q, owner).canWrite, true);
  assert.throws(() => parseRetentionResponse({ ...body, canWrite: false }, q, owner));
  assert.throws(() => parseRetentionResponse(JSON.stringify(body).replace('"ok":true', '"ok":true,"ok":true'), q, owner));
  assert.throws(() => parseRetentionResponse({ ...body, canDelete: false }, q, owner));
});
test("service projector verifies source UTF8 SHA and bound site/category/id then removes sourceText", () => {
  const r = rawRecord(), raw = { ...result(), data: { kind: "record", item: r } };
  const projected = projectRetentionResult(raw, q, owner); assert.equal(JSON.stringify(projected).includes("sourceText"), false);
  for (const item of [{ ...r, sourceText: r.sourceText + " " }, { ...r, source: { ...event(), sequence: 99 } }, { ...r, sourceFingerprint: "0".repeat(64) }])
    assert.throws(() => projectRetentionResult({ ...raw, data: { kind: "record", item } }, q, owner));
});
test("service verifies immutable receipt hashes including history and defaults write permission false", async () => {
  const calls: Record<string, unknown>[] = [];
  const value = await executeRetention({ query: { siteId, mode: "recover", operationId: id(10) }, authUserId: owner }, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_retention_v1"); calls.push(args); return { data: savedResult(), error: null }; } });
  assert.equal(value.receipt?.operationId, id(10)); assert.equal(calls[0].p_allow_write, false);
  assert.throws(() => projectRetentionResult({ ...savedResult(), receipt: { ...saved(), commandFingerprint: "0".repeat(64) } }, q, owner, command()));
});
test("service rejects impossible write capability, wrong scope before RPC and sanitizes unknown errors", async () => {
  let called = 0; const rpc = { rpc: async () => { called++; return { data: { ...result(), data: { kind: "record", item: rawRecord() } }, error: null }; } };
  await assert.rejects(executeRetention({ query: q, command: command({ recordId: id(99) }), authUserId: owner }, rpc)); assert.equal(called, 0);
  await assert.rejects(executeRetention({ query: q, authUserId: owner, allowWrite: false }, rpc), /attendance_retention_invalid/);
  await assert.rejects(executeRetention({ query: q, authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "secret table" } }) }), /attendance_unavailable/);
});
test("rollout requires exact1 and validated bounded explicit site allowlist", () => {
  const env = { FAOLLA_ATTENDANCE_RETENTION_ENABLED: "1", FAOLLA_ATTENDANCE_RETENTION_SITE_IDS: siteId };
  assert.equal(retentionSiteEnabled(siteId, env), true);
  for (const patch of [{ FAOLLA_ATTENDANCE_RETENTION_ENABLED: "true" }, { FAOLLA_ATTENDANCE_RETENTION_SITE_IDS: "" }, { FAOLLA_ATTENDANCE_RETENTION_SITE_IDS: siteId + "," }, { FAOLLA_ATTENDANCE_RETENTION_SITE_IDS: "99999999" }]) assert.equal(retentionSiteEnabled(siteId, { ...env, ...patch }), false);
});
