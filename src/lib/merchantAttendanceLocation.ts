import { attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";

export type AttendanceCoordinates = { latitude: number; longitude: number };
export type AttendancePosition = AttendanceCoordinates & { accuracyMeters: number; capturedAt: string };
export type AttendanceFence = AttendanceCoordinates & { radiusMeters: number; maxAgeMs: number };
export type AttendanceLocationResult = {
  reason: "not_requested" | "missing" | "invalid" | "stale" | "future" | "inside" | "outside" | "uncertain";
  needsReview: boolean;
  distanceMeters: number | null;
};

function validCoordinates(value: AttendanceCoordinates) {
  return Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

export function attendanceDistanceMeters(a: AttendanceCoordinates, b: AttendanceCoordinates): number {
  if (!validCoordinates(a) || !validCoordinates(b)) throw new MerchantAttendanceError("attendance_invalid_coordinates");
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(b.latitude - a.latitude), longitudeDelta = radians(b.longitude - a.longitude);
  const h = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

// A confidence classification of reported coordinates, not proof of presence.
// Call only for an explicitly enabled punch-time location policy.
export function evaluateAttendanceLocation(fence: AttendanceFence | null, position: AttendancePosition | null, serverNow: string): AttendanceLocationResult {
  if (fence === null) return { reason: "not_requested", needsReview: false, distanceMeters: null };
  if (!validCoordinates(fence) || !Number.isFinite(fence.radiusMeters) || fence.radiusMeters < 1 || fence.radiusMeters > 100_000 ||
      !Number.isSafeInteger(fence.maxAgeMs) || fence.maxAgeMs < 1 || fence.maxAgeMs > 300_000) {
    throw new MerchantAttendanceError("attendance_invalid_fence");
  }
  const now = attendanceInstant(serverNow);
  if (position === null) return { reason: "missing", needsReview: true, distanceMeters: null };
  if (!validCoordinates(position) || !Number.isFinite(position.accuracyMeters) || position.accuracyMeters < 0) {
    return { reason: "invalid", needsReview: true, distanceMeters: null };
  }
  let captured: number;
  try { captured = attendanceInstant(position.capturedAt); }
  catch { return { reason: "invalid", needsReview: true, distanceMeters: null }; }
  if (captured > now + 5_000) return { reason: "future", needsReview: true, distanceMeters: null };
  if (now - captured > fence.maxAgeMs) return { reason: "stale", needsReview: true, distanceMeters: null };
  const distanceMeters = attendanceDistanceMeters(fence, position);
  const reason = distanceMeters + position.accuracyMeters <= fence.radiusMeters ? "inside" :
    distanceMeters - position.accuracyMeters > fence.radiusMeters ? "outside" : "uncertain";
  return { reason, needsReview: reason !== "inside", distanceMeters };
}
