import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Deliberately independent from application .env files and production tools.
// The target must be a new, empty, explicitly authorized loopback test DB.
if (process.env.QR_TOKEN_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
  throw new Error("Set QR_TOKEN_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 for a new empty local test database");
}
const port = process.env.QR_TOKEN_TEST_PORT || "56448";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error("invalid_test_port");
const psql = process.env.QR_TOKEN_TEST_PSQL || "psql";
const args = [
  "--host=127.0.0.1", `--port=${port}`, "--username=postgres", "--dbname=faolla_qr_test",
  "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1",
];
const childEnv = {
  ...process.env,
  PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
  PGOPTIONS: "-c statement_timeout=10000 -c lock_timeout=5000",
};
delete childEnv.PGSERVICE;
delete childEnv.PGSERVICEFILE;
delete childEnv.PGPASSWORD;
let connectionSequence = 0;

function execute(sql, marker = "") {
  let output = "";
  let errorOutput = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Most callers do not need a marker. Avoid an unhandled rejection then.
  ready.catch(() => undefined);
  const child = spawn(psql, args, {
    env: { ...childEnv, PGAPPNAME: `faolla_qr_test_${++connectionSequence}` },
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const timer = setTimeout(() => child.kill(), 20000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output += data.toString();
      if (marker && output.includes(marker)) readyResolve();
    });
    child.stderr.on("data", (data) => { errorOutput += data.toString(); });
    child.on("error", (error) => { clearTimeout(timer); readyReject(error); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (marker && !output.includes(marker)) readyReject(new Error(errorOutput || "race_marker_missing"));
      resolve({ code, output: output.trim(), errorOutput });
    });
  });
  child.stdin.end(sql);
  return { done, ready };
}

async function query(sql) {
  const result = await execute(sql).done;
  assert.equal(result.code, 0, result.errorOutput);
  return result.output;
}

async function rejectsSql(sql, expected) {
  const result = await execute(sql).done;
  assert.notEqual(result.code, 0, "SQL unexpectedly succeeded");
  assert.match(result.errorOutput, expected);
}

function call(type, id, action) {
  return `select public.faolla_mutate_qr_token_v1('${type}', '${id}', '${action}');`;
}

function tokenResult(output) {
  const result = output.split(/\r?\n/).find((line) => line.trim().startsWith('{"token"'));
  assert.ok(result, "RPC must return its persisted entry");
  return JSON.parse(result);
}

async function rpc(type, id, action) {
  return tokenResult(await query(`set role service_role; ${call(type, id, action)}`));
}

async function race(first, second) {
  // A emits a marker only after it owns the row lock; B starts while A still
  // holds it. No timing guess determines which snapshot the second call sees.
  const marker = "__QR_ROW_LOCK_HELD__";
  const a = execute(`begin; set local role service_role; ${call(...first)}
    select '${marker}'; select pg_sleep(0.2); commit;`, marker);
  await a.ready;
  const b = execute(`set role service_role; ${call(...second)}`);
  const [left, right] = await Promise.all([a.done, b.done]);
  assert.equal(left.code, 0, left.errorOutput);
  assert.equal(right.code, 0, right.errorOutput);
  return [tokenResult(left.output), tokenResult(right.output)];
}

const tableCount = await query(`select count(*) from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast'
    and c.relkind in ('r','p','v','m','S','f');`);
