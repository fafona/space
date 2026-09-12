import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { captureIngress, planIngressInstallation, validateIngressProof, getIngressProbePlan, createIngressProbeUrl,
  installIngress, verifyIngress, restoreIngress } from "./production-maintenance-ingress.mjs";

// Synthetic-only host. No default process, filesystem, network or Docker
// dependency is used by these tests; they do not establish production readiness.
const INPUT = { appPort: 3000, publicSupabaseUrl: "https://db.example.test/", operationId: "11111111-2222-4333-8444-555555555555" };
const TOKEN = "a".repeat(64);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const ROOT = "/etc/nginx/nginx.conf", SITE = "/etc/nginx/sites-enabled/faolla.conf", FRAGMENT = "/etc/nginx/proxy/app.inc";
const BASE4 = ["-P INPUT ACCEPT", "-P FORWARD DROP", "-P OUTPUT ACCEPT", "-N DOCKER-USER", "-A FORWARD -j DOCKER-USER", "-A DOCKER-USER -j RETURN"];
const BASE6 = ["-P INPUT ACCEPT", "-P FORWARD DROP", "-P OUTPUT ACCEPT"];
const FAMILIES = { kong: "kong", db: "supabase/postgres", rest: "postgrest/postgrest", auth: "supabase/gotrue",
  realtime: "supabase/realtime", storage: "supabase/storage-api", meta: "supabase/postgres-meta", studio: "supabase/studio",
  functions: "supabase/edge-runtime", analytics: "supabase/logflare", vector: "timberio/vector", imgproxy: "darthsim/imgproxy", supavisor: "supabase/supavisor" };

