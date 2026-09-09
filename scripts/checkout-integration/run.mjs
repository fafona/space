import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expectedDisposablePostgresServerAddress } from "../ci-postgres-service-identity.mjs";

// A separate empty disposable instance, never the app's database or env files.
if (process.env.CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
  throw new Error("Set CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 for a new empty local test database");
}
const port = process.env.CHECKOUT_TEST_PORT || "56451";
if (port !== "56451" && !(process.env.CI === "true" && port === "5432")) throw new Error("invalid_test_port");
const expectedServerAddress = expectedDisposablePostgresServerAddress(process.env, port, "56451");
const psql = process.env.CHECKOUT_TEST_PSQL || "psql";
const args = ["--host=127.0.0.1", `--port=${port}`, "--username=postgres", "--dbname=faolla_checkout_test",
  "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"];
const childEnv = { ...process.env, PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
  PGOPTIONS: "-c lc_messages=C -c statement_timeout=15000 -c lock_timeout=10000" };
delete childEnv.PGSERVICE;
delete childEnv.PGSERVICEFILE;
delete childEnv.PGPASSWORD;
let connectionSequence = 0;
const activeChildren = new Set();

function execute(sql, { marker = "", holdOpen = false } = {}) {
  const applicationName = `faolla_checkout_test_${++connectionSequence}`;
  let output = "";
  let errorOutput = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => undefined);
  const child = spawn(psql, args, { env: { ...childEnv, PGAPPNAME: applicationName }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  activeChildren.add(child);
  const timer = setTimeout(() => child.kill(), 25000);
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", (data) => { output += data.toString(); if (marker && output.includes(marker)) readyResolve(); });
    child.stderr.on("data", (data) => { errorOutput += data.toString(); });
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") reject(error); });
    child.on("error", (error) => { clearTimeout(timer); activeChildren.delete(child); readyReject(error); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer); activeChildren.delete(child);
      if (marker && !output.includes(marker)) readyReject(new Error(errorOutput || "race_marker_missing"));
      resolve({ code, output: output.trim(), errorOutput });
    });
  });
  done.catch(() => undefined);
  if (holdOpen) child.stdin.write(`${sql}\n`); else child.stdin.end(sql);
  return { done, ready, applicationName, finish: (tail) => child.stdin.end(`${tail}\n`) };
}

