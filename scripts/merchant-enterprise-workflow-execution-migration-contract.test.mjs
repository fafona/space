import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "scripts",
  "supabase-migrations",
  "202608040022_merchant_enterprise_workflow_execution.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const resolveFeedbackSql = sql.match(
  /create or replace function public\.faolla_resolve_merchant_enterprise_workflow_feedback_v1\([\s\S]*?\n\$\$;/i,
)?.[0] ?? "";
const statsSql = sql.match(
  /create or replace function public\.faolla_get_merchant_enterprise_workflow_execution_stats_v1\([\s\S]*?\n\$\$;/i,
)?.[0] ?? "";
const recentFeedbackSql = statsSql.match(
  /select coalesce\(jsonb_agg\(jsonb_build_object\(\s*'executionId'[\s\S]*?\) as feedback;/i,
)?.[0] ?? "";

test("workflow execution migration is additive, transactional and registered", () => {
  assert.match(sql, /^--[\s\S]*\nbegin;/i);
  assert.match(sql, /insert into public\.faolla_schema_migrations[\s\S]+values \(202608040022, 'merchant_enterprise_workflow_execution'\)/i);
  assert.match(sql, /notify pgrst, 'reload schema';[\s\S]*commit;\s*$/i);
  assert.doesNotMatch(sql, /update public\.merchant_enterprise_(?:employees|roles)\b/i);
  assert.doesNotMatch(sql, /\b(?:source_type|source_id)\b/i);
});

test("acknowledgements and executions pin an immutable published revision snapshot", () => {
  assert.match(sql, /create table if not exists public\.merchant_enterprise_workflow_acknowledgements/i);
  assert.match(sql, /unique \(merchant_id, workflow_id, revision_id, employee_id\)/i);
  assert.match(sql, /create table if not exists public\.merchant_enterprise_workflow_executions[\s\S]+revision_id uuid not null[\s\S]+workflow_snapshot jsonb not null/i);
  assert.match(sql, /foreign key \(merchant_id, workflow_id, revision_id\)[\s\S]+merchant_enterprise_workflow_revisions\(merchant_id, workflow_id, id\)[\s\S]+on delete restrict/i);
  assert.match(sql, /faolla_protect_merchant_workflow_execution_snapshot_v1[\s\S]+new\.revision_id is distinct from old\.revision_id[\s\S]+new\.workflow_snapshot is distinct from old\.workflow_snapshot/i);
  assert.match(sql, /faolla_protect_merchant_workflow_execution_step_snapshot_v1[\s\S]+new\.title is distinct from old\.title[\s\S]+new\.instruction is distinct from old\.instruction/i);
  assert.match(sql, /merchant_enterprise_workflow_acknowledgements_append_only[\s\S]+before update or delete/i);
});

test("employee mutations reauthorize in the database and isolate every row by tenant and employee", () => {
  for (const functionName of [
    "faolla_acknowledge_merchant_enterprise_workflow_v1",
    "faolla_start_merchant_enterprise_workflow_execution_v1",
    "faolla_get_merchant_enterprise_workflow_employee_state_v1",
    "faolla_get_merchant_enterprise_workflow_execution_v1",
    "faolla_update_merchant_enterprise_workflow_execution_step_v1",
    "faolla_submit_merchant_enterprise_workflow_feedback_v1",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\(`, "i"));
  }
  assert.match(sql, /faolla_authorize_merchant_enterprise_workflow_actor_v1\([\s\S]+array\['enterprise\.view', 'workflows\.view'\]/i);
  assert.match(sql, /actor_type' <> 'employee'[\s\S]+employee_actor_required/i);
  assert.match(sql, /where merchant_id = v_site_id and id = v_execution_id and employee_id = v_employee_id[\s\S]+for update/i);
  assert.match(sql, /v_execution\.version <> v_expected_version[\s\S]+enterprise_version_conflict/i);
  assert.match(sql, /workflow\.status <> 'published'[\s\S]+current_revision_id is null/i);
  assert.match(sql, /v_revision\.revision_no <> v_expected_revision_no[\s\S]+workflow_revision_changed/i);
});

test("task checklist generation is atomic, assigned-only, revision sourced and duplicate safe", () => {
  assert.match(sql, /faolla_authorize_merchant_task_write_v1\([\s\S]+array\['tasks\.update'\]/i);
  assert.match(sql, /merchant_task_assignees[\s\S]+employee_id = v_employee_id[\s\S]+task_assignment_required/i);
  assert.match(sql, /v_active_checklist_count \+ v_step_count > 100[\s\S]+task_checklist_limit_reached/i);
  assert.match(sql, /merchant_enterprise_workflow_task_checklist_generation_unique[\s\S]+where task_id is not null and generated_checklist_count > 0/i);
  assert.match(sql, /workflow_task_execution_exists/i);
  assert.match(sql, /jsonb_array_elements\(v_revision\.snapshot -> 'steps'\)/i);
  assert.match(sql, /faolla_create_merchant_task_checklist_item_v1\([\s\S]+workflow-execution-checklist:/i);
  assert.match(sql, /merchant_enterprise_workflow_execution_checklist_items[\s\S]+revision_id uuid not null[\s\S]+step_id uuid not null[\s\S]+checklist_item_id uuid not null/i);
  assert.match(sql, /workflow_execution_started[\s\S]+'revisionId'[\s\S]+'generatedChecklistCount'/i);
});

test("step notes and evidence are bounded and execution completion is derived server-side", () => {
  assert.match(sql, /faolla_valid_merchant_workflow_evidence_v1[\s\S]+jsonb_array_length\(p_evidence\) > 10/i);
  assert.match(sql, /kind'[\s\S]+not in \('file', 'link', 'reference'\)/i);
  assert.match(sql, /char_length\(btrim\(v_item ->> 'reference'\)\) not between 1 and 1000/i);
  assert.match(sql, /note text not null default '' check \(char_length\(note\) <= 2000\)/i);
  assert.match(sql, /select count\(\*\)::integer into v_completed_steps[\s\S]+status = case when v_completed_steps = total_steps then 'completed' else 'in_progress' end/i);
  assert.match(sql, /where merchant_id = v_site_id and id = v_execution_id and version = v_expected_version/i);
});

test("feedback can be opened by the employee and atomically resolved by a manager", () => {
  assert.match(sql, /feedback_status text not null default 'none'[\s\S]+\('none', 'open', 'resolved'\)/i);
  assert.match(sql, /faolla_submit_merchant_enterprise_workflow_feedback_v1[\s\S]+status <> 'completed'[\s\S]+workflow_execution_incomplete/i);
  assert.match(sql, /feedback_status = 'open'[\s\S]+feedback_resolved_at = null/i);
  assert.match(sql, /faolla_resolve_merchant_enterprise_workflow_feedback_v1[\s\S]+can_manage[\s\S]+can_publish[\s\S]+permission_denied/i);
  assert.match(sql, /feedback_status <> 'open'[\s\S]+workflow_feedback_not_open/i);
  assert.match(sql, /feedback_status = 'resolved'[\s\S]+feedback_resolver_type = 'owner' and feedback_resolver_id is null[\s\S]+feedback_resolver_type = 'employee' and feedback_resolver_id is not null/i);
  assert.match(resolveFeedbackSql, /feedback_resolver_type = v_actor ->> 'actor_type'/i);
  assert.match(resolveFeedbackSql, /feedback_resolver_id = case[\s\S]+v_actor ->> 'actor_type' = 'employee'[\s\S]+v_actor ->> 'actor_id'[\s\S]+else null[\s\S]+end/i);
  assert.match(resolveFeedbackSql, /'resolution', jsonb_build_object\([\s\S]+'executionId', v_execution\.id[\s\S]+'feedbackStatus', v_execution\.feedback_status[\s\S]+'resolverType', v_execution\.feedback_resolver_type/i);
  assert.doesNotMatch(resolveFeedbackSql, /faolla_build_merchant_workflow_execution_v1/i);
  assert.doesNotMatch(resolveFeedbackSql, /'execution'\s*,/i);
  assert.doesNotMatch(resolveFeedbackSql, /feedback_resolver_id\s*=\s*\(p_input ->> 'actor_id'\)::uuid/i);
  assert.match(sql, /'executionVersion', feedback\.version/i);
  assert.match(sql, /'status', feedback\.feedback_status[\s\S]+'resolutionNote'[\s\S]+'resolverId'/i);
});

test("manager statistics keep current totals but retain a workflow-wide feedback queue", () => {
  assert.match(statsSql, /'merchantId', v_site_id[\s\S]{0,80}'workflowId', v_workflow_id/i);
  assert.match(
    statsSql,
    /into v_execution_count, v_in_progress_count, v_completed_count,[\s\S]{0,180}v_feedback_count,[\s\S]{0,80}v_average_rating[\s\S]{0,240}revision_id = v_workflow\.current_revision_id/i,
  );
  assert.match(
    statsSql,
    /select count\(\*\)::integer into v_open_feedback_count[\s\S]{0,180}workflow_id = v_workflow_id[\s\S]{0,80}feedback_status = 'open'/i,
  );
  assert.match(statsSql, /'openFeedbackCount', v_open_feedback_count/i);
  assert.doesNotMatch(recentFeedbackSql, /revision_id\s*=\s*v_workflow\.current_revision_id/i);
  assert.match(
    recentFeedbackSql,
    /order by \(execution\.feedback_status = 'open'\) desc,\s*execution\.feedback_submitted_at desc,\s*execution\.id desc\s*limit 50/i,
  );
  assert.match(
    recentFeedbackSql,
    /order by \(feedback\.feedback_status = 'open'\) desc,\s*feedback\.feedback_submitted_at desc,\s*feedback\.id desc/i,
  );
});

test("execution tables are RPC-only and public RPC grants are service-role-only", () => {
  for (const tableName of [
    "merchant_enterprise_workflow_acknowledgements",
    "merchant_enterprise_workflow_executions",
    "merchant_enterprise_workflow_execution_steps",
    "merchant_enterprise_workflow_execution_checklist_items",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${tableName} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${tableName}[\\s\\S]{0,100}from public, anon, authenticated, service_role`, "i"));
  }
  for (const functionName of [
    "faolla_acknowledge_merchant_enterprise_workflow_v1",
    "faolla_start_merchant_enterprise_workflow_execution_v1",
    "faolla_get_merchant_enterprise_workflow_employee_state_v1",
    "faolla_get_merchant_enterprise_workflow_execution_v1",
    "faolla_update_merchant_enterprise_workflow_execution_step_v1",
    "faolla_submit_merchant_enterprise_workflow_feedback_v1",
    "faolla_resolve_merchant_enterprise_workflow_feedback_v1",
    "faolla_get_merchant_enterprise_workflow_execution_stats_v1",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${functionName}\\(jsonb\\)[\\s\\S]{0,100}from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\(jsonb\\)[\\s\\S]{0,80}to service_role`, "i"));
  }
});