function host() {
  const files = new Map([
    [ROOT, "# preserve root bytes\nevents {}\nhttp {\n include /etc/nginx/sites-enabled/*.conf;\n}\n"],
    [SITE, "# preserve site bytes\nserver { listen 443 ssl; server_name faolla.example.test *.example.test; location / { include /etc/nginx/proxy/app.inc; } }\n" +
      "server { listen 443 ssl; server_name db.example.test; location / { proxy_pass http://127.0.0.1:8000; } }\n" +
      "server { listen 888; server_name static.example.test; root /var/www/static; }\n"],
    [FRAGMENT, "# preserve fragment bytes\nproxy_pass http://127.0.0.1:3000;\n"],
  ]);
  const networkId = "d".repeat(64), bridge = "br-" + networkId.slice(0, 12);
  const rows = Object.entries(FAMILIES).map(([service, family], index) => ({ id: (index + 1).toString(16).padStart(64, "0"),
    name: "/supabase-" + service, image: family + ":test", state: "running", project: "synthetic_supabase", service, mode: "synthetic_network",
    networks: { synthetic_network: { IPAddress: `172.20.0.${index + 2}`, NetworkID: networkId, GlobalIPv6Address: "" } },
    ports: service === "kong" ? { "8000/tcp": [{ HostIp: "0.0.0.0", HostPort: "8000" }], "8443/tcp": [{ HostIp: "::", HostPort: "8443" }] } :
      service === "supavisor" ? { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "5432" }], "6543/tcp": [{ HostIp: "::", HostPort: "6543" }] } : {},
  }));
  const state = { files, private: new Map(), rows, rules4: [...BASE4], rules6: [...BASE6], mutations: [], requests: [],
    extraDump: [], version: "nginx version: nginx/1.26.0\nconfigure arguments: --with-http_realip_module --conf-path=/etc/nginx/nginx.conf",
    nft: { nftables: [{ metainfo: {} }] }, bridgeEnabled: "1", networkIPv6: false, failAt: null, failFetch: null,
    worker: 101, keepOldWorker: false, drainingWorker: null };
  const out = (stdout = "", stderr = "") => ({ stdout, stderr });
  const fact = (path) => ({ requestedPath: path, actualPath: path, content: files.get(path), mode: 0o644,
    uid: 0, gid: 0, link: null, parents: ["/etc/nginx:1:2", "/etc:1:1"] });
  function mutation(kind, data, action) {
    state.mutations.push({ kind, data });
    if (state.failAt?.(kind, data)) throw new Error("synthetic private failure");
    action?.();
  }
  const d = {
    captureNetwork: () => ({ version: 1,
      links: [{ index: 1, name: "lo", qdisc: "noqueue", master: null, kind: null }],
      qdiscs: [{ index: 1, kind: "noqueue", handle: 0, parent: 4294967295 }] }),
    readFile: (path) => { assert(files.has(path), "unexpected read"); return fact(path); },
    readText: (path) => path.startsWith("/proc/sys/net/bridge/") ? state.bridgeEnabled :
      /^\/proc\/[0-9]+\/stat$/.test(path) ? `${path.split("/")[2]} (nginx) ${Array.from({ length: 20 }, (_, i) => i === 19 ? path.split("/")[2] + "45" : "0").join(" ")}` : assert.fail("unexpected text read"),
    readPrivate: (path) => state.private.get(path) ?? null,
    listIncludes: (pattern) => {
      const match = new RegExp("^" + pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
      return [...files.keys(), ...state.extraDump.map(([path]) => path)].filter((path) => match.test(path)).sort();
    },
    createPrivate: (path, content) => mutation("create-private", path, () => { assert(!state.private.has(path)); state.private.set(path, content); }),
    writeExact: (file, expected, next) => mutation("write", file.requestedPath, () => {
      assert.equal(sha(files.get(file.requestedPath)), expected); files.set(file.requestedPath, next);
    }),
    probeHeaders: { apikey: "synthetic-" + "b".repeat(32), authorization: "Bearer synthetic-" + "b".repeat(32) },
    async fetch(url, options) {
      state.requests.push({ url, options });
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, new URL(url).protocol === "http:" ? "manual" : "error");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers["cache-control"], "no-cache, no-store");
      assert.equal(options.headers.pragma, "no-cache");
      assert(new URL(url).searchParams.has("faolla_maintenance_probe"));
      if (state.failFetch) return state.failFetch(url, options);
      const path = new URL(url).pathname;
      const allowed = options.headers["x-faolla-maintenance-control"] === TOKEN;
      if (allowed && path === "/rest/v1/") {
        assert.match(new URL(url).searchParams.get("faolla_maintenance_probe"), /^eq\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        return Response.json({ swagger: "2.0", paths: {} });
      }
      if (allowed && path === "/auth/v1/settings") return Response.json({ external: {}, disable_signup: true });
      return new Response("maintenance", { status: 503 });
    },
    run(command, args) {
      if (command === "/usr/sbin/nginx") {
        if (args[0] === "-V") return out("", state.version);
        if (args[0] === "-T") {
          const included = files.get(ROOT).includes("faolla-maintenance-") ? [...state.private] : [];
          return out([...files, ...included, ...state.extraDump].map(([path, content]) => `# configuration file ${path}:\n${content}\n`).join(""));
        }
        mutation(args[0] === "-t" ? "syntax" : "reload", args.join(" "));
        if (args[0] === "-s") {
          if (state.keepOldWorker) state.drainingWorker = state.worker;
          state.worker += 1;
        }
        return out("", "nginx: configuration file test is successful");
      }
      if (command === "ps") return out(`100 1 0 nginx: master process /usr/sbin/nginx\n${state.worker} 100 33 nginx: worker process\n` +
        (state.drainingWorker ? `${state.drainingWorker} 100 33 nginx: worker process is shutting down\n` : ""));
      if (command === "readlink") return out(args[0].endsWith("/ns/net") ? "net:[1234]\n" : "/usr/sbin/nginx\n");
      if (command === "ip") return out(JSON.stringify([{ ifname: bridge, linkinfo: { info_kind: "bridge" } }]));
      if (command === "nft") return out(JSON.stringify(state.nft));
      if (command === "docker") {
        assert.deepEqual(args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
        if (args[2] === "ps") return out(rows.map((row) => JSON.stringify(row.id)).join("\n"));
        if (args[2] === "inspect") return out(rows.map((row) => JSON.stringify(row)).join("\n"));
        if (args[2] === "network") return out(JSON.stringify({ Id: networkId, Driver: "bridge", Scope: "local", EnableIPv6: state.networkIPv6,
          Containers: Object.fromEntries(rows.map((row) => [row.id, {}])) }));
      }
      if (["iptables", "ip6tables"].includes(command)) {
        if (args[0] === "--version") return out(`${command} v1.8.10 (legacy)\n`);
        assert.deepEqual(args.slice(0, 2), ["-w", "5"]);
        const rules = command === "iptables" ? state.rules4 : state.rules6;
        const [op, chain, ...rest] = args.slice(2);
        if (op === "-S") return out(rules.join("\n"));
        mutation(command, args.join(" "), () => {
          assert(!["-F", "--flush", "-P"].includes(op));
          if (op === "-N") { assert(!rules.includes(`-N ${chain}`)); rules.push(`-N ${chain}`); }
          else if (op === "-A") rules.push(`-A ${chain} ${rest.join(" ")}`);
          else if (op === "-I") {
            assert.equal(rest.shift(), "1"); const line = `-A ${chain} ${rest.join(" ")}`;
            const at = rules.findIndex((item) => item.startsWith(`-A ${chain} `)); rules.splice(at < 0 ? rules.length : at, 0, line);
          } else if (op === "-D") {
            const at = rules.indexOf(`-A ${chain} ${rest.join(" ")}`); assert(at >= 0); rules.splice(at, 1);
          } else if (op === "-X") {
            assert(!rules.some((line) => line.startsWith(`-A ${chain} `) || line.endsWith(`-j ${chain}`)));
            const at = rules.indexOf(`-N ${chain}`); assert(at >= 0); rules.splice(at, 1);
          } else assert.fail("unexpected firewall command");
        });
        return out();
      }
      assert.fail(`unexpected executable ${command}`);
    },
  };
  return { state, d, capture: () => captureIngress(INPUT, d) };
}

