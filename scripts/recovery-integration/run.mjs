import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { expectedDisposablePostgresServerAddress } from "../ci-postgres-service-identity.mjs";
import { buildDatabaseRecoveryContentSql, buildDatabaseRecoveryContentScalarSql, buildDatabaseRecoveryReadOnlyPsqlArgs, validateDatabaseRecoveryContent, assertDatabaseRecoveryContentMatch } from "../database-recovery-content-contract.mjs";

// Deliberately separate from application env, backups, ports and existing suites.
if (process.env.RECOVERY_INTEGRATION_ALLOW_DISPOSABLE_DATABASE !== "1") throw new Error("disposable_database_opt_in_required");
const port = process.env.RECOVERY_TEST_PORT || "56461";
if (port !== "56461" && !(process.env.CI === "true" && port === "5432")) throw new Error("invalid_test_port");
const expectedServerAddress = expectedDisposablePostgresServerAddress(process.env, port, "56461");
const source = "faolla_recovery_source_test";
const target = "faolla_recovery_target_test";
const psql = process.env.RECOVERY_TEST_PSQL || "psql";
const pgDump = process.env.RECOVERY_TEST_PG_DUMP || "pg_dump";
const pgRestore = process.env.RECOVERY_TEST_PG_RESTORE || "pg_restore";
const runtime = fileURLToPath(new URL("../../.runtime/recovery-integration", import.meta.url));
const childEnv = { ...process.env, PGHOSTADDR: "127.0.0.1", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
  PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null", PGOPTIONS: "-c lc_messages=C -c statement_timeout=60000 -c lock_timeout=10000" };
for (const key of ["PGSERVICE", "PGSERVICEFILE", "PGPASSWORD", "PGDATABASE", "PGUSER", "PGHOST", "PGPORT"]) delete childEnv[key];
const connection = db => ["--host=127.0.0.1", `--port=${port}`, "--username=postgres", `--dbname=${db}`, "--no-password"];
function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let diagnostic = "";
    const timer = setTimeout(() => child.kill(), 90000);
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { diagnostic += chunk; });
    child.stdin.on("error", error => { if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code)) reject(error); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, output: output.trim(), diagnostic }); });
    child.stdin.end(input);
  });
}
async function query(db, sql) {
  const response = await run(psql, [...connection(db), "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"], sql);
  assert.equal(response.code, 0, response.diagnostic);
  return response.output;
}
const textSql = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonSql = value => `${textSql(JSON.stringify(value))}::jsonb`;
const rpc = async (db, sql) => JSON.parse(await query(db, `SET ROLE service_role; ${sql}`));
async function content(db) {
  const value = JSON.parse(await query(db, `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO,YMD'; SET LOCAL extra_float_digits=3;
    ${buildDatabaseRecoveryContentSql()} COMMIT;`));
  assert.equal(validateDatabaseRecoveryContent(value).valid, true);
  return value;
}
let groups = 0;
function passed(label) { groups += 1; console.log(`[recovery-postgres] passed ${label}`); }
async function checkEmpty(db) {
  assert.equal(await query(db, "SELECT current_database();"), db);
  assert.equal(await query(db, "SELECT host(inet_server_addr());"), expectedServerAddress);
  assert.equal(await query(db, "SELECT inet_server_port();"), port);
  if (port === "56461") {
    const expected = fileURLToPath(new URL("../../.runtime/recovery-test-pg", import.meta.url));
    const normalize = value => value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
    assert.equal(normalize(await query(db, "SHOW data_directory;")), normalize(expected), "refusing another instance");
  }
  assert.equal(await query(db, `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','S','f');`), "0", "refusing a nonempty database");
}

const at = "2026-09-08T12:00:00.000Z";
const operator = "owner:synthetic-recovery";
function fixtureMember(siteId) { return { id: `member-${siteId}`, siteId, siteName: "Synthetic", memberNo: `${siteId}000001`, serial: 1,
  accountId: "synthetic-account", userId: "", email: "", nickname: "Synthetic", name: "Synthetic", phone: "", avatarUrl: "",
  birthday: "", birthdayMonthDayOnly: false, gender: "", country: "", province: "", city: "", address: "", taxName: "", taxNumber: "",
  taxCountry: "", taxProvince: "", taxCity: "", taxAddress: "", allergens: [], pointBalance: 100, balanceAmount: 0, growthValue: 0,
  levelId: "", transactions: [], status: "active", joinedAt: at, leftAt: null, updatedAt: at }; }
