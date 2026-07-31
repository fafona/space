import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202607310006_merchant_enterprise_task_comments.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readCommentFunction(source) {
  const match = source.match(
    /create or replace function public\.faolla_add_merchant_task_comment_v1\(p_input jsonb\)[\s\S]+?\$\$;/i,
  );
  assert.ok(match, "task comment function is missing");
  return match[0];
}

test("task comment migration reuses the append-only event table", () => {
  const source = readMigration();
  const comment = readCommentFunction(source);

  assert.match(comment, /security definer[\s\S]+set search_path = public/i);
  assert.match(comment, /jsonb_typeof\(p_input -> 'text'\) <> 'string'/i);
  assert.match(comment, /char_length\(v_comment_text\) > 2000/i);
  assert.match(comment, /v_actor_type not in \('owner', 'employee'\)/i);
  assert.match(comment, /insert into public\.merchant_task_events/i);
  assert.match(comment, /'commented'/i);
  assert.match(comment, /jsonb_build_object\('text', v_comment_text\)/i);
  assert.doesNotMatch(source, /create table/i);
  assert.doesNotMatch(source, /delete\s+from\s+public\.merchant_task_events/i);
});

test("task comments lock and validate the merchant-scoped active task", () => {
  const comment = readCommentFunction(readMigration());

  assert.match(
    comment,
    /from public\.merchant_tasks[\s\S]+merchant_id = v_site_id[\s\S]+id = v_task_id[\s\S]+for update/i,
  );
  assert.match(comment, /if not found then[\s\S]+raise exception 'task_not_found'/i);
  assert.match(
    comment,
    /v_task\.archived_at is not null[\s\S]+raise exception 'invalid_task_archived'/i,
  );
  assert.match(
    comment,
    /v_actor_type = 'employee'[\s\S]+merchant_enterprise_employees[\s\S]+merchant_id = v_site_id[\s\S]+id = v_actor_id::uuid[\s\S]+status = 'active'[\s\S]+for share/i,
  );
});

test("task comments are replayable through the shared task idempotency namespace", () => {
  const comment = readCommentFunction(readMigration());

  assert.match(comment, /'enterprise-task:' \|\| v_operation_id/i);
  assert.match(comment, /insert into public\.merchant_idempotency_keys/i);
  assert.match(comment, /'enterprise_task_comment_v1'/i);
  assert.match(
    comment,
    /v_existing\.operation <> 'enterprise_task_comment_v1'[\s\S]+v_existing\.request_hash <> v_request_hash/i,
  );
  assert.match(
    comment,
    /v_existing\.status = 'completed'[\s\S]+return v_existing\.response_body/i,
  );
  assert.match(comment, /'event', to_jsonb\(v_event\)/i);
  assert.match(comment, /response_body = v_response/i);
});

test("task comment RPC is service-role only and migration 006 is registered", () => {
  const source = readMigration();

  assert.match(
    source,
    /revoke all on function public\.faolla_add_merchant_task_comment_v1\(jsonb\)[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_add_merchant_task_comment_v1\(jsonb\)[\s\S]+to service_role/i,
  );
  assert.match(
    source,
    /values \(202607310006, 'merchant_enterprise_task_comments'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
});
