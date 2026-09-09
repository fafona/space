import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Dedicated synthetic database only. No instance lifecycle, reset, credentials,
// .env loading, retries or registered migrations. The operator starts/stops it.
const database = "faolla_snapshot_receipt_query_test";
const port = "56521";
const directory = fileURLToPath(new URL("../../.runtime/platform-snapshot-receipt-query-test-pg", import.meta.url));
const receiptTable = "public.faolla_platform_snapshot_restore_receipts";
const lookupName = "public.faolla_read_platform_snapshot_restore_receipt_v1";
const commitName = "public.faolla_commit_platform_snapshot_restore_receipt_v1";
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const normalized = (value) => process.platform === "win32" ? value.replaceAll("\\", "/").toLowerCase() : value;
function childEnvironment(input) {
  return { ...Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]
    .filter((key) => input[key] !== undefined).map((key) => [key, input[key]])),
  NODE_ENV: "test", PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=10000" };
}
function mode(args) {
  if (args.length === 1 && args[0] === "--check-guards") return "guards";
  assert.equal(args.length, 0, "No database/port/host/reset overrides are accepted"); return "database";
}
function identity(value, resolved) {
  assert.equal(value.database, database); assert.equal(value.address, "127.0.0.1"); assert.equal(value.port, port);
  assert.equal(normalized(resolved), normalized(directory), "Dedicated path must not redirect elsewhere");
  assert.equal(normalized(value.directory), normalized(resolved), "Wrong dedicated instance");
}
function empty(relations, functions) {
  assert.equal(relations, "0", "Refusing existing database contents; no reset");
  assert.equal(functions, "0", "Refusing existing public functions; preserve prior evidence");
}
function checkGuards() {
  assert.equal(mode([]), "database"); assert.equal(mode(["--check-guards"]), "guards");
  for (const args of [["--reset"], ["--port", "5432"], ["--database", "postgres"], ["--check-guards", "--reset"]]) assert.throws(() => mode(args));
  const env = childEnvironment({ PATH: "synthetic", PGPASSWORD: "synthetic", PGHOST: "remote", PGPORT: "5432", PGDATABASE: "production",
    PGSERVICE: "unsafe", PGSERVICEFILE: "unsafe", DATABASE_URL: "unsafe", SUPABASE_SERVICE_ROLE_KEY: "synthetic" });
  for (const key of ["PGPASSWORD", "PGHOST", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) assert.equal(env[key], undefined);
  assert.equal(env.PGHOSTADDR, "127.0.0.1");
  const valid = { database, address: "127.0.0.1", port, directory }; identity(valid, directory);
  for (const field of Object.keys(valid)) assert.throws(() => identity({ ...valid, [field]: "wrong" }, directory));
  assert.throws(() => identity(valid, `${directory}-redirected`));
  empty("0", "0"); assert.throws(() => empty("1", "0")); assert.throws(() => empty("0", "1"));
  console.log(JSON.stringify({ mode: "no_database_guard_checks", groups: 3, connected: false }));
}

async function databaseMain() {
  assert.equal(process.env.PLATFORM_SNAPSHOT_RECEIPT_QUERY_ALLOW_DISPOSABLE_DATABASE, "1", "Explicit dedicated receipt-query database opt-in required");
  const env = childEnvironment(process.env);
  const psql = process.platform === "win32" ? "C:\\upos-runtime\\pgsql\\bin\\psql.exe" : "psql";
  const args = ["-X", "-w", "-q", "-A", "-t", "-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"];
  const session = () => {
    const child = spawn(psql, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; let err = ""; let closed = false; let ended = false;
    const result = new Promise((resolve) => {
      const timer = setTimeout(() => { err += "synthetic_psql_deadline"; child.kill(); }, 30000);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
      child.stdin.on("error", (error) => { if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code)) { err += error.message; child.kill(); } });
      child.on("error", (error) => { clearTimeout(timer); closed = true; resolve({ code: null, out: out.trim(), err: `${err}${error.message}` }); });
      child.on("close", (code) => { clearTimeout(timer); closed = true; resolve({ code, out: out.trim(), err }); });
    });
    return { result, get closed() { return closed; },
      send(sql) { assert.equal(ended || closed, false); child.stdin.write(`${sql}\n`); },
      end(sql = "") { if (!ended && !closed) { ended = true; child.stdin.end(`${sql}\n`); } } };
  };
  const execute = (sql) => { const connection = session(); connection.end(sql); return connection.result; };
  const query = async (sql) => { const result = await execute(sql); assert.equal(result.code, 0, result.err); return result.out; };
  const actual = JSON.parse(await query(`select jsonb_build_object('database',current_database(),'address',host(inet_server_addr()),
    'port',inet_server_port()::text,'directory',current_setting('data_directory'));`));
  actual.directory = await realpath(actual.directory); identity(actual, await realpath(directory));
  empty(await query(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`),
  await query("select count(*) from pg_proc where pronamespace='public'::regnamespace;"));
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const extract = (pattern) => { const value = init.match(pattern)?.[0]; assert.ok(value); return value; };
  await query(`create extension pgcrypto;
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
    alter table public.pages enable row level security; grant usage on schema public to anon,authenticated,service_role;`);
  const filenames = ["platform_snapshot_atomic_v1.candidate.sql", "platform_snapshot_restore_v1.candidate.sql", "platform_snapshot_restore_receipts_v1.candidate.sql"];
  const frozen = ["838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93",
    "02519a9f591cf71e30d7f5a72d79ff8326b5fb0544be278baa03d7e974a262eb",
    "886754062ec8bb9558f87582180a6b548fdda87b7dd5fc4610a2aeb0bfe189b2"];
  for (const [index, name] of filenames.entries()) {
    const sql = await readFile(new URL(name, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(sql).digest("hex"), frozen[index]); await query(sql);
  }
  await query("insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup__','[{\"syntheticCatalog\":true}]');");
  const snapshot = async () => JSON.parse(await query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.pages p),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]') from ${receiptTable} r));`));
  const readView = async () => JSON.parse(await query("set role service_role; select public.faolla_read_platform_snapshot_restore_v1('user_manage');"));
  const observe = async (sql, predicate, label) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const value = await query(sql); if (predicate(value)) return value;
      // Poll cadence only; release depends on observed backend state, not time.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Did not observe ${label}`);
  };
  let groups = 0;
  for (const outcome of ["commit", "rollback", "lock_timeout"]) {
    const before = await snapshot(); const view = await readView();
    const operationId = randomUUID(); const marker = `ready-${operationId}`;
    const holderName = `synthetic-holder-${operationId}`;
    const waiterName = `synthetic-waiter-${operationId}`;
    const binding = [operationId, "a".repeat(64), "user_manage", `synthetic-${outcome}`, `v1.${"b".repeat(64)}`].map(literal).join(",");
    const writes = view.target.rows.map(({ slug }) => ({ slug, blocks: [{ syntheticQueryCase: outcome }] }));
    const commit = `${commitName}(${binding},${json(view.catalog.rows)},${json(view.target.rows)},${json(writes)})`;
    const lookup = `${lookupName}(${binding})`;
    const holder = session(); let waiter;
    try {
      holder.send(`set application_name=${literal(holderName)}; begin; set local role service_role;
        select ${commit}; select ${literal(marker)};`);
      // The final marker query has completed and the connection is deliberately
      // idle inside its still-open transaction. No psql stdout flush assumption.
      const holderPid = Number(await observe(`select pid from pg_stat_activity where application_name=${literal(holderName)}
        and state='idle in transaction' and position(${literal(marker)} in query)>0;`, (value) => /^\d+$/.test(value), "holder's completed RPC and open transaction"));
      assert.deepEqual(await snapshot(), before, "Uncommitted restore leaked into a separate physical read");
      waiter = session(); let waiterSettled = false; waiter.result.then(() => { waiterSettled = true; });
      waiter.end(`set application_name=${literal(waiterName)}; set lock_timeout='${outcome === "lock_timeout" ? "1500ms" : "10000ms"}';
        set role service_role; select ${lookup};`);
      await observe(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
        where a.application_name=${literal(waiterName)} and l.locktype='advisory' and not l.granted
          and ${holderPid}=any(pg_blocking_pids(a.pid)));`, (value) => value === "t", "the lookup's actual advisory lock blocked by this holder");
      assert.equal(waiterSettled, false, "In-flight lookup returned before transaction resolution");
      if (outcome === "lock_timeout") {
        const timedOut = await waiter.result;
        assert.notEqual(timedOut.code, 0); assert.equal(timedOut.out, "");
        assert.match(timedOut.err, /^ERROR:\s+platform_snapshot_atomic_store_corrupt\s*$/m);
        assert.deepEqual(await snapshot(), before, "Read timeout changed committed data");
        assert.equal(await query(`select exists(select 1 from pg_stat_activity where pid=${holderPid} and state='idle in transaction');`), "t");
      }
      holder.end(outcome === "rollback" ? "rollback;" : "commit;");
      const held = await holder.result; assert.equal(held.code, 0, held.err);
      const fresh = JSON.parse(held.out.split(/\r?\n/).find((line) => line.startsWith("{")));
      assert.equal(fresh.replayed, false); assert.ok(fresh.result);
      const waited = await waiter.result;
      if (outcome === "rollback") {
        assert.equal(waited.code, 0, waited.err);
        assert.deepEqual(JSON.parse(waited.out), { version: 1, receipt: null });
        assert.deepEqual(await snapshot(), before, "Rollback left target changes or a durable receipt");
      } else {
        if (outcome === "commit") { assert.equal(waited.code, 0, waited.err); assert.deepEqual(JSON.parse(waited.out).receipt, fresh.receipt); }
        const after = await snapshot();
        assert.equal(after.receipts.length, before.receipts.length + 1);
        // A deliberate later read after the known COMMIT is not an automatic
        // retry or resubmission. The timed-out request itself remained an error.
        assert.deepEqual(JSON.parse(await query(`set role service_role; select ${lookup};`)).receipt, fresh.receipt);
        const current = await readView(); assert.deepEqual(current.catalog, view.catalog);
        assert.deepEqual(current.target.rows.map(({ slug, row }) => ({ slug, blocks: row.blocks })), writes);
        assert.deepEqual(await snapshot(), after, "Receipt queries changed physical data");
      }
      groups++; console.log(`[receipt-query-postgres] passed ${outcome}: observed lock barrier, exact final state, no resubmission`);
    } finally {
      holder.end("rollback;"); waiter?.end();
      await Promise.allSettled(waiter ? [holder.result, waiter.result] : [holder.result]);
    }
  }
  assert.equal((await snapshot()).receipts.length, 2);
  assert.equal(await query("select to_regclass('public.faolla_schema_migrations') is null;"), "t");
  console.log(JSON.stringify({ groups, postgres: await query("show server_version;"), database, port,
    candidateHashes: Object.fromEntries(filenames.map((name, index) => [name, frozen[index]])), retained: true,
    writeRpcCalls: 3, automaticResubmissions: 0,
    boundary: "actual PostgreSQL read/commit locking only; null is unknown, timeout is error; no HTTP/browser/Auth/production/PG15 claim" }));
}

async function main() {
  if (mode(process.argv.slice(2)) === "guards") { checkGuards(); return; }
  await databaseMain();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