async function prepare(siteId, id) {
  const membership = fixtureMember(siteId);
  const settings = { siteId, rechargePlans: [], redemptionCategories: [], levels: [], redemptionShowStock: true,
    redemptionStockOperationIds: [], printSettings: {}, growthRules: {}, pointsRules: {}, updatedAt: at,
    redemptionItems: [{ id: "item", categoryId: "", name: "Synthetic item", code: "SKU", barcode: "", imageUrl: "", iconName: "",
      description: "", enabled: true, pointsCost: 20, referenceAmount: null, memberPrice: null, taxRate: null, stock: 5,
      pointProduct: true, recommended: false, sort: 0 }] };
  await rpc(source, `SELECT public.faolla_commit_order_membership_v1(${textSql(siteId)},${jsonSql({ memberships: { expectedUpdatedAt: null, next: [membership] } })});`);
  await rpc(source, `SELECT public.faolla_commit_redemption_v1(${textSql(siteId)},${jsonSql({ settings: { expectedUpdatedAt: null, next: settings } })});`);
  const read = async slug => JSON.parse(await query(source, `SELECT jsonb_build_object('blocks',blocks,'updatedAt',updated_at) FROM public.pages WHERE merchant_id=${textSql(siteId)} AND slug=${textSql(slug)};`));
  const state = { members: await read(`__merchant_memberships__:${siteId}`), settings: await read(`__merchant_membership_settings__:${siteId}`) };
  const items = [{ redemptionItemId: "item", quantity: 1 }];
  const quote = { totalQuantity: 1, grossPoints: 20, couponPointDiscountTotal: 0, totalPoints: 20, couponCount: 0,
    lines: [{ code: "SKU", name: "Synthetic item", categoryName: "", quantity: 1, unitPoints: 20, subtotalPoints: 20, couponDiscountLabel: "", couponPointDiscount: 0 }] };
  const op = { id, membershipId: membership.id, fingerprint: createHash("sha256").update(id).digest("hex") };
  const request = { membershipId: membership.id, items, note: "Synthetic recovery", settingsVersion: state.settings.updatedAt, couponVersion: null, quote };
  const result = { version: 1, operationId: id, siteId, membershipId: membership.id, transactionId: `txn-${id}`, createdAt: at,
    beforePointBalance: 100, afterPointBalance: 80, ...quote, note: request.note };
  const nextMembers = structuredClone(state.members.blocks);
  nextMembers[0].pointBalance = 80;
  nextMembers[0].transactions.push({ id: result.transactionId, type: "redeem", status: "completed", at, pointDelta: -20, balanceDelta: 0,
    growthDelta: 0, note: `${request.note} [op:member-redemption-checkout:${id}]`, operatorId: operator, cancelledAt: null,
    cancellationNote: "", cancelledBy: "", cancellationOperationMarker: "", relatedTransactionId: "", adjustmentKind: "" });
  const nextSettings = structuredClone(state.settings.blocks);
  nextSettings.redemptionItems[0].stock -= 1;
  nextSettings.redemptionStockOperationIds.push(`[op:member-redemption-stock:${id}]`);
  const mutation = { operation: op, memberships: { expectedUpdatedAt: state.members.updatedAt, next: nextMembers },
    settings: { expectedUpdatedAt: state.settings.updatedAt, next: nextSettings } };
  return { siteId, id, op, request, result, mutation };
}
const stageSql = p => `SELECT public.faolla_stage_redemption_checkout_v1(${textSql(p.siteId)},${textSql(operator)},${jsonSql(p.op)},${jsonSql(p.request)});`;
const commitSql = p => `SELECT public.faolla_commit_redemption_v2(${textSql(p.siteId)},${textSql(operator)},${jsonSql(p.mutation)},${jsonSql(p.result)});`;
const stateSql = (p, action = "get") => `SELECT public.faolla_${action}_redemption_checkout_v1(${textSql(p.siteId)},${textSql(operator)},${textSql(p.id)});`;

