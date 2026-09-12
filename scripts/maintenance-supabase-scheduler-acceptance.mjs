import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, realpathSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SUPABASE_SCHEDULER_IMAGE, SUPABASE_SCHEDULER_PSQL_SCRIPT,
  SUPABASE_SCHEDULER_DATABASES_SQL, SUPABASE_SCHEDULER_DATABASE_SQL,
  SUPABASE_SCHEDULER_QUIET_SQL, readSupportedSupabaseMaintenanceQuiet,
} from "./maintenance-supabase-scheduler-profile.mjs";

// Real binaries from the audited official image, with a NEW synthetic cluster.
// This does not run Supabase's product migrations or validate the full stack.
// No production address, host mount, inherited Docker credentials, or listener
// on a host interface is accepted. All fixture writes target our frozen ID.
const LABEL = "com.faolla.scheduler-acceptance";
const PASSWORD = "faolla-ci-only-disposable-scheduler";
const DATA = "/var/lib/postgresql/data/fixture";
const HEX = /^[0-9a-f]{64}$/;
const ERROR = "supabase_scheduler_acceptance_failed";
const fail = () => { throw new Error(ERROR); };
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
let stage = "opt_in";
let startupDiagnostic = null;

export const SCHEDULER_ACCEPTANCE_PRELOADS = "auto_explain,pg_tle,plan_filter,plpgsql,plpgsql_check,supabase_vault,timescaledb";
export const SCHEDULER_ACCEPTANCE_START = `set -eu
umask 077
test ! -e '${DATA}'
test ! -L '${DATA}'
mkdir -m 700 '${DATA}'
printf '%s\\n' "$POSTGRES_PASSWORD" > /tmp/fixture-password
printf '#!/bin/sh\\nprintf "%%s\\\\n" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\\n' > /tmp/fixture-vault-key
chmod 700 /tmp/fixture-vault-key
initdb -D '${DATA}' -U supabase_admin --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/fixture-password --encoding=UTF8 --locale=C >/dev/null
rm -- /tmp/fixture-password
exec postgres -D '${DATA}' -c listen_addresses=127.0.0.1 -c port=5432 -c unix_socket_directories=/tmp -c shared_buffers=32MB -c max_connections=30 -c log_min_messages=warning -c log_statement=none -c 'shared_preload_libraries=${SCHEDULER_ACCEPTANCE_PRELOADS}' -c vault.getkey_script=/tmp/fixture-vault-key
`;

// Only fixture setup uses a writable connection. The actual production helper
// below uses its UNCHANGED read-only script for every profile query.
const WRITE_SCRIPT = `set -eu
[ "$#" -eq 1 ]
case "$1" in postgres|_supabase) ;; *) exit 71 ;; esac
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGPASSWORD
export PGPASSWORD="$POSTGRES_PASSWORD"
export PGCONNECT_TIMEOUT=3
export PGOPTIONS='-c statement_timeout=10s -c lock_timeout=1s'
exec psql -h 127.0.0.1 -p 5432 -U supabase_admin -d "$1" -X -w -q -A -t -v ON_ERROR_STOP=1
`;

export function validateSchedulerAcceptanceInvocation({ platform, environment, argv }) {
  if (platform !== "linux" || environment?.GITHUB_ACTIONS !== "true" || environment?.RUNNER_OS !== "Linux" ||
      environment?.FAOLLA_SUPABASE_SCHEDULER_ACCEPTANCE !== "1" || argv.length !== 0 ||
      !/^[1-9][0-9]*$/.test(environment?.GITHUB_RUN_ID ?? "") ||
      !/^[1-9][0-9]*$/.test(environment?.GITHUB_RUN_ATTEMPT ?? "") ||
      typeof environment?.RUNNER_TEMP !== "string" || !environment.RUNNER_TEMP.startsWith("/")) {
    throw new Error("supabase_scheduler_acceptance_opt_in_required");
  }
  return true;
}

export function schedulerAcceptanceCreateArgs(name, nonce) {
  if (!/^faolla-scheduler-[1-9][0-9]*-[1-9][0-9]*-[0-9a-f]{8}$/.test(name) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce)) fail();
  return ["create", "--platform", "linux/amd64", "--name", name, "--label", `${LABEL}=${nonce}`,
    "--network", "none", "--read-only", "--user", "postgres", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "1g", "--shm-size", "128m",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=512m,mode=1777",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m,mode=1777", "--env", `POSTGRES_PASSWORD=${PASSWORD}`,
    "--env", "POSTGRES_DB=postgres", "--entrypoint", "/bin/sh", SUPABASE_SCHEDULER_IMAGE,
    "-c", SCHEDULER_ACCEPTANCE_START];
}

