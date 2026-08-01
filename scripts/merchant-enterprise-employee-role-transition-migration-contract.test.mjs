import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310011_merchant_enterprise_employee_role_transition.sql",
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

test("role transitions require employee and target-role CAS", () => {
  const updateEmployee = readFunction(
    readMigration(),
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(updateEmployee, /p_input ->> 'expected_version'/i);
  assert.match(updateEmployee, /p_input ->> 'expected_role_version'/i);
  assert.match(
    updateEmployee,
    /v_employee\.version <> v_expected_version[\s\S]+enterprise_version_conflict/i,
  );
  assert.match(
    updateEmployee,
    /v_role_is_changing and v_expected_role_version is null[\s\S]+invalid_employee_role_transition/i,
  );
  assert.match(
    updateEmployee,
    /v_role_is_changing and v_next_role\.version <> v_expected_role_version[\s\S]+enterprise_version_conflict/i,
  );
  assert.match(
    updateEmployee,
    /order by task\.id[\s\S]+for update of task[\s\S]+order by employee\.id[\s\S]+for update of employee[\s\S]+order by role_row\.id[\s\S]+for share of role_row/i,
  );
});

test("only incompatible open assignments require role-transition resolution", () => {
  const updateEmployee = readFunction(
    readMigration(),
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(updateEmployee, /role_transition_mode[\s\S]+\('unassign', 'reassign'\)/i);
  assert.match(
    updateEmployee,
    /into v_role_task_ids[\s\S]+task\.archived_at is null[\s\S]+task\.completed_at is null[\s\S]+not \('tasks\.view' = any\(v_next_role\.permissions\)\)[\s\S]+v_next_role\.access_scope = 'restricted'[\s\S]+next_role_board\.board_id is null/i,
  );
  assert.match(
    updateEmployee,
    /v_role_task_count > 0 and v_role_transition_mode is null[\s\S]+employee_role_transition_required/i,
  );
  assert.match(
    updateEmployee,
    /delete from public\.merchant_task_assignees[\s\S]+employee_id = v_employee_id[\s\S]+task_id = any\(v_role_task_ids\)/i,
  );
  assert.doesNotMatch(
    updateEmployee,
    /delete from public\.merchant_task_assignees[\s\S]{0,180}employee_id = v_employee_id[\s\S]{0,180}task_id = any\(v_open_task_ids\)[\s\S]{0,300}'employee_role_transitioned'/i,
    "the role-transition branch must not remove compatible open assignments",
  );
});

test("employee actors and replacement employees are revalidated for every affected board", () => {
  const updateEmployee = readFunction(
    readMigration(),
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(
    updateEmployee,
    /v_actor_employee[\s\S]+status = 'active'[\s\S]+v_actor_role[\s\S]+status = 'active'[\s\S]+'employees\.manage' = any\(permissions\)/i,
  );
  assert.match(
    updateEmployee,
    /v_role_task_count > 0 and v_actor_type = 'employee'[\s\S]+'tasks\.assign' = any\(v_actor_role\.permissions\)[\s\S]+employee_role_transition_scope_denied/i,
  );
  assert.match(
    updateEmployee,
    /v_actor_role\.access_scope = 'restricted'[\s\S]+task\.id = any\(v_role_task_ids\)[\s\S]+actor_board\.board_id is null[\s\S]+employee_role_transition_scope_denied/i,
  );
  assert.match(
    updateEmployee,
    /v_replacement_employee\.status <> 'active'[\s\S]+employee_role_transition_replacement_invalid/i,
  );
  assert.match(
    updateEmployee,
    /v_replacement_role[\s\S]+status = 'active'[\s\S]+'tasks\.view' = any\(permissions\)[\s\S]+replacement_board\.board_id is null[\s\S]+employee_role_transition_replacement_invalid/i,
  );
});

test("role-transition assignment changes and task events are atomic", () => {
  const updateEmployee = readFunction(
    readMigration(),
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(
    updateEmployee,
    /insert into public\.merchant_task_assignees[\s\S]+unnest\(v_role_task_ids\)[\s\S]+on conflict \(merchant_id, task_id, employee_id\) do nothing/i,
  );
  assert.match(
    updateEmployee,
    /update public\.merchant_tasks[\s\S]+set updated_at = updated_at/i,
  );
  assert.match(
    updateEmployee,
    /'assigneeIds', v_final_assignee_ids[\s\S]+'oldRoleId', v_current_role\.id::text[\s\S]+'newRoleId', v_next_role\.id::text[\s\S]+'replacementEmployeeId', v_replacement_employee_id::text/i,
  );
  assert.match(
    updateEmployee,
    /insert into public\.merchant_task_events[\s\S]+'employee_role_transitioned'[\s\S]+v_event_payload/i,
  );
  assert.match(
    updateEmployee,
    /employee_role_transitioned[\s\S]+update public\.merchant_enterprise_employees[\s\S]+role_id = v_next_role\.id/i,
  );
});

test("migration 011 preserves the migration 010 offboarding contract", () => {
  const updateEmployee = readFunction(
    readMigration(),
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(
    updateEmployee,
    /v_open_task_count > 0 and v_offboarding_mode is null[\s\S]+employee_open_tasks_require_resolution/i,
  );
  assert.match(
    updateEmployee,
    /employee_offboarding_scope_denied[\s\S]+employee_offboarding_replacement_invalid/i,
  );
  assert.match(
    updateEmployee,
    /delete from public\.merchant_task_assignees[\s\S]+task_id = any\(v_open_task_ids\)/i,
  );
  assert.match(updateEmployee, /'employee_offboarded'/i);
  assert.match(
    updateEmployee,
    /'offboardedEmployeeId', v_employee_id::text[\s\S]+'replacementEmployeeId', v_replacement_employee_id::text/i,
  );
});

test("employee role-transition RPC remains service-only and migration is forward-only", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_update_merchant_enterprise_employee_v1\(jsonb\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_update_merchant_enterprise_employee_v1\(jsonb\)\s+to service_role/i,
  );
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202607310011, 'merchant_enterprise_employee_role_transition'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /delete from public\.merchant_enterprise_employees/i);
});
