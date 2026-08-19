import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608190038_ordinary_account_recovery_observer.sql",
);
const acceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "60-ordinary-account-recovery-observer.sql",
);
const runnerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const adapterPath = path.join(
  process.cwd(),
  "src",
  "lib",
  "legacyPersonalRecoverySupabase.server.ts",
);
const recoveryPath = path.join(
  process.cwd(),
  "src",
  "lib",
  "legacyPersonalRecovery.server.ts",
);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readObserver(source) {
  const match = source.match(
    /create or replace function\s+public\.faolla_observe_ordinary_account_recovery_v1\([\s\S]+?\n\$\$;/i,
  );
  assert.ok(match, "recovery observer function is missing");
  return match[0];
}

test("038 observer returns only the exact per-target aggregate envelope", () => {
  const source = read(migrationPath);
  const observer = readObserver(source);
  const outputBuilder = observer.match(
    /select jsonb_build_object\([\s\S]+?\) into v_result;/i,
  )?.[0];
  assert.ok(outputBuilder, "observer aggregate output builder is missing");
  const outputKeys = [
    "schemaVersion",
    "merchantBindingCount",
    "systemSiteBindingCount",
    "staffBindingCount",
    "employeeBindingCount",
    "accountIdentifierCollisionCount",
    "personalAuthBindingCount",
    "personalIdBindingCount",
    "personalOtherAuthBindingCount",
    "exactCanonicalBindingCount",
  ];

  assert.match(
    observer,
    /\(\s*p_auth_user_id uuid,\s*p_personal_account_id text\s*\)/i,
  );
  assert.match(observer, /returns jsonb[\s\S]+language plpgsql[\s\S]+stable[\s\S]+security definer/i);
  assert.match(observer, /set search_path = pg_catalog, public/i);
  assert.match(observer, /p_personal_account_id !~ '\^\[0-9\]\{8\}\$'/i);
  assert.match(observer, /between 50010105 and 59999999/i);
  assert.match(observer, /from auth\.users[\s\S]+auth_user\.id = p_auth_user_id/i);
  assert.match(observer, /ordinary_account_recovery_observer_auth_user_not_found/i);
  assert.match(
    observer,
    /invariants,schemaReady[\s\S]+is distinct from 'true'::jsonb[\s\S]+invariants,aclReady[\s\S]+is distinct from 'true'::jsonb/i,
  );
  assert.match(
    observer,
    /systemSitePrincipalOverlapCount[\s\S]+is distinct from '0'::jsonb/i,
  );
  for (const nullSafeCheck of [
    /jsonb_typeof\(v_readiness\) is distinct from 'object'/gi,
    /v_readiness -> 'schemaVersion' is distinct from '1'::jsonb/gi,
    /v_readiness #> '\{invariants,schemaReady\}' is distinct from 'true'::jsonb/gi,
    /v_readiness #> '\{invariants,aclReady\}' is distinct from 'true'::jsonb/gi,
    /'\{security,systemSitePrincipalOverlapCount\}' is distinct from '0'::jsonb/gi,
  ]) {
    assert.equal(
      source.match(nullSafeCheck)?.length,
      2,
      `preflight and runtime must both use ${nullSafeCheck}`,
    );
  }
  assert.doesNotMatch(
    source,
    /(?:schemaVersion|schemaReady|aclReady|systemSitePrincipalOverlapCount)[\s\S]{0,100}(?:<>|->>|#>>)/i,
  );

  for (const key of outputKeys) {
    assert.equal(
      (outputBuilder.match(new RegExp(`'${key}'`, "g")) ?? []).length,
      1,
      `${key} must occur exactly once in the output builder`,
    );
  }
  assert.match(observer, /merchant_binding\.id <> 'site-main'/i);
  assert.match(observer, /merchant_binding\.id = 'site-main'/i);
  assert.match(observer, /staff_identity\.auth_user_id = p_auth_user_id/i);
  assert.match(observer, /employee\.auth_user_id = p_auth_user_id/i);
  assert.match(observer, /merchant\.id = p_personal_account_id/i);
  assert.match(observer, /personal_binding\.auth_user_id <> p_auth_user_id/i);
  assert.match(
    observer,
    /personal_binding\.auth_user_id = p_auth_user_id[\s\S]+personal_binding\.personal_account_id = p_personal_account_id[\s\S]+personal_binding\.status = 'active'/i,
  );
  assert.doesNotMatch(
    observer,
    /\b(?:insert into|update|delete from|truncate|alter table|drop table|grant|revoke)\b/i,
  );
  assert.doesNotMatch(
    outputBuilder,
    /jsonb_build_object\([\s\S]+?'(?:auth_user_id|personal_account_id|email|metadata)'\s*,/i,
  );
  assert.doesNotMatch(
    source,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    "the production migration must not contain a recovery UUID",
  );
});

test("038 is prerequisite-gated, retryable, and exact service-role only", () => {
  const source = read(migrationPath);
  const registry = source.lastIndexOf(
    "values (202608190038, 'ordinary_account_recovery_observer')",
  );
  const grantValidation = source.lastIndexOf(
    "ordinary_account_recovery_observer_grant_invalid",
  );

  for (const prerequisite of [
    "ordinary_account_authorization_foundation",
    "ordinary_account_authorization_bootstrap",
    "ordinary_account_system_site_principal_isolation",
  ]) {
    assert.match(source, new RegExp(`migration\\.name\\s*=\\s*['\\n ]+${prerequisite}`, "i"));
  }
  assert.match(source, /ordinary_account_recovery_observer_registry_conflict/i);
  assert.match(source, /ordinary_account_recovery_observer_registered_state_invalid/i);
  assert.match(source, /create or replace function/i);
  assert.match(source, /alter function[\s\S]+owner to current_user/i);
  assert.match(source, /pg_catalog\.aclexplode[\s\S]+from public cascade/i);
  assert.match(source, /from %I cascade/i);
  assert.match(
    source,
    /revoke all on function\s+public\.faolla_observe_ordinary_account_recovery_v1\(uuid, text\)\s+from public, anon, authenticated, service_role;/i,
  );
  assert.match(
    source,
    /grant execute on function\s+public\.faolla_observe_ordinary_account_recovery_v1\(uuid, text\)\s+to service_role;/i,
  );
  assert.doesNotMatch(source, /grant\s+[\s\S]*?on\s+(?:table\s+)?public\.(?:merchants|faolla_personal_accounts|merchant_enterprise_staff_identities|merchant_enterprise_employees)/i);
  assert.ok(grantValidation >= 0 && registry > grantValidation);
  assert.match(
    source.slice(registry),
    /notify pgrst, 'reload schema';[\s\S]+commit;\s*$/i,
  );
});

test("application recovery directory uses the observer and strictly normalizes its envelope", () => {
  const adapter = read(adapterPath);
  const recovery = read(recoveryPath);

  assert.match(adapter, /LEGACY_PERSONAL_RECOVERY_RPC_NAMES\.observer/i);
  assert.match(adapter, /p_auth_user_id:\s*authUserId/i);
  assert.match(adapter, /p_personal_account_id:\s*personalAccountId/i);
  assert.doesNotMatch(adapter, /\.from\(/i);
  assert.doesNotMatch(
    adapter,
    /merchant_enterprise_staff_identities|faolla_personal_accounts|merchant_enterprise_employees/i,
  );
  assert.match(recovery, /faolla_observe_ordinary_account_recovery_v1/i);
  assert.match(recovery, /exactRecord\(value,[\s\S]+"schemaVersion"[\s\S]+"personalOtherAuthBindingCount"/i);
  assert.match(recovery, /source\.schemaVersion !== 1/i);
  assert.match(
    recovery,
    /personalOtherAuthBindingCount >[\s\S]+personalIdBindingCount/i,
  );
  assert.match(
    recovery,
    /personalOtherAuthBindingCount !== 0[\s\S]+exactCanonicalBindingCount !== 1/i,
  );
});

test("runner and PostgreSQL acceptance cover 42501, conflicts, retry, and no PII", () => {
  const acceptance = read(acceptancePath);
  const runner = read(runnerPath);
  const packageJson = read(path.join(process.cwd(), "package.json"));

  assert.match(runner, /ordinary_account_recovery_observer\.sql/i);
  assert.match(runner, /60-ordinary-account-recovery-observer\.sql/i);
  assert.match(runner, /ordinary_account_recovery_observer_registry_conflict/i);
  assert.match(runner, /quote_all_identifiers=on/i);
  assert.match(acceptance, /permission denied for table faolla_personal_accounts/i);
  assert.match(acceptance, /permission denied for table merchant_enterprise_staff_identities/i);
  assert.match(acceptance, /count\(\*\) = 10[\s\S]+jsonb_object_keys/i);
  assert.match(acceptance, /unbound recovery observation was not the exact PII-free zero envelope/i);
  for (const message of [
    "target non-site merchant alias conflict",
    "target site-main alias conflict",
    "exact staff-registry UUID conflict",
    "exact employee and synchronized staff UUID conflict",
    "exact merchant ID namespace collision",
    "exact personal ID claimant on another Auth UUID",
    "target Auth UUID bound to another personal ID",
    "exact active canonical recovery binding",
  ]) {
    assert.match(acceptance, new RegExp(message, "i"));
  }
  assert.match(acceptance, /rollback;\s*$/i);
  assert.match(
    packageJson,
    /ordinary-account-recovery-observer-migration-contract\.test\.mjs/i,
  );
});