// Inspect output is private and never printed. Compare all security-relevant
// launch fields before start, EACH SQL call and exact-ID cleanup.
export function validateSchedulerAcceptanceContainer(value, expected, state) {
  const row = Array.isArray(value) && value.length === 1 ? value[0] : null;
  const host = row?.HostConfig, config = row?.Config;
  if (!row || !HEX.test(expected.id) || row.Id !== expected.id || row.Image !== expected.imageId ||
      !/^sha256:[0-9a-f]{64}$/.test(expected.imageId) || row.Name !== `/${expected.name}` ||
      config?.Image !== SUPABASE_SCHEDULER_IMAGE || config?.Labels?.[LABEL] !== expected.nonce ||
      config?.User !== "postgres" || host?.NetworkMode !== "none" || host?.ReadonlyRootfs !== true ||
      host?.Privileged !== false || !Array.isArray(row.Mounts) || row.Mounts.some(item => item.Type !== "tmpfs") ||
      row.Mounts.some(item => !["/var/lib/postgresql/data", "/tmp"].includes(item.Destination)) ||
      (host.Binds ?? []).length !== 0 || Object.keys(host.PortBindings ?? {}).length !== 0 ||
      host.PublishAllPorts !== false || (host.Devices ?? []).length !== 0 ||
      Object.keys(row.NetworkSettings?.Networks ?? {}).join(",") !== "none" ||
      JSON.stringify(config.Entrypoint) !== JSON.stringify(["/bin/sh"]) ||
      JSON.stringify(config.Cmd) !== JSON.stringify(["-c", SCHEDULER_ACCEPTANCE_START]) ||
      JSON.stringify(host.CapDrop) !== JSON.stringify(["ALL"]) || (host.CapAdd ?? []).length !== 0 ||
      !host.SecurityOpt?.includes("no-new-privileges") || host.PidMode || host.IpcMode === "host" ||
      host.UTSMode === "host" || host.PidsLimit !== 256 || host.Memory !== 1073741824 ||
      host.Tmpfs?.["/var/lib/postgresql/data"] !== "rw,nosuid,nodev,noexec,size=512m,mode=1777" ||
      host.Tmpfs?.["/tmp"] !== "rw,nosuid,nodev,size=32m,mode=1777" || Object.keys(host.Tmpfs ?? {}).length !== 2 ||
      row.State?.Status !== state || (state === "running" && row.State?.Running !== true)) fail();
  return true;
}

const INITIAL_SQL = "SELECT json_build_object('version',current_setting('server_version_num'),'data',current_setting('data_directory')," +
  "'database',current_database(),'user',current_user,'superuser',current_setting('is_superuser'),'preloads',current_setting('shared_preload_libraries')," +
  "'databases',(SELECT json_agg(datname ORDER BY datname) FROM pg_database WHERE NOT datistemplate)," +
  "'extensions',(SELECT json_agg(extname ORDER BY extname) FROM pg_extension)," +
  "'relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'))::text;";

export function validateSchedulerAcceptanceInitial(value) {
  assert.deepEqual(value, { version: "150008", data: DATA, database: "postgres", user: "supabase_admin", superuser: "on",
    preloads: SCHEDULER_ACCEPTANCE_PRELOADS, databases: ["postgres"], extensions: ["plpgsql"], relations: 0 });
  return true;
}

// Only the owned, fresh, network-none startup container is eligible. No SQL
// has been sent, no host path mounted, and its only password is synthetic.
// Never project inspect Config/Env/HostConfig or logs from another container.
export function schedulerAcceptanceStartupDiagnostic(state, stdout, stderr) {
  if (!["created", "running", "exited"].includes(state?.Status) || !Number.isSafeInteger(state.ExitCode) ||
      state.ExitCode < 0 || state.ExitCode > 255 || typeof state.OOMKilled !== "boolean" ||
      typeof stdout !== "string" || typeof stderr !== "string") fail();
  const redacted = `${stdout}\n${stderr}`.replaceAll(PASSWORD, "[redacted]")
    .replace(/\b[0-9a-fA-F]{64}\b/g, "[redacted-digest]")
    .split(/\r?\n/).filter(line => !/\b(?:PGPASSWORD|POSTGRES_PASSWORD|authorization|secret|token)\s*[:=]/i.test(line)).slice(-40).join("\n");
  // ASCII projection avoids split UTF-8 and control characters/terminal escapes.
  const logs = redacted.replace(/[^\x20-\x7e\n\t]/g, "?").slice(-4096);
  return { state: state.Status, exitCode: state.ExitCode, oomKilled: state.OOMKilled, logs };
}

