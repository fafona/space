import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310002_merchant_enterprise_board_workflows.sql",
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

test("board workflow migration adds a stable merchant-scoped board position", () => {
  const source = readMigration();
  assert.match(
    source,
    /alter table public\.merchant_task_boards[\s\S]+add column if not exists position integer/i,
  );
  assert.match(
    source,
    /row_number\(\) over \(\s*partition by merchant_id\s*order by created_at,\s*id\s*\) - 1 as stable_position/i,
  );
  assert.match(
    source,
    /alter column position set default 0,[\s\S]+alter column position set not null/i,
  );
  assert.match(
    source,
    /merchant_task_boards_position_nonnegative[\s\S]+check \(position >= 0\)/i,
  );
  assert.match(
    source,
    /create unique index if not exists merchant_task_boards_position_unique_idx[\s\S]+on public\.merchant_task_boards\(merchant_id, position\)[\s\S]+where status = 'active'/i,
  );
});

test("board workflow migration exposes the complete transactional RPC contract", () => {
  const source = readMigration();
  [
    "faolla_bootstrap_merchant_enterprise_v2",
    "faolla_create_merchant_task_board_v1",
    "faolla_update_merchant_task_board_v1",
    "faolla_create_merchant_task_column_v1",
    "faolla_update_merchant_task_column_v1",
  ].forEach((name) => {
    const body = readFunction(source, name);
    assert.match(body, /returns jsonb/i);
    assert.match(body, /language plpgsql/i);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path = public/i);
    assert.match(
      body,
      /pg_advisory_xact_lock\(\s*hashtextextended\('faolla-enterprise-structure:' \|\| v_site_id,\s*0\)\s*\)/i,
    );
  });

  const boardCreate = readFunction(
    source,
    "faolla_create_merchant_task_board_v1",
  );
  assert.match(boardCreate, /'board', to_jsonb\(v_board\) - 'system_key'/i);
  assert.match(boardCreate, /'columns', v_columns/i);

  const boardUpdate = readFunction(
    source,
    "faolla_update_merchant_task_board_v1",
  );
  assert.match(boardUpdate, /'board', to_jsonb\(v_board\) - 'system_key'/i);

  const columnCreate = readFunction(
    source,
    "faolla_create_merchant_task_column_v1",
  );
  assert.match(columnCreate, /'column', to_jsonb\(v_column\) - 'system_key'/i);

  const columnUpdate = readFunction(
    source,
    "faolla_update_merchant_task_column_v1",
  );
  assert.match(columnUpdate, /'column', to_jsonb\(v_column\) - 'system_key'/i);
});

test("bootstrap and structure creates are conflict-safe and replayable", () => {
  const source = readMigration();
  const claim = readFunction(
    source,
    "faolla_claim_enterprise_structure_operation_v1",
  );
  const complete = readFunction(
    source,
    "faolla_complete_enterprise_structure_operation_v1",
  );

  assert.match(claim, /insert into public\.merchant_idempotency_keys/i);
  assert.match(
    claim,
    /on conflict \(merchant_id, idempotency_key\) do nothing/i,
  );
  assert.match(claim, /v_existing\.operation <> p_operation/i);
  assert.match(claim, /v_existing\.request_hash <> p_request_hash/i);
  assert.match(claim, /enterprise_idempotency_conflict/i);
  assert.match(claim, /v_existing\.response_body/i);
  assert.match(complete, /response_body = p_response/i);

  assert.match(source, /'enterprise-bootstrap-v2:' \|\| v_operation_id/i);
  assert.match(source, /'enterprise-board-create:' \|\| v_operation_id/i);
  assert.match(source, /'enterprise-board-update:' \|\| v_operation_id/i);
  assert.match(source, /'enterprise-column-create:' \|\| v_operation_id/i);
  assert.match(source, /'enterprise-column-update:' \|\| v_operation_id/i);
  assert.match(source, /v_request_hash := md5\(p_input::text\)/i);

  const bootstrap = readFunction(
    source,
    "faolla_bootstrap_merchant_enterprise_v2",
  );
  assert.match(
    bootstrap,
    /on conflict \(merchant_id, system_key\) do nothing/i,
  );
  assert.match(
    bootstrap,
    /on conflict \(merchant_id, board_id, system_key\) do nothing/i,
  );
  assert.match(bootstrap, /'roles', v_roles/i);
  assert.match(bootstrap, /'columns', v_columns/i);
});

