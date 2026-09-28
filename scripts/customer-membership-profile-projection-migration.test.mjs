import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";

// Static contracts only: actual SQL execution, ACL replay and malformed JSONB
// behavior require the separately owned native disposable-cluster verification.
const name = "202609280060_customer_membership_profile_projection.sql";
const source = readFileSync(new URL(`./supabase-migrations/${name}`, import.meta.url), "utf8");
const sql = source.replace(/--[^\r\n]*/g, "");
function body(label) {
  const parts = sql.split(`$${label}$`);
  assert.equal(parts.length, 3, `${label} has exactly one dollar-quoted body`);
  return parts[1];
}
const read = body("customer_membership_profile_read");

test("060 is additive, registered and bounded without touching business relations or writers", () => {
  assert.deepEqual(validateMigrationSource(name, source), []);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /set local statement_timeout = '30s'/);
  assert.equal((sql.match(/create or replace function /g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+(?:table|index|trigger|policy)\b/i);
  assert.doesNotMatch(sql, /\b(?:update|delete\s+from|truncate|lock\s+table)\s+/i);
  assert.deepEqual(sql.match(/insert\s+into\s+[a-z_.]+/gi), ["insert into public.faolla_schema_migrations"]);
  assert.doesNotMatch(sql, /pg_advisory|for\s+(?:no\s+key\s+)?update|for\s+(?:key\s+)?share|faolla_commit_/i);
});

test("preflight rejects conflicting registry identity before any function replacement", () => {
  const preflight = body("customer_membership_profile_preflight");
  assert.match(preflight, /to_regclass\('public\.pages'\) is null/);
  assert.match(preflight, /to_regclass\('public\.faolla_schema_migrations'\) is null/);
  assert.match(preflight, /rolname in \('anon', 'authenticated', 'service_role'\)\) <> 3/);
  assert.match(preflight, /where version = 202609280060 and name <> 'customer_membership_profile_projection'/);
  assert.match(preflight, /raise exception 'customer_membership_profile_registry_conflict'/);
  assert.ok(sql.indexOf("$customer_membership_profile_preflight$;") < sql.indexOf("create or replace function"));
  assert.match(sql, /values \(202609280060, 'customer_membership_profile_projection'\)\s+on conflict \(version\) do nothing/);
  assert.match(sql, /notify pgrst, 'reload schema';\s+commit;/);
});

