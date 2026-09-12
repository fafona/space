import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SCHEDULER_ACCEPTANCE_PRELOADS, SCHEDULER_ACCEPTANCE_START,
  validateSchedulerAcceptanceInvocation, schedulerAcceptanceCreateArgs,
  validateSchedulerAcceptanceContainer, validateSchedulerAcceptanceInitial,
  schedulerAcceptanceStartupDiagnostic,
  runSchedulerAcceptanceCases, runSupabaseSchedulerAcceptance,
} from "./maintenance-supabase-scheduler-acceptance.mjs";
import { SUPABASE_SCHEDULER_IMAGE, SUPABASE_SCHEDULER_DATABASES_SQL,
  SUPABASE_SCHEDULER_DATABASE_SQL, SUPABASE_SCHEDULER_QUIET_SQL } from "./maintenance-supabase-scheduler-profile.mjs";

const source = readFileSync(new URL("./maintenance-supabase-scheduler-acceptance.mjs", import.meta.url), "utf8");
const expected = { id: "a".repeat(64), imageId: `sha256:${"b".repeat(64)}`,
  name: "faolla-scheduler-123-1-aaaaaaaa", nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
function container() {
  return [{ Id: expected.id, Image: expected.imageId, Name: `/${expected.name}`, Mounts: [],
    Config: { Image: SUPABASE_SCHEDULER_IMAGE, User: "postgres", Labels: { "com.faolla.scheduler-acceptance": expected.nonce },
      Entrypoint: ["/bin/sh"], Cmd: ["-c", SCHEDULER_ACCEPTANCE_START] },
    HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, Binds: [], PortBindings: {},
      PublishAllPorts: false, Devices: [], CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges"],
      PidMode: "", IpcMode: "private", UTSMode: "", PidsLimit: 256, Memory: 1073741824,
      Tmpfs: { "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=512m,mode=1777", "/tmp": "rw,nosuid,nodev,exec,size=32m,mode=1777" } },
    NetworkSettings: { Networks: { none: {} } }, State: { Status: "running", Running: true } }];
}
function invocation() {
  return { platform: "linux", argv: [], environment: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux",
    GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", RUNNER_TEMP: "/tmp/fixture", FAOLLA_SUPABASE_SCHEDULER_ACCEPTANCE: "1" } };
}
test("invocation requires GitHub Linux and explicit disposable opt-in with no arguments", () => {
  assert.equal(validateSchedulerAcceptanceInvocation(invocation()), true);
  for (const key of Object.keys(invocation().environment)) {
    const input = invocation(); delete input.environment[key];
    assert.throws(() => validateSchedulerAcceptanceInvocation(input), /opt_in_required/);
  }
  for (const platform of ["win32", "darwin"]) assert.throws(() => validateSchedulerAcceptanceInvocation({ ...invocation(), platform }), /opt_in_required/);
  assert.throws(() => validateSchedulerAcceptanceInvocation({ ...invocation(), argv: ["--host=production.invalid"] }), /opt_in_required/);
});
test("missing opt-in rejects before any Docker process or filesystem setup", async () => {
  let calls = 0;
  await assert.rejects(runSupabaseSchedulerAcceptance({ environment: {}, platform: "linux", argv: [], spawn() { calls++; throw Error("SECRET"); } }), /opt_in_required/);
  assert.equal(calls, 0);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./maintenance-supabase-scheduler-acceptance.mjs", import.meta.url))],
    { env: { ...process.env, FAOLLA_SUPABASE_SCHEDULER_ACCEPTANCE: "0" }, encoding: "utf8", timeout: 5000, windowsHide: true });
  assert.equal(child.status, 1); assert.equal(child.stdout, "");
  assert.deepEqual(JSON.parse(child.stderr), { error: "supabase_scheduler_acceptance_opt_in_required", stage: "opt_in" });
});
test("creation pins official image with no host network, mount, port, or privileged capability", () => {
  const args = schedulerAcceptanceCreateArgs(expected.name, expected.nonce);
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--platform") + 1], "linux/amd64");
  assert.equal(args[args.indexOf("--entrypoint") + 1], "/bin/sh");
  assert.equal(args.at(-3), SUPABASE_SCHEDULER_IMAGE);
  assert.ok(args.includes("--read-only")); assert.ok(args.includes("--tmpfs"));
  assert.ok(args.includes("/tmp:rw,nosuid,nodev,exec,size=32m,mode=1777"));
  assert.ok(args.includes("/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=512m,mode=1777"));
  for (const forbidden of ["--privileged", "--publish", "-p", "-v", "--volume", "--mount", "--pid", "--network=host"]) assert.ok(!args.includes(forbidden));
  assert.throws(() => schedulerAcceptanceCreateArgs("production", expected.nonce));
  assert.throws(() => schedulerAcceptanceCreateArgs(expected.name, "other"));
});
test("startup uses image binaries, exact seven preloads and ONLY a synthetic local vault key", () => {
  assert.deepEqual(SCHEDULER_ACCEPTANCE_PRELOADS.split(","), ["auto_explain", "pg_tle", "plan_filter", "plpgsql", "plpgsql_check", "supabase_vault", "timescaledb"]);
  assert.match(SCHEDULER_ACCEPTANCE_START, /initdb -D '\/var\/lib\/postgresql\/data\/fixture' -U supabase_admin/);
  assert.match(SCHEDULER_ACCEPTANCE_START, /--auth-host=scram-sha-256/);
  assert.match(SCHEDULER_ACCEPTANCE_START, /exec postgres[^\n]+listen_addresses=127\.0\.0\.1/);
  assert.match(SCHEDULER_ACCEPTANCE_START, /vault\.getkey_script=\/tmp\/fixture-vault-key/);
  assert.match(SCHEDULER_ACCEPTANCE_START, /a{64}/);
  assert.doesNotMatch(SCHEDULER_ACCEPTANCE_START, /curl|wget|docker-entrypoint|\.env|source |\$\(cat/);
});
test("container identity requires exact ID/image/nonce/name and launch plan", () => {
  assert.equal(validateSchedulerAcceptanceContainer(container(), expected, "running"), true);
  for (const mutate of [v => v[0].Id = "c".repeat(64), v => v[0].Image = `sha256:${"c".repeat(64)}`,
    v => v[0].Name = "/production", v => v[0].Config.Image = "postgres:15",
    v => v[0].Config.Labels["com.faolla.scheduler-acceptance"] = "other", v => v[0].Config.Cmd = ["-c", "other"],
    v => v[0].Config.Entrypoint = ["other"], v => v[0].Config.User = "root", v => v[0].State.Status = "exited"]) {
    const value = container(); mutate(value); assert.throws(() => validateSchedulerAcceptanceContainer(value, expected, "running"), /acceptance_failed/);
  }
});
test("host access or writable mount drift fails closed before any SQL or cleanup", () => {
  for (const mutate of [v => v[0].HostConfig.NetworkMode = "host", v => v[0].HostConfig.Privileged = true,
    v => v[0].HostConfig.Binds.push("/:/host"), v => v[0].HostConfig.PortBindings = { "5432/tcp": [{}] },
    v => v[0].Mounts.push({ Type: "bind", Destination: "/tmp" }), v => v[0].HostConfig.Tmpfs["/host"] = "rw",
    v => v[0].HostConfig.ReadonlyRootfs = false, v => v[0].HostConfig.PidMode = "host", v => v[0].HostConfig.IpcMode = "host",
    v => v[0].HostConfig.CapDrop = [], v => v[0].HostConfig.CapAdd = ["SYS_ADMIN"],
    v => v[0].HostConfig.Devices = [{}], v => v[0].NetworkSettings.Networks.bridge = {},
    v => v[0].HostConfig.SecurityOpt = [], v => v[0].HostConfig.Memory = 0]) {
    const value = container(); mutate(value); assert.throws(() => validateSchedulerAcceptanceContainer(value, expected, "running"), /acceptance_failed/);
  }
});
test("only the private synthetic-key tmpfs is executable while data remains noexec", () => {
  for (const [path, flags] of [["/tmp", "rw,nosuid,nodev,size=32m,mode=1777"],
    ["/var/lib/postgresql/data", "rw,nosuid,nodev,exec,size=512m,mode=1777"]]) {
    const value = container(); value[0].HostConfig.Tmpfs[path] = flags;
    assert.throws(() => validateSchedulerAcceptanceContainer(value, expected, "running"));
  }
  assert.match(SCHEDULER_ACCEPTANCE_START, /chmod 700 \/tmp\/fixture-vault-key/);
  assert.doesNotMatch(SCHEDULER_ACCEPTANCE_START, /chmod 777|chown|sudo|gosu/);
});
test("empty cluster binding rejects wrong version, populated database or missing actual preload", () => {
  const initial = { version: "150008", data: "/var/lib/postgresql/data/fixture", database: "postgres", user: "supabase_admin", superuser: "on",
    preloads: SCHEDULER_ACCEPTANCE_PRELOADS, databases: ["postgres"], extensions: ["plpgsql"], relations: 0 };
  assert.equal(validateSchedulerAcceptanceInitial(initial), true);
  for (const patch of [{ version: "150009" }, { data: "/production" }, { databases: ["postgres", "business"] },
    { extensions: ["plpgsql", "timescaledb"] }, { relations: 1 }, { preloads: "" }, { superuser: "off" }, { extra: true }]) {
    assert.throws(() => validateSchedulerAcceptanceInitial({ ...initial, ...patch }));
  }
});

function casesFixture() {
  const state = { extra: false, unknown: new Set(), catalog: false, tle: false, enabled: false, timescale: false };
  const calls = [], proof = { id: expected.id, image: SUPABASE_SCHEDULER_IMAGE, databaseOid: 5 };
  const query = (db, sql) => {
    calls.push({ kind: "read", db, sql });
    if (sql === SUPABASE_SCHEDULER_DATABASES_SQL) return [{ name: "_supabase", oid: 16384 }, { name: "postgres", oid: 5 }, ...(state.extra ? [{ name: null, oid: 20000 }] : [])];
    if (sql === SUPABASE_SCHEDULER_DATABASE_SQL) return { databaseName: db, databaseOid: db === "postgres" ? 5 : 16384,
      readOnly: true, complete: true, reviewedExtensions: !state.unknown.has(db), timescaledbAbsent: !state.timescale,
      timescaledbOsmAbsent: true, pgTleAbsent: !state.tle, timescaledbCatalogAbsent: !state.catalog, timescaledbConfigAbsent: true };
    if (sql === SUPABASE_SCHEDULER_QUIET_SQL) return { complete: true, schedulerSafe: !state.enabled && !state.unknown.has("postgres"), transactions: 0, prepared: 0, databaseOid: 5 };
    throw Error("unrecognized test SQL");
  };
  const write = (db, sql) => {
    calls.push({ kind: "write", db, sql });
    if (sql.startsWith("CREATE DATABASE")) state.extra = true;
    else if (sql.startsWith("DROP DATABASE")) state.extra = false;
    else if (sql === "CREATE EXTENSION hstore;") state.unknown.add(db);
    else if (sql === "DROP EXTENSION hstore;") state.unknown.delete(db);
    else if (sql.startsWith("CREATE SCHEMA")) state.catalog = true;
    else if (sql.startsWith("DROP SCHEMA")) state.catalog = false;
    else if (sql === "CREATE EXTENSION pg_tle;") state.tle = true;
    else if (sql === "DROP EXTENSION pg_tle;") state.tle = false;
    else if (sql.startsWith("ALTER SYSTEM SET")) state.enabled = true;
    else if (sql.startsWith("ALTER SYSTEM RESET")) state.enabled = false;
    else if (sql.startsWith("CREATE EXTENSION timescaledb")) state.timescale = true;
    else throw Error("unrecognized test mutation");
  };
  const waitSetting = async expected => { calls.push({ kind: "setting", expected }); assert.equal(state.enabled ? "on" : "off", expected); };
  return { query, write, waitSetting, proof, calls };
}
test("case orchestration uses real profile parser and preserves all nine required groups", async () => {
  const fixture = casesFixture();
  assert.equal(await runSchedulerAcceptanceCases(fixture.proof, fixture.query, fixture.write, fixture.waitSetting), 9);
  const calls = fixture.calls;
  assert.ok(calls.some(call => call.db === "_supabase" && call.sql === "CREATE EXTENSION hstore;"));
  const enabled = calls.findIndex(call => call.sql?.startsWith("ALTER SYSTEM SET"));
  assert.deepEqual(calls[enabled + 1], { kind: "setting", expected: "on" });
  assert.equal(calls.at(-1).kind, "read");
  assert.equal(calls.filter(call => call.kind === "write" && call.sql.startsWith("CREATE EXTENSION timescaledb")).length, 1);
});
test("DDL failure is fatal, never promoted to a negative gate pass or replayed", async () => {
  const fixture = casesFixture(); let writes = 0;
  await assert.rejects(runSchedulerAcceptanceCases(fixture.proof, fixture.query, () => { writes++; throw Error("fixture write failed"); }, fixture.waitSetting), /fixture write failed/);
  assert.equal(writes, 1);
});
test("an unobserved PGTLE reload fails instead of counting SET rejection as success", async () => {
  const fixture = casesFixture();
  await assert.rejects(runSchedulerAcceptanceCases(fixture.proof, fixture.query, fixture.write, async () => { throw Error("reload unconfirmed"); }), /reload unconfirmed/);
  assert.ok(!fixture.calls.some(call => call.sql?.startsWith("CREATE EXTENSION timescaledb")));
});
test("a permissive profile query cannot pass the required dangerous-state test", async () => {
  const fixture = casesFixture();
  const fixed = new Map();
  for (const [db, sql] of [["postgres", SUPABASE_SCHEDULER_DATABASES_SQL], ["postgres", SUPABASE_SCHEDULER_DATABASE_SQL],
    ["_supabase", SUPABASE_SCHEDULER_DATABASE_SQL], ["postgres", SUPABASE_SCHEDULER_QUIET_SQL]]) fixed.set(db + sql, fixture.query(db, sql));
  await assert.rejects(runSchedulerAcceptanceCases(fixture.proof, (db, sql) => structuredClone(fixed.get(db + sql)), fixture.write, fixture.waitSetting), /Missing expected exception/);
});
test("positive requires three consecutive complete quiet observations and transient activity is not a pass", async () => {
  const fixture = casesFixture(); let primaryReads = 0, elapsed = 0;
  const query = (db, sql) => {
    const result = fixture.query(db, sql);
    if (sql === SUPABASE_SCHEDULER_QUIET_SQL && ++primaryReads === 3) result.transactions = 1;
    return result;
  };
  assert.equal(await runSchedulerAcceptanceCases(fixture.proof, query, fixture.write, fixture.waitSetting,
    { now: () => elapsed, pause: async ms => { elapsed += ms; } }), 9);
  assert.ok(primaryReads >= 9);
});
test("persistent activity times out before fixture mutation and profile errors are never retried", async () => {
  for (const broken of ["busy", "error"]) {
    const fixture = casesFixture(); let elapsed = 0, primaryReads = 0, writes = 0;
    const query = (db, sql) => {
      const result = fixture.query(db, sql);
      if (sql === SUPABASE_SCHEDULER_QUIET_SQL) {
        primaryReads++;
        if (broken === "error" && primaryReads === 2) throw Error("SECRET");
        result.transactions = 1;
      }
      return result;
    };
    await assert.rejects(runSchedulerAcceptanceCases(fixture.proof, query, () => { writes++; }, fixture.waitSetting,
      { now: () => elapsed, pause: async ms => { elapsed += ms; } }), /unverified|acceptance_failed/);
    assert.equal(writes, 0);
    if (broken === "error") assert.equal(primaryReads, 2);
  }
});
test("transport uses fixed Docker socket, private empty config, exact-ID cleanup and original read-only script", () => {
  assert.match(source, /"\/usr\/bin\/docker", \["--config", configDirectory, "--host", "unix:\/\/\/var\/run\/docker\.sock"/);
  assert.match(source, /readonly \? SUPABASE_SCHEDULER_PSQL_SCRIPT : WRITE_SCRIPT/);
  assert.match(source, /inspect\("running"\);\n\s+const output = docker/);
  assert.match(source, /validateSchedulerAcceptanceInitial\(query\("postgres", INITIAL_SQL\)\)/);
  assert.ok(source.indexOf('stage = "empty_identity"') < source.indexOf('stage = "fixture_setup"'));
  assert.match(source, /validateSchedulerAcceptanceContainer\(raw, owned, state\);[\s\S]*docker\(\["rm", "--force", owned\.id\]/);
  assert.doesNotMatch(source, /docker\(\["(?:system|volume|container)", "prune"|rmSync\(|process\.env\.(?:DATABASE_URL|DOCKER_HOST|POSTGRES_PASSWORD)/);
  assert.match(source, /rmdirSync\(configDirectory\)/);
});
test("startup diagnostics expose only bounded owned-container state/logs and redact synthetic credentials", () => {
  const state = { Status: "exited", ExitCode: 1, OOMKilled: false, Config: { Env: ["SECRET_SENTINEL"] }, Pid: 1234 };
  const result = schedulerAcceptanceStartupDiagnostic(state, "initdb starting\nfaolla-ci-only-disposable-scheduler\n", "FATAL: fixture error\nPOSTGRES_PASSWORD=SECRET_SENTINEL");
  assert.deepEqual(Object.keys(result), ["state", "exitCode", "oomKilled", "logs"]);
  assert.equal(result.state, "exited"); assert.equal(result.exitCode, 1); assert.equal(result.oomKilled, false);
  assert.match(result.logs, /FATAL: fixture error/); assert.match(result.logs, /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL|faolla-ci-only-disposable-scheduler|1234|Config|Env/);
  const bounded = schedulerAcceptanceStartupDiagnostic(state, ("x".repeat(200) + "\n").repeat(100), "\u001b[31m\u0000");
  assert.ok(Buffer.byteLength(bounded.logs) <= 4096); assert.ok(bounded.logs.split("\n").length <= 40);
  assert.doesNotMatch(bounded.logs, /\u001b|\u0000/);
  assert.throws(() => schedulerAcceptanceStartupDiagnostic({ ...state, ExitCode: -1 }, "", ""));
  assert.throws(() => schedulerAcceptanceStartupDiagnostic({ ...state, Status: "other" }, "", ""));
});
test("startup log collection requires fresh-phase ownership validation before the bounded exact-ID read", () => {
  const at = source.indexOf('if (owned && ["start_container", "wait_postgres"].includes(stage))');
  assert.ok(at > 0);
  const block = source.slice(at, source.indexOf("throw error;", at));
  const verify = block.indexOf("validateSchedulerAcceptanceContainer(raw, owned, state.Status)");
  const read = block.indexOf('dockerResult(["logs", "--tail", "40", owned.id], undefined, 5000, 4096)');
  assert.ok(verify >= 0 && read > verify);
  assert.match(block, /catch \{ startupDiagnostic = null; \}/);
  assert.doesNotMatch(block, /owned\.name|\.Config|\.Env|\.HostConfig|fixture_setup|execute\(/);
});