/** Real SQL in CI; injectable transport is used ONLY by local fault tests. */
export async function runSchedulerAcceptanceCases(proof, query, write, waitSetting, timing = {}) {
  let groups = 0;
  const now = timing.now ?? Date.now, wait = timing.pause ?? pause;
  const positive = async () => {
    const deadline = now() + 5000;
    let consecutive = 0;
    do {
      // A fresh connection for every SQL provides fresh statistics. A transient
      // launcher transaction may settle; any schema/profile/SQL error is fatal.
      // Require THREE complete zero observations, never retry a negative case.
      const result = readSupportedSupabaseMaintenanceQuiet(proof, query);
      assert.equal(result.schedulerSafe, true); assert.equal(result.complete, true);
      assert.equal(result.databaseOid, proof.databaseOid);
      consecutive = result.transactions === 0 && result.prepared === 0 ? consecutive + 1 : 0;
      if (consecutive === 3) return;
      await wait(100);
    } while (now() < deadline);
    fail();
  };
  const rejected = () => assert.throws(() => readSupportedSupabaseMaintenanceQuiet(proof, query),
    { message: "maintenance_database_scheduler_profile_unverified" });
  stage = "profile_positive";
  const databases = query("postgres", SUPABASE_SCHEDULER_DATABASES_SQL);
  assert.deepEqual(databases.map(row => row.name), ["_supabase", "postgres"]);
  for (const database of databases) assert.equal(query(database.name, SUPABASE_SCHEDULER_DATABASE_SQL).readOnly, true);
  assert.equal(query("postgres", SUPABASE_SCHEDULER_QUIET_SQL).schedulerSafe, true);
  await positive(); groups++;
  stage = "extra_database";
  write("postgres", "CREATE DATABASE faolla_scheduler_negative TEMPLATE template0;"); rejected();
  write("postgres", "DROP DATABASE faolla_scheduler_negative;"); groups++;
  stage = "unknown_extension";
  write("postgres", "CREATE EXTENSION hstore;"); rejected();
  write("postgres", "DROP EXTENSION hstore;"); groups++;
  stage = "secondary_unknown_extension";
  write("_supabase", "CREATE EXTENSION hstore;"); rejected();
  write("_supabase", "DROP EXTENSION hstore;"); groups++;
  stage = "residual_catalog";
  write("_supabase", "CREATE SCHEMA _timescaledb_catalog;"); rejected();
  write("_supabase", "DROP SCHEMA _timescaledb_catalog;"); groups++;
  stage = "pgtle_installed";
  write("_supabase", "CREATE EXTENSION pg_tle;"); rejected();
  write("_supabase", "DROP EXTENSION pg_tle;"); groups++;
  // These GUCs are PGC_SIGHUP: SET would fail without testing the gate.
  // Reload only this new isolated cluster, then OBSERVE the actual setting.
  stage = "pgtle_enabled";
  write("postgres", "ALTER SYSTEM SET pgtle.enable_password_check='on'; SELECT pg_reload_conf();");
  await waitSetting("on"); rejected();
  write("postgres", "ALTER SYSTEM RESET pgtle.enable_password_check; SELECT pg_reload_conf();");
  await waitSetting("off"); groups++;
  stage = "restored_positive"; await positive(); groups++;
  // Last: installation may start real Timescale workers. No wait/zero-count
  // fiction is needed; the reader must reject its installed extension first.
  stage = "timescaledb_installed";
  write("_supabase", "CREATE EXTENSION timescaledb VERSION '2.16.1';"); rejected(); groups++;
  return groups;
}