async function query(sql) {
  const result = await execute(sql).done;
  assert.equal(result.code, 0, result.errorOutput);
  return result.output;
}
function textSql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function jsonSql(value) { return `${textSql(JSON.stringify(value))}::jsonb`; }
function ordinarySql(siteId, mutation) { return `select public.faolla_commit_redemption_v1(${textSql(siteId)},${jsonSql(mutation)});`; }
function memberSql(siteId, mutation) { return `select public.faolla_commit_order_membership_v1(${textSql(siteId)},${jsonSql({ memberships: mutation })});`; }
function lookupSql(siteId, operation) {
  return `select public.faolla_get_redemption_operation_v1(${[siteId, operation.id, operation.fingerprint, operation.membershipId].map(textSql).join(",")});`;
}
function objectResult(output) {
  const line = output.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
  assert.ok(line, "RPC must return a JSON object");
  return JSON.parse(line);
}
async function ordinary(siteId, mutation) { return objectResult(await query(`set role service_role; ${ordinarySql(siteId, mutation)}`)); }
async function lookup(siteId, operation) { return objectResult(await query(`set role service_role; ${lookupSql(siteId, operation)}`)); }
async function allState() {
  return JSON.parse(await query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by merchant_id nulls first,slug,id),'[]'::jsonb) from public.pages p),
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by merchant_id,operation_id),'[]'::jsonb) from public.faolla_redemption_operations o),
    'checkouts',(select coalesce(jsonb_agg(to_jsonb(c) order by merchant_id,operation_id),'[]'::jsonb) from public.faolla_redemption_checkouts c));`));
}
async function row(siteId, slug) {
  return JSON.parse(await query(`select coalesce((select jsonb_build_object('id',id,'blocks',blocks,'updated_at',updated_at)
    from public.pages where merchant_id=${textSql(siteId)} and slug=${textSql(slug)}),'null'::jsonb);`));
}
async function snapshot(siteId) {
  const [settings, coupons, memberships] = await Promise.all([
    row(siteId, `__merchant_membership_settings__:${siteId}`), row(siteId, `__merchant_coupons__:${siteId}`), row(siteId, `__merchant_memberships__:${siteId}`),
  ]);
  return { settings, coupons, memberships };
}
function change(document) { return { expectedUpdatedAt: document?.updated_at ?? null, next: structuredClone(document?.blocks ?? []) }; }
async function rejectUnchanged(sql, expected = /ERROR:/) {
  const before = await allState();
  const result = await execute(`set role service_role; ${sql}`).done;
  assert.notEqual(result.code, 0, "Invalid/conflicting mutation unexpectedly committed");
  assert.match(result.errorOutput, expected);
  assert.deepEqual(await allState(), before, "Failed operation changed a document, history, backup or receipt");
}
async function waitForBlocked(applicationName) {
  const deadline = Date.now() + 7000;
  do {
    if (await query(`select exists(select 1 from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a using(pid)
      where a.application_name=${textSql(applicationName)} and not l.granted and l.locktype in ('advisory','transactionid','tuple'));`) === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail("Second PostgreSQL session did not reach the actual transaction-lock wait barrier");
}
async function race(firstSql, secondSql, expectedConflict) {
  const marker = "__CHECKOUT_TRANSACTION_HELD__";
  const first = execute(`begin; set local role service_role; ${firstSql} select '${marker}';`, { marker, holdOpen: true });
  try {
    await first.ready;
    const second = execute(`set role service_role; ${secondSql}`);
    await waitForBlocked(second.applicationName);
    first.finish("commit;");
    const [left, right] = await Promise.all([first.done, second.done]);
    assert.equal(left.code, 0, left.errorOutput);
    if (expectedConflict) {
      assert.notEqual(right.code, 0, "Both conflicting prepared snapshots committed");
      assert.match(right.errorOutput, expectedConflict);
    } else assert.equal(right.code, 0, right.errorOutput);
    return { first: objectResult(left.output), second: expectedConflict ? null : objectResult(right.output) };
  } catch (error) { first.finish("rollback;"); throw error; }
}

const time = "2026-09-01T10:00:00.000Z";
let tenantSequence = 12000000;
function member(siteId, index) {
  return { id: `member-${index}`, siteId, siteName: "Synthetic", memberNo: `${siteId}${String(index).padStart(6, "0")}`,
    serial: index, accountId: `account-${index}`, userId: "", email: "", nickname: "Synthetic", name: "Synthetic", phone: "",
    avatarUrl: "", birthday: "", birthdayMonthDayOnly: false, gender: "", country: "", province: "", city: "", address: "",
    taxName: "", taxNumber: "", taxCountry: "", taxProvince: "", taxCity: "", taxAddress: "", allergens: [],
    pointBalance: 200, balanceAmount: 0, growthValue: 0, levelId: "", transactions: [], status: "active", joinedAt: time, leftAt: null, updatedAt: time };
}
function settings(siteId, stock) {
  return { siteId, rechargePlans: [], redemptionCategories: [], levels: [], redemptionShowStock: true, redemptionStockOperationIds: [],
    printSettings: {}, growthRules: {}, pointsRules: {}, updatedAt: time,
    redemptionItems: [{ id: "item-1", categoryId: "", name: "Synthetic item", code: "SKU-1", barcode: "", imageUrl: "", iconName: "",
      description: "", enabled: true, pointsCost: 20, referenceAmount: null, memberPrice: null, taxRate: null, stock,
      pointProduct: true, recommended: false, sort: 0 }] };
}
function coupon(siteId, index) {
  return { id: `coupon-${index}`, siteId, code: `C${index}`, title: "Synthetic coupon", description: "", discountType: "exchange_voucher",
    discountValue: 1, minimumAmount: 0, status: "active", totalQuantity: 10, claimedCount: 1, usedCount: 0, startsAt: null, expiresAt: null,
    createdAt: time, updatedAt: time, redeemEvents: [], claimEvents: [{ id: `claim-${index}`, at: time, accountId: `account-${index}`,
      userId: "", email: "", code: "", customerName: "Synthetic", settlementType: "qr", settlementCode: `SETTLEMENT-${siteId}-${index}`, validUntil: null }] };
}
function entry(id, delta) {
  return { id, type: delta < 0 ? "redeem" : "recharge", status: "completed", at: time, pointDelta: delta, balanceDelta: 0, growthDelta: 0,
    note: `[op:member-redemption-checkout:${id}]`, operatorId: "fixture-owner", cancelledAt: null, cancellationNote: "", cancelledBy: "",
    cancellationOperationMarker: "", relatedTransactionId: "", adjustmentKind: "" };
}
async function seed(stock = 1) {
  const siteId = String(++tenantSequence);
  await query(`set role service_role; ${memberSql(siteId, { expectedUpdatedAt: null, next: [member(siteId, 1), member(siteId, 2)] })}`);
  await ordinary(siteId, { settings: { expectedUpdatedAt: null, next: settings(siteId, stock) }, coupons: { expectedUpdatedAt: null, next: [coupon(siteId, 1), coupon(siteId, 2)] } });
  return { siteId, state: await snapshot(siteId) };
}

const OPERATOR = "owner:fixture-owner";
function plan(siteId, state, id, { operatorId = OPERATOR, useCoupon = true, quantity = 1 } = {}) {
  const target = state.memberships.blocks[0];
  const points = quantity * state.settings.blocks.redemptionItems[0].pointsCost;
  const items = [{ redemptionItemId: "item-1", quantity }];
  const lines = [{ code: "SKU-1", name: "Synthetic item", categoryName: "", quantity,
    unitPoints: points / quantity, subtotalPoints: points, couponDiscountLabel: "", couponPointDiscount: 0 }];
  if (useCoupon) {
    const coupon = state.coupons.blocks[0];
    items.push({ customName: "Synthetic coupon item", customPoints: 0, couponId: coupon.id,
      couponClaimId: coupon.claimEvents[0].id, couponSettlementCode: coupon.claimEvents[0].settlementCode, quantity: 1 });
    lines.push({ code: "COUPON", name: "Synthetic coupon item", categoryName: "", quantity: 1, unitPoints: 0,
      subtotalPoints: 0, couponDiscountLabel: "Exchange", couponPointDiscount: 0 });
  }
  const quote = { totalQuantity: quantity + Number(useCoupon), grossPoints: points, totalPoints: points,
    couponPointDiscountTotal: 0, couponCount: Number(useCoupon), lines };
  const request = { membershipId: target.id, items, note: "Synthetic checkout",
    settingsVersion: state.settings.updated_at, couponVersion: useCoupon ? state.coupons.updated_at : null, quote };
  const operation = { id, membershipId: target.id,
    fingerprint: createHash("sha256").update(JSON.stringify({ siteId, operatorId, membershipId: target.id, items, note: request.note })).digest("hex") };
  const mutation = { operation, settings: change(state.settings), memberships: change(state.memberships) };
  if (mutation.settings.next.redemptionItems[0].stock !== null) {
    mutation.settings.next.redemptionItems[0].stock -= quantity;
    mutation.settings.next.redemptionStockOperationIds.push(`[op:member-redemption-stock:${id}]`);
  }
  mutation.memberships.next[0].pointBalance -= points;
  const transactionId = `transaction-${id}`;
  mutation.memberships.next[0].transactions.push({ ...entry(transactionId, -points), operatorId,
    note: `${request.note} [op:member-redemption-checkout:${id}]` });
  if (useCoupon) {
    mutation.coupons = change(state.coupons);
    const coupon = mutation.coupons.next[0]; const claim = coupon.claimEvents[0];
    coupon.usedCount += 1;
    coupon.redeemEvents.push({ id: `redeem-${id}`, at: time, claimEventId: claim.id, settlementCode: claim.settlementCode,
      accountId: claim.accountId, userId: "", operatorId, note: `[op:member-redemption-checkout:${id}]` });
  }
  const result = { version: 1, operationId: id, siteId, membershipId: target.id, transactionId, createdAt: time,
    beforePointBalance: target.pointBalance, afterPointBalance: target.pointBalance - points, ...quote, note: request.note };
  return { siteId, operatorId, operation, request, mutation, result };
}
function stageSql(prepared) {
  return `select public.faolla_stage_redemption_checkout_v1(${textSql(prepared.siteId)},${textSql(prepared.operatorId)},${jsonSql(prepared.operation)},${jsonSql(prepared.request)});`;
}
function checkoutSql(prepared) {
  return `select public.faolla_commit_redemption_v2(${textSql(prepared.siteId)},${textSql(prepared.operatorId)},${jsonSql(prepared.mutation)},${jsonSql(prepared.result)});`;
}
function contextSql(prepared, action = "get", operationId = prepared.operation.id) {
  const id = operationId === null ? "null" : textSql(operationId);
  return `select public.faolla_${action}_redemption_checkout_v1(${textSql(prepared.siteId)},${textSql(prepared.operatorId)},${id});`;
}
async function rpc(sql) { return objectResult(await query(`set role service_role; ${sql}`)); }
async function stage(prepared) { return (await rpc(stageSql(prepared))).checkout; }
async function get(prepared, operationId = prepared.operation.id) { return (await rpc(contextSql(prepared, "get", operationId))).checkout; }
async function preparedFixture(id, options = {}) {
  const { siteId, state } = await seed(5);
  const prepared = plan(siteId, state, id, options);
  await stage(prepared);
  return prepared;
}
let checks = 0;
function passed(label) { checks += 1; console.log(`[checkout-postgres] passed ${label}`); }

const publicFunctions = [
  "public.faolla_stage_redemption_checkout_v1(text,text,jsonb,jsonb)", "public.faolla_get_redemption_checkout_v1(text,text,text)",
  "public.faolla_cancel_redemption_checkout_v1(text,text,text)", "public.faolla_ack_redemption_checkout_v1(text,text,text)",
  "public.faolla_commit_redemption_v2(text,text,jsonb,jsonb)", "public.faolla_commit_redemption_v1(text,jsonb)",
];
const internalFunctions = [
  "public.faolla_commit_redemption_internal_v1(text,jsonb)", "public.faolla_redemption_checkout_identity_internal(text,text,text)",
  "public.faolla_redemption_checkout_json_internal(public.faolla_redemption_checkouts)",
  "public.faolla_redemption_checkout_quote_internal(jsonb)", "public.faolla_redemption_checkout_request_internal(jsonb,jsonb)",
  "public.faolla_redemption_checkout_terminal_internal(text,text,text,boolean)",
];

try {
  assert.equal(await query("select current_database();"), "faolla_checkout_test");
  assert.equal(await query("select host(inet_server_addr());"), expectedServerAddress);
  assert.equal(await query("select inet_server_port();"), port);
  if (port === "56451") {
    const expectedDataDirectory = fileURLToPath(new URL("../../.runtime/checkout-test-pg", import.meta.url));
    const normalizePath = (value) => value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
    assert.equal(normalizePath(await query("show data_directory;")), normalizePath(expectedDataDirectory), "Refusing another PostgreSQL instance");
  }
  assert.equal(await query(`select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`), "0", "Refusing a non-empty database");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const migrations = await Promise.all(["202609080045_order_membership_atomic_mutation.sql", "202609080046_redemption_atomic_mutation.sql",
    "202609080047_redemption_checkout_context.sql"].map((name) => readFile(new URL(`../supabase-migrations/${name}`, import.meta.url), "utf8")));
  function ddl(pattern, label) { const found = init.match(pattern)?.[0]; assert.ok(found, `Missing real ${label} fixture DDL`); return found; }
  await query(`create extension if not exists pgcrypto;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if not exists(select 1 from pg_roles where rolname='checkout_test_untrusted') then create role checkout_test_untrusted nologin; end if;
    end $$;
    ${ddl(/create table if not exists public\.pages \([\s\S]*?\n\);/i, "pages")}
    ${ddl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i, "timestamp function")}
    ${ddl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i, "timestamp trigger")}
    ${ddl(/create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i, "tenant slug index")}
    alter table public.pages enable row level security;
    create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());
    insert into public.pages(merchant_id,slug,blocks) values(null,'home','{"keep":"public-home"}'),('10000000','home','{"keep":"merchant-home"}');`);
  await query(migrations[0]); await query(migrations[1]);
  // A genuine 046 receipt created before 047, not a forged context/result.
  const legacySeed = await seed(5);
  const legacy = plan(legacySeed.siteId, legacySeed.state, "legacy-before-context");
  await ordinary(legacy.siteId, legacy.mutation);
  await query(migrations[2]);
  const untouchedPages = (await allState()).pages.filter((item) => item.slug === "home");
  passed("real 045/046/047 migrations apply to the checked empty dedicated instance");

  for (const fn of [...publicFunctions, ...internalFunctions]) await query(`grant execute on function ${fn} to checkout_test_untrusted;`);
  await query("grant select(request),update(result) on public.faolla_redemption_checkouts to checkout_test_untrusted; grant select on public.faolla_redemption_checkouts to service_role;");
  await query(migrations[2]);
  for (const fn of [...publicFunctions, ...internalFunctions]) {
    for (const role of ["anon", "authenticated", "checkout_test_untrusted", "service_role"]) {
      assert.equal(await query(`select has_function_privilege('${role}','${fn}','execute');`), role === "service_role" && publicFunctions.includes(fn) ? "t" : "f");
    }
    assert.equal(await query(`select proconfig::text from pg_proc where oid='${fn}'::regprocedure;`), '{"search_path=pg_catalog, public"}');
  }
  for (const role of ["anon", "authenticated", "service_role", "checkout_test_untrusted"]) {
    for (const table of ["faolla_redemption_checkouts", "faolla_redemption_operations"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        assert.equal(await query(`select has_table_privilege('${role}','public.${table}','${privilege}');`), "f");
      }
      const denied = await execute(`set role ${role}; select * from public.${table};`).done;
      assert.notEqual(denied.code, 0); assert.match(denied.errorOutput, /permission denied for table/);
    }
  }
  const deniedInternal = await execute(`set role service_role; select public.faolla_commit_redemption_internal_v1('10000000','{}');`).done;
  assert.notEqual(deniedInternal.code, 0); assert.match(deniedInternal.errorOutput, /permission denied for function/);
  passed("migration replay removes drifted function/table/column ACLs; internals are not callable by service_role");
  await rejectUnchanged(stageSql(legacy), /redemption_legacy_operation_requires_review/);
  await rejectUnchanged(checkoutSql(legacy), /redemption_legacy_operation_requires_review/);
  await rejectUnchanged(ordinarySql(legacy.siteId, legacy.mutation), /redemption_checkout_context_required/);
  passed("legacy 046 receipt cannot be adopted or bypass context through the old public writer");

  const first = await preparedFixture("response-lost");
  const staged = await get(first, null);
  assert.equal(staged.status, "pending"); assert.deepEqual(staged.request, first.request);
  const beforeStageReplay = await allState(); assert.deepEqual(await stage(first), staged); assert.deepEqual(await allState(), beforeStageReplay);
  const alternate = plan(first.siteId, await snapshot(first.siteId), "different-id");
  await rejectUnchanged(stageSql(alternate), /redemption_pending_checkout_exists/);
  await rejectUnchanged(contextSql(first, "ack"), /redemption_checkout_not_terminal/);
  passed("stage is immutable/idempotent and one unacknowledged slot blocks new IDs and pending ack");
  const committed = await rpc(checkoutSql(first));
  assert.equal(committed.replayed, false); assert.deepEqual(committed.result, first.result);
  const persisted = await snapshot(first.siteId);
  assert.equal(persisted.settings.blocks.redemptionItems[0].stock, 4);
  assert.equal(persisted.memberships.blocks[0].pointBalance, 180); assert.equal(persisted.coupons.blocks[0].usedCount, 1);
  const afterCommit = await allState();
  const restored = await get(first, null); assert.equal(restored.status, "committed"); assert.deepEqual(restored.result, first.result);
  assert.equal((await rpc(checkoutSql(first))).replayed, true); assert.deepEqual(await allState(), afterCommit);
  await rejectUnchanged(stageSql(plan(first.siteId, persisted, "blocked-unack-result")), /redemption_pending_checkout_exists/);
  assert.equal((await rpc(contextSql(first, "cancel"))).checkout.status, "committed");
  assert.deepEqual(await allState(), afterCommit);
  passed("lost commit response reloads immutable terminal result, blocks new checkout and cannot be cancelled");
  const acknowledged = (await rpc(contextSql(first, "ack"))).checkout;
  assert.ok(acknowledged.acknowledgedAt); assert.equal(await get(first, null), null);
  const afterAck = await allState(); await rpc(contextSql(first, "ack")); assert.deepEqual(await allState(), afterAck);
  await stage(plan(first.siteId, await snapshot(first.siteId), "new-after-ack", { useCoupon: false }));
  const oldReplay = await rpc(checkoutSql(first)); assert.deepEqual(oldReplay.result, first.result); assert.equal(oldReplay.replayed, true);
  passed("explicit terminal ack frees the slot but preserves original result/idempotency tombstone");

  const cancelled = await preparedFixture("cancel-before-commit");
  const beforeCancel = await snapshot(cancelled.siteId);
  const cancelledResult = (await rpc(contextSql(cancelled, "cancel"))).checkout;
  assert.equal(cancelledResult.status, "cancelled"); assert.equal(cancelledResult.result, null);
  await rejectUnchanged(checkoutSql(cancelled), /redemption_checkout_cancelled/);
  assert.deepEqual(await snapshot(cancelled.siteId), beforeCancel);
  await rejectUnchanged(stageSql(plan(cancelled.siteId, beforeCancel, "cancelled-slot-still-held")), /redemption_pending_checkout_exists/);
  await rpc(contextSql(cancelled, "ack")); await stage(plan(cancelled.siteId, beforeCancel, "after-cancel-ack"));
  await rejectUnchanged(checkoutSql(cancelled), /redemption_checkout_cancelled/);
  passed("cancel first writes a permanent tombstone, changes no finances and requires terminal acknowledgement");

  const commitWins = await preparedFixture("race-commit-wins");
  const committedRace = await race(checkoutSql(commitWins), contextSql(commitWins, "cancel"));
  assert.equal(committedRace.first.replayed, false); assert.equal(committedRace.second.checkout.status, "committed");
  const cancelWins = await preparedFixture("race-cancel-wins");
  await race(contextSql(cancelWins, "cancel"), checkoutSql(cancelWins), /redemption_checkout_cancelled/);
  assert.equal((await snapshot(cancelWins.siteId)).memberships.blocks[0].pointBalance, 200);
  const same = await preparedFixture("same-concurrent-commit");
  const sameRace = await race(checkoutSql(same), checkoutSql(same));
  assert.equal(sameRace.first.replayed, false); assert.equal(sameRace.second.replayed, true);
  assert.equal((await snapshot(same.siteId)).memberships.blocks[0].transactions.length, 1);
  const stageSeed = await seed(5); const stageOne = plan(stageSeed.siteId, stageSeed.state, "stage-one");
  const stageTwo = plan(stageSeed.siteId, stageSeed.state, "stage-two");
  await race(stageSql(stageOne), stageSql(stageTwo), /redemption_pending_checkout_exists/);
  passed("real independent connections observe lock waits for both commit/cancel orderings, duplicate commit and competing stage");

  const isolation = await preparedFixture("actor-site-isolation");
  const otherActor = { ...isolation, operatorId: "employee:other" };
  assert.equal(await get(otherActor), null); assert.equal(await get(otherActor, null), null);
  const otherSite = { ...isolation, siteId: "19999999" };
  assert.equal(await get(otherSite), null); assert.equal(await get(otherSite, null), null);
  for (const altered of [otherActor, otherSite]) {
    await rejectUnchanged(checkoutSql(altered), /redemption_(operation_conflict|checkout_context_required)/);
    await rejectUnchanged(contextSql(altered, "cancel"), /redemption_(operation_conflict|checkout_not_found)/);
    await rejectUnchanged(contextSql(altered, "ack"), /redemption_(operation_conflict|checkout_not_found)/);
  }
  const coworker = plan(isolation.siteId, await snapshot(isolation.siteId), "coworker-slot", { operatorId: "employee:coworker" });
  assert.equal((await stage(coworker)).status, "pending");
  passed("GET discloses no context to another actor/site; mutations reject mismatch and coworker slots are independent");

  for (const part of ["fingerprint", "membershipId", "request", "quote", "settingsPin", "couponPin"]) {
    const altered = structuredClone(isolation);
    if (part === "fingerprint") altered.operation.fingerprint = "f".repeat(64);
    if (part === "membershipId") { altered.operation.membershipId = "member-2"; altered.request.membershipId = "member-2"; }
    if (part === "request") altered.request.note = "changed original note";
    if (part === "quote") { altered.request.quote.lines[0].name = "Changed immutable quote"; }
    if (part === "settingsPin") altered.request.settingsVersion = "2026-01-01T00:00:00Z";
    if (part === "couponPin") altered.request.couponVersion = null;
    await rejectUnchanged(stageSql(altered), /redemption_(operation_conflict|checkout_quote_changed)/);
  }
  for (const part of ["resultQuote", "before", "after", "operator", "settingsPin", "couponPin", "otherMember", "requestProfile"]) {
    const altered = structuredClone(isolation);
    if (part === "resultQuote") altered.result.lines[0].name = "Changed receipt";
    if (part === "before") altered.result.beforePointBalance += 1;
    if (part === "after") altered.result.afterPointBalance += 1;
    if (part === "operator") altered.mutation.memberships.next[0].transactions[0].operatorId = "owner:forged";
    if (part === "settingsPin") altered.mutation.settings.expectedUpdatedAt = null;
    if (part === "couponPin") altered.mutation.coupons.expectedUpdatedAt = null;
    if (part === "otherMember") altered.mutation.memberships.next[1].pointBalance -= 1;
    if (part === "requestProfile") altered.result.email = "must-not-persist@example.test";
    await rejectUnchanged(checkoutSql(altered), /invalid_redemption_checkout|redemption_checkout_quote_changed/);
  }
  passed("immutable intent, quote, pinned versions and authority receipt/debit/operator binding reject substitutions without writes");

  const pins = await preparedFixture("old-pending-pins");
  const settingsEdit = change((await snapshot(pins.siteId)).settings); settingsEdit.next.redemptionItems[0].pointsCost += 1;
  await ordinary(pins.siteId, { settings: settingsEdit });
  await rejectUnchanged(checkoutSql(pins), /merchant_membership_settings_conflict/);
  const refreshed = plan(pins.siteId, await snapshot(pins.siteId), pins.operation.id);
  await rejectUnchanged(stageSql(refreshed), /redemption_checkout_quote_changed/);
  passed("an old pending intent cannot silently reprice/rebase after ordinary settings changes");

  // Every context write boundary: raised error, suppressed DML and post-write tamper.
  for (const suppress of [false, true]) {
    for (const action of ["stage", "commit", "cancel", "ack"]) {
      const fixture = await seed(5); const prepared = plan(fixture.siteId, fixture.state, `fault-${action}-${suppress}`);
      if (action !== "stage") await stage(prepared);
      if (action === "ack") await rpc(contextSql(prepared, "cancel"));
      await query(`create function public.checkout_test_context_failure() returns trigger language plpgsql as $$ begin
        if new.merchant_id=${textSql(prepared.siteId)} then ${suppress ? "return null;" : "raise exception 'checkout_test_context_failure';"} end if;
        return new; end $$;
        create trigger checkout_test_context_failure before insert or update on public.faolla_redemption_checkouts for each row execute function public.checkout_test_context_failure();`);
      try {
        const sql = action === "stage" ? stageSql(prepared) : action === "commit" ? checkoutSql(prepared) : contextSql(prepared, action);
        await rejectUnchanged(sql, suppress ? /redemption_checkout_mutation_not_persisted/ : /checkout_test_context_failure/);
      } finally { await query("drop trigger checkout_test_context_failure on public.faolla_redemption_checkouts; drop function public.checkout_test_context_failure();"); }
    }
  }
  passed("stage/commit/cancel/ack raised failures and suppressed context writes preserve all pages and both durable tables");

  for (const target of ["member", "history", "operation", "context"]) {
    const prepared = await preparedFixture(`after-context-${target}`);
    const body = target === "member" ? `update public.pages set blocks=jsonb_set(blocks,'{0,pointBalance}','999') where merchant_id=new.merchant_id and slug='__merchant_memberships__:'||new.merchant_id;`
      : target === "history" ? `update public.pages set blocks=jsonb_set(blocks,'{tampered}','true') where merchant_id=new.merchant_id and slug='__merchant_membership_settings_history_backup__:'||new.merchant_id;`
      : target === "operation" ? `update public.faolla_redemption_operations set fingerprint=repeat('e',64) where merchant_id=new.merchant_id and operation_id=new.operation_id;`
      : `update public.faolla_redemption_checkouts set result=jsonb_set(result,'{totalPoints}','999') where merchant_id=new.merchant_id and operation_id=new.operation_id;`;
    await query(`create function public.checkout_test_context_after() returns trigger language plpgsql as $$ begin
      if new.status='committed' and pg_trigger_depth()=1 then ${body} end if; return new; end $$;
      create trigger checkout_test_context_after after update on public.faolla_redemption_checkouts for each row execute function public.checkout_test_context_after();`);
    try { await rejectUnchanged(checkoutSql(prepared), /redemption_checkout_mutation_not_persisted/); }
    finally { await query("drop trigger checkout_test_context_after on public.faolla_redemption_checkouts; drop function public.checkout_test_context_after();"); }
  }
  passed("context AFTER triggers cannot rewrite earlier member/history/046 receipt or authority result and still commit");

  for (const prefix of ["__merchant_memberships__:", "__merchant_membership_settings__:", "__merchant_coupons__:",
    "__merchant_memberships_history__:", "__merchant_memberships_history_backup__:", "__merchant_membership_settings_history__:",
    "__merchant_membership_settings_history_backup__:", "__merchant_coupons_history__:", "__merchant_coupons_history_backup__:"]) {
    const prepared = await preparedFixture(`domain-fault-${checks}-${prefix.length}`);
    await query(`create function public.checkout_test_domain_failure() returns trigger language plpgsql as $$ begin
      if new.merchant_id=${textSql(prepared.siteId)} and new.slug=${textSql(prefix + prepared.siteId)} then raise exception 'checkout_test_domain_failure'; end if;
      return new; end $$;
      create trigger checkout_test_domain_failure before insert or update on public.pages for each row execute function public.checkout_test_domain_failure();`);
    try { await rejectUnchanged(checkoutSql(prepared), /checkout_test_domain_failure/); }
    finally { await query("drop trigger checkout_test_domain_failure on public.pages; drop function public.checkout_test_domain_failure();"); }
  }
  passed("every nested financial document and primary/backup history failure keeps the context pending and rolls back the complete checkout");

  const bonus = await preparedFixture("upgrade-bonus-net-points", { useCoupon: false });
  bonus.mutation.memberships.next[0].transactions.push({ ...entry("upgrade-bonus", 50), type: "adjustment",
    operatorId: OPERATOR, note: "Synthetic level upgrade gift" });
  bonus.mutation.memberships.next[0].pointBalance += 50; bonus.result.afterPointBalance += 50;
  assert.equal((await rpc(checkoutSql(bonus))).result.afterPointBalance, 230);
  assert.equal((await snapshot(bonus.siteId)).memberships.blocks[0].pointBalance, 230);
  passed("an explained upgrade gift may make the final point balance exceed the original balance");

  const futureSeed = await seed(5);
  const futureHistory = change(futureSeed.state.coupons);
  futureHistory.next[0].usedCount = 2; futureHistory.next[0].claimedCount = 3;
  futureHistory.next[0].redeemEvents = ["2027-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"].map((at, index) => ({
    id: `future-history-${index}`, at, claimEventId: `future-claim-${index}`, settlementCode: `FUTURE-${index}`,
    accountId: "account-1", userId: "", operatorId: OPERATOR, note: "Synthetic historical redemption" }));
  await ordinary(futureSeed.siteId, { coupons: futureHistory });
  const futureState = await snapshot(futureSeed.siteId);
  const reusedClaim = plan(futureSeed.siteId, futureState, "reused-old-coupon-claim", { operatorId: "employee:reuse-test" });
  const oldClaim = futureHistory.next[0].redeemEvents[0];
  reusedClaim.request.items[1].couponClaimId = oldClaim.claimEventId;
  reusedClaim.request.items[1].couponSettlementCode = oldClaim.settlementCode;
  Object.assign(reusedClaim.mutation.coupons.next[0].redeemEvents.at(-1), {
    claimEventId: oldClaim.claimEventId, settlementCode: oldClaim.settlementCode });
  await stage(reusedClaim);
  await rejectUnchanged(checkoutSql(reusedClaim), /invalid_redemption_checkout/);
  const futurePlan = plan(futureSeed.siteId, futureState, "future-history-interleaves-new");
  futurePlan.mutation.coupons.next[0].redeemEvents.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  await stage(futurePlan);
  const swappedOld = structuredClone(futurePlan);
  swappedOld.mutation.coupons.next[0].redeemEvents.reverse();
  await rejectUnchanged(checkoutSql(swappedOld), /invalid_redemption_checkout/);
  for (const badId of ["", 123, "future-history-0"]) {
    const invalidNewId = structuredClone(futurePlan);
    invalidNewId.mutation.coupons.next[0].redeemEvents[1].id = badId;
    await rejectUnchanged(checkoutSql(invalidNewId), /invalid_redemption_checkout/);
  }
  assert.equal((await rpc(checkoutSql(futurePlan))).replayed, false);
  assert.deepEqual((await snapshot(futureSeed.siteId)).coupons.blocks[0].redeemEvents.map((event) => event.id),
    ["future-history-0", "redeem-future-history-interleaves-new", "future-history-1"]);
  passed("future-dated old coupon events may precede the new event; old order and already-used claim/settlement remain protected");

  for (const corruption of ["empty", "non-string", "duplicate"]) {
    const corruptedSeed = await seed(5);
    const corruptedCoupons = structuredClone(corruptedSeed.state.coupons.blocks);
    corruptedCoupons[0].redeemEvents = structuredClone(futureHistory.next[0].redeemEvents);
    corruptedCoupons[0].redeemEvents[0].id = corruption === "empty" ? "" : corruption === "non-string" ? 123 : "future-history-1";
    // Deliberately corrupt only a new synthetic fixture using the test superuser.
    // A normal service writer rejects this input, so it cannot seed the counterexample.
    await query(`update public.pages set blocks=${jsonSql(corruptedCoupons)} where merchant_id=${textSql(corruptedSeed.siteId)}
      and slug=${textSql(`__merchant_coupons__:${corruptedSeed.siteId}`)};`);
    const corruptedPlan = plan(corruptedSeed.siteId, await snapshot(corruptedSeed.siteId), `corrupt-old-event-${corruption}`);
    const normalizedIds = new Set();
    corruptedPlan.mutation.coupons.next[0].redeemEvents = corruptedPlan.mutation.coupons.next[0].redeemEvents.filter((event) => {
      if (typeof event.id !== "string" || !event.id || normalizedIds.has(event.id)) return false;
      normalizedIds.add(event.id); return true;
    });
    await stage(corruptedPlan);
    await rejectUnchanged(checkoutSql(corruptedPlan), /redemption_checkout_store_corrupt/);
  }
  passed("empty, non-string and duplicate old/new coupon event IDs cannot disappear through an indexed normalization path");

  const historySeed = await seed(5);
  const historyMutation = change(historySeed.state.coupons);
  const historicalCoupon = historyMutation.next[0];
  historicalCoupon.totalQuantity = 10000; historicalCoupon.claimedCount = 5001; historicalCoupon.usedCount = 5000;
  historicalCoupon.redeemEvents = Array.from({ length: 5000 }, (_, index) => ({ id: `historical-${index}`, at: time,
    claimEventId: `historical-claim-${index}`, settlementCode: `HISTORICAL-${index}`, accountId: "account-1", userId: "",
    operatorId: OPERATOR, note: "Synthetic historical redemption" }));
  await ordinary(historySeed.siteId, { coupons: historyMutation });
  const historyPlan = plan(historySeed.siteId, await snapshot(historySeed.siteId), "coupon-history-tail-limit");
  const events = historyPlan.mutation.coupons.next[0].redeemEvents;
  const newEvent = events.pop();
  historyPlan.mutation.coupons.next[0].redeemEvents = [newEvent, ...events].slice(0, 5000);
  await stage(historyPlan);
  const lostMiddle = structuredClone(historyPlan);
  lostMiddle.mutation.coupons.next[0].redeemEvents.splice(2500, 1);
  lostMiddle.mutation.coupons.next[0].redeemEvents.push(events.at(-1));
  await rejectUnchanged(checkoutSql(lostMiddle), /invalid_redemption_checkout/);
  assert.equal((await rpc(checkoutSql(historyPlan))).replayed, false);
  const savedHistory = (await snapshot(historySeed.siteId)).coupons.blocks[0];
  assert.equal(savedHistory.usedCount, 5001); assert.equal(savedHistory.redeemEvents.length, 5000);
  assert.equal(savedHistory.redeemEvents[0].id, newEvent.id);
  assert.equal(savedHistory.redeemEvents.at(-1).id, "historical-4998");
  passed("5000 coupon events retain the exact old prefix; only the final tail may be truncated for a new redemption");

  const priorReplay = await allState(); await query(migrations[2]); assert.deepEqual(await allState(), priorReplay);
  for (const page of untouchedPages) assert.deepEqual((await allState()).pages.find((item) => item.id === page.id), page);
  passed("populated 047 migration replay preserves every result, tombstone, pending request and unrelated page");
  console.log(`[checkout-postgres] ${checks} checks passed; PostgreSQL ${await query("show server_version;")}`);
  console.log("[checkout-postgres] real transaction/context/ACL acceptance only; app pricing, HTTP authorization/redaction and browser recovery remain separately tested");
} finally { for (const child of activeChildren) child.kill(); }