await checkEmpty(source); await checkEmpty(target);
const init = await readFile(new URL("../supabase-init.sql", import.meta.url), "utf8");
const extract = regex => { const value = init.match(regex)?.[0]; assert.ok(value); return value; };
await query(source, `CREATE EXTENSION pgcrypto;
  DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
  ${extract(/create table if not exists public\.pages \([\s\S]*?\n\);/i)}
  ${extract(/create or replace function public\.set_current_timestamp_updated_at\(\)[\s\S]*?\n\$\$;/i)}
  ${extract(/create trigger set_pages_updated_at[\s\S]*?public\.set_current_timestamp_updated_at\(\);/i)}
  ${extract(/create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i)}
  ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
  CREATE TABLE public.faolla_schema_migrations(version bigint PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());`);
const beforeMigrations = await content(source);
assert.equal(beforeMigrations.relations[1].present, false);
assert.equal(beforeMigrations.relations[2].present, false);
passed("pre-migration proof explicitly records absent durable tables");
for (const migration of ["202609080044_qr_token_atomic_mutation.sql", "202609080045_order_membership_atomic_mutation.sql",
  "202609080046_redemption_atomic_mutation.sql", "202609080047_redemption_checkout_context.sql"]) {
  await query(source, await readFile(new URL(`../supabase-migrations/${migration}`, import.meta.url), "utf8"));
}
assert.equal((await content(source)).relations[1].rowCount, "0");
assert.equal((await content(source)).relations[2].present, true);
passed("real 044-047 migrations distinguish absent from present-empty tables");
const pending = await prepare("13000001", "pending");
const committed = await prepare("13000002", "committed");
const cancelled = await prepare("13000003", "cancelled");
const acknowledged = await prepare("13000004", "acknowledged");
for (const p of [pending, committed, cancelled, acknowledged]) await rpc(source, stageSql(p));
await rpc(source, commitSql(committed)); await rpc(source, commitSql(acknowledged));
await rpc(source, stateSql(cancelled, "cancel")); await rpc(source, stateSql(acknowledged, "ack"));
const oldQr = await rpc(source, "SELECT public.faolla_mutate_qr_token_v1('merchant','13000001','ensure');");
const currentQr = await rpc(source, "SELECT public.faolla_mutate_qr_token_v1('merchant','13000001','reset');");
assert.notEqual(oldQr.token, currentQr.token);
// Synthetic coupon / order history documents are also in the protected pages set.
await query(source, `INSERT INTO public.pages(merchant_id,slug,blocks) VALUES
  ('13000001','__merchant_coupons__:13000001','[{"id":"synthetic-coupon","usedCount":1}]'),
  ('13000001','__merchant_orders__:13000001','[{"id":"synthetic-order","points":20}]');`);
const expected = await content(source);
assert.equal(expected.relations[1].rowCount, "2"); assert.equal(expected.relations[2].rowCount, "4");
passed("source preserves pending, committed, cancelled, acknowledged and rotated QR state");

