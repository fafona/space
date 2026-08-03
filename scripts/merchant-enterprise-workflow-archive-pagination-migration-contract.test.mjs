import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608030021_merchant_enterprise_workflow_archive_pagination.sql",
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

test("021 is additive, registered, and indexes the archive keyset", () => {
  const sql = source();
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(
    sql,
    /merchant_enterprise_workflows_archived_updated_idx[\s\S]+\(merchant_id, updated_at desc, id desc\)[\s\S]+where status = 'archived'/i,
  );
  assert.match(
    sql,
    /merchant_enterprise_workflows_archived_scenario_idx[\s\S]+merchant_id, scenario, updated_at desc, id desc[\s\S]+where status = 'archived'/i,
  );
  assert.match(
    sql,
    /merchant_enterprise_workflows_archived_tags_idx[\s\S]+using gin\(tags\)[\s\S]+where status = 'archived'/i,
  );
  assert.match(
    sql,
    /insert into public\.faolla_schema_migrations[\s\S]+values \(202608030021, 'merchant_enterprise_workflow_archive_pagination'\)/i,
  );
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\bdrop\s+column\b/i);
});

test("archived-to-active transitions share the create lock and enforce 200", () => {
  const sql = source();
  assert.match(
    sql,
    /lock table public\.merchant_enterprise_workflows in share row exclusive mode/i,
  );
  const guard = readFunction(
    sql,
    "faolla_enforce_merchant_workflow_active_limit_v1",
  );
  assert.match(guard, /language plpgsql\s+volatile\s+security definer/i);
  assert.match(guard, /old\.status = 'archived' and new\.status <> 'archived'/i);
  assert.match(
    guard,
    /pg_advisory_xact_lock\([\s\S]+hashtextextended\('faolla-enterprise-workflows:' \|\| new\.merchant_id, 0\)/i,
  );
  assert.match(
    guard,
    /where workflow\.merchant_id = new\.merchant_id[\s\S]+workflow\.status <> 'archived'/i,
  );
  assert.match(guard, /v_active_count >= 200[\s\S]+workflow_limit_reached/i);
  assert.match(
    sql,
    /create trigger merchant_enterprise_workflows_active_limit\s+before update of status[\s\S]+for each row[\s\S]+faolla_enforce_merchant_workflow_active_limit_v1/i,
  );
  assert.match(sql, /having count\(\*\) > 200[\s\S]+workflow_active_limit_existing_violation/i);
});

test("published revisions reject TRUNCATE at statement scope", () => {
  const sql = source();
  assert.match(
    sql,
    /create trigger merchant_enterprise_workflow_revisions_reject_truncate\s+before truncate on public\.merchant_enterprise_workflow_revisions\s+for each statement\s+execute function public\.faolla_reject_merchant_workflow_revision_mutation_v1\(\)/i,
  );
  assert.match(
    sql,
    /enable always trigger merchant_enterprise_workflow_revisions_reject_truncate/i,
  );
});

test("archive RPC validates limits, filters, and a paired typed cursor", () => {
  const sql = source();
  const list = readFunction(
    sql,
    "faolla_list_merchant_enterprise_archived_workflows_v1",
  );
  assert.match(
    list,
    /'merchant_id', 'actor_type', 'actor_id', 'limit', 'cursor',[\s\S]+'query', 'scenario', 'tag'/i,
  );
  assert.match(list, /v_limit integer := 50/i);
  assert.match(list, /v_limit not between 1 and 100/i);
  assert.match(list, /char_length\(v_query\) not between 1 and 160/i);
  assert.match(list, /char_length\(v_scenario\) not between 1 and 500/i);
  assert.match(list, /char_length\(v_tag\) not between 1 and 40/i);
  assert.match(
    list,
    /array\['updated_at', 'id'\][\s\S]+\? 'updated_at'[\s\S]+\? 'id'/i,
  );
  assert.match(list, /::timestamptz[\s\S]+invalid_workflow_cursor/i);
  assert.match(
    list,
    /invalid_text_representation[\s\S]+invalid_datetime_format[\s\S]+datetime_field_overflow/i,
  );
  assert.match(list, /v_cursor_id_text !~\*/i);
});

test("archive RPC reauthorizes manager or publisher on every page", () => {
  const list = readFunction(
    source(),
    "faolla_list_merchant_enterprise_archived_workflows_v1",
  );
  assert.match(
    list,
    /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view', 'workflows\.view'\]/i,
  );
  assert.match(
    list,
    /actor_type'\) <> 'owner'[\s\S]+can_manage[\s\S]+can_publish[\s\S]+permission_denied/i,
  );
});

test("archive RPC applies filters before strict keyset limit-plus-one pagination", () => {
  const list = readFunction(
    source(),
    "faolla_list_merchant_enterprise_archived_workflows_v1",
  );
  assert.match(list, /workflow\.merchant_id = v_site_id/i);
  assert.match(list, /workflow\.status = 'archived'/i);
  assert.match(
    list,
    /\(workflow\.updated_at, workflow\.id\)[\s\S]+< \(v_cursor_updated_at, v_cursor_id\)/i,
  );
  assert.match(list, /workflow\.scenario = v_scenario/i);
  assert.match(list, /workflow\.tags @> array\[v_tag\]::text\[\]/i);
  for (const field of ["title", "scenario", "description", "category"]) {
    assert.match(
      list,
      new RegExp(`strpos\\(lower\\(workflow\\.${field}\\), lower\\(v_query\\)\\) > 0`, "i"),
    );
  }
  assert.match(list, /from unnest\(workflow\.tags\)/i);
  assert.match(
    list,
    /merchant_enterprise_workflow_steps[\s\S]+workflow_step\.status = 'active'[\s\S]+workflow_step\.title[\s\S]+workflow_step\.instruction/i,
  );
  assert.match(list, /order by workflow\.updated_at desc, workflow\.id desc[\s\S]+limit \(v_limit \+ 1\)/i);
  assert.match(
    list,
    /returned as materialized \([\s\S]+order by page\.updated_at desc, page\.id desc[\s\S]+limit v_limit/i,
  );
  assert.match(
    list,
    /'updated_at', boundary\.updated_at,[\s\S]+'id', boundary\.id[\s\S]+order by boundary\.updated_at, boundary\.id[\s\S]+limit 1/i,
  );
  assert.match(list, /'workflows', v_workflows,[\s\S]+'next_cursor', v_next_cursor/i);
});

test("exact workflow RPC is tenant-scoped and reauthorizes each lookup", () => {
  const exact = readFunction(
    source(),
    "faolla_get_merchant_enterprise_workflow_v1",
  );
  assert.match(
    exact,
    /array\['merchant_id', 'actor_type', 'actor_id', 'workflow_id'\]/i,
  );
  assert.match(exact, /\? 'workflow_id'[\s\S]+jsonb_typeof\(p_input -> 'workflow_id'\)/i);
  assert.match(exact, /v_workflow_id_text !~\*/i);
  assert.match(
    exact,
    /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view', 'workflows\.view'\]/i,
  );
  assert.match(
    exact,
    /workflow\.merchant_id = v_site_id[\s\S]+workflow\.id = v_workflow_id/i,
  );
  assert.match(
    exact,
    /not v_can_read_current[\s\S]+v_status <> 'published'[\s\S]+workflow_not_found/i,
  );
  assert.match(
    exact,
    /faolla_build_merchant_enterprise_workflow_v1\([\s\S]+not v_can_read_current/i,
  );
});

test("only service_role can execute the archive RPC and storage remains private", () => {
  const sql = source();
  assert.match(
    sql,
    /revoke all on function public\.faolla_list_merchant_enterprise_archived_workflows_v1\(jsonb\)\s+from public, anon, authenticated;/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.faolla_list_merchant_enterprise_archived_workflows_v1\(jsonb\)\s+to service_role;/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.faolla_get_merchant_enterprise_workflow_v1\(jsonb\)\s+from public, anon, authenticated;/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.faolla_get_merchant_enterprise_workflow_v1\(jsonb\)\s+to service_role;/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.faolla_enforce_merchant_workflow_active_limit_v1\(\)\s+from public, anon, authenticated, service_role;/i,
  );
  for (const table of [
    "merchant_enterprise_workflows",
    "merchant_enterprise_workflow_steps",
    "merchant_enterprise_workflow_revisions",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on public\\.${table}\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
  }
});
