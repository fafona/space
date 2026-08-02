import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608020015_merchant_enterprise_task_atomic_authorization.sql",
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

const wrappers = [
  ["faolla_create_merchant_task_v1", "faolla_create_merchant_task_v1_unchecked_015"],
  ["faolla_update_merchant_task_v1", "faolla_update_merchant_task_v1_unchecked_015"],
  ["faolla_move_merchant_task_v1", "faolla_move_merchant_task_v1_unchecked_015"],
  [
    "faolla_add_merchant_task_comment_v1",
    "faolla_add_merchant_task_comment_v1_unchecked_015",
  ],
  [
    "faolla_create_merchant_task_checklist_item_v1",
    "faolla_create_task_checklist_item_v1_unchecked_015",
  ],
  [
    "faolla_update_merchant_task_checklist_item_v1",
    "faolla_update_task_checklist_item_v1_unchecked_015",
  ],
];

test("task authorization migration keeps public v1 names and privatizes old implementations", () => {
  const source = readMigration();

  for (const [publicName, uncheckedName] of wrappers) {
    assert.ok(uncheckedName.length <= 63, `${uncheckedName} exceeds PostgreSQL identifier limit`);
    assert.match(
      source,
      new RegExp(
        `alter function public\\.${publicName}\\(jsonb\\)\\s+rename to ${uncheckedName}`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `revoke all on function public\\.${uncheckedName}\\(jsonb\\)\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    assert.doesNotMatch(
      source,
      new RegExp(`grant execute on function public\\.${uncheckedName}`, "i"),
    );

    const wrapper = readFunction(source, publicName);
    const authorization = wrapper.indexOf(
      "perform public.faolla_authorize_merchant_task_write_v1",
    );
    const delegate = wrapper.indexOf(`return public.${uncheckedName}(p_input)`);
    assert.ok(authorization >= 0, `${publicName} must authorize`);
    assert.ok(delegate > authorization, `${publicName} must authorize before delegating`);
    assert.match(wrapper, /security definer/i);
    assert.match(wrapper, /set search_path = public/i);
  }
});

test("shared task authorizer validates the trusted actor and owner identity", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_task_write_v1",
  );

  assert.match(authorize, /jsonb_typeof\(p_input -> 'actor_type'\) <> 'string'/i);
  assert.match(authorize, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(authorize, /jsonb_typeof\(p_input -> 'actor_id'\) <> 'string'/i);
  assert.match(authorize, /raise exception 'invalid_task_actor'/i);
  assert.match(
    authorize,
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
    assert.match(authorize, new RegExp(`v_merchant\\.${ownerColumn}`, "i"));
  }
  assert.match(authorize, /v_actor_type = 'owner'[\s\S]+permission_denied/i);
  assert.doesNotMatch(authorize, /p_input\s*->>?\s*'required_permission'/i);
  assert.doesNotMatch(authorize, /p_input\s*->>?\s*'board_scope'/i);
});

test("shared task authorizer holds task, employee, role, scope and board locks in order", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_task_write_v1",
  );

  const merchantLock = authorize.indexOf("from public.merchants");
  const taskLock = authorize.indexOf("from public.merchant_tasks as task");
  const employeeLock = authorize.indexOf(
    "from public.merchant_enterprise_employees as employee",
    taskLock,
  );
  const roleLock = authorize.indexOf(
    "from public.merchant_enterprise_roles as role_row",
    employeeLock,
  );
  const scopeLock = authorize.indexOf(
    "from public.merchant_enterprise_role_boards as role_board",
    roleLock,
  );
  const boardLock = authorize.lastIndexOf("from public.merchant_task_boards as board");

  assert.ok(merchantLock >= 0);
  assert.ok(taskLock > merchantLock, "task must lock after merchant");
  assert.ok(employeeLock > taskLock, "employees must lock after task");
  assert.ok(roleLock > employeeLock, "roles must lock after employees");
  assert.ok(scopeLock > roleLock, "role-board mappings must lock after roles");
  assert.ok(boardLock > scopeLock, "board must lock after role scope");
  assert.match(authorize, /task\.id = p_task_id[\s\S]+for update/i);
  assert.match(authorize, /order by employee\.id[\s\S]+for share of employee/i);
  assert.match(authorize, /order by role_row\.id[\s\S]+for share of role_row/i);
  assert.match(
    authorize,
    /order by role_board\.role_id, role_board\.board_id[\s\S]+for share of role_board/i,
  );
  assert.match(authorize, /board\.id = v_effective_board_id[\s\S]+for share of board/i);
});

test("employee authorization uses current active role, dependencies, permissions and board scope", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_task_write_v1",
  );

  assert.match(authorize, /v_actor_employee\.status <> 'active'/i);
  assert.match(authorize, /v_actor_role\.status <> 'active'/i);
  assert.match(
    authorize,
    /faolla_valid_merchant_enterprise_permissions_v1\([\s\S]+v_actor_role\.permissions/i,
  );
  assert.match(authorize, /p_required_permissions <@ v_actor_role\.permissions/i);
  assert.match(
    authorize,
    /v_actor_role\.access_scope = 'restricted'[\s\S]+role_board\.board_id = v_effective_board_id[\s\S]+raise exception '%', p_scope_error/i,
  );
  assert.match(authorize, /p_scope_error not in \('board_not_found', 'task_not_found'\)/i);
  assert.match(authorize, /v_valid_assignee_count <> cardinality\(v_assignee_ids\)/i);
});

test("wrappers derive permissions from mutation fields instead of trusting callers", () => {
  const source = readMigration();
  const createTask = readFunction(source, "faolla_create_merchant_task_v1");
  const updateTask = readFunction(source, "faolla_update_merchant_task_v1");
  const moveTask = readFunction(source, "faolla_move_merchant_task_v1");
  const comment = readFunction(source, "faolla_add_merchant_task_comment_v1");
  const createChecklist = readFunction(
    source,
    "faolla_create_merchant_task_checklist_item_v1",
  );
  const updateChecklist = readFunction(
    source,
    "faolla_update_merchant_task_checklist_item_v1",
  );

  assert.match(createTask, /array\['tasks\.create'\]/i);
  assert.match(
    createTask,
    /cardinality\(v_assignee_ids\) > 0[\s\S]+array_append\([\s\S]+tasks\.assign/i,
  );
  assert.match(
    createTask,
    /faolla_authorize_merchant_task_write_v1\([\s\S]+board_not_found/i,
  );

  assert.match(updateTask, /v_replace_assignees[\s\S]+tasks\.assign/i);
  assert.match(updateTask, /p_input \? 'archived'[\s\S]+tasks\.archive/i);
  for (const field of ["column_id", "title", "description", "priority", "due_at", "position"]) {
    assert.match(updateTask, new RegExp(`p_input \\? '${field}'`, "i"));
  }
  assert.match(updateTask, /tasks\.update/i);
  assert.match(
    updateTask,
    /faolla_authorize_merchant_task_write_v1\([\s\S]+task_not_found/i,
  );

  for (const wrapper of [moveTask, comment, createChecklist, updateChecklist]) {
    assert.match(wrapper, /array\['tasks\.update'\]/i);
    assert.match(wrapper, /task_not_found/i);
  }
  assert.match(createChecklist, /invalid_task_checklist_create/i);
  assert.match(updateChecklist, /invalid_task_checklist_update/i);
  const moveAdvisory = moveTask.indexOf("pg_advisory_xact_lock");
  const moveAuthorization = moveTask.indexOf(
    "perform public.faolla_authorize_merchant_task_write_v1",
  );
  assert.ok(
    moveAdvisory >= 0 && moveAuthorization > moveAdvisory,
    "move ordering advisory lock must precede the task authorization lock",
  );
});

test("only protected wrappers are service-callable and migration is registered", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_authorize_merchant_task_write_v1\([\s\S]+\) from public, anon, authenticated, service_role/i,
  );
  for (const [publicName] of wrappers) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function public\\.${publicName}\\(jsonb\\)\\s+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function public\\.${publicName}\\(jsonb\\)\\s+to service_role`,
        "i",
      ),
    );
  }
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202608020015, 'merchant_enterprise_task_atomic_authorization'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /drop\s+column/i);
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:update|delete)\s+public\./i);
});
