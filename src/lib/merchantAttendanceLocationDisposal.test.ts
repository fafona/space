import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { LOCATION_DISPOSAL_FIELDS, LOCATION_DISPOSAL_PROTOCOL, parseLocationDisposal } from "./merchantAttendanceLocationDisposal";
import { parseAttendanceLocationClockResult } from "./merchantAttendanceLocationClock";
import { parseLocationScheduleResult } from "./merchantAttendanceLocationSchedule";
import { parseOperationalPunchResult } from "./merchantAttendanceOperationalPunch";
import { parseRetentionResult } from "./merchantAttendanceRetention";
import { projectRetentionResult } from "./merchantAttendanceRetention.server";
import { locationScheduleId as id, locationScheduleInput, locationScheduleWire, locationScheduleSite as siteId, locationScheduleActor as actor } from "../../scripts/fixtures/attendance-location-schedule-model";
const disposedAt = "2026-10-09T12:00:00.000001Z";
const marker = () => ({ protocol: LOCATION_DISPOSAL_PROTOCOL, operationId: id(90), disposedAt, fields: [...LOCATION_DISPOSAL_FIELDS] });
const empty = () => ({ reason: "inside", needsReview: false, capturedAt: null, accuracyMeters: null, distanceMeters: null });
function wire() { const r = locationScheduleWire(true); r.clock.locationResult = { ...r.clock.locationResult!, ...parseLocationDisposal(marker(), empty(), r.clock.receipt!.occurredAt) }; return r; }
const query = () => ({ ...locationScheduleInput(false), operationId: id(5) });

