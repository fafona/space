import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";

const name = "202609240052_order_attention_pilot.sql";
const source = readFileSync(new URL(`./supabase-migrations/${name}`, import.meta.url), "utf8");
const sql = source.replace(/--[^\r\n]*/g, "");
function body(label) {
  const delimiter = `$${label}$`;
  const pieces = sql.split(delimiter);
  assert.equal(pieces.length, 3, `${label} must have one delimited body`);
  return pieces[1];
}

test("052 is bounded, additive and enrolls only the approved merchant under the source relation lock", () => {
  assert.deepEqual(validateMigrationSource(name, source), []);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /set local statement_timeout = '5s'/);
  assert.match(sql, /lock table public\.pages in share row exclusive mode/);
  assert.ok(sql.indexOf("lock table public.pages") < sql.indexOf("insert into public.faolla_order_attention_pilot"));
  assert.match(sql, /merchant_id text primary key check \(merchant_id = '10000000'\)/);
  assert.match(sql, /values \(202609240052, 'order_attention_pilot'\)/);
  assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+public\.(?:pages|merchants|merchant_orders|merchant_memberships)\b/i);
  assert.doesNotMatch(sql, /references\s+public\.merchants|create or replace function public\.faolla_commit_/i);
  assert.doesNotMatch(sql, /pg_advisory|for\s+(?:no\s+key\s+)?update|for\s+(?:key\s+)?share/i);
});

test("reapplying migration retires old tokens and projections without enabling traffic", () => {
  assert.match(sql, /epoch uuid not null default pg_catalog\.gen_random_uuid\(\)/);
  assert.match(sql, /on conflict \(merchant_id\) do update\s+set epoch = pg_catalog\.gen_random_uuid\(\),\s+generation = public\.faolla_order_attention_pilot\.generation \+ 1,\s+enabled = false, payload = null, projected_at = null/);
  assert.doesNotMatch(sql, /set\s+enabled\s*=\s*true/i);
});

test("source invalidation covers both OLD and NEW identities, remains active while disabled, and takes no source locks", () => {
  const invalidate = body("invalidate");
  assert.match(invalidate, /tg_op <> 'INSERT' and starts_with\(old\.slug, '__merchant_orders__:10000000'\)/);
  assert.match(invalidate, /tg_op <> 'DELETE' and starts_with\(new\.slug, '__merchant_orders__:10000000'\)/);
  for (const triggerBody of [invalidate, body("clear_summary")]) {
    assert.match(triggerBody, /set generation = generation \+ 1, payload = null, projected_at = null/);
    assert.match(triggerBody, /where merchant_id = '10000000'/);
    assert.doesNotMatch(triggerBody, /\benabled\b|exception\s+when|pg_advisory|\bfrom\s+public\.pages\b/i);
  }
  assert.match(sql, /create constraint trigger faolla_order_attention_invalidate\s+after insert or update or delete on public\.pages\s+deferrable initially deferred\s+for each row/);
  assert.match(sql, /create trigger faolla_order_attention_clear\s+before truncate on public\.pages\s+for each statement/);
  assert.match(sql, /enable always trigger faolla_order_attention_invalidate/);
  assert.match(sql, /enable always trigger faolla_order_attention_clear/);
});

test("ready reads require exact enabled capture trigger shapes including deferred constraint semantics", () => {
  const capture = body("capture_ready");
  assert.equal((capture.match(/tgenabled = 'A'/g) ?? []).length, 2);
  assert.match(capture, /tgtype = 29 and tgqual is null\s+and tgdeferrable and tginitdeferred and tgnargs = 0 and tgattr = ''::int2vector/);
  assert.match(capture, /tgtype = 34 and tgqual is null\s+and not tgdeferrable and not tginitdeferred and tgnargs = 0 and tgattr = ''::int2vector/);
  assert.match(capture, /tgfoid = 'public\.faolla_invalidate_order_attention_pilot\(\)'::regprocedure/);
  assert.match(capture, /tgfoid = 'public\.faolla_clear_order_attention_pilot\(\)'::regprocedure/);
  assert.match(source, /past disabled-trigger interval/);
  assert.match(source, /never called inside a transaction/);
});

