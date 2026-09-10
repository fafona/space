import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  captureNginx, checkNginxIncludeCoverage, getNginxPrivateIncludePath, getNginxProfile,
  isNginxConfigPath, nginxMaster, nginxPlan, nginxWorkers, parseNginx, selectNginxProfile,
} from "./production-maintenance-nginx-profile.mjs";

const U = "12345678-1234-4234-8234-123456789abc";
const SECRET = "SYNTHETIC_SECRET_DO_NOT_PRINT";
const capture = { appPort: 3000, operationId: U, publicSupabaseUrl: "https://faolla.com/" };
const docker = { containers: [{ service: "kong", address: "172.18.0.2" }] };
const denied = (error) => error instanceof Error && /^production_maintenance_ingress_[a-z0-9_]+$/.test(error.message) && !error.message.includes(SECRET);
const deny = 'if ($uri ~ "^/\\.well-known/.*\\.(php|jsp|py|js|css|lua|ts|go|zip|tar\\.gz|rar|7z|sql|bak)$") { return 403; }';
function fixture(id = "bt") {
  const p = getNginxProfile(id), files = new Map(), calls = [];
  const site = id === "bt" ? "/www/server/panel/vhost/nginx/faolla.conf" : "/etc/nginx/sites-enabled/faolla.conf";
  const include = site.slice(0, site.lastIndexOf("/")) + "/*.conf";
  files.set(p.mainConfig, `events {}\n${id === "bt" ? "stream { log_format tcp_format '$remote_addr'; include /www/server/panel/vhost/nginx/tcp/*.conf; }\n" : ""}http {\n${id === "bt" ? "lua_package_path '/www/server/nginx/lib/lua/?.lua;;';\n" : ""}include ${include};\n}\n`);
  files.set(site, `server {\n listen 80; listen 443 ssl; ${id === "bt" ? "listen 443 quic reuseport;" : ""}\n server_name www.faolla.com *.faolla.com faolla.com;\n proxy_set_header Host $host; proxy_set_header Authorization $http_authorization;\n ${id === "bt" ? deny : ""}\n location / { proxy_pass http://127.0.0.1:3000; }\n location ^~ /rest/v1/ { proxy_pass http://127.0.0.1:8000; }\n location ^~ /auth/v1/ { proxy_set_header Connection ""; proxy_pass http://127.0.0.1:8000; }\n ${id === "bt" ? "location ~ /purge(/.*) { return 404; } location ~ /\\.well-known/ { allow all; }" : ""}\n}\n`);
  let version = `nginx version: nginx/1.26.3\nconfigure arguments: --with-http_realip_module ${id === "bt" ? "--prefix=/www/server/nginx --with-stream --add-module=/synthetic/lua" : "--conf-path=/etc/nginx/nginx.conf"}`;
  const state = { rows: [
    { pid: 950, parent: 1, uid: 0, title: `nginx: master process ${p.binary}${id === "bt" ? " -c " + p.mainConfig : ""}` },
    { pid: 1515110, parent: 950, uid: 1000, title: "nginx: worker process" },
    { pid: 889643, parent: 889622, uid: 100, title: "nginx: master process /usr/local/openresty/nginx/sbin/nginx" },
    { pid: 889644, parent: 889643, uid: 100, title: "nginx: worker process" },
  ], namespace: "net:[4026531992]", executable: p.binary, ticks: "12345", extraDump: "", listExtra: [] };
  const fact = (path) => ({ requestedPath: path, actualPath: path, content: files.get(path), mode: 0o600, uid: 0, gid: 0, link: null, parents: [] });
  const list = (pattern) => {
    const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*") + "$");
    return [...files.keys(), ...state.listExtra].filter((path) => regex.test(path)).sort();
  };
  const d = {
    readFile: (path) => { calls.push(["file", path]); assert(files.has(path)); return fact(path); },
    listIncludes: list,
    readText: (path) => { calls.push(["text", path]); const pid = path.split("/")[2];
      return `${pid} (nginx) ${Array.from({ length: 20 }, (_, i) => i === 19 ? state.ticks : "0").join(" ")}`; },
    run: (command, args) => {
      calls.push([command, ...args]);
      const out = (stdout, stderr = "") => ({ stdout, stderr });
      if (command === "ps") return out(state.rows.map((row) => `${row.pid} ${row.parent} ${row.uid} ${row.title}`).join("\n"));
      if (command === "readlink") {
        if (args[0] === "/proc/1/ns/net" || args[0] === "/proc/950/ns/net") return out(state.namespace);
        if (args[0].endsWith("/ns/net")) return out("net:[99999]");
        if (args[0] === "/proc/950/exe") return out(state.executable);
        assert.fail("an unrelated executable must not be inspected");
      }
      if (command === p.binary && args.join() === "-V") return out("", version);
      if (command === p.binary && args.join() === "-T") return out([...files].map(([path, content]) => `# configuration file ${path}:\n${content}`).join("\n") + state.extraDump,
        "nginx: configuration file test is successful");
      assert.fail("unexpected command or actuation");
    },
  };
  return { p, site, files, d, state, calls, fact, version: () => version, setVersion: (value) => { version = value; },
    plan: () => nginxPlan([...files.values()].join("\n"), version, [...files.keys()].map(fact), capture, docker, id),
    capture: () => captureNginx(d, capture, docker) };
}

