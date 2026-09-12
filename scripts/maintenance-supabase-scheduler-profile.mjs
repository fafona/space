import { isProxy } from "node:util/types";

// A read-only compatibility profile for this one audited image, not a generic
// extension allowlist. The caller must revalidate the frozen container before
// EVERY query. Cross-database observations are not one PostgreSQL snapshot;
// they must be repeated after ingress/process isolation, before certifying held.
export const SUPABASE_SCHEDULER_IMAGE = "supabase/postgres:15.8.1.085";
const ERROR = "maintenance_database_scheduler_profile_unverified";
const fail = () => { throw new Error(ERROR); };
const START = "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; SET LOCAL search_path=pg_catalog; ";
const COMPLETE = "current_setting('is_superuser')='on' OR pg_has_role(current_user,'pg_read_all_stats','USAGE')";
const ORIGINAL_EXTENSIONS = "'plpgsql','pgcrypto','uuid-ossp','pg_stat_statements','pgjwt','pg_graphql','pgaudit','pgsodium','pg_trgm','vector','pg_net'";
const REVIEWED_EXTENSIONS = `NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname NOT IN (${ORIGINAL_EXTENSIONS},'supabase_vault') OR (extname='supabase_vault' AND extversion<>'0.3.1'))`;
const PRELOADS = "'','pg_stat_statements','pgaudit','pgsodium','pg_net','pg_cron','auto_explain','pg_tle','plan_filter','plpgsql','plpgsql_check','supabase_vault','timescaledb'";
const SCHEDULER_SAFE = [
  "current_database()='postgres'",
  "current_setting('transaction_read_only')='on'",
  "current_setting('server_version_num')='150008'",
  REVIEWED_EXTENSIONS,
  "EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault' AND extversion='0.3.1')",
  `NOT EXISTS (SELECT 1 FROM regexp_split_to_table(current_setting('shared_preload_libraries'), ',') AS library WHERE trim(both ' \"' from library) NOT IN (${PRELOADS}))`,
  "EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='timescaledb' AND default_version='2.16.1')",
  "EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_tle' AND default_version='1.4.0')",
  "EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='supabase_vault' AND default_version='0.3.1')",
  "current_setting('pgtle.enable_clientauth',true)='off'",
  "current_setting('pgtle.enable_password_check',true)='off'",
  "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE left(lower(backend_type),6)='pg_tle')",
  "NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE lower(backend_type) LIKE '%timescale%' AND backend_type<>'TimescaleDB Background Worker Launcher')",
  "to_regclass('cron.job') IS NULL",
  "NOT EXISTS (SELECT 1 FROM pg_subscription WHERE subenabled)",
  "(position('pg_cron' in current_setting('shared_preload_libraries'))=0 OR current_setting('cron.database_name',true)=current_database())",
].join(" AND ");

// Same five result fields and original cluster-wide transaction/prepared counts.
// The per-database absence proof below is mandatory in addition to this SQL.
export const SUPABASE_SCHEDULER_QUIET_SQL = START +
  `SELECT json_build_object('complete',${COMPLETE},'schedulerSafe',(${SCHEDULER_SAFE}),` +
  "'transactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND xact_start IS NOT NULL)," +
  "'prepared',(SELECT count(*) FROM pg_prepared_xacts),'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()))::text; ROLLBACK;";

// Do not filter unknown databases out of the set: their explicit null name
// makes the whole observation fail, without disclosing a private database name.
export const SUPABASE_SCHEDULER_DATABASES_SQL = START +
  "SELECT COALESCE(json_agg(json_build_object('name',CASE WHEN datname IN ('postgres','_supabase') THEN datname ELSE NULL END,'oid',oid::bigint) ORDER BY CASE datname WHEN '_supabase' THEN 0 WHEN 'postgres' THEN 1 ELSE 2 END,oid),'[]'::json)::text " +
  "FROM pg_database WHERE datallowconn AND NOT datistemplate; ROLLBACK;";

