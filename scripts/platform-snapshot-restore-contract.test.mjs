import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("./platform-snapshot-integration/platform_snapshot_restore_v1.candidate.sql", import.meta.url), "utf8");
const read = sql.slice(sql.indexOf("as $platform_snapshot_restore_read$"), sql.indexOf("$platform_snapshot_restore_read$;"));
const commit = sql.slice(sql.indexOf("as $platform_snapshot_restore_commit$"), sql.indexOf("$platform_snapshot_restore_commit$;"));

test("restore is an additive offline candidate and leaves the frozen v1 primitive and formal registry unchanged", async () => {
  const original = await readFile(new URL("./platform-snapshot-integration/platform_snapshot_atomic_v1.candidate.sql", import.meta.url));
  assert.equal(createHash("sha256").update(original).digest("hex"), "838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93");
  const migrations = await readdir(new URL("./supabase-migrations/", import.meta.url));
  assert.ok(migrations.every((name) => !name.includes("platform_snapshot_restore")));
  assert.match(sql, /OFFLINE CANDIDATE ONLY/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+public\.faolla_schema_migrations/i);
  assert.doesNotMatch(sql, /create or replace function public\.faolla_(?:read|commit)_platform_snapshot_rows_v1/i);
  assert.match(sql, /to_regprocedure\('public\.faolla_read_platform_snapshot_rows_v1\(text\)'\) is null/);
  assert.match(sql, /to_regprocedure\('public\.faolla_commit_platform_snapshot_rows_v1\(text,jsonb,jsonb\)'\) is null/);
});

