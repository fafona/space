import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("./platform-snapshot-integration/platform_snapshot_restore_receipts_v1.candidate.sql", import.meta.url), "utf8");
const part = (tag) => sql.slice(sql.indexOf(`as $${tag}$`), sql.indexOf(`$${tag}$;`));
const read = part("platform_snapshot_receipt_read");
const commit = part("platform_snapshot_receipt_commit");
const install = sql.slice(sql.indexOf("do $platform_snapshot_receipts_install$"), sql.indexOf("$platform_snapshot_receipts_install$;"));
const lookupAt = commit.indexOf("select * into v_existing");
const delegateAt = commit.indexOf("v_result := public.faolla_commit_platform_snapshot_restore_v1");
const replay = commit.slice(lookupAt, delegateAt);

test("receipt storage is an offline additive candidate; both earlier SQL files remain byte-for-byte frozen", async () => {
  for (const [name, hash] of [
    ["platform_snapshot_atomic_v1.candidate.sql", "838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93"],
    ["platform_snapshot_restore_v1.candidate.sql", "02519a9f591cf71e30d7f5a72d79ff8326b5fb0544be278baa03d7e974a262eb"],
  ]) {
    const bytes = await readFile(new URL(`./platform-snapshot-integration/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  }
  assert.match(sql, /OFFLINE CANDIDATE ONLY/);
  assert.ok((await readdir(new URL("./supabase-migrations/", import.meta.url))).every((name) => !name.includes("platform_snapshot_restore_receipt")));
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+public\.faolla_schema_migrations/i);
  assert.doesNotMatch(sql, /create or replace function public\.faolla_(?:read|commit)_platform_snapshot_(?:rows|restore)_v1/i);
});

test("the only new table persists eight metadata fields, never the request, backup content or result JSON", () => {
  const table = sql.slice(sql.indexOf("create table public."), sql.indexOf("v_table := 'public."));
  assert.match(table, /operation_id uuid not null/);
  for (const column of ["actor_key", "scope", "backup_id", "confirmation_token", "plan_hash", "result_hash"]) {
    assert.match(table, new RegExp(`${column} text not null`));
  }
  assert.match(table, /committed_at timestamptz not null/);
  assert.match(table, /primary key \(operation_id\)/);
  assert.doesNotMatch(table, /\bjsonb?\b|\b(?:request|result|status|expires_at)\s+\w+/i);
  assert.match(table, /and isfinite\(committed_at\)/);
  assert.doesNotMatch(sql, /\bdelete from\s+public\.faolla_platform_snapshot_restore_receipts|\btruncate\b/i);
});

test("installation refuses weakened or expanded schemas instead of silently adopting them", () => {
  assert.match(install, /to_regprocedure\('pg_catalog\.sha256\(bytea\)'\) is null/);
  assert.match(install, /relkind = 'r' and relpersistence = 'p'/);
  assert.match(install, /relowner = current_user::regrole/);
  for (const catalog of ["pg_inherits", "pg_policy", "pg_trigger", "pg_rewrite", "pg_attrdef"]) assert.match(install, new RegExp(catalog));
  assert.match(install, /attisdropped/);
  assert.match(install, /t\.typnamespace <> 'pg_catalog'::regnamespace/);
  assert.match(install, /a\.attcollation <> t\.typcollation/);
  assert.match(install, /v_columns is distinct from array\['operation_id:uuid:true::'/);
  assert.match(install, /count\(\*\) from pg_constraint where conrelid = v_table\) <> 2/);
  assert.match(install, /conkey = array\[1\]::smallint\[\]/);
  assert.match(install, /indisvalid and indisready and indisunique and indisprimary/);
  assert.match(install, /pg_get_constraintdef\(oid\)/);
  assert.match(install, /v_check is distinct from/);
  assert.match(install, /message = 'platform_snapshot_atomic_install_conflict'/);
});

test("the two service RPCs validate all identity/intent strings strictly before any receipt access", () => {
  assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]), [
    "faolla_read_platform_snapshot_restore_receipt_v1", "faolla_commit_platform_snapshot_restore_receipt_v1",
  ]);
  for (const body of [read, commit]) {
    const guard = body.slice(0, body.indexOf("perform pg_advisory_xact_lock"));
    assert.ok(guard.includes("p_operation_id !~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'"));
    assert.ok(guard.includes("p_actor_key !~ '^[0-9a-f]{64}$'"));
    assert.match(guard, /p_scope not in \('user_manage', 'support_messages'\)/);
    assert.match(guard, /p_backup_id <> btrim\(p_backup_id\)/);
    assert.match(guard, /char_length\(p_backup_id\) not between 1 and 500/);
    assert.ok(guard.includes("p_confirmation_token !~ '^v1\\.[0-9a-f]{64}$'"));
    assert.doesNotMatch(body, /p_actor_key\s*:=|p_operation_id\s*:=|lower\(p_|btrim\(p_actor_key/);
  }
});

test("lookup coordinates with commits, fully binds identity and exposes only metadata or unknown", () => {
  const lock = read.indexOf("perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));");
  const select = read.indexOf("select * into v_row"); assert.ok(lock >= 0 && select > lock);
  for (const [column, parameter] of [["operation_id", "p_operation_id::uuid"], ["actor_key", "p_actor_key"],
    ["scope", "p_scope"], ["backup_id", "p_backup_id"], ["confirmation_token", "p_confirmation_token"]]) assert.ok(read.includes(`${column} = ${parameter}`));
  assert.match(read, /if not found then[\s\S]*return jsonb_build_object\('version', 1, 'receipt', null\);/);
  assert.doesNotMatch(read, /faolla_(?:read|commit)_platform_snapshot_restore_v1|\b(?:insert into|update|delete from)\b/i);
  assert.doesNotMatch(read, /'not_started'|'retrySafe'|'result'|'replayed'/);
  assert.match(read, /return jsonb_build_object\('version', 1, 'receipt', v_receipt\)/);
});

test("the complete incoming plan and bindings share one 64 MiB budget before locking and hashing", () => {
  const guard = commit.slice(0, commit.indexOf("v_plan_hash :="));
  for (const value of ["p_catalog_expected", "p_target_expected", "p_writes"]) assert.match(guard, new RegExp(`jsonb_typeof\\(${value}\\) is distinct from 'array'`));
  assert.match(guard, /jsonb_array_length\(p_catalog_expected\) <> 2/);
  assert.match(guard, /jsonb_array_length\(p_target_expected\) <> v_target_count/);
  assert.match(guard, /jsonb_array_length\(p_writes\) <> v_target_count/);
  assert.match(guard, /when 'user_manage' then 6 else 3/);
  assert.match(guard, /octet_length\(jsonb_build_object\('operationId', p_operation_id, 'actorKey', p_actor_key, 'scope', p_scope,/);
  assert.match(guard, /'targetExpected', p_target_expected, 'writes', p_writes\)::text\)::bigint > 67108864/);
});

test("plan hashing is actual submitted canonical JSONB and result hashing uses only the actual target receipt", () => {
  assert.match(commit, /v_plan_hash := encode\(pg_catalog\.sha256\(convert_to\(jsonb_build_object\(\s*'catalogExpected', p_catalog_expected, 'targetExpected', p_target_expected, 'writes', p_writes\)::text, 'UTF8'\)\), 'hex'\)/);
  assert.match(commit, /v_result_hash := encode\(pg_catalog\.sha256\(convert_to\(\(v_result -> 'target'\)::text, 'UTF8'\)\), 'hex'\)/);
  assert.doesNotMatch(sql, /\bp_(?:plan_hash|result_hash|result)\b|\bdigest\(/);
  assert.ok(commit.indexOf("v_result_hash :=") > delegateAt);
});

test("one shared lock precedes receipt lookup; identical binding and plan replay before target access", () => {
  const lock = commit.indexOf("perform pg_advisory_xact_lock(hashtextextended('faolla-platform-snapshot-atomic-v1', 0));");
  assert.ok(lock >= 0 && lookupAt > lock && delegateAt > lookupAt);
  assert.match(replay, /where operation_id = p_operation_id::uuid for update/);
  for (const [column, parameter] of [["actor_key", "p_actor_key"], ["scope", "p_scope"], ["backup_id", "p_backup_id"],
    ["confirmation_token", "p_confirmation_token"], ["plan_hash", "v_plan_hash"]]) assert.ok(replay.includes(`v_existing.${column} is distinct from ${parameter}`));
  assert.match(replay, /raise exception 'platform_snapshot_atomic_conflict'/);
  assert.match(replay, /return jsonb_build_object\('version', 1, 'receipt', v_receipt, 'result', null, 'replayed', true\)/);
  assert.doesNotMatch(replay, /faolla_read_platform_snapshot|insert into|delete from|update public\./i);
});

test("the first execution calls the frozen restore once and inserts immutable metadata in the same transaction", () => {
  assert.equal((commit.match(/public\.faolla_commit_platform_snapshot_restore_v1\(/g) ?? []).length, 1);
  const insert = commit.indexOf("insert into public.faolla_platform_snapshot_restore_receipts");
  assert.ok(insert > delegateAt);
  assert.match(commit.slice(insert), /values\(p_operation_id::uuid, p_actor_key, p_scope, p_backup_id, p_confirmation_token, v_plan_hash, v_result_hash, v_committed_at\)/);
  assert.doesNotMatch(commit, /on conflict|\bupdate\s+public\.faolla_platform_snapshot_restore_receipts/i);
  assert.match(commit, /'receipt', v_receipt, 'result', v_result, 'replayed', false/);
  assert.doesNotMatch(commit, /\b(?:commit|rollback)\s*;/i);
});

test("receipt AFTER effects cannot change source, target or recorded binding unnoticed", () => {
  const insert = commit.indexOf("insert into public.faolla_platform_snapshot_restore_receipts");
  const reread = commit.indexOf("v_after := public.faolla_read_platform_snapshot_restore_v1(p_scope);");
  const lookup = commit.indexOf("select * into v_saved");
  assert.ok(reread > insert && lookup > reread);
  assert.match(commit, /if v_after is distinct from v_result then raise exception 'platform_snapshot_atomic_write_unconfirmed'/);
  const checks = commit.slice(lookup, commit.indexOf("v_receipt :=", lookup));
  for (const column of ["operation_id", "actor_key", "scope", "backup_id", "confirmation_token", "plan_hash", "result_hash", "committed_at"]) {
    assert.match(checks, new RegExp(`v_saved\\.${column} is distinct from`));
  }
  assert.match(checks, /if not found/);
  assert.match(commit, /if v_restore_returned then\s*v_error := 'platform_snapshot_atomic_write_unconfirmed'/);
  assert.match(commit, /raise exception using errcode = 'P0001', message = v_error/);
});

test("all direct table and column grants are revoked while only the two new RPCs are service-executable", () => {
  assert.match(sql, /alter table public\.faolla_platform_snapshot_restore_receipts enable row level security/);
  assert.doesNotMatch(sql, /create policy|grant\s+(?:select|insert|update|delete|all)\b[^;]*on\s+(?:table\s+)?public\.faolla_platform_snapshot_restore_receipts/i);
  assert.match(sql, /revoke all on table public\.faolla_platform_snapshot_restore_receipts from public, anon, authenticated, service_role/);
  assert.match(sql, /aclexplode\(a\.attacl\)/);
  assert.match(sql, /revoke all \(%I\) on table public\.faolla_platform_snapshot_restore_receipts from %I cascade/);
  assert.match(sql, /aclexplode\(coalesce\(metadata\.relacl, acldefault\('r', metadata\.relowner\)\)\)/);
  for (const signature of ["faolla_read_platform_snapshot_restore_receipt_v1(text,text,text,text,text)",
    "faolla_commit_platform_snapshot_restore_receipt_v1(text,text,text,text,text,jsonb,jsonb,jsonb)"]) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role;`));
  }
  assert.equal((sql.match(/security definer/g) ?? []).length, 2);
  assert.equal((sql.match(/set search_path = pg_catalog, public/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /(?:grant|revoke)[^;]*on function public\.faolla_(?:read|commit)_platform_snapshot_(?:rows|restore)_v1/i);
});

test("only fixed errors leave the candidate and receipt lookup is not advertised as replay authorization", () => {
  assert.doesNotMatch(sql, /\bsqlerrm\b|using[^;]*\b(?:detail|hint)\s*=/i);
  assert.doesNotMatch(sql, /'retrySafe'\s*,\s*true|'not_started'|\bfor attempt\b|\bwhile\b/);
  assert.match(sql, /Missing is\s*\n\s*-- UNKNOWN/);
  assert.match(sql, /No cleanup\/TTL/);
  assert.match(read, /v_error := 'platform_snapshot_atomic_store_corrupt'/);
  assert.match(commit, /elsif v_restore_started then/);
  assert.match(commit, /if v_error <> 'platform_snapshot_atomic_conflict' then v_error := 'platform_snapshot_atomic_write_unconfirmed'/);
});

test("real receipt runner fixes the empty local target and never starts, resets or selects an external database", async () => {
  const runner = await readFile(new URL("./platform-snapshot-integration/receipts-run.ts", import.meta.url), "utf8");
  assert.match(runner, /const database = "faolla_platform_snapshot_receipts_test"/);
  assert.match(runner, /const port = "56501"/);
  assert.match(runner, /PLATFORM_SNAPSHOT_RECEIPTS_ALLOW_DISPOSABLE_DATABASE, "1"/);
  assert.match(runner, /assertDedicatedIdentity\(actual, await realpath\(expectedPath\)\)/);
  assert.match(runner, /assertEmpty\(await query/);
  assert.ok(runner.indexOf("assertEmpty(await query") < runner.indexOf("for (const candidate of candidates) await query(candidate)"));
  assert.match(runner, /PGHOSTADDR: "127.0.0.1"/);
  assert.match(runner, /PGPASSFILE: process.platform === "win32" \? "NUL" : "\/dev\/null"/);
  assert.match(runner, /windowsHide: true/);
  assert.doesNotMatch(runner, /spawn\([^\n]*(?:pg_ctl|postgres|createdb|dropdb)|(?:drop|create) database\b|dotenv|\.env\.local/);
});

test("receipt integration exercises real adapters and added fault checks behind the guarded setup", async () => {
  const runner = await readFile(new URL("./platform-snapshot-integration/receipts-run.ts", import.meta.url), "utf8");
  for (const call of ["runReceiptFaultChecks({ query, execute, candidate: candidates[2] })",
    "runReceiptAdapterChecks({ query, rpcClient: receiptClient })"]) {
    assert.ok(runner.indexOf(call) > runner.indexOf("for (const candidate of candidates) await query(candidate)"));
  }
  assert.match(runner, /Object\.hasOwn\(argumentNames, name\)/);
  assert.match(runner, /assert\.deepEqual\(Object\.keys\(input\)\.sort\(\), \[\.\.\.keys\]\.sort\(\)\)/);
  assert.match(runner, /set role service_role; select public\.\$\{name\}/);
  assert.match(runner, /PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=12000"/);
});
