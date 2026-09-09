import test from "node:test";
import assert from "node:assert/strict";
import { DATABASE_RECOVERY_RELATIONS, DATABASE_RECOVERY_MIGRATIONS, buildDatabaseRecoveryContentSql,
  buildDatabaseRecoveryReadOnlyPsqlArgs, validateDatabaseRecoveryContent, assertDatabaseRecoveryContentMatch } from "./database-recovery-content-contract.mjs";

function proof({ migrated = true } = {}) {
  return { schemaVersion: 2,
    relations: DATABASE_RECOVERY_RELATIONS.map((name, i) => ({ name, present: migrated || i === 0 || i === 3,
      rowCount: migrated && i === 3 ? "4" : migrated || i === 0 || i === 3 ? "0" : null, contentSha256: migrated || i === 0 || i === 3 ? "a".repeat(64) : null })),
    migrationNames: Object.fromEntries(Object.entries(DATABASE_RECOVERY_MIGRATIONS).map(([key, value]) => [key, migrated ? value : null])),
  };
}
test("recovery proof preserves explicit pre-migration absence and post-migration empty tables", () => {
  for (const migrated of [true, false]) assert.deepEqual(validateDatabaseRecoveryContent(proof({ migrated })).content, proof({ migrated }));
  assert.throws(() => assertDatabaseRecoveryContentMatch(proof(), proof({ migrated: false })), /mismatch/);
});
test("all protected relations are required exactly once and in fixed order", () => {
  for (const change of [p => p.relations.pop(), p => p.relations.reverse(), p => p.relations.push(p.relations[0]),
    p => { p.relations[0].name = 'public.other'; }, p => { p.rawRows = []; }, p => { p.relations[0].rows = []; }]) {
    const value = proof(); change(value); assert.equal(validateDatabaseRecoveryContent(value).valid, false);
  }
});
test("recovery proof strictly validates counts, hashes and absent markers", () => {
  for (const [field, invalid] of [['rowCount', -1], ['rowCount', '01'], ['rowCount', '9223372036854775808'],
    ['rowCount', '1.0'], ['rowCount', null], ['contentSha256', ''], ['contentSha256', 'A'.repeat(64)], ['present', 1]]) {
    const value = proof(); value.relations[0][field] = invalid; assert.equal(validateDatabaseRecoveryContent(value).valid, false);
  }
  const absent = proof({ migrated: false }); absent.relations[1].rowCount = '0';
  assert.equal(validateDatabaseRecoveryContent(absent).valid, false);
});
test("migration and relation presence must agree without silently adopting partial schemas", () => {
  for (const change of [p => { p.migrationNames['202609080046'] = null; },
    p => { p.migrationNames['202609080045'] = null; }, p => { p.migrationNames['202609080047'] = 'wrong'; },
    p => { delete p.migrationNames['202609080044']; }, p => { p.migrationNames['999'] = null; },
    p => { Object.assign(p.relations[2], { present: false, rowCount: null, contentSha256: null }); }]) {
    const value = proof(); change(value); assert.equal(validateDatabaseRecoveryContent(value).valid, false);
  }
});
test("source/restored content match compares every digest even with identical row counts", () => {
  const original = proof(); assert.deepEqual(assertDatabaseRecoveryContentMatch(original, structuredClone(original)), original);
  for (let i = 0; i < DATABASE_RECOVERY_RELATIONS.length; i += 1) {
    const restored = proof(); restored.relations[i].contentSha256 = 'b'.repeat(64);
    assert.throws(() => assertDatabaseRecoveryContentMatch(restored, original), /^Error: database_recovery_content_mismatch$/);
  }
  assert.throws(() => assertDatabaseRecoveryContentMatch(null, original), /^Error: database_recovery_content_invalid$/);
});
test("recovery SQL has only fixed targets and hashes rows before sorted aggregation", () => {
  const sql = buildDatabaseRecoveryContentSql();
  for (const name of DATABASE_RECOVERY_RELATIONS) assert.ok(sql.includes(name));
  assert.match(sql, /pg_catalog\.to_jsonb\(recovery_row\)/);
  assert.match(sql, /string_agg\(row_hash, '''' ORDER BY row_hash COLLATE "C"\)/);
  assert.match(sql, /pg_catalog\.sha256/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|COPY)\b/);
  assert.match(sql, /AS recovery_content;/);
});

test("psql read-only wrapper keeps SELECT and COMMIT in independent command arguments", () => {
  const sql = buildDatabaseRecoveryContentSql();
  const args = buildDatabaseRecoveryReadOnlyPsqlArgs(sql);
  assert.equal(args.length, 12);
  for (let i = 0; i < args.length; i += 2) assert.equal(args[i], '--command');
  assert.match(args[1], /REPEATABLE READ READ ONLY/);
  assert.equal(args[9], sql);
  assert.equal(args[11], 'COMMIT;');
  assert.throws(() => buildDatabaseRecoveryReadOnlyPsqlArgs(''), /database_recovery_query_invalid/);
});