test("profiles are closed constants and fixed configuration roots do not admit arbitrary www paths", () => {
  assert(Object.isFrozen(getNginxProfile("bt")));
  assert(Object.isFrozen(getNginxProfile("bt").configRoots));
  assert.equal(isNginxConfigPath("/www/server/panel/vhost/rewrite/faolla.conf", "bt"), true);
  assert.equal(isNginxConfigPath("/www/server/panel/vhost/nginx/a.conf", "standard"), false);
  for (const path of ["/www/server/panel/vhost/cert/private.key", "/www/server/nginx-other/conf/a", "/www/server/nginx/conf/../a", "/etc/passwd"]) assert.equal(isNginxConfigPath(path), false);
  assert.throws(() => getNginxProfile("other"), denied);
  assert.throws(() => getNginxProfile({ id: "bt" }), denied);
  assert.equal(getNginxPrivateIncludePath(U, "bt"), `/www/server/nginx/conf/faolla-maintenance-${U}.inc`);
  assert.throws(() => getNginxPrivateIncludePath("../secret", "bt"), denied);
});

test("profile selection accepts only the two installed configuration contracts with realip", () => {
  for (const id of ["standard", "bt"]) assert.equal(selectNginxProfile(fixture(id).version()).id, id);
  for (const version of ["--prefix=/www/server/nginx", "--with-http_realip_module --prefix=/other",
    "--with-http_realip_module --prefix=/www/server/nginx --conf-path=/etc/other.conf",
    "--with-http_realip_module --prefix=/www/server/nginx --prefix=/other"]) assert.throws(() => selectNginxProfile(version), denied);
});

for (const id of ["standard", "bt"]) test(`${id} capture binds fixed binary, host master and workers without touching container processes`, () => {
  const f = fixture(id), result = f.capture();
  assert.equal(result.profile, id); assert.equal(result.master.pid, 950);
  assert.deepEqual(result.retiringWorkers, [{ pid: 1515110, startTicks: "12345" }]);
  assert.equal(result.plan.controlLocations.length, 2);
  assert(result.plan.publicProbeUrls.includes("https://launch.faolla.com:443/"));
  assert(!result.plan.publicProbeUrls.includes("http://faolla.com:443/"));
  assert(!f.calls.some((call) => call[0] === "nginx" || call.some((arg) => /88964[34].*(?:exe|stat)/.test(arg))));
  assert(f.calls.some((call) => call[0] === f.p.binary && call[1] === "-T"));
});

