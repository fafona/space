import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationDirectory = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
);
const bootstrapPath = path.join(
  migrationDirectory,
  "202608190036_ordinary_account_authorization_bootstrap.sql",
);
const cutoverPath = path.join(
  migrationDirectory,
  "202608190037_ordinary_account_authorization_cutover.sql",
);
const runnerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const bootstrapAcceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "55-ordinary-account-authorization-bootstrap.sql",
);
const cutoverAcceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "55-ordinary-account-authorization-cutover.sql",
);
const raceSetupPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "56-ordinary-account-lock-race-setup.sql",
);
const raceWorkerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "57-ordinary-account-lock-race-worker.sql",
);
const racePostPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "58-ordinary-account-lock-race-post.sql",
);
const packagePath = path.join(process.cwd(), "package.json");
const cutoverExists = fs.existsSync(cutoverPath);
const cutoverAcceptanceExists = fs.existsSync(cutoverAcceptancePath);

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readFunction(source, name) {
  const expression = new RegExp(
    `create or replace function\\s+public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`,
    "i",
  );
  const match = source.match(expression);
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test("036 is a service-only create/bootstrap layer with no generic binding", () => {
  const source = read(bootstrapPath);
  const create = readFunction(
    source,
    "faolla_create_ordinary_account_authorization_v1",
  );
  const bootstrap = readFunction(
    source,
    "faolla_bootstrap_ordinary_account_authorization_v1",
  );
  const readiness = readFunction(
    source,
    "faolla_get_ordinary_account_authoritative_cutover_readiness_v1",
  );
  const staffGuard = readFunction(
    source,
    "faolla_guard_staff_identity_ordinary_exclusion_v1",
  );
  const authDeleteGuard = readFunction(
    source,
    "faolla_guard_auth_user_ordinary_account_delete_v1",
  );
  const resolver = readFunction(
    source,
    "faolla_resolve_ordinary_account_authorization_v1",
  );

  assert.doesNotMatch(source, /create policy|drop policy/i);
  assert.doesNotMatch(source, /revoke insert|revoke update/i);
  assert.doesNotMatch(
    source,
    /create or replace function\s+public\.faolla_is_merchant_owner/i,
  );
  assert.match(source, /version = 202608190035/i);
  assert.match(source, /volatile[\s\S]+security definer[\s\S]+set search_path = pg_catalog, public/i);
  assert.match(
    source,
    /drop function if exists\s+public\.faolla_bind_ordinary_account_authorization_v1\(uuid, text, text\)/i,
  );

  for (const signature of [
    "faolla_resolve_ordinary_account_authorization_v1\\(uuid\\)",
    "faolla_get_ordinary_account_authorization_readiness_v1\\(\\)",
    "faolla_create_ordinary_account_authorization_v1\\(uuid, text, text\\)",
    "faolla_bootstrap_ordinary_account_authorization_v1\\(uuid, text\\)",
    "faolla_get_ordinary_account_authoritative_cutover_readiness_v1\\(\\)",
  ]) {
    assert.match(
      source,
      new RegExp(
        `revoke all on function\\s+public\\.${signature}\\s+from public, anon, authenticated, service_role`,
        "i",
      ),
    );
    assert.match(
      source,
      new RegExp(
        `grant execute on function\\s+public\\.${signature}\\s+to service_role`,
        "i",
      ),
    );
  }

  assert.match(create, /from auth\.users[\s\S]+auth_user\.id = p_auth_user_id[\s\S]+for key share/i);
  assert.match(create, /merchant_enterprise_staff_identities[\s\S]+ordinary_account_staff_identity_forbidden/i);
  assert.match(create, /faolla_resolve_ordinary_account_authorization_v1/i);
  assert.match(create, /ordinary_account_principal_type_conflict/i);
  assert.match(create, /count\(distinct merchant_alias\.alias_id\)/i);
  assert.match(create, /count\(merchant_alias\.alias_id\)/i);
  assert.match(create, /v_alias_count <> 1[\s\S]+v_alias_value_count <> 7/i);
  assert.match(create, /alias_id is distinct from p_auth_user_id/i);
  assert.match(create, /ordinary_account_identifier_collision/i);
  assert.match(create, /ordinary_account_personal_disabled/i);
  assert.match(create, /invalid_ordinary_personal_id/i);
  assert.match(create, /v_account_id::bigint not between 50010105 and 59999999/i);
  assert.match(create, /ordinary_account_system_site_forbidden/i);
  assert.doesNotMatch(create, /update public\.(?:merchants|faolla_personal_accounts)/i);
  assert.match(
    create,
    /if found then[\s\S]+ordinary_account_binding_conflict[\s\S]+else[\s\S]+insert into public\.merchants/i,
  );
  assert.match(create, /insert into public\.faolla_personal_accounts/i);
  assert.match(create, /insert into public\.merchants[\s\S]+created_by_user_id[\s\S]+p_auth_user_id/i);
  assert.doesNotMatch(create, /auth\.jwt|raw_app_meta_data|raw_user_meta_data/i);
  assert.doesNotMatch(
    create,
    /where[\s\S]{0,160}(?:merchant\.)?(?:email|owner_email|contact_email|user_email)\s*=/i,
  );

  assert.match(bootstrap, /ordinary_account_personal_disabled/i);
  assert.match(
    bootstrap,
    /from auth\.users[\s\S]+auth_user\.id = p_auth_user_id[\s\S]+for key share/i,
  );
  assert.doesNotMatch(bootstrap, /status\s*=\s*'active'|version\s*=\s*personal_account\.version/i);
  assert.match(
    bootstrap,
    /faolla_create_ordinary_account_authorization_v1/i,
  );

  assert.match(readiness, /alias_value_count = 7[\s\S]+alias_count = 1/i);
  assert.match(readiness, /canonicalOrphanCount/i);
  assert.match(readiness, /crossAccountTypeOverlapCount/i);
  assert.match(readiness, /accountIdentifierCollisionCount/i);
  assert.match(readiness, /staffRegistryOverlapCount/i);
  assert.match(readiness, /systemSitePrincipalOverlapCount/i);
  assert.match(readiness, /system_site_principals[\s\S]+ordinary_merchant_alias_principals/i);
  assert.match(
    readiness,
    /merchant_enterprise_staff_identities[\s\S]+as system_staff_identity/i,
  );
  assert.match(readiness, /schemaReady[\s\S]+aclReady/i);
  assert.match(readiness, /merchant\.id <> v_system_site_id/i);
  assert.match(
    readiness,
    /personal_account\.personal_account_id::bigint[\s\S]+not between 50010105 and 59999999/i,
  );
  assert.doesNotMatch(
    readiness,
    /auth\.jwt|auth_user\.email|merchant\.(?:email|owner_email|contact_email|user_email)|raw_app_meta_data|raw_user_meta_data/i,
  );

  assert.match(bootstrap, /v_candidate := 50010105/i);
  assert.match(bootstrap, /v_candidate > 59999999/i);
  assert.match(bootstrap, /v_candidate := 10000000/i);
  assert.match(bootstrap, /v_candidate > 99999999/i);
  assert.match(bootstrap, /between 50010105 and 59999999[\s\S]+60000000/i);
  assert.match(bootstrap, /merchant-id-rules/i);
  assert.match(resolver, /v_system_site_id constant text := 'site-main'/i);
  assert.match(resolver, /ordinary_account_system_site_forbidden/i);
  assert.match(resolver, /merchant\.id <> v_system_site_id/i);
  assert.match(
    resolver,
    /v_personal_account_id::bigint not between 50010105 and 59999999[\s\S]+ordinary_account_personal_binding_conflict/i,
  );
  assert.match(bootstrap, /when 'exact'[\s\S]+when 'range'[\s\S]+when 'pattern'/i);
  assert.match(bootstrap, /into v_block_end[\s\S]+v_block_end is not null/i);
  assert.match(
    bootstrap,
    /v_candidate := greatest\(v_candidate \+ 1, v_block_end \+ 1\)/i,
  );
  assert.match(
    bootstrap,
    /not exists \([\s\S]+from public\.merchants[\s\S]+not exists \([\s\S]+from public\.faolla_personal_accounts/i,
  );
  for (const ordinaryWriter of [create, bootstrap]) {
    const authLock = ordinaryWriter.toLowerCase().indexOf("for key share");
    const advisory = ordinaryWriter.toLowerCase().indexOf("pg_advisory_xact_lock");
    const tableLock = ordinaryWriter.toLowerCase().indexOf("lock table");
    const tableLockEnd = ordinaryWriter.indexOf(";", tableLock);
    const tableLockClause = ordinaryWriter.slice(tableLock, tableLockEnd + 1);
    assert.ok(authLock >= 0 && advisory > authLock && tableLock > advisory);
    assert.match(
      tableLockClause,
      /faolla_personal_accounts[\s\S]+merchants[\s\S]+share row exclusive/i,
    );
    assert.doesNotMatch(
      tableLockClause,
      /merchant_enterprise_staff_identities/i,
    );
  }

  assert.match(
    staffGuard,
    /pg_advisory_xact_lock[\s\S]+lock table[\s\S]+faolla_personal_accounts[\s\S]+merchants[\s\S]+merchant_enterprise_staff_identity_conflict/i,
  );
  assert.match(staffGuard, /merchant\.id <> 'site-main'/i);
  assert.doesNotMatch(staffGuard, /lock table[\s\S]+merchant_enterprise_staff_identities/i);
  assert.doesNotMatch(staffGuard, /from auth\.users|for key share/i);
  assert.match(
    authDeleteGuard,
    /pg_advisory_xact_lock[\s\S]+lock table[\s\S]+faolla_personal_accounts[\s\S]+merchants[\s\S]+ordinary_account_auth_user_delete_forbidden/i,
  );
  assert.match(authDeleteGuard, /merchant\.id <> 'site-main'/i);
  assert.match(
    source,
    /create trigger merchant_enterprise_staff_ordinary_exclusion[\s\S]+before insert[\s\S]+enable always trigger merchant_enterprise_staff_ordinary_exclusion/i,
  );
  assert.match(
    source,
    /create trigger faolla_auth_users_ordinary_delete_guard[\s\S]+before delete on auth\.users[\s\S]+enable always trigger faolla_auth_users_ordinary_delete_guard/i,
  );
  assert.match(
    source,
    /alter function public\.faolla_guard_personal_account_binding_v1\(\)[\s\S]+set search_path = pg_catalog, public/i,
  );
  assert.match(readiness, /pg_catalog\.pg_index[\s\S]+indkey::smallint\[\]/i);
  assert.match(readiness, /relkind = 'r'[\s\S]+relpersistence = 'p'/i);
  assert.match(readiness, /indpred is null[\s\S]+indexprs is null/i);
  assert.match(readiness, /pg_catalog\.pg_opclass[\s\S]+opcdefault/i);
  assert.match(readiness, /indcollation::oid\[\]/i);
  assert.match(readiness, /indoption::smallint\[\]/i);
  assert.match(readiness, /pg_get_constraintdef/i);
  assert.match(readiness, /pg_get_expr/i);
  assert.match(
    readiness,
    /tgfoid[\s\S]+tgenabled = 'A'[\s\S]+tgtype[\s\S]+tgnargs = 0[\s\S]+tgqual is null/i,
  );
  assert.match(source, /pg_catalog\.aclexplode[\s\S]+pg_catalog\.acldefault/i);
  assert.match(source, /alter table public\.faolla_personal_accounts[\s\S]+owner to current_user/i);
  assert.match(
    source,
    /revoke all privileges on table public\.faolla_personal_accounts[\s\S]+cascade/i,
  );
  assert.match(readiness, /personal_acl_table\.relacl/i);
  assert.match(readiness, /pg_catalog\.acldefault[\s\S]+except/i);
  assert.match(readiness, /personal_column_acl\.grantee[\s\S]+personal_acl_table\.relowner/i);
  assert.match(
    source,
    /revoke all privileges \(%s\) on table public\.faolla_personal_accounts[\s\S]+cascade/i,
  );
  assert.match(source, /revoke all on function %s from %I cascade/i);
  assert.match(source, /owner to current_user/i);
  assert.match(readiness, /proowner <> current_user::regrole/i);
  assert.match(
    readiness,
    /function_metadata\.proconfig is distinct from[\s\S]+search_path=pg_catalog, public/i,
  );
  assert.match(readiness, /not function_acl\.is_grantable/i);
  assert.match(
    source,
    /faolla_get_ordinary_account_authorization_readiness_v1\(\)[\s\S]+owner to current_user/i,
  );
  assert.match(
    source,
    /faolla_guard_personal_account_binding_v1\(\)[\s\S]+owner to current_user/i,
  );
  assert.ok(
    source.indexOf("ordinary_account_bootstrap_registry_conflict") <
      source.toLowerCase().indexOf("drop function if exists"),
  );
  assert.match(
    source,
    /values \(202608190036, 'ordinary_account_authorization_bootstrap'\)[\s\S]+notify pgrst, 'reload schema'[\s\S]+commit;\s*$/i,
  );
});

test("037 hard-gates readiness before replacing any authorization behavior", { skip: !cutoverExists }, () => {
  const source = read(cutoverPath);
  const readinessGate = source.indexOf(
    "ordinary_account_authorization_not_ready_for_cutover",
  );
  const ownerReplacement = source.toLowerCase().indexOf(
    "create or replace function public.faolla_is_merchant_owner",
  );
  const firstPolicyDrop = source.toLowerCase().indexOf("drop policy");

  assert.match(source, /version = 202608190035/i);
  assert.match(source, /version = 202608190036/i);
  assert.match(source, /relation_metadata\.relrowsecurity/i);
  assert.match(source, /ordinary_account_rls_cutover_rls_not_enabled/i);
  assert.match(
    source,
    /faolla_get_ordinary_account_authoritative_cutover_readiness_v1\(\)/i,
  );
  assert.doesNotMatch(
    source,
    /faolla_get_ordinary_account_authorization_readiness_v1\(\)/i,
  );
  assert.match(source, /readyForCutover[\s\S]+::boolean is not true/i);
  assert.match(
    source,
    /lock table[\s\S]+auth\.users[\s\S]+merchant_enterprise_staff_identities[\s\S]+faolla_personal_accounts[\s\S]+merchants[\s\S]+share row exclusive/i,
  );
  assert.ok(readinessGate >= 0);
  assert.ok(ownerReplacement > readinessGate);
  assert.ok(firstPolicyDrop > readinessGate);
  assert.ok(
    source.indexOf("ordinary_account_rls_cutover_registry_conflict") <
      ownerReplacement,
  );
  assert.ok(
    source.indexOf("ordinary_account_rls_cutover_policy_allowlist_invalid") <
      ownerReplacement,
  );
  assert.doesNotMatch(
    source.slice(0, readinessGate),
    /create or replace function public\.faolla_is_merchant_owner|drop policy|revoke insert|revoke update/i,
  );
});

test("037 requires exact pre/post policy catalogs and exact anonymous home reads", { skip: !cutoverExists }, () => {
  const source = read(cutoverPath);
  const behaviorStart = source.toLowerCase().indexOf(
    "create or replace function public.faolla_is_merchant_owner",
  );
  const preflight = source.slice(0, behaviorStart);
  const postflight = source.slice(behaviorStart);

  for (const fragment of [preflight, postflight]) {
    assert.match(fragment, /from pg_catalog\.pg_policies/i);
    assert.match(fragment, /actual_policy[\s\S]+expected_policy/i);
    assert.match(fragment, /except[\s\S]+union all[\s\S]+except/i);
    assert.match(fragment, /policy\.permissive::text/i);
    assert.match(fragment, /policy\.roles::text/i);
    assert.match(fragment, /policy\.cmd::text/i);
    assert.match(fragment, /pages_public_home_read/i);
    assert.match(fragment, /pages_public_site_home_read/i);
    assert.match(
      fragment,
      /merchant_idisnullandslug=''home''::text/i,
    );
    assert.match(
      fragment,
      /merchant_idisnotnullandslug=''home''::text/i,
    );
  }

  for (const table of [
    "merchants",
    "pages",
    "merchant_customers",
    "merchant_orders",
    "merchant_order_items",
    "merchant_order_events",
    "merchant_account_ledger",
    "merchant_bookings",
    "merchant_booking_events",
    "merchant_coupons",
    "merchant_coupon_claims",
    "merchant_coupon_redemptions",
    "merchant_coupon_events",
  ]) {
    assert.match(preflight, new RegExp(`'${table}'`, "i"));
    assert.match(postflight, new RegExp(`'${table}'`, "i"));
  }
});

test("037 merchant ownership is UUID-only, conflict-safe, and staff-denying", { skip: !cutoverExists }, () => {
  const source = read(cutoverPath);
  const owner = readFunction(source, "faolla_is_merchant_owner");

  assert.match(owner, /auth\.uid\(\)/i);
  assert.match(owner, /from auth\.users/i);
  assert.match(owner, /count\(distinct merchant_alias\.alias_id\)[\s\S]+alias_count = 1/i);
  assert.match(owner, /count\(merchant_alias\.alias_id\)[\s\S]+alias_value_count = 7/i);
  assert.match(owner, /merchant\.id ~ '\^\[0-9\]\{8\}\$'/i);
  assert.match(owner, /merchant\.id <> 'site-main'/i);
  assert.match(
    owner,
    /system_site\.id = 'site-main'[\s\S]+system_alias\.auth_user_id = principal\.auth_user_id/i,
  );
  assert.match(owner, /not exists[\s\S]+merchant_enterprise_staff_identities/i);
  for (const alias of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(owner, new RegExp(`merchant\\.${alias}`, "i"));
  }
  assert.doesNotMatch(
    owner,
    /auth\.jwt|merchant\.email|owner_email|contact_email|user_email|raw_app_meta_data|raw_user_meta_data/i,
  );
  assert.match(
    source,
    /revoke all on function public\.faolla_is_merchant_owner\(text\)[\s\S]+from public, anon, authenticated, service_role[\s\S]+grant execute[\s\S]+to authenticated/i,
  );
  assert.match(source, /alter function public\.faolla_is_merchant_owner\(text\)[\s\S]+owner to current_user/i);
  assert.match(source, /pg_catalog\.aclexplode[\s\S]+pg_catalog\.acldefault/i);
  assert.match(source, /faolla_is_merchant_owner\(text\) from %I cascade/i);
  assert.match(
    source,
    /proowner = current_user::regrole[\s\S]+function_metadata\.proconfig is not distinct from[\s\S]+search_path=pg_catalog, public/i,
  );
  assert.match(source, /v_owner_acl_exact/i);
  assert.match(source, /not function_acl\.is_grantable/i);
  assert.match(source, /ordinary_account_rls_cutover_table_acl_invalid/i);
  assert.match(source, /table_metadata\.relacl[\s\S]+pg_catalog\.aclexplode/i);
  assert.match(source, /column_acl\.grantee/i);
  assert.match(source, /pre_expected_table_acl[\s\S]+post_expected_table_acl/i);
  assert.match(source, /v_pre_table_acl_state[\s\S]+v_post_table_acl_state/i);
  assert.match(
    source,
    /grant select, insert, update, delete on table public\.%I to service_role/i,
  );
  assert.match(source, /actual_table_acl[\s\S]+expected_table_acl[\s\S]+acl_drift/i);
});

test("037 closes direct merchant writes and rewrites every owner RLS policy", { skip: !cutoverExists }, () => {
  const source = read(cutoverPath);

  assert.match(
    source,
    /revoke insert, update on table public\.merchants[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(source, /drop policy if exists merchants_insert_self/i);
  assert.match(source, /drop policy if exists merchants_update_own/i);
  assert.match(
    source,
    /create policy merchants_select_own[\s\S]+faolla_is_merchant_owner\(id\)/i,
  );

  for (const policy of [
    "pages_owner_read",
    "pages_owner_insert",
    "pages_owner_update",
    "pages_owner_delete",
    "merchant_customers_owner_read",
    "merchant_orders_owner_read",
    "merchant_order_items_owner_read",
    "merchant_order_events_owner_read",
    "merchant_account_ledger_owner_read",
    "merchant_bookings_owner_read",
    "merchant_booking_events_owner_read",
    "merchant_coupons_owner_read",
    "merchant_coupon_claims_owner_read",
    "merchant_coupon_redemptions_owner_read",
    "merchant_coupon_events_owner_read",
  ]) {
    assert.match(
      source,
      new RegExp(
        `create policy ${policy}[\\s\\S]+?faolla_is_merchant_owner`,
        "i",
      ),
    );
  }

  assert.doesNotMatch(source, /drop policy if exists pages_public_home_read/i);
  assert.doesNotMatch(
    source,
    /drop policy if exists pages_public_site_home_read/i,
  );
  assert.doesNotMatch(
    source,
    /create or replace function\s+public\.faolla_(?:bind|create|bootstrap)_ordinary_account_authorization_v1/i,
  );
  assert.match(
    source,
    /values \(202608190037, 'ordinary_account_authorization_cutover'\)[\s\S]+notify pgrst, 'reload schema'[\s\S]+commit;\s*$/i,
  );
});

test("runner and real PostgreSQL acceptance cover independently staged migrations", () => {
  const runner = read(runnerPath);
  const bootstrapAcceptance = read(bootstrapAcceptancePath);
  const cutoverAcceptance = cutoverAcceptanceExists
    ? read(cutoverAcceptancePath)
    : "";
  const raceSetup = read(raceSetupPath);
  const raceWorker = read(raceWorkerPath);
  const racePost = read(racePostPath);
  const packageSource = read(packagePath);

  assert.match(runner, /ordinary_account_authorization_\*\.sql/i);
  assert.match(runner, /expected_enterprise_migration_count=31/i);
  assert.match(runner, /expected_enterprise_migration_count=32/i);
  assert.match(runner, /expected_registry_count=36/i);
  assert.match(runner, /expected_registry_count=37/i);
  assert.match(runner, /cutover_present=0/i);
  assert.match(runner, /202608190036/i);
  assert.match(runner, /202608190037/i);
  assert.match(runner, /ordinary_account_bootstrap_registry_conflict/i);
  assert.match(runner, /ordinary_account_rls_cutover_registry_conflict/i);
  assert.match(runner, /ordinary_account_rls_cutover_policy_allowlist_invalid/i);
  assert.match(runner, /ordinary_account_rls_cutover_public_page_policy_invalid/i);
  assert.match(runner, /ordinary_account_rls_cutover_table_acl_invalid/i);
  assert.match(runner, /shadow_ready[\s\S]+authoritative_ready/i);
  assert.match(runner, /redteam_custom_api/i);
  assert.match(runner, /redteam_custom_child/i);
  assert.match(runner, /with grant option/i);
  assert.match(runner, /faolla_personal_accounts to redteam_custom_api with grant option/i);
  assert.match(runner, /update\(personal_account_id\)[\s\S]+redteam_custom_child/i);
  assert.match(runner, /readiness accepted a custom canonical-table grant chain/i);
  assert.match(runner, /rejecting a custom protected-table ACL/i);
  assert.match(runner, /rejecting an extra known-role table privilege/i);
  assert.match(runner, /grant truncate on table public\.merchants to authenticated/i);
  assert.match(runner, /quote_all_identifiers guard search_path/i);
  assert.match(runner, /semantically different quoted search_path/i);
  assert.match(runner, /same-named fake identity schema objects/i);
  assert.match(
    runner,
    /establishing the serial enterprise fixtures before the identity hardening stage[\s\S]+10-serial-acceptance\.sql[\s\S]+validating the 035 shadow contract before 036 narrows positive authorization[\s\S]+54-ordinary-account-authorization\.sql/i,
  );
  assert.match(runner, /ordinary_staff_race_conflict/i);
  assert.match(runner, /ordinary_auth_delete_race_conflict/i);
  assert.match(runner, /ordinary_bound_delete_race_conflict/i);
  assert.match(runner, /ordinary_system_site_race_conflict/i);
  assert.match(runner, /run_both_fail system-site-exclusion/i);
  assert.match(runner, /202607250005_coupon_shadow_write_rpc\.sql/i);
  assert.match(runner, /run_pre_cutover_acceptance/i);
  assert.match(
    runner,
    /55-ordinary-account-authorization-bootstrap\.sql/i,
  );
  assert.match(
    runner,
    /run_sql_file "\$\{SCRIPT_DIR\}\/55-ordinary-account-authorization-cutover\.sql"/i,
  );
  assert.match(runner, /56-ordinary-account-lock-race-setup\.sql/i);
  assert.match(runner, /57-ordinary-account-lock-race-worker\.sql/i);
  assert.match(runner, /58-ordinary-account-lock-race-post\.sql/i);

  assert.match(bootstrapAcceptance, /faolla_bootstrap_ordinary_account_authorization_v1/i);
  assert.match(bootstrapAcceptance, /faolla_create_ordinary_account_authorization_v1/i);
  assert.match(bootstrapAcceptance, /ordinary_account_personal_disabled/i);
  assert.match(bootstrapAcceptance, /disabled create\/bootstrap changed status or version/i);
  assert.match(bootstrapAcceptance, /50010105/i);
  assert.match(bootstrapAcceptance, /59999999/i);
  assert.match(bootstrapAcceptance, /50010104/i);
  assert.match(bootstrapAcceptance, /60000000/i);
  assert.match(bootstrapAcceptance, /invalid_ordinary_personal_id/i);
  assert.match(bootstrapAcceptance, /ordinary_account_system_site_forbidden/i);
  assert.match(bootstrapAcceptance, /systemSitePrincipalOverlapCount/i);
  assert.match(bootstrapAcceptance, /legacy system\/staff overlap/i);
  assert.match(bootstrapAcceptance, /ordinary Auth-delete guard treated site-main/i);
  assert.match(bootstrapAcceptance, /invalidCanonicalCount/i);
  assert.match(bootstrapAcceptance, /ordinary_account_auth_user_delete_forbidden/i);
  assert.match(bootstrapAcceptance, /merchant_enterprise_staff_identity_conflict/i);
  assert.match(bootstrapAcceptance, /not exists \([\s\S]+version = 202608190037/i);
  assert.match(bootstrapAcceptance, /rollback;\s*$/i);
  assert.match(raceSetup, /bound-delete-race/i);
  assert.match(raceWorker, /lock_timeout = '5s'/i);
  assert.match(raceWorker, /statement_timeout = '15s'/i);
  assert.match(raceWorker, /ordinary_staff_race_conflict/i);
  assert.match(raceWorker, /ordinary_auth_delete_race_conflict/i);
  assert.match(raceWorker, /ordinary_bound_delete_race_conflict/i);
  assert.match(raceWorker, /ordinary_system_site_race_conflict/i);
  assert.match(racePost, /staff\/ordinary race did not commit exactly one/i);
  assert.match(racePost, /left an orphan or phantom binding/i);
  assert.match(racePost, /deleted a bound principal/i);
  assert.match(racePost, /systemSitePrincipalOverlapCount/i);
  assert.match(racePost, /concurrent system-site writers/i);
  if (cutoverExists) {
    assert.ok(cutoverAcceptanceExists, "037 requires its real-PG cutover acceptance file");
    assert.match(cutoverAcceptance, /existing unbound, partial, or foreign target/i);
    assert.match(cutoverAcceptance, /existing multi-alias target/i);
    assert.match(cutoverAcceptance, /reverse staff guard persisted an ordinary\/staff overlap/i);
    assert.match(cutoverAcceptance, /legacy employee staff-sync trigger bypassed/i);
    assert.match(cutoverAcceptance, /Auth delete guard blocked pure staff/i);
    assert.match(cutoverAcceptance, /pg_catalog\.aclexplode/i);
    assert.match(cutoverAcceptance, /not function_acl\.is_grantable/i);
    assert.match(cutoverAcceptance, /post-cutover policy catalog differs from the exact allowlist/i);
    assert.match(
      cutoverAcceptance,
      /to_regprocedure\([\s\S]+faolla_bind_ordinary_account_authorization_v1/i,
    );
    assert.match(cutoverAcceptance, /site-main principal was exposed/i);
    assert.match(cutoverAcceptance, /protected table owner or exact direct ACL allowlist drifted/i);
    assert.match(cutoverAcceptance, /set role authenticated/i);
    assert.match(cutoverAcceptance, /set role anon/i);
    assert.match(cutoverAcceptance, /permission denied for table merchants/i);
    assert.match(cutoverAcceptance, /merchant_orders/i);
    assert.match(cutoverAcceptance, /merchant_coupon_events/i);
    assert.match(cutoverAcceptance, /rollback;\s*$/i);
  } else {
    assert.equal(cutoverAcceptanceExists, false);
  }

  assert.match(
    packageSource,
    /"test:db-migrations":\s*"[^"]*ordinary-account-authorization-cutover-migration-contract\.test\.mjs/i,
  );
  assert.match(
    packageSource,
    /"test":\s*"npm run test:db-migrations/i,
  );
});
