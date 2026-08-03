import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608020018_merchant_enterprise_notifications.sql",
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

test("notification table is tenant-recipient scoped, idempotent and minimally exposed", () => {
  const sql = source();
  assert.match(sql, /create table if not exists public\.merchant_enterprise_notifications/i);
  assert.match(
    sql,
    /foreign key \(merchant_id, recipient_employee_id\)[\s\S]+merchant_enterprise_employees\(merchant_id, id\)/i,
  );
  assert.match(
    sql,
    /foreign key \(merchant_id, task_id\)[\s\S]+merchant_tasks\(merchant_id, id\)/i,
  );
  assert.match(
    sql,
    /unique \(merchant_id, recipient_employee_id, event_key\)/i,
  );
  assert.match(
    sql,
    /merchant_enterprise_notifications_recipient_created_idx[\s\S]+created_at desc,[\s\S]+id desc/i,
  );
  assert.match(
    sql,
    /merchant_enterprise_notifications_unread_idx[\s\S]+where read_at is null/i,
  );
  assert.match(
    sql,
    /alter table public\.merchant_enterprise_notifications enable row level security/i,
  );
  assert.match(
    sql,
    /revoke all on public\.merchant_enterprise_notifications[\s\S]+public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant (?:select|insert|update|delete)[\s\S]+merchant_enterprise_notifications/i,
  );
});

