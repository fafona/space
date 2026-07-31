import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310007_merchant_enterprise_invitation_removal.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readRemovalFunction(source) {
  const match = source.match(
    /create or replace function public\.faolla_remove_merchant_employee_invitation_v1\([\s\S]+?\n\$\$;/i,
  );
  assert.ok(match, "pending invitation removal function is missing");
  return match[0];
}

test("pending invitation removal locks the merchant-scoped employee and enforces row-version CAS", () => {
  const removal = readRemovalFunction(readMigration());

  assert.match(removal, /security definer[\s\S]+set search_path = public/i);
  assert.match(
    removal,
    /from public\.merchant_enterprise_employees[\s\S]+merchant_id = v_site_id[\s\S]+id = v_employee_id[\s\S]+for update/i,
  );
  assert.match(
    removal,
    /v_employee\.version <> v_expected_version[\s\S]+raise exception 'enterprise_version_conflict'/i,
  );
  assert.match(
    removal,
    /v_employee\.status <> 'invited' or v_employee\.accepted_at is not null[\s\S]+raise exception 'employee_invitation_not_pending'/i,
  );
});

test("pending invitation removal refuses every task reference before deleting", () => {
  const removal = readRemovalFunction(readMigration());

  assert.match(
    removal,
    /from public\.merchant_tasks[\s\S]+merchant_id = v_site_id[\s\S]+created_by_employee_id = v_employee_id/i,
  );
  assert.match(
    removal,
    /from public\.merchant_task_assignees[\s\S]+merchant_id = v_site_id[\s\S]+employee_id = v_employee_id[\s\S]+assigned_by_employee_id = v_employee_id/i,
  );
  assert.match(removal, /raise exception 'employee_invitation_in_use'/i);
});

test("pending invitation removal repeats all immutable conditions in the delete predicate", () => {
  const removal = readRemovalFunction(readMigration());

  assert.match(
    removal,
    /delete from public\.merchant_enterprise_employees[\s\S]+merchant_id = v_site_id[\s\S]+id = v_employee_id[\s\S]+version = v_expected_version[\s\S]+status = 'invited'[\s\S]+accepted_at is null[\s\S]+returning id into v_removed_employee_id/i,
  );
  assert.match(
    removal,
    /jsonb_build_object\([\s\S]+'removed',[\s\S]+true,[\s\S]+'employee_id',[\s\S]+v_removed_employee_id::text/i,
  );
  assert.doesNotMatch(removal, /auth\.users/i);
});

test("pending invitation removal RPC is service-role only and migration 007 is registered", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_remove_merchant_employee_invitation_v1\(jsonb\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_remove_merchant_employee_invitation_v1\(jsonb\)[\s\S]+to service_role/i,
  );
  assert.match(
    source,
    /values \(202607310007, 'merchant_enterprise_invitation_removal'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
});
