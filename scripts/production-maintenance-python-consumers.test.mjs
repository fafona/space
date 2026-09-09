import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Isolate builtin mocks from every other test. The child uses the production
// peer's default pythonIdentity/invokePython, but never executes Python or
// connects to a socket. Only its higher-level host observations are synthetic.
const peerUrl = new URL("./production-maintenance-pm2-peer-diagnostic.mjs", import.meta.url).href;
const runtimeUrl = new URL("./production-maintenance-runtime-diagnostic.mjs", import.meta.url).href;
const layoutUrl = new URL("./production-maintenance-runtime-layout.mjs", import.meta.url).href;
const testPath = fileURLToPath(import.meta.url);
const UNKNOWN = { version: 1, maintenance: "not_verified", peerVerified: null, pm2Version: null };
const VERIFIED = { ...UNKNOWN, peerVerified: true, pm2Version: "6.0.14" };

function childSource(scenario) {
  return `
import assert from "node:assert/strict";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
process.argv[1] = ${JSON.stringify(testPath)};
const scenario = ${JSON.stringify(scenario)};
const ENTRY = "/usr/bin/python3", TARGET = "/usr/bin/python3.12";
const SECRET = "CONSUMER_PRIVATE_SENTINEL";
const BOOT = "12345678-1234-1234-1234-123456789abc";
const files = new Map();
let canonicalTarget = TARGET, attempts = 0, unexpectedIO = 0, bootCalls = 0;
const events = [];
function install(path, type, ino, changes = {}) {
  files.set(path, { dev: 1n, ino: BigInt(ino), size: type === "file" ? 4096n : 12n,
    mtimeNs: 4000000000n, ctimeNs: 5000000000n, nlink: type === "directory" ? 2n : 1n,
    uid: 0n, mode: { directory: 0o040755n, file: 0o100755n, symlink: 0o120777n }[type], type, ...changes });
}
for (const [i, path] of ["/", "/usr", "/usr/bin"].entries()) install(path, "directory", i + 1);
install(ENTRY, "symlink", 4); install(TARGET, "file", 5); install("/usr/bin/python3.13", "file", 6);
function mutate(which) {
  if (which === "canonical") canonicalTarget = "/usr/bin/python3.13";
  else {
    const path = { entry: ENTRY, target: TARGET, ancestor: "/usr/bin" }[which];
    const previous = files.get(path); assert.ok(previous);
    files.set(path, { ...previous, ino: previous.ino + 100n, ctimeNs: previous.ctimeNs + 1n });
  }
  events.push("mutated:" + which);
}
if (scenario === "refuse_local") canonicalTarget = "/usr/local/bin/python3.12";
if (scenario === "refuse_leading_zero") canonicalTarget = "/usr/bin/python3.012";
if (scenario === "refuse_hardlink") files.get(TARGET).nlink = 2n;
if (scenario === "refuse_large") files.get(TARGET).size = 67108865n;
if (scenario === "refuse_owner") files.get(TARGET).uid = 1000n;
if (scenario === "refuse_ancestor") files.get("/usr/bin").mode = 0o040775n;

fs.lstatSync = (path, options) => {
  assert.equal(options?.bigint, true);
  if (!files.has(path)) { unexpectedIO++; throw new Error(SECRET); }
  const value = { ...files.get(path) };
  return { ...value, isDirectory: () => value.type === "directory", isFile: () => value.type === "file",
    isSymbolicLink: () => value.type === "symlink" };
};
fs.realpathSync = (path) => {
  if (path === ENTRY) return canonicalTarget;
  if (files.has(path) || path === "/srv/pm2") return path;
  unexpectedIO++; throw new Error(SECRET);
};
// No raw file read, process launch or alternative transport can silently fall
// through to this host. ES module loading itself uses Node's internal loader.
const forbidden = () => { unexpectedIO++; throw new Error(SECRET); };
fs.readFileSync = forbidden;
for (const name of ["spawn", "exec", "execFile", "execSync", "execFileSync", "fork"]) cp[name] = forbidden;
cp.spawnSync = (executable, args, options) => {
  attempts++; events.push("spawn");
  assert.equal(executable, TARGET);
  assert.deepEqual(args.slice(0, 4), ["-I", "-S", "-B", "-c"]);
  assert.equal(args.length, 6);
  assert.match(args[5], /production-maintenance-pm2-connection\\.py$/);
  assert.equal(options.shell, false); assert.equal(options.timeout, 5000);
  assert.equal(options.maxBuffer, 4096); assert.equal(options.cwd, "/");
  assert.deepEqual(options.env, { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" });
  const payload = JSON.parse(options.input);
  assert.deepEqual(Object.keys(payload).sort(), ["daemon", "socketPath"]);
  assert.equal(payload.socketPath, "/srv/pm2/rpc.sock");
  assert.equal(payload.daemon.pid, 10); assert.equal(payload.daemon.bootId, BOOT);
  if (scenario.startsWith("post_")) mutate(scenario.slice(5));
  return { status: 0, signal: null, stderr: "", stdout: JSON.stringify({ version: 1, peerVerified: true, pm2Version: "6.0.14" }) };
};
syncBuiltinESMExports();
const { diagnosePm2Peer } = await import(${JSON.stringify(peerUrl)});
const { createNativeUnknownReasonCounts } = await import(${JSON.stringify(runtimeUrl)});
const { emptyPythonLayout, emptyNativeFileLinkEvidence } = await import(${JSON.stringify(layoutUrl)});
const input = { appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: "a".repeat(40) };
const daemon = { pid: 10, uid: 1000, startTicks: "100", executable: "/opt/node/bin/node",
  executableIdentity: "1:2:3:4:5:1:0:33261", cwd: "/", commandLine: ["PM2 v6.0.14: God Daemon (/srv/pm2)"] };
const web = { pid: 100, uid: 1000, startTicks: "1000", cwd: "/srv/release", commandLine: ["node", SECRET] };
const snapshot = { listener: { chain: [web, daemon] }, ownership: { pid: 100, daemonPid: 10 } };
const metadata = { version: 4, maintenance: "not_verified", stability: "stable", disk: "verified",
  supervision: "runtime_supervision_direct_next_owned", daemonCwdIsRoot: true,
  webMetadata: { cwdLiteralMatch: true, cwdCanonicalMatch: true, entryLiteralMatch: true,
    entryCanonicalMatch: true, interpreterLiteralMatch: true, interpreterCanonicalMatch: true, argsMatch: true, nodeArgsEmpty: true },
  supabaseEnvironment: "matches", worker: { state: "not_observed", nodeDescendantCount: 0, nonNodeDescendantCount: 0 },
  runtimeExtraProcessCount: 0, pm2Home: "matches", pm2Connection: "not_checked", pm2Version: "6.0.14", pm2PathOverridesPresent: false,
  pm2Endpoint: { home: "verified", rpcSocket: "verified", pidFile: "verified", pidMatches: true },
  workerNative: { esbuildCount: 0, otherCount: 0, unknownCount: 0, controlledIdentityVerified: null, unknownReasons: createNativeUnknownReasonCounts() },
  python: { version: "3.12.3", executableVerified: true, afUnixApiAvailable: true, soPeercredApiAvailable: true, rejectionReason: null },
  layoutEvidence: { python: emptyPythonLayout(), nativeFileLinks: emptyNativeFileLinkEvidence() } };
// Do not override python, invoke, or canonical: exercise the actual consumer.
const result = await diagnosePm2Peer(input, {
  metadata: async () => structuredClone(metadata),
  disk: () => ({ runtime: "/srv/release", build: input.expectedOldSha }),
  supervision: async () => structuredClone(snapshot),
  classify: () => "runtime_supervision_direct_next_owned",
  process: (pid) => structuredClone(pid === 10 ? daemon : web),
  boot: () => {
    if (++bootCalls === 2 && scenario.startsWith("pre_")) mutate(scenario.slice(4));
    return BOOT;
  },
});
process.stdout.write(JSON.stringify({ result, attempts, unexpectedIO, events }) + "\\n");
`;
}

