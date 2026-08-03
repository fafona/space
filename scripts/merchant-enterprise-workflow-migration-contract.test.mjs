import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608030020_merchant_enterprise_workflows.sql",
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

test("workflow storage separates mutable drafts from append-only published revisions", () => {
  const sql = source();
  assert.match(
    sql,
    /create table if not exists public\.merchant_enterprise_workflows[\s\S]+current_revision_id uuid null[\s\S]+published_version integer[\s\S]+has_unpublished_changes boolean/i,
  );
  assert.match(
    sql,
    /create table if not exists public\.merchant_enterprise_workflow_steps[\s\S]+foreign key \(merchant_id, workflow_id\)[\s\S]+merchant_enterprise_workflows\(merchant_id, id\)/i,
  );
  assert.match(
    sql,
    /create table if not exists public\.merchant_enterprise_workflow_revisions[\s\S]+revision_no integer[\s\S]+snapshot jsonb[\s\S]+unique \(merchant_id, workflow_id, revision_no\)/i,
  );
  assert.match(
    sql,
    /merchant_enterprise_workflows_current_revision_fk[\s\S]+foreign key \(merchant_id, id, current_revision_id\)[\s\S]+merchant_enterprise_workflow_revisions\(merchant_id, workflow_id, id\)/i,
  );
  assert.match(
    sql,
    /create trigger merchant_enterprise_workflow_revisions_append_only\s+before update or delete/i,
  );
  const reject = readFunction(
    sql,
    "faolla_reject_merchant_workflow_revision_mutation_v1",
  );
  assert.match(reject, /raise exception 'workflow_revisions_append_only'/i);

  for (const table of [
    "merchant_enterprise_workflows",
    "merchant_enterprise_workflow_steps",
    "merchant_enterprise_workflow_revisions",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on public\\.${table}\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
  }
});

test("workflow validation mirrors the API limits and accepts ordered client UUIDs", () => {
  const sql = source();
  const tags = readFunction(sql, "faolla_valid_merchant_workflow_tags_v1");
  const steps = readFunction(sql, "faolla_valid_merchant_workflow_steps_v1");
  const replace = readFunction(sql, "faolla_replace_merchant_workflow_steps_v1");
  const create = readFunction(sql, "faolla_create_merchant_enterprise_workflow_v1");

  assert.match(tags, /jsonb_array_length\(p_tags\) > 10/i);
  assert.match(tags, /char_length\(v_value\) not between 1 and 40/i);
  assert.match(steps, /jsonb_array_length\(p_steps\) > 50/i);
  assert.match(
    steps,
    /coalesce\(jsonb_typeof\(v_step -> 'title'\), ''\) <> 'string'[\s\S]+char_length\(btrim\(v_step ->> 'title'\)\) not between 1 and 160/i,
  );
  assert.match(
    steps,
    /not \(v_step \? 'instruction'\)[\s\S]+coalesce\(jsonb_typeof\(v_step -> 'instruction'\), ''\) <> 'string'[\s\S]+char_length\(btrim\(v_step ->> 'instruction'\)\) not between 1 and 4000/i,
  );
  assert.match(
    steps,
    /coalesce\(jsonb_typeof\(v_step -> 'position'\), ''\) <> 'number'/i,
  );
  assert.match(steps, /v_step ->> 'position'\) <> v_position::text/i);
  assert.match(steps, /v_id = any\(v_seen_ids\)/i);
  assert.match(
    replace,
    /insert into public\.merchant_enterprise_workflow_steps \(\s+id, merchant_id, workflow_id/i,
  );
  assert.match(replace, /where id = v_step_id[\s\S]+raise exception 'invalid_workflow_step'/i);
  assert.doesNotMatch(create, /exists[\s\S]+step\.value \? 'id'[\s\S]+invalid_workflow_payload/i);
  assert.match(
    create,
    /coalesce\(jsonb_typeof\(p_input -> 'title'\), ''\) <> 'string'/i,
  );
  assert.match(
    create,
    /coalesce\(jsonb_typeof\(p_input -> 'operation_id'\), ''\) <> 'string'/i,
  );
  assert.match(
    create,
    /coalesce\(jsonb_typeof\(p_input -> 'scenario'\), ''\) <> 'string'[\s\S]+char_length\(btrim\(p_input ->> 'scenario'\)\) not between 1 and 500/i,
  );
  assert.match(create, /char_length\(coalesce\(p_input ->> 'description', ''\)\) > 5000/i);
  assert.match(
    create,
    /select count\(\*\)::integer into v_active_count\s+from public\.merchant_enterprise_workflows\s+where merchant_id = v_site_id\s+and status <> 'archived'/i,
  );
});

test("permissions support separate author and publisher duties without backfilling roles", () => {
  const sql = source();
  const validator = readFunction(
    sql,
    "faolla_valid_merchant_enterprise_permissions_v1",
  );
  for (const permission of [
    "workflows.view",
    "workflows.manage",
    "workflows.publish",
  ]) {
    assert.match(sql, new RegExp(`'${permission.replace(".", "\\.")}'`, "i"));
  }
  assert.match(
    validator,
    /not \('workflows\.manage' = any\(p_permissions\)\)[\s\S]+enterprise\.view[\s\S]+workflows\.view/i,
  );
  const publishDependency = validator.match(
    /not \('workflows\.publish' = any\(p_permissions\)\)[\s\S]+?\)\);/i,
  )?.[0];
  assert.ok(publishDependency);
  assert.match(publishDependency, /enterprise\.view[\s\S]+workflows\.view/i);
  assert.doesNotMatch(publishDependency, /workflows\.manage/i);

  const defaults = readFunction(sql, "faolla_add_default_workflow_permissions_v1");
  assert.match(
    defaults,
    /system_key = 'administrator'[\s\S]+workflows\.view[\s\S]+workflows\.manage[\s\S]+workflows\.publish/i,
  );
  assert.match(
    defaults,
    /system_key = 'supervisor'[\s\S]+workflows\.view[\s\S]+workflows\.manage/i,
  );
  assert.match(defaults, /system_key = 'employee'[\s\S]+workflows\.view/i);
  assert.doesNotMatch(defaults, /\bupdate\s+public\.merchant_enterprise_roles/i);
  assert.match(
    sql,
    /create trigger merchant_enterprise_roles_default_workflow_permissions\s+before insert on public\.merchant_enterprise_roles/i,
  );
});

