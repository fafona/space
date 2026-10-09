import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`./supabase-migrations/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const permissions = read("202609290062_merchant_attendance_permissions.sql");
const clock = read("202609290063_merchant_attendance_self_clock.sql");
test("attendance extends but does not change any previous SQL permission/dependency rule", () => {
  const pattern = /create or replace function public\.faolla_valid_merchant_enterprise_permissions_v1\([\s\S]*?\n\$\$;/;
  const old = read("202608280041_merchant_staff_business_permissions.sql").match(pattern)?.[0];
  const expanded = permissions.match(pattern)?.[0];
  assert.ok(old); assert.ok(expanded);
  assert.equal(expanded.replace(/\n      \('attendance\.self\.(view|clock)',[^\n]+/g, ""), old);
  assert.doesNotMatch(permissions, /update\s+public\.merchant_enterprise_roles|insert\s+into\s+public\.merchant_enterprise_roles/i);
});
test("clocking only grants service execute, never public RPC or direct event writes", () => {
  const grants = clock.match(/^grant .*$/gm);
  assert.deepEqual(grants, ["grant execute on function public.faolla_attendance_self_v1(text,uuid,jsonb,uuid) to service_role;"]);
  assert.match(clock, /revoke all on function public\.faolla_attendance_self_v1\(text,uuid,jsonb,uuid\) from public,anon,authenticated,service_role/);
  assert.match(clock, /security definer set search_path = pg_catalog/);
  assert.match(clock, /web_clock_enabled boolean not null default false/);
  assert.doesNotMatch(clock, /update\s+public\.merchant_enterprise_(employees|roles)|delete from|truncate/i);
});
test("atomic authorization and worker lock precede replay; replay precedes revision check", () => {
  const employee = clock.indexOf("select * into v_employee");
  const role = clock.indexOf("select * into v_role");
  const worker = clock.indexOf("select * into v_worker");
  const replay = clock.indexOf("if v_receipt.id is not null");
  const revision = clock.indexOf("if v_sequence<>v_expected");
  assert.ok(employee < role && role < worker && worker < replay && replay < revision);
  assert.match(clock, /clock_timestamp\(\)/);
  assert.match(clock, /attendance_location_verification_required/);
  assert.match(clock, /attendance_employment_overlap/);
});
