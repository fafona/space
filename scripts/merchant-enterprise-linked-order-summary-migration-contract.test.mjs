import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608010014_merchant_enterprise_linked_order_summary.sql",
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

test("linked-order permission is opt-in and understood by database validation", () => {
  const source = readMigration();
  const validator = readFunction(
    source,
    "faolla_valid_merchant_enterprise_permissions_v1",
  );

  assert.match(
    source,
    /drop constraint merchant_enterprise_roles_permissions_check[\s\S]+add constraint merchant_enterprise_roles_permissions_check/i,
  );
  assert.match(
    source,
    /merchant_enterprise_roles_permissions_check[\s\S]+permissions <@ array\[[\s\S]+orders\.linked\.view/i,
  );
  assert.match(
    validator,
    /p_permissions <@ array\[[\s\S]+orders\.linked\.view/i,
  );
  assert.match(
    validator,
    /not \('orders\.linked\.view' = any\(p_permissions\)\)[\s\S]+enterprise\.view[\s\S]+tasks\.view/i,
  );
  assert.doesNotMatch(
    source,
    /update\s+public\.merchant_enterprise_roles/i,
    "existing role permissions must not be changed",
  );
  assert.doesNotMatch(
    source,
    /array_append\s*\(\s*permissions/i,
    "migration must not backfill the new permission",
  );
});

test("authorization RPC accepts only merchant, task, and employee identifiers", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_linked_order_summary_v1",
  );

  assert.match(authorize, /p_input jsonb/i);
  assert.match(authorize, /returns jsonb/i);
  assert.match(authorize, /language plpgsql/i);
  assert.match(authorize, /security definer/i);
  assert.match(authorize, /set search_path = public/i);
  assert.match(
    authorize,
    /select count\(\*\) from jsonb_object_keys\(p_input\)\) <> 3/i,
  );
  assert.doesNotMatch(authorize, /jsonb_object_length/i);
  assert.match(
    authorize,
    /p_input - array\[[\s\S]+merchant_id[\s\S]+task_id[\s\S]+employee_id[\s\S]+\]::text\[\] <> '\{\}'::jsonb/i,
  );
  for (const key of ["merchant_id", "task_id", "employee_id"]) {
    assert.match(authorize, new RegExp(`p_input \\? '${key}'`, "i"));
    assert.match(
      authorize,
      new RegExp(`jsonb_typeof\\(p_input -> '${key}'\\) <> 'string'`, "i"),
    );
  }
  assert.doesNotMatch(authorize, /p_input\s*->>?\s*'order_id'/i);
  assert.doesNotMatch(authorize, /p_input\s*->>?\s*'source_id'/i);
  assert.doesNotMatch(authorize, /p_input\s*->>?\s*'actor_type'/i);
});

test("one database query enforces employee, assignment, permission and board scope", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_linked_order_summary_v1",
  );

  assert.match(
    authorize,
    /from public\.merchant_enterprise_employees as employee[\s\S]+join public\.merchant_enterprise_roles as role_row[\s\S]+join public\.merchant_task_assignees as assignee[\s\S]+join public\.merchant_tasks as task[\s\S]+left join public\.merchant_enterprise_role_boards as role_board/i,
  );
  assert.match(authorize, /employee\.merchant_id = v_site_id/i);
  assert.match(authorize, /employee\.id = v_employee_id/i);
  assert.match(authorize, /employee\.status = 'active'/i);
  assert.match(authorize, /role_row\.status = 'active'/i);
  assert.match(
    authorize,
    /'enterprise\.view' = any\(role_row\.permissions\)/i,
  );
  assert.match(authorize, /'tasks\.view' = any\(role_row\.permissions\)/i);
  assert.match(
    authorize,
    /'orders\.linked\.view' = any\(role_row\.permissions\)/i,
  );
  assert.match(
    authorize,
    /assignee\.merchant_id = employee\.merchant_id[\s\S]+assignee\.employee_id = employee\.id/i,
  );
  assert.match(
    authorize,
    /task\.merchant_id = assignee\.merchant_id[\s\S]+task\.id = assignee\.task_id/i,
  );
  assert.match(authorize, /task\.merchant_id = v_site_id/i);
  assert.match(authorize, /task\.id = v_task_id/i);
  assert.match(authorize, /task\.source_type = 'order'/i);
  assert.match(
    authorize,
    /role_row\.access_scope = 'all'[\s\S]+role_row\.access_scope = 'restricted'[\s\S]+role_board\.board_id is not null/i,
  );
});

test("invisible tasks share one 404-safe error and success reveals only source_id", () => {
  const source = readMigration();
  const authorize = readFunction(
    source,
    "faolla_authorize_merchant_linked_order_summary_v1",
  );

  assert.match(
    authorize,
    /select task\.source_id[\s\S]+into v_source_id[\s\S]+if not found then[\s\S]+raise exception 'task_not_found'/i,
  );
  assert.equal(
    authorize.match(/raise exception 'task_not_found'/gi)?.length,
    1,
    "all failed visibility predicates must converge on one stable error",
  );
  assert.match(
    authorize,
    /return jsonb_build_object\('source_id', v_source_id\);/i,
  );
  assert.doesNotMatch(authorize, /return\s+to_jsonb/i);
  assert.doesNotMatch(authorize, /jsonb_build_object\([^;]*(?:task|employee|role|board)_id/i);
});

test("authorization RPC is service-only and migration is atomic and registered", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_authorize_merchant_linked_order_summary_v1\(jsonb\)\s+from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_authorize_merchant_linked_order_summary_v1\(jsonb\)\s+to service_role/i,
  );
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /values \(202608010014, 'merchant_enterprise_linked_order_summary'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /truncate\s+/i);
  assert.doesNotMatch(source, /drop\s+table/i);
  assert.doesNotMatch(source, /drop\s+column/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\./i);
});
