import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "scripts",
  "supabase-migrations",
  "202608190035_ordinary_account_authorization_foundation.sql",
);
const integrationRunnerPath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "run.sh",
);
const integrationAcceptancePath = path.join(
  process.cwd(),
  "scripts",
  "enterprise-integration",
  "54-ordinary-account-authorization.sql",
);
const jsTrimEscapeSequence = String.raw`\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF`;

function readMigration() {
  return fs.readFileSync(migrationPath, "utf8");
}

function readSourceTree(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return [readSourceTree(target)];
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
      return [fs.readFileSync(target, "utf8")];
    })
    .join("\n");
}

function readFunction(source, name) {
  const marker = `create or replace function\n  public.${name}(`;
  const start = source.toLowerCase().indexOf(marker);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return source.slice(start, end + 4);
}

test("personal bindings are canonical one-to-one safe text without an eight-digit restriction", () => {
  const source = readMigration();
  const tableStart = source.indexOf(
    "create table if not exists public.faolla_personal_accounts",
  );
  const tableEnd = source.indexOf("\n);", tableStart);
  const table = source.slice(tableStart, tableEnd + 3);

  assert.match(table, /auth_user_id uuid not null/i);
  assert.match(table, /personal_account_id text not null/i);
  assert.match(table, /status text not null default 'active'/i);
  assert.match(table, /check \(status in \('active', 'disabled'\)\)/i);
  assert.match(table, /version bigint not null default 1/i);
  assert.match(table, /check \(version >= 1\)/i);
  assert.match(table, /updated_at timestamptz not null default now\(\)/i);
  assert.match(table, /check \(updated_at >= created_at\)/i);
  assert.match(
    table,
    /personal_account_id = btrim\([\s\S]+personal_account_id,[\s\S]+U&'/i,
  );
  assert.ok(table.includes(jsTrimEscapeSequence));
  assert.match(table, /char_length\(personal_account_id\) between 1 and 128/i);
  assert.match(table, /octet_length\(personal_account_id\) <= 512/i);
  assert.match(table, /personal_account_id !~ '\[\[:cntrl:\]\]'/i);
  assert.match(table, /personal_account_id !~ U&'\[\\007F-\\009F\]'/i);
  assert.doesNotMatch(table, /\[0-9\].*\{8\}|\\d\{8\}/i);
  assert.match(
    source,
    /create unique index concurrently\s+faolla_personal_accounts_auth_user_id_uidx[\s\S]+\(auth_user_id\)/i,
  );
  assert.match(
    source,
    /create unique index concurrently\s+faolla_personal_accounts_personal_account_id_uidx[\s\S]+\(personal_account_id\)/i,
  );
  const guard = readFunction(
    source,
    "faolla_guard_personal_account_binding_v1",
  );
  assert.match(guard, /tg_op = 'DELETE'[\s\S]+personal_account_binding_delete_forbidden/i);
  assert.match(
    guard,
    /new\.auth_user_id is distinct from old\.auth_user_id[\s\S]+new\.personal_account_id is distinct from old\.personal_account_id[\s\S]+new\.created_at is distinct from old\.created_at[\s\S]+personal_account_binding_identity_immutable/i,
  );
  assert.match(
    guard,
    /new\.status is not distinct from old\.status[\s\S]+new\.version <> old\.version \+ 1[\s\S]+greatest\(statement_timestamp\(\), old\.updated_at\)/i,
  );
  assert.match(
    source,
    /before update or delete on public\.faolla_personal_accounts[\s\S]+enable always trigger faolla_personal_accounts_binding_guard/i,
  );
});

test("resolver authorizes only positive UUID or canonical personal bindings and preserves one-to-many merchants", () => {
  const resolver = readFunction(
    readMigration(),
    "faolla_resolve_ordinary_account_authorization_v1",
  );

  assert.match(resolver, /from auth\.users as auth_user[\s\S]+auth_user\.id = p_auth_user_id/i);
  assert.match(
    resolver,
    /from public\.merchant_enterprise_staff_identities as staff_identity[\s\S]+ordinary_account_staff_identity_forbidden/i,
  );
  for (const alias of [
    "user_id",
    "auth_user_id",
    "owner_user_id",
    "owner_id",
    "auth_id",
    "created_by",
    "created_by_user_id",
  ]) {
    assert.match(resolver, new RegExp(`merchant\\.${alias}`, "i"));
  }
  assert.match(
    resolver,
    /count\(distinct alias_id\)[\s\S]+<> 1[\s\S]+ordinary_account_merchant_binding_conflict/i,
  );
  assert.match(
    resolver,
    /array_agg\(merchant\.id order by merchant\.id\)/i,
  );
  assert.match(
    resolver,
    /from public\.faolla_personal_accounts as personal_account[\s\S]+personal_account\.auth_user_id = p_auth_user_id/i,
  );
  assert.match(
    resolver,
    /personal_account\.personal_account_id, personal_account\.status[\s\S]+when v_personal_status = 'active' then 'resolved'[\s\S]+else 'disabled'/i,
  );
  assert.match(resolver, /ordinary_account_principal_type_conflict/i);
  assert.doesNotMatch(
    resolver,
    /merchant\.email|owner_email|contact_email|user_email|raw_app_meta_data|raw_user_meta_data/i,
  );
});

test("readiness reports aggregate merchant, personal metadata, and staff-overlap gates", () => {
  const source = readMigration();
  const readiness = readFunction(
    source,
    "faolla_get_ordinary_account_authorization_readiness_v1",
  );

  assert.match(source, /\('auth', 'users', 'email'\)/i);
  assert.match(source, /\('auth', 'users', 'raw_app_meta_data'\)/i);
  assert.match(source, /\('auth', 'users', 'raw_user_meta_data'\)/i);
  assert.match(readiness, /security definer/i);
  assert.ok(readiness.includes(jsTrimEscapeSequence));
  assert.match(readiness, /alias_count > 1[\s\S]+alias_conflict_count/i);
  assert.match(readiness, /alias_count = 0 and has_email_alias/i);
  assert.match(readiness, /alias_count = 1 and not auth_user_exists/i);
  assert.match(readiness, /having count\(\*\) > 1[\s\S]+duplicate_id_group_count/i);
  assert.match(
    readiness,
    /jsonb_typeof\(entry\.value\) = 'string'[\s\S]+auth_metadata_string_values/i,
  );
  assert.match(
    readiness,
    /legacy_type_candidate in \('merchant', 'personal'\)[\s\S]+legacy_personal_hint[\s\S]+legacy_platform_merchant_hint/i,
  );
  assert.match(
    readiness,
    /user_metadata ->> 'account_id'[\s\S]+user_metadata ->> 'personal_id'[\s\S]+user_metadata ->> 'merchant_id'[\s\S]+user_metadata ->> 'login_id'[\s\S]+app_metadata ->> 'account_id'/i,
  );
  assert.match(
    readiness,
    /translate\([\s\S]+legacy_account_id_candidate[\s\S]+js_trim_chars[\s\S]+''/i,
  );
  assert.match(
    readiness,
    /merchant_metadata_without_positive[\s\S]+merchant_email_without_positive[\s\S]+merchant_legacy_without_positive/i,
  );
  assert.match(
    readiness,
    /lower\(btrim\([\s\S]+merchant\.email,[\s\S]+auth_metadata\.js_trim_chars[\s\S]+merchant\.owner_email,[\s\S]+auth_metadata\.js_trim_chars[\s\S]+merchant\.contact_email,[\s\S]+auth_metadata\.js_trim_chars[\s\S]+merchant\.user_email,[\s\S]+auth_metadata\.js_trim_chars/i,
  );
  assert.match(
    readiness,
    /metadata_type_conflict[\s\S]+metadata_type_conflict_count/i,
  );
  assert.match(
    readiness,
    /merchant\.id = personal_account\.personal_account_id[\s\S]+accountIdentifierCollisionCount/i,
  );
  assert.match(
    readiness,
    /app_account_type is distinct from[\s\S]+user_account_type[\s\S]+app_personal_id is distinct from[\s\S]+user_personal_id/i,
  );
  for (const personalIdAlias of ["app_personal_id", "user_personal_id"]) {
    assert.match(
      readiness,
      new RegExp(
        `nullif\\(translate\\(coalesce\\([\\s\\S]+?\\),\\s*auth_metadata\\.js_trim_chars,\\s*''\\),\\s*''\\)\\s+as\\s+${personalIdAlias}`,
        "i",
      ),
    );
  }
  assert.match(
    readiness,
    /join public\.merchant_enterprise_staff_identities as staff_identity[\s\S]+'staffRegistryOverlapCount'/i,
  );
  assert.doesNotMatch(readiness, /regexp_replace|\[\[:space:\]\]/i);
  assert.doesNotMatch(
    readiness,
    /btrim\(\s*(?:merchant|auth_user|auth_metadata|type_alias|id_alias|metadata)\.[a-z_]+\s*\)/i,
  );
  assert.match(readiness, /id_alias\.value ~ U&'\[\\007F-\\009F\]'/i);
  for (const aggregateKey of [
    "aliasConflictCount",
    "emailOnlyCount",
    "orphanBindingCount",
    "duplicateMetadataIdGroupCount",
    "metadataDivergenceCount",
    "metadataTypeConflictCount",
    "canonicalActiveBindingCount",
    "canonicalDisabledBindingCount",
    "canonicalOrphanCount",
    "metadataWithoutPositiveBindingAuthUserCount",
    "emailWithoutPositiveBindingAuthUserCount",
    "legacyWithoutPositiveBindingAuthUserCount",
    "accountIdentifierCollisionCount",
    "staffRegistryOverlapCount",
  ]) {
    assert.match(readiness, new RegExp(`'${aggregateKey}'`, "i"));
  }
  assert.doesNotMatch(
    readiness,
    /'authUserId'|'auth_user_id'|'email'|'merchantIds'|'personalAccountId'/i,
  );
});

test("shadow schema and both RPCs are isolated from browser roles", () => {
  const source = readMigration();
  assert.match(source, /alter table public\.faolla_personal_accounts enable row level security/i);
  assert.match(
    source,
    /revoke all on table public\.faolla_personal_accounts\s+from public, anon, authenticated, service_role/i,
  );
  for (const signature of [
    "faolla_resolve_ordinary_account_authorization_v1\\(uuid\\)",
    "faolla_get_ordinary_account_authorization_readiness_v1\\(\\)",
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
});

test("migration is retryable, validates readiness, and registers only at the end", () => {
  const source = readMigration();
  const registration = source.indexOf(
    "values (202608190035, 'ordinary_account_authorization_foundation')",
  );
  const readinessValidation = source.lastIndexOf(
    "ordinary_account_authorization_readiness_invalid",
  );

  assert.match(
    source,
    /commit\s*;[\s\S]+drop index concurrently if exists[\s\S]+create unique index concurrently/i,
  );
  assert.doesNotMatch(source, /create unique index concurrently if not exists/i);
  assert.match(source, /set local quote_all_identifiers = off/i);
  assert.match(
    source,
    /index_metadata\.indisready[\s\S]+index_metadata\.indisvalid[\s\S]+index_metadata\.indislive[\s\S]+index_metadata\.indisunique/i,
  );
  assert.ok(readinessValidation >= 0);
  assert.ok(registration > readinessValidation);
  assert.match(source, /notify pgrst, 'reload schema'[\s\S]+commit;\s*$/i);
});

test("stage one is additive and does not mutate current identities or policies", () => {
  const source = readMigration();
  assert.doesNotMatch(source, /alter table public\.merchants/i);
  assert.doesNotMatch(source, /create policy|drop policy/i);
  assert.doesNotMatch(
    source,
    /insert into auth\.users|update auth\.users|update public\.merchants|delete from public\.merchants|insert into public\.faolla_personal_accounts/i,
  );
  assert.doesNotMatch(source, /faolla_is_merchant_owner/i);
});

test("stage one has no application route consumer", () => {
  const applicationSource = readSourceTree(
    path.join(process.cwd(), "src", "app"),
  );
  assert.doesNotMatch(
    applicationSource,
    /ordinaryAccountAuthorization|faolla_resolve_ordinary_account_authorization_v1|faolla_get_ordinary_account_authorization_readiness_v1/,
  );
});

test("disposable PostgreSQL acceptance and package suites register stage one", () => {
  const runner = fs.readFileSync(integrationRunnerPath, "utf8");
  const acceptance = fs.readFileSync(integrationAcceptancePath, "utf8");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  );

  assert.match(runner, /Expected 30 enterprise\/identity migrations/i);
  assert.match(runner, /202608190035[\s\S]+quote_all_identifiers=on/i);
  assert.match(runner, /Expected 34 applied prerequisite\/enterprise\/identity versions/i);
  assert.match(
    runner,
    /run_sql_file "\$\{SCRIPT_DIR\}\/54-ordinary-account-authorization\.sql"/i,
  );
  assert.match(acceptance, /begin;[\s\S]+rollback;\s*$/i);
  assert.match(acceptance, /personal alpha-01/i);
  assert.match(acceptance, /personal-disabled[\s\S]+"status":"disabled"/i);
  assert.match(
    acceptance,
    /personal-cross', 'disabled'[\s\S]+ordinary_account_principal_type_conflict/i,
  );
  assert.match(acceptance, /personal_account_binding_identity_immutable/i);
  assert.match(acceptance, /ordinary_account_staff_identity_forbidden/i);
  assert.match(acceptance, /aliasConflictCount/i);
  assert.match(acceptance, /metadataDivergenceCount/i);
  assert.match(acceptance, /metadataTypeConflictCount/i);
  assert.match(acceptance, /metadataWithoutPositiveBindingAuthUserCount/i);
  assert.match(acceptance, /emailWithoutPositiveBindingAuthUserCount/i);
  assert.match(acceptance, /legacyWithoutPositiveBindingAuthUserCount/i);
  assert.match(acceptance, /accountIdentifierCollisionCount/i);
  assert.match(
    acceptance,
    /"account_type":"merchant"[\s\S]+"personal_id":"personal-type-conflict"/i,
  );
  assert.match(acceptance, /"account_type":"personal","account_id":42/i);
  assert.match(acceptance, /\\00A0Multi-Owner@Example\.Test\\00A0/i);
  assert.match(acceptance, /E'\\t18000001\\t'/i);
  assert.match(acceptance, /E'\\tpersonal\\t'/i);
  assert.match(acceptance, /\\00A0edge-personal-id\\00A0/i);
  assert.match(acceptance, /unsafe\\0085id/i);
  assert.match(
    acceptance,
    /personal-orphan[\s\S]+canonicalOrphanCount[\s\S]+\+ 1/i,
  );
  assert.match(acceptance, /staffRegistryOverlapCount/i);
  assert.match(
    packageJson.scripts["test:db-migrations"],
    /ordinary-account-authorization-migration-contract\.test\.mjs/,
  );
  assert.match(
    packageJson.scripts["test:auth"],
    /ordinaryAccountAuthorization\.server\.test\.ts/,
  );
});
