import assert from "node:assert/strict";
import test from "node:test";
import {
  DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION,
  DATABASE_RECOVERY_RELATIONS,
  DATABASE_RECOVERY_LEGACY_RELATIONS,
  validateDatabaseRecoveryContent,
  assertDatabaseRecoveryContentMatch,
  buildDatabaseRecoveryContentScalarSql,
  buildDatabaseRecoveryContentSql,
} from "./database-recovery-content-contract.mjs";
import { recoveryContentFixture } from "./test-fixtures/database-recovery-content.mjs";

const invalid = { valid: false, error: "database_recovery_content_invalid" };
const receiptName = "public.faolla_platform_snapshot_restore_receipts";
const legacy = () => recoveryContentFixture({ schemaVersion: 1 });
const current = (options = {}) => recoveryContentFixture({ schemaVersion: 2, ...options });
const reject = (value, options) => assert.deepEqual(validateDatabaseRecoveryContent(value, options), invalid);

test("receipt recovery: fixed current five-table schema cannot silently replace the historical four-table contract", () => {
  assert.equal(DATABASE_RECOVERY_CONTENT_SCHEMA_VERSION, 2);
  assert.deepEqual(DATABASE_RECOVERY_LEGACY_RELATIONS, ["public.pages", "public.faolla_redemption_operations",
    "public.faolla_redemption_checkouts", "public.faolla_schema_migrations"]);
  assert.deepEqual(DATABASE_RECOVERY_RELATIONS, [...DATABASE_RECOVERY_LEGACY_RELATIONS, receiptName]);
  assert.ok(Object.isFrozen(DATABASE_RECOVERY_RELATIONS));
  assert.ok(Object.isFrozen(DATABASE_RECOVERY_LEGACY_RELATIONS));
});

test("receipt recovery: strict v1 identification preserves its version and never synthesizes a receipt-table proof", () => {
  const value = legacy(); const before = structuredClone(value);
  const result = validateDatabaseRecoveryContent(value);
  assert.equal(result.valid, true); assert.equal(result.content.schemaVersion, 1);
  assert.equal(result.content.relations.length, 4);
  assert.equal(result.content.relations.some((item) => item.name === receiptName), false);
  reject(value, { requireCurrent: true });
  assert.deepEqual(value, before);
});

test("receipt recovery: current-only validation accepts explicit five-table proof with present or absent receipts", () => {
  for (const migrated of [false, true]) for (const receipts of [false, true]) {
    const value = current({ migrated, receipts });
    const result = validateDatabaseRecoveryContent(value, { requireCurrent: true });
    assert.equal(result.valid, true); assert.equal(result.content.schemaVersion, 2);
    assert.equal(result.content.relations.length, 5);
    assert.deepEqual(result.content.relations[4], value.relations[4]);
  }
});

test("receipt recovery: changing the version label or dropping the fifth relation never upgrades a legacy archive", () => {
  reject({ ...legacy(), schemaVersion: 2 });
  reject({ ...current(), schemaVersion: 1 });
  const omitted = current(); omitted.relations.pop(); reject(omitted);
  const appended = legacy(); appended.relations.push(current().relations[4]); reject(appended);
  for (const schemaVersion of ["1", "2", 0, 3, null, false, true, undefined]) reject({ ...current(), schemaVersion });
});

test("receipt recovery: relation omission, duplication, reordering and alias substitution all fail closed", () => {
  for (const change of [
    (v) => { v.relations[4] = structuredClone(v.relations[3]); },
    (v) => { [v.relations[3], v.relations[4]] = [v.relations[4], v.relations[3]]; },
    (v) => { v.relations[4].name = "faolla_platform_snapshot_restore_receipts"; },
    (v) => { v.relations[4].name = "public.faolla_platform_snapshot_restore_receipts_backup"; },
    (v) => { v.relations.push(structuredClone(v.relations[4])); },
    (v) => { delete v.relations[4]; },
  ]) { const value = current(); change(value); reject(value); }
});

test("receipt recovery: receipt presence is independent of the old 044–047 migration registry", () => {
  for (const migrated of [false, true]) {
    const absent = current({ migrated, receipts: false }); const present = current({ migrated, receipts: true });
    assert.deepEqual(absent.migrationNames, present.migrationNames);
    assert.equal(validateDatabaseRecoveryContent(absent).valid, true);
    assert.equal(validateDatabaseRecoveryContent(present).valid, true);
    assert.throws(() => assertDatabaseRecoveryContentMatch(absent, present), { message: "database_recovery_content_mismatch" });
  }
});

test("receipt recovery: a missing table cannot substitute for a present empty table", () => {
  const absent = current(); const empty = current({ receipts: true }); empty.relations[4].rowCount = "0";
  assert.equal(validateDatabaseRecoveryContent(absent).valid, true);
  assert.equal(validateDatabaseRecoveryContent(empty).valid, true);
  assert.throws(() => assertDatabaseRecoveryContentMatch(empty, absent), { message: "database_recovery_content_mismatch" });
  for (const patch of [
    { present: false, rowCount: "0" }, { present: false, contentSha256: "a".repeat(64) },
    { present: true, rowCount: null }, { present: true, contentSha256: null },
    { present: "false" }, { present: 0 },
  ]) { const value = patch.present === true ? current({ receipts: true }) : current(); Object.assign(value.relations[4], patch); reject(value); }
});