test("source snapshot preserves one MVCC snapshot, strict canonical scope and real uncompressed bounds", () => {
  assert.match(sql, /faolla_read_order_attention_v1\([\s\S]*?language plpgsql stable/);
  const read = body("read_summary");
  assert.match(read, /not public\.faolla_order_attention_capture_ready\(\)/);
  assert.match(read, /not exists \(select 1 from public\.merchants where id = p_site_id\)/);
  assert.match(read, /if not v_state\.enabled and p_source is not true then/);
  assert.match(read, /'state', 'ready', 'epoch', v_state\.epoch::text/);
  assert.match(read, /order by slug, id limit 513/);
  assert.match(read, /octet_length\(v_page\.blocks::text\)/);
  assert.match(read, /v_count > 512 or v_bytes > 8388608 or v_page\.merchant_id is distinct from p_site_id/);
  assert.match(read, /v_page\.slug !~ '\^__merchant_orders__:10000000\(:chunk:\[0-9\]\+\)\?\$'/);
  assert.match(read, /jsonb_typeof\(v_page\.blocks\) is distinct from 'array'/);
  assert.match(read, /'state', 'source', 'epoch', v_state\.epoch::text/);
  assert.match(read, /'generation', v_state\.generation::text/);
  assert.doesNotMatch(read, /pg_column_size|for update|faolla_commit_|merchant_orders_v1|booking/i);
  assert.ok(read.indexOf("v_count > 512") < read.indexOf("array_append(v_rows"));
});

test("publish CAS binds epoch, decimal generation and schema, without taking source locks or changing activation", () => {
  assert.match(sql, /faolla_publish_order_attention_v1\(\s+p_site_id text, p_epoch uuid, p_generation text, p_payload jsonb/);
  const publish = body("publish_summary");
  assert.match(publish, /not public\.faolla_order_attention_capture_ready\(\)/);
  assert.match(publish, /not exists \(select 1 from public\.merchants where id = p_site_id\)/);
  assert.match(publish, /p_generation::numeric > 9223372036854775807/);
  assert.match(publish, /where merchant_id = p_site_id and epoch = p_epoch and schema_version = 1\s+and generation = p_generation::bigint and payload is null/);
  assert.match(publish, /if not found then return jsonb_build_object\('state', 'conflict'\)/);
  assert.match(publish, /'state', 'published', 'epoch', p_epoch::text, 'generation', v_generation::text/);
  assert.doesNotMatch(publish, /\benabled\b|\bfrom\s+public\.pages\b|pg_advisory|for update|set\s+generation/i);
});

test("private derived table and payload validation expose only service read/publish RPCs", () => {
  assert.match(sql, /alter table public\.faolla_order_attention_pilot enable row level security/);
  assert.match(sql, /revoke all on public\.faolla_order_attention_pilot from public, anon, authenticated, service_role/);
  assert.match(sql, /aclexplode\(coalesce\(c\.relacl/);
  assert.match(sql, /aclexplode\(a\.attacl\)/);
  assert.match(sql, /revoke select \(%1\$I\), insert \(%1\$I\), update \(%1\$I\), references \(%1\$I\) on public\.faolla_order_attention_pilot/);
  assert.match(sql, /aclexplode\(coalesce\(p\.proacl/);
  assert.doesNotMatch(sql, /create policy|grant .* on (?:table )?public\.faolla_order_attention_pilot/i);
  const grants = sql.match(/^grant .+;$/gm) ?? [];
  assert.deepEqual(grants, [
    "grant execute on function public.faolla_read_order_attention_v1(text,boolean) to service_role;",
    "grant execute on function public.faolla_publish_order_attention_v1(text,uuid,text,jsonb) to service_role;",
  ]);
  const publish = body("publish_summary");
  assert.match(publish, /octet_length\(p_payload::text\) > 16384/);
  assert.match(publish, /v_count < 0 or v_count > 1000000 or trunc\(v_count\) <> v_count/);
  assert.match(publish, /k not in \('count', 'latest'\)/);
  assert.match(publish, /v_latest ->> 'url' is distinct from '\/10000000\?mobileTab=business&businessSection=orders&appShell=faolla'/);
});