test("only user_manage and support_messages restores are exposed with an explicit catalog/target bundle", () => {
  const names = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(names, ["faolla_read_platform_snapshot_restore_v1", "faolla_commit_platform_snapshot_restore_v1"]);
  assert.match(read, /p_scope is null or p_scope not in \('user_manage', 'support_messages'\)/);
  assert.match(commit, /when 'user_manage' then v_target_count := 6;/);
  assert.match(commit, /when 'support_messages' then v_target_count := 3;/);
  assert.equal((commit.match(/when '/g) ?? []).length, 2);
  assert.match(read, /return jsonb_build_object\('version', 1, 'scope', p_scope, 'catalog', v_catalog, 'target', v_target\)/);
  assert.match(sql, /p_scope text, p_catalog_expected jsonb, p_target_expected jsonb, p_writes jsonb/);
});

test("source and target reads share the original global writer lock and acquire catalog before target", () => {
  const lock = "perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));";
  assert.equal((sql.match(/perform pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.ok(read.indexOf(lock) >= 0);
  const catalog = read.indexOf("v_catalog := public.faolla_read_platform_snapshot_rows_v1('backup_catalog');");
  const target = read.indexOf("v_target := public.faolla_read_platform_snapshot_rows_v1(p_scope);");
  assert.ok(catalog > read.indexOf(lock) && target > catalog);
  assert.ok(commit.indexOf(lock) >= 0);
  assert.ok(commit.indexOf("v_catalog_before := public.faolla_read_platform_snapshot_rows_v1('backup_catalog');") > commit.indexOf(lock));
  assert.doesNotMatch(sql, /hashtextextended\('faolla-platform-snapshot-restore/i,
    "a separate advisory namespace would not coordinate with ordinary writers");
});

test("the complete two-row catalog dependency and full target vectors are bounded before delegation", () => {
  assert.match(commit, /v_catalog_slugs text\[\] := array\['__platform_admin_data_backup__', '__platform_admin_data_backup_backup__'\]/);
  for (const value of ["p_catalog_expected", "p_target_expected", "p_writes"]) {
    assert.match(commit, new RegExp(`jsonb_typeof\\(${value}\\) is distinct from 'array'`));
  }
  assert.match(commit, /jsonb_array_length\(p_catalog_expected\) <> 2/);
  assert.match(commit, /jsonb_array_length\(p_target_expected\) <> v_target_count/);
  assert.match(commit, /jsonb_array_length\(p_writes\) <> v_target_count/);
  assert.match(commit, /octet_length\(p_catalog_expected::text\)::bigint \+ octet_length\(p_target_expected::text\)::bigint\s*\+ octet_length\(p_writes::text\)::bigint > 67108864/);
  assert.ok(commit.indexOf("67108864") < commit.indexOf("perform pg_advisory_xact_lock"));
});

test("source rows require exact keys, ordered slugs, unique UUIDs, array payloads and finite nullable versions", () => {
  assert.match(commit, /v_entry - array\['slug', 'row'\] <> '\{\}'::jsonb/);
  assert.match(commit, /v_expected_row - array\['id', 'blocks', 'updatedAt'\] <> '\{\}'::jsonb/);
  assert.match(commit, /v_entry ->> 'slug' is distinct from v_catalog_slugs\[v_index \+ 1\]/);
  assert.match(commit, /jsonb_typeof\(v_expected_row -> 'id'\) is distinct from 'string'/);
  assert.ok(commit.includes("'^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'"));
  assert.match(commit, /\(v_expected_row ->> 'id'\) = any\(v_seen_ids\)/);
  assert.match(commit, /jsonb_typeof\(v_expected_row -> 'blocks'\) is distinct from 'array'/);
  assert.match(commit, /v_expected_row -> 'updatedAt' is distinct from 'null'::jsonb/);
  assert.match(commit, /not isfinite\(v_expected_timestamp\)/);
  assert.ok(commit.indexOf("v_seen_ids := array_append") < commit.indexOf("perform pg_advisory_xact_lock"));
});

test("a missing catalog can be observed but two missing source copies cannot start a restore", () => {
  assert.doesNotMatch(read, /v_present_count|jsonb_array_length.*catalog|raise exception.*not_found/);
  assert.match(commit, /if v_present_count = 0 then raise exception 'platform_snapshot_atomic_invalid_request'; end if;/);
  assert.ok(commit.indexOf("if v_present_count = 0") < commit.indexOf("perform pg_advisory_xact_lock"));
  assert.match(commit, /if v_expected_row = 'null'::jsonb or v_actual_row = 'null'::jsonb then/);
  assert.match(commit, /v_expected_row is distinct from v_actual_row then raise exception 'platform_snapshot_atomic_conflict'/);
});

test("source id/content/timestamp CAS must succeed before the sole target commit", () => {
  const write = commit.indexOf("v_target_saved := public.faolla_commit_platform_snapshot_rows_v1(p_scope, p_target_expected, p_writes);");
  assert.ok(write >= 0);
  const before = commit.slice(0, write);
  assert.match(before, /v_expected_row ->> 'id' is distinct from v_actual_row ->> 'id'/);
  assert.match(before, /v_expected_row -> 'blocks' is distinct from v_actual_row -> 'blocks'/);
  assert.match(before, /v_expected_timestamp is distinct from v_actual_timestamp/);
  assert.equal((commit.match(/public\.faolla_commit_platform_snapshot_rows_v1\(/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /^\s*(?:insert into|update|delete from)\s+(?:public\.)?pages\b/im);
  assert.doesNotMatch(commit, /faolla_commit_platform_snapshot_rows_v1\('backup_catalog'/);
});

test("post-commit source corruption or target receipt drift throws inside the same outer transaction", () => {
  const write = commit.indexOf("v_target_saved := public.faolla_commit_platform_snapshot_rows_v1(");
  const finalRead = commit.indexOf("v_after := public.faolla_read_platform_snapshot_restore_v1(p_scope);");
  const finalCheck = commit.indexOf("if v_after -> 'catalog' is distinct from v_catalog_before");
  const returns = commit.indexOf("return v_after;");
  assert.ok(write >= 0 && finalRead > write && finalCheck > finalRead && returns > finalCheck);
  assert.match(commit.slice(finalCheck, returns), /v_after -> 'target' is distinct from v_target_saved/);
  assert.match(commit.slice(finalCheck, returns), /raise exception 'platform_snapshot_atomic_write_unconfirmed'/);
  assert.match(commit.slice(returns), /exception when others then[\s\S]*raise exception using errcode = 'P0001', message = v_error/);
  assert.doesNotMatch(commit, /\b(?:commit|rollback)\s*;/i, "no nested transaction control may escape exception rollback");
});

test("restore ACLs converge to service-only without changing v1 or any existing table grants", () => {
  assert.equal((sql.match(/security definer/g) ?? []).length, 2);
  assert.equal((sql.match(/set search_path = pg_catalog, public/g) ?? []).length, 2);
  assert.equal((sql.match(/set timezone = 'UTC'/g) ?? []).length, 2);
  for (const signature of ["faolla_read_platform_snapshot_restore_v1(text)", "faolla_commit_platform_snapshot_restore_v1(text, jsonb, jsonb, jsonb)"]) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role;`));
  }
  assert.match(sql, /aclexplode\(coalesce\(metadata\.proacl, pg_catalog\.acldefault\('f', metadata\.proowner\)\)\)/);
  assert.match(sql, /where metadata\.oid = v_function and acl\.grantee <> metadata\.proowner/);
  assert.match(sql, /from %I cascade', v_function, v_grantee\.rolname/);
  assert.doesNotMatch(sql, /(?:grant|revoke)[^;]+public\.faolla_(?:read|commit)_platform_snapshot_rows_v1/i);
  assert.doesNotMatch(sql, /(?:grant|revoke)[^;]+on (?:table )?public\.pages|create\s+(?:unique\s+)?index|(?:create|alter|drop)\s+(?:table|trigger|policy)/i);
});

test("only fixed errors leave either function and no retry or compensation loop is introduced", () => {
  assert.match(commit, /get stacked diagnostics v_error = message_text/);
  assert.match(read, /get stacked diagnostics v_error = message_text/);
  assert.match(commit, /if v_target_commit_started then/);
  assert.match(commit, /v_error := 'platform_snapshot_atomic_write_unconfirmed'/);
  assert.match(sql, /not a durable restore receipt or an ABA fence/);
  assert.doesNotMatch(sql, /using[^;]*\b(?:detail|hint)\s*=/i);
  assert.doesNotMatch(sql, /return\s+jsonb_build_object\('error'|\bwhile\b|\bfor attempt\b|sqlerrm/i);
});
