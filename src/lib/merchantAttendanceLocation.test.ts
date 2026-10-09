import assert from "node:assert/strict";
import test from "node:test";
import { attendanceDistanceMeters, evaluateAttendanceLocation, type AttendancePosition } from "./merchantAttendanceLocation";

const now = "2026-09-29T07:00:00.000Z";
const fence = { latitude: 0, longitude: 0, radiusMeters: 100, maxAgeMs: 120_000 };
const position: AttendancePosition = { latitude: 0, longitude: 0, accuracyMeters: 10, capturedAt: now };

test("disabled location policy does not inspect or retain reported position", () => {
  assert.deepEqual(evaluateAttendanceLocation(null, { ...position, latitude: NaN }, "unused"),
    { reason: "not_requested", needsReview: false, distanceMeters: null });
});

for (const [label, input, reason] of [
  ["no permission", null, "missing"],
  ["invalid latitude", { ...position, latitude: 91 }, "invalid"],
  ["invalid longitude", { ...position, longitude: 181 }, "invalid"],
  ["non-finite location", { ...position, longitude: NaN }, "invalid"],
  ["negative accuracy", { ...position, accuracyMeters: -1 }, "invalid"],
  ["invalid timestamp", { ...position, capturedAt: "invalid" }, "invalid"],
  ["old position", { ...position, capturedAt: "2026-09-29T06:57:59.999Z" }, "stale"],
  ["future device clock", { ...position, capturedAt: "2026-09-29T07:00:05.001Z" }, "future"],
  ["accurate inside", position, "inside"],
  ["large uncertainty", { ...position, accuracyMeters: 200 }, "uncertain"],
  ["outside with good precision", { ...position, latitude: 0.002 }, "outside"],
  ["outside center but overlapping uncertainty", { ...position, latitude: 0.001, accuracyMeters: 30 }, "uncertain"],
] as const) {
  test(`classifies ${label} as ${reason}`, () => {
    const result = evaluateAttendanceLocation(fence, input, now);
    assert.equal(result.reason, reason);
    assert.equal(result.needsReview, reason !== "inside");
  });
}

test("invalid policy fails closed, not silently treated as no geofence", () => {
  assert.throws(() => evaluateAttendanceLocation({ ...fence, radiusMeters: 0 }, position, now), /attendance_invalid_fence/);
  assert.throws(() => evaluateAttendanceLocation({ ...fence, maxAgeMs: Infinity }, position, now), /attendance_invalid_fence/);
});

test("distance handles the date line and coincident points", () => {
  assert.equal(attendanceDistanceMeters(position, position), 0);
  const distance = attendanceDistanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 });
  assert.ok(distance > 220 && distance < 224);
});