test("RPC is a stable invoker with a fixed search path, not a new authentication authority", () => {
  assert.match(sql, /public\.faolla_customer_membership_profiles_v1\(p_site_id text\)\s+returns jsonb\s+language plpgsql\s+stable\s+security invoker\s+set search_path = pg_catalog, public/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(read, /auth\.|jwt|request\.jwt|set_config|\bexecute\b|\bperform\b/i);
});

test("invalid scope is rejected without trimming, coercion or reading source rows", () => {
  assert.match(read, /if p_site_id is null or length\(p_site_id\) <> 8 or p_site_id !~ '\^\[0-9\]\{8\}\$' then\s+raise exception 'customer_membership_profile_invalid_site_id';/);
  assert.ok(read.indexOf("raise exception 'customer_membership_profile_invalid_site_id'") < read.indexOf("with candidates"));
  assert.doesNotMatch(read, /\b(?:trim|btrim|regexp_replace)\s*\(/i);
});

test("eligibility and projection read pages exactly once in one bounded statement snapshot", () => {
  assert.equal((read.match(/\bfrom\s+public\.pages\b/gi) ?? []).length, 1);
  assert.equal((read.match(/\binto\s+v_result\b/gi) ?? []).length, 1);
  assert.match(read, /with candidates as materialized \(\s+select page\.id, page\.merchant_id, page\.slug, page\.blocks, page\.updated_at\s+from public\.pages as page\s+where page\.slug = '__merchant_memberships__:' \|\| p_site_id\s+limit 2\s+\), eligible as materialized/);
  assert.doesNotMatch(read, /\bloop\b|\bexception\s+when\b|\bexecute\b/i);
  const statement = read.slice(read.indexOf("with candidates"), read.indexOf(") into v_result;") + ") into v_result;".length);
  assert.equal((statement.match(/;/g) ?? []).length, 1, "no independent count/read snapshots");
});

test("zero/duplicate/global-slug ambiguity, wrong owner and non-array blocks cannot yield projected success", () => {
  assert.match(read, /where \(select count\(\*\) from candidates\) = 1\s+and candidate\.merchant_id = p_site_id\s+and jsonb_typeof\(candidate\.blocks\) = 'array'\s+and not exists/);
  const candidates = read.slice(read.indexOf("with candidates"), read.indexOf("), eligible"));
  assert.doesNotMatch(candidates, /merchant_id\s*=|order by|distinct|offset/i);
  assert.match(read, /\) as row_payload\s+from eligible/);
});

test("every JSON array expansion is guarded or consumes the materialized array-only eligible row", () => {
  assert.equal((read.match(/jsonb_array_elements\(/g) ?? []).length, 3);
  assert.match(read, /jsonb_array_elements\(case\s+when jsonb_typeof\(candidate\.blocks\) = 'array' then candidate\.blocks\s+else '\[\]'::jsonb\s+end\)/);
  assert.match(read, /jsonb_array_elements\(case\s+when jsonb_typeof\(member\.value\) = 'object'\s+and jsonb_typeof\(member\.value -> 'transactions'\) = 'array'\s+then member\.value -> 'transactions'\s+else '\[\]'::jsonb\s+end\)/);
  assert.match(read, /jsonb_array_elements\(eligible\.blocks\) with ordinality/);
});

test("complex money conservatively falls back without inventing JS date/coercion semantics", () => {
  assert.match(read, /where jsonb_typeof\(tx\.value\) = 'object'\s+and \(jsonb_typeof\(tx\.value -> 'balanceDelta'\) in \('array', 'object'\)\s+or jsonb_typeof\(tx\.value -> 'growthDelta'\) in \('array', 'object'\)\)/);
  assert.doesNotMatch(read, /joinedAt|updatedAt|accountId|userId|toString|->>\s*'at'|::(?:numeric|bigint|timestamp)|jsonb_path/i);
  assert.equal((read.match(/raise exception/g) ?? []).length, 1, "bad history is not eagerly turned into a new error");
});

test("projection preserves member ordinal and all other fields and non-object elements", () => {
  assert.match(read, /jsonb_agg\(case\s+when jsonb_typeof\(member\.value\) = 'object'\s+then jsonb_set\(member\.value, '\{transactions\}', '\[\]'::jsonb, true\)\s+else member\.value\s+end order by member\.ordinality\), '\[\]'::jsonb\)/);
  assert.match(read, /with ordinality as member\(value, ordinality\)/);
  assert.doesNotMatch(read, /group by|distinct on|member\.value\s*->>\s*'(?:siteId|id)'|jsonb_strip_nulls/i);
});

test("success is a single raw-shaped row; fallback is versioned, scoped and contains no data", () => {
  assert.match(read, /'id', eligible\.id,\s+'slug', eligible\.slug,\s+'blocks',/);
  assert.match(read, /'updated_at', to_jsonb\(eligible\.updated_at\)/);
  assert.doesNotMatch(read, /updated_at\s*::\s*text|to_char|clock_timestamp|\bnow\(\)/i);
  assert.match(read, /'version', 1, 'status', 'projected', 'siteId', p_site_id,\s+'rows', jsonb_build_array\(projected\.row_payload\)/);
  assert.match(read, /jsonb_build_object\('version', 1, 'status', 'fallback', 'siteId', p_site_id\)\s+\) into v_result;/);
});

test("replay removes all non-owner function grants and restores only service-role execution", () => {
  const acl = body("customer_membership_profile_acl");
  assert.match(acl, /v_function regprocedure := 'public\.faolla_customer_membership_profiles_v1\(text\)'::regprocedure/);
  assert.match(acl, /aclexplode\(coalesce\(metadata\.proacl,\s+pg_catalog\.acldefault\('f', metadata\.proowner\)\)\)/);
  assert.match(acl, /where metadata\.oid = v_function and acl\.grantee <> metadata\.proowner/);
  assert.match(acl, /revoke all on function %s from public cascade/);
  assert.match(acl, /revoke all on function %s from %I cascade/);
  assert.match(sql, /revoke all on function public\.faolla_customer_membership_profiles_v1\(text\) from public, anon, authenticated;/);
  assert.deepEqual(sql.match(/^grant .+;$/gm), [
    "grant execute on function public.faolla_customer_membership_profiles_v1(text) to service_role;",
  ]);
  assert.doesNotMatch(sql, /alter default privileges|grant .* on (?:table|all)|grant .* to (?:anon|authenticated)/i);
});