test("REST uses a valid PostgREST filter nonce without reusing a cache key or changing other probes", () => {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  for (const kind of ["rest", "auth", "blocked"]) {
    const urls = Array.from({ length: 4 }, () => createIngressProbeUrl("https://db.example.test/rest/v1/?existing=1", kind));
    assert.equal(new Set(urls).size, 4);
    for (const url of urls) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://db.example.test"); assert.equal(parsed.pathname, "/rest/v1/");
      assert.equal(parsed.searchParams.get("existing"), "1");
      assert.match(parsed.searchParams.get("faolla_maintenance_probe"), new RegExp("^" + (kind === "rest" ? "eq\\." : "") + uuid + "$"));
    }
  }
  assert.throws(() => createIngressProbeUrl("https://db.example.test/", "unknown"));
});

test("capture is read-only; plan preserves every original byte except exact insertions and private token stays private", () => {
  const h = host(), proof = h.capture(), original = JSON.stringify(proof);
  assert.equal(h.state.mutations.length, 0);
  const planned = planIngressInstallation(proof, TOKEN);
  assert.equal(JSON.stringify(proof), original);
  assert.equal(planned.nginx.plan.selected.length, 2);
  assert.equal(planned.installation.files.find((file) => file.path === FRAGMENT).modified, h.state.files.get(FRAGMENT));
  for (const file of planned.installation.files) assert(!file.modified.includes(TOKEN));
  assert(planned.installation.privateContent.includes(TOKEN));
  assert.match(planned.installation.privateContent, /\$realip_remote_addr/);
  assert(planned.installation.privateContent.includes("https:db\\\\.example\\\\.test:443:POST:/auth/v1/token:password"));
  const publicInfo = getIngressProbePlan(planned);
  assert.equal(publicInfo.controlAllowlist.length, 4);
  assert.equal(publicInfo.controlAllowlist.filter((entry) => entry.method === "POST")[0].url, "https://db.example.test/auth/v1/token?grant_type=password");
  assert(!JSON.stringify(publicInfo).includes(TOKEN));
});