test("same-UID container masters are excluded by host network namespace, not by resolving their executable", () => {
  const f = fixture(); f.state.rows[2].uid = 0;
  assert.equal(f.capture().master.pid, 950);
  assert(!f.calls.some((call) => call[1] === "/proc/889643/exe"));
});

test("master profile mixing, unreviewed arguments and duplicate host masters fail", () => {
  for (const change of [
    (f) => { f.state.executable = "/usr/local/nginx/sbin/nginx"; },
    (f) => { f.state.rows[0].title += " -s reload"; },
    (f) => { f.state.rows[0].title += " -c /etc/other.conf"; },
    (f) => { f.state.rows.push({ ...f.state.rows[0] }); },
    (f) => { f.setVersion(fixture("standard").version()); },
  ]) { const f = fixture(); change(f); assert.throws(f.capture, denied); }
});

test("network namespace or process generation drift invalidates the master observation", () => {
  for (const kind of ["namespace", "ticks"]) {
    const f = fixture(), original = f.d.readText; let reads = 0;
    f.d.readText = (path) => { const result = original(path); if (++reads === 1) f.state[kind] = kind === "namespace" ? "net:[999]" : "999"; return result; };
    assert.throws(() => nginxMaster(f.d), denied);
  }
});

test("workers of other masters cannot contaminate the host worker proof", () => {
  const f = fixture(); f.state.rows[3].title = "nginx: worker process unexpected container arguments";
  assert.equal(nginxWorkers(f.d, nginxMaster(f.d)).length, 1);
  f.state.rows[1].title += " unexpected";
  assert.throws(() => nginxWorkers(f.d, nginxMaster(f.d)), denied);
});

test("empty stream includes remain covered and adding an ingress route is rejected", () => {
  const f = fixture(), result = f.capture(); checkNginxIncludeCoverage({ nginx: result }, f.d);
  f.state.listExtra.push("/www/server/panel/vhost/nginx/tcp/late.conf");
  assert.throws(() => checkNginxIncludeCoverage({ nginx: result }, f.d), denied);
  f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("stream {", "stream { server { listen 1234; proxy_pass 127.0.0.1:8000; }"));
  assert.throws(f.plan, denied);
});

test("unselected cohost Lua is lexically opaque while selected Faolla Lua is always rejected", () => {
  const f = fixture(), cohost = "/www/server/panel/vhost/nginx/forall.conf";
  const body = `set_by_lua_block $x { local a = { value = "} ${SECRET}" }; -- }\n local b = [=[server { fake; }]=]; --[=[ } ]=]\n return a.value }`;
  f.files.set(cohost, `server { listen 443 ssl; server_name www.forall.xin; location /.well-known/ { ${body} } }\n`);
  const result = f.plan(); assert.equal(result.selected.length, 1);
  assert.equal(parseNginx(f.files.get(cohost), cohost)[0].children.at(-1).children[0].opaque.length, 64);
  f.files.set(f.site, f.files.get(f.site).replace("location / {", `location / { ${body}`));
  assert.throws(f.plan, denied);
});

test("opaque Lua cannot hide an adjacent selected server or an unmatched delimiter", () => {
  const f = fixture(), cohost = "/www/server/panel/vhost/nginx/forall.conf";
  for (const body of ["set_by_lua_block $x { local a='unterminated }", "set_by_lua_block $x { --[=[ missing close }"]) {
    f.files.set(cohost, `server { server_name www.forall.xin; location / { ${body} } }`); assert.throws(f.plan, denied);
  }
  f.files.set(cohost, "server { server_name www.forall.xin; location / { set_by_lua_block $x { return '}' } } } server { server_name faolla.com; location / { access_by_lua_block { return 1; } } }");
  assert.throws(f.plan, denied);
});

