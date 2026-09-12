import assert from "node:assert/strict";
import test from "node:test";
import { SUPABASE_SCHEDULER_IMAGE, SUPABASE_SCHEDULER_QUIET_SQL, SUPABASE_SCHEDULER_DATABASES_SQL,
  SUPABASE_SCHEDULER_DATABASE_SQL, SUPABASE_SCHEDULER_PSQL_SCRIPT, readSupportedSupabaseMaintenanceQuiet } from "./maintenance-supabase-scheduler-profile.mjs";

const ERROR = /^maintenance_database_scheduler_profile_unverified$/;
const rejection = callback => assert.throws(callback, error => ERROR.test(error.message) && error.cause === undefined);
const databases = () => [{ name: "_supabase", oid: 16385 }, { name: "postgres", oid: 5 }];
const database = name => ({ databaseName: name, databaseOid: name === "postgres" ? 5 : 16385, readOnly: true, complete: true,
  reviewedExtensions: true, timescaledbAbsent: true, timescaledbOsmAbsent: true, pgTleAbsent: true, timescaledbCatalogAbsent: true, timescaledbConfigAbsent: true });
function fixture() {
  const proof = { id: "a".repeat(64), image: SUPABASE_SCHEDULER_IMAGE, databaseOid: 0 };
  const responses = [databases(), database("_supabase"), database("postgres"),
    { complete: true, schedulerSafe: true, transactions: 3, prepared: 1, databaseOid: 5 }, databases()];
  const calls = [];
  const query = (name, sql) => { calls.push([name, sql]); return responses[calls.length - 1]; };
  return { proof, responses, calls, query };
}

test("exact stock image profile rechecks both databases and returns only the legacy five fields", () => {
  for (const oid of [0, 5]) {
    const f = fixture(); f.proof.databaseOid = oid;
    const before = structuredClone(f.proof), response = readSupportedSupabaseMaintenanceQuiet(f.proof, f.query);
    assert.deepEqual(response, f.responses[3]); assert.notEqual(response, f.responses[3]); assert(Object.isFrozen(response));
    assert.deepEqual(f.proof, before);
    assert.deepEqual(f.calls, [["postgres", SUPABASE_SCHEDULER_DATABASES_SQL], ["_supabase", SUPABASE_SCHEDULER_DATABASE_SQL],
      ["postgres", SUPABASE_SCHEDULER_DATABASE_SQL], ["postgres", SUPABASE_SCHEDULER_QUIET_SQL], ["postgres", SUPABASE_SCHEDULER_DATABASES_SQL]]);
    // Active transactions are still reported; only the outer held check requires zero.
    assert.equal(response.transactions, 3); assert.equal(response.prepared, 1);
  }
});

test("wrong image, identity, shape and non-synchronous query cannot select the profile", () => {
  for (const mutate of [f => { f.proof.image += "-other"; }, f => { f.proof.id = "bad"; }, f => { f.proof.databaseOid = "0"; },
    f => { f.proof.databaseOid = -1; }, f => { f.proof.raw = "secret"; }, f => { f.proof = null; }]) {
    const f = fixture(); mutate(f); rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, () => Promise.resolve(databases())));
  rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, null));
});

test("unknown, extra, duplicate, missing and reordered databases are rejected before a per-database connection", () => {
  for (const value of [[], databases().slice(1), [...databases(), { name: "unknown", oid: 9 }],
    [{ name: null, oid: 9 }, databases()[1]], [{ name: "other", oid: 9 }, databases()[1]], databases().reverse(),
    [databases()[0], databases()[0]], [{ name: "_supabase", oid: 5 }, databases()[1]],
    [{ name: "_supabase", oid: "16385" }, databases()[1]], [{ name: "_supabase", oid: 0 }, databases()[1]]]) {
    const f = fixture(); f.responses[0] = value;
    rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.proof.databaseOid = 999; rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(f.calls.length, 1);
});

test("both database records require every observed absence, exact name/OID and complete read-only visibility", () => {
  for (const index of [1, 2]) for (const key of ["readOnly", "complete", "reviewedExtensions", "timescaledbAbsent", "timescaledbOsmAbsent", "pgTleAbsent", "timescaledbCatalogAbsent", "timescaledbConfigAbsent"]) {
    for (const value of [false, null, 1, "true"]) {
      const f = fixture(); f.responses[index][key] = value;
      rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(f.calls.length, index + 1);
    }
  }
  for (const mutate of [row => { row.databaseName = "other"; }, row => { row.databaseOid++; }, row => { row.raw = "secret"; }, row => { delete row.complete; }]) {
    const f = fixture(); mutate(f.responses[1]); rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query));
  }
});

