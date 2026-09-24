import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expectedDisposablePostgresServerAddress } from "../ci-postgres-service-identity.mjs";

export const DATABASE = "faolla_order_attention_test";
const SITE = "10000000";
const PREFIX = `__merchant_orders__:${SITE}`;
const TABLE = "public.faolla_order_attention_pilot";
const READ = "public.faolla_read_order_attention_v1(text,boolean)";
const PUBLISH = "public.faolla_publish_order_attention_v1(text,uuid,text,jsonb)";
const MIGRATION = "202609240052_order_attention_pilot.sql";

// CI-only, fixed endpoint and database. No application env files or URL/binary
// overrides. Bind the real server address to the existing CI service container.
export function resolveOrderAttentionIntegrationConfig(environment, args = []) {
  if (args.length || environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true" ||
      environment.RUNNER_ENVIRONMENT !== "github-hosted" ||
      environment.ORDER_ATTENTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
    throw new Error("order_attention_disposable_ci_database_required");
  }
  return {
    database: DATABASE,
    serverAddress: expectedDisposablePostgresServerAddress(environment, "5432", "56473"),
    args: ["--host=127.0.0.1", "--port=5432", "--username=postgres", "--no-password", "--no-psqlrc",
      "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=default"],
    env: { PATH: environment.PATH || "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
      PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGPASSFILE: "/dev/null",
      PGOPTIONS: "-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=10000" },
  };
}