test("generated long map keys are fully anchored case-sensitive literal regexes without global hash changes", () => {
  const h = host(), planned = planIngressInstallation(h.capture(), TOKEN);
  const content = planned.installation.privateContent;
  assert.equal(content.includes("map_hash_bucket_size"), false);
  // Decode only the escaped backslashes that Nginx's quoted token lexer removes.
  const keys = [...content.matchAll(/"~((?:\\.|[^"\\])*)"\s+1;/g)]
    .map((entry) => entry[1].replace(/\\\\/g, "\\"));
  assert.equal(keys.length, 5);
  const matchers = keys.map((key) => {
    assert(key.startsWith("\\A") && key.endsWith("\\z"));
    return new RegExp("^(?:" + key.slice(2, -2) + ")$(?![\\s\\S])");
  });
  assert(matchers[0].test(TOKEN));
  for (const wrong of [TOKEN.toUpperCase(), "x" + TOKEN, TOKEN + "x", TOKEN + "\n"]) assert(!matchers[0].test(wrong));
  for (const entry of planned.installation.allowlist) {
    const url = new URL(entry.url), expected = `https:${url.hostname}:443:${entry.method}:${url.pathname}:${entry.method === "POST" ? "password" : ""}`;
    assert.equal(matchers.slice(1).filter((test) => test.test(expected)).length, 1);
    for (const wrong of [expected.replace("db.example", "dbXexample"), expected + "x", expected + "\n", "x" + expected]) {
      assert.equal(matchers.slice(1).some((test) => test.test(wrong)), false);
    }
  }
});

test("install, real-probe projection, exact restore and same-operation reinstall are idempotent", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN), original = new Map(h.state.files);
  await installIngress(proof, TOKEN, h.d);
  assert.equal((await verifyIngress(proof, h.d)).activeHttpVerified, true);
  const writes = h.state.mutations.filter((row) => row.kind === "write").length;
  await installIngress(proof, TOKEN, h.d);
  assert.equal(h.state.mutations.filter((row) => row.kind === "write").length, writes);
  await restoreIngress(proof, h.d);
  assert.deepEqual(h.state.files, original); assert.deepEqual(h.state.rules4, BASE4); assert.deepEqual(h.state.rules6, BASE6);
  assert.equal(h.state.private.size, 1, "retain root-only include for fail-held reinstall");
  await installIngress(proof, TOKEN, h.d);
  assert.equal((await verifyIngress(proof, h.d)).configurationVerified, true);
});

test("firewall covers IPv4/IPv6 host ports before accept, known DNAT destinations, and only exact reply pairs", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  await installIngress(proof, TOKEN, h.d);
  for (const rules of [h.state.rules4, h.state.rules6]) {
    assert.match(rules.find((row) => row.startsWith("-A INPUT ")), /-j FAOM_I_/);
    for (const port of [3000, 5432, 6543, 8000, 8443]) assert(rules.some((row) => row.includes(`! -i lo -p tcp -m tcp --dport ${port} -j DROP`)));
  }
  assert.match(h.state.rules4.find((row) => row.startsWith("-A DOCKER-USER ")), /-j FAOM_F_/);
  const forward = h.state.rules4.filter((row) => row.startsWith("-A FAOM_F_"));
  assert.equal(forward.filter((row) => row.includes("--ctdir REPLY")).length, 4);
  assert.equal(forward.filter((row) => row.includes("--ctstate ESTABLISHED")).length, 4);
  assert.equal(forward.filter((row) => row.endsWith("-j DROP")).length, 13);
  assert(forward.filter((row) => row.includes("--ctdir REPLY")).every((row) => row.includes(" -s ") && row.includes(" -d ") && row.includes(" -i br-") && row.includes(" -o br-")));
  assert(!h.state.mutations.some((row) => /flush|sudo|sysctl|restart/.test(row.data)));
});

test("installation is structural only; missing probe credentials cannot certify held", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  const installed = await installIngress(proof, TOKEN, { ...h.d, probeHeaders: undefined });
  assert.equal(h.state.requests.length, 0);
  await assert.rejects(verifyIngress(installed, { ...h.d, probeHeaders: undefined }), /probe_credentials_unavailable/);
});

for (const kind of ["configuration", "firewall", "identity"]) test(`third-party ${kind} changes are never overwritten`, async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  if (kind === "configuration") h.state.files.set(SITE, h.state.files.get(SITE) + "# external edit\n");
  if (kind === "firewall") h.state.rules4.push("-A INPUT -p tcp -j ACCEPT");
  if (kind === "identity") h.state.rows[0].image = "kong:changed";
  await assert.rejects(installIngress(proof, TOKEN, h.d));
  assert.equal(h.state.mutations.length, 0);
});

