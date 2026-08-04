import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608040026_merchant_enterprise_workflow_automations.sql",
);
const boardScopeMigrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310009_merchant_enterprise_board_access_scopes.sql",
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

test("026 is a registered atomic migration with private automation tables", () => {
  const sql = source();
  assert.match(sql, /^--[\s\S]+\nbegin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(
    sql,
    /values \(202608040026, 'merchant_enterprise_workflow_automations'\)/i,
  );
  for (const table of [
    "merchant_enterprise_automation_rules",
    "merchant_enterprise_automation_rule_assignees",
    "merchant_enterprise_automation_runs",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(
      sql,
      new RegExp(`revoke all on public\\.${table}[\\s\\S]{0,100}service_role`, "i"),
    );
  }
  assert.match(
    sql,
    /merchant_enterprise_automation_runs_event_unique[\s\S]+unique \(merchant_id, rule_id, source_event_key\)/i,
  );
  assert.match(
    sql,
    /merchant_tasks_automation_source_unique_idx[\s\S]+source_type = 'automation'/i,
  );
  assert.match(
    sql,
    /merchant_outbox_automation_due_merchants_idx[\s\S]+event_type = 'enterprise\.workflow_automation\.process'[\s\S]+status in \('pending', 'failed'\)/i,
  );
  assert.match(
    sql,
    /merchant_outbox_automation_expired_leases_idx[\s\S]+lease_expires_at[\s\S]+status = 'processing'/i,
  );
});

test("automation permissions retain dependencies and future system-role defaults", () => {
  const sql = source();
  const valid = readFunction(
    sql,
    "faolla_valid_merchant_enterprise_permissions_v1",
  );
  assert.match(valid, /'automations\.view'/i);
  assert.match(valid, /'automations\.manage'/i);
  assert.match(
    valid,
    /automations\.view'[\s\S]+enterprise\.view'[\s\S]+tasks\.view'[\s\S]+workflows\.view'/i,
  );
  assert.match(
    valid,
    /automations\.manage'[\s\S]+tasks\.create'[\s\S]+tasks\.assign'[\s\S]+automations\.view'[\s\S]+roles\.view'[\s\S]+employees\.view'/i,
  );
  const defaults = readFunction(
    sql,
    "faolla_add_default_workflow_permissions_v1",
  );
  assert.match(
    defaults,
    /system_key = 'administrator'[\s\S]+automations\.view'[\s\S]+automations\.manage'/i,
  );
  assert.match(
    defaults,
    /system_key = 'supervisor'[\s\S]+automations\.view'[\s\S]+automations\.manage'/i,
  );
  const employeeDefaults = defaults.slice(defaults.indexOf("system_key = 'employee'"));
  assert.doesNotMatch(employeeDefaults, /automations\.(view|manage)/i);
});

test("automation authorization rejects a missing actor type before actor lookup", () => {
  const authorize = readFunction(
    source(),
    "faolla_authorize_merchant_enterprise_automation_actor_v1",
  );
  assert.match(
    authorize,
    /v_actor_type is null[\s\S]+v_actor_type not in \('owner', 'employee'\)/i,
  );
});

test("rule writes are tenant-authorized, board-scoped, CAS protected, and pin a revision", () => {
  const sql = source();
  const mutation = readFunction(
    sql,
    "faolla_mutate_merchant_enterprise_automation_rule_v1",
  );
  assert.match(
    mutation,
    /faolla_authorize_merchant_enterprise_automation_actor_v1\([\s\S]+automations\.manage'[\s\S]+v_board_id/i,
  );
  assert.match(
    mutation,
    /faolla_authorize_merchant_task_write_v1\([\s\S]+array\['tasks\.create', 'tasks\.assign'\]::text\[\]/i,
  );
  assert.match(
    mutation,
    /v_existing\.version <> v_expected_version[\s\S]+enterprise_version_conflict/i,
  );
  assert.match(
    mutation,
    /workflow\.current_revision_id <> v_revision_id[\s\S]+workflow_revision_changed/i,
  );
  assert.match(
    mutation,
    /v_existing\.workflow_revision_id is distinct from v_revision_id/i,
  );
  assert.match(
    mutation,
    /merchant_enterprise_workflow_revisions[\s\S]+workflow_id = v_workflow_id[\s\S]+id = v_revision_id[\s\S]+for share/i,
  );
  assert.match(
    mutation,
    /faolla_claim_enterprise_structure_operation_v1[\s\S]+md5\(p_input::text\)/i,
  );
  assert.match(mutation, /pg_advisory_xact_lock[\s\S]+count\(\*\) >= 20/i);
  assert.match(mutation, /automation_active_rule_limit_reached/i);
  assert.match(
    mutation,
    /faolla-enterprise-automation-total:[\s\S]+count\(\*\) >= 100[\s\S]+automation_rule_limit_reached/i,
  );
  assert.match(
    mutation,
    /v_event_type = 'created'[\s\S]+v_from_status is not null or v_to_status is not null/i,
  );
  assert.match(
    sql,
    /event_type = 'created' and from_status is null and to_status is null/i,
  );
});

test("active execution configuration updates advance enabled_at while no-op saves preserve it", () => {
  const mutation = readFunction(
    source(),
    "faolla_mutate_merchant_enterprise_automation_rule_v1",
  );
  for (const field of [
    "name",
    "source_type",
    "event_type",
    "from_status",
    "to_status",
    "board_id",
    "column_id",
    "workflow_id",
    "task_title",
    "task_description",
    "priority",
    "due_offset_minutes",
  ]) {
    assert.match(
      mutation,
      new RegExp(`v_existing\\.${field} is distinct from v_${field}`, "i"),
      field,
    );
  }
  assert.match(
    mutation,
    /v_existing\.workflow_revision_id is distinct from v_revision_id/i,
  );
  assert.match(
    mutation,
    /v_existing_assignee_ids is distinct from v_assignee_ids/i,
  );
  assert.match(
    mutation,
    /when v_status = 'active'[\s\S]+v_existing\.status <> 'active'[\s\S]+or v_execution_config_changed[\s\S]+greatest\([\s\S]+clock_timestamp\(\)[\s\S]+v_existing\.enabled_at \+ interval '1 microsecond'/i,
  );
  assert.match(
    mutation,
    /full no-op save therefore preserves enabled_at/i,
  );
});

test("soft archive is CAS protected, audited, hidden by default, and excluded from the total cap", () => {
  const sql = source();
  assert.match(sql, /status in \('active', 'paused', 'archived'\)/i);
  assert.match(
    sql,
    /status = 'archived' and archived_at is not null[\s\S]+status <> 'archived' and archived_at is null/i,
  );
  const list = readFunction(
    sql,
    "faolla_list_merchant_enterprise_automation_rules_v1",
  );
  assert.match(list, /rule_row\.status <> 'archived'/i);
  const mutation = readFunction(
    sql,
    "faolla_mutate_merchant_enterprise_automation_rule_v1",
  );
  assert.match(
    mutation,
    /merchant_rule\.status <> 'archived'[\s\S]+automation_rule_limit_reached/i,
  );
  assert.match(
    mutation,
    /v_existing\.status = 'archived'[\s\S]+automation_rule_archived/i,
  );
  const archive = readFunction(
    sql,
    "faolla_archive_merchant_enterprise_automation_rule_v1",
  );
  assert.match(archive, /automations\.manage/i);
  assert.match(
    archive,
    /for update[\s\S]+v_existing\.version <> v_expected_version[\s\S]+enterprise_version_conflict/i,
  );
  assert.match(
    archive,
    /set status = 'archived',[\s\S]+archived_at = clock_timestamp\(\)/i,
  );
  assert.match(archive, /automation\.archived/i);
  assert.match(archive, /faolla_claim_enterprise_structure_operation_v1/i);
  assert.match(
    sql,
    /grant execute on function public\.faolla_archive_merchant_enterprise_automation_rule_v1\(jsonb\)[\s\S]+to service_role/i,
  );
});

test("rule saves reject assignees that cannot view the target board", () => {
  const mutation = readFunction(
    source(),
    "faolla_mutate_merchant_enterprise_automation_rule_v1",
  );
  assert.match(
    mutation,
    /unnest\(v_assignee_ids\)[\s\S]+merchant_enterprise_employees[\s\S]+employee\.status <> 'active'/i,
  );
  assert.match(
    mutation,
    /merchant_enterprise_roles[\s\S]+role_row\.status <> 'active'[\s\S]+faolla_valid_merchant_enterprise_permissions_v1/i,
  );
  assert.match(mutation, /not \('tasks\.view' = any\(role_row\.permissions\)\)/i);
  assert.match(
    mutation,
    /role_row\.access_scope = 'restricted'[\s\S]+merchant_enterprise_role_boards[\s\S]+role_board\.board_id = v_board_id/i,
  );
  assert.match(mutation, /raise exception 'automation_assignee_unavailable'/i);
});

test("service event processing reloads authentic future order and booking events", () => {
  const sql = source();
  const process = readFunction(
    sql,
    "faolla_process_merchant_enterprise_automation_event_v1",
  );
  assert.match(
    process,
    /from public\.merchant_order_events[\s\S]+merchant_id = v_site_id[\s\S]+id = v_event_id/i,
  );
  assert.match(
    process,
    /from public\.merchant_booking_events[\s\S]+merchant_id = v_site_id[\s\S]+id = v_event_id/i,
  );
  assert.match(process, /v_event_type not in \('created', 'status_changed'\)/i);
  assert.match(process, /rule_row\.enabled_at <= v_source_event_at/i);
  assert.match(
    process,
    /rule_row\.from_status is null or rule_row\.from_status is not distinct from v_from_status/i,
  );
  assert.match(
    process,
    /rule_row\.to_status is null or rule_row\.to_status is not distinct from v_to_status/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.faolla_process_merchant_enterprise_automation_event_v1\(jsonb\)[\s\S]+to service_role/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.faolla_apply_merchant_enterprise_automation_rule_v1\([\s\S]+service_role/i,
  );
});

test("one automation run atomically creates the task, pinned checklist and notifications", () => {
  const apply = readFunction(
    source(),
    "faolla_apply_merchant_enterprise_automation_rule_v1",
  );
  assert.match(
    apply,
    /insert into public\.merchant_enterprise_automation_runs[\s\S]+on conflict \(merchant_id, rule_id, source_event_key\) do nothing/i,
  );
  assert.match(apply, /from public\.merchant_enterprise_automation_rules[\s\S]+for update/i);
  assert.match(apply, /rule_version[\s\S]+board_id[\s\S]+attempt_count = v_run\.attempt_count \+ 1/i);
  assert.match(apply, /insert into public\.merchant_tasks[\s\S]+'automation', v_run_id::text/i);
  assert.match(apply, /insert into public\.merchant_task_assignees/i);
  assert.match(
    apply,
    /insert into public\.merchant_task_workflow_bindings[\s\S]+'system', null/i,
  );
  assert.match(
    apply,
    /jsonb_array_elements\(v_revision\.snapshot -> 'steps'\)[\s\S]+insert into public\.merchant_task_checklist_items/i,
  );
  assert.match(apply, /faolla_insert_merchant_task_notification_v1/i);
  assert.match(
    apply,
    /exception when others then[\s\S]+status = 'failed'[\s\S]+error_code = v_error_code/i,
  );
});

test("templates use only non-PII source/status placeholders", () => {
  const apply = readFunction(
    source(),
    "faolla_apply_merchant_enterprise_automation_rule_v1",
  );
  for (const placeholder of ["{eventRef}", "{fromStatus}", "{toStatus}"]) {
    assert.match(apply, new RegExp(placeholder.replace(/[{}]/g, "\\$&")));
  }
  assert.doesNotMatch(apply, /\{sourceId\}/i);
  const mutation = readFunction(
    source(),
    "faolla_mutate_merchant_enterprise_automation_rule_v1",
  );
  assert.match(mutation, /regexp_replace[\s\S]+eventRef\|fromStatus\|toStatus[\s\S]+\\\{\[\^\{\}\]\*\\\}/i);
  assert.doesNotMatch(
    apply,
    /customer(_|\s)*(name|phone|email|address)|guest|source_snapshot|event\.payload/i,
  );
  assert.match(apply, /left\([\s\S]+240\)/i);
  assert.match(apply, /left\([\s\S]+10000\s*\)/i);
});

test("source triggers atomically enqueue only events with a matching active rule", () => {
  const sql = source();
  for (const [table, dispatch] of [
    ["merchant_order_events", "faolla_dispatch_merchant_enterprise_order_automation_v1"],
    ["merchant_booking_events", "faolla_dispatch_merchant_enterprise_booking_automation_v1"],
  ]) {
    assert.match(
      sql,
      new RegExp(
        `after insert on public\\.${table}[\\s\\S]+execute function public\\.${dispatch}\\(\\)`,
        "i",
      ),
    );
    const fn = readFunction(sql, dispatch);
    assert.match(fn, /if not exists \([\s\S]+merchant_enterprise_automation_rules/i);
    assert.match(fn, /rule_row\.status = 'active'[\s\S]+rule_row\.enabled_at <= new\.created_at/i);
    assert.match(fn, /insert into public\.merchant_outbox_events/i);
    assert.match(fn, /enterprise\.workflow_automation\.process/i);
    assert.match(fn, /on conflict \(merchant_id, event_key\) do nothing/i);
    assert.doesNotMatch(fn, /faolla_process_merchant_enterprise_automation_event_v1/i);
  }
});

test("automation tenant discovery wraps its cursor and dedicated claim is fair within the bounded scope", () => {
  const sql = source();
  const discovery = readFunction(
    sql,
    "faolla_discover_merchant_enterprise_automation_merchants_v1",
  );
  assert.match(
    discovery,
    /event\.event_type = 'enterprise\.workflow_automation\.process'/i,
  );
  assert.match(discovery, /group by event\.merchant_id/i);
  assert.match(
    discovery,
    /eligible\.merchant_id > v_after_merchant_id then 0[\s\S]+else 1[\s\S]+eligible\.merchant_id[\s\S]+limit v_limit/i,
  );
  assert.match(
    discovery,
    /status in \('pending', 'failed'\)[\s\S]+available_at <= now\(\)[\s\S]+status = 'processing'[\s\S]+lease_expires_at <= now\(\)/i,
  );

  const claim = readFunction(
    sql,
    "faolla_claim_merchant_enterprise_automation_outbox_v1",
  );
  assert.match(
    claim,
    /cardinality\(v_merchant_ids\) > v_limit[\s\S]+invalid_outbox_merchant_scope/i,
  );
  assert.match(
    claim,
    /while v_claimed < v_limit loop[\s\S]+foreach v_merchant_id in array v_merchant_ids loop[\s\S]+event\.merchant_id = v_merchant_id[\s\S]+for update skip locked[\s\S]+limit 1/i,
  );
  assert.match(
    claim,
    /return next v_event[\s\S]+exit when v_claimed >= v_limit/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.faolla_discover_merchant_enterprise_automation_merchants_v1\([\s\S]+grant execute on function public\.faolla_claim_merchant_enterprise_automation_outbox_v1\([\s\S]+to service_role/i,
  );
});

test("outbox health treats the workflow automation handler as a known event type", () => {
  const sql = source();
  const health = readFunction(sql, "faolla_get_merchant_outbox_health_v1");
  assert.match(
    health,
    /'unknown_event_type_count'[\s\S]+event\.event_type not in \([\s\S]+'enterprise\.workflow_automation\.process'/i,
  );
  for (const existingType of [
    "merchant.notification.deliver",
    "google.reviews.sync",
    "asset.convert",
    "site.publish.follow_up",
    "backup.create",
    "webhook.deliver",
  ]) {
    assert.match(health, new RegExp(existingType.replaceAll(".", "\\."), "i"));
  }
  assert.match(
    sql,
    /grant execute on function public\.faolla_get_merchant_outbox_health_v1\(text, integer\)[\s\S]+to service_role/i,
  );
});

test("persistent board, column, workflow, employee and role-scope failures pause once and are terminal", () => {
  const sql = source();
  const apply = readFunction(
    sql,
    "faolla_apply_merchant_enterprise_automation_rule_v1",
  );
  // Board and column lifecycle state collapse to the public target code.
  assert.match(
    apply,
    /board\.status = 'active'[\s\S]+column_row\.status = 'active'[\s\S]+not column_row\.is_done[\s\S]+automation_target_unavailable/i,
  );
  // Workflow archival/pinned-revision loss collapses to the workflow code.
  assert.match(
    apply,
    /workflow\.status <> 'archived'[\s\S]+automation_workflow_unavailable/i,
  );
  // Employee/role permission and restricted-board scope collapse to assignee.
  assert.match(
    apply,
    /employee\.status = 'active'[\s\S]+role_row\.status = 'active'[\s\S]+'tasks\.view' = any\(role_row\.permissions\)[\s\S]+merchant_enterprise_role_boards[\s\S]+automation_assignee_unavailable/i,
  );
  const boardScope = fs.readFileSync(boardScopeMigrationPath, "utf8");
  assert.match(
    boardScope,
    /faolla_guard_merchant_task_assignee_board_access_v1[\s\S]+for share of employee, role_row[\s\S]+raise exception 'task_assignee_board_access_denied'/i,
  );
  assert.match(
    apply,
    /task_assignee_board_access_denied%' then 'automation_assignee_unavailable'/i,
  );
  assert.match(
    apply,
    /v_terminal_failure := v_error_code in \([\s\S]+automation_target_unavailable[\s\S]+automation_assignee_unavailable[\s\S]+automation_workflow_unavailable[\s\S]+set status = 'paused'/i,
  );
  assert.match(
    apply,
    /'automation\.paused'[\s\S]+reason_code', 'execution_configuration_invalid'/i,
  );
  assert.match(apply, /'retryable', not v_terminal_failure/i);
});

test("public run listing exposes opaque refs and retry metadata without internal keys", () => {
  const list = readFunction(
    source(),
    "faolla_list_merchant_enterprise_automation_rules_v1",
  );
  assert.match(list, /'event_ref', recent\.event_ref/i);
  assert.match(list, /'rule_version', recent\.rule_version/i);
  assert.match(list, /'attempt_count', recent\.attempt_count/i);
  assert.doesNotMatch(list, /'source_event_key'/i);
  assert.match(
    source(),
    /event_ref ~ '\^\(order\|booking\)-\[0-9a-f\]\{8\}-[\s\S]+\[0-9a-f\]\{12\}\$'/i,
  );
});

test("entitlement revocation pauses rules through a private audited service RPC", () => {
  const sql = source();
  const pause = readFunction(
    sql,
    "faolla_pause_merchant_enterprise_automations_for_entitlement_v1",
  );
  assert.match(pause, /reason_code[\s\S]+entitlement_revoked/i);
  assert.match(pause, /status = 'active'[\s\S]+set status = 'paused'/i);
  assert.match(pause, /automation\.paused[\s\S]+reason_code/i);
  assert.match(
    sql,
    /revoke all on function public\.faolla_pause_merchant_enterprise_automations_for_entitlement_v1\(jsonb\)[\s\S]+grant execute on function public\.faolla_pause_merchant_enterprise_automations_for_entitlement_v1\(jsonb\)[\s\S]+to service_role/i,
  );
});

test("automation audit vocabulary is explicit and preserves the prior vocabulary", () => {
  const sql = source();
  assert.match(
    sql,
    /merchant_enterprise_audit_events_event_type_check[\s\S]+workspace\.bootstrapped[\s\S]+workflow\.restored[\s\S]+automation\.created[\s\S]+automation\.failed/i,
  );
  assert.match(
    sql,
    /merchant_enterprise_audit_events_entity_type_check[\s\S]+'workflow', 'automation'/i,
  );
  const appendUses = [
    "automation.created",
    "automation.updated",
    "automation.paused",
    "automation.resumed",
    "automation.fired",
    "automation.failed",
  ];
  for (const event of appendUses) assert.match(sql, new RegExp(event.replace(".", "\\.")));
});