assert.equal(tableCount, "0", "Refusing a non-empty database");
assert.equal(await query("select current_database();"), "faolla_qr_test");
const migration = await readFile(new URL("../supabase-migrations/202609080044_qr_token_atomic_mutation.sql", import.meta.url), "utf8");
const initSource = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
const pagesDdl = initSource.match(/create table if not exists public\.pages \([\s\S]*?\n\);/i)?.[0];
assert.ok(pagesDdl, "Use the real pages column contract from supabase-init.sql");
await query(`
  do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    if not exists(select 1 from pg_roles where rolname='qr_test_untrusted') then create role qr_test_untrusted nologin; end if;
  end $$;
  ${pagesDdl}
  alter table public.pages enable row level security;
  create table public.faolla_schema_migrations(version bigint primary key, name text not null, applied_at timestamptz default now());
  insert into public.pages(id,merchant_id,slug,blocks) values
    ('00000000-0000-4000-8000-000000000001',null,'__faolla_qr_tokens__',
      '{"type":"faolla_qr_tokens","version":1,"entries":{"merchant:11111111":{"token":"legacy-merchant","updatedAt":"2026-08-30T00:00:00.000Z"},"personal:22222222":{"token":"legacy-personal","updatedAt":"legacy-date"}}}'),
    ('00000000-0000-4000-8000-000000000002',null,'home','{"keep":"public-home"}'),
    ('00000000-0000-4000-8000-000000000003','12345678','__faolla_qr_tokens__','{"keep":"merchant-scoped-page"}'),
    ('00000000-0000-4000-8000-000000000004',null,'__faolla_qr_tokens__','{"entries":{"merchant:33333333":{"token":"ambiguous-legacy-token"}}}');
`);
let checks = 0;
function passed(label) { checks += 1; console.log(`[qr-postgres] passed ${label}`); }

await rejectsSql(migration, /qr_token_store_duplicate_rows/);
assert.equal(await query("select count(*) from public.pages where merchant_id is null and slug='__faolla_qr_tokens__';"), "2");
assert.equal(await query("select count(*) from public.faolla_schema_migrations;"), "0");
passed("duplicate legacy rows block migration without deleting or merging tokens");
await query("delete from public.pages where id='00000000-0000-4000-8000-000000000004';");
await query(migration);
const beforeReplay = await query("select blocks::text from public.pages where id='00000000-0000-4000-8000-000000000001';");
await query("grant execute on function public.faolla_mutate_qr_token_v1(text,text,text) to qr_test_untrusted;");
await query(migration);
assert.equal(await query("select blocks::text from public.pages where id='00000000-0000-4000-8000-000000000001';"), beforeReplay);
assert.deepEqual(await rpc("merchant", "11111111", "ensure"), { token: "legacy-merchant", updatedAt: "2026-08-30T00:00:00.000Z" });
assert.deepEqual(await rpc("personal", "22222222", "ensure"), { token: "legacy-personal", updatedAt: "legacy-date" });
passed("migration replay and ensure preserve existing links byte-for-byte");

for (const role of ["anon", "authenticated", "qr_test_untrusted"]) {
  assert.equal(await query(`select has_function_privilege('${role}', 'public.faolla_mutate_qr_token_v1(text,text,text)', 'execute');`), "f");
  await rejectsSql(`set role ${role}; ${call("merchant", "11111111", "reset")}`, /permission denied for function/);
}
assert.equal(await query("select proconfig::text from pg_proc where oid='public.faolla_mutate_qr_token_v1(text,text,text)'::regprocedure;"), '{"search_path=pg_catalog, public"}');
passed("only service role plus function owner can execute; fixed search_path");

for (const invalid of [call("bad", "11111111", "reset"), call("merchant", "x", "reset"), call("merchant", "11111111", "bad")]) {
  await rejectsSql(`set role service_role; ${invalid}`, /invalid_qr_token_mutation/);
}
passed("invalid account types, IDs and actions cannot mutate");

const [merchantReset, personalReset] = await race(["merchant", "11111111", "reset"], ["personal", "22222222", "reset"]);
assert.deepEqual(await rpc("merchant", "11111111", "ensure"), merchantReset);
assert.deepEqual(await rpc("personal", "22222222", "ensure"), personalReset);
assert.notEqual(merchantReset.token, "legacy-merchant");
assert.notEqual(personalReset.token, "legacy-personal");
passed("concurrent different-account resets preserve both writes and revoke both old tokens");

