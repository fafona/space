import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310001_merchant_enterprise_foundation.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

test("enterprise migration creates merchant-scoped workforce and task tables", () => {
  const source = readMigration();
  [
    "merchant_enterprise_roles",
    "merchant_enterprise_employees",
    "merchant_task_boards",
    "merchant_task_columns",
    "merchant_tasks",
    "merchant_task_assignees",
    "merchant_task_events",
  ].forEach((table) => {
    assert.match(source, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  });
});

test("enterprise migration keeps employee authorization separate from merchant ownership", () => {
  const source = readMigration();
  assert.doesNotMatch(source, /alter\s+table\s+public\.merchants/i);
  assert.doesNotMatch(source, /user_metadata|app_metadata|faolla_is_merchant_owner/i);
  assert.match(source, /revoke all on public\.merchant_tasks from anon, authenticated/i);
});

test("enterprise task foreign keys keep board, column, employee and task rows merchant scoped", () => {
  const source = readMigration();
  assert.match(source, /foreign key \(merchant_id, board_id\)[\s\S]+merchant_task_boards\(merchant_id, id\)/i);
  assert.match(
    source,
    /foreign key \(merchant_id, board_id, column_id\)[\s\S]+merchant_task_columns\(merchant_id, board_id, id\)/i,
  );
  assert.match(source, /foreign key \(merchant_id, employee_id\)[\s\S]+merchant_enterprise_employees\(merchant_id, id\)/i);
  assert.match(source, /foreign key \(merchant_id, task_id\)[\s\S]+merchant_tasks\(merchant_id, id\)/i);
  assert.match(source, /is_done boolean not null default false/i);
  assert.match(source, /merchant_task_boards_system_key_unique[\s\S]+unique \(merchant_id, system_key\)/i);
});

test("enterprise task RPCs are service-only, transactional and idempotent", () => {
  const source = readMigration();
  assert.match(source, /create or replace function public\.faolla_create_merchant_task_v1\(p_input jsonb\)/i);
  assert.match(source, /create or replace function public\.faolla_update_merchant_task_v1\(p_input jsonb\)/i);
  assert.match(source, /'enterprise-task:' \|\| v_operation_id/i);
  assert.match(source, /insert into public\.merchant_idempotency_keys/i);
  assert.match(source, /response_body = v_response/i);
  assert.match(
    source,
    /from public\.merchant_tasks[\s\S]+version = v_expected_version[\s\S]+for update/i,
  );
  assert.match(source, /replace_assignees[\s\S]+delete from public\.merchant_task_assignees/i);
  assert.match(source, /unique \(merchant_id, operation_id\)/i);
  assert.match(source, /merchant_enterprise_employees[\s\S]+status = 'active'[\s\S]+for share/i);
  assert.match(
    source,
    /revoke all on function public\.faolla_create_merchant_task_v1\(jsonb\) from public,\s*anon,\s*authenticated/i,
  );
  assert.match(
    source,
    /revoke all on function public\.faolla_update_merchant_task_v1\(jsonb\) from public,\s*anon,\s*authenticated/i,
  );
  assert.match(source, /grant execute on function public\.faolla_update_merchant_task_v1\(jsonb\) to service_role/i);
  assert.match(source, /grant select on public\.merchant_tasks to service_role/i);
  assert.match(source, /grant select, insert, update on public\.merchant_enterprise_roles to service_role/i);
});

test("enterprise bootstrap keys support conflict-safe upserts", () => {
  const source = readMigration();
  assert.match(source, /merchant_enterprise_roles_system_key_unique[\s\S]+unique \(merchant_id, system_key\)/i);
  assert.match(source, /merchant_task_boards_system_key_unique[\s\S]+unique \(merchant_id, system_key\)/i);
  assert.match(
    source,
    /merchant_task_columns_system_key_unique[\s\S]+unique \(merchant_id, board_id, system_key\)/i,
  );
  assert.match(source, /system_key text null/i);
  assert.match(
    source,
    /grant select, insert, update, delete on public\.merchant_enterprise_employees to service_role/i,
  );
  assert.match(source, /grant select on public\.merchant_tasks to service_role/i);
});
