import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(
    root,
    "scripts/supabase-migrations/202608310043_merchant_employee_initial_password_setup.sql",
  ),
  "utf8",
);
const integrationRunner = fs.readFileSync(
  path.join(root, "scripts/enterprise-integration/run.sh"),
  "utf8",
);
const integrationAcceptance = fs.readFileSync(
  path.join(
    root,
    "scripts/enterprise-integration/65-employee-initial-password-setup.sql",
  ),
  "utf8",
);

function functionBody(name) {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing ${name}`);
  return match[0];
}

test("initial-password setup is claimed once and acceptance fences incomplete Auth writes", () => {
  assert.match(
    source,
    /add column if not exists initial_password_policy text[\s\S]+set initial_password_policy = 'waived'[\s\S]+set default 'required'[\s\S]+set not null/i,
  );
  assert.match(
    source,
    /create table if not exists public\.merchant_employee_initial_password_setups[\s\S]+employee_id uuid primary key/i,
  );
  assert.match(
    source,
    /merchant_employee_initial_password_claim_auth_uidx[\s\S]+auth_user_id[\s\S]+where state = 'claimed'/i,
  );
  const claim = functionBody(
    "faolla_claim_merchant_employee_initial_password_setup_v1",
  );
  assert.match(claim, /merchant_enterprise_employees[\s\S]+for update/i);
  assert.match(
    claim,
    /pg_advisory_xact_lock[\s\S]+auth_user_id = v_auth_user_id[\s\S]+employee_id <> v_employee\.id[\s\S]+state = 'claimed'/i,
  );
  assert.match(
    claim,
    /password_fingerprint = v_password_fingerprint[\s\S]+set operation_id = v_operation_id[\s\S]+claim_expires_at = v_claim_expires_at[\s\S]+resumed', true/i,
  );
  assert.match(
    claim,
    /claim_expires_at <= v_now[\s\S]+password_fingerprint = v_password_fingerprint[\s\S]+resumed', false/i,
  );
  assert.match(claim, /employee_initial_password_setup_in_progress/i);

  const complete = functionBody(
    "faolla_complete_merchant_employee_initial_password_setup_v1",
  );
  assert.match(
    complete,
    /state = 'completed'[\s\S]+claim_expires_at = null[\s\S]+completed_at = v_now[\s\S]+initial_password_policy = 'completed'/i,
  );

  const accept = functionBody("faolla_accept_merchant_employee_invitation_v1");
  assert.match(
    accept,
    /merchant_employee_initial_password_setups[\s\S]+initial_password_policy = 'required'[\s\S]+not found or v_setup\.state <> 'completed'[\s\S]+employee_initial_password_setup_incomplete/i,
  );
  assert.match(
    accept,
    /faolla_accept_employee_invite_pre043/i,
  );
  assert.ok(Buffer.byteLength("faolla_accept_employee_invite_pre043", "utf8") <= 63);
  assert.match(
    source,
    /to_regprocedure\([\s\S]+faolla_bind_employee_invite_identity_pre043\(jsonb\)[\s\S]+rename to faolla_bind_employee_invite_identity_pre043/i,
  );
  assert.match(
    source,
    /to_regprocedure\([\s\S]+faolla_accept_employee_invite_pre043\(jsonb\)[\s\S]+rename to faolla_accept_employee_invite_pre043/i,
  );

  const bind = functionBody(
    "faolla_bind_merchant_employee_invitation_identity_v2",
  );
  assert.match(
    bind,
    /initial_password_policy[\s\S]+not in \('required', 'waived'\)[\s\S]+faolla_bind_employee_invite_identity_pre043[\s\S]+set initial_password_policy/i,
  );
  assert.match(
    bind,
    /setup\.invitation_version = employee\.invitation_version[\s\S]+setup\.invitation_token_hash = employee\.invitation_token_hash[\s\S]+setup\.state = 'completed'[\s\S]+then 'completed'[\s\S]+setup\.state = 'claimed'[\s\S]+then 'required'[\s\S]+else v_policy/i,
  );
  assert.match(
    bind,
    /delete from public\.merchant_employee_initial_password_setups as setup[\s\S]+employee\.initial_password_policy = 'waived'[\s\S]+setup\.state = 'claimed'[\s\S]+setup\.invitation_version is distinct from employee\.invitation_version/i,
  );
  const waive = functionBody("faolla_waive_employee_initial_password_v1");
  assert.match(
    waive,
    /invitation_version is distinct from v_invitation_version[\s\S]+invitation_token_hash is distinct from v_token_hash[\s\S]+initial_password_policy = 'waived'/i,
  );
  assert.match(
    waive,
    /invitation_version = v_invitation_version[\s\S]+invitation_token_hash = v_token_hash[\s\S]+v_setup\.state = 'completed'[\s\S]+initial_password_policy in \('required', 'completed'\)/i,
  );
});

test("password recovery grants distinguish proof issuance and consume one password fingerprint", () => {
  assert.match(
    source,
    /create table if not exists public\.auth_password_recovery_grants[\s\S]+state in \('requested', 'ready', 'claimed', 'completed'\)/i,
  );
  const activate = functionBody("faolla_activate_password_recovery_grant_v1");
  assert.match(
    activate,
    /proof_kind is null[\s\S]+proof_kind not in \('requested_intent', 'typed_recovery'\)/i,
  );
  assert.match(
    activate,
    /v_proof_kind is distinct from 'typed_recovery'[\s\S]+password_recovery_intent_invalid_or_expired/i,
  );

  const claim = functionBody("faolla_claim_password_recovery_grant_v1");
  assert.match(
    claim,
    /state = 'claimed'[\s\S]+password_fingerprint = v_password_fingerprint/i,
  );
  assert.match(claim, /password_recovery_grant_in_progress/i);
  assert.match(
    functionBody("faolla_complete_password_recovery_grant_v1"),
    /state = 'completed'[\s\S]+completed_at = statement_timestamp\(\)/i,
  );
  assert.match(
    functionBody("faolla_release_password_recovery_grant_v1"),
    /state = 'ready'[\s\S]+password_fingerprint = null[\s\S]+state = 'claimed'/i,
  );
});

test("new security tables and RPCs are service-role only and migration is registered", () => {
  for (const table of [
    "merchant_employee_initial_password_setups",
    "auth_password_recovery_grants",
  ]) {
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(
      source,
      new RegExp(`revoke all on table public\\.${table}[\\s\\S]+from public, anon, authenticated`, "i"),
    );
  }
  for (const name of [
    "faolla_claim_merchant_employee_initial_password_setup_v1",
    "faolla_complete_merchant_employee_initial_password_setup_v1",
    "faolla_release_merchant_employee_initial_password_setup_v1",
    "faolla_create_password_recovery_intent_v1",
    "faolla_activate_password_recovery_grant_v1",
    "faolla_validate_password_recovery_grant_v1",
    "faolla_claim_password_recovery_grant_v1",
    "faolla_complete_password_recovery_grant_v1",
    "faolla_release_password_recovery_grant_v1",
    "faolla_bind_merchant_employee_invitation_identity_v2",
    "faolla_waive_employee_initial_password_v1",
  ]) {
    assert.match(
      source,
      new RegExp(`grant execute on function public\\.${name}\\(jsonb\\)[\\s\\S]+to service_role`, "i"),
    );
  }
  assert.match(
    source,
    /values \(202608310043, 'merchant_employee_initial_password_setup'\)/i,
  );
  assert.match(
    integrationRunner,
    /202608310043_merchant_employee_initial_password_setup\.sql/,
  );
  assert.match(
    integrationRunner,
    /202608300042, 202608310043\)/,
  );
  assert.match(
    integrationRunner,
    /65-employee-initial-password-setup\.sql/,
  );
  assert.match(
    integrationRunner,
    /65-employee-initial-password-setup\.sql[\s\S]+run_sql_file_as_role "\$\{migration\}" supabase_admin[\s\S]+043 registered replay changed policy, audit evidence, or registry state/,
  );
});

test("real PostgreSQL acceptance covers policy states, leases, concurrency, and fail-closed proofs", () => {
  assert.match(
    integrationAcceptance,
    /pg_catalog\.to_regprocedure[\s\S]+pg_catalog\.octet_length[\s\S]+pg_catalog\.has_function_privilege/i,
  );
  assert.match(
    integrationAcceptance,
    /post-043 employees did not default to required[\s\S]+explicitly waived[\s\S]+complete did not atomically persist setup and employee policy/i,
  );
  assert.match(
    integrationAcceptance,
    /claim_expires_at[\s\S]+cross-merchant expired claim was not taken over[\s\S]+global Auth-subject claim fence retained multiple or wrong claims/i,
  );
  assert.match(
    integrationAcceptance,
    /Auth-initialized delivery retry waived an in-flight setup claim[\s\S]+in-flight setup could not complete after Auth-initialized delivery retry/i,
  );
  assert.match(
    integrationAcceptance,
    /old completed setup remains historical evidence[\s\S]+new invitation generation inherited stale completed policy[\s\S]+reinvited completed employee was not safely waived and accepted/i,
  );
  assert.match(
    integrationAcceptance,
    /new-generation waiver retained a stale global Auth-subject claim fence/i,
  );
  assert.match(
    integrationAcceptance,
    /first recovery grant claim was not new[\s\S]+claimed recovery grant was not released[\s\S]+completed recovery grant replay was not terminal/i,
  );
  assert.match(
    integrationAcceptance,
    /NULL proof_kind created a recovery grant/i,
  );
});
