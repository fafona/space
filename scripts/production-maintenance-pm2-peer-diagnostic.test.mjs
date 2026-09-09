import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnosePm2Peer, PM2_PEER_BRIDGE_SOURCE, validatePm2PeerDiagnostic } from "./production-maintenance-pm2-peer-diagnostic.mjs";
import { createNativeUnknownReasonCounts } from "./production-maintenance-runtime-diagnostic.mjs";

const ERROR = "production_maintenance_pm2_peer_unverified";
const SECRET = "PEER_SECRET_MUST_NOT_LEAK";
const DIRECT = "runtime_supervision_direct_next_owned";
const BOOT = "12345678-1234-1234-1234-123456789abc";
const UNKNOWN = { version: 1, maintenance: "not_verified", peerVerified: null, pm2Version: null };
const input = () => ({ appDir: "/srv/faolla", appName: "faolla", appPort: 3000, expectedOldSha: "a".repeat(40) });
function fixture() {
  const daemon = { pid: 10, uid: 1000, startTicks: "100", executable: "/opt/node/bin/node",
    executableIdentity: "1:2:3:4:5:1:0:33261", cwd: "/", commandLine: ["PM2 v6.0.14: God Daemon (/srv/pm2)"] };
  const web = { pid: 100, uid: 1000, startTicks: "1000", cwd: "/srv/release", commandLine: ["node", SECRET] };
  const snapshot = { listener: { chain: [web, daemon] }, ownership: { pid: 100, daemonPid: 10 } };
  const disk = { runtime: "/srv/release", build: "a".repeat(40) };
  const metadata = { version: 3, maintenance: "not_verified", stability: "stable", disk: "verified", supervision: DIRECT,
    daemonCwdIsRoot: true, webMetadata: { cwdLiteralMatch: true, cwdCanonicalMatch: true, entryLiteralMatch: true,
      entryCanonicalMatch: true, interpreterLiteralMatch: true, interpreterCanonicalMatch: true, argsMatch: true, nodeArgsEmpty: true },
    supabaseEnvironment: "matches", worker: { state: "not_observed", nodeDescendantCount: 0, nonNodeDescendantCount: 0 },
    runtimeExtraProcessCount: 0, pm2Home: "matches", pm2Connection: "not_checked", pm2Version: "6.0.14", pm2PathOverridesPresent: false,
    pm2Endpoint: { home: "verified", rpcSocket: "verified", pidFile: "verified", pidMatches: true },
    workerNative: { esbuildCount: 0, otherCount: 0, unknownCount: 0, controlledIdentityVerified: null, unknownReasons: createNativeUnknownReasonCounts() },
    python: { version: "3.12.3", executableVerified: true, afUnixApiAvailable: true, soPeercredApiAvailable: true, rejectionReason: null } };
  const python = { executable: "/usr/bin/python3.12", file: "frozen-file", directories: ["root", "usr", "bin"] };
  const calls = [];
  const state = { boot: BOOT };
  const deps = { metadata: async () => structuredClone(metadata), disk: () => structuredClone(disk),
    supervision: async () => structuredClone(snapshot), classify: () => DIRECT,
    process: (pid) => structuredClone(pid === daemon.pid ? daemon : web), canonical: (path) => path,
    python: () => structuredClone(python), boot: () => state.boot,
    invoke: (executable, payload) => { calls.push({ executable, payload });
      return { version: 1, peerVerified: true, pm2Version: "6.0.14" }; } };
  return { deps, calls, daemon, web, snapshot, disk, metadata, python, state };
}
const diagnose = (f) => diagnosePm2Peer(input(), f.deps);

test("fresh same-peer version proof is scalar and never grants maintenance", async () => {
  const f = fixture(); const result = await diagnose(f);
  assert.deepEqual(result, { ...UNKNOWN, peerVerified: true, pm2Version: "6.0.14" });
  assert.deepEqual(validatePm2PeerDiagnostic(result), result);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload, { socketPath: "/srv/pm2/rpc.sock", daemon: {
    pid: 10, uid: 1000, startTicks: "100", executable: "/opt/node/bin/node",
    executableIdentity: "1:2:3:4:5:1:0:33261", bootId: BOOT } });
  assert.doesNotMatch(JSON.stringify(result), /PEER_SECRET|\/srv|pid|operationId|held/);
});

test("unverified metadata prevents any socket invocation", async () => {
  const changes = [
    (m) => { m.stability = "unverified"; }, (m) => { m.disk = "unverified"; },
    (m) => { m.supervision = "legacy"; }, (m) => { m.version = 1; },
    (m) => { m.pm2Connection = "verified"; }, (m) => { m.pm2Version = null; },
    (m) => { m.pm2PathOverridesPresent = true; },
    ...["home", "rpcSocket", "pidFile"].map((key) => (m) => { m.pm2Endpoint[key] = "unsafe"; }),
    (m) => { m.pm2Endpoint.pidMatches = false; },
    ...["executableVerified", "afUnixApiAvailable", "soPeercredApiAvailable"].map((key) => (m) => { m.python[key] = false; }),
  ];
  for (const change of changes) {
    const f = fixture(); change(f.metadata);
    assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(f.calls.length, 0);
  }
});

