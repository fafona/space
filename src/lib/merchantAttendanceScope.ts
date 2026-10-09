import { requireAttendanceUuid } from "./merchantAttendance";
import { attendanceInstant, MerchantAttendanceError } from "./merchantAttendanceTime";

// Pure reference policy, not an API authorization boundary. Migration 066 mirrors
// this predicate in the record RPC under current membership/role/scope locks and
// applies it BEFORE pagination. Future counts, aggregation and export must too.
// Never accept these snapshots from a browser, cache them between requests, or
// fetch an unrestricted result set and rely on this function to redact it later.
export const ATTENDANCE_SCOPE_LIMITS = Object.freeze({ grants: 32, workersPerGrant: 200, locationsPerGrant: 50 });

export type AttendanceManagementGrant = Readonly<{
  id: string;
  workerIds: readonly string[];
  locationIds: readonly string[];
  // Validity of the authorization, NOT the event's date range. A separately
  // bounded history query is still required, including for exports.
  validFrom: string;
  validUntil: string | null;
}>;
export type AttendanceManagementScope = Readonly<{
  siteId: string;
  employeeId: string;
  revision: number;
  grants: readonly AttendanceManagementGrant[];
}>;
export type AttendanceScopeActor = Readonly<{
  siteId: string;
  employeeId: string;
  employeeActive: boolean;
  roleActive: boolean;
  permissions: readonly string[];
}>;
// Only immutable event attribution belongs here. In particular, do not use the
// worker's current default location to decide visibility of a historical event.
export type AttendanceRecordAttribution = Readonly<{ siteId: string; workerId: string; locationId: string }>;

function invalid(): never { throw new MerchantAttendanceError("attendance_invalid_scope"); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) return invalid();
  return result;
}
function site(value: unknown): string {
  if (typeof value !== "string" || !/^\d{8}$/.test(value)) return invalid();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string") return invalid();
  try { requireAttendanceUuid(value); } catch { return invalid(); }
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string") return invalid();
  try { attendanceInstant(value); } catch { return invalid(); }
  return value;
}
function ids(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  // Array.from also visits holes: a sparse array must not silently omit entries.
  const result = Array.from(value, uuid);
  if (new Set(result).size !== result.length) return invalid();
  return Object.freeze(result.sort());
}

export function parseAttendanceManagementScope(value: unknown): AttendanceManagementScope {
  const raw = object(value, ["siteId", "employeeId", "revision", "grants"]);
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) return invalid();
  if (!Array.isArray(raw.grants) || raw.grants.length > ATTENDANCE_SCOPE_LIMITS.grants) return invalid();
  const grants = Array.from(raw.grants, (item): AttendanceManagementGrant => {
    const grant = object(item, ["id", "workerIds", "locationIds", "validFrom", "validUntil"]);
    const validFrom = instant(grant.validFrom);
    const validUntil = grant.validUntil === null ? null : instant(grant.validUntil);
    if (validUntil !== null && validUntil <= validFrom) return invalid();
    return Object.freeze({ id: uuid(grant.id),
      workerIds: ids(grant.workerIds, ATTENDANCE_SCOPE_LIMITS.workersPerGrant),
      locationIds: ids(grant.locationIds, ATTENDANCE_SCOPE_LIMITS.locationsPerGrant), validFrom, validUntil });
  });
  if (new Set(grants.map(grant => grant.id)).size !== grants.length) return invalid();
  return Object.freeze({ siteId: site(raw.siteId), employeeId: uuid(raw.employeeId),
    revision: raw.revision as number, grants: Object.freeze(grants) });
}

function parseActor(value: unknown): AttendanceScopeActor {
  const raw = object(value, ["siteId", "employeeId", "employeeActive", "roleActive", "permissions"]);
  if (typeof raw.employeeActive !== "boolean" || typeof raw.roleActive !== "boolean"
    || !Array.isArray(raw.permissions) || raw.permissions.length > 200) return invalid();
  const permissions = Array.from(raw.permissions, item => {
    if (typeof item !== "string" || item.length < 1 || item.length > 100) return invalid();
    return item;
  });
  return { siteId: site(raw.siteId), employeeId: uuid(raw.employeeId), employeeActive: raw.employeeActive,
    roleActive: raw.roleActive, permissions };
}

/** Evaluates ONE record's access under current authoritative inputs. It does
 * not authorize approvals, exports, location evidence, or the owner's separate
 * route. Empty/missing/malformed scopes never become all-company permission.
 * Callers must not reuse a successful answer after authorization changes. */
export function attendanceManagerCanReadRecord(input: {
  actor: unknown; scope: unknown; record: unknown; checkedAt: string;
}): boolean {
  try {
    const actor = parseActor(input.actor), scope = parseAttendanceManagementScope(input.scope);
    const raw = object(input.record, ["siteId", "workerId", "locationId"]);
    const record = { siteId: site(raw.siteId), workerId: uuid(raw.workerId), locationId: uuid(raw.locationId) };
    const now = instant(input.checkedAt);
    if (!actor.employeeActive || !actor.roleActive || !actor.permissions.includes("enterprise.view")
      || !actor.permissions.includes("attendance.records.view") || actor.siteId !== scope.siteId
      || actor.employeeId !== scope.employeeId || record.siteId !== scope.siteId) return false;
    // OR between complete grants; AND between worker and location within one
    // grant. Flattening each axis separately would create unintended pairs.
    return scope.grants.some(grant => grant.validFrom <= now && (grant.validUntil === null || now < grant.validUntil)
      && grant.workerIds.includes(record.workerId) && grant.locationIds.includes(record.locationId));
  } catch {
    return false;
  }
}
