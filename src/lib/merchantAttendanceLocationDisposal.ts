import { MerchantAttendanceError } from "./merchantAttendanceTime";

// Read compatibility only. This marker is never authority to erase evidence;
// the service/SQL must verify its immutable execution proof before returning it.
export const LOCATION_DISPOSAL_PROTOCOL = "attendance-location-precision-disposal-v1" as const;
export const LOCATION_DISPOSAL_FIELDS = Object.freeze(["captured_at", "accuracy_meters", "distance_meters"] as const);
export const LOCATION_DISPOSAL_NOTICE = "该笔定位精度字段已按批准处置，原打卡动作和定位分类保留。";
export type LocationDisposal = Readonly<{
  protocol: typeof LOCATION_DISPOSAL_PROTOCOL; operationId: string; disposedAt: string; fields: typeof LOCATION_DISPOSAL_FIELDS;
}>;
export type DisposedLocationPrecision = {
  reason: "inside"; needsReview: false; capturedAt: null; accuracyMeters: null; distanceMeters: null; disposal: LocationDisposal;
};
function fail(): never { throw new MerchantAttendanceError("attendance_invalid_request"); }
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(k => typeof k !== "string" || !keys.includes(k))) fail();
  const out: Record<string, unknown> = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !("value" in d) || !d.enumerable) fail(); out[key] = d.value; }
  return out;
}
function utc(value: unknown, digits: 3 | 6): string {
  if (typeof value !== "string" || value.length !== 21 + digits
    || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/.test(value)) fail();
  const ms = value.slice(0, 23) + "Z";
  if (!Number.isFinite(Date.parse(ms)) || new Date(ms).toISOString() !== ms) fail();
  return digits === 6 ? value : value.slice(0, 23) + "000Z";
}
/** Exact, detached disposed branch. A measured/missing result may not carry a marker. */
export function parseLocationDisposal(raw: unknown, summary: { reason: unknown; needsReview: unknown; capturedAt: unknown; accuracyMeters: unknown; distanceMeters: unknown }, occurredAt: string): DisposedLocationPrecision {
  const s = data(summary, ["reason", "needsReview", "capturedAt", "accuracyMeters", "distanceMeters"]);
  if (s.reason !== "inside" || s.needsReview !== false || s.capturedAt !== null || s.accuracyMeters !== null || s.distanceMeters !== null) fail();
  const r = data(raw, ["protocol", "operationId", "disposedAt", "fields"]);
  if (r.protocol !== LOCATION_DISPOSAL_PROTOCOL || typeof r.operationId !== "string" || r.operationId.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.operationId)) fail();
  const disposedAt = utc(r.disposedAt, 6), originalAt = utc(occurredAt, occurredAt.length === 24 ? 3 : 6);
  if (disposedAt < originalAt) fail();
  if (!Array.isArray(r.fields) || Object.getPrototypeOf(r.fields) !== Array.prototype || r.fields.length !== 3 || Reflect.ownKeys(r.fields).length !== 4) fail();
  for (let i = 0; i < 3; i++) { const d = Object.getOwnPropertyDescriptor(r.fields, String(i)); if (!d || !("value" in d) || !d.enumerable || d.value !== LOCATION_DISPOSAL_FIELDS[i]) fail(); }
  return { reason: "inside", needsReview: false, capturedAt: null, accuracyMeters: null, distanceMeters: null,
    disposal: Object.freeze({ protocol: LOCATION_DISPOSAL_PROTOCOL, operationId: r.operationId, disposedAt, fields: LOCATION_DISPOSAL_FIELDS }) };
}
