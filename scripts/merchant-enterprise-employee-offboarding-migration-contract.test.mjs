import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310010_merchant_enterprise_employee_offboarding.sql",
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

test("employee role delegation cannot exceed the employee actor", () => {
  const source = readMigration();
  const helper = readFunction(
    source,
    "faolla_merchant_enterprise_role_fits_actor_v1",
  );

  assert.match(helper, /actor_role\.status = 'active'/i);
  assert.match(helper, /target_role\.status = 'active'/i);
  assert.match(
    helper,
    /target_role\.permissions\s*<@\s*actor_role\.permissions/i,
  );
  assert.match(
    helper,
    /actor_role\.access_scope = 'all'[\s\S]+target_role\.access_scope = 'restricted'/i,
  );
  assert.match(
    helper,
    /merchant_enterprise_role_boards as target_board[\s\S]+merchant_enterprise_role_boards as actor_board[\s\S]+actor_board\.board_id is null/i,
  );
});

test("employee create RPC revalidates authority and creates an invitation", () => {
  const source = readMigration();
  const createEmployee = readFunction(
    source,
    "faolla_create_merchant_enterprise_employee_v1",
  );

  assert.match(createEmployee, /returns jsonb/i);
  assert.match(createEmployee, /language plpgsql/i);
  assert.match(createEmployee, /security definer/i);
  assert.match(createEmployee, /set search_path = public/i);
  assert.match(
    createEmployee,
    /p_input ->> 'merchant_id'[\s\S]+p_input ->> 'email'[\s\S]+p_input ->> 'display_name'[\s\S]+p_input ->> 'role_id'[\s\S]+p_input ->> 'actor_type'[\s\S]+p_input ->> 'actor_id'/i,
  );
  assert.doesNotMatch(createEmployee, /p_input\s*->>\s*'operation_id'/i);
  assert.match(
    createEmployee,
    /merchant_enterprise_employees as employee[\s\S]+employee\.status = 'active'[\s\S]+role_row\.status = 'active'[\s\S]+'employees\.manage' = any\(role_row\.permissions\)/i,
  );
  assert.match(
    createEmployee,
    /faolla_merchant_enterprise_role_fits_actor_v1[\s\S]+permission_escalation_denied/i,
  );
  assert.doesNotMatch(createEmployee, /raise exception 'permission_denied'/i);
  assert.match(
    createEmployee,
    /insert into public\.merchant_enterprise_employees[\s\S]+'invited'[\s\S]+statement_timestamp\(\)/i,
  );
  assert.match(createEmployee, /when unique_violation[\s\S]+employee_email_in_use/i);
  assert.match(
    createEmployee,
    /'employee', to_jsonb\(v_employee\) - 'invitation_token_hash'/i,
  );
});