test("global/init/inherited scripts and aliases overlapping Faolla are not opaque exemptions", () => {
  for (const change of [
    (f) => f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("http {", "http { init_by_lua_block { return 1; }")),
    (f) => f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("http {", "http { set_by_lua_block $x { return 1 }")),
    (f) => f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("?.lua;;", "$dynamic")),
    ...["*.faolla.com", ".faolla.com", "_", "launch.faolla.com"].map((name) => (f) => f.files.set("/www/server/panel/vhost/nginx/cohost.conf",
      `server { listen 443 ssl; server_name ${name}; location / { set_by_lua_block $x { return 1 } } }`)),
  ]) { const f = fixture(); change(f); assert.throws(f.plan, denied); }
});

test("cohost proxy exception is confined to the observed host and exact loopback service", () => {
  const f = fixture(), cohost = "/www/server/panel/vhost/nginx/btaf.conf";
  f.files.set(cohost, "server { listen 443 ssl; server_name www.btaf.com; location / { proxy_pass https://127.0.0.1:39962/; } }");
  assert.equal(f.plan().selected.length, 1);
  for (const replacement of ["https://127.0.0.1:39963/", "https://unknown.internal/", "https://$dynamic/"]) {
    f.files.set(cohost, `server { listen 443 ssl; server_name www.btaf.com; location / { proxy_pass ${replacement}; } }`);
    assert.throws(f.plan, denied);
  }
});

test("control static caret prefixes suppress sibling regex but ordinary prefixes cannot claim that", () => {
  const f = fixture(); assert.equal(f.plan().controlLocations.length, 2);
  f.files.set(f.site, f.files.get(f.site).replace("location ^~ /rest/v1/", "location /rest/v1/"));
  assert.throws(f.plan, denied);
});

test("exact control locations can be verified independently of regex siblings", () => {
  const f = fixture();
  f.files.set(f.site, f.files.get(f.site).replace("location ^~ /rest/v1/ { proxy_pass http://127.0.0.1:8000; }",
    "location = /rest/v1/ { proxy_pass http://127.0.0.1:8000; } location = /rest/v1/pages { proxy_pass http://127.0.0.1:8000; }"));
  assert.equal(f.plan().controlLocations.length, 3);
});

test("nested or duplicate locations, control redirects, URI remapping and dynamic upstreams are rejected", () => {
  for (const change of [
    (s) => s.replace("location ^~ /rest/v1/ {", "location ^~ /rest/v1/ { location /rest/v1/pages { return 200; }"),
    (s) => s.replace("location ^~ /auth/v1/", "location ^~ /rest/v1/"),
    (s) => s.replace("location ^~ /rest/v1/ {", "location ^~ /rest/v1/ { return 302 /elsewhere;"),
    (s) => s.replace("proxy_pass http://127.0.0.1:8000;", "proxy_pass http://127.0.0.1:8000/;"),
    (s) => s.replace("proxy_pass http://127.0.0.1:8000;", "proxy_pass http://$upstream;"),
    (s) => s.replace("location ^~ /rest/v1/ {", "location ^~ /rest/v1/ { auth_request /elsewhere;"),
  ]) { const f = fixture(); f.files.set(f.site, change(f.files.get(f.site))); assert.throws(f.plan, denied); }
});

test("only the exact observed well-known extension rejection may occur at selected server level", () => {
  const f = fixture(); assert.equal(f.plan().selected.length, 1);
  for (const condition of [deny.replace("return 403", "return 200"), deny.replace("well-known", "rest"),
    deny.replace("$uri", "$request_uri"), deny.replace("~", "!~"), "if ($uri) { return 403; }"]) {
    f.files.set(f.site, fixture().files.get(f.site).replace(deny, condition)); assert.throws(f.plan, denied);
  }
});

test("quic needs a TLS stream listener for real TCP probes and never produces http port443", () => {
  const f = fixture(); assert(f.plan().publicProbeUrls.every((url) => !url.startsWith("http:") || !url.includes(":443")));
  f.files.set(f.site, f.files.get(f.site).replace("listen 443 ssl;", "")); assert.throws(f.plan, denied);
});