test("unsafe, null or malformed quiet results never supply a successful legacy result", () => {
  for (const [key, value] of [["schedulerSafe", false], ["schedulerSafe", null], ["complete", false], ["complete", "true"],
    ["transactions", -1], ["transactions", "0"], ["transactions", 0.5], ["prepared", null], ["prepared", Number.MAX_SAFE_INTEGER + 1], ["databaseOid", 6]]) {
    const f = fixture(); f.responses[3][key] = value; rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(f.calls.length, 4);
  }
  const f = fixture(); f.responses[3].extra = "secret"; rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query));
});

test("before/after database set or proof identity changes invalidate all completed observations", () => {
  for (const mutate of [f => { f.responses[4][0].oid++; }, f => { f.responses[4][1].oid++; },
    f => { f.responses[4].push({ name: "other", oid: 99 }); }, f => { f.responses[4][0].name = null; }]) {
    const f = fixture(); mutate(f); rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(f.calls.length, 5);
  }
  const f = fixture(); rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, (name, sql) => {
    const result = f.query(name, sql); if (f.calls.length === 5) f.proof.id = "b".repeat(64); return result;
  }));
});

test("query errors at every step are bounded, secret-free and never retried", () => {
  for (let index = 0; index < 5; index++) {
    const f = fixture(); rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, (name, sql) => {
      const value = f.query(name, sql); if (f.calls.length === index + 1) throw new Error("secret-sentinel"); return value;
    })); assert.equal(f.calls.length, index + 1);
  }
});

test("getters, proxies, prototype fields and sparse arrays are rejected without evaluating hostile values", () => {
  let touched = 0;
  const getter = { get id() { touched++; return "a".repeat(64); }, image: SUPABASE_SCHEDULER_IMAGE, databaseOid: 0 };
  const proxy = new Proxy({}, { get() { touched++; throw new Error("secret"); }, ownKeys() { touched++; return []; } });
  rejection(() => readSupportedSupabaseMaintenanceQuiet(getter, () => { touched++; }));
  rejection(() => readSupportedSupabaseMaintenanceQuiet(proxy, () => { touched++; }));
  for (const value of [proxy, new Array(2), Object.assign(databases(), { extra: true }), Object.create({ 0: databases()[0], 1: databases()[1], length: 2 })]) {
    const f = fixture(); f.responses[0] = value; rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query));
  }
  const f = fixture(); f.responses[0] = databases(); Object.defineProperty(f.responses[0], "0", { enumerable: true, get() { touched++; return databases()[0]; } });
  rejection(() => readSupportedSupabaseMaintenanceQuiet(f.proof, f.query)); assert.equal(touched, 0);
});

