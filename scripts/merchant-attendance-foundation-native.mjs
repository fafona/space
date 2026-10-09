// Explicit local-only acceptance. Never reads application env or a database URL.
// Creates one new synthetic PG15 cluster, verifies ownership, and stops it.
// The stopped directory is printed for checked cleanup; no recursive delete.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { checkAttendanceSelfNative } from "./merchant-attendance-self-native-checks.mjs";
import { checkAttendanceAdminNative } from "./merchant-attendance-admin-native-checks.mjs";
import { checkAttendanceManagementNative } from "./merchant-attendance-management-native-checks.mjs";
import { checkAttendanceChoicesNative } from "./merchant-attendance-choices-native-checks.mjs";
import { checkAttendanceChoiceLabelsNative } from "./merchant-attendance-choice-labels-native-checks.mjs";
import { checkAttendanceHistoryNative } from "./merchant-attendance-history-native-checks.mjs";
import { checkAttendanceAuditNative } from "./merchant-attendance-audit-native-checks.mjs";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = "D:/codex-pg15-ordinary-identity/pgsql/bin";
// User-approved local-only port change: the former dynamic-range port56644
// collided with an existing Chrome socket. Keep a single fixed test port and
// all original endpoint/directory ownership checks; never accept arbitrary URLs.
const PORT = 16444;
const DATABASE = "faolla_attendance_foundation_test";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TABLES = ["settings", "locations", "workers", "employment_periods", "events"];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = () => readFileSync(path.join(ROOT, "scripts/supabase-migrations/202609290061_merchant_attendance_foundation.sql"), "utf8");

export function attendanceNativeConfig(arguments_, platform = process.platform) {
  assert.deepEqual(arguments_, ["--run-local"], "attendance_native_requires_explicit_local_run");
  assert.equal(platform, "win32", "attendance_native_windows_only");
  return { port: PORT, database: DATABASE, binaries: Object.fromEntries(
    ["psql", "initdb", "pg_ctl"].map((name) => [name, path.join(BIN, `${name}.exe`)])),
  };
}

