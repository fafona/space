import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// Never read application env files or accept a remote/database URL override.
if (process.env.TRANSACTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
  throw new Error("Set TRANSACTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 for a new empty local test database");
}
const port = process.env.TRANSACTION_TEST_PORT || "56449";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error("invalid_test_port");
const psql = process.env.TRANSACTION_TEST_PSQL || "psql";
const args = [
  "--host=127.0.0.1", `--port=${port}`, "--username=postgres", "--dbname=faolla_transaction_test",
  "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1",
];
const childEnv = {
  ...process.env,
  PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  PGOPTIONS: "-c lc_messages=C -c statement_timeout=15000 -c lock_timeout=10000",
};
delete childEnv.PGSERVICE;
delete childEnv.PGSERVICEFILE;
delete childEnv.PGPASSWORD;
const activeChildren = new Set();
let connectionSequence = 0;

function execute(sql, { marker = "", holdOpen = false } = {}) {
  const applicationName = `faolla_transaction_test_${++connectionSequence}`;
  let output = "";
  let errorOutput = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => undefined);
  const child = spawn(psql, args, {
    env: { ...childEnv, PGAPPNAME: applicationName },
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  activeChildren.add(child);
  const timer = setTimeout(() => child.kill(), 25000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output += data.toString();
      if (marker && output.includes(marker)) readyResolve();
    });
    child.stderr.on("data", (data) => { errorOutput += data.toString(); });
    child.stdin.on("error", (error) => {
      // A rejected SQL statement closes psql before a queued COMMIT is sent.
      if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") reject(error);
    });
    child.on("error", (error) => { clearTimeout(timer); activeChildren.delete(child); readyReject(error); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      if (marker && !output.includes(marker)) readyReject(new Error(errorOutput || "race_marker_missing"));
      resolve({ code, output: output.trim(), errorOutput });
    });
  });
  done.catch(() => undefined);
  if (holdOpen) child.stdin.write(`${sql}\n`);
  else child.stdin.end(sql);
  return { done, ready, applicationName, finish: (tail) => child.stdin.end(`${tail}\n`) };
}

async function query(sql) {
  const result = await execute(sql).done;
  assert.equal(result.code, 0, result.errorOutput);
  return result.output;
}

function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function jsonSql(value) { return `${sqlText(JSON.stringify(value))}::jsonb`; }
function call(siteId, mutation) {
  return `select public.faolla_commit_order_membership_v1(${sqlText(siteId)},${jsonSql(mutation)});`;
}

function rpcResult(output) {
  const line = output.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
  assert.ok(line, "RPC must return its persisted commit timestamp");
  const result = JSON.parse(line);
  assert.equal(typeof result.updatedAt, "string");
  assert.ok(Number.isFinite(Date.parse(result.updatedAt)));
  return result;
}

async function commit(siteId, mutation) {
  return rpcResult(await query(`set role service_role; ${call(siteId, mutation)}`));
}

async function allPages() {
  return JSON.parse(await query("select coalesce(jsonb_agg(to_jsonb(p) order by merchant_id nulls first,slug,id),'[]'::jsonb) from public.pages p;"));
}

async function expectRejectedUnchanged(siteId, mutation, expected = /ERROR:/) {
  const before = await allPages();
  const result = await execute(`set role service_role; ${call(siteId, mutation)}`).done;
  assert.notEqual(result.code, 0, "Mutation unexpectedly committed");
  assert.match(result.errorOutput, expected);
  assert.deepEqual(await allPages(), before, "A failed transaction changed page/history/backup state");
}

async function orderRows(siteId) {
  const prefix = `__merchant_orders__:${siteId}`;
  return JSON.parse(await query(`select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'blocks',blocks,'updated_at',updated_at) order by slug,id),'[]'::jsonb)
    from public.pages where merchant_id=${sqlText(siteId)} and (slug=${sqlText(prefix)} or starts_with(slug,${sqlText(`${prefix}:chunk:`)}));`));
}

async function membershipRow(siteId) {
  return JSON.parse(await query(`select coalesce((select jsonb_build_object('blocks',blocks,'updated_at',updated_at) from public.pages
    where merchant_id=${sqlText(siteId)} and slug=${sqlText(`__merchant_memberships__:${siteId}`)}),'null'::jsonb);`));
}

