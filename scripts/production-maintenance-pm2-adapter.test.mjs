import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { controlPm2, inspectPm2Registry, validatePm2Registry, PM2_CONTROL_BRIDGE_SOURCE,
  capturePm2DumpTarget, persistPm2Dump, verifyPm2Dump, validatePm2DumpReceipt, pm2RegistryDigest } from "./production-maintenance-pm2-adapter.mjs";

const BOOT = "12345678-1234-1234-1234-123456789012";
const id = "1:2:3:4:5:1:0:33261";
const daemon = { pid: 10, parentPid: 1, uid: 0, startTicks: "123", processIdentity: id, cwd: "/", cwdIdentity: id,
  executable: "/usr/bin/node", executableIdentity: id, commandLineDigest: "a".repeat(64) };
const row = () => ({ name: "faolla", pid: 20, pm_id: 0, pm2_env: { name: "faolla", pm_id: 0, status: "online",
  created_at: 123, pm_uptime: 234, restart_time: 0, pm_cwd: "/srv/faolla.releases/aaaaaaaaaaaa-20260909000000",
  pm_exec_path: "/srv/faolla.releases/aaaaaaaaaaaa-20260909000000/node_modules/next/dist/bin/next",
  args: ["start", "-p", "3000"], node_args: [], exec_mode: "fork_mode", exec_interpreter: "/usr/bin/node",
  watch: false, cron_restart: null, autorestart: true, FAOLLA_BACKGROUND_JOBS_PAUSED: null, nonce: null, envDigest: null } });
const request = () => ({ action: "delete", expected: row(), expectedProcess: { pid: 20, uid: 0, startTicks: "200",
  bootId: BOOT, executable: "/usr/bin/node", executableIdentity: id } });
