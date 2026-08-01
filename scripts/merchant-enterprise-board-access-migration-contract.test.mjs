import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310009_merchant_enterprise_board_access_scopes.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readFunction(source, name) {
  const marker = `create or replace function public.${name}(`;
  const start = source.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

test("board access migration keeps existing roles on all-board access", () => {
  const source = readMigration();
  assert.match(
    source,
    /alter table public\.merchant_enterprise_roles[\s\S]+add column if not exists access_scope text not null default 'all'/i,
  );
  assert.match(
    source,
    /merchant_enterprise_roles_access_scope_check[\s\S]+check \(access_scope in \('all', 'restricted'\)\)/i,
  );
  assert.doesNotMatch(source, /update\s+public\.merchant_enterprise_roles\s+set\s+access_scope\s*=\s*'restricted'/i);
});

test("role board mappings are merchant scoped, indexed and service-read-only", () => {
  const source = readMigration();
  assert.match(
    source,
    /create table if not exists public\.merchant_enterprise_role_boards[\s\S]+primary key \(merchant_id, role_id, board_id\)/i,
  );
  assert.match(
    source,
    /foreign key \(merchant_id, role_id\)[\s\S]+merchant_enterprise_roles\(merchant_id, id\)[\s\S]+on delete cascade/i,
  );
  assert.match(
    source,
    /foreign key \(merchant_id, board_id\)[\s\S]+merchant_task_boards\(merchant_id, id\)[\s\S]+on delete cascade/i,
  );
  assert.match(
    source,
    /merchant_enterprise_role_boards_board_role_idx[\s\S]+\(merchant_id, board_id, role_id\)/i,
  );
  assert.match(
    source,
    /alter table public\.merchant_enterprise_role_boards enable row level security/i,
  );
  assert.match(
    source,
    /revoke all on public\.merchant_enterprise_role_boards from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant select on public\.merchant_enterprise_role_boards to service_role/i,
  );
  assert.doesNotMatch(
    source,
    /grant\s+(?:insert|update|delete|all)[^;]*merchant_enterprise_role_boards[^;]*service_role/i,
  );
});

test("role create and update RPCs atomically validate and return board access", () => {
  const source = readMigration();
  const createRole = readFunction(
    source,
    "faolla_create_merchant_enterprise_role_v1",
  );
  const updateRole = readFunction(
    source,
    "faolla_update_merchant_enterprise_role_v1",
  );

  for (const body of [createRole, updateRole]) {
    assert.match(body, /returns jsonb/i);
    assert.match(body, /language plpgsql/i);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = public/i);
    assert.match(body, /access_scope/i);
    assert.match(body, /allowed_board_ids/i);
    assert.match(body, /merchant_task_boards[\s\S]+merchant_id = v_site_id/i);
    assert.match(body, /invalid_role_board_access/i);
    assert.match(body, /merchant_enterprise_role_boards/i);
    assert.match(body, /'role', to_jsonb\(v_role\) - 'system_key'/i);
    assert.match(body, /'allowed_board_ids'/i);
  }

  assert.match(updateRole, /expected_version/i);
  assert.match(
    updateRole,
    /from public\.merchant_enterprise_roles[\s\S]+merchant_id = v_site_id[\s\S]+id = v_role_id[\s\S]+for update/i,
  );
  assert.match(updateRole, /v_role\.version <> v_expected_version/i);
  assert.match(
    updateRole,
    /update public\.merchant_enterprise_roles[\s\S]+version = v_expected_version[\s\S]+returning \* into v_role/i,
  );
  assert.match(
    updateRole,
    /delete from public\.merchant_enterprise_role_boards[\s\S]+insert into public\.merchant_enterprise_role_boards/i,
  );

  for (const name of [
    "faolla_create_merchant_enterprise_role_v1",
    "faolla_update_merchant_enterprise_role_v1",
  ]) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function public\\.${name}\\(jsonb\\)\\s+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function public\\.${name}\\(jsonb\\)\\s+to service_role`,
        "i",
      ),
    );
  }
});

test("task assignments require an active task-viewing role with board access", () => {
  const source = readMigration();
  const guard = readFunction(
    source,
    "faolla_guard_merchant_task_assignee_board_access_v1",
  );
  assert.match(guard, /select task\.board_id[\s\S]+merchant_tasks[\s\S]+for share/i);
  assert.match(
    guard,
    /merchant_enterprise_employees[\s\S]+merchant_enterprise_roles[\s\S]+employee\.status = 'active'[\s\S]+role_row\.status = 'active'/i,
  );
  assert.match(guard, /'tasks\.view' = any\(v_role\.permissions\)/i);
  assert.match(
    guard,
    /v_role\.access_scope = 'restricted'[\s\S]+merchant_enterprise_role_boards/i,
  );
  assert.match(guard, /task_assignee_board_access_denied/i);
  assert.match(
    source,
    /before insert on public\.merchant_task_assignees[\s\S]+faolla_guard_merchant_task_assignee_board_access_v1\(\)/i,
  );
  assert.match(
    source,
    /before update of merchant_id, task_id, employee_id on public\.merchant_task_assignees[\s\S]+faolla_guard_merchant_task_assignee_board_access_v1\(\)/i,
  );
});

test("restoring or reopening a task revalidates its active assignees", () => {
  const source = readMigration();
  const guard = readFunction(
    source,
    "faolla_guard_merchant_task_reactivation_assignees_v1",
  );

  assert.match(
    guard,
    /old\.archived_at is not null and new\.archived_at is null/i,
  );
  assert.match(
    guard,
    /old\.completed_at is not null and new\.completed_at is null/i,
  );
  assert.match(
    guard,
    /merchant_task_assignees[\s\S]+merchant_enterprise_employees[\s\S]+merchant_enterprise_roles/i,
  );
  assert.match(guard, /employee\.status = 'active'/i);
  assert.match(guard, /role_row\.status <> 'active'/i);
  assert.match(guard, /'tasks\.view' = any\(role_row\.permissions\)/i);
  assert.match(
    guard,
    /role_row\.access_scope = 'restricted'[\s\S]+role_board\.board_id is null/i,
  );
  assert.match(guard, /task_assignee_board_access_denied/i);
  assert.match(
    source,
    /before update of archived_at, completed_at on public\.merchant_tasks[\s\S]+faolla_guard_merchant_task_reactivation_assignees_v1\(\)/i,
  );
  assert.match(
    source,
    /revoke all on function public\.faolla_guard_merchant_task_reactivation_assignees_v1\(\)[\s\S]+from public, anon, authenticated/i,
  );
});

test("role shrink and employee role changes preserve active task assignment access", () => {
  const source = readMigration();
  const updateRole = readFunction(
    source,
    "faolla_update_merchant_enterprise_role_v1",
  );
  const employeeGuard = readFunction(
    source,
    "faolla_guard_merchant_employee_role_assignments_v1",
  );
  const assignmentFit = readFunction(
    source,
    "faolla_employee_assignments_fit_role_v1",
  );

  assert.match(
    updateRole,
    /employee\.status = 'active'[\s\S]+task\.archived_at is null[\s\S]+task\.completed_at is null/i,
  );
  assert.match(updateRole, /not \('tasks\.view' = any\(v_next_permissions\)\)/i);
  assert.match(updateRole, /v_next_access_scope = 'restricted'/i);
  assert.match(updateRole, /role_board_access_in_use/i);

  assert.match(
    employeeGuard,
    /new\.role_id is distinct from old\.role_id[\s\S]+new\.status = 'active' and old\.status <> 'active'/i,
  );
  assert.match(employeeGuard, /faolla_employee_assignments_fit_role_v1/i);
  assert.match(employeeGuard, /employee_board_access_in_use/i);
  assert.match(
    assignmentFit,
    /task\.archived_at is null[\s\S]+task\.completed_at is null/i,
  );
  assert.match(assignmentFit, /merchant_enterprise_role_boards/i);
  assert.match(
    source,
    /before update of role_id, status on public\.merchant_enterprise_employees[\s\S]+faolla_guard_merchant_employee_role_assignments_v1\(\)/i,
  );
});

test("board access migration is registered atomically and reloads PostgREST", () => {
  const source = readMigration();
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202607310009, 'merchant_enterprise_board_access_scopes'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
});