async function currentMutation(siteId) {
  const rows = await orderRows(siteId);
  const members = await membershipRow(siteId);
  return {
    orders: { expectedRows: rows, next: structuredClone(rows.flatMap((row) => row.blocks)) },
    memberships: { expectedUpdatedAt: members?.updated_at ?? null, next: members?.blocks ?? [] },
  };
}

async function waitForBlockedSession(applicationName) {
  const deadline = Date.now() + 7000;
  do {
    const blocked = await query(`select exists(select 1 from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a using(pid)
      where a.application_name=${sqlText(applicationName)} and not l.granted and l.locktype in ('advisory','transactionid','tuple'));`);
    if (blocked === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail("Second real PostgreSQL session did not wait on the first transaction");
}

async function race(siteId, firstMutation, secondMutation, conflict) {
  const marker = "__TRANSACTION_LOCK_HELD__";
  const first = execute(`begin; set local role service_role; ${call(siteId, firstMutation)} select '${marker}';`, { marker, holdOpen: true });
  try {
    await first.ready;
    const second = execute(`set role service_role; ${call(siteId, secondMutation)}`);
    await waitForBlockedSession(second.applicationName);
    first.finish("commit;");
    const [left, right] = await Promise.all([first.done, second.done]);
    assert.equal(left.code, 0, left.errorOutput);
    assert.notEqual(right.code, 0, "Both writes from the same old snapshot committed");
    assert.match(right.errorOutput, conflict);
    return rpcResult(left.output);
  } catch (error) {
    first.finish("rollback;");
    throw error;
  }
}

const fixtureTime = "2026-09-01T10:00:00.000Z";
function order(siteId, serial) {
  return {
    id: `O${siteId}20260901${String(serial).padStart(4, "0")}`,
    siteId, siteName: `Synthetic ${siteId}`, blockId: "products", clientRequestId: `request-${serial}`,
    customerAccountId: "account-1", customerUserId: "", customerLoginEmail: "", customerGuestHash: "",
    createdAt: fixtureTime, updatedAt: fixtureTime, merchantTouchedAt: "", status: "pending",
    customer: { name: "Synthetic member", phone: "", email: "", note: "" },
    items: [{ productId: "product-1", code: "SKU-1", name: "Synthetic item", description: "", imageUrl: "", tag: "",
      quantity: 1, unitPrice: 10, unitPriceText: "10.00", subtotal: 10 }],
    totalQuantity: 1, totalAmount: 10, pricePrefix: "EUR ", confirmedAt: null, completedAt: null,
    cancelledAt: null, printedAt: null, printCount: 0,
  };
}

function member(siteId, serial) {
  return {
    id: `membership-${serial}`, siteId, siteName: `Synthetic ${siteId}`, memberNo: `${siteId}${String(serial).padStart(6, "0")}`,
    serial, accountId: `account-${serial}`, userId: "", email: "", nickname: "Synthetic", name: "Synthetic", phone: "",
    avatarUrl: "", birthday: "", birthdayMonthDayOnly: false, gender: "", country: "", province: "", city: "", address: "",
    taxName: "", taxNumber: "", taxCountry: "", taxProvince: "", taxCity: "", taxAddress: "", allergens: [],
    pointBalance: 100, balanceAmount: 0, growthValue: 0, levelId: "", transactions: [],
    status: "active", joinedAt: fixtureTime, leftAt: null, updatedAt: fixtureTime,
  };
}

function creditMember(record, delta, operation) {
  record.pointBalance += delta;
  record.transactions.push({ id: operation, type: delta < 0 ? "redeem" : "recharge", status: "completed", at: fixtureTime,
    pointDelta: delta, balanceDelta: 0, growthDelta: 0, note: `[order:${operation}]`, operatorId: "fixture-owner",
    cancelledAt: null, cancellationNote: "", cancelledBy: "", cancellationOperationMarker: "",
    relatedTransactionId: "", adjustmentKind: "" });
}

function completeOrder(record) {
  record.status = "completed";
  record.completedAt = fixtureTime;
}

let checks = 0;
function passed(label) { checks += 1; console.log(`[transaction-postgres] passed ${label}`); }

try {
  assert.equal(await query("select current_database();"), "faolla_transaction_test");
  const relationCount = await query(`select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`);
  assert.equal(relationCount, "0", "Refusing a non-empty database");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase-migrations/202609080045_order_membership_atomic_mutation.sql", import.meta.url), "utf8");
  function realDdl(pattern, label) {
    const source = init.match(pattern)?.[0];
    assert.ok(source, `Missing real ${label} fixture contract`);
    return source;
  }
  await query(`
    create extension if not exists pgcrypto;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if not exists(select 1 from pg_roles where rolname='transaction_test_untrusted') then create role transaction_test_untrusted nologin; end if;
    end $$;
    ${realDdl(/create table if not exists public\.merchants \([\s\S]*?\n\);/i, "merchants")}
    ${realDdl(/create table if not exists public\.pages \([\s\S]*?\n\);/i, "pages")}
    ${realDdl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i, "updated_at function")}
    ${realDdl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i, "pages timestamp trigger")}
    ${realDdl(/create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i, "merchant slug unique index")}
    alter table public.pages enable row level security;
    create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());
    insert into public.merchants(id,name) values ('11111111','Synthetic A'),('22222222','Synthetic B'),('33333333','Synthetic C');
    insert into public.pages(merchant_id,slug,blocks) values
      (null,'home','{"keep":"public-home"}'),
      ('11111111','home','{"keep":"merchant-home"}'),
      ('11111111','__merchant_membership_settings__:11111111','{"keep":"inventory-not-in-this-rpc"}'),
      ('11111111','__merchant_coupons__:11111111','{"keep":"coupons-not-in-this-rpc"}');
  `);
  const unrelatedPages = await allPages();
  await query(migration);
  const beforeReplay = await allPages();
  await query("grant execute on function public.faolla_commit_order_membership_v1(text,jsonb) to transaction_test_untrusted;");
  await query(migration);
  assert.deepEqual(await allPages(), beforeReplay);
  for (const role of ["anon", "authenticated", "transaction_test_untrusted"]) {
    assert.equal(await query(`select has_function_privilege('${role}','public.faolla_commit_order_membership_v1(text,jsonb)','execute');`), "f");
    const denial = await execute(`set role ${role}; ${call("11111111", {})}`).done;
    assert.notEqual(denial.code, 0);
    assert.match(denial.errorOutput, /permission denied for function/);
  }
  assert.equal(await query("select has_function_privilege('service_role','public.faolla_commit_order_membership_v1(text,jsonb)','execute');"), "t");
  assert.equal(await query("select proconfig::text from pg_proc where oid='public.faolla_commit_order_membership_v1(text,jsonb)'::regprocedure;"), '{"search_path=pg_catalog, public"}');
  passed("migration replay preserves pages and normalizes service-only EXECUTE ACLs");

  const site = "11111111";
  const initial = {
    orders: { expectedRows: [], next: Array.from({ length: 101 }, (_, index) => order(site, index + 1)) },
    memberships: { expectedUpdatedAt: null, next: [member(site, 1), member(site, 2)] },
  };
  const firstCommit = await commit(site, initial);
  const createdRows = await orderRows(site);
  assert.deepEqual(createdRows.map((row) => row.blocks.length), [100, 1]);
  assert.equal((await membershipRow(site)).blocks.length, 2);
  assert.equal(Date.parse((await membershipRow(site)).updated_at), Date.parse(firstCommit.updatedAt));
  for (const prefix of ["__merchant_orders_history_v2__:", "__merchant_orders_history_backup_v2__:", "__merchant_memberships_history__:", "__merchant_memberships_history_backup__:"]) {
    assert.equal(await query(`select count(*) from public.pages where merchant_id=${sqlText(site)} and slug=${sqlText(`${prefix}${site}`)};`), "1");
  }
  passed("101 orders, members, primary histories and backups commit together");

  const populatedBeforeReplay = await allPages();
  await query(migration);
  assert.deepEqual(await allPages(), populatedBeforeReplay);
  passed("migration replay does not change populated orders, balances or histories");

  await expectRejectedUnchanged(site, initial, /order_update_conflict/);
  await expectRejectedUnchanged(site, { memberships: initial.memberships }, /merchant_memberships_conflict/);
  passed("retrying a previously committed request cannot duplicate orders, points or histories");

  const noOpBefore = await allPages();
  await commit(site, await currentMutation(site));
  const unchangedMember = await membershipRow(site);
  await commit(site, { memberships: { expectedUpdatedAt: unchangedMember.updated_at, next: unchangedMember.blocks } });
  assert.deepEqual(await allPages(), noOpBefore);
  passed("fresh-snapshot no-op retries do not rewrite chunks, member timestamps, histories or backups");

  const common = await currentMutation(site);
  const left = structuredClone(common);
  const right = structuredClone(common);
  completeOrder(left.orders.next[0]);
  creditMember(left.memberships.next[0], 10, "order-one");
  completeOrder(right.orders.next[100]);
  creditMember(right.memberships.next[0], 20, "order-two");
  await race(site, left, right, /order_update_conflict/);
  let persisted = await currentMutation(site);
  assert.equal(persisted.orders.next[0].status, "completed");
  assert.equal(persisted.orders.next[100].status, "pending");
  assert.equal(persisted.memberships.next[0].pointBalance, 110);
  completeOrder(persisted.orders.next[100]);
  creditMember(persisted.memberships.next[0], 20, "order-two");
  const retryCommit = await commit(site, persisted);
  persisted = await currentMutation(site);
  assert.equal(persisted.orders.next[0].status, "completed");
  assert.equal(persisted.orders.next[100].status, "completed");
  assert.equal(persisted.memberships.next[0].pointBalance, 130);
  assert.equal(persisted.memberships.next[0].transactions.length, 2);
  assert.ok(Date.parse(retryCommit.updatedAt) > Date.parse(firstCommit.updatedAt));
  passed("two real same-site sessions updating different orders and one member cannot lose either accepted update");

  const untouchedChunk = (await orderRows(site))[1];
  const oneChunk = await currentMutation(site);
  oneChunk.orders.next[0].customer.note = "one-chunk-only";
  await commit(site, { orders: oneChunk.orders });
  assert.deepEqual((await orderRows(site))[1], untouchedChunk);
  passed("editing one order chunk preserves other chunks and their database versions");

  const memberBase = await membershipRow(site);
  const debitA = { memberships: { expectedUpdatedAt: memberBase.updated_at, next: structuredClone(memberBase.blocks) } };
  const debitB = structuredClone(debitA);
  creditMember(debitA.memberships.next[0], -100, "debit-one");
  creditMember(debitB.memberships.next[0], -100, "debit-two");
  await race(site, debitA, debitB, /merchant_memberships_conflict/);
  assert.equal((await membershipRow(site)).blocks[0].pointBalance, 30);
  assert.equal((await membershipRow(site)).blocks[0].transactions.filter((entry) => entry.id.startsWith("debit-")).length, 1);
  passed("competing member-only writes from one balance snapshot allow only one debit");

  const newMemberSite = "33333333";
  const preparedEmpty = {
    orders: { expectedRows: [], next: [order(newMemberSite, 1)] },
    memberships: { expectedUpdatedAt: null, next: [] },
  };
  await race(newMemberSite, { memberships: { expectedUpdatedAt: null, next: [member(newMemberSite, 1)] } }, preparedEmpty, /merchant_memberships_conflict/);
  assert.equal((await membershipRow(newMemberSite)).blocks[0].pointBalance, 100);
  assert.deepEqual(await orderRows(newMemberSite), []);
  passed("a prepared empty-member snapshot conflicts after another session creates the member; its order is not written");

  async function injection(slug, suppress) {
    const before = await allPages();
    await query(`create or replace function public.transaction_test_failure() returns trigger language plpgsql as $$ begin
      if new.merchant_id=${sqlText(site)} and new.slug=${sqlText(slug)} then
        ${suppress ? "return null;" : "raise exception 'transaction_test_injected_failure';"}
      end if; return new; end $$;
      create trigger z_transaction_test_failure before insert or update on public.pages for each row execute function public.transaction_test_failure();`);
    try {
      const next = await currentMutation(site);
      next.orders.next[0].customer.note = "must-rollback-first-chunk";
      next.orders.next[100].customer.note = "must-rollback-second-chunk";
      creditMember(next.memberships.next[0], 7, "must-rollback-credit");
      const result = await execute(`set role service_role; ${call(site, next)}`).done;
      assert.notEqual(result.code, 0, `Injected ${suppress ? "suppressed DML" : "failure"} was reported successful for ${slug}`);
      assert.match(result.errorOutput, suppress ? /order_membership_mutation_not_persisted/ : /transaction_test_injected_failure/);
      assert.deepEqual(await allPages(), before, `Partial write escaped rollback at ${slug}`);
    } finally {
      await query("drop trigger z_transaction_test_failure on public.pages; drop function public.transaction_test_failure();");
    }
  }
  for (const slug of [`__merchant_orders__:${site}:chunk:1`, `__merchant_memberships__:${site}`, `__merchant_orders_history_v2__:${site}`, `__merchant_memberships_history_backup__:${site}`]) {
    await injection(slug, false);
    await injection(slug, true);
  }
  passed("cross-chunk/member/history/backup failures and suppressed DML roll back every document");

  await query(`create function public.transaction_test_after_rewrite() returns trigger language plpgsql as $$ begin
      update public.pages set blocks=jsonb_set(blocks,'{0,customer,note}','"unexpected-trigger-rewrite"')
       where merchant_id=${sqlText(site)} and slug=${sqlText(`__merchant_orders__:${site}:chunk:0`)};
      return new; end $$;
    create trigger z_transaction_test_after_rewrite after insert or update on public.pages for each row
      when (new.merchant_id=${sqlText(site)} and new.slug=${sqlText(`__merchant_memberships_history_backup__:${site}`)})
      execute function public.transaction_test_after_rewrite();`);
  try {
    const next = await currentMutation(site);
    completeOrder(next.orders.next[2]);
    creditMember(next.memberships.next[0], 5, "must-rollback-after-trigger");
    await expectRejectedUnchanged(site, next, /order_membership_mutation_not_persisted/);
  } finally {
    await query("drop trigger z_transaction_test_after_rewrite on public.pages; drop function public.transaction_test_after_rewrite();");
  }
  passed("a later AFTER trigger cannot silently rewrite an earlier committed document");

  const legacySite = "22222222";
  const legacyOrders = Array.from({ length: 101 }, (_, index) => order(legacySite, index + 1));
  await query(`insert into public.pages(merchant_id,slug,blocks) values (${sqlText(legacySite)},${sqlText(`__merchant_orders__:${legacySite}`)},${jsonSql(legacyOrders)});`);
  const legacy = await currentMutation(legacySite);
  completeOrder(legacy.orders.next[0]);
  await query(`create function public.transaction_test_skip_delete() returns trigger language plpgsql as $$ begin return null; end $$;
    create trigger z_transaction_test_skip_delete before delete on public.pages for each row
    when (old.merchant_id=${sqlText(legacySite)} and old.slug=${sqlText(`__merchant_orders__:${legacySite}`)}) execute function public.transaction_test_skip_delete();`);
  try {
    await expectRejectedUnchanged(legacySite, { orders: legacy.orders }, /order_membership_mutation_not_persisted/);
  } finally {
    await query("drop trigger z_transaction_test_skip_delete on public.pages; drop function public.transaction_test_skip_delete();");
  }
  await commit(legacySite, { orders: legacy.orders });
  assert.deepEqual((await orderRows(legacySite)).map((row) => row.blocks.length), [100, 1]);
  assert.equal((await orderRows(legacySite)).flatMap((row) => row.blocks).length, 101);
  assert.equal(await query(`select count(*) from public.pages where merchant_id=${sqlText(legacySite)} and slug=${sqlText(`__merchant_orders__:${legacySite}`)};`), "0");
  passed("legacy unchunked orders convert transactionally; a suppressed legacy delete rolls everything back");

  const independentLeft = await currentMutation(site);
  independentLeft.orders.next[0].customer.note = "independent-tenant-first";
  const independentRight = await currentMutation(legacySite);
  independentRight.orders.next[1].customer.note = "independent-tenant-second";
  const independentMarker = "__INDEPENDENT_TENANT_LOCK_HELD__";
  const held = execute(`begin; set local role service_role; ${call(site, independentLeft)} select '${independentMarker}';`, { marker: independentMarker, holdOpen: true });
  try {
    await held.ready;
    await commit(legacySite, { orders: independentRight.orders });
    assert.equal((await orderRows(legacySite))[0].blocks[1].customer.note, "independent-tenant-second");
    assert.notEqual((await orderRows(site))[0].blocks[0].customer.note, "independent-tenant-first");
    held.finish("commit;");
    const result = await held.done;
    assert.equal(result.code, 0, result.errorOutput);
  } catch (error) {
    held.finish("rollback;");
    throw error;
  }
  passed("one tenant can commit while another tenant's transaction remains open");

  const valid = await currentMutation(site);
  const crossTenantOrder = structuredClone(valid);
  crossTenantOrder.orders.next[0].siteId = legacySite;
  await expectRejectedUnchanged(site, crossTenantOrder);
  const crossTenantMember = structuredClone(valid);
  crossTenantMember.memberships.next[0].siteId = legacySite;
  await expectRejectedUnchanged(site, crossTenantMember);
  await expectRejectedUnchanged(site, { orders: { expectedRows: await orderRows(legacySite), next: valid.orders.next } });
  for (const malformed of [null, [], {}, { orders: null }, { memberships: { expectedUpdatedAt: null, next: {} } }, { orders: { expectedRows: {}, next: [] } }]) {
    await expectRejectedUnchanged(site, malformed);
  }
  const duplicate = structuredClone(valid);
  duplicate.orders.next.push(structuredClone(duplicate.orders.next[0]));
  await expectRejectedUnchanged(site, duplicate);
  for (const [section, field, value] of [
    ["memberships", "pointBalance", -1], ["memberships", "pointBalance", 0.5],
    ["memberships", "pointBalance", Number.MAX_SAFE_INTEGER + 1],
    ["memberships", "balanceAmount", -1], ["memberships", "balanceAmount", 1.001],
    ["memberships", "growthValue", -1], ["memberships", "growthValue", 1.001],
    ["orders", "totalAmount", -1], ["orders", "totalAmount", 10.001],
    ["orders", "totalQuantity", -1], ["orders", "totalQuantity", 1.5],
  ]) {
    const invalidNumber = structuredClone(valid);
    invalidNumber[section].next[0][field] = value;
    await expectRejectedUnchanged(site, invalidNumber, /invalid_order_membership_mutation/);
  }
  const duplicateMember = structuredClone(valid);
  duplicateMember.memberships.next.push(structuredClone(duplicateMember.memberships.next[0]));
  await expectRejectedUnchanged(site, duplicateMember);
  await expectRejectedUnchanged("site-main", valid);
  passed("cross-tenant identities, forged snapshots, malformed payloads and duplicate orders fail closed");

  for (const ambiguousOwner of [null, legacySite]) {
    const id = await query(`insert into public.pages(merchant_id,slug,blocks) values
      (${ambiguousOwner === null ? "null" : sqlText(ambiguousOwner)},${sqlText(`__merchant_orders__:${site}`)},'[]') returning id;`);
    try {
      await expectRejectedUnchanged(site, valid, /order_membership_store_ambiguous/);
    } finally {
      await query(`delete from public.pages where id=${sqlText(id)}::uuid;`);
    }
  }
  passed("unscoped or foreign-owned documents with a protected tenant slug are rejected without choosing a winner");

  const corruptTarget = (await orderRows(site))[0];
  await query(`update public.pages set blocks='{"corrupt":true}' where id=${sqlText(corruptTarget.id)}::uuid;`);
  const corruptBefore = await allPages();
  await expectRejectedUnchanged(site, { orders: { expectedRows: await orderRows(site), next: valid.orders.next } });
  assert.deepEqual(await allPages(), corruptBefore);
  await query(`update public.pages set blocks=${jsonSql(corruptTarget.blocks)} where id=${sqlText(corruptTarget.id)}::uuid;`);
  passed("corrupt persisted order documents are not silently overwritten or normalized away");

  const memberTarget = await membershipRow(site);
  await query(`update public.pages set blocks='{"corrupt":true}' where merchant_id=${sqlText(site)} and slug=${sqlText(`__merchant_memberships__:${site}`)};`);
  const malformedMember = await membershipRow(site);
  await expectRejectedUnchanged(site, { memberships: { expectedUpdatedAt: malformedMember.updated_at, next: memberTarget.blocks } }, /order_membership_store_corrupt/);
  await query(`update public.pages set blocks=${jsonSql(memberTarget.blocks)} where merchant_id=${sqlText(site)} and slug=${sqlText(`__merchant_memberships__:${site}`)};`);
  passed("corrupt persisted member documents are rejected without resetting their balances");

  const finalPages = await allPages();
  for (const unrelated of unrelatedPages) assert.deepEqual(finalPages.find((row) => row.id === unrelated.id), unrelated);
  passed("public/merchant home, inventory settings and coupons remain untouched");
  console.log(`[transaction-postgres] ${checks} checks passed; PostgreSQL ${await query("show server_version;")}`);
  console.log("[transaction-postgres] covers order/member/history commit only; inventory/coupon atomicity and HTTP/Auth are not covered");
} finally {
  for (const child of activeChildren) child.kill();
}
