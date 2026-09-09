import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const sql = await readFile(new URL("./platform-snapshot-integration/platform_snapshot_atomic_v1.candidate.sql", import.meta.url), "utf8");
const scopes = {
  user_manage: ["__platform_merchant_config_archive__", "__platform_merchant_config_archive_backup__",
    "__platform_merchant_snapshot__", "__platform_merchant_snapshot_backup__", "__platform_merchant_snapshot_history__", "__platform_merchant_snapshot_history_backup__"],
  support_messages: ["__platform_support_inbox__", "__platform_support_inbox_history__", "__platform_support_inbox_history_backup__"],
  backup_catalog: ["__platform_admin_data_backup__", "__platform_admin_data_backup_backup__"],
};

test("offline candidate is not an automatic migration and never edits the registry", async () => {
  const migrations = await readdir(new URL("./supabase-migrations/", import.meta.url));
  assert.ok(migrations.every((name) => !name.includes("platform_snapshot_atomic")));
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+public\.faolla_schema_migrations/i);
  assert.match(sql, /OFFLINE CANDIDATE ONLY/);
});

test("both RPCs independently restrict complete sorted physical sets to exactly three scopes and eleven slugs", () => {
  assert.equal((sql.match(/create or replace function public\.faolla_/g) ?? []).length, 2);
  assert.match(sql, /faolla_read_platform_snapshot_rows_v1\(p_scope text\)/);
  assert.match(sql, /faolla_commit_platform_snapshot_rows_v1\(\s*p_scope text, p_expected jsonb, p_writes jsonb/);
  for (const [scope, expected] of Object.entries(scopes)) {
    assert.deepEqual([...expected].sort(), expected);
    const matches = [...sql.matchAll(new RegExp(`when '${scope}' then v_slugs := array\\[([\\s\\S]*?)\\];`, "g"))];
    assert.equal(matches.length, 2);
    for (const match of matches) assert.deepEqual([...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]), expected);
  }
  assert.equal(new Set(Object.values(scopes).flat()).size, 11);
  assert.doesNotMatch(sql, /when 'archive_only'|slug\s*(?:like|~)|delete from public\.pages/i);
});

test("both API functions fix search_path and precisely converge service-only EXECUTE ACLs", () => {
  assert.equal((sql.match(/security definer/g) ?? []).length, 2);
  assert.equal((sql.match(/set search_path = pg_catalog, public/g) ?? []).length, 2);
  for (const signature of ["faolla_read_platform_snapshot_rows_v1(text)", "faolla_commit_platform_snapshot_rows_v1(text, jsonb, jsonb)"]) {
    assert.ok(sql.includes(`revoke all on function public.${signature} from public, anon, authenticated;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role;`));
  }
  assert.match(sql, /aclexplode/);
  assert.doesNotMatch(sql, /(?:grant|revoke).*on (?:table )?public\.pages|disable.*trigger/i);
});

test("first creation uses a narrow validated unique index; existing corruption is never repaired", () => {
  assert.match(sql, /create unique index if not exists pages_platform_snapshot_atomic_unique_idx/);
  assert.match(sql, /where merchant_id is null and slug = any\(array/);
  assert.match(sql, /group by slug having count\(\*\) > 1/);
  assert.match(sql, /slug = any\(v_slugs\) and merchant_id is not null/);
  assert.match(sql, /metadata\.indisunique and metadata\.indisvalid and metadata\.indisready/);
  assert.match(sql, /pg_get_expr\(metadata\.indpred, metadata\.indrelid\) = v_expected_predicate/);
  assert.doesNotMatch(sql, /on conflict|drop index|delete from/i);
});

test("read uses one materialized statement and transaction lock for its complete physical vector", () => {
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('faolla-platform-snapshot-atomic-v1', 0\)\)/);
  assert.match(sql, /with selected as materialized \([\s\S]*?where slug = any\(v_slugs\)[\s\S]*?for update\s*\)/);
  assert.match(sql, /'updatedAt', to_jsonb\(updated_at\)/);
  assert.match(sql, /'row', null/);
});

test("commit requires full read/write vectors, exact fields, size limit and id/content/timestamp CAS before DML", () => {
  assert.match(sql, /jsonb_array_length\(p_expected\) <> cardinality\(v_slugs\)/);
  assert.match(sql, /jsonb_array_length\(p_writes\) <> cardinality\(v_slugs\)/);
  assert.match(sql, /octet_length\(p_expected::text\)::bigint \+ octet_length\(p_writes::text\)::bigint > 67108864/);
  assert.match(sql, /v_expected_entry - array\['slug', 'row'\]/);
  assert.match(sql, /v_expected_row - array\['id', 'blocks', 'updatedAt'\]/);
  assert.match(sql, /v_write - array\['slug', 'blocks'\]/);
  const start = sql.indexOf("as $platform_snapshot_commit$");
  const commit = sql.slice(start);
  assert.ok(commit.indexOf("raise exception 'platform_snapshot_atomic_conflict'") < commit.indexOf("insert into public.pages"));
  assert.match(commit, /v_expected_timestamp is distinct from v_actual_timestamp/);
  assert.match(commit, /v_expected_row -> 'blocks' is distinct from v_actual_row -> 'blocks'/);
});

test("DML checks affected rows and final entire scope including IDs, payload and preserved no-op timestamps", () => {
  assert.match(sql, /get diagnostics v_affected = row_count/);
  assert.match(sql, /v_affected <> 1/);
  assert.match(sql, /v_saved.id::text is distinct from v_actual_row ->> 'id'/);
  assert.match(sql, /where id::text = v_actual_row ->> 'id' and merchant_id is null and slug = v_slug/);
  assert.match(sql, /v_after := public\.faolla_read_platform_snapshot_rows_v1\(p_scope\)/);
  assert.match(sql, /v_actual_row ->> 'id' is distinct from v_saved_ids ->> v_slug/);
  assert.match(sql, /v_actual_row -> 'blocks' is distinct from p_writes -> v_index -> 'blocks'/);
  assert.match(sql, /v_actual_row ->> 'updatedAt'\)::timestamptz is distinct from \(v_saved_versions ->> v_slug\)::timestamptz/);
  assert.match(sql, /v_actual_row -> 'blocks' = v_write[\s\S]*?continue;/);
});

test("exceptions are re-raised using only fixed whitelisted messages, not raw server details", () => {
  assert.match(sql, /get stacked diagnostics v_error = message_text/);
  assert.match(sql, /if v_write_started then\s*v_error := 'platform_snapshot_atomic_write_unconfirmed'/);
  assert.match(sql, /raise exception using errcode = 'P0001', message = v_error/);
  assert.doesNotMatch(sql, /using[^;]*\b(?:detail|hint)\s*=/i);
  assert.doesNotMatch(sql, /return\s+jsonb_build_object\('error'/i);
});