test("dynamic header values are preserved only in the private plan with Nginx inheritance", () => {
  const f = fixture(), plan = f.plan();
  const inherited = plan.controlLocations.find((location) => location.inheritedHeaders.length);
  assert(inherited.inheritedHeaders.includes("proxy_set_header Host $host;"));
  assert(inherited.inheritedHeaders.includes("proxy_set_header Authorization $http_authorization;"));
  assert(plan.controlLocations.some((location) => location.inheritedHeaders.length === 0));
  f.files.set(f.site, f.files.get(f.site).replace("proxy_set_header Host", "proxy_set_header $header")); assert.throws(f.plan, denied);
});

test("include roots, relative config prefix, duplicate sections and private glob collision remain closed", () => {
  for (const change of [
    (f) => f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("include /www/server/panel/vhost/nginx/*.conf", "include /etc/other/*.conf")),
    (f) => f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("include /www/server/panel/vhost/nginx/*.conf", "include /www/server/nginx/conf/*")),
    (f) => { f.state.extraDump = `\n# configuration file ${f.site}:\n${f.files.get(f.site)}`; },
  ]) { const f = fixture(); change(f); assert.throws(f.capture, denied); }
  const f = fixture(); f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("include /www/server/panel/vhost/nginx/*.conf", "include local.conf"));
  f.files.set(f.p.configPrefix + "/local.conf", f.files.get(f.site)); f.files.delete(f.site);
  assert.equal(f.plan().selected.length, 1);
});

test("file dump mismatches and raw command failures cannot expose secret text", () => {
  const f = fixture(), read = f.d.readFile;
  f.d.readFile = (path) => ({ ...read(path), content: SECRET }); assert.throws(f.capture, denied);
  const g = fixture(); g.d.run = () => ({ stdout: SECRET, stderr: SECRET }); assert.throws(g.capture, denied);
});

test("cohost conditional Lua stays opaque and cannot be admitted in selected or inherited scopes", () => {
  const f = fixture(), cohost = "/www/server/panel/vhost/nginx/cohost.conf";
  const body = 'if ($request_uri) { set_by_lua_block $value { return "{}" } }';
  f.files.set(cohost, `server { listen 80; server_name other.example.test; ${body} }`);
  assert.equal(f.plan().selected.length, 1);
  f.files.set(cohost, `server { listen 80; server_name extra.faolla.com; ${body} }`);
  assert.throws(f.plan, denied);
  f.files.delete(cohost);
  f.files.set(f.p.mainConfig, f.files.get(f.p.mainConfig).replace("http {", `http { ${body}`));
  assert.throws(f.plan, denied);
});

test("unselected regex or variable server names cannot silently shadow protected hosts", () => {
  for (const name of ['~^faolla\\.com$', '$hostname', '~^other\\.example$']) {
    const f = fixture();
    f.files.set("/www/server/panel/vhost/nginx/shadow.conf", `server { listen 443 ssl; server_name ${name}; root /synthetic; }`);
    assert.throws(f.plan, denied);
  }
});

test("CRLF configuration is parsed without changing original bytes or insertion offsets", () => {
  const f = fixture();
  for (const [path, content] of f.files) f.files.set(path, content.replace(/\r?\n/g, "\r\n"));
  const proof = f.capture();
  assert(proof.files.some((file) => file.content.includes("\r\n")));
  for (const point of [proof.plan.http, ...proof.plan.selected, ...proof.plan.controlLocations])
    assert.equal(f.files.get(point.file)[point.offset - 1], "{");
  assert.equal(proof.plan.selected.length, 1);
});

test("module has no execution, signal or write capability outside injected read-only commands", () => {
  const source = readFileSync(new URL("./production-maintenance-nginx-profile.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /spawnSync|execSync|writeFile|renameSync|process\.kill|\["-s",\s*"reload"\]/);
  assert.match(source, /O_NOFOLLOW \| constants\.O_NONBLOCK/);
});
