import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectMaintenanceCapabilities, parseMaintenanceKongEnvironment, summarizeMaintenanceCapabilitiesDocker,
  validateMaintenanceCapabilitiesReport, validateMaintenanceCapabilitiesReportFile,
  MAINTENANCE_DATABASE_SQL, MAINTENANCE_CRON_SQL, MAINTENANCE_PSQL_CONTAINER_SCRIPT } from "./check-production-maintenance-capabilities.mjs";

const BUILD = "c".repeat(40);
const SECRET = "DO_NOT_LEAK_PRIVATE_SENTINEL";
const script = fileURLToPath(new URL("./check-production-maintenance-capabilities.mjs", import.meta.url));
const args = () => ["/srv/faolla", "faolla", "3000", BUILD];
const version = () => ({ ok: true, buildId: BUILD, releasedAt: "2026-09-09T00:00:00.000Z" });
function rows() {
  return [["kong", "kong"], ["db", "supabase/postgres"], ["rest", "postgrest/postgrest"], ["auth", "supabase/gotrue"]].map(([role, image], index) => ({
    id: String(index + 1).repeat(64), name: "/supabase-" + role, image: image + ":test", state: "running",
    project: SECRET, service: role, networkMode: "private-network", networks: [SECRET],
    ports: role === "kong" ? { "8000/tcp": [{ HostIp: "192.0.2.11", HostPort: "8000" }] } : {},
  }));
}
function database() {
  return { databaseMatches: true, readOnly: true, statsComplete: true, activeBackends: 2, openTransactions: 1, preparedTransactions: 0,
    pagesWriteGrants: { tablePresent: true, rlsEnabled: true, rlsForced: false, policyCount: 4,
      roles: Object.fromEntries(["anon", "authenticated", "service_role"].map((role) => [role, {
        rolePresent: true, tableInsert: role !== "anon", tableUpdate: role !== "anon", tableDelete: role !== "anon",
        anyColumnInsert: role !== "anon", anyColumnUpdate: role !== "anon",
      }])), rowWriteAccess: "not_verified" },
    extensions: { pgCron: true, pgNet: false, http: false, dblink: false, postgresFdw: false, otherCount: 1 },
    cronTablePresent: true, cronReadable: true, cronComplete: true };
}
function fixture(overrides = {}) {
  const containers = overrides.rows || rows(); const calls = []; let versionCalls = 0;
  const env = { KONG_DATABASE: "off", KONG_ADMIN_LISTEN: "0.0.0.0:8001", KONG_PLUGINS: "bundled,request-termination",
    KONG_DECLARATIVE_CONFIG: "/private/" + SECRET, ...overrides.env };
  const deps = { getVersion: async () => { versionCalls++; return overrides.version ? overrides.version(versionCalls) : version(); },
    run(command, parameters, input) {
      calls.push({ command, parameters, input });
      if (overrides.run) {
        const value = overrides.run(command, parameters, input);
        if (value !== undefined) return value;
      }
      assert.equal(command, "docker"); assert.deepEqual(parameters.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
      if (parameters.includes("ps")) return containers.map((row) => JSON.stringify(row.id)).join("\n");
      if (parameters.includes("inspect")) {
        const format = parameters[parameters.indexOf("--format") + 1];
        if (format.includes(".Config.Env")) {
          const key = format.match(/"(KONG_[A-Z_]+)"/)[1];
          return env[key] === null ? "" : JSON.stringify(key + "=" + env[key]);
        }
        return containers.map((row) => JSON.stringify(row)).join("\n");
      }
      if (parameters.includes("curl")) {
        assert.equal(parameters[parameters.indexOf("exec") + 1], containers[0].id);
        const endpoint = parameters.at(-1);
        if (endpoint.endsWith("/status")) return JSON.stringify({ database: { reachable: true }, configuration: SECRET }) + "\n200";
        if (endpoint.endsWith("/plugins/enabled")) return JSON.stringify({ enabled_plugins: ["request-termination", "pre-function", SECRET] }) + "\n200";
        if (endpoint === "http://127.0.0.1:8001/") return JSON.stringify({ version: "2.8.1", configuration: { password: SECRET } }) + "\n200";
        assert.fail("not an allowed URL");
      }
      assert.equal(parameters[parameters.indexOf("-i") + 1], containers[1].id);
      assert.equal(parameters.at(-1), MAINTENANCE_PSQL_CONTAINER_SCRIPT);
      if (input === MAINTENANCE_DATABASE_SQL) return JSON.stringify(overrides.database || database());
      assert.equal(input, MAINTENANCE_CRON_SQL);
      return JSON.stringify({ activeCount: 1, totalCount: 2 });
    } };
  return { deps, calls, versionCalls: () => versionCalls };
}
async function report() { const f = fixture(); return collectMaintenanceCapabilities(args(), f.deps); }
function withFile(text, callback) {
  const directory = mkdtempSync(path.join(tmpdir(), "faolla-capabilities-test-"));
  try { const file = path.join(directory, "report.json"); writeFileSync(file, text); return callback(file); }
  finally { rmSync(directory, { recursive: true }); }
}

test("collector freezes IDs, verifies live build twice and never reports maintenance verified", async () => {
  const f = fixture(); const result = await collectMaintenanceCapabilities(args(), f.deps);
  assert.equal(f.versionCalls(), 2);
  assert.equal(result.runtime.before.status, "verified"); assert.equal(result.runtime.after.status, "verified");
  assert.equal(result.maintenanceState, "not_verified");
  assert.equal(result.docker.data.identities.kong, "verified");
  assert.equal(result.database.summary.data.activeBackends, 2);
  assert.equal(result.database.cron.data.activeCount, 1);
  assert.equal(result.database.otherDatabaseSchedules, "unknown");
  assert.equal(f.calls.length, 11);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(JSON.stringify(result).includes("192.0.2.11"), false);
  assert.equal(JSON.stringify(result).includes("/supabase-"), false);
});

test("invalid args or initial build mismatch never start Docker diagnostics", async () => {
  const f = fixture();
  await assert.rejects(collectMaintenanceCapabilities(["/", "app", "3000", BUILD], f.deps));
  assert.equal(f.calls.length, 0); assert.equal(f.versionCalls(), 0);
  const mismatch = fixture({ version: () => ({ ...version(), buildId: "d".repeat(40) }) });
  const result = await collectMaintenanceCapabilities(args(), mismatch.deps);
  assert.equal(result.runtime.before.status, "mismatch"); assert.equal(mismatch.calls.length, 0);
  assert.equal(result.docker.status, "unknown");
});

test("ending build mismatch cannot be promoted to verified, and binding is captured", async () => {
  const input = args();
  const f = fixture({ version: (call) => { input[3] = "e".repeat(40); return { ...version(), buildId: call === 1 ? BUILD : "d".repeat(40) }; } });
  const result = await collectMaintenanceCapabilities(input, f.deps);
  assert.equal(result.expectedRuntimeBuildId, BUILD); assert.equal(result.runtime.after.status, "mismatch");
  assert.throws(() => validateMaintenanceCapabilitiesReport(result, "d".repeat(40)));
});

test("inventory rejects more than 64 IDs and duplicate or substituted identities before exec", async () => {
  for (const containers of [[...rows(), rows()[0]], Array.from({ length: 65 }, (_, index) => ({ id: index.toString(16).padStart(64, "0") }))]) {
    const f = fixture({ rows: containers }); const result = await collectMaintenanceCapabilities(args(), f.deps);
    assert.equal(result.docker.status, "unknown");
    assert.equal(f.calls.some((call) => call.parameters.includes("exec")), false);
  }
  const invalid = rows(); invalid[0].image = "unknown/private-image:latest";
  const f = fixture({ rows: invalid }); const result = await collectMaintenanceCapabilities(args(), f.deps);
  assert.equal(result.docker.data.identities.kong, "unknown");
  assert.equal(f.calls.some((call) => call.parameters.includes("curl")), false);
});

test("noncore image/service pairs stay unknown despite sharing a network", () => {
  const containers = rows();
  containers.push({ ...containers[0], id: "a".repeat(64), name: "/private-worker", service: "worker", image: "private/worker:1" });
  const result = summarizeMaintenanceCapabilitiesDocker(containers);
  assert.equal(result.data.containers.at(-1).role, "unknown");
  assert.equal(result.data.containers.at(-1).sharesKongNetwork, true);
  assert.equal(result.data.containers.at(-1).networkReachability, "not_inspected");
  assert.equal(JSON.stringify(result.data).includes("private/worker"), false);
});

test("a fixed-name core without Compose metadata plus another matching service is ambiguous", async () => {
  const containers = rows(); containers[0].service = null;
  containers.push({ ...containers[0], id: "a".repeat(64), name: "/different-kong", service: "kong" });
  const f = fixture({ rows: containers }); const result = await collectMaintenanceCapabilities(args(), f.deps);
  assert.equal(result.docker.data.identities.kong, "ambiguous");
  assert.equal(f.calls.some((call) => call.parameters.includes("curl")), false);
  assert.equal(f.calls.some((call) => call.parameters.some((parameter) => parameter.includes(".Config.Env"))), false);
});

test("host networking without published ports is not declared unreachable", () => {
  const containers = rows(); containers[0].networkMode = "host"; containers[0].ports = {};
  const result = summarizeMaintenanceCapabilitiesDocker(containers).data.containers[0];
  assert.deepEqual(result.publishedPortExposure, ["unknown"]); assert.deepEqual(result.publishedHostPorts, []);
});

test("Kong only projects four exact env keys and uses fixed no-proxy GET endpoints", async () => {
  const f = fixture(); const result = await collectMaintenanceCapabilities(args(), f.deps);
  const envCalls = f.calls.filter((call) => call.parameters.some((parameter) => parameter.includes(".Config.Env")));
  assert.equal(envCalls.length, 4);
  for (const call of envCalls) {
    const format = call.parameters[call.parameters.indexOf("--format") + 1];
    assert.match(format, /eq \(index \(split \. "="\) 0\) "KONG_(DATABASE|ADMIN_LISTEN|PLUGINS|DECLARATIVE_CONFIG)"/);
    assert.equal(format.includes("hasPrefix"), false);
  }
  const gets = f.calls.filter((call) => call.parameters.includes("curl"));
  assert.deepEqual(gets.map((call) => call.parameters.at(-1)), [
    "http://127.0.0.1:8001/status", "http://127.0.0.1:8001/plugins/enabled", "http://127.0.0.1:8001/",
  ]);
  for (const call of gets) {
    assert.equal(call.parameters[call.parameters.indexOf("curl") + 1], "--disable");
    assert.ok(call.parameters.includes("--noproxy")); assert.equal(call.parameters.includes("--location"), false);
    assert.equal(call.input, undefined);
  }
  assert.equal(result.kong.plugins.data.requestTermination, true); assert.equal(result.kong.root.data.major, "2");
});

test("off, missing, nonloopback, alternate-port or complex admin listen never triggers probes", async () => {
  for (const admin of ["off", null, "192.0.2.10:8001", "127.0.0.1:9001", "0.0.0.0:8001, 0.0.0.0:8444 ssl"]) {
    const f = fixture({ env: { KONG_ADMIN_LISTEN: admin } });
    const result = await collectMaintenanceCapabilities(args(), f.deps);
    assert.equal(f.calls.some((call) => call.parameters.includes("curl")), false);
    assert.equal(result.kong.plugins.status, "unknown");
  }
  assert.throws(() => parseMaintenanceKongEnvironment({ KONG_DATABASE: "off", private: SECRET }));
});

test("DB uses configured credentials only inside fixed script with read-only SQL and pinned endpoint", async () => {
  const f = fixture(); await collectMaintenanceCapabilities(args(), f.deps);
  assert.match(MAINTENANCE_PSQL_CONTAINER_SCRIPT, /unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGPASSWORD/);
  assert.match(MAINTENANCE_PSQL_CONTAINER_SCRIPT, /export PGPASSWORD="\$POSTGRES_PASSWORD"/);
  assert.match(MAINTENANCE_PSQL_CONTAINER_SCRIPT, /-h 127\.0\.0\.1 -p 5432 -U supabase_admin -d "\$POSTGRES_DB" -X -w/);
  for (const sql of [MAINTENANCE_DATABASE_SQL, MAINTENANCE_CRON_SQL]) {
    assert.match(sql, /^BEGIN READ ONLY;/); assert.match(sql, /statement_timeout='5s'/);
    assert.match(sql, /lock_timeout='1s'/); assert.match(sql, /ROLLBACK;\s*$/);
    // Fixed privilege-name string literals are metadata, not DML statements.
    assert.doesNotMatch(sql.replace(/'(?:''|[^'])*'/g, "''"), /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|SET\s+ROLE|pg_terminate_backend|cron\.unschedule)\b/i);
    assert.doesNotMatch(sql, /\b(?:query|command|gid|client_addr)\b/i);
  }
  assert.match(MAINTENANCE_DATABASE_SQL, /'pg_read_all_stats', 'USAGE'/);
  assert.match(MAINTENANCE_DATABASE_SQL, /NOT relrowsecurity/);
  assert.match(MAINTENANCE_DATABASE_SQL, /rolbypassrls/);
});

test("pages metadata includes column grants without claiming row writes or maintenance verified", async () => {
  const db = database();
  db.pagesWriteGrants.roles.authenticated.tableInsert = false;
  db.pagesWriteGrants.roles.authenticated.tableUpdate = false;
  const f = fixture({ database: db }); const result = await collectMaintenanceCapabilities(args(), f.deps);
  const grants = result.database.summary.data.pagesWriteGrants;
  assert.equal(grants.roles.authenticated.tableUpdate, false);
  assert.equal(grants.roles.authenticated.anyColumnUpdate, true);
  assert.equal(grants.roles.service_role.tableDelete, true);
  assert.equal(grants.rlsEnabled, true); assert.equal(grants.rlsForced, false); assert.equal(grants.policyCount, 4);
  assert.equal(grants.rowWriteAccess, "not_verified"); assert.equal(result.maintenanceState, "not_verified");
  assert.equal(f.calls.filter((call) => call.input === MAINTENANCE_DATABASE_SQL).length, 1);
  assert.equal(f.calls.filter((call) => call.input).length, 2);
  assert.match(MAINTENANCE_DATABASE_SQL, /pg_catalog\.to_regclass\('public\.pages'\)/);
  assert.match(MAINTENANCE_DATABASE_SQL, /FROM \(VALUES \('anon'\),\('authenticated'\),\('service_role'\)\)/);
  assert.equal((MAINTENANCE_DATABASE_SQL.match(/pg_catalog\.has_table_privilege\(roles\.oid/g) || []).length, 3);
  assert.equal((MAINTENANCE_DATABASE_SQL.match(/pg_catalog\.has_any_column_privilege\(roles\.oid/g) || []).length, 2);
  assert.doesNotMatch(MAINTENANCE_DATABASE_SQL, /\b(?:polqual|polwithcheck|pg_get_expr|SET\s+ROLE)\b/i);
  assert.doesNotMatch(MAINTENANCE_DATABASE_SQL, /\bFROM\s+public\.pages\b/i);
});

test("missing pages table or fixed role keeps permission unknown instead of false", async () => {
  const roleAbsent = database();
  roleAbsent.pagesWriteGrants.roles.anon = { rolePresent: false, tableInsert: null, tableUpdate: null,
    tableDelete: null, anyColumnInsert: null, anyColumnUpdate: null };
  const tableAbsent = database();
  Object.assign(tableAbsent.pagesWriteGrants, { tablePresent: false, rlsEnabled: null, rlsForced: null, policyCount: null });
  for (const role of Object.values(tableAbsent.pagesWriteGrants.roles)) {
    Object.assign(role, { tableInsert: null, tableUpdate: null, tableDelete: null, anyColumnInsert: null, anyColumnUpdate: null });
  }
  for (const db of [roleAbsent, tableAbsent]) {
    const result = await collectMaintenanceCapabilities(args(), fixture({ database: db }).deps);
    assert.equal(result.database.summary.status, "observed");
    assert.deepEqual(result.database.summary.data.pagesWriteGrants, db.pagesWriteGrants);
  }
});

test("pages grant metadata rejects false absence, extra identities, policy bodies and certainty", async () => {
  for (const mutate of [
    (grants) => { grants.roles.authenticated.rolePresent = false; },
    (grants) => { grants.tablePresent = false; },
    (grants) => { grants.roles.authenticated.anyColumnUpdate = "true"; },
    (grants) => { grants.roles.private_user = SECRET; },
    (grants) => { grants.policyExpression = SECRET; },
    (grants) => { grants.rowWriteAccess = "verified"; },
    (grants) => { grants.policyCount = -1; },
    (grants) => { delete grants.roles.service_role; },
  ]) {
    const db = database(); mutate(db.pagesWriteGrants);
    const result = await collectMaintenanceCapabilities(args(), fixture({ database: db }).deps);
    assert.equal(result.database.summary.status, "unknown"); assert.equal(result.database.summary.data, null);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    const valid = await report(); valid.database.summary.data = db;
    assert.throws(() => validateMaintenanceCapabilitiesReport(valid, BUILD));
  }
});

test("partial stats must stay null and cron RLS visibility cannot be mistaken for zero", async () => {
  const db = { ...database(), statsComplete: false, activeBackends: null, openTransactions: null, preparedTransactions: null, cronComplete: false };
  const f = fixture({ database: db }); const result = await collectMaintenanceCapabilities(args(), f.deps);
  assert.equal(result.database.summary.status, "observed"); assert.equal(result.database.summary.data.activeBackends, null);
  assert.equal(result.database.cron.status, "unknown");
  assert.equal(f.calls.filter((call) => call.input).length, 1);
  const invalid = fixture({ database: { ...db, activeBackends: 0 } });
  assert.equal((await collectMaintenanceCapabilities(args(), invalid.deps)).database.summary.status, "unknown");
});

test("DB failure or malformed body is unknown, not zero, without credentials fallback", async () => {
  for (const response of [SECRET, JSON.stringify({ ...database(), username: SECRET })]) {
    const f = fixture({ run: (_command, _args, input) => input ? response : undefined });
    const result = await collectMaintenanceCapabilities(args(), f.deps);
    assert.equal(result.database.summary.status, "unknown"); assert.equal(result.database.summary.data, null);
    assert.equal(f.calls.filter((call) => call.input).length, 1);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
});

test("Kong/API errors do not print response configuration or substitute success", async () => {
  const f = fixture({ run: (_command, parameters) => {
    if (parameters.includes("curl")) throw new Error(SECRET); return undefined;
  } });
  const result = await collectMaintenanceCapabilities(args(), f.deps);
  for (const field of ["status", "plugins", "root"]) assert.equal(result.kong[field].status, "unknown");
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("a Kong redirect with a plausible JSON body remains unknown without following it", async () => {
  const f = fixture({ run: (_command, parameters) => parameters.includes("curl")
    ? JSON.stringify({ database: { reachable: true }, enabled_plugins: [], version: "2.8.1" }) + "\n302" : undefined });
  const result = await collectMaintenanceCapabilities(args(), f.deps);
  for (const field of ["status", "plugins", "root"]) assert.equal(result.kong[field].status, "unknown");
  assert.equal(f.calls.filter((call) => call.parameters.includes("curl")).length, 3);
});

test("strict report rejects new fields, impossible calendar, false cron certainty and promotion", async () => {
  const valid = await report();
  for (const mutate of [
    (copy) => { copy.secret = SECRET; }, (copy) => { copy.maintenanceState = "verified"; },
    (copy) => { copy.observedAt = "2026-02-30T00:00:00.000Z"; },
    (copy) => { copy.database.summary.data.cronComplete = false; },
    (copy) => { copy.kong.root.data.configuration = SECRET; },
    (copy) => { copy.docker.data.containers[0].name = SECRET; },
  ]) {
    const copy = structuredClone(valid); mutate(copy);
    assert.throws(() => validateMaintenanceCapabilitiesReport(copy, BUILD));
  }
});

test("strict file and CLI validator bind live SHA and reject duplicate JSON without leaking", async () => {
  const valid = await report(); const encoded = JSON.stringify(valid);
  withFile(encoded, (file) => {
    assert.deepEqual(validateMaintenanceCapabilitiesReportFile(file, BUILD), valid);
    const run = spawnSync(process.execPath, [script, "--validate-report", file, BUILD], { encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 0); assert.deepEqual(JSON.parse(run.stdout), valid); assert.equal(run.stderr, "");
    const wrong = spawnSync(process.execPath, [script, "--validate-report", file, "d".repeat(40)], { encoding: "utf8", timeout: 5000 });
    assert.equal(wrong.status, 23); assert.equal(wrong.stdout, "");
  });
  for (const raw of [encoded.replace('"version":1', '"version":1,"version":1'), '{"secret":"' + SECRET + '"}', " ".repeat(32769)]) {
    withFile(raw, (file) => {
      const run = spawnSync(process.execPath, [script, "--validate-report", file, BUILD], { encoding: "utf8", timeout: 5000 });
      assert.equal(run.status, 23); assert.equal(run.stdout, ""); assert.equal(run.stderr.includes(SECRET), false);
    });
  }
});

test("stdin validator is self-contained and ending runtime mismatch has nonzero exit", async () => {
  const valid = await report(); valid.runtime.after = { status: "mismatch", buildId: "d".repeat(40) };
  withFile(JSON.stringify(valid), (file) => {
    const run = spawnSync(process.execPath, ["--input-type=module", "-", "--validate-report", file, BUILD],
      { input: readFileSync(script, "utf8"), encoding: "utf8", timeout: 5000 });
    assert.equal(run.status, 20); assert.equal(JSON.parse(run.stdout).runtime.after.status, "mismatch");
  });
});
