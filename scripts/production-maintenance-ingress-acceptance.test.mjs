import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ingressAcceptanceTopology, planIngressAcceptanceNginx, readIngressAcceptanceBridgeState, validateIngressAcceptanceInvocation } from "./production-maintenance-ingress-acceptance.mjs";
import { captureNftFirewall, planNftFirewall } from "./production-maintenance-nft.mjs";

const script = fileURLToPath(new URL("./production-maintenance-ingress-acceptance.mjs", import.meta.url));
const source = readFileSync(script, "utf8");
const base = () => ({ platform: "linux", env: { GITHUB_ACTIONS: "true", FAOLLA_INGRESS_REAL_ACCEPTANCE: "1" },
  argv: [], pid: 123, uid: 1001, netns: "net:[100]" });

test("ingress acceptance is opt-in CI only and arbitrary CLI targets cannot select a host namespace", () => {
  assert.deepEqual(validateIngressAcceptanceInvocation(base()), { isolated: false });
  for (const patch of [{ platform: "win32" }, { env: {} }, { env: { GITHUB_ACTIONS: "false", FAOLLA_INGRESS_REAL_ACCEPTANCE: "1" } },
    { env: { GITHUB_ACTIONS: "true", FAOLLA_INGRESS_REAL_ACCEPTANCE: "0" } }, { argv: ["--host"] },
    { argv: ["--isolated", "net:[100]"] }, { argv: ["--isolated", "net:[99]"], pid: 2, uid: 0 },
    { argv: ["--isolated", "net:[99]"], pid: 1, uid: 1001 }, { argv: ["--isolated", "net:[99]", "extra"], pid: 1, uid: 0 }]) {
    assert.throws(() => validateIngressAcceptanceInvocation({ ...base(), ...patch }), /ingress_acceptance_(?:opt_in|namespace)_required/);
  }
  assert.deepEqual(validateIngressAcceptanceInvocation({ ...base(), argv: ["--isolated", "net:[99]"], pid: 1, uid: 0 }),
    { isolated: true, parentNetns: "net:[99]" });
});

test("real default CLI refuses before tools, namespaces, fixture files or listeners are started", () => {
  for (const env of [{}, { GITHUB_ACTIONS: "false", FAOLLA_INGRESS_REAL_ACCEPTANCE: "1" },
    { GITHUB_ACTIONS: "true", FAOLLA_INGRESS_REAL_ACCEPTANCE: "0" }]) {
    const answer = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 5000, windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot ?? "", PATH: "", ...env }, shell: false });
    assert.equal(answer.error, undefined);
    assert.equal(answer.status, 1); assert.equal(answer.stdout, "");
    assert.deepEqual(JSON.parse(answer.stderr), { error: "ingress_acceptance_opt_in_required", stage: "guards" });
  }
});

test("synthetic topology exercises the actual fixed production rule planner without credentials", () => {
  const docker = ingressAcceptanceTopology();
  assert.equal(docker.containers.length, 13);
  assert.equal(new Set(docker.containers.map((row) => row.address)).size, 13);
  const plan = planNftFirewall({ input: { operationId: "11111111-2222-4333-8444-555555555555", appPort: 3000 }, docker });
  assert.deepEqual(plan.inputPorts, [3000, 5432, 6543, 8000, 8443]);
  assert.match(plan.script, /ct direction reply accept/);
  assert.equal((plan.script.match(/ct direction reply accept/g) ?? []).length, 4);
  assert.equal((plan.script.match(/ip daddr [0-9.]+ drop/g) ?? []).length, 13);
  assert.doesNotMatch(plan.script, /flush|54321|192\.168\.1\./);
});

