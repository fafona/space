import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateMigrationSource } from "./check-supabase-migrations.mjs";

const name = "202609290061_merchant_attendance_foundation.sql";
const source = readFileSync(new URL(`./supabase-migrations/${name}`, import.meta.url), "utf8");
const tables = ["settings", "locations", "workers", "employment_periods", "events"];

test("attendance migration is additive, registered and leaves existing business data untouched", () => {
  assert.deepEqual(validateMigrationSource(name, source), []);
  assert.doesNotMatch(source, /(?:alter\s+table|update|insert\s+into|delete\s+from)\s+public\.(?:merchants|merchant_enterprise_\w+|pages)\b/i);
  assert.match(source, /enabled boolean not null default false/i);
  assert.doesNotMatch(source, /insert into public\.merchant_attendance_/i);
});

test("every attendance table defaults to closed RLS and service read only", () => {
  for (const suffix of tables) {
    const name = `merchant_attendance_${suffix}`;
    assert.match(source, new RegExp(`alter table public\\.${name} enable row level security`, "i"));
    assert.match(source, new RegExp(`revoke all on public\\.${name} from public, anon, authenticated, service_role`, "i"));
    assert.match(source, new RegExp(`grant select on public\\.${name} to service_role`, "i"));
  }
  assert.doesNotMatch(source, /grant\s+(?:all|insert|update|delete|execute)\b/i);
  assert.doesNotMatch(source, /create policy/i);
});

test("employee, worker and location foreign keys retain tenant scope", () => {
  assert.match(source, /foreign key \(merchant_id, employee_id\)\s+references public\.merchant_enterprise_employees\(merchant_id, id\)/i);
  for (const [field, table] of [["worker_id", "workers"], ["location_id", "locations"], ["default_location_id", "locations"]]) {
    assert.match(source, new RegExp(`foreign key \\(merchant_id, ${field}\\)\\s+references public\\.merchant_attendance_${table}\\(merchant_id, id\\)`, "i"));
  }
  assert.match(source, /unique \(merchant_id, worker_id, operation_id\)/i);
  assert.match(source, /unique \(merchant_id, worker_id, sequence\)/i);
});

test("raw event updates, deletes and table truncation are blocked", () => {
  assert.match(source, /before update or delete on public\.merchant_attendance_events/i);
  assert.match(source, /before truncate on public\.merchant_attendance_events/i);
  assert.match(source, /errcode = '42501', message = 'attendance_events_append_only'/i);
});

test("public execute defaults are revoked from both new functions", () => {
  for (const signature of ["faolla_attendance_valid_zone_v1(text)", "faolla_attendance_events_append_only_v1()"]) {
    assert.ok(source.includes(`revoke all on function public.${signature} from public, anon, authenticated, service_role;`));
  }
});