function fixture() {
  const calls = [];
  const f = { calls, current: { ...daemon, commandLine: ["PM2 v6.0.14: God Daemon (/root/.pm2)"] }, boot: BOOT,
    helper: "fixed-helper", python: { target: { path: "/usr/libexec/platform-python3.6" } }, rows: [row()], after: null };
  f.d = { boot: () => f.boot, readProcess: () => structuredClone(f.current), canonical: (path) => path, daemonEnvironment: () => true,
    python: () => structuredClone(f.python), verifyPython: (proof) => { assert.deepEqual(proof, f.python); }, helperProof: () => f.helper,
    invoke(python, payload) {
      calls.push(structuredClone({ python, payload }));
      const answer = { version: 1, pm2Version: "6.0.14", peerVerified: true, registry: f.rows,
        ...(payload.request === null ? {} : { acknowledged: true }) };
      f.after?.();
      return { status: 0, stderr: "", stdout: JSON.stringify(answer) };
    } };
  return f;
}
test("registry transport freezes daemon, root cwd, boot and fixed Python without CLI", async () => {
  const f = fixture(); assert.deepEqual(await inspectPm2Registry(daemon, BOOT, f.d), [row()]);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.socketPath, "/root/.pm2/rpc.sock");
  assert.equal(f.calls[0].payload.request, null); assert.equal(f.calls[0].payload.daemon.bootId, BOOT);
  assert.equal(Object.keys(f.calls[0].payload.daemon).length, 6);
});
test("one fixed control invocation returns bounded filtered evidence, not authority", async () => {
  const f = fixture(); const result = await controlPm2(daemon, BOOT, request(), f.d);
  assert.equal(f.calls.length, 1); assert.equal(result.acknowledged, true); assert.deepEqual(result.registry, [row()]);
});
test("malformed daemon or arbitrary action never reaches Python or filesystem dependencies", async () => {
  for (const input of [{ ...daemon, raw: "private" }, { ...daemon, cwd: "/root/../" }, { ...daemon, startTicks: "0" }]) {
    const f = fixture(); await assert.rejects(inspectPm2Registry(input, BOOT, f.d)); assert.equal(f.calls.length, 0);
  }
  for (const action of [{ action: "save" }, { action: "prepare", launch: {}, arbitrary: true }, { action: "restart", expected: row(), expectedProcess: null }]) {
    const f = fixture(); await assert.rejects(controlPm2(daemon, BOOT, action, f.d)); assert.equal(f.calls.length, 0);
  }
});
test("input accessor, proxy, sparse array and unknown registry keys cannot be invoked or returned", async () => {
  let called = 0;
  const getter = { ...daemon }; Object.defineProperty(getter, "pid", { enumerable: true, get() { called++; return 10; } });
  const proxy = new Proxy(daemon, { get() { called++; }, ownKeys() { called++; return []; } });
  for (const input of [getter, proxy]) await assert.rejects(inspectPm2Registry(input, BOOT, fixture().d));
  assert.equal(called, 0);
  const rows = [row()]; delete rows[0]; assert.throws(() => validatePm2Registry(rows));
  assert.throws(() => validatePm2Registry([{ ...row(), environment: "private" }]));
  assert.throws(() => validatePm2Registry([{ ...row(), pm2_env: { ...row().pm2_env, private: "private" } }]));
});
test("different daemon generation, version, boot or aliased home prevents sending", async () => {
  for (const change of [(f) => { f.current.startTicks = "124"; }, (f) => { f.boot = "b".repeat(36); },
    (f) => { f.current.commandLine = ["PM2 v6.0.15: God Daemon (/root/.pm2)"]; },
    (f) => { f.d.canonical = () => "/different"; }, (f) => { f.d.daemonEnvironment = () => false; },
    (f) => { f.d.verifyPython = () => { throw new Error("secret"); }; }]) {
    const f = fixture(); change(f); await assert.rejects(controlPm2(daemon, BOOT, request(), f.d), { message: "production_maintenance_pm2_unverified" });
    assert.equal(f.calls.length, 0);
  }
});
test("post-send drift and lost acknowledgements remain unknown with no repeat", async () => {
  for (const change of [(f) => { f.helper = "changed"; }, (f) => { f.boot = "changed"; },
    (f) => { f.current.startTicks = "125"; }, (f) => { f.python = { target: { path: "/different" } }; }]) {
    const f = fixture(); f.after = () => change(f);
    await assert.rejects(controlPm2(daemon, BOOT, request(), f.d), { message: "production_maintenance_pm2_outcome_unknown" });
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); const original = f.d.invoke;
  f.d.invoke = (...args) => { original(...args); throw new Error("raw password"); };
  await assert.rejects(controlPm2(daemon, BOOT, request(), f.d), { message: "production_maintenance_pm2_outcome_unknown" });
  assert.equal(f.calls.length, 1);
});
test("read-only failure and malformed replies do not reveal raw private output", async () => {
  for (const result of [{ status: 1, stderr: "secret", stdout: "secret" }, { status: 0, stderr: "", stdout: "secret" },
    { status: 0, stderr: "", stdout: JSON.stringify({ version: 1, pm2Version: "6.0.14", peerVerified: true, registry: [], raw: "secret" }) }]) {
    const f = fixture(); f.d.invoke = () => result;
    await assert.rejects(inspectPm2Registry(daemon, BOOT, f.d), { message: "production_maintenance_pm2_unverified" });
  }
});
test("bridge is isolated, bounded and has no dynamic method or ambient environment", () => {
  const source = readFileSync(new URL("./production-maintenance-pm2-adapter.mjs", import.meta.url), "utf8");
  assert.match(PM2_CONTROL_BRIDGE_SOURCE, /read\(65537\)/);
  assert.match(PM2_CONTROL_BRIDGE_SOURCE, /inspect_pm2_registry/); assert.match(PM2_CONTROL_BRIDGE_SOURCE, /control_pm2_process/);
  assert.doesNotMatch(source, /process\.env|spawnSync\("pm2"|getattr\(|shell: true/);
  assert.match(source, /\["-I", "-S", "-B", "-c"/);
});
test("import from stdin is inert", () => {
  const url = new URL("./production-maintenance-pm2-adapter.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], { input: `await import(${JSON.stringify(url)});`, encoding: "utf8" });
  assert.equal(result.status, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});
const target = () => ({ version: 1, socketPath: "/root/.pm2/rpc.sock",
  daemon: { pid: daemon.pid, uid: daemon.uid, startTicks: daemon.startTicks, bootId: BOOT,
    executable: daemon.executable, executableIdentity: daemon.executableIdentity },
  chain: [["1", "2", "16832", "0", "0"], ["1", "3", "16832", "0", "0"]], dump: null, backup: null });
const receipt = () => ({ version: 1, pm2Version: "6.0.14", peerVerified: true, saved: true, processCount: 1,
  registryHash: pm2RegistryDigest([row()]), target: { ...target(), dump: { identity: id, sha256: "b".repeat(64) } } });
test("fixed dump actions bind full target/receipt and registry without returning raw environments", async () => {
  const f = fixture();
  f.d.invokeDump = (_python, payload) => {
    f.calls.push(payload);
    return { status: 0, stderr: "", stdout: JSON.stringify(payload.request.action === "capture" ? target()
      : payload.request.action === "persist" ? receipt() : true) };
  };
  assert.deepEqual(await capturePm2DumpTarget(daemon, BOOT, f.d), target());
  assert.deepEqual(await persistPm2Dump(daemon, BOOT, [row()], target(), f.d), receipt());
  assert.equal(await verifyPm2Dump(daemon, BOOT, [row()], receipt(), f.d), true);
  assert.deepEqual(f.calls.map((call) => call.request.action), ["capture", "persist", "verify"]);
  assert.doesNotMatch(JSON.stringify(f.calls), /anonKey|password/);
});
test("dump recursive registry hash is stable across property and registry ordering", () => {
  const original = row(), reordered = Object.fromEntries(Object.entries(original).reverse());
  reordered.pm2_env = Object.fromEntries(Object.entries(original.pm2_env).reverse());
  assert.equal(pm2RegistryDigest([original]), pm2RegistryDigest([reordered]));
  const second = { ...row(), name: "other", pm_id: 8, pm2_env: { ...row().pm2_env, name: "other", pm_id: 8 } };
  assert.equal(pm2RegistryDigest([original, second]), pm2RegistryDigest([second, reordered]));
  assert.notEqual(pm2RegistryDigest([original]), pm2RegistryDigest([{ ...original, pid: 44 }]));
});
test("dump wrong peer, home, hash, identity and extra fields reject before persistence", async () => {
  for (const change of [(t) => { t.daemon.pid++; }, (t) => { t.socketPath = "/other/rpc.sock"; },
    (t) => { t.chain[0][0] = "-1"; }, (t) => { t.dump = { identity: "bad", sha256: "b".repeat(64) }; },
    (t) => { t.rawEnvironment = "secret"; }]) {
    const f = fixture(), t = target(); change(t); let invoked = false;
    f.d.invokeDump = () => { invoked = true; };
    await assert.rejects(persistPm2Dump(daemon, BOOT, [row()], t, f.d)); assert.equal(invoked, false);
  }
  for (const change of [(r) => { r.registryHash = "c".repeat(64); }, (r) => { r.target.dump = null; },
    (r) => { r.processCount = 2; }, (r) => { r.raw = "secret"; }]) {
    const r = receipt(); change(r); assert.throws(() => validatePm2DumpReceipt(r, daemon, BOOT, [row()]));
  }
});
test("lost dump save response is unknown once only; verify is strictly read-only failure", async () => {
  for (const action of ["persist", "verify"]) {
    const f = fixture(); let calls = 0;
    f.d.invokeDump = () => { calls++; throw new Error("private bytes"); };
    await assert.rejects(action === "persist" ? persistPm2Dump(daemon, BOOT, [row()], target(), f.d)
      : verifyPm2Dump(daemon, BOOT, [row()], receipt(), f.d),
    { message: action === "persist" ? "production_maintenance_pm2_outcome_unknown" : "production_maintenance_pm2_unverified" });
    assert.equal(calls, 1);
  }
});
