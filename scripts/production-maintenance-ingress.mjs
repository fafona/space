import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fchmodSync, fchownSync, fsyncSync, lstatSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { posix } from "node:path";

// No CLI, state file, deployment authority or automatic rollback. The caller
// must durably save planIngressInstallation() before the first host mutation.
// Unsupported topology is a prepare failure, never a maintenance certificate.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const DOCKER = ["--host", "unix:///var/run/docker.sock"];
const MAX = 2_097_152;
const ROLES = { kong: "kong", db: "supabase/postgres", rest: "postgrest/postgrest", auth: "supabase/gotrue",
  realtime: "supabase/realtime", storage: "supabase/storage-api", meta: "supabase/postgres-meta",
  studio: "supabase/studio", functions: "supabase/edge-runtime", analytics: "supabase/logflare",
  vector: "timberio/vector", imgproxy: "darthsim/imgproxy", supavisor: "supabase/supavisor" };
const INSPECT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},"state":{{json .State.Status}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mode":{{json .HostConfig.NetworkMode}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}}}';
const fail = (code = "production_maintenance_ingress_unverified") => { throw new Error(code); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const eq = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const text = (value, max = MAX) => typeof value === "string" && Buffer.byteLength(value) <= max && !value.includes("\0");
const port = (value) => Number.isInteger(value) && value > 0 && value <= 65535;
const private4 = (value) => isIP(value) === 4 && (value.startsWith("10.") || value.startsWith("192.168.") ||
  (value.startsWith("172.") && Number(value.split(".")[1]) >= 16 && Number(value.split(".")[1]) <= 31));
const absolute = (value) => text(value, 500) && value.startsWith("/etc/nginx/") && posix.normalize(value) === value && !/[\r\n]/.test(value);
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"));
}
function list(value, validate, maximum = 128) {
  return Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, i))
      .every((d) => d?.enumerable && Object.hasOwn(d, "value") && validate(d.value));
}
function input(value) {
  if (!exact(value, ["appPort", "publicSupabaseUrl", "operationId"]) || !port(value.appPort) || !UUID.test(value.operationId)) fail();
  let url;
  try { url = new URL(value.publicSupabaseUrl); } catch { fail(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !/^[a-z0-9.-]+$/.test(url.hostname) || !/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(url.pathname) ||
      url.pathname.includes("/api/supabase-proxy")) fail("production_maintenance_ingress_public_url_unsupported");
  return { appPort: value.appPort, publicSupabaseUrl: url.href, operationId: value.operationId };
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, windowsHide: true,
    timeout: 15_000, maxBuffer: MAX, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH || "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" } });
  if (result.error || result.signal || result.status !== 0) fail();
  return { stdout: result.stdout, stderr: result.stderr };
}
function readFileFact(requestedPath) {
  if (!absolute(requestedPath)) fail();
  const actualPath = realpathSync(requestedPath);
  if (!absolute(actualPath)) fail();
  const link = lstatSync(requestedPath), stat = lstatSync(actualPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o022) || stat.size > MAX) fail();
  const parents = [];
  for (const directory of new Set([posix.dirname(requestedPath), posix.dirname(actualPath)])) {
    for (let cursor = directory; cursor !== "/"; cursor = posix.dirname(cursor)) {
      const parent = lstatSync(cursor);
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022)) fail();
      const item = `${cursor}:${parent.dev}:${parent.ino}`;
      if (!parents.includes(item)) parents.push(item);
    }
  }
  return { requestedPath, actualPath, content: readFileSync(actualPath, "utf8"), mode: stat.mode & 0o777,
    uid: stat.uid, gid: stat.gid, link: link.isSymbolicLink() ? `${link.dev}:${link.ino}:${actualPath}` : null, parents };
}
function writeExact(file, expected, next) {
  const current = readFileFact(file.requestedPath);
  if (current.actualPath !== file.actualPath || current.link !== file.link || !eq(current.parents, file.parents) ||
      current.uid !== file.uid || current.gid !== file.gid || current.mode !== file.mode || hash(current.content) !== expected) fail();
  const temporary = `${file.actualPath}.faolla-${hash(next).slice(0, 20)}.tmp`;
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, file.mode);
  try { fchmodSync(fd, file.mode); fchownSync(fd, file.uid, file.gid); writeFileSync(fd, next); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (hash(readFileFact(file.requestedPath).content) !== expected) fail();
  renameSync(temporary, file.actualPath);
}
function readPrivate(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > MAX) fail();
    return readFileSync(path, "utf8");
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function createPrivate(path, content) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}
function listConfigIncludes(pattern) {
  if (!absolute(pattern) || posix.dirname(pattern).includes("*")) fail();
  for (let cursor = posix.dirname(pattern); cursor !== "/"; cursor = posix.dirname(cursor)) {
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022)) fail();
  }
  if (!pattern.includes("*")) { readFileFact(pattern); return [pattern]; }
  const names = readdirSync(posix.dirname(pattern));
  if (names.length > 1024) fail();
  const match = new RegExp("^" + posix.basename(pattern).split("*").map(regexLiteral).join("[^/]*") + "$");
  return names.filter((name) => match.test(name)).map((name) => posix.join(posix.dirname(pattern), name)).sort();
}
function deps(overrides = {}) {
  return { run, readFile: readFileFact, readText: (file) => readFileSync(file, "utf8"), writeExact,
    readPrivate, createPrivate, listIncludes: listConfigIncludes, fetch: globalThis.fetch, ...overrides };
}
function output(d, command, args, allowStderr = false) {
  const result = d.run(command, args);
  if (!exact(result, ["stdout", "stderr"]) || !text(result.stdout) || !text(result.stderr) || (!allowStderr && result.stderr.trim())) fail();
  return allowStderr ? `${result.stdout}\n${result.stderr}` : result.stdout;
}

