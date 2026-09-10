import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// CI-only data-plane acceptance, never a production maintenance entrypoint.
// No network/firewall mutation is available until a fresh network AND PID
// namespace has been independently checked. No host nft/iptables write occurs.
const HERE = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(HERE));
const OPERATION = "11111111-2222-4333-8444-555555555555";
const TOKEN = "a".repeat(64); // Synthetic fixture only, never a production token.
const ROLES = ["kong", "db", "rest", "auth", "realtime", "storage", "meta", "studio", "functions", "analytics", "vector", "imgproxy", "supavisor"];
const FAMILIES = ["kong", "supabase/postgres", "postgrest/postgrest", "supabase/gotrue", "supabase/realtime", "supabase/storage-api", "supabase/postgres-meta", "supabase/studio", "supabase/edge-runtime", "supabase/logflare", "timberio/vector", "darthsim/imgproxy", "supabase/supavisor"];
const BRIDGE = "faolla_br0";
const NET_ID = /^net:\[[1-9][0-9]*\]$/;
const STAGES = new Set(["guards", "namespace_launch", "namespace_setup", "network_capture", "baseline", "nft_install", "input_dataplane",
  "bridge_dataplane", "nginx_fixture", "restore", "cleanup"]);
const BINARIES = { nft: "/usr/sbin/nft", ip: "/usr/sbin/ip", iptables: "/usr/sbin/iptables", ip6tables: "/usr/sbin/ip6tables",
  "iptables-save": "/usr/sbin/iptables-save", "ip6tables-save": "/usr/sbin/ip6tables-save", ebtables: "/usr/sbin/ebtables",
  "ebtables-save": "/usr/sbin/ebtables-save", curl: "/usr/bin/curl", openssl: "/usr/bin/openssl", nginx: "/usr/sbin/nginx",
  nsenter: "/usr/bin/nsenter", unshare: "/usr/bin/unshare" };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = () => { throw new Error("ingress_acceptance_failed"); };
const pause = (ms) => new Promise((accept) => setTimeout(accept, ms));
let stage = "guards";

export function validateIngressAcceptanceInvocation({ platform, env, argv, pid, uid, netns }) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.FAOLLA_INGRESS_REAL_ACCEPTANCE !== "1" ||
      !Array.isArray(argv) || !NET_ID.test(netns ?? "")) throw new Error("ingress_acceptance_opt_in_required");
  if (argv.length === 0) return { isolated: false };
  if (argv.length !== 2 || argv[0] !== "--isolated" || !NET_ID.test(argv[1]) ||
      argv[1] === netns || pid !== 1 || uid !== 0) throw new Error("ingress_acceptance_namespace_required");
  return { isolated: true, parentNetns: argv[1] };
}

export function ingressAcceptanceTopology() {
  const networkId = "d".repeat(64);
  return { project: "synthetic_supabase", networkId, bridge: BRIDGE,
    containers: ROLES.map((service, index) => ({ id: String(index + 1).padStart(64, "0"), name: "/supabase-" + service,
      service, image: FAMILIES[index] + ":fixture", address: `172.30.0.${index + 2}`, networkId,
      networkName: "synthetic_bridge", publishedPorts: service === "kong" ? [8000, 8443] : service === "supavisor" ? [5432, 6543] : [] })) };
}

const SERVER_SOURCE = `const http=require('node:http');
const ports=JSON.parse(process.argv[1]); let ready=0;
for(const port of ports) http.createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({ok:true,controlHeaderPresent:Object.hasOwn(req.headers,'x-faolla-maintenance-control'),
    authorization:req.headers.authorization||null,apikey:req.headers.apikey||null,cookie:req.headers.cookie||null}));
}).listen(port,'::',()=>{if(++ready===ports.length)process.stdout.write('READY\\n');});
setTimeout(()=>process.exit(2),180000).unref();`;

