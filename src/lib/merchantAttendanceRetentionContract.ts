/** C23 is metadata-only: no deletion, anonymization, propagation, timer or
 * retention-policy backfill. A due result is never permission to delete. */
import type { DisposedLocationPrecision } from "./merchantAttendanceLocationDisposal";
export const RETENTION_CATEGORIES = ["events", "location_results", "period_artifact"] as const;
export type RetentionCategory = typeof RETENTION_CATEGORIES[number];
export const RETENTION_API = "/api/merchant-enterprise/attendance/retention";
export const RETENTION_BODY_LIMIT = 8192;
export const RETENTION_RESULT_LIMIT = 131072;
export const RETENTION_MAX_DAYS = 36500; // Input/resource bound, not a legal recommendation.
export const RETENTION_MAX_REVISION = 9007199254740990;
export type RetentionQuery = { siteId: string } & (
  | { mode: "policies" }
  | { mode: "record"; category: RetentionCategory; recordId: string }
  | { mode: "history"; category: RetentionCategory; recordId: string | null; beforeRevision: number | null }
  | { mode: "recover"; operationId: string }
  | { mode: "preview"; category: "events" | "location_results"; workerId: string; fromAt: string; toAt: string }
  | { mode: "preview"; category: "period_artifact"; workerId: string; periodId: string }
);
export type RetentionCommand = { siteId: string; operationId: string; category: RetentionCategory; expectedRevision: number; reason: string } & (
  | { action: "set_policy"; retentionDays: number | null }
  | { action: "hold" | "release"; recordId: string; expectedSourceFingerprint: string }
);
export type RetentionEventSource = {
  kind: "event"; eventId: string; workerId: string; locationId: string; operationId: string; sequence: number;
  action: "clock_in" | "break_start" | "break_end" | "clock_out"; rawSource: "web" | "kiosk"; breakPaid: boolean | null;
  occurredAt: string; receivedAt: string; timeZone: string; actorEmployeeId: string | null;
};
export type RetentionLocationSource = {
  kind: "location_summary"; event: RetentionEventSource; settingsVersion: number; workerVersion: number; locationVersion: number;
  algorithmVersion: 1;
} & ({ reason: "inside" | "outside" | "uncertain" | "stale" | "future" | "denied" | "timeout" | "unavailable" | "unsupported" | "not_provided";
  needsReview: boolean; capturedAt: string | null; accuracyMeters: number | null; distanceMeters: number | null;
  disposal?: never;
} | DisposedLocationPrecision);
export type RetentionArtifactSource = {
  kind: "period_artifact"; artifactId: string; periodId: string; workerId: string; employeeId: string;
  fromDate: string; throughDate: string; timeZone: string; startAt: string; endAt: string; recordedAt: string;
  artifactSha256: string; artifactBytes: number; sourceFingerprint: string;
};
export type RetentionSource = RetentionEventSource | RetentionLocationSource | RetentionArtifactSource;
export type RetentionPolicy = { category: RetentionCategory; revision: number; retentionDays: number | null; operationId: string | null; recordedAt: string | null };
export type RetentionPreservation = { revision: number; held: boolean; operationId: string | null; actorId: string | null; reason: string | null; recordedAt: string | null };
export type RetentionRecord = {
  category: RetentionCategory; recordId: string; source: RetentionSource; sourceFingerprint: string;
  policy: RetentionPolicy; anchorAt: string; asOf: string; dueAt: string | null;
  ageState: "unconfigured" | "not_due" | "due"; preservation: RetentionPreservation;
};
export type RetentionReceipt = { operationId: string; actorId: string; revision: number; command: RetentionCommand; commandFingerprint: string; recordedAt: string };
export type RetentionData =
  | { kind: "policies"; items: RetentionPolicy[] }
  | { kind: "record"; item: RetentionRecord }
  | { kind: "preview"; asOf: string; items: RetentionRecord[] }
  | { kind: "history"; items: RetentionReceipt[]; nextBeforeRevision: number | null }
  | { kind: "receipt" };
export type RetentionResult = {
  protocol: "attendance-retention-v1"; siteId: string; actorId: string; readAt: string;
  canWrite: boolean; data: RetentionData; receipt: RetentionReceipt | null; disposition: "preview_only";
};
export type RetentionResponse = { canWrite: boolean; result: RetentionResult };
// Raw SQL record adds sourceText = jsonb_build_object('siteId',site,
// 'category',category,'recordId',recordId,'source',source)::text. The service
// verifies UTF8 SHA256/source structure and removes sourceText. No other raw extras.
// SHA command tuple is JSON scalar serialization, no spaces:
// ['attendance-retention-command-v1',siteId,action,category,recordId|null,
// operationId,expectedRevision,retentionDays|null,expectedSourceFingerprint|null,reason].
// POST query is derived: set_policy -> policies, hold/release -> record.
// POST and recover return data={kind:'receipt'}, canWrite=false. Unknown recover
// has receipt=null; an absent receipt is never proof that a write failed.
// Policies always returns exactly three ordered categories, revision0/null unset.
// Preview has <=100 rows, SQL probes101 then rejects rather than truncating.
// Event/location sorting is original occurredAt,eventId descending; artifacts
// recordedAt,artifactId descending, unique artifact even if multiple versions refer.
// History <=25 contiguous descending revisions strictly before the cursor;
// nextBeforeRevision=last revision iff more exist, otherwise null.
// All instants exact UTC6. dueAt=anchorAt+days*86400 seconds, equal is due.
// Source identity is historical only. No current worker->Auth reconstruction.
// settings.enabled=false, employee inactivity/rebind and sealing do not block
// owner metadata management. Feature off forbids fresh writes, never saved reads/replay.