test("a partial same-operation config installation can resume but a failed reload never certifies held", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  h.state.failAt = (kind, path) => kind === "write" && path === SITE;
  await assert.rejects(installIngress(proof, TOKEN, h.d));
  assert.notEqual(h.state.files.get(ROOT), proof.nginx.files[0].content);
  h.state.failAt = (kind) => kind === "reload";
  await assert.rejects(installIngress(proof, TOKEN, h.d));
  assert(h.state.rules4.some((row) => row.startsWith("-A FAOM_F_")));
  h.state.failAt = null;
  await installIngress(proof, TOKEN, h.d);
});

test("restore refuses third-party changed configuration and does not flush rules", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  await installIngress(proof, TOKEN, h.d);
  h.state.files.set(SITE, h.state.files.get(SITE) + "# external change\n");
  const before = h.state.mutations.length;
  await assert.rejects(restoreIngress(proof, h.d));
  assert.equal(h.state.mutations.length, before);
  assert(h.state.rules4.some((row) => row.startsWith("-A FAOM_F_")));
});

for (const change of [
  (h) => { h.state.version = h.state.version.replace("--with-http_realip_module", ""); },
  (h) => { h.state.files.set(SITE, h.state.files.get(SITE).replace("443 ssl", "443 ssl proxy_protocol")); },
  (h) => { h.state.files.set(FRAGMENT, "proxy_pass http://$unknown;\n"); },
  (h) => { h.state.files.set(FRAGMENT, "proxy_pass http://127.0.0.1:888;\n"); },
  (h) => { h.state.files.set(ROOT, h.state.files.get(ROOT) + "stream { server { listen 444; proxy_pass 127.0.0.1:8000; } }\n"); },
  (h) => { h.state.files.set(SITE, h.state.files.get(SITE).replace("proxy_pass http://127.0.0.1:8000", "proxy_pass http://127.0.0.1:8000/unreviewed")); },
  (h) => { h.state.nft.nftables.push({ table: { name: "unknown" } }); },
  (h) => { h.state.bridgeEnabled = "0"; },
  (h) => { h.state.networkIPv6 = true; },
  (h) => { h.state.rows[3].mode = "host"; },
  (h) => { h.state.rules4.splice(4, 0, "-A FORWARD -j ACCEPT"); },
]) test("unsupported topology fails closed during read-only prepare", () => {
  const h = host(); change(h); assert.throws(h.capture); assert.equal(h.state.mutations.length, 0);
});

test("public Web proxy and non-HTTPS URL are refused before inspection", () => {
  const h = host();
  for (const publicSupabaseUrl of ["https://faolla.example.test/api/supabase-proxy", "http://db.example.test/"])
    assert.throws(() => captureIngress({ ...INPUT, publicSupabaseUrl }, h.d), /public_url_unsupported/);
  assert.equal(h.state.mutations.length, 0);
});

test("fixed Kong bridge address is recognized, not an unverified DNS or recursive proxy", () => {
  const h = host(); h.state.files.set(SITE, h.state.files.get(SITE).replace("127.0.0.1:8000", "172.20.0.2:8000"));
  assert.equal(h.capture().nginx.plan.selected.length, 2);
});

test("proof tampering cannot broaden the control allowlist or replace another file", () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  for (const change of [
    (p) => { p.installation.allowlist[0].url = "https://evil.example.test/"; },
    (p) => { p.installation.files[0].modified += "# injected"; p.installation.files[0].modifiedHash = sha(p.installation.files[0].modified); },
    (p) => { p.installation.privateContent += "map $uri $backdoor { default 1; }"; p.installation.privateHash = sha(p.installation.privateContent); },
    (p) => { p.nginx.plan.selected.pop(); },
  ]) { const altered = structuredClone(proof); change(altered); assert.throws(() => validateIngressProof(altered)); }
  assert.throws(() => planIngressInstallation(proof, "b".repeat(64)));
});

