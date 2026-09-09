import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedDisposablePostgresServerAddress } from "../ci-postgres-service-identity.mjs";
import { PRODUCTION_MAINTENANCE_QUIET_SQL, PRODUCTION_MAINTENANCE_ACL_SQL } from "../production-maintenance-control.mjs";

const DATABASE = "faolla_pages_acl_test";
const MIGRATION = "202609090048_pages_client_write_acl.sql";

/** Deliberately CI-only: no URL, host, port, credential, binary or CLI override. */
export function resolvePagesAclIntegrationConfig(environment, args = []) {
  if (args.length !== 0 || environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true" ||
      environment.PAGES_ACL_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
    throw new Error("pages_acl_disposable_ci_database_required");
  }
  return {
    database: DATABASE,
    serverAddress: expectedDisposablePostgresServerAddress(environment, "5432", "56471"),
    args: ["--host=127.0.0.1", "--port=5432", "--username=postgres", `--dbname=${DATABASE}`,
      "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
      "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=sqlstate"],
    // Do not forward inherited PG*, passwords, environment files or service files.
    env: { PATH: environment.PATH || "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
      PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
      PGPASSFILE: "/dev/null", PGAPPNAME: "faolla_pages_acl_ci_acceptance",
      PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=5000" },
  };
}

export function runPagesAclIntegration(environment = process.env, args = process.argv.slice(2)) {
  const config = resolvePagesAclIntegrationConfig(environment, args);
  const deadline = Date.now() + 120_000;
  let groups = 0;
  const execute = (sql, verbose = false) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("pages_acl_acceptance_deadline_exceeded");
    const result = spawnSync("psql", verbose ? [...config.args, "--set=VERBOSITY=default"] : config.args, {
      input: sql, encoding: "utf8", env: config.env, shell: false,
      windowsHide: true, timeout: Math.min(25_000, remaining), maxBuffer: 1_048_576,
    });
    if (result.error || result.signal) throw new Error("pages_acl_acceptance_process_failed");
    return { status: result.status, output: result.stdout.trim(), error: result.stderr };
  };
  const query = (sql) => {
    const result = execute(sql);
    if (result.status !== 0) {
      const state = result.error.match(/ERROR:\s+([A-Z0-9]{5})(?:\s|$)/)?.[1] || "unknown";
      console.error(`[pages-acl-postgres] synthetic_query_failed sqlstate=${state}`);
    }
    assert.equal(result.status, 0, "synthetic SQL did not complete");
    return result.output;
  };
  const json = (sql) => JSON.parse(query(sql));
  const pass = (label) => { groups += 1; console.log(`[pages-acl-postgres] passed ${label}`); };

  // Every mutation is after fixed endpoint/database, genuine PG15, and empty
  // relation/function/role checks. No reset, cleanup or database drop is offered.
  const identity = json(`begin read only;
    select jsonb_build_object('database',current_database(),'user',current_user,
      'address',host(inet_server_addr()),'port',inet_server_port(),
      'major',current_setting('server_version_num')::integer / 10000,
      'dataDirectory',current_setting('data_directory'),
      'relations',(select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'
          and c.relkind in ('r','p','v','m','S','f')),
      'functions',(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'),
      'roles',(select count(*) from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role','pages_acl_test_writer')));
    rollback;`);
  assert.deepEqual(identity, { database: DATABASE, user: "postgres", address: config.serverAddress,
    port: 5432, major: 15, dataDirectory: "/var/lib/postgresql/data", relations: 0, functions: 0, roles: 0 },
  "refusing a non-empty or differently bound PostgreSQL service");
  pass("fixed empty PG15 CI service identity");
  const quiet = json(PRODUCTION_MAINTENANCE_QUIET_SQL);
  if (quiet.complete !== true || quiet.schedulerSafe !== true || quiet.transactions !== 0 || quiet.prepared !== 0 || !Number.isSafeInteger(quiet.databaseOid)) {
    console.error(JSON.stringify({ checkpoint: "maintenance-quiet-projection", complete: quiet.complete === true,
      schedulerSafe: quiet.schedulerSafe === true, transactionsZero: quiet.transactions === 0,
      preparedZero: quiet.prepared === 0, databaseOidType: typeof quiet.databaseOid }));
  }
  assert.deepEqual(Object.keys(quiet).sort(), ["complete", "schedulerSafe", "transactions", "prepared", "databaseOid"].sort());
  assert.equal(quiet.complete, true);
  assert.equal(quiet.schedulerSafe, true);
  assert.equal(quiet.transactions, 0);
  assert.equal(quiet.prepared, 0);
  assert.ok(Number.isSafeInteger(quiet.databaseOid) && quiet.databaseOid > 0);
  pass("real maintenance read-only quiet and scheduler projection compiles on PG15");

  const read = (name) => readFileSync(new URL(`../supabase-migrations/${name}`, import.meta.url), "utf8");
  const migration = read(MIGRATION);
  const hash = createHash("sha256").update(migration).digest("hex");
  const init = readFileSync(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const ddl = (pattern) => { const value = init.match(pattern)?.[0]; assert.ok(value, "real baseline DDL missing"); return value; };
  query(`create role anon nologin;
    create role authenticated nologin inherit;
    create role service_role nologin bypassrls;
    create role pages_acl_test_writer nologin;
    grant usage on schema public to anon,authenticated,service_role,pages_acl_test_writer;
    ${ddl(/create table if not exists public\.pages \([\s\S]*?\n\);/i)}
    ${ddl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i)}
    ${ddl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i)}
    ${ddl(/create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i)}
    create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());
    alter table public.pages enable row level security;
    create policy synthetic_old_browser_all on public.pages for all to anon,authenticated using(true) with check(true);
    grant select,insert,update,delete on table public.pages to public,anon,authenticated,service_role;
    grant insert(slug,blocks),update(blocks) on table public.pages to public,anon,authenticated;
    create table public.pages_acl_other(id integer primary key,value text);
    insert into public.pages_acl_other values(1,'synthetic unrelated data');
    grant select,insert,update,delete on public.pages_acl_other to public,anon,authenticated,service_role;
    insert into public.pages(merchant_id,slug,blocks) values(null,'home','{"synthetic":"public"}'),
      ('10000000','home','{"synthetic":"merchant"}');`);
  for (const name of ["202609080044_qr_token_atomic_mutation.sql", "202609080045_order_membership_atomic_mutation.sql",
    "202609080046_redemption_atomic_mutation.sql", "202609080047_redemption_checkout_context.sql"]) query(read(name));
  pass("actual baseline pages and frozen 044 through 047 migrations installed");

  const snapshot = () => json(`select jsonb_build_object(
    'pages',(select jsonb_agg(to_jsonb(p) order by id) from public.pages p),
    'registry',(select jsonb_agg(to_jsonb(m) order by version) from public.faolla_schema_migrations m),
    'relations',(select jsonb_agg(jsonb_build_object('name',relname,'owner',relowner,'acl',relacl::text,
      'rls',relrowsecurity,'forced',relforcerowsecurity) order by relname) from pg_catalog.pg_class
      where oid in ('public.pages'::regclass,'public.pages_acl_other'::regclass)),
    'columnAcl',(select jsonb_agg(jsonb_build_object('name',attname,'acl',attacl::text) order by attnum)
      from pg_catalog.pg_attribute where attrelid='public.pages'::regclass and attnum>0 and not attisdropped),
    'policies',(select jsonb_agg(to_jsonb(p) order by polname) from pg_catalog.pg_policy p where polrelid='public.pages'::regclass),
    'other',(select jsonb_agg(to_jsonb(o) order by id) from public.pages_acl_other o),
    'memberships',(select coalesce(jsonb_agg(to_jsonb(a) order by roleid,member),'[]'::jsonb) from pg_catalog.pg_auth_members a));`);
  const rejectMigration = (code) => {
    const before = snapshot();
    const result = execute(migration, true);
    assert.notEqual(result.status, 0, "invalid ACL migration unexpectedly committed");
    assert.ok(result.error.includes(code), "migration did not return the expected fixed error");
    assert.deepEqual(snapshot(), before, "failed migration did not fully roll back ACLs/registry/data");
  };
  query("update public.faolla_schema_migrations set name='synthetic_wrong_dependency' where version=202609080047;");
  rejectMigration("pages_client_write_acl_dependency_missing");
  query("update public.faolla_schema_migrations set name='redemption_checkout_context' where version=202609080047;");
  query("insert into public.faolla_schema_migrations(version,name) values(202609090048,'synthetic_conflict');");
  rejectMigration("pages_client_write_acl_registry_conflict");
  query("delete from public.faolla_schema_migrations where version=202609090048 and name='synthetic_conflict';");
  pass("missing predecessor and conflicting registry entry refuse without changes");

  query("grant insert,update,delete on public.pages to pages_acl_test_writer; grant pages_acl_test_writer to authenticated;");
  rejectMigration("pages_client_write_acl_effective_write_remains");
  query("revoke pages_acl_test_writer from authenticated; revoke insert,update,delete on public.pages from pages_acl_test_writer;");
  pass("unknown inherited writer causes transactional rollback instead of role changes");

  query("alter table public.pages owner to authenticated;");
  rejectMigration("pages_client_write_acl_effective_write_remains");
  query("alter table public.pages owner to postgres;");
  pass("client ownership refuses and preserves the pre-attempt state");

  // If the service relies on PUBLIC, removing PUBLIC must not silently break it.
  query("revoke insert,update,delete on public.pages from service_role;");
  rejectMigration("pages_client_write_acl_preserved_privilege_changed");
  query("grant insert,update,delete on public.pages to service_role;");
  pass("service permissions inherited solely from PUBLIC are not silently lost");

  const exercise = (role) => `begin; set local role ${role};
    insert into public.pages(slug,blocks) values('synthetic-write-proof','[]') returning 1;
    update public.pages set blocks='{"synthetic":"updated"}' where slug='synthetic-write-proof' returning 1;
    delete from public.pages where slug='synthetic-write-proof' returning 1; rollback;`;
  for (const role of ["anon", "authenticated"]) assert.equal(query(exercise(role)), "1\n1\n1");
  const before = snapshot();
  query(migration);
  const after = snapshot();
  assert.deepEqual(after.pages, before.pages);
  assert.deepEqual(after.policies, before.policies);
  assert.deepEqual(after.other, before.other);
  assert.deepEqual(after.memberships, before.memberships);
  assert.deepEqual(after.relations.find((row) => row.name === "pages_acl_other"), before.relations.find((row) => row.name === "pages_acl_other"));
  assert.equal(after.relations.find((row) => row.name === "pages").rls, true);
  assert.equal(after.relations.find((row) => row.name === "pages").forced, false);
  assert.equal(after.registry.filter((row) => row.version === 202609090048 && row.name === "pages_client_write_acl").length, 1);
  pass("048 closes previously working browser writers without changing rows/RLS/other tables");
  assert.deepEqual(json(PRODUCTION_MAINTENANCE_ACL_SQL), { migration: true, clientsDenied: true, serviceWrites: true });
  pass("real maintenance end verifies 048 and effective client/service privileges");

  for (const role of ["anon", "authenticated"]) {
    assert.equal(query(`set role ${role}; select count(*) from public.pages;`), "2");
    for (const sql of [
      "insert into public.pages(slug,blocks) values('synthetic-denied','[]');",
      "update public.pages set blocks='[]' where slug='home';",
      "delete from public.pages where slug='home';",
    ]) {
      const result = execute(`begin; set local role ${role}; ${sql} rollback;`);
      assert.notEqual(result.status, 0, "browser direct pages mutation unexpectedly allowed");
      assert.match(result.error, /42501/, "must be a privilege rejection, not a fixture data error");
    }
  }
  assert.equal(query(exercise("service_role")), "1\n1\n1");
  assert.deepEqual(snapshot(), after);
  pass("anon/authenticated table and column writes denied, SELECT and service DML preserved");

  query(migration);
  assert.deepEqual(snapshot(), after, "idempotent reapply must not change data or registry timestamps");
  query("grant insert,update,delete on public.pages to public,anon,authenticated; grant insert(blocks),update(blocks) on public.pages to public,anon,authenticated;");
  query(migration);
  for (const role of ["anon", "authenticated"]) {
    assert.equal(query(`select has_table_privilege('${role}','public.pages','INSERT')
      or has_table_privilege('${role}','public.pages','UPDATE') or has_table_privilege('${role}','public.pages','DELETE')
      or has_any_column_privilege('${role}','public.pages','INSERT') or has_any_column_privilege('${role}','public.pages','UPDATE');`), "f");
  }
  assert.deepEqual(snapshot().pages, after.pages);
  pass("repeat installation removes reintroduced PUBLIC/table/column grants without data changes");
  console.log(JSON.stringify({ ok: true, database: DATABASE, postgresMajor: 15, groups, migrationSha256: hash }));
  return { groups, migrationSha256: hash };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runPagesAclIntegration(); }
  catch { console.error("[pages-acl-postgres] acceptance_failed; synthetic database preserved"); process.exitCode = 1; }
}
