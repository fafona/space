import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Operator-owned lifecycle. Exact NEW empty synthetic database only: no reset,
// pg_ctl, credentials, .env, migrations, database deletion or automatic retries.
const database = "faolla_snapshot_receipt_inspection_test";
const port = "56531";
const directory = fileURLToPath(new URL("../../.runtime/platform-snapshot-receipt-inspection-test-pg", import.meta.url));
const receiptTable = "public.faolla_platform_snapshot_restore_receipts";
const inspectName = "public.faolla_inspect_platform_snapshot_restore_receipt_v1";
const inspectSignature = `${inspectName}(text,text,text,text,text)`;
const commitName = "public.faolla_commit_platform_snapshot_restore_receipt_v1";
const filenames = ["platform_snapshot_atomic_v1.candidate.sql", "platform_snapshot_restore_v1.candidate.sql",
  "platform_snapshot_restore_receipts_v1.candidate.sql", "platform_snapshot_restore_inspection_v1.candidate.sql"];
const frozen = ["838b642731bfceec9fb66d8da9e1debe7cdacff713670c102172b38457ac7d93",
  "02519a9f591cf71e30d7f5a72d79ff8326b5fb0544be278baa03d7e974a262eb",
  "886754062ec8bb9558f87582180a6b548fdda87b7dd5fc4610a2aeb0bfe189b2",
  "fe2797d97ef4162af3695227238570a8b80deb53524a752a11961481f22ffcc2"];
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
async function loadCandidates() {
  return Promise.all(filenames.map(async (name, index) => {
    const sql = await readFile(new URL(name, import.meta.url), "utf8");
    assert.equal(createHash("sha256").update(sql).digest("hex"), frozen[index], `Frozen candidate drift: ${name}`);
    return sql;
  }));
}
async function checkGuards() {
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
  await loadCandidates();
  console.log(JSON.stringify({ mode: "no_database_guard_checks", groups: 4, connected: false }));
}

