import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608040024_merchant_enterprise_published_choices.sql",
);
const executionMigrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608040022_merchant_enterprise_workflow_execution.sql",
);
const integrationFixturePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "48-task-workflow-binding.sql",
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

test("024 creates one immutable published-revision binding per task", () => {
  const sql = source();
  assert.match(sql, /^--[\s\S]+\nbegin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(
    sql,
    /create table if not exists public\.merchant_task_workflow_bindings[\s\S]+primary key \(merchant_id, task_id\)/i,
  );
  assert.match(
    sql,
    /foreign key \(merchant_id, task_id\)[\s\S]+references public\.merchant_tasks\(merchant_id, id\)[\s\S]+on delete restrict/i,
  );
  assert.match(
    sql,
    /foreign key \(merchant_id, workflow_id, workflow_revision_id\)[\s\S]+merchant_enterprise_workflow_revisions\([\s\S]+merchant_id, workflow_id, id[\s\S]+on delete restrict/i,
  );
  assert.match(
    sql,
    /create trigger merchant_task_workflow_bindings_append_only\s+before update or delete/i,
  );
  assert.match(
    sql,
    /create trigger merchant_task_workflow_bindings_reject_truncate\s+before truncate/i,
  );
  assert.match(sql, /enable always trigger merchant_task_workflow_bindings_append_only/i);
  assert.match(sql, /enable always trigger merchant_task_workflow_bindings_reject_truncate/i);
});

test("task binding integration choice assertion is valid aggregate SQL", () => {
  const fixture = fs.readFileSync(integrationFixturePath, "utf8");
  assert.match(
    fixture,
    /bool_and\(\(select count\(\*\) = 6 from jsonb_object_keys\(choice\)\)\)/i,
  );
});

test("binding provenance never persists an owner auth UUID", () => {
  const sql = source();
  const bind = readFunction(sql, "faolla_bind_merchant_task_workflow_v1");
  assert.match(sql, /bound_by_actor_id uuid null/i);
  assert.match(
    sql,
    /merchant_task_workflow_bindings_actor_identity_check[\s\S]+bound_by_actor_type = 'owner' and bound_by_actor_id is null[\s\S]+bound_by_actor_type = 'employee' and bound_by_actor_id is not null/i,
  );
  assert.match(
    sql,
    /merchant_task_workflow_bindings_actor_employee_fk[\s\S]+foreign key \(merchant_id, bound_by_actor_id\)[\s\S]+references public\.merchant_enterprise_employees\(merchant_id, id\)/i,
  );
  assert.match(
    bind,
    /bound_by_actor_id[\s\S]+case[\s\S]+actor_type'\) = 'employee'[\s\S]+actor_id'\)::uuid[\s\S]+else null[\s\S]+end/i,
  );
  assert.match(
    bind,
    /'workflow_bound'[\s\S]+case[\s\S]+actor_type'\) = 'employee'[\s\S]+actor_id'\)[\s\S]+else ''[\s\S]+end/i,
  );
  assert.doesNotMatch(
    bind,
    /'workflow_bound',[\s\S]{0,240}btrim\(p_input ->> 'actor_type'\),\s*btrim\(p_input ->> 'actor_id'\)/i,
  );
});