test("task RPC wrappers emit assignment, unassignment, comment and due notifications after authorization", () => {
  const sql = source();
  const wrappers = [
    ["faolla_create_merchant_task_v1", "faolla_create_merchant_task_v1_core_018"],
    ["faolla_update_merchant_task_v1", "faolla_update_merchant_task_v1_core_018"],
    [
      "faolla_add_merchant_task_comment_v1",
      "faolla_add_merchant_task_comment_v1_core_018",
    ],
  ];
  for (const [publicName, coreName] of wrappers) {
    assert.match(
      sql,
      new RegExp(
        `alter function public\\.${publicName}\\(jsonb\\)\\s+rename to ${coreName}`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${coreName}\\(jsonb\\)\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    const wrapper = readFunction(sql, publicName);
    const delegated = wrapper.indexOf(`public.${coreName}(p_input)`);
    const emitted = wrapper.indexOf(
      "public.faolla_insert_merchant_task_notification_v1",
    );
    assert.ok(delegated >= 0, `${publicName} must delegate to authorized core`);
    assert.ok(emitted > delegated, `${publicName} must notify after successful delegation`);
    assert.match(wrapper, /from public\.merchant_task_events/i);
    assert.match(wrapper, /operation_id = nullif\(btrim\(p_input ->> 'operation_id'\)/i);
    assert.match(wrapper, /security definer/i);
    assert.match(wrapper, /set search_path = public/i);
  }

  const createTask = readFunction(sql, "faolla_create_merchant_task_v1");
  const updateTask = readFunction(sql, "faolla_update_merchant_task_v1");
  const comment = readFunction(sql, "faolla_add_merchant_task_comment_v1");
  assert.match(createTask, /'task_assigned'/i);
  assert.match(updateTask, /'task_assigned'/i);
  assert.match(updateTask, /'task_unassigned'/i);
  assert.match(updateTask, /p_input \? 'due_at'[\s\S]+'task_due_changed'/i);
  assert.match(updateTask, /v_previous_due_at is distinct from v_next_due_at/i);
  assert.match(comment, /'task_commented'/i);
  assert.doesNotMatch(comment, /p_input ->> 'text'/i);
});

test("notification insertion only targets active employees and stores a sanitized payload", () => {
  const helper = readFunction(source(), "faolla_insert_merchant_task_notification_v1");
  assert.match(helper, /employee\.merchant_id = p_site_id/i);
  assert.match(helper, /employee\.id = p_recipient_employee_id/i);
  assert.match(helper, /employee\.status = 'active'/i);
  assert.match(
    helper,
    /on conflict \(merchant_id, recipient_employee_id, event_key\) do nothing/i,
  );
  assert.match(
    helper,
    /when p_notification_type = 'task_due_changed'[\s\S]+jsonb_build_object\('dueAt'/i,
  );
  assert.match(helper, /else '\{\}'::jsonb/i);
  assert.doesNotMatch(helper, /email|auth_user|token|comment_text/i);
  assert.doesNotMatch(helper, /grant execute/i);
});

test("employee assignment lifecycle events notify active replacements and role-transition removals", () => {
  const sql = source();
  const trigger = readFunction(
    sql,
    "faolla_emit_employee_assignment_notifications_v1",
  );
  assert.match(
    trigger,
    /new\.event_type not in \('employee_role_transitioned', 'employee_offboarded'\)/i,
  );
  assert.match(
    trigger,
    /new\.event_type = 'employee_role_transitioned'[\s\S]+payload ->> 'employeeId'[\s\S]+'task_unassigned'/i,
  );
  assert.match(
    trigger,
    /payload ->> 'replacementEmployeeId'[\s\S]+'task_assigned'/i,
  );
  assert.doesNotMatch(
    trigger,
    /new\.event_type = 'employee_offboarded'[\s\S]+payload ->> 'offboardedEmployeeId'/i,
  );
  assert.match(
    sql,
    /create trigger merchant_task_events_employee_assignment_notifications[\s\S]+after insert on public\.merchant_task_events[\s\S]+faolla_emit_employee_assignment_notifications_v1\(\)/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.faolla_emit_employee_assignment_notifications_v1\(\)[\s\S]+public, anon, authenticated, service_role/i,
  );
});

test("list and mark-read derive the recipient from an active employee actor", () => {
  const sql = source();
  const authorize = readFunction(
    sql,
    "faolla_authorize_merchant_notification_actor_v1",
  );
  assert.match(authorize, /p_input ->> 'actor_type' <> 'employee'/i);
  assert.match(authorize, /employee\.id = v_actor_id/i);
  assert.match(authorize, /employee\.status = 'active'/i);
  assert.match(authorize, /role_row\.status = 'active'/i);
  assert.match(authorize, /'enterprise\.view' = any\(role_row\.permissions\)/i);
  assert.match(authorize, /'tasks\.view' = any\(role_row\.permissions\)/i);
  assert.doesNotMatch(authorize, /recipient/i);

  for (const name of [
    "faolla_list_merchant_enterprise_notifications_v1",
    "faolla_mark_merchant_enterprise_notifications_read_v1",
  ]) {
    const fn = readFunction(sql, name);
    assert.match(
      fn,
      /v_actor_id := public\.faolla_authorize_merchant_notification_actor_v1\(p_input\)/i,
    );
    assert.match(fn, /recipient_employee_id = v_actor_id/i);
    assert.doesNotMatch(fn, /p_input ->> 'recipient/i);
  }
});

test("notification reads are bounded keyset pages and read state is monotonic", () => {
  const sql = source();
  const list = readFunction(
    sql,
    "faolla_list_merchant_enterprise_notifications_v1",
  );
  assert.match(list, /v_limit < 1 or v_limit > 50/i);
  assert.match(
    list,
    /\(notification\.created_at, notification\.id\)[\s\S]+< \(v_cursor_created_at, v_cursor_id\)/i,
  );
  assert.match(list, /limit v_limit \+ 1/i);
  assert.match(list, /notification\.read_at is null/i);
  assert.doesNotMatch(list, /recipient_employee_id['"]?\s*,/i);

  const mark = readFunction(
    sql,
    "faolla_mark_merchant_enterprise_notifications_read_v1",
  );
  assert.match(mark, /v_mark_all = \(v_notification_id_text is not null\)/i);
  assert.match(mark, /set read_at = coalesce\(notification\.read_at, now\(\)\)/i);
  assert.match(mark, /notification\.read_at is null/i);
  assert.match(mark, /v_mark_all or notification\.id = v_notification_id/i);
  assert.match(mark, /get diagnostics v_marked_count = row_count/i);
});

test("only public notification RPCs are service-callable and migration is registered", () => {
  const sql = source();
  assert.match(
    sql,
    /revoke all on function public\.faolla_authorize_merchant_notification_actor_v1\(jsonb\)[\s\S]+public, anon, authenticated, service_role/i,
  );
  for (const name of [
    "faolla_list_merchant_enterprise_notifications_v1",
    "faolla_mark_merchant_enterprise_notifications_read_v1",
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
  assert.match(sql, /values \(202608020018, 'merchant_enterprise_notifications'\)/i);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
  assert.match(sql, /(?:^|\n)begin\s*;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /truncate\s+/i);
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /drop\s+column/i);
});
