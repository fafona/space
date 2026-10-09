// A disposable namespace INSIDE the existing, identity-checked synthetic DB.
// Real migration bodies, only schema-qualified names/search_path are rewritten.
// No public DDL/data is committed, no new database/cluster or dump file is made.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";

export const attendanceConcurrencyMigrations = [
  "202609290061_merchant_attendance_foundation.sql", "202609290062_merchant_attendance_permissions.sql",
  "202609290063_merchant_attendance_self_clock.sql", "202609290064_merchant_attendance_owner_configuration.sql",
  "202609290065_merchant_attendance_record_permission.sql", "202609290066_merchant_attendance_scopes_records.sql",
  "202609290067_merchant_attendance_scope_choices.sql", "202609300070_merchant_attendance_self_session.sql",
  "202609300081_merchant_attendance_request_permission.sql", "202609300082_merchant_attendance_correction_requests.sql",
  "202609300083_merchant_attendance_correction_owner_review.sql", "202609300084_merchant_attendance_correction_controls.sql",
  "202609300085_merchant_attendance_correction_rule_binding.sql", "202609300086_merchant_attendance_correction_decisions.sql",
];
export function qualifyAttendanceSandbox(source, schema) {
  assert.match(schema, /^attendance_race_[a-f0-9]{32}$/);
  assert.equal(typeof source, "string");
  return source.replace(/\bpublic\./g, `${schema}.`)
    .replace(/(search_path\s*=\s*pg_catalog,\s*)public\b/g, `$1${schema}`);
}
export async function withAttendanceConcurrencySandbox({root,query,querySteps}, check) {
  const schema = `attendance_race_${randomUUID().replaceAll("-", "")}`;
  const marker = `faolla-synthetic-concurrency:${randomUUID()}`;
  assert.equal(query(`select count(*) from pg_namespace where nspname='${schema}';`), "0");
  const owned = JSON.parse(query(`begin;create schema ${schema} authorization postgres;
    comment on schema ${schema} is '${marker}';grant usage on schema ${schema} to service_role,anon,authenticated;commit;
    select jsonb_build_object('oid',oid::bigint,'owner',nspowner::regrole::text,'marker',obj_description(oid,'pg_namespace')) from pg_namespace where nspname='${schema}';`));
  const sql = source => qualifyAttendanceSandbox(source, schema);
  try {
    assert.equal(owned.owner, "postgres"); assert.equal(owned.marker, marker); assert.ok(Number.isSafeInteger(owned.oid));
    const enterprise = readFileSync(path.join(root, "scripts/supabase-migrations/202607310001_merchant_enterprise_foundation.sql"), "utf8");
    const ddl = ["roles","employees"].map(name => {
      const found = enterprise.match(new RegExp(`create table if not exists public\\.merchant_enterprise_${name} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(found, "attendance_concurrency_employee_ddl_required"); return found;
    }).join("\n");
    await querySteps([sql(`begin;
      create table public.merchants(id text primary key,user_id uuid,auth_user_id uuid,owner_user_id uuid,owner_id uuid,auth_id uuid,created_by uuid,created_by_user_id uuid);
      create table public.faolla_schema_migrations(version bigint primary key,name text not null);${ddl}`),
    ...attendanceConcurrencyMigrations.map(name => sql(readFileSync(path.join(root,"scripts/supabase-migrations",name),"utf8")
      .replace(/^begin;$/m, "").replace(/^commit;$/m, ""))), "commit;"]);
    await check({schema, sql});
  } finally {
    // Only this run's exact schema OID + owner + unguessable marker may be removed.
    // No glob/prefix cleanup, no cleanup of a leftover schema from another run.
    assert.equal(owned.owner, "postgres"); assert.equal(owned.marker, marker); assert.ok(Number.isSafeInteger(owned.oid));
    const current = JSON.parse(query(`select jsonb_build_object('oid',oid::bigint,'owner',nspowner::regrole::text,'marker',obj_description(oid,'pg_namespace')) from pg_namespace where nspname='${schema}';`));
    assert.deepEqual(current, owned, "attendance_concurrency_cleanup_identity_mismatch");
    query(`drop schema ${schema} cascade;`);
    assert.equal(query(`select count(*) from pg_namespace where nspname='${schema}';`), "0");
  }
}