test("correct files/rules alone are insufficient: public 200, redirect, false JSON and token-wide bypass all reject", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  await installIngress(proof, TOKEN, h.d);
  for (const response of [
    () => new Response("not held", { status: 200 }),
    () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test/" } }),
    (url, options) => options.headers["x-faolla-maintenance-control"] ? Response.json({ synthetic: "not upstream" }) : new Response(null, { status: 503 }),
  ]) { h.state.failFetch = response; await assert.rejects(verifyIngress(proof, h.d), /http_unverified/); }
});

test("only one exact credential-free edge HTTPS upgrade can precede a required 503", async () => {
  const h = host(); h.state.files.set(SITE, h.state.files.get(SITE).replace("listen 443 ssl;", "listen 80; listen 443 ssl;"));
  const proof = planIngressInstallation(h.capture(), TOKEN); await installIngress(proof, TOKEN, h.d);
  const baseFetch = h.d.fetch;
  for (const status of [301, 308]) {
    h.state.failFetch = null;
    const requests = [];
    const fetch = (url, options) => {
      const parsed = new URL(url); requests.push({ url, options });
      if (parsed.protocol === "http:") {
        assert.equal(options.headers["x-faolla-maintenance-control"], undefined);
        assert.equal(options.redirect, "manual"); parsed.protocol = "https:";
        return Promise.resolve(new Response(null, { status, headers: { location: parsed.href } }));
      }
      assert.equal(options.redirect, "error"); return baseFetch(url, options);
    };
    assert.equal((await verifyIngress(proof, { ...h.d, fetch })).activeHttpVerified, true);
    assert(requests.some((request) => request.url.startsWith("http:")));
  }
  for (const alter of [
    (url) => { url.hostname = "other.example.test"; }, (url) => { url.pathname = "/elsewhere"; },
    (url) => { url.search = ""; }, (url) => { url.hash = "extra"; },
    (url) => { url.username = "user"; }, (url) => { url.port = "8443"; },
  ]) {
    const fetch = (url, options) => {
      const target = new URL(url);
      if (target.protocol !== "http:") return baseFetch(url, options);
      target.protocol = "https:"; alter(target);
      return Promise.resolve(new Response(null, { status: 301, headers: { location: target.href } }));
    };
    await assert.rejects(verifyIngress(proof, { ...h.d, fetch }), /http_unverified/);
  }
  for (const status of [200, 302, 307]) {
    const fetch = (url, options) => new URL(url).protocol === "http:" ?
      Promise.resolve(new Response(null, { status, headers: { location: url.replace("http:", "https:") } })) : baseFetch(url, options);
    await assert.rejects(verifyIngress(proof, { ...h.d, fetch }), /http_unverified/);
  }
});

test("network bypass proof drift is refused before modifying config or firewall", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN), network = h.d.captureNetwork();
  h.d.captureNetwork = () => ({ ...network, links: network.links.map((link) => ({ ...link, name: "changed" })) });
  await assert.rejects(installIngress(proof, TOKEN, h.d));
  assert.equal(h.state.mutations.length, 0);
});

test("unexpected included file prevents claiming verification", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  await installIngress(proof, TOKEN, h.d);
  h.state.extraDump.push(["/etc/nginx/sites-enabled/unreviewed.conf", "server {}\n"]);
  await assert.rejects(verifyIngress(proof, h.d));
});

test("new wildcard include before install is refused before the first mutation", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  h.state.extraDump.push(["/etc/nginx/sites-enabled/unreviewed.conf", "server {}\n"]);
  await assert.rejects(installIngress(proof, TOKEN, h.d));
  assert.equal(h.state.mutations.length, 0);
});

test("fenced verification proves ingress only, without falsely claiming upstream services", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  const options = { ...h.d, probeControlServices: false };
  await installIngress(proof, TOKEN, options);
  h.state.requests.length = 0;
  const result = await verifyIngress(proof, options);
  assert.equal(result.activeHttpVerified, true); assert.equal(result.controlServicesVerified, false);
  assert(!h.state.requests.some((request) => request.options.headers["x-faolla-maintenance-control"] && new URL(request.url).pathname !== "/auth/v1/token"));
  h.state.failFetch = () => new Response(null, { status: 200 });
  await assert.rejects(verifyIngress(proof, options), /http_unverified/);
});

