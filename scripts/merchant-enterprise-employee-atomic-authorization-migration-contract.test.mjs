import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608020017_merchant_enterprise_employee_atomic_authorization.sql",
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
    "faolla_create_merchant_enterprise_employee_v1",
    "faolla_create_merchant_enterprise_employee_v1_unchecked_017",
    "employee",
  ],
  [
    "faolla_update_merchant_enterprise_employee_v1",
    "faolla_update_merchant_enterprise_employee_v1_unchecked_017",
    "employee",
  ],
  [
    "faolla_reserve_merchant_employee_invitation_v1",
    "faolla_reserve_merchant_employee_invitation_v1_unchecked_017",
    "invitation",
  ],
  [
    "faolla_revoke_merchant_employee_invitation_v1",
    "faolla_revoke_merchant_employee_invitation_v1_unchecked_017",
    "invitation",
  ],
  [
    "faolla_remove_merchant_employee_invitation_v1",
    "faolla_remove_merchant_employee_invitation_v1_unchecked_017",
    "invitation",
  ],
];

test("employee authorization preserves public RPC names and privatizes every old implementation", () => {
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
      "perform public.faolla_authorize_merchant_enterprise_employee_actor_v1",
    );
    const delegate = wrapper.indexOf(`return public.${uncheckedName}(p_input)`);
    assert.ok(authorization >= 0, `${publicName} must authorize`);
    assert.ok(delegate > authorization, `${publicName} must authorize before delegating`);
    assert.match(wrapper, /security definer/i);
    assert.match(wrapper, /set search_path = public/i);
  }
});

test("employee create and update validate owners while preserving employee delegate lock order", () => {
  const source = readMigration();

  for (const name of [
    "faolla_create_merchant_enterprise_employee_v1",
    "faolla_update_merchant_enterprise_employee_v1",
  ]) {
    const wrapper = readFunction(source, name);
    assert.match(wrapper, /v_actor_type := nullif\(btrim\(p_input ->> 'actor_type'\), ''\)/i);
    assert.match(
      wrapper,
      /if v_actor_type = 'owner' then[\s\S]+faolla_authorize_merchant_enterprise_employee_actor_v1\([\s\S]+p_input,[\s\S]+null,[\s\S]+false[\s\S]+end if/i,
    );
    assert.doesNotMatch(wrapper, /if v_actor_type = 'employee' then[\s\S]+faolla_authorize/i);
    assert.match(wrapper, /unchecked_017\(p_input\)/i);
  }
});

test("shared employee authorizer locks the merchant and validates the real owner UUID", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_enterprise_employee_actor_v1",
  );

  assert.match(authorize, /jsonb_typeof\(p_input -> 'merchant_id'\)[\s\S]+<> 'string'/i);
  assert.match(authorize, /jsonb_typeof\(p_input -> 'actor_type'\)[\s\S]+<> 'string'/i);
  assert.match(authorize, /jsonb_typeof\(p_input -> 'actor_id'\)[\s\S]+<> 'string'/i);
  assert.match(authorize, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(authorize, /v_actor_id_text !~\*[\s\S]+\[0-9a-f\][\s\S]+permission_escalation_denied/i);
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
    assert.match(
      authorize,
      new RegExp(`v_merchant\\.${ownerColumn}`, "i"),
      `owner authorization must check merchants.${ownerColumn}`,
    );
  }
  assert.match(
    authorize,
    /if v_actor_type = 'owner' then[\s\S]+v_actor_id = any\(array_remove\([\s\S]+permission_escalation_denied[\s\S]+return;/i,
  );
  assert.doesNotMatch(authorize, /allowEnterpriseManagement|permission_config|from public\.pages/i);
});

test("invitation authorization revalidates manager, target role, permissions and board scope", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_enterprise_employee_actor_v1",
  );

  assert.match(
    authorize,
    /v_actor_id = p_target_employee_id[\s\S]+permission_escalation_denied/i,
  );
  assert.match(
    authorize,
    /employee\.id = any\(array\[v_actor_id, p_target_employee_id\]\)[\s\S]+order by employee\.id[\s\S]+for update of employee/i,
  );
  assert.match(authorize, /v_actor_employee\.status <> 'active'/i);
  assert.match(authorize, /id = p_target_employee_id[\s\S]+employee_not_found/i);
  assert.match(
    authorize,
    /role_row\.id = any\(array_remove\(array\[[\s\S]+v_actor_employee\.role_id,[\s\S]+v_target_employee\.role_id[\s\S]+order by role_row\.id[\s\S]+for share of role_row/i,
  );
  assert.match(
    authorize,
    /id = v_actor_employee\.role_id[\s\S]+status = 'active'[\s\S]+'employees\.manage' = any\(permissions\)/i,
  );
  assert.match(
    authorize,
    /role_board\.role_id = any\(array_remove\(array\[[\s\S]+order by role_board\.role_id, role_board\.board_id[\s\S]+for share of role_board/i,
  );
  assert.match(
    authorize,
    /faolla_merchant_enterprise_role_fits_actor_v1\([\s\S]+v_actor_role\.id,[\s\S]+v_target_employee\.role_id[\s\S]+permission_escalation_denied/i,
  );

  const merchantLock = authorize.indexOf("from public.merchants");
  const employeeLock = authorize.indexOf("from public.merchant_enterprise_employees as employee");
  const roleLock = authorize.indexOf("from public.merchant_enterprise_roles as role_row");
  const mappingLock = authorize.indexOf("from public.merchant_enterprise_role_boards as role_board");
  assert.ok(merchantLock >= 0);
  assert.ok(employeeLock > merchantLock, "employees must lock after merchant identity");
  assert.ok(roleLock > employeeLock, "roles must lock after employees");
  assert.ok(mappingLock > roleLock, "role-board mappings must lock after roles");
});

test("invitation wrappers derive the target and require atomic manager authorization", () => {
  const source = readMigration();

  for (const [publicName, , kind] of wrappers) {
    if (kind !== "invitation") continue;
    const wrapper = readFunction(source, publicName);
    assert.match(wrapper, /jsonb_typeof\(p_input -> 'employee_id'\)[\s\S]+<> 'string'/i);
    assert.match(wrapper, /v_employee_id_text := nullif\(btrim\(p_input ->> 'employee_id'\), ''\)/i);
    assert.match(wrapper, /v_employee_id_text !~\*[\s\S]+\[0-9a-f\]/i);
    assert.match(
      wrapper,
      /faolla_authorize_merchant_enterprise_employee_actor_v1\([\s\S]+p_input,[\s\S]+v_employee_id_text::uuid,[\s\S]+true/i,
    );
    assert.doesNotMatch(wrapper, /p_input\s*->>?\s*'require_employee_manager'/i);
  }
});

test("only wrappers remain service-callable and unrelated boundaries stay unchanged", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_authorize_merchant_enterprise_employee_actor_v1\([\s\S]+jsonb, uuid, boolean[\s\S]+\) from public, anon, authenticated, service_role/i,
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

  assert.doesNotMatch(
    source,
    /alter function public\.faolla_(?:accept|finalize|bind)_merchant_employee/i,
  );
  assert.doesNotMatch(source, /faolla_(?:create|update)_merchant_enterprise_role_v1/i);
  assert.doesNotMatch(source, /(?:grant|revoke)[^;]+on (?:table )?public\.merchant_/i);
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202608020017, 'merchant_enterprise_employee_atomic_authorization'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /drop\s+column/i);
});