test("workflow writes reauthorize, use idempotency and enforce action-specific CAS", () => {
  const sql = source();
  const authorize = readFunction(
    sql,
    "faolla_authorize_merchant_enterprise_workflow_actor_v1",
  );
  const create = readFunction(sql, "faolla_create_merchant_enterprise_workflow_v1");
  const update = readFunction(sql, "faolla_update_merchant_enterprise_workflow_v1");

  assert.match(authorize, /from public\.merchants[\s\S]+for share/i);
  assert.match(authorize, /merchant_id = v_site_id[\s\S]+id = v_actor_id[\s\S]+for share/i);
  assert.match(authorize, /v_employee\.status <> 'active'/i);
  assert.match(authorize, /v_role\.status <> 'active'/i);
  assert.match(authorize, /v_role\.permissions @> p_required_permissions/i);
  assert.match(authorize, /faolla_valid_merchant_enterprise_permissions_v1/i);
  assert.match(
    authorize,
    /v_actor_type is null[\s\S]+v_actor_type not in \('owner', 'employee'\)/i,
  );

  for (const fn of [create, update]) {
    assert.match(fn, /faolla_claim_enterprise_structure_operation_v1/i);
    assert.match(fn, /faolla_complete_enterprise_structure_operation_v1/i);
    assert.match(fn, /faolla_authorize_merchant_enterprise_workflow_actor_v1/i);
  }
  assert.match(
    create,
    /array\['enterprise\.view', 'workflows\.view', 'workflows\.manage'\]/i,
  );
  assert.match(
    update,
    /v_action = 'save'[\s\S]+array\['enterprise\.view', 'workflows\.view', 'workflows\.manage'\][\s\S]+else[\s\S]+array\['enterprise\.view', 'workflows\.view', 'workflows\.publish'\]/i,
  );
  assert.match(
    update,
    /v_action = 'save'[\s\S]+title[\s\S]+scenario[\s\S]+steps[\s\S]+elsif not public\.faolla_merchant_workflow_object_has_only_keys_v1[\s\S]+expected_version', 'action'/i,
  );
  assert.match(update, /for update[\s\S]+v_workflow\.version <> v_expected_version/i);
  assert.match(
    update,
    /v_action is null[\s\S]+v_action not in \('save', 'publish', 'archive', 'restore'\)/i,
  );
  assert.match(
    update,
    /coalesce\(jsonb_typeof\(p_input -> 'action'\), ''\) <> 'string'/i,
  );
  assert.match(
    update,
    /coalesce\(jsonb_typeof\(p_input -> 'workflow_id'\), ''\) <> 'string'[\s\S]+coalesce\(jsonb_typeof\(p_input -> 'operation_id'\), ''\) <> 'string'/i,
  );
  assert.match(
    update,
    /coalesce\(jsonb_typeof\(p_input -> 'expected_version'\), ''\) <> 'number'/i,
  );
  assert.match(update, /raise exception 'enterprise_version_conflict'/i);
  assert.match(update, /raise exception 'workflow_publish_incomplete'/i);
});