const [firstEnsure, secondEnsure] = await race(["merchant", "55555555", "ensure"], ["merchant", "55555555", "ensure"]);
assert.deepEqual(firstEnsure, secondEnsure);
passed("concurrent same-account ensures return the same persisted token");

const [firstReset, secondReset] = await race(["merchant", "55555555", "reset"], ["merchant", "55555555", "reset"]);
assert.notEqual(firstReset.token, secondReset.token);
assert.deepEqual(await rpc("merchant", "55555555", "ensure"), secondReset);
assert.notEqual(secondReset.token, firstEnsure.token);
passed("concurrent same-account resets serialize and only the final reset stays valid");

const [resetThen, ensuredAfter] = await race(["merchant", "55555555", "reset"], ["merchant", "55555555", "ensure"]);
assert.deepEqual(resetThen, ensuredAfter);
const [ensuredBefore, resetAfter] = await race(["merchant", "55555555", "ensure"], ["merchant", "55555555", "reset"]);
assert.deepEqual(ensuredBefore, resetThen);
assert.notEqual(resetAfter.token, ensuredBefore.token);
assert.deepEqual(await rpc("merchant", "55555555", "ensure"), resetAfter);
passed("ensure/reset races never restore a revoked snapshot");

await query(`create function public.qr_test_skip_update() returns trigger language plpgsql as $$ begin return null; end $$;
  create trigger qr_test_skip_update before update on public.pages for each row execute function public.qr_test_skip_update();`);
await rejectsSql(`set role service_role; ${call("merchant", "55555555", "reset")}`, /qr_token_mutation_not_persisted/);
await query("drop trigger qr_test_skip_update on public.pages;");
assert.deepEqual(await rpc("merchant", "55555555", "ensure"), resetAfter);
passed("a suppressed update cannot return an uncommitted token");

const intact = await query("select blocks::text from public.pages where merchant_id is null and slug='__faolla_qr_tokens__';");
await query("alter table public.pages alter column blocks drop not null; update public.pages set blocks=null where merchant_id is null and slug='__faolla_qr_tokens__';");
await rejectsSql(`set role service_role; ${call("merchant", "55555555", "reset")}`, /qr_token_store_corrupt/);
assert.equal(await query("select blocks is null from public.pages where merchant_id is null and slug='__faolla_qr_tokens__';"), "t");
await query(`update public.pages set blocks='${intact.replaceAll("'", "''")}'::jsonb where merchant_id is null and slug='__faolla_qr_tokens__';
  alter table public.pages alter column blocks set not null;`);
passed("SQL NULL corruption fails closed without a falsely successful reset");

await query("delete from public.pages where merchant_id is null and slug='__faolla_qr_tokens__';");
const [firstCreation, secondCreation] = await race(["merchant", "12345678", "ensure"], ["personal", "87654321", "ensure"]);
assert.deepEqual(await rpc("merchant", "12345678", "ensure"), firstCreation);
assert.deepEqual(await rpc("personal", "87654321", "ensure"), secondCreation);
assert.equal(await query("select count(*) from public.pages where merchant_id is null and slug='__faolla_qr_tokens__';"), "1");
assert.equal(await query("select count(*) from jsonb_object_keys((select blocks->'entries' from public.pages where merchant_id is null and slug='__faolla_qr_tokens__'));"), "2");
passed("concurrent first creation produces one system row with both accounts");

assert.equal(await query("select blocks->>'keep' from public.pages where id='00000000-0000-4000-8000-000000000002';"), "public-home");
assert.equal(await query("select blocks->>'keep' from public.pages where id='00000000-0000-4000-8000-000000000003';"), "merchant-scoped-page");
passed("public home and same-slug merchant pages are untouched");

console.log(`[qr-postgres] ${checks} checks passed; PostgreSQL ${await query("show server_version;")}`);
console.log(`[qr-postgres] isolated test source ${fileURLToPath(import.meta.url)}`);