export async function runAttendanceNative(arguments_) {
  const config = attendanceNativeConfig(arguments_);
  for (const binary of Object.values(config.binaries)) assert.ok(existsSync(binary), "attendance_native_binary_missing");
  await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", () => reject(new Error("attendance_native_port_in_use")));
    socket.listen({ host: "127.0.0.1", port: PORT, exclusive: true }, () => socket.close(resolve));
  });
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "faolla-attendance-foundation-")));
  const dataDirectory = path.join(directory, "data");
  console.log(JSON.stringify({ localSyntheticDirectory: directory, port: PORT }));
  const windows = process.env.SystemRoot || "C:\\Windows";
  const environment = {
    SystemRoot: windows, WINDIR: windows, COMSPEC: path.join(windows, "System32", "cmd.exe"),
    PATH: `${BIN};${path.join(windows, "System32")}`, TEMP: directory, TMP: directory,
    PGHOSTADDR: "127.0.0.1", PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "5",
    PGPASSFILE: path.join(directory, "no-credentials.pgpass"),
    PGAPPNAME: "faolla_attendance_foundation_local",
    PGOPTIONS: "-c lc_messages=C -c statement_timeout=10000 -c lock_timeout=3000",
  };
  const deadline = Date.now() + 180_000;
  function run(binary, parameters, input, { start = false, cleanup = false } = {}) {
    assert.ok(cleanup || Date.now() < deadline, "attendance_native_deadline");
    assert.ok(!start || (binary === config.binaries.pg_ctl && parameters.at(-1) === "start"));
    const result = spawnSync(binary, parameters, { encoding: "utf8", input, env: environment,
      windowsHide: true, shell: false, timeout: 25_000, maxBuffer: 2_000_000,
      stdio: start ? "ignore" : ["pipe", "pipe", "pipe"],
    });
    assert.ok(!result.error && !result.signal, `attendance_native_process_failed:${result.error?.code || result.signal || "unknown"}`);
    return { status: result.status, output: (result.stdout || "").trim(), error: result.stderr || "" };
  }
  function sql(source) {
    return run(config.binaries.psql, ["--host=127.0.0.1", `--port=${PORT}`, "--username=postgres", `--dbname=${DATABASE}`,
      "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=sqlstate"], source);
  }
  function query(source) {
    const result = sql(source);
    assert.equal(result.status, 0, `attendance_native_sql_failed:${result.error}`);
    return result.output;
  }
  function connection(name, source, hold = false) {
    assert.match(name, /^attendance_[a-z_]+$/);
    const child = spawn(config.binaries.psql, ["--host=127.0.0.1", `--port=${PORT}`, "--username=postgres", `--dbname=${DATABASE}`,
      "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"],
    { env: { ...environment, PGAPPNAME: name, PGOPTIONS: "-c lc_messages=C -c statement_timeout=10000 -c lock_timeout=8000" }, windowsHide: true, shell: false, stdio: "pipe" });
    let output = ""; let error = ""; let resolveReady; let ended = false;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    child.stdout.on("data", (chunk) => { output += chunk; if (output.includes("ATTENDANCE_READY")) resolveReady(); });
    child.stderr.on("data", (chunk) => { error += chunk; });
    const timer = setTimeout(() => child.kill(), 15000);
    const completed = new Promise((resolve) => {
      child.once("error", (failure) => { error += failure.message; });
      child.once("close", (status) => { clearTimeout(timer); ended = true; resolveReady(); resolve({ status, output: output.trim(), error }); });
    });
    const finish = (tail) => { if (!ended && !child.stdin.writableEnded && !child.stdin.destroyed) child.stdin.end(`${tail}\n`); };
    child.stdin.on("error", () => { /* failure is returned by completed, not hidden */ });
    child.stdin.write(`${source}\n${hold ? "select 'ATTENDANCE_READY';" : ""}\n`);
    if (!hold) finish("");
    return { ready, completed, finish };
  }
  const identitySql = `select jsonb_build_object('database',current_database(),'user',current_user,'address',host(inet_server_addr()),
    'port',inet_server_port(),'major',current_setting('server_version_num')::int/10000,'directory',current_setting('data_directory'));`;
  const checks = [];
  const pass = (label) => { checks.push(label); console.log(`PASS ${label}`); };
  let startAttempted = false;
  try {
    assert.equal(run(config.binaries.initdb, [`--pgdata=${dataDirectory}`, "--username=postgres", "--no-locale", "--encoding=UTF8",
      "--auth-local=trust", "--auth-host=trust"]).status, 0, "attendance_native_initdb_failed");
    startAttempted = true;
    assert.equal(run(config.binaries.pg_ctl, ["-D", dataDirectory, "-l", path.join(directory, "postgres.log"), "-w", "-t", "20",
      "-o", `-h 127.0.0.1 -p ${PORT}`, "start"], undefined, { start: true }).status, 0, "attendance_native_start_failed");
    const admin = (source) => run(config.binaries.psql, ["--host=127.0.0.1", `--port=${PORT}`, "--username=postgres", "--dbname=postgres",
      "--no-password", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1"], source);
    const identityResult = admin(identitySql);
    assert.equal(identityResult.status, 0, identityResult.error);
    const identity = JSON.parse(identityResult.output);
    assert.deepEqual({ ...identity, directory: path.resolve(identity.directory) },
      { database: "postgres", user: "postgres", address: "127.0.0.1", port: PORT, major: 15, directory: path.resolve(dataDirectory) });
    assert.equal(admin(`create database ${DATABASE} template template0;`).status, 0);
    assert.equal(query("select count(*) from pg_class where relnamespace='public'::regnamespace;"), "0");
    pass("owned loopback-only fresh PG15 database identity");

    const enterprise = readFileSync(path.join(ROOT, "scripts/supabase-migrations/202607310001_merchant_enterprise_foundation.sql"), "utf8");
    const ddl = ["roles", "employees"].map((name) => {
      const definition = enterprise.match(new RegExp(`create table if not exists public\\.merchant_enterprise_${name} \\([\\s\\S]*?\\n\\);`, "i"))?.[0];
      assert.ok(definition, "attendance_baseline_employee_ddl_missing");
      return definition;
    }).join("\n");
    query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create table public.merchants(id text primary key,user_id uuid,auth_user_id uuid,owner_user_id uuid,owner_id uuid,auth_id uuid,created_by uuid,created_by_user_id uuid);
      create table public.faolla_schema_migrations(version bigint primary key,name text not null);
      ${ddl}
      insert into public.merchants(id) values ('99990001'),('99990002');
      insert into public.merchant_enterprise_employees(id,merchant_id,email,display_name)
      values ('${id(1)}','99990001','synthetic-a@example.test','Synthetic A'),('${id(2)}','99990002','synthetic-b@example.test','Synthetic B');`);
    const baseline = () => query(`select jsonb_build_object('merchants',(select jsonb_agg(m order by id) from public.merchants m),
      'employees',(select jsonb_agg(e order by id) from public.merchant_enterprise_employees e));`);
    const before = baseline();
    query(migration());
    assert.equal(baseline(), before);
    for (const suffix of TABLES) assert.equal(query(`select count(*) from public.merchant_attendance_${suffix};`), "0");
    pass("additive migration creates no employee or configuration backfill");

    query(`insert into public.merchant_attendance_settings(merchant_id,time_zone) values ('99990001','Europe/Madrid'),('99990002','UTC');
      insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone) values
      ('${id(11)}','99990001','Synthetic A','Europe/Madrid'),('${id(12)}','99990002','Synthetic B','UTC');
      insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id) values
      ('${id(21)}','99990001','${id(1)}','A1','Synthetic A','${id(11)}'),('${id(22)}','99990002','${id(2)}','B1','Synthetic B','${id(12)}');
      insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone)
      values ('${id(31)}','99990001','${id(21)}','${id(11)}','${id(41)}',1,'clock_in','web','Europe/Madrid');`);
    assert.equal(query("select count(*) from public.merchant_attendance_settings where enabled;"), "0");
    assert.equal(query("select count(*) from public.merchant_attendance_workers where active;"), "0");
    pass("module, workers and locations have inactive defaults");

    const snapshot = () => query(`select jsonb_build_object(${TABLES.map((suffix) =>
      `'${suffix}',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.merchant_attendance_${suffix} t),'[]'::jsonb)`).join(",")});`);
    function reject(label, source, code) {
      const before = snapshot();
      const result = sql(source);
      assert.notEqual(result.status, 0, `unexpectedly accepted: ${label}`);
      assert.match(result.error, new RegExp(`\\b${code}\\b`));
      assert.equal(snapshot(), before, `rejected mutation changed state: ${label}`);
      pass(label);
    }
    for (const role of ["anon", "authenticated"]) {
      for (const suffix of TABLES) reject(`${role} cannot read ${suffix}`,
        `set role ${role}; select * from public.merchant_attendance_${suffix};`, "42501");
    }
    assert.equal(query("set role service_role; select count(*) from public.merchant_attendance_events;"), "1");
    reject("service cannot write unvalidated punch events", `set role service_role;
      insert into public.merchant_attendance_events select * from public.merchant_attendance_events;`, "42501");
    reject("public cannot execute internal helper", "set role authenticated; select public.faolla_attendance_valid_zone_v1('UTC');", "42501");
    assert.equal(query("begin; grant select on public.merchant_attendance_events to authenticated; set role authenticated; select count(*) from public.merchant_attendance_events; rollback;"), "0");
    pass("RLS also denies rows after an accidental SELECT grant");

    reject("cross-tenant employee assignment", `insert into public.merchant_attendance_workers(merchant_id,employee_id,worker_no,display_name)
      values ('99990001','${id(2)}','X','Wrong');`, "23503");
    reject("cross-tenant default location", `update public.merchant_attendance_workers set default_location_id='${id(12)}' where id='${id(21)}';`, "23503");
    const insertEvent = (location, worker, operation, sequence, action = "clock_in", extra = "null") =>
      `insert into public.merchant_attendance_events(merchant_id,worker_id,location_id,operation_id,sequence,action,source,time_zone,break_paid)
       values ('99990001','${worker}','${location}','${operation}',${sequence},'${action}','web','UTC',${extra});`;
    reject("cross-tenant punch worker", insertEvent(id(11), id(22), id(42), 2), "23503");
    reject("cross-tenant punch location", insertEvent(id(12), id(21), id(42), 2), "23503");
    reject("duplicate operation", insertEvent(id(11), id(21), id(41), 2), "23505");
    reject("duplicate worker sequence", insertEvent(id(11), id(21), id(42), 1), "23505");
    reject("missing break classification", insertEvent(id(11), id(21), id(42), 2, "break_start"), "23514");
    reject("break classification on non-break", insertEvent(id(11), id(21), id(42), 2, "clock_in", "false"), "23514");
    reject("raw punch UPDATE even by table owner", "update public.merchant_attendance_events set action='clock_out';", "42501");
    reject("raw punch DELETE even by table owner", "delete from public.merchant_attendance_events;", "42501");
    reject("raw punch TRUNCATE even by table owner", "truncate table public.merchant_attendance_events;", "42501");
    reject("unknown time zone", "update public.merchant_attendance_settings set time_zone='Europe/Fake' where merchant_id='99990001';", "23514");
    reject("incomplete location fence", `update public.merchant_attendance_locations set latitude=37 where id='${id(11)}';`, "23514");
    reject("NaN location", `update public.merchant_attendance_locations set latitude='NaN',longitude=0,radius_meters=50 where id='${id(11)}';`, "23514");
    reject("case/whitespace duplicate worker number", "insert into public.merchant_attendance_workers(merchant_id,worker_no,display_name) values ('99990001',' a1 ','Duplicate');", "23505");
    reject("cross-tenant employment interval", `insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values ('99990001','${id(22)}','2026-09-01');`, "23503");
    reject("reversed employment interval", `insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on,ends_on) values ('99990001','${id(21)}','2026-09-02','2026-09-01');`, "23514");
    query(`insert into public.merchant_attendance_workers(id,merchant_id,worker_no,display_name) values ('${id(23)}','99990001','K1','Terminal only');`);
    assert.equal(query(`select employee_id is null from public.merchant_attendance_workers where id='${id(23)}';`), "t");
    pass("attendance-only worker requires neither email nor auth account");
    const saved = snapshot();
    query(migration());
    assert.equal(snapshot(), saved);
    assert.equal(baseline(), before);
    assert.equal(query("select count(*) from public.faolla_schema_migrations where version=202609290061;"), "1");
    pass("migration replay preserves raw attendance and all baseline employee rows");
    await checkAttendanceSelfNative({ root: ROOT, query, sql: (source) => {
      // Preserve exact safe error codes AND application messages for new RPC checks.
      return sql(`\\set VERBOSITY verbose\n${source}`);
    }, pass, connection });
    await checkAttendanceAdminNative({ root: ROOT, query, sql: (source) => sql(`\\set VERBOSITY verbose\n${source}`), pass, connection });
    await checkAttendanceManagementNative({ root: ROOT, query, sql: (source) => sql(`\\set VERBOSITY verbose\n${source}`), pass, connection });
    checkAttendanceChoicesNative({ root: ROOT, query, sql: (source) => sql(`\\set VERBOSITY verbose\n${source}`), pass });
    checkAttendanceChoiceLabelsNative({ root: ROOT, query, pass });
    checkAttendanceHistoryNative({ root: ROOT, query, pass });
    checkAttendanceAuditNative({ root: ROOT, query, pass });
    console.log(JSON.stringify({ checks: checks.length, passed: true, productionAccess: false }));
  } finally {
    if (startAttempted) {
      const status = run(config.binaries.pg_ctl, ["-D", dataDirectory, "status"], undefined, { cleanup: true });
      assert.ok(status.status === 0 || status.status === 3, "attendance_native_cleanup_status_unknown");
      if (status.status === 0) {
        const pid = readFileSync(path.join(dataDirectory, "postmaster.pid"), "utf8").split(/\r?\n/);
        assert.equal(path.resolve(pid[1]), path.resolve(dataDirectory), "attendance_native_cleanup_directory_mismatch");
        assert.equal(Number(pid[3]), PORT, "attendance_native_cleanup_port_mismatch");
        assert.equal(run(config.binaries.pg_ctl, ["-D", dataDirectory, "-m", "fast", "-w", "-t", "20", "stop"], undefined, { cleanup: true }).status, 0);
      }
      assert.equal(run(config.binaries.pg_ctl, ["-D", dataDirectory, "status"], undefined, { cleanup: true }).status, 3);
      console.log(JSON.stringify({ stopped: true, localSyntheticDirectory: directory }));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runAttendanceNative(process.argv.slice(2)).catch((error) => { console.error(error); process.exitCode = 1; });
}