test("all privileged networking happens only after independent network and PID namespace checks", () => {
  assert.match(source, /process\.pid !== 1 \|\| process\.getuid\(\) !== 0/);
  assert.match(source, /readlinkSync\("\/proc\/self\/ns\/net"\) !== netns/);
  assert.match(source, /"--net", "--mount", "--pid", "--fork"/);
  assert.match(source, /"--kill-child=KILL", "--mount-proc"/);
  assert.match(source, /const result = \(command, args, options = \{\}\) => \{\s*assertIsolated\(\)/);
  assert.match(source, /namespaceOf\(entry\.child\) !== entry\.netns/);
  assert.match(source, /timeout: 180000, killSignal: "SIGKILL"/);
  assert.doesNotMatch(source, /run\("docker"|modprobe|systemctl|service\s+nginx|nft.*flush ruleset|\.\.\.process\.env/);
});

test("CI startup diagnostics disclose only fixed tool and namespace phases without relaxing prerequisites", () => {
  for (const step of ["namespace_loopback", "namespace_bridge", "namespace_forwarding", "namespace_bridge_hooks", "namespace_endpoints"]) {
    assert.ok(source.includes(`stage = "${step}";`));
  }
  assert.match(source, /stage = `tool_\$\{key\}`;\s*return \[key, realpathSync\(value\)\]/);
  assert.match(source, /STAGES\.has\(detail\.stage\)/);
  assert.match(source, /readFileSync\(`\/proc\/sys\/net\/bridge\/\$\{name\}`, "utf8"\)\.trim\(\), "1"/);
  assert.doesNotMatch(source, /stderr\.write\(error|stderr\.write\(result|JSON\.stringify\(error\)|console\.(?:log|error)\(error/);
});

test("bridge fixture only accepts modern CI kernel and fixed per-net fields, preserving parent verification on failure", () => {
  const calls = [];
  const values = { "/proc/sys/kernel/osrelease": "6.14.0-1017-azure\n", "/proc/sys/net/bridge/bridge-nf-call-iptables": "0\n",
    "/proc/sys/net/bridge/bridge-nf-call-ip6tables": "1\n" };
  const read = (path) => { calls.push(path); assert.ok(Object.hasOwn(values, path)); return values[path]; };
  assert.deepEqual(readIngressAcceptanceBridgeState(read), { kernelRelease: "6.14.0-1017-azure", bridge4: "0", bridge6: "1" });
  assert.deepEqual(calls, Object.keys(values));
  for (const kernel of ["4.18.0-348.7.1.el8_5.x86_64", "5.15.0-1", "7.0.0-unknown", "untrusted/path", "6.0"]) {
    assert.throws(() => readIngressAcceptanceBridgeState((path) => path.endsWith("osrelease") ? kernel : read(path)), /ingress_acceptance_failed/);
  }
  for (const value of ["", "2", "false", "1\n0"]) {
    assert.throws(() => readIngressAcceptanceBridgeState((path) => path.endsWith("osrelease") ? values[path] : value), /ingress_acceptance_failed/);
  }
  assert.throws(() => readIngressAcceptanceBridgeState(() => { throw new Error("missing"); }), /missing/);
  const checks = source.slice(source.indexOf('// Always verify parent state'));
  assert.ok(checks.indexOf("JSON.stringify(readIngressAcceptanceBridgeState())") < checks.indexOf("if (result.error"));
  assert.match(source, /assertIsolated\(\);\s*writeFileSync\(`\/proc\/sys\/net\/bridge\/\$\{name\}`, "1\\n"\)/);
  assert.match(checks, /JSON.stringify\(parentBridge\)\) fail\(\)/);
});

test("acceptance keeps real capture install verification and exact restore, with actual data-plane baselines", () => {
  for (const call of ["captureNftFirewall(d)", "installNftFirewall(frozen, plan, d)", "verifyNftFirewall(frozen, plan, d)", "restoreNftFirewall(frozen, plan, d)"]) {
    assert.ok(source.includes(call), call);
  }
  assert.match(source, /firewall\.captureNftFirewall\(d\), frozen/);
  assert.match(source, /fixture_firewalld/);
  assert.match(source, /"functions", "db"/);
  assert.match(source, /http:\/\/\[fd42:200::1\]:3000\//);
  assert.match(source, /answer\.status, 28/);
  assert.doesNotMatch(source, /nftables v0\.9\.3|iptables v1\.8\.4/);
});

test("nginx runs only generated private fixture config and validates control-header stripping", () => {
  assert.match(source, /planIngressInstallation\(proof, TOKEN\)/);
  assert.match(source, /source\.replace\(planned\.installation\.privatePath, include\)/);
  assert.match(source, /run\("nginx", \["-t", "-p", fixture \+ "\/", "-c", conf\]\)/);
  assert.match(source, /"daemon off; master_process off;"/);
  assert.match(source, /controlHeaderPresent: false/);
  assert.match(source, /X-Forwarded-For: 127\.0\.0\.1/);
  assert.match(source, /grant_type=refresh_token/);
  assert.match(source, /synthetic_config_and_requests_only/);
  assert.doesNotMatch(source, /nginx", \["-s"|writeFileSync\("\/etc\/|writeFileSync\("\/www\//);
});

test("actual ingress planner accepts the complete synthetic namespace fixture without configuration hand-editing", async () => {
  // This test checks the real planner API; kernel/version evidence comes only
  // from the separate opted-in Linux acceptance, not this synthetic command DI.
  const nft = { nftables: [
    { metainfo: { version: "1.0.9", release_name: "fixture", json_schema_version: 1 } },
    { table: { family: "inet", name: "fixture_firewalld", handle: 1 } },
    { chain: { family: "inet", table: "fixture_firewalld", name: "input", handle: 2, type: "filter", hook: "input", prio: 10, policy: "accept" } },
  ] };
  const frozen = captureNftFirewall({ readText: () => "1", run(command, args) {
    if (args.join(" ") === "--version") return { stdout: command === "nft" ? "nftables v1.0.9 (fixture)" : `${command} v1.8.10 (nf_tables)`, stderr: "" };
    if (command === "nft") { assert.deepEqual(args, ["-j", "-a", "-n", "list", "ruleset"]); return { stdout: JSON.stringify(nft), stderr: "" }; }
    assert.ok(["iptables-save", "ip6tables-save", "ebtables-save"].includes(command));
    return { stdout: "*filter\n:INPUT ACCEPT [0:0]\nCOMMIT\n", stderr: "" };
  } });
  const network = { version: 1, links: [{ index: 1, name: "lo", qdisc: "noqueue", master: null, kind: null }],
    qdiscs: [{ index: 1, kind: "noqueue", handle: 0, parent: 0xffffffff }] };
  const planned = await planIngressAcceptanceNginx({ fixture: "/tmp/faolla-ingress-acceptance-synthetic", frozen,
    docker: ingressAcceptanceTopology(), network });
  assert.equal(planned.installation.files.length, 1);
  assert.equal(planned.nginx.plan.selected.length, 2);
  assert.equal(planned.nginx.plan.controlLocations.length, 1);
  assert.equal(planned.installation.allowlist.length, 4);
  assert.match(planned.installation.files[0].modified, /proxy_set_header X-Faolla-Maintenance-Control "";/);
  assert.match(planned.installation.privateContent, /https:guard\.example\.test:18443:POST:\/auth\/v1\/token:password/);
  assert.match(source, /const network = networkHelper\.captureNetworkBypass\(\)/);
  assert.match(source, /networkHelper\.verifyNetworkBypass\(network\)/);
});