test("employee update RPC uses CAS and revalidates both current and next roles", () => {
  const source = readMigration();
  const updateEmployee = readFunction(
    source,
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(updateEmployee, /expected_version/i);
  assert.doesNotMatch(updateEmployee, /p_input\s*->>\s*'operation_id'/i);
  assert.match(
    updateEmployee,
    /from public\.merchant_enterprise_employees[\s\S]+merchant_id = v_site_id[\s\S]+id = v_employee_id[\s\S]+for update/i,
  );
  assert.match(
    updateEmployee,
    /v_employee\.version <> v_expected_version[\s\S]+enterprise_version_conflict/i,
  );
  assert.match(
    updateEmployee,
    /v_actor_employee_id = v_employee_id[\s\S]+permission_escalation_denied/i,
  );
  assert.match(
    updateEmployee,
    /employee\.status = 'active'[\s\S]+role_row\.status = 'active'[\s\S]+'employees\.manage' = any\(role_row\.permissions\)/i,
  );
  assert.doesNotMatch(updateEmployee, /raise exception 'permission_denied'/i);
  assert.ok(
    (updateEmployee.match(/faolla_merchant_enterprise_role_fits_actor_v1/gi) ?? [])
      .length >= 2,
    "the target employee's current and next roles must remain within actor authority",
  );
  assert.match(
    updateEmployee,
    /array\[v_employee_id, v_actor_employee_id, v_replacement_employee_id\][\s\S]+order by employee\.id[\s\S]+for update of employee/i,
  );
  assert.match(
    updateEmployee,
    /update public\.merchant_enterprise_employees[\s\S]+display_name = v_next_display_name[\s\S]+role_id = v_next_role\.id[\s\S]+status = v_next_status[\s\S]+version = v_expected_version[\s\S]+returning \* into v_employee/i,
  );
});

test("active employee offboarding resolves every open task atomically", () => {
  const source = readMigration();
  const updateEmployee = readFunction(
    source,
    "faolla_update_merchant_enterprise_employee_v1",
  );

  assert.match(
    updateEmployee,
    /task\.archived_at is null[\s\S]+task\.completed_at is null/i,
  );
  assert.match(
    updateEmployee,
    /v_open_task_count > 0 and v_offboarding_mode is null[\s\S]+employee_open_tasks_require_resolution/i,
  );
  assert.match(
    updateEmployee,
    /'tasks\.assign' = any\(v_actor_role\.permissions\)[\s\S]+employee_offboarding_scope_denied/i,
  );
  assert.match(
    updateEmployee,
    /v_actor_role\.access_scope = 'restricted'[\s\S]+actor_board\.board_id is null[\s\S]+employee_offboarding_scope_denied/i,
  );
  assert.match(
    updateEmployee,
    /into v_replacement_employee[\s\S]+status = 'active'[\s\S]+into v_replacement_role[\s\S]+status = 'active'[\s\S]+'tasks\.view' = any\(permissions\)/i,
  );
  assert.match(updateEmployee, /employee_offboarding_replacement_invalid/i);
  assert.match(
    updateEmployee,
    /replacement_board\.board_id is null[\s\S]+employee_offboarding_replacement_invalid/i,
  );
  assert.match(
    updateEmployee,
    /insert into public\.merchant_task_assignees[\s\S]+on conflict \(merchant_id, task_id, employee_id\) do nothing[\s\S]+delete from public\.merchant_task_assignees/i,
  );
  assert.match(
    updateEmployee,
    /update public\.merchant_tasks[\s\S]+set updated_at = updated_at/i,
  );
  assert.match(
    updateEmployee,
    /'assigneeIds', v_final_assignee_ids[\s\S]+'offboardedEmployeeId', v_employee_id::text[\s\S]+'replacementEmployeeId', v_replacement_employee_id::text/i,
  );
  assert.match(
    updateEmployee,
    /insert into public\.merchant_task_events[\s\S]+'employee_offboarded'[\s\S]+v_event_payload/i,
  );
});

test("direct writes preserve employee lifecycle and resolve open tasks", () => {
  const source = readMigration();
  const guard = readFunction(
    source,
    "faolla_guard_merchant_employee_open_task_disable_v1",
  );

  assert.match(
    guard,
    /old\.status = 'active'[\s\S]+new\.status <> 'active'[\s\S]+employee_open_tasks_require_resolution/i,
  );
  assert.match(
    guard,
    /merchant_task_assignees[\s\S]+merchant_tasks[\s\S]+task\.archived_at is null[\s\S]+task\.completed_at is null/i,
  );
  assert.match(guard, /employee_open_tasks_require_resolution/i);
  assert.match(
    guard,
    /old\.status <> 'invited' and new\.status = 'invited'[\s\S]+invalid_employee_status_transition/i,
  );
  assert.match(
    source,
    /before update of status on public\.merchant_enterprise_employees[\s\S]+faolla_guard_merchant_employee_open_task_disable_v1\(\)/i,
  );
});

test("task reopening rejects every stale or out-of-scope assignee", () => {
  const source = readMigration();
  const guard = readFunction(
    source,
    "faolla_guard_merchant_task_reactivation_assignees_v1",
  );

  assert.match(
    guard,
    /new\.archived_at is null[\s\S]+new\.completed_at is null[\s\S]+old\.archived_at is not null[\s\S]+or old\.completed_at is not null/i,
  );
  assert.match(guard, /left join public\.merchant_enterprise_employees/i);
  assert.match(guard, /left join public\.merchant_enterprise_roles/i);
  assert.match(guard, /employee\.id is null[\s\S]+employee\.status <> 'active'/i);
  assert.match(guard, /role_row\.id is null[\s\S]+role_row\.status <> 'active'/i);
  assert.match(guard, /not \('tasks\.view' = any\(role_row\.permissions\)\)/i);
  assert.match(
    guard,
    /role_row\.access_scope = 'restricted'[\s\S]+role_board\.board_id is null/i,
  );
  assert.match(guard, /task_assignee_board_access_denied/i);
});

test("employee mutation RPCs are service-only and migration is atomic", () => {
  const source = readMigration();

  for (const name of [
    "faolla_create_merchant_enterprise_employee_v1",
    "faolla_update_merchant_enterprise_employee_v1",
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

  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202607310010, 'merchant_enterprise_employee_offboarding'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /delete from public\.merchant_enterprise_employees/i);
});
