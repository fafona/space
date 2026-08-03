import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608040023_merchant_enterprise_workflow_revisions.sql",
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

test("023 is additive, registered and keeps revision storage immutable", () => {
  const sql = source();
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(
    sql,
    /insert into public\.faolla_schema_migrations[\s\S]+values \(202608040023, 'merchant_enterprise_workflow_revisions'\)/i,
  );
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\bdrop\s+column\b|\btruncate\b/i);
  assert.doesNotMatch(
    sql,
    /update\s+public\.merchant_enterprise_workflow_revisions|delete\s+from\s+public\.merchant_enterprise_workflow_revisions/i,
  );
});

test("history listing is tenant scoped, manager/reviewer only and keyset paginated", () => {
  const list = readFunction(
    source(),
    "faolla_list_merchant_enterprise_workflow_revisions_v1",
  );
  assert.match(
    list,
    /array\s*\[\s*'merchant_id', 'actor_type', 'actor_id', 'workflow_id',[\s\S]+'limit', 'before_revision'/i,
  );
  assert.match(
    list,
    /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view', 'workflows\.view'\]/i,
  );
  assert.match(
    list,
    /actor_type' <> 'owner'[\s\S]+can_manage[\s\S]+can_publish[\s\S]+permission_denied/i,
  );
  assert.match(
    list,
    /workflow\.merchant_id = v_site_id[\s\S]+workflow\.id = v_workflow_id/i,
  );
  assert.match(
    list,
    /revision\.merchant_id = v_site_id[\s\S]+revision\.workflow_id = v_workflow_id[\s\S]+revision\.revision_no < v_before_revision/i,
  );
  assert.match(list, /order by revision\.revision_no desc[\s\S]+limit \(v_limit \+ 1\)/i);
  assert.match(list, /return jsonb_build_object\(\s*'merchantId', v_site_id/i);
  assert.match(list, /'next_before_revision', v_next_before_revision/i);
});

test("revision detail returns selected, previous and working draft snapshots for diff", () => {
  const detail = readFunction(
    source(),
    "faolla_get_merchant_enterprise_workflow_revision_v1",
  );
  assert.match(detail, /revision\.revision_no = v_revision_no/i);
  assert.match(
    detail,
    /revision\.revision_no < v_revision_no[\s\S]+order by revision\.revision_no desc[\s\S]+limit 1/i,
  );
  assert.match(
    detail,
    /faolla_build_merchant_enterprise_workflow_v1\([\s\S]+v_site_id, v_workflow_id, false/i,
  );
  assert.match(detail, /'revision'[\s\S]+'previous_revision'[\s\S]+'working_draft'/i);
  assert.match(detail, /return jsonb_build_object\(\s*'merchantId', v_site_id/i);
  assert.match(detail, /'can_restore'[\s\S]+can_manage/i);
});

test("historical restore copies into the mutable draft and preserves revision rows", () => {
  const restore = readFunction(
    source(),
    "faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1",
  );
  assert.match(
    restore,
    /array\['enterprise\.view', 'workflows\.view', 'workflows\.manage'\]/i,
  );
  assert.match(restore, /faolla_claim_enterprise_structure_operation_v1/i);
  assert.match(restore, /faolla_complete_enterprise_structure_operation_v1/i);
  assert.match(restore, /for update[\s\S]+v_workflow\.version <> v_expected_version/i);
  assert.match(restore, /v_workflow\.status = 'archived'[\s\S]+workflow_archived/i);
  assert.match(
    restore,
    /faolla_replace_merchant_workflow_steps_v1\([\s\S]+v_snapshot -> 'steps'/i,
  );
  assert.match(
    restore,
    /update public\.merchant_enterprise_workflows[\s\S]+title = btrim\(v_snapshot ->> 'title'\)[\s\S]+has_unpublished_changes = true/i,
  );
  assert.doesNotMatch(restore, /current_revision_id\s*=/i);
  assert.doesNotMatch(
    restore,
    /update\s+public\.merchant_enterprise_workflow_revisions|delete\s+from\s+public\.merchant_enterprise_workflow_revisions/i,
  );
  assert.match(restore, /workflow\.restore_revision[\s\S]+'workflow\.updated'/i);
});

test("legacy role gap detection is owner-only and provably read-only", () => {
  const gaps = readFunction(
    source(),
    "faolla_list_merchant_enterprise_workflow_permission_gaps_v1",
  );
  assert.match(gaps, /language plpgsql\s+security definer/i);
  assert.match(
    gaps,
    /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view'\]/i,
  );
  assert.match(gaps, /actor_type' <> 'owner'[\s\S]+permission_denied/i);
  assert.match(gaps, /system_default_gap[\s\S]+custom_role_review/i);
  assert.match(gaps, /return jsonb_build_object\('merchantId', v_site_id, 'gaps', v_gaps\)/i);
  assert.match(
    gaps,
    /administrator'[\s\S]+workflows\.view[\s\S]+workflows\.manage[\s\S]+workflows\.publish/i,
  );
  assert.doesNotMatch(gaps, /\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/i);
});

test("permission grant is owner-only, additive and never manufactures dependencies", () => {
  const grant = readFunction(
    source(),
    "faolla_grant_merchant_enterprise_role_workflow_permissions_v1",
  );
  assert.match(grant, /actor_type' <> 'owner'[\s\S]+permission_denied/i);
  assert.match(
    grant,
    /workflow_permissions'[\s\S]+workflows\.view[\s\S]+workflows\.manage[\s\S]+workflows\.publish/i,
  );
  assert.match(
    grant,
    /jsonb_typeof\(p_input -> 'workflow_permissions'\)[\s\S]+<> 'array'[\s\S]+raise exception 'invalid_workflow_permission_grant';\s+end if;\s+if jsonb_array_length\(p_input -> 'workflow_permissions'\)/i,
  );
  assert.match(grant, /cardinality\(v_requested\) <> jsonb_array_length/i);
  assert.match(
    grant,
    /unnest\(v_role\.permissions \|\| v_requested\)/i,
  );
  assert.match(grant, /faolla_valid_merchant_enterprise_permissions_v1\(v_next_permissions\)/i);
  assert.match(grant, /raise exception 'invalid_permission_dependencies'/i);
  assert.doesNotMatch(grant, /array_append\([^,]+,\s*'workflows\./i);
  assert.match(grant, /v_role\.version <> v_expected_version/i);
  assert.match(grant, /faolla_claim_enterprise_structure_operation_v1/i);
  assert.match(grant, /v_response := jsonb_build_object\(\s*'merchantId', v_site_id/i);
  assert.match(
    grant,
    /faolla_set_merchant_enterprise_audit_context_v1\([\s\S]+role\.grant_workflow_permissions[\s\S]+update public\.merchant_enterprise_roles/i,
  );
  assert.doesNotMatch(
    grant,
    /faolla_append_merchant_enterprise_audit_event_v1/i,
  );
});

test("all revision and permission-gap RPCs remain service-role only", () => {
  const sql = source();
  for (const name of [
    "faolla_list_merchant_enterprise_workflow_revisions_v1",
    "faolla_get_merchant_enterprise_workflow_revision_v1",
    "faolla_restore_merchant_enterprise_workflow_revision_to_draft_v1",
    "faolla_list_merchant_enterprise_workflow_permission_gaps_v1",
    "faolla_grant_merchant_enterprise_role_workflow_permissions_v1",
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
});
