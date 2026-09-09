import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDatabaseRecoveryContentSql, buildDatabaseRecoveryReadOnlyPsqlArgs,
  validateDatabaseRecoveryContent, assertDatabaseRecoveryContentMatch } from "../database-recovery-content-contract.mjs";

// Synthetic evidence only. The operator owns instance/database lifecycle. This
// runner never loads .env, starts/stops PostgreSQL, resets data or removes files.
const port = "56511";
const source = "faolla_receipt_recovery_source_test";
const target = "faolla_receipt_recovery_target_test";
const directory = fileURLToPath(new URL("../../.runtime/receipt-recovery-test-pg", import.meta.url));
const runtime = fileURLToPath(new URL("../../.runtime/receipt-recovery-integration", import.meta.url));
const dumpPath = path.join(runtime, "synthetic-receipt-recovery.dump");
const receiptTable = "public.faolla_platform_snapshot_restore_receipts";
const readName = "public.faolla_read_platform_snapshot_restore_receipt_v1";
const commitName = "public.faolla_commit_platform_snapshot_restore_receipt_v1";
const expectedRelations = ["public.pages", "public.faolla_redemption_operations", "public.faolla_redemption_checkouts",
  "public.faolla_schema_migrations", receiptTable];
const executable = (name) => process.platform === "win32" ? `C:\\upos-runtime\\pgsql\\bin\\${name}.exe` : name;
const normalized = (value) => process.platform === "win32" ? value.replaceAll("\\", "/").toLowerCase() : value;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
function childEnvironment(input) {
  return { ...Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]
    .filter((key) => input[key] !== undefined).map((key) => [key, input[key]])),
  NODE_ENV: "test", PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  PGOPTIONS: "-c lc_messages=C -c statement_timeout=60000 -c lock_timeout=10000" };
}
function mode(args) {
  if (args.length === 1 && args[0] === "--check-guards") return "guards";
  assert.equal(args.length, 0, "No host/database/port/file/reset arguments are accepted");
  return "database";
}
function identity(value, db, resolved) {
  assert.ok(db === source || db === target);
  assert.equal(value.database, db); assert.equal(value.address, "127.0.0.1"); assert.equal(value.port, port);
  assert.equal(normalized(resolved), normalized(directory), "Dedicated directory must not redirect elsewhere");
  assert.equal(normalized(value.directory), normalized(resolved), "Wrong dedicated database instance");
}
function empty(relations, functions) {
  assert.equal(relations, "0", "Refusing nonempty database; preserve existing evidence");
  assert.equal(functions, "0", "Refusing existing public functions; no reset");
}
function checkGuards() {
  assert.equal(mode([]), "database"); assert.equal(mode(["--check-guards"]), "guards");
  for (const args of [["--reset"], ["--port", "5432"], ["--file", "existing.dump"], ["--check-guards", "--reset"]]) assert.throws(() => mode(args));
  const env = childEnvironment({ PATH: "synthetic", PGPASSWORD: "synthetic", PGHOST: "remote", PGPORT: "5432",
    PGDATABASE: "production", PGSERVICE: "unsafe", PGSERVICEFILE: "unsafe", DATABASE_URL: "unsafe", SUPABASE_SERVICE_ROLE_KEY: "synthetic" });
  for (const key of ["PGPASSWORD", "PGHOST", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) assert.equal(env[key], undefined);
  assert.equal(env.PGHOSTADDR, "127.0.0.1");
  const valid = { database: source, address: "127.0.0.1", port, directory };
  identity(valid, source, directory);
  for (const field of Object.keys(valid)) assert.throws(() => identity({ ...valid, [field]: "wrong" }, source, directory));
  assert.throws(() => identity(valid, source, `${directory}-redirected`));
  empty("0", "0"); assert.throws(() => empty("1", "0")); assert.throws(() => empty("0", "1"));
  console.log(JSON.stringify({ mode: "no_database_guard_checks", groups: 3, connected: false }));
}

async function databaseMain() {
  assert.equal(process.env.RECEIPT_RECOVERY_ALLOW_DISPOSABLE_DATABASE, "1", "Explicit disposable receipt recovery opt-in required");
  const env = childEnvironment(process.env);
  const connection = (db) => {
    assert.ok(db === source || db === target);
    return ["--host=127.0.0.1", `--port=${port}`, "--username=postgres", `--dbname=${db}`, "--no-password"];
  };
  const run = (name, args, input = "", outputFd) => new Promise((resolve, reject) => {
    const child = spawn(executable(name), args, { env, windowsHide: true, stdio: ["pipe", outputFd ?? "pipe", "pipe"] });
    let out = ""; let err = "";
    const timer = setTimeout(() => child.kill(), 90000);
    child.stdout?.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
    child.stdin.on("error", (error) => { if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code)) reject(error); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err }); });
    child.stdin.end(input);
  });
  const psqlArgs = (db) => [...connection(db), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"];
  const execute = (db, sql) => run("psql", psqlArgs(db), sql);
  const query = async (db, sql) => { const response = await execute(db, sql); assert.equal(response.code, 0, response.err); return response.out; };
  const proof = async (db) => {
    const response = await run("psql", [...psqlArgs(db), ...buildDatabaseRecoveryReadOnlyPsqlArgs(buildDatabaseRecoveryContentSql())]);
    assert.equal(response.code, 0, response.err);
    const value = JSON.parse(response.out);
    assert.equal(validateDatabaseRecoveryContent(value).valid, true);
    assert.equal(value.schemaVersion, 2); assert.deepEqual(value.relations.map((item) => item.name), expectedRelations);
    return value;
  };
  const relation = (content) => content.relations.find((item) => item.name === receiptTable);
  let groups = 0; const pass = (label) => { groups++; console.log(`[receipt-recovery-postgres] passed ${label}`); };
  for (const db of [source, target]) {
    const actual = JSON.parse(await query(db, `select jsonb_build_object('database',current_database(),'address',host(inet_server_addr()),
      'port',inet_server_port()::text,'directory',current_setting('data_directory'));`));
    actual.directory = await realpath(actual.directory);
    identity(actual, db, await realpath(directory));
    empty(await query(db, `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`),
    await query(db, "select count(*) from pg_proc where pronamespace='public'::regnamespace;"));
  }
  await mkdir(runtime, { recursive: true });
  assert.equal(normalized(await realpath(runtime)), normalized(runtime), "Evidence directory must not redirect elsewhere");
  await assert.rejects(access(dumpPath), (error) => error.code === "ENOENT", "Never overwrite a prior dump");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const extract = (pattern) => { const value = init.match(pattern)?.[0]; assert.ok(value); return value; };
  await query(source, `create extension pgcrypto;
    do $$ begin
      if exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role') and
        (rolsuper or rolcanlogin or rolcreaterole or rolcreatedb or rolbypassrls)) then raise exception 'unsafe_synthetic_role'; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    ${extract(/create table if not exists public\.pages \([\s\S]*?\n\);/i)}
    ${extract(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i)}
    ${extract(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i)}
    alter table public.pages enable row level security; grant usage on schema public to anon,authenticated,service_role;
    create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());`);
  const absent = await proof(source); assert.equal(relation(absent).present, false);
  const filenames = ["platform_snapshot_atomic_v1.candidate.sql", "platform_snapshot_restore_v1.candidate.sql", "platform_snapshot_restore_receipts_v1.candidate.sql"];
  const frozen = ["838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93",
    "02519a9f591cf71e30d7f5a72d79ff8326b5fb0544be278baa03d7e974a262eb",
    "886754062ec8bb9558f87582180a6b548fdda87b7dd5fc4610a2aeb0bfe189b2"];
  for (const [index, name] of filenames.entries()) {
    const sql = await readFile(new URL(`../platform-snapshot-integration/${name}`, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(sql).digest("hex"), frozen[index], "Frozen candidate changed; review before running");
    await query(source, sql);
  }
  const presentEmpty = await proof(source); assert.equal(relation(presentEmpty).rowCount, "0");
  assert.throws(() => assertDatabaseRecoveryContentMatch(presentEmpty, absent));
  pass("dedicated empty databases and schema-v2 proof distinguish absent from present-empty receipt storage");

  await query(source, "insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup__','[{\"syntheticCatalog\":true}]');");
  const view = JSON.parse(await query(source, "set role service_role; select public.faolla_read_platform_snapshot_restore_v1('user_manage');"));
  const writes = view.target.rows.map(({ slug }) => ({ slug, blocks: [{ syntheticRecoveryContent: "never-copy-this-business-payload-into-receipt" }] }));
  const binding = [randomUUID(), "a".repeat(64), "user_manage", "synthetic-recovery-backup", `v1.${"b".repeat(64)}`];
  const bindingArgs = binding.map(literal).join(",");
  const commitSql = `set role service_role; select ${commitName}(${bindingArgs},${json(view.catalog.rows)},${json(view.target.rows)},${json(writes)});`;
  const lookupSql = `set role service_role; select ${readName}(${bindingArgs});`;
  const committed = JSON.parse(await query(source, commitSql));
  assert.equal(committed.replayed, false); assert.ok(committed.result);
  assert.deepEqual(Object.keys(committed.receipt).sort(), ["version", "operationId", "actorKey", "scope", "backupId", "confirmationToken", "planHash", "resultHash", "committedAt"].sort());
  assert.ok(!JSON.stringify(committed.receipt).includes("never-copy-this-business-payload"));
  const expected = await proof(source); assert.equal(relation(expected).rowCount, "1");
  assert.equal(expected.relations[3].rowCount, "0");
  pass("real service RPC commits a metadata-only durable receipt without registering candidate migrations");

  // Exclusive creation + inherited stdout descriptor prevents pg_dump from
  // opening/truncating an existing file. Failed/partial evidence is retained.
  const dump = await open(dumpPath, "wx", 0o600);
  try {
    const dumped = await run("pg_dump", [...connection(source), "--format=custom"], "", dump.fd);
    assert.equal(dumped.code, 0, dumped.err); await dump.sync();
    assert.ok((await dump.stat()).size > 0);
  } finally { await dump.close(); }
  assertDatabaseRecoveryContentMatch(await proof(source), expected);
  const restored = await run("pg_restore", [...connection(target), "--exit-on-error", "--single-transaction", dumpPath]);
  assert.equal(restored.code, 0, restored.err);
  assertDatabaseRecoveryContentMatch(await proof(target), expected);
  pass("real custom pg_dump and transactional pg_restore preserve all five relation proofs");

  assert.deepEqual(JSON.parse(await query(target, lookupSql)).receipt, committed.receipt);
  const replayed = JSON.parse(await query(target, commitSql));
  assert.equal(replayed.replayed, true); assert.equal(replayed.result, null); assert.deepEqual(replayed.receipt, committed.receipt);
  assertDatabaseRecoveryContentMatch(await proof(target), expected);
  pass("restored service lookup and original-plan replay preserve receipt and all target rows without additional writes");

  const transientProof = async (mutation) => {
    const value = JSON.parse(await query(target, `begin; set local timezone='UTC'; set local datestyle='ISO,YMD';
      set local extra_float_digits=3; ${mutation} ${buildDatabaseRecoveryContentSql()} rollback;`));
    assert.equal(validateDatabaseRecoveryContent(value).valid, true);
    assertDatabaseRecoveryContentMatch(await proof(target), expected);
    return value;
  };
  for (const assignment of ["plan_hash=repeat('0',64)", "result_hash=repeat('1',64)", "actor_key=repeat('2',64)", "committed_at=committed_at+interval '1 millisecond'"]) {
    const altered = await transientProof(`update ${receiptTable} set ${assignment};`);
    assert.equal(relation(altered).rowCount, "1");
    assert.throws(() => assertDatabaseRecoveryContentMatch(altered, expected));
  }
  pass("same-count plan/result/actor/timestamp tampering changes the proof and rolls back completely");
  const missingRow = await transientProof(`delete from ${receiptTable};`);
  const missingTable = await transientProof(`drop table ${receiptTable};`);
  assert.equal(relation(missingRow).present, true); assert.equal(relation(missingRow).rowCount, "0");
  assert.equal(relation(missingTable).present, false);
  for (const actual of [missingRow, missingTable]) assert.throws(() => assertDatabaseRecoveryContentMatch(actual, expected));
  assert.throws(() => assertDatabaseRecoveryContentMatch(missingRow, missingTable));
  pass("missing receipt, missing table and present-empty table are distinct and cannot satisfy the restored proof");

  assert.equal(await query(target, `select relrowsecurity from pg_class where oid='${receiptTable}'::regclass;`), "t");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const permission of ["select", "insert", "update", "delete", "truncate"]) {
      assert.equal(await query(target, `select has_table_privilege(${literal(role)},'${receiptTable}',${literal(permission)});`), "f");
    }
    const denied = await execute(target, `set role ${role}; select * from ${receiptTable};`);
    assert.notEqual(denied.code, 0); assert.match(denied.err, /permission denied for table/);
    for (const signature of [`${readName}(text,text,text,text,text)`, `${commitName}(text,text,text,text,text,jsonb,jsonb,jsonb)`]) {
      assert.equal(await query(target, `select has_function_privilege(${literal(role)},${literal(signature)},'execute');`), role === "service_role" ? "t" : "f");
    }
    if (role !== "service_role") {
      const rejected = await execute(target, `set role ${role}; select ${readName}(${bindingArgs});`);
      assert.notEqual(rejected.code, 0); assert.match(rejected.err, /permission denied for function/);
    }
  }
  assertDatabaseRecoveryContentMatch(await proof(target), expected);
  pass("restored RLS and actual API access checks retain service-only RPC and deny direct receipt-table access");
  const legacy = { ...expected, schemaVersion: 1, relations: expected.relations.slice(0, 4) };
  assert.throws(() => assertDatabaseRecoveryContentMatch(expected, legacy));
  assertDatabaseRecoveryContentMatch(await proof(source), expected);
  pass("a legacy four-table proof cannot attest this five-table restore; source and synthetic evidence remain intact");
  console.log(JSON.stringify({ groups, postgres: await query(target, "show server_version;"), port, source, target,
    candidateHashes: Object.fromEntries(filenames.map((name, index) => [name, frozen[index]])), proofSchemaVersion: 2,
    receiptCount: relation(expected).rowCount, dump: dumpPath, retained: true,
    boundary: "single synthetic PostgreSQL database dump/restore; not production DR, cluster roles backup, complete ACL attestation, storage snapshot or Supabase/PG15 evidence" }));
}

async function main() {
  if (mode(process.argv.slice(2)) === "guards") { checkGuards(); return; }
  await databaseMain();
}
const watchdog = setTimeout(() => { throw new Error("synthetic_receipt_recovery_timeout"); }, 240000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
