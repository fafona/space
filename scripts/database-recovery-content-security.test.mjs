import assert from "node:assert/strict";
import test from "node:test";

import {
  DATABASE_RECOVERY_MIGRATIONS,
  DATABASE_RECOVERY_RELATIONS,
  assertDatabaseRecoveryContentMatch,
  buildDatabaseRecoveryContentScalarSql,
  buildDatabaseRecoveryContentSql,
  validateDatabaseRecoveryContent,
} from "./database-recovery-content-contract.mjs";

const INVALID = { valid: false, error: "database_recovery_content_invalid" };
const versions = Object.keys(DATABASE_RECOVERY_MIGRATIONS);

function fixture(applied = versions) {
  const appliedSet = new Set(applied);
  return {
    schemaVersion: 2,
    relations: DATABASE_RECOVERY_RELATIONS.map((name, index) => {
      const present = index === 0 || index === 3 || index === 4 ||
        appliedSet.has(index === 1 ? "202609080046" : "202609080047");
      return { name, present, rowCount: present ? "10" : null,
        contentSha256: present ? "a".repeat(64) : null };
    }),
    migrationNames: Object.fromEntries(versions.map((version) =>
      [version, appliedSet.has(version) ? DATABASE_RECOVERY_MIGRATIONS[version] : null])),
  };
}

function rejects(value, description) {
  assert.deepEqual(validateDatabaseRecoveryContent(value), INVALID, description);
}

test("recovery security: malformed proof containers never coerce into valid evidence", () => {
  for (const value of [null, undefined, false, true, 0, 1, "", "{}", [], [fixture()]]) rejects(value);
  for (const schemaVersion of ["1", "2", 0, 1, 3, null, undefined, true, [], {}]) {
    rejects({ ...fixture(), schemaVersion });
  }
  for (const relations of [null, undefined, false, {}, "public.pages", []]) {
    rejects({ ...fixture(), relations });
  }
  for (const migrationNames of [null, undefined, false, [], "{}", {}]) {
    rejects({ ...fixture(), migrationNames });
  }
});

test("recovery security: every relation requires exact typed fields, no aliases or raw rows", () => {
  for (let index = 0; index < DATABASE_RECOVERY_RELATIONS.length; index += 1) {
    for (const field of ["name", "present", "rowCount", "contentSha256"]) {
      const omitted = fixture();
      delete omitted.relations[index][field];
      rejects(omitted, `${index}:missing:${field}`);
    }
    for (const present of [0, 1, "true", "false", null, undefined, [], {}]) {
      const value = fixture(); value.relations[index].present = present; rejects(value);
    }
    for (const extra of ["rows", "request", "rawToken", "content_sha256", "row_count"]) {
      const value = fixture(); value.relations[index][extra] = "private-canary"; rejects(value);
    }
  }
});

test("recovery security: counts remain canonical decimal strings within PostgreSQL bigint", () => {
  for (const count of ["0", "1", "9007199254740992", "9223372036854775807"]) {
    const value = fixture(); value.relations[0].rowCount = count;
    const result = validateDatabaseRecoveryContent(value);
    assert.equal(result.valid, true, count);
    assert.equal(result.content.relations[0].rowCount, count);
  }
  for (const count of [0, 1, NaN, Infinity, -Infinity, 1n, false, true, null, undefined,
    [], {}, "", "00", "01", "+1", "-0", "-1", " 1", "1 ", "1\n", "1\r\n", "1.0", "1e3",
    "1_000", "1,000", "０", "١", "9223372036854775808", "99999999999999999999"]) {
    const value = fixture(); value.relations[0].rowCount = count; rejects(value);
  }
});

test("recovery security: digests are exact lowercase 32-byte hex, never coercible values", () => {
  for (const digest of [null, undefined, 0, false, [], {}, "", "a".repeat(63), "a".repeat(65),
    "A".repeat(64), "g".repeat(64), `sha256:${"a".repeat(64)}`, `${"a".repeat(64)}\n`,
    ` ${"a".repeat(64)}`, { toString: () => "a".repeat(64) }]) {
    const value = fixture(); value.relations[0].contentSha256 = digest; rejects(value);
  }
});

test("recovery security: absent and empty relations cannot substitute for each other", () => {
  for (const index of [1, 2]) {
    for (const field of ["rowCount", "contentSha256"]) {
      for (const payload of [undefined, "", "0", 0, false, "a".repeat(64)]) {
        const value = fixture([]); value.relations[index][field] = payload; rejects(value);
      }
    }
  }
  for (const index of [0, 3]) {
    const value = fixture([]);
    Object.assign(value.relations[index], { present: false, rowCount: null, contentSha256: null });
    rejects(value, `required relation ${index}`);
  }
  const empty = fixture(); empty.relations[1].rowCount = "0"; empty.relations[2].rowCount = "0";
  assert.equal(validateDatabaseRecoveryContent(empty).valid, true);
  assert.throws(() => assertDatabaseRecoveryContentMatch(empty, fixture([])),
    { message: "database_recovery_content_mismatch" });
});

test("recovery security: exhaustive migration states enforce only actual dependencies", () => {
  for (let mask = 0; mask < 16; mask += 1) {
    const applied = versions.filter((_, index) => (mask & (1 << index)) !== 0);
    const value = fixture(applied);
    const order = applied.includes("202609080045");
    const operation = applied.includes("202609080046");
    const checkout = applied.includes("202609080047");
    assert.equal(validateDatabaseRecoveryContent(value).valid,
      (!operation || order) && (!checkout || operation), `migration mask ${mask}`);
  }
});