await mkdir(runtime, { recursive: true });
const dumpPath = path.join(runtime, `synthetic-${Date.now()}.dump`);
let result = await run(pgDump, [...connection(source), "--format=custom", `--file=${dumpPath}`]);
assert.equal(result.code, 0, result.diagnostic);
result = await run(pgRestore, [...connection(target), "--exit-on-error", "--single-transaction", dumpPath]);
assert.equal(result.code, 0, result.diagnostic);
assertDatabaseRecoveryContentMatch(await content(target), expected);
passed("real single-database pg_dump/pg_restore preserves the current content profile, including explicit receipt-table absence");
for (const p of [pending, committed, cancelled, acknowledged]) {
  assert.deepEqual(await rpc(target, stateSql(p)), await rpc(source, stateSql(p)));
}
assert.deepEqual(await rpc(target, "SELECT public.faolla_mutate_qr_token_v1('merchant','13000001','ensure');"), currentQr);
assertDatabaseRecoveryContentMatch(await content(target), expected);
passed("restored raw recovery states and current QR are unchanged without automatic ACK");
await rpc(target, commitSql(committed));
await rpc(target, commitSql(acknowledged));
assertDatabaseRecoveryContentMatch(await content(target), expected);
const denied = await run(psql, [...connection(target), "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], `SET ROLE service_role; ${commitSql(cancelled)}`);
assert.notEqual(denied.code, 0); assert.match(denied.diagnostic, /redemption_checkout_cancelled/);
assertDatabaseRecoveryContentMatch(await content(target), expected);
passed("restored committed/acknowledged replay is read-only and cancelled replay stays forbidden");

for (const role of ["anon", "authenticated", "service_role"]) {
  for (const table of ["faolla_redemption_operations", "faolla_redemption_checkouts"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      assert.equal(await query(target, `SELECT has_table_privilege('${role}','public.${table}','${privilege}');`), "f");
    }
  }
  assert.equal(await query(target, `SELECT has_function_privilege('${role}','public.faolla_commit_redemption_internal_v1(text,jsonb)','execute');`), "f");
  assert.equal(await query(target, `SELECT has_function_privilege('${role}','public.faolla_commit_redemption_v2(text,text,jsonb,jsonb)','execute');`), role === "service_role" ? "t" : "f");
}
assert.equal(await query(target, "SELECT relrowsecurity FROM pg_class WHERE oid='public.faolla_redemption_checkouts'::regclass;"), "t");
assert.equal(await query(target, "SELECT indisunique AND indisvalid FROM pg_index WHERE indexrelid='public.faolla_redemption_checkouts_unacknowledged_idx'::regclass;"), "t");
passed("dump restore retains protected ACL, internal writer denial, RLS and unique unacknowledged slot");

// Faults exist only within rollback transactions in this disposable restored DB.
for (const [name, mutation] of [
  ["live balance", "UPDATE public.pages SET blocks=jsonb_set(blocks,'{0,pointBalance}','999') WHERE slug='__merchant_memberships__:13000002'"],
  ["coupon state", "UPDATE public.pages SET blocks='[]' WHERE slug='__merchant_coupons__:13000001'"],
  ["QR token", "UPDATE public.pages SET blocks='{}' WHERE slug='__faolla_qr_tokens__'"],
  ["operation fingerprint", "UPDATE public.faolla_redemption_operations SET fingerprint=repeat('b',64)"],
  ["acknowledgement", "UPDATE public.faolla_redemption_checkouts SET acknowledged_at=null WHERE operation_id='acknowledged'"],
  ["lost cancellation", "DELETE FROM public.faolla_redemption_checkouts WHERE operation_id='cancelled'"],
]) {
  const changed = JSON.parse(await query(target, `BEGIN; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO,YMD'; SET LOCAL extra_float_digits=3;
    ${mutation}; ${buildDatabaseRecoveryContentSql()} ROLLBACK;`));
  assert.throws(() => assertDatabaseRecoveryContentMatch(changed, expected), /database_recovery_content_mismatch/, name);
  assertDatabaseRecoveryContentMatch(await content(target), expected);
}
passed("restoration proof rejects changed books, coupons, QR, receipts, ACK and missing tombstones");
const missing = JSON.parse(await query(target, `BEGIN; ALTER TABLE public.faolla_redemption_checkouts RENAME TO displaced_checkout;
  ${buildDatabaseRecoveryContentSql()} ROLLBACK;`));
assert.equal(validateDatabaseRecoveryContent(missing).valid, false);
assertDatabaseRecoveryContentMatch(await content(target), expected);
passed("recorded 047 with a missing checkout table cannot masquerade as pre-migration state");
const cliProof = await run(psql, [...connection(target), "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
  ...buildDatabaseRecoveryReadOnlyPsqlArgs(`SELECT json_build_object('recoveryContent',${buildDatabaseRecoveryContentScalarSql()});`)]);
assert.equal(cliProof.code, 0, cliProof.diagnostic);
assertDatabaseRecoveryContentMatch(JSON.parse(cliProof.output).recoveryContent, expected);
passed("actual psql command emits one parseable proof with the capture transaction wrapper");
console.log(`[recovery-postgres] ${groups} groups passed; synthetic dump retained; no production backup or database accessed`);