async function databaseMain() {
  assert.equal(process.env.PLATFORM_SNAPSHOT_RECEIPT_INSPECTION_ALLOW_DISPOSABLE_DATABASE, "1", "Explicit dedicated receipt-inspection database opt-in required");
  const candidates = await loadCandidates();
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
      if exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role','synthetic_inspection_reader') and
        (rolsuper or rolcanlogin or rolcreaterole or rolcreatedb or rolbypassrls)) then raise exception 'unsafe_synthetic_role'; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if not exists(select 1 from pg_roles where rolname='synthetic_inspection_reader') then create role synthetic_inspection_reader nologin; end if;
    end $$;
    ${extract(/create table if not exists public\.pages \([\s\S]*?\n\);/i)}
    ${extract(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i)}
    ${extract(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i)}
    alter table public.pages enable row level security;
    grant usage on schema public to anon,authenticated,service_role,synthetic_inspection_reader;`);
  for (const sql of candidates) await query(sql);
  const snapshot = async () => JSON.parse(await query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from public.pages p),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by operation_id),'[]') from ${receiptTable} r));`));
  let groups = 0;
  const passed = (label) => { groups++; console.log(`[receipt-inspection-postgres] passed ${label}`); };
  const readView = async (scope) => JSON.parse(await query(`set role service_role; select public.faolla_read_platform_snapshot_restore_v1(${literal(scope)});`));
  const binding = (scope, label) => [randomUUID(), "a".repeat(64), scope, `synthetic-${label}`, `v1.${"b".repeat(64)}`];
  const params = (values) => values.map(literal).join(",");
  const inspection = (values) => `${inspectName}(${params(values)})`;
  const prepare = async (scope, label) => {
    const view = await readView(scope); const values = binding(scope, label);
    const writes = view.target.rows.map(({ slug }) => ({ slug,
      blocks: slug.startsWith("__platform_support_inbox_history") ? { entries: [], synthetic: label } : [{ synthetic: label }] }));
    return { values, view, writes,
      commit: `${commitName}(${params(values)},${json(view.catalog.rows)},${json(view.target.rows)},${json(writes)})` };
  };
  const assertInspection = (value, receipt, state) => {
    assert.deepEqual(Object.keys(value).sort(), ["inspection", "receipt", "version"]);
    assert.equal(value.version, 1); assert.deepEqual(value.receipt, receipt);
    if (receipt === null) { assert.equal(value.inspection, null); return; }
    assert.deepEqual(Object.keys(value.inspection).sort(), ["observedAt", "targetHash", "targetState", "version"]);
    assert.equal(value.inspection.version, 1); assert.equal(value.inspection.targetState, state);
    assert.match(value.inspection.targetHash, /^[a-f0-9]{64}$/);
    assert.equal(Number.isFinite(Date.parse(value.inspection.observedAt)), true);
    if (state === "matches_commit") assert.equal(value.inspection.targetHash, receipt.resultHash);
    else assert.notEqual(value.inspection.targetHash, receipt.resultHash);
  };
  const beforeAcl = await snapshot();
  await query(`grant execute on function ${inspectSignature} to public,synthetic_inspection_reader;`);
  await query(candidates[3]);
  const noOperation = binding("user_manage", "absent");
  for (const role of ["anon", "authenticated", "synthetic_inspection_reader"]) {
    const denied = await execute(`set role ${role}; select ${inspection(noOperation)};`);
    assert.notEqual(denied.code, 0); assert.match(denied.err, /permission denied for function/);
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    const denied = await execute(`set role ${role}; select * from ${receiptTable};`);
    assert.notEqual(denied.code, 0); assert.match(denied.err, /permission denied for table/);
  }
  assertInspection(JSON.parse(await query(`set role service_role; select ${inspection(noOperation)};`)), null);
  assert.equal(await query(`select relrowsecurity from pg_class where oid=${literal(receiptTable)}::regclass;`), "t");
  assert.equal(await query(`select prosecdef and proconfig @> array['search_path=pg_catalog, public','TimeZone=UTC','lock_timeout=5s']
    from pg_proc where oid=${literal(inspectSignature)}::regprocedure;`), "t");
  assert.deepEqual(await snapshot(), beforeAcl);
  passed("service-only ACL/custom grant repair, RLS, fixed definer settings, install replay");

  await query("insert into public.pages(merchant_id,slug,blocks) values(null,'__platform_admin_data_backup__','[{\"syntheticCatalog\":true}]');");
  const committed = [];
  for (const scope of ["user_manage", "support_messages"]) {
    const plan = await prepare(scope, scope); const result = JSON.parse(await query(`set role service_role; select ${plan.commit};`));
    assert.equal(result.replayed, false); assert.ok(result.result);
    const before = await snapshot();
    assertInspection(JSON.parse(await query(`set role service_role; select ${inspection(plan.values)};`)), result.receipt, "matches_commit");
    assert.deepEqual(await snapshot(), before, "Inspection wrote data");
    committed.push({ ...plan, receipt: result.receipt }); passed(`${scope} actual committed target hash matches`);
  }
  const sample = committed[0]; const targetSlug = sample.writes[0].slug;
  const beforeFaults = await snapshot();
  for (const [label, sql] of [
    ["target content", `update public.pages set blocks='[{"synthetic":"changed"}]' where slug=${literal(targetSlug)} and merchant_id is null;`],
    ["target timestamp only", `update public.pages set updated_at=updated_at where slug=${literal(targetSlug)} and merchant_id is null;`],
  ]) {
    const value = JSON.parse(await query(`begin; ${sql} set local role service_role; select ${inspection(sample.values)}; rollback;`));
    assertInspection(value, sample.receipt, "differs_from_commit");
    assert.deepEqual(await snapshot(), beforeFaults); passed(`${label} differs without mutating permanent state`);
  }
  for (const sql of [
    "update public.pages set blocks='{}' where slug='__platform_admin_data_backup__' and merchant_id is null;",
    "delete from public.pages where slug in ('__platform_admin_data_backup__','__platform_admin_data_backup_backup__') and merchant_id is null;",
  ]) {
    assertInspection(JSON.parse(await query(`begin; ${sql} set local role service_role; select ${inspection(sample.values)}; rollback;`)), sample.receipt, "matches_commit");
    assert.deepEqual(await snapshot(), beforeFaults);
  }
  passed("corrupt or absent current backup catalog does not affect target inspection");
  const corruptTarget = `update public.pages set blocks='{}' where slug=${literal(targetSlug)} and merchant_id is null;`;
  for (const values of [noOperation, sample.values.map((value, index) => index === 1 ? "c".repeat(64) : value)]) {
    assertInspection(JSON.parse(await query(`begin; ${corruptTarget} set local role service_role; select ${inspection(values)}; rollback;`)), null);
    assert.deepEqual(await snapshot(), beforeFaults);
  }
  passed("missing or foreign binding remains exact unknown without reading corrupt target");
  const corrupt = await execute(`begin; ${corruptTarget} set local role service_role; select ${inspection(sample.values)}; rollback;`);
  assert.notEqual(corrupt.code, 0); assert.match(corrupt.err, /^ERROR:\s+platform_snapshot_atomic_store_corrupt\s*$/m);
  assert.equal(corrupt.out, ""); assert.deepEqual(await snapshot(), beforeFaults);
  const invalid = await execute(`set role service_role; select ${inspection(sample.values.map((value, index) => index === 2 ? "backup_catalog" : value))};`);
  assert.notEqual(invalid.code, 0); assert.match(invalid.err, /^ERROR:\s+platform_snapshot_atomic_invalid_request\s*$/m);
  assert.deepEqual(await snapshot(), beforeFaults); passed("corrupt target and invalid scope return fixed errors, never unknown");

  const observe = async (sql, predicate, label) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const value = await query(sql); if (predicate(value)) return value;
      // Poll cadence only. Release requires observed backend state, not a sleep.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Did not observe ${label}`);
  };
  for (const outcome of ["commit", "rollback", "lock_timeout"]) {
    const before = await snapshot(); const plan = await prepare("user_manage", outcome);
    const operationId = plan.values[0]; const marker = `ready-${operationId}`;
    const holderName = `synthetic-holder-${operationId}`; const waiterName = `synthetic-waiter-${operationId}`;
    const holder = session(); let waiter;
    try {
      holder.send(`set application_name=${literal(holderName)}; begin; set local role service_role;
        select ${plan.commit}; select ${literal(marker)};`);
      const holderPid = Number(await observe(`select pid from pg_stat_activity where application_name=${literal(holderName)}
        and state='idle in transaction' and position(${literal(marker)} in query)>0;`, (value) => /^\d+$/.test(value), "completed write RPC in open transaction"));
      assert.deepEqual(await snapshot(), before, "Uncommitted restore leaked into a separate physical read");
      waiter = session(); let settled = false; waiter.result.then(() => { settled = true; });
      const started = Date.now();
      waiter.end(`set application_name=${literal(waiterName)}; set lock_timeout='10000ms';
        set role service_role; select ${inspection(plan.values)};`);
      await observe(`select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
        where a.application_name=${literal(waiterName)} and l.locktype='advisory' and not l.granted
          and ${holderPid}=any(pg_blocking_pids(a.pid)));`, (value) => value === "t", "inspection blocked by this exact holder");
      assert.equal(settled, false);
      if (outcome === "lock_timeout") {
        const timeout = await waiter.result; const elapsed = Date.now() - started;
        assert.notEqual(timeout.code, 0); assert.equal(timeout.out, "");
        assert.match(timeout.err, /^ERROR:\s+platform_snapshot_atomic_store_corrupt\s*$/m);
        assert.ok(elapsed >= 4500 && elapsed < 9000, `Expected function's 5s lock deadline, saw ${elapsed}ms`);
        assert.deepEqual(await snapshot(), before);
        assert.equal(await query(`select exists(select 1 from pg_stat_activity where pid=${holderPid} and state='idle in transaction');`), "t");
      }
      holder.end(outcome === "rollback" ? "rollback;" : "commit;");
      const held = await holder.result; assert.equal(held.code, 0, held.err);
      const fresh = JSON.parse(held.out.split(/\r?\n/).find((line) => line.startsWith("{")));
      assert.equal(fresh.replayed, false); assert.ok(fresh.result);
      const waited = await waiter.result;
      if (outcome === "rollback") {
        assert.equal(waited.code, 0, waited.err); assertInspection(JSON.parse(waited.out), null);
        assert.deepEqual(await snapshot(), before, "Rollback left target data or a durable receipt");
      } else {
        if (outcome === "commit") { assert.equal(waited.code, 0, waited.err); assertInspection(JSON.parse(waited.out), fresh.receipt, "matches_commit"); }
        const after = await snapshot(); assert.equal(after.receipts.length, before.receipts.length + 1);
        // Deliberate manual observation after COMMIT, not retry or resubmission.
        assertInspection(JSON.parse(await query(`set role service_role; select ${inspection(plan.values)};`)), fresh.receipt, "matches_commit");
        assert.deepEqual(await snapshot(), after, "Read-only inspection changed physical data");
      }
      passed(`real ${outcome} lock barrier, exact final state, no resubmission`);
    } finally {
      holder.end("rollback;"); waiter?.end();
      await Promise.allSettled(waiter ? [holder.result, waiter.result] : [holder.result]);
    }
  }
  assert.equal((await snapshot()).receipts.length, 4);
  assert.equal(await query("select to_regclass('public.faolla_schema_migrations') is null;"), "t");
  console.log(JSON.stringify({ groups, postgres: await query("show server_version;"), database, port,
    candidateHashes: Object.fromEntries(filenames.map((name, index) => [name, frozen[index]])), retained: true,
    writeRpcCalls: 5, automaticResubmissions: 0,
    boundary: "actual PostgreSQL physical target comparison only; not browser application, ABA prevention, globally stopped writers, production or PG15 evidence" }));
}

async function main() {
  if (mode(process.argv.slice(2)) === "guards") { await checkGuards(); return; }
  await databaseMain();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
