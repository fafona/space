import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608020019_merchant_enterprise_audit.sql",
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

const auditedWrappers = [
  ["faolla_create_merchant_enterprise_role_v1", "role.create"],
  ["faolla_update_merchant_enterprise_role_v1", "role.update"],
  ["faolla_create_merchant_enterprise_role_v2", "role.create"],
  ["faolla_update_merchant_enterprise_role_v2", "role.update"],
  ["faolla_create_merchant_task_board_v1", "board.create"],
  ["faolla_update_merchant_task_board_v1", "board.update"],
  ["faolla_create_merchant_task_column_v1", "column.create"],
  ["faolla_update_merchant_task_column_v1", "column.update"],
  ["faolla_create_merchant_enterprise_employee_v1", "employee.create"],
  ["faolla_update_merchant_enterprise_employee_v1", "employee.update"],
  ["faolla_reserve_merchant_employee_invitation_v1", "invitation.reserve"],
  ["faolla_revoke_merchant_employee_invitation_v1", "invitation.revoke"],
  ["faolla_remove_merchant_employee_invitation_v1", "invitation.remove"],
  ["faolla_accept_merchant_employee_invitation_v1", "invitation.accept"],
  ["faolla_finalize_merchant_employee_invitation_v1", "invitation.finalize"],
  ["faolla_bind_merchant_employee_auth_user_v1", "invitation.bind"],
];

test("audit storage is merchant-scoped, append-only and unavailable for direct reads", () => {
  const source = readMigration();

  assert.match(
    source,
    /create table if not exists public\.merchant_enterprise_audit_events[\s\S]+merchant_id text not null[\s\S]+before_data jsonb[\s\S]+after_data jsonb[\s\S]+created_at timestamptz/i,
  );
  assert.match(
    source,
    /create unique index if not exists merchant_enterprise_audit_events_dedupe_idx[\s\S]+where dedupe_key is not null/i,
  );
  assert.match(
    source,
    /merchant_enterprise_audit_events_actor_identity_check[\s\S]+actor_type = 'employee' and actor_id is not null[\s\S]+actor_type in \('owner', 'system'\) and actor_id is null/i,
  );
  assert.match(
    source,
    /alter table public\.merchant_enterprise_audit_events enable row level security/i,
  );
  assert.match(
    source,
    /revoke all on public\.merchant_enterprise_audit_events\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    source,
    /create trigger merchant_enterprise_audit_events_append_only\s+before update or delete on public\.merchant_enterprise_audit_events/i,
  );
  const reject = readFunction(
    source,
    "faolla_reject_merchant_enterprise_audit_mutation_v1",
  );
  assert.match(reject, /raise exception 'enterprise_audit_events_append_only'/i);
  assert.doesNotMatch(
    source,
    /grant\s+(?:select|insert|update|delete|all)[^;]*merchant_enterprise_audit_events/i,
  );
});

test("audit capture uses a strict employee whitelist and snapshots actor and target labels", () => {
  const source = readMigration();
  const capture = readFunction(
    source,
    "faolla_capture_merchant_enterprise_audit_v1",
  );
  const append = readFunction(
    source,
    "faolla_append_merchant_enterprise_audit_event_v1",
  );

  for (const safeKey of [
    "display_name",
    "role_id",
    "status",
    "auth_bound",
    "invitation_version",
    "invitation_delivery_status",
    "invitation_expires_at",
    "invitation_revoked_at",
    "accepted_at",
  ]) {
    assert.match(capture, new RegExp(`'${safeKey}'`, "i"));
  }
  assert.doesNotMatch(capture, /'email'\s*,/i);
  assert.doesNotMatch(capture, /'auth_user_id'\s*,/i);
  assert.doesNotMatch(capture, /'invitation_token_hash'\s*,/i);
  assert.doesNotMatch(capture, /'token_hash'\s*,/i);
  assert.doesNotMatch(capture, /raw_user_meta_data|encrypted_password|confirmation_token/i);

  assert.match(append, /actor_label/i);
  assert.match(append, /target_label/i);
  assert.match(
    append,
    /employee\.display_name[\s\S]+from public\.merchant_enterprise_employees/i,
  );
  assert.match(
    append,
    /if v_actor_type in \('owner', 'system'\) then\s+v_actor_id := null/i,
  );
  assert.match(
    capture,
    /v_context_action = 'invitation\.accept'[\s\S]+v_actor_type := 'employee'[\s\S]+v_actor_id := \(v_new ->> 'id'\)::uuid/i,
  );
});

test("all enterprise administration tables capture only successful row mutations", () => {
  const source = readMigration();
  const capture = readFunction(
    source,
    "faolla_capture_merchant_enterprise_audit_v1",
  );

  for (const [triggerName, tableName, operations] of [
    ["merchant_enterprise_roles_audit", "merchant_enterprise_roles", "insert or update"],
    [
      "merchant_enterprise_role_boards_audit",
      "merchant_enterprise_role_boards",
      "insert or delete",
    ],
    ["merchant_task_boards_enterprise_audit", "merchant_task_boards", "insert or update"],
    ["merchant_task_columns_enterprise_audit", "merchant_task_columns", "insert or update"],
    [
      "merchant_enterprise_employees_audit",
      "merchant_enterprise_employees",
      "insert or update or delete",
    ],
  ]) {
    assert.match(
      source,
      new RegExp(
        `create trigger ${triggerName}\\s+after ${operations} on public\\.${tableName}`,
        "i",
      ),
    );
  }
  assert.match(capture, /if v_before is not distinct from v_after then\s+return null/i);
  assert.match(capture, /perform public\.faolla_append_merchant_enterprise_audit_event_v1/i);
  assert.doesNotMatch(capture, /before\s+(?:insert|update|delete)/i);
});

