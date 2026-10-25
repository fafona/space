// Operational PostgreSQL acceptance, not a dependency-free unit test. Run via
// test:booking-atomic:postgres with a separately prepared, pinned TEMP runtime.
// No skip mode or production database URL is accepted by this entry point.
// Install pinned test dependencies in a separate TEMP directory (not the app):
// npm install --prefix <temp>/faolla-booking-pg-... --ignore-scripts --no-audit --no-fund
//   @embedded-postgres/windows-x64@17.10.0-beta.17 pg@8.23.1
// Set FAOLLA_BOOKING_TEST_RUNTIME_DIR to that directory; run with node --import tsx --test.
// Leaves a STOPPED synthetic cluster and logs in TEMP for diagnosis; no services,
// firewall changes, production credentials, production migrations or real mail.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import atomicPreparation from "../src/lib/merchantBookingAtomicPreparation.server.ts";
import bookingCore from "../src/lib/merchantBookings.ts";
const { bookingAtomicCommandIdentity, executeAtomicBookingCommand } = atomicPreparation;
const { getMerchantBookingSlotCapacityIssue } = bookingCore;

const exec = promisify(execFile);
const runtime = path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR || ".missing-test-runtime");
const relative = path.relative(tmpdir(), runtime);
assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative)
  && path.basename(runtime).startsWith("faolla-booking-pg-"), "test runtime must be a dedicated faolla-booking-pg-* TEMP directory");
const requireTest = createRequire(path.join(runtime, "test-loader.cjs"));
const { Client } = requireTest("pg");
const pgRoot = path.join(runtime, "node_modules", "@embedded-postgres", "windows-x64");
assert.equal(JSON.parse(await readFile(path.join(pgRoot, "package.json"), "utf8")).version, "17.10.0-beta.17");
assert.equal(JSON.parse(await readFile(path.join(runtime, "node_modules/pg/package.json"), "utf8")).version, "8.23.1");
const binaries = await import(pathToFileURL(path.join(pgRoot, "dist/index.js")).href);
const evidence = await mkdtemp(path.join(tmpdir(), "faolla-booking-atomic-test-"));
const cluster = path.join(evidence, "cluster");
let started = false;
let admin;
const connections = [];
let config;
const root = path.resolve(import.meta.dirname, "..");
const owner = "__faolla_booking_persistence__";
const primary = "__merchant_booking_records__:v1";
let passed = 0;