test("headers and stalled body have a bounded timeout even if transport ignores abort", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  await installIngress(proof, TOKEN, h.d);
  h.state.failFetch = () => new Promise(() => {});
  await assert.rejects(verifyIngress(proof, { ...h.d, probeTimeoutMs: 2 }), /http_unverified/);
  h.state.failFetch = (url, options) => !options.headers["x-faolla-maintenance-control"] || new URL(url).pathname === "/auth/v1/token" ?
    new Response(null, { status: 503 }) : new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), { headers: { "content-type": "application/json" } });
  await assert.rejects(verifyIngress(proof, { ...h.d, probeTimeoutMs: 2 }), /http_unverified/);
});

test("structural install does not wait for old Websocket workers but held verification must drain them", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  h.state.keepOldWorker = true;
  const installed = await installIngress(proof, TOKEN, h.d);
  assert.equal(h.state.requests.length, 0);
  await assert.rejects(verifyIngress(installed, { ...h.d, workerDrainTimeoutMs: 2 }), /old_workers_not_drained/);
  h.state.drainingWorker = null;
  await verifyIngress(installed, h.d);
});

test("reinstall returns updated retiring-worker identities for caller persistence before held verification", async () => {
  const h = host(), proof = planIngressInstallation(h.capture(), TOKEN);
  const first = await installIngress(proof, TOKEN, h.d);
  await restoreIngress(first, h.d);
  const second = await installIngress(first, TOKEN, h.d);
  assert(second.nginx.retiringWorkers.length > first.nginx.retiringWorkers.length);
  await verifyIngress(second, h.d);
});