function run(scenario) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: childSource(scenario), encoding: "utf8", timeout: 10000, killSignal: "SIGKILL",
    maxBuffer: 8192, windowsHide: true, shell: false,
  });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, "");
  assert.ok(child.stdout.length < 1024);
  assert.doesNotMatch(child.stdout, /CONSUMER_PRIVATE_SENTINEL|\/usr|\/srv|socketPath|startTicks/);
  const reply = JSON.parse(child.stdout);
  assert.equal(reply.unexpectedIO, 0);
  return reply;
}

test("peer defaults use shared capture and a single bounded mock Python invocation", () => {
  const result = run("success");
  assert.deepEqual(result.result, VERIFIED); assert.equal(result.attempts, 1);
  assert.deepEqual(result.events, ["spawn"]);
});

for (const kind of ["entry", "target", "ancestor", "canonical"]) {
  test(`peer shared pre-execution verification rejects valid ${kind} replacement with zero invocations`, () => {
    const result = run(`pre_${kind}`);
    assert.deepEqual(result.result, UNKNOWN); assert.equal(result.attempts, 0);
    assert.deepEqual(result.events, [`mutated:${kind}`]);
  });
  test(`peer shared post-execution verification discards valid ${kind} replacement without replay`, () => {
    const result = run(`post_${kind}`);
    assert.deepEqual(result.result, UNKNOWN); assert.equal(result.attempts, 1);
    assert.deepEqual(result.events, ["spawn", `mutated:${kind}`]);
  });
}

for (const reason of ["local", "leading_zero", "hardlink", "large", "owner", "ancestor"]) {
  test(`peer shared capture refusal (${reason}) cannot invoke Python despite stale positive metadata`, () => {
    const result = run(`refuse_${reason}`);
    assert.deepEqual(result.result, UNKNOWN); assert.equal(result.attempts, 0);
    assert.deepEqual(result.events, []);
  });
}