test("generated checklist provenance is complete, unique, immutable, and tied to the binding", () => {
  const sql = source();
  assert.doesNotMatch(
    sql,
    /\bnot\s+case\b/i,
    "boolean CASE expressions must be parenthesized for PL/pgSQL parsing",
  );
  for (const column of [
    "source_workflow_id",
    "source_workflow_revision_id",
    "source_workflow_step_id",
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column} uuid null`, "i"));
  }
  assert.match(
    sql,
    /merchant_task_checklist_items_workflow_source_pair_check[\s\S]+source_workflow_id is null[\s\S]+source_workflow_revision_id is null[\s\S]+source_workflow_step_id is null[\s\S]+or[\s\S]+source_workflow_id is not null[\s\S]+source_workflow_revision_id is not null[\s\S]+source_workflow_step_id is not null/i,
  );
  assert.match(
    sql,
    /merchant_task_checklist_items_workflow_binding_fk[\s\S]+foreign key \([\s\S]+merchant_id,[\s\S]+task_id,[\s\S]+source_workflow_id,[\s\S]+source_workflow_revision_id[\s\S]+references public\.merchant_task_workflow_bindings/i,
  );
  assert.match(
    sql,
    /merchant_task_checklist_items_workflow_step_unique_idx[\s\S]+source_workflow_revision_id,[\s\S]+source_workflow_step_id[\s\S]+where source_workflow_revision_id is not null/i,
  );
  const guard = readFunction(
    sql,
    "faolla_guard_merchant_task_checklist_workflow_source_v1",
  );
  assert.match(guard, /tg_op = 'UPDATE'[\s\S]+is distinct from[\s\S]+task_checklist_workflow_source_immutable/i);
  assert.match(
    guard,
    /merchant_task_workflow_bindings[\s\S]+merchant_enterprise_workflow_revisions[\s\S]+jsonb_array_elements\(v_snapshot -> 'steps'\)[\s\S]+source_workflow_step_id/i,
  );
  assert.match(sql, /enable always trigger merchant_task_checklist_items_workflow_source_guard/i);
});

test("published picker always projects the current immutable revision and caps output at 200", () => {
  const list = readFunction(
    source(),
    "faolla_list_merchant_enterprise_published_workflow_choices_v1",
  );
  assert.match(
    list,
    /array\['merchant_id', 'actor_type', 'actor_id'\]/i,
  );
  assert.match(
    list,
    /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view', 'workflows\.view'\]/i,
  );
  assert.match(
    list,
    /revision\.merchant_id = workflow\.merchant_id[\s\S]+revision\.workflow_id = workflow\.id[\s\S]+revision\.id = workflow\.current_revision_id/i,
  );
  assert.match(list, /workflow\.merchant_id = v_site_id/i);
  assert.match(list, /workflow\.status = 'published'/i);
  assert.match(list, /'title', choice\.snapshot ->> 'title'/i);
  assert.match(list, /'scenario', choice\.snapshot ->> 'scenario'/i);
  assert.match(list, /'revision_id', choice\.revision_id/i);
  assert.match(list, /'step_count', jsonb_array_length\(choice\.snapshot -> 'steps'\)/i);
  assert.match(
    list,
    /return jsonb_build_object\([\s\S]+'merchantId', v_site_id,[\s\S]+'choices', v_choices/i,
  );
  assert.match(list, /limit 200/i);
  assert.doesNotMatch(list, /workflow\.title|workflow\.scenario|merchant_enterprise_workflow_steps/i);
});

test("binding GET reauthorizes task/workflow visibility and restricted board scope", () => {
  const auth = readFunction(
    source(),
    "faolla_authorize_merchant_task_workflow_read_v1",
  );
  assert.match(auth, /from public\.merchants[\s\S]+for share/i);
  assert.match(
    auth,
    /from public\.merchant_tasks[\s\S]+task\.merchant_id = v_site_id[\s\S]+task\.id = p_task_id[\s\S]+for share/i,
  );
  assert.match(
    auth,
    /permissions @> array\[[\s\S]+'enterprise\.view', 'tasks\.view', 'workflows\.view'[\s\S]+\]::text\[\]/i,
  );
  assert.match(
    auth,
    /v_role\.access_scope = 'restricted'[\s\S]+merchant_enterprise_role_boards[\s\S]+role_board\.board_id = v_board_id[\s\S]+permission_denied/i,
  );
  const get = readFunction(
    source(),
    "faolla_get_merchant_task_workflow_binding_v1",
  );
  assert.match(get, /array\['merchant_id', 'task_id', 'actor_type', 'actor_id'\]/i);
  assert.match(get, /faolla_authorize_merchant_task_workflow_read_v1/i);
  assert.match(get, /faolla_build_merchant_task_workflow_binding_v1/i);
  assert.match(
    get,
    /return jsonb_build_object\([\s\S]+'merchantId', v_site_id,[\s\S]+'binding', v_binding/i,
  );
  const build = readFunction(
    source(),
    "faolla_build_merchant_task_workflow_binding_v1",
  );
  assert.match(build, /'merchant_id', v_binding\.merchant_id/i);
});

test("binding write uses task-first authorization, revision CAS, and the checklist lock domain", () => {
  const bind = readFunction(source(), "faolla_bind_merchant_task_workflow_v1");
  assert.match(
    bind,
    /'expected_task_version'[\s\S]+'expected_revision_id'[\s\S]+'operation_id'/i,
  );
  const taskAuthAt = bind.indexOf("faolla_authorize_merchant_task_write_v1");
  const workflowAuthAt = bind.indexOf(
    "faolla_authorize_merchant_enterprise_workflow_actor_v1",
  );
  const checklistLockAt = bind.indexOf("faolla-enterprise-task-checklist:");
  assert.ok(taskAuthAt >= 0 && workflowAuthAt > taskAuthAt && checklistLockAt > workflowAuthAt);
  assert.match(bind, /array\['tasks\.update'\]::text\[\]/i);
  assert.match(
    bind,
    /array\['enterprise\.view', 'workflows\.view'\]::text\[\]/i,
  );
  assert.match(bind, /v_task\.version <> v_expected_task_version[\s\S]+enterprise_version_conflict/i);
  assert.match(bind, /v_task\.archived_at is not null[\s\S]+invalid_task_archived/i);
  assert.match(bind, /v_workflow\.status <> 'published'[\s\S]+workflow_not_published/i);
  assert.match(bind, /v_workflow\.current_revision_id <> v_revision_id[\s\S]+workflow_revision_changed/i);
  assert.match(
    bind,
    /revision\.merchant_id = v_site_id[\s\S]+revision\.workflow_id = v_workflow_id[\s\S]+revision\.id = v_revision_id/i,
  );
});

test("binding and execution checklist sources are mutually exclusive under the same task lock", () => {
  const sql = source();
  const executionSql = fs.readFileSync(executionMigrationPath, "utf8");
  const bind = readFunction(sql, "faolla_bind_merchant_task_workflow_v1");
  const start = readFunction(
    executionSql,
    "faolla_start_merchant_enterprise_workflow_execution_v1",
  );
  const guard = readFunction(
    sql,
    "faolla_guard_merchant_task_workflow_checklist_source_v1",
  );

  assert.match(
    bind,
    /faolla_authorize_merchant_task_write_v1\([\s\S]+v_task_id[\s\S]+array\['tasks\.update'\]::text\[\]/i,
  );
  assert.match(
    start,
    /faolla_authorize_merchant_task_write_v1\([\s\S]+v_task_id[\s\S]+array\['tasks\.update'\]::text\[\][\s\S]+from public\.merchant_tasks[\s\S]+id = v_task_id[\s\S]+for update/i,
  );
  assert.match(
    guard,
    /from public\.merchant_tasks[\s\S]+task\.merchant_id = v_merchant_id[\s\S]+task\.id = v_task_id[\s\S]+for update/i,
  );
  assert.match(
    guard,
    /v_source_kind = 'binding'[\s\S]+merchant_enterprise_workflow_executions[\s\S]+generated_checklist_count > 0[\s\S]+task_workflow_checklist_source_exists/i,
  );
  assert.match(
    guard,
    /v_source_kind = 'execution'[\s\S]+merchant_task_workflow_bindings[\s\S]+task_workflow_checklist_source_exists/i,
  );
  assert.match(
    sql,
    /create trigger merchant_task_workflow_bindings_source_exclusive[\s\S]+before insert[\s\S]+\(\s*'binding'\s*\)[\s\S]+enable always trigger merchant_task_workflow_bindings_source_exclusive/i,
  );
  assert.match(
    sql,
    /create trigger merchant_enterprise_workflow_executions_task_source_exclusive[\s\S]+before insert[\s\S]+\(\s*'execution'\s*\)[\s\S]+enable always trigger merchant_enterprise_workflow_executions_task_source_exclusive/i,
  );
});

test("binding and checklist generation are one idempotent all-or-nothing RPC", () => {
  const bind = readFunction(source(), "faolla_bind_merchant_task_workflow_v1");
  assert.match(
    bind,
    /faolla_claim_enterprise_structure_operation_v1\([\s\S]+'enterprise_task_workflow_bind_v1'[\s\S]+md5\(p_input::text\)/i,
  );
  assert.match(bind, /return v_claim -> 'response'/i);
  assert.match(
    bind,
    /v_active_count \+ v_step_count > 100[\s\S]+task_checklist_limit_reached/i,
  );
  const bindingInsertAt = bind.indexOf(
    "insert into public.merchant_task_workflow_bindings",
  );
  const checklistInsertAt = bind.indexOf(
    "insert into public.merchant_task_checklist_items",
  );
  const eventInsertAt = bind.indexOf("insert into public.merchant_task_events");
  const completeAt = bind.indexOf(
    "faolla_complete_enterprise_structure_operation_v1",
  );
  assert.ok(
    bindingInsertAt >= 0 &&
      checklistInsertAt > bindingInsertAt &&
      eventInsertAt > checklistInsertAt &&
      completeAt > eventInsertAt,
  );
  assert.match(
    bind,
    /text,[\s\S]+position,[\s\S]+source_workflow_id,[\s\S]+source_workflow_revision_id,[\s\S]+source_workflow_step_id/i,
  );
  assert.match(bind, /'workflow_bound'/i);
  assert.match(bind, /'generatedChecklistCount', v_step_count/i);
  assert.doesNotMatch(bind, /workflow_execution/i);
});

test("024 keeps storage private and exposes only three service-role RPCs", () => {
  const sql = source();
  assert.match(
    sql,
    /alter table public\.merchant_task_workflow_bindings enable row level security/i,
  );
  assert.match(
    sql,
    /revoke all on public\.merchant_task_workflow_bindings\s+from public, anon, authenticated, service_role/i,
  );
  for (const name of [
    "faolla_list_merchant_enterprise_published_workflow_choices_v1",
    "faolla_get_merchant_task_workflow_binding_v1",
    "faolla_bind_merchant_task_workflow_v1",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${name}\\(jsonb\\)\\s+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${name}\\(jsonb\\)\\s+to service_role`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /values \(202608040024, 'merchant_enterprise_published_choices_and_task_binding'\)/i,
  );
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\bdrop\s+column\b|\bdelete\s+from\b/i);
});