async function runIsolated(parentNetns) {
  const netns = readlinkSync("/proc/self/ns/net");
  const assertIsolated = () => {
    if (process.pid !== 1 || process.getuid() !== 0 || !NET_ID.test(netns) || netns === parentNetns ||
        readlinkSync("/proc/self/ns/net") !== netns) fail();
  };
  assertIsolated();
  const fixture = mkdtempSync("/tmp/faolla-ingress-acceptance-");
  chmodSync(fixture, 0o700);
  const fixtureIdentity = lstatSync(fixture);
  const children = [], endpoints = new Map();
  const environment = { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" };
  let groups = 0;
  const result = (command, args, options = {}) => {
    assertIsolated();
    const executable = BINARIES[command]; if (!executable) fail();
    return spawnSync(executable, args, { encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 2_097_152,
      cwd: fixture, env: environment, shell: false, windowsHide: true, ...options });
  };
  const run = (command, args, options = {}) => {
    const answer = result(command, args, options);
    if (answer.error || answer.signal || answer.status !== 0 || typeof answer.stdout !== "string" || typeof answer.stderr !== "string") fail();
    return { stdout: answer.stdout, stderr: answer.stderr };
  };
  const namespaceOf = (child) => {
    if (child.exitCode !== null || child.signalCode !== null || !Number.isSafeInteger(child.pid) || child.pid <= 1) fail();
    const value = readlinkSync(`/proc/${child.pid}/ns/net`);
    if (!NET_ID.test(value) || value === netns || value === parentNetns) fail();
    return value;
  };
  async function startServer(ports, separate = false) {
    assertIsolated();
    const args = ["-e", SERVER_SOURCE, JSON.stringify(ports)];
    const child = separate ? spawn(BINARIES.unshare, ["--net", "--", process.execPath, ...args],
      { cwd: fixture, env: environment, shell: false, stdio: ["ignore", "pipe", "pipe"] }) :
      spawn(process.execPath, args, { cwd: fixture, env: environment, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let stdout = "", stderr = "";
    child.stdout.on("data", (bytes) => { stdout += bytes; if (stdout.length > 64) child.kill("SIGKILL"); });
    child.stderr.on("data", (bytes) => { stderr += bytes; if (stderr.length > 4096) child.kill("SIGKILL"); });
    const deadline = Date.now() + 5000;
    while (stdout !== "READY\n") {
      if (stderr || child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) fail();
      await pause(10);
    }
    if (separate) namespaceOf(child);
    return child;
  }
  function inEndpoint(name, command, args) {
    assertIsolated();
    const endpoint = endpoints.get(name); if (!endpoint || namespaceOf(endpoint.child) !== endpoint.netns || !BINARIES[command]) fail();
    return run("nsenter", ["--target", String(endpoint.child.pid), "--net", "--", BINARIES[command], ...args]);
  }
  async function endpoint(name, index, address, external = false) {
    const child = await startServer([18080], true);
    endpoints.set(name, { child, netns: namespaceOf(child), address });
    const host = `fh${index}`, peer = `fp${index}`;
    run("ip", ["link", "add", host, "type", "veth", "peer", "name", peer]);
    run("ip", ["link", "set", peer, "netns", String(child.pid)]);
    if (external) {
      run("ip", ["address", "add", "10.200.0.1/24", "dev", host]);
      run("ip", ["-6", "address", "add", "fd42:200::1/64", "dev", host, "nodad"]);
    } else run("ip", ["link", "set", host, "master", BRIDGE]);
    run("ip", ["link", "set", host, "up"]);
    inEndpoint(name, "ip", ["link", "set", "lo", "up"]);
    inEndpoint(name, "ip", ["link", "set", peer, "name", "eth0"]);
    inEndpoint(name, "ip", ["address", "add", `${address}/24`, "dev", "eth0"]);
    if (external) inEndpoint(name, "ip", ["-6", "address", "add", "fd42:200::2/64", "dev", "eth0", "nodad"]);
    inEndpoint(name, "ip", ["link", "set", "eth0", "up"]);
    inEndpoint(name, "ip", ["route", "add", "default", "via", external ? "10.200.0.1" : "172.30.0.1"]);
  }
  function request(source, url, { blocked = false, headers = [], method = "GET", resolveHost = null } = {}) {
    const args = ["--disable", "--silent", "--show-error", "--noproxy", "*", "--connect-timeout", "1", "--max-time", "1",
      "--request", method, "--write-out", "\n%{http_code}"];
    if (url.startsWith("https:")) args.push("--insecure"); // Only this generated self-signed synthetic listener.
    if (resolveHost) args.push("--resolve", resolveHost);
    for (const header of headers) args.push("--header", header);
    args.push(url);
    let answer;
    if (source === null) answer = result("curl", args);
    else {
      const entry = endpoints.get(source); if (!entry || namespaceOf(entry.child) !== entry.netns) fail();
      answer = result("nsenter", ["--target", String(entry.child.pid), "--net", "--", BINARIES.curl, ...args]);
    }
    if (answer.error || answer.signal || typeof answer.stdout !== "string" || answer.stdout.length > 65536) fail();
    if (blocked) { assert.equal(answer.status, 28, "a DROP must time out, not merely fail to find a listener"); return null; }
    assert.equal(answer.status, 0, "synthetic listener did not complete a request");
    const newline = answer.stdout.lastIndexOf("\n");
    const status = Number(answer.stdout.slice(newline + 1));
    assert.ok(Number.isSafeInteger(status) && status >= 100 && status <= 599);
    return { status, body: answer.stdout.slice(0, newline) };
  }
  const ok = (source, url) => { assert.equal(request(source, url).status, 200); };
  const group = () => { groups++; };
  try {
    stage = "namespace_setup";
    const tools = Object.fromEntries(Object.entries(BINARIES).map(([key, value]) => [key, realpathSync(value)]));
    assert.equal(Object.keys(tools).length, Object.keys(BINARIES).length);
    run("ip", ["link", "set", "lo", "up"]);
    run("ip", ["link", "add", BRIDGE, "type", "bridge"]);
    run("ip", ["address", "add", "172.30.0.1/24", "dev", BRIDGE]);
    run("ip", ["link", "set", BRIDGE, "up"]);
    // This sysctl is network-namespace local. Bridge hooks must already be on;
    // no host/global module, sysctl or firewall setting is repaired by this test.
    assertIsolated(); writeFileSync("/proc/sys/net/ipv4/ip_forward", "1\n");
    for (const name of ["bridge-nf-call-iptables", "bridge-nf-call-ip6tables"]) {
      assert.equal(readFileSync(`/proc/sys/net/bridge/${name}`, "utf8").trim(), "1");
    }
    await endpoint("external", 0, "10.200.0.2", true);
    const docker = ingressAcceptanceTopology();
    for (const [index, role] of ["kong", "rest", "auth", "db", "functions"].entries()) {
      await endpoint(role, index + 1, docker.containers.find((row) => row.service === role).address);
    }
    await startServer([3000, 8000, 8443, 5432, 6543]);
    const address = (role) => docker.containers.find((row) => row.service === role).address;
    const url = (role) => `http://${address(role)}:18080/`;
    group();

    // Real RTM_GETQDISC and ip-link sampling, not a synthetic noqueue proof.
    // The production read-only helper executes only in this verified namespace.
    stage = "network_capture";
    const networkHelper = await import("./production-maintenance-network-bypass.mjs");
    assertIsolated();
    const network = networkHelper.captureNetworkBypass();
    assertIsolated();

    stage = "baseline";
    // Actual compatibility tables plus independent early ACCEPT hooks. A later
    // private DROP must still win without flushing or rewriting these tables.
    run("iptables", ["-A", "INPUT", "-j", "ACCEPT"]);
    run("iptables", ["-A", "FORWARD", "-j", "ACCEPT"]);
    run("ip6tables", ["-A", "INPUT", "-j", "ACCEPT"]);
    run("ebtables", ["-A", "FORWARD", "-j", "ACCEPT"]);
    run("nft", ["-f", "-"], { input: "add table inet fixture_firewalld\nadd chain inet fixture_firewalld input { type filter hook input priority 10; policy accept; }\nadd chain inet fixture_firewalld forward { type filter hook forward priority 10; policy accept; }\nadd rule inet fixture_firewalld input counter accept\nadd rule inet fixture_firewalld forward counter accept\n" });
    for (const port of [3000, 8000, 8443, 5432, 6543]) ok("external", `http://10.200.0.1:${port}/`);
    ok("external", "http://[fd42:200::1]:3000/");
    for (const from of ["kong", "rest", "auth", "db", "functions"]) for (const to of ["kong", "rest", "auth", "db"]) {
      if (from !== to) ok(from, url(to));
    }
    const firewall = await import("./production-maintenance-nft.mjs");
    const d = { run, readText: (path) => {
      assertIsolated();
      if (!/^\/proc\/sys\/net\/bridge\/bridge-nf-call-ip(?:6)?tables$/.test(path)) fail();
      return readFileSync(path, "utf8");
    } };
    const frozen = firewall.captureNftFirewall(d);
    const plan = firewall.planNftFirewall({ input: { operationId: OPERATION, appPort: 3000 }, docker });
    group();

    stage = "nft_install";
    assert.deepEqual(firewall.installNftFirewall(frozen, plan, d), { verified: true });
    assert.deepEqual(firewall.verifyNftFirewall(frozen, plan, d), { verified: true });
    group();
    stage = "input_dataplane";
    for (const port of [3000, 8000, 8443, 5432, 6543]) request("external", `http://10.200.0.1:${port}/`, { blocked: true });
    request("external", "http://[fd42:200::1]:3000/", { blocked: true });
    ok(null, "http://127.0.0.1:3000/");
    group();
    stage = "bridge_dataplane";
    const allowed = new Set(["kong:rest", "kong:auth", "rest:db", "auth:db"]);
    for (const pair of allowed) { const [from, to] = pair.split(":"); ok(from, url(to)); }
    for (const [from, to] of [["rest", "kong"], ["auth", "kong"], ["db", "rest"], ["db", "auth"],
      ["kong", "db"], ["functions", "kong"], ["functions", "rest"], ["functions", "auth"], ["functions", "db"]]) {
      request(from, url(to), { blocked: true });
    }
    // Successful HTTP on every allowed direction also proves its reverse TCP
    // reply survives; the NEW reverse requests above must nevertheless drop.
    firewall.verifyNftFirewall(frozen, plan, d); group();

    stage = "nginx_fixture";
    await verifyNginxFixture({ fixture, frozen, docker, network, run, request, children, assertIsolated });
    group();

    stage = "restore";
    assert.deepEqual(firewall.restoreNftFirewall(frozen, plan, d), { restored: true });
    assert.deepEqual(firewall.captureNftFirewall(d), frozen, "restoration must leave every baseline table unchanged");
    for (const port of [3000, 8000, 8443, 5432, 6543]) ok("external", `http://10.200.0.1:${port}/`);
    ok("external", "http://[fd42:200::1]:3000/");
    ok("functions", url("db")); ok("db", url("rest"));
    assertIsolated();
    assert.equal(networkHelper.verifyNetworkBypass(network), true);
    assertIsolated();
    group();
    return { ok: true, groups, namespaceIsolated: true, nftVersion: frozen.nftVersion, iptablesVersion: frozen.version4,
      planSha256: hash(plan.script), nginxEvidence: "synthetic_config_and_requests_only" };
  } finally {
    const priorStage = stage;
    stage = "cleanup";
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const deadline = Date.now() + 2000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await pause(10);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      const finalDeadline = Date.now() + 2000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < finalDeadline) await pause(10);
      if (child.exitCode === null && child.signalCode === null) fail();
    }
    assertIsolated();
    const observed = lstatSync(fixture);
    if (realpathSync(fixture) !== fixture || dirname(fixture) !== "/tmp" || !fixture.startsWith("/tmp/faolla-ingress-acceptance-") ||
        !observed.isDirectory() || observed.isSymbolicLink() || observed.dev !== fixtureIdentity.dev || observed.ino !== fixtureIdentity.ino) fail();
    rmSync(fixture, { recursive: true });
    stage = priorStage;
  }
}

export async function planIngressAcceptanceNginx({ fixture, frozen, docker, network }) {
  const profile = await import("./production-maintenance-nginx-profile.mjs");
  const ingress = await import("./production-maintenance-ingress.mjs");
  const root = "/etc/nginx/nginx.conf", certificate = join(fixture, "certificate.pem"), key = join(fixture, "key.pem");
  const tls = `ssl_certificate ${certificate}; ssl_certificate_key ${key};`;
  const content = `pid ${fixture}/nginx.pid; error_log ${fixture}/nginx-error.log; events {} http { access_log off;
server { listen 18444 ssl; server_name app.example.test; ${tls} location / { proxy_pass http://127.0.0.1:3000; } }
server { listen 18443 ssl; server_name guard.example.test; ${tls} location / {
proxy_set_header Authorization $http_authorization; proxy_set_header apikey $http_apikey; proxy_set_header Cookie $http_cookie;
proxy_pass http://127.0.0.1:8000; } }
server { listen 18445 ssl; server_name cohost.example.test; ${tls} location / { return 200 "cohost"; } }
}\n`;
  const version = "nginx version: nginx/1.26.3\nconfigure arguments: --with-http_realip_module --conf-path=/etc/nginx/nginx.conf";
  const files = [{ requestedPath: root, actualPath: root, content, mode: 0o644, uid: 0, gid: 0, link: null, parents: ["/etc/nginx:1:2", "/etc:1:1"] }];
  const input = { appPort: 3000, publicSupabaseUrl: "https://guard.example.test:18443/", operationId: OPERATION };
  const nginx = { profile: "standard", versionHash: hash(version),
    master: { pid: 100, startTicks: "12345", executable: "/usr/sbin/nginx", commandHash: "b".repeat(64) },
    retiringWorkers: [{ pid: 101, startTicks: "12346" }], files,
    plan: profile.nginxPlan(content, version, files, input, docker, "standard") };
  // Only planner input is synthetic. The generated maps and location guards
  // below are parsed and served by a real nginx in the isolated namespace.
  const proof = { version: 1, input, nginx, docker, firewall: frozen, network, installation: null };
  return ingress.planIngressInstallation(proof, TOKEN);
}

async function verifyNginxFixture({ fixture, frozen, docker, network, run, request, children, assertIsolated }) {
  const root = "/etc/nginx/nginx.conf", certificate = join(fixture, "certificate.pem"), key = join(fixture, "key.pem");
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certificate,
    "-days", "1", "-subj", "/CN=guard.example.test"]);
  const planned = await planIngressAcceptanceNginx({ fixture, frozen, docker, network });
  const include = join(fixture, "maintenance.inc"), conf = join(fixture, "nginx.conf");
  assert.equal(planned.installation.files.length, 1);
  assert.equal(planned.installation.files[0].path, root);
  writeFileSync(include, planned.installation.privateContent, { mode: 0o600, flag: "wx" });
  const source = planned.installation.files[0].modified;
  assert.equal(source.split(planned.installation.privatePath).length - 1, 1);
  writeFileSync(conf, source.replace(planned.installation.privatePath, include), { mode: 0o600, flag: "wx" });
  run("nginx", ["-t", "-p", fixture + "/", "-c", conf]);
  assertIsolated();
  const child = spawn(BINARIES.nginx, ["-p", fixture + "/", "-c", conf, "-g", "daemon off; master_process off;"],
    { cwd: fixture, env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" }, shell: false, stdio: "ignore" });
  children.push(child);
  const deadline = Date.now() + 5000;
  while (true) {
    try { if (request(null, "https://127.0.0.1:18443/").status === 200) break; } catch { /* bounded listener startup */ }
    if (child.exitCode !== null || child.signalCode !== null || Date.now() >= deadline) fail();
    await pause(20);
  }
  const external = (path, options = {}) => request("external", `https://guard.example.test:18443${path}`,
    { resolveHost: "guard.example.test:18443:10.200.0.1", ...options });
  for (const path of ["/", "/rest/v1/", "/auth/v1/settings"]) assert.equal(external(path).status, 503);
  assert.equal(external("/", { headers: ["X-Forwarded-For: 127.0.0.1"] }).status, 503);
  const headers = [`X-Faolla-Maintenance-Control: ${TOKEN}`, "Authorization: Bearer synthetic", "apikey: synthetic", "Cookie: synthetic=value"];
  for (const [method, path] of [["GET", "/rest/v1/"], ["GET", "/rest/v1/pages"], ["GET", "/auth/v1/settings"], ["POST", "/auth/v1/token?grant_type=password"]]) {
    const answer = external(path, { method, headers }); assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.body), { ok: true, controlHeaderPresent: false,
      authorization: "Bearer synthetic", apikey: "synthetic", cookie: "synthetic=value" });
  }
  for (const [method, path] of [["POST", "/rest/v1/pages"], ["DELETE", "/rest/v1/pages"], ["GET", "/rest/v1/other"],
    ["POST", "/auth/v1/token?grant_type=refresh_token"], ["POST", "/auth/v1/token"], ["GET", "/unrelated"]]) {
    assert.equal(external(path, { method, headers }).status, 503);
  }
  assert.equal(request("external", "https://app.example.test:18444/", { headers,
    resolveHost: "app.example.test:18444:10.200.0.1" }).status, 503);
  assert.equal(request("external", "https://cohost.example.test:18445/", {
    resolveHost: "cohost.example.test:18445:10.200.0.1" }).status, 200);
}