test("all fixed SQL uses bounded read-only transactions and preserves the original stats/OID contract", () => {
  for (const sql of [SUPABASE_SCHEDULER_QUIET_SQL, SUPABASE_SCHEDULER_DATABASES_SQL, SUPABASE_SCHEDULER_DATABASE_SQL]) {
    assert.match(sql, /^BEGIN READ ONLY;/); assert.match(sql, /statement_timeout='5s'/); assert.match(sql, /lock_timeout='1s'/); assert.match(sql, /SET LOCAL search_path=pg_catalog;/); assert.match(sql, /ROLLBACK;$/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COPY|CALL|COMMIT)\b/i);
  }
  assert.match(SUPABASE_SCHEDULER_QUIET_SQL, /pid<>pg_backend_pid\(\) AND xact_start IS NOT NULL/);
  assert.match(SUPABASE_SCHEDULER_QUIET_SQL, /'prepared',\(SELECT count\(\*\) FROM pg_prepared_xacts\)/);
  assert.match(SUPABASE_SCHEDULER_QUIET_SQL, /'databaseOid',\(SELECT oid::bigint FROM pg_database WHERE datname=current_database\(\)\)/);
  assert.match(SUPABASE_SCHEDULER_DATABASES_SQL, /CASE WHEN datname IN \('postgres','_supabase'\) THEN datname ELSE NULL END/);
  assert.match(SUPABASE_SCHEDULER_DATABASES_SQL, /WHERE datallowconn AND NOT datistemplate/);
  assert.match(SUPABASE_SCHEDULER_DATABASES_SQL, /ORDER BY CASE datname WHEN '_supabase' THEN 0 WHEN 'postgres' THEN 1 ELSE 2 END,oid/);
  assert.doesNotMatch(SUPABASE_SCHEDULER_DATABASES_SQL, /WHERE datname IN/);
  assert.match(SUPABASE_SCHEDULER_DATABASE_SQL, /extname='timescaledb_osm'/);
  assert.match(SUPABASE_SCHEDULER_DATABASE_SQL, /'reviewedExtensions',NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname NOT IN \(/);
  assert.match(SUPABASE_SCHEDULER_DATABASE_SQL, /OR \(extname='supabase_vault' AND extversion<>'0\.3\.1'\)/);
  assert.doesNotMatch(SUPABASE_SCHEDULER_DATABASE_SQL, /cron\.job|pg_subscription/);
});

test("main profile pins exact audited versions, forbids unknown preload/ext values and retains cron/subscription restrictions", () => {
  const sql = SUPABASE_SCHEDULER_QUIET_SQL;
  assert.equal(SUPABASE_SCHEDULER_IMAGE, "supabase/postgres:15.8.1.085");
  for (const fragment of ["current_setting('server_version_num')='150008'", "extname='supabase_vault' AND extversion='0.3.1'",
    "name='timescaledb' AND default_version='2.16.1'", "name='pg_tle' AND default_version='1.4.0'", "name='supabase_vault' AND default_version='0.3.1'",
    "current_setting('pgtle.enable_clientauth',true)='off'", "current_setting('pgtle.enable_password_check',true)='off'",
    "left(lower(backend_type),6)='pg_tle'", "backend_type<>'TimescaleDB Background Worker Launcher'", "to_regclass('cron.job') IS NULL",
    "NOT EXISTS (SELECT 1 FROM pg_subscription WHERE subenabled)", "current_setting('cron.database_name',true)=current_database()"])
    assert.ok(sql.includes(fragment), fragment);
  assert.match(sql, /pg_extension WHERE extname NOT IN \(/);
  assert.match(sql, /regexp_split_to_table[\s\S]+NOT IN \(/);
  for (const name of ["auto_explain", "pg_tle", "plan_filter", "plpgsql", "plpgsql_check", "supabase_vault", "timescaledb"]) assert.ok(sql.includes(`'${name}'`));
  assert.doesNotMatch(sql, /regexp_replace|replace\(|\$libdir|CREATE EXTENSION|ALTER SYSTEM/);
});

test("container script accepts only the fixed stock database argument and keeps normal configured credentials private", () => {
  const script = SUPABASE_SCHEDULER_PSQL_SCRIPT;
  assert.match(script, /\[ "\$POSTGRES_DB" = postgres \]/); assert.match(script, /\[ "\$#" -eq 1 \]/);
  assert.match(script, /case "\$1" in postgres\|_supabase\) ;; \*\) exit 71 ;; esac/);
  assert.match(script, /export PGPASSWORD="\$POSTGRES_PASSWORD"/);
  assert.match(script, /PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5s -c lock_timeout=1s'/);
  assert.match(script, /exec psql -h 127\.0\.0\.1 -p 5432 -U supabase_admin -d "\$1" -X -w -q -A -t -v ON_ERROR_STOP=1$/);
  assert.doesNotMatch(script, /(?:echo|printf|eval|set -x|psql.*-c)\b/);
});
