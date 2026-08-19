import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608190033_merchant_enterprise_invitation_delivery_outbox.sql",
);

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8").replace(/\r\n?/g, "\n");
}

function readFunction(source, name) {
  const marker = `create or replace function\n  public.${name}(`;
  const start = source.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

function readTable(source, name) {
  const marker = `create table if not exists\n  public.${name} (`;
  const start = source.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing table ${name}`);
  const end = source.indexOf("\n  );", start);
  assert.notEqual(end, -1, `unterminated table ${name}`);
  return source.slice(start, end + 5);
}

test("033 rebuilds concurrent indexes before installing invitation behavior", () => {
  const source = readMigration();
  assert.match(
    source,
    /merchant_enterprise_invitation_delivery_prerequisite_missing[\s\S]+commit;[\s\S]+drop index concurrently if exists[\s\S]+merchant_enterprise_employees_invitation_exchange_idx[\s\S]+drop index concurrently if exists[\s\S]+merchant_outbox_enterprise_invitation_due_idx[\s\S]+drop index concurrently if exists[\s\S]+merchant_outbox_enterprise_invitation_lease_idx[\s\S]+begin;[\s\S]+create table if not exists public\.merchant_enterprise_staff_identities/i,
  );
  assert.equal(
    [...source.matchAll(/create (?:unique )?index concurrently\s+/gi)].length,
    3,
  );
  assert.match(
    source,
    /create unique index concurrently\s+merchant_enterprise_employees_invitation_exchange_idx/i,
  );
  assert.doesNotMatch(source, /create index concurrently if not exists/i);
  assert.match(
    source,
    /indisready[\s\S]+indisvalid[\s\S]+indislive[\s\S]+indisunique[\s\S]+merchant_enterprise_invitation_lease_index_invalid[\s\S]+values \(202608190033, 'merchant_enterprise_invitation_delivery_outbox'\)/i,
  );
});

test("generic outbox event has a minimal immutable non-secret seed", () => {
  const source = readMigration();
  const enqueue = readFunction(
    source,
    "faolla_enqueue_merchant_enterprise_invitation_generation_v1",
  );
  const guard = readFunction(
    source,
    "faolla_guard_merchant_enterprise_invitation_outbox_v1",
  );
  assert.match(enqueue, /'enterprise\.employee_invitation\.deliver'/i);
  assert.match(
    enqueue,
    /'payload', jsonb_build_object\(\s*'schema_version', 1,\s*'invitation_version', p_employee\.invitation_version,\s*'hmac_key_id', p_hmac_key_id\s*\)/i,
  );
  assert.doesNotMatch(
    enqueue,
    /'email'|'token_hash'|'action_link'|'redirect_to'/i,
  );
  assert.match(
    guard,
    /new\.payload is distinct from old\.payload[\s\S]+event_seed_immutable/i,
  );
  assert.match(
    guard,
    /array\['hmac_key_id', 'invitation_version', 'schema_version'\]/i,
  );
  assert.match(guard, /new\.last_error is distinct from new\.last_error_code/i);
  assert.match(
    source,
    /create trigger merchant_enterprise_invitation_outbox_guard[\s\S]+before insert or update or delete[\s\S]+enable always trigger merchant_enterprise_invitation_outbox_guard/i,
  );
  assert.doesNotMatch(source, /create table[^;]*invitation[^;]*(?:queue|outbox)/i);
});

test("create and schedule are atomic, reauthorize cached replies, and survive key rotation", () => {
  const source = readMigration();
  const create = readFunction(
    source,
    "faolla_create_merchant_enterprise_employee_invitation_v2",
  );
  const schedule = readFunction(
    source,
    "faolla_schedule_merchant_employee_invitation_delivery_v2",
  );
  for (const fn of [create, schedule]) {
    const hashAssignment = fn.slice(
      fn.indexOf("v_request_hash :="),
      fn.indexOf("v_claim :="),
    );
    assert.doesNotMatch(hashAssignment, /hmac_key_id/i);
    assert.match(fn, /faolla_claim_enterprise_structure_operation_v1/i);
    assert.match(fn, /faolla_complete_enterprise_structure_operation_v1/i);
  }
  assert.match(create, /faolla_create_merchant_enterprise_employee_v1\(p_input\)/i);
  assert.match(create, /interval '7 days'/i);
  assert.match(
    create,
    /faolla_authorize_merchant_enterprise_employee_actor_v1\([\s\S]+v_cache[\s\S]+payload ->> 'invitation_version'/i,
  );
  assert.ok(
    schedule.indexOf("faolla_authorize_merchant_enterprise_employee_actor_v1") <
      schedule.indexOf("faolla_claim_enterprise_structure_operation_v1"),
  );
  assert.match(schedule, /employee_invitation_renew_required/i);
  assert.match(
    schedule,
    /v_action = 'resend'[\s\S]+invitation_revoked_at is not null[\s\S]+invitation_expires_at > statement_timestamp\(\)[\s\S]+employee_invitation_renew_required[\s\S]+select \* into v_event/i,
  );
  assert.match(schedule, /employee_invitation_renew_not_required/i);
  assert.match(schedule, /'enterprise-invitation-owner'/i);
  assert.match(schedule, /'enterprise-invitation-employee'/i);
  assert.doesNotMatch(
    schedule,
    /merchant_outbox_replays[\s\S]+left\(lower\(btrim\(p_input ->> 'actor_id'\)\)/i,
  );
  assert.match(
    schedule,
    /v_event_found := found[\s\S]+if v_action = 'renew'[\s\S]+if v_event_found[\s\S]+employee_invitation_renew_not_required[\s\S]+elsif not v_event_found[\s\S]+employee_invitation_renew_required/i,
  );
  assert.doesNotMatch(schedule, /invitation_delivery_key_mismatch/i);
  assert.match(schedule, /interval '7 days'/i);
});

test("worker flow stores only a digest and binds an exact global staff identity", () => {
  const source = readMigration();
  const prepare = readFunction(
    source,
    "faolla_prepare_merchant_employee_invitation_delivery_v1",
  );
  const lookup = readFunction(
    source,
    "faolla_lookup_merchant_enterprise_staff_identity_v1",
  );
  const bind = readFunction(
    source,
    "faolla_bind_merchant_employee_invitation_identity_v2",
  );
  const complete = readFunction(
    source,
    "faolla_complete_merchant_employee_invitation_delivery_v1",
  );
  const fail = readFunction(
    source,
    "faolla_fail_merchant_employee_invitation_delivery_v1",
  );
  assert.match(prepare, /set invitation_token_hash = v_token_hash/i);
  assert.match(prepare, /employee[\s\S]+for update[\s\S]+outbox_events[\s\S]+for update/i);
  assert.match(lookup, /from auth\.users/i);
  assert.match(lookup, /principal_type'[\s\S]+'merchant_staff'/i);
  assert.match(lookup, /merchant_staff_email_hash/i);
  assert.match(bind, /merchant_enterprise_staff_identity_conflict/i);
  assert.match(bind, /from auth\.users/i);
  assert.match(bind, /merchant_staff_email_hash/i);
  assert.match(bind, /faolla_bind_merchant_employee_auth_user_v1/i);
  assert.match(complete, /'status', 'sent'/i);
  assert.match(complete, /'already_completed', true/i);
  assert.match(fail, /v_error_code,\s*v_error_code/i);
  assert.match(fail, /'already_failed', true/i);
  assert.match(
    fail,
    /coalesce\(v_result ->> 'status', ''\) not in \([\s\S]+retry_scheduled[\s\S]+dead_lettered[\s\S]+invitation_delivery_lease_lost/i,
  );
  assert.doesNotMatch(fail, /p_input\s*->>\s*'error_message'/i);
});

test("legacy terminal operations cancel jobs and staff registry is append-only", () => {
  const source = readMigration();
  const cancel = readFunction(
    source,
    "faolla_cancel_merchant_enterprise_invitation_outbox_v1",
  );
  assert.match(cancel, /'removed'/i);
  assert.match(cancel, /'accepted'/i);
  assert.match(cancel, /'revoked'/i);
  assert.match(cancel, /'superseded'/i);
  assert.match(
    cancel,
    /delete from public\.merchant_enterprise_invitation_exchange_issuances[\s\S]+auth_user_id = v_auth_user_id[\s\S]+merchant_id = v_merchant_id[\s\S]+employee_id = v_employee_id[\s\S]+invitation_version = v_max_generation/i,
  );
  assert.match(
    source,
    /create trigger merchant_enterprise_invitation_cancel_outbox[\s\S]+after update or delete[\s\S]+enable always trigger merchant_enterprise_invitation_cancel_outbox/i,
  );
  assert.match(
    source,
    /create trigger merchant_enterprise_staff_identities_immutable[\s\S]+before update or delete[\s\S]+enable always trigger merchant_enterprise_staff_identities_immutable/i,
  );
});

test("exchange uses a caller attempt and full Auth-link TTL issuance lease", () => {
  const source = readMigration();
  const begin = readFunction(
    source,
    "faolla_begin_merchant_employee_invitation_exchange_v1",
  );
  const mark = readFunction(
    source,
    "faolla_mark_merchant_employee_invitation_exchange_issued_v1",
  );
  const release = readFunction(
    source,
    "faolla_release_merchant_employee_invitation_exchange_v1",
  );
  const recheck = readFunction(
    source,
    "faolla_recheck_merchant_employee_invitation_exchange_v1",
  );
  assert.match(begin, /p_input ->> 'attempt_id'/i);
  assert.match(begin, /p_input ->> 'issuance_lease_seconds'/i);
  assert.match(begin, /v_lease_seconds < 60 or v_lease_seconds > 86400/i);
  assert.match(begin, /v_attempt_id_text !~[\s\S]+-4\[0-9a-f\]\{3\}-\[89ab\]/i);
  assert.match(begin, /'duplicate_attempt'/i);
  assert.match(begin, /pg_advisory_xact_lock\(hashtextextended\(/i);
  assert.match(begin, /attempt_count = least[\s\S]+6/i);
  assert.match(begin, /attempt_count = least[\s\S]+21/i);
  assert.match(mark, /set state = 'issued'/i);
  assert.match(release, /and state = 'claimed'/i);
  assert.doesNotMatch(release, /state = 'issued'/i);
  assert.match(recheck, /issuance\.state = 'issued'/i);
  assert.match(recheck, /issuance\.issuance_id = v_issuance_id/i);

  for (const tableName of [
    "merchant_enterprise_invitation_exchange_rate_buckets",
    "merchant_enterprise_invitation_exchange_issuances",
  ]) {
    const table = readTable(source, tableName);
    assert.doesNotMatch(table, /\bemail\b|token_hash|action_link|redirect_to/i);
  }
});

test("outbox health recognizes the invitation handler without changing its ACL", () => {
  const source = readMigration();
  const health = readFunction(
    source,
    "faolla_get_merchant_outbox_health_v1",
  );
  assert.match(
    health,
    /p_merchant_id text default null,\s*p_window_hours integer default 24/i,
  );
  assert.match(health, /language plpgsql\s+stable\s+security definer/i);
  for (const eventType of [
    "merchant.notification.deliver",
    "google.reviews.sync",
    "asset.convert",
    "site.publish.follow_up",
    "backup.create",
    "webhook.deliver",
    "enterprise.workflow_automation.process",
    "enterprise.employee_invitation.deliver",
  ]) {
    assert.match(health, new RegExp(`'${eventType.replaceAll(".", "\\.")}'`, "i"));
  }
  assert.match(health, /'unknown_event_type_count'/i);
});

test("all new callable surfaces are service-role only and V1 names stay intact", () => {
  const source = readMigration();
  for (const name of [
    "faolla_create_merchant_enterprise_employee_invitation_v2",
    "faolla_schedule_merchant_employee_invitation_delivery_v2",
    "faolla_prepare_merchant_employee_invitation_delivery_v1",
    "faolla_lookup_merchant_enterprise_staff_identity_v1",
    "faolla_bind_merchant_employee_invitation_identity_v2",
    "faolla_complete_merchant_employee_invitation_delivery_v1",
    "faolla_fail_merchant_employee_invitation_delivery_v1",
    "faolla_begin_merchant_employee_invitation_exchange_v1",
    "faolla_mark_merchant_employee_invitation_exchange_issued_v1",
    "faolla_release_merchant_employee_invitation_exchange_v1",
    "faolla_recheck_merchant_employee_invitation_exchange_v1",
    "faolla_get_merchant_outbox_health_v1",
  ]) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function\\s+public\\.${name}\\([^;]+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function\\s+public\\.${name}\\([^;]+to service_role`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(
    source,
    /alter function public\.faolla_(?:create|reserve|revoke|remove|accept|bind)_merchant[^;]+rename/i,
  );
  assert.doesNotMatch(source, /drop\s+(?:table|column|function)\b/i);
  assert.match(source, /notify pgrst, 'reload schema';\s*commit;\s*$/i);
  const registry = source.indexOf("insert into public.faolla_schema_migrations");
  const recheck = source.indexOf(
    "public.faolla_recheck_merchant_employee_invitation_exchange_v1(",
  );
  assert.ok(recheck >= 0 && recheck < registry);
  assert.equal(source.slice(source.lastIndexOf("commit;") + 7).trim(), "");
});