test("board and column writes enforce CAS, capacity and active-structure invariants", () => {
  const source = readMigration();
  const boardUpdate = readFunction(
    source,
    "faolla_update_merchant_task_board_v1",
  );
  const columnUpdate = readFunction(
    source,
    "faolla_update_merchant_task_column_v1",
  );
  const boardCreate = readFunction(
    source,
    "faolla_create_merchant_task_board_v1",
  );
  const columnCreate = readFunction(
    source,
    "faolla_create_merchant_task_column_v1",
  );

  assert.match(
    boardUpdate,
    /merchant_id = v_site_id[\s\S]+id = v_board_id[\s\S]+version = v_expected_version[\s\S]+for update/i,
  );
  assert.match(
    columnUpdate,
    /merchant_id = v_site_id[\s\S]+board_id = v_board_id[\s\S]+id = v_column_id[\s\S]+version = v_expected_version[\s\S]+for update/i,
  );
  assert.match(boardUpdate, /enterprise_version_conflict/i);
  assert.match(columnUpdate, /enterprise_version_conflict/i);

  assert.match(boardCreate, /v_active_board_count >= 50/i);
  assert.match(boardCreate, /board_limit_reached/i);
  assert.match(boardUpdate, /v_active_count >= 50/i);
  assert.match(columnCreate, /v_active_column_count >= 30/i);
  assert.match(columnCreate, /column_limit_reached/i);
  assert.match(columnUpdate, /v_active_count >= 30/i);

  assert.match(boardUpdate, /archived_at is null[\s\S]+board_in_use/i);
  assert.match(boardUpdate, /v_active_count <= 1[\s\S]+last_active_board/i);
  assert.match(
    boardUpdate,
    /board_has_no_active_columns/i,
  );
  assert.match(
    columnUpdate,
    /column_id = v_column_id[\s\S]+archived_at is null[\s\S]+column_in_use/i,
  );
  assert.match(
    columnUpdate,
    /v_active_count <= 1[\s\S]+last_active_column/i,
  );
  assert.match(columnUpdate, /v_board\.status <> 'active'[\s\S]+inactive_board/i);

  assert.match(source, /char_length\(v_name\) > 120/i);
  assert.match(source, /char_length\(v_name\) > 80/i);
  assert.match(source, /\^#\[0-9A-Fa-f\]\{6\}\$/i);
  assert.match(source, /> 1000000/i);
});

test("position changes are performed as locked set rewrites without physical deletion", () => {
  const source = readMigration();
  const boardReposition = readFunction(
    source,
    "faolla_reposition_merchant_task_board_v1",
  );
  const columnReposition = readFunction(
    source,
    "faolla_reposition_merchant_task_column_v1",
  );

  assert.match(boardReposition, /set position = \(position::bigint \+ v_offset\)::integer/i);
  assert.match(boardReposition, /with other_boards as/i);
  assert.match(boardReposition, /desired_positions as/i);
  assert.match(columnReposition, /set position = \(position::bigint \+ v_offset\)::integer/i);
  assert.match(columnReposition, /with other_columns as/i);
  assert.match(columnReposition, /desired_positions as/i);

  assert.doesNotMatch(
    source,
    /\bdelete\s+from\s+public\.merchant_(?:task_boards|task_columns|tasks)\b/i,
  );
  assert.doesNotMatch(source, /\bdrop\s+(?:table|column)\b/i);
});

test("task trigger rejects active tasks in archived structures and shares archive locks", () => {
  const source = readMigration();
  const guard = readFunction(
    source,
    "faolla_guard_active_merchant_task_structure_v1",
  );

  assert.match(guard, /if new\.archived_at is not null then[\s\S]+return new/i);
  assert.match(
    guard,
    /from public\.merchant_task_boards[\s\S]+merchant_id = new\.merchant_id[\s\S]+id = new\.board_id[\s\S]+for share/i,
  );
  assert.match(guard, /v_board_status <> 'active'[\s\S]+invalid_task_board/i);
  assert.match(
    guard,
    /from public\.merchant_task_columns[\s\S]+merchant_id = new\.merchant_id[\s\S]+board_id = new\.board_id[\s\S]+id = new\.column_id[\s\S]+for share/i,
  );
  assert.match(guard, /v_column_status <> 'active'[\s\S]+invalid_task_column/i);
  assert.match(
    source,
    /create trigger merchant_tasks_active_structure_guard[\s\S]+before insert or update on public\.merchant_tasks[\s\S]+faolla_guard_active_merchant_task_structure_v1\(\)/i,
  );

  const boardUpdate = readFunction(
    source,
    "faolla_update_merchant_task_board_v1",
  );
  const columnUpdate = readFunction(
    source,
    "faolla_update_merchant_task_column_v1",
  );
  assert.match(boardUpdate, /from public\.merchant_task_boards[\s\S]+for update/i);
  assert.match(columnUpdate, /from public\.merchant_task_columns[\s\S]+for update/i);
});

test("workflow RPCs are service-role only and the migration is registered", () => {
  const source = readMigration();
  [
    "faolla_bootstrap_merchant_enterprise_v2",
    "faolla_create_merchant_task_board_v1",
    "faolla_update_merchant_task_board_v1",
    "faolla_create_merchant_task_column_v1",
    "faolla_update_merchant_task_column_v1",
  ].forEach((name) => {
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
  });

  assert.match(source, /^\s*begin\s*;/i);
  assert.match(
    source,
    /insert into public\.faolla_schema_migrations \(version, name\)[\s\S]+values \(202607310002, 'merchant_enterprise_board_workflows'\)/i,
  );
  assert.match(source, /commit;\s*$/i);
});