test("frozen daemon version and canonical home are required before connecting", async () => {
  for (const title of ["PM2 v6.0.8: God Daemon (/srv/pm2)", "PM2 v6.0.14: God Daemon (/)",
    "PM2 v6.0.14: God Daemon (/srv/../pm2)", "PM2 v6.0.14: God Daemon (/srv/pm2/)", SECRET]) {
    const f = fixture(); f.daemon.commandLine = [title];
    assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.deps.canonical = () => "/other/pm2";
  assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(f.calls.length, 0);
});

test("v3 reasons are informational and malformed or rejected metadata cannot reach the peer", async () => {
  for (const change of [
    (m) => { m.version = 2; },
    (m) => { m.python.rejectionReason = "target_links"; },
    (m) => { m.python = { version: null, executableVerified: false, afUnixApiAvailable: null,
      soPeercredApiAvailable: null, rejectionReason: "target_links" }; },
    (m) => { m.workerNative.unknownReasons.file_links = 1; },
    (m) => { m.workerNative.unknownReasons.secret = SECRET; },
    (m) => { m.python.rejectionReason = SECRET; },
  ]) {
    const f = fixture(); change(f.metadata);
    assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(f.calls.length, 0);
  }
});

test("live process, Python or boot failures prevent a connection", async () => {
  for (const change of [
    (f) => { f.deps.process = () => ({ ...f.daemon, startTicks: "changed" }); },
    (f) => { f.deps.python = () => { throw new Error(SECRET); }; },
    (f) => { f.deps.boot = () => "invalid"; },
    (f) => { f.deps.classify = () => "unknown"; },
  ]) {
    const f = fixture(); change(f); assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(f.calls.length, 0);
  }
});

test("wrong versions, raw errors and augmented replies fail without replay", async () => {
  for (const answer of [null, { error: SECRET }, { version: 1, peerVerified: true, pm2Version: "6.0.8" },
    { version: 1, peerVerified: true, pm2Version: "6.0.14-beta.1" },
    { version: 1, peerVerified: false, pm2Version: "6.0.14" },
    { version: 1, peerVerified: true, pm2Version: "6.0.14", extra: SECRET }]) {
    const f = fixture(); let count = 0; f.deps.invoke = () => { count++; return answer; };
    assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(count, 1);
  }
  const f = fixture(); let count = 0; f.deps.invoke = () => { count++; throw new Error(SECRET); };
  assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(count, 1);
});

test("post-query runtime, daemon, Python and boot drift invalidate the proof", async () => {
  for (const change of [
    (f) => { f.disk.build = "b".repeat(40); },
    (f) => { f.daemon.startTicks = "101"; },
    (f) => { f.web.startTicks = "1001"; },
    (f) => { f.python.file = "replacement"; },
    (f) => { f.state.boot = "00000000-0000-0000-0000-000000000000"; },
  ]) {
    const f = fixture(); const invoke = f.deps.invoke;
    f.deps.invoke = (...args) => { const result = invoke(...args); change(f); return result; };
    assert.deepEqual(await diagnose(f), UNKNOWN); assert.equal(f.calls.length, 1);
  }
});

test("input and diagnostic contracts reject extra fields and accessors", async () => {
  for (const value of [{ ...input(), operationId: SECRET }, { ...input(), appDir: "/" },
    { ...input(), appDir: "/srv/../faolla" }, { ...input(), appPort: 80 },
    { ...input(), get appName() { throw new Error(SECRET); } }]) {
    await assert.rejects(diagnosePm2Peer(value, fixture().deps), { message: ERROR });
  }
  for (const value of [{ ...UNKNOWN, held: true }, { ...UNKNOWN, peerVerified: true },
    { ...UNKNOWN, pm2Version: "6.0.14" }, { ...UNKNOWN, maintenance: "verified" },
    { ...UNKNOWN, get peerVerified() { throw new Error(SECRET); } }]) {
    assert.throws(() => validatePm2PeerDiagnostic(value), { message: ERROR });
  }
});

test("bridge uses fixed isolated Python and a bounded version-only helper", () => {
  const source = readFileSync(new URL("./production-maintenance-pm2-peer-diagnostic.mjs", import.meta.url), "utf8");
  assert.match(source, /\["-I", "-S", "-B", "-c", PM2_PEER_BRIDGE_SOURCE, helper\]/);
  assert.match(source, /timeout: 5000, killSignal: "SIGKILL", maxBuffer: 4096, shell: false/);
  assert.match(source, /env: \{ PATH: "\/usr\/bin:\/bin", LANG: "C", LC_ALL: "C" \}/);
  assert.doesNotMatch(source, /process\.env|pm2\.connect|pm2List|productionOperations|startProcess|deleteProcess/);
  const helper = fileURLToPath(new URL("./production-maintenance-pm2-connection.py", import.meta.url));
  for (const payload of [JSON.stringify({ socketPath: "/not/a/socket", daemon: {} }), "x".repeat(8193), "{"]) {
    const result = spawnSync(process.platform === "win32" ? "python.exe" : "python3",
      ["-I", "-S", "-B", "-c", PM2_PEER_BRIDGE_SOURCE, helper], { input: payload, encoding: "utf8",
        timeout: 5000, killSignal: "SIGKILL", windowsHide: true, shell: false, maxBuffer: 4096,
        env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" } });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.equal(result.stdout, ""); assert.equal(result.stderr.trim(), ERROR);
  }
});

test("stdin import is inert and does not initialize runtime inspection", () => {
  const target = new URL("./production-maintenance-pm2-peer-diagnostic.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(target)});`, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
