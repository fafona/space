import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import http from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REPORT_BYTES = 32_768;
const MAX_COMMAND_BYTES = 1_048_576;
const roleImages = { kong: "kong", db: "supabase/postgres", rest: "postgrest/postgrest", auth: "supabase/gotrue",
  realtime: "supabase/realtime", storage: "supabase/storage-api", meta: "supabase/postgres-meta",
  studio: "supabase/studio", functions: "supabase/edge-runtime", analytics: "supabase/logflare",
  vector: "timberio/vector", imgproxy: "darthsim/imgproxy", supavisor: "supabase/supavisor" };
const coreRoles = ["kong", "db", "rest", "auth"];
const states = ["created", "running", "paused", "restarting", "removing", "exited", "dead"];
const exposureTypes = ["none", "loopback", "all_interfaces", "non_loopback", "unknown"];
const networkModes = ["host", "bridge", "none", "container", "custom"];
const identityStates = ["verified", "missing", "unknown", "ambiguous"];
const dockerPrefix = ["--host", "unix:///var/run/docker.sock"];
const envKeys = ["KONG_DATABASE", "KONG_ADMIN_LISTEN", "KONG_PLUGINS", "KONG_DECLARATIVE_CONFIG"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const unknown = (code) => ({ status: "unknown", code, data: null });
const observed = (data) => ({ status: "observed", code: null, data });
const string = (value, max = 500) => typeof value === "string" && value.length <= max;
const INSPECT_FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"state":{{json .State.Status}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"networkMode":{{json .HostConfig.NetworkMode}},"networks":[{{$first := true}}{{range $name,$value := .NetworkSettings.Networks}}{{if not $first}},{{end}}{{json $name}}{{$first = false}}{{end}}],"ports":{{json .NetworkSettings.Ports}}}';

export const MAINTENANCE_PSQL_CONTAINER_SCRIPT = [
  "set -eu",
  ': "${POSTGRES_PASSWORD:?configured password required}"',
  ': "${POSTGRES_DB:?configured database required}"',
  '[ "$POSTGRES_DB" = postgres ]',
  "unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE PGOPTIONS PGPASSFILE PGPASSWORD",
  'export PGPASSWORD="$POSTGRES_PASSWORD"',
  "export PGCONNECT_TIMEOUT=3",
  "export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5s -c lock_timeout=1s'",
  'exec psql -h 127.0.0.1 -p 5432 -U supabase_admin -d "$POSTGRES_DB" -X -w -q -A -t -v ON_ERROR_STOP=1',
].join("\n");
const SQL_START = "BEGIN READ ONLY;\nSET LOCAL statement_timeout='5s';\nSET LOCAL lock_timeout='1s';\n";
export const MAINTENANCE_DATABASE_SQL = SQL_START + [
  "WITH visibility AS (SELECT current_setting('is_superuser') = 'on'",
  " OR pg_catalog.pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS complete),",
  "counts AS (SELECT count(*) FILTER (WHERE state = 'active') AS active,",
  " count(*) FILTER (WHERE xact_start IS NOT NULL) AS transactions",
  " FROM pg_catalog.pg_stat_activity WHERE pid <> pg_catalog.pg_backend_pid())",
  "SELECT json_build_object(",
  " 'databaseMatches', current_database() = 'postgres',",
  " 'readOnly', current_setting('transaction_read_only') = 'on',",
  " 'statsComplete', visibility.complete,",
  " 'activeBackends', CASE WHEN visibility.complete THEN counts.active ELSE NULL END,",
  " 'openTransactions', CASE WHEN visibility.complete THEN counts.transactions ELSE NULL END,",
  " 'preparedTransactions', CASE WHEN visibility.complete THEN (SELECT count(*) FROM pg_catalog.pg_prepared_xacts) ELSE NULL END,",
  " 'extensions', json_build_object(",
  " 'pgCron', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron'),",
  " 'pgNet', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net'),",
  " 'http', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='http'),",
  " 'dblink', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='dblink'),",
  " 'postgresFdw', EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='postgres_fdw'),",
  " 'otherCount', (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname NOT IN ('pg_cron','pg_net','http','dblink','postgres_fdw'))),",
  " 'cronTablePresent', pg_catalog.to_regclass('cron.job') IS NOT NULL,",
  " 'cronReadable', COALESCE(pg_catalog.has_table_privilege(pg_catalog.to_regclass('cron.job'),'SELECT'),false),",
  " 'cronComplete', EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('cron.job') AND (NOT relrowsecurity",
  " OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)))))::text",
  " FROM visibility CROSS JOIN counts;",
  "ROLLBACK;",
].join("\n");
export const MAINTENANCE_CRON_SQL = SQL_START +
  "SELECT json_build_object('activeCount', count(*) FILTER (WHERE active), 'totalCount', count(*))::text FROM cron.job;\nROLLBACK;\n";
const sha = (value) => typeof value === "string" && value.length === 40 && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const integer = (value, max = 100_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const fail = (code = "maintenance_capabilities_report_invalid") => { throw new Error(code); };
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}
function list(value, check, max = 100) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Array.from({ length: value.length }, (_, index) => descriptors[index]).every((descriptor) =>
    descriptor?.enumerable && Object.hasOwn(descriptor, "value") && check(descriptor.value));
}
function strictJson(text, maximum = MAX_COMMAND_BYTES) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > maximum) fail();
  const parsed = JSON.parse(text);
  // JSON.parse alone silently chooses the last duplicate key. Reject duplicates,
  // including escaped spellings, before interpreting a diagnostic identity.
  const stack = [];
  for (let index = 0; index < text.length; index++) {
    const c = text[index];
    if (c === "{") stack.push(new Set());
    else if (c === "[") stack.push(null);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') { if (text[index] === "\\") index++; index++; }
      let after = index + 1; while (/\s/.test(text[after] || "") && after < text.length) after++;
      if (text[after] === ":") {
        const key = JSON.parse(text.slice(start, index + 1)); const current = stack.at(-1);
        if (!current || current.has(key)) fail(); current.add(key);
      }
    }
  }
  return parsed;
}
function boundedFile(file, limit) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > limit) fail();
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > limit) fail();
    const bytes = Buffer.alloc(limit + 1); const count = readSync(fd, bytes, 0, bytes.length, 0);
    if (count > limit) fail();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
  } finally { closeSync(fd); }
}
export function captureMaintenanceCapabilitiesArguments(values) {
  if (!Array.isArray(values) || values.length !== 4 || values.some((value) => typeof value !== "string")) fail("maintenance_capabilities_arguments_invalid");
  const [appDir, appName, port, expectedRuntimeBuildId] = values;
  if (!/^\/[A-Za-z0-9._/-]+$/.test(appDir) || appDir === "/" || appDir.endsWith("/") ||
      appDir.includes("//") || appDir.split("/").some((part) => part === "." || part === "..") ||
      appDir.length > 500 || !/^[A-Za-z0-9._-]{1,100}$/.test(appName) || appName !== appName.trim() ||
      !/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || !sha(expectedRuntimeBuildId)) fail("maintenance_capabilities_arguments_invalid");
  return { appDir, appName, port: Number(port), expectedRuntimeBuildId };
}
function run(command, parameters, input) {
  const result = spawnSync(command, parameters, { encoding: "utf8", input, timeout: 10_000,
    maxBuffer: MAX_COMMAND_BYTES, windowsHide: true, shell: false,
    env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  if (result.error || result.signal || result.status !== 0 || !string(result.stdout, MAX_COMMAND_BYTES) ||
      Buffer.byteLength(result.stdout) > MAX_COMMAND_BYTES) fail("maintenance_capabilities_command_unknown");
  return result.stdout;
}
function exposure(ip) {
  if (["", "0.0.0.0", "::"].includes(ip)) return "all_interfaces";
  if (!isIP(ip)) return "unknown";
  return ip === "::1" || /^127\./.test(ip) ? "loopback" : "non_loopback";
}
function matchesImage(image, expected) {
  return string(image) && (image === expected || image.startsWith(expected + ":") || image.startsWith(expected + "@sha256:"));
}
function classify(row) {
  return Object.keys(roleImages).find((role) => row.service === role && matchesImage(row.image, roleImages[role])) || "unknown";
}
export function summarizeMaintenanceCapabilitiesDocker(rows) {
  if (!list(rows, (row) => exact(row, ["id", "name", "image", "state", "project", "service", "networkMode", "networks", "ports"]) &&
      digest(row.id) && string(row.name) && row.name.startsWith("/") && string(row.image) && states.includes(row.state) &&
      (row.project === null || string(row.project)) && (row.service === null || string(row.service)) &&
      string(row.networkMode) && row.networkMode.length > 0 &&
      list(row.networks, (name) => string(name, 200) && name.length > 0, 16) && new Set(row.networks).size === row.networks.length &&
      row.ports && typeof row.ports === "object" && !Array.isArray(row.ports) && Object.keys(row.ports).length <= 32, 64) ||
      new Set(rows.map((row) => row.id)).size !== rows.length || new Set(rows.map((row) => row.name)).size !== rows.length) fail();
  const identities = {}; const frozen = {};
  for (const role of coreRoles) {
    const named = rows.filter((row) => row.name === "/supabase-" + role);
    const candidates = rows.filter((row) => classify(row) === role);
    const candidateIds = new Set([...named, ...candidates].map((row) => row.id));
    identities[role] = candidateIds.size > 1 ? "ambiguous" : !named.length ? "missing"
      : matchesImage(named[0].image, roleImages[role]) && (!named[0].service || named[0].service === role) ? "verified" : "unknown";
    if (identities[role] === "verified") frozen[role] = named[0];
  }
  const containers = rows.map((row) => {
    const publishedHostPorts = new Set(); const publishedPortExposure = new Set();
    for (const [port, mappings] of Object.entries(row.ports)) {
      if (!/^[1-9]\d{0,4}\/(?:tcp|udp|sctp)$/.test(port) || Number(port.split("/")[0]) > 65535) fail();
      if (mappings === null) continue;
      if (!list(mappings, (mapping) => exact(mapping, ["HostIp", "HostPort"]) && string(mapping.HostIp, 100) &&
          string(mapping.HostPort, 5) && /^[1-9]\d{0,4}$/.test(mapping.HostPort) && Number(mapping.HostPort) <= 65535, 16)) fail();
      for (const mapping of mappings) { publishedHostPorts.add(Number(mapping.HostPort)); publishedPortExposure.add(exposure(mapping.HostIp)); }
    }
    const networkMode = ["host", "bridge", "none"].includes(row.networkMode) ? row.networkMode : row.networkMode.startsWith("container:") ? "container" : "custom";
    const role = coreRoles.find((name) => frozen[name]?.id === row.id) || classify(row);
    return { identityHash: hash(row.id), imageHash: hash(row.image), role, state: row.state,
      composeProjectHash: row.project ? hash(row.project) : null, networkMode,
      networkCount: row.networks.length, networkSetHash: hash(JSON.stringify([...row.networks].sort())),
      sharesKongNetwork: frozen.kong ? row.networks.some((name) => frozen.kong.networks.includes(name)) : "unknown",
      publishedHostPorts: [...publishedHostPorts].sort((a, b) => a - b),
      publishedPortExposure: publishedPortExposure.size ? [...publishedPortExposure].sort() : ["host", "container"].includes(networkMode) ? ["unknown"] : ["none"],
      networkReachability: "not_inspected" };
  });
  return { data: { identities, containers }, frozen };
}
function inventory(execute) {
  const raw = execute("docker", [...dockerPrefix, "ps", "--all", "--no-trunc", "--format", "{{json .ID}}"]);
  const ids = raw.trim() ? raw.trim().split(/\r?\n/).map((line) => strictJson(line, 100)) : [];
  if (!list(ids, digest, 64) || new Set(ids).size !== ids.length) fail();
  if (!ids.length) return summarizeMaintenanceCapabilitiesDocker([]);
  const details = execute("docker", [...dockerPrefix, "inspect", "--type=container", "--format", INSPECT_FORMAT, ...ids]);
  const rows = details.trim().split(/\r?\n/).map((line) => strictJson(line, 32_768));
  if (rows.length !== ids.length || rows.some((row) => !ids.includes(row?.id))) fail();
  return summarizeMaintenanceCapabilitiesDocker(rows);
}
export function parseMaintenanceKongEnvironment(values) {
  if (!exact(values, envKeys) || !Object.values(values).every((value) => value === null || string(value, 4096))) fail();
  const admin = values.KONG_ADMIN_LISTEN;
  const adminListen = admin === "off" ? "off" : /^(?:127\.0\.0\.1|0\.0\.0\.0):8001$/.test(admin || "") ? "loopback_probe_8001" : "unknown";
  const pluginValues = values.KONG_PLUGINS === null ? null : values.KONG_PLUGINS.split(",").map((value) => value.trim());
  if (pluginValues && (pluginValues.length > 256 || pluginValues.some((value) => !value || value.length > 200))) fail();
  return { database: ["off", "postgres"].includes(values.KONG_DATABASE) ? values.KONG_DATABASE : "unknown",
    adminListen, plugins: pluginValues === null ? "unset" : pluginValues.includes("bundled") ? "bundled_configured" : "custom_configured",
    configuredPluginCount: pluginValues === null ? null : pluginValues.length,
    declarativeConfig: values.KONG_DECLARATIVE_CONFIG ? "set" : "unset" };
}
function emptyKong() {
  return { environment: unknown("kong_environment_unknown"), status: unknown("kong_status_unknown"),
    plugins: unknown("kong_plugins_unknown"), root: unknown("kong_root_unknown") };
}
function kongFacts(execute, row) {
  const result = emptyKong(); if (!row || row.state !== "running") return result;
  try {
    const values = {};
    for (const key of envKeys) {
      const template = '{{range .Config.Env}}{{if eq (index (split . "=") 0) "' + key + '"}}{{json .}}{{println}}{{end}}{{end}}';
      const text = execute("docker", [...dockerPrefix, "inspect", "--type=container", "--format", template, row.id]);
      const lines = text.trim() ? text.trim().split(/\r?\n/) : [];
      if (lines.length > 1) fail();
      const value = lines.length ? strictJson(lines[0], 8192) : null;
      if (value !== null && (!string(value, 4200) || !value.startsWith(key + "="))) fail();
      values[key] = value === null ? null : value.slice(key.length + 1);
    }
    result.environment = observed(parseMaintenanceKongEnvironment(values));
  } catch { return result; }
  if (result.environment.data.adminListen !== "loopback_probe_8001") return result;
  for (const [field, endpoint] of [["status", "/status"], ["plugins", "/plugins/enabled"], ["root", "/"]]) {
    try {
      const raw = execute("docker", [...dockerPrefix, "exec", row.id, "curl", "--disable", "--silent", "--show-error", "--fail",
        "--max-time", "3", "--connect-timeout", "1", "--noproxy", "*", "--request", "GET", "--write-out", "\n%{http_code}", "http://127.0.0.1:8001" + endpoint]);
      if (!raw.endsWith("\n200")) fail();
      const value = strictJson(raw.slice(0, -4), 65_536);
      if (!value || typeof value !== "object" || Array.isArray(value)) fail();
      if (field === "status") {
        if (!value.database || typeof value.database.reachable !== "boolean") fail();
        result.status = observed({ databaseReachable: value.database.reachable });
      } else if (field === "plugins") {
        if (!list(value.enabled_plugins, (name) => string(name, 200) && name.length > 0, 256) ||
            new Set(value.enabled_plugins).size !== value.enabled_plugins.length) fail();
        result.plugins = observed({ count: value.enabled_plugins.length, requestTermination: value.enabled_plugins.includes("request-termination"),
          preFunction: value.enabled_plugins.includes("pre-function") });
      } else {
        if (!string(value.version, 100) || !/^\d+\.\d+/.test(value.version)) fail();
        result.root = observed({ major: value.version.startsWith("2.") ? "2" : value.version.startsWith("3.") ? "3" : "other" });
      }
    } catch { /* Preserve the exact unknown code. Never retry or expose raw response. */ }
  }
  return result;
}
function validDatabase(value) {
  return exact(value, ["databaseMatches", "readOnly", "statsComplete", "activeBackends", "openTransactions", "preparedTransactions", "extensions", "cronTablePresent", "cronReadable", "cronComplete"]) &&
    value.databaseMatches === true && value.readOnly === true && typeof value.statsComplete === "boolean" &&
    ["activeBackends", "openTransactions", "preparedTransactions"].every((key) => value.statsComplete ? integer(value[key], 1_000_000_000) : value[key] === null) &&
    exact(value.extensions, ["pgCron", "pgNet", "http", "dblink", "postgresFdw", "otherCount"]) &&
    ["pgCron", "pgNet", "http", "dblink", "postgresFdw"].every((key) => typeof value.extensions[key] === "boolean") &&
    integer(value.extensions.otherCount) && typeof value.cronTablePresent === "boolean" && typeof value.cronReadable === "boolean" &&
    typeof value.cronComplete === "boolean" && (value.cronTablePresent || (!value.cronReadable && !value.cronComplete));
}
function databaseFacts(execute, row) {
  const result = { summary: unknown("database_probe_unknown"), cron: unknown("database_cron_unknown"), otherDatabaseSchedules: "unknown" };
  if (!row || row.state !== "running") return result;
  const query = (sql) => strictJson(execute("docker", [...dockerPrefix, "exec", "-i", row.id, "sh", "-c", MAINTENANCE_PSQL_CONTAINER_SCRIPT], sql).trim(), 16_384);
  try {
    const value = query(MAINTENANCE_DATABASE_SQL);
    if (!validDatabase(value)) fail();
    result.summary = observed(value);
    if (!value.cronTablePresent) result.cron = { status: "absent", code: null, data: null };
    else if (value.cronReadable && value.cronComplete) {
      const counts = query(MAINTENANCE_CRON_SQL);
      if (!exact(counts, ["activeCount", "totalCount"]) || !integer(counts.activeCount, 1_000_000_000) ||
          !integer(counts.totalCount, 1_000_000_000) || counts.activeCount > counts.totalCount) fail();
      result.cron = observed(counts);
    }
  } catch { /* A failed cron read does not turn it into zero or trigger another identity. */ }
  return result;
}
async function runtimeVersion(getVersion, port, expected) {
  try {
    const value = await getVersion(port);
    if (!exact(value, ["ok", "buildId", "releasedAt"]) || value.ok !== true || !sha(value.buildId) || !string(value.releasedAt, 100)) fail();
    return value.buildId === expected ? { status: "verified", buildId: expected } : { status: "mismatch", buildId: value.buildId };
  } catch { return { status: "unknown", buildId: null }; }
}
export async function collectMaintenanceCapabilities(values, dependencies = {}) {
  const args = captureMaintenanceCapabilitiesArguments(values);
  const execute = dependencies.run || run; const getVersion = dependencies.getVersion || readMaintenanceCapabilitiesVersion;
  const before = await runtimeVersion(getVersion, args.port, args.expectedRuntimeBuildId);
  let docker = unknown("docker_inventory_unknown"); let kong = emptyKong();
  let database = { summary: unknown("database_probe_unknown"), cron: unknown("database_cron_unknown"), otherDatabaseSchedules: "unknown" };
  if (before.status === "verified") {
    try {
      const captured = inventory(execute); docker = observed(captured.data);
      kong = kongFacts(execute, captured.frozen.kong);
      database = databaseFacts(execute, captured.frozen.db);
    } catch { /* Inventory is incomplete: do not probe an unverified container. */ }
  }
  const after = await runtimeVersion(getVersion, args.port, args.expectedRuntimeBuildId);
  return validateMaintenanceCapabilitiesReport({ version: 1, observedAt: new Date().toISOString(), expectedRuntimeBuildId: args.expectedRuntimeBuildId,
    maintenanceState: "not_verified", runtime: { before, after }, docker, kong, database }, args.expectedRuntimeBuildId);
}
export function validateMaintenanceCapabilitiesReport(value, expectedRuntimeBuildId) {
  if (!sha(expectedRuntimeBuildId) || !exact(value, ["version", "observedAt", "expectedRuntimeBuildId", "maintenanceState", "runtime", "docker", "kong", "database"]) ||
      value.version !== 1 || value.expectedRuntimeBuildId !== expectedRuntimeBuildId || value.maintenanceState !== "not_verified" ||
      !string(value.observedAt, 24) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt) ||
      !Number.isFinite(Date.parse(value.observedAt)) || new Date(value.observedAt).toISOString() !== value.observedAt ||
      !exact(value.runtime, ["before", "after"]) || !Object.values(value.runtime).every((r) => exact(r, ["status", "buildId"]) &&
        ((r.status === "verified" && r.buildId === expectedRuntimeBuildId) || (r.status === "mismatch" && sha(r.buildId) && r.buildId !== expectedRuntimeBuildId) ||
        (r.status === "unknown" && r.buildId === null)))) fail();
  if (!box(value.docker, "docker_inventory_unknown", (data) => exact(data, ["identities", "containers"]) &&
      exact(data.identities, coreRoles) && Object.values(data.identities).every((state) => identityStates.includes(state)) &&
      list(data.containers, (row) => exact(row, ["identityHash", "imageHash", "role", "state", "composeProjectHash", "networkMode", "networkCount", "networkSetHash",
        "sharesKongNetwork", "publishedHostPorts", "publishedPortExposure", "networkReachability"]) && digest(row.identityHash) && digest(row.imageHash) &&
        (row.role === "unknown" || Object.hasOwn(roleImages, row.role)) && states.includes(row.state) && (row.composeProjectHash === null || digest(row.composeProjectHash)) &&
        networkModes.includes(row.networkMode) && integer(row.networkCount, 16) && digest(row.networkSetHash) &&
        [true, false, "unknown"].includes(row.sharesKongNetwork) && row.networkReachability === "not_inspected" &&
        list(row.publishedHostPorts, (port) => integer(port, 65535) && port > 0, 512) && new Set(row.publishedHostPorts).size === row.publishedHostPorts.length &&
        list(row.publishedPortExposure, (item) => exposureTypes.includes(item), 5) && row.publishedPortExposure.length > 0 &&
        new Set(row.publishedPortExposure).size === row.publishedPortExposure.length &&
        !(row.publishedPortExposure.includes("none") && (row.publishedPortExposure.length > 1 || row.publishedHostPorts.length || ["host", "container"].includes(row.networkMode))), 64) &&
      new Set(data.containers.map((row) => row.identityHash)).size === data.containers.length)) fail();
  if (!exact(value.kong, ["environment", "status", "plugins", "root"]) ||
      !box(value.kong.environment, "kong_environment_unknown", (data) => exact(data, ["database", "adminListen", "plugins", "configuredPluginCount", "declarativeConfig"]) &&
        ["off", "postgres", "unknown"].includes(data.database) && ["off", "loopback_probe_8001", "unknown"].includes(data.adminListen) &&
        ["unset", "bundled_configured", "custom_configured"].includes(data.plugins) &&
        (data.plugins === "unset" ? data.configuredPluginCount === null : integer(data.configuredPluginCount, 256) && data.configuredPluginCount > 0) &&
        ["set", "unset"].includes(data.declarativeConfig)) ||
      !box(value.kong.status, "kong_status_unknown", (data) => exact(data, ["databaseReachable"]) && typeof data.databaseReachable === "boolean") ||
      !box(value.kong.plugins, "kong_plugins_unknown", (data) => exact(data, ["count", "requestTermination", "preFunction"]) &&
        integer(data.count, 256) && typeof data.requestTermination === "boolean" && typeof data.preFunction === "boolean") ||
      !box(value.kong.root, "kong_root_unknown", (data) => exact(data, ["major"]) && ["2", "3", "other"].includes(data.major))) fail();
  if (!exact(value.database, ["summary", "cron", "otherDatabaseSchedules"]) || value.database.otherDatabaseSchedules !== "unknown" ||
      !box(value.database.summary, "database_probe_unknown", validDatabase)) fail();
  const cron = value.database.cron;
  if (!(exact(cron, ["status", "code", "data"]) && cron.status === "absent" && cron.code === null && cron.data === null &&
      value.database.summary.status === "observed" && value.database.summary.data.cronTablePresent === false) &&
      !box(cron, "database_cron_unknown", (data) => exact(data, ["activeCount", "totalCount"]) && integer(data.activeCount, 1_000_000_000) &&
        integer(data.totalCount, 1_000_000_000) && data.activeCount <= data.totalCount &&
        value.database.summary.status === "observed" && value.database.summary.data.cronReadable && value.database.summary.data.cronComplete)) fail();
  if (value.runtime.before.status !== "verified" && (value.docker.status !== "unknown" || value.database.summary.status !== "unknown" ||
      Object.values(value.kong).some((entry) => entry.status !== "unknown"))) fail();
  const encoded = JSON.stringify(value); if (Buffer.byteLength(encoded) > MAX_REPORT_BYTES) fail();
  return JSON.parse(encoded);
}
export function validateMaintenanceCapabilitiesReportFile(file, expectedRuntimeBuildId) {
  return validateMaintenanceCapabilitiesReport(strictJson(boundedFile(file, MAX_REPORT_BYTES), MAX_REPORT_BYTES), expectedRuntimeBuildId);
}
if (process.argv[1] === "-" || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    const report = args[0] === "--validate-report" && args.length === 3
      ? validateMaintenanceCapabilitiesReportFile(args[1], args[2]) : await collectMaintenanceCapabilities(args);
    process.stdout.write(JSON.stringify(report) + "\n");
    if (Object.values(report.runtime).some((entry) => entry.status !== "verified")) process.exitCode = 20;
  } catch (error) {
    const code = error?.message === "maintenance_capabilities_arguments_invalid" ? error.message : "maintenance_capabilities_report_invalid";
    process.stderr.write("[maintenance-capabilities] " + code + "\n"); process.exitCode = 23;
  }
}

function box(value, code, check) {
  return exact(value, ["status", "code", "data"]) && ((value.status === "unknown" && value.code === code && value.data === null) ||
    (value.status === "observed" && value.code === null && check(value.data)));
}

export async function readMaintenanceCapabilitiesVersion(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  return await new Promise((resolve) => {
    let request; let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { request?.destroy(); finish(null); }, 4_000);
    try {
      request = http.get({ host: "127.0.0.1", port, path: "/api/app-web-version", method: "GET",
        agent: false, timeout: 3_000, headers: { accept: "application/json" } }, (response) => {
        if (response.statusCode !== 200) { response.destroy(); finish(null); return; }
        const chunks = []; let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 16_384) { response.destroy(); finish(null); } else chunks.push(chunk);
        });
        response.on("end", () => {
          try { finish(strictJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), 16_384)); }
          catch { finish(null); }
        });
        response.on("error", () => finish(null)); response.on("aborted", () => finish(null));
      });
      request.on("error", () => finish(null)); request.on("timeout", () => { request.destroy(); finish(null); });
    } catch { finish(null); }
  });
}
