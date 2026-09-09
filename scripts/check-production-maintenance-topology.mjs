import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import http from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REPORT_BYTES = 32_768;
const MAX_COMMAND_BYTES = 1_048_576;
const roles = ["kong", "rest", "db", "auth"];
const states = ["created", "running", "paused", "restarting", "removing", "exited", "dead"];
const exposures = ["none", "loopback", "all_interfaces", "non_loopback", "unknown"];
const networkModes = ["host", "bridge", "none", "container", "custom"];
const sha = (value) => typeof value === "string" && value.length === 40 && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const integer = (value, max = 100_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const fail = (code = "maintenance_topology_report_invalid") => { throw new Error(code); };
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
function unavailable(code) { return { status: "unavailable", code, data: null }; }
function observed(data) { return { status: "observed", code: null, data }; }

export function captureMaintenanceTopologyArguments(values) {
  if (!Array.isArray(values) || values.length !== 4 || values.some((value) => typeof value !== "string")) fail("maintenance_topology_arguments_invalid");
  const [appDir, appName, port, expectedRuntimeBuildId] = values;
  if (!/^\/[A-Za-z0-9._/-]+$/.test(appDir) || appDir === "/" || appDir.endsWith("/") ||
      appDir.includes("//") || appDir.split("/").some((part) => part === "." || part === "..") ||
      appDir.length > 500 || !/^[A-Za-z0-9._-]{1,100}$/.test(appName) || appName !== appName.trim() ||
      !/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535 || !sha(expectedRuntimeBuildId)) fail("maintenance_topology_arguments_invalid");
  return { appDir, appName, port: Number(port), expectedRuntimeBuildId };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 5_000, maxBuffer: MAX_COMMAND_BYTES,
    windowsHide: true, shell: false, env: { PATH: process.env.PATH || "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== "string" ||
      Buffer.byteLength(result.stdout, "utf8") > MAX_COMMAND_BYTES) fail("maintenance_topology_command_unavailable");
  return result.stdout;
}

export async function readMaintenanceRuntimeVersion(port) {
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

function exposure(ip) {
  if (ip === "0.0.0.0" || ip === "::" || ip === "") return "all_interfaces";
  if (!isIP(ip)) return "unknown";
  if (ip === "::1" || /^127\./.test(ip)) return "loopback";
  return "non_loopback";
}
export function summarizeMaintenanceDocker(records, details) {
  if (!list(records, (row) => exact(row, ["id", "name"]) && digest(row.id) && typeof row.name === "string" &&
      row.name.length > 0 && row.name.length <= 200, 256) || new Set(records.map((row) => row.id)).size !== records.length ||
      new Set(records.map((row) => row.name)).size !== records.length || !Array.isArray(details)) fail();
  const selected = records.filter((row) => roles.some((role) => row.name === `supabase-${role}`));
  if (details.length !== selected.length || selected.length > roles.length) fail();
  const summaries = roles.map((role) => ({ role, count: 0, state: null, networkMode: null, publishedHostPorts: [], publishedPortExposure: ["none"], networkReachability: "not_inspected" }));
  for (const row of selected) {
    const matched = details.filter((detail) => detail?.id === row.id);
    if (matched.length !== 1) fail(); const detail = matched[0];
    if (!exact(detail, ["id", "name", "state", "networkMode", "ports"]) || detail.name !== `/${row.name}` || !states.includes(detail.state) ||
        typeof detail.networkMode !== "string" || !detail.networkMode || detail.networkMode.length > 200 ||
        !detail.ports || typeof detail.ports !== "object" || Array.isArray(detail.ports) || Object.keys(detail.ports).length > 32) fail();
    const types = new Set(); const hostPorts = new Set();
    for (const [port, mappings] of Object.entries(detail.ports)) {
      if (!/^\d{1,5}\/(?:tcp|udp|sctp)$/.test(port) || Number(port.split("/")[0]) < 1 || Number(port.split("/")[0]) > 65535) fail();
      if (mappings === null) continue;
      if (!list(mappings, (mapping) => exact(mapping, ["HostIp", "HostPort"]) && typeof mapping.HostIp === "string" &&
          typeof mapping.HostPort === "string" && /^[1-9]\d{0,4}$/.test(mapping.HostPort) && Number(mapping.HostPort) <= 65535, 16)) fail();
      for (const mapping of mappings) { types.add(exposure(mapping.HostIp)); hostPorts.add(Number(mapping.HostPort)); }
    }
    const summary = summaries.find((item) => row.name === `supabase-${item.role}`);
    summary.count = 1; summary.state = detail.state;
    summary.networkMode = ["host", "bridge", "none"].includes(detail.networkMode) ? detail.networkMode
      : detail.networkMode.startsWith("container:") ? "container" : "custom";
    summary.publishedHostPorts = [...hostPorts].sort((a, b) => a - b);
    // Host/container networking may expose listeners without port bindings.
    summary.publishedPortExposure = types.size ? [...types].sort() : ["host", "container"].includes(summary.networkMode) ? ["unknown"] : ["none"];
  }
  return { roles: summaries, otherContainerCount: records.length - selected.length };
}
function dockerFacts(execute) {
  try {
    const prefix = ["--host", "unix:///var/run/docker.sock"];
    const raw = execute("docker", [...prefix, "ps", "--all", "--no-trunc", "--format", '{"id":{{json .ID}},"name":{{json .Names}}}']);
    const records = raw.trim() ? raw.trim().split(/\r?\n/).map((line) => strictJson(line, 2_048)) : [];
    if (!list(records, (row) => exact(row, ["id", "name"]) && digest(row.id) && typeof row.name === "string", 256)) fail();
    const selected = records.filter((row) => roles.some((role) => row.name === `supabase-${role}`));
    if (selected.length > 4) fail();
    const details = selected.map((row) => strictJson(execute("docker", [...prefix, "inspect", "--type=container", "--format",
      '{"id":{{json .Id}},"name":{{json .Name}},"state":{{json .State.Status}},"networkMode":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}}}', row.id]), 32_768));
    return observed(summarizeMaintenanceDocker(records, details));
  } catch { return unavailable("docker_topology_unavailable"); }
}

export function summarizeMaintenanceNginx(text, appPort) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_COMMAND_BYTES || !text.trim()) fail();
  // Diagnostic classification, not a complete Nginx parser or a write fence.
  // Ignore comments; no header, path, upstream hostname or config body escapes.
  const config = text.replace(/#[^\r\n]*/g, "");
  const names = [...config.matchAll(/\bserver_name\s+([^;{}]+);/g)].flatMap((match) => match[1].trim().split(/\s+/));
  const listenPorts = new Set(); let unknownListenCount = 0;
  for (const match of config.matchAll(/\blisten\s+([^;{}]+);/g)) {
    const endpoint = match[1].trim().split(/\s+/)[0];
    const port = /^(?:\d{1,5}|(?:\[[a-fA-F0-9:]+\]|[\d.]+|\*):\d{1,5})$/.test(endpoint) ? Number(endpoint.split(":").at(-1)) : 0;
    if (Number.isSafeInteger(port) && port > 0 && port <= 65535) listenPorts.add(port); else unknownListenCount++;
  }
  let appLoopback = false; let supabaseLoopback = false; let otherUpstreamCount = 0;
  for (const match of config.matchAll(/\bproxy_pass\s+([^;{}]+);/g)) {
    try {
      const url = new URL(match[1].trim());
      if (["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
          Number(url.port || (url.protocol === "http:" ? 80 : 443)) === appPort) appLoopback = true;
      else if (["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
          [8000, 8443, 54321].includes(Number(url.port))) supabaseLoopback = true;
      else otherUpstreamCount++;
    } catch { otherUpstreamCount++; }
  }
  return { configuredDomains: { faolla: names.includes("faolla.com"), www: names.includes("www.faolla.com"), launch: names.includes("launch.faolla.com") },
    listenPorts: [...listenPorts].sort((a, b) => a - b), unknownListenCount,
    upstreams: { appLoopback, supabaseLoopback, otherUpstreamCount }, configHash: createHash("sha256").update(text).digest("hex") };
}

export async function collectMaintenanceTopology(values, dependencies = {}) {
  const args = captureMaintenanceTopologyArguments(values);
  const execute = dependencies.run || run;
  const getVersion = dependencies.getVersion || readMaintenanceRuntimeVersion;
  let runtime;
  try {
    const version = await getVersion(args.port);
    if (!exact(version, ["ok", "buildId", "releasedAt"]) || version.ok !== true || !sha(version.buildId) ||
        typeof version.releasedAt !== "string" || version.releasedAt.length > 100) throw new Error("invalid");
    runtime = version.buildId === args.expectedRuntimeBuildId ? { status: "verified", code: null, buildId: version.buildId }
      : { status: "mismatch", code: "runtime_build_mismatch", buildId: version.buildId };
  } catch { runtime = { status: "unavailable", code: "runtime_version_unavailable", buildId: null }; }
  // Native jlist can auto-start a daemon after any precheck races with exit.
  // Existing runtime supervision diagnostics remain separate evidence.
  const pm2 = unavailable("pm2_inventory_not_collected");
  const docker = dockerFacts(execute);
  let nginx;
  try { nginx = observed(summarizeMaintenanceNginx(execute("nginx", ["-T"]), args.port)); }
  catch { nginx = unavailable("nginx_topology_unavailable"); }
  const report = { version: 1, observedAt: new Date().toISOString(), expectedRuntimeBuildId: args.expectedRuntimeBuildId,
    maintenanceState: "not_verified", runtime, pm2, docker, nginx, cron: { status: "unknown", code: "cron_not_inspected" } };
  return validateMaintenanceTopologyReport(report, args.expectedRuntimeBuildId);
}

export function validateMaintenanceTopologyReport(value, expectedRuntimeBuildId) {
  if (!sha(expectedRuntimeBuildId) || !exact(value, ["version", "observedAt", "expectedRuntimeBuildId", "maintenanceState", "runtime", "pm2", "docker", "nginx", "cron"]) ||
      value.version !== 1 || value.expectedRuntimeBuildId !== expectedRuntimeBuildId || value.maintenanceState !== "not_verified" ||
      typeof value.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt) ||
      !Number.isFinite(Date.parse(value.observedAt)) || new Date(value.observedAt).toISOString() !== value.observedAt) fail();
  const r = value.runtime;
  if (!exact(r, ["status", "code", "buildId"]) || !(
    (r.status === "verified" && r.code === null && r.buildId === expectedRuntimeBuildId) ||
    (r.status === "mismatch" && r.code === "runtime_build_mismatch" && sha(r.buildId) && r.buildId !== expectedRuntimeBuildId) ||
    (r.status === "unavailable" && r.code === "runtime_version_unavailable" && r.buildId === null))) fail();
  function section(item, unavailableCodes, check) {
    if (!exact(item, ["status", "code", "data"]) || !((item.status === "unavailable" && unavailableCodes.includes(item.code) && item.data === null) ||
      (item.status === "observed" && item.code === null && check(item.data)))) fail();
  }
  section(value.pm2, ["pm2_inventory_not_collected"], () => false);
  section(value.docker, ["docker_topology_unavailable"], (data) => exact(data, ["roles", "otherContainerCount"]) && integer(data.otherContainerCount, 256) &&
    list(data.roles, (row) => exact(row, ["role", "count", "state", "networkMode", "publishedHostPorts", "publishedPortExposure", "networkReachability"]) && roles.includes(row.role) && [0, 1].includes(row.count) &&
      row.networkReachability === "not_inspected" &&
      (row.count === 0 ? row.state === null && row.networkMode === null && row.publishedHostPorts?.length === 0 && row.publishedPortExposure?.length === 1 && row.publishedPortExposure[0] === "none"
        : states.includes(row.state) && networkModes.includes(row.networkMode)) &&
      list(row.publishedHostPorts, (port) => integer(port, 65535) && port > 0, 512) && new Set(row.publishedHostPorts).size === row.publishedHostPorts.length &&
      list(row.publishedPortExposure, (type) => exposures.includes(type), 5) && row.publishedPortExposure.length > 0 && new Set(row.publishedPortExposure).size === row.publishedPortExposure.length &&
      !(row.publishedPortExposure.includes("none") && (row.publishedPortExposure.length > 1 || row.publishedHostPorts.length > 0 || ["host", "container"].includes(row.networkMode))), 4) && data.roles.length === 4 &&
    data.roles.every((row, index) => row.role === roles[index]));
  section(value.nginx, ["nginx_topology_unavailable"], (data) => exact(data, ["configuredDomains", "listenPorts", "unknownListenCount", "upstreams", "configHash"]) &&
    exact(data.configuredDomains, ["faolla", "www", "launch"]) && Object.values(data.configuredDomains).every((flag) => typeof flag === "boolean") &&
    list(data.listenPorts, (port) => integer(port, 65535) && port > 0) && new Set(data.listenPorts).size === data.listenPorts.length && integer(data.unknownListenCount) &&
    exact(data.upstreams, ["appLoopback", "supabaseLoopback", "otherUpstreamCount"]) && typeof data.upstreams.appLoopback === "boolean" &&
    typeof data.upstreams.supabaseLoopback === "boolean" && integer(data.upstreams.otherUpstreamCount) && digest(data.configHash));
  if (!exact(value.cron, ["status", "code"]) || value.cron.status !== "unknown" || value.cron.code !== "cron_not_inspected") fail();
  const encoded = JSON.stringify(value); if (Buffer.byteLength(encoded) > MAX_REPORT_BYTES) fail();
  return JSON.parse(encoded);
}

export function validateMaintenanceTopologyReportFile(file, expectedRuntimeBuildId) {
  return validateMaintenanceTopologyReport(strictJson(boundedFile(file, MAX_REPORT_BYTES), MAX_REPORT_BYTES), expectedRuntimeBuildId);
}

if (process.argv[1] === "-" || (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    const report = args[0] === "--validate-report" && args.length === 3
      ? validateMaintenanceTopologyReportFile(args[1], args[2]) : await collectMaintenanceTopology(args);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.runtime.status !== "verified") process.exitCode = 20;
  } catch (error) {
    const code = error?.message === "maintenance_topology_arguments_invalid" ? error.message : "maintenance_topology_report_invalid";
    process.stderr.write(`[maintenance-topology] ${code}\n`); process.exitCode = 23;
  }
}