export async function main() {
  const args = process.argv.slice(2);
  const checked = validateIngressAcceptanceInvocation({ platform: process.platform, env: process.env, argv: args,
    pid: process.pid, uid: process.getuid?.(), netns: process.platform === "linux" ? readlinkSync("/proc/self/ns/net") : null });
  if (checked.isolated) return runIsolated(checked.parentNetns);
  stage = "namespace_launch";
  const parentNetns = readlinkSync("/proc/self/ns/net");
  const result = spawnSync("/usr/bin/sudo", ["--non-interactive", "/usr/bin/env", "GITHUB_ACTIONS=true", "FAOLLA_INGRESS_REAL_ACCEPTANCE=1",
    "PATH=/usr/sbin:/usr/bin:/sbin:/bin", "/usr/bin/unshare", "--net", "--mount", "--pid", "--fork",
    "--kill-child=KILL", "--mount-proc", "--", process.execPath, HERE, "--isolated", parentNetns], {
    cwd: ROOT, encoding: "utf8", timeout: 180000, killSignal: "SIGKILL", maxBuffer: 65536,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", GITHUB_ACTIONS: "true", FAOLLA_INGRESS_REAL_ACCEPTANCE: "1" },
    shell: false, windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== "" || readlinkSync("/proc/self/ns/net") !== parentNetns) {
    try {
      const detail = JSON.parse(result.stderr);
      if (detail && Object.keys(detail).sort().join(",") === "error,stage" && detail.error === "ingress_acceptance_failed" && STAGES.has(detail.stage)) stage = detail.stage;
    } catch { /* Never reveal subprocess stderr or response bodies. */ }
    fail();
  }
  const report = JSON.parse(result.stdout);
  if (!report || Object.keys(report).sort().join(",") !== "groups,iptablesVersion,namespaceIsolated,nftVersion,nginxEvidence,ok,planSha256" ||
      report.ok !== true || report.namespaceIsolated !== true || report.groups !== 7 ||
      typeof report.nftVersion !== "string" || !/^nftables v(?:0\.9\.3|1\.0\.[0-9]+)(?: \([^\r\n]{1,80}\))?$/.test(report.nftVersion) ||
      typeof report.iptablesVersion !== "string" || !/^iptables v1\.8\.[0-9]+ \(nf_tables\)$/.test(report.iptablesVersion) ||
      report.nginxEvidence !== "synthetic_config_and_requests_only" || !/^[0-9a-f]{64}$/.test(report.planSha256)) fail();
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(await main()) + "\n"); }
  catch (error) {
    const code = ["ingress_acceptance_opt_in_required", "ingress_acceptance_namespace_required"].includes(error?.message)
      ? error.message : "ingress_acceptance_failed";
    process.stderr.write(JSON.stringify({ error: code, stage }) + "\n"); process.exitCode = 1;
  }
}
