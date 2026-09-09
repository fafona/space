import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// A separate empty disposable instance, never the app's database or env files.
if (process.env.REDEMPTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") {
  throw new Error("Set REDEMPTION_INTEGRATION_ALLOW_DISPOSABLE_DATABASE=1 for a new empty local test database");
}
const port = process.env.REDEMPTION_TEST_PORT || "56450";
if (!/^\d{4,5}$/.test(port) || Number(port) > 65535) throw new Error("invalid_test_port");
const psql = process.env.REDEMPTION_TEST_PSQL || "psql";
const args = ["--host=127.0.0.1", `--port=${port}`, "--username=postgres", "--dbname=faolla_redemption_test",
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
  const applicationName = `faolla_redemption_test_${++connectionSequence}`;
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
function commitSql(siteId, mutation) { return `select public.faolla_commit_redemption_v1(${textSql(siteId)},${jsonSql(mutation)});`; }
function memberSql(siteId, mutation) { return `select public.faolla_commit_order_membership_v1(${textSql(siteId)},${jsonSql({ memberships: mutation })});`; }
function lookupSql(siteId, operation) {
  return `select public.faolla_get_redemption_operation_v1(${[siteId, operation.id, operation.fingerprint, operation.membershipId].map(textSql).join(",")});`;
}
function objectResult(output) {
  const line = output.split(/\r?\n/).find((item) => item.trim().startsWith("{"));
  assert.ok(line, "RPC must return a JSON object");
  return JSON.parse(line);
}
async function commit(siteId, mutation) { return objectResult(await query(`set role service_role; ${commitSql(siteId, mutation)}`)); }
async function lookup(siteId, operation) { return objectResult(await query(`set role service_role; ${lookupSql(siteId, operation)}`)); }
async function allState() {
  return JSON.parse(await query(`select jsonb_build_object(
    'pages',(select coalesce(jsonb_agg(to_jsonb(p) order by merchant_id nulls first,slug,id),'[]'::jsonb) from public.pages p),
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by merchant_id,operation_id),'[]'::jsonb) from public.faolla_redemption_operations o));`));
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
  const marker = "__REDEMPTION_TRANSACTION_HELD__";
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
let tenantSequence = 11000000;
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
  await commit(siteId, { settings: { expectedUpdatedAt: null, next: settings(siteId, stock) }, coupons: { expectedUpdatedAt: null, next: [coupon(siteId, 1), coupon(siteId, 2)] } });
  return { siteId, state: await snapshot(siteId) };
}
function checkout(siteId, state, id, { memberIndex = 0, quantity = 1, points = 20, couponIndex = 0 } = {}) {
  const mutation = { settings: change(state.settings), memberships: change(state.memberships) };
  const targetMember = mutation.memberships.next[memberIndex];
  const request = { siteId, membershipId: targetMember.id, quantity, couponId: couponIndex === null ? null : state.coupons.blocks[couponIndex].id };
  mutation.operation = { id, fingerprint: createHash("sha256").update(JSON.stringify(request)).digest("hex"), membershipId: targetMember.id };
  if (quantity > 0 && mutation.settings.next.redemptionItems[0].stock !== null) {
    mutation.settings.next.redemptionItems[0].stock -= quantity;
    mutation.settings.next.redemptionStockOperationIds.push(`[op:member-redemption-stock:${id}]`);
  }
  targetMember.pointBalance -= points;
  targetMember.transactions.push(entry(id, -points));
  if (couponIndex !== null) {
    mutation.coupons = change(state.coupons);
    const targetCoupon = mutation.coupons.next[couponIndex];
    const claim = targetCoupon.claimEvents[0];
    targetCoupon.usedCount += 1;
    targetCoupon.redeemEvents.push({ id: `redeem-${id}`, at: time, claimEventId: claim.id, settlementCode: claim.settlementCode,
      accountId: claim.accountId, userId: "", operatorId: "fixture-owner", note: `[op:member-redemption-checkout:${id}]` });
  }
  return mutation;
}
function receiptCount(state, siteId) { return state.operations.filter((item) => item.merchant_id === siteId).length; }
let checks = 0;
function passed(label) { checks += 1; console.log(`[redemption-postgres] passed ${label}`); }

try {
  assert.equal(await query("select current_database();"), "faolla_redemption_test");
  assert.equal(await query(`select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and c.relkind in ('r','p','v','m','S','f');`), "0", "Refusing a non-empty database");
  const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
  const orderMigration = await readFile(new URL("../supabase-migrations/202609080045_order_membership_atomic_mutation.sql", import.meta.url), "utf8");
  const redemptionMigration = await readFile(new URL("../supabase-migrations/202609080046_redemption_atomic_mutation.sql", import.meta.url), "utf8");
  function ddl(pattern, label) { const found = init.match(pattern)?.[0]; assert.ok(found, `Missing real ${label} fixture DDL`); return found; }
  await query(`create extension if not exists pgcrypto;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      if not exists(select 1 from pg_roles where rolname='redemption_test_untrusted') then create role redemption_test_untrusted nologin; end if;
    end $$;
    ${ddl(/create table if not exists public\.pages \([\s\S]*?\n\);/i, "pages")}
    ${ddl(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i, "timestamp function")}
    ${ddl(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i, "timestamp trigger")}
    ${ddl(/create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i, "tenant slug index")}
    alter table public.pages enable row level security;
    create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());
    insert into public.pages(merchant_id,slug,blocks) values (null,'home','{"keep":"public-home"}'),('10000000','home','{"keep":"merchant-home"}');`);
  await query(orderMigration);
  await query(redemptionMigration);
  const untouchedPages = (await allState()).pages;
  for (const fn of ["public.faolla_commit_redemption_v1(text,jsonb)", "public.faolla_get_redemption_operation_v1(text,text,text,text)"]) {
    await query(`grant execute on function ${fn} to redemption_test_untrusted;`);
  }
  await query(redemptionMigration);
  for (const fn of ["public.faolla_commit_redemption_v1(text,jsonb)", "public.faolla_get_redemption_operation_v1(text,text,text,text)"]) {
    for (const role of ["anon", "authenticated", "redemption_test_untrusted"]) {
      assert.equal(await query(`select has_function_privilege('${role}','${fn}','execute');`), "f");
    }
    assert.equal(await query(`select has_function_privilege('service_role','${fn}','execute');`), "t");
    assert.equal(await query(`select proconfig::text from pg_proc where oid='${fn}'::regprocedure;`), '{"search_path=pg_catalog, public"}');
  }
  for (const role of ["anon", "authenticated", "service_role", "redemption_test_untrusted"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      assert.equal(await query(`select has_table_privilege('${role}','public.faolla_redemption_operations','${privilege}');`), "f");
    }
    const deniedTable = await execute(`set role ${role}; select * from public.faolla_redemption_operations;`).done;
    assert.notEqual(deniedTable.code, 0);
    assert.match(deniedTable.errorOutput, /permission denied for table faolla_redemption_operations/);
    if (role !== "service_role") {
      for (const sql of [commitSql("10000000", {}), lookupSql("10000000", { id: "not-authorized", fingerprint: "0".repeat(64), membershipId: "member-1" })]) {
        const deniedRpc = await execute(`set role ${role}; ${sql}`).done;
        assert.notEqual(deniedRpc.code, 0);
        assert.match(deniedRpc.errorOutput, /permission denied for function faolla_(?:commit_redemption|get_redemption_operation)_v1/);
      }
    }
  }
  passed("migration replay normalizes service-only RPC ACLs and denies direct receipt-table access");

  const first = await seed();
  const request = checkout(first.siteId, first.state, "response-lost");
  assert.deepEqual(await lookup(first.siteId, request.operation), { committed: false });
  const result = await commit(first.siteId, request);
  assert.equal(result.replayed, false);
  assert.equal(result.membershipId, request.operation.membershipId);
  let state = await snapshot(first.siteId);
  assert.equal(state.settings.blocks.redemptionItems[0].stock, 0);
  assert.equal(state.memberships.blocks[0].pointBalance, 180);
  assert.equal(state.coupons.blocks[0].usedCount, 1);
  assert.equal(receiptCount(await allState(), first.siteId), 1);
  for (const [domain, document] of Object.entries(state)) assert.equal(Date.parse(result.versions[domain]), Date.parse(document.updated_at));
  passed("stock, coupon, points, histories and one receipt commit together with actual stored versions");

  const responseLostState = await allState();
  assert.equal((await commit(first.siteId, request)).replayed, true);
  assert.deepEqual(await lookup(first.siteId, request.operation), { committed: true, membershipId: request.operation.membershipId });
  assert.deepEqual(await allState(), responseLostState);
  passed("response-loss retry succeeds after stock reaches zero and the coupon is used, without any additional write");
  const noopBefore = await allState();
  await commit(first.siteId, { settings: change(state.settings), coupons: change(state.coupons), memberships: change(state.memberships) });
  assert.deepEqual(await allState(), noopBefore);
  passed("ordinary unchanged documents pass CAS without changing timestamps, histories or receipts");
  for (const operation of [
    { ...request.operation, fingerprint: "f".repeat(64) }, { ...request.operation, membershipId: "member-2" },
  ]) {
    await rejectUnchanged(commitSql(first.siteId, { ...request, operation }), /redemption_operation_conflict/);
    await rejectUnchanged(lookupSql(first.siteId, operation), /redemption_operation_conflict/);
  }
  passed("same operation ID with a different fingerprint or member is rejected by commit and lookup");
  const populatedBeforeReplay = await allState();
  await query(redemptionMigration);
  assert.deepEqual(await allState(), populatedBeforeReplay);
  passed("reapplying the migration preserves populated receipts and financial documents");

  const repeated = await seed();
  const repeatedRequest = checkout(repeated.siteId, repeated.state, "same-concurrent-operation");
  const replayRace = await race(commitSql(repeated.siteId, repeatedRequest), commitSql(repeated.siteId, repeatedRequest));
  assert.equal(replayRace.first.replayed, false);
  assert.equal(replayRace.second.replayed, true);
  assert.equal((await snapshot(repeated.siteId)).memberships.blocks[0].transactions.length, 1);
  assert.equal(receiptCount(await allState(), repeated.siteId), 1);
  passed("two concurrent identical operations have one financial commit and one replay");

  for (const differentMember of [false, true]) {
    const competition = await seed();
    const left = checkout(competition.siteId, competition.state, "last-stock-first", { couponIndex: null });
    const right = checkout(competition.siteId, competition.state, "last-stock-second", { memberIndex: differentMember ? 1 : 0, couponIndex: null });
    await race(commitSql(competition.siteId, left), commitSql(competition.siteId, right), /merchant_membership_settings_conflict/);
    const final = await snapshot(competition.siteId);
    assert.equal(final.settings.blocks.redemptionItems[0].stock, 0);
    assert.equal(final.memberships.blocks[0].pointBalance, 180);
    assert.equal(final.memberships.blocks[1].pointBalance, 200);
    assert.equal(receiptCount(await allState(), competition.siteId), 1);
    const impossible = checkout(competition.siteId, final, "sold-out-new-operation", { memberIndex: differentMember ? 1 : 0, couponIndex: null });
    await rejectUnchanged(commitSql(competition.siteId, impossible), /invalid_redemption_mutation/);
  }
  passed("same-member and different-member contenders for the last item cannot oversell or double debit");

  const sameCoupon = await seed(null);
  const couponA = checkout(sameCoupon.siteId, sameCoupon.state, "coupon-first", { quantity: 0, points: 0 });
  const couponB = checkout(sameCoupon.siteId, sameCoupon.state, "coupon-second", { quantity: 0, points: 0 });
  await race(commitSql(sameCoupon.siteId, couponA), commitSql(sameCoupon.siteId, couponB), /merchant_coupons_conflict/);
  assert.equal((await snapshot(sameCoupon.siteId)).coupons.blocks[0].redeemEvents.length, 1);
  assert.equal(receiptCount(await allState(), sameCoupon.siteId), 1);
  passed("concurrent attempts for one coupon claim produce only one redemption event");

  const mixed = await seed();
  const mixedRequest = checkout(mixed.siteId, mixed.state, "mixed-cart");
  const useBeforeCommit = change(mixed.state.coupons);
  useBeforeCommit.next[0].usedCount = 1;
  useBeforeCommit.next[0].redeemEvents = structuredClone(mixedRequest.coupons.next[0].redeemEvents);
  await commit(mixed.siteId, { coupons: useBeforeCommit });
  await rejectUnchanged(commitSql(mixed.siteId, mixedRequest), /merchant_coupons_conflict/);
  const mixedFinal = await snapshot(mixed.siteId);
  assert.equal(mixedFinal.settings.blocks.redemptionItems[0].stock, 1);
  assert.equal(mixedFinal.memberships.blocks[0].pointBalance, 200);
  assert.equal(receiptCount(await allState(), mixed.siteId), 0);
  passed("a coupon consumed after mixed-cart preparation rejects the whole cart without charging points or stock");

  for (const domain of ["settings", "coupons"]) {
    for (const checkoutFirst of [false, true]) {
      const concurrent = await seed(3);
      const prepared = checkout(concurrent.siteId, concurrent.state, `edit-${domain}-${checkoutFirst}`);
      const edit = change(concurrent.state[domain]);
      if (domain === "settings") edit.next.redemptionItems[0].name = "Edited product name";
      else {
        edit.next[1].claimedCount += 1;
        edit.next[1].claimEvents.push({ ...edit.next[1].claimEvents[0], id: "ordinary-new-claim", settlementCode: `NEW-${concurrent.siteId}` });
      }
      const editSql = commitSql(concurrent.siteId, { [domain]: edit });
      const cartSql = commitSql(concurrent.siteId, prepared);
      await race(checkoutFirst ? cartSql : editSql, checkoutFirst ? editSql : cartSql,
        domain === "settings" ? /merchant_membership_settings_conflict/ : /merchant_coupons_conflict/);
      const refreshed = await snapshot(concurrent.siteId);
      if (checkoutFirst) {
        const rebase = change(refreshed[domain]);
        if (domain === "settings") rebase.next.redemptionItems[0].name = "Edited product name";
        else { rebase.next[1].claimedCount += 1; rebase.next[1].claimEvents.push(edit.next[1].claimEvents.at(-1)); }
        await commit(concurrent.siteId, { [domain]: rebase });
      } else await commit(concurrent.siteId, checkout(concurrent.siteId, refreshed, prepared.operation.id));
      const final = await snapshot(concurrent.siteId);
      assert.equal(final.settings.blocks.redemptionItems[0].stock, 2);
      assert.equal(final.memberships.blocks[0].pointBalance, 180);
      assert.equal(final.coupons.blocks[0].usedCount, 1);
      if (domain === "settings") assert.equal(final.settings.blocks.redemptionItems[0].name, "Edited product name");
      else assert.equal(final.coupons.blocks[1].claimEvents.length, 2);
    }
  }
  passed("settings edits and ordinary coupon writes share the checkout lock/CAS in both orderings without lost updates");

  for (const checkoutFirst of [false, true]) {
    const concurrent = await seed(3);
    const prepared = checkout(concurrent.siteId, concurrent.state, `recharge-race-${checkoutFirst}`);
    const recharge = change(concurrent.state.memberships);
    recharge.next[0].pointBalance += 50;
    recharge.next[0].transactions.push(entry("ordinary-recharge", 50));
    const chargeSql = memberSql(concurrent.siteId, recharge);
    const cartSql = commitSql(concurrent.siteId, prepared);
    await race(checkoutFirst ? cartSql : chargeSql, checkoutFirst ? chargeSql : cartSql, /merchant_memberships_conflict/);
    const refreshed = await snapshot(concurrent.siteId);
    if (checkoutFirst) {
      const rebase = change(refreshed.memberships);
      rebase.next[0].pointBalance += 50; rebase.next[0].transactions.push(entry("ordinary-recharge", 50));
      await query(`set role service_role; ${memberSql(concurrent.siteId, rebase)}`);
    } else await commit(concurrent.siteId, checkout(concurrent.siteId, refreshed, prepared.operation.id));
    const final = await snapshot(concurrent.siteId);
    assert.equal(final.memberships.blocks[0].pointBalance, 230);
    assert.equal(final.memberships.blocks[0].transactions.length, 2);
    assert.equal(final.settings.blocks.redemptionItems[0].stock, 2);
  }
  passed("045 member recharge and 046 checkout serialize in both orderings and retain both valid changes");

  const injected = await seed(10);
  const injectionSlugs = ["__merchant_memberships__:", "__merchant_membership_settings__:", "__merchant_coupons__:",
    "__merchant_memberships_history__:", "__merchant_memberships_history_backup__:",
    "__merchant_membership_settings_history__:", "__merchant_membership_settings_history_backup__:",
    "__merchant_coupons_history__:", "__merchant_coupons_history_backup__:"];
  for (const suppress of [false, true]) {
    for (const prefix of injectionSlugs) {
      await query(`create function public.redemption_test_failure() returns trigger language plpgsql as $$ begin
        if new.merchant_id=${textSql(injected.siteId)} and new.slug=${textSql(`${prefix}${injected.siteId}`)} then
          ${suppress ? "return null;" : "raise exception 'redemption_test_injected_failure';"}
        end if; return new; end $$;
        create trigger z_redemption_test_failure before insert or update on public.pages for each row execute function public.redemption_test_failure();`);
      try {
        await rejectUnchanged(commitSql(injected.siteId, checkout(injected.siteId, await snapshot(injected.siteId), `failure-${suppress}-${injectionSlugs.indexOf(prefix)}`)),
          suppress ? /(?:redemption|order_membership)_mutation_not_persisted/ : /redemption_test_injected_failure/);
      } finally { await query("drop trigger z_redemption_test_failure on public.pages; drop function public.redemption_test_failure();"); }
    }
    await query(`create function public.redemption_test_receipt_failure() returns trigger language plpgsql as $$ begin
      ${suppress ? "return null;" : "raise exception 'redemption_test_receipt_failure';"} end $$;
      create trigger redemption_test_receipt_failure before insert on public.faolla_redemption_operations for each row execute function public.redemption_test_receipt_failure();`);
    try {
      await rejectUnchanged(commitSql(injected.siteId, checkout(injected.siteId, await snapshot(injected.siteId), `receipt-failure-${suppress}`)),
        suppress ? /redemption_mutation_not_persisted/ : /redemption_test_receipt_failure/);
    } finally { await query("drop trigger redemption_test_receipt_failure on public.faolla_redemption_operations; drop function public.redemption_test_receipt_failure();"); }
  }
  passed("each domain, every primary/backup history and receipt failure or suppressed write rolls the entire checkout back");

  await query(`create function public.redemption_test_after_receipt() returns trigger language plpgsql as $$ begin
    update public.pages set blocks=jsonb_set(blocks,'{0,pointBalance}','999') where merchant_id=new.merchant_id and slug='__merchant_memberships__:'||new.merchant_id;
    return new; end $$;
    create trigger redemption_test_after_receipt after insert on public.faolla_redemption_operations for each row execute function public.redemption_test_after_receipt();`);
  try {
    await rejectUnchanged(commitSql(injected.siteId, checkout(injected.siteId, await snapshot(injected.siteId), "after-receipt-rewrite")), /redemption_mutation_not_persisted/);
  } finally { await query("drop trigger redemption_test_after_receipt on public.faolla_redemption_operations; drop function public.redemption_test_after_receipt();"); }
  passed("a receipt AFTER trigger rewriting an earlier financial document is detected and rolled back");

  for (const timing of ["before", "after"]) {
    await query(`create function public.redemption_test_receipt_rewrite() returns trigger language plpgsql as $$ begin
      ${timing === "before" ? "new.fingerprint := repeat('e',64);" : "update public.faolla_redemption_operations set fingerprint=repeat('e',64) where merchant_id=new.merchant_id and operation_id=new.operation_id;"}
      return new; end $$;
      create trigger redemption_test_receipt_rewrite ${timing} insert on public.faolla_redemption_operations for each row execute function public.redemption_test_receipt_rewrite();`);
    try {
      await rejectUnchanged(commitSql(injected.siteId, checkout(injected.siteId, await snapshot(injected.siteId), `receipt-rewrite-${timing}`)), /redemption_mutation_not_persisted/);
    } finally { await query("drop trigger redemption_test_receipt_rewrite on public.faolla_redemption_operations; drop function public.redemption_test_receipt_rewrite();"); }
  }
  passed("receipt BEFORE and AFTER triggers cannot substitute another fingerprint while committing financial changes");

  const largest = await seed();
  const safeIntegers = change(largest.state.settings);
  safeIntegers.next.redemptionItems[0].stock = Number.MAX_SAFE_INTEGER;
  safeIntegers.next.redemptionItems[0].pointsCost = Number.MAX_SAFE_INTEGER;
  await commit(largest.siteId, { settings: safeIntegers });
  const storedSafeIntegers = await snapshot(largest.siteId);
  for (const field of ["stock", "pointsCost"]) {
    assert.equal(storedSafeIntegers.settings.blocks.redemptionItems[0][field], Number.MAX_SAFE_INTEGER);
    const unsafe = change(storedSafeIntegers.settings);
    unsafe.next.redemptionItems[0][field] = Number.MAX_SAFE_INTEGER + 1;
    await rejectUnchanged(commitSql(largest.siteId, { settings: unsafe }), /invalid_redemption_mutation/);
  }
  await query(`update public.pages set blocks=jsonb_set(blocks,'{redemptionItems,0,stock}','9007199254740992')
    where id=${textSql(storedSafeIntegers.settings.id)}::uuid;`);
  const unsafeStored = await snapshot(largest.siteId);
  await rejectUnchanged(commitSql(largest.siteId, { settings: {
    expectedUpdatedAt: unsafeStored.settings.updated_at, next: safeIntegers.next,
  } }), /redemption_store_corrupt/);
  await query(`update public.pages set blocks=${jsonSql(storedSafeIntegers.settings.blocks)}
    where id=${textSql(storedSafeIntegers.settings.id)}::uuid;`);
  passed("stock and points cost accept the largest JS-safe integer, reject the next integer and fail closed on unsafe stored stock");

  const boundary = await seed();
  const valid = checkout(boundary.siteId, boundary.state, "boundary-operation");
  for (const bad of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(valid); invalid.settings.next.redemptionItems[0].stock = bad;
    await rejectUnchanged(commitSql(boundary.siteId, invalid), /invalid_redemption_mutation/);
  }
  for (const mutation of [null, {}, { settings: null }, { coupons: { expectedUpdatedAt: null, next: {} } },
    { settings: valid.settings, operation: valid.operation }, { ...valid, operation: { ...valid.operation, fingerprint: "bad" } },
    { ...valid, operation: { ...valid.operation, id: "x".repeat(121) } }]) await rejectUnchanged(commitSql(boundary.siteId, mutation));
  const wrongMember = structuredClone(valid); wrongMember.memberships.next[0].siteId = first.siteId;
  await rejectUnchanged(commitSql(boundary.siteId, wrongMember));
  const wrongCoupon = structuredClone(valid); wrongCoupon.coupons.next[0].siteId = first.siteId;
  await rejectUnchanged(commitSql(boundary.siteId, wrongCoupon));
  const wrongSettings = structuredClone(valid); wrongSettings.settings.next.siteId = first.siteId;
  await rejectUnchanged(commitSql(boundary.siteId, wrongSettings));
  assert.deepEqual(await lookup(boundary.siteId, request.operation), { committed: false });
  passed("negative/fractional/unsafe stock, malformed requests and cross-tenant records or receipt lookup fail closed");

  for (const domain of ["settings", "coupons"]) {
    const before = await snapshot(boundary.siteId);
    const corruptAttempt = checkout(boundary.siteId, before, `corrupt-${domain}`);
    const target = before[domain];
    await query(`update public.pages set blocks='{"corrupt":true}' where id=${textSql(target.id)}::uuid;`);
    const latest = await snapshot(boundary.siteId);
    corruptAttempt[domain].expectedUpdatedAt = latest[domain].updated_at;
    await rejectUnchanged(commitSql(boundary.siteId, corruptAttempt), /redemption_store_corrupt/);
    await query(`update public.pages set blocks=${jsonSql(target.blocks)} where id=${textSql(target.id)}::uuid;`);
  }
  for (const domain of ["settings", "coupons"]) {
    const slug = domain === "settings" ? `__merchant_membership_settings__:${boundary.siteId}` : `__merchant_coupons__:${boundary.siteId}`;
    const id = await query(`insert into public.pages(merchant_id,slug,blocks) values (null,${textSql(slug)},'[]') returning id;`);
    try { await rejectUnchanged(commitSql(boundary.siteId, checkout(boundary.siteId, await snapshot(boundary.siteId), `ambiguous-${domain}`)), /redemption_store_ambiguous/); }
    finally { await query(`delete from public.pages where id=${textSql(id)}::uuid;`); }
  }
  passed("corrupt or ambiguously owned settings/coupon documents cannot be normalized away during checkout");

  const finalState = await allState();
  for (const page of untouchedPages) assert.deepEqual(finalState.pages.find((item) => item.id === page.id), page);
  for (const receipt of finalState.operations) assert.deepEqual(Object.keys(receipt).sort(), ["committed_at", "fingerprint", "membership_id", "merchant_id", "operation_id"]);
  passed("unrelated public pages are unchanged and receipts contain no member PII or full cart payload");
  console.log(`[redemption-postgres] ${checks} checks passed; PostgreSQL ${await query("show server_version;")}`);
  console.log("[redemption-postgres] real SQL transaction/CAS/receipt acceptance only; application pricing, initial coupon eligibility, HTTP/Auth and fingerprint canonicalization require their application tests");
} finally { for (const child of activeChildren) child.kill(); }