export function extractBaselineDdl(init) {
  return [
    /create table if not exists public\.merchants \([\s\S]*?\n\);/i,
    /create table if not exists public\.pages \([\s\S]*?\n\);/i,
    /create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i,
    /create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i,
    /create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i,
  ].map((pattern) => { const ddl = init.match(pattern)?.[0]; assert.ok(ddl, "actual baseline DDL missing"); return ddl; }).join("\n");
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = (value) => `${sqlText(JSON.stringify(value))}::jsonb`;
const readSql = (source = false, site = SITE) => `select public.faolla_read_order_attention_v1(${sqlText(site)},${source});`;
const publishSql = (snapshot, payload) => `select public.faolla_publish_order_attention_v1('${SITE}',${sqlText(snapshot.epoch)}::uuid,${sqlText(snapshot.generation)},${jsonSql(payload)});`;
const commitSql = (mutation) => `select public.faolla_commit_order_membership_v1('${SITE}',${jsonSql(mutation)});`;
const payload = { count: 1, latest: { key: "order:synthetic-1", title: "Synthetic order", body: "Synthetic item",
  url: "/10000000?mobileTab=business&businessSection=orders&appShell=faolla", createdAt: "2026-09-24T10:00:00.000Z" } };

export async function runOrderAttentionIntegration(environment = process.env, args = process.argv.slice(2)) {
  const config = resolveOrderAttentionIntegrationConfig(environment, args);
  const deadline = Date.now() + 240_000;
  const children = new Set();
  let sequence = 0;
  let checks = 0;
  function execute(sql, { database = DATABASE, marker = "", hold = false } = {}) {
    assert.ok(database === DATABASE || database === "postgres", "database is fixed");
    const remaining = deadline - Date.now();
    assert.ok(remaining > 0, "order_attention_acceptance_deadline_exceeded");
    const applicationName = `faolla_order_attention_test_${++sequence}`;
    const child = spawn("psql", [...config.args, `--dbname=${database}`], {
      env: { ...config.env, PGAPPNAME: applicationName }, shell: false, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    let output = "";
    let errorOutput = "";
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    ready.catch(() => undefined);
    const timer = setTimeout(() => child.kill(), Math.min(25_000, remaining));
    const done = new Promise((resolve, reject) => {
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.length > 24_000_000) child.kill();
        if (marker && output.includes(marker)) readyResolve();
      });
      child.stderr.on("data", (data) => { errorOutput += data.toString(); if (errorOutput.length > 65_536) child.kill(); });
      child.stdin.on("error", (error) => { if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code)) reject(error); });
      child.on("error", (error) => { clearTimeout(timer); children.delete(child); readyReject(error); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer); children.delete(child);
        if (marker && !output.includes(marker)) readyReject(new Error(errorOutput || "race_marker_missing"));
        resolve({ code, output: output.trim(), errorOutput });
      });
    });
    done.catch(() => undefined);
    if (hold) child.stdin.write(`${sql}\n`); else child.stdin.end(sql);
    return { done, ready, applicationName, finish: (tail) => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(`${tail}\n`);
    } };
  }
  async function query(sql, options) {
    const result = await execute(sql, options).done;
    assert.equal(result.code, 0, result.errorOutput);
    return result.output;
  }
  const json = async (sql, options) => JSON.parse(await query(sql, options));
  const serviceJson = (sql) => json(`set role service_role; ${sql}`);
  const read = (source = false, site = SITE) => serviceJson(readSql(source, site));
  const publish = (snapshot, value = payload) => serviceJson(publishSql(snapshot, value));
  const pass = (label) => { checks += 1; console.log(`[order-attention-postgres] passed ${label}`); };
  const allPages = () => json("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.pages p;");
  const summary = () => json(`select to_jsonb(s)||jsonb_build_object('generation',generation::text) from ${TABLE} s where merchant_id='${SITE}';`);
  const snapshot = async () => ({ pages: await allPages(), summary: await summary() });
  async function control(enabled) {
    await query(`update ${TABLE} set enabled=${enabled},epoch=gen_random_uuid(),generation=generation+1,payload=null,projected_at=null where merchant_id='${SITE}';`);
  }
  async function ready() {
    const source = await read(true);
    assert.equal(source.state, "source");
    assert.match(source.epoch, /^[a-f0-9-]{36}$/);
    assert.match(source.generation, /^(0|[1-9][0-9]*)$/);
    if ((await read()).state === "ready") return read();
    assert.equal((await publish(source)).state, "published");
    const result = await read();
    assert.equal(result.state, "ready");
    assert.deepEqual(result.payload, payload);
    return result;
  }
  async function invalidated(sql, expectedState = "source") {
    const before = await ready();
    await query(sql); // Separate transaction: deferred capture must have committed.
    const after = await read();
    assert.equal(after.state, expectedState);
    assert.ok(BigInt((await summary()).generation) > BigInt(before.generation));
    assert.equal((await publish(before)).state, "conflict", "late rebuild cannot overwrite newer source");
  }
  async function mutation() {
    const rows = await json(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) order by slug,id),'[]'::jsonb)
      from public.pages where merchant_id='${SITE}' and (slug='${PREFIX}' or starts_with(slug,'${PREFIX}:chunk:'));`);
    const member = await json(`select coalesce((select jsonb_build_object('blocks',blocks,'updated_at',updated_at) from public.pages where merchant_id='${SITE}' and slug='__merchant_memberships__:${SITE}'),'null'::jsonb);`);
    return { orders: { expectedRows: rows, next: rows.flatMap((row) => row.blocks) },
      memberships: { expectedUpdatedAt: member?.updated_at ?? null, next: member?.blocks ?? [] } };
  }
  async function waitBlocked(applicationName) {
    const until = Date.now() + 5000;
    do {
      const blocked = await query(`select exists(select 1 from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a using(pid)
        where a.application_name=${sqlText(applicationName)} and not l.granted and l.locktype in ('advisory','transactionid','tuple','relation'));`);
      if (blocked === "t") return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < until);
    assert.fail("real second PostgreSQL session did not block on the expected lock");
  }
  try {
    // The previous transaction acceptance shares only the disposable cluster.
    // Refuse an existing target instead of dropping/resetting anything.
    const identitySql = `begin read only; select jsonb_build_object('database',current_database(),'user',current_user,
      'address',host(inet_server_addr()),'port',inet_server_port(),'major',current_setting('server_version_num')::integer/10000,
      'dataDirectory',current_setting('data_directory')); rollback;`;
    const identity = await json(identitySql, { database: "postgres" });
    assert.deepEqual(identity, { database: "postgres", user: "postgres", address: config.serverAddress,
      port: 5432, major: 15, dataDirectory: "/var/lib/postgresql/data" });
    assert.equal(await query(`select count(*) from pg_database where datname='${DATABASE}';`, { database: "postgres" }), "0", "refusing existing database");
    await query(`create database ${DATABASE} template template0;`, { database: "postgres" });
    assert.deepEqual(await json(identitySql), { ...identity, database: DATABASE });
    assert.equal(await query(`select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`), "0");
    assert.equal(await query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast';`), "0");
    pass("bound PG15 CI service and fixed newly created empty database");
    const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL(`../supabase-migrations/${MIGRATION}`, import.meta.url), "utf8");
    await query(`create extension pgcrypto;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      end $$;
      create role order_attention_test_untrusted nologin;
      grant usage on schema public to anon,authenticated,service_role,order_attention_test_untrusted;
      ${extractBaselineDdl(init)}
      alter table public.pages enable row level security;
      create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());
      insert into public.merchants(id,name) values('${SITE}','Synthetic pilot'),('22222222','Synthetic unrelated');
      insert into public.pages(merchant_id,slug,blocks) values('${SITE}','home','{"synthetic":"untouched"}'),
        ('22222222','__merchant_orders__:22222222','[]'),(null,'home','{"synthetic":"public"}');`);
    await query(await readFile(new URL("../supabase-migrations/202609080045_order_membership_atomic_mutation.sql", import.meta.url), "utf8"));
    const originalRpc = await query("select pg_get_functiondef('public.faolla_commit_order_membership_v1(text,jsonb)'::regprocedure);");
    const beforeMigration = await allPages();
    await query(migration);
    assert.deepEqual(await allPages(), beforeMigration);
    assert.equal(await query("select pg_get_functiondef('public.faolla_commit_order_membership_v1(text,jsonb)'::regprocedure);"), originalRpc);
    assert.deepEqual(await read(), { state: "disabled" });
    assert.deepEqual(await read(false, "22222222"), { state: "unavailable" });
    assert.equal((await read(true)).state, "source");
    pass("actual init + 045 + 052 preserve source and old commit RPC; pilot starts disabled");

    for (const role of ["anon", "authenticated", "service_role", "order_attention_test_untrusted"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        assert.equal(await query(`select has_table_privilege('${role}','${TABLE}','${privilege}');`), "f");
      }
      for (const fn of [READ, PUBLISH]) {
        assert.equal(await query(`select has_function_privilege('${role}','${fn}','EXECUTE');`), role === "service_role" ? "t" : "f");
      }
      for (const fn of ["faolla_invalidate_order_attention_pilot()", "faolla_clear_order_attention_pilot()", "faolla_order_attention_capture_ready()"]) {
        assert.equal(await query(`select has_function_privilege('${role}','public.${fn}','EXECUTE');`), "f");
      }
      if (role !== "service_role") {
        const rejected = await execute(`set role ${role}; ${readSql()}`).done;
        assert.notEqual(rejected.code, 0); assert.match(rejected.errorOutput, /permission denied for function/);
      }
    }
    assert.equal(await query(`select relrowsecurity from pg_class where oid='${TABLE}'::regclass;`), "t");
    assert.equal(await query(`select count(*) from pg_policy where polrelid='${TABLE}'::regclass;`), "0");
    for (const fn of [READ, PUBLISH]) assert.equal(await query(`select proconfig::text like '%search_path=pg_catalog, public%' from pg_proc where oid='${fn}'::regprocedure;`), "t");
    pass("service-only RPC execution and no browser/service direct table privileges or policies");

    const warmed = await read(true);
    assert.equal((await publish(warmed)).state, "published");
    assert.deepEqual(await read(), { state: "disabled" });
    await control(true);
    assert.equal((await publish(warmed)).state, "conflict");
    await ready();
    const beforeReplay = await allPages();
    const beforeEpoch = await read();
    await query(`grant select on ${TABLE} to order_attention_test_untrusted; grant select(payload) on ${TABLE} to authenticated;
      grant execute on function ${READ} to order_attention_test_untrusted,anon;`);
    await query(migration);
    assert.deepEqual(await allPages(), beforeReplay);
    assert.equal(await query(`select has_table_privilege('order_attention_test_untrusted','${TABLE}','SELECT');`), "f");
    assert.equal(await query(`select has_function_privilege('order_attention_test_untrusted','${READ}','EXECUTE');`), "f");
    assert.equal(await query(`select has_column_privilege('authenticated','${TABLE}','payload','SELECT');`), "f");
    assert.equal(await query(`select has_function_privilege('anon','${READ}','EXECUTE');`), "f");
    assert.equal((await publish(beforeEpoch)).state, "conflict");
    await control(true);
    pass("disabled prewarming, enable epoch CAS, migration replay clears stale projection and unexpected grants");

    await query(`update ${TABLE} set generation=9007199254740993,payload=null,projected_at=null where merchant_id='${SITE}';`);
    const largeGeneration = await read(true);
    assert.equal(largeGeneration.generation, "9007199254740993");
    assert.equal((await publish(largeGeneration)).state, "published");
    assert.equal((await read()).generation, "9007199254740993");
    pass("CAS generation remains an exact decimal string above JavaScript safe integers");

    const initial = { orders: { expectedRows: [], next: [{ id: "synthetic-1", siteId: SITE, status: "pending",
      createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T10:00:00.000Z", items: [], totalAmount: 0, totalQuantity: 0 }] },
      memberships: { expectedUpdatedAt: null, next: [{ id: "synthetic-member", siteId: SITE, status: "active", transactions: [],
        pointBalance: 100, balanceAmount: 0, growthValue: 0 }] } };
    await invalidated(`set role service_role; ${commitSql(initial)}`);
    const next = await mutation();
    next.orders.next[0].status = "confirmed";
    await invalidated(`set role service_role; ${commitSql(next)}`);
    await ready();
    const noOpBefore = await snapshot();
    await serviceJson(commitSql(await mutation()));
    assert.deepEqual(await snapshot(), noOpBefore, "unchanged v1 retry must not dirty the projection");
    const populatedBeforeReplay = await allPages();
    await query(migration);
    assert.deepEqual(await allPages(), populatedBeforeReplay, "replay must preserve populated order/member/history rows byte-for-byte");
    assert.deepEqual(await read(), { state: "disabled" });
    await control(true);
    pass("unchanged v1 order + membership writer invalidates on commit");

    await invalidated(`insert into public.pages(merchant_id,slug,blocks) values('${SITE}','${PREFIX}:chunk:999','[]');`);
    await invalidated(`update public.pages set blocks='[{"synthetic":true}]' where slug='${PREFIX}:chunk:999';`);
    await invalidated(`update public.pages set slug='synthetic-renamed' where slug='${PREFIX}:chunk:999';`);
    await invalidated(`update public.pages set slug='${PREFIX}:chunk:999' where slug='synthetic-renamed';`);
    await invalidated(`update public.pages set merchant_id='22222222' where slug='${PREFIX}:chunk:999';`, "unavailable");
    assert.equal((await read()).state, "unavailable", "wrong-merchant source must refuse projection");
    await query(`delete from public.pages where slug='${PREFIX}:chunk:999';`);
    await ready();
    await invalidated(`insert into public.pages(merchant_id,slug,blocks) values('${SITE}','${PREFIX} ','[]');`, "unavailable");
    const beforeWhitespaceDelete = await summary();
    await query(`delete from public.pages where slug='${PREFIX} ';`);
    assert.equal((await read()).state, "source");
    assert.ok(BigInt((await summary()).generation) > BigInt(beforeWhitespaceDelete.generation));
    await invalidated(`set session_replication_role=replica; update public.pages set blocks=blocks||'[]'::jsonb where slug='${PREFIX}:chunk:0';`);
    const unchanged = await snapshot();
    await query("update public.pages set blocks='[]' where merchant_id='22222222';");
    assert.deepEqual(await summary(), unchanged.summary);
    pass("direct insert/update/delete, rename both directions, owner change, whitespace and replica writes invalidate; unrelated merchant does not");

    await invalidated(`insert into public.pages(merchant_id,slug,blocks)
      select '${SITE}','${PREFIX}:chunk:'||(1000+i)::text,'[]'::jsonb from generate_series(1,513) i;`, "unavailable");
    await query(`delete from public.pages where merchant_id='${SITE}' and slug ~ '^__merchant_orders__:10000000:chunk:1[0-9]{3}$';`);
    assert.equal((await read()).state, "source");
    await invalidated(`insert into public.pages(merchant_id,slug,blocks) values('${SITE}','${PREFIX}:chunk:999',jsonb_build_array(repeat('x',8388609)));`, "unavailable");
    await query(`delete from public.pages where slug='${PREFIX}:chunk:999';`);
    assert.equal((await read()).state, "source");
    await invalidated(`insert into public.pages(merchant_id,slug,blocks) values('${SITE}','${PREFIX}:chunk:999','{}');`, "unavailable");
    await query(`delete from public.pages where slug='${PREFIX}:chunk:999';`);
    assert.equal((await read()).state, "source");
    pass("source over 512 rows, over 8MiB or non-array refuses projection and recovers after synthetic repair");

    for (const failingSlug of [`__merchant_memberships__:${SITE}`, `__merchant_orders_history_v2__:${SITE}`, `__merchant_memberships_history_backup__:${SITE}`]) {
      for (const suppress of [false, true]) {
        await ready();
        const before = await snapshot();
        await query(`create function public.order_attention_test_fail() returns trigger language plpgsql as $$ begin
          if new.slug=${sqlText(failingSlug)} then ${suppress ? "return null;" : "raise exception 'synthetic_joint_failure';"} end if; return new; end $$;
          create trigger z_order_attention_test_fail before insert or update on public.pages for each row execute function public.order_attention_test_fail();`);
        try {
          const failedMutation = await mutation();
          failedMutation.orders.next[0].status = "completed";
          failedMutation.memberships.next[0].pointBalance += 1;
          const result = await execute(`set role service_role; ${commitSql(failedMutation)}`).done;
          assert.notEqual(result.code, 0);
          assert.match(result.errorOutput, /synthetic_joint_failure|order_membership_mutation_not_persisted/);
          assert.deepEqual(await snapshot(), before, "source/history/member/summary must all roll back");
        } finally {
          await query("drop trigger z_order_attention_test_fail on public.pages; drop function public.order_attention_test_fail();");
        }
      }
    }
    const beforeRollback = await snapshot();
    await query(`begin; update public.pages set blocks='[]' where slug='${PREFIX}:chunk:0'; set constraints all immediate; rollback;`);
    assert.deepEqual(await snapshot(), beforeRollback);
    pass("joint membership/history failures, suppressed DML and forced deferred-trigger rollback remain fully atomic");

    await ready();
    const beforeCaptureFailure = await snapshot();
    await query(`create function public.order_attention_test_capture_fail() returns trigger language plpgsql as $$ begin
      raise exception 'synthetic_capture_failure'; end $$;
      create trigger order_attention_test_capture_fail before update on ${TABLE} for each row execute function public.order_attention_test_capture_fail();`);
    try {
      const failedCaptureMutation = await mutation();
      failedCaptureMutation.orders.next[0].customer = { note: "must-roll-back-capture" };
      failedCaptureMutation.memberships.next[0].pointBalance += 1;
      const rejected = await execute(`set role service_role; ${commitSql(failedCaptureMutation)}`).done;
      assert.notEqual(rejected.code, 0);
      assert.match(rejected.errorOutput, /synthetic_capture_failure/);
      assert.deepEqual(await snapshot(), beforeCaptureFailure, "deferred capture exception must roll back the complete old v1 transaction");
    } finally {
      await query(`drop trigger order_attention_test_capture_fail on ${TABLE}; drop function public.order_attention_test_capture_fail();`);
    }
    pass("derived summary update failure at deferred commit rolls back order/member/history/summary together");

    const shared = await mutation();
    const firstChange = structuredClone(shared);
    const secondChange = structuredClone(shared);
    firstChange.orders.next[0].customer = { note: "first-old-v1-writer" };
    secondChange.orders.next[0].customer = { note: "second-old-v1-writer" };
    firstChange.memberships.next[0].pointBalance += 1;
    secondChange.memberships.next[0].pointBalance += 2;
    const firstWriter = execute(`begin; set local role service_role; ${commitSql(firstChange)} select '__OLD_V1_HELD__';`, { marker: "__OLD_V1_HELD__", hold: true });
    try {
      await firstWriter.ready;
      const secondWriter = execute(`set role service_role; ${commitSql(secondChange)}`);
      await waitBlocked(secondWriter.applicationName);
      firstWriter.finish("commit;");
      const [accepted, rejected] = await Promise.all([firstWriter.done, secondWriter.done]);
      assert.equal(accepted.code, 0, accepted.errorOutput);
      assert.notEqual(rejected.code, 0);
      assert.match(rejected.errorOutput, /order_update_conflict/);
      const persisted = await mutation();
      assert.equal(persisted.orders.next[0].customer.note, "first-old-v1-writer");
      assert.equal(persisted.memberships.next[0].pointBalance, firstChange.memberships.next[0].pointBalance);
      assert.equal((await read()).state, "source");
    } catch (error) { firstWriter.finish("rollback;"); throw error; }
    pass("two unchanged old v1 writers from one CAS snapshot commit once and reject the loser with capture installed");

    // Future chunk INSERT then existing-chunk upsert in one direct transaction.
    // An immediate invalidation would hold summary while the v1 writer owns
    // the existing chunk: the inverse lock order below could deadlock. Deferred
    // capture lets v1 reach its marker first and release the chunk at COMMIT.
    await ready();
    const chunkWriterMutation = await mutation();
    chunkWriterMutation.orders.next[0].customer = { note: "v1-with-future-direct-chunk" };
    const directChunks = execute(`begin; insert into public.pages(merchant_id,slug,blocks) values('${SITE}','${PREFIX}:chunk:1','[]'); select '__FUTURE_CHUNK_HELD__';`, { marker: "__FUTURE_CHUNK_HELD__", hold: true });
    let chunkWriter;
    try {
      await directChunks.ready;
      chunkWriter = execute(`begin; set local role service_role; ${commitSql(chunkWriterMutation)} select '__V1_CHUNK_HELD__';`, { marker: "__V1_CHUNK_HELD__", hold: true });
      await chunkWriter.ready;
      directChunks.finish(`insert into public.pages as existing(merchant_id,slug,blocks) values('${SITE}','${PREFIX}:chunk:0','[]')
        on conflict(merchant_id,slug) where merchant_id is not null do update set blocks=existing.blocks; commit;`);
      await waitBlocked(directChunks.applicationName);
      chunkWriter.finish("commit;");
      for (const result of await Promise.all([directChunks.done, chunkWriter.done])) assert.equal(result.code, 0, result.errorOutput);
      assert.equal((await mutation()).orders.next[0].customer.note, "v1-with-future-direct-chunk");
      assert.equal((await read()).state, "source");
    } catch (error) { directChunks.finish("rollback;"); chunkWriter?.finish("rollback;"); throw error; }
    await query(`delete from public.pages where merchant_id='${SITE}' and slug='${PREFIX}:chunk:1';`);
    pass("direct future-chunk insert plus existing-chunk upsert and old v1 writer avoid source/summary lock inversion");

    // Hold the summary row in one session. Another session must reach its
    // commit-time capture without holding a summary lock while acquiring pages.
    await control(true);
    const raceSource = await read(true);
    const publisher = execute(`begin; set local role service_role; ${publishSql(raceSource, payload)} select '__SUMMARY_HELD__';`, { marker: "__SUMMARY_HELD__", hold: true });
    try {
      await publisher.ready;
      const writerMutation = await mutation();
      writerMutation.orders.next[0].status = "pending";
      writerMutation.memberships.next[0].pointBalance += 1;
      const writer = execute(`set role service_role; ${commitSql(writerMutation)}`);
      await waitBlocked(writer.applicationName);
      publisher.finish("commit;");
      for (const result of await Promise.all([publisher.done, writer.done])) assert.equal(result.code, 0, result.errorOutput);
      assert.equal((await read()).state, "source");
      assert.equal((await publish(raceSource)).state, "conflict");
    } catch (error) { publisher.finish("rollback;"); throw error; }
    pass("two real sessions: publisher holds summary; legacy joint writer commits after it and invalidates without deadlock");

    // Conversely, an uncommitted source writer can coexist with an old MVCC
    // snapshot publication: its later commit must invalidate that publication.
    await control(true);
    const beforeWriter = await read(true);
    const direct = execute(`begin; update public.pages set blocks=blocks||'[]'::jsonb where slug='${PREFIX}:chunk:0'; select '__SOURCE_HELD__';`, { marker: "__SOURCE_HELD__", hold: true });
    try {
      await direct.ready;
      assert.equal((await publish(beforeWriter)).state, "published");
      direct.finish("commit;");
      const result = await direct.done; assert.equal(result.code, 0, result.errorOutput);
      assert.equal((await read()).state, "source");
      assert.equal((await publish(beforeWriter)).state, "conflict");
    } catch (error) { direct.finish("rollback;"); throw error; }
    pass("reverse two-session race: source-before-publish commit invalidates old MVCC projection");

    for (const trigger of ["faolla_order_attention_invalidate", "faolla_order_attention_clear"]) {
      await ready();
      await query(`alter table public.pages disable trigger ${trigger};`);
      assert.deepEqual(await read(), { state: "unavailable" });
      assert.deepEqual(await read(true), { state: "unavailable" });
      await query(`alter table public.pages enable always trigger ${trigger};`);
      // Trigger repair requires an explicit epoch reset, not mere re-enable.
      await control(true);
    }
    const staleEpoch = await ready();
    await control(false);
    assert.deepEqual(await read(), { state: "disabled" });
    await control(true);
    assert.equal((await publish(staleEpoch)).state, "conflict");
    // Synthetic privileged-restore ABA: even restoring an old counter value
    // cannot make an old worker publish across a different epoch.
    await query(`update ${TABLE} set generation=${sqlText(staleEpoch.generation)}::bigint where merchant_id='${SITE}';`);
    const resetSource = await read(true);
    assert.equal(resetSource.generation, staleEpoch.generation);
    assert.notEqual(resetSource.epoch, staleEpoch.epoch);
    assert.equal((await publish(staleEpoch)).state, "conflict");
    for (const malformed of [{ count: -1, latest: null }, { count: 1, latest: null }, { count: 0, latest: null, orders: [] }]) {
      const result = await execute(`set role service_role; ${publishSql(await read(true), malformed)}`).done;
      assert.notEqual(result.code, 0); assert.match(result.errorOutput, /invalid_order_attention_payload/);
    }
    pass("disabled capture refuses read, reset/disable/re-enable reject old epoch, payload contract rejects malformed data");

    const merchantToken = await ready();
    await query(`delete from public.merchants where id='${SITE}';`);
    assert.deepEqual(await read(), { state: "unavailable" });
    assert.deepEqual(await read(true), { state: "unavailable" });
    assert.equal((await publish(merchantToken)).state, "unavailable");
    await query(`insert into public.merchants(id,name) values('${SITE}','Synthetic pilot');`);
    await control(true);
    assert.equal((await publish(merchantToken)).state, "conflict");
    pass("missing merchant refuses even ready data; explicit restore reset rejects the prior epoch");

    await invalidated("set session_replication_role=replica; truncate table public.pages;");
    assert.deepEqual((await read(true)).rows, []);
    const empty = await read(true);
    assert.equal((await publish(empty, { count: 0, latest: null })).state, "published");
    assert.deepEqual((await read()).payload, { count: 0, latest: null });
    assert.equal(await query("select pg_get_functiondef('public.faolla_commit_order_membership_v1(text,jsonb)'::regprocedure);"), originalRpc);
    pass("ALWAYS TRUNCATE capture survives replica mode and accepts an empty derived projection");
    console.log(JSON.stringify({ status: "passed", checks, database: DATABASE, migration: MIGRATION }));
    return { checks };
  } finally {
    // Only the exact psql children created by this invocation, never services.
    for (const child of children) child.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runOrderAttentionIntegration(); }
  catch (error) { console.error(`[order-attention-postgres] ${error.message}`); process.exitCode = 1; }
}
