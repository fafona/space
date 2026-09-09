import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";

const name = "202609090048_pages_client_write_acl.sql";
const source = readFileSync(new URL(`./supabase-migrations/${name}`, import.meta.url), "utf8");
const sql = source.replace(/--[^\r\n]*/g, "");

test("048 is transactional, bounded and registered under its exact new version", () => {
  assert.deepEqual(validateMigrationSource(name, source), []);
  assert.match(sql, /set local lock_timeout = '5s'/);
  assert.match(sql, /set local statement_timeout = '30s'/);
  assert.match(sql, /lock table public\.pages in access exclusive mode/);
  assert.match(sql, /values \(202609090048, 'pages_client_write_acl'\)/);
  assert.match(sql, /pages_client_write_acl_registry_conflict/);
});

test("048 requires the real predecessor registrations, functions and fixed roles", () => {
  for (const version of [202609080044, 202609080045, 202609080046, 202609080047]) {
    assert.ok(sql.includes(String(version)));
  }
  for (const rpc of ["faolla_mutate_qr_token_v1", "faolla_commit_order_membership_v1", "faolla_commit_redemption_v1", "faolla_commit_redemption_v2"]) {
    assert.match(sql, new RegExp(`to_regprocedure\\('public\\.${rpc}`));
  }
  assert.match(sql, /rolname in \('anon', 'authenticated', 'service_role'\)\) <> 3/);
  assert.match(sql, /v_pages is null or v_registry is null/);
});

test("only fixed-client table and column writes are revoked without cascade", () => {
  assert.match(sql, /revoke insert, update, delete on table public\.pages from public, anon, authenticated/);
  assert.match(sql, /revoke insert \(%I\), update \(%I\) on table public\.pages from public, anon, authenticated/);
  assert.match(sql, /attnum > 0 and not attisdropped/);
  assert.doesNotMatch(sql, /\b(?:cascade|grant|alter|drop|create|truncate)\b/i);
  assert.doesNotMatch(sql, /revoke\s+(?:all|select)\b/i);
  assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+public\.pages\b/i);
  assert.doesNotMatch(sql, /(?:from|to)\s+service_role\s*;/i);
});

test("inherited or ownership writes and lost preserved privileges abort the whole migration", () => {
  for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
    assert.ok(sql.includes(`has_table_privilege(v_role.oid, v_pages, '${privilege}')`));
  }
  for (const privilege of ["INSERT", "UPDATE"]) {
    assert.ok(sql.includes(`has_any_column_privilege(v_role.oid, v_pages, '${privilege}')`));
  }
  assert.match(sql, /raise exception 'pages_client_write_acl_effective_write_remains'/);
  assert.match(sql, /v_after is distinct from v_before/);
  assert.match(sql, /pages_client_write_acl_preserved_privilege_changed/);
  assert.match(sql, /has_column_privilege\(r\.oid, v_pages, a\.attnum, 'SELECT'\)/);
  assert.doesNotMatch(sql, /exception\s+when|alter\s+role|revoke\s+\w+\s+from\s+(?:anon|authenticated)/i);
});
