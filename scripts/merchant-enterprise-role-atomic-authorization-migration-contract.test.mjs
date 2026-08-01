import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608010013_merchant_enterprise_role_atomic_authorization.sql",
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

function assertActorContract(body) {
  assert.match(body, /p_input \? 'actor_type'/i);
  assert.match(body, /jsonb_typeof\(p_input -> 'actor_type'\) <> 'string'/i);
  assert.match(body, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(body, /p_input \? 'actor_id'/i);
  assert.match(body, /jsonb_typeof\(p_input -> 'actor_id'\) <> 'string'/i);
  assert.match(
    body,
    /v_actor_id_text !~\*[\s\S]+\[0-9a-f\][\s\S]+invalid_role_actor/i,
  );
  assert.match(body, /pg_advisory_xact_lock[\s\S]+hashtextextended/i);
  assert.match(
    body,
    /from public\.merchants[\s\S]+where id = v_site_id[\s\S]+for share/i,
  );
  for (const ownerColumn of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(
      body,
      new RegExp(`v_merchant\\.${ownerColumn}`, "i"),
      `owner authorization must check merchants.${ownerColumn}`,
    );
  }
  assert.match(body, /permission_escalation_denied/i);
}

test("role authorization migration is additive and keeps v1 RPCs intact", () => {
  const source = readMigration();
  assert.match(source, /^\s*--[\s\S]+\bbegin\s*;/i);
  assert.match(source, /commit\s*;\s*$/i);
  assert.doesNotMatch(
    source,
    /create or replace function public\.faolla_(?:create|update)_merchant_enterprise_role_v1/i,
  );
  assert.doesNotMatch(source, /\balter\s+table\b/i);
  assert.doesNotMatch(source, /\bdrop\s+(?:table|column|function)\b/i);
  assert.doesNotMatch(source, /^\s*(?:update|delete)\s+public\./im);
  assert.equal(
    source.match(/insert\s+into\s+public\./gi)?.length,
    1,
    "only the migration registry row may be inserted",
  );
});

test("v2 role RPCs require and atomically revalidate a trusted actor", () => {
  const source = readMigration();
  const createRole = readFunction(
    source,
    "faolla_create_merchant_enterprise_role_v2",
  );
  const updateRole = readFunction(
    source,
    "faolla_update_merchant_enterprise_role_v2",
  );

  for (const body of [createRole, updateRole]) {
    assert.match(body, /returns jsonb/i);
    assert.match(body, /language plpgsql/i);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = public/i);
    assertActorContract(body);
    assert.doesNotMatch(body, /exception\s+when/i);
  }

  assert.match(
    createRole,
    /from public\.merchant_enterprise_employees[\s\S]+id = v_actor_id[\s\S]+for update/i,
  );
  assert.match(createRole, /v_actor_employee\.status <> 'active'/i);
  assert.match(
    createRole,
    /from public\.merchant_enterprise_roles[\s\S]+id = v_actor_employee\.role_id[\s\S]+for update/i,
  );
  assert.match(createRole, /v_actor_role\.status <> 'active'/i);
  assert.match(createRole, /'roles\.manage' = any\(v_actor_role\.permissions\)/i);

  assert.match(
    updateRole,
    /employee\.id = v_actor_id[\s\S]+order by employee\.id[\s\S]+for update of employee/i,
  );
  assert.match(updateRole, /v_actor_employee\.status <> 'active'/i);
  assert.match(
    updateRole,
    /order by role_row\.id[\s\S]+for update of role_row/i,
  );
  assert.match(updateRole, /v_actor_role\.status <> 'active'/i);
  assert.match(updateRole, /'roles\.manage' = any\(v_actor_role\.permissions\)/i);
});