async function connect(role) {
  const client = new Client(config);
  await client.connect();
  connections.push(client);
  if (role) await client.query(`set role ${role}`); // Only hardcoded test roles below.
  return client;
}
const one = async (client, query, args = []) => (await client.query(query, args)).rows[0];
function identity(nonce = randomUUID(), semanticInput = { operation: "create" }, siteId = "shop") {
  return { siteId, principalScope: "synthetic:customer", nonce, semanticInput };
}
function rpc(client) {
  return async (name, args) => {
    assert.ok(["faolla_booking_atomic_snapshot_v1", "faolla_booking_atomic_commit_v1"].includes(name));
    const values = [args.p_site_id, args.p_command_key, args.p_request_hash];
    if (name.includes("commit")) values.push(args.p_mutation);
    try {
      const result = await one(client, `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) as data`, values);
      return { data: result.data, error: null };
    } catch (error) { return { data: null, error: { message: error.message } }; }
  };
}
const snapshot = async (client, ident) => {
  const result = await rpc(client)("faolla_booking_atomic_snapshot_v1", bookingAtomicCommandIdentity(ident));
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
const records = (snap) => structuredClone(snap.rows.find((row) => row.slug === primary).blocks.records);
function booking(id, siteId = "shop") {
  return { id, siteId, createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z",
    appointmentAt: "2030-02-01T12:00", status: "active", editToken: "a".repeat(36), customerName: "Synthetic" };
}
function mutation(snap, next, mailJobs = [], result = { bookingId: next.at(-1)?.id }) {
  return { generation: snap.generation, revision: snap.revision, rows: snap.rows,
    next: { version: 1, records: next }, mailJobs, result };
}
async function commit(client, ident, value) {
  const result = await rpc(client)("faolla_booking_atomic_commit_v1", { ...bookingAtomicCommandIdentity(ident), p_mutation: value });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
const mail = (id) => ({ bookingId: id, kind: "status", message: { recipient: "synthetic@example.invalid", status: "active" } });
async function check(name, body) { await body(); passed++; console.log(`[booking-atomic-pg] PASS ${name}`); }

before(async () => {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  await exec(binaries.initdb, ["-D", cluster, "-U", "booking_test_admin", "-A", "trust", "--encoding=UTF8", "--locale=C"], { windowsHide: true, timeout: 60000 });
  await exec(binaries.pg_ctl, ["-D", cluster, "-l", path.join(evidence, "postgres.log"), "-w", "-t", "30", "-o",
    `-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`, "start"], { windowsHide: true, timeout: 45000 });
  started = true;
  config = { host: "127.0.0.1", port, user: "booking_test_admin", database: "postgres", connectionTimeoutMillis: 5000,
    statement_timeout: 10000, query_timeout: 15000, application_name: "faolla-booking-isolated-test" };
  admin = await connect();
  assert.equal((await one(admin, "show data_directory")).data_directory.replaceAll("\\", "/").toLowerCase(), cluster.replaceAll("\\", "/").toLowerCase());
  await admin.query("create database faolla_booking_atomic_test");
  config.database = "faolla_booking_atomic_test";
  await admin.end();
  connections.splice(connections.indexOf(admin), 1);
  admin = await connect();
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.pages(id uuid primary key default gen_random_uuid(), merchant_id text, slug text, blocks jsonb, updated_at timestamptz default now());
    create table public.faolla_schema_migrations(version bigint primary key, name text not null);
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on public.pages to service_role;
    create function public.set_pages_updated_at() returns trigger language plpgsql as $$begin new.updated_at = now(); return new; end;$$;
    create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_pages_updated_at();
  `);
  await admin.query("insert into pages(merchant_id,slug,blocks) values($1,$2,$3)", [owner, primary, { version: 1, records: [booking("foreign", "other")] }]);
  const existing = (await admin.query("select * from pages")).rows;
  await admin.query(await readFile(path.join(root, "scripts/supabase-migrations/202610250211_booking_atomic_preparation.sql"), "utf8"));
  assert.deepEqual((await admin.query("select * from pages")).rows, existing, "migration installation must not rewrite existing booking rows");
  console.log(`[booking-atomic-pg] PostgreSQL ${(await one(admin, "show server_version")).server_version}; synthetic evidence: ${evidence}`);
});
after(async () => {
  await Promise.all(connections.map((client) => client.end().catch(() => {})));
  if (started) {
    // Stop ONLY the cluster we just created, after verifying its directory.
    const pid = (await readFile(path.join(cluster, "postmaster.pid"), "utf8")).split(/\r?\n/);
    assert.equal(path.resolve(pid[1]).toLowerCase(), path.resolve(cluster).toLowerCase());
    await exec(binaries.pg_ctl, ["-D", cluster, "-w", "-t", "30", "-m", "fast", "stop"], { windowsHide: true, timeout: 45000 });
    console.log(`[booking-atomic-pg] stopped owned cluster; ${passed} checks; logs retained: ${evidence}`);
  }
});

test("real PostgreSQL transactions, private ACLs and conservative mail leases", { timeout: 90000 }, async () => {
  const service1 = await connect("service_role");
  const service2 = await connect("service_role");
  await check("installation is inert; legacy pages writes still work and RPC stays disabled", async () => {
    assert.equal((await one(admin, "select active from faolla_booking_atomic_control")).active, false);
    await service1.query("update pages set blocks=blocks where slug=$1", [primary]);
    await assert.rejects(snapshot(service1, identity()), /booking_atomic_inactive/);
  });
  await check("no browser or raw service table access, and no public helper execution", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of ["faolla_booking_atomic_control", "faolla_booking_atomic_commands", "faolla_booking_mail_jobs"]) {
        assert.equal((await one(admin, "select has_table_privilege($1,$2,'SELECT') as allowed", [role, `public.${table}`])).allowed, false);
        assert.equal((await one(admin, "select has_table_privilege($1,$2,'UPDATE') as allowed", [role, `public.${table}`])).allowed, false);
      }
      assert.equal((await one(admin, "select has_function_privilege($1,'public.faolla_booking_atomic_rows_v1()','EXECUTE') as allowed", [role])).allowed, false);
    }
    for (const role of ["anon", "authenticated"]) {
      const client = await connect(role);
      await assert.rejects(client.query("select public.faolla_booking_atomic_snapshot_v1($1,$2,$3)", ["shop", "a".repeat(64), "b".repeat(64)]), /permission denied/);
      await assert.rejects(client.query("select * from public.faolla_booking_mail_jobs"), /permission denied/);
      await client.end(); connections.splice(connections.indexOf(client), 1);
    }
  });
  await admin.query("update faolla_booking_atomic_control set active=true"); // Synthetic DB ONLY; no production activation helper.
  await check("active guard blocks old writes, rename and backup bypasses; unrelated pages unaffected", async () => {
    for (const query of ["update pages set blocks=blocks where slug=$1", "update pages set slug='renamed' where slug=$1", "delete from pages where slug=$1"]) {
      await assert.rejects(service1.query(query, [primary]), /booking_atomic_legacy_writer_fenced/);
    }
    await assert.rejects(service1.query("insert into pages(merchant_id,slug,blocks) values($1,$2,'{}')", [owner, `${primary}:backup`]), /booking_atomic_legacy_writer_fenced/);
    await assert.rejects(admin.query("truncate pages"), /booking_atomic_legacy_writer_fenced/);
    await service1.query("insert into pages(merchant_id,slug,blocks) values('other','ordinary-page','[]')");
  });
  let winningJob;
  await check("two simultaneous identical commands persist exactly one booking, command and mail job", async () => {
    const ident = identity();
    const snap = await snapshot(service1, ident);
    const value = mutation(snap, [...records(snap), booking("same-command")], [mail("same-command")]);
    const result = await Promise.all([commit(service1, ident, value), commit(service2, ident, value)]);
    assert.deepEqual(result.map((r) => r.replayed).sort(), [false, true]);
    assert.deepEqual(result[0].result, result[1].result);
    assert.equal((await one(admin, "select count(*)::int as n from faolla_booking_atomic_commands")).n, 1);
    assert.equal((await one(admin, "select count(*)::int as n from faolla_booking_mail_jobs")).n, 1);
    const current = await snapshot(service1, identity());
    assert.equal(records(current).filter((r) => r.id === "same-command").length, 1);
    assert.equal((await snapshot(service1, ident)).replayed, true);
    await assert.rejects(snapshot(service1, { ...ident, semanticInput: { operation: "different" } }), /booking_atomic_key_reused/);
    winningJob = (await one(admin, "select id from faolla_booking_mail_jobs")).id;
  });
  await check("stale snapshot loses CAS; fresh validation sees the occupied slot, no overbooking", async () => {
    const first = identity(), second = identity();
    const snap1 = await snapshot(service1, first), snap2 = await snapshot(service2, second);
    const next = [...records(snap1), booking("last-slot")];
    await commit(service1, first, mutation(snap1, next));
    await assert.rejects(commit(service2, second, mutation(snap2, [...records(snap2), booking("overbooking")])), /booking_atomic_conflict/);
    let planned = 0;
    await assert.rejects(executeAtomicBookingCommand({ identity: second, rpc: rpc(service2), authorize: async () => {},
      plan: async (fresh) => { planned++; assert.ok(records(fresh).some((r) => r.id === "last-slot")); throw new Error("slot_full"); },
    }), /slot_full/);
    assert.equal(planned, 1);
    assert.ok(!records(await snapshot(service1, identity())).some((r) => r.id === "overbooking"));
  });
  await check("actual capacity rule plus real concurrent adapter commands admits only the final seat", async () => {
    let initialPlans = 0;
    let release;
    const bothPlanned = new Promise((resolve) => { release = resolve; });
    let authorizationChecks = 0;
    const appointmentAt = "2030-03-01T12:00";
    const run = (client, id) => executeAtomicBookingCommand({ identity: identity(), rpc: rpc(client),
      authorize: async () => { authorizationChecks++; },
      plan: async (snap) => {
        const current = records(snap);
        const issue = getMerchantBookingSlotCapacityIssue(appointmentAt, [{ timeRange: "12:00-13:00", maxBookings: 1 }], current.filter((r) => r.siteId === "shop"));
        if (issue) throw new Error("slot_full");
        initialPlans++;
        if (initialPlans === 2) release();
        await bothPlanned;
        return { next: { version: 1, records: [...current, { ...booking(id), appointmentAt }] },
          result: { bookingId: id }, mailJobs: [mail(id)] };
      },
    });
    const results = await Promise.allSettled([run(service1, "race-one"), run(service2, "race-two")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.find((r) => r.status === "rejected").reason.message, "slot_full");
    assert.equal(authorizationChecks, 3, "losing command must reauthorize before retry");
    const current = records(await snapshot(service1, identity()));
    assert.equal(current.filter((r) => r.appointmentAt === appointmentAt).length, 1);
    // This additional mail intent is settled synthetically here so later queue
    // claim tests still have only their explicitly selected job pending.
    await admin.query("update faolla_booking_mail_jobs set state='failed' where booking_id like 'race-%'");
  });
  await check("dependency changes and generation mismatch invalidate otherwise current revision", async () => {
    const ident = identity(), snap = await snapshot(service1, ident);
    await admin.query("begin");
    await admin.query("select set_config('faolla.booking_atomic_write','v1',true)");
    await admin.query("insert into pages(merchant_id,slug,blocks) values($1,'__merchant_booking_rules__:v1','{}')", [owner]);
    await admin.query("commit");
    await assert.rejects(commit(service1, ident, mutation(snap, records(snap))), /booking_atomic_conflict/);
    const fresh = await snapshot(service1, ident);
    await assert.rejects(commit(service1, ident, { ...mutation(fresh, records(fresh)), generation: randomUUID() }), /booking_atomic_conflict/);
  });
  await check("foreign merchant records, creation identity, tokens, deletes and duplicate IDs are protected", async () => {
    for (const transform of [
      (r) => r.filter((item) => item.id !== "foreign"),
      (r) => r.map((item) => item.id === "foreign" ? { ...item, status: "cancelled" } : item),
      (r) => r.map((item) => item.id === "same-command" ? { ...item, editToken: "b".repeat(36) } : item),
      (r) => r.map((item) => item.id === "same-command" ? { ...item, siteId: "other" } : item),
      (r) => [...r, booking("foreign", "shop")],
      (r) => [...r, booking("new-foreign", "other")],
      (r) => [...r, { ...booking("invalid-status"), status: "pending" }],
    ]) {
      const ident = identity(), snap = await snapshot(service1, ident);
      await assert.rejects(commit(service1, ident, mutation(snap, transform(records(snap)))), /booking_atomic_(scope_violation|invalid_records)/);
    }
  });
  await check("invalid mail intent rolls back primary, backup, revision and dedup ledger together", async () => {
    const ident = identity(), snap = await snapshot(service1, ident);
    const before = await admin.query("select * from faolla_booking_atomic_commands");
    const badJob = mail("rollback"); badJob.message.editToken = "must-never-be-stored";
    await assert.rejects(commit(service1, ident, mutation(snap, [...records(snap), booking("rollback")], [badJob])), /booking_atomic_invalid_mail_intent/);
    assert.deepEqual(await snapshot(service1, ident), snap);
    assert.deepEqual((await admin.query("select * from faolla_booking_atomic_commands")).rows, before.rows);
    // Same key remains usable after a definite transaction rollback.
    await commit(service1, ident, mutation(snap, [...records(snap), booking("rollback")], []));
    assert.equal((await snapshot(service1, ident)).replayed, true);
  });
  await check("mail intent rejects hidden bearer fields, nested payloads and reply header injection", async () => {
    for (const change of [
      { replyTo: "one@example.invalid\r\nBcc: two@example.invalid" },
      { replyTo: "one@example.invalid,two@example.invalid" },
      { manageUrl: "https://example.invalid/#secret" },
      { notes: { editToken: "nested-secret" } },
      { recipient: "one@example.invalid;two@example.invalid" },
      { reminderOffsetMinutes: -1 },
    ]) {
      const ident = identity(), snap = await snapshot(service1, ident);
      const job = mail("same-command"); Object.assign(job.message, change);
      await assert.rejects(commit(service1, ident, mutation(snap, records(snap), [job])), /booking_atomic_invalid_mail_intent/);
      assert.deepEqual(await snapshot(service1, ident), snap);
    }
  });
  await check("two simultaneous queue claims cannot dispatch one email twice", async () => {
    const claims = await Promise.all([one(service1, "select faolla_booking_mail_claim_v1('shop') as job"), one(service2, "select faolla_booking_mail_claim_v1('shop') as job")]);
    assert.equal(claims.filter((r) => r.job !== null).length, 1);
    const job = claims.find((r) => r.job)?.job;
    assert.equal(job.id, winningJob);
    assert.equal(job.message.editToken, undefined);
    await assert.rejects(service1.query("select faolla_booking_mail_settle_v1('shop',$1,$2,'sent',null)", [job.id, job.lease_id]), /invalid_settlement/);
    assert.equal((await one(service1, "select faolla_booking_mail_settle_v1('other',$1,$2,'sent','test-receipt') as settled", [job.id, job.lease_id])).settled, false);
    assert.equal((await one(service1, "select faolla_booking_mail_settle_v1('shop',$1,$2,'sent','test-receipt') as settled", [job.id, randomUUID()])).settled, false);
    assert.equal((await one(service1, "select faolla_booking_mail_settle_v1('shop',$1,$2,'sent','test-receipt') as settled", [job.id, job.lease_id])).settled, true);
    assert.equal((await one(service1, "select faolla_booking_mail_settle_v1('shop',$1,$2,'failed',null) as settled", [job.id, job.lease_id])).settled, false);
  });
  await check("expired uncertain dispatch is NOT requeued; stale lease cannot report success", async () => {
    const ident = identity(), snap = await snapshot(service1, ident);
    await commit(service1, ident, mutation(snap, [...records(snap), booking("uncertain")], [mail("uncertain")]));
    const { job } = await one(service1, "select faolla_booking_mail_claim_v1('shop') as job");
    await admin.query("update faolla_booking_mail_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1", [job.id]);
    assert.equal((await one(service1, "select faolla_booking_mail_claim_v1('shop') as job")).job, null);
    assert.equal((await one(admin, "select state from faolla_booking_mail_jobs where id=$1", [job.id])).state, "unconfirmed");
    assert.equal((await one(service1, "select faolla_booking_mail_settle_v1('shop',$1,$2,'sent','late-receipt') as settled", [job.id, job.lease_id])).settled, false);
    assert.equal((await one(service1, "select faolla_booking_mail_claim_v1('shop') as job")).job, null);
  });
  await check("ambiguous primary fails closed rather than silently selecting or repairing rows", async () => {
    await admin.query("update faolla_booking_atomic_control set active=false");
    const row = await one(admin, "insert into pages(merchant_id,slug,blocks) select merchant_id,slug,blocks from pages where slug=$1 returning id", [primary]);
    await admin.query("update faolla_booking_atomic_control set active=true");
    await assert.rejects(snapshot(service1, identity()), /booking_atomic_store_ambiguous/);
    assert.equal((await one(admin, "select count(*)::int as n from pages where slug=$1", [primary])).n, 2);
    await admin.query("update faolla_booking_atomic_control set active=false");
    await admin.query("delete from pages where id=$1", [row.id]);
  });
});
