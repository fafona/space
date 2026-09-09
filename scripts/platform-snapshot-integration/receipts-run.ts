import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runReceiptAdapterChecks } from "./receipt-adapter-checks";
import { runReceiptFaultChecks } from "./receipt-fault-checks";
import {
  PLATFORM_SNAPSHOT_ATOMIC_SCOPES, readPlatformSnapshotRestoreAtomic,
  type PlatformSnapshotAtomicClient, type PlatformSnapshotAtomicScope,
  type PlatformSnapshotRestoreAtomicView, type PlatformSnapshotAtomicWrite,
} from "../../src/lib/platformSnapshotAtomic.server";

// Standalone SYNTHETIC evidence only. This runner never starts/stops an instance,
// creates/resets a database, loads .env or applies a registered migration.
// An operator must first start the dedicated instance using an authorized,
// unprivileged PostgreSQL launch and prepare the exact empty database below.
const database = "faolla_platform_snapshot_receipts_test";
const port = "56501";
const receiptTable = "public.faolla_platform_snapshot_restore_receipts";
const expectedPath = fileURLToPath(new URL("../../.runtime/platform-snapshot-receipts-test-pg", import.meta.url));
const readName = "faolla_read_platform_snapshot_restore_receipt_v1";
const commitName = "faolla_commit_platform_snapshot_restore_receipt_v1";
const readSignature = `public.${readName}(text,text,text,text,text)`;
const commitSignature = `public.${commitName}(text,text,text,text,text,jsonb,jsonb,jsonb)`;
const baseArgs = ["-X", "-w", "-q", "-A", "-t", "-h", "127.0.0.1", "-p", port,
  "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"];
const pathKey = (value: string) => process.platform === "win32" ? value.replaceAll("\\", "/").toLowerCase() : value;

function childEnvironment(source: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]
    .filter((key) => source[key] !== undefined).map((key) => [key, source[key]])),
  PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=12000" };
}
function cliMode(args: string[]): "guards" | "database" {
  if (args.length === 1 && args[0] === "--check-guards") return "guards";
  assert.equal(args.length, 0, "This runner accepts no database, port, host or credential arguments");
  return "database";
}
function assertDedicatedIdentity(value: { database: string; address: string; port: string; directory: string }, resolvedExpected: string) {
  assert.equal(value.database, database, "Wrong dedicated database");
  assert.equal(value.address, "127.0.0.1", "Non-loopback database is forbidden");
  assert.equal(value.port, port, "Wrong dedicated port");
  assert.equal(pathKey(resolvedExpected), pathKey(expectedPath), "Dedicated directory must not redirect outside its literal path");
  assert.equal(pathKey(value.directory), pathKey(resolvedExpected), "Wrong dedicated data directory");
}
function assertEmpty(relations: string, functions: string) {
  assert.equal(relations, "0", "Refusing nonempty database; preserve prior synthetic evidence");
  assert.equal(functions, "0", "Refusing existing public functions; no reset or implicit continuation");
}
function checkGuards() {
  assert.equal(cliMode([]), "database"); assert.equal(cliMode(["--check-guards"]), "guards");
  for (const args of [["--database", "postgres"], ["--port", "5432"], ["--reset"], ["--check-guards", "--reset"]]) {
    assert.throws(() => cliMode(args));
  }
  const clean = childEnvironment({ PATH: "synthetic-path", PGHOST: "unsafe", PGHOSTADDR: "203.0.113.1", PGPORT: "5432",
    PGDATABASE: "production", PGPASSWORD: "synthetic-not-a-secret", PGSERVICE: "unsafe", PGSERVICEFILE: "unsafe",
    PGOPTIONS: "unsafe", DATABASE_URL: "unsafe", SUPABASE_SERVICE_ROLE_KEY: "synthetic-not-a-secret" });
  for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    assert.equal(clean[key], undefined);
  }
  assert.equal(clean.PGHOSTADDR, "127.0.0.1"); assert.match(clean.PGOPTIONS!, /statement_timeout=20000/);
  const identity = { database, address: "127.0.0.1", port, directory: expectedPath };
  assertDedicatedIdentity(identity, expectedPath);
  for (const field of ["database", "address", "port", "directory"] as const) {
    assert.throws(() => assertDedicatedIdentity({ ...identity, [field]: "wrong" }, expectedPath));
  }
  assert.throws(() => assertDedicatedIdentity(identity, `${expectedPath}-redirected`));
  assertEmpty("0", "0"); assert.throws(() => assertEmpty("1", "0")); assert.throws(() => assertEmpty("0", "1"));
  console.log(JSON.stringify({ mode: "no_database_guard_checks", groups: 3, connected: false,
    checks: ["fixed CLI and no reset", "credential-free child environment", "exact loopback identity/path and empty database"] }));
}

