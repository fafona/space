import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { types } from "node:util";

// Private Nginx configuration evidence. No commands are run on import and no
// install/reload/write capability is provided by this module. Cohosted server
// scripts remain privileged trusted applications, not a sandbox boundary.
const MAX = 2_097_152;
const ERROR = "production_maintenance_ingress_nginx_unsupported";
const fail = (code = ERROR) => { throw new Error(code); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = (value, limit = MAX) => typeof value === "string" && Buffer.byteLength(value) <= limit && !value.includes("\0");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROFILES = Object.freeze({
  standard: Object.freeze({ id: "standard", binary: "/usr/sbin/nginx", mainConfig: "/etc/nginx/nginx.conf",
    prefix: "/etc/nginx", configPrefix: "/etc/nginx", configRoots: Object.freeze(["/etc/nginx"]) }),
  bt: Object.freeze({ id: "bt", binary: "/www/server/nginx/sbin/nginx", mainConfig: "/www/server/nginx/conf/nginx.conf",
    prefix: "/www/server/nginx", configPrefix: "/www/server/nginx/conf", configRoots: Object.freeze([
      "/www/server/nginx/conf", "/www/server/panel/vhost/nginx", "/www/server/panel/vhost/rewrite"]) }),
});
export function getNginxProfile(id = "standard") {
  if (typeof id !== "string" || !Object.hasOwn(PROFILES, id)) fail();
  return PROFILES[id];
}
function profile(value = "standard") {
  if (typeof value === "string") return getNginxProfile(value);
  if (Object.values(PROFILES).includes(value)) return value;
  fail();
}
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function selectNginxProfile(version) {
  if (!text(version) || !version.includes("--with-http_realip_module")) fail();
  const configurations = [...version.matchAll(/(?:^|\s)--conf-path=([^\s]+)/g)].map((item) => item[1]);
  const prefixes = [...version.matchAll(/(?:^|\s)--prefix=([^\s]+)/g)].map((item) => item[1]);
  if (configurations.length > 1 || prefixes.length > 1) fail();
  if (configurations[0] === PROFILES.standard.mainConfig) return PROFILES.standard;
  if (prefixes[0] === PROFILES.bt.prefix && (!configurations.length || configurations[0] === PROFILES.bt.mainConfig)) return PROFILES.bt;
  fail();
}
export function isNginxConfigPath(value, rawProfile) {
  if (!text(value, 500) || !value.startsWith("/") || /[\r\n]/.test(value) || posix.normalize(value) !== value) return false;
  const profiles = rawProfile === undefined ? Object.values(PROFILES) : [profile(rawProfile)];
  return profiles.some((p) => p.configRoots.some((root) => value.startsWith(root + "/")));
}
export function getNginxPrivateIncludePath(operationId, rawProfile = "standard") {
  if (typeof operationId !== "string" || !UUID.test(operationId)) fail();
  return `${profile(rawProfile).configPrefix}/faolla-maintenance-${operationId}.inc`;
}
function safeParents(requestedPath, actualPath) {
  const parents = [];
  for (const directory of new Set([posix.dirname(requestedPath), posix.dirname(actualPath)])) {
    for (let cursor = directory; ; cursor = posix.dirname(cursor)) {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) || realpathSync(cursor) !== cursor) fail();
      const item = `${cursor}:${stat.dev}:${stat.ino}`;
      if (!parents.includes(item)) parents.push(item);
      if (cursor === "/") break;
    }
  }
  return parents;
}
export function readFileFact(requestedPath) {
  let descriptor;
  try {
    if (!isNginxConfigPath(requestedPath)) fail();
    const actualPath = realpathSync(requestedPath);
    if (!isNginxConfigPath(actualPath)) fail();
    const link = lstatSync(requestedPath), stat = lstatSync(actualPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o022) || stat.size > MAX) fail();
    const parents = safeParents(requestedPath, actualPath);
    const sameFile = (a, b) => ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode", "uid", "gid", "nlink"].every((key) => a[key] === b[key]);
    descriptor = openSync(actualPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!sameFile(stat, fstatSync(descriptor))) fail();
    const bytes = Buffer.alloc(stat.size + 1); let size = 0;
    while (size < bytes.length) { const count = readSync(descriptor, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
    if (size !== stat.size || !sameFile(stat, fstatSync(descriptor))) fail();
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)), after = lstatSync(actualPath);
    if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs ||
        stat.ctimeMs !== after.ctimeMs || stat.mode !== after.mode || stat.uid !== after.uid || stat.nlink !== after.nlink ||
        realpathSync(requestedPath) !== actualPath || !eq(safeParents(requestedPath, actualPath), parents) || !text(content)) fail();
    return { requestedPath, actualPath, content, mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid,
      link: link.isSymbolicLink() ? `${link.dev}:${link.ino}:${actualPath}` : null, parents };
  } catch { fail(); } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
