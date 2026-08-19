import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608190034_merchant_enterprise_current_operations.sql",
);
const integrationRunnerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const integrationAcceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "53-current-operations.sql",
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

test("current operations RPC accepts only the frozen identity and target keys", () => {
  const query = readFunction(
    readMigration(),
    "faolla_get_merchant_enterprise_current_operations_v1",
  );
  assert.match(
    query,
    /jsonb_object_keys\(p_input\)[\s\S]+not in \(\s*'merchant_id', 'actor_type', 'actor_id', 'employee_id'\s*\)/i,
  );
  assert.match(query, /v_site_id !~ '\^\[0-9\]\{8\}\$'/i);
  assert.match(query, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(query, /v_requested_employee_id_text[\s\S]+::uuid/i);
  assert.doesNotMatch(query, /'cursor'|'created_from'|'created_to'/gi);
});

test("RPC reauthorizes the owner or active employee and current role before reads", () => {
  const query = readFunction(
    readMigration(),
    "faolla_get_merchant_enterprise_current_operations_v1",
  );
  const ownerCheck = query.search(/v_merchant\.owner_user_id/i);
  const employeeCheck = query.search(
    /from public\.merchant_enterprise_employees[\s\S]+status = 'active'/i,
  );
  const roleCheck = query.search(
    /from public\.merchant_enterprise_roles[\s\S]+status = 'active'/i,
  );
  const firstTaskRead = query.search(/from public\.merchant_tasks as task/i);
  assert.ok(ownerCheck >= 0);
  assert.ok(employeeCheck > ownerCheck);
  assert.ok(roleCheck > employeeCheck);
  assert.ok(firstTaskRead > roleCheck);
  assert.match(
    query,
    /faolla_valid_merchant_enterprise_permissions_v1\(\s*v_actor_role\.permissions\s*\)/i,
  );
  assert.match(query, /'tasks\.view' = any\(v_actor_role\.permissions\)/i);
  assert.match(
    query,
    /v_effective_employee_id <> v_actor_employee\.id[\s\S]+not \('employees\.view' = any\(v_actor_role\.permissions\)\)[\s\S]+raise exception 'permission_denied'[\s\S]+target_employee/i,
  );
});

test("restricted callers are scoped by current role-board membership", () => {
  const query = readFunction(
    readMigration(),
    "faolla_get_merchant_enterprise_current_operations_v1",
  );
  assert.match(
    query,
    /v_scope_restricted := v_actor_role\.access_scope = 'restricted'/i,
  );
  assert.match(
    query,
    /visible_boards as materialized[\s\S]+board\.status = 'active'[\s\S]+not v_scope_restricted[\s\S]+from public\.merchant_enterprise_role_boards as role_board[\s\S]+role_board\.role_id = v_actor_role\.id[\s\S]+role_board\.board_id = board\.id/i,
  );
  assert.match(
    query,
    /'scopeRestricted', v_scope_restricted/i,
  );
});

test("current-state counts use one task row and exact rolling UTC boundaries", () => {
  const query = readFunction(
    readMigration(),
    "faolla_get_merchant_enterprise_current_operations_v1",
  );
  assert.match(query, /v_as_of timestamptz := statement_timestamp\(\)/i);
  assert.match(
    query,
    /current_tasks as materialized[\s\S]+task\.archived_at is null[\s\S]+task\.completed_at is null/i,
  );
  assert.match(
    query,
    /v_effective_employee_id is null[\s\S]+exists \([\s\S]+target_assignment\.employee_id = v_effective_employee_id/i,
  );
  assert.match(query, /due_at < v_as_of/i);
  assert.match(
    query,
    /due_at >= v_as_of[\s\S]+due_at < v_as_of \+ interval '168 hours'/i,
  );
  assert.match(query, /count\(distinct board_id\)::integer as involved_board_count/i);
  assert.match(query, /assignee_count = 0[\s\S]+as unassigned_task_count/i);
  assert.match(query, /assignee_count > 1[\s\S]+as shared_assignment_task_count/i);
  assert.doesNotMatch(query, /primary_owner|episode|completion_rate|on_time|average_duration/i);
});

test("response exposes bounded deterministic boards and priority tasks without payload text", () => {
  const query = readFunction(
    readMigration(),
    "faolla_get_merchant_enterprise_current_operations_v1",
  );
  for (const key of [
    "asOf",
    "scope",
    "employeeId",
    "scopeRestricted",
    "boardSummaryTotalCount",
    "boardsTruncated",
    "summary",
    "boards",
    "priorityTasks",
  ]) {
    assert.match(query, new RegExp(`'${key}'`, "i"));
  }
  assert.match(
    query,
    /selected_boards[\s\S]+overdue_task_count desc[\s\S]+open_task_count desc[\s\S]+board_name[\s\S]+board_id[\s\S]+limit 100/i,
  );
  assert.match(
    query,
    /selected_priority_tasks[\s\S]+task\.due_at asc nulls last[\s\S]+task\.updated_at desc[\s\S]+task\.id[\s\S]+limit 6/i,
  );
  assert.doesNotMatch(
    query,
    /'description'|'email'|'authUserId'|'auth_user_id'|'assigneeIds'|'assignee_ids'|'payload'/i,
  );
});

test("migration builds retryable exact concurrent indexes before registration", () => {
  const source = readMigration();
  assert.match(
    source,
    /commit\s*;[\s\S]+drop index concurrently if exists\s+public\.merchant_tasks_current_operations_idx[\s\S]+create index concurrently\s+merchant_tasks_current_operations_idx[\s\S]+where archived_at is null and completed_at is null/i,
  );
  assert.match(
    source,
    /drop index concurrently if exists\s+public\.merchant_task_assignees_employee_task_idx[\s\S]+create index concurrently\s+merchant_task_assignees_employee_task_idx[\s\S]+merchant_id, employee_id, task_id/i,
  );
  assert.doesNotMatch(source, /create index concurrently if not exists/i);
  assert.doesNotMatch(source, /pg_get_indexdef/i);
  assert.match(
    source,
    /index_metadata\.indisready[\s\S]+index_metadata\.indisvalid[\s\S]+index_metadata\.indislive[\s\S]+index_metadata\.indkey\[0\][\s\S]+pg_index_column_has_property/i,
  );
  assert.match(source, /set local quote_all_identifiers = off/i);
  assert.match(
    source,
    /pg_get_expr\(\s*index_metadata\.indpred,\s*index_metadata\.indrelid,\s*false\s*\)\s*=\s*'\(\(archived_at IS NULL\) AND \(completed_at IS NULL\)\)'/i,
  );
  assert.match(
    source,
    /merchant_enterprise_current_operations_index_invalid[\s\S]+values \(202608190034, 'merchant_enterprise_current_operations'\)/i,
  );
});

test("migration is additive, prerequisite-gated and service-role only", () => {
  const source = readMigration();
  assert.match(
    source,
    /to_regprocedure\(\s*'public\.faolla_valid_merchant_enterprise_permissions_v1\(text\[\]\)'\s*\)/i,
  );
  assert.match(source, /\('merchant_task_boards', 'position'\)/i);
  assert.match(
    source,
    /revoke all on function public\.faolla_get_merchant_enterprise_current_operations_v1\(jsonb\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_get_merchant_enterprise_current_operations_v1\(jsonb\)\s+to service_role/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /drop\s+table|drop\s+column|delete\s+from|update\s+public\.merchant_tasks|insert\s+into\s+public\.merchant_tasks/i);
});

test("disposable PostgreSQL acceptance covers retries, GUC stability and authorization", () => {
  const runner = fs.readFileSync(integrationRunnerPath, "utf8");
  const acceptance = fs.readFileSync(integrationAcceptancePath, "utf8");
  assert.match(
    runner,
    /Expected 30 enterprise\/identity migrations \(001-026 plus 032-035\)/i,
  );
  assert.match(
    runner,
    /create index merchant_tasks_current_operations_idx[\s\S]+create index merchant_task_assignees_employee_task_idx/i,
  );
  assert.match(
    runner,
    /PGOPTIONS="\$\{PGOPTIONS\} -c quote_all_identifiers=on" run_sql_file "\$\{migration\}"/i,
  );
  assert.match(
    runner,
    /202608190034[\s\S]+Expected 34 applied prerequisite\/enterprise\/identity versions/i,
  );
  assert.match(runner, /run_sql_file "\$\{SCRIPT_DIR\}\/53-current-operations\.sql"/i);

  assert.match(acceptance, /begin;[\s\S]+rollback;\s*$/i);
  assert.match(
    acceptance,
    /Visible overdue shared[\s\S]+merchant_task_assignees[\s\S]+96000000-0000-4000-8000-000000000002/i,
  );
  assert.match(
    acceptance,
    /summary,openTaskCount[\s\S]+summary,sharedAssignmentTaskCount[\s\S]+priorityTasks,5,id/i,
  );
  assert.match(
    acceptance,
    /Visible exactly at as-of[\s\S]+excluded the inclusive asOf boundary[\s\S]+Visible exactly at 168 hours[\s\S]+included the exclusive asOf \+ 168h boundary/i,
  );
  assert.match(
    acceptance,
    /scopeRestricted[\s\S]+boardSummaryTotalCount[\s\S]+93000000-0000-4000-8000-000000000001/i,
  );
  assert.match(
    acceptance,
    /current-operations-invited@example\.test[\s\S]+current-operations-disabled@example\.test[\s\S]+employee_not_found/i,
  );
  assert.match(
    acceptance,
    /permission_denied[\s\S]+permission denied for function[\s\S]+has_function_privilege/i,
  );
  assert.match(
    acceptance,
    /20000000-0000-4000-8000-000000000002[\s\S]+50000000-0000-4000-8000-000000000005[\s\S]+permission_denied/i,
  );
  assert.match(
    acceptance,
    /previously valid actor must stop reading immediately[\s\S]+set status = 'archived'[\s\S]+set status = 'disabled'/i,
  );
});