export const SUPABASE_SCHEDULER_DATABASE_SQL = START +
  `SELECT json_build_object('databaseName',current_database(),'databaseOid',(SELECT oid::bigint FROM pg_database WHERE datname=current_database()),'readOnly',current_setting('transaction_read_only')='on','complete',${COMPLETE},` +
  `'reviewedExtensions',${REVIEWED_EXTENSIONS},` +
  "'timescaledbAbsent',NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='timescaledb')," +
  "'timescaledbOsmAbsent',NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='timescaledb_osm')," +
  "'pgTleAbsent',NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_tle')," +
  "'timescaledbCatalogAbsent',NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='_timescaledb_catalog')," +
  "'timescaledbConfigAbsent',NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='_timescaledb_config'))::text; ROLLBACK;";

export const SUPABASE_SCHEDULER_PSQL_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?configured password required}"',
  ': "${POSTGRES_DB:?configured database required}"',
  '[ "$POSTGRES_DB" = postgres ]',
  '[ "$#" -eq 1 ]',
  'case "$1" in postgres|_supabase) ;; *) exit 71 ;; esac',
  "unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGPASSWORD",
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGCONNECT_TIMEOUT=3",
  "export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5s -c lock_timeout=1s'",
  'exec psql -h 127.0.0.1 -p 5432 -U supabase_admin -d "$1" -X -w -q -A -t -v ON_ERROR_STOP=1',
].join("\n");

function record(value, keys) {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || !keys.every(key =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) fail();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
const positive = value => Number.isSafeInteger(value) && value > 0;
const natural = value => Number.isSafeInteger(value) && value >= 0;
function proofValue(value) {
  const row = record(value, ["id", "image", "databaseOid"]);
  if (typeof row.id !== "string" || !/^[0-9a-f]{64}$/.test(row.id) ||
      row.image !== SUPABASE_SCHEDULER_IMAGE || !natural(row.databaseOid)) fail();
  return row;
}
function databaseSet(value) {
  if (!Array.isArray(value) || isProxy(value) || value.length !== 2 || Reflect.ownKeys(value).length !== 3) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const rows = ["_supabase", "postgres"].map((name, index) => {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    const row = record(descriptor.value, ["name", "oid"]);
    if (row.name !== name || !positive(row.oid)) fail();
    return row;
  });
  if (rows[0].oid === rows[1].oid) fail();
  return rows;
}
function databaseRow(value, expected) {
  const flags = ["readOnly", "complete", "reviewedExtensions", "timescaledbAbsent", "timescaledbOsmAbsent", "pgTleAbsent", "timescaledbCatalogAbsent", "timescaledbConfigAbsent"];
  const row = record(value, ["databaseName", "databaseOid", ...flags]);
  if (row.databaseName !== expected.name || row.databaseOid !== expected.oid || !flags.every(key => row[key] === true)) fail();
}
function quietRow(value, oid) {
  const row = record(value, ["complete", "schedulerSafe", "transactions", "prepared", "databaseOid"]);
  if (row.complete !== true || row.schedulerSafe !== true || !natural(row.transactions) ||
      !natural(row.prepared) || row.databaseOid !== oid) fail();
  return row;
}

/** No I/O, retry, credentials, mutation or fallback; query is a private caller. */
export function readSupportedSupabaseMaintenanceQuiet(rawProof, query) {
  try {
    const proof = proofValue(rawProof);
    if (typeof query !== "function" || isProxy(query)) fail();
    const before = databaseSet(query("postgres", SUPABASE_SCHEDULER_DATABASES_SQL));
    const primaryOid = before[1].oid;
    if (proof.databaseOid !== 0 && proof.databaseOid !== primaryOid) fail();
    for (const entry of before) databaseRow(query(entry.name, SUPABASE_SCHEDULER_DATABASE_SQL), entry);
    const result = quietRow(query("postgres", SUPABASE_SCHEDULER_QUIET_SQL), primaryOid);
    const after = databaseSet(query("postgres", SUPABASE_SCHEDULER_DATABASES_SQL));
    if (before.some((row, index) => row.oid !== after[index].oid)) fail();
    const finalProof = proofValue(rawProof);
    if (Object.keys(proof).some(key => proof[key] !== finalProof[key])) fail();
    return Object.freeze(result);
  } catch {
    // Never publish a database name, query, credential or underlying exception.
    fail();
  }
}
