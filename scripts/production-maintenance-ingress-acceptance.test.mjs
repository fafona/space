import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ingressAcceptanceTopology, planIngressAcceptanceNginx, readIngressAcceptanceBridgeState, readIngressAcceptanceDiagnostic, readSyntheticFixtureNftStderr,
  validateIngressAcceptanceInvocation } from "./production-maintenance-ingress-acceptance.mjs";
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

test("failure diagnostics preserve actual bounded tool versions but never raw commands, responses or errors", () => {
  const value = { lastTool: "nft", action: "read_ruleset", exitCode: 1, signal: null, errno: null, stderrClass: "managed_warning", fixtureNftStderr: null,
    warnings: ["# Warning: table ip filter is managed by iptables-nft, do not touch!"],
    frames: [{ file: "production-maintenance-nft.mjs", line: 33, column: 9 }], nftShape: [{ left: "ct.state", op: "==", right: "set:established,related" }],
    versions: { nft: "nftables v1.0.9 (Old Doc Yak #3)",
    iptables: "iptables v1.8.10 (nf_tables)", "ebtables-save": "unrecognized" } };
  assert.deepEqual(readIngressAcceptanceDiagnostic(value), value);
  for (const patch of [{ lastTool: "/private/path" }, { exitCode: -1 }, { exitCode: 1.5 }, { stderr: "sensitive" },
    { versions: { nft: "private-error credential" } }, { versions: { private: "nftables v1.0.9" } },
    { versions: { nft: "nftables v1.0.9\nprivate" } }, { action: "privatecommand" }, { signal: "private" }, { errno: "private" },
    { frames: [{ file: "/private/path", line: 1, column: 1 }] }, { warnings: ["secret"] },
    { nftShape: [{ left: "ip.daddr", op: "==", right: "private-value" }] }]) {
    assert.equal(readIngressAcceptanceDiagnostic({ ...value, ...patch }), null);
  }
  assert.equal(readIngressAcceptanceDiagnostic(null), null);
});

test("raw tool stderr exception is bounded and only matches the immutable synthetic baseline input", () => {
  const input = "add table inet fixture_firewalld\nadd chain inet fixture_firewalld input { type filter hook input priority 10; policy accept; }\nadd chain inet fixture_firewalld forward { type filter hook forward priority 10; policy accept; }\nadd rule inet fixture_firewalld input counter accept\nadd rule inet fixture_firewalld forward counter accept\n";
  const read = (command = "nft", args = ["-f", "-"], script = input, phase = "baseline_tables", stderr = "fixed fixture tool error") =>
    readSyntheticFixtureNftStderr(command, args, script, phase, stderr);
  assert.equal(read(), "fixed fixture tool error");
  assert.equal(read("curl"), null);
  assert.equal(read("nft", ["-j", "list", "ruleset"]), null);
  assert.equal(read("nft", ["-f", "-"], input + "# extra"), null);
  assert.equal(read("nft", ["-f", "-"], input, "nft_install"), null);
  assert.equal(Buffer.byteLength(read("nft", ["-f", "-"], input, "baseline_tables", "x".repeat(5000))), 1024);
  assert.ok(Buffer.byteLength(read("nft", ["-f", "-"], input, "baseline_tables", "界".repeat(5000))) <= 1024);
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

test("every nft stdin batch uses the real production pipe transport without faking interpreter checks or retrying", () => {
  assert.match(source, /import \{ runNftBatch \} from "\.\/production-maintenance-nft-transport\.mjs"/);
  const runner = source.slice(source.indexOf("const result = (command, args"), source.indexOf("const namespaceOf ="));
  assert.match(runner, /command === "nft" && args\.length === 2 && args\[0\] === "-f" && args\[1\] === "-"/);
  assert.match(runner, /runNftBatch\(options\.input, \{ spawn\(command, args, options\) \{\s*assertIsolated\(\);\s*observed = spawnSync\(command, args, options\);\s*return observed;/);
  assert.doesNotMatch(runner, /capturePython:|verifyPython:|NFT_PIPE_PYTHON|retry|for\s*\(|while\s*\(/);
  assert.equal((runner.match(/runNftBatch\(/g) ?? []).length, 1);
  assert.match(runner, /answer = \{ stdout: observed\?\.stdout \?\? "", stderr: observed\?\.stderr \?\? "", status: 1/);
  assert.match(runner, /if \(Object\.hasOwn\(options, "input"\)\) fail\(\)/);
});

test("nginx runs only generated private fixture config and validates control-header stripping", () => {
  assert.match(source, /planIngressInstallation\(proof, TOKEN\)/);
  assert.match(source, /source\.replace\(planned\.installation\.privatePath, include\)/);
  assert.match(source, /run\("nginx", \["-t", "-p", fixture \+ "\/", "-c", conf\]\)/);
  assert.match(source, /"daemon off; master_process off;"/);
  assert.match(source, /controlHeaderPresent: false/);
  assert.match(source, /X-Forwarded-For: 127\.0\.0\.1/);
  assert.match(source, /grant_type=refresh_token/);
  assert.match(source, /TOKEN\.toUpperCase\(\), TOKEN \+ "0", "0" \+ TOKEN, "b"\.repeat\(64\)/);
  assert.match(source, /https:\/\/guard-example-test:18443\/rest\/v1\//);
  assert.match(source, /\["OPTIONS", "\/rest\/v1\/"\]/);
  assert.match(source, /synthetic_config_and_requests_only/);
  for (const directory of ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"]) {
    assert.ok(source.includes(`${directory}_temp_path $` + "{fixture}/"), directory);
  }
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
  assert.ok(planned.installation.privateContent.includes(
    JSON.stringify(String.raw`~\Ahttps:guard\.example\.test:18443:POST:/auth/v1/token:password\z`) + " 1;"));
  assert.match(source, /const network = networkHelper\.captureNetworkBypass\(\)/);
  assert.match(source, /networkHelper\.verifyNetworkBypass\(network\)/);
});
