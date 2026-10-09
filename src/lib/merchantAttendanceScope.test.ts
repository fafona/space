import assert from "node:assert/strict";
import test from "node:test";
import { attendanceManagerCanReadRecord, ATTENDANCE_SCOPE_LIMITS, parseAttendanceManagementScope,
  type AttendanceManagementGrant, type AttendanceManagementScope, type AttendanceRecordAttribution,
  type AttendanceScopeActor } from "./merchantAttendanceScope";
import { MerchantAttendanceError } from "./merchantAttendanceTime";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", employeeId = id(1), workerA = id(2), workerB = id(3), locationA = id(4), locationB = id(5);
const checkedAt = "2026-09-29T12:00:00.000Z";
const grant = (patch: Partial<AttendanceManagementGrant> = {}): AttendanceManagementGrant => ({
  id: id(6), workerIds: [workerA], locationIds: [locationA], validFrom: "2026-09-01T00:00:00.000Z", validUntil: null, ...patch,
});
const scope = (patch: Partial<AttendanceManagementScope> = {}): AttendanceManagementScope => ({
  siteId, employeeId, revision: 1, grants: [grant()], ...patch,
});
const actor = (patch: Partial<AttendanceScopeActor> = {}): AttendanceScopeActor => ({
  siteId, employeeId, employeeActive: true, roleActive: true, permissions: ["enterprise.view", "attendance.records.view"], ...patch,
});
const record = (patch: Partial<AttendanceRecordAttribution> = {}): AttendanceRecordAttribution => ({ siteId, workerId: workerA, locationId: locationA, ...patch });
function allowed(patch: Partial<Parameters<typeof attendanceManagerCanReadRecord>[0]> = {}) {
  return attendanceManagerCanReadRecord({ actor: actor(), scope: scope(), record: record(), checkedAt, ...patch });
}
const invalid = (value: unknown) => assert.throws(() => parseAttendanceManagementScope(value),
  (error: unknown) => error instanceof MerchantAttendanceError && error.code === "attendance_invalid_scope");

test("current permission AND worker AND actual event location are all required", () => {
  assert.equal(allowed(), true);
  assert.equal(allowed({ record: record({ workerId: workerB }) }), false);
  assert.equal(allowed({ record: record({ locationId: locationB }) }), false);
});
test("multiple grants preserve pairs instead of forming a worker/location cross-product", () => {
  const two = scope({ grants: [grant(), grant({ id: id(7), workerIds: [workerB], locationIds: [locationB] })] });
  for (const workerId of [workerA, workerB, id(8)]) for (const locationId of [locationA, locationB, id(9)]) {
    assert.equal(allowed({ scope: two, record: record({ workerId, locationId }) }),
      (workerId === workerA && locationId === locationA) || (workerId === workerB && locationId === locationB));
  }
});
test("one explicit grant can contain several workers and places; it does not select future workers", () => {
  const selected = scope({ grants: [grant({ workerIds: [workerA, workerB], locationIds: [locationA, locationB] })] });
  assert.equal(allowed({ scope: selected, record: record({ workerId: workerB, locationId: locationA }) }), true);
  assert.equal(allowed({ scope: selected, record: record({ workerId: id(10) }) }), false);
});
test("historical access uses each event's actual place, never a worker's new default place", () => {
  const movedWorker = { id: workerA, defaultLocationId: locationA };
  const oldEvent = record({ workerId: movedWorker.id, locationId: locationB });
  assert.equal(allowed({ record: oldEvent }), false);
  assert.equal(allowed({ record: record({ workerId: movedWorker.id, locationId: locationA }) }), true);
  assert.equal(allowed({ record: { ...oldEvent, defaultLocationId: movedWorker.defaultLocationId } }), false);
});
for (const [name, change] of [
  ["other merchant actor", { actor: actor({ siteId: "99990002" }) }],
  ["other merchant scope", { scope: scope({ siteId: "99990002" }) }],
  ["other merchant record", { record: record({ siteId: "99990002" }) }],
  ["different employee", { actor: actor({ employeeId: id(8) }) }],
  ["disabled employee", { actor: actor({ employeeActive: false }) }],
  ["disabled role", { actor: actor({ roleActive: false }) }],
  ["self permission only", { actor: actor({ permissions: ["enterprise.view", "attendance.self.view", "attendance.self.clock"] }) }],
  ["missing enterprise prerequisite", { actor: actor({ permissions: ["attendance.records.view"] }) }],
  ["all boards only", { actor: actor({ permissions: ["enterprise.view", "boards.manage", "tasks.view"] }) }],
  ["empty scope", { scope: scope({ grants: [] }) }],
  ["empty workers", { scope: scope({ grants: [grant({ workerIds: [] })] }) }],
  ["empty locations", { scope: scope({ grants: [grant({ locationIds: [] })] }) }],
  ["missing scope", { scope: undefined }],
  ["missing actor", { actor: null }],
  ["missing record", { record: null }],
  ["browser time without timezone", { checkedAt: "2026-09-29T12:00:00" }],
] as const) test(`scope denies ${name}`, () => assert.equal(allowed(change), false));

