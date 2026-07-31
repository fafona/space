import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310005_merchant_enterprise_task_reordering.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readFunction(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${escapedName}\\(p_input jsonb\\)[\\s\\S]+?\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `${name} function is missing`);
  return match[0];
}

test("task move RPC validates the versioned zero-based move contract", () => {
  const source = readMigration();
  const move = readFunction(source, "faolla_move_merchant_task_v1");

  assert.match(move, /security definer[\s\S]+set search_path = public/i);
  assert.match(move, /p_input ->> 'merchant_id'/i);
  assert.match(move, /p_input ->> 'task_id'/i);
  assert.match(move, /p_input ->> 'target_column_id'/i);
  assert.match(move, /not \(p_input \? 'expected_version'\)/i);
  assert.match(move, /jsonb_typeof\(p_input -> 'expected_version'\) <> 'number'/i);
  assert.match(move, /p_input ->> 'expected_version'\) !~ '\^\[1-9\]\[0-9\]\*\$'/i);
  assert.match(move, /not \(p_input \? 'target_index'\)/i);
  assert.match(move, /jsonb_typeof\(p_input -> 'target_index'\) <> 'number'/i);
  assert.match(move, /p_input ->> 'target_index'\) !~ '\^\(0\|\[1-9\]\[0-9\]\*\)\$'/i);
  assert.match(move, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(move, /least\(v_requested_target_index, v_target_task_count\)/i);
});

test("task move RPC serializes and locks a stable active source and target order", () => {
  const source = readMigration();
  const move = readFunction(source, "faolla_move_merchant_task_v1");

  assert.match(
    move,
    /pg_advisory_xact_lock\([\s\S]+faolla-enterprise-task-order:/i,
  );
  assert.match(
    move,
    /from public\.merchant_tasks[\s\S]+version = v_expected_version[\s\S]+for update/i,
  );
  assert.match(move, /v_task\.archived_at is not null[\s\S]+invalid_task_archived/i);
  assert.match(
    move,
    /column_id in \(v_source_column_id, v_target_column_id\)[\s\S]+order by column_id, position, created_at, id[\s\S]+for update/i,
  );
  assert.match(
    move,
    /order by task\.position, task\.created_at, task\.id/i,
  );
  assert.match(move, /task\.archived_at is null/i);
});

test("task move RPC atomically compacts both columns with bigint 1024 spacing", () => {
  const source = readMigration();
  const move = readFunction(source, "faolla_move_merchant_task_v1");

  assert.match(move, /with target_tasks as \(/i);
  assert.match(move, /source_tasks as \(/i);
  assert.match(move, /desired_positions as \(/i);
  assert.match(move, /update public\.merchant_tasks as task/i);
  assert.match(move, /set column_id = desired\.column_id/i);
  assert.match(
    move,
    /position = desired\.target_order::bigint \* 1024::bigint/i,
  );
  assert.match(move, /row_number\(\) over \([\s\S]+\) - 1 as source_index/i);
  assert.doesNotMatch(move, /\bdelete\s+from\s+public\.merchant_tasks\b/i);
});

test("task move RPC derives completion from the target column without resetting done time", () => {
  const source = readMigration();
  const move = readFunction(source, "faolla_move_merchant_task_v1");

  assert.match(
    move,
    /from public\.merchant_task_columns[\s\S]+id = v_target_column_id[\s\S]+status = 'active'[\s\S]+for share/i,
  );
  assert.match(
    move,
    /completed_at = case[\s\S]+task\.id <> v_task_id then task\.completed_at[\s\S]+when v_target_is_done then coalesce\(task\.completed_at, now\(\)\)[\s\S]+else null/i,
  );
});

test("task move RPC is replayable, audited and service-role only", () => {
  const source = readMigration();
  const move = readFunction(source, "faolla_move_merchant_task_v1");

  assert.match(move, /'enterprise-task:' \|\| v_operation_id/i);
  assert.match(move, /insert into public\.merchant_idempotency_keys/i);
  assert.match(move, /'enterprise_task_move_v1'/i);
  assert.match(move, /v_existing\.status = 'completed'[\s\S]+return v_existing\.response_body/i);
  assert.match(move, /insert into public\.merchant_task_events/i);
  assert.match(move, /'moved'/i);
  assert.match(move, /'task', to_jsonb\(v_task\)[\s\S]+'assignee_ids', v_assignee_ids/i);
  assert.match(move, /response_body = v_response/i);
  assert.match(
    source,
    /revoke all on function public\.faolla_move_merchant_task_v1\(jsonb\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_move_merchant_task_v1\(jsonb\)[\s\S]+to service_role/i,
  );
  assert.match(
    source,
    /values \(202607310005, 'merchant_enterprise_task_reordering'\)/i,
  );
});