export async function runSupabaseSchedulerAcceptance(overrides = {}) {
  const environment = overrides.environment ?? process.env;
  validateSchedulerAcceptanceInvocation({ platform: overrides.platform ?? process.platform, environment, argv: overrides.argv ?? process.argv.slice(2) });
  startupDiagnostic = null;
  const parent = realpathSync(environment.RUNNER_TEMP);
  const configDirectory = mkdtempSync(join(parent, "faolla-scheduler-docker-"));
  const directoryIdentity = lstatSync(configDirectory);
  const spawn = overrides.spawn ?? spawnSync;
  const nonce = randomUUID(), name = `faolla-scheduler-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}-${nonce.slice(0, 8)}`;
  let owned = null;
  const dockerResult = (args, input, timeout = 10000, maxBuffer = 1048576) => {
    const result = spawn("/usr/bin/docker", ["--config", configDirectory, "--host", "unix:///var/run/docker.sock", ...args], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, input, encoding: "utf8", maxBuffer,
      timeout, killSignal: "SIGKILL", shell: false, windowsHide: true,
    });
    if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== "string" || typeof result.stderr !== "string") fail();
    return result;
  };
  const docker = (args, input, timeout) => dockerResult(args, input, timeout).stdout.trim();
  const inspect = state => validateSchedulerAcceptanceContainer(JSON.parse(docker(["inspect", owned.id])), owned, state);
  const execute = (database, sql, readonly = true) => {
    if (!["postgres", "_supabase"].includes(database) || typeof sql !== "string" || sql.length > 16384) fail();
    inspect("running");
    const output = docker(["exec", "-i", owned.id, "/bin/sh", "-c", readonly ? SUPABASE_SCHEDULER_PSQL_SCRIPT : WRITE_SCRIPT, "fixture-psql", database], sql, 15000);
    inspect("running");
    return output;
  };
  const query = (database, sql) => JSON.parse(execute(database, sql));
  try {
    stage = "pull_image"; docker(["pull", "--platform", "linux/amd64", SUPABASE_SCHEDULER_IMAGE], undefined, 240000);
    const image = JSON.parse(docker(["image", "inspect", SUPABASE_SCHEDULER_IMAGE]));
    if (!Array.isArray(image) || image.length !== 1 || !/^sha256:[0-9a-f]{64}$/.test(image[0]?.Id) ||
        image[0].Architecture !== "amd64" || image[0].Os !== "linux" || !image[0].RepoTags?.includes(SUPABASE_SCHEDULER_IMAGE)) fail();
    stage = "create_container";
    const id = docker(schedulerAcceptanceCreateArgs(name, nonce));
    if (!HEX.test(id)) fail();
    owned = { id, name, nonce, imageId: image[0].Id };
    inspect("created"); stage = "start_container"; docker(["start", id]);
    const deadline = Date.now() + 90000;
    stage = "wait_postgres";
    while (true) {
      inspect("running");
      try {
        // Only readiness may retry; no fixture DDL or profile read is replayed.
        docker(["exec", id, "pg_isready", "-h", "127.0.0.1", "-p", "5432", "-U", "supabase_admin", "-d", "postgres"], undefined, 5000);
        break;
      } catch { if (Date.now() >= deadline) fail(); await pause(250); }
    }
    stage = "empty_identity"; validateSchedulerAcceptanceInitial(query("postgres", INITIAL_SQL));
    stage = "fixture_setup";
    execute("postgres", "CREATE DATABASE _supabase TEMPLATE template0; CREATE EXTENSION supabase_vault VERSION '0.3.1';", false);
    const databases = query("postgres", SUPABASE_SCHEDULER_DATABASES_SQL);
    const proof = { id, image: SUPABASE_SCHEDULER_IMAGE, databaseOid: databases.find(row => row.name === "postgres")?.oid };
    assert.ok(Number.isSafeInteger(proof.databaseOid) && proof.databaseOid > 0);
    const waitSetting = async expected => {
      const deadline = Date.now() + 5000;
      do {
        if (query("postgres", "SELECT to_json(current_setting('pgtle.enable_password_check'))::text;") === expected) return;
        await pause(100);
      } while (Date.now() < deadline);
      fail();
    };
    const groups = await runSchedulerAcceptanceCases(proof, query, (db, sql) => execute(db, sql, false), waitSetting);
    return { ok: true, groups, image: SUPABASE_SCHEDULER_IMAGE, serverVersion: "15.8", network: "none",
      evidence: "real_image_synthetic_cluster_not_full_stack" };
  } catch (error) {
    if (owned && ["start_container", "wait_postgres"].includes(stage)) {
      try {
        const raw = JSON.parse(docker(["inspect", owned.id]));
        const state = raw?.[0]?.State;
        if (!["created", "running", "exited"].includes(state?.Status)) fail();
        validateSchedulerAcceptanceContainer(raw, owned, state.Status);
        const logs = dockerResult(["logs", "--tail", "40", owned.id], undefined, 5000, 4096);
        startupDiagnostic = schedulerAcceptanceStartupDiagnostic(state, logs.stdout, logs.stderr);
      } catch { startupDiagnostic = null; } // Ownership/limits/errors forbid logs, never fallback.
    }
    throw error;
  } finally {
    const prior = stage; stage = "cleanup";
    try {
      if (owned) {
        const raw = JSON.parse(docker(["inspect", owned.id]));
        const state = raw?.[0]?.State?.Status;
        if (!["created", "running", "exited"].includes(state)) fail();
        validateSchedulerAcceptanceContainer(raw, owned, state);
        // No name lookup, broad prune, host deletion, or --volumes operation.
        docker(["rm", "--force", owned.id], undefined, 15000);
      }
    } finally {
      const observed = lstatSync(configDirectory);
      if (!observed.isDirectory() || observed.isSymbolicLink() || observed.dev !== directoryIdentity.dev ||
          observed.ino !== directoryIdentity.ino || realpathSync(configDirectory) !== configDirectory) fail();
      rmdirSync(configDirectory); // Refuse recursive removal if Docker wrote anything unexpected.
    }
    stage = prior;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(await runSupabaseSchedulerAcceptance()) + "\n"); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: error?.message === "supabase_scheduler_acceptance_opt_in_required" ? error.message : ERROR,
      stage, ...(startupDiagnostic ? { startupDiagnostic } : {}) }) + "\n");
    process.exitCode = 1;
  }
}
