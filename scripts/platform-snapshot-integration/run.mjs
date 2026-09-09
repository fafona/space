import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SCOPE_SLUGS, writesFor } from "./fixtures.mjs";

// Deliberately standalone: no app env files, credentials, automatic reset or CI exception.
if (process.env.PLATFORM_SNAPSHOT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
  throw new Error("Set PLATFORM_SNAPSHOT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 for the dedicated empty synthetic database");
}
const port = process.env.PLATFORM_SNAPSHOT_TEST_PORT || "56471";
assert.equal(port, "56471", "Only the dedicated local test port is accepted");
const psql = process.env.PLATFORM_SNAPSHOT_TEST_PSQL || (process.platform === "win32" ? "C:\\upos-runtime\\pgsql\\bin\\psql.exe" : "psql");
const db = "faolla_platform_snapshot_test";
const args = ["--host=127.0.0.1", `--port=${port}`, "--username=postgres", `--dbname=${db}`,
  "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"];
// Explicit child environment: do not pass app secrets, PG services or passwords.
const childEnv = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
Object.assign(childEnv, { PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGCLIENTENCODING: "UTF8",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=12000" });
const active = new Set(); let sequence = 0; let checks = 0;
const prefix = "[platform-snapshot-postgres]";
function passed(label) { checks++; console.log(`${prefix} passed ${label}`); }
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function sqlJson(value) { return `${sqlText(JSON.stringify(value))}::jsonb`; }
function execute(sql, { marker = "", hold = false } = {}) {
  const applicationName = `faolla_platform_snapshot_test_${++sequence}`;
  const child = spawn(psql, args, { env: { ...childEnv, PGAPPNAME: applicationName }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  active.add(child); let output = ""; let errorOutput = ""; let ended = false;
  let readyResolve; let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); ready.catch(() => undefined);
  const timer = setTimeout(() => child.kill(), 35000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { output += chunk.toString(); if (marker && output.includes(marker)) readyResolve(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") reject(error); });
    child.on("error", (error) => { clearTimeout(timer); active.delete(child); readyReject(error); reject(error); });
    child.on("close", (code) => {
      ended = true; clearTimeout(timer); active.delete(child);
      if (marker && !output.includes(marker)) readyReject(new Error(errorOutput || "transaction_marker_missing"));
      resolve({ code, output: output.trim(), errorOutput });
    });
  });
  done.catch(() => undefined);
  if (hold) child.stdin.write(`${sql}\n`); else child.stdin.end(sql);
  return { done, ready, applicationName, finish(tail) { if (!ended && !child.stdin.writableEnded) child.stdin.end(`${tail}\n`); } };
}
async function query(sql) {
  const result = await execute(sql).done; assert.equal(result.code, 0, result.errorOutput); return result.output;
}
function objectResult(output) {
  const line = output.split(/\r?\n/).find((item) => item.startsWith("{"));
  assert.ok(line, "RPC must return an object"); return JSON.parse(line);
}
const reader = "public.faolla_read_platform_snapshot_rows_v1(text)";
const writer = "public.faolla_commit_platform_snapshot_rows_v1(text,jsonb,jsonb)";
function readSql(scope) { return `select public.faolla_read_platform_snapshot_rows_v1(${sqlText(scope)});`; }
function commitSql(scope, expected, writes) {
  return `select public.faolla_commit_platform_snapshot_rows_v1(${sqlText(scope)},${sqlJson(expected)},${sqlJson(writes)});`;
}
async function rpc(sql) { return objectResult(await query(`set role service_role; ${sql}`)); }
async function readScope(scope) {
  const result = await rpc(readSql(scope));
  assert.equal(result.version, 1); assert.equal(result.scope, scope); assert.ok(Array.isArray(result.rows));
  assert.deepEqual(result.rows.map((item) => item.slug), SCOPE_SLUGS[scope]);
  return result.rows;
}
async function commit(scope, expected, writes) {
  const result = await rpc(commitSql(scope, expected, writes));
  assert.equal(result.version, 1); assert.equal(result.scope, scope); assert.ok(Array.isArray(result.rows));
  assert.deepEqual(result.rows.map((item) => item.slug), SCOPE_SLUGS[scope]); return result.rows;
}
async function allPages() {
  return JSON.parse(await query("select coalesce(jsonb_agg(to_jsonb(p) order by merchant_id nulls first,slug,id),'[]'::jsonb) from public.pages p;"));
}
async function rejectedUnchanged(sql, pattern = /platform_snapshot_atomic_/) {
  const before = await allPages(); const result = await execute(`set role service_role; ${sql}`).done;
  assert.notEqual(result.code, 0, "Invalid/conflicting mutation unexpectedly succeeded"); assert.match(result.errorOutput, pattern);
  assert.deepEqual(await allPages(), before, "Failed operation changed a page, history, backup or timestamp");
}
async function waitForBlocked(applicationName) {
  const deadline = Date.now() + 9000;
  do {
    const blocked = await query(`select exists(select 1 from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a using(pid)
      where a.application_name=${sqlText(applicationName)} and not l.granted and l.locktype in ('advisory','transactionid','tuple'));`);
    if (blocked === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail("Second independent session did not reach a real PostgreSQL lock wait");
}
async function race(firstSql, secondSql, expectedConflict) {
  const marker = "__PLATFORM_SNAPSHOT_TRANSACTION_HELD__";
  const first = execute(`begin; set local role service_role; ${firstSql} select '${marker}';`, { marker, hold: true });
  let second;
  try {
    await first.ready; second = execute(`set role service_role; ${secondSql}`);
    await waitForBlocked(second.applicationName); first.finish("commit;");
    const results = await Promise.allSettled([first.done, second.done]);
    assert.ok(results.every((result) => result.status === "fulfilled"));
    const [left, right] = results.map((result) => result.value);
    assert.equal(left.code, 0, left.errorOutput);
    if (expectedConflict) { assert.notEqual(right.code, 0); assert.match(right.errorOutput, expectedConflict); }
    else assert.equal(right.code, 0, right.errorOutput);
    return { left, right };
  } finally {
    first.finish("rollback;"); await Promise.allSettled([first.done, ...(second ? [second.done] : [])]);
  }
}
async function insertSynthetic(slug, blocks, owner = null) {
  return query(`insert into public.pages(merchant_id,slug,blocks) values(${owner === null ? "null" : sqlText(owner)},${sqlText(slug)},${sqlJson(blocks)}) returning id;`);
}
async function removeSyntheticIds(ids) {
  // Only IDs returned by this runner's own synthetic INSERT; never a broad reset.
  assert.ok(ids.length && ids.every((id) => /^[0-9a-f-]{36}$/i.test(id)));
  await query(`delete from public.pages where id in (${ids.map(sqlText).join(",")});`);
}
const mutation = (reference) => `case when jsonb_typeof(${reference})='array' then ${reference} || '[{"syntheticTamper":true}]'::jsonb
  else ${reference} || '{"syntheticTamper":true}'::jsonb end`;
const candidateUrl = new URL("./platform_snapshot_atomic_v1.candidate.sql", import.meta.url);

try {
  assert.equal(await query("select current_database();"), db);
  assert.equal(await query("select current_user;"), "postgres");
  assert.equal(await query("select host(inet_server_addr());"), "127.0.0.1");
  assert.equal(await query("select inet_server_port();"), port);
  const expectedData = await realpath(fileURLToPath(new URL("../../.runtime/platform-snapshot-test-pg", import.meta.url)));
  const actualData = await realpath(await query("show data_directory;"));
  const normalized = (value) => process.platform === "win32" ? value.replaceAll("\\", "/").toLowerCase() : value;
  assert.equal(normalized(actualData), normalized(expectedData), "Refusing another PostgreSQL data directory");
  assert.equal(await query(`select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`), "0", "Refusing a non-empty database");
  assert.equal(await query(`select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public';`), "0", "Refusing pre-existing public functions");
  const candidate = await readFile(candidateUrl, "utf8");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  function ddl(pattern, label) { const found = init.match(pattern)?.[0]; assert.ok(found, `Missing actual ${label} DDL`); return found; }
  await query(`create extension pgcrypto;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if not exists(select 1 from pg_roles where rolname='platform_snapshot_test_untrusted') then create role platform_snapshot_test_untrusted nologin; end if;
    end $$;
    ${ddl(/create table if not exists public\.pages \([\s\S]*?\n\);/i, "pages")}
    ${ddl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i, "timestamp function")}
    ${ddl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i, "timestamp trigger")}
    ${ddl(/create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i, "merchant slug index")}
    alter table public.pages enable row level security;
    grant usage on schema public to anon,authenticated,service_role,platform_snapshot_test_untrusted;
    insert into public.pages(merchant_id,slug,blocks) values(null,'home','{"keep":"public-home"}'),('10000000','home','{"keep":"merchant-home"}');`);
  const untouched = await allPages();
  for (const kind of ["duplicate", "foreign-owner"]) {
    const slug = SCOPE_SLUGS.user_manage[0]; const ids = [];
    ids.push(await insertSynthetic(slug, [], kind === "foreign-owner" ? "10000099" : null));
    if (kind === "duplicate") ids.push(await insertSynthetic(slug, []));
    const before = await allPages(); const result = await execute(candidate).done;
    assert.notEqual(result.code, 0, `${kind} installation should fail`);
    assert.match(result.errorOutput, /platform_snapshot_atomic_install_conflict/);
    assert.deepEqual(await allPages(), before); await removeSyntheticIds(ids);
  }
  await query("create index pages_platform_snapshot_atomic_unique_idx on public.pages(id);");
  const indexConflict = await execute(candidate).done;
  assert.notEqual(indexConflict.code, 0); assert.match(indexConflict.errorOutput, /platform_snapshot_atomic_install_conflict/);
  await query("drop index public.pages_platform_snapshot_atomic_unique_idx;");
  await query(candidate);
  passed("candidate installation rejects duplicate/foreign-owner physical rows and applies only to the verified synthetic instance");
  for (const scope of Object.keys(SCOPE_SLUGS)) assert.ok((await readScope(scope)).every((item) => item.row === null));
  for (const fn of [reader, writer]) {
    for (const role of ["anon", "authenticated", "platform_snapshot_test_untrusted", "service_role"]) {
      assert.equal(await query(`select has_function_privilege(${sqlText(role)},${sqlText(fn)},'EXECUTE');`), role === "service_role" ? "t" : "f");
    }
    assert.equal(await query(`select prosecdef from pg_proc where oid=${sqlText(fn)}::regprocedure;`), "t");
    assert.match(await query(`select proconfig::text from pg_proc where oid=${sqlText(fn)}::regprocedure;`), /search_path=pg_catalog, public/);
  }
  for (const role of ["anon", "authenticated", "platform_snapshot_test_untrusted"]) {
    for (const sql of [readSql("user_manage"), commitSql("user_manage", [], [])]) {
      const result = await execute(`set role ${role}; ${sql}`).done;
      assert.notEqual(result.code, 0); assert.match(result.errorOutput, /permission denied for function/);
    }
  }
  passed("service-only security-definer RPCs enforce fixed search paths and denied direct calls by untrusted roles");

  const missing = await readScope("backup_catalog");
  await race(commitSql("backup_catalog", missing, writesFor("backup_catalog", "missing-first")),
    commitSql("backup_catalog", missing, writesFor("backup_catalog", "missing-second")), /platform_snapshot_atomic_conflict/);
  assert.equal((await allPages()).filter((row) => SCOPE_SLUGS.backup_catalog.includes(row.slug)).length, 2);
  passed("two sessions preparing missing rows wait on a real lock; only one complete insert set commits");

  for (const scope of Object.keys(SCOPE_SLUGS)) {
    const expected = await readScope(scope); const writes = writesFor(scope, `roundtrip-${scope}`);
    const result = await commit(scope, expected, writes);
    assert.deepEqual(result.map(({ slug, row }) => ({ slug, blocks: row.blocks })), writes);
    assert.deepEqual(await readScope(scope), result);
    const before = await allPages(); const unchanged = result.map(({ slug, row }) => ({ slug, blocks: row.blocks }));
    assert.deepEqual(await commit(scope, result, unchanged), result); assert.deepEqual(await allPages(), before);
  }
  passed("all three scopes preserve physical arrays/objects, unknown fields and history-only data; no-op retains IDs and timestamps");

  const snapshot = await readScope("user_manage");
  await race(commitSql("user_manage", snapshot, writesFor("user_manage", "winner")),
    commitSql("user_manage", snapshot, writesFor("user_manage", "loser")), /platform_snapshot_atomic_conflict/);
  const latest = await readScope("user_manage");
  await rejectedUnchanged(commitSql("user_manage", snapshot, latest.map(({ slug, row }) => ({ slug, blocks: row.blocks }))), /platform_snapshot_atomic_conflict/);
  for (const field of ["id", "blocks", "updatedAt"]) {
    const expected = structuredClone(latest);
    expected[0].row[field] = field === "id" ? "00000000-0000-0000-0000-000000000001" : field === "blocks" ? [] : "2000-01-01T00:00:00.000Z";
    await rejectedUnchanged(commitSql("user_manage", expected, writesFor("user_manage", "invalid-cas")), /platform_snapshot_atomic_conflict/);
  }
  passed("stale full snapshots and mismatched identity/blocks/version fail CAS, including an otherwise no-op write");

  for (const kind of ["unknown-scope", "missing-expected", "missing-write", "duplicate-expected", "duplicate-write", "extra-field", "wrong-owner", "bad-block-shape", "unknown-slug", "wrong-id-shape"]) {
    const scope = "support_messages"; const expected = await readScope(scope); const writes = writesFor(scope, "invalid");
    let requestedScope = scope;
    if (kind === "unknown-scope") requestedScope = "all_database";
    if (kind === "missing-expected") expected.pop(); if (kind === "missing-write") writes.pop();
    if (kind === "duplicate-expected") expected[1] = expected[0]; if (kind === "duplicate-write") writes[1] = writes[0];
    if (kind === "extra-field") writes[0].unapproved = true;
    if (kind === "wrong-owner") expected[0].row.merchantId = "10000000";
    if (kind === "bad-block-shape") writes[0].blocks = typeof writes[0].blocks === "object" && !Array.isArray(writes[0].blocks) ? [] : {};
    if (kind === "unknown-slug") writes[0].slug = "home";
    if (kind === "wrong-id-shape") expected[0].row.id = 123;
    await rejectedUnchanged(commitSql(requestedScope, expected, writes), /platform_snapshot_atomic_invalid_request/);
  }
  passed("malformed scope, incomplete/duplicate sets, unknown keys/ownership, bad row and document shape never write");

  for (const scope of Object.keys(SCOPE_SLUGS)) for (const slug of SCOPE_SLUGS[scope]) for (const kind of ["raise", "suppress", "tamper", "replace-id"]) {
    const expected = await readScope(scope); const writes = writesFor(scope, `fault-${scope}-${slug}-${kind}`);
    const action = kind === "raise" ? "raise exception 'synthetic_snapshot_failure';" : kind === "suppress" ? "return null;"
      : kind === "replace-id" ? "new.id := gen_random_uuid();" : `new.blocks := ${mutation("new.blocks")};`;
    await query(`create function public.platform_snapshot_test_failure() returns trigger language plpgsql as $$ begin
      if new.merchant_id is null and new.slug=${sqlText(slug)} then ${action} end if; return new; end $$;
      create trigger platform_snapshot_test_failure before insert or update on public.pages for each row execute function public.platform_snapshot_test_failure();`);
    try { await rejectedUnchanged(commitSql(scope, expected, writes), kind === "raise" ? /synthetic_snapshot_failure|platform_snapshot_atomic_write_unconfirmed/ : /platform_snapshot_atomic_write_unconfirmed/); }
    finally { await query("drop trigger platform_snapshot_test_failure on public.pages; drop function public.platform_snapshot_test_failure();"); }
  }
  passed("raised, suppressed, body-tampered and ID-replacing writes at all 11 boundaries roll back every page/history/backup/timestamp");

  for (const scope of Object.keys(SCOPE_SLUGS)) {
    const expected = await readScope(scope); const writes = writesFor(scope, "after-last-write");
    const first = SCOPE_SLUGS[scope][0]; const last = SCOPE_SLUGS[scope].at(-1);
    await query(`create function public.platform_snapshot_test_after() returns trigger language plpgsql as $$ begin
      if new.merchant_id is null and new.slug=${sqlText(last)} and pg_trigger_depth()=1 then
        update public.pages set blocks=${mutation("blocks")} where merchant_id is null and slug=${sqlText(first)};
      end if; return new; end $$;
      create trigger platform_snapshot_test_after after insert or update on public.pages for each row execute function public.platform_snapshot_test_after();`);
    try { await rejectedUnchanged(commitSql(scope, expected, writes), /platform_snapshot_atomic_write_unconfirmed/); }
    finally { await query("drop trigger platform_snapshot_test_after on public.pages; drop function public.platform_snapshot_test_after();"); }
  }
  passed("last-row AFTER triggers cannot alter an earlier row and escape whole-scope rollback");

  const timestampScope = "user_manage";
  await query(`create function public.platform_snapshot_test_stamp_before() returns trigger language plpgsql as $$ begin
    if pg_trigger_depth()>1 then new.updated_at := new.updated_at + interval '1 second'; end if; return new; end $$;
    create trigger zzz_platform_snapshot_test_stamp_before before update on public.pages for each row execute function public.platform_snapshot_test_stamp_before();
    create function public.platform_snapshot_test_stamp_after() returns trigger language plpgsql as $$ begin
      if new.slug=${sqlText(SCOPE_SLUGS[timestampScope].at(-1))} and pg_trigger_depth()=1 then
        update public.pages set updated_at=updated_at where merchant_id is null and slug=${sqlText(SCOPE_SLUGS[timestampScope][0])};
      end if; return new; end $$;
    create trigger platform_snapshot_test_stamp_after after update on public.pages for each row execute function public.platform_snapshot_test_stamp_after();`);
  try { await rejectedUnchanged(commitSql(timestampScope, await readScope(timestampScope), writesFor(timestampScope, "timestamp-only-tamper")), /platform_snapshot_atomic_write_unconfirmed/); }
  finally { await query(`drop trigger zzz_platform_snapshot_test_stamp_before on public.pages;
    drop trigger platform_snapshot_test_stamp_after on public.pages;
    drop function public.platform_snapshot_test_stamp_before(); drop function public.platform_snapshot_test_stamp_after();`); }
  passed("late timestamp-only tampering of an earlier row is detected even when all document bodies and IDs match");

  const foreignSlug = SCOPE_SLUGS.support_messages[0];
  const foreignId = await insertSynthetic(foreignSlug, [], "10000099");
  try {
    await rejectedUnchanged(readSql("support_messages"), /platform_snapshot_atomic_store_corrupt/);
    await rejectedUnchanged(commitSql("support_messages", [], []), /platform_snapshot_atomic_(store_corrupt|invalid_request)/);
  } finally { await removeSyntheticIds([foreignId]); }
  const duplicate = await execute(`insert into public.pages(merchant_id,slug,blocks) values(null,${sqlText(foreignSlug)},'[]');`).done;
  assert.notEqual(duplicate.code, 0); assert.match(duplicate.errorOutput, /duplicate key|unique constraint/);
  passed("runtime foreign ownership is rejected and the partial unique index prevents duplicate protected null-owner rows");

  // Negative boundary: a powerful legacy writer does not participate in the RPC
  // CAS/advisory protocol. Row locking delays it but cannot forbid its later write.
  const oldWriterScope = "backup_catalog"; const prepared = await readScope(oldWriterScope);
  const marker = "__LEGACY_BOUNDARY_HELD__";
  const first = execute(`begin; set local role service_role; ${commitSql(oldWriterScope, prepared, writesFor(oldWriterScope, "new-writer"))} select '${marker}';`, { marker, hold: true });
  let legacy;
  try {
    await first.ready;
    legacy = execute(`update public.pages set blocks='[{"legacyBypass":true}]'::jsonb where merchant_id is null and slug=${sqlText(SCOPE_SLUGS[oldWriterScope][0])};`);
    await waitForBlocked(legacy.applicationName); first.finish("commit;");
    const [left, right] = await Promise.all([first.done, legacy.done]); assert.equal(left.code, 0, left.errorOutput); assert.equal(right.code, 0, right.errorOutput);
    assert.deepEqual((await readScope(oldWriterScope))[0].row.blocks, [{ legacyBypass: true }]);
  } finally { first.finish("rollback;"); await Promise.allSettled([first.done, ...(legacy ? [legacy.done] : [])]); }
  passed("negative boundary reproduced: uncoordinated direct writer can overwrite after RPC commit; advisory locking alone is not cutover");

  for (const fn of [reader, writer]) await query(`grant execute on function ${fn} to platform_snapshot_test_untrusted;`);
  const beforeReplay = await allPages(); await query(candidate); assert.deepEqual(await allPages(), beforeReplay);
  for (const fn of [reader, writer]) assert.equal(await query(`select has_function_privilege('platform_snapshot_test_untrusted',${sqlText(fn)},'EXECUTE');`), "f");
  for (const page of untouched) assert.deepEqual((await allPages()).find((row) => row.id === page.id), page);
  passed("candidate reapplication is content-preserving and unrelated public/merchant pages stay untouched");
  console.log(`${prefix} ${checks} groups passed; PostgreSQL ${await query("show server_version;")}`);
  console.log(`${prefix} candidate SHA-256 ${createHash("sha256").update(candidate).digest("hex")}`);
  console.log(`${prefix} synthetic transaction/physical-CAS/ACL evidence only; no app cutover, real HTTP/Auth, production migration, deployment or disaster recovery`);
} finally {
  for (const child of active) child.kill();
}