// A bounded Nginx lexer, not regex replacement of server text. Include expansion
// retains each node's source file/offset; unknown or ambiguous syntax is refused.
function parseNginx(content, file) {
  const tokens = [];
  for (let i = 0; i < content.length;) {
    if (/\s/.test(content[i])) { i++; continue; }
    if (content[i] === "#") { while (i < content.length && content[i] !== "\n") i++; continue; }
    const start = i;
    if ("{};".includes(content[i])) { tokens.push({ value: content[i++], start, end: i }); continue; }
    let value = "";
    if ('"\''.includes(content[i])) {
      const quote = content[i++];
      while (i < content.length && content[i] !== quote) {
        if (content[i] === "\\") { i++; if (i >= content.length) fail(); }
        value += content[i++];
      }
      if (content[i++] !== quote) fail();
    } else {
      while (i < content.length && !/[\s{};#]/.test(content[i])) {
        if (content[i] === "\\") fail();
        value += content[i++];
      }
    }
    if (!value || tokens.length > 100_000) fail();
    tokens.push({ value, start, end: i });
  }
  let cursor = 0;
  function nodes(nested = false, depth = 0) {
    if (depth > 32) fail();
    const result = [];
    while (cursor < tokens.length) {
      if (tokens[cursor].value === "}") { if (!nested) fail(); cursor++; return result; }
      const values = [];
      while (cursor < tokens.length && !["{", ";", "}"].includes(tokens[cursor].value)) values.push(tokens[cursor++]);
      if (!values.length || cursor >= tokens.length || tokens[cursor].value === "}") fail();
      const delimiter = tokens[cursor++];
      result.push({ name: values[0].value, args: values.slice(1).map((item) => item.value), file,
        start: values[0].start, body: delimiter.end,
        children: delimiter.value === "{" ? nodes(true, depth + 1) : null });
    }
    if (nested) fail();
    return result;
  }
  return nodes();
}
function regexLiteral(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function nginxPlan(dump, version, files, capture, docker) {
  if (!version.includes("--with-http_realip_module") || !version.includes("--conf-path=/etc/nginx/nginx.conf") ||
      /faolla_maintenance_|x.faolla.maintenance.control/i.test(dump)) fail("production_maintenance_ingress_nginx_unsupported");
  const byPath = new Map(files.map((file) => [file.requestedPath, file]));
  if (byPath.size !== files.length || !byPath.has("/etc/nginx/nginx.conf")) fail();
  const parsed = new Map(files.map((file) => [file.requestedPath, parseNginx(file.content, file.requestedPath)]));
  const seen = new Set();
  function expand(nodes, stack = []) {
    if (stack.length > 32) fail();
    return nodes.flatMap((node) => {
      if (node.name === "include") {
        if (node.children || node.args.length !== 1 || /[$?\[\]{}]/.test(node.args[0])) fail();
        const target = node.args[0].startsWith("/") ? node.args[0] : "/etc/nginx/" + node.args[0];
        if (!absolute(target) || posix.dirname(target).includes("*")) fail();
        const pattern = new RegExp("^" + target.split("*").map(regexLiteral).join("[^/]*") + "$");
        if (pattern.test(`/etc/nginx/faolla-maintenance-${capture.operationId}.inc`)) fail();
        const matching = [...byPath.keys()].filter((file) => pattern.test(file)).sort();
        if (!matching.length && !target.includes("*")) fail();
        return matching.flatMap((file) => {
          if (stack.includes(file)) fail();
          seen.add(file); return expand(parsed.get(file), [...stack, file]);
        });
      }
      return [{ ...node, children: node.children ? expand(node.children, stack) : null }];
    });
  }
  seen.add("/etc/nginx/nginx.conf");
  const tree = expand(parsed.get("/etc/nginx/nginx.conf"), ["/etc/nginx/nginx.conf"]);
  if (tree.some((node) => ["stream", "mail"].includes(node.name))) fail("production_maintenance_ingress_nginx_unsupported");
  if (seen.size !== files.length) fail();
  const http = tree.filter((node) => node.name === "http");
  if (http.length !== 1 || !http[0].children) fail();
  const all = [];
  function visit(nodes) { for (const node of nodes) { all.push(node); if (node.children) visit(node.children); } }
  visit(tree);
  if (all.some((node) => node.args.includes("proxy_protocol") || ["debug_connection", "proxy_method"].includes(node.name) ||
      (node.name === "error_log" && node.args.includes("debug")) ||
      (node.name === "error_page" && node.args.includes("503")) ||
      /(?:^|_)(?:lua|perl|js)(?:_|$)/.test(node.name))) fail("production_maintenance_ingress_nginx_unsupported");
  const upstreams = new Map();
  for (const node of http[0].children.filter((item) => item.name === "upstream")) {
    if (node.args.length !== 1 || upstreams.has(node.args[0]) || !node.children) fail();
    const targets = node.children.filter((item) => item.name === "server").map((item) => item.args[0]);
    if (!targets.length || targets.some((target) => !target || target.includes("$"))) fail();
    upstreams.set(node.args[0], targets);
  }
  const route = new URL(capture.publicSupabaseUrl);
  const kongAddress = docker.containers.find((row) => row.service === "kong").address;
  const appTargets = [`127.0.0.1:${capture.appPort}`, `localhost:${capture.appPort}`, `[::1]:${capture.appPort}`];
  const kongTargets = ["127.0.0.1", "localhost", "[::1]", kongAddress].flatMap((host) => [`${host}:8000`, `${host}:8443`]);
  const selected = [], probes = [], controlLocations = [];
  function preserveInheritedProxyHeaders(location) {
    // Nginx inherits this directive family only when the current level has no
    // proxy_set_header of its own. Adding just the empty control header would
    // otherwise discard inherited Host/Authorization/apikey/Cookie settings.
    const ancestry = [];
    function find(node, path) {
      if (node === location) { ancestry.push(...path, node); return true; }
      return node.children?.some((child) => find(child, [...path, node])) || false;
    }
    if (!find(http[0], []) || ancestry.some((node) => !["http", "server", "location"].includes(node.name)) ||
        all.filter((node) => node.name === "location" && node.file === location.file && node.body === location.body).length !== 1) fail();
    let inherited = [];
    for (const scope of ancestry) {
      const headers = scope.children.filter((node) => node.name === "proxy_set_header");
      if (headers.some((node) => node.children || node.args.length !== 2 || node.args[0].includes("$") || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(node.args[0]))) fail();
      if (headers.length) inherited = headers;
      if (scope === location && headers.length) return [];
    }
    return inherited.map((node) => byPath.get(node.file).content.slice(node.start, node.body));
  }
  let hasApp = false, hasKong = false, publicRouteVerified = false;
  for (const server of http[0].children.filter((node) => node.name === "server")) {
    if (!server.children) fail();
    const descendants = [];
    function scan(nodes) { for (const node of nodes) { descendants.push(node); if (node.children) scan(node.children); } }
    scan(server.children);
    const targets = descendants.filter((node) => node.name === "proxy_pass").flatMap((node) => {
      if (node.args.length !== 1 || node.args[0].includes("$")) fail("production_maintenance_ingress_nginx_unsupported");
      const match = node.args[0].match(/^https?:\/\/([^/]+)(?:\/.*)?$/);
      if (!match) fail();
      return upstreams.get(match[1]) || [match[1]];
    });
    // No DNS alias, recursive Nginx port or unknown upstream can be proven not
    // to lead back to this project. This first implementation refuses it.
    if (targets.some((target) => !appTargets.includes(target) && !kongTargets.includes(target))) fail("production_maintenance_ingress_nginx_routing_unsupported");
    const app = targets.some((target) => appTargets.includes(target));
    const kong = targets.some((target) => kongTargets.includes(target));
    if (!app && !kong) continue;
    hasApp ||= app; hasKong ||= kong;
    const names = server.children.filter((node) => node.name === "server_name").flatMap((node) => node.args);
    const listens = server.children.filter((node) => node.name === "listen");
    if (!names.length || names.some((name) => !/^(?:\*\.)?[a-z0-9.-]+$/.test(name) && name !== "_") || !listens.length) fail();
    const ports = listens.map((node) => {
      const match = node.args[0]?.match(/^(?:(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):)?([0-9]+)$/);
      if (!match || !port(Number(match[1])) || node.args.slice(1).some((arg) => !["ssl", "http2", "default_server", "reuseport", "ipv6only=on", "ipv6only=off"].includes(arg))) fail();
      return { port: Number(match[1]), tls: node.args.includes("ssl") };
    });
    for (const name of names.filter((name) => /^[a-z0-9.-]+$/.test(name) && name !== "_")) {
      for (const listener of ports) probes.push(`${listener.tls ? "https" : "http"}://${name}:${listener.port}/`);
    }
    if (names.includes(route.hostname) && kong && ports.some((listener) => listener.port === Number(route.port || (route.protocol === "https:" ? 443 : 80)) && listener.tls === (route.protocol === "https:"))) {
      // Resolve the four control paths through exact/static-prefix locations.
      // No rewrite/regex/auth subrequest can turn a whitelisted token request
      // into an unreviewed Web write or another upstream.
      if (descendants.some((node) => ["rewrite", "proxy_method", "auth_request", "try_files"].includes(node.name) ||
          (node.name === "location" && (node.args.length !== 1 && !(node.args.length === 2 && ["=", "^~"].includes(node.args[0])))))) fail();
      const prefix = route.pathname.replace(/\/$/, "");
      for (const suffix of ["/rest/v1/", "/rest/v1/pages", "/auth/v1/settings", "/auth/v1/token"]) {
        const uri = prefix + suffix;
        const locations = descendants.filter((node) => node.name === "location");
        const exactLocation = locations.filter((node) => node.args[0] === "=" && node.args[1] === uri);
        const prefixes = locations.filter((node) => node.args[0] !== "=" && uri.startsWith(node.args.at(-1))).sort((a, b) => b.args.at(-1).length - a.args.at(-1).length);
        const location = exactLocation[0] || prefixes[0];
        if (!location || exactLocation.length > 1) fail();
        const passes = location.children?.filter((node) => node.name === "proxy_pass") || [];
        if (passes.length !== 1) fail();
        const target = passes[0].args[0].match(/^https?:\/\/([^/]+)/)?.[1];
        if (!(upstreams.get(target) || [target]).every((item) => kongTargets.includes(item))) fail();
        const replacement = passes[0].args[0].match(/^https?:\/\/[^/]+(\/.*)$/)?.[1];
        const upstreamUri = replacement === undefined ? uri : replacement + uri.slice(location.args.at(-1).length);
        if (upstreamUri !== suffix || location.children.some((node) => ["return", "if"].includes(node.name))) fail();
        if (!controlLocations.some((node) => node.file === location.file && node.offset === location.body)) {
          controlLocations.push({ file: location.file, offset: location.body, inheritedHeaders: preserveInheritedProxyHeaders(location) });
        }
      }
      publicRouteVerified = true;
    }
    selected.push({ file: server.file, offset: server.body });
  }
  if (!hasApp || !hasKong || !publicRouteVerified || !selected.length || new Set(selected.map((node) => `${node.file}:${node.offset}`)).size !== selected.length) {
    fail("production_maintenance_ingress_nginx_routing_unsupported");
  }
  const publicProbeUrls = [...new Set(probes)].sort();
  if (!publicProbeUrls.length || publicProbeUrls.length > 16) fail();
  return { http: { file: http[0].file, offset: http[0].body }, selected, controlLocations, publicProbeUrls };
}

function captureNginx(d, capture, docker) {
  const version = output(d, "nginx", ["-V"], true);
  const dump = output(d, "nginx", ["-T"], true);
  const paths = [...dump.matchAll(/^# configuration file (\/etc\/nginx\/[^:\r\n]+):\s*$/gm)].map((match) => match[1]);
  if (!paths.length || paths.length > 64 || new Set(paths).size !== paths.length) fail();
  const files = paths.map((file) => d.readFile(file));
  if (new Set(files.map((file) => file.actualPath)).size !== files.length) fail();
  // Compare every dump section to its actual file; diagnostic suffix is not
  // configuration and is never allowed to substitute another on-disk tree.
  for (let index = 0; index < paths.length; index++) {
    const start = dump.indexOf(`# configuration file ${paths[index]}:`);
    const body = dump.indexOf("\n", start) + 1;
    const end = index + 1 < paths.length ? dump.indexOf(`# configuration file ${paths[index + 1]}:`, body) : dump.length;
    const section = dump.slice(body, end);
    if (!section.startsWith(files[index].content) || section.slice(files[index].content.length).trim().split(/\r?\n/).some((line) => line && !line.startsWith("nginx:"))) fail();
  }
  const master = nginxMaster(d);
  return { versionHash: hash(version), master, retiringWorkers: nginxWorkers(d, master).map(({ pid, startTicks }) => ({ pid, startTicks })),
    files, plan: nginxPlan(dump, version, files, capture, docker) };
}
function nginxMaster(d) {
  const processes = output(d, "ps", ["-C", "nginx", "-o", "pid=,ppid=,uid=,args="]).trim().split(/\r?\n/);
  const masters = processes.filter((line) => line.includes("nginx: master process"));
  if (masters.length !== 1) fail("production_maintenance_ingress_nginx_master_unsupported");
  const match = masters[0].trim().match(/^([1-9][0-9]*)\s+([0-9]+)\s+0\s+nginx: master process (?:\/usr\/sbin\/)?nginx(?: -g daemon on; master_process on;)?$/);
  if (!match) fail("production_maintenance_ingress_nginx_master_unsupported");
  const pid = Number(match[1]);
  const stat = d.readText(`/proc/${pid}/stat`);
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  if (!/^[0-9]+$/.test(fields[19] || "")) fail();
  const executable = output(d, "readlink", [`/proc/${pid}/exe`]).trim();
  if (executable !== "/usr/sbin/nginx") fail();
  return { pid, startTicks: fields[19], executable, commandHash: hash(masters[0].trim()) };
}
function nginxWorkers(d, master) {
  const rows = output(d, "ps", ["-C", "nginx", "-o", "pid=,ppid=,uid=,args="]).trim().split(/\r?\n/)
    .filter((line) => line.includes("nginx: worker process"));
  if (!rows.length || rows.length > 256) fail("production_maintenance_ingress_nginx_workers_unverified");
  return rows.flatMap((line) => {
    const match = line.trim().match(/^([1-9][0-9]*)\s+([0-9]+)\s+[0-9]+\s+nginx: worker process( is shutting down)?$/);
    if (!match || Number(match[2]) !== master.pid) fail("production_maintenance_ingress_nginx_workers_unverified");
    const pid = Number(match[1]);
    let stat;
    try { stat = d.readText(`/proc/${pid}/stat`); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    if (!stat.startsWith(`${pid} (nginx) `)) fail();
    const startTicks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
    if (!/^[0-9]+$/.test(startTicks || "")) fail();
    return [{ pid, startTicks, shuttingDown: !!match[3] }];
  });
}
async function waitForRetiredWorkers(proof, d) {
  const timeout = d.workerDrainTimeoutMs ?? 30_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000) fail();
  const retired = new Set(proof.nginx.retiringWorkers.map((worker) => `${worker.pid}:${worker.startTicks}`));
  const deadline = Date.now() + timeout;
  do {
    const workers = nginxWorkers(d, proof.nginx.master);
    if (workers.length && workers.every((worker) => !worker.shuttingDown && !retired.has(`${worker.pid}:${worker.startTicks}`))) return;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
  } while (Date.now() <= deadline);
  fail("production_maintenance_ingress_old_workers_not_drained");
}
function captureDocker(d) {
  const ids = output(d, "docker", [...DOCKER, "ps", "--all", "--no-trunc", "--format", "{{json .ID}}"])
    .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (!list(ids, (id) => HEX.test(id), 64) || !ids.length || new Set(ids).size !== ids.length) fail();
  const rows = output(d, "docker", [...DOCKER, "inspect", "--type=container", "--format", INSPECT, ...ids])
    .trim().split(/\r?\n/).map((line) => JSON.parse(line));
  if (rows.length !== ids.length || new Set(rows.map((row) => row.id)).size !== ids.length || rows.some((row) => !ids.includes(row.id))) fail();
  const kong = rows.filter((row) => row.name === "/supabase-kong");
  if (kong.length !== 1 || !/^[A-Za-z0-9_-]{1,100}$/.test(kong[0].project || "")) fail();
  const selected = rows.filter((row) => row.project === kong[0].project);
  if (selected.length !== Object.keys(ROLES).length || new Set(selected.map((row) => row.service)).size !== selected.length) fail();
  const containers = selected.map((row) => {
    const family = ROLES[row.service];
    if (!family || !(row.image === family || row.image.startsWith(family + ":") || row.image.startsWith(family + "@sha256:")) || row.state !== "running" ||
        ["host", "none"].includes(row.mode) || row.mode?.startsWith("container:") || !row.networks || Object.keys(row.networks).length !== 1) fail();
    if (["kong", "db", "rest", "auth"].includes(row.service) && row.name !== "/supabase-" + row.service) fail();
    const [networkName, network] = Object.entries(row.networks)[0];
    if (!HEX.test(network.NetworkID || "") || !private4(network.IPAddress) || network.GlobalIPv6Address) fail("production_maintenance_ingress_ipv6_bridge_unsupported");
    const published = [];
    for (const [containerPort, bindings] of Object.entries(row.ports || {})) {
      if (!/^[0-9]+\/tcp$/.test(containerPort) || !port(Number(containerPort.split("/")[0]))) fail();
      if (bindings !== null && !list(bindings, (binding) => exact(binding, ["HostIp", "HostPort"]) &&
          ["0.0.0.0", "127.0.0.1", "::", "::1"].includes(binding.HostIp) && /^[0-9]+$/.test(binding.HostPort) && port(Number(binding.HostPort)))) fail();
      for (const binding of bindings || []) published.push(Number(binding.HostPort));
    }
    return { id: row.id, name: row.name, service: row.service, image: row.image, address: network.IPAddress,
      networkId: network.NetworkID, networkName, publishedPorts: [...new Set(published)].sort((a, b) => a - b) };
  }).sort((a, b) => a.service.localeCompare(b.service));
  if (new Set(containers.map((row) => row.address)).size !== containers.length || new Set(containers.map((row) => row.networkId)).size !== 1) fail();
  const networkId = containers[0].networkId;
  const network = JSON.parse(output(d, "docker", [...DOCKER, "network", "inspect", networkId, "--format", "{{json .}}"]));
  if (network.Id !== networkId || network.Driver !== "bridge" || network.EnableIPv6 !== false || network.Scope !== "local" ||
      !eq(Object.keys(network.Containers || {}).sort(), containers.map((row) => row.id).sort())) fail();
  const bridge = network.Options?.["com.docker.network.bridge.name"] || `br-${networkId.slice(0, 12)}`;
  if (!/^[A-Za-z0-9_-]{1,15}$/.test(bridge)) fail();
  const link = JSON.parse(output(d, "ip", ["-j", "-d", "link", "show", "dev", bridge]));
  if (!Array.isArray(link) || link.length !== 1 || link[0].ifname !== bridge || link[0].linkinfo?.info_kind !== "bridge") fail();
  const routes = { kong: containers.find((row) => row.service === "kong"), rest: containers.find((row) => row.service === "rest"),
    auth: containers.find((row) => row.service === "auth"), db: containers.find((row) => row.service === "db") };
  if (!routes.kong.publishedPorts.includes(8000) || !routes.kong.publishedPorts.includes(8443)) fail();
  return { project: kong[0].project, networkId, bridge, containers };
}
function firewall(d) {
  const v4 = output(d, "iptables", ["--version"]).trim(), v6 = output(d, "ip6tables", ["--version"]).trim();
  // Native nft/flowtable/offload configurations require a separately reviewed
  // backend. Do not claim legacy rules govern an uninspected parallel ruleset.
  if (!/\(legacy\)$/.test(v4) || !/\(legacy\)$/.test(v6) || v4.replace("iptables", "") !== v6.replace("ip6tables", "") ||
      d.readText("/proc/sys/net/bridge/bridge-nf-call-iptables").trim() !== "1" ||
      d.readText("/proc/sys/net/bridge/bridge-nf-call-ip6tables").trim() !== "1") fail("production_maintenance_ingress_netfilter_unsupported");
  const nft = JSON.parse(output(d, "nft", ["-j", "list", "ruleset"]));
  if (!Array.isArray(nft.nftables) || nft.nftables.some((entry) => !exact(entry, ["metainfo"]))) fail("production_maintenance_ingress_netfilter_unsupported");
  const ipv4 = output(d, "iptables", ["-w", "5", "-S"]).trim().split(/\r?\n/);
  const ipv6 = output(d, "ip6tables", ["-w", "5", "-S"]).trim().split(/\r?\n/);
  if (![ipv4, ipv6].every((lines) => lines.length < 10_000 && lines.some((line) => /^-P INPUT /.test(line))) ||
      !ipv4.includes("-N DOCKER-USER") || ipv4.find((line) => line.startsWith("-A FORWARD ")) !== "-A FORWARD -j DOCKER-USER" ||
      [...ipv4, ...ipv6].some((line) => /FLOWOFFLOAD|FAOM_.*FAOM_/i.test(line))) fail();
  return { version4: v4, version6: v6, ipv4, ipv6 };
}
function rulesFor(proof) {
  const suffix = hash(proof.input.operationId).slice(0, 16);
  const inputChain = `FAOM_I_${suffix}`, forwardChain = `FAOM_F_${suffix}`;
  const ports = [...new Set([proof.input.appPort, ...proof.docker.containers.flatMap((row) => row.publishedPorts)])].sort((a, b) => a - b);
  if (ports.some((item) => [22, 80, 443].includes(item))) fail("production_maintenance_ingress_port_overlap");
  const inputRules = ports.map((item) => ["!", "-i", "lo", "-p", "tcp", "-m", "tcp", "--dport", String(item), "-j", "DROP"]);
  const role = (name) => proof.docker.containers.find((item) => item.service === name).address;
  const forwardRules = [["kong", "rest"], ["kong", "auth"], ["rest", "db"], ["auth", "db"]]
    .flatMap(([from, to]) => [
      ["-s", role(from) + "/32", "-d", role(to) + "/32", "-i", proof.docker.bridge, "-o", proof.docker.bridge, "-j", "RETURN"],
      ["-s", role(to) + "/32", "-d", role(from) + "/32", "-i", proof.docker.bridge, "-o", proof.docker.bridge,
        "-m", "conntrack", "--ctstate", "ESTABLISHED", "--ctdir", "REPLY", "-j", "RETURN"],
    ]);
  for (const container of proof.docker.containers) forwardRules.push(["-d", container.address + "/32", "-j", "DROP"]);
  return { inputChain, forwardChain, inputRules, forwardRules };
}
function expectedRules(base, chains) {
  const policies = base.filter((line) => line.startsWith("-P "));
  const declarations = base.filter((line) => line.startsWith("-N "));
  const rules = base.filter((line) => line.startsWith("-A "));
  if (policies.length + declarations.length + rules.length !== base.length) fail();
  const result = [...policies, ...declarations, ...chains.map(({ chain }) => `-N ${chain}`)];
  for (const parent of [...policies, ...declarations].map((line) => line.split(" ")[1])) {
    result.push(...chains.filter((entry) => entry.parent === parent).map((entry) => `-A ${parent} -j ${entry.chain}`));
    result.push(...rules.filter((line) => line.startsWith(`-A ${parent} `)));
  }
  for (const entry of chains) result.push(...entry.rules.map((args) => `-A ${entry.chain} ${args.join(" ")}`));
  return result;
}
function normalizedRules(lines) {
  const chains = new Map();
  for (const line of lines) {
    if (!text(line, 4096) || /[\r\n]/.test(line)) fail();
    const parts = line.split(" ");
    if (["-P", "-N"].includes(parts[0])) {
      if (chains.has(parts[1])) fail();
      chains.set(parts[1], { declaration: line, rules: [] });
    }
  }
  for (const line of lines.filter((item) => item.startsWith("-A "))) {
    const name = line.split(" ")[1]; if (!chains.has(name)) fail(); chains.get(name).rules.push(line);
  }
  if (lines.some((line) => !/^-([PNA]) /.test(line))) fail();
  return [...chains.entries()].sort(([a], [b]) => a.localeCompare(b));
}
const equalRules = (left, right) => eq(normalizedRules(left), normalizedRules(right));
function firewallPlan(proof) {
  const rules = rulesFor(proof);
  const ipv4 = [{ chain: rules.inputChain, parent: "INPUT", rules: rules.inputRules },
    { chain: rules.forwardChain, parent: "DOCKER-USER", rules: rules.forwardRules }];
  const ipv6 = [{ chain: rules.inputChain, parent: "INPUT", rules: rules.inputRules }];
  return { ipv4, ipv6, expected4: expectedRules(proof.firewall.ipv4, ipv4), expected6: expectedRules(proof.firewall.ipv6, ipv6) };
}

export function captureIngress(rawInput, overrides = {}) {
  const capture = input(rawInput), d = deps(overrides);
  const docker = captureDocker(d), nginx = captureNginx(d, capture, docker), filter = firewall(d);
  if ([...filter.ipv4, ...filter.ipv6].some((line) => line.includes("FAOM_"))) fail();
  const proof = { version: 1, input: capture, nginx, docker, firewall: filter, installation: null };
  checkIncludeCoverage(proof, d);
  firewallPlan(proof);
  if (!eq(captureDocker(d), docker)) fail();
  return validateIngressProof(proof);
}
function buildInstallation(proof, controlToken) {
  if (!HEX.test(controlToken)) fail("production_maintenance_ingress_control_token_invalid");
  const suffix = hash(proof.input.operationId).slice(0, 16), variable = `$faolla_maintenance_${suffix}`;
  const route = new URL(proof.input.publicSupabaseUrl), prefix = route.pathname.replace(/\/$/, "");
  const allowlist = [["GET", "/rest/v1/"], ["GET", "/rest/v1/pages"], ["GET", "/auth/v1/settings"], ["POST", "/auth/v1/token"]]
    .map(([method, path]) => ({ method, url: new URL(prefix + path + (method === "POST" ? "?grant_type=password" : ""), route.origin).href }));
  const privatePath = `/etc/nginx/faolla-maintenance-${proof.input.operationId}.inc`;
  const content = `# faolla maintenance ${proof.input.operationId}\n` +
    `map $realip_remote_addr ${variable}_peer { default 0; 127.0.0.1 1; ::1 1; }\n` +
    `map $http_x_faolla_maintenance_control ${variable}_token { default 0; "${controlToken}" 1; }\n` +
    `map "$scheme:$host:$server_port:$request_method:$uri:$arg_grant_type" ${variable}_route { default 0;\n` +
    allowlist.map((entry) => `  "https:${route.hostname}:${route.port || 443}:${entry.method}:${new URL(entry.url).pathname}:${entry.method === "POST" ? "password" : ""}" 1;`).join("\n") + "\n}\n" +
    `map "${variable}_peer:${variable}_token:${variable}_route" ${variable}_deny { default 1;\n` +
    ['"1:0:0" 0;', '"1:0:1" 0;', '"1:1:0" 0;', '"1:1:1" 0;', '"0:1:1" 0;'].join("\n") + "\n}\n";
  const inserts = [{ ...proof.nginx.plan.http, content: `\n  include ${privatePath};\n` },
    ...proof.nginx.plan.selected.map((entry) => ({ ...entry, content: `\n  if (${variable}_deny) { return 503; }\n` })),
    ...proof.nginx.plan.controlLocations.map((entry) => ({ ...entry,
      content: "\n" + entry.inheritedHeaders.map((header) => `  ${header}\n`).join("") + '  proxy_set_header X-Faolla-Maintenance-Control "";\n' }))];
  const files = proof.nginx.files.map((file) => {
    let modified = file.content;
    for (const entry of inserts.filter((item) => item.file === file.requestedPath).sort((a, b) => b.offset - a.offset)) {
      modified = modified.slice(0, entry.offset) + entry.content + modified.slice(entry.offset);
    }
    return { path: file.requestedPath, originalHash: hash(file.content), modifiedHash: hash(modified), modified };
  });
  return { privatePath, privateContent: content, privateHash: hash(content), controlTokenHash: hash(controlToken), files, allowlist };
}
export function planIngressInstallation(rawProof, controlToken) {
  const proof = validateIngressProof(rawProof);
  const installation = buildInstallation(proof, controlToken);
  if (proof.installation !== null && !eq(proof.installation, installation)) fail();
  proof.installation = installation;
  return proof;
}
export function validateIngressProof(value) {
  if (!exact(value, ["version", "input", "nginx", "docker", "firewall", "installation"]) || value.version !== 1) fail();
  const capture = input(value.input);
  if (!eq(capture, value.input) || !exact(value.nginx, ["versionHash", "master", "retiringWorkers", "files", "plan"]) || !HEX.test(value.nginx.versionHash) ||
      !exact(value.nginx.master, ["pid", "startTicks", "executable", "commandHash"]) || !Number.isSafeInteger(value.nginx.master.pid) || value.nginx.master.pid < 1 ||
      !/^[0-9]+$/.test(value.nginx.master.startTicks) || value.nginx.master.executable !== "/usr/sbin/nginx" || !HEX.test(value.nginx.master.commandHash) ||
      !list(value.nginx.retiringWorkers, (worker) => exact(worker, ["pid", "startTicks"]) && Number.isSafeInteger(worker.pid) && worker.pid > 0 &&
        /^[0-9]+$/.test(worker.startTicks), 1024) || !value.nginx.retiringWorkers.length ||
      !list(value.nginx.files, (file) => exact(file, ["requestedPath", "actualPath", "content", "mode", "uid", "gid", "link", "parents"]) &&
        absolute(file.requestedPath) && absolute(file.actualPath) && text(file.content) && file.uid === 0 && Number.isInteger(file.gid) &&
        Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777 && !(file.mode & 0o022) &&
        (file.link === null || text(file.link, 600)) && list(file.parents, (parent) => text(parent, 600), 20), 64) ||
      !exact(value.nginx.plan, ["http", "selected", "controlLocations", "publicProbeUrls"]) ||
      !exact(value.docker, ["project", "networkId", "bridge", "containers"]) || !text(value.docker.project, 100) || !HEX.test(value.docker.networkId) || !/^[A-Za-z0-9_-]{1,15}$/.test(value.docker.bridge) ||
      !list(value.docker.containers, (row) => exact(row, ["id", "name", "service", "image", "address", "networkId", "networkName", "publishedPorts"]) &&
        HEX.test(row.id) && text(row.name, 100) && Object.hasOwn(ROLES, row.service) && text(row.image, 200) && private4(row.address) &&
        row.networkId === value.docker.networkId && text(row.networkName, 100) && list(row.publishedPorts, port), 13) || value.docker.containers.length !== 13 ||
      !exact(value.firewall, ["version4", "version6", "ipv4", "ipv6"]) || !text(value.firewall.version4, 100) || !text(value.firewall.version6, 100) ||
      !list(value.firewall.ipv4, (line) => text(line, 4096), 10000) || !list(value.firewall.ipv6, (line) => text(line, 4096), 10000)) fail();
  const point = (node) => exact(node, ["file", "offset"]) && Number.isSafeInteger(node.offset) && node.offset > 0 &&
    value.nginx.files.some((file) => file.requestedPath === node.file && file.content[node.offset - 1] === "{");
  if (!point(value.nginx.plan.http) || !list(value.nginx.plan.selected, point, 128) || !value.nginx.plan.selected.length ||
      !list(value.nginx.plan.controlLocations, (node) => exact(node, ["file", "offset", "inheritedHeaders"]) &&
        point({ file: node.file, offset: node.offset }) && list(node.inheritedHeaders, (header) => text(header, 8192), 128), 128) ||
      !value.nginx.plan.controlLocations.length ||
      !list(value.nginx.plan.publicProbeUrls, (url) => text(url, 1000), 128)) fail();
  if (value.installation !== null) {
    const plan = value.installation;
    if (!exact(plan, ["privatePath", "privateContent", "privateHash", "controlTokenHash", "files", "allowlist"]) ||
        plan.privatePath !== `/etc/nginx/faolla-maintenance-${capture.operationId}.inc` || !text(plan.privateContent) || hash(plan.privateContent) !== plan.privateHash ||
        !HEX.test(plan.controlTokenHash) || !list(plan.files, (file) => exact(file, ["path", "originalHash", "modifiedHash", "modified"]) &&
          absolute(file.path) && HEX.test(file.originalHash) && HEX.test(file.modifiedHash) && text(file.modified) && hash(file.modified) === file.modifiedHash &&
          value.nginx.files.some((original) => original.requestedPath === file.path && hash(original.content) === file.originalHash), 64) ||
        plan.files.length !== value.nginx.files.length || !list(plan.allowlist, (entry) => exact(entry, ["method", "url"]) &&
          ["GET", "POST"].includes(entry.method) && text(entry.url, 1000), 4) || plan.allowlist.length !== 4) fail();
    const token = plan.privateContent.match(/map \$http_x_faolla_maintenance_control [^\n]+ \{ default 0; "([0-9a-f]{64})" 1; \}/)?.[1];
    if (!token || hash(token) !== plan.controlTokenHash || !eq(plan, buildInstallation(value, token))) fail();
  }
  if (new Set(value.docker.containers.map((row) => row.id)).size !== 13 || new Set(value.docker.containers.map((row) => row.service)).size !== 13 ||
      new Set(value.docker.containers.map((row) => row.address)).size !== 13) fail();
  const derived = nginxPlan(value.nginx.files.map((file) => file.content).join("\n"),
    "--with-http_realip_module --conf-path=/etc/nginx/nginx.conf", value.nginx.files, capture, value.docker);
  if (!eq(derived, value.nginx.plan)) fail();
  return structuredClone(value);
}
function checkFiles(proof, d, mode) {
  checkIncludeCoverage(proof, d);
  for (const file of proof.nginx.files) {
    const actual = d.readFile(file.requestedPath), plan = proof.installation.files.find((entry) => entry.path === file.requestedPath);
    if (!eq({ ...actual, content: "" }, { ...file, content: "" })) fail();
    const current = hash(actual.content);
    if (mode === "modified" ? current !== plan.modifiedHash : current !== plan.modifiedHash && current !== plan.originalHash) fail();
  }
  const current = d.readPrivate(proof.installation.privatePath);
  if (current !== null && hash(current) !== proof.installation.privateHash) fail();
  if (mode === "modified" && current === null) fail();
}
function checkIncludeCoverage(proof, d) {
  const paths = proof.nginx.files.map((file) => file.requestedPath);
  function check(nodes) {
    for (const node of nodes) {
      if (node.name === "include") {
        const target = node.args[0].startsWith("/") ? node.args[0] : "/etc/nginx/" + node.args[0];
        const pattern = new RegExp("^" + target.split("*").map(regexLiteral).join("[^/]*") + "$");
        if (!eq(d.listIncludes(target), paths.filter((path) => pattern.test(path)).sort())) fail();
      }
      if (node.children) check(node.children);
    }
  }
  for (const file of proof.nginx.files) check(parseNginx(file.content, file.requestedPath));
}
function verifyHost(proof, d) {
  if (!eq(captureDocker(d), proof.docker) || !eq(nginxMaster(d), proof.nginx.master) || hash(output(d, "nginx", ["-V"], true)) !== proof.nginx.versionHash) fail();
  const actual = firewall(d);
  if (actual.version4 !== proof.firewall.version4 || actual.version6 !== proof.firewall.version6) fail();
  return actual;
}
function ensureChain(d, binary, chain, allLines) {
  const existing = allLines.filter((line) => line.startsWith(`-A ${chain.chain} `));
  const expected = chain.rules.map((args) => `-A ${chain.chain} ${args.join(" ")}`);
  if (!eq(existing, expected.slice(0, existing.length))) fail();
  if (!allLines.includes(`-N ${chain.chain}`)) output(d, binary, ["-w", "5", "-N", chain.chain]);
  for (let i = 0; i < expected.length; i++) if (!existing.includes(expected[i])) output(d, binary, ["-w", "5", "-A", chain.chain, ...chain.rules[i]]);
  const jump = `-A ${chain.parent} -j ${chain.chain}`;
  const matching = allLines.filter((line) => line === jump);
  if (matching.length > 1 || (matching.length && allLines.find((line) => line.startsWith(`-A ${chain.parent} `)) !== jump)) fail();
  if (!matching.length) output(d, binary, ["-w", "5", "-I", chain.parent, "1", "-j", chain.chain]);
}
export function getIngressProbePlan(rawProof) {
  const proof = validateIngressProof(rawProof);
  if (!proof.installation) fail();
  return { publicProbeUrls: proof.nginx.plan.publicProbeUrls, publicSupabaseUrl: proof.input.publicSupabaseUrl,
    controlAllowlist: proof.installation.allowlist };
}
function probeHeaders(d) {
  const value = d.probeHeaders;
  if (!exact(value, ["apikey", "authorization"]) || !text(value.apikey, 8192) ||
      !/^[A-Za-z0-9._-]{20,8192}$/.test(value.apikey) || value.authorization !== `Bearer ${value.apikey}` || typeof d.fetch !== "function" ||
      (d.probeControlServices !== undefined && typeof d.probeControlServices !== "boolean") ||
      (d.probeTimeoutMs !== undefined && (!Number.isInteger(d.probeTimeoutMs) || d.probeTimeoutMs < 1 || d.probeTimeoutMs > 8000))) {
    fail("production_maintenance_ingress_probe_credentials_unavailable");
  }
  return { ...value };
}
async function verifyHttp(proof, d) {
  const headers = probeHeaders(d);
  const token = proof.installation.privateContent.match(/map \$http_x_faolla_maintenance_control [^\n]+ \{ default 0; "([0-9a-f]{64})" 1; \}/)?.[1];
  const request = async (url, control, kind) => {
    const parsed = new URL(url); parsed.searchParams.set("faolla_maintenance_probe", randomUUID());
    const controller = new AbortController();
    let reader, expired = false, timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      expired = true; controller.abort(); reject(new Error("production_maintenance_ingress_http_unverified"));
    }, d.probeTimeoutMs ?? 8000); });
    const action = (async () => {
      const response = await d.fetch(parsed.href, { method: "GET", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { "cache-control": "no-cache, no-store", pragma: "no-cache", ...(control ? { ...headers, "x-faolla-maintenance-control": token } : {}) } });
      if (expired) { void response.body?.cancel().catch(() => {}); fail(); }
      if (response.redirected || response.status !== (kind === "blocked" ? 503 : 200)) fail();
      if (kind === "blocked") { await response.body?.cancel(); return; }
      if (!/^(?:application\/json|application\/openapi\+json)(?:;|$)/i.test(response.headers.get("content-type") || "")) fail();
      reader = response.body?.getReader(); if (!reader) fail();
      const chunks = []; let size = 0;
      while (true) {
        const chunk = await reader.read(); if (expired) fail(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > MAX) fail(); chunks.push(chunk.value);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) fail();
      if (kind === "auth" ? !body.external || typeof body.external !== "object" || Array.isArray(body.external) :
          body.swagger !== "2.0" || !body.paths || typeof body.paths !== "object" || Array.isArray(body.paths)) fail();
    })();
    try { await Promise.race([action, deadline]); }
    catch { fail("production_maintenance_ingress_http_unverified"); }
    finally { clearTimeout(timer); if (reader) { void reader.cancel().catch(() => {}); } }
  };
  const route = new URL(proof.input.publicSupabaseUrl), prefix = route.pathname.replace(/\/$/, "");
  await Promise.all([
    ...proof.nginx.plan.publicProbeUrls.map((url) => request(url, false, "blocked")),
    request(new URL(prefix + "/rest/v1/", route.origin).href, false, "blocked"),
    request(new URL(prefix + "/auth/v1/token", route.origin).href, true, "blocked"),
    ...(d.probeControlServices === false ? [] : [request(new URL(prefix + "/rest/v1/", route.origin).href, true, "rest"),
      request(new URL(prefix + "/auth/v1/settings", route.origin).href, true, "auth")]),
  ]);
}
export async function installIngress(rawProof, controlToken, overrides = {}) {
  const proof = planIngressInstallation(rawProof, controlToken), d = deps(overrides), plan = firewallPlan(proof);
  checkFiles(proof, d, "either");
  const actual = verifyHost(proof, d);
  const retiring = [...proof.nginx.retiringWorkers, ...nginxWorkers(d, proof.nginx.master).map(({ pid, startTicks }) => ({ pid, startTicks }))];
  proof.nginx.retiringWorkers = [...new Map(retiring.map((worker) => [`${worker.pid}:${worker.startTicks}`, worker])).values()];
  validateIngressProof(proof);
  // Ignore only this operation's own partial rules when checking the baseline.
  for (const [current, original, chains] of [[actual.ipv4, proof.firewall.ipv4, plan.ipv4], [actual.ipv6, proof.firewall.ipv6, plan.ipv6]]) {
    const owned = new Set(chains.map((entry) => entry.chain));
    if (!equalRules(current.filter((line) => !owned.has(line.split(" ")[1]) && ![...owned].some((chain) => line === `-A INPUT -j ${chain}` || line === `-A DOCKER-USER -j ${chain}`)), original)) fail();
  }
  if (d.readPrivate(proof.installation.privatePath) === null) d.createPrivate(proof.installation.privatePath, proof.installation.privateContent);
  for (const file of proof.nginx.files) {
    const change = proof.installation.files.find((entry) => entry.path === file.requestedPath);
    if (hash(d.readFile(file.requestedPath).content) === change.originalHash && change.originalHash !== change.modifiedHash) d.writeExact(file, change.originalHash, change.modified);
  }
  output(d, "nginx", ["-t"], true);
  for (const chain of plan.ipv4) ensureChain(d, "iptables", chain, actual.ipv4);
  for (const chain of plan.ipv6) ensureChain(d, "ip6tables", chain, actual.ipv6);
  output(d, "nginx", ["-s", "reload"], true);
  verifyIngressStructure(proof, d);
  // This is deliberately not a held certificate: caller persists the returned
  // worker observations, stops Web/worker, then calls full verifyIngress().
  return proof;
}
function verifyIngressStructure(proof, d) {
  if (!proof.installation) fail();
  checkFiles(proof, d, "modified");
  const actual = verifyHost(proof, d), plan = firewallPlan(proof);
  if (!equalRules(actual.ipv4, plan.expected4) || !equalRules(actual.ipv6, plan.expected6)) fail();
  const dump = output(d, "nginx", ["-T"], true);
  const paths = [...dump.matchAll(/^# configuration file (\/etc\/nginx\/[^:\r\n]+):\s*$/gm)].map((match) => match[1]);
  if (!eq([...paths].sort(), [...proof.nginx.files.map((file) => file.requestedPath), proof.installation.privatePath].sort())) fail();
  output(d, "nginx", ["-t"], true);
}
export async function verifyIngress(rawProof, overrides = {}) {
  const proof = validateIngressProof(rawProof), d = deps(overrides);
  verifyIngressStructure(proof, d);
  await waitForRetiredWorkers(proof, d);
  await verifyHttp(proof, d);
  return { configurationVerified: true, activeHttpVerified: true, controlServicesVerified: d.probeControlServices !== false,
    ...getIngressProbePlan(proof) };
}
export async function restoreIngress(rawProof, overrides = {}) {
  const proof = validateIngressProof(rawProof), d = deps(overrides);
  await verifyIngress(proof, overrides);
  // Original content only replaces this operation's exact modified content.
  // Any partial failure must be handled by caller reinstall + failed-held logic.
  for (const file of proof.nginx.files) {
    const change = proof.installation.files.find((entry) => entry.path === file.requestedPath);
    if (change.originalHash !== change.modifiedHash) d.writeExact(file, change.modifiedHash, file.content);
  }
  output(d, "nginx", ["-t"], true);
  output(d, "nginx", ["-s", "reload"], true);
  const plan = firewallPlan(proof);
  for (const [binary, chains] of [["iptables", plan.ipv4], ["ip6tables", plan.ipv6]]) {
    for (const chain of [...chains].reverse()) {
      output(d, binary, ["-w", "5", "-D", chain.parent, "-j", chain.chain]);
      for (const rule of [...chain.rules].reverse()) output(d, binary, ["-w", "5", "-D", chain.chain, ...rule]);
      output(d, binary, ["-w", "5", "-X", chain.chain]);
    }
  }
  const current = firewall(d);
  if (!equalRules(current.ipv4, proof.firewall.ipv4) || !equalRules(current.ipv6, proof.firewall.ipv6)) fail();
  for (const file of proof.nginx.files) if (hash(d.readFile(file.requestedPath).content) !== hash(file.content)) fail();
  // Keep the root-only include for exact fail-held reinstall after a later
  // caller-controlled smoke failure. It is no longer included by Nginx.
  return { restored: true };
}
