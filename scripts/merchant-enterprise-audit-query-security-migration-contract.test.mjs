import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608180032_merchant_enterprise_audit_query_security.sql",
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

test("audit query keeps caller authorization separate and ahead of reads", () => {
  const query = readFunction(
    readMigration(),
    "faolla_list_merchant_enterprise_audit_events_v1",
  );
  assert.match(
    query,
    /faolla_authorize_merchant_enterprise_automation_actor_v1\(\s*p_input,\s*'audit\.view',\s*null\s*\)/i,
  );
  const authorization = query.search(
    /perform public\.faolla_authorize_merchant_enterprise_automation_actor_v1/i,
  );
  const firstAuditRead = query.search(
    /from public\.merchant_enterprise_audit_events/i,
  );
  assert.ok(authorization >= 0 && firstAuditRead > authorization);
  assert.match(query, /p_input\s*->>\s*'filter_actor_type'/i);
  assert.match(query, /p_input\s*->>\s*'filter_actor_id'/i);
});

test("audit query applies exact actor and UTC half-open filters in one stable page scan", () => {
  const query = readFunction(
    readMigration(),
    "faolla_list_merchant_enterprise_audit_events_v1",
  );
  assert.match(query, /filter_actor_type[\s\S]+in \('owner', 'employee', 'system'\)/i);
  assert.match(query, /filter_actor_id[\s\S]+::uuid/i);
  assert.match(query, /created_from[\s\S]+at time zone 'UTC'/i);
  assert.match(query, /created_to_exclusive[\s\S]+at time zone 'UTC'/i);
  assert.match(
    query,
    /v_created_from\s*>=\s*v_created_to_exclusive[\s\S]+invalid_enterprise_audit_query/i,
  );
  for (const predicate of [
    /audit_event\.actor_type\s*=\s*v_filter_actor_type/gi,
    /audit_event\.actor_id\s*=\s*v_filter_actor_id/gi,
    /audit_event\.created_at\s*>=\s*v_created_from/gi,
    /audit_event\.created_at\s*<\s*v_created_to_exclusive/gi,
  ]) {
    assert.equal([...query.matchAll(predicate)].length, 1);
  }
  assert.equal(
    [...query.matchAll(/from public\.merchant_enterprise_audit_events/gi)].length,
    1,
    "events and the cursor must come from the same database page scan",
  );
});

test("audit query preserves microsecond keyset precision and the current event catalog", () => {
  const query = readFunction(
    readMigration(),
    "faolla_list_merchant_enterprise_audit_events_v1",
  );
  assert.match(
    query,
    /\(p_input \? 'before_created_at'\) <> \(p_input \? 'before_id'\)/i,
  );
  assert.equal(
    [
      ...query.matchAll(
        /\(audit_event\.created_at, audit_event\.id\)\s*<\s*\(v_before_created_at, v_before_id\)/gi,
      ),
    ].length,
    1,
  );
  assert.match(query, /HH24:MI:SS\.US"Z"/i);
  assert.match(
    query,
    /v_before_created_at_text\s*<>\s*v_normalized_timestamp[\s\S]+left\(v_normalized_timestamp, 23\)\s*\|\|\s*'Z'[\s\S]+invalid_enterprise_audit_cursor/i,
  );
  assert.match(query, /v_last_created_at\s*:=\s*v_events\s*->\s*-1\s*->>\s*'created_at'/i);
  assert.match(query, /v_last_id\s*:=\s*\(v_events\s*->\s*-1\s*->>\s*'id'\)::uuid/i);
  assert.match(
    query,
    /jsonb_build_object\(\s*'before_created_at', v_last_created_at,\s*'before_id', v_last_id\s*\)/i,
  );
  assert.match(query, /'automation\.failed'/i);
  assert.match(query, /'workflow\.restored'/i);
});

test("task events reject update, delete and truncate without blocking inserts", () => {
  const source = readMigration();
  const reject = readFunction(
    source,
    "faolla_reject_merchant_task_event_mutation_v1",
  );
  assert.match(reject, /raise exception 'merchant_task_events_append_only'/i);
  assert.match(
    source,
    /create trigger merchant_task_events_append_only\s+before update or delete on public\.merchant_task_events\s+for each row/i,
  );
  assert.match(source, /enable always trigger merchant_task_events_append_only/i);
  assert.match(
    source,
    /create trigger merchant_task_events_reject_truncate\s+before truncate on public\.merchant_task_events\s+for each statement/i,
  );
  assert.match(source, /enable always trigger merchant_task_events_reject_truncate/i);
  assert.doesNotMatch(source, /before\s+insert[^;]*public\.merchant_task_events/i);
  assert.doesNotMatch(source, /(?:grant|revoke)[^;]*on public\.merchant_task_events/i);
});

test("migration is additive, indexed, registered and API-schema compatible", () => {
  const source = readMigration();
  assert.match(source, /(?:^|\n)begin\s*;/i);
  assert.match(
    source,
    /merchant_enterprise_audit_query_prerequisite_missing[\s\S]+commit\s*;[\s\S]+drop index concurrently if exists\s+public\.merchant_enterprise_audit_events_actor_created_idx\s*;[\s\S]+create index concurrently\s+merchant_enterprise_audit_events_actor_created_idx[\s\S]+merchant_id, actor_type, actor_id, created_at desc, id desc[\s\S]+begin\s*;[\s\S]+create or replace function public\.faolla_reject_merchant_task_event_mutation_v1/i,
  );
  assert.doesNotMatch(
    source,
    /create index concurrently if not exists\s+merchant_enterprise_audit_events_actor_created_idx/i,
  );
  assert.match(
    source,
    /index_metadata\.indisready[\s\S]+index_metadata\.indisvalid[\s\S]+index_metadata\.indislive[\s\S]+index_metadata\.indkey\[0\][\s\S]+pg_index_column_has_property[\s\S]+merchant_enterprise_audit_actor_index_invalid/i,
  );
  assert.doesNotMatch(source, /pg_get_indexdef/i);
  assert.match(
    source,
    /values \(202608180032, 'merchant_enterprise_audit_query_security'\)/i,
  );
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.match(source, /commit;\s*$/i);
  assert.doesNotMatch(source, /drop\s+table|drop\s+column|delete\s+from/i);
  assert.doesNotMatch(
    source.replace(/before\s+truncate\s+on/gi, "before guarded-event on"),
    /\btruncate(?:\s+table)?\b/i,
  );
  assert.match(
    source,
    /revoke all on function public\.faolla_list_merchant_enterprise_audit_events_v1\(jsonb\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.match(
    source,
    /grant execute on function public\.faolla_list_merchant_enterprise_audit_events_v1\(jsonb\)\s+to service_role/i,
  );
});