test("current revocation is re-evaluated, with no positive decision cache", () => {
  assert.equal(allowed(), true);
  assert.equal(allowed({ scope: scope({ revision: 2, grants: [] }) }), false);
  assert.equal(allowed({ actor: actor({ permissions: ["enterprise.view"] }) }), false);
  assert.equal(allowed({ actor: actor({ employeeActive: false }) }), false);
  assert.equal(allowed(), true);
});
test("grant validity is UTC half-open, including exact activation and expiry instants", () => {
  const timed = scope({ grants: [grant({ validFrom: checkedAt, validUntil: "2026-09-29T13:00:00.000Z" })] });
  for (const [at, expected] of [["2026-09-29T11:59:59.999Z", false], [checkedAt, true],
    ["2026-09-29T12:59:59.999Z", true], ["2026-09-29T13:00:00.000Z", false]] as const) {
    assert.equal(allowed({ scope: timed, checkedAt: at }), expected);
  }
});
test("repeated local hours at DST fall-back are different authorization instants", () => {
  const timed = scope({ grants: [grant({ validFrom: "2026-10-25T00:30:00.000Z", validUntil: "2026-10-25T01:30:00.000Z" })] });
  assert.equal(allowed({ scope: timed, checkedAt: "2026-10-25T00:45:00.000Z" }), true);
  assert.equal(allowed({ scope: timed, checkedAt: "2026-10-25T01:45:00.000Z" }), false);
});
for (const [name, value] of [
  ["array", []], ["null", null], ["noncanonical site", { ...scope(), siteId: "9999" }],
  ["zero revision", { ...scope(), revision: 0 }], ["fractional revision", { ...scope(), revision: 1.5 }],
  ["unsafe revision", { ...scope(), revision: Number.MAX_SAFE_INTEGER + 1 }],
  ["legacy all flag", { ...scope(), all: true }], ["board scope", { ...scope(), boardAccess: "all" }],
  ["wildcard workers", scope({ grants: [{ ...grant(), workerIds: ["*"] }] })],
  ["null locations", { ...scope(), grants: [{ ...grant(), locationIds: null }] }],
  ["duplicate workers", scope({ grants: [grant({ workerIds: [workerA, workerA] })] })],
  ["duplicate locations", scope({ grants: [grant({ locationIds: [locationA, locationA] })] })],
  ["duplicate grants", scope({ grants: [grant(), grant()] })],
  ["sparse grants", { ...scope(), grants: Array(1) }],
  ["sparse workers", scope({ grants: [grant({ workerIds: Array(1) })] })],
  ["missing validUntil", { ...scope(), grants: [{ id: id(6), workerIds: [workerA], locationIds: [locationA], validFrom: checkedAt }] }],
  ["reversed window", scope({ grants: [grant({ validFrom: checkedAt, validUntil: "2026-09-01T00:00:00.000Z" })] })],
  ["empty window", scope({ grants: [grant({ validFrom: checkedAt, validUntil: checkedAt })] })],
  ["invalid calendar date", scope({ grants: [grant({ validFrom: "2026-02-30T00:00:00.000Z" })] })],
] as const) test(`malformed scope fails closed: ${name}`, () => { invalid(value); assert.equal(allowed({ scope: value }), false); });