test("C23 disposed union is exact and detached; it is a receipt marker, not erasure authority", () => {
  const raw = marker(), parsed = parseLocationDisposal(raw, empty(), "2026-10-09T12:00:00.000000Z");
  raw.fields.reverse(); assert.deepEqual(parsed.disposal.fields, LOCATION_DISPOSAL_FIELDS); assert.equal(Object.isFrozen(parsed.disposal), true);
  assert.throws(() => parseLocationDisposal(marker(), empty(), "2026-10-09T12:00:00.000002Z"));
  for (const patch of [{ reason: "outside" }, { needsReview: true }, { capturedAt: disposedAt }, { accuracyMeters: 0 }, { distanceMeters: 0 }])
    assert.throws(() => parseLocationDisposal(marker(), { ...empty(), ...patch }, "2026-10-08T07:50:00.000Z"));
});
test("C23 markers reject unknown fields, bad UTC/UUID, sparse arrays, symbols and getters without executing them", () => {
  for (const patch of [{ protocol: "v2" }, { operationId: id(90) + "\n" }, { disposedAt: disposedAt + "\n" }, { disposedAt: "2026-02-30T12:00:00.000000Z" },
    { fields: LOCATION_DISPOSAL_FIELDS.slice(0, 2) }, { fields: [...LOCATION_DISPOSAL_FIELDS].reverse() }, { ownerId: actor }, { fields: new Array(3) }])
    assert.throws(() => parseLocationDisposal({ ...marker(), ...patch }, empty(), "2026-10-08T07:50:00.000Z"));
  let calls = 0; const getter = { ...marker(), get disposedAt() { calls++; return disposedAt; } };
  assert.throws(() => parseLocationDisposal(getter, empty(), "2026-10-08T07:50:00.000Z"));
  const fieldGetter = marker(); Object.defineProperty(fieldGetter.fields, "0", { get() { calls++; return "captured_at"; }, enumerable: true });
  assert.throws(() => parseLocationDisposal(fieldGetter, empty(), "2026-10-08T07:50:00.000Z")); assert.equal(calls, 0);
  assert.throws(() => parseLocationDisposal({ ...marker(), [Symbol("x")]: 1 }, empty(), "2026-10-08T07:50:00.000Z"));
});
test("C23 old location receipt and saved schedule retain event/notice/adoption while exposing approved disposal", () => {
  const r = wire(), before = locationScheduleWire(true);
  assert.deepEqual(parseAttendanceLocationClockResult(r.clock, query()).receipt, before.clock.receipt);
  const parsed = parseLocationScheduleResult(r, query()); assert.deepEqual(parsed.adoption, before.adoption);
  assert.deepEqual(parsed.clock.receiptGate, before.clock.receiptGate); assert.equal(parsed.clock.locationResult?.disposal?.operationId, id(90));
  assert.deepEqual(parseLocationScheduleResult(before, query()), before);
  for (const patch of [{ disposal: null }, { capturedAt: before.clock.locationResult!.capturedAt }, { reason: "denied", needsReview: true }, { eventId: id(91) }])
    assert.throws(() => parseLocationScheduleResult({ ...r, clock: { ...r.clock, locationResult: { ...r.clock.locationResult, ...patch } } }, query()));
  const noMarker: Record<string, unknown> = { ...r.clock.locationResult }; delete noMarker.disposal;
  assert.throws(() => parseLocationScheduleResult({ ...r, clock: { ...r.clock, locationResult: noMarker } }, query()));
  let calls = 0; const locationGetter = { ...r.clock.locationResult, get disposal() { calls++; return marker(); } };
  assert.throws(() => parseAttendanceLocationClockResult({ ...r.clock, locationResult: locationGetter }, query())); assert.equal(calls, 0);
});
test("C23 operational location recovery accepts the same strict union without a new command or current source", async () => {
  const r = wire(), raw = { protocol: "attendance-operational-punch-v1", channel: "location", siteId, readAt: disposedAt,
    clock: r.clock, policy: null, session: null, choices: null, association: null, adoption: null, operation: null,
    replayed: false, canStart: false, canBreak: false, canFinish: false };
  const input = { siteId, channel: "location" as const, authUserId: actor, expectedWorkerId: id(3), query: { mode: "recover" as const, operationId: id(5) }, command: null, write: false };
  const parsed = await parseOperationalPunchResult(raw, input);
  assert.equal(parsed.channel, "location"); assert.equal(parsed.clock.receipt?.operationId, id(5));
  await assert.rejects(parseOperationalPunchResult({ ...raw, readAt: "2026-10-09T12:00:00.000000Z" }, input));
  await assert.rejects(parseOperationalPunchResult({ ...raw, clock: { ...r.clock, locationResult: { ...r.clock.locationResult, disposal: { ...marker(), fields: [] } } } }, input));
});
function retention() {
  const at = "2026-10-08T07:50:00.000000Z", source = { kind: "location_summary", event: { kind: "event", eventId: id(7), workerId: id(3), locationId: id(4), operationId: id(5),
    sequence: 1, action: "clock_in", rawSource: "web", breakPaid: null, occurredAt: at, receivedAt: at, timeZone: "Europe/Madrid", actorEmployeeId: id(2) },
    settingsVersion: 2, workerVersion: 4, locationVersion: 7, algorithmVersion: 1, ...empty(), disposal: marker() };
  const sourceText = JSON.stringify({ siteId, category: "location_results", recordId: id(7), source });
  const item = { category: "location_results", recordId: id(7), source, sourceText, sourceFingerprint: createHash("sha256").update(sourceText).digest("hex"),
    policy: { category: "location_results", revision: 0, retentionDays: null, operationId: null, recordedAt: null }, anchorAt: at, asOf: disposedAt, dueAt: null, ageState: "unconfigured",
    preservation: { revision: 0, held: false, operationId: null, actorId: null, reason: null, recordedAt: null } };
  return { raw: { protocol: "attendance-retention-v1", siteId, actorId: actor, readAt: disposedAt, canWrite: false, data: { kind: "record", item }, receipt: null, disposition: "preview_only" },
    query: { siteId, mode: "record" as const, category: "location_results" as const, recordId: id(7) } };
}
test("C23 retention source hash still covers exact NULL+marker; no bypass for a valid-looking marker", () => {
  const { raw, query: q } = retention(), projected = projectRetentionResult(raw, q, actor);
  assert.equal(projected.data.kind, "record"); assert.doesNotMatch(JSON.stringify(projected), /sourceText/);
  assert.deepEqual(parseRetentionResult(projected, q, actor), projected);
  assert.throws(() => projectRetentionResult({ ...raw, data: { kind: "record", item: { ...raw.data.item, sourceFingerprint: "a".repeat(64) } } }, q, actor));
  const changed = structuredClone(raw); changed.data.item.source.disposal.operationId = id(91);
  assert.throws(() => projectRetentionResult(changed, q, actor));
  const future = structuredClone(projected); if (future.data.kind === "record" && future.data.item.source.kind === "location_summary" && future.data.item.source.disposal)
    future.data.item.source = { ...future.data.item.source, disposal: { ...future.data.item.source.disposal, disposedAt: "2026-10-10T12:00:00.000001Z" } };
  assert.throws(() => parseRetentionResult(future, q, actor));
});
test("C23 existing four result surfaces describe disposed precision, not missing location or new authority", () => {
  for (const name of ["MerchantAttendanceLocationClockPanel", "MerchantAttendanceLocationScheduleClock", "MerchantAttendanceOperationalPunchWorkspace", "MerchantAttendanceRetentionPanel"])
    assert.match(readFileSync(new URL(`../components/enterprise/${name}.tsx`, import.meta.url), "utf8"), /data-location-disposed.*LOCATION_DISPOSAL_NOTICE/);
});