test("receipt recovery: same receipt count with a different actor/plan/result digest is still a mismatch", () => {
  const before = current({ receipts: true });
  for (const digit of ["a", "b", "c"]) {
    const after = structuredClone(before); after.relations[4].contentSha256 = digit.repeat(64);
    assert.equal(after.relations[4].rowCount, before.relations[4].rowCount);
    assert.equal(validateDatabaseRecoveryContent(after).valid, true);
    assert.throws(() => assertDatabaseRecoveryContentMatch(after, before), { message: "database_recovery_content_mismatch" });
  }
});

test("receipt recovery: the comparison API does not accept v1 or cross-version equality even when receipts are absent", () => {
  for (const [left, right] of [[legacy(), legacy()], [legacy(), current()], [current(), legacy()]]) {
    const originals = structuredClone([left, right]);
    assert.throws(() => assertDatabaseRecoveryContentMatch(left, right), { message: "database_recovery_content_invalid" });
    assert.deepEqual([left, right], originals);
  }
  const value = current(); assert.deepEqual(assertDatabaseRecoveryContentMatch(value, structuredClone(value)), value);
});

test("receipt recovery: receipt counts and digests retain exact types rather than coercing bad evidence", () => {
  for (const rowCount of [0, 1, null, false, "01", "1 ", "-1", "1.0", "9223372036854775808"]) {
    const value = current({ receipts: true }); value.relations[4].rowCount = rowCount; reject(value);
  }
  for (const contentSha256 of [null, false, 1, "", "A".repeat(64), "g".repeat(64), "a".repeat(63), `${"a".repeat(64)}\n`]) {
    const value = current({ receipts: true }); value.relations[4].contentSha256 = contentSha256; reject(value);
  }
});

test("receipt recovery: metadata proof refuses raw receipt data and errors never echo sensitive values", () => {
  const canary = "PRIVATE-RECEIPT-ACTOR-PLAN-PAYLOAD";
  for (const field of ["rows", "actorKey", "operationId", "confirmationToken", "request", "result", "rawToken"]) {
    const value = current({ receipts: true }); value.relations[4][field] = canary;
    const result = validateDatabaseRecoveryContent(value);
    assert.deepEqual(result, invalid); assert.equal(JSON.stringify(result).includes(canary), false);
  }
  const proof = validateDatabaseRecoveryContent(current({ receipts: true })).content;
  for (const item of proof.relations) assert.deepEqual(Object.keys(item).sort(), ["contentSha256", "name", "present", "rowCount"]);
});

test("receipt recovery: SQL builders always emit current v2 and ignore caller attempts to select legacy tables/version", () => {
  const scalar = buildDatabaseRecoveryContentScalarSql(); const query = buildDatabaseRecoveryContentSql();
  assert.match(scalar, /'schemaVersion', 2/);
  assert.match(query, /'schemaVersion', 2/);
  assert.ok(query.includes(receiptName));
  let touched = false;
  const malicious = { get schemaVersion() { touched = true; throw new Error("must not inspect caller SQL options"); },
    relation: "public.pages; DROP TABLE public.pages; --" };
  assert.equal(buildDatabaseRecoveryContentScalarSql(malicious), scalar);
  assert.equal(buildDatabaseRecoveryContentSql({ schemaVersion: 1, relations: DATABASE_RECOVERY_LEGACY_RELATIONS }), query);
  assert.equal(touched, false); assert.equal(scalar.includes("DROP TABLE"), false);
  assert.equal(buildDatabaseRecoveryContentScalarSql(1), scalar);
});

test("receipt recovery: the fifth table is hashed in full before aggregation but SQL outputs no raw receipt fields", () => {
  const sql = buildDatabaseRecoveryContentSql();
  assert.ok(sql.includes('FROM "public"."faolla_platform_snapshot_restore_receipts" AS recovery_row'));
  assert.match(sql, /pg_catalog\.to_jsonb\(recovery_row\)::text/);
  // The digest SELECT is itself a quoted query_to_xml argument: its empty
  // string separator is escaped as four quotes in the enclosing SQL.
  assert.match(sql, /string_agg\(row_hash, '''' ORDER BY row_hash COLLATE "C"\)/);
  assert.match(sql, /to_regclass\('public\.faolla_platform_snapshot_restore_receipts'\)/);
  assert.equal((sql.match(/faolla:recovery-content:v2:/g) ?? []).length, 5);
  assert.doesNotMatch(sql, /faolla:recovery-content:v1:/);
  assert.doesNotMatch(sql, /\bSELECT\s+(?:recovery_row\.\*|operation_id|actor_key|confirmation_token|plan_hash|result_hash|committed_at)\b/i);
  assert.doesNotMatch(sql, /\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|CREATE TABLE|ALTER TABLE)\b/i);
});