test("role, board, column, employee and invitation RPCs preserve prior authorization delegates", () => {
  const source = readMigration();

  for (const [publicName, action] of auditedWrappers) {
    const delegateName = `${publicName}_preaudit_019`;
    assert.ok(delegateName.length <= 63, `${delegateName} exceeds PostgreSQL identifier limit`);
    assert.match(
      source,
      new RegExp(
        `alter function public\\.${publicName}\\(jsonb\\)\\s+rename to ${delegateName}`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `revoke all on function public\\.${delegateName}\\(jsonb\\) from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    assert.doesNotMatch(
      source,
      new RegExp(`grant execute on function public\\.${delegateName}`, "i"),
    );

    const wrapper = readFunction(source, publicName);
    const context = wrapper.indexOf(action);
    const delegate = wrapper.indexOf(`public.${delegateName}(p_input)`);
    assert.ok(context >= 0, `${publicName} must set ${action} context`);
    assert.ok(delegate > context, `${publicName} must set context before delegating`);
    assert.match(wrapper, /security definer/i);
    assert.match(wrapper, /set search_path = public/i);
    assert.doesNotMatch(wrapper.slice(0, delegate), /insert into public\.merchant_enterprise_audit_events/i);
  }
});

test("bootstrap emits one deduplicated workspace event only after actual initialization", () => {
  const source = readMigration();
  const bootstrap = readFunction(
    source,
    "faolla_bootstrap_merchant_enterprise_v2",
  );

  const delegate = bootstrap.indexOf(
    "faolla_bootstrap_merchant_enterprise_v2_preaudit_019(p_input)",
  );
  const append = bootstrap.indexOf(
    "faolla_append_merchant_enterprise_audit_event_v1",
  );
  assert.match(bootstrap, /'workspace\.bootstrap'/i);
  assert.match(
    bootstrap,
    /set_config\('faolla\.enterprise_audit_mutated', '0', true\)/i,
  );
  assert.match(
    bootstrap,
    /if current_setting\('faolla\.enterprise_audit_mutated', true\) = '1' then/i,
  );
  assert.ok(delegate >= 0);
  assert.ok(append > delegate, "bootstrap audit must be appended after its delegate succeeds");
  assert.match(bootstrap, /'workspace\.bootstrap:' \|\| v_operation_id/i);

  const capture = readFunction(
    source,
    "faolla_capture_merchant_enterprise_audit_v1",
  );
  assert.match(
    capture,
    /if v_context_action = 'workspace\.bootstrap' then[\s\S]+enterprise_audit_mutated[\s\S]+return null/i,
  );
});

test("employee lifecycle audit distinguishes every required transition", () => {
  const source = readMigration();
  const capture = readFunction(
    source,
    "faolla_capture_merchant_enterprise_audit_v1",
  );

  for (const eventType of [
    "employee.created",
    "employee.renamed",
    "employee.role_changed",
    "employee.disabled",
    "employee.restored",
    "invitation.reserved",
    "invitation.revoked",
    "invitation.removed",
    "invitation.accepted",
    "invitation.delivery_finalized",
    "invitation.auth_bound",
  ]) {
    assert.match(capture, new RegExp(`'${eventType.replace(".", "\\.")}'`, "i"));
  }
});

test("audit query atomically authorizes a real owner or active audit viewer", () => {
  const source = readMigration();
  const query = readFunction(
    source,
    "faolla_list_merchant_enterprise_audit_events_v1",
  );

  assert.match(query, /from public\.merchants[\s\S]+where id = v_site_id[\s\S]+for share/i);
  for (const ownerColumn of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(query, new RegExp(`v_merchant\\.${ownerColumn}`, "i"));
  }
  assert.match(
    query,
    /from public\.merchant_enterprise_employees[\s\S]+status <> 'active'/i,
  );
  assert.match(
    query,
    /from public\.merchant_enterprise_roles[\s\S]+status <> 'active'[\s\S]+'audit\.view' = any\(v_role\.permissions\)/i,
  );
  assert.match(query, /limit v_limit/i);
  assert.match(query, /next_cursor/i);
  assert.match(
    source,
    /revoke all on function public\.faolla_list_merchant_enterprise_audit_events_v1\(jsonb\) from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_list_merchant_enterprise_audit_events_v1\(jsonb\) to service_role/i,
  );
});

test("audit.view extends the permission catalog without weakening dependencies", () => {
  const source = readMigration();
  const validator = readFunction(
    source,
    "faolla_valid_merchant_enterprise_permissions_v1",
  );

  assert.match(
    source,
    /add constraint merchant_enterprise_roles_permissions_check[\s\S]+'audit\.view'/i,
  );
  assert.match(validator, /'audit\.view'/i);
  assert.match(validator, /'orders\.linked\.view'/i);
  assert.match(
    validator,
    /not \('orders\.linked\.view' = any\(p_permissions\)\)[\s\S]+'tasks\.view' = any\(p_permissions\)/i,
  );
  assert.match(
    validator,
    /not \('audit\.view' = any\(p_permissions\)\) or 'enterprise\.view' = any\(p_permissions\)/i,
  );
});

test("migration is forward-only, registered and reloads the API schema", () => {
  const source = readMigration();

  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202608020019, 'merchant_enterprise_audit'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /drop\s+column/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\.merchant_enterprise_audit_events/i);
});
