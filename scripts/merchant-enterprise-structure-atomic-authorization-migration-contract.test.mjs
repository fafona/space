import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608020016_merchant_enterprise_structure_atomic_authorization.sql",
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
  [
    "faolla_bootstrap_merchant_enterprise_v2",
    "faolla_bootstrap_merchant_enterprise_v2_unchecked_016",
  ],
  [
    "faolla_create_merchant_task_board_v1",
    "faolla_create_merchant_task_board_v1_unchecked_016",
  ],
  [
    "faolla_update_merchant_task_board_v1",
    "faolla_update_merchant_task_board_v1_unchecked_016",
  ],
  [
    "faolla_create_merchant_task_column_v1",
    "faolla_create_merchant_task_column_v1_unchecked_016",
  ],
  [
    "faolla_update_merchant_task_column_v1",
    "faolla_update_merchant_task_column_v1_unchecked_016",
  ],
];

test("structure authorization keeps public RPC names and privatizes every old implementation", () => {
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
      "perform public.faolla_authorize_merchant_enterprise_structure_write_v1",
    );
    const delegate = wrapper.indexOf(`return public.${uncheckedName}(p_input)`);
    assert.ok(authorization >= 0, `${publicName} must authorize`);
    assert.ok(delegate > authorization, `${publicName} must authorize before delegating`);
    assert.match(wrapper, /security definer/i);
    assert.match(wrapper, /set search_path = public/i);
  }
});

test("shared structure authorizer validates actor identity and current employee role permissions", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_enterprise_structure_write_v1",
  );

  assert.match(authorize, /jsonb_typeof\(p_input -> 'actor_type'\) <> 'string'/i);
  assert.match(authorize, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(authorize, /jsonb_typeof\(p_input -> 'actor_id'\) <> 'string'/i);
  assert.match(authorize, /raise exception 'invalid_enterprise_actor'/i);
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
  assert.match(authorize, /v_actor_employee\.status <> 'active'/i);
  assert.match(authorize, /v_actor_role\.status <> 'active'/i);
  assert.match(
    authorize,
    /faolla_valid_merchant_enterprise_permissions_v1\([\s\S]+v_actor_role\.permissions/i,
  );
  assert.match(authorize, /p_required_permissions <@ v_actor_role\.permissions/i);
  assert.doesNotMatch(authorize, /p_input\s*->>?\s*'required_permissions'/i);
});

test("structure authorization serializes locks and hides scope or resource state", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_enterprise_structure_write_v1",
  );

  const advisoryLock = authorize.indexOf("pg_advisory_xact_lock");
  const merchantLock = authorize.indexOf("from public.merchants");
  const employeeLock = authorize.indexOf("from public.merchant_enterprise_employees");
  const roleLock = authorize.indexOf("from public.merchant_enterprise_roles");
  const mappingLock = authorize.indexOf("from public.merchant_enterprise_role_boards");
  const boardLock = authorize.indexOf("from public.merchant_task_boards as board");
  const columnLock = authorize.indexOf("from public.merchant_task_columns as task_column");

  assert.ok(advisoryLock >= 0);
  assert.ok(merchantLock > advisoryLock, "merchant must lock after the structure advisory lock");
  assert.ok(employeeLock > merchantLock, "employee must lock after merchant");
  assert.ok(roleLock > employeeLock, "role must lock after employee");
  assert.ok(mappingLock > roleLock, "role-board mappings must lock after role");
  assert.ok(boardLock > mappingLock, "board must lock after role scope");
  assert.ok(columnLock > boardLock, "column must lock after board");
  const allBoardScopeCheck = authorize.indexOf(
    "and p_require_all_boards",
    boardLock,
  );
  assert.ok(
    allBoardScopeCheck > boardLock,
    "target board scope must be validated before denying an all-board mutation",
  );
  assert.match(authorize, /order by role_board\.role_id, role_board\.board_id[\s\S]+for share of role_board/i);
  assert.match(
    authorize,
    /p_require_all_boards[\s\S]+v_actor_role\.access_scope <> 'all'[\s\S]+permission_denied/i,
  );
  assert.match(
    authorize,
    /v_actor_role\.access_scope = 'restricted'[\s\S]+role_board\.board_id = p_board_id[\s\S]+board_not_found/i,
  );
  assert.match(authorize, /board\.id = p_board_id[\s\S]+for share of board[\s\S]+board_not_found/i);
  assert.match(
    authorize,
    /task_column\.board_id = p_board_id[\s\S]+task_column\.id = p_column_id[\s\S]+for share of task_column[\s\S]+column_not_found/i,
  );
});

test("wrappers derive all-board and permission requirements without trusting callers", () => {
  const source = readMigration();
  const bootstrap = readFunction(source, "faolla_bootstrap_merchant_enterprise_v2");
  const createBoard = readFunction(source, "faolla_create_merchant_task_board_v1");
  const updateBoard = readFunction(source, "faolla_update_merchant_task_board_v1");
  const createColumn = readFunction(source, "faolla_create_merchant_task_column_v1");
  const updateColumn = readFunction(source, "faolla_update_merchant_task_column_v1");

  assert.match(
    bootstrap,
    /null,\s*null,\s*true,\s*array\['boards\.manage', 'roles\.manage'\]::text\[\]/i,
  );
  assert.match(
    createBoard,
    /null,\s*null,\s*true,\s*array\['boards\.manage'\]::text\[\]/i,
  );
  assert.match(updateBoard, /v_require_all_boards := p_input \? 'position'/i);
  assert.match(
    updateBoard,
    /v_board_id_text::uuid,\s*null,\s*v_require_all_boards,\s*array\['boards\.manage'\]::text\[\]/i,
  );
  assert.doesNotMatch(updateBoard, /p_input\s*->>?\s*'require_all_boards'/i);
  assert.match(createColumn, /v_board_id_text::uuid,\s*null,\s*false,[\s\S]+boards\.manage/i);
  assert.match(
    updateColumn,
    /v_board_id_text::uuid,\s*v_column_id_text::uuid,\s*false,[\s\S]+boards\.manage/i,
  );
  assert.match(updateBoard, /raise exception 'invalid_board_update'/i);
  assert.match(createColumn, /raise exception 'invalid_column'/i);
  assert.match(updateColumn, /raise exception 'invalid_column_update'/i);
});

test("only protected wrappers are service-callable and the entitlement boundary stays truthful", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_authorize_merchant_enterprise_structure_write_v1\([\s\S]+\) from public, anon, authenticated, service_role/i,
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
  assert.match(source, /authoritative enterprise entitlement[\s\S]+API precondition/i);
  assert.doesNotMatch(source, /allowEnterpriseManagement|permission_config|from public\.pages/i);
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202608020016, 'merchant_enterprise_structure_atomic_authorization'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /drop\s+column/i);
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:update|delete)\s+public\./i);
});