export function listConfigIncludes(pattern) {
  try {
    if (!isNginxConfigPath(pattern) || /[$?\[\]{}]/.test(pattern) || posix.dirname(pattern).includes("*")) fail();
    safeParents(pattern, pattern);
    if (!pattern.includes("*")) { readFileFact(pattern); return [pattern]; }
    const names = readdirSync(posix.dirname(pattern));
    if (names.length > 1024) fail();
    const match = new RegExp("^" + posix.basename(pattern).split("*").map(escape).join("[^/]*") + "$");
    return names.filter((name) => match.test(name)).map((name) => posix.join(posix.dirname(pattern), name)).sort();
  } catch { fail(); }
}
function output(d, command, args, allowStderr = false) {
  const result = d.run(command, args);
  if (!result || typeof result !== "object" || types.isProxy(result) || Object.keys(result).sort().join() !== "stderr,stdout" ||
      !text(result.stdout) || !text(result.stderr) || (!allowStderr && result.stderr.trim())) fail();
  return allowStderr ? `${result.stdout}\n${result.stderr}` : result.stdout;
}
function luaEnd(source, start) {
  let depth = 1, i = start;
  const longEnd = () => {
    const begin = source.slice(i).match(/^\[(=*)\[/);
    if (!begin) return false;
    const end = source.indexOf("]" + begin[1] + "]", i + begin[0].length);
    if (end < 0) fail(); i = end + begin[1].length + 2; return true;
  };
  while (i < source.length) {
    if (source.startsWith("--", i)) {
      i += 2; if (!longEnd()) { while (i < source.length && source[i] !== "\n") i++; }
    } else if (source[i] === "[" && longEnd()) { /* Lua long string. */ }
    else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++];
      while (i < source.length && source[i] !== quote) { if (source[i] === "\\") i++; i++; }
      if (source[i++] !== quote) fail();
    } else if (source[i] === "{") { if (++depth > 32) fail(); i++; }
    else if (source[i] === "}") { if (--depth === 0) return i; i++; }
    else i++;
  }
  fail();
}
export function parseNginx(content, file) {
  if (!text(content) || !isNginxConfigPath(file)) fail();
  let cursor = 0, count = 0;
  const next = () => {
    while (cursor < content.length) {
      if (/\s/.test(content[cursor])) { cursor++; continue; }
      if (content[cursor] === "#") { while (cursor < content.length && content[cursor] !== "\n") cursor++; continue; }
      break;
    }
    if (cursor === content.length) return null;
    const start = cursor;
    if ("{};".includes(content[cursor])) return { value: content[cursor++], start, end: cursor };
    let value = "", quoted = false;
    while (cursor < content.length && !/[\s{};#]/.test(content[cursor])) {
      if (content[cursor] === "'" || content[cursor] === '"') {
        quoted = true;
        const quote = content[cursor++];
        while (cursor < content.length && content[cursor] !== quote) {
          if (content[cursor] === "\\") { value += content[cursor++]; if (cursor === content.length) fail(); }
          value += content[cursor++];
        }
        if (content[cursor++] !== quote) fail();
      } else {
        if (content[cursor] === "\\") { value += content[cursor++]; if (cursor === content.length) fail(); }
        value += content[cursor++];
      }
    }
    if (!value && !quoted || ++count > 100_000) fail(); return { value, start, end: cursor };
  };
  const nodes = (nested, depth) => {
    if (depth > 32) fail(); const result = [];
    while (true) {
      const first = next();
      if (!first) { if (nested) fail(); return result; }
      if (first.value === "}") { if (!nested) fail(); return result; }
      if (["{", ";"].includes(first.value)) fail();
      const values = [first]; let delimiter;
      while ((delimiter = next()) && !["{", ";", "}"].includes(delimiter.value)) values.push(delimiter);
      if (!delimiter || delimiter.value === "}") fail();
      const node = { name: first.value, args: values.slice(1).map((item) => item.value), file,
        start: first.start, body: delimiter.end, head: content.slice(first.start, delimiter.start), children: null };
      if (delimiter.value === "{") {
        if (node.name === "set_by_lua_block") {
          const end = luaEnd(content, cursor); node.opaque = hash(content.slice(cursor, end)); cursor = end + 1;
        } else node.children = nodes(true, depth + 1);
      } else if (node.name === "set_by_lua_block") fail();
      result.push(node);
    }
  };
  return nodes(false, 0);
}
function includeTarget(node, p) {
  if (node.children || node.args.length !== 1 || /[$?\[\]{}]/.test(node.args[0])) fail();
  const target = node.args[0].startsWith("/") ? node.args[0] : p.configPrefix + "/" + node.args[0];
  if (!isNginxConfigPath(target, p) || posix.dirname(target).includes("*")) fail(); return target;
}
function flattened(nodes) {
  const result = [];
  const visit = (values, parents) => { for (const node of values) { result.push({ node, parents }); if (node.children) visit(node.children, [...parents, node]); } };
  visit(nodes, []); return result;
}
function wellKnownDeny(node) {
  const expression = "^/\\.well-known/.*\\.(php|jsp|py|js|css|lua|ts|go|zip|tar\\.gz|rar|7z|sql|bak)$";
  const match = node.head.match(/^if\s*\(\s*\$uri\s*~\s*(.*?)\s*\)\s*$/s);
  let actual = match?.[1];
  if (actual?.startsWith('"') && actual.endsWith('"') || actual?.startsWith("'") && actual.endsWith("'")) actual = actual.slice(1, -1);
  return actual === expression && node.children?.length === 1 && node.children[0].name === "return" &&
    eq(node.children[0].args, ["403"]) && !node.children[0].children;
}
export function nginxPlan(dump, version, files, capture, docker, rawProfile) {
  const p = rawProfile === undefined ? selectNginxProfile(version) : profile(rawProfile);
  if (selectNginxProfile(version).id !== p.id || !text(dump) || /faolla_maintenance_|x.faolla.maintenance.control/i.test(dump)) fail();
  if (!Array.isArray(files) || !files.length || files.length > 64) fail();
  const byPath = new Map(files.map((file) => [file.requestedPath, file]));
  if (byPath.size !== files.length || !byPath.has(p.mainConfig) || files.some((file) =>
    !isNginxConfigPath(file.requestedPath, p) || !isNginxConfigPath(file.actualPath, p))) fail();
  const parsed = new Map(files.map((file) => [file.requestedPath, parseNginx(file.content, file.requestedPath)])), seen = new Set([p.mainConfig]);
  const expand = (nodes, stack) => {
    if (stack.length > 32) fail();
    return nodes.flatMap((node) => {
      if (node.name !== "include") return [{ ...node, children: node.children ? expand(node.children, stack) : null }];
      const target = includeTarget(node, p), pattern = new RegExp("^" + target.split("*").map(escape).join("[^/]*") + "$");
      if (pattern.test(getNginxPrivateIncludePath(capture.operationId, p))) fail();
      const matches = [...byPath.keys()].filter((file) => pattern.test(file)).sort();
      if (!matches.length && !target.includes("*")) fail();
      return matches.flatMap((file) => { if (stack.includes(file)) fail(); seen.add(file); return expand(parsed.get(file), [...stack, file]); });
    });
  };
  const tree = expand(parsed.get(p.mainConfig), [p.mainConfig]);
  if (seen.size !== files.length || tree.some((node) => node.name === "mail")) fail();
  for (const node of tree.filter((item) => item.name === "stream")) {
    if (p.id !== "bt" || !node.children || node.children.some((item) => item.children ||
      !["log_format", "access_log", "error_log"].includes(item.name))) fail();
  }
  const http = tree.filter((node) => node.name === "http");
  if (http.length !== 1 || !http[0].children) fail();
  const all = flattened(tree), servers = http[0].children.filter((node) => node.name === "server"), upstreams = new Map();
  for (const { node, parents } of all) {
    if (node.args.includes("proxy_protocol") || ["debug_connection", "proxy_method"].includes(node.name) ||
      (node.name === "error_log" && node.args.includes("debug")) || (node.name === "error_page" && node.args.includes("503"))) fail();
    if (/(?:^|_)(?:lua|perl|js)(?:_|$)/.test(node.name)) {
      const packagePath = p.id === "bt" && node.name === "lua_package_path" && parents.length === 1 && parents[0] === http[0] &&
        !node.children && node.args.length === 1 && !node.args[0].includes("$");
      const isolated = p.id === "bt" && node.name === "set_by_lua_block" && node.opaque && node.args.length === 1 &&
        /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(node.args[0]) && parents.some((item) => servers.includes(item)) &&
        parents.every((item) => ["http", "server", "location", "if"].includes(item.name));
      if (!packagePath && !isolated) fail();
    }
  }
  for (const node of http[0].children.filter((item) => item.name === "upstream")) {
    if (node.args.length !== 1 || upstreams.has(node.args[0]) || !node.children) fail();
    const targets = node.children.filter((item) => item.name === "server").map((item) => item.args[0]);
    if (!targets.length || targets.some((target) => !target || target.includes("$"))) fail(); upstreams.set(node.args[0], targets);
  }
  let route; try { route = new URL(capture.publicSupabaseUrl); } catch { fail(); }
  const kongAddress = docker.containers.find((row) => row.service === "kong")?.address;
  if (!kongAddress || !Number.isInteger(capture.appPort)) fail();
  const appTargets = [`127.0.0.1:${capture.appPort}`, `localhost:${capture.appPort}`, `[::1]:${capture.appPort}`];
  const kongTargets = ["127.0.0.1", "localhost", "[::1]", kongAddress].flatMap((host) => [`${host}:8000`, `${host}:8443`]);
  const protectedHosts = [...new Set(["faolla.com", "www.faolla.com", "launch.faolla.com", route.hostname])];
  const covers = (name, host) => name === host || name.startsWith("*.") && host.endsWith(name.slice(1)) ||
    name.startsWith(".") && (host === name.slice(1) || host.endsWith(name));
  const selected = [], probes = [], controlLocations = [];
  let hasApp = false, hasKong = false, publicRouteVerified = false;
  const headers = (location) => {
    const parents = all.find((entry) => entry.node === location)?.parents;
    if (!parents || parents.some((node) => !["http", "server", "location"].includes(node.name)) ||
      all.filter(({ node }) => node.name === "location" && node.file === location.file && node.body === location.body).length !== 1) fail();
    let inherited = [];
    for (const scope of [...parents, location]) {
      const values = scope.children.filter((node) => node.name === "proxy_set_header");
      if (values.some((node) => node.children || node.args.length !== 2 || node.args[0].includes("$") || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(node.args[0]))) fail();
      if (values.length) inherited = values;
      if (scope === location && values.length) return [];
    }
    return inherited.map((node) => byPath.get(node.file).content.slice(node.start, node.body));
  };
  for (const server of servers) {
    if (!server.children) fail();
    const descendants = flattened(server.children).map((item) => item.node);
    const names = server.children.filter((node) => node.name === "server_name").flatMap((node) => node.args);
    // An unclassified regex/variable server name could win routing for a
    // protected hostname even without a recognized proxy_pass in its body.
    // Do not infer cohost separation from a failed literal-name comparison.
    if (names.some((name) => name !== "_" && !/^(?:\*\.)?[a-z0-9.-]+$/.test(name))) fail();
    const targets = descendants.filter((node) => node.name === "proxy_pass").flatMap((node) => {
      if (node.args.length !== 1 || node.args[0].includes("$")) fail();
      const match = node.args[0].match(/^https?:\/\/([^/]+)(?:\/.*)?$/); if (!match) fail();
      return upstreams.get(match[1]) || [match[1]];
    });
    const app = targets.some((value) => appTargets.includes(value)), kong = targets.some((value) => kongTargets.includes(value));
    const named = names.some((name) => protectedHosts.some((host) => covers(name, host)) || /(?:^|\.)faolla\.com$/.test(name));
    const unknown = targets.filter((value) => !appTargets.includes(value) && !kongTargets.includes(value));
    const cohost = p.id === "bt" && !app && !kong && !named && names.length && names.every((name) => name === "www.btaf.com") &&
      unknown.every((value) => value === "127.0.0.1:39962");
    if (unknown.length && !cohost) fail("production_maintenance_ingress_nginx_routing_unsupported");
    if (!app && !kong && !named) {
      if (descendants.some((node) => node.opaque) && (!names.length || names.includes("_") ||
        names.some((name) => !/^[a-z0-9.-]+$/.test(name) || protectedHosts.some((host) => covers(name, host))))) fail();
      continue;
    }
    if (descendants.some((node) => /(?:^|_)(?:lua|perl|js)(?:_|$)/.test(node.name) ||
      ["rewrite", "auth_request", "proxy_method"].includes(node.name))) fail();
    if (server.children.some((node) => node.name === "if" && (p.id !== "bt" || !wellKnownDeny(node)))) fail();
    hasApp ||= app; hasKong ||= kong;
    const listens = server.children.filter((node) => node.name === "listen");
    if (!names.length || names.some((name) => !/^(?:\*\.)?[a-z0-9.-]+$/.test(name) && name !== "_") || !listens.length) fail();
    const ports = listens.map((node) => {
      const match = node.args[0]?.match(/^(?:(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):)?([0-9]+)$/);
      const allowed = ["ssl", "http2", "default_server", "reuseport", "ipv6only=on", "ipv6only=off", ...(p.id === "bt" ? ["quic"] : [])];
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535 || node.args.slice(1).some((arg) => !allowed.includes(arg))) fail();
      return { port: Number(match[1]), tls: node.args.includes("ssl") || node.args.includes("quic"), quic: node.args.includes("quic") };
    });
    if (ports.some((item) => item.quic && !ports.some((other) => !other.quic && other.tls && other.port === item.port))) fail();
    const probeNames = new Set([...names.filter((name) => /^[a-z0-9.-]+$/.test(name) && name !== "_"),
      ...protectedHosts.filter((host) => names.some((name) => covers(name, host)))]);
    for (const name of probeNames) for (const listener of ports) probes.push(`${listener.tls ? "https" : "http"}://${name}:${listener.port}/`);
    if (names.some((name) => covers(name, route.hostname)) && kong && ports.some((listener) => listener.port === Number(route.port || 443) && listener.tls)) {
      if (descendants.some((node) => node.name === "try_files")) fail();
      const prefix = route.pathname.replace(/\/$/, ""), locations = server.children.filter((node) => node.name === "location");
      for (const suffix of ["/rest/v1/", "/rest/v1/pages", "/auth/v1/settings", "/auth/v1/token"]) {
        const uri = prefix + suffix;
        const exact = locations.filter((node) => node.args.length === 2 && node.args[0] === "=" && node.args[1] === uri);
        const prefixes = locations.filter((node) => (node.args.length === 1 || node.args.length === 2 && node.args[0] === "^~") &&
          node.args.at(-1).startsWith("/") && uri.startsWith(node.args.at(-1))).sort((a, b) => b.args.at(-1).length - a.args.at(-1).length);
        const location = exact[0] || prefixes[0];
        if (!location || exact.length > 1 || !exact.length && prefixes[1]?.args.at(-1) === location.args.at(-1) ||
            !exact.length && location.args[0] !== "^~" && locations.some((node) => ["~", "~*"].includes(node.args[0]))) fail();
        if (!location.children || location.children.some((node) => ["location", "return", "if", "rewrite", "auth_request", "try_files"].includes(node.name))) fail();
        const passes = location.children.filter((node) => node.name === "proxy_pass"); if (passes.length !== 1) fail();
        const target = passes[0].args[0].match(/^https?:\/\/([^/]+)/)?.[1];
        if (!(upstreams.get(target) || [target]).every((value) => kongTargets.includes(value))) fail();
        const replacement = passes[0].args[0].match(/^https?:\/\/[^/]+(\/.*)$/)?.[1];
        if ((replacement === undefined ? uri : replacement + uri.slice(location.args.at(-1).length)) !== suffix) fail();
        if (!controlLocations.some((node) => node.file === location.file && node.offset === location.body))
          controlLocations.push({ file: location.file, offset: location.body, inheritedHeaders: headers(location) });
      }
      publicRouteVerified = true;
    }
    selected.push({ file: server.file, offset: server.body });
  }
  if (!hasApp || !hasKong || !publicRouteVerified || !selected.length || new Set(selected.map((node) => `${node.file}:${node.offset}`)).size !== selected.length) fail("production_maintenance_ingress_nginx_routing_unsupported");
  const publicProbeUrls = [...new Set(probes)].sort(); if (!publicProbeUrls.length || publicProbeUrls.length > 16) fail();
  return { http: { file: http[0].file, offset: http[0].body }, selected, controlLocations, publicProbeUrls };
}
function processRows(d) {
  return output(d, "ps", ["-C", "nginx", "-o", "pid=,ppid=,uid=,args="]).trim().split(/\n/).map((line) => {
    const match = line.trim().match(/^([1-9][0-9]*)\s+([0-9]+)\s+([0-9]+)\s+(.+)$/);
    if (!match) fail(); return { pid: Number(match[1]), parent: Number(match[2]), uid: Number(match[3]), title: match[4] };
  });
}
function ticks(d, pid) {
  const value = d.readText(`/proc/${pid}/stat`);
  if (!text(value, 8192) || !value.startsWith(`${pid} (nginx) `)) fail();
  const start = value.slice(value.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
  if (!/^[1-9][0-9]*$/.test(start || "")) fail(); return start;
}
export function nginxMaster(d, rawProfile) {
  const hostNamespace = output(d, "readlink", ["/proc/1/ns/net"]).trim();
  if (!/^net:\[[1-9][0-9]*\]$/.test(hostNamespace)) fail();
  const masters = processRows(d).filter((row) => row.uid === 0 && row.title.startsWith("nginx: master process "))
    .filter((row) => output(d, "readlink", [`/proc/${row.pid}/ns/net`]).trim() === hostNamespace);
  if (masters.length !== 1) fail("production_maintenance_ingress_nginx_master_unsupported");
  const row = masters[0], startTicks = ticks(d, row.pid), executable = output(d, "readlink", [`/proc/${row.pid}/exe`]).trim();
  const p = rawProfile === undefined ? Object.values(PROFILES).find((item) => item.binary === executable) : profile(rawProfile);
  if (!p || executable !== p.binary) fail("production_maintenance_ingress_nginx_master_unsupported");
  const base = row.title.slice("nginx: master process ".length), initial = base.match(/^(\S+)(.*)$/);
  if (!initial || ![p.binary, "nginx"].includes(initial[1])) fail();
  let remaining = initial[2];
  if (remaining.endsWith(" -g daemon on; master_process on;")) remaining = remaining.slice(0, -" -g daemon on; master_process on;".length);
  const seen = new Set();
  while (remaining) {
    const option = remaining.match(/^ -(c|p) (\S+)(.*)$/);
    if (!option || seen.has(option[1]) || option[2].replace(/\/$/, "") !== (option[1] === "c" ? p.mainConfig : p.prefix)) fail();
    seen.add(option[1]); remaining = option[3];
  }
  if (ticks(d, row.pid) !== startTicks || output(d, "readlink", [`/proc/${row.pid}/ns/net`]).trim() !== hostNamespace ||
    output(d, "readlink", ["/proc/1/ns/net"]).trim() !== hostNamespace) fail();
  return { pid: row.pid, startTicks, executable, commandHash: hash(`${row.pid}:${row.parent}:${row.uid}:${row.title}:${hostNamespace}`) };
}
export function nginxWorkers(d, master) {
  const rows = processRows(d).filter((row) => row.parent === master.pid && row.title.startsWith("nginx: worker process"));
  if (!rows.length || rows.length > 256) fail("production_maintenance_ingress_nginx_workers_unverified");
  return rows.map((row) => {
    if (!/^nginx: worker process(?: is shutting down)?$/.test(row.title)) fail();
    return { pid: row.pid, startTicks: ticks(d, row.pid), shuttingDown: row.title.endsWith(" is shutting down") };
  });
}
export function captureNginx(d, capture, docker) {
  const master = nginxMaster(d), p = Object.values(PROFILES).find((item) => item.binary === master.executable);
  const version = output(d, p.binary, ["-V"], true);
  if (selectNginxProfile(version).id !== p.id) fail();
  const dump = output(d, p.binary, ["-T"], true);
  const paths = [...dump.matchAll(/^# configuration file ([^:\r\n]+):\s*$/gm)].map((match) => match[1]);
  if (!paths.length || paths.length > 64 || new Set(paths).size !== paths.length || paths.some((path) => !isNginxConfigPath(path, p))) fail();
  const files = paths.map((path) => d.readFile(path));
  if (new Set(files.map((file) => file.actualPath)).size !== files.length) fail();
  for (let i = 0; i < paths.length; i++) {
    const start = dump.indexOf("\n", dump.indexOf(`# configuration file ${paths[i]}:`)) + 1;
    const end = i + 1 < paths.length ? dump.indexOf(`# configuration file ${paths[i + 1]}:`, start) : dump.length;
    const section = dump.slice(start, end);
    if (!section.startsWith(files[i].content) || section.slice(files[i].content.length).trim().split(/\n/).some((line) => line && !line.startsWith("nginx:"))) fail();
  }
  const workers = nginxWorkers(d, master), plan = nginxPlan(dump, version, files, capture, docker, p);
  if (!eq(nginxMaster(d, p), master)) fail();
  return { profile: p.id, versionHash: hash(version), master,
    retiringWorkers: workers.map(({ pid, startTicks }) => ({ pid, startTicks })), files, plan };
}
export function checkNginxIncludeCoverage(proof, d) {
  const p = profile(proof.nginx.profile ?? "standard"), paths = proof.nginx.files.map((file) => file.requestedPath);
  for (const file of proof.nginx.files) for (const { node } of flattened(parseNginx(file.content, file.requestedPath))) {
    if (node.name !== "include") continue;
    const target = includeTarget(node, p), match = new RegExp("^" + target.split("*").map(escape).join("[^/]*") + "$");
    if (!eq(d.listIncludes(target), paths.filter((path) => match.test(path)).sort())) fail();
  }
}