test("employee role creation cannot delegate permissions or boards it lacks", () => {
  const source = readMigration();
  const createRole = readFunction(
    source,
    "faolla_create_merchant_enterprise_role_v2",
  );

  assert.match(
    createRole,
    /faolla_valid_merchant_enterprise_permissions_v1\(v_permissions\)/i,
  );
  assert.match(
    createRole,
    /v_permissions <@ v_actor_role\.permissions/i,
  );
  assert.match(
    createRole,
    /v_actor_role\.access_scope = 'restricted'[\s\S]+v_access_scope <> 'restricted'[\s\S]+v_allowed_board_ids <@ v_actor_allowed_board_ids/i,
  );
  assert.match(
    createRole,
    /merchant_enterprise_role_boards[\s\S]+order by role_board\.role_id, role_board\.board_id[\s\S]+for share of role_board/i,
  );
  assert.match(
    createRole,
    /merchant_task_boards[\s\S]+id = any\(v_allowed_board_ids\)[\s\S]+for share of board/i,
  );

  const delegationCheck = createRole.indexOf(
    "v_permissions <@ v_actor_role.permissions",
  );
  const v1Call = createRole.indexOf(
    "return public.faolla_create_merchant_enterprise_role_v1(p_input)",
  );
  assert.ok(delegationCheck >= 0 && v1Call > delegationCheck);
});

test("employee role updates protect self, system roles, and current plus next scope", () => {
  const source = readMigration();
  const updateRole = readFunction(
    source,
    "faolla_update_merchant_enterprise_role_v2",
  );

  assert.match(updateRole, /v_actor_role\.id = v_target_role\.id/i);
  assert.match(updateRole, /v_target_role\.is_system/i);
  assert.match(
    updateRole,
    /v_target_role\.permissions <@ v_actor_role\.permissions/i,
  );
  assert.match(
    updateRole,
    /v_next_permissions <@ v_actor_role\.permissions/i,
  );
  assert.match(
    updateRole,
    /v_target_role\.access_scope <> 'restricted'/i,
  );
  assert.match(
    updateRole,
    /v_current_allowed_board_ids <@ v_actor_allowed_board_ids/i,
  );
  assert.match(updateRole, /v_next_access_scope <> 'restricted'/i);
  assert.match(
    updateRole,
    /v_next_allowed_board_ids <@ v_actor_allowed_board_ids/i,
  );
  assert.match(
    updateRole,
    /faolla_valid_merchant_enterprise_permissions_v1[\s\S]+invalid_permissions/i,
  );
  assert.match(
    updateRole,
    /merchant_task_boards[\s\S]+id = any\(v_next_allowed_board_ids\)[\s\S]+for share of board/i,
  );
});

test("role updates use the established task, employee, role lock order", () => {
  const source = readMigration();
  const updateRole = readFunction(
    source,
    "faolla_update_merchant_enterprise_role_v2",
  );
  const taskLock = updateRole.indexOf(
    "from public.merchant_task_assignees as assignee",
  );
  const employeeLock = updateRole.indexOf(
    "from public.merchant_enterprise_employees as employee",
    taskLock,
  );
  const roleLock = updateRole.indexOf(
    "from public.merchant_enterprise_roles as role_row",
    employeeLock,
  );
  const mappingLock = updateRole.indexOf(
    "from public.merchant_enterprise_role_boards as role_board",
    roleLock,
  );
  const v1Call = updateRole.indexOf(
    "return public.faolla_update_merchant_enterprise_role_v1(p_input)",
  );

  assert.ok(taskLock >= 0, "open task lock is required");
  assert.ok(employeeLock > taskLock, "employees must lock after tasks");
  assert.ok(roleLock > employeeLock, "roles must lock after employees");
  assert.ok(mappingLock > roleLock, "role mappings must lock after roles");
  assert.ok(v1Call > mappingLock, "v1 mutation must run after authorization locks");
  assert.match(
    updateRole,
    /task\.archived_at is null[\s\S]+task\.completed_at is null[\s\S]+order by task\.id[\s\S]+for update of task/i,
  );
  assert.match(updateRole, /order by employee\.id[\s\S]+for update of employee/i);
  assert.match(updateRole, /order by role_row\.id[\s\S]+for update of role_row/i);
});

test("v2 role RPCs remain service-only and migration is registered", () => {
  const source = readMigration();
  for (const name of [
    "faolla_create_merchant_enterprise_role_v2",
    "faolla_update_merchant_enterprise_role_v2",
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
  assert.match(
    source,
    /insert into public\.faolla_schema_migrations \(version, name\)[\s\S]+values \(202608010013, 'merchant_enterprise_role_atomic_authorization'\)[\s\S]+on conflict \(version\) do nothing/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
});
