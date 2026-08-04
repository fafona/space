import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608040025_merchant_enterprise_todos.sql",
);

function source() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readFunction(sql, name) {
  const marker = `create or replace function public.${name}(`;
  const start = sql.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return sql.slice(start, end + 4);
}

test("025 adds a read-only, service-role todo RPC inside one migration transaction", () => {
  const sql = source();
  assert.match(sql, /^--[\s\S]+\nbegin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(
    sql,
    /create or replace function public\.faolla_list_merchant_enterprise_todos_v1\(\s*p_input jsonb/i,
  );
  assert.match(
    sql,
    /security definer\s+set search_path = public/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.faolla_list_merchant_enterprise_todos_v1\(jsonb\)[\s\S]+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.faolla_list_merchant_enterprise_todos_v1\(jsonb\)\s+to service_role/i,
  );
  const writtenTables = [
    ...sql.matchAll(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+public\.([a-z0-9_]+)/gi,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(writtenTables, ["faolla_schema_migrations"]);
  assert.match(
    sql,
    /insert into public\.faolla_schema_migrations \(version, name\)[\s\S]+202608040025, 'merchant_enterprise_todos'/i,
  );
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});

test("todo RPC strictly validates bounded categories, page size and a complete keyset", () => {
  const fn = readFunction(source(), "faolla_list_merchant_enterprise_todos_v1");
  for (const key of [
    "merchant_id",
    "actor_type",
    "actor_id",
    "category",
    "limit",
    "cursor_bucket",
    "cursor_sort_at",
    "cursor_kind",
    "cursor_id",
  ]) {
    assert.match(fn, new RegExp(`'${key}'`, "i"));
  }
  assert.match(fn, /category[^\n]+not in \('all', 'tasks', 'workflows'\)/i);
  assert.match(fn, /v_limit < 1 or v_limit > 50/i);
  assert.match(fn, /cursor_bucket[\s\S]+cursor_sort_at[\s\S]+cursor_kind[\s\S]+cursor_id/i);
  assert.match(fn, /\(bucket, sort_at, kind, entity_id\)\s*>/i);
  assert.match(fn, /order by bucket, sort_at, kind, entity_id/i);
  assert.doesNotMatch(fn, /\boffset\b/i);
});

test("todo RPC reauthorizes the active actor and enforces task permissions and board scope", () => {
  const fn = readFunction(source(), "faolla_list_merchant_enterprise_todos_v1");
  assert.match(
    fn,
    /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view'\]::text\[\]/i,
  );
  assert.match(
    fn,
    /merchant_enterprise_employees[\s\S]+merchant_enterprise_roles[\s\S]+employee\.status = 'active'[\s\S]+role_row\.status = 'active'/i,
  );
  assert.match(fn, /v_can_view_tasks := 'tasks\.view' = any\(v_permissions\)/i);
  assert.match(fn, /v_can_assign_tasks := 'tasks\.assign' = any\(v_permissions\)/i);
  assert.match(
    fn,
    /v_access_scope = 'all'[\s\S]+merchant_enterprise_role_boards[\s\S]+role_board\.board_id = task\.board_id/i,
  );
  assert.match(
    fn,
    /task\.archived_at is null[\s\S]+task\.completed_at is null/i,
  );
  assert.match(
    fn,
    /assigned_to_me[\s\S]+v_can_assign_tasks[\s\S]+assignee_count = 0 or task\.due_at < v_now/i,
  );
});

test("todo RPC exposes current-revision acknowledgements and only the employee's open executions", () => {
  const fn = readFunction(source(), "faolla_list_merchant_enterprise_todos_v1");
  assert.match(fn, /'workflow_acknowledgement'::text/i);
  assert.match(
    fn,
    /revision\.id = workflow\.current_revision_id[\s\S]+workflow\.status = 'published'/i,
  );
  assert.match(
    fn,
    /merchant_enterprise_workflow_acknowledgements[\s\S]+acknowledgement\.revision_id = workflow\.current_revision_id[\s\S]+acknowledgement\.employee_id = v_employee_id/i,
  );
  assert.match(fn, /'workflow_execution'::text/i);
  assert.match(
    fn,
    /execution\.employee_id = v_employee_id[\s\S]+execution\.status = 'in_progress'/i,
  );
  assert.match(fn, /v_actor_type = 'employee'[\s\S]+v_can_view_workflows/i);
});

test("open feedback is workflow-manager-only and remains cross-version", () => {
  const fn = readFunction(source(), "faolla_list_merchant_enterprise_todos_v1");
  assert.match(
    fn,
    /v_can_manage_workflows := 'workflows\.manage' = any\(v_permissions\)[\s\S]+or 'workflows\.publish' = any\(v_permissions\)/i,
  );
  assert.match(fn, /'workflow_feedback'::text/i);
  assert.match(
    fn,
    /v_can_view_workflows[\s\S]+v_can_manage_workflows[\s\S]+execution\.feedback_status = 'open'/i,
  );
  const feedbackStart = fn.indexOf("'workflow_feedback'::text");
  const acknowledgementStart = fn.indexOf("'workflow_acknowledgement'::text");
  const feedbackBranch = fn.slice(feedbackStart, acknowledgementStart);
  assert.doesNotMatch(feedbackBranch, /current_revision_id|revision_id\s*=/i);
});

test("counts are calculated before cursor filtering and the tenant marker is explicit", () => {
  const fn = readFunction(source(), "faolla_list_merchant_enterprise_todos_v1");
  const candidatesAt = fn.indexOf("with all_candidates as materialized");
  const categoryAt = fn.indexOf("category_candidates as materialized");
  const filteredAt = fn.indexOf("filtered_candidates as materialized");
  const countsAt = fn.indexOf("'counts', jsonb_build_object");
  assert.ok(
    candidatesAt >= 0 &&
      categoryAt > candidatesAt &&
      filteredAt > categoryAt &&
      countsAt > filteredAt,
  );
  assert.match(
    fn,
    /from all_candidates[\s\S]+v_category = 'all'[\s\S]+v_category = 'tasks' and kind = 'task'[\s\S]+v_category = 'workflows' and kind <> 'task'/i,
  );
  assert.match(fn, /'merchantId', v_site_id/i);
  for (const key of [
    "openCount",
    "taskCount",
    "overdueCount",
    "dueSoonCount",
    "acknowledgementCount",
    "executionCount",
    "feedbackCount",
  ]) {
    assert.match(fn, new RegExp(`'${key}'`, "i"));
  }
  assert.match(fn, /from all_candidates\)/i);
  assert.match(fn, /'nextCursor'[\s\S]+'category', v_category[\s\S]+'entityId', item\.entity_id/i);
});

test("due-soon classification is deterministic and the employee execution read is indexed", () => {
  const sql = source();
  const fn = readFunction(sql, "faolla_list_merchant_enterprise_todos_v1");
  assert.match(fn, /v_now timestamptz := statement_timestamp\(\)/i);
  assert.match(fn, /v_now \+ interval '72 hours'/i);
  assert.match(
    sql,
    /merchant_enterprise_workflow_execution_open_employee_idx[\s\S]+merchant_id, employee_id, updated_at, id[\s\S]+where status = 'in_progress'/i,
  );
});

test("todo subtitles remain readable Chinese and keep their deterministic separators", () => {
  const sql = source();
  assert.match(sql, /board\.name \|\| ' · ' \|\| task_column\.name as subtitle/);
  assert.match(sql, /employee\.display_name \|\| ' 提交了待处理反馈'/);
  assert.match(sql, /completed_steps::text \|\| '\/' \|\| execution\.total_steps::text \|\| ' 步已完成'/);
  assert.doesNotMatch(sql, /鎻愪氦|姝ュ凡|锟|\uFFFD/);
});