test("malformed later grant cannot be hidden behind an earlier matching grant", () => {
  const value = { ...scope(), grants: [grant(), { ...grant({ id: id(7) }), workerIds: ["*"] }] };
  assert.equal(allowed({ scope: value }), false);
});
test("actor flags are strict booleans; owner/all-scope flags cannot override the employee boundary", () => {
  for (const value of [{ ...actor(), employeeActive: "true" }, { ...actor(), roleActive: 1 },
    { ...actor(), isOwner: true }, { ...actor(), boardAccess: "all" }, { ...actor(), permissions: ["*"] },
    { ...actor(), permissions: Array(1) }]) assert.equal(allowed({ actor: value }), false);
});
test("bounded, canonical parsing makes detached immutable snapshots without mutating input", () => {
  const value = structuredClone(scope({ grants: [grant({ workerIds: [workerB, workerA] })] }));
  const before = structuredClone(value), parsed = parseAttendanceManagementScope(value);
  assert.deepEqual(value, before);
  assert.deepEqual(parsed.grants[0].workerIds, [workerA, workerB]);
  assert.notEqual(parsed.grants, value.grants);
  assert.notEqual(parsed.grants[0].workerIds, value.grants[0].workerIds);
  for (const item of [parsed, parsed.grants, parsed.grants[0], parsed.grants[0].workerIds, parsed.grants[0].locationIds]) {
    assert.equal(Object.isFrozen(item), true);
  }
});
test("scope size bounds reject excess instead of truncating authorization", () => {
  const maxWorkers = Array.from({ length: ATTENDANCE_SCOPE_LIMITS.workersPerGrant }, (_, i) => id(i + 100));
  const maxLocations = Array.from({ length: ATTENDANCE_SCOPE_LIMITS.locationsPerGrant }, (_, i) => id(i + 500));
  const maxGrants = Array.from({ length: ATTENDANCE_SCOPE_LIMITS.grants }, (_, i) => grant({ id: id(i + 1000), workerIds: maxWorkers, locationIds: maxLocations }));
  assert.equal(parseAttendanceManagementScope(scope({ grants: maxGrants })).grants.length, ATTENDANCE_SCOPE_LIMITS.grants);
  invalid(scope({ grants: [...maxGrants, grant({ id: id(9999) })] }));
  invalid(scope({ grants: [grant({ workerIds: [...maxWorkers, id(9999)] })] }));
  invalid(scope({ grants: [grant({ locationIds: [...maxLocations, id(9999)] })] }));
});
test("exhaustive finite pair matrix equals OR of individual AND grants", () => {
  const workers = [workerA, workerB, id(10)], locations = [locationA, locationB, id(11)];
  // All nonempty subsets on both axes in each of two grants: 2,401 policies.
  for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) for (let c = 1; c < 8; c++) for (let d = 1; d < 8; d++) {
    const select = (items: string[], mask: number) => items.filter((_, i) => mask & (1 << i));
    const value = scope({ grants: [grant({ workerIds: select(workers, a), locationIds: select(locations, b) }),
      grant({ id: id(7), workerIds: select(workers, c), locationIds: select(locations, d) })] });
    for (let w = 0; w < 3; w++) for (let l = 0; l < 3; l++) {
      const expected = Boolean(((a & (1 << w)) && (b & (1 << l))) || ((c & (1 << w)) && (d & (1 << l))));
      assert.equal(allowed({ scope: value, record: record({ workerId: workers[w], locationId: locations[l] }) }), expected);
    }
  }
});