function controlLocationBody(planned) {
  const file = planned.installation.files.find((entry) => entry.path === SITE);
  const body = file.modified.match(/server_name db\.example\.test;\s*(?:proxy_set_header[^;]+;\s*)*location \/ \{([^}]+)\}/)?.[1];
  assert(body, "expected exact synthetic control location");
  return body;
}
function headerDirectives(source) {
  return [...source.matchAll(/proxy_set_header\s+([A-Za-z0-9-]+)\s+("[^"\n]*"|[^;\s]+)\s*;/g)]
    .map((match) => ({ name: match[1].toLowerCase(), value: match[2].replace(/^"|"$/g, "") }));
}
function projectedUpstreamHeaders(directives, incoming) {
  // Pure model of the explicitly covered Nginx empty-value suppression rule,
  // not a claim that a real Nginx instance was run by this unit test.
  const outgoing = { ...incoming };
  for (const directive of directives) {
    const value = directive.value.startsWith("$http_") ? incoming[directive.value.slice(6).replaceAll("_", "-")] : directive.value;
    if (value === "") delete outgoing[directive.name]; else outgoing[directive.name] = value;
  }
  return outgoing;
}

for (const level of ["none", "http", "server", "location"]) test(`control header is stripped at exact location while ${level} header behavior is preserved`, () => {
  const h = host();
  const headers = 'proxy_set_header Authorization "$http_authorization"; proxy_set_header apikey $http_apikey; proxy_set_header Cookie $http_cookie; proxy_set_header X-Existing "kept";';
  if (level === "http") h.state.files.set(ROOT, h.state.files.get(ROOT).replace("http {", `http { ${headers}`));
  if (level === "server") {
    h.state.files.set(ROOT, h.state.files.get(ROOT).replace("http {", "http { proxy_set_header X-Overridden parent;"));
    h.state.files.set(SITE, h.state.files.get(SITE).replace("server_name db.example.test;", `server_name db.example.test; ${headers}`));
  }
  if (level === "location") {
    h.state.files.set(ROOT, h.state.files.get(ROOT).replace("http {", "http { proxy_set_header X-Overridden parent;"));
    h.state.files.set(SITE, h.state.files.get(SITE).replace("location / { proxy_pass http://127.0.0.1:8000;", `location / { ${headers} proxy_pass http://127.0.0.1:8000;`));
  }
  const planned = planIngressInstallation(h.capture(), TOKEN);
  assert.equal(planned.nginx.plan.controlLocations.length, 1, "one shared exact context for the four control paths");
  const body = controlLocationBody(planned);
  assert.equal((body.match(/proxy_set_header X-Faolla-Maintenance-Control "";/g) || []).length, 1);
  assert(!body.includes("X-Overridden"), "do not revive an overridden ancestor setting");
  if (level !== "none") for (const directive of headers.match(/proxy_set_header[^;]+;/g)) assert(body.includes(directive), "retain exact original directive text and values");
  const incoming = { authorization: "Bearer synthetic", apikey: "synthetic", cookie: "synthetic_cookie", "x-faolla-maintenance-control": TOKEN };
  const expected = projectedUpstreamHeaders(headerDirectives(level === "none" ? "" : headers), incoming);
  delete expected["x-faolla-maintenance-control"];
  assert.deepEqual(projectedUpstreamHeaders(headerDirectives(body), incoming), expected);
  assert.equal(incoming["x-faolla-maintenance-control"], TOKEN, "incoming header is untouched for rewrite map evaluation");
  assert.match(planned.installation.privateContent, /map \$http_x_faolla_maintenance_control/);
  assert.equal(planned.nginx.plan.controlLocations[0].inheritedHeaders.length, ["http", "server"].includes(level) ? 4 : 0);
});

test("every distinct exact/static control location gets its own upstream strip, including existing custom headers", () => {
  const h = host();
  const locations = ["/rest/v1/", "/rest/v1/pages", "/auth/v1/settings", "/auth/v1/token"]
    .map((path) => `location = ${path} { proxy_set_header X-Existing keep; proxy_pass http://127.0.0.1:8000; }`).join("\n");
  h.state.files.set(SITE, h.state.files.get(SITE).replace("location / { proxy_pass http://127.0.0.1:8000; }", locations));
  const planned = planIngressInstallation(h.capture(), TOKEN);
  assert.equal(planned.nginx.plan.controlLocations.length, 4);
  const modified = planned.installation.files.find((entry) => entry.path === SITE).modified;
  assert.equal((modified.match(/proxy_set_header X-Faolla-Maintenance-Control "";/g) || []).length, 4);
  assert.equal((modified.match(/proxy_set_header X-Existing keep;/g) || []).length, 4);
});

test("headers supplied by a location include remain local and their shared file is not rewritten", () => {
  const h = host(), path = "/etc/nginx/proxy/headers.inc";
  const original = 'proxy_set_header Authorization "$http_authorization";\nproxy_set_header Cookie $http_cookie;\n';
  h.state.files.set(path, original);
  h.state.files.set(SITE, h.state.files.get(SITE).replace("location / { proxy_pass http://127.0.0.1:8000;", `location / { include ${path}; proxy_pass http://127.0.0.1:8000;`));
  const planned = planIngressInstallation(h.capture(), TOKEN);
  assert.deepEqual(planned.nginx.plan.controlLocations[0].inheritedHeaders, []);
  assert.equal(planned.installation.files.find((entry) => entry.path === path).modified, original);
  assert.match(controlLocationBody(planned), /proxy_set_header X-Faolla-Maintenance-Control "";/);
});

test("uncertain header-name inheritance and tampered strip plans are rejected before mutations", () => {
  const h = host();
  h.state.files.set(ROOT, h.state.files.get(ROOT).replace("http {", "http { proxy_set_header $unverified_name value;"));
  assert.throws(h.capture);
  assert.equal(h.state.mutations.length, 0);
  const clean = host(), planned = planIngressInstallation(clean.capture(), TOKEN);
  for (const change of [
    (proof) => { proof.nginx.plan.controlLocations = []; },
    (proof) => { proof.nginx.plan.controlLocations[0].inheritedHeaders = ["proxy_set_header Authorization erased;"]; },
    (proof) => {
      const file = proof.installation.files.find((entry) => entry.path === SITE);
      file.modified = file.modified.replace('proxy_set_header X-Faolla-Maintenance-Control "";', ""); file.modifiedHash = sha(file.modified);
    },
  ]) { const forged = structuredClone(planned); change(forged); assert.throws(() => validateIngressProof(forged)); }
});