test("recovery security: migration registry count cannot be smaller than its claimed applied rows", () => {
  for (const applied of [[], ["202609080044"], ["202609080045"],
    ["202609080045", "202609080046"], versions]) {
    for (let count = 0; count <= versions.length + 1; count += 1) {
      const value = fixture(applied); value.relations[3].rowCount = String(count);
      assert.equal(validateDatabaseRecoveryContent(value).valid, count >= applied.length,
        `registry=${count}, applied=${applied.join(",")}`);
    }
  }
});

test("recovery security: migration versions and names cannot be normalized or silently dropped", () => {
  for (const version of versions) {
    for (const name of [undefined, 0, false, true, [], {}, "", ` ${DATABASE_RECOVERY_MIGRATIONS[version]}`,
      `${DATABASE_RECOVERY_MIGRATIONS[version]}\n`, DATABASE_RECOVERY_MIGRATIONS[version].toUpperCase()]) {
      const value = fixture(); value.migrationNames[version] = name; rejects(value);
    }
    const value = fixture();
    value.migrationNames[`${version} `] = value.migrationNames[version];
    delete value.migrationNames[version]; rejects(value);
  }
});

test("recovery security: ordered relation roster cannot be renamed, duplicated or sparsified", () => {
  for (let index = 0; index < DATABASE_RECOVERY_RELATIONS.length; index += 1) {
    for (const name of [DATABASE_RECOVERY_RELATIONS[index].toUpperCase(),
      `${DATABASE_RECOVERY_RELATIONS[index]} `, 'public.pages; DROP TABLE public.pages; --', null, {}]) {
      const value = fixture(); value.relations[index].name = name; rejects(value);
    }
    const duplicate = fixture(); duplicate.relations[index] = duplicate.relations[(index + 1) % DATABASE_RECOVERY_RELATIONS.length]; rejects(duplicate);
    const sparse = fixture(); delete sparse.relations[index]; rejects(sparse);
  }
});

test("recovery security: normalized proof is detached, does not mutate or retain input objects", () => {
  const value = fixture(); const before = structuredClone(value);
  const result = validateDatabaseRecoveryContent(value);
  assert.equal(result.valid, true);
  assert.deepEqual(value, before);
  assert.notEqual(result.content, value);
  assert.notEqual(result.content.relations, value.relations);
  assert.notEqual(result.content.migrationNames, value.migrationNames);
  result.content.relations[0].rowCount = "42";
  result.content.migrationNames["202609080044"] = null;
  assert.deepEqual(value, before);
});

test("recovery security: matching canonicalizes object keys but compares each domain count", () => {
  const original = fixture();
  const reordered = { migrationNames: Object.fromEntries(Object.entries(original.migrationNames).reverse()),
    relations: original.relations.map((item) => Object.fromEntries(Object.entries(item).reverse())), schemaVersion: 2 };
  assert.deepEqual(assertDatabaseRecoveryContentMatch(reordered, original), original);
  for (let index = 0; index < DATABASE_RECOVERY_RELATIONS.length; index += 1) {
    const value = fixture(); value.relations[index].rowCount = "11";
    assert.throws(() => assertDatabaseRecoveryContentMatch(value, original),
      { message: "database_recovery_content_mismatch" });
  }
  const qrMigrationMissing = fixture(); qrMigrationMissing.migrationNames["202609080044"] = null;
  assert.throws(() => assertDatabaseRecoveryContentMatch(qrMigrationMissing, original),
    { message: "database_recovery_content_mismatch" });
});

test("recovery security: all invalid and mismatch errors have fixed value-free payloads", () => {
  const secret = "private@example.invalid QR_TOKEN_PRIVATE INSERT INTO public.pages member-original-request";
  const malformed = fixture(); malformed.relations[0].rowCount = secret;
  assert.deepEqual(validateDatabaseRecoveryContent(malformed), INVALID);
  for (const [actual, expected, code] of [
    [malformed, fixture(), "database_recovery_content_invalid"],
    [fixture(), { request: secret }, "database_recovery_content_invalid"],
    [fixture(), { ...fixture(), relations: fixture().relations.map((item) => ({ ...item, contentSha256: "b".repeat(64) })) },
      "database_recovery_content_mismatch"],
  ]) {
    assert.throws(() => assertDatabaseRecoveryContentMatch(actual, expected), (error) => {
      assert.equal(error.message, code);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.stack, /private@example|QR_TOKEN_PRIVATE|INSERT INTO public\.pages/);
      return true;
    });
  }
});

test("recovery security: SQL target selection is immutable and ignores caller-supplied identifiers", () => {
  assert.equal(Object.isFrozen(DATABASE_RECOVERY_RELATIONS), true);
  assert.equal(Object.isFrozen(DATABASE_RECOVERY_MIGRATIONS), true);
  assert.throws(() => { DATABASE_RECOVERY_RELATIONS[0] = "auth.users"; }, TypeError);
  assert.throws(() => { DATABASE_RECOVERY_MIGRATIONS["202609080047"] = "spoofed"; }, TypeError);
  const payload = "public.pages; COPY auth.users TO PROGRAM 'private-command'; --";
  const scalar = buildDatabaseRecoveryContentScalarSql();
  assert.equal(buildDatabaseRecoveryContentScalarSql(payload), scalar);
  assert.equal(buildDatabaseRecoveryContentSql(payload), `SELECT ${scalar} AS recovery_content;`);
  assert.doesNotMatch(scalar, /private-command|auth\.users|\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|COPY)\b/i);
  assert.equal((scalar.match(/query_to_xml\(/g) ?? []).length, 5);
  assert.equal((scalar.match(/FROM "public"\."(?:pages|faolla_redemption_operations|faolla_redemption_checkouts|faolla_schema_migrations|faolla_platform_snapshot_restore_receipts)" AS recovery_row/g) ?? []).length, 5);
  assert.doesNotMatch(scalar, /SELECT\s+\*/i);
});
