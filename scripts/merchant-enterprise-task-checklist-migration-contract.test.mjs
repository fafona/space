import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310008_merchant_enterprise_task_checklists.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readFunction(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${escapedName}\\s*\\(\\s*p_input jsonb\\s*\\)[\\s\\S]+?\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `${name} function is missing`);
  return match[0];
}

test("task checklist table is versioned, task-scoped and soft removable", () => {
  const source = readMigration();

  assert.match(source, /create table if not exists public\.merchant_task_checklist_items/i);
  assert.match(source, /text text not null check \(char_length\(btrim\(text\)\) between 1 and 500\)/i);
  assert.match(source, /completed_at timestamptz null/i);
  assert.match(source, /archived_at timestamptz null/i);
  assert.match(source, /version bigint not null default 1 check \(version > 0\)/i);
  assert.match(
    source,
    /foreign key \(merchant_id, task_id\)[\s\S]+references public\.merchant_tasks\(merchant_id, id\)[\s\S]+on delete cascade/i,
  );
  assert.match(
    source,
    /merchant_task_checklist_items_task_position_idx[\s\S]+merchant_id,[\s\S]+task_id,[\s\S]+position,[\s\S]+created_at,[\s\S]+id[\s\S]+where archived_at is null/i,
  );
  assert.match(
    source,
    /create trigger merchant_task_checklist_items_touch[\s\S]+faolla_touch_versioned_row\(\)/i,
  );
  assert.doesNotMatch(source, /delete\s+from\s+public\.merchant_task_checklist_items/i);
});

test("checklist creation validates text and serializes the parent task limit", () => {
  const create = readFunction(
    readMigration(),
    "faolla_create_merchant_task_checklist_item_v1",
  );

  assert.match(create, /security definer[\s\S]+set search_path = public/i);
  assert.match(create, /jsonb_typeof\(p_input -> 'text'\) <> 'string'/i);
  assert.match(create, /char_length\(v_text\) > 500/i);
  assert.match(
    create,
    /pg_advisory_xact_lock\([\s\S]+faolla-enterprise-task-checklist:/i,
  );
  assert.match(
    create,
    /from public\.merchant_tasks[\s\S]+merchant_id = v_site_id[\s\S]+id = v_task_id[\s\S]+for update/i,
  );
  assert.match(create, /v_task\.archived_at is not null[\s\S]+invalid_task_archived/i);
  assert.match(
    create,
    /from public\.merchant_task_boards[\s\S]+merchant_id = v_site_id[\s\S]+id = v_task\.board_id[\s\S]+status = 'active'[\s\S]+for share/i,
  );
  assert.match(
    create,
    /count\(\*\)::integer,[\s\S]+max\(item\.position\) \+ 1024::bigint[\s\S]+item\.archived_at is null/i,
  );
  assert.match(create, /v_active_count >= 100[\s\S]+task_checklist_limit_reached/i);
});

test("checklist updates use merchant-task-item CAS and protect archived items", () => {
  const update = readFunction(
    readMigration(),
    "faolla_update_merchant_task_checklist_item_v1",
  );

  assert.match(update, /jsonb_typeof\(p_input -> 'expected_version'\) <> 'number'/i);
  assert.match(
    update,
    /from public\.merchant_task_checklist_items[\s\S]+merchant_id = v_site_id[\s\S]+task_id = v_task_id[\s\S]+id = v_item_id[\s\S]+for update/i,
  );
  assert.match(update, /v_item\.version <> v_expected_version[\s\S]+enterprise_version_conflict/i);
  assert.match(
    update,
    /v_item\.archived_at is not null[\s\S]+p_input \? 'archived'[\s\S]+not \(p_input ->> 'archived'\)::boolean[\s\S]+not \(p_input \? 'text'\)[\s\S]+not \(p_input \? 'completed'\)[\s\S]+invalid_task_checklist_archived/i,
  );
  assert.match(
    update,
    /v_item\.archived_at is not null[\s\S]+count\(\*\)::integer[\s\S]+active_item\.archived_at is null[\s\S]+v_active_count >= 100[\s\S]+task_checklist_limit_reached/i,
  );
  assert.match(
    update,
    /where merchant_id = v_site_id[\s\S]+task_id = v_task_id[\s\S]+id = v_item_id[\s\S]+version = v_expected_version[\s\S]+returning \* into v_item/i,
  );
});

test("checklist mutations are idempotent and completion transitions are audited", () => {
  const source = readMigration();
  const create = readFunction(source, "faolla_create_merchant_task_checklist_item_v1");
  const update = readFunction(source, "faolla_update_merchant_task_checklist_item_v1");

  for (const [fn, operation] of [
    [create, "enterprise_task_checklist_create_v1"],
    [update, "enterprise_task_checklist_update_v1"],
  ]) {
    assert.match(fn, /'enterprise-task:' \|\| v_operation_id/i);
    assert.match(fn, /insert into public\.merchant_idempotency_keys/i);
    assert.match(fn, new RegExp(`'${operation}'`, "i"));
    assert.match(fn, /v_existing\.status = 'completed'[\s\S]+return v_existing\.response_body/i);
    assert.match(fn, /response_body = v_response/i);
  }

  assert.match(create, /insert into public\.merchant_task_events/i);
  assert.match(create, /'checklist_item_created'/i);
  assert.match(update, /'checklist_item_completed'/i);
  assert.match(update, /'checklist_item_reopened'/i);
  assert.match(update, /'checklist_item_archived'/i);
  assert.match(update, /'checklist_item_restored'/i);
  assert.match(update, /'checklistItemId', v_item\.id::text/i);
  assert.match(update, /'previousCompleted', v_previous_completed/i);
  assert.match(update, /'completedAt', v_item\.completed_at/i);
  assert.doesNotMatch(update, /'text',\s*(v_item\.text|p_input\s*->>\s*'text')/i);
});

test("checklist storage and RPCs are service-role only and migration 008 is registered", () => {
  const source = readMigration();

  assert.match(source, /alter table public\.merchant_task_checklist_items enable row level security/i);
  assert.match(
    source,
    /revoke all on public\.merchant_task_checklist_items from anon, authenticated/i,
  );
  assert.match(
    source,
    /grant select, insert, update on public\.merchant_task_checklist_items to service_role/i,
  );
  for (const name of [
    "faolla_create_merchant_task_checklist_item_v1",
    "faolla_update_merchant_task_checklist_item_v1",
  ]) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function public\\.${name}\\(jsonb\\)[\\s\\S]+from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function public\\.${name}\\(jsonb\\)[\\s\\S]+to service_role`,
        "i",
      ),
    );
  }
  assert.match(
    source,
    /values \(202607310008, 'merchant_enterprise_task_checklists'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
});