test("publication creates an immutable revision and view-only reads project only that revision", () => {
  const sql = source();
  const update = readFunction(sql, "faolla_update_merchant_enterprise_workflow_v1");
  const list = readFunction(sql, "faolla_list_merchant_enterprise_workflows_v1");
  const build = readFunction(sql, "faolla_build_merchant_enterprise_workflow_v1");

  const revisionInsert = update.indexOf(
    "insert into public.merchant_enterprise_workflow_revisions",
  );
  const pointerUpdate = update.indexOf("set current_revision_id = v_revision.id");
  assert.ok(revisionInsert >= 0);
  assert.ok(pointerUpdate > revisionInsert);
  assert.match(update, /revision_no, snapshot/i);
  assert.match(update, /published_version = v_revision\.revision_no/i);
  assert.match(update, /has_unpublished_changes = false/i);
  assert.match(
    update,
    /v_action = 'save'[\s\S]+when published_version > 0 then true/i,
  );

  assert.match(list, /can_manage[\s\S]+can_publish/i);
  assert.match(
    list,
    /if v_can_read_draft then[\s\S]+faolla_build_merchant_enterprise_workflow_v1\([\s\S]+false[\s\S]+else[\s\S]+workflow\.status = 'published'/i,
  );
  assert.match(
    list,
    /join public\.merchant_enterprise_workflow_revisions[\s\S]+revision\.id = workflow\.current_revision_id/i,
  );
  assert.match(
    list,
    /revision\.published_at[\s\S]+as published_position[\s\S]+order by published_position, revision\.published_at, workflow\.id/i,
  );
  const viewOnlyBranch = list.slice(
    list.indexOf("\n  else\n    select coalesce(", list.indexOf("if v_can_read_draft then")),
  );
  assert.doesNotMatch(viewOnlyBranch, /workflow\.created_at/i);
  assert.match(
    list,
    /case when workflow\.status = 'archived' then 1 else 0 end[\s\S]+archived_sort[\s\S]+active_position[\s\S]+archived_updated_at desc/i,
  );
  assert.match(
    list,
    /limit case when v_include_archived then 400 else 200 end/i,
  );
  assert.match(build, /if p_use_published_revision then/i);
  assert.match(build, /v_revision\.snapshot ->> 'title'/i);
  assert.match(build, /'has_unpublished_changes', false/i);
  assert.match(
    build,
    /'created_at', v_revision\.published_at,[\s\S]+'updated_at', v_revision\.published_at/i,
  );
  assert.doesNotMatch(
    build.slice(
      build.indexOf("if p_use_published_revision then"),
      build.indexOf("end if;", build.indexOf("if p_use_published_revision then")),
    ),
    /workflow_step\.instruction/i,
  );
});

test("workflow publication notifications are target-safe, sanitized and permission-filtered", () => {
  const sql = source();
  const update = readFunction(sql, "faolla_update_merchant_enterprise_workflow_v1");
  const authorize = readFunction(
    sql,
    "faolla_authorize_merchant_notification_actor_v1",
  );
  const list = readFunction(
    sql,
    "faolla_list_merchant_enterprise_notifications_v1",
  );
  const mark = readFunction(
    sql,
    "faolla_mark_merchant_enterprise_notifications_read_v1",
  );

  assert.match(sql, /alter column task_id drop not null/i);
  assert.match(sql, /add column if not exists workflow_id uuid null/i);
  assert.match(
    sql,
    /merchant_enterprise_notifications_exactly_one_target_check[\s\S]+notification_type = 'workflow_published'[\s\S]+task_id is null[\s\S]+workflow_id is not null[\s\S]+notification_type <> 'workflow_published'[\s\S]+task_id is not null[\s\S]+workflow_id is null/i,
  );
  assert.match(sql, /'workflow_published'/i);
  const payload = readFunction(
    sql,
    "faolla_valid_merchant_workflow_notification_payload_v1",
  );
  assert.match(payload, /count\(\*\)[\s\S]+= 2/i);
  assert.match(payload, /return false/i);
  assert.match(payload, /return coalesce\(/i);
  assert.match(payload, /workflowTitle/i);
  assert.match(payload, /publishedVersion/i);
  assert.doesNotMatch(payload, /description|scenario|instruction|email|token/i);

  assert.match(
    update,
    /insert into public\.merchant_enterprise_notifications[\s\S]+from public\.merchant_enterprise_employees[\s\S]+join public\.merchant_enterprise_roles/i,
  );
  assert.match(update, /employee\.status = 'active'/i);
  assert.match(update, /role_row\.status = 'active'/i);
  assert.match(update, /'workflows\.view' = any\(role_row\.permissions\)/i);
  assert.match(update, /employee\.id::text = v_auth ->> 'actor_id'/i);
  assert.match(update, /on conflict \(merchant_id, recipient_employee_id, event_key\) do nothing/i);

  assert.match(authorize, /'tasks\.view'[\s\S]+or 'workflows\.view'/i);
  assert.match(
    list,
    /coalesce\(jsonb_typeof\(p_input -> 'limit'\), ''\) <> 'number'[\s\S]+invalid_notification_request/i,
  );
  assert.match(
    mark,
    /coalesce\(jsonb_typeof\(p_input -> 'mark_all'\), ''\) <> 'boolean'[\s\S]+invalid_notification_request/i,
  );
  for (const fn of [list, mark]) {
    assert.match(
      fn,
      /notification\.task_id is not null and v_can_read_tasks[\s\S]+notification\.workflow_id is not null and v_can_read_workflows/i,
    );
    assert.match(fn, /recipient_employee_id = v_actor_id/i);
  }
  assert.match(list, /'workflow_id', page\.workflow_id/i);
});

test("workflow audit is whitelisted, transaction-local and queryable", () => {
  const sql = source();
  const summary = readFunction(sql, "faolla_merchant_workflow_audit_summary_v1");
  const create = readFunction(sql, "faolla_create_merchant_enterprise_workflow_v1");
  const update = readFunction(sql, "faolla_update_merchant_enterprise_workflow_v1");
  const auditList = readFunction(
    sql,
    "faolla_list_merchant_enterprise_audit_events_v1",
  );

  for (const eventType of [
    "workflow.created",
    "workflow.updated",
    "workflow.published",
    "workflow.archived",
    "workflow.restored",
  ]) {
    assert.match(sql, new RegExp(`'${eventType.replace(".", "\\.")}'`, "i"));
    assert.match(auditList, new RegExp(`'${eventType.replace(".", "\\.")}'`, "i"));
  }
  for (const key of ["title", "category", "status", "published_version", "step_count"]) {
    assert.match(summary, new RegExp(`'${key}'`, "i"));
  }
  assert.doesNotMatch(summary, /description|scenario|instruction|tags|email|token/i);
  assert.match(create, /faolla_append_merchant_enterprise_audit_event_v1/i);
  assert.match(update, /faolla_append_merchant_enterprise_audit_event_v1/i);
  assert.match(update, /v_before[\s\S]+v_after/i);
  assert.match(auditList, /'workflow'/i);
  assert.match(
    auditList,
    /v_actor_type is null[\s\S]+v_actor_type not in \('owner', 'employee'\)/i,
  );
});

test("only the three workflow RPCs are service-callable and migration is registered", () => {
  const sql = source();
  for (const name of [
    "faolla_create_merchant_enterprise_workflow_v1",
    "faolla_update_merchant_enterprise_workflow_v1",
    "faolla_list_merchant_enterprise_workflows_v1",
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
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.faolla_(?:authorize|replace|build|valid|reject|add_default|merchant_workflow_audit)/i,
  );
  assert.match(
    sql,
    /values \(202608030020, 'merchant_enterprise_workflows'\)/i,
  );
  assert.match(sql, /notify pgrst, 'reload schema'/i);
});