type Binding = { operationId: string; actorKey: string; scope: "user_manage" | "support_messages"; backupId: string; confirmationToken: string };
type Receipt = Binding & { version: 1; planHash: string; resultHash: string; committedAt: string };
type ReceiptResult = { version: 1; receipt: Receipt; result: PlatformSnapshotRestoreAtomicView | null; replayed: boolean };
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
const bindingArgs = (binding: Binding) => [binding.operationId, binding.actorKey, binding.scope, binding.backupId, binding.confirmationToken].map(literal).join(",");
const receiptSql = (binding: Binding, view: PlatformSnapshotRestoreAtomicView, writes: PlatformSnapshotAtomicWrite[]) =>
  `set application_name='synthetic-receipts-rpc'; set role service_role; select public.${commitName}(${bindingArgs(binding)},${json(view.catalog.rows)},${json(view.target.rows)},${json(writes)});`;
const lookupSql = (binding: Binding) => `set role service_role; select public.${readName}(${bindingArgs(binding)});`;

async function databaseMain() {
  assert.equal(process.env.PLATFORM_SNAPSHOT_RECEIPTS_ALLOW_DISPOSABLE_DATABASE, "1", "Explicit synthetic receipt database opt-in required");
  const psql = process.platform === "win32" ? "C:\\upos-runtime\\pgsql\\bin\\psql.exe" : "psql";
  const env = childEnvironment(process.env);
  const execute = (sql: string): Promise<{ code: number | null; out: string; err: string }> => new Promise((resolve, reject) => {
    const child = spawn(psql, baseArgs, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on("data", (part) => { out += part; }); child.stderr.on("data", (part) => { err += part; });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err }); }); child.stdin.end(sql);
  });
  const query = async (sql: string) => { const result = await execute(sql); assert.equal(result.code, 0, result.err); return result.out; };
  const actual = { database: await query("select current_database();"), address: await query("select host(inet_server_addr());"),
    port: await query("select inet_server_port();"), directory: await realpath(await query("show data_directory;")) };
  assertDedicatedIdentity(actual, await realpath(expectedPath));
  assertEmpty(await query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');"),
    await query("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"));

  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const ddl = (pattern: RegExp) => { const result = init.match(pattern)?.[0]; assert.ok(result); return result; };
  const filenames = ["platform_snapshot_atomic_v1.candidate.sql", "platform_snapshot_restore_v1.candidate.sql", "platform_snapshot_restore_receipts_v1.candidate.sql"];
  const candidates = await Promise.all(filenames.map((name) => readFile(new URL(name, import.meta.url), "utf8")));
  const hashes = candidates.map((value) => createHash("sha256").update(value).digest("hex"));
  assert.equal(hashes[0], "838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93");
  assert.equal(hashes[1], "02519a9f591cf71e30d7f5a72d79ff8326b5fb0544be278baa03d7e974a262eb");
  await query(`create extension pgcrypto;
    do $$ begin
      if exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role') and (rolsuper or rolcanlogin or rolcreaterole or rolcreatedb)) then
        raise exception 'unsafe_synthetic_role'; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end $$;
    ${ddl(/create table if not exists public\.pages \([\s\S]*?\n\);/i)}
    ${ddl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i)}
    ${ddl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i)}
    alter table public.pages enable row level security; grant usage on schema public to anon,authenticated,service_role;
    insert into public.pages(merchant_id,slug,blocks) values(null,'home','[{"synthetic":"public"}]'),('10000000','home','[{"synthetic":"merchant"}]');`);
  for (const candidate of candidates) await query(candidate);
  const snapshot = async () => JSON.parse(await query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.pages p),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]') from ${receiptTable} r));`)) as { pages: Array<{ id: string }>; receipts: unknown[] };
  const initial = await snapshot();
  let groups = 0; const pass = (label: string) => { groups++; console.log(`[platform-snapshot-receipts] passed ${label}`); };
  const live: PlatformSnapshotAtomicClient = { rpc: async (name, input) => {
    assert.ok(name === "faolla_read_platform_snapshot_rows_v1" || name === "faolla_read_platform_snapshot_restore_v1", "Only read RPCs are bridged here");
    const result = await execute(`set role service_role; select public.${name}(${literal(String(input.p_scope))});`);
    if (result.code !== 0) return { data: null, error: { code: "TEST_SQL_ERROR", message: "synthetic_sql_failure" } };
    return { data: JSON.parse(result.out), error: null };
  } };
  const receiptClient: PlatformSnapshotAtomicClient = { rpc: async (name, input) => {
    const argumentNames: Readonly<Record<string, readonly string[]>> = {
      faolla_read_platform_snapshot_restore_v1: ["p_scope"],
      faolla_read_platform_snapshot_rows_v1: ["p_scope"],
      [readName]: ["p_operation_id", "p_actor_key", "p_scope", "p_backup_id", "p_confirmation_token"],
      [commitName]: ["p_operation_id", "p_actor_key", "p_scope", "p_backup_id", "p_confirmation_token",
        "p_catalog_expected", "p_target_expected", "p_writes"],
    };
    assert.ok(Object.hasOwn(argumentNames, name), "Only fixed synthetic receipt RPCs are bridged");
    const keys = argumentNames[name];
    assert.deepEqual(Object.keys(input).sort(), [...keys].sort());
    const sqlArgs = keys.map((key) => key === "p_catalog_expected" || key === "p_target_expected" || key === "p_writes"
      ? json(input[key]) : literal(String(input[key]))).join(",");
    const result = await execute(`set role service_role; select public.${name}(${sqlArgs});`);
    if (result.code !== 0) {
      const message = /^ERROR:\s+(platform_snapshot_atomic_(?:invalid_request|conflict|store_corrupt|write_unconfirmed))\s*$/m.exec(result.err)?.[1];
      return { data: null, error: { code: message ? "P0001" : "TEST_SQL_ERROR", message: message ?? "synthetic_sql_failure" } };
    }
    return { data: JSON.parse(result.out), error: null };
  } };
  let sequence = 0;
  const binding = (scope: Binding["scope"] = "user_manage"): Binding => ({ operationId: `00000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`,
    actorKey: "a".repeat(64), scope, backupId: `synthetic-backup-${sequence}`, confirmationToken: `v1.${"b".repeat(64)}` });
  const writesFor = (scope: PlatformSnapshotAtomicScope, label: string): PlatformSnapshotAtomicWrite[] =>
    PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].map((slug) => ({ slug, blocks: slug.includes("support_inbox_history")
      ? { entries: [], syntheticBusinessContent: label } : [{ syntheticBusinessContent: label, unicode: "中文 ñ €" }] }));
  const commit = async (operation: Binding, view: PlatformSnapshotRestoreAtomicView, writes: PlatformSnapshotAtomicWrite[]) =>
    JSON.parse(await query(receiptSql(operation, view, writes))) as ReceiptResult;
  const lookup = async (operation: Binding) => JSON.parse(await query(lookupSql(operation))) as { version: 1; receipt: Receipt | null };
  const rejectSql = async (sql: string, code: string) => {
    const before = await snapshot(); const failed = await execute(sql);
    assert.notEqual(failed.code, 0); assert.match(failed.err, new RegExp(`^ERROR:\\s+${code}\\s*$`, "m"));
    assert.deepEqual(await snapshot(), before);
  };

  const columns = JSON.parse(await query(`select jsonb_agg(attname order by attnum) from pg_attribute where attrelid='${receiptTable}'::regclass and attnum>0 and not attisdropped;`));
  assert.deepEqual(columns, ["operation_id", "actor_key", "scope", "backup_id", "confirmation_token", "plan_hash", "result_hash", "committed_at"]);
  assert.equal(await query(`select relrowsecurity from pg_class where oid='${receiptTable}'::regclass;`), "t");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const permission of ["select", "insert", "update", "delete", "truncate"]) {
      assert.equal(await query(`select has_table_privilege(${literal(role)},'${receiptTable}',${literal(permission)});`), "f");
    }
    const denied = await execute(`set role ${role}; select * from ${receiptTable};`);
    assert.notEqual(denied.code, 0); assert.match(denied.err, /permission denied for table/);
    for (const signature of [readSignature, commitSignature]) {
      assert.equal(await query(`select has_function_privilege(${literal(role)},${literal(signature)},'execute');`), role === "service_role" ? "t" : "f");
    }
    if (role !== "service_role") {
      const deniedRpc = await execute(`set role ${role}; select public.${readName}(${bindingArgs(binding())});`);
      assert.notEqual(deniedRpc.code, 0); assert.match(deniedRpc.err, /permission denied for function/);
    }
  }
  pass("strict metadata schema, RLS, service-only functions and no direct API table access");

  await query("insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup__','[{\"syntheticCatalog\":true}]');");
  const recorded: Array<{ operation: Binding; before: PlatformSnapshotRestoreAtomicView; writes: PlatformSnapshotAtomicWrite[]; result: ReceiptResult }> = [];
  for (const scope of ["user_manage", "support_messages"] as const) {
    const operation = binding(scope); const before = await readPlatformSnapshotRestoreAtomic(live, scope);
    const writes = writesFor(scope, "NEVER_COPY_PRIVATE_BUSINESS_INTO_RECEIPT");
    const result = await commit(operation, before, writes);
    assert.equal(result.replayed, false); assert.ok(result.result); assert.deepEqual(result.result.catalog, before.catalog);
    assert.deepEqual(result.result.target.rows.map((entry) => ({ slug: entry.slug, blocks: entry.row!.blocks })), writes);
    assert.deepEqual({ ...result.receipt, planHash: undefined, resultHash: undefined, committedAt: undefined },
      { version: 1, ...operation, planHash: undefined, resultHash: undefined, committedAt: undefined });
    const expectedPlanHash = await query(`select encode(sha256(convert_to(jsonb_build_object('catalogExpected',${json(before.catalog.rows)},'targetExpected',${json(before.target.rows)},'writes',${json(writes)})::text,'UTF8')),'hex');`);
    const expectedResultHash = await query(`select encode(sha256(convert_to(${json(result.result.target)}::text,'UTF8')),'hex');`);
    assert.equal(result.receipt.planHash, expectedPlanHash); assert.equal(result.receipt.resultHash, expectedResultHash);
    assert.ok(Number.isFinite(Date.parse(result.receipt.committedAt)));
    assert.ok(!JSON.stringify((await snapshot()).receipts).includes("NEVER_COPY_PRIVATE_BUSINESS_INTO_RECEIPT"));
    recorded.push({ operation, before, writes, result });
  }
  pass("both scopes atomically commit actual targets and metadata-only receipts with database-derived hashes");

  for (const item of recorded) {
    const before = await snapshot(); const found = await lookup(item.operation); assert.deepEqual(found.receipt, item.result.receipt);
    for (const modified of [{ ...item.operation, operationId: binding().operationId }, { ...item.operation, actorKey: "c".repeat(64) },
      { ...item.operation, scope: item.operation.scope === "user_manage" ? "support_messages" as const : "user_manage" as const },
      { ...item.operation, backupId: "different-backup" }, { ...item.operation, confirmationToken: `v1.${"d".repeat(64)}` }]) {
      assert.deepEqual(await lookup(modified), { version: 1, receipt: null });
    }
    assert.deepEqual(await snapshot(), before);
  }
  pass("matching, missing and every mismatched lookup binding are read-only; missing is not proof of no commit");

  for (const item of recorded) {
    await query(`update public.pages set blocks=blocks||'[{"laterCatalog":true}]' where merchant_id is null and slug='__platform_admin_data_backup__';
      update public.pages set blocks=${json([{ laterTarget: true }])} where merchant_id is null and slug=${literal(PLATFORM_SNAPSHOT_ATOMIC_SCOPES[item.operation.scope].find((slug) => !slug.includes("history"))!)};`);
    const before = await snapshot(); const replay = await commit(item.operation, item.before, item.writes);
    assert.deepEqual(replay, { version: 1, receipt: item.result.receipt, result: null, replayed: true });
    assert.deepEqual(await snapshot(), before);
  }
  pass("same original operation and plan confirms once with result:null and zero writes despite later source/target changes");

  for (const item of recorded) {
    for (const changed of [{ ...item.operation, actorKey: "c".repeat(64) }, { ...item.operation, backupId: "different" },
      { ...item.operation, confirmationToken: `v1.${"c".repeat(64)}` }]) {
      await rejectSql(receiptSql(changed, item.before, item.writes), "platform_snapshot_atomic_conflict");
    }
    const changedWrites = writesFor(item.operation.scope, "different-plan");
    await rejectSql(receiptSql(item.operation, item.before, changedWrites), "platform_snapshot_atomic_conflict");
    const scope = item.operation.scope === "user_manage" ? "support_messages" : "user_manage";
    const otherView = await readPlatformSnapshotRestoreAtomic(live, scope);
    await rejectSql(receiptSql({ ...item.operation, scope }, otherView, writesFor(scope, "different-scope")), "platform_snapshot_atomic_conflict");
  }
  pass("same operation ID with changed actor, scope, backup, confirmation or physical plan cannot overwrite or replay");

  for (const part of ["catalog", "target"] as const) {
    const operation = binding(); const before = await readPlatformSnapshotRestoreAtomic(live, operation.scope);
    const row = before[part].rows.find((entry) => entry.row !== null)!;
    await query(`update public.pages set blocks=blocks||'[{"sourceRace":true}]' where merchant_id is null and slug=${literal(row.slug)};`);
    await rejectSql(receiptSql(operation, before, writesFor(operation.scope, "must-rollback")), "platform_snapshot_atomic_conflict");
    assert.equal((await lookup(operation)).receipt, null);
  }
  pass("source and target CAS conflicts commit neither target changes nor a receipt");

  for (const fault of ["raise", "suppress", "mutate-before", "mutate-after", "target-after", "source-after", "insert-source-after"] as const) {
    const operation = binding(); const view = await readPlatformSnapshotRestoreAtomic(live, operation.scope);
    const sourceCopyMissing = view.catalog.rows[1].row === null;
    assert.equal(sourceCopyMissing, true, "Fixture keeps second catalog row absent for the source-insert fault");
    const body = fault === "raise" ? "raise exception 'PRIVATE synthetic receipt insert failure';"
      : fault === "suppress" ? "return null;"
        : fault === "mutate-before" ? "new.result_hash := repeat('f',64);"
          : fault === "mutate-after" ? `update ${receiptTable} set result_hash=repeat('f',64) where operation_id=new.operation_id;`
            : fault === "target-after" ? "update public.pages set blocks='[{\"receiptTamperedTarget\":true}]' where merchant_id is null and slug='__platform_merchant_snapshot__';"
              : fault === "source-after" ? "update public.pages set blocks='[{\"receiptTamperedSource\":true}]' where merchant_id is null and slug='__platform_admin_data_backup__';"
                : "insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup_backup__','[{\"receiptForgedMissingSource\":true}]');";
    const timing = ["raise", "suppress", "mutate-before"].includes(fault) ? "before" : "after";
    await query(`create function public.synthetic_receipt_fault() returns trigger language plpgsql as $$ begin ${body} return new; end $$;
      create trigger synthetic_receipt_fault ${timing} insert on ${receiptTable} for each row execute function public.synthetic_receipt_fault();`);
    try { await rejectSql(receiptSql(operation, view, writesFor(operation.scope, `receipt-fault-${fault}`)), "platform_snapshot_atomic_write_unconfirmed"); }
    finally { await query(`drop trigger synthetic_receipt_fault on ${receiptTable}; drop function public.synthetic_receipt_fault();`); }
    assert.equal((await lookup(operation)).receipt, null);
  }
  pass("receipt insert error/suppression/metadata tampering and late source/target trigger effects roll back the entire nested transaction");

  for (const scope of ["user_manage", "support_messages"] as const) {
    const operation = binding(scope); const view = await readPlatformSnapshotRestoreAtomic(live, scope);
    await query(`create function public.synthetic_receipt_target_fault() returns trigger language plpgsql as $$ begin
      if new.slug=${literal(PLATFORM_SNAPSHOT_ATOMIC_SCOPES[scope].at(-1)!)} then raise exception 'PRIVATE synthetic last target failure'; end if; return new; end $$;
      create trigger synthetic_receipt_target_fault after update on public.pages for each row execute function public.synthetic_receipt_target_fault();`);
    try { await rejectSql(receiptSql(operation, view, writesFor(scope, "last-target-fault")), "platform_snapshot_atomic_write_unconfirmed"); }
    finally { await query("drop trigger synthetic_receipt_target_fault on public.pages; drop function public.synthetic_receipt_target_fault();"); }
    assert.equal((await lookup(operation)).receipt, null);
  }
  pass("last target failures in both scopes cannot leave a committed receipt");

  const concurrentOperation = binding("support_messages");
  const concurrentView = await readPlatformSnapshotRestoreAtomic(live, concurrentOperation.scope);
  const concurrentWrites = writesFor(concurrentOperation.scope, "concurrent-once");
  const racing = await Promise.all([commit(concurrentOperation, concurrentView, concurrentWrites), commit(concurrentOperation, concurrentView, concurrentWrites)]);
  const winner = racing.find((item) => item.replayed === false); const second = racing.find((item) => item.replayed === true);
  assert.ok(winner?.result); assert.ok(second); assert.equal(second.result, null); assert.deepEqual(second.receipt, winner.receipt);
  assert.deepEqual(await readPlatformSnapshotRestoreAtomic(live, concurrentOperation.scope), winner.result);
  assert.equal(await query(`select count(*) from ${receiptTable} where operation_id=${literal(concurrentOperation.operationId)};`), "1");
  pass("two real connections committing the same operation produce one target commit and one read-only receipt replay");

  const lostOperation = binding(); const lostView = await readPlatformSnapshotRestoreAtomic(live, lostOperation.scope);
  let attempts = 0;
  await assert.rejects((async () => { attempts++; await commit(lostOperation, lostView, writesFor(lostOperation.scope, "ACK-lost-after-real-commit"));
    throw new Error("synthetic_response_lost"); })(), /synthetic_response_lost/);
  assert.equal(attempts, 1); const afterLost = await snapshot(); assert.ok((await lookup(lostOperation)).receipt);
  assert.deepEqual(await snapshot(), afterLost);
  pass("one simulated lost ACK after actual commit is resolved by metadata lookup without reexecuting the restore");

  const validOperation = binding(); const validView = await readPlatformSnapshotRestoreAtomic(live, validOperation.scope);
  for (const changed of [{ ...validOperation, operationId: "bad" }, { ...validOperation, actorKey: "bad" },
    { ...validOperation, backupId: " " }, { ...validOperation, confirmationToken: "bad" }]) {
    await rejectSql(receiptSql(changed, validView, writesFor(validOperation.scope, "bad")), "platform_snapshot_atomic_invalid_request");
    await rejectSql(lookupSql(changed), "platform_snapshot_atomic_invalid_request");
  }
  await rejectSql(receiptSql(validOperation, validView, []), "platform_snapshot_atomic_invalid_request");
  const badView = structuredClone(validView); badView.catalog.rows.reverse();
  await rejectSql(receiptSql(validOperation, badView, writesFor(validOperation.scope, "bad-source-vector")), "platform_snapshot_atomic_write_unconfirmed");
  pass("invalid operation metadata and malformed plans fail without changing pages or receipts");

  const beforeReapply = await snapshot();
  await query(`grant select on ${receiptTable} to public; grant select(operation_id) on ${receiptTable} to authenticated;
    grant execute on function ${readSignature} to public; grant execute on function ${commitSignature} to authenticated;
    alter table ${receiptTable} disable row level security;`);
  await query(candidates[2]);
  assert.deepEqual(await snapshot(), beforeReapply);
  assert.equal(await query(`select relrowsecurity from pg_class where oid='${receiptTable}'::regclass;`), "t");
  assert.equal(await query(`select has_table_privilege('anon','${receiptTable}','select') or has_column_privilege('authenticated','${receiptTable}','operation_id','select') or has_function_privilege('anon',${literal(readSignature)},'execute') or has_function_privilege('authenticated',${literal(commitSignature)},'execute');`), "f");
  pass("candidate reapplication preserves all evidence and repairs table, column, function ACL and RLS drift");

  groups += await runReceiptFaultChecks({ query, execute, candidate: candidates[2] });
  groups += await runReceiptAdapterChecks({ query, rpcClient: receiptClient });
  const final = await snapshot();
  for (const row of initial.pages) assert.deepEqual(final.pages.find((item) => item.id === row.id), row);
  assert.equal(await query("select to_regclass('public.faolla_schema_migrations') is null;"), "t");
  pass("unrelated public/merchant pages and migration registry boundary are preserved; synthetic data remains");
  console.log(JSON.stringify({ groups, postgres: await query("show server_version;"), database, port,
    candidateHashes: Object.fromEntries(filenames.map((name, index) => [name, hashes[index]])),
    retained: true, boundary: "actual SQL via TS+psql bridge; no HTTP/PostgREST/Auth/browser-local recovery, ABA proof, DR proof or production cutover" }));
}

async function main() {
  if (cliMode(process.argv.slice(2)) === "guards") { checkGuards(); return; }
  await databaseMain();
}
const watchdog = setTimeout(() => { throw new Error("synthetic_receipts_acceptance_timeout"); }, 120000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
